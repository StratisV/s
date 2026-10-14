import { generateKeyPairSync } from 'node:crypto';
import { defineConfig } from '@playwright/test';

// Server mode end to end (docs/ARCHITECTURE.md "Server mode (no setup)", "Local server and
// tests"; `npm run test:e2e:server`): the app built for server mode (HOMEOS_LOCAL_SERVER=1)
// into dist-server/app and served, with /api/home, by the local server (server/entry/local.ts)
// over an in-memory store. Two or three browser contexts are two or three phones. One worker:
// there is one home per server, and each test starts from a reset. E2E_PORT lets two checkouts
// run it side by side.
const PORT = Number(process.env.E2E_PORT || 4316);

/** Every name scripts/backend-mode.mjs reads for Supabase, emptied: whatever the shell or .env.local says, this is server mode. */
const NO_SUPABASE = Object.fromEntries(
  [
    'VITE_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
  ].map((name) => [name, '']),
);

/**
 * Phone notifications on the first server (e2e-server/notifications.spec.ts): a VAPID key pair
 * made for this run (nothing is ever sent: no browser here subscribes, service workers are
 * blocked), and the cron secret the morning run's test calls with (e2e-server/helpers.ts).
 */
const VAPID = (() => {
  const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]);
  return {
    HOMEOS_VAPID_PUBLIC_KEY: publicKey.toString('base64url'),
    HOMEOS_VAPID_PRIVATE_KEY: jwk.d!,
    HOMEOS_VAPID_SUBJECT: 'mailto:e2e@example.com',
  };
})();

export default defineConfig({
  testDir: 'e2e-server',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 402, height: 874 },
    deviceScaleFactor: 2,
    hasTouch: true,
    timezoneId: 'Europe/London',
    locale: 'en-GB',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: [
        'npx vite build --mode e2e-server --outDir dist-server/app',
        'node scripts/build-server.mjs --local',
        // 5 wrong codes per address a minute, also for an address someone signed in from (every
        // context here is the same address).
        `node dist-server/local.mjs --port ${PORT} --static dist-server/app --memory --allow-reset --attempts 5,20,60000,5`,
      ].join(' && '),
      env: {
        ...NO_SUPABASE,
        HOMEOS_LOCAL_SERVER: '1',
        VITE_FORCE_DEMO: '',
        VITE_VAPID_PUBLIC_KEY: '',
        // The setup code the tests use (e2e-server/helpers.ts SETUP_CODE); never a real one.
        HOMEOS_SETUP_CODE: 'TEST-SETU-PCDE-2345-6789',
        ...VAPID,
        // e2e-server/helpers.ts CRON_SECRET; never a real one.
        CRON_SECRET: 'e2e-cron-secret-not-a-real-one',
      },
      url: `http://localhost:${PORT}/index.html`,
      // Never a server built for something else (demo mode, another checkout).
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      // The same app on a second server whose month of saving runs out after 4 puts (bringing
      // the home online, the phone's first use of its key, and two changes; e2e-server/readonly.spec.ts).
      // Started after the first, so the build is there.
      command: `node dist-server/local.mjs --port ${PORT + 1} --static dist-server/app --memory --allow-reset`,
      env: { HOMEOS_SETUP_CODE: 'TEST-SETU-PCDE-2345-6789', HOMEOS_BLOB_WRITES_PER_MONTH: '4' },
      url: `http://localhost:${PORT + 1}/index.html`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
