# home.os architecture

home.os is an installable web app (PWA) built with Vite, React and TypeScript on
top of Supabase, or, with nothing to set up, on the deployment's own server (Vercel Functions
and a private Blob store; see "Server mode (no setup)"). The design spec is `design/README.md` (Turn 3, option 3a in
`design/HomeOS Directions.dc.html`; reference renders in `design/reference/`).

## Product rules that shape the code

- **Server mode** (no Supabase configured, a Blob store connected): the home lives on the
  deployment's own server and people sign in with codes, not Google; the weekly email is
  hidden, and phone notifications are the server's own (weekly status, housekeeping report,
  your reminders; see "Notifications" there). See "Server mode (no setup)". The rules below
  hold there too, except where that section says otherwise.
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
- Radical simplicity: no filters, counters, dashboards or settings beyond the spec. The
  exceptions the household asked for: Home says in one sentence what needs attention and shows
  the same items three ways (Up next, Rooms, Calendar; see "Home" below), and Home has a
  calendar of what is due (see "Home: the calendar").
- **Colour always comes with a word** (`URGENCY_LABEL`, `CONDITION_LABEL`, `ragWord()` in
  `lib/constants.ts`): a To do's red, amber and green mean **Urgent**, **Within the month** and
  **Not urgent**; a To maintain item's mean **Needs work**, **Okay** and **Good**. The Item
  sheet's picker ("How urgent?" or "Condition", each word with what it means under it:
  `RAG_HINT`), Home's rows and tiles, and shared text all say the word.
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
                           months (month grids and weeks, Monday first), calendar (what each day
                           holds on Home's calendar: due, missed, repeats, visits),
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
  lib/backend/server.ts    server mode backend (this deployment's /api/home; codes, polling)
  lib/backend/serverApi.ts the wire contract between server.ts and server/ (both import it)
  lib/backend/demo.ts      localStorage backend (no env vars, e2e tests); the server runs it too
  lib/logic/serverImport.ts "Bring this home online": the phone's demo home as the server's home
  lib/serverLinks.ts       ?setup= and ?code= links (server mode)
  lib/push.ts              Web Push subscribe/unsubscribe + iOS install detection
  lib/sw-register.ts       service worker registration
  ui/                      shared primitives: Screen (+ ScreenHeader), Hero, StatusSky, Sheet, ActionSheet, Toggle,
                           Avatar, Toast, Confetti, HomeScene (Join), icons, useReorder (drag and arrow-key
                           reordering for the areas and the housekeeping task list), MonthCalendar
                           (the calendar card Home and Housekeeping share)
  ui/animals.ts            the drawn green duck and brown hedgehog (SVG) for HomeScene and Confetti
  lib/preview.ts           `?frame` simulates the 54px status bar inset for screenshots
  screens/home/            Home screen (the summary, Up next, Rooms with each room's menu),
                           item rows, the calendar (HomeCalendar), tab switch (TabBar) and the
                           floating + (AddButton)
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
e2e-server/                Playwright tests on the local server (server mode): setup, codes, sync
server/                    server mode's API (bundled by scripts/build-server.mjs, published at /api/home)
  core/                    handler (ops), homeStore (cache, write queue, budget), runAs (DemoBackend
                           per call), rpc (allow-list), auth (keys, codes), limits, setup, context
  store/                   BlobStore: vercel (private Vercel Blob), file (local), memory (tests)
  entry/                   vercel.ts (the function), local.ts (local server), node.ts (http glue)
scripts/                   migrate, build-server (Build Output for Vercel, local bundle),
                           backend-mode (which backend a build is for), build-output, icons, test-db
```

## Styling conventions

- CSS Modules (`X.module.css`) next to each component; tokens in `src/styles/tokens.css`.
  The tint has three tokens, so words keep 4.5:1: `--tint` (#007aff, dark #0a84ff) is for
  shapes only (rings, dots, icons, focus rings); `--tint-text` (#0058b9, dark #5aa9ff) is every
  word in the tint (text buttons and links, Done, Cancel, Today, Clear, Edit, today's date on
  a calendar), 6:1 or better on the page where the system blue is 3.6:1; `--tint-fill`
  (#0071e3 in both appearances, #0040dd with Increase Contrast) is a solid fill under white
  words or glyphs (filled buttons, Mark as Done, the chosen day or chip, your chat bubbles,
  the round +), 4.7:1 with white where the system blue is 4:1 (3.7:1 in dark). In dark mode
  `--destructive` is iOS's accessible red #ff6961 (4.8:1 on the action sheets' glass). A
  bottom sheet over the page (the code sheet) takes `--sheet-bg`, `--sheet-card`,
  `--sheet-edge` and `--sheet-dim`: the page's colours in light; in dark mode lifted a step
  (#1c1c1e, its cards #2c2c2e, a faint top edge, the page dimmed more), so it never sinks
  into the black page.
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
- The app icon is `public/icons/icon.svg`: the hero's cottage at dusk as one frosted-glass
  glyph (coral fish-scale roof, brick chimney, lit attic window, teal arched door with a lit
  fanlight, one lit window) with the green duck on the lawn, under the hero's evening sky.
  `npm run icons` renders the touch icon (180, full bleed, no alpha), the manifest icons
  (rounded "any", and maskable with `#art` shrunk into the safe zone) and `favicon.ico`
  (16 and 32). At 16 px the SVG's own media query leaves out the duck and the stars and draws
  the cottage larger, in the ICO and when a browser draws the SVG favicon.
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
  `housekeeping_sections`, `housekeeping_tasks`, `housekeeping_visits` and `housekeeping_visit_tasks`,
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
  `supabase/config.toml` also keeps `enable_confirmations` on, and README "Going live with
  Supabase" asks for the Email provider to be off. An email and password account is always `private` (with
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

## Server mode (no setup)

The household wants their home shared across phones with nothing to set up by hand: no
Supabase project, no Google Cloud console. Server mode keeps the home on the deployment's own
server: one Vercel Function (`/api/home`) over a **private Vercel Blob store** connected to the
same Vercel project, and people sign in with **codes** instead of Google. Supabase and Google
sign-in stay in the code, unused while Supabase is not configured. The weekly email needs
another service, so it is hidden in server mode; phone notifications (Web Push) come from the
same function, once a day from Vercel Cron (see "Notifications").

The server holds the same document the demo backend keeps in localStorage and runs the
**DemoBackend's own code** on it for every call, as the signed-in person, so the data rules
(lengths, kinds, people, chat, housekeeping) are written once.

### Choosing the backend

`pickBackendMode()` in `src/lib/backend/index.ts` (the browser) and `backendMode()` in
`scripts/backend-mode.mjs` (the build) apply the same order:

1. `VITE_FORCE_DEMO=1` (the e2e tests): **demo**.
2. Supabase URL and anon key configured (the names in `supabaseSettings()`): **Supabase**.
3. The build has a server: `BLOB_READ_WRITE_TOKEN` is set (Vercel sets it when a Blob store is
   connected to the project) or `HOMEOS_LOCAL_SERVER=1` (local and e2e builds): **server**.
4. Otherwise: **demo**.

`vite.config.ts` turns 3 into the define `import.meta.env.VITE_HOMEOS_SERVER = '1'` (else `''`).
Only the presence of the token decides it; its value never goes into the client bundle or a log.
`createBackend()` constructs `ServerBackend` (`src/lib/backend/server.ts`) in server mode.
`Backend.kind` is `'server'`; `serverAccess(backend)` gives its sign-in side (`ServerAccess`).

### Deploying (Vercel)

- **One function, published with the Build Output API.** Vercel's build command is
  `node scripts/migrate.mjs && npm run build && node scripts/build-server.mjs --vercel`.
  `migrate.mjs` skips without a database, as before. `build-server.mjs --vercel` does nothing
  unless the build is in server mode; then it writes `.vercel/output`: `static/` (a copy of
  `dist/`), `functions/api/home.func/` (`server/entry/vercel.ts` bundled by esbuild into one
  ESM file, `index.mjs`, with `.vc-config.json`: `nodejs22.x`, launcher `Nodejs`, helpers off,
  `maxDuration` 15, and `regions: [HOMEOS_FUNCTION_REGION]` when that is set) and `config.json`
  (vercel.json's `headers` as routes, in order, each with `continue`, then
  `{ "handle": "filesystem" }`; not vercel.json's `crons`: Vercel adds those to the Build
  Output itself, and the same cron listed in `config.json` too fails the deployment as
  `duplicated_cron_job`; `buildOutputConfig()` in `scripts/build-output.mjs`, tested).
  Vercel deploys `.vercel/output` instead of `dist/` when the build command leaves one, so the
  app is served as before and the function answers at `/api/home`. Without a Blob store nothing
  changes: Vercel deploys `dist/` as today.
- **Why the source is `server/`, not `api/`.** Vercel compiles each `api/*.ts` file on its own,
  and Node's ESM loader (the package is `"type": "module"`) cannot resolve the app's
  extensionless imports (`../lib/logic/dates`), so a function that imports `src/lib/backend/demo.ts`
  fails at run time. Bundling with esbuild avoids that, and a deployment uses either zero-config
  `api/` functions or a Build Output, not both. Everything the function needs (the app's
  `src/lib` code and `@vercel/blob`) is inside `index.mjs`; ESM with a `createRequire` banner
  (`ESM_REQUIRE_BANNER`) so CommonJS dependencies load.
- **One endpoint on purpose.** All ops share one function, so the instance that stores a write is
  the one that answers the next poll from its cache. Separate functions would each keep their
  own cache and see each other's writes only after a Blob read.
- **Check after the first deploy** (the integrator or main session, no user step):
  `GET /api/home?op=status` with header `X-HomeOS: 1` answers `{"home":false}` (JSON, not the
  app's HTML and not a 404). If Vercel ignored `.vercel/output`, the fallback is a committed
  `api/home.js` that re-exports a bundle written by a `vercel-build` script; nothing else changes.
- **Settings** (environment variables; the main session sets them, never the user):

  | variable | what |
  | --- | --- |
  | `BLOB_READ_WRITE_TOKEN` | set by Vercel when the private Blob store is connected; build and run time |
  | `HOMEOS_SETUP_CODE` | the one-time setup code: 12 or more letters of `CODE_ALPHABET` once normalised, e.g. `K7QM-3XRP-WN9D` (60 bits). Unset or malformed: setup always answers `invalid_code` |
  | `HOMEOS_BLOB_WRITES_PER_MONTH` | write budget (default 1900; `0` = no limit, for the Pro plan) |
  | `HOMEOS_BLOB_READS_PER_MONTH` | read budget (default 9000; `0` = no limit) |
  | `HOMEOS_BLOB_PATH` | optional: where the home's blob lives (default `homeos/<VERCEL_ENV>/home.json`, so previews never touch production's home) |
  | `HOMEOS_FUNCTION_REGION` | optional: the region to pin the function to (the Blob store's) |
  | `HOMEOS_VAPID_PUBLIC_KEY`, `HOMEOS_VAPID_PRIVATE_KEY` | the Web Push key pair (web-push format, base64url: a 65-byte P-256 point and its 32-byte scalar; `npx web-push generate-vapid-keys` makes one). Missing or malformed: phone notifications are off (Profile says "Notifications aren't set up yet.") and the server logs once which one is wrong, never its value. Only the public key leaves the server |
  | `HOMEOS_VAPID_SUBJECT` | the contact push services see: `mailto:…` or an https URL; default `https://<VERCEL_PROJECT_PRODUCTION_URL>` |
  | `CRON_SECRET` | 16 or more characters; Vercel sends it to the cron job as `Authorization: Bearer <secret>`. Unset (or shorter): the morning run answers 403 and nothing is sent |

### The stored document

One private blob, `ServerDoc` in `server/core/serverDoc.ts`, format `homeos.server/1`:

- `home`: the DemoBackend document (`DemoDoc`, now exported from `src/lib/backend/demo.ts` with its
  row types). At rest `session` is null and `users`, `invites`, `push_subs` are empty. Members
  who have joined have a `user_id` the server made (`u-<uuid>`); people not joined yet have null.
  Emails are always `''` (no Google). This is the only part any browser sees, and only through
  what DemoBackend's methods return.
- `auth` (server only, never in a response): `devices` (`DeviceRow`: id, `keyHash`, `userId`,
  `label`, `createdAt`, and `seenAt`, written once on the device's first signed-in request) and
  `codes` (`CodeRow`: id, `codeHash`, `memberId`, `createdBy`, `createdAt`, `expiresAt`, and once
  used `usedAt`, `usedBy` (the device it signed in) and `usedClaimed`, kept `CODE_REPLAY_MS`, 15
  minutes); `secret` (32 random bytes made at setup: signs device tokens) and `setupHash` (the
  setup code that brought the home online). Only hashes of keys and codes are stored. A
  device's Web Push subscription is kept on its row (`push`: endpoint, p256dh, auth), so it goes
  when the device goes (removed, signed out, its person released).
- `notify` (server only; missing in documents made before notifications): `people`, one
  `NotifyPersonRow` per person who has joined (`memberId`, the three choices `weeklyStatus`,
  `housekeeping` and `reminders`, `list`: their reminders, at most 20, and `sent`: what the
  morning run sent them last). Each person only ever sees their own (GET notify).
  `pruneAuth()` drops the rows of people who are gone or no longer joined.
- `rev` (1 when the home came online, +1 with every stored change of data), `chatRev` (+1 when
  the chat changed in a stored change), `meta` (`createdAt`, `writes`: the last 50 put ids,
  `usage`: Blob operations this UTC month).

### Storage, reads and writes

- **`BlobStore`** (`server/store/types.ts`): `get(path, { ifNoneMatch })` (always the latest, never
  a CDN copy; `'unchanged'` for a matching ETag; null for none) and `put(path, body, { ifMatch } |
  { create: true })` (BlobConflictError when the ETag moved, or the blob exists).
  `VercelBlobStore` (`@vercel/blob` 2.8.1, private: `get(path, { access: 'private', useCache:
  false, ifNoneMatch })`, `put(path, body, { access: 'private', contentType: 'application/json',
  addRandomSuffix: false, allowOverwrite: true, ifMatch })`, `BlobPreconditionFailedError` →
  BlobConflictError; the SDK is passed in by `server/entry/vercel.ts`, the only file that imports
  the package), `FileBlobStore` (local) and `MemoryBlobStore` (unit tests; implemented).
- **`HomeStore`** (`server/core/homeStore.ts`), one per function instance:
  - Reads come from its cached copy when that was checked within `freshMs`; otherwise one `get`
    with `ifNoneMatch` refreshes it. Auth, polls and loads all use the cache. Concurrent
    refreshes share one call. Status needs no read at all once the instance has seen a home
    (a home never goes away); before that, "no home" is kept 30 s.
  - **Rechecks** (a read for any other reason than freshness) are gated by the budget: a
    caller who has seen a newer rev (`minRev`) or a write that failed on a copy that may be
    behind ("member": at most one per `recheckMs`, 1 s at first), and a sign-in code or bare
    key the copy does not know ("stranger": at most one a minute and `reads / 300` a day, since
    anyone can send those). A recheck that is not allowed answers from the copy. Only a device
    token signed by this home (`read({ minRev, trusted: true })`, see "Signing in") and a write
    conflict read past the gates.
  - **Writes** go through one queue per instance and are stored with
    `put(ifMatch: the ETag they were applied to)`. Up to `MAX_BATCH` (25) writes waiting when a
    put can start go into one put (group commit), each applied in order to the result of the one
    before; a write that throws is rolled back and rejects alone (a `pure` write, which replaces
    `doc.home` instead of editing it, as all the handler's do, by putting the previous home
    object back and a copy of `auth`; any other from a copy of the whole document). A batch that
    changes nothing (same JSON) is not stored. Before each put: `rev` + 1 when a `'data'` write
    changed something (`'meta'` writes, marking a device used or storing the read count, keep
    the rev, so browsers do not reload), `chatRev` + 1 when `chatFingerprint()` changed, a fresh
    id appended to `meta.writes`, usage counted, `pruneAuth()`. A body over `MAX_DOC_BYTES`
    (5 MiB) is refused (`too_large`).
  - **Conflicts**: `BlobConflictError` means another instance stored first: re-read, then, unless
    `meta.writes` holds this put's id (the put landed and only its reply was lost, which the SDK
    then retried), wait a jittered 50 to 300 ms times the attempt and apply the whole batch again
    to what is there. Seven attempts, then `busy` (nothing stored; ServerBackend asks once more).
    Every write is applied to the latest document, so **two people writing at once never lose
    a change**: two ticks on one visit, two edits to different fields of one item, a message and
    a tick, two tasks moved into sections, a task added while another is moved, all land (a
    move names one task and where it goes, never the whole list as one phone last saw it).
    The same field edited by two people at once: the later write wins, as on Supabase.
  - A write made on an instance is in its cache at once, so with one warm instance (the usual
    case for a household) everyone's next poll sees it; a write on another instance is seen
    within `freshMs`.
  - **A copy that is behind**: a write that fails on this instance's copy (a person or an item
    made elsewhere a moment ago, a device signed in elsewhere) is tried once more after a
    member recheck. A put that fails with `BlobUnavailableError` is checked the same way as a
    conflict (did one of this batch's ids land?), else the batch rejects `unavailable`.

### Budget (Vercel Blob on the Hobby plan)

The Hobby plan includes **2,000 advanced operations** (`put`) and **10,000 simple operations**
(`head()`, and `get` cache misses, which all of ours are) a month, and when either is exceeded
Vercel **blocks the store for 30 days**: the home could not even be read. So the server counts
and spends carefully, and has a hard ceiling:

- No Blob operation per request: auth, polls, status and reads use the instance's cached copy.
- No write for a wrong code (it is checked on the copy first), a sign-in check or a no-op
  (unchanged JSON is not stored). One put per device ever, for its first use (`seenAt`).
- Reads are counted per instance and stored with the next put, and once 50 have built up
  (`READ_FLUSH_AT`), by a put of their own that keeps the rev, so an instance that goes away
  loses few of them.
- `pressure()` from `meta.usage` plus this instance's reads not stored yet: under 60 % of the
  read budget `freshMs` 10 s, `pollMs` 3 s, `recheckMs` 1 s; 60 to 85 %: 30 s, 6 s, 5 s; 85 to
  90 %: 120 s, 20 s, 20 s; from 90 % (`READ_CEILING`): **the ceiling**: the copy is never
  refreshed except for a trusted device token or a write conflict, `pollMs` is 60 s. With the
  default read budget of 9,000 that leaves 1,000 reads under Hobby's 10,000 for what the counts
  missed. At the ceiling another instance's change is seen when this instance next writes.
- Browsers poll at the `pollMs` the server returns, only while visible and in use: once a minute
  after 3 minutes without input, not at all after 15 (see ServerBackend).
- Puts at the write budget: **read-only** until the month turns (UTC). Writes answer 503
  `read_only` without a put, `VersionResponse.readOnly` is true, and Home says so (see Screens).
  Reading keeps working, instead of the store going dark for 30 days.
- The integrator or main session checks the team's plan: on Pro, set both budgets to `0`.
  Roughly one put per change: a household making 60 changes a day uses the Hobby budget.

### Reusing DemoBackend (`server/core/runAs.ts`)

For each call: a fresh in-memory `StorageLike` holding the home with `session` set to the
caller's user id and `users: [{ id, email: '', name }]`; `new DemoBackend({ storage, user, now,
search: '', latency: 0 })`; the method runs; for a write the document is read back from the
storage and `session` and `users` cleared before it is kept. DemoBackend only stores its
document when the change succeeded, so a refused call changes nothing, and its BackendError
goes to the browser as the same code. Nothing else in the server knows the data rules.
Server-only rules on top: the auth section (codes, devices), `pruneAuth()` after every write, and
limits on what one write may grow the home to: `HOME_MAX_BYTES` (4 MiB of JSON, about 16,000 chat
messages) and `HOME_ROW_LIMITS` (members 50, areas 200, items 2,000, messages 20,000, reactions
50,000, housekeeping sections 30, tasks 200, visits 3,000): past them a write that adds is refused with 413
`too_large` ("Couldn't save. The home is full."); one that keeps or shrinks the home always works.

### The API (`src/lib/backend/serverApi.ts`, `server/core/handler.ts`)

One path, `/api/home`; JSON both ways; `Cache-Control: no-store`. Every request needs the header
`X-HomeOS: 1`, and a POST `Content-Type: application/json`, else 403 `forbidden` (CSRF: a page
on another site can't send either without a CORS preflight, which is never answered). Body
limits: setup 4 MiB, rpc 256 KiB, else 4 KiB (413 `too_large`).

| op | sign-in | request | response |
| --- | --- | --- | --- |
| `GET ?op=status` | no | | `{ home }` (is a home online; from memory once this instance has seen one) |
| `GET ?op=session` | yes | | `{ user, entry, device, rev }`; renews the cookie |
| `GET ?op=version` | yes | | `{ rev, chatRev, pollMs, readOnly }` |
| `GET ?op=devices` | yes | | `{ devices: DeviceInfo[] }` |
| `POST setup` | no | `{ code, phone, app? }` | `{ user, entry, device, rev }` + cookie |
| `POST redeem` | no | `{ code, app? }` | `{ user, entry, device, rev }` + cookie |
| `POST rpc` | yes | `{ method, args, minRev? }` | `{ result, rev }` (`null` for void) |
| `POST createCode` | yes | `{ memberId }` | `{ code, memberId, expiresAt }` (403 `forbidden` for someone joined and signed in elsewhere) |
| `POST removeDevice` | yes | `{ deviceId }` | `{ ok }` (clears the cookie when it was this one) |
| `POST signOut` | either | | `{ ok }` always; revokes this device if signed in; clears the cookie |
| `POST release` | yes | | `{ ok }` ("Not Shea?"); clears the cookie |
| `GET ?op=notify` | yes | | `NotifySettings`: `{ prefs, reminders, publicKey, subscribed }` (this person's; `subscribed` is this device) |
| `POST pushSubscribe` | yes | `{ subscription: { endpoint, keys: { p256dh, auth } } }` | `{ ok }` (400 without VAPID keys, or for an endpoint not on a known push service) |
| `POST pushUnsubscribe` | yes | | `{ ok }` |
| `POST setNotify` | yes | `{ prefs: { weeklyStatus?, housekeeping?, reminders? } }` | `NotifySettings` |
| `POST saveReminder` | yes | `{ reminder: { id?, title, days } }` | `NotifySettings` (404 for an id that is not theirs) |
| `POST deleteReminder` | yes | `{ id }` | `NotifySettings` |
| `GET ?op=tick` | `Authorization: Bearer <CRON_SECRET>`, no X-HomeOS | | `{ ok, sent, failed, gone }` (403 otherwise) |

`user` is `{ id: user id, email: '', name }`, `entry` a `HomeEntry` (`member`; `claimed` from a
redeem that made someone join). `app` (`AppMode`): `'standalone'` when the page runs as an
installed app, for the device's label. Errors are `{ "error": { "code", "message" } }`:

| code | status | browser sees (`toBackendError`) |
| --- | --- | --- |
| `not_signed_in` | 401 | `not_signed_in`, and ServerBackend signs this browser out |
| `forbidden`, `unknown_op`, `too_large`, `busy`, `unknown` | 403, 400, 413, 503, 500 | `unknown` |
| `invalid_input` | 400 | `unknown` with `invalid_input: …` (DemoBackend's words) |
| `not_found`, `home_exists`, `invalid_code`, `read_only` | 404, 409, 400, 503 | the same code |
| `too_many_attempts` | 429 + Retry-After | `too_many_attempts` |
| `unavailable` (Blob unreachable, or this instance can't tell yet whether a device is signed in) | 503 | `network` |

**The device key** is 32 random bytes, base64url, made on setup or redeem and sent only inside a
**device token** in `Set-Cookie: homeos_key=<token>; Path=/api; HttpOnly; SameSite=Lax;
Max-Age=34560000; Secure` (Secure on https; the local server leaves it off for
http://localhost): `<key>.<device id>.<rev>.<mac>`, where `rev` is the first rev that holds the
device and `mac` is HMAC-SHA256 of `"<device id>.<rev>.<key hash>"` with the home's `auth.secret`
(16 bytes, base64url). The key alone is the credential; the token lets any instance tell a device
signed in elsewhere a moment ago from a made-up or removed one (see "Signing in"). The browser
app never sees or stores it. The server also accepts `Authorization: Bearer <token or key>`
(tests, tools). A cookie rather than a header on purpose: an HttpOnly key can't be read by script, Safari's 7-day
limit on script-written storage does not apply to it, and iOS copies Safari's cookies into a
Home Screen app when it is added, so a phone that signed in in Safari and then adds home.os to
its Home Screen is still signed in (reported behaviour, not checked on a device yet; otherwise
"Add another device" covers it).

### The RPC allow-list (`RPC_METHODS`, `server/core/rpc.ts`)

`{op:'rpc'}` runs one of these, as the caller, after checking the arguments' shapes
(`RPC_ARGS`: ids are strings of 1 to 100 characters; text at most 20,000 characters, then
DemoBackend applies the real limits after trimming; enums, real dates, whole numbers in range;
objects with only their listed keys; anything else is `invalid_input: args[i].key`).

| method | kind | arguments checked |
| --- | --- | --- |
| `getMyHouseholdId` | read | none |
| `load` | read | household id |
| `updateHousehold` | write | id; `{ name?, address?, timezone? }` text |
| `updateMember` | write | id; `{ name?, emoji? }` (weekly email and push are not in server mode) |
| `addPerson` | write | household id; `{ name, emoji, email? }`, email only `''` |
| `removePerson` | write | member id (their code goes too) |
| `createArea`, `renameArea` | write | id; name text |
| `deleteArea` | write | id |
| `reorderAreas` | write | household id; up to 500 ids |
| `createItem` | write | household id; ItemDraft, every key: `area_id` id, `kind` task/state, `title` `note` `good` text, `rag` red/amber/green, `due_date` date or null, `assignee_id` id or null, `repeat` none/weekly/monthly/quarterly/biannual/yearly, `notify` none/same_day/day_before/week_before |
| `updateItem` | write | id; any of ItemDraft's keys, same checks |
| `deleteItem`, `completeItem`, `undoCompletion` | write | id |
| `listMessages` | read | household id; `{ before?: timestamp or null, limit?: 1 to 999 }` optional |
| `getMessages` | read | up to 1000 ids |
| `sendMessage` | write | household id; body text |
| `deleteMessage` | write | id |
| `setReaction` | write | message id; emoji text; on boolean |
| `setHousekeepingNote` | write | household id; body text |
| `undoClearHousekeepingNote` | write | household id |
| `createHousekeepingTask` | write | household id; title text; optional section id or null |
| `renameHousekeepingTask` | write | id; title text |
| `deleteHousekeepingTask` | write | id |
| `moveHousekeepingTask` | write | id; section id or null; index, a whole number 0 to 100,000 |
| `reorderHousekeepingTasks` | write | household id; up to 500 ids (an app from before sections still open on a phone; each task keeps its section) |
| `createHousekeepingSection` | write | household id; title text |
| `renameHousekeepingSection` | write | id; title text |
| `deleteHousekeepingSection` | write | id |
| `moveHousekeepingSection` | write | id; index, a whole number 0 to 100,000 |
| `setHousekeepingTaskDone` | write | household id; date; exactly one of `{ taskId }`, `{ visitTaskId }`; done boolean |
| `saveHousekeepingVisit` | write | household id; date; `{ comments?: text, price_pence?: 0 to 1,000,000 or null }` |
| `addHousekeepingVisit` | write | household id; date |
| `deleteHousekeepingVisit` | write | id |

Not RPCs (`NOT_RPC`, which with `RPC_METHODS` names every Backend method; a test checks it):
`getUser` (GET session), `onAuthChange` (local), `signInWithGoogle` (rejects: no Google),
`signOut` (POST signOut), `takeAuthError` (null), `enterHome` (setup's or redeem's entry once,
else the session's), `subscribe`, `subscribeChat` and `reconnect` (polling), `createHousehold`
(rejects `home_exists`: a home comes online only through setup), `joinHousehold` and
`createInvite` (reject `invalid_invite`: codes replace invite links), `getInvitePreview` (null),
`releaseClaim` (POST release), `importHousehold` (rejects: setup does it), `setPersonEmail`
(rejects `invalid_input: email`), `savePushSubscription` (POST pushSubscribe, this device's),
`deletePushSubscription` (POST pushUnsubscribe).

### Signing in (`server/core/auth.ts`, `server/core/limits.ts`)

- **Codes**: 8 letters of `CODE_ALPHABET` (`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`: no 0, 1, I or O;
  32 letters, so `byte & 31` is unbiased), 40 bits, shown as `ABCD-EFGH` (`formatCode`), typed in
  any case with or without spaces or hyphens (`normaliseCode`). Single use, valid 7 days. Up to
  `MAX_LIVE_CODES` (5) live a person: making another does not cancel the one sent before (past 5,
  their oldest goes). Stored as hex SHA-256 of the normalised code. Also a link:
  `<app>/?code=ABCD-EFGH` (`codeLink`).
- **Who gets one** (`issueCode`): anyone in the home can make a code for someone not joined yet
  ("Invite Shea"; someone new is added first, Add Person: name and emoji), for themselves ("Add
  another device"), and for someone who has joined but has **no device signed in** any more (a
  lost phone, once someone removed it from their page; or after they signed out of their only
  one). Never for someone joined who is signed in somewhere: a code for them would let whoever
  has it be them, silently (403 `forbidden`; People shows "Only Shea can sign in on another
  device…" instead of the button). Recovering a lost phone therefore takes a visible step:
  removing that person's devices signs them out everywhere.
- **Redeem**: the code's person joins if they had not (`user_id = 'u-' + uuid`, `claimed_at` now,
  entry `claimed`, so the welcome step follows and "Not Shea?" works for a day), else it is one
  more device for them (entry `member`). A device row is added (at most 10 a person and 50 a
  home; the oldest goes). The code is kept as used for 15 minutes (`CODE_REPLAY_MS`); when the
  person joins, their other live codes that someone else made go. **A lost reply**: the same code
  again within those 15 minutes, while the device it signed in has never been used (`seenAt`),
  replaces that device and gives the same entry; once the device has been used, the code is spent.
- **Setup code** (`HOMEOS_SETUP_CODE`): brings a home online once (see Setup). With a home online,
  the same code (also the one in `auth.setupHash`) signs a browser in as the **owner** only while
  none of the owner's devices has ever been used (the reply to Bring It Online was lost, or every
  device of theirs was signed out or removed): their unused devices go, the home is not built
  again. Otherwise setup answers `home_exists`, for good.
- **Guessing**: every presented secret is hashed and compared with every stored hash using
  `timingSafeEqual`, without stopping early. Code and setup attempts are limited in memory per
  instance (`AttemptLimiter`; the address from `x-real-ip`, else the first `x-forwarded-for`, which
  Vercel sets; an IPv6 address counts by its /64, an IPv4 address written as IPv6 as itself):
  `begin(ip)` checks and counts in one synchronous step, so an attempt counts as failed from the
  moment it starts (a burst sent at once is limited exactly like the same codes one after another)
  until it works; 10 failures per address in 15 minutes, 20 for an address someone signed in from
  in that time (the home's Wi-Fi), then 429 with Retry-After without trying the code. While 50
  different addresses are failing, an address that has failed itself is held until its failures
  leave the window; an address with no failures of its own is never held up by anyone else.
  A wrong code is checked on the instance's copy (and at most one stranger recheck) and never
  reaches the write queue or the Blob store.
- **A device this instance does not know** (`signedIn()` in `handler.ts`): a device token signed by
  this home for a rev newer than the copy is a device another instance signed in a moment ago:
  the copy is read until it holds that rev (past every budget gate: only real devices can ask, once
  each), then judged again. A token this home did not sign, or one whose rev the copy holds without
  the device (removed, or its person released), is definitely out: 401, and only then is the cookie
  cleared. A bare key (tools), or no copy of the home here: out when the copy was checked within
  2 s, else one stranger recheck when the budget and `keyMisses` (unknown keys, counted apart from
  codes, so a phone with an old key never holds up a code on the same Wi-Fi) allow, else 503
  `unavailable`, which the browser treats as a dropped connection and asks again. `minRev` on a
  read RPC is honoured with a member recheck.
- **Devices** (`DeviceInfo`): id, the person, a label ("iPhone · Safari", `deviceLabel()`; "iPhone ·
  Home Screen app" when setup or redeem said `app: 'standalone'`, since Safari and the Home Screen
  app send the same user agent and keep separate sign-ins), when it signed in, and `current`.
  Anyone in the home can remove any device. Sign Out revokes this one. "Not Shea?" (`release`)
  runs DemoBackend's `releaseClaim` as the caller (within a day of joining), and `pruneAuth()` then
  signs that person out everywhere.
- **Known limit**: a removed device can still read the home through an instance whose copy has not
  seen the removal yet, for up to `freshMs` (10 s, longer under budget pressure; at the ceiling,
  until that instance next writes). Its writes are refused at once (each write checks the caller on
  the document it writes).

### Setup ("Bring this home online")

`server/core/setup.ts`: limits, setup code (constant time); a home online already: the owner's
second chance (see "Signing in"), else `home_exists`; otherwise
`buildServerHome(phone, { now, ownerUserId })` (`src/lib/logic/serverImport.ts`, whose header is
the full rule list), then `newServerDoc` (with `auth.secret` and `auth.setupHash`) + the owner's
device, stored with `put({ create: true })` (a second setup racing finds the home and gets the
second chance, or `home_exists`). In short, from the phone's `homeos.demo.v1`:

- `buildImportPayloadWithIds()` (`importHome.ts`, now exported; `buildImportPayload()` is it
  without the ids) does the people, areas, items and completions with its rules unchanged: the
  phone's signed-in person is `me` and becomes the **owner** (signed in on this browser), the made-up
  Stats history stays behind, text is cut to the limits.
- Everyone else comes as **not joined yet** (no email), except a person the demo made up whom
  nothing that comes along refers to: so Shea (with her items) comes, Ela (nothing of hers) does
  not. A person can always be added again in People.
- The household's name, address and time zone, areas, every item with all its fields, real
  completions, the **chat the household wrote** (messages after the home was set up on the
  phone, their reactions), and **housekeeping** (the task list as it is, its sections (at most
  30, names cut to 40) included, the message if written after set-up, the visits created after
  set-up with their ticks, comments, prices and the sections their rows had).
- Fresh ids for everything. `serverSetupSummary(raw)` is the same rules' summary for the screen
  (`ServerSetupSummary`: DemoHomeSummary plus `messages`, `visits` and `lastChanged`, the newest
  change that comes along, so an older copy is recognisable).

### ServerBackend (`src/lib/backend/server.ts`)

- Requests send `X-HomeOS: 1` and the cookie (same origin), time out after 15 s
  (`network`), and map errors with `toBackendError`. Any 401 forgets the session and fires
  `onAuthChange(null)` once before rejecting `not_signed_in`; within 30 s of signing in here
  (`FRESH_SIGN_IN_MS`), a 401 is asked once more a second later first. An RPC the server found
  `busy` (nothing was stored) is sent once more after 0.3 to 0.8 s.
- `getUser()` is GET session (null on 401); the session is kept 2 s so `enterHome()` right after
  shares it. `bringOnline` and `redeemCode` send `app` (`appMode()`, `src/lib/appMode.ts`), keep
  the entry they get for the next `enterHome()` (once), fire `onAuthChange(user)`, and write
  `homeos.server.auth` (`AUTH_SIGNAL_KEY`, no secret) so other tabs re-check their session.
  `bringOnline` that meets `home_exists` asks GET session: when this browser is signed in (an
  earlier tap got through and only its reply was lost), that is a success.
- `signOut()` never rejects. When the server can't be reached (offline), the key is still in its
  HttpOnly cookie, which only the server can clear: `homeos.server.signout`
  (`PENDING_SIGN_OUT_KEY`) is set, this browser counts as signed out, and the sign-out is sent
  before anything else at start-up (`getUser()`) and on `online`; a new sign-in drops it.
- Every read sends `minRev`: the newest rev this browser has seen (from polls and every
  response), so it never reads older than it has shown.
- **Polling** (one poller for `subscribe`, `subscribeChat` and `onStatus`): GET version every
  `pollMs` (3 s until the server says otherwise) while `document.visibilityState` is visible and
  someone is using the page: after 3 minutes without input (`pointerdown`, `keydown`,
  `touchstart`, `wheel`, `scroll`) once a minute (`IDLE_POLL_MS`), after 15 minutes not at all
  until input, which polls at once; at once on visible, `focus`, `online` and `reconnect()` (which
  also count as someone being back); never while hidden; stopped when nothing listens. A tablet
  on a stand left on Home asks about 70 times and then nothing. `subscribe`'s `onChange` fires on
  the first successful poll, whenever `rev` goes up, and on the first success after a failed poll
  (the "rejoin" of Sync guarantees). `subscribeChat` gets `{ type: 'resync' }` on the same
  occasions for `chatRev`, plus the change of each of its own chat writes just before that write
  resolves (as the demo backend does). `onStatus` gets `{ readOnly }`.

### HomeProvider in server mode

Phases are unchanged: no key is phase `signedOut`; with a key, `enterHome()` gives `member` or,
right after a redeem that made someone join, `claimed` (the welcome step, as after a Google
claim). New in `HomeContextValue`:

- `serverWelcome: ServerWelcome | null` (null outside server mode), worked out whenever the phase
  becomes `signedOut`: `checking`, then
  - a waiting `?code=` link (`takeSignInCode()`): where home.os may not live (`linkNeedsChoice()`:
    Safari on an iPhone or iPad outside the Home Screen app, or a browser inside another app,
    such as WhatsApp's or Instagram's), it is **not** used up: `private` with the code in the
    field and notice `codeHere` (join in this browser, or type it in the Home Screen app);
    elsewhere it is tried once with `redeemCode`; success opens the home; failure is `private`
    with that code in the field and notice `codeInvalid` or `tooManyAttempts`;
  - else GET status: no home online and a `?setup=` link waiting, while this browser has no demo
    home, or is a browser tab on an iPhone or iPad: `setupElsewhere` (the setup code, this
    browser's own summary if it has one, `ios`); no home online and this browser holds a demo home
    (`serverSetupSummary(localStorage homeos.demo.v1)` not null): `setup` with the summary,
    `pendingSetupCode()` (or `''`) and `elsewhere` on an iPhone browser tab;
  - else `private` (`homeOnline` from status; notice `setupUsed` when a `?setup=` link was waiting
    and a home is online, and that link is forgotten).
- `chooseSetupHere()`: "Use This Copy Instead" on `setupElsewhere`: `setup` with this browser's copy.
- `chooseSavedCopy()`: "Use the Saved Copy" on `setupElsewhere`, or "Use the Saved Copy Instead"
  on `setup`: `setup` with `saved` and the household's saved copy (`lib/logic/savedHome.ts`, the
  home as it was on Stratis's phone on 11 Oct 2026, built by `scripts/build-saved-home.ts`).
  `bringHomeOnline` then sends that document instead of `homeos.demo.v1`.
- `bringHomeOnline(setupCode)`, `redeemCode(code)`, `createCode(memberId)`, `listDevices()`,
  `removeDevice(deviceId)`: see their doc comments. After bringing the home online:
  `onboardingTail` and `invitePeople` (the server variant of "haven't joined yet", below), then
  the home. **No notifications step in server mode** (Onboarding skips it: `finishOnboarding`).
- `readOnly` from `onStatus`; a write that fails with `read_only` sets it too.
- Links: `src/lib/serverLinks.ts` (`captureServerLinks()` from `main.tsx` in server mode only,
  `pendingSetupCode()`, `takeSignInCode()`, `forgetServerLinks()`), kept in localStorage like
  shared links; a `?code=` link opened while signed in is forgotten with the toast "This phone
  is already signed in as {name}."
- Unchanged: optimistic writes, reload ordering, the retry steps, resume, the safety net.
  `reconnect()` simply polls.

### Screens (server mode; copy is exact)

- **Welcome, `private`**: the hero and wordmark as now; instead of Continue with Google: "This
  home is private." (17/600) and "Ask someone at home for a code." With `homeOnline` false, the
  second line is "home.os isn't set up here yet." Then **Have a code?**: one text field
  (`autocapitalize=characters`, `autocomplete=one-time-code`, `inputmode=text`, `spellcheck=false`,
  `maxLength` 20, placeholder "ABCD-EFGH", shown in groups as typed) and **Join** (primary, off
  until 8 letters; busy while it runs). Errors under the field (`role="alert"`): `invalid_code`
  "That code didn't work. Check it, or ask for a new one."; `too_many_attempts` "Too many tries.
  Wait 15 minutes, then try again."; a setup code (12 or more letters), without asking the
  server: "That's a setup code, and this home is already online. Ask someone at home for a
  code." (no home online: "That's the setup code. Enter it in home.os where your home is.");
  else `errorMessage`. Notices above the field: `codeInvalid` "That link's code didn't work. Ask
  for a new one."; `tooManyAttempts` as the error; `setupUsed` "This home is already online. Ask
  someone at home for a code."; `codeHere` "Using home.os from your Home Screen? Open it there
  and type this code. Or join in this browser.", with the link's code in the field, the button
  reading **Join in This Browser**, and **Copy Code** under it ("Copied." or "Couldn't copy.
  Select the code instead."). No Google button and no demo note in server mode.
- **A setup link where the home is not** (`setupElsewhere`), in place of the code field: on an
  iPhone or iPad "Open home.os from your Home Screen." and "Your home is kept in the home.os app
  on your Home Screen, not in Safari. Open it there and enter this setup code."; elsewhere "Open
  home.os where your home is." and "This browser doesn't have your home. Open home.os where you
  use it, and enter this setup code."; the setup code large on a card (28/600, selectable, read
  out a letter at a time), **Copy Code**; when this browser has a copy too, "This browser has a
  copy too: {name}, {counts}, last changed {day}." and **Use This Copy Instead** (text button);
  last, "Or bring your saved copy online from here: {name}, {counts}." ("Or bring your saved copy
  online:" after a copy of this browser's) and **Use the Saved Copy** (text button).
- **Bring this home online** (`setup`): title "Bring this home online"; the card of "Bring over
  the home from this phone" (name, address, "{n} areas · {m} items" plus " · {d} done" and
  " · {k} messages" when there are any, the people with "(you)"); "Last changed {day}." under it;
  on an iPhone browser tab also "Use home.os from your Home Screen? Bring it online from there.";
  then **Use the Saved Copy Instead** (text button). With the saved copy (`saved`): "This is your
  saved copy of the home." in place of those lines, and no such button;
  a **Setup code** field (pre-filled from the link; same input attributes, `maxLength` 20,
  placeholder "XXXX-XXXX-XXXX") with **Paste** at its end where the clipboard can be read (the
  code from the link or on its own; else "There's no setup code to paste. Copy it from the link
  first."); footnote "Everyone else joins with a code you send them from Profile."; **Bring It
  Online** (primary; busy; `errorMessage` under it). Nothing else: no Start Fresh.
- **Welcome home, {name}** (after a redeem that made someone join): the existing ClaimWelcome;
  the "Not {name}?" sheet's message in server mode: "You'll be signed out and {name} goes back to
  waiting to join. Ask someone at home for a new code."
- **{Names} haven't joined yet** (after bringing the home online, `invitePeople`): "Send each of
  them a code. They type it in home.os, or open the link." One row per person not joined: emoji,
  name, **Invite** (creates a code and opens the code sheet). **Continue**. "You can invite them
  later in Profile > Household > People."
- **Code sheet** (any Invite or Add another device): title "Code for {name}" (or "Code for
  another device"); the code large (34/600, letter-spaced, selectable); "Works once, for 7 days.
  On {name}'s phone, open home.os and enter it, or open the link." (another device: "On your
  other phone or tablet, open home.os and enter it, or open the link."); **Share** (the share
  helper, text "Join our home on home.os. Type this code in home.os: {code}\nOr open {link}": the
  code first, since a link opens in Safari or the messaging app's browser); **Done**. A code that
  could not be made because the person signed in meanwhile says "{name} signed in meanwhile, so
  only they can add a device now." in a toast. The sheet has its own surface (`--sheet-*`): in
  dark mode #1c1c1e with a faint top edge, its code card #2c2c2e, over the page dimmed by half,
  so it reads as a step of its own rather than the next part of Profile.
- **Profile**: the account line reads "This device · {label}" instead of "Signed in with
  Google"; **Notifications** (see "Notifications" below); **Add another device** (a code for
  me); **Sign Out** as now. The weekly email and "Invite someone" are hidden.
- **People > a person**: not joined: no Google Email field; **Invite {name}** (code sheet), and
  Remove as now. Joined: **Devices**, each "{label} · Signed in {date}" with **Remove** (asks
  "Remove this device?" / "It will need a new code to get back in." / **Remove**, destructive;
  removing your own signs you out), and **Sign in on a new phone** (code sheet) on your own page,
  and on someone else's once none of their devices is signed in; while they are, the caption
  "Only {name} can sign in on another device, from their Profile. If they lost their phone,
  remove it here, then send them a code." instead. Add Person has no email field; its footnote:
  "Then send them a code from their page."
- **Read-only**: when `readOnly`, Home shows one line under the person filter (13/18 secondary):
  "Saving is paused until next month: the free storage limit is used up." A failed save says
  "Couldn't save. Saving is paused until next month." A save refused because the home reached
  its size limit says "Couldn't save. The home is full."

### Sync guarantees in server mode

The table in "Sync guarantees" holds, every row heard through polling: within about 5 s while
both are open and online (a 3 s poll, the 250 ms debounce, the load), and within about 5 s of
coming back into view or online. A browser polls only while visible and in use (after 3 minutes
without input once a minute, after 15 not until the next input, which polls at once). Writes
resolve as soon as they are stored, and the writer reloads at once (with `minRev`).

### Notifications (`server/core/notify.ts`, Profile)

Phone notifications through Web Push, set by each person for themselves in Profile and kept
by the server, so they apply to all of that person's devices. No email, nothing to set up by
hand beyond the four settings (see "Deploying").

- **What there is.** Three choices, each off until ticked: **Weekly status** (Monday morning:
  what is overdue, what is due from today to Sunday, what was done Monday to Sunday last week;
  To do items only), **Housekeeping report** (the morning after a visit: what was ticked out of
  how many, the comments, the price and the message left for the housekeeper), and **My
  reminders** (each person's own: a title of up to 80 characters and one or more weekdays; at
  most 20). A notification goes only to someone who has joined, ticked it, and has at least one
  device with notifications on.
- **The morning run.** `vercel.json` has `"crons": [{ "path": "/api/home?op=tick",
  "schedule": "0 7 * * *" }]` (only there: Vercel adds it to the Build Output). Vercel's
  Hobby plan allows cron jobs **once a day** at most, invoked anywhere within the hour (an
  expression that runs more often fails the deployment; vercel.com/docs/cron-jobs/usage-and-pricing:
  Hobby "Once per day", "Per-hour (±59 min)"; Pro and Enterprise once a minute). Cron times are
  UTC, so the run comes 07:00 to 07:59 in London in winter (GMT) and 08:00 to 08:59 in summer
  (BST): Profile says reminders come "in the morning, between 7 and 9", and a reminder has days
  but no time ("Morning"). On Pro the same daily run works; a time per reminder would need an
  hourly cron and a time field. Vercel calls the path with a GET, no X-HomeOS header, and
  `Authorization: Bearer <CRON_SECRET>`; the handler checks that in constant time (403 otherwise,
  and nothing is read). A GET of `/api/home` with no op and the `x-vercel-cron-schedule` header
  counts as the run too, should the query not come through.
- **What it sends** (`planMorning()`, in each household's time zone, `today` from the run's time):
  the weekly status on Monday, or on Tuesday when Monday's run did not send it (once per week:
  `sent.weekly` is the Monday); the household's latest visit with something recorded, dated
  before today and at most 7 days ago, once per visit (`sent.housekeeping`), so a visit is
  reported the morning after its day, or the morning after it was saved when that was later,
  and an older visit is never reported once a newer one has been (the morning after, rather
  than weekly on Monday: the run is daily anyway, and the report is useful while the visit is
  fresh); each reminder whose days include today's weekday (at most 10 a morning; once per day,
  `sent.reminders`; a day the run missed is not made up). Payloads `{ title, body, url: '/',
  tag }` for `public/sw.js`, cut to fit Web Push's 4 KB: "This week at {household}" with
  "Overdue (n): A, B and 2 more", "Due this week (n): Bins (today), Boiler service (Thu)" (or
  "Nothing due this week."), "Done last week (n): …" (or "Nothing done last week."); "Housekeeping,
  Thu 8 Oct" with "Done 2 of 3: Kitchen and Bathrooms", "Comments: …", "Price: £45.00",
  "Message left: …"; a reminder's own title with "Reminder for Sunday".
- **At most once.** `takeDue()` plans and records what it plans in `notify.people[].sent` in
  one `'meta'` write (the rev stays: browsers do not reload), and only then are the pushes sent
  (`deliver()`, all at once, 8 s each, TTL 12 hours). The write is applied to the latest
  document like every write, so Vercel calling twice, or two instances running at once, send
  each notification once; a push that fails is not tried again. A push service that answers 404
  or 410 makes the run forget that subscription (another `'meta'` write). Nothing due: no write.
  Read-only (write budget used up): nothing is sent, since nothing could be recorded.
- **Sending** reuses `supabase/functions/_shared/webpush.ts` (VAPID ES256 JWT and aes128gcm
  payload encryption with WebCrypto, no npm package; esbuild bundles it into the function, which
  stays one self-contained file). Subscriptions are only stored, and endpoints only contacted,
  for https on the known push services (Apple, Google, Mozilla, Microsoft), up to 1,024
  characters, with a 65-byte P-256 key and a 16-byte secret. The same endpoint sent from another
  device moves there (a browser that signed in again), so a phone never gets one twice.
- **Budget.** A morning with something to send costs one put (the claim), plus one read when the
  instance is cold; a morning with nothing to send costs no put. Choices and reminders cost a
  put each when changed. About 30 to 60 puts a month of the Hobby plan's 2,000.
- **Profile** (`ServerNotifications.tsx`, `ReminderPage.tsx`, `useNotify.tsx`; copy is exact):
  under **Notifications**, a card with **On this device** and a switch (named "Notifications on
  this device"): on when the browser allows notifications, holds a subscription and the server
  has it for this device. Turning it on asks permission from the tap itself (Safari only prompts
  then), subscribes with the server's public key (GET notify's `publicKey`, so the build needs
  no key) and saves it; off unsubscribes this browser and forgets it on the server. Under it,
  when it needs saying: on an iPhone or iPad outside the Home Screen app (switch off) "On
  iPhone, add home.os to your Home Screen first: Share, then Add to Home Screen."; blocked: the
  same lines as the Supabase build's; no keys on the server: "Notifications aren't set up yet.";
  a browser without Web Push: "This browser can't show notifications.". Then a card of three
  ticks (rows with a checkmark, `role="checkbox"`, each with what it sends under it): **Weekly
  status** "Mondays: what's due this week, what's overdue, what was done last week",
  **Housekeeping report** "The morning after a visit: what was done, comments, price, your
  message", **My reminders** "Your own, on the days you choose"; caption "Sent to each device
  where you turn notifications on." A tick shows at once and is put back, with the not-saved
  toast, when it can't be saved. With My reminders ticked, a **My reminders** section: a row per
  reminder (its title over "Every Sunday · Morning", "Weekdays", "Weekends", "Every day" or the
  days Monday first, "Mon, Wed, Fri"), then **Add Reminder**; caption "Reminders come in the
  morning, between 7 and 9." (at 20: "You have 20 reminders, the most there can be."). A
  reminder's page is pushed from Profile like Household: "New Reminder" or "Edit Reminder",
  **Save** in the bar (off until there is a title and a day), **Remind me to** (placeholder
  "Take the bins out"), **Days** (seven round buttons, Monday first, 40px circles that take a
  finger 44px across without reaching a neighbour, 44px tall below 360px wide; "Pick the days
  it should come on." while none is chosen), **Time** "Morning" with the same caption, and **Delete
  Reminder** for one that exists. Saving or deleting closes it (focus back on its row, or Add
  Reminder); a failure keeps it, with a toast. Loading failed: "Couldn't load your
  notifications." with **Try Again**. Settings load when Profile opens and when the app comes
  back into view.
- `HomeContextValue` gains `notifySettings()`, `setNotifyPrefs()`, `saveReminder()` and
  `deleteReminder()` (ServerAccess's, the same names; a `read_only` refusal sets `readOnly`);
  `src/lib/push.ts`'s `pushState()` and `enablePush()` take the key to use (the build's
  `VITE_VAPID_PUBLIC_KEY` by default).

### Local server and tests

- `server/entry/local.ts` (bundled by `npm run build:server` into `dist-server/local.mjs`): the
  built app and `/api/home` on one port, `FileBlobStore` under `.homeos-local/` or `--memory`,
  `--allow-reset` (`POST /__homeos/reset`), `--attempts <perIp>,<global>,<windowMs>[,<trustedPerIp>]`. `npm run dev:server`
  (`scripts/dev-server.mjs`): bundles the local server, runs it on 4300 (`--api-port` to
  change; `--allow-reset`; `HOMEOS_SETUP_CODE` from the shell, else `TEST-SETU-PCDE`) and Vite's
  dev server (its own script, so Ctrl+C stops both; other arguments go to Vite) with
  `HOMEOS_LOCAL_SERVER=1 HOMEOS_API_PROXY=http://localhost:4300`.
- `playwright.server.config.ts` (`npm run test:e2e:server`, `e2e-server/`): port
  `E2E_PORT` (default 4316); builds with `HOMEOS_LOCAL_SERVER=1` (Supabase and VAPID variables
  emptied, `VITE_FORCE_DEMO` empty) into `dist-server/app`, then runs the local server with
  `--memory --allow-reset --attempts 5,20,60000,5` and `HOMEOS_SETUP_CODE=TEST-SETU-PCDE` (the
  default Blob budgets), plus a second local server on `E2E_PORT + 1` over the same build with
  `HOMEOS_BLOB_WRITES_PER_MONTH=4` (`readonly.spec.ts`: setup, the phone's first use of its key,
  and two changes); one worker; each test starts from a
  reset; `serviceWorkers: 'block'`; timezone Europe/London. Each person is their own browser
  context (`e2e-server/helpers.ts`: `openDevice()` can sign a context in first through its own
  cookie jar, with the same setup or redeem call the screens make, so a test that is not about
  signing in starts on Home; Home opens on Rooms there, as these tests follow rooms and their
  rows, unless `homeView` says otherwise; `userAgent` for an iPhone's Safari; unless `inUse: false`, a
  harmless `wheel` event every 20 s, as a person looking at the phone would make, so a phone that
  only watches another's changes keeps its 3 s polls). Console errors fail a test, except the 400, 401 and 429 answers
  the app expects and shows (a signed-out session check, a refused code, a limit). It proves: setup from the user's home fixture
  (`USER_DEMO_DOC` put in localStorage first) with the summary and everything coming along;
  Shea joining with her code (typed, and as a link) and seeing her items; a stranger with no code
  sees "This home is private"; wrong codes are refused and then limited; removing a device signs
  that browser out; Sign Out; "Not Shea?"; and every kind of change (item create, edit, kind,
  done and undo, delete; areas; household; people added, edited, removed; chat messages and
  reactions; housekeeping message, ticks, comments, price, task list, visits) showing on the
  other context within 5 s without a reload (a mark on the page a reload would lose), including
  two people ticking different tasks and editing different fields of one item at the same moment
  (both changes stay), with a third context (Stratis's tablet) seeing it all and the stored home
  holding every change once; a browser that was offline catching up when back online; no GET
  version while the page is hidden and a catch-up as soon as it is visible; the used code and the
  used setup link refused; the code sheet's copy and focus return; the only device's Sign Out
  warning; read-only (the month's last change, then Home's line and the failed save's toast,
  and reading still working); Bring It Online tapped again after its reply (and cookie) was lost,
  opening the home with one device; a setup link opened in an iPhone's Safari with no home there
  (where to use it, the code, Copy Code) and with a copy there (its age, Use This Copy Instead);
  the saved copy brought online from an iPhone's Safari with no home there (its 11 areas and 21
  items on Home, nothing kept in Safari);
  a code link opened in an iPhone's Safari not used up, then typed in the Home Screen app, which
  People lists as "iPhone · Home Screen app", with no Sign in on a new phone for Stratis to tap;
  and Sign Out while offline staying signed out after a reload online, with its device gone.
- Unit tests (Vitest, `server/**/*.test.ts` and `src`): `rpc` (every method accepts the app's
  real shapes; wrong types, unknown keys, unknown methods, `constructor` and `__proto__` refused);
  `runAs` (the session never reaches the stored home); `auth` (format, normalising, up to 5 live
  codes and the others going when someone joins, who may make one, expiry, single use and the
  lost-reply replay, claim, the owner's second chance, device tokens, device limits); `limits`
  (a burst counted from its start, trusted addresses, the global rule never holding an address
  with no failures, IPv6 by /64); `homeStore` with two stores over one `MemoryBlobStore`
  (concurrent writes never lost, group commit of at most 25, a lost reply not applied twice, no
  put for no change, meta writes keeping the rev, pure and whole-document rollback, the body cap,
  jittered backoff, `minRev`, freshness, budget levels and the ceiling, the read count stored
  every 50 reads, read-only); `handler` (CSRF, content type, body limits, cookie attributes, 401s,
  every op, error mapping, no key, hash, secret or setup hash in any response; and every finding of
  the review: no code for someone signed in elsewhere, 200 wrong codes at once looked at only 10
  times without a write, strangers on many addresses or one IPv6 /64, old keys not counted against
  codes, a device redeemed on another instance signed in at once on this one even under budget
  pressure, at the ceiling and with the limiter tripped, a cookie cleared only when a copy new
  enough says so, 503 rather than 401 when it can't tell, status from memory, `minRev` reads gated,
  the ceiling stopping reads, Bring It Online and a code entered again after a lost reply, the size
  and row limits, the Home Screen app label); `serverImport` (the fixture: Stratis owner, Shea with her items, Ela and the
  made-up history and chat left behind, the starter task list; `demoCreatedDoc()`: one
  completion; real chat and visits after set-up come along); `deviceLabel`; and
  `server/client.test.ts`: ServerBackend against `handleApi` in-process (a fake `fetch`), every
  RPC round trip, polling with fake timers (visible, hidden, focus, online, first poll, rev and
  chatRev changes, recovery, idle backoff and a tab left open for five days), 401 signing out
  (and asked once more just after signing in), `busy` asked once more, Sign Out while offline
  finishing when back online and at start-up, `home_exists` with this browser signed in, the
  `app` hint, the one-off `claimed` entry. HomeProvider and the screens' server-mode behaviour in
  `src` (links that need a choice, a setup link where the home is not, Copy Code, Paste, the
  last-changed line, People's rule for Sign in on a new phone).
- Notifications: `server/core/notify.test.ts` (what goes out when: Monday, a missed Monday made
  up on Tuesday and never later, the visit the morning after and once, reminders on their days
  only, once per period however often the run comes, the household's day in London, the
  wording, payloads under 4 KB; the choices' and reminders' checks; subscriptions on known push
  services only, moved between devices, gone with their device), `server/core/notifyApi.test.ts`
  (the ops through the handler, the private key never in a response, the run answering only
  `Bearer <CRON_SECRET>` and nothing without it, two instances at once sending once, a second
  run storing nothing, 410 forgetting the subscription, and real Web Push to a fake network that
  the phone's key decrypts), `server/core/config.test.ts`, the pure rollback of `notify` in
  `homeStore.test.ts`, HomeProvider's pass-throughs in `HomeProvider.server.test.tsx`, Profile in
  `src/screens/profile/ServerNotifications.test.tsx`, and `e2e-server/notifications.spec.ts`
  (choices and a reminder made on the phone are on the tablet, changed there, deleted on the
  phone, Shea sees none of them; the iPhone Safari line; the run refused without the secret and
  answering with it). The e2e servers get a VAPID key pair made for the run and
  `CRON_SECRET=e2e-cron-secret-not-a-real-one`; nothing is pushed (service workers are blocked).
- `scripts/vercel-function.test.ts` (Vitest): `server/entry/vercel.ts` bundled with the same
  esbuild options as `build-server.mjs`, loaded by Node's own loader from a temporary folder
  outside the repository (nothing resolvable from there), its default export served with
  Node's `IncomingMessage` and `ServerResponse` (the Nodejs launcher with helpers off), and the
  real `@vercel/blob` 2.8.1 talking to a fake Blob service through undici's `MockAgent` (the SDK's
  fetch uses undici's global dispatcher; the network is shut off). It checks the requests the
  SDK really sends (the private blob URL with `cache=0`, `If-None-Match`, `x-vercel-blob-access:
  private`, `x-allow-overwrite: 0` on create, `x-if-match` on every other put, the bearer token),
  the 412 from a moved ETag becoming a retry that keeps both changes, polls with no Blob call,
  the Secure HttpOnly cookie holding a device token, the device's first use stored once without a
  new rev, and no token, setup code or key hash in any response.
- `npm run test:build` (`scripts/check-build.mjs`): with every mode variable emptied, a build is
  demo mode and `build-server.mjs --vercel` publishes nothing (no `.vercel/output`: Vercel
  deploys `dist/` as before); with a random made-up `BLOB_READ_WRITE_TOKEN`, setup code, VAPID
  private key and `CRON_SECRET`, `vercel.json`'s own `buildCommand` succeeds, the app is server
  mode, `.vercel/output` holds `static/` (the built `dist/`), `config.json` (v3, the headers,
  then the filesystem, and the morning cron) and `functions/api/home.func` with exactly
  `.vc-config.json` (Node 22, `index.mjs`, launcher `Nodejs`) and a self-contained `index.mjs`
  with a default export; no secret nor any part of the token is in any deployed file or the
  build log, and the browser's files don't name `BLOB_READ_WRITE_TOKEN`, `HOMEOS_SETUP_CODE`,
  `HOMEOS_VAPID_PRIVATE_KEY` or `CRON_SECRET`. It removes `.vercel/output` afterwards.

### Verifying a deployment

`npx vercel build` needs a Vercel login, so the deployment is proven offline instead (above):
`npm run test:build` (the builds and the Build Output), `scripts/vercel-function.test.ts` (the
function as Vercel runs it, with the real SDK), and the server e2e suite (the app and API
together). Why Vercel will use the output: the Vite preset builds with `@vercel/static-build`,
which, after the build command, uses `.vercel/output` whenever `.vercel/output/config.json`
exists (`getBuildOutputDirectory()` in `packages/static-build/src/utils/build-output-v3.ts`), so
`framework` and `outputDirectory` in `vercel.json` only matter for a build without a Blob store.
There is no `api/` folder, so no zero-config function competes with the bundled one.

After the first deploy with the Blob store connected and `HOMEOS_SETUP_CODE` set, the main
session checks (no user step, no setup code needed, nothing here changes the home; `H='X-HomeOS: 1'`,
`J='Content-Type: application/json'`, `A=https://<app>/api/home`):

1. The build log says `build-server: published dist/ and /api/home in .vercel/output.` (else
   the build was not in server mode: `BLOB_READ_WRITE_TOKEN` was missing at build time).
2. `curl -sSi -H "$H" "$A?op=status"`: 200, `{"home":false}`, `Content-Type: application/json;
   charset=utf-8`, `Cache-Control: no-store`. Without the header: 403
   `{"error":{"code":"forbidden","message":"Missing the X-HomeOS header"}}`. HTML or a 404 means
   the function was not deployed (see the fallback under "Deploying").
3. `curl -sSi -H "$H" "$A?op=version"`: 401 `not_signed_in` with
   `Set-Cookie: homeos_key=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0; Secure`. The same with
   `-H "Authorization: Bearer $(printf 'A%.0s' {1..43})"` (a made-up key): 401.
4. `curl -sSi -H "$H" -H "$J" -d '{"op":"redeem","code":"ZZZZ-ZZZZ"}' "$A"`: 400 `invalid_code`
   (one failed attempt for that address; 10 in 15 minutes, then 429 with Retry-After).
   `-d '{"op":"setup","code":"AAAA-AAAA-AAAA","phone":"{}"}'`: 400 `invalid_code` (a wrong setup
   code, also counted). `-d '{"op":"nope"}'`: 400 `unknown_op`. `-H 'Content-Type: text/plain'
   -d '{"op":"signOut"}'`: 403 `forbidden`. `-X PUT "$A?op=status"`: 405. A redeem body over 4 KiB
   (`-d "{\"op\":\"redeem\",\"code\":\"$(head -c 5000 /dev/zero | tr '\0' x)\"}"`): 413 `too_large`.
   `-d '{"op":"signOut"}'`: 200 `{"ok":true}` with the clearing cookie.
5. `https://<app>/` in a fresh private window: the Welcome screen says "This home is private."
   and "home.os isn't set up here yet." with a "Have a code?" field and no Google button.
   `https://<app>/?setup=K7QM-3XRP-WN9D` (any made-up code; nothing is sent to the server with it)
   in a fresh private window: "Open home.os where your home is." with that code on a card and
   **Copy Code**, and the address bar loses `?setup=`. `https://<app>/?code=ZZZZ-ZZZZ` in a
   desktop browser: "That link's code didn't work. Ask for a new one." with the code in the field.
6. The function's logs show no `HOMEOS_SETUP_CODE is set but is not a setup code` warning.
7. Then the setup link `https://<app>/?setup=<HOMEOS_SETUP_CODE>` goes to the user; once the
   home is online, step 2 gives `{"home":true}`, step 4's setup with the real code gives 409
   `home_exists` once the owner's phone has made a request, and `GET ?op=version` with the
   user's cookie gives `{ rev, chatRev, pollMs: 3000, readOnly: false }`.

Connected Blob stores also get `BLOB_STORE_ID` and OIDC credentials; `@vercel/blob` uses OIDC
when it can and falls back to `BLOB_READ_WRITE_TOKEN` (its token lookup never throws), so
either works. The build only needs the token's presence to choose server mode.

### Open points after integration

- **The saved home (`src/lib/logic/savedHome.json`) is not wired.** It was meant for setup when
  the phone's own copy is not in this browser ("Use my saved copy"). Importing it into the app
  would put the household's address, names and items in the public JavaScript bundle, so it
  must stay out of the client: if wanted, the function should hold it (for example setup with
  `phone: 'saved'`, the summary returned only after the setup code checks out). Today, a setup
  link opened where the home isn't (Safari, while the home is in the Home Screen app) says where
  to use it and shows the setup code with Copy Code; the Home Screen app's setup step has Paste.
- **Who may make a code (a decision for the architect):** the decided design allows codes for a
  person not joined yet, a new person, or yourself. The fix for "anyone could make a code for
  someone joined and sign in as them" keeps that, and also allows a code for someone joined who
  has no device signed in any more, so a lost phone (or signing out of your only one) can be
  recovered by someone at home without anyone typing anything in a console; doing so needs a
  visible step first (removing that person's devices signs them out everywhere). Without it, a
  person who lost their only phone could never be themselves again.
- **Known limits** (by design, documented in "Signing in" and "Budget"): a removed device can
  still read through an instance whose copy has not seen the removal for up to `freshMs`; at the
  read ceiling (90 % of the month's reads) a change made on another instance is seen only when
  this instance next writes; a sustained stranger can use up to `reads / 300` stranger rechecks a
  day per instance, which the ceiling bounds.
- **UI additions beyond the contract, awaiting the architect:** the Item sheet hides Notify in
  server mode; Sign Out and removing the last device say that a new code is needed (and that
  nobody could make one when it is the only device signed in); the extra copy "No devices
  signed in.", "Loading…", a device-list error with Try Again, "Checking" (screen readers only),
  "Joining", "Bringing It Online" and "Everyone has joined"; a failed Add Person in server mode
  shows the not-saved toast. The integration keeps them (the e2e suite checks the first two).
- **Integration changes:** `deviceLabel()` reads `HeadlessChrome/` as Chrome; the code errors
  under the Welcome and setup fields wrap in balanced lines (`text-wrap: balance`).
- A completion that fails because saving is paused still shows its confetti before it comes
  back (as any failed save does, offline too).
- `setupUsed` repeats "Ask someone at home for a code." under the line that already says it
  (the contract's copy).

### The server-mode contract (do not change without the architect)

Fixed: `src/lib/backend/serverApi.ts` (paths, header, cookie name, code alphabet and formats, the
request and response shapes, error codes and statuses, `RPC_METHODS`, `NOT_RPC`), `ServerAccess`,
`ServerStatus`, `serverAccess()`, `Backend.kind` and the three new `BackendErrorCode`s
(`src/lib/backend/types.ts`), `DeviceInfo`, `IssuedCode`, `ServerSetupSummary`
(`src/lib/types.ts`), `ServerWelcome`, `ServerWelcomeNotice` and the new `HomeContextValue`
members, `ServerDoc` and its parts, `BlobStore`, `HomeStore`'s methods, `runAs`, `RPC_ARGS`, the
signatures in `server/core/*.ts` and `src/lib/logic/serverImport.ts`, `buildImportPayloadWithIds`,
`scripts/backend-mode.mjs` and `scripts/build-output.mjs`, and the copy above. Implemented already:
the wire helpers and their tests, `MemoryBlobStore`, the mode choice, the build output helpers and
`scripts/build-server.mjs`. Every other `server/` function and every ServerBackend method throws
"not implemented yet" until built.

Changed by the review fixes (additive; the architect to confirm): the cookie's value is a device
token (the key inside it); `SetupRequest.app` and `RedeemRequest.app` (`AppMode`); `createCode` may
answer 403 `forbidden`; `unavailable` also means "this instance can't tell yet"; `ServerAuth.secret`
and `setupHash`, `DeviceRow.seenAt`, `CodeRow.usedAt`, `usedBy` and `usedClaimed`;
`ServerSetupSummary.lastChanged`; `ServerWelcome` kind `setupElsewhere`, `setup.elsewhere` and
notice `codeHere`; `HomeContextValue.chooseSetupHere`; `HomeStore.write(change, { kind, pure })`,
`recheck()`, `knowsHome()`, `checkedAt()` and `Pressure.recheckMs` and `ceiling`;
`ServerContext.keyMisses`; `AttemptLimiter.begin()` and `AttemptLimits.trustedPerIp`; `newServerDoc`'s
third argument; `deviceLabel`'s second.

Added for notifications (additive; the architect to confirm): `ApiGetOp` `notify`, the POST ops
`pushSubscribe`, `pushUnsubscribe`, `setNotify`, `saveReminder` and `deleteReminder` with their
request types, `NotifyResponse`, `TickResponse`, `REMINDERS_MAX` and the cron-only GET `tick`;
`NOT_RPC`'s push entries; `ServerAccess.notifySettings()`, `setNotifyPrefs()`, `saveReminder()`
and `deleteReminder()` and the same four on `HomeContextValue`; `Reminder`, `ReminderInput`,
`NotifyPrefs` and `NotifySettings` (`src/lib/types.ts`); `ServerDoc.notify`, `DeviceRow.push`;
`ServerConfig.push` and `cronSecret`; `ServerContext.push`; a pure write's rollback restoring
`notify` too; `pushState()`'s and `enablePush()`'s key argument.

`server/entry/vercel.ts` comes with `@vercel/blob` (the integrator installs it and adds `esbuild`
as an explicit devDependency at the version Vite already brings):

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as blob from '@vercel/blob';
import { SETUP_BODY_MAX } from '../../src/lib/backend/serverApi';
import { createServerContext } from '../core/context';
import { errorResponse, handleApi, type ApiResponse } from '../core/handler';
import { VercelBlobStore } from '../store/vercel';
import { readRequest, writeResponse } from './node';

process.env.VERCEL_BLOB_RETRIES ??= '2';
const ctx = createServerContext({ blobs: new VercelBlobStore(blob), env: process.env, secureCookies: true });

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let response: ApiResponse;
  try {
    response = await handleApi(await readRequest(req, { maxBytes: SETUP_BODY_MAX, trustProxy: true }), ctx);
  } catch (err) {
    response = errorResponse(err);
  }
  writeResponse(res, response);
}
```

(`createServerContext()` in `server/core/context.ts` builds the `ServerContext`: `configFromEnv(env)`,
`new HomeStore(blobs, { path, budget })`, a limiter, and `node:crypto` for randomness. The local
entry builds the same with its own store and `secureCookies: false`.)

## Home

Below the hero and the tab switch, Home answers "what needs me now?" first, in words, and
keeps everything else one tap away (`screens/home/HomeScreen.tsx`, `UpNextView.tsx`, logic in
`lib/logic/upNext.ts` + `.test.ts`). The design follows Things 3's Today, Todoist's Overdue,
Apple Reminders' Today and Apple Home's rooms: one accent (the tint) for what can be tapped,
colour only where it means something and always with a word, and few visible controls.

- **The summary sentence** (`homeSummary()`): right under the tab switch, 20/25/600 (a step
  under the hero's title), the lead in the label colour and the rest in grey: "2 things need
  attention and 1 is due today." "Everything else can wait."; "2 things are due today."
  "Nothing urgent or late."; "Nothing urgent today." "Next up: Water the plants, in 2 days.";
  "All clear." "Nothing to do right now." It counts what the person filter shows, and says
  whose they are while it narrows Home (`SummaryScope`): "For you, 1 thing needs attention.",
  "For Shea, nothing urgent today.", "Unassigned: 2 things are due today.", "All clear for
  Shea.", "Nothing unassigned to do."
- **The read-only line** (server mode, saving paused): one quiet line (`role="status"`) right
  under the sentence.
- **The view switch and whose items**: one row under the sentence: a small segmented control
  (a radio group "View": **Up next**, **Rooms**, **Calendar**; 32px with 14px words, against
  the tab switch's 44px and 17px, so the two never read as one; each segment a 44px tall
  target, its label cut short inside it so nothing clips that target; arrow keys, Home and End
  move the choice), then **Mine** and the people menu (see "Home: date and the person
  filter"). The view the person picks on the switch is kept on this device (`homeos.homeView`
  = `rooms` or `calendar`, nothing for Up next; every read and write in try/catch). A shared
  room link shows Rooms for that visit only (`showForLink` in `useHomeView()`): it is not
  stored, and gives way as soon as the person picks a view, leaves Home or reopens the app, so
  a link from the chat never changes what Home opens on. Below 390px the segments' words drop
  to 13px; below 350px the switch takes a line of its own (every word whole) and Mine and the
  people menu the line under it; nothing scrolls sideways at 320px.
- **Up next** (the default, `upNext()`): one list across every room, grouped by when:
  **Needs attention** (`needsAttention()`: a To do that is late or Urgent, whatever its date,
  and a To maintain item that Needs work), **Today**, **Next 7 days** (tomorrow to a week
  today), **Later** (after that, or no date). Empty groups are left out. Needs attention and
  Later are sorted by `compareByUrgency()` (late first, then Urgent, Within the month, Not
  urgent, then the earliest date, then the oldest); Today and Next 7 days by `compareByDate()`
  (the earliest date first, then urgency), so "In 2 days" never sits under "In 6 days". Later
  shows three rows, then "Show 6 more" / "Show fewer" (a disclosure, `aria-expanded`;
  `ShowMore.tsx`, as a room's). Things looked after that are Good or Okay close the view under
  **Looking after** ("All in good shape.", or "Keep an eye on anything marked Okay." when one
  is Okay; while something looked after needs work, and so is under Needs attention, never
  "all in good shape": "1 needs work, under Needs attention.", `lookingAfterNote()`), Okay
  first: two columns of tiles (the room, who, the name, the gauge and the word,
  Okay in amber words; a tile opens the item), or one row in a card when there is only one. Rows in the
  groups show their room; a row in Today leaves its date out. Nothing open: one card, "All
  clear" (or "Nothing for Ela right now.").
- **Rooms** (Apple Home's rooms): first, on the right where the other views have their first
  heading, one quiet text button, **Collapse all** / **Expand all** (15px `--tint-text`, a 44px
  target; rooms with nothing open don't count: they have nothing to fold), so the first card
  starts at the same height in all three views. Then the rooms in the household's order, one
  card each, 12px apart. The card's header (58px) is the room's drawing in a soft rounded square
  (`RoomIcon.tsx`: a pot, sofa, bath, bed, leaf, plant, hot tub, door, tulip and more, chosen
  from the name, a house when nothing matches; tinted red while something there is late,
  urgent or needs work), then its name (17/22/600) with a small chevron that stays on the line
  with the name's last letter, all one disclosure button (`aria-expanded`, `aria-controls`)
  inside the `h2`. Then one quiet word (`roomStatus()`): "1 late", "1 urgent", "1 needs work"
  or several ("1 late, 1 urgent") in red, "3 open" in grey while folded, "All clear" for a room
  with nothing open; the disclosure is described by it (`aria-describedby`), so VoiceOver says
  "Hallway, expanded, 1 late". Beside a long name on a small phone the word wraps only
  between its parts ("1 late," then "1 needs work"), and the name only between its words where
  it can. A tap on the word folds or opens the room too, as on the name
  (it is no button of its own: the name's button carries it for the keyboard and VoiceOver).
  Then a borderless "..." ("<area> options", 44px, lined up with
  the rows' right edge) whose menu, named after the room, holds **Add Item** ("Add item to
  <area>": the new-item sheet with that area chosen) and **Share Room** (named by its words, as
  seen and as Voice Control hears them; see "Sharing"). Under the header (a hairline in
  between), the room's To dos, most urgent first (`roomOrder()`, the order Share Room lists
  them in), three of them and "Show 2 more" / "Show fewer" when two or more are left (a room
  with four shows all four), then, under a hairline and a small "Looking after" label, the
  things it looks after. Folded, the rows slide shut (about 320ms, none with Reduce Motion)
  and are inert and hidden, leaving one line per room: Collapse all gives an overview of the
  house, one line a room with how many are open. Folded rooms are kept in localStorage under
  `homeos.collapsed.<householdId>` (deleted areas are forgotten). A room with nothing open is
  one quiet line in its place in the order: its drawing and name in grey, "All clear" and its
  menu (its `h2` takes focus, `tabIndex={-1}`).
- **Calendar**: see "Home: the calendar".
- **Rows** (`ItemRow.tsx`): a neutral grey ring (24px, `--ring-idle`, 3:1 on the card; a 44px
  tap circle, "Mark <title> as done") for a To do, or a condition gauge for a To maintain item
  (`ConditionGauge` in `StatusRing.tsx`: three rising bars, Good fills three, Okay two, Needs
  work one, in its colour; never a ring, as it is never done). Then the title (two lines at
  most; a note is never on the row, not even as a glyph: it is in the Item sheet, and
  VoiceOver hears "has a note") and, at the end of its first line, who it is for (`Who`):
  their emoji and first name (13px grey; nothing when unassigned, and nothing while the person
  filter shows one person's items, as they would all say the same). Under both, one 13px line
  (`RowMeta`): the label (`RagBadge`), at three volumes so red stands out: a red pill
  "Urgent", a dot and amber words "Within the month" (500, `--rag-amber-text`: #9a5b00, 5.4:1
  on the card and a hue well apart from the red; #ffb340 in dark), a dot and grey words "Not
  urgent"; for To maintain the same without the dot (its gauge shows it): a red pill "Needs
  work", amber "Okay", grey "Good". Then when it is due (`relativeDue()`: "Today", "Tomorrow",
  "In 4 days", "In 3 weeks", "In 2 months", the date a year or more away; "2 days late" in
  red, the only red date), a repeat glyph, "Updated 2 days ago" for a To maintain item
  (`relativeUpdated()`, in the household's time zone) where the room isn't shown, and the room
  with its drawing where the list mixes rooms. A dot follows quiet words and goes before the
  room; after a pill the next words follow straight on. The room is always whole: on the line
  while it fits, else at the start of the next ("Bathroom Small" and "Bathroom Large" never
  both read "Bathroom ..."), cut short only when its name is wider than the whole line.
  Assistive tech hears one sentence instead of the visible lines: "Heaters not working,
  Urgent, 2 days late, Hallway, Shea, has a note." Completing: the ring fills with the tint,
  the check springs in and the title is struck through (420ms), a row that leaves its list
  folds away (260ms; none of the motion with Reduce Motion), then the item completes with an
  Undo toast ("Marked as done", or for a repeating job when it comes round again, in the
  words its row will use: "Done. Next one in 8 weeks", `doneMessage()`); a small burst of
  hedgehog and duck confetti (14) and a light haptic. The toast shows as the row goes, not
  once the server answers (a slow connection left a second with nothing to tap); Undo waits
  for that answer before taking the completion back, and a completion that never saved has
  nothing to take back (its own toast says so). A toast with a button stays 8 seconds
  (`ACTION_TOAST_MS`; a finger can't hold it, only a hovering mouse or keyboard focus can),
  one with words alone 4 (`TOAST_MS`).
- **The round +** (`AddButton` in `TabBar.tsx`): adds an item. After a shared room link opened
  a room (`onRoomContext`), it widens to "+ Garden" and is named "New item in Garden", and the
  new-item sheet opens with that room chosen, until another view or tab is chosen.
- **What was saved can be seen**: when an item is created, or moved to another area, the Item
  sheet reports it (`onSaved(itemId)`), and App passes it to Home (`revealItem`) while Home is
  behind the sheet. Once it is in the list (a new item comes with the next load), Home shows
  everyone's items for that visit if the person filter hides it (`showAllForNow`: not
  remembered, so Mine stays the choice Home opens on), opens its room if folded, and holds it
  for a moment in `RevealContext` (`screens/home/reveal.ts`): a "Show N more" over it opens
  (`useFold()` in `ShowMore.tsx`: Up next's Later and a room's To dos; it can be folded again
  straight away), the calendar goes to its day, and its row lights up (a tint wash that fades
  over 2.4s, `data-lit`; a tile gets a ring) and comes into view whole, clear of the docked
  tab switch and the + (`revealRow()`: measured, as `scrollIntoView` with the rows' scroll
  margins stopped short in Chromium, which cut them at the cards' clipped edges, and at the
  scale of the page still pushed back behind the closing sheet). The calendar shows only To
  dos with a date: one saved from it without a date, or a thing looked after, gets a toast
  saying where it went (`notOnCalendar()`: "Saved in Kitchen. It has no date, so it isn’t on
  the calendar.", "Saved in Garden. Things looked after aren’t on the calendar."). Leaving
  Home drops a reveal not yet shown.
- **Keyboard focus** never lands on a row in a collapsed area: after a completion
  (`ItemRow`) or when the Item sheet closes on a row that is gone (`App` `restoreFocus`),
  focus goes to the nearest row that can be seen (`inCollapsedArea()` in
  `screens/home/areaPanel.ts`), else to the room's name or the group's heading
  (`rowFallback()`), else the round +.
- **Menus** (`ui/Menu.tsx`): a pull-down menu as iOS draws one, grown out of its button, an
  optional small grey title ("Show tasks for", which names it), items with an optional second
  line ("Not joined yet") and quiet trailing text ("5 open"); `aria-haspopup="menu"` and
  `aria-expanded` on the button; `menuitem` or `menuitemradio` items; focus goes to the chosen
  item (or the first), arrow keys, Home and End move, Escape or Tab close it and focus goes
  back to the button. Choosing an item puts focus back on the button first, so a sheet it opens
  returns focus there. A tap outside (which it swallows), a scroll that moves its button or a resize closes it. Its
  glass is nearly opaque (`--menu-glass`, 0.98, blur 40px), so nothing behind shows through
  the words, and solid (`--menu-solid`) with Reduce Transparency or where `backdrop-filter`
  isn't supported.
- **Dark mode**: tokens in `styles/tokens.css` follow `prefers-color-scheme` (iOS dark system
  colours: black page, #1c1c1e cards, lighter status text tones that keep 4.5:1; the
  segmented controls' thumb is `#545458`, so it sits back as the white thumb does in light).
  The toast is two steps lighter than a card there, with a hairline edge (`--toast-bg`,
  `--toast-edge`, `--toast-shadow`), so it never sinks into the list; placeholders, disabled
  buttons, the switches' off track and pressed rows use tokens too (`--placeholder`,
  `--label-quaternary`, `--fill-secondary`, `--fill-tertiary`), on every tab. Every word in
  the tint (Show 6 more, Today, Show month, Collapse all, Save, Done, Cancel, Clear, Edit) uses
  `--tint-text`, and white words sit on `--tint-fill`, 4.5:1 or better in both appearances
  (see "Styling conventions").

### Home: date and the person filter

- The hero's top line shows today's date in full ("FRIDAY 9 OCTOBER", `longDay()` in
  `lib/logic/dates.ts`, the household's day), level with the avatar.
- `PersonFilter` (`screens/home/PersonFilter.tsx`, logic in `personFilter.ts`), on the view
  switch's row, 32px tall (44px targets), grey until they narrow Home, then a tint wash (never
  a solid fill):
  - **Mine**: one tap. A toggle button (`aria-pressed`, named "Mine") with your emoji and the
    word (the word only from 350 to 369px wide, where it shares its line with the view switch;
    narrower, the controls take two lines and both show). On, Home shows only your items;
    tapped again, everyone's.
  - **The people menu**: a small pill (a people glyph and a chevron, or the chosen person's
    emoji, or a dashed circle for Unassigned), named "Show tasks for: Everyone" (or "Shea",
    "Stratis (you)", "Unassigned"), washed in the tint while it narrows Home to someone other
    than you. It opens a menu titled "Show tasks for": Everyone, you, each other member and
    Unassigned, each with how many are open ("5 open"; VoiceOver "5 items") and, under someone
    who has not joined yet, "Not joined yet"; the chosen one checked.
  Choosing a person shows only items assigned to them, in every view, and only the rooms where
  they have some; Collapse all acts on what is shown. The choice is kept per household
  on this device (`homeos.who.<householdId>`); a member who left reads as Everyone. Saving an
  item the filter hides shows everyone's for that visit, and so does a shared area link (see
  "Sharing"): not remembered, and gone once the person picks, leaves Home or reopens the app,
  so Mine stays their own choice.
- People's 🦆 and 🦔 are drawn (`ui/EmojiText.tsx`: the green duck and brown hedgehog of
  `ui/animals.ts`) wherever a member's emoji shows, with the character kept in the text for
  copying and screen readers.

### Home: the calendar

`screens/home/HomeCalendar.tsx` (+ `.module.css`, `.test.tsx`), logic in
`lib/logic/calendar.ts` (+ `.test.ts`) and `lib/logic/months.ts`, on the date picker
`ui/DatePicker.tsx` (+ `.module.css`, `.test.tsx`: the bar, Show month / Show week, Today, the
chosen day and the week and month shown, `useChosenDay()`, and `revealDay()`) and its calendar
card `ui/MonthCalendar.tsx`, both of which Housekeeping uses too (see "Housekeeping" UI 2).
Nothing new is stored on the server.

- **Where**: Home's third view (**Calendar** in the view switch). First a 48px bar
  (`DatePicker`'s `headingId`): on the left the calendar's heading, an `h2` (20/25/600, the
  section title every tab's headings share, `ui/type.module.css`) that
  names its section, always relative, so it says what the card's title doesn't: "This week",
  "Next week", "Last week", else "In 8 weeks" or "2 weeks ago" (`weekHeading()`); "This month",
  "Next month", "Last month", else "In 2 months" or "3 months ago" (`monthHeading()`). On the right **Today** (15px
  `--tint-text`, its own 44px target) whenever today isn't the chosen day or isn't shown, and **Show
  month** / **Show week** (the same). The `line` the bar can show for today is Housekeeping's;
  Home has none, as today's list shows at once.
- **Week or month**: the week strip (one row of seven days, Monday first) is the default; Show
  month gives the month. Both are a card whose top row has Previous and Next (44px chevrons,
  "Previous week" / "Next week", or "Previous month" / "Next month", no limit either way) round
  a centred title, 17/22/600: the month ("October 2026") or the week (`weekTitle()`: "5 to 11
  October", "28 Sep to 4 Oct" across two months, with the year when it isn't this year's: "28
  Dec to 3 Jan 2027"), so the heading says where the week is and the card's title which days.
  The arrows stay in the card's top row rather than either side of the days: there they would
  take the days under 44px wide at 375px. The grid of the week is named "Week of Monday 5
  October" (`weekName()`). The choice is kept on this device (`homeos.calendar` = `month`,
  nothing for the week; every read and write in try/catch; `useCalendarView()`, which Home's
  calendar keeps and hands to its `DatePicker` so it knows which days are shown), as the brief
  asks, so the month can be what Home opens on; it is the user's choice, and Show week is
  always at the top of it.
- **The week and month shown** (`HomeCalendar` keeps them, MonthCalendar's `week` and
  `onWeek`): at first this week and this month. The keys move them too (past the edge of the
  strip goes on into the next week). Show month opens on the month of the chosen day if the
  strip shows it, else of today if it shows that, else of the week's Monday. Show week opens on
  the chosen day's week when that day is in the month shown, otherwise on this week with today
  chosen. **Today** chooses today and shows its week (or month), as at first; if it had focus,
  focus goes to today's button, as Today itself goes. They are remembered with the chosen day
  while the app runs, per household, so Home is as it was left after a tab switch (Today brings
  it back); a new day (midnight, or back from the background the next morning) starts on today
  in this week and month again, and MonthCalendar forgets the day the keys last moved to (the
  roving tab stop is today again).
- **The chosen day**: today at first: what is due today shows under the card at once.
  Choosing another day shows its details there instead. Changing week or month keeps it
  chosen, but while it is not among the days shown (`isDayShown()`) one quiet line, "Pick a
  day to see what is due.", takes the place of its details, so a list never reads as part of
  a week it isn't in; choosing a day (or Today) brings a list back. An item just saved has
  its day chosen and shown (`RevealContext`). Choosing a day
  says what it holds through a polite, visually hidden live region
  (`calendarDayAnnouncement()`: "Wednesday 14 October: 4 due (1 urgent, 1 within the month, 2
  not urgent). Details below the calendar.", "Thursday 8 October, today: nothing due. …")
  and, when its details are low on the screen,
  scrolls them up (`revealDay()`: measured, as `scrollIntoView` with `block: 'nearest'` did not
  scroll at all in Chromium: as much of the day as fits above the floating +, which is the
  scroll area's bottom padding, without taking its heading up under the docked tab switch,
  the scroll area's `scroll-padding-top`; no smooth scroll with Reduce Motion); focus stays on
  the day.
- **What marks a day** (`calendarDays()`, `calendarLookup()`, worked out a month at a time):
  - **To do items due** that day: open tasks with a due date (`isDated()`), the person
    filter applied (with Shea chosen, only Shea's). Under the day's circle, one 6px dot per
    item in its urgency's colour (set in CSS from its `data-rag`, so dark mode has its own),
    red first, then amber, then green, at most three, then "+2" (`dayDots()`). A day before
    today with something still open is **missed**: its number is red (`--destructive`, 600)
    and its items count as missed.
  - **Repeats** (`repeatDates()`): a repeating item's next due date is its own mark; in the
    days shown (the month, or the week) its later rounds are faint hollow dots, after the
    solid ones: a 1.5px ring in the darker words colour of its urgency (`--rag-*-text`) at
    80%, which keeps 3:1 against the card in both appearances (light: green 3.7:1, amber
    3.7:1, red 4.5:1) while being clearly lighter than a solid dot. They are where Mark as
    Done would move it, one completion after another:
    `nextDueDate()` from its due date (from today for a missed one, as `complete_item` does),
    then one interval at a time (weekly, monthly, quarterly, every 6 months, yearly; month
    ends clamp and carry on: 31 Jan, 28 Feb, 28 Mar). ISODate arithmetic only, so the clock
    changes in London move nothing.
  - **The housekeeping visit**: a recorded visit (`isRecorded()`, whoever the filter shows) has
    the mark Housekeeping's calendar gives a visit, the 5px tint dot inside the circle under
    the number (white on the chosen day's fill), so the same day looks the same on both tabs.
    It sits inside the circle, the status dots under it, and it is tint blue, never a status
    colour.
  - To maintain items have no date and never mark it; nor do done items.
  - The legend, under the days in the week strip and the month alike, says what every mark
    means in words (hidden from assistive tech, as each day's name says it): on one line a red
    dot "Urgent", an amber dot "Within the month" and a green dot "Not urgent"; on the next a
    hollow dot "Repeat", a small circle with the tint dot "Housekeeping" and "Red date:
    missed" (the words "Red date" in the missed red).
- **Under the calendar** (the chosen day, once opened): an `h3` (the section title,
  `tabIndex={-1}`) with the day in full (`fullDay()`, with the year when it isn't this year's),
  then a card: its items as Home's own rows (`ItemRow`: the ring completes, the row opens the
  Item sheet) in the order of its marks (`dayRows()`: missed first, then red, amber, green;
  Home's order breaks ties), then its repeats in the same order. Each row shows its room; a
  row due that day leaves its date out (the heading says it); a missed one keeps "2 days
  late". Today first lists what is still open from before it (`lateItems()`: most urgent
  first, then the longest late), with "1 late" beside its heading in the missed red (as a room
  says it beside its name; it takes no room of its own, so today's first row stays on the
  first screen), then its own rows under a small "Due today" label (or the line saying there
  are none): marked only on their own day, a late job left today reading "Nothing due for
  Shea today." while it was two days late. Choosing today says
  them first too ("Thursday 8 October, today: 1 late (urgent), 1 due (not urgent). Details
  below the calendar.").
  Repeats (`RepeatRow`: a faint dashed grey ring that is not a button, the title in secondary
  grey, then on the quiet line (`RowMeta`, as on every row) its urgency in words, "Repeat of
  Thu 8 Oct · Every week" (`repeatMeta()`; how often gives way first on a narrow screen) and
  its room, and who it is for, read as "<title>, Within the month, repeat, …"; the row opens
  the Item sheet). Nothing:
  "Nothing due today." / "Nothing due." ("Nothing due for Shea." with Shea chosen, "Nothing
  unassigned due." for Unassigned). Then, for a day with a recorded visit, a card with one
  row: the broom, "Housekeeping visit" and "6 of 7 done · £60.00" (`visitSummary()`), named
  "Housekeeping visit, 6 of 7 done, £60.00. Show in Housekeeping". It opens that day in
  Housekeeping: App switches tab and passes the day (`showDay`); Housekeeping chooses it in its
  date picker (in its week and month), so the day shows in place of the Today section, then
  scrolls its heading to the top and focuses it (`tabIndex={-1}`); for today, the Today
  section's heading.
- **Two lists of rows**: the chosen day's (inside `section[data-calendar]`) and the areas'.
  Moving focus to a nearby row (after a completion in `ItemRow`, or when the Item sheet closes
  on a row that is gone in `App`) stays in the row's own list (`rowsBeside()` in
  `screens/home/areaPanel.ts`), and falls back to the area's name or, under the calendar, the
  chosen day's button (else the day's heading) (`rowFallback()`). Every row under the calendar leaves its list once
  completed (`ItemRow` `leavesOnComplete`), a repeating one too, as it moves on to a later
  day; in the areas only a one-off leaves.
- **Accessibility**: the grid is a `table` with `role="grid"`, labelled by the month title
  (`aria-live="polite"`) or the week's name (the week's title is a polite live region too);
  columns are `th scope="col"` with the full weekday as `abbr`; each day cell is
  `role="gridcell"` with `aria-selected`, holding the day's button, named by
  `calendarDayName()`, which says the dots' colours in words ("Friday 16 October, 3 due (1
  urgent, 2 not urgent), 1 missed (urgent), 2 repeats, housekeeping visit"; one urgency
  alone reads "1 due (within the month)"; ", today" after the date, ", selected" last); the
  marks are `aria-hidden`. One day button is
  in the tab order (the one the keys moved to, else the chosen day, else today, else the first
  day shown); arrow keys move a day or a week, Home and End go to the start and end of the
  week, Page Up and Page Down change month, and moving past the edge goes on into the next
  month or week. Day buttons fill their cells: 52px tall (48 below 360px wide), at least 44px
  wide from 360px up (about 40 at 320, like Housekeeping's). Nothing relies on colour alone:
  missed dates are bold too, repeats are hollow, the visit sits inside the circle.
- **Room on the first screen**: the calendar is a view of its own, so it never pushes Up next
  or the rooms down. At 402 by 874 the heading, the strip and today's first row are on the
  first screen. The month is taller than a screen at 320.
- **Demo seed**: `?demo-seed=1` adds `DEMO_CALENDAR_ITEMS` (`lib/constants.ts`) to
  `SEED_ITEMS` (only there: never a real household's list). With the e2e clock (Thu 8 Oct
  2026): the dehumidifier due today (weekly, Shea), the plants on Sat 10 (weekly, Ela), and on
  Wed 14 four things due (the gutters red, the shower amber, the garden furniture and the bins
  (weekly, Stratis) green: three dots and "+1"), with the weekly jobs coming round faint for
  the rest of the month, Heaters missed on Tue 6 and the visit on Thu 1. Garden Lounge keeps
  one status and Front garden two, so their names still fit beside the counts at 320px.
- **Tests**: `lib/logic/calendar.test.ts` (weeks and their titles, the clock changes in London,
  repeats of every interval, month-end clamping, missed repeats, marks, dots, the day's order,
  names, announcements, the repeat line and today's line), `screens/home/HomeCalendar.test.tsx`
  (week and month, Previous and Next week, Today and where focus goes, a new day after a tap in
  the week and in the month, which week Show week opens on, the marks, the view kept on this
  device and without storage, choosing a day, the order of its rows, completing from it by
  keyboard (a weekly item, and the last row of a day off the grid), repeats, the visit link,
  empty days for each filter, scrolling the day up with Reduce Motion, the day remembered, the
  keyboard), `HomeScreen.test.tsx` (the filter narrows the marks, today's list open at once,
  completing from the chosen day), `App.test.tsx` (a visit opens its day, and today's the Today section,
  in Housekeeping) and `e2e/calendar.spec.ts` (the marks, the filter, the strip moved by taps
  and Today, a December day then back to this week by taps, choosing a day and completing from
  it, the view remembered after a reload, the link to Housekeeping, the keyboard (a weekly
  item and an off-grid day completed from the list), a new day after midnight, Reduce Motion,
  320, 375 and 402px with no sideways scroll and 44px targets, the first screen at 402 by 874
  and 320 by 700, a day low in the month brought up above the + at 320 by 700, Housekeeping's
  date picker the same bar and card, and the visit marked the same on both), and
  `ui/DatePicker.test.tsx` (the line and Today, Show month and Show week kept under the screen's
  own key, `lastDay`, the chosen day kept per household until a new day). The e2e helpers
  `ring`, `row` and `areaHeadings` look in the areas only (`areas()` in `e2e/fixtures.ts`),
  since the chosen day lists rows of its own.

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
  left of Save (none while creating an item: there is nothing to link to yet). Each room's
  "..." menu on Home has **Share Room** (named by its words; the menu is named after the room,
  see "Home"). Both use `ShareIcon` (square.and.arrow.up).
- **What** (`lib/logic/share.ts`, pure and unit tested): plain text, then a blank line and a
  link back into the app. An item is shared as the sheet shows it, edits not yet saved
  included (as they would be saved; a blank title keeps the saved one). Sharing saves
  nothing, and the link opens the item as it is:

  ```
  Heaters not working
  Hallway · Urgent · Missed · Tue 6 Oct
  Assigned to Shea
  No heat since the weekend. Engineer needs booking.

  https://<app>/?item=<id>
  ```

  A task reads `Due Fri 13 Nov` (or `Missed · Tue 6 Oct`) and adds its repeat (`Every month`);
  a To maintain item reads `Updated <day>` (household time zone), `Looked after by <name>` and
  adds `What good looks like: …`. Names never carry the emoji; no assignee reads `Unassigned`.
  Notes are tidied (spaces squashed, blank lines dropped) and cut at a word with "…" past 280
  characters (`SHARE_NOTE_MAX`). An area lists its open items in the order its card on Home
  lists them (`roomOrder()`: To dos most urgent first, then the things it looks after, by
  name), one line each: `Kitchen (2 items)`, `• Olive oil · Not urgent · Due Fri 13 Nov`, …; nothing open reads
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
  the link in localStorage (`homeos.link`, with the time) until the household has loaded, so it
  survives signing in and the Google redirect, like an invite. It is forgotten after an hour,
  when taken, and on sign out. Once the household is ready, `useSharedLink` (in App's main
  shell) opens the item's sheet, or switches to Home, where `HomeScreen` (`linkedArea`) shows
  its Rooms view, expands the area (remembered as open), scrolls it to just under the stuck tab
  switch once its card has opened (the screen's `scroll-padding-top`), moves focus to its name
  without scrolling (VoiceOver reads "Garden, expanded" and carries on into its items), and
  rings the card in the tint colour for a moment (`data-linked`). If the person filter hides
  the area, or some of its items, it goes back to Everyone, so what was shared is all there.
  The round + then adds to that room ("+ Garden", "New item in Garden") until another view is
  chosen. Leaving Home before that happens (App's `switchTab`) drops the link, so it can't
  scroll Home on a later visit. An id this household doesn't have gets a toast ("That item
  isn’t in your home", "That area isn’t in your home"); a one-off item that has been done says
  "“<title>” is already done". RLS already keeps other households' rows out of `load()`, so a
  link is no way in.

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
  (no due date, Never, 1 day before) from the Item sheet (`withKind()`); a task that becomes
  a state keeps its task fields in the sheet's draft until it is saved, so switching back
  before saving restores them.
- **Item sheet**: a two-option segmented control (**To do**, **To maintain**; the Stats control
  style) under the title and note, above the picker (`RagPicker.tsx`: "How urgent?" with
  Urgent "Needs doing now", Within the month "Some time in the next few weeks" and Not urgent
  "Whenever there is time"; for To maintain "Condition" with Needs work "Not as it should
  be", Okay "Fine for now, keep an eye on it" and Good "Just as it should be"; a native radio
  group in red, amber, green order, each radio named by its word with the hint as its
  description). For To maintain the Due, Repeat and
  Notify rows and Mark as Done are hidden, "Assigned to" reads **Looked after by**, and
  **What good looks like** appears under the control (see below).
- **Home row**: a task keeps its neutral ring (tap to complete). A state shows its condition
  gauge in the ring's place (three bars; see "Home"); it is not a button and taps go through
  to the row, which opens the sheet. Its line reads `Good · Updated 2 days ago`, from
  `updated_at` in the household time zone, and who looks after it sits at the end of its
  title's line. Assistive tech hears `<title>, to maintain, Needs work, …`.
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
- **Sections** (`supabase/migrations/20261015000100_housekeeping_sections.sql`): the list can
  be divided into sections ("Kitchen", "Bathrooms"). Anyone creates, renames, reorders and
  deletes them, adds a task straight into one, and moves tasks within a section or between
  sections (dragging, the arrow keys, or Move to Section). Names are trimmed, 1 to 40
  characters (`TEXT_LIMITS.housekeepingSection`); a household has at most 30
  (`HOUSEKEEPING_SECTIONS_MAX`). A task's position is its place within its section (or among
  the tasks in no section). A move is one task (or section) and where it goes: its section and
  its index there, which the store clamps to the list as it stands and closes up around. So
  two people moving different tasks at once both keep their moves, and a task added or deleted
  on another phone meanwhile never refuses one. The list's order is the tasks in no section
  first, with no heading, then section by section in the sections' order (`listOrder()`).
  Deleting a section keeps its tasks: they move to the top, with no section, after the tasks
  already there, in their order, on today's visit too; the app asks first. An empty section is
  not shown on a checklist. A household from before sections has none: every task and row in
  none.
- **Visits**: at most one per household and day (the household's time zone), today or earlier,
  never in the future. A visit is created by the first write for its day: ticking or unticking
  a task, saving comments or the price, or "Add a visit". When it is created it copies:
  - the task list: each task's title, its section (its id, and its name then as
    `section_title`) and its place, none done, one row per task, positions running section by
    section;
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
  keeps the title it was ticked under and stays when its task is deleted (in its section while
  that is on the list, after the rows of the section's tasks; else with none). Sections too:
  after every change to the list, today's rows take their tasks' sections, the sections' names
  and order (`relayVisit()`, `housekeeping_relay()`). Visits on earlier days never change: they
  keep the sections they had, by their names then, in their order (a deleted section's rows
  keep its name and their place, so two deleted sections of one name stay two, unless they
  were next to each other: with no section left to tell them apart, those read as one).
- **Comments**: free text, trimmed, up to 4000 characters. **Price for the day**: GBP, typed on
  a decimal keypad, stored as whole pence from 0 to 1,000,000 (`HOUSEKEEPING_PRICE_MAX_PENCE`,
  £10,000.00), shown as £45.00; null means not entered.
- A visit's copy of the message is read-only. Its ticks, comments and price stay editable on
  any day (everyone edits everything), and anyone can delete a visit (confirmed), for everyone:
  today's from the Today section once something is recorded on it, another day's under the
  calendar.
- **Live**: changes by others show up as they happen, like items (`Backend.subscribe`, reload
  on any event).

### Tables (migrations `supabase/migrations/20261010000400_housekeeping.sql`, `20261015000100_housekeeping_sections.sql`)

| table | columns |
| --- | --- |
| `housekeeping_sections` | id, household_id → households on delete cascade, title text not null (trimmed, 1 to 40), position int not null default 0 (a new one goes last), created_at |
| `housekeeping_notes` | household_id uuid **primary key** → households on delete cascade, body text not null default '' (trimmed, <= 4000), updated_at timestamptz not null default now(), updated_by → members on delete set null; cleared_body text null, cleared_updated_at timestamptz null, cleared_updated_by → members on delete set null (what the last Clear took away, for Undo; null otherwise). No row = never written. |
| `housekeeping_tasks` | id, household_id → households on delete cascade, title text not null (trimmed, 1 to 200), section_id → housekeeping_sections on delete set null (null: no section), position int not null default 0 (within its section), created_at |
| `housekeeping_visits` | id, household_id → households on delete cascade, visit_date date not null, note text not null default '' (the copy of the message, <= 4000), comments text not null default '' (<= 4000), price_pence int null (0 to 1,000,000), created_by → members on delete set null, created_at, updated_by → members on delete set null, updated_at; **unique (household_id, visit_date)** |
| `housekeeping_visit_tasks` | id, visit_id → housekeeping_visits on delete cascade, household_id → households on delete cascade (copied from the visit), task_id → housekeeping_tasks **on delete set null**, title text not null (1 to 200), section_id → housekeeping_sections on delete set null, section_title text not null default '' (<= 40, the section's name then), position int not null default 0 (section by section), done bool not null default false, done_by → members on delete set null, done_at timestamptz null; **unique (visit_id, task_id)** |

Check constraints (SQLSTATE 23514; the client maps them to `invalid_input: <constraint>`):
`housekeeping_notes_body_length`, `housekeeping_tasks_title_length` (a blank title is trimmed
to '' and fails it too), `housekeeping_visits_note_length`,
`housekeeping_visits_comments_length`, `housekeeping_visits_price_range`,
`housekeeping_visit_tasks_title_length`, `housekeeping_sections_title_length`,
`housekeeping_visit_tasks_section_title_length`, and `housekeeping_sections_limit` (raised by
the sections' insert trigger for a 31st). Unique constraints: `housekeeping_visits_one_per_day`,
`housekeeping_visit_tasks_task_once`.

Triggers on `housekeeping_tasks` (security definer, empty `search_path`, not callable by
clients):

- BEFORE INSERT or UPDATE (`housekeeping_tasks_before_write`): trims the title (the same
  whitespace as JavaScript's `trim()`, `js_trim()`); an insert always goes last in its section
  (or among the tasks in no section: position = the highest there + 1, whatever the client
  sent), and only into a section of its own household (else `not_found`); an update keeps
  household_id and created_at.
- AFTER INSERT (`housekeeping_tasks_after_insert`): adds the task to today's visit, if any, in
  its place.
- AFTER UPDATE (`housekeeping_tasks_after_update`): a new title is copied to today's visit's
  row for the task unless that row is ticked (it keeps the title it was ticked under); a new
  place or section lays today's visit out again.
- BEFORE DELETE (`housekeeping_tasks_before_delete`): removes today's visit's row for the task
  unless it is done (before the foreign key sets task_id to null on every visit's rows).
- AFTER DELETE (`housekeeping_tasks_after_delete`): lays today's visit out again (a ticked row
  left behind goes after the rows of its section's tasks; the places close up).

On `housekeeping_sections`: BEFORE INSERT or UPDATE (`housekeeping_sections_before_write`:
trims the name, a new section goes last, at most 30, an update keeps household_id and
created_at) and BEFORE DELETE (`housekeeping_sections_before_delete`: its tasks move to the
top, with no section, after the tasks already there, in their order; today's visit's rows in
it get none and the visit is laid out again; earlier visits' rows lose the section through
the foreign key and keep its name).

`housekeeping_relay(visit)` lays a visit out as the list stands (each row takes its task's
section, the section's name and its place; a row whose task is gone keeps its section while
that is on the list, after the section's rows; positions 0…n-1 section by section; only rows
that change are written), and `housekeeping_relay_today(household)` does so for today's visit.

Creating a visit, adding a task, the AFTER UPDATE and BEFORE DELETE triggers and every RPC
that changes the list take a per-household transaction-level advisory lock
(`housekeeping_lock()`), so a task added or renamed at the moment today's visit is created is
never missed. Locks are taken in one order, so two changes at the same moment wait for each
other instead of deadlocking: the household's task rows first (a delete, rename or move locks
its row as it starts; `move_housekeeping_task`, `delete_housekeeping_section` and
`reorder_housekeeping_tasks` lock them all first; creating a visit locks them `FOR KEY SHARE`),
then `housekeeping_lock()`, then visit rows. Creating a visit copies the task list with
`FOR KEY SHARE`, so a task being deleted at that moment is waited for and then left out (the
tick that created the visit stands) rather than failing the foreign key.

Internal helpers (not callable by clients): `js_trim(text)`, `housekeeping_relay(uuid)`,
`housekeeping_relay_today(uuid)`, `housekeeping_starter_tasks()`
(the starter list; `src/lib/constants.test.ts` and `supabase/tests/housekeeping.test.mjs`
compare it with `HOUSEKEEPING_STARTER_TASKS`), `household_today(uuid)`,
`housekeeping_lock(uuid)`, `housekeeping_lock_visit(uuid)` (locks a visit row for the write,
false when it was deleted meanwhile) and `housekeeping_visit_for(household, date, member)`
(finds or creates the visit with its copies; `not_found` for an unknown household,
`invalid_input` for a null or future date).

### RLS and grants

- `housekeeping_notes`: SELECT where `is_household_member(household_id)`. Written only by
  `set_housekeeping_note` and `undo_clear_housekeeping_note`.
- `housekeeping_sections`: SELECT where member. Written only by the section RPCs.
- `housekeeping_tasks`: SELECT, INSERT, UPDATE, DELETE where member. Grants: select, delete,
  insert (household_id, title, section_id), update (title). Sections and places change only
  through `move_housekeeping_task`, the section RPCs, `reorder_housekeeping_tasks` (and the
  insert trigger).
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
   follows (trigger). Redefined by the sections migration for an app from before sections still
   running: each task stays in its section. The app now moves one task at a time
   (`move_housekeeping_task`). Server mode keeps the same for such an app
   (`reorderHousekeepingTasks` in the RPC allow-list).
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

From `20261015000100_housekeeping_sections.sql` (each takes `housekeeping_lock()` before it
writes; a section of another household is `not_found`):

7. `create_housekeeping_section(p_household_id uuid, p_title text) returns
   housekeeping_sections` (the row). Trimmed, last, with no task; blank or too long is
   `housekeeping_sections_title_length`, a 31st `housekeeping_sections_limit`.
8. `rename_housekeeping_section(p_section_id uuid, p_title text) returns void`. Trimmed; the
   same name changes nothing. Today's visit shows the new name; earlier visits keep theirs.
9. `delete_housekeeping_section(p_section_id uuid) returns void`. Keeps its tasks (the BEFORE
   DELETE trigger moves them to the top, with no section, on today's visit too). Gone already:
   `not_found`.
10. `move_housekeeping_section(p_section_id uuid, p_index integer) returns void`. The section
    moved to that index among the others (0 first; past the end: last); the sections'
    positions run 0…n-1 again and their tasks come along. A null or negative index is
    `invalid_input`; a section gone meanwhile `not_found`. Today's visit follows.
11. `move_housekeeping_task(p_task_id uuid, p_section_id uuid, p_index integer) returns void`.
    One task moved into that section (null: no section) at that index among its other tasks
    (0 first; past the end: last). The places in the section it joins, and in the one it
    leaves, run 0…n-1 again; nothing else changes. A task or section that is not the
    household's, or gone meanwhile, is `not_found`; a null or negative index `invalid_input`.
    Today's visit follows (the AFTER UPDATE trigger).

    Moves name one item and where it goes, never the whole order as one phone last saw it, so
    two people moving different tasks or sections at once both keep their moves, and a task
    added or deleted on another phone meanwhile never refuses one. The file drops
    `arrange_housekeeping_tasks` and `reorder_housekeeping_sections`, the whole-order writes of
    an earlier version of it, wherever that was applied.

`create_household` is redefined (same signature, copied from
`20261010000300_item_good.sql`) to also insert the starter task list, in order. A visit is
deleted with a plain DELETE on `housekeeping_visits` (RLS); its rows go with it.

Existing households get the starter list once: on the file's first run (the one that creates
`housekeeping_tasks`; the file records that in the session setting
`homeos.housekeeping_backfill` at its top and clears it at the end), each household with no
task and no visit gets it. Applying the file again changes no data, so a list someone emptied
stays empty.

Realtime: the five tables join `supabase_realtime` (guarded, so the files also run on plain
Postgres) with replica identity full; `Backend.subscribe` listens to each with
`household_id=eq.<id>`.

### Data in the app

`HouseholdData.housekeeping: HousekeepingData` (`src/lib/types.ts`), loaded by `Backend.load`
with the rest of the household:

- `note: HousekeepingNote`, `{ body, updated_at, updated_by }` (never written:
  `{ body: '', updated_at: null, updated_by: null }`);
- `sections: HousekeepingSection[]` (`{ id, household_id, title, position }`), in order;
- `tasks: HousekeepingTask[]` (with `section_id`, null for none), in the list's order: the
  tasks in no section first, then section by section, each by position (then created_at, id);
- `visits: HousekeepingVisit[]`, every visit, newest first, each with its
  `tasks: HousekeepingVisitTask[]` (with `section_id` and `section_title`) by position, then
  title, then id.

`HousekeepingTickTarget` is `{ taskId }` (a row whose task is still on the list; this also
works for a day with no visit yet, which the tick then creates) or `{ visitTaskId }` (a row
whose task has been deleted). `checklistFor()` picks it. `HousekeepingVisitPatch` is
`{ comments?, price_pence? }` (only the keys present are written).

### Backend methods (`src/lib/backend/types.ts`)

| method | Supabase | Demo |
| --- | --- | --- |
| `setHousekeepingNote(householdId, body)` | rpc `set_housekeeping_note` | same rules |
| `undoClearHousekeepingNote(householdId)` | rpc `undo_clear_housekeeping_note` | same rules |
| `createHousekeepingTask(householdId, title, sectionId?)` → `HousekeepingTask` | insert `{ household_id, title, section_id? }`, select `id, household_id, title, section_id, position` | last in its section, adds to today's visit in its place |
| `renameHousekeepingTask(id, title)` | update `{ title }` (no row: `not_found`) | renames, today's visit too unless ticked there |
| `deleteHousekeepingTask(id)` | delete (no row: `not_found`) | today's undone row goes, other rows keep it with task_id null |
| `moveHousekeepingTask(id, sectionId, index)` | rpc `move_housekeeping_task` | same rules |
| `reorderHousekeepingTasks(householdId, orderedIds)` (an app from before sections) | rpc `reorder_housekeeping_tasks` | same rules: position = index, each task keeps its section |
| `createHousekeepingSection(householdId, title)` → `HousekeepingSection` | rpc `create_housekeeping_section` | same rules (`invalid_input: sections (at most 30)`) |
| `renameHousekeepingSection(id, title)` | rpc `rename_housekeeping_section` | same rules |
| `deleteHousekeepingSection(id)` | rpc `delete_housekeeping_section` | same rules |
| `moveHousekeepingSection(id, index)` | rpc `move_housekeeping_section` | same rules |
| `setHousekeepingTaskDone(householdId, date, target, done)` → visit id | rpc `tick_housekeeping_task` | same rules |
| `saveHousekeepingVisit(householdId, date, patch)` → visit id | rpc `save_housekeeping_visit` (only the keys present) | same rules |
| `addHousekeepingVisit(householdId, date)` → visit id | rpc `add_housekeeping_visit` | same rules |
| `deleteHousekeepingVisit(id)` | delete on `housekeeping_visits` (no row: `not_found`) | rows go with it |

- Supabase: `load` adds four reads to its `Promise.all`, all through `runAll`: the note
  (`body, updated_at, updated_by`; no row reads as never written), the sections
  (`id, household_id, title, position`, ordered by position, created_at, id), the tasks
  (`id, household_id, title, section_id, position`, put in the list's order) and the visits
  with their rows embedded (`id, household_id, visit_date, note, comments, price_pence,
  created_by, created_at, updated_by, updated_at, tasks:housekeeping_visit_tasks(id, visit_id,
  household_id, task_id, title, section_id, section_title, position, done, done_by, done_at)`, ordered by visit_date
  descending, rows sorted in the client). An id that is not a uuid is `not_found` without a
  request (like chat); a date that is not `YYYY-MM-DD` is `invalid_input: date`; a blank title
  is `invalid_input: title` (like `requireText`). Also refused before any request: a tick
  target that is not exactly one of `taskId` and `visitTaskId` (`invalid_input: target`), and
  a price that is not a whole number or null (`invalid_input: price`; JSON would send NaN or
  Infinity as null and clear the price), and a move's index that is not a whole number from 0
  (`invalid_input: index`). In `reorderHousekeepingTasks` an id that is not a uuid is sent as
  the nil uuid, so it keeps its place in the order and names no task.
  `subscribe` adds the five tables.
- Demo (`src/lib/backend/demo.ts`): five collections in the document (`housekeeping_notes`,
  `housekeeping_sections`, `housekeeping_tasks`, `housekeeping_visits`,
  `housekeeping_visit_tasks`) with the SQL columns. `read()` fills them in for documents stored
  before them, and a document without the `housekeeping_tasks` key gets the starter list for
  each household once, like the migration. A document from before sections (the server's live
  home is one until its first write) reads with no sections and every task and row in none,
  in memory only: the stored document is not rewritten by reading it.
  The semantics mirror the SQL exactly, the copy rules, today's visit following the list,
  idempotent ticks and the note's "same text" rule included. Errors: `not_found` where SQL
  says so; `invalid_input: date` (future or malformed), `invalid_input: title` (blank or over
  200), `invalid_input: note`, `invalid_input: comments` (over 4000), `invalid_input: price`
  (not a whole number, below 0 or over the maximum), `invalid_input: target` (both or
  neither), `invalid_input: index` (a move's place, not a whole number from 0).
  `createHouseholdIn` gives every demo household (`?demo-seed=1` included) the
  starter list, `HOUSEKEEPING_DEMO_NOTE` and `HOUSEKEEPING_DEMO_VISITS` from
  `src/lib/constants.ts`, in the household's time zone and never in the future. It must not
  call the stubbed functions of `src/lib/logic/housekeeping.ts` (only `emptyHousekeeping()`),
  so the backend and the UI can be built side by side.

### HomeProvider (`src/state/HomeProvider.tsx`)

`HomeContextValue` actions (the names and signatures are fixed; the data is
`data.housekeeping`): `setHousekeepingNote(body)`, `undoClearHousekeepingNote(previous)`
(shows `previous`, the message as it was before Clear, at once, and sends the Undo after any
message write still in flight, so it never overtakes its Clear), `createHousekeepingTask(title,
sectionId?)` → `HousekeepingTask`, `renameHousekeepingTask(id, title)`,
`deleteHousekeepingTask(id)`, `moveHousekeepingTask(id, sectionId, index)`,
`createHousekeepingSection(title)` → `HousekeepingSection`, `renameHousekeepingSection(id,
title)`, `deleteHousekeepingSection(id)`, `moveHousekeepingSection(id, index)`,
`setHousekeepingTaskDone(date, target, done)`,
`saveHousekeepingVisit(date, patch)`, `addHousekeepingVisit(date)`,
`deleteHousekeepingVisit(id)`. All go through `mutate()` with a revert that takes back only
what the action touched, like the other edits (a failed write shows "Couldn't save." and
rejects). The optimistic copies come from `src/lib/logic/housekeeping.ts`:

- a write for a day with no visit shows a pending visit at once (`newVisit()`, id
  `pending:<date>`, rows `pending:<taskId>`); further writes for that day apply to it locally
  and are sent with `{ taskId }` targets; a failure removes it; the reload swaps in the real
  visit under the same row keys (`ChecklistRow.key`), so a focused checkbox keeps its focus;
- ticks use `applyTick()`, comments and price `applyVisitPatch()`, list edits
  `withTaskRenamed()`, `withTaskDeleted()`, `withTaskMoved()`, `withSectionRenamed()`,
  `withSectionDeleted()`, `withSectionMoved()` (today's visit follows); a revert puts
  back the sections and places it set and lays the list out again (`withListSettled()`);
- `createHousekeepingTask` and `createHousekeepingSection` are not optimistic: they resolve to
  the stored row, like `createArea` (the sheet shows the name typed, saving, until then); it
  shows on the list (a task on today's visit too, `withTaskAdded()`, `withSectionAdded()`) as
  soon as it resolves, before the reload;
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
padding; these five live in `lib/logic/months.ts`, which Home's calendar shares, and are
re-exported here), `canHaveVisit`, `longDay` ("Thursday 1 October"; `fullDay()` in
`months.ts`), `calendarDayLabel` (", selected"
for the chosen day), `daySelectedAnnouncement`, `todayLine` ("6 of 7 done today · £60.00").
Visits: `isRecorded`, `visitOn`, `visitDays` (a month's, or all), `monthTotals`,
`monthSummary` ("4 visits · £180.00", "2 visits", "No visits"), `doneCount`,
`housekeepingSubtitle`. Prices:
`formatPrice` ("£1,234.50"), `priceInputValue` ("1234.50"), `parsePrice`. The list's order:
`listOrder`, `taskListGroups` (the editor's groups), `relayVisit` (a visit laid out as the
list stands). Checklist: `checklistSections` (a day's rows section by section, by the
sections the visit had: a section still on the list by its id; a deleted one by its name,
each run of its rows apart, so two of one name stay two and in their place),
`checklistFor` (the same as one list), `matchesTarget`, `sectionProgress` ("2 of 5", then
"All done", or "Done" for a section of one task), `sectionDoneWords`, `sectionHeadingLabel`
("Kitchen, 2 of 5 done", "Kitchen, all 5 done", "Bins, done"). Bylines: `visitByline`,
`noteByline`, `doneByline`. The tab's dot: `hasNewNote`.
Optimistic edits: `snapshotNote`, `newVisit`, `applyTick`, `applyVisitPatch`,
`withTaskAdded`, `withTaskRenamed`, `withTaskDeleted`, `withTaskMoved` (one task into a
section at an index, as `move_housekeeping_task`), `withSectionAdded`, `withSectionRenamed`,
`withSectionDeleted`, `withSectionMoved`, `withListSettled`.
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
| `Checklist.tsx` | the tasks as checkboxes, a card per section |
| `SectionIcon.tsx` | a section's drawing: Home's room drawing for a room's name, else a list |
| `PriceField.tsx` | the £ field: parse, format, error |
| `Calendar.tsx` | the visits under the tab switch: `ui/DatePicker.tsx` (Home's date picker, on the card `ui/MonthCalendar.tsx`) with today's line, the month's summary, a dot for each visit (`data-visit`) and `lastDay` today; the view kept under `homeos.calendar.housekeeping` |
| `DayDetail.tsx` | a chosen day before today, in place of the Today section |
| `TaskListSheet.tsx` | the page sheet that edits the task list and its sections; App mounts it beside the stage, like the Item sheet, so the screen behind is pushed back |
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

1. `ScreenHeader`: the hero with today's date in full on its top line, as on Home ("THURSDAY
   8 OCTOBER", `longDay()` in `lib/logic/dates.ts`, in a `time`), the title **Housekeeping**,
   the secondary line `housekeepingSubtitle()` ("Today's visit", "Last visit Thu 1 Oct" or
   "Weekly") and the avatar; then the tab switch. `Screen` with `label="Housekeeping"` and
   `withAdd={false}`.
2. **Calendar** (`Calendar`, right under the tab switch): Home's date picker
   (`ui/DatePicker.tsx`, see "Home: the calendar"), in a section named by a visually hidden
   `h2` **Calendar**. The 44px bar: on the left, while today is chosen and shown, a 15/20
   secondary line on today's visit (`todayLine()`: "No visit yet today", "6 of 7 done today ·
   £60.00"), else **Today**; on the right **Show month** / **Show week**, kept on this device
   under `homeos.calendar.housekeeping` (apart from Home's choice). Then the card: this week as
   a strip at first ("5 to 11 October" between Previous week and Next week, the grid named
   "Week of Monday 5 October"), or the month ("October 2026" between Previous month and Next
   month, with `monthSummary(monthTotals())` under it: "4 visits · £180.00"). No marks under
   the days and no legend: each day's button fills its cell (46px tall, square, so a tap
   anywhere in the cell counts) and draws a round 40px circle (36px below 360px wide) with its
   number: today has a tint number and a 1.5px tint ring, the chosen day is filled with the
   tint and has a white number, a day with a recorded visit (`visitDays()`) has a 5px dot under
   its number (tint; white when chosen), the mark Home's calendar gives a visit, and future
   days are dimmed (`--label-tertiary`) and disabled (`lastDay` today), as is Next once the
   week or month after would be all future: no visits can be ahead. The chosen day and the
   week and month shown (`useChosenDay()`) are remembered while the app runs, per household:
   today at first, in this week and month, and again on a new day. Changing week or month
   keeps the chosen day; Today chooses today again, in its week. Choosing a day shows it below
   (5.), says what is there through the live region (`daySelectedAnnouncement()`: "Thursday 1
   October: 6 of 7 done, £60.00. Details below the calendar.", "Thursday 8 October, today: not
   started yet. …") and, when its heading is low on the screen, scrolls it up (`revealDay()`,
   measured, no smooth scroll with Reduce Motion) until 45% of the screen is left under the
   heading for the day's details, without taking the heading under the docked tab switch, so
   the strip stays in sight; focus stays on the day.
3. **Message for the housekeeper** (`NoteSection`): the `h2`, with **Clear** on the right
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
4. **Today**, while today is chosen in the calendar (`h2`, `tabIndex={-1}`, with **Edit** on
   the right: 15px tint text, `aria-label="Edit task list"`, opens `TaskListSheet`), then
   `VisitEditor` for `today`:
   - the checklist (`Checklist`, groups from `checklistSections()`): the tasks in no section
     first, in a card with no heading, then each section's card under one quiet line of text,
     as iOS groups a list, 22px between cards, in the sections' order (an empty section is
     left out). The line, lined up with the checkboxes, has the section's name (15/20/600
     secondary, wrapping, an `h3` named with its progress, "Kitchen, 2 of 5 done") and on the
     right "2 of 5" (15/20 secondary, tabular). With every task ticked the words read **All
     done** (600, `--rag-green-text`), or **Done** for a section of one task. A header costs
     one line, less than what it heads, and the only round things on the checklist are the
     checkboxes (a progress ring there read as one more checkbox that did nothing, and part
     way as a spinner). Each row a `label` with a
     native checkbox drawn as a 24px iOS circle (empty: 1.5px #C7C7CC ring; ticked: filled
     `--tint` with a white check), the title at 17/22, and when ticked a second line at 13/18
     secondary, `doneByline()` ("🦊 Ela · 10:42"); rows at least 52px tall, hairlines inset to
     the text. The whole row toggles; the change is saved at once
     (`setHousekeepingTaskDone(date, row.target, checked)`). With no tasks: "No tasks yet." and
     a tint **Add tasks** button that opens the sheet. Of the three header treatments tried
     (the header in the card with a drawing and a ring; the header above the card, iOS grouped
     style; the header in the card with a slim bar), the second was kept: the first grew the
     checklist by three quarters for a list split by room, put a header heavier than its one
     task on most sections, and said "done" three times once that task was ticked.
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
5. **A past day** (`DayDetail`), in place of the Today section while a day before today is
   chosen in the calendar (a visit on Home's calendar opens its day here, chosen, with focus on
   this heading: see "Home: the calendar"):
   - a heading (`h2`, 20/25/600, `tabIndex={-1}`): `longDay()` ("Thursday 1 October");
   - without a visit: "No visit recorded." and a tint **Add a visit** button
     (`addHousekeepingVisit(date)`; focus then moves to the first checkbox);
   - with a visit: a card **Message that day** (13/18 secondary label above 17/22
     text, read-only; "No message that day." when empty), then `VisitEditor` for that date
     (editable, same as today; its fields are named with the day, "Comments, Thursday 1
     October" and "Price for the day, Thursday 1 October", so they can't be mistaken for
     today's), then a card with a centred **Delete Visit** button (17px, `--destructive`). It
     asks first (`ActionSheet`): title "Delete the visit on Thu 1 Oct?", message "Its ticks,
     comments and price will be deleted for everyone.", action **Delete Visit** (destructive).
     After deleting, the day shows "No visit recorded." and focus moves to **Add a visit**.
6. **Task list sheet** (`TaskListSheet`): a page `Sheet` labelled "Task list". Nav bar
   (`data-sheet-handle`): the title "Task list" centred (17/22/600) and **Done** on the right
   (17px/600 tint), which closes it. The body (`data-sheet-scroll`): the tasks in no section in
   a card of their own (once there are sections headed **No Section** in secondary grey, with
   a dashed square, a group of that name, so it is clear what a task added there is), then a
   card per section (20px apart, a group named after the section), then **Add Section**. Rows
   look like the Household editor's areas: each row has a red minus (`aria-label="Delete
   <title>"`), the title edited in place (`InlineText` with `multiline`, a textarea that grows
   as the name wraps, so a long name reads in full: Enter saves, line breaks become spaces;
   `aria-label="Task name"`, `maxLength` 200; blank puts the old title back), once there are
   sections a "…" button (`aria-label="Move <title> to a section"`, `--ring-idle` like the
   grip beside it, so the column of them recedes) whose menu, titled **Move to Section**,
   lists **No Section** and every section with its drawing, the current one checked (a long
   name wraps onto two lines there), and a grip (`aria-label="Reorder <title>"`, 44px wide,
   `--ring-idle`). A section's header: its drawing in a 30px tile (it follows the name), the
   name edited in place and wrapping (17/22/600, `aria-label="Section name"`, `maxLength` 40),
   a "…" (`aria-label="<name> options"`: **Rename**, **Move Up**, **Move Down** (only where it
   can), **Delete Section** in red) and a grip (`aria-label="Reorder <name> section"`). Each
   card ends with **Add Task** (green plus; once there are sections named "Add Task to <name>",
   "Add Task to No Section" for the first card). **Add Section** is a card of its own (tint);
   with 30 (counting any being made) it is dimmed and the caption says "A list has 30 sections
   at most.". Under the cards, 13/18 secondary: "Changes show in today's visit too. Earlier
   visits keep their own list.", after "Sections group the tasks, such as Kitchen or
   Bathrooms." while there are none.

   Adding: Add Task or Add Section turns, inside the tap, into the new name's field where the
   button was (rendered with `flushSync` and focused in the click, so iOS raises the keyboard
   and every letter typed lands in it), empty, with "New task" or "New section"
   (`HOUSEKEEPING_NEW_TASK`, `HOUSEKEEPING_NEW_SECTION`) as its placeholder; a section's
   drawing follows the name as it is typed. Nothing is made until a name is in: Enter (or
   leaving the field, or tapping another Add) makes it with what was typed, and Escape, or
   nothing typed, drops it. Enter and Escape put focus back on the button, so Enter adds the
   next one. A tap on another button meanwhile (Add Task in another card, a task's delete or
   "…") saves the name and does its own job in the one tap: the press leaves the field focused,
   and the name is saved as the click starts, so the list never moves under the finger
   between the two (a grip leaves the field open). While the server answers, the new row
   shows its name, quieter, with a small spinner (it breathes instead with Reduce Motion), and
   is replaced by the stored one; a failed save (the toast says why) puts the name back in its
   field to try again.

   Moving (`useGroupedReorder()` in `ui/useReorder.ts`): hold a grip and a picture of the row
   (or of the section's header) lifts, a touch bigger, with a shadow, and follows the finger;
   the row folds away where it was, and the rows step aside to open a slot where it would land,
   within its section or in another, with a soft tint placeholder in it (a dashed outline the
   shape of a header for a section). The picture is the row as it was, its name wrapped the
   same, on `--lift-bg` (in dark mode a step lighter than the cards, as iOS lifts a row). The
   page scrolls near its edges. On release it glides into the slot and the move is saved at
   once, as that one item and where it went (`moveHousekeepingTask(id, sectionId, index)` or
   `moveHousekeepingSection(id, index)`); a section unfolds again where it landed. Escape puts
   it back. A drag never moves the sheet. The up and down arrow keys on a grip move it one
   place, and at the top or bottom of a section into the one before or after; Move to
   Section, Move Up and Move Down do the same without dragging. Each move is announced ("Clean
   the oven moved to Kitchen, position 2 of 3.", "Kitchen moved to position 1 of 3."). Focus
   stays on the grip used, and after Move Up or Move Down on the section's "…" (brought into
   view). Move to Section keeps your place: the sheet does not scroll, focus goes to the next
   task's "…" in the card the task left (else the one before it, else that card's Add Task),
   ready for the next move, and the task lights up for a moment where it landed. Rename, in a
   section's "…", focuses the name with its text selected inside the tap, so iOS raises the
   keyboard. Reduce Motion: no glide, fold or placeholder fade.

   Delete Task asks first: title "Delete <title>?", message "Earlier visits keep it.", action
   **Delete Task**. Delete Section asks first: title "Delete <name>?", message "Its 3 tasks
   move to the top of the list. Earlier visits keep this section." ("Its task moves…" for one,
   only "Earlier visits keep this section." for none), action **Delete Section**; focus then
   goes to the next section's "…", else the one before it, else Add Section. The list may be
   empty. When it closes, focus goes back to the button that opened it (Edit, or Add tasks;
   Edit if that has gone), however it was opened: a VoiceOver double tap is a tap, and focus
   moved by script after a tap shows no ring.

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
  their description (`aria-describedby`). Each section (its line and card) is a group labelled
  by its `h3`, whose name carries the progress ("Kitchen, 2 of 5 done", "Kitchen, all 5 done",
  "Bins, done" for one task); the visible "2 of 5" is hidden from assistive tech. Ticking a
  section's last task is said as "<title> done. Kitchen, all 5 done".
- The calendar is a `table` with `role="grid"`, named by the week ("Week of Monday 5
  October") or labelled by the month title (the titles are `aria-live="polite"`, so changing
  week or month is announced); column headers are `th scope="col"` with the full weekday as
  `abbr`; each day cell is `role="gridcell"` with `aria-selected` and holds the day's button,
  named by `calendarDayLabel()` ("Thursday 1 October, visit, 6 of 7 done, £60.00", then ",
  selected" for the chosen day, since focus is on the button, not its cell). One day button is
  in the tab order (the one the keys moved to, else the chosen day, else today, else the first
  day shown); arrow keys move a day or a week, Home and End go to the start and end of the
  week, Page Up and Page Down change month, moving past the edge of the week or month goes on
  into the next, and focus never lands on a future day.
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
- `src/screens/housekeeping/HousekeepingScreen.test.tsx`: the date over the title, the
  sections and copy, saving comments and the price ("Saved", and a failed save keeping what was
  typed), the price error, the date picker (this week with today chosen and its line, Previous
  week and Today, Show month with each month's total kept apart from Home's, labels, the
  keyboard), choosing a day (it shows in place of today's, scroll and announcement), a day from
  Home's calendar, Add a visit, Delete Visit (today's too), visits with nothing recorded, Clear
  and Undo, the checklist's sections ("Done" for a section of one task), and the task list
  sheet: Add Task and Add Section typed straight into the field they become (nothing made
  blank or on Escape, the name kept on leaving the field, shown while saving, given back after
  a failed save), one move per task or section, Move to Section keeping your place, Rename
  focused in the tap, No Section, and what deleting a section says.
- `src/screens/housekeeping/HousekeepingProvider.test.tsx`: the screen with the real provider
  and demo backend: typing kept through failed saves and saved once back; Delete straight after
  Add a visit; a tick taken back counts no visit.
- `src/App.test.tsx`: the tab switch, the Housekeeping dot, the tab remembered on this device,
  focus back on Edit after the task list closes.
- `supabase/tests/housekeeping.test.mjs` (written with the migration): schema, RLS, RPCs,
  concurrent ticks, today's visit following the list (a ticked row keeps its title), Undo after
  Clear, a task deleted while today's visit is created, the starter list and its first-run-only
  backfill; sections, and moves: one task or section at a time, two moves at the same moment
  both kept, a move beside an add or a delete, and `reorder_housekeeping_tasks` for an app from
  before sections keeping each task in its section.
- `server/core/handler.test.ts`: in server mode, two phones moving different tasks at the same
  moment both keep their moves, and an app from before sections can still reorder.
- `src/lib/backend/supabase.integration.test.ts` (live suite): load shape, the RPC mappings and
  realtime on the five tables.
- `e2e/housekeeping.spec.ts`: the tab order and `aria-current`; no + on Housekeeping; the switch
  fits at 320, 375 and 402px (no horizontal scroll, every label's `scrollWidth` within its
  `clientWidth`); the seed as above, today's date over the title and the date picker right under
  the tab switch; ticking starts today's visit (subtitle "Today's visit", today marked, the
  line); comments and price save and survive a reload (the month remembered); September's
  summary; a past visit's details in place of today's; Show week and Today; the keyboard;
  Delete Visit (today's too); Add a visit; future days and next week disabled; the task list
  sheet's add, rename, reorder and delete reach today's checklist while last week's visit keeps
  the old title; Undo after Clear keeps the writer; "Saved"; a chosen day brought up with the
  strip still in sight (with and without Reduce Motion); a tap in a cell's corner chooses it at
  320px; the picker's 44px targets and no sideways scroll at 320, 375 and 402px; the
  Housekeeping dot and reopening on the last tab; focus back on Edit after the task list.
  Sections: added by typing the name, filled by Move to Section (keeping your place: focus on
  the next task's "…", no scrolling) and by dragging onto a section's Add Task, a task added
  straight into one, No Section headed, reordered by menu, renamed, today's checklist in
  sections with each heading's progress, all done shown and said, kept after a reload; a
  section dragged by its header and moved with the arrow keys, a task's grip crossing into the
  section before; deleting a section asks first and keeps its tasks at the top, ticks and all;
  an earlier visit keeps its sections by their names; no sideways scroll and 44px targets at
  375 and 430px.
  Server mode (`e2e-server/sync.spec.ts`): sections added, filled, ticked, renamed, reordered
  and deleted on one phone show on the other.
  Existing e2e tests keep passing.

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
- `npm run test:e2e:server`: Playwright against the local server in server mode
  (`playwright.server.config.ts`, `e2e-server/`; see "Server mode (no setup)", "Local server and
  tests").
- `npm run test:build`: the production builds as Vercel makes them, demo and server mode, with
  no secret in anything deployed (`scripts/check-build.mjs`).
- `npm run test:e2e:live`: Playwright against a build that uses the local Supabase stack
  (`playwright.live.config.ts`, `e2e-live/`): sessions made with the Auth admin API and the
  password grant are put into the app's auth storage (`sb-<host>-auth-token`) before it loads.
  It needs a database with no home in it, waits for one, and removes only what it made.
