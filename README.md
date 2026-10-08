# home.os

A radically simple, iPhone-first app for looking after a home. It lists the **areas** of
the house (Kitchen, Garden, Jacuzzi…) and the **items** that need attention in each, with a
red, amber or green status, a note, a due date, an assignee, an optional repeat and a push
reminder. Everyone in the household signs in with **Google**, picks an emoji for their
profile, and **can edit everything**. A Stats tab shows who has done what, everyone gets a
weekly email with the full status, and push notifications arrive before deadlines and when
one is missed.

It is an installable web app (PWA): no App Store needed. Add it to the iPhone Home Screen
and it behaves like a native app, including notifications (iOS 16.4 or later).

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
3. Deploy the scheduler function and give it its secrets:

   ```bash
   npx supabase functions deploy scheduler --no-verify-jwt
   npx supabase secrets set \
     CRON_SECRET="$(openssl rand -hex 32)" \
     APP_URL="https://your-app-url" \
     VAPID_PUBLIC_KEY="..." VAPID_PRIVATE_KEY="..." VAPID_SUBJECT="mailto:you@example.com" \
     RESEND_API_KEY="re_..." EMAIL_FROM="home.os <home@yourdomain.com>"
   ```

4. Open `supabase/cron.sql`, replace the two placeholders (your project URL and the same
   `CRON_SECRET`), and run it once in the Supabase **SQL Editor**. It runs the scheduler every
   15 minutes: reminders go out at 08:00 household time per each item's Notify setting, missed
   alerts the morning after a deadline, and the weekly email on Mondays at 08:00.

### 5. Deploy the app

Any static host works. Build command `npm run build`, output folder `dist`, plus the three
`VITE_` variables. To serve from a sub-path (for example GitHub Pages), also set
`VITE_BASE=/your-path/`.

### 6. On each iPhone

1. Open the app's URL in **Safari** and tap **Continue with Google**.
2. Create your profile (name and emoji). The first person creates the home; everyone else
   joins with the **Invite someone** link from Profile.
3. Tap **Share → Add to Home Screen**, then open home.os from the Home Screen.
4. In **Profile**, turn on **Push notifications**.

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server (demo mode unless `.env.local` has Supabase settings) |
| `npm run build` | Typecheck and production build into `dist/` |
| `npm test` | Unit tests (logic, demo backend, push client, scheduler modules) |
| `npm run test:db` | Database tests: schema, row level security and RPCs on a throwaway Postgres 16 |
| `npm run test:e2e` | Playwright end-to-end tests against a demo-mode build |
| `npm run icons` | Re-render the app icons from `public/icons/icon.svg` |

With Docker running, `npx supabase start` gives you a full local Supabase stack;
`npx supabase db reset` applies the migrations to it.

## Permissions

Everyone who belongs to a household can edit everything in it: the household's name,
address and time zone, its areas, every item, completions (undo) and each other's profiles.
People outside the household can't see or change any of it. New people join only through an
invite link (valid for 14 days).
