-- home.os chat: one group chat per household, with emoji reactions.
--
-- The contract lives in docs/ARCHITECTURE.md ("Chat (household group chat)"). Every member
-- reads and posts; messages are kept forever (nothing here or in the scheduler ever deletes
-- them by age). Anyone in the household can react to any message, with several different
-- emoji, once each. Members delete only their own messages and their own reactions, and
-- nothing can be edited. Outsiders and anon see and change nothing.
--
-- Like the earlier migrations, everything here can be applied again without errors
-- (if not exists, create or replace, drop/create for triggers and policies).
--
-- Limits (src/lib/constants.ts TEXT_LIMITS.chatMessage): messages.body is trimmed and 1 to
-- 4000 characters, message_reactions.emoji 1 to 16 characters. A violation raises
-- check_violation (SQLSTATE 23514) naming the constraint.

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- The sender, set by messages_before_insert(). Null once their member row is gone
  -- (a former member): the message stays.
  member_id uuid null references public.members (id) on delete set null,
  -- Trimmed by messages_before_insert().
  body text not null,
  created_at timestamptz not null default now(),
  constraint messages_body_length check (length(body) between 1 and 4000)
);

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  -- The reacting member, set by message_reactions_before_insert().
  member_id uuid not null references public.members (id) on delete cascade,
  -- Copied from the message by message_reactions_before_insert(), so RLS checks the real
  -- household.
  household_id uuid not null references public.households (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  -- Several different emoji per member and message, each once.
  primary key (message_id, member_id, emoji),
  constraint message_reactions_emoji_length check (length(emoji) between 1 and 16)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes (paging backwards through a household's chat, plus foreign keys used by RLS and
-- cascades; the primary key covers reactions by message)
-- ─────────────────────────────────────────────────────────────────────────────

create index if not exists messages_household_created_idx on public.messages (household_id, created_at desc);
create index if not exists messages_member_id_idx on public.messages (member_id);
create index if not exists message_reactions_household_id_idx on public.message_reactions (household_id);
create index if not exists message_reactions_member_id_idx on public.message_reactions (member_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Triggers
-- ─────────────────────────────────────────────────────────────────────────────

-- messages: the sender is always the signed-in caller (a service role insert keeps what it
-- was given), and the body is trimmed of the same whitespace as JavaScript's trim(): tab,
-- line feed, vertical tab, form feed, carriage return, space, no-break space, the other
-- Unicode space separators, the line and paragraph separators and the byte order mark. A
-- body of only whitespace becomes '' and fails messages_body_length.
create or replace function public.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.member_id := coalesce(public.current_member_id(), new.member_id);
  new.body := btrim(
    new.body,
    U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
  );
  return new;
end;
$$;

drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert
  before insert on public.messages
  for each row execute function public.messages_before_insert();

-- message_reactions: the reacting member is always the signed-in caller (a service role
-- insert keeps what it was given) and household_id always comes from the message, so RLS
-- checks the household the message really belongs to. A missing message raises not_found.
create or replace function public.message_reactions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
begin
  new.member_id := coalesce(public.current_member_id(), new.member_id);
  select m.household_id into v_household_id from public.messages m where m.id = new.message_id;
  if v_household_id is null then
    raise exception 'not_found';
  end if;
  new.household_id := v_household_id;
  return new;
end;
$$;

drop trigger if exists message_reactions_before_insert on public.message_reactions;
create trigger message_reactions_before_insert
  before insert on public.message_reactions
  for each row execute function public.message_reactions_before_insert();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row level security and privileges
--
-- Table privileges decide WHAT a signed-in user may do (insert only the listed columns, no
-- update at all), policies decide WHERE (only their own household, deletes only their own
-- rows). Supabase grants anon and authenticated everything on new tables and functions in
-- public by default, so all of it is revoked first and granted back explicitly.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;

revoke all on table public.messages, public.message_reactions from public, anon, authenticated;
grant all on table public.messages, public.message_reactions to service_role;

-- messages: read, post (the sender and the time are set by the database), delete own.
grant select, delete on public.messages to authenticated;
grant insert (household_id, body) on public.messages to authenticated;

-- message_reactions: read, react (member and household are set by the database), un-react.
grant select, delete on public.message_reactions to authenticated;
grant insert (message_id, emoji) on public.message_reactions to authenticated;

-- Trigger functions are internal only.
revoke all on function public.messages_before_insert() from public, anon, authenticated;
revoke all on function public.message_reactions_before_insert() from public, anon, authenticated;

-- messages
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    public.is_household_member(household_id)
    and member_id = (select public.current_member_id())
  );

drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete to authenticated
  using (member_id = (select public.current_member_id()));

-- message_reactions (household_id is copied from the message by a trigger before these
-- checks run)
drop policy if exists message_reactions_select on public.message_reactions;
create policy message_reactions_select on public.message_reactions
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists message_reactions_insert on public.message_reactions;
create policy message_reactions_insert on public.message_reactions
  for insert to authenticated
  with check (
    public.is_household_member(household_id)
    and member_id = (select public.current_member_id())
  );

drop policy if exists message_reactions_delete on public.message_reactions;
create policy message_reactions_delete on public.message_reactions
  for delete to authenticated
  using (member_id = (select public.current_member_id()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime
--
-- Both tables join the supabase_realtime publication only when it exists, so this file
-- also runs on plain Postgres (the database tests). Realtime applies RLS, so members only
-- receive their own household's rows. A DELETE carries the primary key (a message id, or
-- the message id of a reaction), which is all the client needs; logging the whole old row
-- lets realtime filter deletes by household_id, like the other published tables.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach v_table in array array['messages', 'message_reactions']
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

alter table public.messages replica identity full;
alter table public.message_reactions replica identity full;
