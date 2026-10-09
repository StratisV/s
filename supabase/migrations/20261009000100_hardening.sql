-- home.os hardening: size and format limits, push endpoint rules, fixed authorship, and a
-- trimmed item view for the scheduler.
--
-- Like the earlier migrations, everything here can be applied again without errors
-- (drop/add for constraints, create or replace for functions and the view).
--
-- Limits (src/lib/constants.ts TEXT_LIMITS; the inputs use the same maxLength). Lengths are
-- characters, as Postgres length() counts them:
--   items.title 200, items.note 4000, members.name 40, members.emoji 16,
--   members.color '#RRGGBB', households.name 60, households.address 120, areas.name 60,
--   push_subs.endpoint https only and 2048, push_subs.p256dh / auth 256,
--   push_subs.user_agent 512 (longer values are cut by the insert trigger).
-- A violation raises check_violation (SQLSTATE 23514), which the RPCs pass through too.

-- ─────────────────────────────────────────────────────────────────────────────
-- Triggers
-- ─────────────────────────────────────────────────────────────────────────────

-- items: as before, plus created_by and created_at are fixed once the row exists. The only
-- change allowed to created_by is the "on delete set null" cascade when the creator's member
-- row is deleted (by then that row is gone, which is how the cascade is told apart from a
-- client clearing the column).
create or replace function public.items_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
begin
  if tg_op = 'INSERT'
    or new.area_id is distinct from old.area_id
    or new.household_id is distinct from old.household_id
  then
    select a.household_id into v_household_id from public.areas a where a.id = new.area_id;
    if v_household_id is null then
      raise exception 'not_found';
    end if;
    new.household_id := v_household_id;
  end if;

  if new.assignee_id is not null and (
    tg_op = 'INSERT'
    or new.assignee_id is distinct from old.assignee_id
    or new.household_id is distinct from old.household_id
  ) then
    if not exists (
      select 1 from public.members m
      where m.id = new.assignee_id and m.household_id = new.household_id
    ) then
      raise exception 'invalid_input';
    end if;
  end if;

  new.updated_at := now();
  new.updated_by := public.current_member_id();
  if tg_op = 'INSERT' then
    -- The signed-in creator; a service role insert keeps what it was given.
    new.created_by := coalesce(new.updated_by, new.created_by);
  else
    new.created_at := old.created_at;
    if new.created_by is distinct from old.created_by then
      if new.created_by is not null
        or exists (select 1 from public.members m where m.id = old.created_by)
      then
        new.created_by := old.created_by;
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- push_subs: a browser that subscribes again with a stored endpoint replaces the old row,
-- but only when that row is the caller's own or carries the same keys (the same browser
-- subscription, perhaps left behind by another account that signed out without
-- unsubscribing). Knowing someone's endpoint alone is not enough: the insert then fails on
-- the unique constraint, or an upsert on the other user's RLS policy, and their row stays.
-- A long user agent is cut to 512 characters instead of failing the subscription.
create or replace function public.push_subs_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.user_agent := left(new.user_agent, 512);
  delete from public.push_subs s
  where s.endpoint = new.endpoint
    and (s.user_id = new.user_id or (s.p256dh = new.p256dh and s.auth = new.auth));
  return new;
end;
$$;

revoke all on function public.items_before_write() from public, anon, authenticated;
revoke all on function public.push_subs_before_insert() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Bring existing rows within the limits, so the constraints below can be validated. Rows
-- that are already within them are not touched, so this is a no-op on a second run.
-- ─────────────────────────────────────────────────────────────────────────────

update public.items set title = left(btrim(title), 200) where length(title) > 200;
update public.items set note = left(note, 4000) where length(note) > 4000;
update public.members set name = left(btrim(name), 40) where length(name) > 40;
update public.members set emoji = '🦔' where length(emoji) > 16;
update public.members set color = '#007AFF' where color !~ '^#[0-9A-Fa-f]{6}$';
update public.households set name = left(btrim(name), 60) where length(name) > 60;
update public.households set address = left(btrim(address), 120) where length(address) > 120;
update public.areas set name = left(btrim(name), 60) where length(name) > 60;
update public.push_subs set user_agent = left(user_agent, 512) where length(user_agent) > 512;
-- A subscription the scheduler would refuse to contact is of no use to anyone.
delete from public.push_subs
where endpoint !~ '^https://\S+$'
   or length(endpoint) > 2048
   or length(p256dh) > 256
   or length(auth) > 256;

-- ─────────────────────────────────────────────────────────────────────────────
-- Constraints
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.items drop constraint if exists items_title_length;
alter table public.items add constraint items_title_length check (length(title) <= 200);
alter table public.items drop constraint if exists items_note_length;
alter table public.items add constraint items_note_length check (length(note) <= 4000);

alter table public.members drop constraint if exists members_name_length;
alter table public.members add constraint members_name_length check (length(name) <= 40);
alter table public.members drop constraint if exists members_emoji_length;
alter table public.members add constraint members_emoji_length check (length(emoji) <= 16);
alter table public.members drop constraint if exists members_color_hex;
alter table public.members add constraint members_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$');

alter table public.households drop constraint if exists households_name_length;
alter table public.households add constraint households_name_length check (length(name) <= 60);
alter table public.households drop constraint if exists households_address_length;
alter table public.households add constraint households_address_length check (length(address) <= 120);

alter table public.areas drop constraint if exists areas_name_length;
alter table public.areas add constraint areas_name_length check (length(name) <= 60);

-- The scheduler POSTs to the endpoint, so only https URLs of a sane length are stored. Which
-- push services it will actually contact is decided in the Edge Function (an allowlist in
-- supabase/functions/_shared/webpush.ts), so a new browser vendor never needs a migration.
alter table public.push_subs drop constraint if exists push_subs_endpoint_https;
alter table public.push_subs add constraint push_subs_endpoint_https
  check (endpoint ~ '^https://\S+$' and length(endpoint) <= 2048);
alter table public.push_subs drop constraint if exists push_subs_keys_length;
alter table public.push_subs add constraint push_subs_keys_length
  check (length(p256dh) <= 256 and length(auth) <= 256);
alter table public.push_subs drop constraint if exists push_subs_user_agent_length;
alter table public.push_subs add constraint push_subs_user_agent_length
  check (length(user_agent) <= 512);

-- ─────────────────────────────────────────────────────────────────────────────
-- scheduler_open_items: the open items as the scheduler reads them, with the note already
-- squashed to its first 200 characters (the weekly email shows 160), so a run does not
-- download every full note of every household. Service role only.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view public.scheduler_open_items
with (security_invoker = true)
as
select
  i.id,
  i.household_id,
  i.area_id,
  i.title,
  left(btrim(regexp_replace(i.note, '\s+', ' ', 'g')), 200) as note,
  i.rag,
  i.due_date,
  i.assignee_id,
  i.notify,
  i.status,
  i.created_at
from public.items i
where i.status = 'open';

revoke all on table public.scheduler_open_items from public, anon, authenticated;
grant select on table public.scheduler_open_items to service_role;
