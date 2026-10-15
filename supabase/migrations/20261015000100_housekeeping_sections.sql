-- home.os housekeeping sections: the task list grouped into sections ("Kitchen", "Bathrooms").
--
-- The contract lives in docs/ARCHITECTURE.md ("Housekeeping", "Sections"). In short:
--   - housekeeping_sections: the household's sections, in order (position). Anyone in the
--     household adds, renames, reorders and deletes them, through the RPCs below; at most 30
--     (housekeeping_sections_limit), names trimmed, 1 to 40 characters.
--   - housekeeping_tasks.section_id: the section a task is in (null: none). A task's position
--     is its place within its section (or among the tasks in no section). The list's order is
--     the tasks in no section first, then section by section in the sections' order.
--   - housekeeping_visit_tasks.section_id and section_title: the section a row had on its
--     visit and that section's name then (a snapshot, like the title), so an earlier visit
--     keeps the sections it had. A visit's positions run 0…n-1, section by section.
--   - Today's visit follows the list (housekeeping_relay()): after every change to the list
--     its rows take their tasks' sections, names and places. A ticked row keeps the title it
--     was ticked under (as before); a ticked row whose task is gone keeps its section while
--     that is on the list, after the rows of the section's tasks.
--   - Deleting a section keeps its tasks: they move to the top, with no section, after the
--     tasks already there, on today's visit too. Earlier visits keep the section by its name
--     (section_id becomes null through the foreign key, section_title stays).
--
--   - Lock order. Every change to the list takes its locks in one order, so two changes made
--     at the same moment wait for each other instead of deadlocking: first the household's
--     task rows it touches (a delete, rename or move locks its row as it starts; the RPCs that
--     move tasks lock them all first; a visit being created locks them FOR KEY SHARE), then
--     housekeeping_lock(household), then visit rows. A tick on a visit already there locks
--     only the visit and its row, and never waits for housekeeping_lock after them.
--
-- Like the earlier migrations, everything here can be applied again without errors, and
-- applying it again changes no data. A database from before this file reads as it did: no
-- sections, every task and row in none (null, '').

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.housekeeping_sections (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- Trimmed by the trigger, so a blank name fails the length check.
  title text not null,
  -- Order of the sections (0 first); a new section always goes last (trigger).
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint housekeeping_sections_title_length check (length(title) between 1 and 40)
);

create index if not exists housekeeping_sections_household_idx on public.housekeeping_sections (household_id, position);

-- The section a task is in; null for none. Deleting a section moves its tasks out first
-- (housekeeping_sections_before_delete), so the foreign key only ever finds none left.
alter table public.housekeeping_tasks
  add column if not exists section_id uuid null references public.housekeeping_sections (id) on delete set null;
create index if not exists housekeeping_tasks_section_idx on public.housekeeping_tasks (section_id);

-- The section a row had on its visit, and its name then. The foreign key forgets a deleted
-- section; the name stays, so the visit keeps it.
alter table public.housekeeping_visit_tasks
  add column if not exists section_id uuid null references public.housekeeping_sections (id) on delete set null;
alter table public.housekeeping_visit_tasks add column if not exists section_title text not null default '';
alter table public.housekeeping_visit_tasks drop constraint if exists housekeeping_visit_tasks_section_title_length;
alter table public.housekeeping_visit_tasks
  add constraint housekeeping_visit_tasks_section_title_length check (length(section_title) <= 40);
create index if not exists housekeeping_visit_tasks_section_idx on public.housekeeping_visit_tasks (section_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Today's visit follows the list
-- ─────────────────────────────────────────────────────────────────────────────

-- Lays a visit's rows out as the list stands: each row whose task is on the list takes the
-- task's section (its id, and its name as section_title) and the task's place; a row whose
-- task is gone keeps its section while that is on the list (else none), after the rows of
-- the section's tasks, in the order it had. Positions run 0…n-1, section by section, the rows
-- in no section first. Titles and ticks are left alone. Only rows that change are written.
create or replace function public.housekeeping_relay(p_visit_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
begin
  select v.household_id into v_household_id from public.housekeeping_visits v where v.id = p_visit_id;
  if v_household_id is null then
    return;
  end if;
  with laid as (
    select vt.id,
           s.id as section_id,
           coalesce(s.title, '') as section_title,
           (row_number() over (
              order by (s.id is not null), s.position, s.created_at, s.id,
                       (t.id is null), t.position, t.created_at, t.id,
                       vt.position, vt.title, vt.id
           ) - 1)::integer as position
    from public.housekeeping_visit_tasks vt
    left join public.housekeeping_tasks t
      on t.id = vt.task_id and t.household_id = v_household_id
    left join public.housekeeping_sections s
      on s.household_id = v_household_id
     and s.id = case when t.id is not null then t.section_id else vt.section_id end
    where vt.visit_id = p_visit_id
  )
  update public.housekeeping_visit_tasks vt
  set section_id = laid.section_id,
      section_title = laid.section_title,
      position = laid.position
  from laid
  where vt.id = laid.id
    and (
      vt.section_id is distinct from laid.section_id
      or vt.section_title is distinct from laid.section_title
      or vt.position is distinct from laid.position
    );
end;
$$;

-- Today's visit (household time zone), if there is one, laid out as the list stands.
create or replace function public.housekeeping_relay_today(p_household_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_visit_id uuid;
begin
  select v.id into v_visit_id
  from public.housekeeping_visits v
  where v.household_id = p_household_id and v.visit_date = public.household_today(p_household_id);
  if v_visit_id is not null then
    perform public.housekeeping_relay(v_visit_id);
  end if;
end;
$$;

-- The household's visit on p_visit_date, created if there is none yet: as in
-- 20261010000400_housekeeping.sql, and each copied row also gets its task's section and that
-- section's name, the list's order running section by section (housekeeping_relay()).
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

  -- The lock order: the tasks first (FOR KEY SHARE: a task being deleted at this moment is
  -- waited for, and then left out; renames and moves don't wait), then the household's lock,
  -- as another caller may be creating the visit right now: wait for them, then look again.
  perform 1 from public.housekeeping_tasks t where t.household_id = p_household_id order by t.id for key share;
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

  -- FOR KEY SHARE, as before (a task added since the first pass is locked here). The places
  -- and sections' names come from housekeeping_relay() just after.
  insert into public.housekeeping_visit_tasks (visit_id, household_id, task_id, title, position, section_id)
  select v_visit_id, p_household_id, t.id, t.title, 0, t.section_id
  from public.housekeeping_tasks t
  where t.household_id = p_household_id
  for key share of t;

  perform public.housekeeping_relay(v_visit_id);
  return v_visit_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Triggers on the task list (redefined from 20261010000400_housekeeping.sql)
-- ─────────────────────────────────────────────────────────────────────────────

-- BEFORE INSERT OR UPDATE: trim the title; a new task goes last in its section (or among
-- the tasks in no section), whatever position the client sends, and only into a section of
-- its own household (else not_found); an update keeps household_id and created_at.
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
    if new.section_id is not null and not exists (
      select 1 from public.housekeeping_sections s
      where s.id = new.section_id and s.household_id = new.household_id
    ) then
      raise exception 'not_found';
    end if;
    select coalesce(max(t.position) + 1, 0) into new.position
    from public.housekeeping_tasks t
    where t.household_id = new.household_id and t.section_id is not distinct from new.section_id;
  else
    new.household_id := old.household_id;
    new.created_at := old.created_at;
    if new.section_id is distinct from old.section_id and new.section_id is not null and not exists (
      select 1 from public.housekeeping_sections s
      where s.id = new.section_id and s.household_id = new.household_id
    ) then
      raise exception 'not_found';
    end if;
  end if;
  return new;
end;
$$;

-- AFTER INSERT: a new task joins today's visit, if there is one, not done, in its place.
create or replace function public.housekeeping_tasks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit_id uuid;
begin
  select v.id into v_visit_id
  from public.housekeeping_visits v
  where v.household_id = new.household_id and v.visit_date = public.household_today(new.household_id);
  if v_visit_id is not null then
    insert into public.housekeeping_visit_tasks (visit_id, household_id, task_id, title, position, section_id)
    values (v_visit_id, new.household_id, new.id, new.title, 0, new.section_id)
    on conflict (visit_id, task_id) do nothing;
    perform public.housekeeping_relay(v_visit_id);
  end if;
  return null;
end;
$$;

-- AFTER UPDATE: a renamed task is renamed on today's visit unless it is ticked there (a
-- ticked row is a record of what was done, so it keeps the title it was ticked under); a task
-- moved (its place or its section) moves there too, ticked or not.
create or replace function public.housekeeping_tasks_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.title is distinct from old.title
    or new.position is distinct from old.position
    or new.section_id is distinct from old.section_id
  then
    perform public.housekeeping_lock(new.household_id);
  end if;
  if new.title is distinct from old.title then
    update public.housekeeping_visit_tasks vt
    set title = new.title
    from public.housekeeping_visits v
    where vt.visit_id = v.id
      and vt.task_id = new.id
      and not vt.done
      and v.household_id = new.household_id
      and v.visit_date = public.household_today(new.household_id);
  end if;
  if new.position is distinct from old.position or new.section_id is distinct from old.section_id then
    perform public.housekeeping_relay_today(new.household_id);
  end if;
  return null;
end;
$$;

-- BEFORE DELETE (redefined from 20261010000400_housekeeping.sql, which took no lock here):
-- today's visit drops the task unless it is already ticked there (a done row stays, as
-- history, with task_id null from the foreign key). The row being deleted is locked by now,
-- and the household's lock comes next (the lock order): a visit being created at this moment
-- locks every task FOR KEY SHARE before that lock, so it waits for this delete, and then
-- leaves the task out.
create or replace function public.housekeeping_tasks_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.housekeeping_lock(old.household_id);
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

-- AFTER DELETE: a ticked row the task leaves on today's visit (housekeeping_tasks_before_delete
-- keeps it) goes after the rows of its section's tasks, and the places close up. The BEFORE
-- DELETE trigger has taken the household's lock.
create or replace function public.housekeeping_tasks_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.housekeeping_relay_today(old.household_id);
  return null;
end;
$$;

drop trigger if exists housekeeping_tasks_after_delete on public.housekeeping_tasks;
create trigger housekeeping_tasks_after_delete
  after delete on public.housekeeping_tasks
  for each row execute function public.housekeeping_tasks_after_delete();

-- ─────────────────────────────────────────────────────────────────────────────
-- Triggers on the sections
-- ─────────────────────────────────────────────────────────────────────────────

-- BEFORE INSERT OR UPDATE: trim the name; a new section goes last, and a household has at
-- most 30 (check_violation housekeeping_sections_limit); an update keeps household_id and
-- created_at.
create or replace function public.housekeeping_sections_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.title := public.js_trim(new.title);
  if tg_op = 'INSERT' then
    perform public.housekeeping_lock(new.household_id);
    if (select count(*) from public.housekeeping_sections s where s.household_id = new.household_id) >= 30 then
      raise exception using
        errcode = 'check_violation',
        constraint = 'housekeeping_sections_limit',
        message = 'new row for relation "housekeeping_sections" violates check constraint "housekeeping_sections_limit"';
    end if;
    select coalesce(max(s.position) + 1, 0) into new.position
    from public.housekeeping_sections s
    where s.household_id = new.household_id;
  else
    new.household_id := old.household_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists housekeeping_sections_before_write on public.housekeeping_sections;
create trigger housekeeping_sections_before_write
  before insert or update on public.housekeeping_sections
  for each row execute function public.housekeeping_sections_before_write();

-- BEFORE DELETE: the section's tasks move to the top, with no section, after the tasks
-- already there, in their order; today's visit's rows in it (a ticked row whose task is gone
-- too) have none any more, and the visit is laid out again. Earlier visits' rows lose the
-- section through the foreign key and keep its name. The RPC takes housekeeping_lock before
-- the row; this takes it again (a no-op then) for a delete made some other way.
create or replace function public.housekeeping_sections_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next integer;
begin
  perform public.housekeeping_lock(old.household_id);
  select coalesce(max(t.position) + 1, 0) into v_next
  from public.housekeeping_tasks t
  where t.household_id = old.household_id and t.section_id is null;
  update public.housekeeping_tasks t
  set section_id = null,
      position = v_next + o.ord - 1
  from (
    select t2.id, row_number() over (order by t2.position, t2.created_at, t2.id) as ord
    from public.housekeeping_tasks t2
    where t2.section_id = old.id
  ) o
  where t.id = o.id;
  update public.housekeeping_visit_tasks vt
  set section_id = null,
      section_title = ''
  from public.housekeeping_visits v
  where vt.visit_id = v.id
    and vt.section_id = old.id
    and v.household_id = old.household_id
    and v.visit_date = public.household_today(old.household_id);
  perform public.housekeeping_relay_today(old.household_id);
  return old;
end;
$$;

drop trigger if exists housekeeping_sections_before_delete on public.housekeeping_sections;
create trigger housekeeping_sections_before_delete
  before delete on public.housekeeping_sections
  for each row execute function public.housekeeping_sections_before_delete();

-- ─────────────────────────────────────────────────────────────────────────────
-- RPCs (security definer, empty search_path; each checks the caller first: no user is
-- not_signed_in, and not a member of the household (or a section or task elsewhere) is
-- not_found). Each takes housekeeping_lock before it writes, so changes to the list are made
-- one at a time per household and today's visit is never created halfway through one; one
-- that moves tasks locks them all first (the lock order in the header).
-- ─────────────────────────────────────────────────────────────────────────────

-- create_housekeeping_section: a new section, trimmed, last, with no task. Returns the row.
-- Too long or blank: housekeeping_sections_title_length; a 31st: housekeeping_sections_limit.
create or replace function public.create_housekeeping_section(p_household_id uuid, p_title text)
returns public.housekeeping_sections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.housekeeping_sections;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  if not exists (
    select 1 from public.members m where m.user_id = v_uid and m.household_id = p_household_id
  ) then
    raise exception 'not_found';
  end if;
  perform public.housekeeping_lock(p_household_id);
  insert into public.housekeeping_sections (household_id, title)
  values (p_household_id, coalesce(p_title, ''))
  returning * into v_row;
  return v_row;
end;
$$;

-- rename_housekeeping_section: trimmed; the same name again changes nothing. Today's visit
-- shows the new name; earlier visits keep the one they had.
create or replace function public.rename_housekeeping_section(p_section_id uuid, p_title text)
returns void
language plpgsql
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
  select s.household_id into v_household_id
  from public.housekeeping_sections s
  join public.members m on m.household_id = s.household_id and m.user_id = v_uid
  where s.id = p_section_id;
  if v_household_id is null then
    raise exception 'not_found';
  end if;
  perform public.housekeeping_lock(v_household_id);
  update public.housekeeping_sections s
  set title = coalesce(p_title, '')
  where s.id = p_section_id
    and s.title is distinct from public.js_trim(coalesce(p_title, ''));
  perform public.housekeeping_relay_today(v_household_id);
end;
$$;

-- delete_housekeeping_section: deletes it, keeping its tasks (housekeeping_sections_before_delete
-- moves them to the top, with no section, on today's visit too).
create or replace function public.delete_housekeeping_section(p_section_id uuid)
returns void
language plpgsql
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
  select s.household_id into v_household_id
  from public.housekeeping_sections s
  join public.members m on m.household_id = s.household_id and m.user_id = v_uid
  where s.id = p_section_id;
  if v_household_id is null then
    raise exception 'not_found';
  end if;
  -- Its tasks move (the trigger): the household's tasks first, then the lock.
  perform 1 from public.housekeeping_tasks t where t.household_id = v_household_id order by t.id for no key update;
  perform public.housekeeping_lock(v_household_id);
  delete from public.housekeeping_sections s where s.id = p_section_id;
  if not found then
    -- Deleted by someone else while this one waited.
    raise exception 'not_found';
  end if;
end;
$$;

-- reorder_housekeeping_sections: position = index in p_section_ids (the first mention wins);
-- ids from other households are ignored. Each section's tasks come along; today's visit follows.
create or replace function public.reorder_housekeeping_sections(p_household_id uuid, p_section_ids uuid[])
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
    select 1 from public.members m where m.user_id = v_uid and m.household_id = p_household_id
  ) then
    raise exception 'not_found';
  end if;
  perform public.housekeeping_lock(p_household_id);
  update public.housekeeping_sections s
  set position = o.ord - 1
  from (
    select distinct on (x.id) x.id, x.ord
    from unnest(coalesce(p_section_ids, '{}'::uuid[])) with ordinality as x(id, ord)
    order by x.id, x.ord
  ) o
  where s.id = o.id
    and s.household_id = p_household_id
    and s.position is distinct from o.ord - 1;
  perform public.housekeeping_relay_today(p_household_id);
end;
$$;

-- arrange_housekeeping_tasks: the whole list at once, all or nothing. p_groups is a JSON array
-- of { "sectionId": uuid | null, "taskIds": [uuid…] }: each task gets that section and its
-- index there as its position. It must name every task of the household exactly once, and a
-- section at most once (else invalid_input); a task or section that is not the household's is
-- not_found. The groups' order does not matter (sections keep theirs). Today's visit follows.
create or replace function public.arrange_housekeeping_tasks(p_household_id uuid, p_groups jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_groups jsonb := coalesce(p_groups, 'null'::jsonb);
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_named integer;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  if not exists (
    select 1 from public.members m where m.user_id = v_uid and m.household_id = p_household_id
  ) then
    raise exception 'not_found';
  end if;
  -- The household's tasks first, then the lock. A task added while this waited is not named
  -- below, so the arrangement is refused (invalid_input) and the app reloads.
  perform 1 from public.housekeeping_tasks t where t.household_id = p_household_id order by t.id for no key update;
  perform public.housekeeping_lock(p_household_id);

  -- The shape: an array of objects, each with a sectionId (a string or null) and taskIds (an
  -- array of strings).
  if jsonb_typeof(v_groups) <> 'array' or exists (
    select 1
    from jsonb_array_elements(v_groups) as e(g)
    where case
            when jsonb_typeof(e.g) <> 'object' then true
            when coalesce(jsonb_typeof(e.g -> 'sectionId'), 'missing') not in ('string', 'null') then true
            when coalesce(jsonb_typeof(e.g -> 'taskIds'), 'missing') <> 'array' then true
            else exists (
              select 1 from jsonb_array_elements(e.g -> 'taskIds') as x(id) where jsonb_typeof(x.id) <> 'string'
            )
          end
  ) then
    raise exception 'invalid_input';
  end if;
  -- Each section at most once.
  if (select count(*) <> count(distinct lower(coalesce(e.g ->> 'sectionId', '-')))
      from jsonb_array_elements(v_groups) as e(g)) then
    raise exception 'invalid_input';
  end if;
  -- Each section the household's.
  if exists (
    select 1
    from jsonb_array_elements(v_groups) as e(g)
    where jsonb_typeof(e.g -> 'sectionId') = 'string'
      and (
        e.g ->> 'sectionId' !~ v_uuid
        or not exists (
          select 1 from public.housekeeping_sections s
          where s.id::text = lower(e.g ->> 'sectionId') and s.household_id = p_household_id
        )
      )
  ) then
    raise exception 'not_found';
  end if;
  -- Each task once.
  select count(*) into v_named
  from jsonb_array_elements(v_groups) as e(g), jsonb_array_elements_text(e.g -> 'taskIds') as x(id);
  if v_named <> (
    select count(distinct lower(x.id))
    from jsonb_array_elements(v_groups) as e(g), jsonb_array_elements_text(e.g -> 'taskIds') as x(id)
  ) then
    raise exception 'invalid_input';
  end if;
  -- Each task the household's.
  if exists (
    select 1
    from jsonb_array_elements(v_groups) as e(g), jsonb_array_elements_text(e.g -> 'taskIds') as x(id)
    where x.id !~ v_uuid
      or not exists (
        select 1 from public.housekeeping_tasks t
        where t.id::text = lower(x.id) and t.household_id = p_household_id
      )
  ) then
    raise exception 'not_found';
  end if;
  -- Every task of the household named.
  if v_named <> (select count(*) from public.housekeeping_tasks t where t.household_id = p_household_id) then
    raise exception 'invalid_input';
  end if;

  -- Each moved task's AFTER UPDATE trigger lays today's visit out again.
  update public.housekeeping_tasks t
  set section_id = a.section_id,
      position = a.position
  from (
    select (e.g ->> 'sectionId')::uuid as section_id,
           x.id::uuid as task_id,
           (x.ord - 1)::integer as position
    from jsonb_array_elements(v_groups) as e(g)
    cross join lateral jsonb_array_elements_text(e.g -> 'taskIds') with ordinality as x(id, ord)
  ) a
  where t.id = a.task_id
    and t.household_id = p_household_id
    and (t.section_id is distinct from a.section_id or t.position is distinct from a.position);
end;
$$;

-- reorder_housekeeping_tasks (redefined from 20261010000400_housekeeping.sql, for an app from
-- before sections still running): position = index in p_task_ids, which keeps each task in
-- its section; ids from other households are ignored. Today's visit follows (the AFTER UPDATE
-- trigger). The app now arranges the list with arrange_housekeeping_tasks.
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
  perform 1 from public.housekeeping_tasks t where t.household_id = p_household_id order by t.id for no key update;
  perform public.housekeeping_lock(p_household_id);

  update public.housekeeping_tasks t
  set position = o.ord - 1
  from unnest(coalesce(p_task_ids, '{}'::uuid[])) with ordinality as o(id, ord)
  where t.id = o.id
    and t.household_id = p_household_id
    and t.position is distinct from o.ord - 1;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row level security and privileges
--   housekeeping_sections   read; written by the RPCs above
--   housekeeping_tasks      as before, and a new task may name its section (insert section_id);
--                           sections and places change only through the RPCs
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.housekeeping_sections enable row level security;

revoke all on table public.housekeeping_sections from public, anon, authenticated;
grant all on table public.housekeeping_sections to service_role;
grant select on public.housekeeping_sections to authenticated;
grant insert (section_id) on public.housekeeping_tasks to authenticated;

drop policy if exists housekeeping_sections_select on public.housekeeping_sections;
create policy housekeeping_sections_select on public.housekeeping_sections
  for select to authenticated
  using (public.is_household_member(household_id));

revoke all on function public.create_housekeeping_section(uuid, text) from public, anon;
revoke all on function public.rename_housekeeping_section(uuid, text) from public, anon;
revoke all on function public.delete_housekeeping_section(uuid) from public, anon;
revoke all on function public.reorder_housekeeping_sections(uuid, uuid[]) from public, anon;
revoke all on function public.arrange_housekeeping_tasks(uuid, jsonb) from public, anon;
revoke all on function public.reorder_housekeeping_tasks(uuid, uuid[]) from public, anon;
grant execute on function public.create_housekeeping_section(uuid, text) to authenticated, service_role;
grant execute on function public.rename_housekeeping_section(uuid, text) to authenticated, service_role;
grant execute on function public.delete_housekeeping_section(uuid) to authenticated, service_role;
grant execute on function public.reorder_housekeeping_sections(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.arrange_housekeeping_tasks(uuid, jsonb) to authenticated, service_role;
grant execute on function public.reorder_housekeeping_tasks(uuid, uuid[]) to authenticated, service_role;

revoke all on function public.housekeeping_relay(uuid) from public, anon, authenticated;
revoke all on function public.housekeeping_relay_today(uuid) from public, anon, authenticated;
revoke all on function public.housekeeping_visit_for(uuid, date, uuid) from public, anon, authenticated;
revoke all on function public.housekeeping_tasks_before_write() from public, anon, authenticated;
revoke all on function public.housekeeping_tasks_after_insert() from public, anon, authenticated;
revoke all on function public.housekeeping_tasks_after_update() from public, anon, authenticated;
revoke all on function public.housekeeping_tasks_before_delete() from public, anon, authenticated;
revoke all on function public.housekeeping_tasks_after_delete() from public, anon, authenticated;
revoke all on function public.housekeeping_sections_before_write() from public, anon, authenticated;
revoke all on function public.housekeeping_sections_before_delete() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime: the sections join supabase_realtime (when it exists), with the whole old row
-- logged so deletes can be filtered by household too. Clients reload on any event.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'housekeeping_sections'
    )
  then
    alter publication supabase_realtime add table public.housekeeping_sections;
  end if;
end;
$$;

alter table public.housekeeping_sections replica identity full;
