-- home.os: "What good looks like" for To maintain items.
--
-- A state (To maintain, see 20261010000200_item_kind.sql) is a thing whose condition the
-- household keeps track of, like the firepit. Its note says how it is now ("Restocked."); this
-- new free-text column says how it should be kept ("Cover on when not in use, ash cleared out,
-- logs dry and stacked under the bench.").
--
-- Contract (docs/ARCHITECTURE.md "Database"):
--   items.good text not null default '' check (length(good) <= 4000)
--   create_household seed items take an optional "good" (default '')
--
-- Every item has the column, tasks too. The app only shows it for a state, but it is kept
-- whatever the kind, so an item that becomes a task and then a state again still has it.
-- Nothing else needs to change for it:
--   - RLS and grants: items is granted to authenticated as a whole table (select, insert,
--     update, delete), so every member can read and edit the new column, outsiders cannot.
--   - Triggers: items_before_write (area, assignee, authorship) and items_kind_rules (a state
--     has no due date, repeat or reminder) leave it alone.
--   - complete_item and undo_completion only update status, due_date and completed_at, so it
--     is kept as it is (and a state is never completed anyway).
--   - Realtime: items is already in the publication with replica identity full.
--   - The scheduler's view (scheduler_open_items) lists its own columns and does not need it.
--
-- Like the earlier migrations, everything here can be applied again without errors
-- (add column if not exists, drop/add for the constraint, create or replace for the function).

-- ─────────────────────────────────────────────────────────────────────────────
-- Column and limit (TEXT_LIMITS.itemGood in src/lib/constants.ts, like items.note)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.items add column if not exists good text not null default '';

-- Only on a second run could a row be over the limit; within it nothing is touched.
update public.items set good = left(good, 4000) where length(good) > 4000;

alter table public.items drop constraint if exists items_good_length;
alter table public.items add constraint items_good_length check (length(good) <= 4000);

-- ─────────────────────────────────────────────────────────────────────────────
-- create_household: as in 20261010000200_item_kind.sql, plus an optional "good" per seed item.
-- p_items: [{area, kind ('task' | 'state', default 'task'), title, note, good (default ''),
--            rag, due_in_days (int|null), repeat, notify}]
-- A state is seeded without a due date, repeat or reminder (the items_kind_rules trigger).
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

  return v_household_id;
end;
$$;

-- create or replace keeps the existing privileges; stated again so this file reads whole.
revoke all on function public.create_household(text, text, text, text, text, text[], jsonb) from public, anon;
grant execute on function public.create_household(text, text, text, text, text, text[], jsonb) to authenticated, service_role;
