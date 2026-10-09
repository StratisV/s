-- home.os row level security and privileges.
--
-- Every member may read and edit everything in their household; outsiders see nothing.
-- Table privileges decide WHAT a signed-in user may do (for example only some member
-- columns are updatable), policies decide WHERE (only their own household).
--
-- anon gets nothing. Supabase grants anon and authenticated everything on new tables and
-- functions in public by default, so all of it is revoked first and granted back
-- explicitly. service_role (used by the scheduler Edge Function) keeps full access and
-- bypasses RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- Enable RLS everywhere
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.areas enable row level security;
alter table public.items enable row level security;
alter table public.completions enable row level security;
alter table public.invites enable row level security;
alter table public.push_subs enable row level security;
alter table public.notifications_log enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table privileges
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on table
  public.households, public.members, public.areas, public.items, public.completions,
  public.invites, public.push_subs, public.notifications_log
from public, anon, authenticated;

grant all on table
  public.households, public.members, public.areas, public.items, public.completions,
  public.invites, public.push_subs, public.notifications_log
to service_role;

-- households: created by create_household(), never deleted by clients.
grant select on public.households to authenticated;
grant update (name, address, timezone, weekly_email_day, weekly_email_time)
  on public.households to authenticated;

-- members: created by create_household() / join_household(). Anyone in the household may
-- edit anyone's profile fields, but not who belongs where or their role.
grant select on public.members to authenticated;
grant update (name, emoji, color, weekly_email, push_enabled)
  on public.members to authenticated;

-- areas and items: full CRUD inside the household.
grant select, insert, update, delete on public.areas to authenticated;
grant select, insert, update, delete on public.items to authenticated;

-- completions: written by complete_item(); read for Stats; deleted by undo or by hand.
grant select, delete on public.completions to authenticated;

-- invites: written by create_invite().
grant select on public.invites to authenticated;

-- push_subs: each user manages their own browser subscriptions.
grant select, insert, update, delete on public.push_subs to authenticated;

-- notifications_log: no client access at all (service role only).

-- ─────────────────────────────────────────────────────────────────────────────
-- Function privileges for the helpers and triggers in the schema migration
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function public.current_member_id() from public, anon;
revoke all on function public.is_household_member(uuid) from public, anon;
grant execute on function public.current_member_id() to authenticated, service_role;
grant execute on function public.is_household_member(uuid) to authenticated, service_role;

-- Internal only (called by triggers and RPCs, which run as the owner).
revoke all on function public.is_valid_timezone(text) from public, anon, authenticated;
revoke all on function public.next_due_date(text, date, date) from public, anon, authenticated;
revoke all on function public.households_before_write() from public, anon, authenticated;
revoke all on function public.items_before_write() from public, anon, authenticated;
revoke all on function public.push_subs_before_insert() from public, anon, authenticated;
grant execute on function public.is_valid_timezone(text) to service_role;
grant execute on function public.next_due_date(text, date, date) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Policies
-- ─────────────────────────────────────────────────────────────────────────────

-- households
drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select to authenticated
  using (public.is_household_member(id));

drop policy if exists households_update on public.households;
create policy households_update on public.households
  for update to authenticated
  using (public.is_household_member(id))
  with check (public.is_household_member(id));

-- members
drop policy if exists members_select on public.members;
create policy members_select on public.members
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists members_update on public.members;
create policy members_update on public.members
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- areas
drop policy if exists areas_select on public.areas;
create policy areas_select on public.areas
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists areas_insert on public.areas;
create policy areas_insert on public.areas
  for insert to authenticated
  with check (public.is_household_member(household_id));

drop policy if exists areas_update on public.areas;
create policy areas_update on public.areas
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists areas_delete on public.areas;
create policy areas_delete on public.areas
  for delete to authenticated
  using (public.is_household_member(household_id));

-- items (household_id is rewritten from the area by a trigger before these checks run)
drop policy if exists items_select on public.items;
create policy items_select on public.items
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists items_insert on public.items;
create policy items_insert on public.items
  for insert to authenticated
  with check (public.is_household_member(household_id));

drop policy if exists items_update on public.items;
create policy items_update on public.items
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists items_delete on public.items;
create policy items_delete on public.items
  for delete to authenticated
  using (public.is_household_member(household_id));

-- completions
drop policy if exists completions_select on public.completions;
create policy completions_select on public.completions
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists completions_delete on public.completions;
create policy completions_delete on public.completions
  for delete to authenticated
  using (public.is_household_member(household_id));

-- invites
drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites
  for select to authenticated
  using (public.is_household_member(household_id));

-- push_subs: private to the user; new rows must point at the caller's own member row.
drop policy if exists push_subs_select on public.push_subs;
create policy push_subs_select on public.push_subs
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists push_subs_insert on public.push_subs;
create policy push_subs_insert on public.push_subs
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and member_id = (select public.current_member_id())
  );

drop policy if exists push_subs_update on public.push_subs;
create policy push_subs_update on public.push_subs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and member_id = (select public.current_member_id())
  );

drop policy if exists push_subs_delete on public.push_subs;
create policy push_subs_delete on public.push_subs
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- notifications_log: RLS on, no policies.
