# home.os

A radically simple, iPhone-first app for looking after a home. It lists the **areas** of
the house (Kitchen, Garden, Jacuzzi…) and the **items** that need attention in each, with a
red, amber or green status, a note and an assignee. An item is either **To do** (a job like
"fix the gate", with a due date, an optional repeat and a push reminder, ticked off when it is
done) or **To maintain** (something whose condition you keep track of, like the firepit: it
never gets done and stays on the list, and says **What good looks like** for it, such as
"cover on, ash cleared out, logs dry and stacked"). Everyone in the household signs in with
**Google**, picks an emoji for their profile, and **can edit everything**.

- **Home**: today's date, then every area and its items, with how many are red, amber and green.
  A row of people at the top (Everyone, you, each person, Unassigned, with counts) shows just
  one person's items, so everyone can see what they need to do; the phone remembers the choice.
  Each item is one slim row: its title, then who, when and its note on one line. Areas fold away with a
  tap (or all at once) and stay that way on that phone. Add an item with the round + at the
  bottom right, or with the small + in an area's header, which starts the item in that area.
- **The hero**: every tab opens on an illustration that runs to the very top of the screen: the
  house in its garden, with a green duck and a brown hedgehog, under the sky as it is in London
  right now (sunrise, daytime, sunset, dusk or a starry night). The Home / Chat / Housekeeping /
  Stats switch sits just under it and stays at the top as you scroll.
- **Chat**: one group chat for the whole household. Messages are kept for good (no limit on how
  long they stay), anyone can react to a message with emoji (long-press it, or tap a reaction
  to add yours), and a dot on the Chat tab shows unread messages.
- **Housekeeping**: the weekly visit by the housekeeper (a household member like everyone
  else). A message for the housekeeper at the top, today's checklist from the household's task
  list (edit it with Edit: add, rename, reorder, delete), who ticked what, comments and the
  price for the day in pounds, all saved as you go, and a calendar of every visit (Monday
  first): what was asked, what was done, the comments and the price, with each month's total.
  Any past day's visit can be opened, corrected or deleted, and a missed one added.
- **Stats**: who has done what.
- **Share**: send an item (from its sheet, as the sheet shows it) or a whole area (the share
  button in its header) to WhatsApp, Messages or Mail as a short summary with a link. The
  link opens that item, or that area on Home, in home.os for anyone in the household (after
  signing in if need be; on iPhone, links open in Safari rather than the Home Screen app).
  Where there is no share sheet, the text is copied instead.
- A **weekly email** with the full status, and **push notifications** before deadlines and when
  one is missed.

It is an installable web app (PWA): no App Store needed. Add it to the iPhone Home Screen
and it behaves like a native app, including notifications (iOS 16.4 or later).

- Live: https://home-os-orpin.vercel.app (demo mode until Supabase is configured)
- Design spec: [`design/README.md`](design/README.md) (Turn 3, option 3a)
- How it is built: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Try it in 30 seconds (demo mode)

```bash
npm install
npm run dev
```

Open http://localhost:5173. Without Supabase settings the app runs in **demo mode**:
sign-in is simulated and data stays in your browser. Add `?demo-seed=1` to the URL to jump
straight into a household filled with example data, or `?demo-reset=1` to start over.

## Going live

You need four free accounts: **Supabase** (database, Google sign-in, scheduled jobs),
**Google Cloud** (the OAuth client for "Continue with Google"), **Resend** (the weekly email)
and a static host such as **Vercel**, **Netlify** or **Cloudflare Pages** (HTTPS is required
for notifications).

### The quick way: Vercel + Supabase (shared data on every phone)

Without a database the app runs in demo mode and each browser keeps its own data. To share it:

1. In Vercel, open the project, go to **Storage**, choose **Create Database**, then **Supabase**,
   and connect it to the project (all environments). Vercel adds the database settings to the
   project (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `POSTGRES_URL_NON_POOLING`, ...).
2. Redeploy. The build reads those settings (`vite.config.ts`), and `scripts/migrate.mjs` brings
   the database up to date before building (production builds only; it records what it applied
   in `supabase_migrations.schema_migrations`, like the Supabase CLI).
3. Turn on Google sign-in (step 2 below, including its step 5) and, in Supabase **Authentication > URL Configuration**,
   set the Site URL to the app's address and add `<app address>/**` as a redirect URL.

The numbered steps below do the same by hand, plus push notifications and the weekly email.

### 1. Supabase project and database

1. Create a project at https://supabase.com/dashboard.
2. Link this folder to it and push the schema:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF
   npx supabase db push
   ```

### 2. Google sign-in

1. In Google Cloud Console, open **APIs & Services → Credentials → Create credentials →
   OAuth client ID** (type **Web application**). If asked, configure the consent screen first
   (External, app name `home.os`, your email).
2. Under **Authorized redirect URIs** add
   `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`.
3. In Supabase: **Authentication → Sign In / Providers → Google**: enable it and paste the
   client ID and secret.
4. In Supabase: **Authentication → URL Configuration**: set **Site URL** to your app's URL
   (for example `https://homeos.vercel.app`) and add it, plus `http://localhost:5173` for
   local development, to **Redirect URLs**.
5. In Supabase: **Authentication → Sign In / Providers → Email**: turn it off (home.os only
   uses Google), or at least keep **Confirm email** on (the default). Someone signing in with
   Google becomes the person a housemate added with that email. The database only accepts an
   email Google vouches for (the account needs a Google identity with that email, verified by
   Google), so an email and password account can never become anyone; turning the Email
   provider off also keeps such accounts from being made at all.
6. Nothing to set for **one home**: the database refuses a second home from the app itself.
   (`public.app_settings.many_homes` lets a development or test database hold many homes; never
   turn it on for a real deployment.)

### 3. App settings

Copy `.env.example` to `.env.local` and fill in:

| Variable | Where to find it |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase **Project Settings → API → Project URL** |
| `VITE_SUPABASE_ANON_KEY` | Supabase **Project Settings → API → anon public key** |
| `VITE_VAPID_PUBLIC_KEY` | The public key from `npx web-push generate-vapid-keys` (see step 4) |

Set the same three variables in your host's dashboard for production builds.

### 4. Push notifications and the weekly email

1. Generate a Web Push key pair once: `npx web-push generate-vapid-keys`.
2. Create a Resend API key at https://resend.com and verify the domain you will send from.
3. Make up a long random secret for the scheduler and keep it for the next two steps:
   `openssl rand -hex 32`.
4. Deploy the scheduler function and give it its secrets. The function reads a view that the
   migrations create, so run `npx supabase db push` (step 1) first, and again before
   redeploying the function after an update (see "Updating" below):

   ```bash
   npx supabase functions deploy scheduler --no-verify-jwt
   npx supabase secrets set \
     CRON_SECRET="the-secret-from-step-3" \
     APP_URL="https://your-app-url" \
     VAPID_PUBLIC_KEY="..." VAPID_PRIVATE_KEY="..." VAPID_SUBJECT="mailto:you@example.com" \
     RESEND_API_KEY="re_..." EMAIL_FROM="home.os <home@yourdomain.com>"
   ```

5. Open `supabase/cron.sql`, replace the two placeholders at the top of step 2 (your project
   URL and the same secret), and run the whole script once in the Supabase **SQL Editor**. It
   calls the scheduler every 15 minutes: reminders go out from 08:00 household time per each
   item's Notify setting, missed alerts the morning after a deadline, and the weekly email on
   Mondays at 08:00. `select cron.unschedule('home-os-scheduler');` stops it.

### 5. Deploy the app (Vercel)

1. Open https://vercel.com/new, sign in with GitHub and import **StratisV/s**. The settings
   come from `vercel.json` (Vite, `npm run build`, output `dist`), so just press **Deploy**.
   Vercel deploys the repository's default branch to production and redeploys on every push.
2. Without the variables below the site runs in **demo mode** (simulated sign-in, data in each
   browser). For real Google sign-in add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and
   `VITE_VAPID_PUBLIC_KEY` under **Project → Settings → Environment Variables**, then
   **Redeploy** (Vite reads them at build time).
3. Put the Vercel URL (for example `https://homeos.vercel.app`) into Supabase **Authentication
   → URL Configuration** (Site URL and Redirect URLs) and into `APP_URL` for the scheduler.

Any other static host works the same way: build command `npm run build`, output folder
`dist`, plus the three `VITE_` variables. To serve from a sub-path (for example GitHub Pages),
also set `VITE_BASE=/your-path/`.

### 6. On each iPhone

There is one home per deployment, and nobody can set up a second one.

1. Open the app's URL in **Safari** and tap **Continue with Google**.
2. The first person sets up the home. **Do this on the phone that kept the home in demo mode**
   and tap **Bring It Over**: the areas, every item, what was done (Stats) and everyone in it
   come across, and you keep your name and emoji (the demo's made-up history stays behind).
   Then add the others' Google emails right there. Otherwise create your profile (name and
   emoji), then the home. If someone set up an empty home first on another phone, ask them to
   add your email: once you are in, and while that home still has nothing in it, your phone
   offers to bring its home over in its place.
3. Add everyone else in **Profile → Household → People → Add Person**: their name, emoji and
   the Google email they sign in with (people brought over from the phone are there already:
   tap one to add their email). You can give them items straight away. When they tap
   **Continue with Google** they go straight into the home as that person, with their items.
   Someone whose email nobody has added sees "This home is private", with the email to ask for.
   The **Invite someone** link from Profile still works too: whoever opens it is asked "Are you
   one of these people?" first, so nobody brought over from the phone ends up there twice.
   If the wrong person got in with an email, they tap **Not Shea? Sign Out** on the welcome
   step, and Shea waits for the right email again.
4. Tap **Share → Add to Home Screen**, then open home.os from the Home Screen.
5. In **Profile**, turn on **Push notifications**.

### 7. Updating

After pulling an update, **apply the database migrations before anything else**, because
Vercel redeploys the app as soon as the default branch changes and the new app reads the new
columns (for example `items.kind` or `items.good`): an app deployed ahead of its migrations
can't load any household. The migrations are backward compatible (new tables and columns with
defaults), so the app that is live keeps working on the new schema. In order:

1. `npx supabase db push` (for this release: the chat, item kind and "What good looks like"
   migrations, `20261010000100_chat.sql`, `20261010000200_item_kind.sql` and
   `20261010000300_item_good.sql`).
2. `npx supabase functions deploy scheduler --no-verify-jwt`.
3. Push or merge to the default branch (Vercel deploys the app).

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server (demo mode unless `.env.local` has Supabase settings) |
| `npm run build` | Typecheck and production build into `dist/` |
| `npm test` | Unit tests (logic, demo backend, push client, scheduler modules) |
| `npm run test:db` | Database tests: schema, row level security and RPCs on a throwaway Postgres 16 |
| `npm run test:e2e` | Playwright end-to-end tests against a demo-mode build |
| `npm run test:e2e:live` | Two phones on a real (local) Supabase: bringing the home over, joining by email, "This home is private", and every kind of change syncing live |
| `npm run icons` | Re-render the app icons from `public/icons/icon.svg` |

With Docker running, `npx supabase start` gives you a full local Supabase stack;
`npx supabase db reset` applies the migrations to it. A deployment holds one home, and the
database refuses a second one from the app; the tests make many, so a **development** database
they run against must allow that once:
`insert into public.app_settings (id, many_homes) values (true, true) on conflict (id) do update set many_homes = true;`
(`npm run test:db` does it for its own throwaway database, whose `one_home_deployment` tests
also make a fresh database without it, as a deployment has it). Then
`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db` runs the
database tests against it. The live backend suite runs with
`SUPABASE_TEST_URL=http://127.0.0.1:54321 SUPABASE_TEST_ANON_KEY=<anon key> SUPABASE_TEST_SERVICE_KEY=<service role key> npx vitest run src/lib/backend/supabase.integration.test.ts`
(keys from `npx supabase status`; the database at `SUPABASE_TEST_DB_URL`, by default the local
stack's), and
`npx supabase functions serve scheduler --no-verify-jwt --env-file <file>` serves the scheduler.

**Live two-phone tests** (`npm run test:e2e:live`, `playwright.live.config.ts`, `e2e-live/`):

1. Start the local stack and apply the migrations: `npx supabase start`, then
   `npx supabase db reset` (or, on a database other runs share,
   `MIGRATE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node scripts/migrate.mjs --no-record`
   and `docker restart supabase_rest_home-os` so the API sees the new functions).
2. Run `npm run test:e2e:live`. It reads the URL and keys from `npx supabase status` (or from
   `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY` and `SUPABASE_TEST_SERVICE_KEY`, as the live
   backend suite does) and never prints them. It only runs against a local stack, unless
   `LIVE_E2E_ALLOW_REMOTE=1`.
3. It builds the app against that stack into `dist-live/` and serves it on port 4214
   (`E2E_LIVE_PORT` to change it). Google sign-in can't run in a test, so each phone is a
   browser context whose storage already holds a session: accounts are made with the Auth admin
   API (email confirmed) and given the Google identity a Google sign-in leaves (with SQL, on the
   database `npx supabase status` names or `SUPABASE_TEST_DB_URL`), then signed in with a password.
4. Bringing the home over needs a database with no home in it. The tests wait up to 90 seconds
   for other test runs to finish with theirs, then say so. Afterwards they remove their own
   accounts and home (accounts named `homeos-live-e2e-…@example.com`), and nothing else.

What they prove, with Stratis's phone holding the household's demo home: when Shea set up an
empty home first, his phone says its home can't come over yet, and once she adds him it takes
the place of the empty one (Shea matched by name), and Ela joins through an invite link as the
Ela who came along. Then, from no home: he brings it over (every area, item, assignment and the
real Stats history), adds Shea's Google email, and Shea signs in and is Shea with her items;
someone else sees "This home is private" until they are added;
then every change one phone makes (items, What good looks like, kind, done and undo, delete,
areas, household name and address, people, chat messages and reactions) shows on the other
within 5 seconds, without a reload, and a phone that was offline catches up as soon as it is
back online.

## Permissions

Everyone who belongs to a household can edit everything in it: the household's name,
address and time zone, its areas, every item (To do or To maintain, and switching between
them), completions (undo) and each other's profiles
(name and emoji, under **Profile → Household → People**).

People can be in the home before they join (**Not joined yet**):

- Anyone at home can add a person under **Profile → Household → People → Add Person** (name,
  emoji and the Google email they will sign in with), give them items, and set, change or
  clear their email. Each email belongs to one person in the home.
- Until they sign in, such a person has no account: they give nobody access, get no
  notifications or weekly email, and can't post in the chat. Their items show on Home, in the
  person filter and in Stats like anyone else's.
- When they sign in with Google using that email (Google must have verified it), they become
  that person, keeping the name, emoji, items and Stats set up for them. Within a day they can
  say it isn't them (**Not Shea?**): the person waits to join again, without that email.
- Anyone can remove a person who has not joined yet; their items become unassigned, and what
  they did leaves Stats (the confirmation says how many). Someone who has joined can't be
  removed from the app.

The household chat has its own rules:

- Everyone in the household reads and posts in it.
- Messages are kept forever: nothing deletes them by age. If someone's account is removed,
  their messages stay (shown as from a former member).
- Anyone can react to any message, with several different emoji, once each, and can take back
  only their own reactions.
- Only the author can delete a message (for everyone); nobody can edit one.

Housekeeping follows the household rule. The housekeeper joins like anyone else, and everyone
can change the message for the housekeeper, the task list, any visit's ticks, comments and
price, and can delete a visit. Each visit keeps its own copy of the list and of that day's
message, so renaming or deleting a task later never changes past visits, and two people
ticking at the same time never undo each other's ticks.

People outside the household can't see or change any of it. Someone new joins by signing in
with Google using the email someone at home added for them, or with an invite link (valid for
14 days). Anyone else who signs in sees "This home is private" and nothing of the home. A shared
item or area link opens the item or area only for people in the household. The text of a shared
message can be read by whoever it was sent to.
