import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4180);

/** iPhone-sized Chromium, the size the app is designed for. */
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
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
