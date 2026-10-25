# home.os

A radically simple, iPhone-first app for looking after a home. It lists the **areas** of
the house (Kitchen, Garden, Jacuzzi…) and the **items** that need attention in each, with a
red, amber or green status, a note and an assignee. An item is either **To do** (a job like
"fix the gate", with a due date, an optional repeat and a push reminder, ticked off when it is
done) or **To maintain** (something whose condition you keep track of, like the firepit: it
never gets done and stays on the list, and says **What good looks like** for it, such as
"cover on, ash cleared out, logs dry and stacked"). Everyone in the household signs in (with
a **code** from someone at home on this deployment's own server, or with **Google** on
Supabase), picks an emoji for their profile, and **can edit everything**.

The colour always comes with a word. For a To do it is how urgent it is: red is **Urgent**,
amber is **Within the month**, green is **Not urgent**. For a To maintain item it is the
condition it is in: **Needs work**, **Okay** or **Good**. The Item sheet says what each one
means under it ("Needs doing now", "Fine for now, keep an eye on it").

- **Four tabs** along the bottom, in a bar of frosted glass docked on the bottom edge:
  **Home**, **Goals** (Goals for the week, with a red count of this week's goals not done
  yet), **Housekeeping** (a dot for a new message) and **Stats**. The phone reopens on the tab
  last open.
- **Home**: the hero, then one plain sentence on what needs doing ("2 things need attention
  and 1 is due today. Everything else can wait.").
  Then the areas of the house, two to a row, one card each with its own drawing of the room (a
  pot steaming in the kitchen, the green duck in the bath, a robin on the garden fence; each
  in its own colours, so no two look alike, and by lamplight in dark mode), its name, how it
  is ("2 urgent tasks" in red: jobs marked Urgent and things that need work; "3 non-urgent
  tasks" in orange: the other jobs, late or not; both when both apply, red first; or "All
  good" in green), and who is looking after it. A card opens that area as a sheet: its
  picture, its name, how it is (the same words) and who is on it, **Add Item** and **Share
  Room**, then its jobs, most urgent first (three, then "Show 2 more"), and the things it
  looks after.

  In an area's sheet each item is a row: its title (two lines at most), its urgency in words
  and when it is due ("Tomorrow", "In 4 days", "2 days late" in red), who it is for (their
  emoji and first name), and a plain grey ring: tap it to tick the job off (the title is
  struck through for a moment, then the row folds away, with Undo there at once for 8
  seconds, and "Done. Next one in 8 weeks" for a job that repeats). **Urgent** is the loudest
  word; **Within the month** is amber; **Not urgent** grey. A thing looked after has a small
  gauge instead of a ring (three bars for Good, two for Okay, one for Needs work). Add an item
  with the round + just above the tab bar on the right, or with **Add Item** in an area's
  sheet. A new job has no due date until someone gives it one, so nothing turns "late" by
  itself. Once saved, the app shows where it went: on Home its area's card lights up for a
  moment; in an area's sheet its row does, with any "Show N more" over it opened. One saved
  into another area than the sheet open says where it went ("Saved in Hallway.").
- **Goals for the week**: the home's shared list for the week, Monday to Sunday in the home's
  time zone. It opens on this week ("This week, 5 to 11 Oct", and how many are done), with
  arrows to the weeks before and after. Anyone at home can add a goal (**Add a Goal**; Enter
  adds it and starts the next), rename it in place, choose who is on it, tick it off (it then
  says who ticked it and when) or untick it, move it (drag its grip, use the arrow keys, or
  Move Up and Move Down in its "…" menu) and delete it, after a question. When this week is
  empty and last week has goals not done, **Bring over 2 from last week** copies them in. A
  week holds up to 50 goals, each up to 120 characters. Ticking the last one of the week sets
  off the confetti.

  **Share** gives the home one public link (`https://<your app>/?goals=<token>`), sent with
  the phone's share sheet (WhatsApp is one tap) or copied. Anyone with it sees the current
  week, read-only and without signing in: the house, "Goals for the week", the dates, and
  each goal with its tick and who is on it (first name and emoji). Nothing else of the home.
  The page keeps itself up to date (it asks again every minute while it is open). **Turn Off
  Link** ends it: the old link then says "This link is no longer active", and a new link can
  be made later.
- **Dark mode**: the whole app follows the phone's appearance (the hero keeps its own sky).
- **The hero**: Home opens on an illustration that runs to the very top of the screen: the
  house in its garden, with a green duck and a brown hedgehog, under the sky as it is in London
  right now (sunrise, daytime, sunset, dusk or a starry night). The other tabs keep a slim band
  of that sky at the top, over a large title and the profile button.
- **Housekeeping**: the weekly visit by the housekeeper (a household member like everyone
  else). Today's date over the title, as on Home. Under the title, the app's calendar: this
  week as a strip (or the whole month, with each month's total), a blue dot on the days the
  housekeeper came, a line on how today's visit is going, and **Today** to come back. Then a
  message for the housekeeper, then the day chosen in the calendar: its tasks as a stack of
  area cards, one a row. **Whole home** comes first (the tasks that belong to no one area, its
  picture a doll's house of every room), then each area with its own picture, its name and the
  day's progress ("2 of 5 done", "All done" in green, "No tasks yet" in grey), then any section
  no area is called. A tap opens a card in place to its checklist (a tap on its header closes
  it again; several can be open): tick tasks, see who ticked what, and add a task to that area
  with **Add Task**. Then comments and the price for the day in pounds, all saved as you go;
  or, for a past day, what was asked, what was done, the comments and the price. Any past
  day's visit can be corrected or deleted, and a missed one added. Edit opens the whole task
  list (add, rename, reorder, delete).
  An area's tasks are the section of the task list named after it (the case and extra spaces
  don't matter): the first Add Task on an area makes that section, and renaming the area in
  Household renames it too, so the area keeps its tasks. The task list can be divided into
  sections by hand as well: add, rename, reorder and delete them in the task list (Add Section,
  and each section's "..." menu), add a task straight into one, and move tasks between them by
  dragging, with the arrow keys, or with Move to Section. Deleting a section keeps its tasks:
  they move to the top of the list (Whole home). Earlier visits keep the sections they had, and
  find their areas by those names. Two people sorting the list at the same time both keep
  their moves.
- **Stats**: who has done what.
- **Share**: send an item (from its sheet, as the sheet shows it) or a whole area (Share Room
  in its sheet) to WhatsApp, Messages or Mail as a short summary with a link, which says
  each item's urgency or condition in words. The
  link opens that item, or that area's sheet over Home, in home.os for anyone in the
  household (after signing in if need be; on iPhone, links open in Safari rather than the
  Home Screen app).
  Where there is no share sheet, the text is copied instead.
- A **weekly email** with the full status, and **push notifications** before deadlines and when
  one is missed.

It is an installable web app (PWA): no App Store needed. Add it to the iPhone Home Screen
and it behaves like a native app, including notifications (iOS 16.4 or later).

- Live: https://home-os-orpin.vercel.app (server mode once its Blob store is connected; see [Server mode](#server-mode-shared-on-every-phone-nothing-to-set-up))
- Design spec: [`design/README.md`](design/README.md) (Turn 3, option 3a)
- How it is built: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Try it in 30 seconds (demo mode)

```bash
npm install
npm run dev
```

Open http://localhost:5173. Without Supabase settings the app runs in **demo mode**:
sign-in is simulated and data stays in your browser. Add `?demo-seed=1` to the URL to jump
straight into a household filled with example data (with a few extra jobs, so there is
something due today and a busy week, and goals for last week and this one), or
`?demo-reset=1` to start over.

## Server mode: shared on every phone, nothing to set up

When the Vercel project has a private **Vercel Blob** store connected, home.os keeps the
household's home on its own server (one Vercel Function, `/api/home`) and everyone signs in
with a **code** instead of Google. Nobody has to open a console or make an account. Supabase,
Google sign-in, push notifications and the weekly email stay in the code, unused in this
mode (they need other services), and are hidden in the app.

**What you do, once:** open the **setup link** you were sent (it ends in `?setup=…`) on the
phone that has the home, check what comes along (the home's name and address, areas, items,
who's who, real history and housekeeping, and when that copy last changed) and tap
**Bring It Online**. That phone is now signed in as you, and everyone else in the home is
waiting to join with their items. If the home lives in the home.os app on your Home Screen and
the link opened in Safari instead, Safari says so and shows the setup code with **Copy Code**:
open the app and paste it (**Paste**) or type it under **Setup code**. If the connection drops
just as you tap, tap again: the same setup code signs that phone in as you until you have used
the home. After that the setup code does nothing.

**Inviting the others:** right after that, or later in **Profile > Household > People**, tap
**Invite** next to someone (for someone new, **Add Person** first: a name and an emoji). The
code sheet shows a code like `K7QM-3XRP` and **Share** sends it, with a link. They open home.os
and type the code under **Have a code?** (or open the link; on an iPhone a link opens in
Safari, so it asks whether to join there or shows the code to type in the Home Screen app), and
they are in as themselves, with their items. A code works once and for 7 days; making another
for the same person does not cancel the first (once they join, the others go).

- **Another phone or tablet of your own:** **Profile > Add another device**.
- **Someone's devices:** their page in People lists where they are signed in ("iPhone · Home
  Screen app", "iPhone · Safari"…); **Remove** signs that device out. Only they can add a
  device of their own; when they have lost their phone, remove it, and then **Sign in on a new
  phone** makes them a fresh code.
- **Sign Out** forgets this device (also when offline: it finishes once back online); signing
  in again needs a new code from someone at home (the app warns you when it is the only device
  signed in).
- Anyone without a code sees "This home is private." and nothing of the home. Wrong codes are
  limited (a few tries per address, then a 15-minute wait), without holding up anyone else.
- Changes show on everyone's phone within a few seconds while the app is open and in use
  (each phone asks the server every few seconds while it is on screen, once a minute after 3
  minutes without a tap, not at all after 15, and at once when someone uses it again).

**Limits:** on Vercel's free (Hobby) plan the Blob store allows about 2,000 saved changes and
10,000 reads a month. home.os counts them; if the month's saving runs out, Home says
"Saving is paused until next month" and everything can still be read, and near the read
allowance it stops reading the store for anything but saving, instead of the store being
blocked. On a paid plan set `HOMEOS_BLOB_WRITES_PER_MONTH` and `HOMEOS_BLOB_READS_PER_MONTH`
to `0` (no limit).

**For whoever deploys** (not the household): connect a private Blob store to the Vercel
project (all environments; Vercel adds `BLOB_READ_WRITE_TOKEN`), set `HOMEOS_SETUP_CODE` to
12 or more letters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (for example `K7QM-3XRP-WN9D`),
and redeploy. `vercel.json`'s build command then publishes the app and the function together
(the Build Output API, `scripts/build-server.mjs`); without a Blob store it deploys the demo
build exactly as before. After the deploy, `curl -H 'X-HomeOS: 1' <app>/api/home?op=status`
must answer `{"home":false}` (JSON) until the home is brought online. Details:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) "Server mode (no setup)".

## Going live with Supabase

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
defaults), so the app that is live keeps working on the new schema. A phone with the page from
before housekeeping sections still open can still reorder its task list: the sections
migration keeps `reorder_housekeeping_tasks` for it, and server mode keeps
`reorderHousekeepingTasks` the same way (each task stays in its section). In order:

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
| `npm run dev:server` | Server mode on this computer: the local API server (home kept in `.homeos-local/`) and Vite in server mode; setup code `TEST-SETU-PCDE` unless `HOMEOS_SETUP_CODE` is set |
| `npm run build:server` | Bundle the local server into `dist-server/local.mjs` |
| `npm run test:e2e:server` | Two and three phones in server mode on the local server: setup, codes, devices, read-only, and every kind of change syncing live |
| `npm run test:build` | The production builds as Vercel makes them: demo mode without a Blob store, server mode with one, and no secret in anything deployed |
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
areas, household name and address, people) shows on the other
within 5 seconds, without a reload, and a phone that was offline catches up as soon as it is
back online.

**Server-mode tests** (`npm run test:e2e:server`, `playwright.server.config.ts`, `e2e-server/`)
need nothing running: they build the app in server mode into `dist-server/app`, start the
local server over an in-memory store on `E2E_PORT` (default 4316) and a second one on the next
port whose month of saving runs out after 3 changes, and reset the home before each test.
They prove, with Stratis's phone holding the household's demo home: bringing it online with
the setup link (and with the code typed, after a wrong one), everything coming along, Shea
joining with her code typed or as a link and seeing her items, used codes and the used setup
link refused, a stranger kept out, wrong codes refused then limited and never stored, Add
another device, removing a device signing that browser out, Sign Out, the last-device warning,
"Not Shea?", read-only mode, and every kind of change (items, areas, household, people,
housekeeping) showing on the other phone within 5 seconds without a reload, including two
people writing at the same moment on three phones, a phone that was offline catching up, and
no polling while the app is hidden. `npm run test:build` and `scripts/vercel-function.test.ts`
(part of `npm test`) check the Vercel deployment offline: the builds, and the function bundle
running with the real `@vercel/blob` against a fake Blob service.

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
  notifications or weekly email. Their items show on Home, on goals and in Stats like anyone
  else's.
- When they sign in with Google using that email (Google must have verified it), they become
  that person, keeping the name, emoji, items and Stats set up for them. Within a day they can
  say it isn't them (**Not Shea?**): the person waits to join again, without that email.
- Anyone can remove a person who has not joined yet; their items become unassigned, and what
  they did leaves Stats (the confirmation says how many). Someone who has joined can't be
  removed from the app.

Goals for the week follow the household rule too: anyone at home can add, rename, tick,
untick, move and delete any goal, in any week, and make or turn off the public link. The
public link is the one way in from outside: anyone with it sees this week's goals (titles,
ticks, and the first name and emoji of who is on each), and nothing else. Its token is 128
random bits, so it can't be guessed; turning it off ends it for good (a copy kept at the edge
can still show the week for a minute or so).

Housekeeping follows the household rule. The housekeeper joins like anyone else, and everyone
can change the message for the housekeeper, the task list, any visit's ticks, comments and
price, and can delete a visit. Each visit keeps its own copy of the list and of that day's
message, so renaming or deleting a task later never changes past visits, and two people
ticking at the same time never undo each other's ticks.

People outside the household can't see or change any of it. Someone new joins by signing in
with Google using the email someone at home added for them, or with an invite link (valid for
14 days); in server mode, with a code someone at home made for them (single use, valid 7 days). Anyone else who signs in sees "This home is private" and nothing of the home. A shared
item or area link opens the item or area only for people in the household (the goals link is
the exception, above). The text of a shared
message can be read by whoever it was sent to.
