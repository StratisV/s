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
--   One home per deployment: clients cannot add a second household (households_one_home,
--     home_exists), and claims and joins only reach the deployment's home, the oldest one.
--     Development and test databases turn on app_settings.many_homes.
--   enter_home()                      where the signed-in person belongs; claims a person
--                                     whose email is their verified Google email
--   add_person(hid, name, emoji, email)  a person who has not joined yet
--   set_person_email(member, email)   set or clear a not-yet-joined person's email
--   remove_person(member)             remove a not-yet-joined person (items become unassigned)
--   import_household(payload)         create the home from this phone's demo data, or put it
--                                     into the caller's home while that is untouched
--   join_household(...)               as before, but claims a not-yet-joined person with the
--                                     caller's verified email instead of adding a duplicate
--   invite_preview(token)             as before, plus the people waiting to join and the
--                                     emojis in use
--   join_as_person(token, member)     join through an invite as a person waiting to join
--   release_claim()                   "Not Shea?": undo a claim made in the last day
--
-- New error messages (BackendError codes): email_taken (another person in the home has that
-- email) and home_exists (a home exists already: no second one, and no import).
--
-- create_household is NOT redefined here (the Housekeeping migration owns it); the trigger on
-- households keeps it to one home. Like the earlier migrations, everything here can be
-- applied again without errors.

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

-- When an account became this person (a claim by email at sign-in, or "Are you one of these
-- people?" on an invite). Null for everyone else. release_claim() ("Not Shea?") is only
-- allowed for a day after it. Clients cannot write it (members has column UPDATE grants).
alter table public.members add column if not exists claimed_at timestamptz null;

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

-- The account's email in stored form when Google vouches for it, else ''. Only such an email
-- may claim a person. That takes a Google identity on the account (auth.identities, provider
-- 'google') whose own email is this one and that Google marked verified, as well as Supabase
-- Auth's email_confirmed_at. A confirmed email alone is not enough: a project whose Email
-- provider auto-confirms sign-ups (Supabase's "Confirm email" off, or the CLI's
-- enable_confirmations = false) would let anyone who types a waiting person's address with a
-- password become them.
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
  where u.id = p_user_id
    and u.email_confirmed_at is not null
    and coalesce(u.email, '') <> ''
    and exists (
      select 1
      from auth.identities i
      where i.user_id = u.id
        and i.provider = 'google'
        and lower(coalesce(i.identity_data ->> 'email_verified', '')) = 'true'
        and lower(btrim(coalesce(i.identity_data ->> 'email', ''), E' \t\r\n'))
          = lower(btrim(u.email, E' \t\r\n'))
    );
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

-- ─────────────────────────────────────────────────────────────────────────────
-- One home per deployment, kept by the database itself
--
-- Clients (anon, authenticated) can never add a second household: a BEFORE INSERT trigger
-- refuses it with home_exists, under the same advisory lock as import_household, so two people
-- creating (or creating and bringing a home over) at once end up with one home. The service
-- role and the database owner (SQL editor, migrations) are not limited.
--
-- Claims (enter_home, join_household, join_as_person) and joins only ever reach the
-- deployment's home, the oldest household, so a household that got in some other way (made by
-- an admin, or left from before this rule) can never capture anyone.
--
-- Development and test databases hold many homes (the tests make one per case, and a shared
-- local stack has several people's). There, someone with database access turns on
-- app_settings.many_homes: clients may then create more homes, and claims and joins reach
-- every home (the oldest home first). Clients can neither read nor change it.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.app_settings (
  -- One row at most.
  id boolean primary key default true constraint app_settings_one_row check (id),
  -- Development and test databases only. Off (or no row): one home.
  many_homes boolean not null default false
);
alter table public.app_settings enable row level security;
-- No policies: only the owner and the service role (which bypasses RLS) get through, and only
-- the service role gets to read it (the live test suites check it before they start).
revoke all on table public.app_settings from public, anon, authenticated, service_role;
grant select on table public.app_settings to service_role;

-- True when this database allows many homes (app_settings.many_homes).
create or replace function public.many_homes()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.many_homes from public.app_settings s where s.id), false)
$$;

-- The deployment's home: the oldest household (null when there is none).
create or replace function public.deployment_home()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select h.id from public.households h order by h.created_at, h.id limit 1
$$;

-- Whether claims and joins may reach household p: the deployment's home, or any home while
-- many_homes is on.
create or replace function public.reachable_home(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_household_id is not null
    and (public.many_homes() or p_household_id = public.deployment_home())
$$;

create or replace function public.households_one_home()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serialised with import_household and every other insert: the check below sees what a
  -- concurrent insert committed (each statement here reads the newest committed rows).
  perform pg_catalog.pg_advisory_xact_lock(4712, 1);
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
    and not public.many_homes()
    and public.home_exists()
  then
    raise exception 'home_exists';
  end if;
  return new;
end;
$$;

drop trigger if exists households_one_home on public.households;
create trigger households_one_home
  before insert on public.households
  for each row execute function public.households_one_home();

-- ─────────────────────────────────────────────────────────────────────────────
-- An untouched home: set up and not used since, so bringing the home over from a phone may
-- replace what is in it (import_household). Nothing anyone did would be lost:
--   the household's name, address and time zone never changed (updated_at = created_at),
--   every area and item is one it was created with, and no item was edited or done,
--   nothing was ever done (no completions) and nobody wrote in the chat,
--   and, when the Housekeeping migration is present, no visit, no message for the
--   housekeeper and only the starter task list.
-- People are not counted: they stay (import_household matches them by name).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.home_untouched(p_household_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_created timestamptz;
  v_updated timestamptz;
  v_busy boolean;
begin
  select h.created_at, h.updated_at into v_created, v_updated
  from public.households h
  where h.id = p_household_id;
  if v_created is null or v_updated is distinct from v_created then
    return false;
  end if;
  if exists (select 1 from public.areas a where a.household_id = p_household_id and a.created_at <> v_created)
    or exists (
      select 1 from public.items i
      where i.household_id = p_household_id
        and (i.created_at <> v_created or i.updated_at <> v_created or i.status <> 'open')
    )
    or exists (select 1 from public.completions c where c.household_id = p_household_id)
    or exists (select 1 from public.messages m where m.household_id = p_household_id)
  then
    return false;
  end if;
  if pg_catalog.to_regclass('public.housekeeping_visits') is not null then
    execute 'select exists (select 1 from public.housekeeping_visits v where v.household_id = $1)'
      into v_busy using p_household_id;
    if v_busy then
      return false;
    end if;
  end if;
  if pg_catalog.to_regclass('public.housekeeping_notes') is not null then
    execute 'select exists (select 1 from public.housekeeping_notes n where n.household_id = $1 and n.body <> '''')'
      into v_busy using p_household_id;
    if v_busy then
      return false;
    end if;
  end if;
  if pg_catalog.to_regclass('public.housekeeping_tasks') is not null then
    execute 'select exists (select 1 from public.housekeeping_tasks t where t.household_id = $1 and t.created_at <> $2)'
      into v_busy using p_household_id, v_created;
    if v_busy then
      return false;
    end if;
  end if;
  return true;
end;
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
--   {"status": "member",  "household_id": uuid, "member_id": uuid, "can_import": boolean}
--       already in a home: open it
--   {"status": "claimed", "household_id": uuid, "member_id": uuid, "can_import": boolean}
--       someone at home had added a person with this account's verified Google email who had
--       not joined yet: the caller is now that person (name, emoji, colour, items and Stats
--       kept)
--   {"status": "no_home"}
--       not in a home, and no home exists at all: the first person creates it (or brings it
--       over from their phone)
--   {"status": "private", "email": text, "email_verified": boolean}
--       a home exists and nobody there has this account's email: ask someone at home to add
--       it in Profile > Household > People. Nothing about the home is revealed.
-- can_import: the home is untouched (home_untouched), so the home this phone kept in demo
-- mode may still replace what is in it (import_household).
-- A claim is atomic: two sessions claiming the same person cannot both win, and an account
-- never ends up as two people (members_user_id_key). It only reaches the deployment's home
-- (reachable_home): a person with the same email in any other household is never claimed.
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
  v_many boolean := public.many_homes();
  v_home uuid := public.deployment_home();
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;

  select * into v_member from public.members m where m.user_id = v_uid;
  if v_member.id is not null then
    return json_build_object(
      'status', 'member', 'household_id', v_member.household_id, 'member_id', v_member.id,
      'can_import', public.home_untouched(v_member.household_id)
    );
  end if;

  v_email := public.verified_email(v_uid);
  if v_email <> '' then
    -- The deployment's home only (every home, oldest first, while many_homes is on), then the
    -- oldest person, so the outcome is the same every time.
    for v_target in
      select m.id
      from public.members m
      join public.households h on h.id = m.household_id
      where m.user_id is null and m.email <> '' and lower(m.email) = v_email
        and (v_many or m.household_id = v_home)
      order by h.created_at, h.id, m.created_at, m.id
    loop
      v_claimed := null;
      begin
        -- Still waiting to join, still with this email? A concurrent claim, or an email
        -- changed in People, that committed first makes this touch no row: READ COMMITTED
        -- re-checks the whole condition on the newest row version.
        update public.members m
        set user_id = v_uid, claimed_at = now()
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
        return json_build_object(
          'status', 'claimed', 'household_id', v_member.household_id, 'member_id', v_member.id,
          'can_import', public.home_untouched(v_member.household_id)
        );
      end if;
    end loop;

    -- Claimed (or joined) by this same account in a concurrent call.
    select * into v_member from public.members m where m.user_id = v_uid;
    if v_member.id is not null then
      return json_build_object(
        'status', 'member', 'household_id', v_member.household_id, 'member_id', v_member.id,
        'can_import', public.home_untouched(v_member.household_id)
      );
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
-- join_household: as in 20261008000300_rpc.sql, plus:
-- - Only the deployment's home can be joined (reachable_home): an invite to any other
--   household is invalid_invite.
-- - When the household has a person who has not joined yet with the caller's verified Google
--   email, the caller becomes that person (their name, emoji, colour and items are kept;
--   p_member_name and p_member_emoji are not applied) instead of being added a second time.
--   Otherwise a new member is added as before; if their email is already someone else's in
--   this home, they join without it.
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
  if v_invite.id is null or v_invite.expires_at <= now() or not public.reachable_home(v_invite.household_id) then
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
      set user_id = v_uid, claimed_at = now()
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

  v_email := public.account_email(v_uid);
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
-- invite_preview: as in 20261008000300_rpc.sql (null for a token that is unknown, expired, or
-- for a household other than the deployment's home), plus what the Join screen needs to
-- avoid a second copy of someone:
--   "people": the people in the home who have not joined yet and have no email, in join
--             order: [{"id", "name", "emoji"}]. "Are you one of these people?" lists them, and
--             join_as_person makes the caller one of them.
--   "emojis": every emoji in use in the home, so a newcomer starts on one nobody has.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.invite_preview(p_token text)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'household_name', h.name,
    'address', h.address,
    'people', coalesce((
      select json_agg(json_build_object('id', m.id, 'name', m.name, 'emoji', m.emoji) order by m.created_at, m.id)
      from public.members m
      where m.household_id = h.id and m.user_id is null and m.email = ''
    ), '[]'::json),
    'emojis', coalesce((
      select json_agg(m.emoji order by m.created_at, m.id)
      from public.members m
      where m.household_id = h.id
    ), '[]'::json)
  )
  from public.invites i
  join public.households h on h.id = i.household_id
  where i.token = btrim(p_token, E' \t\r\n')
    and i.expires_at > now()
    and public.reachable_home(h.id)
  limit 1
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- join_as_person: join through an invite as one of the people the home is waiting for ("Are
-- you one of these people?" on the Join screen). Returns the household id.
-- The person must be in the invite's household, not joined yet, and have no email (or the
-- caller's verified Google email): someone with another email is kept for that account.
-- They keep their name, emoji, colour, items and Stats; their email becomes the caller's
-- (unless someone else in the home has it).
-- Errors as join_household (not_signed_in, invalid_invite, already_member), and not_found
-- when that person cannot be taken (gone, joined meanwhile, or kept for another email).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.join_as_person(p_token text, p_member_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_invite public.invites%rowtype;
  v_current uuid;
  v_email text;
  v_verified text;
  v_claimed uuid;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;

  select * into v_invite from public.invites i where i.token = btrim(p_token, E' \t\r\n');
  select m.household_id into v_current from public.members m where m.user_id = v_uid;

  if v_current is not null and v_current = v_invite.household_id then
    return v_current;
  end if;
  if v_invite.id is null or v_invite.expires_at <= now() or not public.reachable_home(v_invite.household_id) then
    raise exception 'invalid_invite';
  end if;
  if v_current is not null then
    raise exception 'already_member';
  end if;

  -- The same lock as joins and new people: an email is checked and taken in one step.
  perform 1 from public.households h where h.id = v_invite.household_id for update;

  v_verified := public.verified_email(v_uid);
  v_email := public.account_email(v_uid);
  if v_email <> '' and exists (
    select 1 from public.members m
    where m.household_id = v_invite.household_id and m.id <> p_member_id and lower(m.email) = v_email
  ) then
    v_email := '';
  end if;

  begin
    update public.members m
    set user_id = v_uid, email = v_email, claimed_at = now()
    where m.id = p_member_id
      and m.household_id = v_invite.household_id
      and m.user_id is null
      and (m.email = '' or (v_verified <> '' and lower(m.email) = v_verified))
    returning m.id into v_claimed;
  exception when unique_violation then
    raise exception 'already_member';
  end;
  if v_claimed is null then
    raise exception 'not_found';
  end if;
  return v_invite.household_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- release_claim: "Not Shea?" on the welcome step after a claim. Within a day of the claim, the
-- caller stops being that person: the row goes back to "Not joined yet", without the email
-- (it matched the wrong account, so someone at home has to put in the right one), and this
-- account's push subscriptions for it are removed. The caller is then in no home.
-- not_found when the caller has no claim from the last day.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.release_claim()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.members%rowtype;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  select * into v_member from public.members m where m.user_id = v_uid for update;
  if v_member.id is null or v_member.claimed_at is null or v_member.claimed_at < now() - interval '1 day' then
    raise exception 'not_found';
  end if;
  delete from public.push_subs s where s.member_id = v_member.id;
  update public.members m
  set user_id = null, email = '', claimed_at = null
  where m.id = v_member.id;
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
-- import_household: create the home from the data this phone kept in demo mode, or put it
-- into the caller's home while that home is untouched (home_untouched), all or nothing.
-- Returns the household id. The payload (ImportPayload in src/lib/types.ts, built by
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
-- item without times gets now, a done item without completed_at gets now. A state is never
-- done (invalid_input) and has no due date, repeat or reminder (the kind trigger clears
-- them). Chat, invites and push subscriptions are not part of it.
--
-- Two ways in:
-- - No home exists (and the caller is in none): a new home. The person marked "me" is the
--   caller (role owner, the account's email); every other person is added as not joined
--   yet, with no email. When the Housekeeping migration is present, the home gets its starter
--   task list, as create_household gives one.
-- - The caller is in a home that is untouched (set up and not used since: someone created it
--   on another device first, say): the phone's home replaces what is in it, in place (same
--   household id, so its invites and every device showing it carry on). Its name, address and
--   time zone become the phone's; its areas, items and completions go and the phone's come in.
--   Its people stay: "me" is the caller, as they are; each other person from the phone is the
--   person of the same name already there (trimmed, any case, each at most once), else is
--   added as not joined yet.
--
-- Errors: not_signed_in; already_member (the caller is in a home that is in use);
-- home_exists (a home exists and the caller is not in it: they should be added to it
-- instead); invalid_input (a payload it refuses; nothing changes). Imports are serialised
-- with each other and with every new household (households_one_home); the second of two at
-- once sees home_exists or already_member.
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
  v_emoji text;
  v_replace uuid;
  v_match uuid;
  v_matched jsonb := '{}'::jsonb;
  v_colors constant text[] := array['#007AFF', '#AF52DE', '#30B0C7', '#FF9500', '#34C759', '#FF2D55'];
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;

  -- One import (or new household) at a time.
  perform pg_catalog.pg_advisory_xact_lock(4712, 1);

  select m.household_id, m.id into v_replace, v_me from public.members m where m.user_id = v_uid;
  if v_replace is not null then
    if not public.home_untouched(v_replace) then
      raise exception 'already_member';
    end if;
  elsif public.home_exists() then
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
  if v_replace is null then
    insert into public.households (name, address, timezone)
    values (v_name, public.import_text(v_household -> 'address', 120, true), v_timezone)
    returning id into v_household_id;
  else
    -- In place. The update locks the household row (joins, new people and email changes wait
    -- for this); its areas take their items with them.
    v_household_id := v_replace;
    update public.households h
    set name = v_name, address = public.import_text(v_household -> 'address', 120, true), timezone = v_timezone
    where h.id = v_household_id;
    delete from public.completions c where c.household_id = v_household_id;
    delete from public.areas a where a.household_id = v_household_id;
    delete from public.items i where i.household_id = v_household_id;
  end if;

  -- ── People, in join order (created_at a millisecond apart, all in the past) ──
  v_count := jsonb_array_length(v_people);
  for v_entry, v_index in
    select e.value, e.ord::integer from jsonb_array_elements(v_people) with ordinality as e(value, ord)
  loop
    v_name := public.import_text(v_entry -> 'name', 40, true);
    if v_name = '' then
      raise exception 'invalid_input';
    end if;
    v_emoji := coalesce(nullif(public.import_text(v_entry -> 'emoji', 16, true), ''), '🦔');
    v_color := case when jsonb_typeof(v_entry -> 'color') = 'string' then v_entry ->> 'color' else '' end;
    if v_color !~ '^#[0-9A-Fa-f]{6}$' then
      v_color := v_colors[((v_index - 1) % 6) + 1];
    end if;
    v_is_me := coalesce((v_entry -> 'me') = 'true'::jsonb, false);
    if v_replace is not null then
      if v_is_me then
        -- The caller, as they are in this home.
        v_person_ids := v_person_ids || jsonb_build_object(v_entry ->> 'key', v_me);
        continue;
      end if;
      -- Someone already in this home with the same name is this person.
      select m.id into v_match
      from public.members m
      where m.household_id = v_household_id
        and m.id <> v_me
        and lower(btrim(m.name)) = lower(v_name)
        and not (v_matched ? m.id::text)
      order by m.created_at, m.id
      limit 1;
      if v_match is not null then
        v_matched := v_matched || jsonb_build_object(v_match::text, true);
        v_person_ids := v_person_ids || jsonb_build_object(v_entry ->> 'key', v_match);
        continue;
      end if;
    end if;
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
      v_emoji,
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
  -- (A home it replaced keeps the list it has.)
  if v_replace is null
    and pg_catalog.to_regclass('public.housekeeping_tasks') is not null
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
revoke all on function public.invite_preview(text) from public, anon;
revoke all on function public.join_as_person(text, uuid) from public, anon;
revoke all on function public.release_claim() from public, anon;

grant execute on function public.enter_home() to authenticated, service_role;
grant execute on function public.add_person(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.set_person_email(uuid, text) to authenticated, service_role;
grant execute on function public.remove_person(uuid) to authenticated, service_role;
grant execute on function public.import_household(jsonb) to authenticated, service_role;
grant execute on function public.join_household(text, text, text) to authenticated, service_role;
grant execute on function public.invite_preview(text) to authenticated, service_role;
grant execute on function public.join_as_person(text, uuid) to authenticated, service_role;
grant execute on function public.release_claim() to authenticated, service_role;

-- Internal only (called by RPCs and triggers, which run as the owner).
revoke all on function public.members_before_write() from public, anon, authenticated;
revoke all on function public.items_before_write() from public, anon, authenticated;
revoke all on function public.verified_email(uuid) from public, anon, authenticated;
revoke all on function public.account_email(uuid) from public, anon, authenticated;
revoke all on function public.home_exists() from public, anon, authenticated;
revoke all on function public.many_homes() from public, anon, authenticated;
revoke all on function public.deployment_home() from public, anon, authenticated;
revoke all on function public.reachable_home(uuid) from public, anon, authenticated;
revoke all on function public.households_one_home() from public, anon, authenticated;
revoke all on function public.home_untouched(uuid) from public, anon, authenticated;
revoke all on function public.is_valid_email(text) from public, anon, authenticated;
revoke all on function public.import_text(jsonb, integer, boolean) from public, anon, authenticated;
revoke all on function public.import_key(jsonb) from public, anon, authenticated;
revoke all on function public.import_ref(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.import_timestamp(jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.import_date(jsonb) from public, anon, authenticated;
revoke all on function public.import_choice(jsonb, text[], text) from public, anon, authenticated;
