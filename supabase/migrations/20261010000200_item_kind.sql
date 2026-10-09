-- home.os item kinds: "To do" (task) and "To maintain" (state).
--
-- A task is something to get done: Mark as Done completes it (a repeating one moves to its
-- next due date, a one-off one leaves the list). A state is a thing whose condition the
-- household keeps track of (the firepit, the jacuzzi): it is never done and stays on the
-- list, and it has no due date, repeat or reminder. An item can change kind both ways; a
-- state that becomes a task gets the new-item defaults for its due date and so on from the
-- app (the database only clears them when an item becomes a state).
--
-- Contract (docs/ARCHITECTURE.md "Database"):
--   items.kind text not null default 'task' check (kind in ('task', 'state'))
--   items BEFORE INSERT/UPDATE: when kind = 'state', due_date := null, repeat := 'none',
--     notify := 'none' (whatever the client sends)
--   complete_item on a state raises invalid_input (and logs nothing)
--   create_household seed items take an optional "kind" (default 'task')
--
-- The scheduler's view (scheduler_open_items) is left as it is. A state never has a due date
-- or a reminder, so it can never be due, missed or reminded about; the scheduler reads which
-- open items are states straight from items (service role) to mark them in the weekly email.
--
-- Like the earlier migrations, everything here can be applied again without errors
-- (add column if not exists, drop/add for constraints, create or replace for functions,
-- drop/create for the trigger).

-- ─────────────────────────────────────────────────────────────────────────────
-- Column
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.items add column if not exists kind text not null default 'task';

alter table public.items drop constraint if exists items_kind_check;
alter table public.items add constraint items_kind_check check (kind in ('task', 'state'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: a state has no due date, repeat or reminder.
--
-- Its own trigger, so items_before_write() (area, assignee and authorship rules) stays as
-- it is. Triggers on the same event fire in name order, so this runs after
-- items_before_write; neither depends on the other.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.items_kind_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'state' then
    new.due_date := null;
    new.repeat := 'none';
    new.notify := 'none';
  end if;
  return new;
end;
$$;

revoke all on function public.items_kind_rules() from public, anon, authenticated;

drop trigger if exists items_kind_rules on public.items;
create trigger items_kind_rules
  before insert or update on public.items
  for each row execute function public.items_kind_rules();

-- Rows that are already states (only on a second run) keep to the rule.
update public.items
set due_date = null, repeat = 'none', notify = 'none'
where kind = 'state'
  and (due_date is not null or repeat <> 'none' or notify <> 'none');

-- ─────────────────────────────────────────────────────────────────────────────
-- create_household: as before, plus an optional "kind" per seed item.
-- p_items: [{area, kind ('task' | 'state', default 'task'), title, note, rag,
--            due_in_days (int|null), repeat, notify}]
-- A state is seeded without a due date, repeat or reminder (the trigger above).
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

    insert into public.items (
      household_id, area_id, kind, title, note, rag, due_date, repeat, notify, created_by
    )
    values (
      v_household_id, v_area_id, v_kind, v_title, coalesce(v_item ->> 'note', ''), v_rag,
      v_due_date, v_repeat, v_notify, v_member_id
    );
  end loop;

  return v_household_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- complete_item: as before, but a state is never done: invalid_input, nothing logged.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.complete_item(p_item_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.members%rowtype;
  v_item public.items%rowtype;
  v_timezone text;
  v_today date;
  v_completion_id uuid;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  select * into v_member from public.members m where m.user_id = v_uid;

  -- Lock the item so two people tapping Done at once cannot both complete a one-off item.
  select * into v_item
  from public.items i
  where i.id = p_item_id and i.household_id = v_member.household_id
  for update;
  if v_item.id is null or v_item.status <> 'open' then
    raise exception 'not_found';
  end if;
  -- A state (To maintain) stays on the list for good.
  if v_item.kind = 'state' then
    raise exception 'invalid_input';
  end if;

  insert into public.completions (
    household_id, item_id, item_title, credited_to, completed_by, completed_at,
    prev_due_date, prev_status
  )
  values (
    v_item.household_id, v_item.id, v_item.title, coalesce(v_item.assignee_id, v_member.id),
    v_member.id, now(), v_item.due_date, v_item.status
  )
  returning id into v_completion_id;

  if v_item.repeat <> 'none' then
    -- Stays open; the next due date is computed against today in the household's zone.
    select h.timezone into v_timezone from public.households h where h.id = v_item.household_id;
    v_today := (now() at time zone v_timezone)::date;
    update public.items
    set due_date = public.next_due_date(v_item.repeat, v_item.due_date, v_today)
    where id = v_item.id;
  else
    update public.items
    set status = 'done', completed_at = now()
    where id = v_item.id;
  end if;

  return v_completion_id;
end;
$$;

-- create or replace keeps the existing privileges; stated again so this file reads whole.
revoke all on function public.create_household(text, text, text, text, text, text[], jsonb) from public, anon;
revoke all on function public.complete_item(uuid) from public, anon;
grant execute on function public.create_household(text, text, text, text, text, text[], jsonb) to authenticated, service_role;
grant execute on function public.complete_item(uuid) to authenticated, service_role;
