import { defineConfig } from '@playwright/test';
import { liveEnv } from './e2e-live/env';

// Live two-device tests (README "Development"): the app built against a local Supabase
// stack, two or three browser contexts as two or three people. `npm run test:e2e:live`.
// E2E_LIVE_PORT lets two checkouts run them side by side.
const PORT = Number(process.env.E2E_LIVE_PORT || 4214);
const env = liveEnv();

export default defineConfig({
  testDir: 'e2e-live',
  // One home per deployment: the tests share one home, one step after another.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 180_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 402, height: 874 },
    deviceScaleFactor: 2,
    hasTouch: true,
    timezoneId: 'Europe/London',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Its own build (dist-live), so it never mixes with the demo build the other e2e tests use.
    command: `npx vite build --mode live --outDir dist-live && npx vite preview --outDir dist-live --port ${PORT} --strictPort`,
    env: {
      VITE_SUPABASE_URL: env.url,
      VITE_SUPABASE_ANON_KEY: env.anonKey,
      // Whatever .env.local says: the real backend, and no push (the steps stay the same everywhere).
      VITE_FORCE_DEMO: '',
      VITE_VAPID_PUBLIC_KEY: '',
    },
    url: `http://localhost:${PORT}`,
    // Never a server built for something else (demo mode, another stack).
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
