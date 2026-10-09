-- home.os schema: tables, indexes, helper functions and triggers.
--
-- The contract lives in docs/ARCHITECTURE.md ("Database"). Row level security, grants,
-- RPCs and realtime come in the later migrations. Everything here is written so that the
-- file can be applied again without errors (if not exists, create or replace, drop/create
-- for triggers).
--
-- Permissions model: every member of a household may edit everything in it. Outsiders see
-- and change nothing. One household per user (members.user_id is unique).

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  -- IANA zone. "Today", "missed" and "this month" are computed in it.
  timezone text not null default 'Europe/London',
  -- 0 = Sunday ... 6 = Saturday.
  weekly_email_day smallint not null default 1 check (weekly_email_day between 0 and 6),
  weekly_email_time time not null default '08:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Member who made the last change (set by trigger). No foreign key on purpose: it is
  -- informational and must not block deleting a member.
  updated_by uuid null
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- One household per user.
  user_id uuid not null unique references auth.users (id) on delete cascade,
  name text not null,
  email text not null default '',
  emoji text not null default '🦔',
  -- Hex colour, assigned in join order (see join_household).
  color text not null,
  -- 'owner' only decides who receives the "missed" push alert. It grants nothing extra.
  role text not null default 'member' check (role in ('owner', 'member')),
  weekly_email boolean not null default true,
  push_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  -- Always copied from the area by items_before_write(), whatever the client sends.
  household_id uuid not null references public.households (id) on delete cascade,
  area_id uuid not null references public.areas (id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  note text not null default '',
  rag text not null default 'amber' check (rag in ('red', 'amber', 'green')),
  due_date date null,
  assignee_id uuid null references public.members (id) on delete set null,
  repeat text not null default 'none'
    check (repeat in ('none', 'weekly', 'monthly', 'quarterly', 'biannual', 'yearly')),
  notify text not null default 'day_before'
    check (notify in ('none', 'same_day', 'day_before', 'week_before')),
  status text not null default 'open' check (status in ('open', 'done')),
  created_by uuid null references public.members (id) on delete set null,
  updated_by uuid null references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);

-- A completion log row. It outlives its item (item_id is set to null when the item is
-- deleted) so Stats keep counting it.
create table if not exists public.completions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  item_id uuid null references public.items (id) on delete set null,
  item_title text not null,
  -- The assignee at completion time, or the completer when the item was unassigned.
  credited_to uuid null references public.members (id) on delete set null,
  completed_by uuid null references public.members (id) on delete set null,
  completed_at timestamptz not null default now(),
  -- What undo_completion() restores.
  prev_due_date date null,
  prev_status text not null check (prev_status in ('open', 'done'))
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  token text not null unique,
  created_by uuid null references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days'
);

-- Web Push subscriptions, private to the user who created them.
create table if not exists public.push_subs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- What the scheduler Edge Function has sent (service role only). The unique key makes each
-- reminder, missed alert and weekly email go out at most once.
create table if not exists public.notifications_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  item_id uuid null references public.items (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  kind text not null check (kind in ('reminder', 'missed', 'weekly')),
  ref_date date not null,
  sent_at timestamptz not null default now(),
  constraint notifications_log_once unique nulls not distinct (kind, member_id, item_id, ref_date)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes (household lookups for RLS and loading, plus foreign keys used by cascades)
-- ─────────────────────────────────────────────────────────────────────────────

create index if not exists members_household_id_idx on public.members (household_id);
create index if not exists areas_household_id_idx on public.areas (household_id, position);
create index if not exists items_household_id_idx on public.items (household_id, status);
create index if not exists items_area_id_idx on public.items (area_id);
create index if not exists items_assignee_id_idx on public.items (assignee_id);
create index if not exists items_created_by_idx on public.items (created_by);
create index if not exists items_updated_by_idx on public.items (updated_by);
create index if not exists completions_household_id_idx on public.completions (household_id, completed_at);
create index if not exists completions_item_id_idx on public.completions (item_id);
create index if not exists completions_credited_to_idx on public.completions (credited_to);
create index if not exists completions_completed_by_idx on public.completions (completed_by);
create index if not exists invites_household_id_idx on public.invites (household_id);
create index if not exists invites_created_by_idx on public.invites (created_by);
create index if not exists push_subs_member_id_idx on public.push_subs (member_id);
create index if not exists push_subs_user_id_idx on public.push_subs (user_id);
create index if not exists notifications_log_household_id_idx on public.notifications_log (household_id);
create index if not exists notifications_log_item_id_idx on public.notifications_log (item_id);
create index if not exists notifications_log_member_id_idx on public.notifications_log (member_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper functions (used by RLS policies, triggers and RPCs)
--
-- The member lookups are security definer so they can read members regardless of the
-- caller's RLS. Every function pins an empty search_path so nothing can be shadowed.
-- Grants are in the RLS migration.
-- ─────────────────────────────────────────────────────────────────────────────

-- The caller's member id, or null when signed out or not in a household yet.
create or replace function public.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from public.members m where m.user_id = auth.uid()
$$;

-- True when the caller belongs to household `hid`.
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m where m.household_id = hid and m.user_id = auth.uid()
  )
$$;

-- True for a time zone name Postgres knows (e.g. 'Europe/London').
create or replace function public.is_valid_timezone(tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select tz is not null and exists (select 1 from pg_catalog.pg_timezone_names n where n.name = tz)
$$;

-- Next due date after completing a repeating item. Mirrors nextDueDate() in
-- src/lib/logic/items.ts: one interval after the old due date (or after today when there is
-- none); if that is still before today, one interval after today instead. Monthly intervals
-- are calendar months clamped to the month end (31 Jan + 1 month = 28/29 Feb), which is
-- what date + interval does. Returns null for 'none'.
create or replace function public.next_due_date(p_repeat text, p_due date, p_today date)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_step interval;
  v_next date;
begin
  v_step := case p_repeat
    when 'weekly' then interval '7 days'
    when 'monthly' then interval '1 month'
    when 'quarterly' then interval '3 months'
    when 'biannual' then interval '6 months'
    when 'yearly' then interval '12 months'
  end;
  if v_step is null then
    return null;
  end if;
  v_next := (coalesce(p_due, p_today) + v_step)::date;
  if v_next < p_today then
    v_next := (p_today + v_step)::date;
  end if;
  return v_next;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Triggers
-- ─────────────────────────────────────────────────────────────────────────────

-- households: validate the time zone; stamp updated_at / updated_by on every update.
create or replace function public.households_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.timezone is distinct from old.timezone then
    if not public.is_valid_timezone(new.timezone) then
      raise exception 'invalid_input';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := public.current_member_id();
  end if;
  return new;
end;
$$;

drop trigger if exists households_before_write on public.households;
create trigger households_before_write
  before insert or update on public.households
  for each row execute function public.households_before_write();

-- items: household_id always comes from the area (so RLS checks the real household), the
-- assignee must belong to that household, and updated_at / updated_by / created_by are
-- stamped. The lookups only run when the relevant columns change, so the "on delete set
-- null" cascades from members (assignee_id, created_by, updated_by) never trip over rows
-- that are being deleted in the same statement.
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
  end if;
  return new;
end;
$$;

drop trigger if exists items_before_write on public.items;
create trigger items_before_write
  before insert or update on public.items
  for each row execute function public.items_before_write();

-- push_subs: a push endpoint belongs to one browser. When someone subscribes with an
-- endpoint that is already stored (the same browser, perhaps after another account signed
-- out without unsubscribing), the old row is replaced instead of failing on the unique
-- constraint or on another user's RLS policy. The new row still has to pass RLS (own user,
-- own member), otherwise the whole insert, including this delete, is rolled back.
create or replace function public.push_subs_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.push_subs s where s.endpoint = new.endpoint;
  return new;
end;
$$;

drop trigger if exists push_subs_before_insert on public.push_subs;
create trigger push_subs_before_insert
  before insert on public.push_subs
  for each row execute function public.push_subs_before_insert();
