-- home.os housekeeping: the weekly visit by the housekeeper (the Housekeeping tab).
--
-- The contract lives in docs/ARCHITECTURE.md ("Housekeeping"). In short:
--   - housekeeping_notes: the household's "Message for the housekeeper", one row per
--     household, with who changed it last and when. It stays until changed or cleared.
--   - housekeeping_tasks: the household's task list (the template every visit copies).
--     Anyone in the household adds, renames, deletes and reorders tasks.
--   - housekeeping_visits: at most one visit per household and day (the household's time
--     zone), never in the future, with its own copy of the message, comments and the price
--     for the day in whole pence.
--   - housekeeping_visit_tasks: each visit's own copy of the task list (title, position)
--     with done, who ticked it and when. One row per visit and task, so two people ticking
--     different tasks at once never undo each other, and renaming or deleting a task never
--     rewrites an earlier visit.
--
-- The housekeeper is a household member like everyone else, and every member reads and
-- edits all of it; outsiders and anon see and change nothing. Visits and their tasks are
-- written only through the RPCs below (which create a day's visit on its first write);
-- the task list is written directly (RLS) and through reorder_housekeeping_tasks, and
-- triggers keep today's visit in step with it.
--
-- Errors, as in the earlier migrations: not_signed_in, not_found (also for anything in
-- another household), invalid_input (malformed arguments, a future day); a size or range
-- limit raises check_violation (SQLSTATE 23514) naming the constraint.
--
-- Like the earlier migrations, everything here can be applied again without errors
-- (if not exists, create or replace, drop/create for triggers and policies).

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

-- The "Message for the housekeeper". No row = never written (the app reads body '').
create table if not exists public.housekeeping_notes (
  household_id uuid primary key references public.households (id) on delete cascade,
  -- Trimmed by set_housekeeping_note(). '' = no message (cleared).
  body text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.members (id) on delete set null,
  constraint housekeeping_notes_body_length check (length(body) <= 4000)
);

-- The task list. position orders it (0 first); a new task always goes last (trigger).
create table if not exists public.housekeeping_tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- Trimmed by the trigger, so a blank title fails the length check.
  title text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint housekeeping_tasks_title_length check (length(title) between 1 and 200)
);

-- One visit per household and day.
create table if not exists public.housekeeping_visits (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- The day in the household's time zone; never after today (checked by the RPCs, as
  -- "today" moves).
  visit_date date not null,
  -- The message as it stood that day, copied once when the visit is created (see
  -- housekeeping_visit_for()). Never changed afterwards.
  note text not null default '',
  comments text not null default '',
  -- Whole pence; null = not entered.
  price_pence integer null,
  -- Who recorded it (the first write) and who changed it last.
  created_by uuid null references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid null references public.members (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint housekeeping_visits_one_per_day unique (household_id, visit_date),
  constraint housekeeping_visits_note_length check (length(note) <= 4000),
  constraint housekeeping_visits_comments_length check (length(comments) <= 4000),
  constraint housekeeping_visits_price_range check (price_pence is null or price_pence between 0 and 1000000)
);

-- Each visit's copy of the task list.
create table if not exists public.housekeeping_visit_tasks (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.housekeeping_visits (id) on delete cascade,
  -- Copied from the visit, so RLS and realtime filter by household.
  household_id uuid not null references public.households (id) on delete cascade,
  -- The task it was copied from; null once that task is deleted (the row stays).
  task_id uuid null references public.housekeeping_tasks (id) on delete set null,
  title text not null,
  position integer not null default 0,
  done boolean not null default false,
  -- Who ticked it and when; both null while not done.
  done_by uuid null references public.members (id) on delete set null,
  done_at timestamptz null,
  -- A task appears at most once per visit (rows whose task is gone, task_id null, may be many).
  constraint housekeeping_visit_tasks_task_once unique (visit_id, task_id),
  constraint housekeeping_visit_tasks_title_length check (length(title) between 1 and 200)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes (loading a household, RLS, realtime filters and foreign key cascades; the
-- unique constraints cover visits by (household_id, visit_date) and rows by visit)
-- ─────────────────────────────────────────────────────────────────────────────

create index if not exists housekeeping_notes_updated_by_idx on public.housekeeping_notes (updated_by);
create index if not exists housekeeping_tasks_household_idx on public.housekeeping_tasks (household_id, position);
create index if not exists housekeeping_visits_created_by_idx on public.housekeeping_visits (created_by);
create index if not exists housekeeping_visits_updated_by_idx on public.housekeeping_visits (updated_by);
create index if not exists housekeeping_visit_tasks_household_idx on public.housekeeping_visit_tasks (household_id);
create index if not exists housekeeping_visit_tasks_task_id_idx on public.housekeeping_visit_tasks (task_id);
create index if not exists housekeeping_visit_tasks_done_by_idx on public.housekeeping_visit_tasks (done_by);

-- ─────────────────────────────────────────────────────────────────────────────
-- Internal helpers (not callable by clients; grants at the end)
-- ─────────────────────────────────────────────────────────────────────────────

-- The same whitespace as JavaScript's String.prototype.trim(), as in messages_before_insert:
-- tab, line feed, vertical tab, form feed, carriage return, space, no-break space, the other
-- Unicode space separators, the line and paragraph separators and the byte order mark.
create or replace function public.js_trim(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(
    p_text,
    U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
  )
$$;

-- The task list every new household starts with (and existing households without one get
-- once, below). HOUSEKEEPING_STARTER_TASKS in src/lib/constants.ts is the same list in the
-- same order; a unit test compares them.
create or replace function public.housekeeping_starter_tasks()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'Change the bed sheets',
    'Hoover and mop the floors',
    'Clean the bathrooms',
    'Clean the kitchen',
    'Dust the surfaces',
    'Empty the bins',
    'Ironing'
  ]::text[]
$$;

-- Today in the household's time zone (null for a household that does not exist).
create or replace function public.household_today(p_household_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone h.timezone)::date from public.households h where h.id = p_household_id
$$;

-- Serialises, per household and until the end of the transaction, creating a visit (which
-- copies the task list) with adding, renaming and reordering tasks (which update today's
-- visit), so a task changed at the very moment today's visit is created is never missed.
create or replace function public.housekeeping_lock(p_household_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(4711, pg_catalog.hashtext(p_household_id::text))
$$;

-- The household's visit on p_visit_date, created if there is none yet. Membership must be
-- checked by the caller (an RPC); p_member_id is who records it. Raises not_found for an
-- unknown household and invalid_input for a missing or future day (household time zone).
--
-- A new visit copies:
--   - the task list: every task's id, title and position, none done;
--   - the message: its body if it was last changed on or before p_visit_date in the
--     household's time zone (so today always gets the current one), else '' (it was
--     changed since, so what it said that day is not known). Never written: ''.
create or replace function public.housekeeping_visit_for(
  p_household_id uuid,
  p_visit_date date,
  p_member_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_visit_id uuid;
  v_note text;
begin
  select h.timezone into v_timezone from public.households h where h.id = p_household_id;
  if v_timezone is null then
    raise exception 'not_found';
  end if;
  if p_visit_date is null or p_visit_date > (now() at time zone v_timezone)::date then
    raise exception 'invalid_input';
  end if;

  select v.id into v_visit_id
  from public.housekeeping_visits v
  where v.household_id = p_household_id and v.visit_date = p_visit_date;
  if v_visit_id is not null then
    return v_visit_id;
  end if;

  -- Another caller may be creating it right now: wait for them, then look again.
  perform public.housekeeping_lock(p_household_id);
  select v.id into v_visit_id
  from public.housekeeping_visits v
  where v.household_id = p_household_id and v.visit_date = p_visit_date;
  if v_visit_id is not null then
    return v_visit_id;
  end if;

  select case
           when (n.updated_at at time zone v_timezone)::date <= p_visit_date then n.body
           else ''
         end
  into v_note
  from public.housekeeping_notes n
  where n.household_id = p_household_id;

  insert into public.housekeeping_visits (household_id, visit_date, note, created_by, updated_by)
  values (p_household_id, p_visit_date, coalesce(v_note, ''), p_member_id, p_member_id)
  returning id into v_visit_id;

  insert into public.housekeeping_visit_tasks (visit_id, household_id, task_id, title, position)
  select v_visit_id, p_household_id, t.id, t.title, t.position
  from public.housekeeping_tasks t
  where t.household_id = p_household_id
  order by t.position, t.created_at, t.id;

  return v_visit_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Triggers on the task list: tidy the row, and keep today's visit in step. Visits on
-- earlier days are never touched (their rows keep their title; a deleted task's rows keep
-- going with task_id null through the foreign key).
-- ─────────────────────────────────────────────────────────────────────────────

-- BEFORE INSERT OR UPDATE: trim the title; a new task goes last (whatever position the
-- client sends); an update keeps household_id and created_at.
create or replace function public.housekeeping_tasks_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.title := public.js_trim(new.title);
  if tg_op = 'INSERT' then
    perform public.housekeeping_lock(new.household_id);
    select coalesce(max(t.position) + 1, 0) into new.position
    from public.housekeeping_tasks t
    where t.household_id = new.household_id;
  else
    new.household_id := old.household_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists housekeeping_tasks_before_write on public.housekeeping_tasks;
create trigger housekeeping_tasks_before_write
  before insert or update on public.housekeeping_tasks
  for each row execute function public.housekeeping_tasks_before_write();

-- AFTER INSERT: a new task joins today's visit, if there is one, not done.
create or replace function public.housekeeping_tasks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.housekeeping_visit_tasks (visit_id, household_id, task_id, title, position)
  select v.id, v.household_id, new.id, new.title, new.position
  from public.housekeeping_visits v
  where v.household_id = new.household_id
    and v.visit_date = public.household_today(new.household_id)
  on conflict (visit_id, task_id) do nothing;
  return null;
end;
$$;

drop trigger if exists housekeeping_tasks_after_insert on public.housekeeping_tasks;
create trigger housekeeping_tasks_after_insert
  after insert on public.housekeeping_tasks
  for each row execute function public.housekeeping_tasks_after_insert();

-- AFTER UPDATE: a renamed or moved task is renamed or moved on today's visit too (ticked
-- or not: it is the same task on the same day).
create or replace function public.housekeeping_tasks_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.title is distinct from old.title or new.position is distinct from old.position then
    perform public.housekeeping_lock(new.household_id);
    update public.housekeeping_visit_tasks vt
    set title = new.title, position = new.position
    from public.housekeeping_visits v
    where vt.visit_id = v.id
      and vt.task_id = new.id
      and v.household_id = new.household_id
      and v.visit_date = public.household_today(new.household_id);
  end if;
  return null;
end;
$$;

drop trigger if exists housekeeping_tasks_after_update on public.housekeeping_tasks;
create trigger housekeeping_tasks_after_update
  after update on public.housekeeping_tasks
  for each row execute function public.housekeeping_tasks_after_update();

-- BEFORE DELETE: today's visit drops the task unless it is already ticked there (a done
-- row stays, as history, with task_id null from the foreign key). It runs before the row
-- goes because the foreign key clears task_id first otherwise. No housekeeping_lock here:
-- the row being deleted is already locked, and a visit being created at the same moment
-- waits on that row lock instead (it then fails cleanly if the task is gone).
create or replace function public.housekeeping_tasks_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.housekeeping_visit_tasks vt
  using public.housekeeping_visits v
  where vt.visit_id = v.id
    and vt.task_id = old.id
    and not vt.done
    and v.household_id = old.household_id
    and v.visit_date = public.household_today(old.household_id);
  return old;
end;
$$;

drop trigger if exists housekeeping_tasks_before_delete on public.housekeeping_tasks;
create trigger housekeeping_tasks_before_delete
  before delete on public.housekeeping_tasks
  for each row execute function public.housekeeping_tasks_before_delete();

-- ─────────────────────────────────────────────────────────────────────────────
-- RPCs (security definer, empty search_path; each checks the caller is a member of
-- p_household_id: not_signed_in without a user, not_found otherwise)
-- ─────────────────────────────────────────────────────────────────────────────

-- set_housekeeping_note: replace the message with p_body, trimmed ('' clears it), stamping
-- who and when. The same text again changes nothing (the stamp stays), and clearing a
-- message that was never written stores nothing. Too long: housekeeping_notes_body_length.
create or replace function public.set_housekeeping_note(p_household_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member_id uuid;
  v_body text := public.js_trim(coalesce(p_body, ''));
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

  if v_body = '' and not exists (
    select 1 from public.housekeeping_notes n where n.household_id = p_household_id
  ) then
    return;
  end if;

  insert into public.housekeeping_notes as n (household_id, body, updated_at, updated_by)
  values (p_household_id, v_body, now(), v_member_id)
  on conflict (household_id) do update
    set body = excluded.body, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    where n.body is distinct from excluded.body;
end;
$$;

-- reorder_housekeeping_tasks: position = index in p_task_ids. Ids from other households
-- are ignored. Today's visit follows (trigger).
create or replace function public.reorder_housekeeping_tasks(p_household_id uuid, p_task_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  if not exists (
    select 1 from public.members m
    where m.user_id = v_uid and m.household_id = p_household_id
  ) then
    raise exception 'not_found';
  end if;

  update public.housekeeping_tasks t
  set position = o.ord - 1
  from unnest(coalesce(p_task_ids, '{}'::uuid[])) with ordinality as o(id, ord)
  where t.id = o.id
    and t.household_id = p_household_id
    and t.position is distinct from o.ord - 1;
end;
$$;

-- add_housekeeping_visit: "Add a visit" on p_visit_date (today or earlier): creates it
-- (nothing ticked) or returns the one already there. Returns the visit id.
create or replace function public.add_housekeeping_visit(p_household_id uuid, p_visit_date date)
returns uuid
language plpgsql
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
  return public.housekeeping_visit_for(p_household_id, p_visit_date, v_member_id);
end;
$$;

-- tick_housekeeping_task: tick (p_done true) or untick one row. Exactly one of:
--   p_task_id        the row copied from that task on the visit on p_visit_date, creating
--                    the visit first if there is none (today or earlier only);
--   p_visit_task_id  that row, on any visit of the household (p_visit_date is not used).
-- Ticking stamps done_by (the caller) and done_at; unticking clears both; the visit's
-- updated_at/updated_by are stamped. A row already in that state is left as it is. No such
-- row: not_found (and a visit created by this call is rolled back with it). Only that one
-- row is written, under its row lock: concurrent ticks of different rows never clobber each
-- other. Returns the visit id.
create or replace function public.tick_housekeeping_task(
  p_household_id uuid,
  p_visit_date date,
  p_task_id uuid,
  p_visit_task_id uuid,
  p_done boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member_id uuid;
  v_visit_id uuid;
  v_row public.housekeeping_visit_tasks%rowtype;
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
  if p_done is null or (p_task_id is null) = (p_visit_task_id is null) then
    raise exception 'invalid_input';
  end if;

  if p_visit_task_id is not null then
    select * into v_row
    from public.housekeeping_visit_tasks vt
    where vt.id = p_visit_task_id and vt.household_id = p_household_id
    for update;
  else
    v_visit_id := public.housekeeping_visit_for(p_household_id, p_visit_date, v_member_id);
    select * into v_row
    from public.housekeeping_visit_tasks vt
    where vt.visit_id = v_visit_id and vt.task_id = p_task_id
    for update;
  end if;
  if v_row.id is null then
    raise exception 'not_found';
  end if;

  if v_row.done is distinct from p_done then
    update public.housekeeping_visit_tasks
    set done = p_done,
        done_by = case when p_done then v_member_id end,
        done_at = case when p_done then now() end
    where id = v_row.id;
    update public.housekeeping_visits
    set updated_at = now(), updated_by = v_member_id
    where id = v_row.visit_id;
  end if;
  return v_row.visit_id;
end;
$$;

-- save_housekeeping_visit: write the keys present in p_patch to the visit on p_visit_date,
-- creating it first if there is none (today or earlier only):
--   "comments"     a string, trimmed (too long: housekeeping_visits_comments_length);
--   "price_pence"  a whole number (out of range: housekeeping_visits_price_range) or null.
-- Other keys are ignored. A wrong type is invalid_input. Stamps updated_at/updated_by when
-- something changed. Returns the visit id.
create or replace function public.save_housekeeping_visit(
  p_household_id uuid,
  p_visit_date date,
  p_patch jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member_id uuid;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_has_comments boolean;
  v_has_price boolean;
  v_comments text;
  v_price jsonb;
  v_price_pence integer;
  v_visit_id uuid;
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

  if jsonb_typeof(v_patch) <> 'object' then
    raise exception 'invalid_input';
  end if;
  v_has_comments := v_patch ? 'comments';
  v_has_price := v_patch ? 'price_pence';
  if v_has_comments then
    if jsonb_typeof(v_patch -> 'comments') <> 'string' then
      raise exception 'invalid_input';
    end if;
    v_comments := public.js_trim(v_patch ->> 'comments');
  end if;
  if v_has_price then
    v_price := v_patch -> 'price_pence';
    if jsonb_typeof(v_price) = 'null' then
      v_price_pence := null;
    elsif jsonb_typeof(v_price) = 'number'
      and v_price::numeric = trunc(v_price::numeric)
      and abs(v_price::numeric) <= 2147483647
    then
      -- The range itself is housekeeping_visits_price_range's to report.
      v_price_pence := v_price::numeric::integer;
    else
      raise exception 'invalid_input';
    end if;
  end if;

  v_visit_id := public.housekeeping_visit_for(p_household_id, p_visit_date, v_member_id);

  update public.housekeeping_visits v
  set comments = case when v_has_comments then v_comments else v.comments end,
      price_pence = case when v_has_price then v_price_pence else v.price_pence end,
      updated_at = now(),
      updated_by = v_member_id
  where v.id = v_visit_id
    and (
      (v_has_comments and v.comments is distinct from v_comments)
      or (v_has_price and v.price_pence is distinct from v_price_pence)
    );
  return v_visit_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- create_household: as in 20261010000300_item_good.sql, plus the starter task list
-- (housekeeping_starter_tasks(), in order). Same signature and behaviour otherwise.
-- p_items: [{area, kind ('task' | 'state', default 'task'), title, note, good (default ''),
--            rag, due_in_days (int|null), repeat, notify}]
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_household(
  p_name text,
  p_address text,
  p_timezone text,
  p_member_name text,
  p_member_emoji text,
  p_areas text[],
  p_items jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_member_name text := btrim(coalesce(p_member_name, ''));
  v_timezone text := btrim(coalesce(p_timezone, ''));
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_household_id uuid;
  v_member_id uuid;
  v_today date;
  v_area_name text;
  v_position integer := 0;
  v_item jsonb;
  v_area_id uuid;
  v_title text;
  v_kind text;
  v_rag text;
  v_repeat text;
  v_notify text;
  v_due jsonb;
  v_due_date date;
  v_task_title text;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  if exists (select 1 from public.members m where m.user_id = v_uid) then
    raise exception 'already_member';
  end if;
  if v_name = '' or v_member_name = '' or jsonb_typeof(v_items) <> 'array' then
    raise exception 'invalid_input';
  end if;
  if not public.is_valid_timezone(v_timezone) then
    v_timezone := 'Europe/London';
  end if;

  insert into public.households (name, address, timezone)
  values (v_name, btrim(coalesce(p_address, '')), v_timezone)
  returning id into v_household_id;

  begin
    insert into public.members (household_id, user_id, name, email, emoji, color, role)
    values (
      v_household_id,
      v_uid,
      v_member_name,
      coalesce(
        nullif(auth.jwt() ->> 'email', ''),
        (select u.email from auth.users u where u.id = v_uid),
        ''
      ),
      coalesce(nullif(btrim(p_member_emoji), ''), '🦔'),
      '#007AFF',
      'owner'
    )
    returning id into v_member_id;
  exception when unique_violation then
    -- A concurrent call won the race for this user.
    raise exception 'already_member';
  end;

  -- Areas in the given order; blank names are skipped and positions stay contiguous.
  for v_area_name in
    select btrim(a.name)
    from unnest(coalesce(p_areas, '{}'::text[])) with ordinality as a(name, ord)
    where btrim(coalesce(a.name, '')) <> ''
    order by a.ord
  loop
    insert into public.areas (household_id, name, position)
    values (v_household_id, v_area_name, v_position);
    v_position := v_position + 1;
  end loop;

  -- Seed items, due relative to today in the household's zone, unassigned.
  v_today := (now() at time zone v_timezone)::date;
  for v_item in select e.value from jsonb_array_elements(v_items) as e(value)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid_input';
    end if;

    v_title := btrim(coalesce(v_item ->> 'title', ''));
    v_kind := coalesce(v_item ->> 'kind', 'task');
    v_rag := coalesce(v_item ->> 'rag', 'amber');
    v_repeat := coalesce(v_item ->> 'repeat', 'none');
    v_notify := coalesce(v_item ->> 'notify', 'day_before');
    if v_title = ''
      or v_kind not in ('task', 'state')
      or v_rag not in ('red', 'amber', 'green')
      or v_repeat not in ('none', 'weekly', 'monthly', 'quarterly', 'biannual', 'yearly')
      or v_notify not in ('none', 'same_day', 'day_before', 'week_before')
    then
      raise exception 'invalid_input';
    end if;

    v_due := v_item -> 'due_in_days';
    if v_due is null or jsonb_typeof(v_due) = 'null' then
      v_due_date := null;
    elsif jsonb_typeof(v_due) = 'number'
      and v_due::numeric = trunc(v_due::numeric)
      and abs(v_due::numeric) <= 36500
    then
      v_due_date := v_today + v_due::numeric::integer;
    else
      raise exception 'invalid_input';
    end if;

    -- Matched by name, case-insensitively; the first such area wins. Unknown areas skip.
    select a.id into v_area_id
    from public.areas a
    where a.household_id = v_household_id
      and lower(a.name) = lower(btrim(coalesce(v_item ->> 'area', '')))
    order by a.position
    limit 1;
    if v_area_id is null then
      continue;
    end if;

    -- Too long a note or "good" violates items_note_length / items_good_length (23514).
    insert into public.items (
      household_id, area_id, kind, title, note, good, rag, due_date, repeat, notify, created_by
    )
    values (
      v_household_id, v_area_id, v_kind, v_title, coalesce(v_item ->> 'note', ''),
      coalesce(v_item ->> 'good', ''), v_rag, v_due_date, v_repeat, v_notify, v_member_id
    );
  end loop;

  -- Housekeeping: the starter task list, in order (each new task goes last).
  foreach v_task_title in array public.housekeeping_starter_tasks()
  loop
    insert into public.housekeeping_tasks (household_id, title)
    values (v_household_id, v_task_title);
  end loop;

  return v_household_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Existing households: the starter task list, once. Only households with no task and no
-- visit get it, so applying this file again never refills a list that was emptied after
-- visits were recorded.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_household_id uuid;
  v_task_title text;
begin
  for v_household_id in
    select h.id
    from public.households h
    where not exists (select 1 from public.housekeeping_tasks t where t.household_id = h.id)
      and not exists (select 1 from public.housekeeping_visits v where v.household_id = h.id)
    order by h.created_at, h.id
  loop
    foreach v_task_title in array public.housekeeping_starter_tasks()
    loop
      insert into public.housekeeping_tasks (household_id, title)
      values (v_household_id, v_task_title);
    end loop;
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row level security and privileges
--
-- Table privileges decide WHAT a signed-in user may do, policies decide WHERE (only their
-- own household). Supabase grants anon and authenticated everything on new tables and
-- functions in public by default, so all of it is revoked first and granted back.
--   housekeeping_notes        read; written by set_housekeeping_note()
--   housekeeping_tasks        read, add (household_id, title), rename (title), delete;
--                             positions by reorder_housekeeping_tasks()
--   housekeeping_visits       read, delete; written by the RPCs
--   housekeeping_visit_tasks  read; written by the RPCs (deleted with their visit)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.housekeeping_notes enable row level security;
alter table public.housekeeping_tasks enable row level security;
alter table public.housekeeping_visits enable row level security;
alter table public.housekeeping_visit_tasks enable row level security;

revoke all on table
  public.housekeeping_notes, public.housekeeping_tasks, public.housekeeping_visits,
  public.housekeeping_visit_tasks
from public, anon, authenticated;
grant all on table
  public.housekeeping_notes, public.housekeeping_tasks, public.housekeeping_visits,
  public.housekeeping_visit_tasks
to service_role;

grant select on public.housekeeping_notes to authenticated;
grant select, delete on public.housekeeping_tasks to authenticated;
grant insert (household_id, title) on public.housekeeping_tasks to authenticated;
grant update (title) on public.housekeeping_tasks to authenticated;
grant select, delete on public.housekeeping_visits to authenticated;
grant select on public.housekeeping_visit_tasks to authenticated;

-- housekeeping_notes
drop policy if exists housekeeping_notes_select on public.housekeeping_notes;
create policy housekeeping_notes_select on public.housekeeping_notes
  for select to authenticated
  using (public.is_household_member(household_id));

-- housekeeping_tasks
drop policy if exists housekeeping_tasks_select on public.housekeeping_tasks;
create policy housekeeping_tasks_select on public.housekeeping_tasks
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists housekeeping_tasks_insert on public.housekeeping_tasks;
create policy housekeeping_tasks_insert on public.housekeeping_tasks
  for insert to authenticated
  with check (public.is_household_member(household_id));

drop policy if exists housekeeping_tasks_update on public.housekeeping_tasks;
create policy housekeeping_tasks_update on public.housekeeping_tasks
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists housekeeping_tasks_delete on public.housekeeping_tasks;
create policy housekeeping_tasks_delete on public.housekeeping_tasks
  for delete to authenticated
  using (public.is_household_member(household_id));

-- housekeeping_visits
drop policy if exists housekeeping_visits_select on public.housekeeping_visits;
create policy housekeeping_visits_select on public.housekeeping_visits
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists housekeeping_visits_delete on public.housekeeping_visits;
create policy housekeeping_visits_delete on public.housekeeping_visits
  for delete to authenticated
  using (public.is_household_member(household_id));

-- housekeeping_visit_tasks
drop policy if exists housekeeping_visit_tasks_select on public.housekeeping_visit_tasks;
create policy housekeeping_visit_tasks_select on public.housekeeping_visit_tasks
  for select to authenticated
  using (public.is_household_member(household_id));

-- Functions: the RPCs for signed-in users; the helpers and triggers for nobody but the
-- owner (and the service role, for the plain helpers).
revoke all on function public.set_housekeeping_note(uuid, text) from public, anon;
revoke all on function public.reorder_housekeeping_tasks(uuid, uuid[]) from public, anon;
revoke all on function public.add_housekeeping_visit(uuid, date) from public, anon;
revoke all on function public.tick_housekeeping_task(uuid, date, uuid, uuid, boolean) from public, anon;
revoke all on function public.save_housekeeping_visit(uuid, date, jsonb) from public, anon;
grant execute on function public.set_housekeeping_note(uuid, text) to authenticated, service_role;
grant execute on function public.reorder_housekeeping_tasks(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.add_housekeeping_visit(uuid, date) to authenticated, service_role;
grant execute on function public.tick_housekeeping_task(uuid, date, uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.save_housekeeping_visit(uuid, date, jsonb) to authenticated, service_role;

revoke all on function public.js_trim(text) from public, anon, authenticated;
revoke all on function public.housekeeping_starter_tasks() from public, anon, authenticated;
revoke all on function public.household_today(uuid) from public, anon, authenticated;
revoke all on function public.housekeeping_lock(uuid) from public, anon, authenticated;
revoke all on function public.housekeeping_visit_for(uuid, date, uuid) from public, anon, authenticated;
revoke all on function public.housekeeping_tasks_before_write() from public, anon, authenticated;
revoke all on function public.housekeeping_tasks_after_insert() from public, anon, authenticated;
revoke all on function public.housekeeping_tasks_after_update() from public, anon, authenticated;
revoke all on function public.housekeeping_tasks_before_delete() from public, anon, authenticated;
grant execute on function public.js_trim(text) to service_role;
grant execute on function public.housekeeping_starter_tasks() to service_role;
grant execute on function public.household_today(uuid) to service_role;

-- create_household: create or replace keeps the existing privileges; stated again so this
-- file reads whole.
revoke all on function public.create_household(text, text, text, text, text, text[], jsonb) from public, anon;
grant execute on function public.create_household(text, text, text, text, text, text[], jsonb) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime
--
-- All four tables join the supabase_realtime publication only when it exists, so this
-- file also runs on plain Postgres (the database tests). Each carries household_id, and
-- logging the whole old row lets realtime filter deletes by it too, like the other
-- published tables. Clients reload on any event (Backend.subscribe).
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach v_table in array array[
    'housekeeping_notes', 'housekeeping_tasks', 'housekeeping_visits', 'housekeeping_visit_tasks'
  ]
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

alter table public.housekeeping_notes replica identity full;
alter table public.housekeeping_tasks replica identity full;
alter table public.housekeeping_visits replica identity full;
alter table public.housekeeping_visit_tasks replica identity full;
