-- home.os goals for the week (the Goals tab) and their public link.
--
-- The contract lives in docs/ARCHITECTURE.md ("Goals for the week"). In short:
--   - goals: the household's goals, week by week. A week is named by its Monday (household
--     time zone). Each goal has a title (trimmed, 1 to 120 characters), who is on it (or no
--     one), its place in its week (0…n-1), whether it is done (who ticked it and when), the
--     goal of the week before it was brought over from, and who added it and when. At most 50
--     a week (goals_week_limit).
--   - goal_links: the household's public link, one at most: a 128-bit random token
--     (22 characters of base64url). Turning it off deletes the row, so the token stops
--     working for good; a new link has a new token.
--   - public_goals(token): for anyone, anon included, with no sign-in: the current week
--     (household time zone) of the goals of the household whose link has that token, as
--     JSON with only each goal's title, its tick and who is on it (first name and emoji).
--     Nothing else of the home. Null for any other token.
--
-- Every member reads all of it; outsiders and anon read nothing (but public_goals). Goals and
-- the link are written only through the RPCs below, each of which takes the household's goals
-- lock first, so a week's places stay 0…n-1 and two people moving goals at once both keep their
-- moves.
--
-- Errors, as in the earlier migrations: not_signed_in, not_found (also for anything in another
-- household), invalid_input (a week that is not a Monday, a negative place); a size or count
-- limit raises check_violation (SQLSTATE 23514) naming the constraint (goals_title_length,
-- goals_week_limit).
--
-- Like the earlier migrations, everything here can be applied again without errors (if not
-- exists, create or replace, drop/create for triggers and policies), and applying it again
-- changes no data.

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- The Monday of its week in the household's time zone.
  week date not null,
  -- Trimmed by the trigger, so a blank title fails the length check.
  title text not null,
  -- Who is on it; null for no one.
  member_id uuid null references public.members (id) on delete set null,
  -- Its place in its week, 0 first; a new goal goes last (trigger).
  position integer not null default 0,
  done boolean not null default false,
  -- Who ticked it and when; both null while not done (done_by also once they are removed).
  done_by uuid null references public.members (id) on delete set null,
  done_at timestamptz null,
  -- The goal of the week before it was brought over from (bring_over_goals).
  carried_from uuid null references public.goals (id) on delete set null,
  created_by uuid null references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint goals_title_length check (length(title) between 1 and 120),
  constraint goals_week_monday check (extract(isodow from week) = 1),
  constraint goals_done_stamp check (done or (done_by is null and done_at is null))
);

create table if not exists public.goal_links (
  -- Its own id as the primary key, so a realtime DELETE notice (which carries only the
  -- primary key, to every subscriber) never names a household.
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  token text not null,
  created_by uuid null references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint goal_links_one_per_home unique (household_id),
  constraint goal_links_token_unique unique (token),
  constraint goal_links_token_shape check (token ~ '^[A-Za-z0-9_-]{22}$')
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes (loading a household, a week's goals, RLS, realtime filters and foreign key
-- cascades). A goal is brought into a week at most once.
-- ─────────────────────────────────────────────────────────────────────────────

create index if not exists goals_household_week_idx on public.goals (household_id, week, position);
create index if not exists goals_member_id_idx on public.goals (member_id);
create index if not exists goals_done_by_idx on public.goals (done_by);
create index if not exists goals_created_by_idx on public.goals (created_by);
create index if not exists goals_carried_from_idx on public.goals (carried_from);
create unique index if not exists goals_carried_once on public.goals (week, carried_from) where carried_from is not null;
create index if not exists goal_links_created_by_idx on public.goal_links (created_by);

-- ─────────────────────────────────────────────────────────────────────────────
-- Internal helpers (not callable by clients; grants at the end)
-- ─────────────────────────────────────────────────────────────────────────────

-- Serialises, per household and until the end of the transaction, every write to its goals
-- (adding, moving, deleting, bringing over), so a week's places stay 0…n-1.
create or replace function public.goals_lock(p_household_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(4713, pg_catalog.hashtext(p_household_id::text))
$$;

-- The Monday of the week a day is in.
create or replace function public.goals_week_of(p_day date)
returns date
language sql
immutable
set search_path = ''
as $$
  select p_day - (extract(isodow from p_day)::integer - 1)
$$;

-- A fresh link token: 16 random bytes as base64url without padding (22 characters). The
-- bytes are the fully random ones of two version 4 uuids (gen_random_uuid() is built in and
-- uses the server's strong random source), so no extension is needed.
create or replace function public.goals_new_token()
returns text
language sql
volatile
set search_path = ''
as $$
  with b as (
    select pg_catalog.uuid_send(pg_catalog.gen_random_uuid()) as a,
           pg_catalog.uuid_send(pg_catalog.gen_random_uuid()) as c
  )
  select pg_catalog.rtrim(
    pg_catalog.translate(
      pg_catalog.encode(
        substring(b.a from 1 for 6) || substring(b.a from 8 for 1) ||
        substring(b.a from 10 for 7) || substring(b.c from 1 for 2),
        'base64'
      ),
      '+/', '-_'
    ),
    '='
  )
  from b
$$;

-- The caller's member row in p_household_id: not_signed_in without a user, not_found when
-- they are not in it.
create or replace function public.goals_member(p_household_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member_id uuid;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  select m.id into v_member_id
  from public.members m
  where m.user_id = v_uid and m.household_id = p_household_id;
  if v_member_id is null then
    raise exception 'not_found';
  end if;
  return v_member_id;
end;
$$;

-- The household of a goal the caller may edit (the caller's own household's): not_signed_in
-- without a user, not_found for a goal that is gone or elsewhere.
create or replace function public.goals_household_of(p_goal_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_household_id uuid;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  select g.household_id into v_household_id
  from public.goals g
  join public.members m on m.household_id = g.household_id and m.user_id = v_uid
  where g.id = p_goal_id;
  if v_household_id is null then
    raise exception 'not_found';
  end if;
  return v_household_id;
end;
$$;

-- Someone in the household to put on a goal (joined or not): not_found otherwise. Null is no one.
create or replace function public.goals_check_person(p_household_id uuid, p_member_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_member_id is not null and not exists (
    select 1 from public.members m where m.id = p_member_id and m.household_id = p_household_id
  ) then
    raise exception 'not_found';
  end if;
end;
$$;

-- A week's places run 0…n-1 again, in their order.
create or replace function public.goals_settle(p_household_id uuid, p_week date)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  with laid as (
    select g.id, (row_number() over (order by g.position, g.created_at, g.id) - 1)::integer as position
    from public.goals g
    where g.household_id = p_household_id and g.week = p_week
  )
  update public.goals g
  set position = laid.position
  from laid
  where g.id = laid.id and g.position is distinct from laid.position
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: tidy the row. On insert: the title trimmed, the week a Monday (the check), at most
-- 50 a week (goals_week_limit), the goal last in its week, who is on it from the household.
-- On update: the household, week, author, origin and creation time stay as they were.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.goals_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.title := public.js_trim(new.title);
  if tg_op = 'INSERT' then
    perform public.goals_lock(new.household_id);
    if (
      select count(*) from public.goals g where g.household_id = new.household_id and g.week = new.week
    ) >= 50 then
      raise exception using
        errcode = 'check_violation',
        constraint = 'goals_week_limit',
        message = 'new row for relation "goals" violates check constraint "goals_week_limit"';
    end if;
    select coalesce(max(g.position) + 1, 0) into new.position
    from public.goals g
    where g.household_id = new.household_id and g.week = new.week;
  else
    new.household_id := old.household_id;
    new.week := old.week;
    new.created_at := old.created_at;
    -- Only the foreign keys' on-delete-set-null may clear these.
    new.created_by := case when new.created_by is null then null else old.created_by end;
    new.carried_from := case when new.carried_from is null then null else old.carried_from end;
  end if;
  perform public.goals_check_person(new.household_id, new.member_id);
  return new;
end;
$$;

drop trigger if exists goals_before_write on public.goals;
create trigger goals_before_write
  before insert or update on public.goals
  for each row execute function public.goals_before_write();

-- ─────────────────────────────────────────────────────────────────────────────
-- RPCs (security definer, empty search_path; each checks the caller is in the household:
-- not_signed_in without a user, not_found otherwise)
-- ─────────────────────────────────────────────────────────────────────────────

-- add_goal: a goal at the end of the week starting p_week (a Monday, else invalid_input), not
-- done, with who is on it (p_member_id, someone in the household; null: no one). Too long or
-- blank: goals_title_length; a 51st: goals_week_limit. Returns the row.
create or replace function public.add_goal(p_household_id uuid, p_week date, p_title text, p_member_id uuid default null)
returns public.goals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid := public.goals_member(p_household_id);
  v_row public.goals;
begin
  if p_week is null or extract(isodow from p_week) <> 1 then
    raise exception 'invalid_input';
  end if;
  perform public.goals_check_person(p_household_id, p_member_id);
  perform public.goals_lock(p_household_id);
  insert into public.goals (household_id, week, title, member_id, created_by)
  values (p_household_id, p_week, coalesce(p_title, ''), p_member_id, v_member_id)
  returning * into v_row;
  return v_row;
end;
$$;

-- rename_goal: trimmed; the same title again changes nothing.
create or replace function public.rename_goal(p_goal_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.goals_household_of(p_goal_id);
  update public.goals g
  set title = coalesce(p_title, '')
  where g.id = p_goal_id and g.title is distinct from public.js_trim(coalesce(p_title, ''));
end;
$$;

-- set_goal_person: who is on it (someone in the household, else not_found), or null for no one.
create or replace function public.set_goal_person(p_goal_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid := public.goals_household_of(p_goal_id);
begin
  perform public.goals_check_person(v_household_id, p_member_id);
  update public.goals g
  set member_id = p_member_id
  where g.id = p_goal_id and g.member_id is distinct from p_member_id;
end;
$$;

-- set_goal_done: ticks (done_by the caller, done_at now) or unticks (both cleared). The state
-- it has already changes nothing (the stamp stays). Null: invalid_input.
create or replace function public.set_goal_done(p_goal_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid := public.goals_household_of(p_goal_id);
  v_member_id uuid := public.goals_member(v_household_id);
begin
  if p_done is null then
    raise exception 'invalid_input';
  end if;
  update public.goals g
  set done = p_done,
      done_by = case when p_done then v_member_id end,
      done_at = case when p_done then now() end
  where g.id = p_goal_id and g.done is distinct from p_done;
end;
$$;

-- move_goal: one goal moved within its week to p_index among the others (0 first; past the
-- end: last); the week's places run 0…n-1 again. Only this goal's place is decided, so two
-- people moving different goals at once both keep their moves. Gone or elsewhere: not_found;
-- a null or negative index: invalid_input.
create or replace function public.move_goal(p_goal_id uuid, p_index integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_week date;
begin
  if p_index is null or p_index < 0 then
    raise exception 'invalid_input';
  end if;
  v_household_id := public.goals_household_of(p_goal_id);
  perform public.goals_lock(v_household_id);
  -- As the week stands now: deleted by someone else while this one waited?
  select g.week into v_week from public.goals g where g.id = p_goal_id;
  if v_week is null then
    raise exception 'not_found';
  end if;
  with others as (
    select g.id, (row_number() over (order by g.position, g.created_at, g.id) - 1)::integer as ord
    from public.goals g
    where g.household_id = v_household_id and g.week = v_week and g.id <> p_goal_id
  ), k as (
    select least(p_index, (select count(*) from others))::integer as at
  ), laid as (
    select o.id, case when o.ord < k.at then o.ord else o.ord + 1 end as position from others o, k
    union all
    select p_goal_id, k.at from k
  )
  update public.goals g
  set position = laid.position
  from laid
  where g.id = laid.id and g.position is distinct from laid.position;
end;
$$;

-- delete_goal: gone for everyone; the rest of its week close up. A goal brought over from it
-- keeps going (carried_from null, the foreign key).
create or replace function public.delete_goal(p_goal_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid := public.goals_household_of(p_goal_id);
  v_week date;
begin
  perform public.goals_lock(v_household_id);
  delete from public.goals g where g.id = p_goal_id returning g.week into v_week;
  if v_week is null then
    raise exception 'not_found';
  end if;
  perform public.goals_settle(v_household_id, v_week);
end;
$$;

-- bring_over_goals: the goals of the week before p_week that are not done, and not brought into
-- p_week already, copied to the end of p_week in their order (title and who is on it, not done,
-- carried_from the goal it came from), as many as fit under 50. Two people tapping at once
-- bring each goal once (the lock, and goals_carried_once). Returns the new rows.
create or replace function public.bring_over_goals(p_household_id uuid, p_week date)
returns setof public.goals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid := public.goals_member(p_household_id);
  v_room integer;
  v_from record;
  v_row public.goals;
begin
  if p_week is null or extract(isodow from p_week) <> 1 then
    raise exception 'invalid_input';
  end if;
  perform public.goals_lock(p_household_id);
  select 50 - count(*) into v_room from public.goals g where g.household_id = p_household_id and g.week = p_week;
  for v_from in
    select g.id, g.title, g.member_id
    from public.goals g
    where g.household_id = p_household_id
      and g.week = p_week - 7
      and not g.done
      and not exists (select 1 from public.goals c where c.week = p_week and c.carried_from = g.id)
    order by g.position, g.created_at, g.id
    limit greatest(v_room, 0)
  loop
    insert into public.goals (household_id, week, title, member_id, carried_from, created_by)
    values (p_household_id, p_week, v_from.title, v_from.member_id, v_from.id, v_member_id)
    returning * into v_row;
    return next v_row;
  end loop;
end;
$$;

-- goals_link: the household's public link, or a new one with a fresh token if there is none.
create or replace function public.goals_link(p_household_id uuid)
returns public.goal_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid := public.goals_member(p_household_id);
  v_row public.goal_links;
begin
  insert into public.goal_links (household_id, token, created_by)
  values (p_household_id, public.goals_new_token(), v_member_id)
  on conflict (household_id) do nothing;
  select * into v_row from public.goal_links l where l.household_id = p_household_id;
  return v_row;
end;
$$;

-- stop_goals_link: turns the public link off; its token stops working for good. No link:
-- nothing to do.
create or replace function public.stop_goals_link(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.goals_member(p_household_id);
  delete from public.goal_links l where l.household_id = p_household_id;
end;
$$;

-- public_goals: for anyone (anon too): the current week, in the household's time zone, of the
-- goals of the household whose link has p_token, as
--   { "week": "YYYY-MM-DD", "goals": [ { "title", "done", "person": { "name", "emoji" } | null } ] }
-- in their order, "name" being the first word of the person's name. Nothing else of the home:
-- no ids, no address, no emails, no other rows. Null for a token not shaped like one, unknown,
-- or turned off. (The lookup is by the unique index on a 128-bit random token.)
create or replace function public.public_goals(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_week date;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    return null;
  end if;
  select l.household_id into v_household_id from public.goal_links l where l.token = p_token;
  if v_household_id is null then
    return null;
  end if;
  v_week := public.goals_week_of(public.household_today(v_household_id));
  return pg_catalog.json_build_object(
    'week', v_week,
    'goals', coalesce((
      select pg_catalog.json_agg(
        pg_catalog.json_build_object(
          'title', g.title,
          'done', g.done,
          'person', case
            when m.id is null then null
            else pg_catalog.json_build_object('name', coalesce(pg_catalog.split_part(pg_catalog.btrim(pg_catalog.regexp_replace(m.name, '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g')), ' ', 1), ''), 'emoji', m.emoji)
          end
        )
        order by g.position, g.created_at, g.id
      )
      from public.goals g
      left join public.members m on m.id = g.member_id
      where g.household_id = v_household_id and g.week = v_week
    ), '[]'::json)
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security and grants
--   goals       read by members; written by the RPCs
--   goal_links  read by members (anyone at home can share it again); written by the RPCs
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.goals enable row level security;
alter table public.goal_links enable row level security;

revoke all on table public.goals, public.goal_links from public, anon, authenticated;
grant all on table public.goals, public.goal_links to service_role;
grant select on public.goals to authenticated;
grant select on public.goal_links to authenticated;

drop policy if exists goals_select on public.goals;
create policy goals_select on public.goals
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists goal_links_select on public.goal_links;
create policy goal_links_select on public.goal_links
  for select to authenticated
  using (public.is_household_member(household_id));

-- Functions: the RPCs for signed-in users, public_goals for anyone; the helpers and the
-- trigger for nobody but the owner.
revoke all on function public.add_goal(uuid, date, text, uuid) from public, anon;
revoke all on function public.rename_goal(uuid, text) from public, anon;
revoke all on function public.set_goal_person(uuid, uuid) from public, anon;
revoke all on function public.set_goal_done(uuid, boolean) from public, anon;
revoke all on function public.move_goal(uuid, integer) from public, anon;
revoke all on function public.delete_goal(uuid) from public, anon;
revoke all on function public.bring_over_goals(uuid, date) from public, anon;
revoke all on function public.goals_link(uuid) from public, anon;
revoke all on function public.stop_goals_link(uuid) from public, anon;
grant execute on function public.add_goal(uuid, date, text, uuid) to authenticated, service_role;
grant execute on function public.rename_goal(uuid, text) to authenticated, service_role;
grant execute on function public.set_goal_person(uuid, uuid) to authenticated, service_role;
grant execute on function public.set_goal_done(uuid, boolean) to authenticated, service_role;
grant execute on function public.move_goal(uuid, integer) to authenticated, service_role;
grant execute on function public.delete_goal(uuid) to authenticated, service_role;
grant execute on function public.bring_over_goals(uuid, date) to authenticated, service_role;
grant execute on function public.goals_link(uuid) to authenticated, service_role;
grant execute on function public.stop_goals_link(uuid) to authenticated, service_role;

revoke all on function public.public_goals(text) from public;
grant execute on function public.public_goals(text) to anon, authenticated, service_role;

revoke all on function public.goals_lock(uuid) from public, anon, authenticated;
revoke all on function public.goals_week_of(date) from public, anon, authenticated;
revoke all on function public.goals_new_token() from public, anon, authenticated;
revoke all on function public.goals_member(uuid) from public, anon, authenticated;
revoke all on function public.goals_household_of(uuid) from public, anon, authenticated;
revoke all on function public.goals_check_person(uuid, uuid) from public, anon, authenticated;
revoke all on function public.goals_settle(uuid, date) from public, anon, authenticated;
revoke all on function public.goals_before_write() from public, anon, authenticated;
grant execute on function public.goals_week_of(date) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime
--
-- Both tables join the supabase_realtime publication only when it exists, so this file also
-- runs on plain Postgres (the database tests). Each carries household_id, and logging the
-- whole old row lets realtime filter deletes by it too, like the other published tables. A
-- delete's notice carries only the primary key (a goal's or a link's own id), never a token or
-- a household id. Clients reload on any event (Backend.subscribe).
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach v_table in array array['goals', 'goal_links']
  loop
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;

alter table public.goals replica identity full;
alter table public.goal_links replica identity full;
