# home.os architecture

home.os is an installable web app (PWA) built with Vite, React and TypeScript on
top of Supabase. The design spec is `design/README.md` (Turn 3, option 3a in
`design/HomeOS Directions.dc.html`; reference renders in `design/reference/`).

## Product rules that shape the code

- Sign in with **Google** only. **One home** per deployment (see "One home"), kept by the
  database: after sign-in the server says where the person belongs. Someone already in the home
  goes straight in; someone a housemate added with their Google email (Profile > Household >
  People) becomes that person; the very first person creates the home (with a **profile**: name
  from Google, editable, plus an emoji), or brings it over from their phone's demo data; anyone
  else sees "This home is private". Nobody can make a second home. Invite links still work.
- **Every member can edit everything** in their household: household name,
  address and time zone, areas, items, completions (undo), and every member's
  profile. There are no owner-only permissions. The `owner` role only decides
  who gets the "missed" push alert (README "Push").
- One household per user (`members.user_id` is unique), and one home per deployment.
- **People before they join** ("Not joined yet", see that section): anyone can add a person
  by name, emoji and Google email. They can be assigned items and are credited in Stats like
  anyone else, and get no pushes or emails until they sign in and become that person.
- **Sync**: every change shows on every other device of the home without a reload (see
  "Sync guarantees").
- Two kinds of item (see "Item kinds" below): **To do** (`task`, the default: a job with a due
  date, repeat and reminder that Mark as Done completes) and **To maintain** (`state`: a thing
  whose condition is kept track of, like the firepit; never done, always on the list, with a
  free-text **What good looks like**).
- Radical simplicity: no filters, counters, dashboards or settings beyond the spec. The one
  exception the household asked for: each area header shows how many of its items are red,
  amber and green (see "Home" below).
- **Housekeeping** (see "Housekeeping" below): a tab for the weekly visit by the housekeeper,
  who is a household member like everyone else (no roles). A message for the housekeeper,
  today's checklist from the household's task list, comments and the price for the day, and a
  calendar of every visit.

## Layout

```
src/
  main.tsx                 boot: pick backend, providers, service worker
  App.tsx                  phase routing (loading/onboarding/main), tabs, sheet push-back
  state/HomeProvider.tsx   app state + actions (optimistic), toast, today in household tz
  lib/types.ts             domain types (match SQL columns)
  lib/constants.ts         emoji set, colours, labels, default areas, seed items
  lib/logic/*.ts           pure logic: dates, items (missed, sort, repeat, kinds), stats (donut),
                           chat (order, merge, runs, separators, reactions, unread, keyboard),
                           sun (London sun position), sky (time-of-day sky colours),
                           housekeeping (month grid, totals, GBP prices, checklist, optimistic edits),
                           people (joined or not, email rules), importHome (the demo home this
                           phone kept, as the import_household payload; fixture importHome.fixture.ts),
                           share (the text and link an item or area is shared with)
  lib/sharedLink.ts        ?item= / ?area= links: taken from the address at startup, kept until used
  lib/shareSheet.ts        navigator.share, or the clipboard (lib/clipboard.ts) where there is none
  lib/backend/types.ts     Backend interface (the contract both backends implement)
  lib/backend/supabase.ts  production backend (supabase-js)
  lib/backend/demo.ts      localStorage backend (no env vars, e2e tests)
  lib/push.ts              Web Push subscribe/unsubscribe + iOS install detection
  lib/sw-register.ts       service worker registration
  ui/                      shared primitives: Screen (+ ScreenHeader), Hero, StatusSky, Sheet, ActionSheet, Toggle,
                           Avatar, Toast, Confetti, HomeScene (Join), icons, useReorder (drag and arrow-key
                           reordering for the areas and the housekeeping task list)
  ui/animals.ts            the drawn green duck and brown hedgehog (SVG) for HomeScene and Confetti
  lib/preview.ts           `?frame` simulates the 54px status bar inset for screenshots
  screens/home/            Home screen (collapsible areas with status counts and an add button),
                           item rows, tab switch (TabBar) and the floating + (AddButton)
  screens/chat/            Household group chat with emoji reactions
  screens/housekeeping/    Housekeeping tab: message, today's checklist, comments, price, calendar,
                           task list sheet
  state/ChatProvider.tsx   chat state: pages, realtime merge, optimistic send/react, unread dot
  screens/item/            Item sheet (edit / new)
  screens/share/           useShare (share or copy, with its toasts), useSharedLink (opens a link)
  screens/stats/           Stats screen + donut
  screens/profile/         Profile (full-screen cover) + Household editor (pushed inside Profile, with
                           People: each member's name and emoji on a page pushed on top, Add Person,
                           and for someone not joined yet their Google email and Remove)
  screens/onboarding/      Welcome, create profile, household create/join, notifications step, and the
                           one-home steps: This home is private, Bring over the home, Welcome home
  screens/testing/         test support only: MockHome, a stand-in for HomeProvider in unit tests
public/                    manifest, service worker (sw.js), icons, favicon.ico (npm run icons)
supabase/migrations/       schema, RLS, RPCs
supabase/functions/        Edge Functions (scheduler: push reminders, missed alerts, weekly email)
supabase/tests/            database tests (run against a local Postgres 16)
e2e/                       Playwright tests (demo mode)
e2e-live/                  Playwright tests on a local Supabase stack: two phones, one home
```

## Styling conventions

- CSS Modules (`X.module.css`) next to each component; tokens in `src/styles/tokens.css`.
  `--tint-text` (#0058b9) is the tint for small text on tinted fills or glass, where `--tint`
  falls below 4.5:1 (selected reaction chips, the chat's "New messages" pill).
- Sizes from the README are CSS px at the 402×874 reference. The OS draws the status bar:
  layouts use `var(--top-inset)` (= `env(safe-area-inset-top)`) instead of a fixed 54px.
- The app draws under the status bar (`apple-mobile-web-app-status-bar-style` is
  `black-translucent`, so the hero reaches the top of the screen) and the status bar text is
  always white. `StatusSky` keeps it readable: a fixed strip, `--top-inset` tall, in the colour
  of the top of the hero's sky, shown wherever no hero is under the status bar (a tab scrolled
  past its hero, Profile, the setup steps). Screens with a hero at the top say so with
  `useHeroAtTop()` (`data-hero-top` on `<html>`); App sets `data-cover` while Profile is open
  and `data-sheet` while a sheet is up (the screen behind goes black). The strip's colour is
  also written to `<meta name="theme-color">`.
- Icons are inline SVG from `src/ui/icons.tsx` (SF Symbols stand-ins).
- Respect `prefers-reduced-motion`.

## Database (Supabase Postgres, schema `public`)

All ids are `uuid default gen_random_uuid()`. Timestamps are `timestamptz default now()`.

| table | columns |
| --- | --- |
| `households` | id, name text not null, address text not null default '', timezone text not null default 'Europe/London', weekly_email_day smallint not null default 1 (0=Sun…6=Sat), weekly_email_time time not null default '08:00', created_at, updated_at, updated_by uuid null |
| `members` | id, household_id → households on delete cascade, user_id uuid **null** **unique** → auth.users on delete cascade (null: "Not joined yet", see "People before they join"), name text not null, email text not null default '' (stored trimmed and lower case, <= 254, unique per household among non-blank emails), emoji text not null default '🦔', color text not null, role text not null default 'member' check (owner, member), weekly_email bool not null default true, push_enabled bool not null default false (always false while user_id is null), created_at, claimed_at timestamptz null (when an account became this person by a claim; "Not Shea?" is allowed for a day) |
| `app_settings` | id boolean primary key default true check (id) (one row at most), many_homes boolean not null default false (development and test databases only, see "One home") |
| `areas` | id, household_id → households on delete cascade, name text not null, position int not null default 0, created_at |
| `items` | id, household_id → households on delete cascade, area_id → areas on delete cascade, kind text not null default 'task' check (task, state), title text not null (non-blank), note text not null default '', good text not null default '' ("What good looks like", see "Item kinds"), rag text not null default 'amber' check (red, amber, green), due_date date null, assignee_id → members on delete set null, repeat text not null default 'none' check (none, weekly, monthly, quarterly, biannual, yearly), notify text not null default 'day_before' check (none, same_day, day_before, week_before), status text not null default 'open' check (open, done), created_by → members on delete set null, updated_by → members on delete set null, created_at, updated_at, completed_at timestamptz null |
| `completions` | id, household_id → households on delete cascade, item_id → items **on delete set null**, item_title text not null, credited_to → members on delete set null, completed_by → members on delete set null, completed_at, prev_due_date date null, prev_status text not null |
| `invites` | id, household_id → households on delete cascade, token text not null unique, created_by → members on delete set null, created_at, expires_at timestamptz not null default now() + 14 days |
| `push_subs` | id, member_id → members on delete cascade, user_id uuid not null default auth.uid(), endpoint text not null unique, p256dh text not null, auth text not null, user_agent text, created_at |
| `notifications_log` | id, household_id → households on delete cascade, item_id → items on delete cascade (null for weekly), member_id → members on delete cascade, kind text check (reminder, missed, weekly), ref_date date not null, sent_at; **unique nulls not distinct (kind, member_id, item_id, ref_date)** |

Triggers:
- `items` BEFORE INSERT/UPDATE: set `household_id` from the area (so RLS checks the real
  household), reject an `assignee_id` from another household, set `updated_at = now()` and
  `updated_by = current_member_id()` (and `created_by` on insert when null). On UPDATE
  `created_by` and `created_at` keep their values; only the on-delete-set-null cascade from
  `members` may clear `created_by`.
- `items` BEFORE INSERT/UPDATE (`items_kind_rules`, after the one above): when
  `kind = 'state'`, `due_date := null`, `repeat := 'none'`, `notify := 'none'`, whatever the
  client sends (so a task that becomes a state loses them; a state that becomes a task takes
  whatever the update gives it).
- `households` BEFORE UPDATE: `updated_at`, `updated_by`.

Helper functions (`security definer`, `stable`, `set search_path = ''`):
- `public.current_member_id() returns uuid`: the caller's member id (or null).
- `public.is_household_member(hid uuid) returns boolean`.

### Row Level Security (every table has RLS enabled)

- `households`: SELECT, UPDATE where `is_household_member(id)`. No INSERT/DELETE (RPC only).
  Column grants for UPDATE: name, address, timezone, weekly_email_day, weekly_email_time.
- `members`: SELECT, UPDATE where `is_household_member(household_id)`. Column grants for
  UPDATE: name, emoji, color, weekly_email, push_enabled (so `email` and `user_id` change only
  through the RPCs). INSERT via RPC only (create_household, join_household, add_person,
  import_household). DELETE via `remove_person` only (people who have not joined).
- `is_household_member()` and `current_member_id()` compare `user_id = auth.uid()`, which is
  never true for a null `user_id`: a person who has not joined grants nobody anything.
- `areas`, `items`: SELECT, INSERT, UPDATE, DELETE where `is_household_member(household_id)`.
- `completions`: SELECT, DELETE where member. INSERT via `complete_item` only.
- `invites`: SELECT where member. INSERT via `create_invite` only.
- `push_subs`: all operations where `user_id = auth.uid()` (and on insert the member_id must
  be the caller's member).
- `notifications_log`: no policies (service role only).
- `app_settings`: no policies, no grants to clients (the service role may read it).

`anon` gets nothing. `authenticated` gets table privileges limited as above.

### RPCs (`security definer`, `set search_path = ''`, `grant execute … to authenticated`)

Errors are raised with these exact messages so clients can map them:
`not_signed_in`, `already_member`, `invalid_invite`, `not_found`, `invalid_input`, and since
`20261010000500_one_home.sql` `email_taken` and `home_exists` (BackendError codes of the
same names).

1. `create_household(p_name text, p_address text, p_timezone text, p_member_name text,
   p_member_emoji text, p_areas text[], p_items jsonb default '[]'::jsonb) returns uuid`
   Creates the household (an unknown time zone falls back to 'Europe/London'), the caller's
   member row (role owner, colour `#007AFF`, email from `auth.jwt() ->> 'email'`), the areas in
   the given order (blank names skipped, positions 0…n-1), and the items in `p_items`:
   `[{area, kind ('task' default | 'state'), title, note, good ('' default), rag, due_in_days
   (int|null), repeat, notify}]` (a state is stored without a due date, repeat or reminder),
   matched to areas by name case-insensitively (unknown area skipped), due date = today in the
   household time zone + `due_in_days`, unassigned. Raises `already_member` if the caller has a
   member row.
2. `invite_preview(p_token text) returns json` → `{"household_name": …, "address": …}` for a
   valid unexpired token, else null. Callable by any signed-in user.
3. `join_household(p_token text, p_member_name text, p_member_emoji text) returns uuid`
   Valid unexpired token → inserts the member (role member, colour = MEMBER_COLORS[member
   count mod 6] where MEMBER_COLORS = `#007AFF, #AF52DE, #30B0C7, #FF9500, #34C759, #FF2D55`).
   Already a member of that household → returns its id. Member elsewhere → `already_member`.
   Invites are reusable until they expire.
4. `create_invite() returns text` → a fresh token (32 hex chars from `gen_random_uuid()`),
   expires in 14 days.
5. `complete_item(p_item_id uuid) returns uuid` (completion id). Caller must be a member of
   the item's household; item must be open (`not_found` otherwise); a state raises
   `invalid_input` and nothing is logged (it is never done). Inserts a completion with
   `credited_to = coalesce(assignee_id, caller)`, `completed_by = caller`, `item_title`,
   `prev_due_date`, `prev_status`. If `repeat <> 'none'`: keep open and move `due_date` one
   interval forward from the old due date (null due date: from today); if that is still before
   today (household time zone), one interval from today instead. Monthly-type intervals clamp to
   month end (31 Jan + 1 month = 28/29 Feb). Otherwise `status = 'done'`, `completed_at = now()`.
6. `undo_completion(p_completion_id uuid) returns void`. Member of its household → restore the
   item's `status`/`due_date` from `prev_*` (clear `completed_at`) and delete the completion.
7. `reorder_areas(p_household_id uuid, p_area_ids uuid[]) returns void`. Sets
   `position = index` for each id that belongs to the household.
8. `enter_home() returns json`: where the signed-in person belongs, claiming a person who has
   not joined yet by Google-verified email, and whether the home is untouched (see "One home").
9. `add_person(p_household_id uuid, p_name text, p_emoji text, p_email text) returns uuid`,
   `set_person_email(p_member_id uuid, p_email text) returns void`,
   `remove_person(p_member_id uuid) returns void` (see "People before they join").
10. `import_household(p_payload jsonb) returns uuid` (see "Bring over the home from this
    phone").
11. `join_as_person(p_token text, p_member_id uuid) returns uuid`: join through an invite as a
    person the home is waiting for (no email, or the caller's verified one); they keep their
    name, emoji, colour and items, and their email becomes the caller's unless someone in the
    home has it. Errors as `join_household`, and `not_found` when they cannot be taken.
12. `release_claim() returns void`: "Not Shea?" (see "One home").

`invite_preview` (2) also returns, since `20261010000500_one_home.sql`, `"people"` (the people
waiting to join without an email: id, name, emoji, in join order) and `"emojis"` (every emoji in
use in the home), and is null for a household other than the deployment's home.

`join_household` (3) also claims, since `20261010000500_one_home.sql`: a person in that
household who has not joined yet and has the caller's verified email becomes the caller
(their name, emoji and colour are kept; `p_member_name` and `p_member_emoji` are not applied)
instead of a second row being added. An unverified caller whose email someone in the home
already has joins as someone new, without the email. Only the deployment's home can be joined
(`invalid_invite` otherwise).

`create_household` (1) is refused with `home_exists` when a home exists (the
`households_one_home` trigger, see "One home"), unless the database allows many homes.

Realtime: add `households, members, areas, items, completions` to the `supabase_realtime`
publication (guarded so the migration also runs on plain Postgres).

Details beyond the list above (all covered by `supabase/tests`):
- `invalid_input`: a blank household or member name, an unknown time zone on update,
  `weekly_email_day` outside 0 to 6, an invalid kind/rag/repeat/notify in seed items, or
  completing a state. A blank emoji becomes 🦔. Invite tokens are trimmed.
- `items.kind` outside ('task', 'state') violates `items_kind_check` (23514); null violates
  not null (23502). Undoing a completion of an item that has since become a state leaves it
  without a due date (the kind trigger runs on that update too).
- Member email comes from the JWT, falling back to `auth.users`. A BEFORE INSERT/UPDATE
  trigger (`members_before_write`) stores every email trimmed and lower case, whoever writes
  it, and keeps `push_enabled` false while `user_id` is null.
- `join_household` with a token for the caller's own household returns its id even after the
  token expired; otherwise an unknown or expired token raises `invalid_invite` before
  `already_member` is checked.
- The items trigger raises `not_found` for a missing area; on insert `created_by` is always the
  caller (the service role keeps what it sends).
- A BEFORE INSERT trigger on `push_subs` replaces a stored row with the same endpoint when it
  is the caller's own or has the same keys (the same browser subscription), so a phone that
  changes hands moves its subscription to the new account. Knowing someone else's endpoint is
  not enough: the insert fails and their row stays.
- Check constraints (SQLSTATE 23514; the client maps them to `unknown` /
  `invalid_input: <constraint>`): `items.title` <= 200, `items.note` <= 4000, `items.good`
  <= 4000 (`items_good_length`), `members.name` <= 40, `members.emoji` <= 16, `members.color`
  `#RRGGBB`, `households.name` <= 60, `households.address` <= 120, `areas.name` <= 60,
  `push_subs.endpoint` https only and <= 2048, `push_subs.p256dh` and `auth` <= 256,
  `push_subs.user_agent` <= 512 (the insert trigger cuts longer values). Lengths are characters
  (Postgres `length()`); `TEXT_LIMITS` in `src/lib/constants.ts` holds the same numbers and the
  inputs use them as `maxLength`.
- View `scheduler_open_items` (`security_invoker`, service role only): open items with the note
  whitespace-squashed and cut to 200 characters, read by the scheduler. It has no `kind`
  column; the scheduler reads the ids of open states from `items` itself (see below).
- Internal helpers `next_due_date(text, date, date)` and `is_valid_timezone(text)` are not
  callable by clients.
- Realtime DELETE events carry only the primary key (RLS tables), so clients reload on any event.
  Realtime checks RLS when it reads each change, so an INSERT/UPDATE whose row is already gone
  is dropped (its DELETE still arrives). Supabase applies no RLS to deletes: any signed-in user
  who subscribes without a filter receives DELETE notices from every household, without
  knowing any id. Each notice carries only the deleted row's primary key: the row id for
  `households`, `members`, `areas`, `items`, `completions`, `messages`,
  `housekeeping_tasks`, `housekeeping_visits` and `housekeeping_visit_tasks`,
  (message_id, member_id, emoji) for `message_reactions`, where emoji is one of the app's
  reaction emoji, and the household id for `housekeeping_notes` (whose rows are only ever
  deleted with their household, alongside that household's own notice). No text, names or
  other household ids. This is how Supabase Realtime treats deletes,
  and it cannot be filtered per table in the publication. The app's own subscriptions
  (`subscribe`, `subscribeChat`) always filter by household: by `household_id` on the tables
  that carry it (all with replica identity full, so the filter also applies to deletes) and by
  `id`, the primary key, on `households`. Members therefore never receive other households'
  notices. The live suite pins
  exactly this and nothing more.
- Both subscriptions ask for a reload on every join, the first included: Realtime never replays
  changes made before a join (between the client's first load and the join, or while a dropped
  connection was down).

## Backend contract

`src/lib/backend/types.ts` is authoritative. `BackendError.code` mirrors the RPC error
messages above (`network` for fetch failures). The housekeeping methods are listed under
"Housekeeping" below. `completeItem` on a state throws
`BackendError('unknown', 'invalid_input: state')` in the demo backend and
`BackendError('unknown', 'invalid_input')` from Supabase; the UI never calls it for a state.

## One home

Migration `supabase/migrations/20261010000500_one_home.sql`; types `HomeEntry` and
`Phase` (`private`) in `src/lib/types.ts` and `src/state/HomeProvider.tsx`;
`Backend.enterHome()`. A deployment holds one home, and nobody can create a second: not the
app, and not a client calling the database directly.

### One home, kept by the database

- **`households_one_home`** (BEFORE INSERT on `households`): takes the advisory lock
  `(4712, 1)` (the same as `import_household`), then raises `home_exists` when a household
  exists already and the request comes from a client (`auth.role()` is `authenticated` or
  `anon`). So `create_household` (which this migration does not redefine; the Housekeeping
  migration owns it) refuses a second home, and two people creating, or one creating while
  another brings a home over, end up with one home. The service role and the database owner
  (SQL editor, migrations) are not limited.
- **The deployment's home** is the oldest household (`deployment_home()`). Claims
  (`enter_home`, `join_household`, `join_as_person`) and joins only reach it
  (`reachable_home()`): an invite to any other household is `invalid_invite` (and its preview
  null), and a person with the same email in another household is never claimed. A household
  that got in some other way (an admin, or one left from before this rule) captures nobody.
- **`app_settings.many_homes`** (one-row table, RLS on, no policies; the service role may read
  it): for development and test databases only, which hold many homes (the tests make one per
  case; a shared local stack holds several people's). On, clients may create more homes and
  claims and joins reach every home (oldest home first, then oldest person). Off, or no row:
  one home. `npm run test:db` turns it on for its throwaway database, and
  `supabase/tests/one_home_deployment.test.mjs` makes a fresh database without it, as a
  deployment has it. The live suites check it is on before they start.

### Where a person belongs: `enter_home()`

HomeProvider's bootstrap asks `Backend.enterHome()` after every sign-in (instead of
`getMyHouseholdId()`, which stays for other callers and never claims). It returns one of:

| status | when | the app |
| --- | --- | --- |
| `member` | the account has a member row | phase `ready`: the home (first the offer of this phone's home, when it has one) |
| `claimed` | not a member, and a person in the deployment's home has not joined yet (`user_id` null) and has this account's **Google-verified** email (see below; both trimmed and lower case) | the account is now that person; phase `ready` with `claimed` and `onboardingTail`: the welcome step, the notifications step, then the home |
| `no_home` | not a member, no such person, and no household exists | phase `onboarding`: "Bring over the home from this phone" when this browser has one, else Profile then Create home |
| `private` | not a member, no such person, and a household exists | phase `private`: "This home is private" |

JSON from the RPC: `{"status":"member"|"claimed","household_id","member_id","can_import"}`,
`{"status":"no_home"}`, `{"status":"private","email","email_verified"}`; the backend maps it
to `HomeEntry` (`householdId`, `memberId`, `canImport`, `email`, `emailVerified`).
`can_import` is `home_untouched()` of that home (see "Bring over the home from this phone").
`not_signed_in` without a user.

- **The claim is atomic**: `update members set user_id = auth.uid(), claimed_at = now() where id
  = <person> and user_id is null and lower(email) = <verified email>`. Of two accounts
  claiming one person at once, exactly one wins and the other gets `private`; the same account
  in two tabs gets `claimed` once and `member` in the other; an email changed in People while
  someone signs in with the old one is not claimed. A claimed person keeps their id, name,
  emoji, colour, role, items and Stats.
- **Only a Google-verified email claims** (`verified_email()`): the account needs
  `auth.users.email_confirmed_at`, and a Google identity (`auth.identities`, provider `google`)
  whose own email is the account's and that Google marked `email_verified`. A confirmed email
  alone is not enough: a project whose Email provider confirms sign-ups by itself would let
  anyone who types a waiting person's address with a password become them. The local
  `supabase/config.toml` also keeps `enable_confirmations` on, and README "Going live" asks for
  the Email provider to be off. An email and password account is always `private` (with
  `email_verified` false), and through an invite joins as someone new without the email.
- `private` reveals nothing about the home: only the caller's own email and whether it is
  verified.
- **No second home**, in the app too. The app reaches Create home only from `no_home`, and
  HomeProvider's `createHousehold` asks `enterHome()` once more just before creating (anything
  but `no_home` moves to that phase and rejects with `home_exists`); when the database refuses
  anyway (someone set one up in between), it asks again and moves to the phase that gives.
  On the real backend Create Home says, under the button, "Used home.os on your phone before?
  Sign in on that phone first to bring your home over." and asks first ("Create a new home?"),
  unless this browser's own home was just turned down (Start Fresh).
- **Invite links** keep working. From phase `private` an invite opens Profile then Join, without
  "Set up a new home instead". `invite_preview` also lists the people waiting to join without an
  email, and Join asks "Are you one of these people?" (see "Screens"): picking one joins as them
  (`join_as_person`). `join_household` claims a not-yet-joined person with the caller's verified
  email instead of adding a duplicate; in practice `enter_home` has already claimed them at
  sign-in, so the invite is simply cleared as for any member. A link that is no longer valid:
  with a home, straight to "This home is private" with the line "That invite link has
  expired." (no Profile step; the link is forgotten); with no home yet, "Invite link not valid"
  first, whose main action is Check Again.
- **"Not Shea?"** (`release_claim()`, `Backend.releaseClaim`): within a day of a claim (by
  email or as a listed person; `members.claimed_at`), the account stops being that person,
  who goes back to "Not joined yet" without the email that matched (someone at home puts in the
  right one), and its push subscriptions for them go. The account is then in no home.
  `not_found` without a claim from the last day.
- **Demo mode** (`DemoBackend.enterHome`): the same rules on the local document, with the demo
  account's email counting as verified, except that it never answers `private`: a demo sign-in
  always gets a home (its own, a claimed person, or `no_home` to create one), and `canImport`
  is always false. The demo never offers the import (it is where the data comes from).

### Screens (Onboarding views; copy is exact)

Full-screen steps like ProfileStep (`StepPage`), in `src/screens/onboarding/`. App only shows
the new ErrorScreen for phase `error`; every phase but loading, error and ready-without-tail
already shows Onboarding.

- **This home is private** (phase `private`). Title "This home is private". Body: "Ask someone
  at home to add **{email}** in Profile > Household > People, then check again." With no email:
  "Ask someone at home to add your Google email in Profile > Household > People, then check
  again." A long email breaks after the @ or before a dot (mid-word only when one part is wider
  than the screen). When `emailVerified` is false, add: "Your Google account's email isn't verified yet,
  so it can't be matched." When this browser kept a home in demo mode: "This phone still has
  {name} ({counts}). Someone has already set up a home here, so it can't be brought over now."
  After an invite link that was no good, first: "That invite link has expired." Buttons:
  **Check Again** (primary; `recheckHome()`, busy while it runs; when nothing changed, "Not
  added yet. Checked just now." under it as a status; `errorMessage(err)` on failure) and
  **Sign Out**. Never a way to create a home. HomeProvider also rechecks whenever the app comes
  back into view in this phase.
- **Invite link not valid** (phase `onboarding` with an invite link that is no good, before
  Profile). "It may have expired, as links last 14 days, or be from before your home was set up
  here. Ask whoever sent it to sign in to home.os first, then add you in Profile > Household >
  People." **Check Again** (primary; "No home here yet. Checked just now." when nothing
  changed), then the text button **Set up a new home instead** (forgets the link: Profile, then
  Create home, which asks first).
- **Bring over the home from this phone** (`demoImport` with `demoImportMode` 'create' in phase
  `onboarding`, shown before Profile; or 'replace' in phase `ready` with `onboardingTail`).
  Title "Bring over the home from this phone". A white card: the household name (17/600), the
  address under it if any, "{n} areas · {m} items" plus " · {d} done" when completions come
  along (singular "1 area", "1 item"; `m` counts open items), then each person as emoji and
  name, "(you)" after the one with `me`, hairlines inset on both sides. Footnote: 'create':
  "Everyone else joins when someone adds their Google email in Profile > Household > People.";
  'replace': "It takes the place of {home}, which has nothing in it yet. Everyone already in
  {home} stays." Buttons: **Bring It Over** (primary; `importDemoHome()`, busy while it runs,
  `errorMessage(err)` under it on failure) and a text button that asks first in an action
  sheet: 'create' **Start Fresh** ("Start a new home?" / "The home on this phone ({m} items)
  won't come along, and can't be brought over later." / **Start Fresh**, destructive); 'replace'
  **Keep {home}** ("Keep {home} as it is?" / "... won't come along, and won't be offered again.").
  Sign Out in the nav bar for 'create' only. No Profile step after an import: the demo name and
  emoji come along. After Start Fresh, Profile has **Back** (left of Sign Out) to the offer,
  until a home is created.
- **The home on this phone stays here** (`demoImportMode` 'blocked' in phase `ready`, once).
  "This phone still has {name} ({counts}) from before. {home} already has things in it, so that
  home can't be brought over." **OK** marks the document declined.
- **{Names} haven't joined yet** (phase `ready`, `onboardingTail`, `invitePeople`, someone
  without an email; right after bringing a home over). "Add the Google email each of them signs
  in with. When they sign in, they join as themselves, with their items." One card per person
  (emoji and name, then the email field, "{name}'s Google email"), the same rules and messages
  as People. "You can add or change them later in Profile > Household > People." **Continue**
  saves what was typed (`setPersonEmail`), then the notifications step.
- **Welcome** after a claim (phase `ready`, `onboardingTail` and `claimed`, also after joining
  as a listed person). Title "Welcome home, {me.name}". Body "{household name} is all set up
  for you. Pick your emoji." The emoji grid (`EmojiGrid`) on `me.emoji`. Button **Continue**
  (`confirmClaimed(emoji)`), then the notifications step as after a create or join. Text button
  **Not {name}? Sign Out**, which asks first ("Not {name}?" / "You'll be signed out and {name}
  goes back to waiting to join. Ask someone at home to check the email they added for you.")
  and then runs `releaseClaim()`.
- **Join {home}** with people waiting (`InvitePreview.people` not empty): under the invite card,
  "Are you one of these people?" as a radio group: each person (emoji and name), then "Someone
  new ({profile name})". Nothing is chosen at first unless exactly one has the name typed on
  Your profile. **Join as {name}** (`joinHousehold({..., personId})`, then the welcome step as
  that person) or **Join**; off until there is an answer. Someone who joined meanwhile: a toast
  "{name} has joined already or was removed." and the list again.
- **ErrorScreen** (phase `error`, `src/screens/onboarding/ErrorScreen.tsx`): a hero step,
  "You're offline" / "Your home opens by itself as soon as you're back online." when it was the
  connection (`phase.offline`), else "Couldn't open your home" with the message; **Try Again**
  (`retry()`). HomeProvider retries by itself on `online`, when the app comes back into view and
  every 15 s while in view.

## People before they join

Migration `supabase/migrations/20261010000500_one_home.sql`; `Member.user_id: string | null`;
`src/lib/logic/people.ts` (`hasJoined`, `normaliseEmail`, `isValidEmail`, `emailTaken`);
`TEXT_LIMITS.email` (254).

- A member row with `user_id` null is a person someone at home added who has not signed in yet
  (**Not joined yet**). They are a member like any other for items (assignee, created by),
  completions (credited to), the person filter, Stats and the weekly email's text, and anyone
  edits their name and emoji (`updateMember`). They hold no account: no access, no chat posts,
  no push (forced off), no weekly email, no reminders. Use `hasJoined(member)`, never a null
  check of your own.
- **Emails**: stored trimmed and lower case by the `members_before_write` trigger (so any
  writer, create_household included, stores the same form); at most 254 characters
  (`members_email_length`); unique per household among non-blank emails, case-insensitive
  (`members_household_email_key`). The app compares with `normaliseEmail()`. `isValidEmail()`
  and SQL `is_valid_email()` are the same rule: one @, no spaces, a dot in the domain, at most
  254 characters. A joined member's email is their account's and is never edited in the app.
- **RPCs** (signed-in members of that household; outsiders get `not_found`):
  - `add_person(p_household_id, p_name, p_emoji, p_email) returns uuid`: name trimmed, blank is
    `invalid_input`, over 40 characters violates `members_name_length`; blank emoji is 🦔;
    email optional ('' for none), normalised, not an email is `invalid_input`, someone in the
    home has it is `email_taken`. Role member, colour `MEMBER_COLORS[people in the home mod 6]`
    (like a join), push off, weekly email on (it starts once they join).
  - `set_person_email(p_member_id, p_email) returns void`: set, change or clear (''); the same
    value again is a no-op; `email_taken`; `invalid_input` for someone who has joined or a value
    that is not an email.
  - `remove_person(p_member_id) returns void`: only someone who has not joined
    (`invalid_input` otherwise). Their items become unassigned and their completions are
    credited to nobody (the foreign keys' on delete set null), as when any member row goes.
  - Adds and email changes lock the household row, so two at once cannot take one email.
- **Household > People** (`src/screens/profile/HouseholdEditor.tsx`, `PersonPage.tsx`):
  - Each row: avatar, name, and for someone who has not joined a secondary line "Not joined
    yet · {email}" or "Not joined yet · No email yet". When the email (or "No email yet") does
    not fit beside "Not joined yet", it goes on a line of its own without the dot, cut with an
    ellipsis only if it is wider than the row. People stay in member order.
  - Last row **Add Person** (tint, plus icon), pushing an Add Person page like PersonPage:
    Name (`maxLength` 40, focused), the emoji grid (on the first emoji nobody at home has,
    `firstFreeEmoji()`; Your profile does the same for someone joining through an invite, from
    `InvitePreview.emojis`), **Google Email** (`type=email`,
    `inputmode=email`, `autocapitalize=none`, `autocorrect=off`, `spellcheck=false`,
    `maxLength` 254, placeholder "name@gmail.com"), footnote "When they sign in with Google
    using this email, they join as this person, with their items." **Add** in the navigation bar
    (off while the name is blank or a non-blank email fails `isValidEmail`). Errors under the
    field: `email_taken` "Someone at home already has that email."; invalid "Enter the full
    email address, like name@gmail.com." The page keeps its input on failure.
  - PersonPage for someone who has not joined: name and emoji as today, plus **Google Email**
    (same field and footnote; saved with `setPersonEmail` on blur or Return, an error shows
    under it and keeps the text), and at the bottom a destructive **Remove {name}** that asks
    (ActionSheet) "Remove {name}? Their items become unassigned." (or, when Stats credits them
    with something, "Their items become unassigned and their {n} done tasks leave Stats.",
    `removeMessage()`) with **Remove** and Cancel, then pops the page. For someone who has
    joined: as today (no email field, no remove).
  - Profile's **Invite someone** has a caption: "Someone already in People? Add their Google
    email there instead, and they join as themselves." (and the Join screen asks "Are you one
    of these people?", see "One home").
- **Elsewhere**: the Item sheet's assignee list adds a quiet secondary "Not joined yet" after
  such a person's name (the Sharing work also edits the Item sheet: keep this to the option's
  label). The Home person filter, Home rows and Stats show them like anyone else, with no
  label (only the filter chip's VoiceOver name ends ", not joined yet").
- **Scheduler** (`supabase/functions/_shared/plan.ts`, reading `members.user_id`): nobody with
  `user_id` null gets a reminder, a missed alert or the weekly email; an unassigned reminder
  goes to the members who have joined; a missed item assigned to someone who has not joined
  still alerts the owner(s); the weekly email still names them.
- **Demo**: the same RPC rules and errors in `DemoBackend` (`addPerson`, `setPersonEmail`,
  `removePerson`); people it adds have `user_id` null and show "Not joined yet".

## Bring over the home from this phone

The household used the live site in demo mode, so their home lives in one phone's
localStorage (`homeos.demo.v1`, the `DemoBackend` document). The first person to sign in with
Google on that phone, while no home exists, is offered to bring it over. If someone set up a
home first, the phone's home still comes over once its person is in that home, as long as the
home has nothing in it yet.

- **Offer** (Supabase backend only; `demoHomeSummary(readDemoDoc(localStorage))` not null: the
  document has a household and is marked neither `imported` nor `declined`), by
  `HomeProvider.demoImportMode`:
  - 'create': phase `onboarding` (`no_home`). Start Fresh (asked first) hides it for the
    session; Profile's Back brings it back (`reopenDemoImport`); creating the home then marks the
    document `declined` (`markDemoDeclined`), so it never comes back.
  - 'replace': phase `ready`, the home untouched (`HomeEntry.canImport`), before the home opens
    (`onboardingTail`; after the welcome step for a claim). Keep (asked first) marks it declined.
  - 'blocked': phase `private` (a line on that screen), or phase `ready` with a home in use (said
    once; OK marks it declined).
  - A home that is this document's home already (`demoHomeMatches()`: same name, areas in order,
    everyone by name, the same open items; an import whose reply was lost) marks it imported
    instead of offering it again.
- **Payload**: `buildImportPayload(doc)` in `src/lib/logic/importHome.ts` (pure,
  deterministic), `ImportPayload` version 1 in `src/lib/types.ts`. The home is the demo's
  signed-in person's (else the earliest owner's, else the earliest person's). That person is
  `me` and becomes the Google account (role owner, the account's email), keeping their demo
  name, emoji and colour; everyone else in that home comes as not joined yet, without the
  demo's made-up emails. Areas in order; every open and done item with all its fields (kind,
  title, note, good, rag, due date, repeat, notify, status, assignee, created and updated by,
  created, updated and completed times); every real completion (Stats history), linked to its
  item when the item came along. The made-up history the demo adds to every home it sets up
  (`addHistory`: no item, done no later than the home was set up) stays behind, as do chat,
  invites and push subscriptions. The summary counts what comes along ("· 3 done"). Anything the
  database would refuse is repaired or left out (text cut to `TEXT_LIMITS`, unknown values to
  their defaults, an item without an area or title or a done state left out, a completion
  without a time left out), so a payload from this builder is always accepted while no home
  exists.
- **`import_household(p_payload jsonb) returns uuid`**, all or nothing. With no home: a new
  home, as above. When the caller is in a home that is untouched (`home_untouched()`: its name,
  address and time zone never changed, every area and item is one it was created with and no
  item was edited or done, no completions, no chat, and with the Housekeeping migration no
  visit, no message and only the starter list; people do not count), the phone's home goes into
  it in place, keeping its id (invites and every open device carry on): its name, address and
  time zone become the phone's, its areas, items and completions are replaced, and its people
  stay: `me` is the caller as they are, each other person from the phone is the person of the
  same name already there (trimmed, any case, each once), else is added as not joined yet. Its
  housekeeping list stays. Errors: `not_signed_in`;
  `already_member` (the caller is in a home in use); `home_exists` (a home exists and the caller
  is not in it); `invalid_input`
  for anything it refuses (wrong types, unknown keys or references, duplicate keys, not exactly
  one `me`, text over the limits, unknown kind/rag/repeat/notify/status, a done state, a date
  or time it cannot read, over 50 people, 100 areas, 2000 items or 20000 completions). A state
  keeps no due date, repeat or reminder (the kind trigger). Times later than now become now;
  missing item times are now. Items keep their own times and authors (the items trigger lets
  the import through for its own inserts only). With the Housekeeping migration present the
  home also gets the starter task list, as `create_household` gives.
- **Afterwards**: `markDemoImported(localStorage, {at, household_id})` marks the document and
  changes nothing else in it, so the offer never comes back on that phone, then the home opens
  like after a create: first "{Names} haven't joined yet" for the emails of the people who came
  along without one (`invitePeople`), then the notifications step. When Shea signs in with the
  email added for her, `enter_home` makes her Shea, with her items.
- **Fixtures**: `src/lib/logic/importHome.fixture.ts` is the household's real home as the phone
  stores it (six areas, 19 open items and one done, Stratis, Shea and Ela, three real
  completions and some of the demo's made-up history), and `demoCreatedDoc()` is a home as the
  real `DemoBackend.createHousehold` sets one up (111 made-up completions, one real one).
  `supabase/tests/fixtures/demo-import.json` and `demo-created-import.json` are their payloads;
  the unit test checks they agree (`UPDATE_IMPORT_FIXTURE=1 npx vitest run
  src/lib/logic/importHome.test.ts` rewrites them) and the database tests import them.

## Sync guarantees

Every change one person makes shows on every other signed-in device of the home without a
reload: within about 2 s while both are open and online, and within about 2 s of a device
coming back into view or back online.

| change | tables written | heard as |
| --- | --- | --- |
| item create, edit (title, note, What good looks like, RAG, due, repeat, notify, assignee, area), kind change, delete | items | `subscribe` → reload |
| complete, undo | items, completions | `subscribe` → reload |
| area add, rename, reorder, delete | areas (and items on delete) | `subscribe` → reload |
| household name, address, time zone | households | `subscribe` → reload |
| person added, edited (name, emoji), email set, removed, claimed or joined | members | `subscribe` → reload |
| chat message sent or deleted | messages | `subscribeChat` → message |
| reaction added or removed | message_reactions | `subscribeChat` → reaction |

What makes it hold (timings are constants in `src/state/HomeProvider.tsx`: `RETRY_STEPS_MS`,
`RETRY_EVERY_MS`, `RESUME_AFTER_MS`, `SAFETY_MS`):

1. **Realtime**: `subscribe` (one channel, five tables, filtered by household) and
   `subscribeChat`; every table is in the `supabase_realtime` publication with replica identity
   full. Each channel join, the first and every rejoin, asks for a reload (`onChange`) or a
   `resync`, because Realtime never replays what happened while it was not joined.
2. **Loads in order**: HomeProvider reloads 250 ms after the last event; a reload never shows
   older data than what is shown, and waits for writes in flight (the write's own reload
   follows).
3. **Retry**: a background reload that fails is tried again after 1, 2, 4 and 8 s, then every
   15 s, while the app is visible and the phase is `ready`, until one is shown (or a newer
   load is).
4. **Coming back**: on `visibilitychange` to visible after 10 s or more hidden, on `pageshow`
   with `persisted`, and on `online`, HomeProvider calls `backend.reconnect()` (it alone does)
   and reloads at once; ChatProvider resyncs on the same three events. A shorter hide keeps the
   debounced reload it has today. In phase `private` the same events run `recheckHome()`, and in
   phase `error` (no connection when the app opened, say) they run `retry()`, as does a 15 s
   timer while in view, so the home opens by itself once the connection is back.
5. **Reconnect** (`Backend.reconnect`): the Supabase backend drops the socket and opens a fresh
   one, at most once per 5 s (`RECONNECT_MIN_MS`), because a phone that slept can hold a socket
   that says it is open but is dead, and the 25 s heartbeat takes up to a minute to notice. Each
   subscription (`subscribe`, `subscribeChat`) then gets a fresh channel with the same listeners
   on the new socket, and the old one is removed: a channel whose socket died without a close
   event still believes it is joined and would never rejoin by itself. Each fresh join asks for
   a reload; events from a replaced channel are ignored.
6. **Safety net**: while visible and `ready`, when 60 s pass with no realtime event and no
   reload, HomeProvider reloads and ChatProvider loads the newest page. This covers a channel
   that joined but silently stopped delivering.

Tests that pin it (required with the data work):

- Live suite (`src/lib/backend/supabase.integration.test.ts`, local Supabase): members A and B
  on separate clients, A subscribed. For every row of the table above, B makes the change and
  A hears it within 2 s once events flow; the claim is made by a third account whose email B
  added. After `reconnect()`, A's channel rejoins and asks for a reload within 5 s.
- Unit (`src/state/HomeProvider.test.tsx`, `ChatProvider.test.tsx`, fake timers): the retry
  steps, the resume events (one `reconnect()`, one reload), the 60 s safety net, and the
  recheck in phase `private`. Offline (`supabase.integration.test.ts`, a fake client): the
  fresh channels after `reconnect()`, in order, at most once per 5 s, never throwing.
- e2e (demo, two pages in one browser context, which share localStorage): a change on one page
  shows on the other without a reload, for an item, an area, a person and a chat message.
- Live e2e (`e2e-live/one-home.spec.ts`, `npm run test:e2e:live`, README "Development"): the
  app built against the local stack, one browser context per person. Stratis brings over the
  fixture home, Shea claims her person by email, a stranger sees "This home is private" until
  added; then each row of the table above, made on one phone through the app, shows on the
  other within 5 s (`SYNC_MS`) with no reload (each page carries a mark that a reload would
  lose). Before each change the watching phone has had no request open for 400 ms (`quiet()`),
  so what it shows next came over Realtime, not from a load of its own: with the app's channels
  muted, every check that a change arrived fails. A last test takes one phone offline while the
  other adds an item: nothing arrives while offline, and it shows within 5 s of going back
  online, after which Realtime carries the next change again.

## The one-home contract (do not change without the architect)

Two builders work from this in parallel. **Data**: `DemoBackend` and `SupabaseBackend`
(`enterHome`, `importHousehold`, `addPerson`, `setPersonEmail`, `removePerson`, `reconnect`),
HomeProvider (bootstrap through `enterHome`, the phases, `claimed`, `confirmClaimed`,
`demoImport`, `importDemoHome`, `declineDemoImport`, `recheckHome`, the guarded
`createHousehold`, `addPerson`, `setPersonEmail` and `removePerson` (both optimistic), and
"Sync guarantees" 3 to 6), ChatProvider's resume and safety net, and their tests. **UI**: the
three Onboarding views, Household > People (Add Person, the email and Remove on PersonPage,
"Not joined yet"), the Item sheet's label, demo e2e tests, and README ("On each iPhone",
"Permissions"). Every `TODO(one-home ...)` stub names its owner by area.

Fixed (both builders code against these; a change needs the architect):

- `supabase/migrations/20261010000500_one_home.sql`: function names, parameters, return
  shapes and error messages, and its database tests. It never redefines `create_household`.
- `src/lib/types.ts`: `Member.user_id: string | null`, `Member.email`'s stored form,
  `HomeEntry`, `NewPersonInput`, `ImportPayload` and its parts, `DemoHomeSummary`.
- `src/lib/backend/types.ts`: the new methods, their documented errors, and the codes
  `email_taken` and `home_exists`.
- `src/state/HomeProvider.tsx`: the `Phase` kinds and every `HomeContextValue` member above.
- `src/lib/logic/importHome.ts` and `people.ts`: exported names and signatures, and the fixture.
- Rules: a null `user_id` never grants anything (`hasJoined()`); emails are compared with
  `normaliseEmail()`; nothing anywhere offers a second home; the copy above.

Changed after review (the fixer of one/int): the database keeps one home
(`households_one_home`, `app_settings.many_homes`) and claims only reach the deployment's
home; only a Google-verified email claims; `enter_home` returns `can_import`
(`HomeEntry.canImport`); `import_household` also replaces an untouched home; `invite_preview`
returns `people` and `emojis`; new `join_as_person` (`JoinHouseholdInput.personId`) and
`release_claim` (`Backend.releaseClaim`); `DemoHomeSummary.done`; `Phase` 'error' has
`offline`; HomeContextValue adds `demoImportMode`, `reopenDemoImport`, `canReopenDemoImport`,
`invitePeople`, `doneInvitingPeople`, `releaseClaim` and `retry`; importHome.ts adds
`markDemoDeclined`, `demoHomeMatches` and leaves the demo's made-up history behind.

## Home

- **Areas collapse.** Each area name is a disclosure button (`aria-expanded`, `aria-controls`)
  inside the area's `h2`, with a small chevron that stays on the line with the name's last
  letter. Collapsed, the card slides shut (about 320ms, none with Reduce Motion) and its rows
  are inert and hidden. **Collapse All** / **Expand All** (15px tint text, right-aligned above
  the first area) does every area at once.
- **Remembered per device**: the collapsed area ids are kept in localStorage under
  `homeos.collapsed.<householdId>` (every read and write in try/catch; deleted areas are
  forgotten). Nothing is stored on the server.
- **Status counts**: on the right of each header, red, then amber, then green badges (just
  the number, 13px/600, the RAG text colour on the RAG tint, 20px round like the person
  filter's counts), only for non-zero counts, shown open or collapsed. Every open item in the
  area counts by its RAG, To maintain items included. Assistive tech reads one label, such as
  "1 urgent, 2 at risk, 3 on track". A tap on the counts opens or closes the area like the
  name does; it also keeps a phone's tap correction from moving that tap onto Share.
- **Share**: between the counts and the +, a bare tint share glyph ("Share <area>"), see
  "Sharing" below. The button is its own 44 × 44 tap target and overlaps nothing: it starts
  where the counts end (or 8px after the name, where the name's own target ends, when there
  are no counts) and ends where the +'s target begins. Dropping the badges' dots paid for
  its width: with all three counts the name has the room it had before Share (127px at
  320 wide, 209px at 402), so names wrap where they did, between words. With fewer counts
  it has more room than that, if less than before Share (at 320 wide: 151px with two
  counts, 176px with one, 196px with none).
- **Add**: after the counts and Share, a small tinted + ("Add item to <area>", 44 × 44 tap
  target) opens the new-item sheet with that area chosen.
- **Saving into a collapsed area opens it**: when an item is created, or moved to another
  area, the Item sheet reports the area (`onSaved`), App passes it to Home (`revealArea`)
  and Home expands it, so the item can be seen. Closing without saving changes nothing.
  This covers the area's + and the round + at the bottom right.
- **Keyboard focus** never lands on a row in a collapsed area: after a completion
  (`ItemRow`) or when the Item sheet closes on a row that is gone (`App` `restoreFocus`),
  focus goes to the nearest row that can be seen (`inCollapsedArea()` in
  `screens/home/areaPanel.ts`), else to the area's name.

### Home: date and the person filter

- The hero's top line shows today's date in full ("FRIDAY 9 OCTOBER", `longDay()` in
  `lib/logic/dates.ts`, the household's day), level with the avatar.
- Under the tab switch, `PersonFilter` (`screens/home/PersonFilter.tsx`, logic in
  `personFilter.ts`): a radio group "Show tasks for" with Everyone, you, each other member and
  Unassigned, each with its count of open items. Choosing a person shows only items assigned to
  them, and only the areas where they have some; Collapse All acts on what is shown. Nothing
  open reads "Nothing for Ela right now." The choice is kept per household on this device
  (`homeos.who.<householdId>`); a member who left reads as Everyone. Saving an item into an
  area the filter hides switches back to Everyone, and so does a shared area link (see
  "Sharing").
- People's 🦆 and 🦔 are drawn (`ui/EmojiText.tsx`: the green duck and brown hedgehog of
  `ui/animals.ts`) wherever a member's emoji shows, with the character kept in the text for
  copying and screen readers.

### The hero and the tab switch

Every tab (Home, Chat, Housekeeping, Stats) starts with `ScreenHeader` (`ui/Screen.tsx`): the
`Hero` (`ui/Hero.tsx`) from the very top of the screen, with the title (an `h1`), a secondary
line (the address on Home) and the Profile avatar on it, then the Home / Chat / Housekeeping /
Stats switch (`TabBar`, a `nav` named "Tabs" whose buttons carry `aria-current="page"`; see
"Housekeeping" for how four segments size and fit). The switch is
`position: sticky` at `--top-inset`: once the hero has scrolled away it stays at the top on a
frosted background (`data-stuck`), and `StatusSky` fills in behind the status bar. Welcome
uses the same hero, full bleed, over the wordmark. The round + (`AddButton`) floats at the
bottom right on Home and Stats only; Chat's composer sits at the bottom; Housekeeping has
neither.

The hero draws the house, the green duck and the brown hedgehog under the sky as it is in
London (`skyAt()` in `lib/logic/sun.ts`), recomputed every minute and when the app comes back
into view. It exposes `data-phase` and `data-tone` (white or black text over the sky); the
illustration is decorative and a visually hidden sentence describes it.

### Home scene: the sky in London

`HomeScene` (now on the Join screen's invite card) shows the sky as it is now at the house:
`lib/logic/sun.ts` works out the sun's elevation in London (`skyAt()`), and
`lib/logic/sky.ts` (`skyLook()`) turns it into colours that blend smoothly with the
elevation, with a softer, pinker morning and a warmer evening.

- **Day** (12° and up, `FULL_DAY`): exactly the 3a colours and picture, the sun 22px from the
  top and 28px from the right.
- **Sunrise and sunset** (0° to 8°): peach, coral and pink, a low orange sun with a bigger
  halo and a glow along the horizon. **Dawn and dusk** (-6° to 0°): indigo to rose, the first
  bright stars. **Night**: navy sky, darker ground, a crescent moon where the 3a sun sits,
  twinkling stars (still with Reduce Motion), the house and animals dimmed and the windows
  warmly lit.
- **The sun's path**: in the morning it rises on the left (east) and climbs to the top-left
  corner; by full day it is in the 3a spot, top right, and in the evening it sinks down the
  right (west) side behind the ground. It is two elements, one per side; they swap with a
  cross-fade at the top, so the sun never crosses the house.
- **Updates**: every minute and when the app comes back into view (`visibilitychange`,
  `pageshow`). Colours fade over 1.6s (registered custom properties, `@property`; Safari
  16.4+ fades, older engines just switch). The sun glides between minutes, but after a jump
  in time (back from the background the next morning, say) it is simply in its new place
  (`data-jump` on the scene turns its transitions off for that change).
- The scene has `data-phase` (night, dawn, sunrise, day, sunset, dusk) and `data-sun` (east
  or west), and its label says the time of day: "A duck and a hedgehog outside their house at
  sunset".
- The duck (green) and hedgehog (brown) are SVG drawings in `ui/animals.ts`, used in the
  scene and the confetti (`<img data-animal="duck|hedgehog">`). Avatars are still emoji.

## Sharing

Any item or area can be shared, for example to WhatsApp, Messages or Mail.

- **Where**: the Item sheet of a saved item has a round **Share item** button in its nav bar,
  left of Save (none while creating an item: there is nothing to link to yet). Each area
  header on Home has **Share <area>** (see "Home"). Both use `ShareIcon` (square.and.arrow.up).
- **What** (`lib/logic/share.ts`, pure and unit tested): plain text, then a blank line and a
  link back into the app. An item is shared as the sheet shows it, edits not yet saved
  included (as they would be saved; a blank title keeps the saved one). Sharing saves
  nothing, and the link opens the item as it is:

  ```
  Heaters not working
  Hallway · Red · Missed · Tue 6 Oct
  Assigned to Shea
  No heat since the weekend. Engineer needs booking.

  https://<app>/?item=<id>
  ```

  A task reads `Due Fri 13 Nov` (or `Missed · Tue 6 Oct`) and adds its repeat (`Every month`);
  a To maintain item reads `Updated <day>` (household time zone), `Looked after by <name>` and
  adds `What good looks like: …`. Names never carry the emoji; no assignee reads `Unassigned`.
  Notes are tidied (spaces squashed, blank lines dropped) and cut at a word with "…" past 280
  characters (`SHARE_NOTE_MAX`). An area lists its open items in Home's order, one line each:
  `Kitchen (2 items)`, `• Olive oil · Green · Due Fri 13 Nov`, …; nothing open reads
  `Nothing to do`, and past 20 (`SHARE_AREA_MAX`) the rest are counted (`…and 4 more`).
- **How** (`screens/share/useShare.ts`, `lib/shareSheet.ts`): `navigator.share({ title, text })`
  straight from the tap, with the link as the text's last line (so every app gets it, and the
  share sheet's Copy copies the whole message). Cancelling (AbortError) does nothing. Without
  a share sheet (most desktop browsers), or when it refuses, the same text goes on the
  clipboard and a toast says "Copied to share"; if that fails too, "Couldn’t share. Try
  again." A second tap while the sheet is coming up is ignored (for 1.5s at most, in case a
  share sheet never reports back). The invite link uses the same helper.
- **Links** (`lib/sharedLink.ts`): `<origin><BASE_URL>?item=<id>` or `?area=<id>`. `main.tsx`
  calls `captureSharedLink()` before anything renders: it takes the parameter out of the
  address bar (`history.replaceState`, other parameters left exactly as they were) and keeps
  the link in localStorage (`homeos.link`, with the time) until the household has loaded, so
  it survives signing in and the Google redirect, like an invite. It is forgotten after an
  hour, when taken, and on sign out. Once the household is ready, `useSharedLink` (in App's
  main shell) opens the item's sheet, or switches to Home, where `HomeScreen` (`linkedArea`)
  expands the area (remembered as open), scrolls it to just under the stuck tab switch once its
  card has opened (the screen's `scroll-padding-top`), moves focus to its name without
  scrolling (VoiceOver reads "Garden, expanded" and carries on into its items), and rings the
  card in the tint colour for a moment (`data-linked`). If the person filter hides the area,
  or some of its items, it goes back to Everyone, so what was shared is all there. Leaving
  Home before that happens (App's `switchTab`) drops the link, so it can't scroll Home on a
  later visit. An id this household doesn't have gets a toast ("That item isn’t in your
  home", "That area isn’t in your home"); a one-off item that has been done says "“<title>”
  is already done". RLS already keeps other households' rows out of `load()`, so a link is
  no way in.

## Item kinds: To do and To maintain

Migrations `supabase/migrations/20261010000200_item_kind.sql` and
`20261010000300_item_good.sql` (What good looks like, below); types `Item.kind`,
`ItemDraft.kind`, `SeedItem.kind?` (`'task' | 'state'`, `ItemKind` in `src/lib/types.ts`).

- **To do** (`task`, default): as before. A one-off one leaves the list when done, a repeating
  one moves to its next due date.
- **To maintain** (`state`): kept track of, never done. No due date, repeat or reminder (the
  database trigger, `applyKindRules()` in `src/lib/logic/items.ts`, the demo backend and the
  Item sheet all agree). Its RAG status, note, area and who looks after it are edited as usual.
- Changing kind is allowed both ways. A state that becomes a task gets the new-item defaults
  (due in 7 days, Never, 1 day before) from the Item sheet (`withKind()`); a task that becomes
  a state keeps its task fields in the sheet's draft until it is saved, so switching back
  before saving restores them.
- **Item sheet**: a two-option segmented control (**To do**, **To maintain**; the Stats control
  style) under the title and note, above the RAG picker. For To maintain the Due, Repeat and
  Notify rows and Mark as Done are hidden, "Assigned to" reads **Looked after by**, and
  **What good looks like** appears under the control (see below).
- **Home row**: a task keeps its hollow status ring (tap to complete). A state shows a solid
  14px dot in its RAG colour in the ring's place; it is not a button and taps go through to the
  row, which opens the sheet. Its meta line reads `🦊 Ela · Updated Tue 6 Oct` (or
  `Unassigned · Updated …`), from `updated_at` in the household time zone (`itemMeta(item,
  members, today, timeZone)`). Assistive tech hears `<title>, Red, to maintain`.
- **Order** within an area (`compareItems`): tasks first (due date, undated last, then oldest),
  then states by title.
- **What good looks like** (`items.good`, migration
  `supabase/migrations/20261010000300_item_good.sql`; `Item.good`, `ItemDraft.good`,
  `SeedItem.good?`, `TEXT_LIMITS.itemGood` = 4000): free text saying how a state should be kept
  ("Cover on when not in use, ash cleared out, logs dry and stacked under the bench."), next to
  its note, which says how it is now. Every item has the column (default ''), tasks too: the
  app only shows it for a state, and nothing but an edit changes it (not the kind trigger,
  `complete_item` or `undo_completion`), so an item switched to To do and back keeps it. Same
  RLS as the rest of the row (every member edits it), same 4000-character limit as the note.
  In the Item sheet it appears for To maintain only, under the type control and above the RAG
  picker: a section header (20/25/600) "What good looks like" that labels a white card which
  is itself an auto-growing textarea (17/22, two lines tall when empty, placeholder "Describe how
  it should be kept, e.g. cover on, logs dry and stacked"). It is part of the draft: trimmed on
  save, sent only when changed, and an edit makes Close ask before discarding. Choosing To do
  hides it but keeps the text in the draft. Home rows do not show it.
- **Seed**: SEED_ITEMS has the state "Firepit" (Garden, green, Ela in the demo), with its
  "What good looks like".
- Demo documents stored before kinds existed read their items as tasks, and items stored before
  "What good looks like" existed read as `good: ''`.

## Chat (household group chat)

One group chat per household. Every member can read and post; messages are **kept forever**
(no retention limit, no automatic deletion). Anyone can react to any message with emoji;
each member can add several different emoji to the same message, once each. A member can
delete only their own messages (and remove only their own reactions). Messages cannot be
edited.

### Tables (migration `supabase/migrations/20261010000100_chat.sql`)

| table | columns |
| --- | --- |
| `messages` | id uuid pk, household_id → households on delete cascade, member_id → members on delete set null (null = former member), body text not null (trimmed, 1 to 4000 chars), created_at timestamptz not null default now(); index (household_id, created_at desc) |
| `message_reactions` | message_id → messages on delete cascade, member_id → members on delete cascade, household_id → households on delete cascade (copied from the message), emoji text not null (one of the app's reaction emoji, `REACTION_EMOJIS`), created_at; primary key (message_id, member_id, emoji) |

Check constraints (SQLSTATE 23514, which the client maps to `invalid_input`):
`messages_body_length` (1 to 4000 characters after trimming), `message_reactions_emoji_length`
(1 to 16 characters) and `message_reactions_emoji_allowed` (exactly one of the 32
`REACTION_EMOJIS` in `src/lib/constants.ts`, same code points including U+FE0F;
`src/lib/constants.test.ts` compares the two lists). Check constraints run in name order, so
`_allowed` reports first.

Triggers (security definer, empty `search_path`, not callable by clients): on INSERT into
`messages`, `member_id := coalesce(current_member_id(), member_id)` (the service role keeps
what it sends) and the body is trimmed of the same whitespace as JavaScript's `trim()` (not
only spaces, so a body of only newlines is rejected); on INSERT into `message_reactions`, the
same for `member_id`, and `household_id` from the message (a missing message raises
`not_found`).

RLS: `messages` SELECT where `is_household_member(household_id)`, INSERT where member and
`member_id = current_member_id()`, DELETE where `member_id = current_member_id()`, no UPDATE.
`message_reactions` the same. Grants: messages select, insert (household_id, body), delete;
message_reactions select, insert (message_id, emoji), delete. `anon` gets nothing. Both tables
join the `supabase_realtime` publication with replica identity full, like the other published
tables.

### Backend methods (`src/lib/backend/types.ts`)

`listMessages(householdId, { before?, limit? })` pages backwards by `created_at` (oldest first
within a page, `hasMore` when older ones exist); `getMessages(ids)` reloads specific messages
with reactions; `sendMessage`, `deleteMessage`, `setReaction(messageId, emoji, on)`;
`subscribeChat(householdId, onChange)` reports `ChatChange` events: a message added or deleted,
a reaction changed on a message, or `resync`. The Supabase backend maps realtime events on
both tables to these (a DELETE carries the primary key, which is enough); the demo backend
emits them for its own writes and on `storage` events from other tabs.

Both backends behave the same on the edges: a household the caller cannot see is `not_found`;
a blank body or one over 4000 characters (an emoji counts as one) is `invalid_input: body`;
deleting a message that is not yours (or is gone) is `not_found`; adding a reaction is
idempotent, needs one of `REACTION_EMOJIS` (`invalid_input: emoji` otherwise) and an existing
message (`not_found`); removing one touches only your own and never errors when nothing
matches. Messages order by `created_at` to the microsecond (`instantOf` in
`src/lib/logic/chat.ts`; a JS Date stops at milliseconds), then id.

- Supabase: `listMessages` embeds reactions in one request (`reactions:message_reactions(...)`,
  sorted oldest first in the client), caps `limit` at 999 (the API returns at most 1000 rows
  and one extra row tells `hasMore`), never ends a page inside a group of messages sharing one
  `created_at` (a group bigger than the page is returned whole, so a page can then be longer
  than `limit`), and passes `before` on unchanged, microseconds included (never through a JS
  Date). `sendMessage` sends only `household_id` and `body`. `subscribeChat` listens on one
  channel to both tables with `household_id=eq.<id>` for every event, deletes included,
  maps a messages DELETE `old.id` and a message_reactions `message_id` to `ChatChange`, and
  emits `resync` on every join (the first included). A new subscription may first replay
  changes made shortly before it joined, so handling is idempotent.
- Demo: messages and reactions live in the same localStorage document (`messages`,
  `message_reactions`). Listeners hear a write synchronously, just before its promise
  resolves; no-op writes emit nothing; another tab's change to this household's chat emits
  `resync`. Every demo household starts with a short seeded conversation between Stratis,
  Shea and Ela.
- `ChatProvider` merges by id only, keeps a sent message's bubble key, takes a stored message
  for a pending send only if it was posted after the send began (and gives the bubble back if
  the send then fails), and on `resync` reloads the newest page and then the older loaded
  messages it doesn't cover.

### UI

- Tab switch under the hero: **Home, Chat, Housekeeping, Stats**. The round + (new item) floats
  at the bottom right on Home and Stats, not on Chat or Housekeeping. A small dot on Chat means unread messages from others (last-read time is kept per
  member on this device); one on Housekeeping means a message for the housekeeper written or
  changed by someone else since the member last had that tab open on this device. The app
  reopens on the tab last open on this device (`homeos.tab` in localStorage, Home when there is
  none), so the housekeeper lands on Housekeeping.
- Chat screen: large title "Chat", message bubbles (own on the right in the tint colour, others
  on the left in white with the sender's emoji and name), reactions as small chips under a
  bubble (tap a chip to add or remove that reaction), long-press (or the context-menu key /
  right-click / Enter on a focused bubble) on a bubble opens the reaction bar (six quick
  reactions plus "+" for the full grid) with Copy and, for your own messages, Delete (confirmed;
  from the keyboard, focus moves on to the next message). Older messages load as you scroll up.
- Runs group one sender's messages within 5 minutes (the name over the first, the avatar beside
  the last, the tail on the last bubble). Separators read "Today 08:05", "Yesterday 18:42" or
  "Tue 6 Oct 18:42" in the household's time zone and also appear after an hour's pause. A
  message of only one to three emoji shows large with no bubble. A missing sender reads
  "Former member".
- The unread dot uses a last-read time per member on this device, in localStorage under
  `homeos.chat.read.<memberId>`.
- Composer: sits at the bottom. While typing it follows the iPhone keyboard
  (`visualViewport`); when the field was tapped
  with a finger, it stays where it was until the keyboard's height is known (or 600 ms pass),
  so it never drops behind the rising keyboard first. Tapped with a finger, Return starts a new
  line and the round button sends (like Messages); with a hardware keyboard, Enter sends and
  Shift+Enter starts a new line; Ctrl or Cmd+Enter always sends. The send button is
  `aria-disabled` while blank, so Tab from the field reaches it. On Chat,
  toasts sit above the composer (`--toast-bottom`, set by ChatScreen and read by `Toast`).
- Home: each area header has a small + that opens the new-item sheet with that area chosen
  (see "Home" above).

## Housekeeping

The third tab: the weekly visit by the housekeeper. She is a household member like everyone
else (signs in with Google, joins with the invite link) and, like everyone, can edit
everything. There are no roles. Out of scope: push notifications, the weekly email, roles and
payments.

### Product rules

- **Message for the housekeeper**: one household-wide note that any member writes to give
  direction. Multi-line, trimmed, up to 4000 characters (`TEXT_LIMITS.housekeepingNote`). It
  shows who last changed it and when, can be cleared, and stays until someone changes it.
  Undo after Clear puts it back as it was, with who wrote it and when (not as a new edit by
  whoever undid it), as long as nobody has written a new one since.
- **Task list**: the household's housekeeping tasks (the template every visit copies). Anyone
  adds, renames, deletes and reorders them. Titles are trimmed, 1 to 200 characters
  (`TEXT_LIMITS.housekeepingTask`). New households start with `HOUSEKEEPING_STARTER_TASKS`:
  Change the bed sheets; Hoover and mop the floors; Clean the bathrooms; Clean the kitchen;
  Dust the surfaces; Empty the bins; Ironing. Households that existed before the migration get
  the same list once (only those with no task and no visit).
- **Visits**: at most one per household and day (the household's time zone), today or earlier,
  never in the future. A visit is created by the first write for its day: ticking or unticking
  a task, saving comments or the price, or "Add a visit". When it is created it copies:
  - the task list: each task's title and position, none done, one row per task;
  - the message as it stood that day: its text if it was last changed on or before the visit's
    day (household time; always so for today), otherwise '' (it has changed since, so what it
    said that day is not known).

  It records who created it and when ("Recorded by") and who changed it last.
- **A visit counts once something is recorded on it**: a task ticked, comments or a price
  (`isRecorded()`). One with none of these (a tick taken back, "Add a visit" with nothing
  filled in yet) is still stored and editable, but it is not a visit anywhere it would claim
  one: no dot in the calendar, not in the month's total, not in the day's label, not "Today's
  visit" or the last visit in the subtitle, never chosen by default. Under it: "Not started
  yet." for today, "Nothing recorded yet." for another day.
- **History stays true**: each visit keeps its own rows (title, done, who ticked it and when).
  Renaming or deleting a task never rewrites an earlier visit. A tick writes only its own row,
  atomically, so two people ticking at once never undo each other (no read-modify-write of a
  list).
- **Today's visit follows the list**: when today's visit exists, adding a task adds it there
  (not done), reordering moves it there, renaming renames it there unless it is ticked, and
  deleting removes it there unless it is ticked. A ticked row is a record of what was done: it
  keeps the title it was ticked under and stays when its task is deleted. Visits on earlier
  days never change.
- **Comments**: free text, trimmed, up to 4000 characters. **Price for the day**: GBP, typed on
  a decimal keypad, stored as whole pence from 0 to 1,000,000 (`HOUSEKEEPING_PRICE_MAX_PENCE`,
  £10,000.00), shown as £45.00; null means not entered.
- A visit's copy of the message is read-only. Its ticks, comments and price stay editable on
  any day (everyone edits everything), and anyone can delete a visit (confirmed), for everyone:
  today's from the Today section once something is recorded on it, another day's under the
  calendar.
- **Live**: changes by others show up as they happen, like items (`Backend.subscribe`, reload
  on any event).

### Tables (migration `supabase/migrations/20261010000400_housekeeping.sql`)

| table | columns |
| --- | --- |
| `housekeeping_notes` | household_id uuid **primary key** → households on delete cascade, body text not null default '' (trimmed, <= 4000), updated_at timestamptz not null default now(), updated_by → members on delete set null; cleared_body text null, cleared_updated_at timestamptz null, cleared_updated_by → members on delete set null (what the last Clear took away, for Undo; null otherwise). No row = never written. |
| `housekeeping_tasks` | id, household_id → households on delete cascade, title text not null (trimmed, 1 to 200), position int not null default 0, created_at |
| `housekeeping_visits` | id, household_id → households on delete cascade, visit_date date not null, note text not null default '' (the copy of the message, <= 4000), comments text not null default '' (<= 4000), price_pence int null (0 to 1,000,000), created_by → members on delete set null, created_at, updated_by → members on delete set null, updated_at; **unique (household_id, visit_date)** |
| `housekeeping_visit_tasks` | id, visit_id → housekeeping_visits on delete cascade, household_id → households on delete cascade (copied from the visit), task_id → housekeeping_tasks **on delete set null**, title text not null (1 to 200), position int not null default 0, done bool not null default false, done_by → members on delete set null, done_at timestamptz null; **unique (visit_id, task_id)** |

Check constraints (SQLSTATE 23514; the client maps them to `invalid_input: <constraint>`):
`housekeeping_notes_body_length`, `housekeeping_tasks_title_length` (a blank title is trimmed
to '' and fails it too), `housekeeping_visits_note_length`,
`housekeeping_visits_comments_length`, `housekeeping_visits_price_range`,
`housekeeping_visit_tasks_title_length`. Unique constraints: `housekeeping_visits_one_per_day`,
`housekeeping_visit_tasks_task_once`.

Triggers on `housekeeping_tasks` (security definer, empty `search_path`, not callable by
clients):

- BEFORE INSERT or UPDATE (`housekeeping_tasks_before_write`): trims the title (the same
  whitespace as JavaScript's `trim()`, `js_trim()`); an insert always goes last (position =
  the household's highest + 1, whatever the client sent); an update keeps household_id and
  created_at.
- AFTER INSERT (`housekeeping_tasks_after_insert`): adds the task to today's visit, if any.
- AFTER UPDATE (`housekeeping_tasks_after_update`): a new position is copied to today's visit's
  row for the task, and a new title too unless that row is ticked (it keeps the title it was
  ticked under).
- BEFORE DELETE (`housekeeping_tasks_before_delete`): removes today's visit's row for the task
  unless it is done (before the foreign key sets task_id to null on every visit's rows).

Creating a visit, adding a task and the AFTER UPDATE trigger take a per-household
transaction-level advisory lock (`housekeeping_lock()`), so a task added or renamed at the
moment today's visit is created is never missed. Creating a visit copies the task list with
`FOR KEY SHARE`, so a task being deleted at that moment is waited for and then left out (the
tick that created the visit stands) rather than failing the foreign key.

Internal helpers (not callable by clients): `js_trim(text)`, `housekeeping_starter_tasks()`
(the starter list; `src/lib/constants.test.ts` and `supabase/tests/housekeeping.test.mjs`
compare it with `HOUSEKEEPING_STARTER_TASKS`), `household_today(uuid)`,
`housekeeping_lock(uuid)`, `housekeeping_lock_visit(uuid)` (locks a visit row for the write,
false when it was deleted meanwhile) and `housekeeping_visit_for(household, date, member)`
(finds or creates the visit with its copies; `not_found` for an unknown household,
`invalid_input` for a null or future date).

### RLS and grants

- `housekeeping_notes`: SELECT where `is_household_member(household_id)`. Written only by
  `set_housekeeping_note` and `undo_clear_housekeeping_note`.
- `housekeeping_tasks`: SELECT, INSERT, UPDATE, DELETE where member. Grants: select, delete,
  insert (household_id, title), update (title). Positions change only through
  `reorder_housekeeping_tasks` (and the insert trigger).
- `housekeeping_visits`: SELECT, DELETE where member. Written only by the RPCs.
- `housekeeping_visit_tasks`: SELECT where member. Written only by the RPCs and the task
  triggers; deleted with their visit.

`anon` gets nothing; `service_role` gets everything.

### RPCs (`security definer`, `set search_path = ''`, `grant execute … to authenticated`)

Each checks the caller first: no user is `not_signed_in`, and not a member of
`p_household_id` is `not_found`.

1. `set_housekeeping_note(p_household_id uuid, p_body text) returns void`. Trims; '' clears.
   The same text again changes nothing (the stamp stays); clearing a message that was never
   written stores nothing. Otherwise stamps updated_at and updated_by (the caller).
2. `reorder_housekeeping_tasks(p_household_id uuid, p_task_ids uuid[]) returns void`.
   position = index in the array; ids from other households are ignored. Today's visit
   follows (trigger).
3. `add_housekeeping_visit(p_household_id uuid, p_visit_date date) returns uuid`. "Add a
   visit": creates the visit on that day (nothing ticked) or returns the one already there.
4. `tick_housekeeping_task(p_household_id uuid, p_visit_date date, p_task_id uuid,
   p_visit_task_id uuid, p_done boolean) returns uuid` (the visit id). Exactly one of
   `p_task_id` (the row copied from that task on the visit on `p_visit_date`, creating the
   visit first if there is none) and `p_visit_task_id` (that row, on any visit of the
   household; `p_visit_date` is not used); both, neither or a null `p_done` is
   `invalid_input`. No such row is `not_found`, and a visit the call created is rolled back
   with it. A row already in that state is left alone. A tick sets done_by (the caller) and
   done_at (now), an untick clears both, and the visit's updated_at and updated_by are
   stamped. The row is locked and written on its own. The visit is locked first, in the
   order deleting a visit takes them (the visit, then its rows), so a tick and a delete at the
   same moment never deadlock: the tick waits, then finds the visit gone (`not_found`).
5. `save_housekeeping_visit(p_household_id uuid, p_visit_date date, p_patch jsonb) returns
   uuid` (the visit id). Keys: `comments` (a string, trimmed) and `price_pence` (a whole
   number, or null to clear); other keys are ignored; a wrong type (or a patch that is not an
   object) is `invalid_input`; the ranges are the check constraints'. Creates the visit if
   needed; stamps updated_at and updated_by only when something changed. A visit deleted at
   that very moment is `not_found` (the save is not lost quietly).

6. `undo_clear_housekeeping_note(p_household_id uuid) returns void`. Undo after Clear: puts
   back `cleared_body` with `cleared_updated_at` and `cleared_updated_by` as the message and
   its stamp, and forgets them, only while the message is still '' (a message written since
   stays). Nothing to put back changes nothing. `set_housekeeping_note` fills the `cleared_*`
   columns when it clears a message and empties them when it writes one.

`create_household` is redefined (same signature, copied from
`20261010000300_item_good.sql`) to also insert the starter task list, in order. A visit is
deleted with a plain DELETE on `housekeeping_visits` (RLS); its rows go with it.

Existing households get the starter list once: on the file's first run (the one that creates
`housekeeping_tasks`; the file records that in the session setting
`homeos.housekeeping_backfill` at its top and clears it at the end), each household with no
task and no visit gets it. Applying the file again changes no data, so a list someone emptied
stays empty.

Realtime: the four tables join `supabase_realtime` (guarded, so the file also runs on plain
Postgres) with replica identity full; `Backend.subscribe` listens to each with
`household_id=eq.<id>`.

### Data in the app

`HouseholdData.housekeeping: HousekeepingData` (`src/lib/types.ts`), loaded by `Backend.load`
with the rest of the household:

- `note: HousekeepingNote`, `{ body, updated_at, updated_by }` (never written:
  `{ body: '', updated_at: null, updated_by: null }`);
- `tasks: HousekeepingTask[]`, by position (then created_at, id);
- `visits: HousekeepingVisit[]`, every visit, newest first, each with its
  `tasks: HousekeepingVisitTask[]` by position, then title, then id.

`HousekeepingTickTarget` is `{ taskId }` (a row whose task is still on the list; this also
works for a day with no visit yet, which the tick then creates) or `{ visitTaskId }` (a row
whose task has been deleted). `checklistFor()` picks it. `HousekeepingVisitPatch` is
`{ comments?, price_pence? }` (only the keys present are written).

### Backend methods (`src/lib/backend/types.ts`)

| method | Supabase | Demo |
| --- | --- | --- |
| `setHousekeepingNote(householdId, body)` | rpc `set_housekeeping_note` | same rules |
| `undoClearHousekeepingNote(householdId)` | rpc `undo_clear_housekeeping_note` | same rules |
| `createHousekeepingTask(householdId, title)` → `HousekeepingTask` | insert `{ household_id, title }`, select `id, household_id, title, position` | appends, adds to today's visit |
| `renameHousekeepingTask(id, title)` | update `{ title }` (no row: `not_found`) | renames, today's visit too unless ticked there |
| `deleteHousekeepingTask(id)` | delete (no row: `not_found`) | today's undone row goes, other rows keep it with task_id null |
| `reorderHousekeepingTasks(householdId, orderedIds)` | rpc `reorder_housekeeping_tasks` | same rules |
| `setHousekeepingTaskDone(householdId, date, target, done)` → visit id | rpc `tick_housekeeping_task` | same rules |
| `saveHousekeepingVisit(householdId, date, patch)` → visit id | rpc `save_housekeeping_visit` (only the keys present) | same rules |
| `addHousekeepingVisit(householdId, date)` → visit id | rpc `add_housekeeping_visit` | same rules |
| `deleteHousekeepingVisit(id)` | delete on `housekeeping_visits` (no row: `not_found`) | rows go with it |

- Supabase: `load` adds three reads to its `Promise.all`, all through `runAll`: the note
  (`body, updated_at, updated_by`; no row reads as never written), the tasks
  (`id, household_id, title, position`, ordered by position, created_at, id) and the visits
  with their rows embedded (`id, household_id, visit_date, note, comments, price_pence,
  created_by, created_at, updated_by, updated_at, tasks:housekeeping_visit_tasks(id, visit_id,
  household_id, task_id, title, position, done, done_by, done_at)`, ordered by visit_date
  descending, rows sorted in the client). An id that is not a uuid is `not_found` without a
  request (like chat); a date that is not `YYYY-MM-DD` is `invalid_input: date`; a blank title
  is `invalid_input: title` (like `requireText`). Also refused before any request: a tick
  target that is not exactly one of `taskId` and `visitTaskId` (`invalid_input: target`), and
  a price that is not a whole number or null (`invalid_input: price`; JSON would send NaN or
  Infinity as null and clear the price). In `reorderHousekeepingTasks` an id that is not a uuid
  is sent as the nil uuid, so it keeps its place in the order and names no task.
  `subscribe` adds the four tables.
- Demo (`src/lib/backend/demo.ts`): four collections in the document (`housekeeping_notes`,
  `housekeeping_tasks`, `housekeeping_visits`, `housekeeping_visit_tasks`) with the SQL
  columns. `read()` fills them in for documents stored before them, and a document without the
  `housekeeping_tasks` key gets the starter list for each household once, like the migration.
  The semantics mirror the SQL exactly, the copy rules, today's visit following the list,
  idempotent ticks and the note's "same text" rule included. Errors: `not_found` where SQL
  says so; `invalid_input: date` (future or malformed), `invalid_input: title` (blank or over
  200), `invalid_input: note`, `invalid_input: comments` (over 4000), `invalid_input: price`
  (not a whole number, below 0 or over the maximum), `invalid_input: target` (both or
  neither). `createHouseholdIn` gives every demo household (`?demo-seed=1` included) the
  starter list, `HOUSEKEEPING_DEMO_NOTE` and `HOUSEKEEPING_DEMO_VISITS` from
  `src/lib/constants.ts`, in the household's time zone and never in the future. It must not
  call the stubbed functions of `src/lib/logic/housekeeping.ts` (only `emptyHousekeeping()`),
  so the backend and the UI can be built side by side.

### HomeProvider (`src/state/HomeProvider.tsx`)

`HomeContextValue` actions (the names and signatures are fixed; the data is
`data.housekeeping`): `setHousekeepingNote(body)`, `undoClearHousekeepingNote(previous)`
(shows `previous`, the message as it was before Clear, at once, and sends the Undo after any
message write still in flight, so it never overtakes its Clear), `createHousekeepingTask(title)` →
`HousekeepingTask`, `renameHousekeepingTask(id, title)`, `deleteHousekeepingTask(id)`,
`reorderHousekeepingTasks(orderedIds)`, `setHousekeepingTaskDone(date, target, done)`,
`saveHousekeepingVisit(date, patch)`, `addHousekeepingVisit(date)`,
`deleteHousekeepingVisit(id)`. All go through `mutate()` with a revert that takes back only
what the action touched, like the other edits (a failed write shows "Couldn't save." and
rejects). The optimistic copies come from `src/lib/logic/housekeeping.ts`:

- a write for a day with no visit shows a pending visit at once (`newVisit()`, id
  `pending:<date>`, rows `pending:<taskId>`); further writes for that day apply to it locally
  and are sent with `{ taskId }` targets; a failure removes it; the reload swaps in the real
  visit under the same row keys (`ChecklistRow.key`), so a focused checkbox keeps its focus;
- ticks use `applyTick()`, comments and price `applyVisitPatch()`, list edits
  `withTaskRenamed()`, `withTaskDeleted()`, `withTasksReordered()` (today's visit follows);
- `createHousekeepingTask` is not optimistic: it resolves to the stored task, like
  `createArea`, so the sheet can focus its name; the stored task shows on the list (and on
  today's visit, `withTaskAdded()`) as soon as it resolves, before the reload;
- the message shows `me` and now as who changed it; unchanged text (after trimming) sends
  nothing;
- each revert puts back only what its write set, where the screen still shows what it set
  (a later edit to the same field, tick or message is left alone); optimistic stamps always
  move forward, even within one millisecond, so a revert can tell its own from a later one;
- a date after `today` is refused without a write or a toast
  (`BackendError('unknown', 'invalid_input: date')`);
- each day's visit writes are tracked with the visit id they return, so deleting a pending
  visit (`pending:<date>`, shown before its write came back or before a reload brought its id)
  waits for that day's writes and deletes the stored visit by that id; if none of them stored
  it, nothing is sent.

### Logic (`src/lib/logic/housekeeping.ts`)

Pure functions; each doc comment is the spec and ends with the unit tests it needs ("Tests:",
for `src/lib/logic/housekeeping.test.ts`). Calendar: `WEEKDAYS` (Monday first), `monthOf`,
`shiftMonth`, `monthTitle` ("October 2026"), `monthGrid` (weeks of 7, Monday first, null
padding), `canHaveVisit`, `longDay` ("Thursday 1 October"), `calendarDayLabel` (", selected"
for the chosen day), `defaultSelectedDay` (today's month, or any month),
`daySelectedAnnouncement`. Visits: `isRecorded`, `visitOn`, `visitDays`, `monthTotals`,
`monthSummary` ("4 visits · £180.00", "2 visits", "No visits"), `doneCount`,
`housekeepingSubtitle`. Prices:
`formatPrice` ("£1,234.50"), `priceInputValue` ("1234.50"), `parsePrice`. Checklist:
`checklistFor`, `matchesTarget`. Bylines: `visitByline`, `noteByline`, `doneByline`. The tab's
dot: `hasNewNote`.
Optimistic edits: `snapshotNote`, `newVisit`, `applyTick`, `applyVisitPatch`,
`withTaskAdded`, `withTaskRenamed`, `withTaskDeleted`, `withTasksReordered`.
`emptyHousekeeping()` is the empty state.

### UI

Files under `src/screens/housekeeping/` (each with a `.module.css` where it has styles):

| file | what |
| --- | --- |
| `HousekeepingScreen.tsx` (+ `.test.tsx`) | the tab: `Screen` with the sections below and the live region (`data-announcer`) |
| `NoteSection.tsx` | "Message for the housekeeper" |
| `VisitEditor.tsx` | one day's checklist, comments, price and byline (today, and the selected day) |
| `DeleteVisit.tsx` | the Delete Visit card and its confirmation (today's, and the selected day's) |
| `SaveStatus.tsx` | "✓ Saved" for a moment, and "Not saved. Try again" after a failed save |
| `useNewNote.ts` | the Housekeeping tab's dot (a new message from someone else) |
| `Checklist.tsx` | the tasks as checkboxes |
| `PriceField.tsx` | the £ field: parse, format, error |
| `Calendar.tsx` | month header and summary, the month grid |
| `DayDetail.tsx` | the selected day under the calendar |
| `TaskListSheet.tsx` | the page sheet that edits the task list; App mounts it beside the stage, like the Item sheet, so the screen behind is pushed back |
| `useSavedText.ts` | the message and comments fields: save after a pause and on blur, keep a draft while editing or after a failed save |
| `Housekeeping.module.css` | the shared sections, cards, captions, price row and empty states |

Elsewhere: `screens/types.ts` (`Tab` already includes `'housekeeping'`), `screens/home/TabBar.tsx`
and its CSS (four tabs), `App.tsx` (renders `HousekeepingScreen` for the tab), the comments in
`ui/Screen.tsx` and `TabBar.tsx` (they now say "Home / Chat / Housekeeping / Stats"), `e2e/fixtures.ts`
(`housekeepingScreen(page)`, `'Housekeeping'` in `tabButton` and `goToTab`), and the tests that
pin three tabs (`src/App.test.tsx` "tab bar", `e2e/onboarding.spec.ts` and any other).

**Tab switch.** Home, Chat, Housekeeping, Stats, in that order, in the same `nav` named "Tabs"
with `aria-current="page"` on the open one (keep that contract and Chat's unread dot).
Housekeeping has a dot too (named "Housekeeping, new message") while `useNewNote()` says the
message is new to this member (`hasNewNote()`, last seen kept per member on this device). The
app reopens on the tab last open on this device. Segments
size to their labels (Housekeeping is the longest): flex items with equal extra space, labels
on one line, never truncated. The white thumb follows the open segment: its left and width come
from that button's `offsetLeft` and `offsetWidth`, measured in a layout effect and again on
resize (`ResizeObserver`), and it slides over 0.34s (`--sheet-ease`, no animation with Reduce
Motion; hidden until first measured). It must fit with no truncation and no sideways scroll at
320, 375 and 402px wide (16px gutters, so 282px inside the switch at 320). Keep 15px labels
where they fit; if they don't at 320, drop to 14px and tighter padding below 340px only.
Measure it in the e2e test rather than trusting estimates. The round + shows on Home and Stats only, and
pops in when you come back from a tab without it.

**Screen**, top to bottom (16px gutters, white cards radius 24, section headers 20/25/600 as
`h2`, rows 17/22):

1. `ScreenHeader`: the hero with the title **Housekeeping**, the secondary line
   `housekeepingSubtitle()` ("Today's visit", "Last visit Thu 1 Oct" or "Weekly") and the
   avatar; then the tab switch. `Screen` with `label="Housekeeping"` and `withAdd={false}`.
2. **Message for the housekeeper** (`NoteSection`): the `h2`, with **Clear** on the right
   (15px tint text button, `aria-label="Clear message"`; with nothing to clear it stays in place,
   dimmed and `aria-disabled`, so focus and VoiceOver keep their place after a Clear). A card
   that is an auto-growing textarea (`AutoGrowTextarea` from `screens/item`, two lines when
   empty, `maxLength` 4000, labelled by the `h2`), placeholder "Anything to do first, or
   differently? e.g. please do the spare room first". Under the card, 13/18 secondary:
   `noteByline()` ("🦆 Shea · Yesterday 19:20"), nothing when empty. It saves
   `HOUSEKEEPING_SAVE_DELAY_MS` (1s) after the last keystroke and on blur, when the trimmed
   text differs from the stored one. Clear empties it at once and shows the toast "Message
   cleared" with **Undo** (`undoClearHousekeepingNote`: the old text back under its writer's
   name and time). After a save, the byline starts with "✓ Saved ·" for 2s (`SAVED_FLASH_MS`);
   a failed save keeps the text in the field (unsaved typing, sent again on the next pause or
   blur) and shows "Not saved." with **Try again** in place of the byline.
3. **Today** (`h2`, with **Edit** on the right: 15px tint text, `aria-label="Edit task list"`,
   opens `TaskListSheet`), then `VisitEditor` for `today`:
   - the checklist card (`Checklist`, rows from `checklistFor()`): each row a `label` with a
     native checkbox drawn as a 24px iOS circle (empty: 1.5px #C7C7CC ring; ticked: filled
     `--tint` with a white check), the title at 17/22, and when ticked a second line at 13/18
     secondary, `doneByline()` ("🦊 Ela · 10:42"); rows at least 52px tall, hairlines inset to
     the text. The whole row toggles; the change is saved at once
     (`setHousekeepingTaskDone(date, row.target, checked)`). With no tasks: "No tasks yet." and
     a tint **Add tasks** button that opens the sheet.
   - **Comments** (section header) and a card that is an auto-growing textarea, placeholder
     "Anything to mention, e.g. we're out of bin bags", `maxLength` 4000; saved 1s after the
     last keystroke and on blur when the trimmed text changed.
   - A card with one row: **Price for the day** on the left, on the right "£" (aria-hidden)
     and a text field (`inputMode="decimal"`, `enterKeyHint="done"`, `autoComplete="off"`,
     placeholder "0.00", right-aligned, `aria-label="Price for the day"`) showing
     `priceInputValue()`. On blur: `parsePrice()`; valid and changed saves (blank clears) and
     the field shows the formatted value; invalid keeps the text, sets `aria-invalid` and shows
     under the card (13/18, `--rag-red-text`, `role="alert"`): "Enter an amount like 45.00, up
     to £10,000.00."
   - Under the cards, 13/18 secondary: `visitByline()` ("Recorded by 🦊 Ela · Today 10:42"),
     or while nothing is recorded "Not started yet. Ticking a task starts today's visit." ("Not
     started yet. Comments or a price start today's visit." when the list is empty).
   - Saving: "✓ Saved" (13px tint, hidden from assistive tech, which hears the live region)
     shows for 2s on the right of the Comments heading after comments save, and before the
     byline after the price saves. A failed save keeps what was typed (comments as unsaved
     typing, the price in its field) and shows "Not saved." with **Try again** (named "Try again
     to save the comments" / "the price") under that card until it saves; Escape in the price
     field goes back to the stored price.
   - Once something is recorded today, a card with **Delete Visit** under it, as on other days
     (title "Delete today's visit?"); afterwards focus goes to the Today heading.
4. **Calendar** (`h2`, `Calendar`): one card. Its top row: a previous-month button (chevron,
   `aria-label="Previous month"`), the month title centred (17/22/600, `monthTitle()`), a
   next-month button (`aria-label="Next month"`, disabled on today's month: no visits can be
   ahead). Under the title, 15/20 secondary: `monthSummary(monthTotals())` ("4 visits ·
   £180.00"). Then the grid: weekday letters (13/18/600 secondary, `WEEKDAYS`), then the weeks
   of `monthGrid()`. Each day's button fills its cell (46px tall, square, so a tap anywhere in
   the cell counts) and draws a round 40px circle (36px below 360px wide) with its number:
   today has a tint number and a 1.5px tint ring, the selected day is filled with the tint and
   has a white number, a day with a visit has a 5px dot under its number (tint; white when
   selected), and future days are dimmed (`--label-tertiary`) and disabled. The month and the
   selected day are remembered while the app runs (like Stats' period). On first opening: the
   month of today and `defaultSelectedDay()` (the latest recorded visit this month before
   today, else nothing). Changing month chooses that month's latest recorded visit, or nothing,
   never a day from another month. Choosing a day says what is there through the live region
   (`daySelectedAnnouncement()`: "Thursday 1 October: 6 of 7 done, £60.00. Details below the
   calendar.") and, when its heading is low on the screen, scrolls it up (`scrollIntoView`,
   `block: 'nearest'`, the heading's `scroll-margin-bottom` 45vh; no smooth scroll with Reduce
   Motion); focus stays on the day.
5. **The selected day** (`DayDetail`, under the calendar card):
   - nothing selected: 15/20 secondary "Tap a day to see its visit."
   - a heading (`h3`, 20/25/600): `longDay()` ("Thursday 1 October");
   - today: "Today's visit is above." and a tint **Show** button (`aria-label="Show today's
     visit"`) that scrolls the Today section into view and focuses its heading (`tabIndex={-1}`);
   - a past day without a visit: "No visit recorded." and a tint **Add a visit** button
     (`addHousekeepingVisit(date)`; focus then moves to the first checkbox);
   - a past day with a visit: a card **Message that day** (13/18 secondary label above 17/22
     text, read-only; "No message that day." when empty), then `VisitEditor` for that date
     (editable, same as today; its fields are named with the day, "Comments, Thursday 1
     October" and "Price for the day, Thursday 1 October", so they can't be mistaken for
     today's), then a card with a centred **Delete Visit** button (17px, `--destructive`). It
     asks first (`ActionSheet`): title "Delete the visit on Thu 1 Oct?", message "Its ticks,
     comments and price will be deleted for everyone.", action **Delete Visit** (destructive).
     After deleting, the day shows "No visit recorded." and focus moves to **Add a visit**.
6. **Task list sheet** (`TaskListSheet`): a page `Sheet` labelled "Task list". Nav bar
   (`data-sheet-handle`): the title "Task list" centred (17/22/600) and **Done** on the right
   (17px/600 tint), which closes it. The body (`data-sheet-scroll`) is one card that looks and
   behaves like the Household editor's areas (`screens/profile/AreaList.tsx`, with the same styles;
   both take their drag and keyboard reorder from `ui/useReorder.ts`):
   each row has a red minus (`aria-label="Delete <title>"`), the title edited in place
   (`InlineText`, `aria-label="Task name"`, `maxLength` 200; blank puts the old title back)
   and a grip (`aria-label="Reorder <title>"`, drag, or the up and down arrow keys;
   announced "<title> moved to position 2 of 7."). The last row is **Add Task** (plus icon,
   tint): it adds `HOUSEKEEPING_NEW_TASK` ("New task") and focuses its name with the text
   selected (with the same stand-in input trick so iOS raises the keyboard). Under the card,
   13/18 secondary: "Changes show in today's visit too. Earlier visits keep their own list."
   Delete asks first: title "Delete <title>?", message "Earlier visits keep it.", action
   **Delete Task**. The list may be empty. When it closes, focus goes back to the button that
   opened it (Edit, or Add tasks; Edit if that has gone), however it was opened: a VoiceOver
   double tap is a tap, and focus moved by script after a tap shows no ring.

**States.** Everything is in `data.housekeeping`, so the tab never shows a spinner. Ticks,
comments, the price and the message show at once (optimistic) and come back as stored after the
reload; a failed write shows the provider's "Couldn't save." toast and puts the old value back,
except in the field being typed in: what was typed stays there, marked "Not saved.", until it
saves.
Changes by others arrive live; a field being edited (focused, with unsaved typing) keeps its
draft and follows the stored value again once saved or blurred.

**Accessibility.**

- The checklist is a `fieldset` with a visually hidden `legend` ("Tasks today", or "Tasks on
  Thursday 1 October") and real checkboxes named by their titles; the "who ticked it" line is
  their description (`aria-describedby`).
- The calendar is a `table` with `role="grid"`, labelled by the month title (the title is
  `aria-live="polite"`, so changing month is announced); column headers are `th scope="col"`
  with the full weekday as `abbr`; each day cell is `role="gridcell"` with `aria-selected` and
  holds the day's button, named by `calendarDayLabel()` ("Thursday 1 October, visit, 6 of 7
  done, £60.00", then ", selected" for the chosen day, since focus is on the button, not its
  cell). One day button is in the tab order (the selected day, else today, else the
  1st); arrow keys move a day or a week, Home and End go to the start and end of the week,
  Page Up and Page Down change month, moving past the month's edge changes month, and focus
  never lands on a future day.
- One polite, visually hidden live region on the screen announces what was saved: "Saved"
  (message, comments, price), "<title> done" or "<title> not done" (ticks), "Message cleared",
  "Visit added", "Visit deleted", and what a chosen day holds. Failures are the provider's
  toast (`role="status"`) and "Not saved." with Try again by the field.
- Targets are at least 44px except the day buttons below 360px wide (the whole cell, about
  40px wide by 46px tall).
  Text sizes follow the iOS 3a scale; nothing relies on colour alone (ticks have a check,
  visit days a dot, today a ring).

**Demo seed.** With the e2e clock (Thu 8 Oct 2026, 10:00 London) the seeded household has the
message "Guests arrive Friday, please do the spare room first." (Shea, yesterday 19:20), the
starter list, no visit today, and visits on Thu 1 Oct, 24 Sep, 17 Sep, 10 Sep and 3 Sep: the
subtitle reads "Last visit Thu 1 Oct", October "1 visit · £60.00", September "4 visits ·
£240.00", and Thu 1 Oct has the message "Please leave the ironing for next week.", 6 of 7 done
(not Ironing) and "Ironing left for next week as asked. We're out of bin bags."

**Tests.**

- `src/lib/logic/housekeeping.test.ts`: every "Tests:" list in the logic module.
- `src/lib/backend/demo.test.ts`: each housekeeping method, mirroring
  `supabase/tests/housekeeping.test.mjs` (copy rules, today's visit following the list,
  idempotent ticks, errors, another member's view of the same document), the seed above, and
  the starter list for an older document.
- `src/state/HomeProvider.test.tsx`: a tick on a day without a visit shows a pending visit and
  then the stored one; a failed write takes back only its change; a future date is refused;
  deleting a pending visit (straight after Add a visit, after a failed reload, after a failed
  write); Undo after Clear (shown at once, after the Clear in flight, a failure taken back).
- `src/screens/housekeeping/HousekeepingScreen.test.tsx`: the sections and copy, saving
  comments and the price ("Saved", and a failed save keeping what was typed), the price error,
  the calendar labels, keyboard and month change, choosing a day (scroll and announcement),
  Add a visit, Delete Visit (today's too), visits with nothing recorded, Clear and Undo, and
  the task list sheet.
- `src/screens/housekeeping/HousekeepingProvider.test.tsx`: the screen with the real provider
  and demo backend: typing kept through failed saves and saved once back; Delete straight after
  Add a visit; a tick taken back counts no visit.
- `src/App.test.tsx`: the tab switch, the Housekeeping dot, the tab remembered on this device,
  focus back on Edit after the task list closes.
- `supabase/tests/housekeeping.test.mjs` (written with the migration): schema, RLS, RPCs,
  concurrent ticks, today's visit following the list (a ticked row keeps its title), Undo after
  Clear, a task deleted while today's visit is created, the starter list and its first-run-only
  backfill.
- `src/lib/backend/supabase.integration.test.ts` (live suite): load shape, the RPC mappings and
  realtime on the four tables.
- `e2e/housekeeping.spec.ts`: the tab order and `aria-current`; no + on Housekeeping; the switch
  fits at 320, 375 and 402px (no horizontal scroll, every label's `scrollWidth` within its
  `clientWidth`); the seed as above; ticking starts today's visit (subtitle "Today's visit",
  today marked); comments and price save and survive a reload; September's summary; a past
  visit's details; Delete Visit (today's too); Add a visit; future days disabled; the task list
  sheet's add, rename, reorder and delete reach today's checklist while last week's visit keeps
  the old title; Undo after Clear keeps the writer; "Saved"; a day low on the screen scrolls
  into view; a tap in a cell's corner chooses it at 320px; the Housekeeping dot and reopening
  on the last tab; focus back on Edit after the task list. Existing e2e tests keep passing.

## Edge Function `scheduler` (runs every 15 minutes via pg_cron + pg_net)

- Auth: `Authorization: Bearer <CRON_SECRET>`; `verify_jwt = false` in `supabase/config.toml`.
- `?dry=1` returns the plan as JSON without claiming or sending (`&now=<ISO timestamp>` plans
  another moment, dry runs only). The response summarises counts per channel; a channel whose
  secrets are missing is skipped and named in `skipped`.
- Optional `RESEND_API_URL` replaces `https://api.resend.com/emails` (local testing against a
  fake only).
- Scheduled by `supabase/cron.sql` (job `home-os-scheduler`; Vault secrets
  `home_os_project_url` and `home_os_cron_secret`).
- Uses the service role key. For each household, works in the household's time zone and only
  sends at or after 08:00 local (SEND_HOUR).
- **Kinds**: the function reads the ids of open states (`items` where `kind = 'state'`) next to
  the view and marks the items (`withItemKinds()` in `_shared/plan.ts`). States get no
  reminders and no missed alerts.
- **Reminders**: open tasks with `notify <> 'none'` and a due date where
  `due_date - days_before == today` (same_day 0, day_before 1, week_before 7). Recipients: the
  assignee, or every member if unassigned. Only members with `push_enabled`.
  Log key: (reminder, member, item, ref_date = due_date).
- **Missed**: open tasks with `due_date` between today − 3 and today − 1 ("the morning after").
  Recipients: assignee and owner(s), deduplicated, `push_enabled` only.
  Log key: (missed, member, item, ref_date = due_date).
- **Weekly email**: on `weekly_email_day` at or after `weekly_email_time` local, to each member
  with `weekly_email = true`. Log key: (weekly, member, null, ref_date = today). Content, in
  order: missed deadlines (title, area, assignee, days late); due in the next 7 days; everything
  else open grouped by area with RAG (each area's states after its tasks, marked "To
  maintain"; a state is never missed or due); unassigned tasks; done this week per person; a
  button that opens home.os (`APP_URL`). Sent with Resend (`RESEND_API_KEY`, `EMAIL_FROM`).
- Idempotency: claim the log row first (`insert … on conflict do nothing returning id`); only
  send if claimed; delete the claim if sending fails so the next run retries.
- Web Push: VAPID (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`), aes128gcm payload
  encryption with WebCrypto (`supabase/functions/_shared/webpush.ts`). 404/410 → delete the
  subscription. Payload JSON: `{ title, body, url, tag }`.
- Pushes only go to https endpoints on the push service allowlist (`DEFAULT_PUSH_HOSTS` in
  `supabase/functions/_shared/webpush.ts`: fcm.googleapis.com, updates.push.services.mozilla.com,
  web.push.apple.com and *.push.apple.com, *.notify.windows.com). Any other stored endpoint is
  never contacted and is deleted like a 404/410, and redirects are not followed.
- Limits: every push and Resend request has a 10 s limit. Pushes and the weekly email run side
  by side. 90 s after a run starts it stops starting sends, aborts those in flight (releasing
  their claims) and returns its summary; the rest goes out on a later run. The summary carries
  `timedOut` and a `deferred` count per channel (`push.deferred`, `email.deferred`).
- Reads open items through the `scheduler_open_items` view, so apply the migrations before
  deploying the function.

## Testing

- `npm test`: Vitest unit tests (logic, demo backend, Edge Function shared modules).
- `npm run test:db`: starts a throwaway local Postgres 16 (or uses `DATABASE_URL`), applies a Supabase stub
  (`auth` schema, roles, `auth.users.email_confirmed_at`) and the migrations, then runs `supabase/tests`.
  `createUser()` makes verified users unless given `verified: false`. A database that tests
  share always holds homes, so `one_home.test.mjs` tests "no home exists" (`no_home`, the
  import) inside one transaction that replaces `home_exists()` for itself and is always rolled
  back: nothing it does is seen by anyone else.
- `npm run test:e2e`: Playwright against the demo-mode build.
- `npm run test:e2e:live`: Playwright against a build that uses the local Supabase stack
  (`playwright.live.config.ts`, `e2e-live/`): sessions made with the Auth admin API and the
  password grant are put into the app's auth storage (`sb-<host>-auth-token`) before it loads.
  It needs a database with no home in it, waits for one, and removes only what it made.
