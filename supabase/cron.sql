-- home.os: run the scheduler Edge Function every 15 minutes.
--
-- The scheduler sends push reminders, missed alerts and the weekly email
-- (supabase/functions/scheduler). It decides itself what is due in each household's time
-- zone, so calling it often is safe: everything is logged and goes out once.
--
-- Run this ONCE in the Supabase SQL Editor after deploying the function and setting its
-- secrets (README "Push notifications and the weekly email"):
--
--   1. Replace the two placeholders in step 2 below:
--        - your project URL (Project Settings -> API -> Project URL)
--        - the CRON_SECRET you gave the function (npx supabase secrets set CRON_SECRET=...)
--   2. Run the whole script.
--
-- It is safe to run again: the secrets are updated in place and the job is replaced. To
-- change only the schedule, leave the placeholders as they are; the stored secrets are kept.
--
-- Useful afterwards:
--   select * from cron.job where jobname = 'home-os-scheduler';
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select id, status_code, content from net._http_response order by created desc limit 10;
--   select cron.unschedule('home-os-scheduler');   -- stop it

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extensions: pg_cron (the timer), pg_net (HTTP from SQL), Vault (secrets)
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Secrets, stored encrypted in Vault (never in the job's command text)
-- ─────────────────────────────────────────────────────────────────────────────

do $secrets$
declare
  -- ▼ Replace these two values ▼
  v_project_url text := 'https://YOUR-PROJECT-REF.supabase.co';
  v_cron_secret text := 'YOUR-CRON-SECRET';
  -- ▲ Replace these two values ▲

  v_placeholders boolean;
  v_id uuid;
begin
  v_project_url := rtrim(btrim(v_project_url), '/');
  v_cron_secret := btrim(v_cron_secret);
  -- (Written so that a find-and-replace of the placeholders does not change this check.)
  v_placeholders := v_project_url ~ 'YOUR-' or v_cron_secret ~ '^YOUR-' or v_cron_secret = '';

  if v_placeholders then
    -- Re-running just to reschedule is fine once the secrets exist.
    if (select count(*) from vault.secrets where name in ('home_os_project_url', 'home_os_cron_secret')) = 2 then
      raise notice 'Placeholders left as they are: keeping the secrets already in Vault.';
      return;
    end if;
    raise exception 'Replace YOUR-PROJECT-REF and YOUR-CRON-SECRET at the top of step 2, then run the script again.';
  end if;

  if v_project_url !~ '^https?://' then
    raise exception 'The project URL should look like https://abcdefghijklmnop.supabase.co (got %).', v_project_url;
  end if;

  select id into v_id from vault.secrets where name = 'home_os_project_url';
  if v_id is null then
    perform vault.create_secret(v_project_url, 'home_os_project_url', 'home.os: Supabase project URL for the scheduler cron job');
  else
    perform vault.update_secret(v_id, v_project_url);
  end if;

  select id into v_id from vault.secrets where name = 'home_os_cron_secret';
  if v_id is null then
    perform vault.create_secret(v_cron_secret, 'home_os_cron_secret', 'home.os: CRON_SECRET of the scheduler Edge Function');
  else
    perform vault.update_secret(v_id, v_cron_secret);
  end if;
end
$secrets$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The job: every 15 minutes, POST to /functions/v1/scheduler with the bearer secret
-- ─────────────────────────────────────────────────────────────────────────────

-- Replace an earlier version of the job.
select cron.unschedule(jobid) from cron.job where jobname = 'home-os-scheduler';

select cron.schedule(
  'home-os-scheduler',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'home_os_project_url')
      || '/functions/v1/scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'home_os_cron_secret')
    ),
    body := '{}'::jsonb,
    -- The function may take a while when many messages are due; don't cut it off at the 5 s default.
    timeout_milliseconds := 120000
  ) as request_id;
  $job$
);
