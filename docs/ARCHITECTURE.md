# home.os architecture

home.os is an installable web app (PWA) built with Vite, React and TypeScript on
top of Supabase. The design spec is `design/README.md` (Turn 3, option 3a in
`design/HomeOS Directions.dc.html`; reference renders in `design/reference/`).

## Product rules that shape the code

- Sign in with **Google** only. First sign-in creates a **profile** (name from
  Google, editable, plus an emoji) and then a **household** (create, or join
  through an invite link).
- **Every member can edit everything** in their household: household name,
  address and time zone, areas, items, completions (undo), and every member's
  profile. There are no owner-only permissions. The `owner` role only decides
  who gets the "missed" push alert (README "Push").
- One household per user.
- Radical simplicity: no filters, counters, dashboards or settings beyond the spec.

## Layout

```
src/
  main.tsx                 boot: pick backend, providers, service worker
  App.tsx                  phase routing (loading/onboarding/main), tabs, sheet push-back
  state/HomeProvider.tsx   app state + actions (optimistic), toast, today in household tz
  lib/types.ts             domain types (match SQL columns)
  lib/constants.ts         emoji set, colours, labels, default areas, seed items
  lib/logic/*.ts           pure logic: dates, items (missed, sort, repeat), stats (donut),
                           chat (order, merge, runs, separators, reactions, unread, keyboard)
  lib/backend/types.ts     Backend interface (the contract both backends implement)
  lib/backend/supabase.ts  production backend (supabase-js)
  lib/backend/demo.ts      localStorage backend (no env vars, e2e tests)
  lib/push.ts              Web Push subscribe/unsubscribe + iOS install detection
  lib/sw-register.ts       service worker registration
  ui/                      shared primitives: Screen, Sheet, ActionSheet, Toggle, Avatar, Toast, Confetti, HomeScene, icons
  lib/preview.ts           `?frame` simulates the 54px status bar inset for screenshots
  screens/home/            Home screen (per-area add buttons), item rows, home scene, floating tab bar
  screens/chat/            Household group chat with emoji reactions
  state/ChatProvider.tsx   chat state: pages, realtime merge, optimistic send/react, unread dot
  screens/item/            Item sheet (edit / new)
  screens/stats/           Stats screen + donut
  screens/profile/         Profile (full-screen cover) + Household editor (pushed inside Profile, with
                           People: each member's name and emoji on a page pushed on top)
  screens/onboarding/      Welcome, create profile, household create/join, notifications step
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
- Icons are inline SVG from `src/ui/icons.tsx` (SF Symbols stand-ins).
- Respect `prefers-reduced-motion`.

## Database (Supabase Postgres, schema `public`)

All ids are `uuid default gen_random_uuid()`. Timestamps are `timestamptz default now()`.

| table | columns |
| --- | --- |
| `households` | id, name text not null, address text not null default '', timezone text not null default 'Europe/London', weekly_email_day smallint not null default 1 (0=Sun…6=Sat), weekly_email_time time not null default '08:00', created_at, updated_at, updated_by uuid null |
| `members` | id, household_id → households on delete cascade, user_id uuid not null **unique** → auth.users on delete cascade, name text not null, email text not null default '', emoji text not null default '🦔', color text not null, role text not null default 'member' check (owner, member), weekly_email bool not null default true, push_enabled bool not null default false, created_at |
| `areas` | id, household_id → households on delete cascade, name text not null, position int not null default 0, created_at |
| `items` | id, household_id → households on delete cascade, area_id → areas on delete cascade, title text not null (non-blank), note text not null default '', rag text not null default 'amber' check (red, amber, green), due_date date null, assignee_id → members on delete set null, repeat text not null default 'none' check (none, weekly, monthly, quarterly, biannual, yearly), notify text not null default 'day_before' check (none, same_day, day_before, week_before), status text not null default 'open' check (open, done), created_by → members on delete set null, updated_by → members on delete set null, created_at, updated_at, completed_at timestamptz null |
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
- `households` BEFORE UPDATE: `updated_at`, `updated_by`.

Helper functions (`security definer`, `stable`, `set search_path = ''`):
- `public.current_member_id() returns uuid`: the caller's member id (or null).
- `public.is_household_member(hid uuid) returns boolean`.

### Row Level Security (every table has RLS enabled)

- `households`: SELECT, UPDATE where `is_household_member(id)`. No INSERT/DELETE (RPC only).
  Column grants for UPDATE: name, address, timezone, weekly_email_day, weekly_email_time.
- `members`: SELECT, UPDATE where `is_household_member(household_id)`. Column grants for
  UPDATE: name, emoji, color, weekly_email, push_enabled. INSERT via RPC only. No DELETE.
- `areas`, `items`: SELECT, INSERT, UPDATE, DELETE where `is_household_member(household_id)`.
- `completions`: SELECT, DELETE where member. INSERT via `complete_item` only.
- `invites`: SELECT where member. INSERT via `create_invite` only.
- `push_subs`: all operations where `user_id = auth.uid()` (and on insert the member_id must
  be the caller's member).
- `notifications_log`: no policies (service role only).

`anon` gets nothing. `authenticated` gets table privileges limited as above.

### RPCs (`security definer`, `set search_path = ''`, `grant execute … to authenticated`)

Errors are raised with these exact messages so clients can map them:
`not_signed_in`, `already_member`, `invalid_invite`, `not_found`, `invalid_input`.

1. `create_household(p_name text, p_address text, p_timezone text, p_member_name text,
   p_member_emoji text, p_areas text[], p_items jsonb default '[]'::jsonb) returns uuid`
   Creates the household (an unknown time zone falls back to 'Europe/London'), the caller's
   member row (role owner, colour `#007AFF`, email from `auth.jwt() ->> 'email'`), the areas in
   the given order (blank names skipped, positions 0…n-1), and the items in `p_items`:
   `[{area, title, note, rag, due_in_days (int|null), repeat, notify}]`, matched to areas by
   name case-insensitively (unknown area skipped), due date = today in the household time
   zone + `due_in_days`, unassigned. Raises `already_member` if the caller has a member row.
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
   the item's household; item must be open (`not_found` otherwise). Inserts a completion with
   `credited_to = coalesce(assignee_id, caller)`, `completed_by = caller`, `item_title`,
   `prev_due_date`, `prev_status`. If `repeat <> 'none'`: keep open and move `due_date` one
   interval forward from the old due date (null due date: from today); if that is still before
   today (household time zone), one interval from today instead. Monthly-type intervals clamp to
   month end (31 Jan + 1 month = 28/29 Feb). Otherwise `status = 'done'`, `completed_at = now()`.
6. `undo_completion(p_completion_id uuid) returns void`. Member of its household → restore the
   item's `status`/`due_date` from `prev_*` (clear `completed_at`) and delete the completion.
7. `reorder_areas(p_household_id uuid, p_area_ids uuid[]) returns void`. Sets
   `position = index` for each id that belongs to the household.

Realtime: add `households, members, areas, items, completions` to the `supabase_realtime`
publication (guarded so the migration also runs on plain Postgres).

Details beyond the list above (all covered by `supabase/tests`):
- `invalid_input`: a blank household or member name, an unknown time zone on update,
  `weekly_email_day` outside 0 to 6, or an invalid rag/repeat/notify in seed items. A blank
  emoji becomes 🦔. Invite tokens are trimmed.
- Member email comes from the JWT, falling back to `auth.users`.
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
  `invalid_input: <constraint>`): `items.title` <= 200, `items.note` <= 4000, `members.name`
  <= 40, `members.emoji` <= 16, `members.color` `#RRGGBB`, `households.name` <= 60,
  `households.address` <= 120, `areas.name` <= 60, `push_subs.endpoint` https only and <= 2048,
  `push_subs.p256dh` and `auth` <= 256, `push_subs.user_agent` <= 512 (the insert trigger cuts
  longer values). Lengths are characters (Postgres `length()`); `TEXT_LIMITS` in
  `src/lib/constants.ts` holds the same numbers and the inputs use them as `maxLength`.
- View `scheduler_open_items` (`security_invoker`, service role only): open items with the note
  whitespace-squashed and cut to 200 characters, read by the scheduler.
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
messages above (`network` for fetch failures).

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

- Floating tab bar: **Home, Chat, Stats**. The round + (new item) shows on Home and Stats, not
  on Chat. A small dot on Chat means unread messages from others (last-read time is kept per
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
- Composer: sits above the tab bar. While typing, the tab bar slides away (hidden and inert)
  and the composer follows the iPhone keyboard (`visualViewport`); when the field was tapped
  with a finger, it stays where it was until the keyboard's height is known (or 600 ms pass),
  so it never drops behind the rising keyboard first. Tapped with a finger, Return starts a new
  line and the round button sends (like Messages); with a hardware keyboard, Enter sends and
  Shift+Enter starts a new line; Ctrl or Cmd+Enter always sends. The send button is
  `aria-disabled` while blank, so Tab from the field reaches it and then the tab bar. On Chat,
  toasts sit above the composer (`--toast-bottom`, set by ChatScreen and read by `Toast`).
- Home: each area header has a small + that opens the new-item sheet with that area chosen.

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
- **Reminders**: open items with `notify <> 'none'` and a due date where
  `due_date - days_before == today` (same_day 0, day_before 1, week_before 7). Recipients: the
  assignee, or every member if unassigned. Only members with `push_enabled`.
  Log key: (reminder, member, item, ref_date = due_date).
- **Missed**: open items with `due_date` between today − 3 and today − 1 ("the morning after").
  Recipients: assignee and owner(s), deduplicated, `push_enabled` only.
  Log key: (missed, member, item, ref_date = due_date).
- **Weekly email**: on `weekly_email_day` at or after `weekly_email_time` local, to each member
  with `weekly_email = true`. Log key: (weekly, member, null, ref_date = today). Content, in
  order: missed deadlines (title, area, assignee, days late); due in the next 7 days; everything
  else open grouped by area with RAG; unassigned items; done this week per person; a button
  that opens home.os (`APP_URL`). Sent with Resend (`RESEND_API_KEY`, `EMAIL_FROM`).
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
  (`auth` schema, roles) and the migrations, then runs `supabase/tests`.
- `npm run test:e2e`: Playwright against the demo-mode build.
