import { defineConfig } from '@playwright/test';

const PORT = 4173;

/** iPhone-sized Chromium (WebKit isn't needed: layout is plain CSS). */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 402, height: 874 },
    deviceScaleFactor: 2,
    hasTouch: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    // Always demo mode, whatever is in .env.local.
    command: `npx vite build --mode e2e && npx vite preview --port ${PORT} --strictPort`,
    env: { VITE_FORCE_DEMO: '1' },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
