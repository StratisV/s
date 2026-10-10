-- home.os: one home, people who have not joined yet, and bringing the home over from a phone.
--
-- The contract lives in docs/ARCHITECTURE.md ("One home", "People before they join",
-- "Bring over the home from this phone"). In short:
--
--   members.user_id is nullable. A row with user_id null is a person someone at home added
--     (name, emoji, optional Google email) who has not signed in yet ("Not joined yet"). They
--     can be assigned items and credited in Stats like anyone else. Such a row grants nobody
--     anything: every access check compares user_id with auth.uid(), and null never matches.
--   members.email is stored lower-case and trimmed (members_before_write) and is unique per
--     household among non-blank emails (members_household_email_key), at most 254 characters.
--   A person who has not joined never has push on (members_before_write), and the scheduler
--     skips them (supabase/functions/_shared/plan.ts).
--   enter_home()                      where the signed-in person belongs; claims a person
--                                     whose email is their verified Google email
--   add_person(hid, name, emoji, email)  a person who has not joined yet
--   set_person_email(member, email)   set or clear a not-yet-joined person's email
--   remove_person(member)             remove a not-yet-joined person (items become unassigned)
--   import_household(payload)         create the home from this phone's demo data
--   join_household(...)               as before, but claims a not-yet-joined person with the
--                                     caller's verified email instead of adding a duplicate
--
-- New error messages (BackendError codes): email_taken (another person in the home has that
-- email) and home_exists (import_household when a home already exists).
--
-- create_household is NOT redefined here (the Housekeeping migration owns it). Like the
-- earlier migrations, everything here can be applied again without errors.

-- ─────────────────────────────────────────────────────────────────────────────
-- members: people before they join
-- ─────────────────────────────────────────────────────────────────────────────

-- Still unique (and still on delete cascade): one person per account. Postgres unique
-- constraints treat nulls as distinct, so any number of people can be waiting to join.
alter table public.members alter column user_id drop not null;

-- Emails are stored in one form, so equality is case-insensitive and claims compare like
-- for like. Rows already in that form are not touched (a no-op on a second run).
update public.members
set email = lower(btrim(email, E' \t\r\n'))
where email is distinct from lower(btrim(email, E' \t\r\n'));

-- Longer than any real address (RFC 5321): only possible on a hand-edited database.
update public.members set email = '' where length(email) > 254;

-- Two people in one home with the same email (also only possible by hand): the later ones
-- lose it, so the unique index below can be built.
update public.members m
set email = ''
where m.email <> ''
  and exists (
    select 1 from public.members o
    where o.household_id = m.household_id
      and lower(o.email) = lower(m.email)
      and (o.created_at, o.id) < (m.created_at, m.id)
  );

alter table public.members drop constraint if exists members_email_length;
alter table public.members add constraint members_email_length check (length(email) <= 254);

-- One person per email in a home (case-insensitive; blank emails do not count).
create unique index if not exists members_household_email_key
  on public.members (household_id, lower(email))
  where email <> '';

-- Finding the person to claim at sign-in.
create index if not exists members_unjoined_email_idx
  on public.members (lower(email))
  where user_id is null and email <> '';

-- members: the email in its stored form, and no push for someone who has not joined (there
-- is no browser to push to; push_subs needs the person's own account anyway).
create or replace function public.members_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(btrim(coalesce(new.email, ''), E' \t\r\n'));
  if new.user_id is null then
    new.push_enabled := false;
  end if;
  return new;
end;
$$;

drop trigger if exists members_before_write on public.members;
create trigger members_before_write
  before insert or update on public.members
  for each row execute function public.members_before_write();

-- ─────────────────────────────────────────────────────────────────────────────
-- Internal helpers (not callable by clients)
-- ─────────────────────────────────────────────────────────────────────────────

-- The account's email in stored form if Supabase Auth has verified it (Google accounts always
-- are), else ''. Only a verified email may claim a person.
create or replace function public.verified_email(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select lower(btrim(coalesce(u.email, ''), E' \t\r\n')) into v_email
  from auth.users u
  where u.id = p_user_id and u.email_confirmed_at is not null;
  return coalesce(v_email, '');
end;
$$;

-- The account's email in stored form, verified or not ('' when it has none): what the
-- "This home is private" screen asks housemates to add.
create or replace function public.account_email(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select lower(btrim(coalesce(u.email, ''), E' \t\r\n')) into v_email
  from auth.users u
  where u.id = p_user_id;
  return coalesce(nullif(v_email, ''), lower(btrim(coalesce(auth.jwt() ->> 'email', ''), E' \t\r\n')));
end;
$$;

-- True when any home exists. home.os runs one home per deployment: with none, the first person
-- to sign in creates it (or brings it over from their phone); with one, nobody creates another.
create or replace function public.home_exists()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.households)
$$;

-- A plausible email address (what add_person and set_person_email accept): one @, no spaces,
-- a dot in the domain, at most 254 characters. src/lib/logic/people.ts isValidEmail() is the
-- same rule.
create or replace function public.is_valid_email(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_email is not null
    and length(p_email) <= 254
    and p_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- items: import_household keeps each item's own history
--
-- As in 20261009000100_hardening.sql, plus one case: while import_household is inserting
-- (it sets homeos.importing to 'on' for those statements only), an inserted row keeps the
-- created_at, updated_at, created_by and updated_by it was given, so "Updated Tue 6 Oct" and
-- the order of undated tasks survive the move. Clients cannot set that setting: PostgREST
-- runs no SQL of theirs, and no RPC sets it from input.
-- ─────────────────────────────────────────────────────────────────────────────

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

  if tg_op = 'INSERT' and coalesce(current_setting('homeos.importing', true), '') = 'on' then
    -- import_household: the item's own timestamps and authors, as validated by the import.
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, new.created_at);
    return new;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- enter_home: where the signed-in person belongs. Called right after sign-in (and again by
-- the "This home is private" screen). Returns json, one of:
--   {"status": "member",  "household_id": uuid, "member_id": uuid}
--       already in a home: open it
--   {"status": "claimed", "household_id": uuid, "member_id": uuid}
--       someone at home had added a person with this account's verified email who had not
--       joined yet: the caller is now that person (name, emoji, colour, items and Stats kept)
--   {"status": "no_home"}
--       not in a home, and no home exists at all: the first person creates it (or brings it
--       over from their phone)
--   {"status": "private", "email": text, "email_verified": boolean}
--       a home exists and nobody there has this account's email: ask someone at home to add
--       it in Profile > Household > People. Nothing about the home is revealed.
-- A claim is atomic: two sessions claiming the same person cannot both win, and an account
-- never ends up as two people (members_user_id_key).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enter_home()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.members%rowtype;
  v_email text;
  v_target uuid;
  v_claimed uuid;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;

  select * into v_member from public.members m where m.user_id = v_uid;
  if v_member.id is not null then
    return json_build_object('status', 'member', 'household_id', v_member.household_id, 'member_id', v_member.id);
  end if;

  v_email := public.verified_email(v_uid);
  if v_email <> '' then
    -- Oldest first, so the outcome is the same every time (one home holds one such person
    -- at most; several homes in one database only happen in tests).
    for v_target in
      select m.id
      from public.members m
      where m.user_id is null and m.email <> '' and lower(m.email) = v_email
      order by m.created_at, m.id
    loop
      v_claimed := null;
      begin
        -- Still waiting to join, still with this email? A concurrent claim, or an email
        -- changed in People, that committed first makes this touch no row: READ COMMITTED
        -- re-checks the whole condition on the newest row version.
        update public.members m
        set user_id = v_uid
        where m.id = v_target
          and m.user_id is null
          and m.email <> ''
          and lower(m.email) = v_email
        returning m.id into v_claimed;
      exception when unique_violation then
        -- This account became someone else at the same moment (another tab): that wins.
        exit;
      end;
      if v_claimed is not null then
        select * into v_member from public.members m where m.id = v_claimed;
        return json_build_object('status', 'claimed', 'household_id', v_member.household_id, 'member_id', v_member.id);
      end if;
    end loop;

    -- Claimed (or joined) by this same account in a concurrent call.
    select * into v_member from public.members m where m.user_id = v_uid;
    if v_member.id is not null then
      return json_build_object('status', 'member', 'household_id', v_member.household_id, 'member_id', v_member.id);
    end if;
  end if;

  if not public.home_exists() then
    return json_build_object('status', 'no_home');
  end if;
  return json_build_object(
    'status', 'private',
    'email', public.account_email(v_uid),
    'email_verified', v_email <> ''
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- join_household: as in 20261008000300_rpc.sql, plus: when the household has a person who has
-- not joined yet with the caller's verified email, the caller becomes that person (their
-- name, emoji, colour and items are kept; p_member_name and p_member_emoji are not applied)
-- instead of being added a second time. Otherwise a new member is added as before; if their
-- email is already someone else's in this home (an unverified account), they join without it.
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
  v_verified text;
  v_email text;
  v_claimed uuid;
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

  -- Serialise joins and new people per household, so colours follow join order and an email
  -- is checked and taken in one step (add_person and set_person_email lock the same row).
  perform 1 from public.households h where h.id = v_invite.household_id for update;

  v_verified := public.verified_email(v_uid);
  if v_verified <> '' then
    begin
      update public.members m
      set user_id = v_uid
      where m.household_id = v_invite.household_id
        and m.user_id is null
        and m.email <> ''
        and lower(m.email) = v_verified
      returning m.id into v_claimed;
    exception when unique_violation then
      raise exception 'already_member';
    end;
    if v_claimed is not null then
      return v_invite.household_id;
    end if;
  end if;

  v_email := lower(btrim(coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    (select u.email from auth.users u where u.id = v_uid),
    ''
  ), E' \t\r\n'));
  if v_email <> '' and exists (
    select 1 from public.members m
    where m.household_id = v_invite.household_id and lower(m.email) = v_email
  ) then
    v_email := '';
  end if;

  select count(*) into v_count from public.members m where m.household_id = v_invite.household_id;

  begin
    insert into public.members (household_id, user_id, name, email, emoji, color, role)
    values (
      v_invite.household_id,
      v_uid,
      v_member_name,
      v_email,
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
-- add_person: someone at home adds a person who has not joined yet. Returns the member id.
--   p_name   required (trimmed; blank is invalid_input; over 40 characters violates
--            members_name_length)
--   p_emoji  blank becomes 🦔
--   p_email  optional ('' for none): the Google email they will sign in with. Trimmed and
--            lower-cased; not an email is invalid_input; already someone's in this home is
--            email_taken.
-- Role member, colour MEMBER_COLORS[people in the home mod 6] (like join_household), no
-- account, push off, weekly email on (it starts once they join).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.add_person(
  p_household_id uuid,
  p_name text,
  p_emoji text,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, ''), E' \t\r\n'));
  v_count integer;
  v_id uuid;
  v_colors constant text[] := array['#007AFF', '#AF52DE', '#30B0C7', '#FF9500', '#34C759', '#FF2D55'];
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  if not exists (
    select 1 from public.members m where m.user_id = v_uid and m.household_id = p_household_id
  ) then
    raise exception 'not_found';
  end if;
  if v_name = '' or (v_email <> '' and not public.is_valid_email(v_email)) then
    raise exception 'invalid_input';
  end if;

  perform 1 from public.households h where h.id = p_household_id for update;

  if v_email <> '' and exists (
    select 1 from public.members m where m.household_id = p_household_id and lower(m.email) = v_email
  ) then
    raise exception 'email_taken';
  end if;

  select count(*) into v_count from public.members m where m.household_id = p_household_id;
  insert into public.members (household_id, user_id, name, email, emoji, color, role)
  values (
    p_household_id,
    null,
    v_name,
    v_email,
    coalesce(nullif(btrim(p_emoji), ''), '🦔'),
    v_colors[(v_count % 6) + 1],
    'member'
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- set_person_email: set, change or clear ('') the email of a person who has not joined yet.
-- not_found: no such person in the caller's home. invalid_input: they have joined (their
-- email is their account's), or the value is not an email. email_taken: another person in
-- the home has it. Setting the email they already have is a no-op.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_person_email(p_member_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, ''), E' \t\r\n'));
  v_person public.members%rowtype;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  select * into v_person
  from public.members p
  where p.id = p_member_id
    and p.household_id = (select m.household_id from public.members m where m.user_id = v_uid);
  if v_person.id is null then
    raise exception 'not_found';
  end if;
  if v_person.user_id is not null or (v_email <> '' and not public.is_valid_email(v_email)) then
    raise exception 'invalid_input';
  end if;

  perform 1 from public.households h where h.id = v_person.household_id for update;

  if v_email <> '' and exists (
    select 1 from public.members m
    where m.household_id = v_person.household_id and m.id <> v_person.id and lower(m.email) = v_email
  ) then
    raise exception 'email_taken';
  end if;

  -- Joined in the meantime (the row lock above waited for their claim): their email is theirs.
  update public.members m
  set email = v_email
  where m.id = v_person.id and m.user_id is null and m.email is distinct from v_email;
  if not found and exists (select 1 from public.members m where m.id = v_person.id and m.user_id is not null) then
    raise exception 'invalid_input';
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- remove_person: remove a person who has not joined yet. Their items become unassigned and
-- their Stats credits go with them (on delete set null), as when any member row is deleted.
-- not_found: no such person in the caller's home. invalid_input: they have joined.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.remove_person(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_person public.members%rowtype;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  select * into v_person
  from public.members p
  where p.id = p_member_id
    and p.household_id = (select m.household_id from public.members m where m.user_id = v_uid)
  for update;
  if v_person.id is null then
    raise exception 'not_found';
  end if;
  if v_person.user_id is not null then
    raise exception 'invalid_input';
  end if;
  delete from public.members m where m.id = v_person.id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Import payload helpers (internal). Each raises invalid_input for a value of the wrong
-- type or out of bounds.
-- ─────────────────────────────────────────────────────────────────────────────

-- A string field: null or missing is ''. Trimmed when p_trim. Longer than p_max characters
-- is invalid_input.
create or replace function public.import_text(p_value jsonb, p_max integer, p_trim boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return '';
  end if;
  if jsonb_typeof(p_value) <> 'string' then
    raise exception 'invalid_input';
  end if;
  v_text := p_value #>> '{}';
  if p_trim then
    v_text := btrim(v_text, E' \t\r\n');
  end if;
  if length(v_text) > p_max then
    raise exception 'invalid_input';
  end if;
  return v_text;
end;
$$;

-- A key that names a person, area or item inside the payload: a string of 1 to 64 characters.
create or replace function public.import_key(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or jsonb_typeof(p_value) <> 'string'
    or length(p_value #>> '{}') not between 1 and 64
  then
    raise exception 'invalid_input';
  end if;
  return p_value #>> '{}';
end;
$$;

-- An optional reference to a key in p_map ({key: uuid}): null or missing is null, an unknown
-- key is invalid_input.
create or replace function public.import_ref(p_value jsonb, p_map jsonb)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  v_key := public.import_key(p_value);
  if not (p_map ? v_key) then
    raise exception 'invalid_input';
  end if;
  return (p_map ->> v_key)::uuid;
end;
$$;

-- An optional instant (ISO 8601 with a zone): null or missing is null; later than p_now
-- becomes p_now (nothing is stamped in the future); anything unreadable is invalid_input.
create or replace function public.import_timestamp(p_value jsonb, p_now timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_text text;
  v_at timestamptz;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string' then
    raise exception 'invalid_input';
  end if;
  v_text := p_value #>> '{}';
  if v_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)$' then
    raise exception 'invalid_input';
  end if;
  begin
    v_at := v_text::timestamptz;
  exception when others then
    raise exception 'invalid_input';
  end;
  return least(v_at, p_now);
end;
$$;

-- An optional calendar date 'YYYY-MM-DD': null or missing is null; anything else is
-- invalid_input.
create or replace function public.import_date(p_value jsonb)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_text text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string' then
    raise exception 'invalid_input';
  end if;
  v_text := p_value #>> '{}';
  if v_text !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'invalid_input';
  end if;
  begin
    return v_text::date;
  exception when others then
    raise exception 'invalid_input';
  end;
end;
$$;

-- An optional value from a fixed list: null or missing is p_default; anything else that is
-- not one of p_allowed is invalid_input.
create or replace function public.import_choice(p_value jsonb, p_allowed text[], p_default text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return p_default;
  end if;
  if jsonb_typeof(p_value) <> 'string' or not ((p_value #>> '{}') = any (p_allowed)) then
    raise exception 'invalid_input';
  end if;
  return p_value #>> '{}';
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- import_household: create the home from the data this phone kept in demo mode, all or
-- nothing. Returns the household id. The payload (ImportPayload in src/lib/types.ts, built by
-- buildImportPayload() in src/lib/logic/importHome.ts):
--
--   { "version": 1,
--     "household": {"name": 1-60, "address": 0-120, "timezone": IANA (unknown: Europe/London)},
--     "people": [ 1-50, join order:
--       {"key", "name": 1-40, "emoji": 0-16 (blank: 🦔), "color": "#RRGGBB" (optional),
--        "me": true for exactly one} ],
--     "areas": [ 0-100, in order: {"key", "name": 1-60} ],
--     "items": [ 0-2000:
--       {"key", "area": area key, "kind": task|state (task), "title": 1-200, "note": 0-4000,
--        "good": 0-4000, "rag": red|amber|green (amber), "due_date": "YYYY-MM-DD"|null,
--        "repeat" (none), "notify" (day_before), "status": open|done (open),
--        "assignee": person key|null, "created_by": person key|null (me),
--        "updated_by": person key|null (me), "created_at", "updated_at",
--        "completed_at": ISO|null} ],
--     "completions": [ 0-20000:
--       {"item": item key|null, "item_title": 1-200, "credited_to": person key|null,
--        "completed_by": person key|null, "completed_at": ISO (required),
--        "prev_due_date": "YYYY-MM-DD"|null, "prev_status": open|done (open)} ] }
--
-- Keys are 1-64 character strings, unique within their list. Names, titles and the address
-- are trimmed; notes and "good" are kept as they are. Times later than now become now; an
-- item without times gets now, a done item without completed_at gets now. The person marked
-- "me" is the caller (role owner, the account's email); every other person is added as not
-- joined yet, with no email. A state is never done (invalid_input) and has no due date,
-- repeat or reminder (the kind trigger clears them). Chat, invites and push subscriptions
-- are not part of it. When the Housekeeping migration is present, the home gets its starter
-- task list, as create_household gives one.
--
-- Errors: not_signed_in; already_member (the caller is in a home); home_exists (any home
-- exists: the caller should be added to it instead); invalid_input (a payload it refuses;
-- nothing is created). Concurrent imports are serialised; the second sees home_exists or
-- already_member.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.import_household(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_payload jsonb := p_payload;
  v_household jsonb;
  v_people jsonb;
  v_areas jsonb;
  v_items jsonb;
  v_completions jsonb;
  v_person_ids jsonb;
  v_area_ids jsonb;
  v_item_ids jsonb;
  v_household_id uuid;
  v_me uuid;
  v_name text;
  v_timezone text;
  v_entry jsonb;
  v_index integer;
  v_count integer;
  v_color text;
  v_is_me boolean;
  v_kind text;
  v_status text;
  v_title text;
  v_created timestamptz;
  v_updated timestamptz;
  v_completed timestamptz;
  v_area uuid;
  v_task_title text;
  v_colors constant text[] := array['#007AFF', '#AF52DE', '#30B0C7', '#FF9500', '#34C759', '#FF2D55'];
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;

  -- One import (or claim of the first home) at a time.
  perform pg_catalog.pg_advisory_xact_lock(4712, 1);

  if exists (select 1 from public.members m where m.user_id = v_uid) then
    raise exception 'already_member';
  end if;
  if public.home_exists() then
    raise exception 'home_exists';
  end if;

  -- ── Shape ──
  if v_payload is null or jsonb_typeof(v_payload) <> 'object'
    or v_payload -> 'version' is distinct from '1'::jsonb
  then
    raise exception 'invalid_input';
  end if;
  v_household := v_payload -> 'household';
  v_people := coalesce(v_payload -> 'people', '[]'::jsonb);
  v_areas := coalesce(v_payload -> 'areas', '[]'::jsonb);
  v_items := coalesce(v_payload -> 'items', '[]'::jsonb);
  v_completions := coalesce(v_payload -> 'completions', '[]'::jsonb);
  if v_household is null or jsonb_typeof(v_household) <> 'object'
    or jsonb_typeof(v_people) <> 'array' or jsonb_array_length(v_people) not between 1 and 50
    or jsonb_typeof(v_areas) <> 'array' or jsonb_array_length(v_areas) > 100
    or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) > 2000
    or jsonb_typeof(v_completions) <> 'array' or jsonb_array_length(v_completions) > 20000
  then
    raise exception 'invalid_input';
  end if;
  if exists (select 1 from jsonb_array_elements(v_people) as e(value) where jsonb_typeof(e.value) <> 'object')
    or exists (select 1 from jsonb_array_elements(v_areas) as e(value) where jsonb_typeof(e.value) <> 'object')
    or exists (select 1 from jsonb_array_elements(v_items) as e(value) where jsonb_typeof(e.value) <> 'object')
    or exists (select 1 from jsonb_array_elements(v_completions) as e(value) where jsonb_typeof(e.value) <> 'object')
  then
    raise exception 'invalid_input';
  end if;

  -- ── Keys: unique per list; each gets a fresh id ──
  select coalesce(jsonb_object_agg(public.import_key(e.value -> 'key'), gen_random_uuid()), '{}'::jsonb), count(*)
  into v_person_ids, v_count
  from jsonb_array_elements(v_people) as e(value);
  if (select count(*) from jsonb_object_keys(v_person_ids)) <> v_count then
    raise exception 'invalid_input';
  end if;
  select coalesce(jsonb_object_agg(public.import_key(e.value -> 'key'), gen_random_uuid()), '{}'::jsonb), count(*)
  into v_area_ids, v_count
  from jsonb_array_elements(v_areas) as e(value);
  if (select count(*) from jsonb_object_keys(v_area_ids)) <> v_count then
    raise exception 'invalid_input';
  end if;
  select coalesce(jsonb_object_agg(public.import_key(e.value -> 'key'), gen_random_uuid()), '{}'::jsonb), count(*)
  into v_item_ids, v_count
  from jsonb_array_elements(v_items) as e(value);
  if (select count(*) from jsonb_object_keys(v_item_ids)) <> v_count then
    raise exception 'invalid_input';
  end if;

  -- Exactly one "me".
  if (select count(*) from jsonb_array_elements(v_people) as e(value) where e.value -> 'me' = 'true'::jsonb) <> 1
    or exists (
      select 1 from jsonb_array_elements(v_people) as e(value)
      where e.value ? 'me' and jsonb_typeof(e.value -> 'me') not in ('boolean', 'null')
    )
  then
    raise exception 'invalid_input';
  end if;

  -- ── Household ──
  v_name := public.import_text(v_household -> 'name', 60, true);
  if v_name = '' then
    raise exception 'invalid_input';
  end if;
  v_timezone := public.import_text(v_household -> 'timezone', 100, true);
  if not public.is_valid_timezone(v_timezone) then
    v_timezone := 'Europe/London';
  end if;
  insert into public.households (name, address, timezone)
  values (v_name, public.import_text(v_household -> 'address', 120, true), v_timezone)
  returning id into v_household_id;

  -- ── People, in join order (created_at a millisecond apart, all in the past) ──
  v_count := jsonb_array_length(v_people);
  for v_entry, v_index in
    select e.value, e.ord::integer from jsonb_array_elements(v_people) with ordinality as e(value, ord)
  loop
    v_name := public.import_text(v_entry -> 'name', 40, true);
    if v_name = '' then
      raise exception 'invalid_input';
    end if;
    v_color := case when jsonb_typeof(v_entry -> 'color') = 'string' then v_entry ->> 'color' else '' end;
    if v_color !~ '^#[0-9A-Fa-f]{6}$' then
      v_color := v_colors[((v_index - 1) % 6) + 1];
    end if;
    v_is_me := coalesce((v_entry -> 'me') = 'true'::jsonb, false);
    insert into public.members (id, household_id, user_id, name, email, emoji, color, role, created_at)
    values (
      (v_person_ids ->> (v_entry ->> 'key'))::uuid,
      v_household_id,
      case when v_is_me then v_uid end,
      v_name,
      case when v_is_me then coalesce(
        nullif(auth.jwt() ->> 'email', ''),
        (select u.email from auth.users u where u.id = v_uid),
        ''
      ) else '' end,
      coalesce(nullif(public.import_text(v_entry -> 'emoji', 16, true), ''), '🦔'),
      v_color,
      case when v_is_me then 'owner' else 'member' end,
      v_now - (v_count - v_index) * interval '1 millisecond'
    );
    if v_is_me then
      v_me := (v_person_ids ->> (v_entry ->> 'key'))::uuid;
    end if;
  end loop;

  -- ── Areas, in order ──
  for v_entry, v_index in
    select e.value, e.ord::integer from jsonb_array_elements(v_areas) with ordinality as e(value, ord)
  loop
    v_name := public.import_text(v_entry -> 'name', 60, true);
    if v_name = '' then
      raise exception 'invalid_input';
    end if;
    insert into public.areas (id, household_id, name, position)
    values ((v_area_ids ->> (v_entry ->> 'key'))::uuid, v_household_id, v_name, v_index - 1);
  end loop;

  -- ── Items, open and done, with their own history ──
  perform pg_catalog.set_config('homeos.importing', 'on', true);
  for v_entry in select e.value from jsonb_array_elements(v_items) as e(value)
  loop
    v_kind := public.import_choice(v_entry -> 'kind', array['task', 'state'], 'task');
    v_status := public.import_choice(v_entry -> 'status', array['open', 'done'], 'open');
    v_title := public.import_text(v_entry -> 'title', 200, true);
    if v_title = '' or (v_kind = 'state' and v_status = 'done') then
      raise exception 'invalid_input';
    end if;
    v_created := coalesce(public.import_timestamp(v_entry -> 'created_at', v_now), v_now);
    v_updated := greatest(coalesce(public.import_timestamp(v_entry -> 'updated_at', v_now), v_created), v_created);
    v_completed := case
      when v_status = 'done' then coalesce(public.import_timestamp(v_entry -> 'completed_at', v_now), v_now)
    end;
    v_area := public.import_ref(v_entry -> 'area', v_area_ids);
    if v_area is null then
      raise exception 'invalid_input';
    end if;
    insert into public.items (
      id, household_id, area_id, kind, title, note, good, rag, due_date, assignee_id, repeat,
      notify, status, created_by, updated_by, created_at, updated_at, completed_at
    )
    values (
      (v_item_ids ->> (v_entry ->> 'key'))::uuid,
      v_household_id,
      v_area,
      v_kind,
      v_title,
      public.import_text(v_entry -> 'note', 4000, false),
      public.import_text(v_entry -> 'good', 4000, false),
      public.import_choice(v_entry -> 'rag', array['red', 'amber', 'green'], 'amber'),
      public.import_date(v_entry -> 'due_date'),
      public.import_ref(v_entry -> 'assignee', v_person_ids),
      public.import_choice(
        v_entry -> 'repeat', array['none', 'weekly', 'monthly', 'quarterly', 'biannual', 'yearly'], 'none'
      ),
      public.import_choice(v_entry -> 'notify', array['none', 'same_day', 'day_before', 'week_before'], 'day_before'),
      v_status,
      coalesce(public.import_ref(v_entry -> 'created_by', v_person_ids), v_me),
      coalesce(public.import_ref(v_entry -> 'updated_by', v_person_ids), v_me),
      v_created,
      v_updated,
      v_completed
    );
  end loop;
  perform pg_catalog.set_config('homeos.importing', '', true);

  -- ── Completions (Stats history) ──
  for v_entry in select e.value from jsonb_array_elements(v_completions) as e(value)
  loop
    v_title := public.import_text(v_entry -> 'item_title', 200, true);
    v_completed := public.import_timestamp(v_entry -> 'completed_at', v_now);
    if v_title = '' or v_completed is null then
      raise exception 'invalid_input';
    end if;
    insert into public.completions (
      household_id, item_id, item_title, credited_to, completed_by, completed_at,
      prev_due_date, prev_status
    )
    values (
      v_household_id,
      public.import_ref(v_entry -> 'item', v_item_ids),
      v_title,
      public.import_ref(v_entry -> 'credited_to', v_person_ids),
      public.import_ref(v_entry -> 'completed_by', v_person_ids),
      v_completed,
      public.import_date(v_entry -> 'prev_due_date'),
      public.import_choice(v_entry -> 'prev_status', array['open', 'done'], 'open')
    );
  end loop;

  -- ── Housekeeping starter list, when that migration is present (as create_household) ──
  if pg_catalog.to_regclass('public.housekeeping_tasks') is not null
    and pg_catalog.to_regprocedure('public.housekeeping_starter_tasks()') is not null
  then
    for v_task_title in
      execute 'select t from unnest(public.housekeeping_starter_tasks()) with ordinality as s(t, ord) order by ord'
    loop
      execute 'insert into public.housekeeping_tasks (household_id, title) values ($1, $2)'
      using v_household_id, v_task_title;
    end loop;
  end if;

  return v_household_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Privileges
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function public.enter_home() from public, anon;
revoke all on function public.add_person(uuid, text, text, text) from public, anon;
revoke all on function public.set_person_email(uuid, text) from public, anon;
revoke all on function public.remove_person(uuid) from public, anon;
revoke all on function public.import_household(jsonb) from public, anon;
revoke all on function public.join_household(text, text, text) from public, anon;

grant execute on function public.enter_home() to authenticated, service_role;
grant execute on function public.add_person(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.set_person_email(uuid, text) to authenticated, service_role;
grant execute on function public.remove_person(uuid) to authenticated, service_role;
grant execute on function public.import_household(jsonb) to authenticated, service_role;
grant execute on function public.join_household(text, text, text) to authenticated, service_role;

-- Internal only (called by RPCs and triggers, which run as the owner).
revoke all on function public.members_before_write() from public, anon, authenticated;
revoke all on function public.items_before_write() from public, anon, authenticated;
revoke all on function public.verified_email(uuid) from public, anon, authenticated;
revoke all on function public.account_email(uuid) from public, anon, authenticated;
revoke all on function public.home_exists() from public, anon, authenticated;
revoke all on function public.is_valid_email(text) from public, anon, authenticated;
revoke all on function public.import_text(jsonb, integer, boolean) from public, anon, authenticated;
revoke all on function public.import_key(jsonb) from public, anon, authenticated;
revoke all on function public.import_ref(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.import_timestamp(jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.import_date(jsonb) from public, anon, authenticated;
revoke all on function public.import_choice(jsonb, text[], text) from public, anon, authenticated;
