# home.os architecture

home.os is an installable web app (PWA) built with Vite, React and TypeScript on
top of Supabase. The design spec is `design/README.md` (Turn 3, option 3a in
`design/HomeOS Directions.dc.html`; reference renders in `design/reference/`).

## Product rules that shape the code

- Sign in with **Google** only. **One home** per deployment (see "One home"): after sign-in
  the server says where the person belongs. Someone already in the home goes straight in;
  someone a housemate added with their Google email (Profile > Household > People) becomes
  that person; the very first person creates the home (with a **profile**: name from Google,
  editable, plus an emoji), or brings it over from their phone's demo data; anyone else sees
  "This home is private". Nobody is ever offered a second home. Invite links still work.
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
                           people (joined or not, email rules), importHome (the demo home this
                           phone kept, as the import_household payload; fixture importHome.fixture.ts)
  lib/backend/types.ts     Backend interface (the contract both backends implement)
  lib/backend/supabase.ts  production backend (supabase-js)
  lib/backend/demo.ts      localStorage backend (no env vars, e2e tests)
  lib/push.ts              Web Push subscribe/unsubscribe + iOS install detection
  lib/sw-register.ts       service worker registration
  ui/                      shared primitives: Screen (+ ScreenHeader), Hero, StatusSky, Sheet, ActionSheet, Toggle,
                           Avatar, Toast, Confetti, HomeScene (Join), icons
  ui/animals.ts            the drawn green duck and brown hedgehog (SVG) for HomeScene and Confetti
  lib/preview.ts           `?frame` simulates the 54px status bar inset for screenshots
  screens/home/            Home screen (collapsible areas with status counts and an add button),
                           item rows, tab switch (TabBar) and the floating + (AddButton)
  screens/chat/            Household group chat with emoji reactions
  state/ChatProvider.tsx   chat state: pages, realtime merge, optimistic send/react, unread dot
  screens/item/            Item sheet (edit / new)
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
| `members` | id, household_id → households on delete cascade, user_id uuid **null** **unique** → auth.users on delete cascade (null: "Not joined yet", see "People before they join"), name text not null, email text not null default '' (stored trimmed and lower case, <= 254, unique per household among non-blank emails), emoji text not null default '🦔', color text not null, role text not null default 'member' check (owner, member), weekly_email bool not null default true, push_enabled bool not null default false (always false while user_id is null), created_at |
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
   not joined yet by verified email (see "One home").
9. `add_person(p_household_id uuid, p_name text, p_emoji text, p_email text) returns uuid`,
   `set_person_email(p_member_id uuid, p_email text) returns void`,
   `remove_person(p_member_id uuid) returns void` (see "People before they join").
10. `import_household(p_payload jsonb) returns uuid` (see "Bring over the home from this
    phone").

`join_household` (3) also claims, since `20261010000500_one_home.sql`: a person in that
household who has not joined yet and has the caller's verified email becomes the caller
(their name, emoji and colour are kept; `p_member_name` and `p_member_emoji` are not applied)
instead of a second row being added. An unverified caller whose email someone in the home
already has joins as someone new, without the email.

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
  `households`, `members`, `areas`, `items`, `completions` and `messages`, and
  (message_id, member_id, emoji) for `message_reactions`, where emoji is one of the app's
  reaction emoji. No text, names or household ids. This is how Supabase Realtime treats deletes,
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
messages above (`network` for fetch failures). `completeItem` on a state throws
`BackendError('unknown', 'invalid_input: state')` in the demo backend and
`BackendError('unknown', 'invalid_input')` from Supabase; the UI never calls it for a state.

## One home

Migration `supabase/migrations/20261010000500_one_home.sql`; types `HomeEntry` and
`Phase` (`private`) in `src/lib/types.ts` and `src/state/HomeProvider.tsx`;
`Backend.enterHome()`. A deployment holds one home, and signing in never creates a second.

### Where a person belongs: `enter_home()`

HomeProvider's bootstrap asks `Backend.enterHome()` after every sign-in (instead of
`getMyHouseholdId()`, which stays for other callers and never claims). It returns one of:

| status | when | the app |
| --- | --- | --- |
| `member` | the account has a member row | phase `ready`: the home |
| `claimed` | not a member, and a person in a home has not joined yet (`user_id` null) and has this account's **verified** email (`auth.users.email_confirmed_at` not null; both trimmed and lower case) | the account is now that person; phase `ready` with `claimed` and `onboardingTail`: the welcome step, the notifications step, then the home |
| `no_home` | not a member, no such person, and no household exists | phase `onboarding`: "Bring over the home from this phone" when this browser has one, else Profile then Create home |
| `private` | not a member, no such person, and a household exists | phase `private`: "This home is private" |

JSON from the RPC: `{"status":"member"|"claimed","household_id","member_id"}`,
`{"status":"no_home"}`, `{"status":"private","email","email_verified"}`; the backend maps it
to `HomeEntry` (`householdId`, `memberId`, `email`, `emailVerified`). `not_signed_in` without a
user.

- **The claim is atomic**: `update members set user_id = auth.uid() where id = <person> and
  user_id is null and lower(email) = <verified email>`. Of two accounts claiming one person at
  once, exactly one wins and the other gets `private`; the same account in two tabs gets
  `claimed` once and `member` in the other; an email changed in People while someone signs in
  with the old one is not claimed. A claimed person keeps their id, name, emoji, colour, role,
  items and Stats. With several matches (only in a database holding several homes, like the
  tests) the oldest person wins.
- **Only a verified email claims.** Google accounts always are. Supabase Auth must never
  mark an email verified that nobody proved: keep the Email provider off, or on with "Confirm
  email" on (the default). README "Going live" says so.
- `private` reveals nothing about the home: only the caller's own email and whether it is
  verified.
- **No second home.** The app reaches Create home only from `no_home`, and HomeProvider's
  `createHousehold` asks `enterHome()` once more just before creating (anything but `no_home`
  moves to that phase and rejects with `home_exists`). The database does not refuse a second
  household from `create_household` (the tests and the shared development database hold many,
  and the Housekeeping migration owns that function); `import_household` refuses with
  `home_exists` itself, serialised by an advisory lock.
- **Invite links** keep working. From phase `private` an invite opens Profile then Join, without
  "Set up a new home instead"; a link that is no longer valid says so and offers **Continue**,
  which forgets it and shows "This home is private". `join_household` claims a not-yet-joined person with the
  caller's verified email instead of adding a duplicate; in practice `enter_home` has already
  claimed them at sign-in, so the invite is simply cleared as for any member.
- **Demo mode** (`DemoBackend.enterHome`): the same rules on the local document, with the demo
  account's email counting as verified, except that it never answers `private`: a demo sign-in
  always gets a home (its own, a claimed person, or `no_home` to create one). The demo never
  offers the import (it is where the data comes from).

### Screens (Onboarding views; copy is exact)

All three are full-screen steps like ProfileStep (`StepPage`), in `src/screens/onboarding/`.
App needs no change: every phase but loading, error and ready-without-tail already shows
Onboarding.

- **This home is private** (phase `private`). Title "This home is private". Body: "Ask someone
  at home to add **{email}** in Profile > Household > People, then check again." With no email:
  "Ask someone at home to add your Google email in Profile > Household > People, then check
  again." When `emailVerified` is false, add: "Your Google account's email isn't verified yet,
  so it can't be matched." Buttons: **Check Again** (primary; `recheckHome()`, busy while it
  runs, `errorMessage(err)` under it on failure) and **Sign Out**. Never a way to create a home.
  HomeProvider also rechecks whenever the app comes back into view in this phase.
- **Bring over the home from this phone** (phase `onboarding` and `demoImport` not null; shown
  before Profile). Title "Bring over the home from this phone". A white card: the household name
  (17/600), the address under it if any, "{n} areas · {m} items" (singular "1 area", "1 item";
  `m` counts open items), then each person as emoji and name, "(you)" after the one with `me`.
  Footnote: "Everyone else joins when someone adds their Google email in Profile > Household >
  People." Buttons: **Bring It Over** (primary; `importDemoHome()`, busy while it runs,
  `errorMessage(err)` under it on failure) and **Start Fresh** (`declineDemoImport()`: Profile,
  then Create home). Sign Out as on ProfileStep. No Profile step after an import: the demo name
  and emoji come along.
- **Welcome** after a claim (phase `ready`, `onboardingTail` and `claimed`). Title "Welcome
  home, {me.name}". Body "{household name} is all set up for you. Pick your emoji." The emoji
  grid (`EmojiGrid`) on `me.emoji`. Button **Continue** (`confirmClaimed(emoji)`), then the
  notifications step as after a create or join.

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
    yet · {email}" or "Not joined yet · No email yet". People stay in member order.
  - Last row **Add Person** (tint, plus icon), pushing an Add Person page like PersonPage:
    Name (`maxLength` 40, focused), the emoji grid (🦔 chosen), **Google Email** (`type=email`,
    `inputmode=email`, `autocapitalize=none`, `autocorrect=off`, `spellcheck=false`,
    `maxLength` 254, placeholder "name@gmail.com"), footnote "When they sign in with Google
    using this email, they join as this person, with their items." **Add** in the navigation bar
    (off while the name is blank or a non-blank email fails `isValidEmail`). Errors under the
    field: `email_taken` "Someone at home already has that email."; invalid "Enter the full
    email address, like name@gmail.com." The page keeps its input on failure.
  - PersonPage for someone who has not joined: name and emoji as today, plus **Google Email**
    (same field and footnote; saved with `setPersonEmail` on blur or Return, an error shows
    under it and keeps the text), and at the bottom a destructive **Remove {name}** that asks
    (ActionSheet) "Remove {name}? Their items become unassigned." with **Remove** and Cancel,
    then pops the page. For someone who has joined: as today (no email field, no remove).
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
Google on that phone, while no home exists, is offered to bring it over.

- **Offer**: phase `onboarding` (`no_home`) on the Supabase backend, and
  `demoHomeSummary(readDemoDoc(localStorage))` is not null: the document has a household and is
  not marked `imported`. "Start Fresh" hides it for the session.
- **Payload**: `buildImportPayload(doc)` in `src/lib/logic/importHome.ts` (pure,
  deterministic), `ImportPayload` version 1 in `src/lib/types.ts`. The home is the demo's
  signed-in person's (else the earliest owner's, else the earliest person's). That person is
  `me` and becomes the Google account (role owner, the account's email), keeping their demo
  name, emoji and colour; everyone else in that home comes as not joined yet, without the
  demo's made-up emails. Areas in order; every open and done item with all its fields (kind,
  title, note, good, rag, due date, repeat, notify, status, assignee, created and updated by,
  created, updated and completed times); every completion (Stats history), linked to its item
  when the item came along. Chat, invites and push subscriptions stay behind. Anything the
  database would refuse is repaired or left out (text cut to `TEXT_LIMITS`, unknown values to
  their defaults, an item without an area or title or a done state left out, a completion
  without a time left out), so a payload from this builder is always accepted while no home
  exists.
- **`import_household(p_payload jsonb) returns uuid`**, all or nothing: `not_signed_in`;
  `already_member` (the caller is in a home); `home_exists` (any home exists); `invalid_input`
  for anything it refuses (wrong types, unknown keys or references, duplicate keys, not exactly
  one `me`, text over the limits, unknown kind/rag/repeat/notify/status, a done state, a date
  or time it cannot read, over 50 people, 100 areas, 2000 items or 20000 completions). A state
  keeps no due date, repeat or reminder (the kind trigger). Times later than now become now;
  missing item times are now. Items keep their own times and authors (the items trigger lets
  the import through for its own inserts only). With the Housekeeping migration present the
  home also gets the starter task list, as `create_household` gives.
- **Afterwards**: `markDemoImported(localStorage, {at, household_id})` marks the document and
  changes nothing else in it, so the offer never comes back on that phone, then the home opens
  like after a create (notifications step). The owner then adds Shea's Google email in People;
  when Shea signs in, `enter_home` makes her Shea, with her items.
- **Fixture**: `src/lib/logic/importHome.fixture.ts` is the household's real home as the phone
  stores it (six areas, 19 open items and one done, Stratis, Shea and Ela, and a Stats
  history). `supabase/tests/fixtures/demo-import.json` is its payload; the unit test checks they
  agree (`UPDATE_IMPORT_FIXTURE=1 npx vitest run src/lib/logic/importHome.test.ts` rewrites it)
  and the database tests import it.

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

What makes it hold (the first two exist; the rest is required of the one-home data work):

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
   debounced reload it has today. In phase `private` the same events run `recheckHome()`.
5. **Reconnect** (`Backend.reconnect`): the Supabase backend drops the socket and opens a fresh
   one, at most once per 5 s, because a phone that slept can hold a socket that says it is open
   but is dead, and the 25 s heartbeat takes up to a minute to notice. Channels rejoin when it
   opens, and each join asks for a reload.
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
  recheck in phase `private`.
- e2e (demo, two pages in one browser context, which share localStorage): a change on one page
  shows on the other without a reload, for an item, an area, a person and a chat message.

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

## Home

- **Areas collapse.** Each area name is a disclosure button (`aria-expanded`, `aria-controls`)
  inside the area's `h2`, with a small chevron that stays on the line with the name's last
  letter. Collapsed, the card slides shut (about 320ms, none with Reduce Motion) and its rows
  are inert and hidden. **Collapse All** / **Expand All** (15px tint text, right-aligned above
  the first area) does every area at once.
- **Remembered per device**: the collapsed area ids are kept in localStorage under
  `homeos.collapsed.<householdId>` (every read and write in try/catch; deleted areas are
  forgotten). Nothing is stored on the server.
- **Status counts**: on the right of each header, red, then amber, then green chips (a dot
  and a number, 13px/600, the RAG text colour on the RAG tint), only for non-zero counts,
  shown open or collapsed. Every open item in the area counts by its RAG, To maintain items
  included. Assistive tech reads one label, such as "1 urgent, 2 at risk, 3 on track".
- **Add**: after the counts, a small tinted + ("Add item to <area>", 44 × 44 tap target)
  opens the new-item sheet with that area chosen.
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
  area the filter hides switches back to Everyone.
- People's 🦆 and 🦔 are drawn (`ui/EmojiText.tsx`: the green duck and brown hedgehog of
  `ui/animals.ts`) wherever a member's emoji shows, with the character kept in the text for
  copying and screen readers.

### The hero and the tab switch

Every tab (Home, Chat, Stats) starts with `ScreenHeader` (`ui/Screen.tsx`): the `Hero`
(`ui/Hero.tsx`) from the very top of the screen, with the title (an `h1`), a secondary line
(the address on Home) and the Profile avatar on it, then the Home / Chat / Stats switch
(`TabBar`, a `nav` named "Tabs" whose buttons carry `aria-current="page"`). The switch is
`position: sticky` at `--top-inset`: once the hero has scrolled away it stays at the top on a
frosted background (`data-stuck`), and `StatusSky` fills in behind the status bar. Welcome
uses the same hero, full bleed, over the wordmark. The round + (`AddButton`) floats at the
bottom right on Home and Stats; Chat's composer sits at the bottom.

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

- Tab switch under the hero: **Home, Chat, Stats**. The round + (new item) floats at the bottom
  right on Home and Stats, not on Chat. A small dot on Chat means unread messages from others (last-read time is kept per
  member on this device).
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
