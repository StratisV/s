-- home.os RPCs (called with supabase.rpc()).
--
-- All are security definer with an empty search_path, check the caller themselves, and
-- raise one of these exact messages so clients can map them (BackendError.code):
--   not_signed_in   no auth.uid()
--   already_member  the caller already belongs to a household
--   invalid_invite  unknown or expired invite token
--   not_found       the row does not exist, or the caller is not in its household
--   invalid_input   malformed arguments
-- Outsiders always get not_found, so ids from other households reveal nothing.

-- ─────────────────────────────────────────────────────────────────────────────
-- create_household: the caller's new household, owner member row, areas and seed items.
-- p_items: [{area, title, note, rag, due_in_days (int|null), repeat, notify}]
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
    v_rag := coalesce(v_item ->> 'rag', 'amber');
    v_repeat := coalesce(v_item ->> 'repeat', 'none');
    v_notify := coalesce(v_item ->> 'notify', 'day_before');
    if v_title = ''
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
      household_id, area_id, title, note, rag, due_date, repeat, notify, created_by
    )
    values (
      v_household_id, v_area_id, v_title, coalesce(v_item ->> 'note', ''), v_rag,
      v_due_date, v_repeat, v_notify, v_member_id
    );
  end loop;

  return v_household_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- invite_preview: what the join screen shows before the user commits. Any signed-in user.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.invite_preview(p_token text)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object('household_name', h.name, 'address', h.address)
  from public.invites i
  join public.households h on h.id = i.household_id
  where i.token = btrim(p_token, E' \t\r\n')
    and i.expires_at > now()
  limit 1
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- join_household: join through a reusable, unexpired invite. Returns the household id.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.join_household(
  p_token text,
  p_member_name text,
  p_member_emoji text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member_name text := btrim(coalesce(p_member_name, ''));
  v_invite public.invites%rowtype;
  v_current uuid;
  v_count integer;
  v_colors constant text[] := array['#007AFF', '#AF52DE', '#30B0C7', '#FF9500', '#34C759', '#FF2D55'];
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;

  select * into v_invite from public.invites i where i.token = btrim(p_token, E' \t\r\n');
  select m.household_id into v_current from public.members m where m.user_id = v_uid;

  -- Opening the link again after joining is harmless.
  if v_current is not null and v_current = v_invite.household_id then
    return v_current;
  end if;
  if v_invite.id is null or v_invite.expires_at <= now() then
    raise exception 'invalid_invite';
  end if;
  if v_current is not null then
    raise exception 'already_member';
  end if;
  if v_member_name = '' then
    raise exception 'invalid_input';
  end if;

  -- Serialise joins per household so colours follow join order.
  perform 1 from public.households h where h.id = v_invite.household_id for update;
  select count(*) into v_count from public.members m where m.household_id = v_invite.household_id;

  begin
    insert into public.members (household_id, user_id, name, email, emoji, color, role)
    values (
      v_invite.household_id,
      v_uid,
      v_member_name,
      coalesce(
        nullif(auth.jwt() ->> 'email', ''),
        (select u.email from auth.users u where u.id = v_uid),
        ''
      ),
      coalesce(nullif(btrim(p_member_emoji), ''), '🦔'),
      v_colors[(v_count % 6) + 1],
      'member'
    );
  exception when unique_violation then
    raise exception 'already_member';
  end;

  return v_invite.household_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- create_invite: a fresh token for the caller's household, valid for 14 days.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_invite()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.members%rowtype;
  v_token text := replace(gen_random_uuid()::text, '-', '');
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  select * into v_member from public.members m where m.user_id = v_uid;
  if v_member.id is null then
    raise exception 'not_found';
  end if;

  insert into public.invites (household_id, token, created_by, expires_at)
  values (v_member.household_id, v_token, v_member.id, now() + interval '14 days');
  return v_token;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- complete_item: log a completion and move the item on. Returns the completion id.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- undo_completion: put the item back exactly as it was and delete the completion.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.undo_completion(p_completion_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_completion public.completions%rowtype;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;

  select * into v_completion
  from public.completions c
  where c.id = p_completion_id
    and c.household_id = (select m.household_id from public.members m where m.user_id = v_uid)
  for update;
  if v_completion.id is null then
    raise exception 'not_found';
  end if;

  -- The item may have been deleted since (item_id is then null): just drop the log row.
  if v_completion.item_id is not null then
    update public.items
    set status = v_completion.prev_status,
        due_date = v_completion.prev_due_date,
        completed_at = case when v_completion.prev_status = 'open' then null else completed_at end
    where id = v_completion.item_id;
  end if;

  delete from public.completions where id = v_completion.id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- reorder_areas: position = index in p_area_ids. Ids from other households are ignored.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reorder_areas(p_household_id uuid, p_area_ids uuid[])
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

  update public.areas a
  set position = o.ord - 1
  from unnest(coalesce(p_area_ids, '{}'::uuid[])) with ordinality as o(id, ord)
  where a.id = o.id
    and a.household_id = p_household_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Privileges: signed-in users only.
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function public.create_household(text, text, text, text, text, text[], jsonb) from public, anon;
revoke all on function public.invite_preview(text) from public, anon;
revoke all on function public.join_household(text, text, text) from public, anon;
revoke all on function public.create_invite() from public, anon;
revoke all on function public.complete_item(uuid) from public, anon;
revoke all on function public.undo_completion(uuid) from public, anon;
revoke all on function public.reorder_areas(uuid, uuid[]) from public, anon;

grant execute on function public.create_household(text, text, text, text, text, text[], jsonb) to authenticated, service_role;
grant execute on function public.invite_preview(text) to authenticated, service_role;
grant execute on function public.join_household(text, text, text) to authenticated, service_role;
grant execute on function public.create_invite() to authenticated, service_role;
grant execute on function public.complete_item(uuid) to authenticated, service_role;
grant execute on function public.undo_completion(uuid) to authenticated, service_role;
grant execute on function public.reorder_areas(uuid, uuid[]) to authenticated, service_role;
