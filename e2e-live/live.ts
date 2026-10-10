import { randomBytes } from 'node:crypto';
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { liveEnv } from './env';

// Helpers for the live two-device tests: accounts made with the GoTrue admin API, sessions
// from the password grant, put into the app's Supabase auth storage before it loads (Google
// sign-in itself cannot run in a test), and everything this suite made removed afterwards.

const env = liveEnv();

/** How long a change on one device may take to show on the other. */
export const SYNC_MS = 5_000;

/** Every account this suite makes has an email starting with this (and only those are cleaned up). */
const EMAIL_PREFIX = 'homeos-live-e2e-';
const RUN = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

export interface Account {
  id: string;
  email: string;
  password: string;
  /** The name Google would give (user_metadata.full_name). */
  googleName: string;
}

/** Where supabase-js keeps the session: `sb-<first label of the API host>-auth-token`. */
export const AUTH_STORAGE_KEY = `sb-${new URL(env.url).hostname.split('.')[0]}-auth-token`;

async function api<T>(path: string, init: RequestInit & { key: 'anon' | 'service' }): Promise<T> {
  const key = init.key === 'service' ? env.serviceKey : env.anonKey;
  const res = await fetch(`${env.url}${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...init.headers },
  });
  const text = await res.text();
  // Never echo the request (it carries a key); the response body says what went wrong.
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** A confirmed account, as a Google sign-in would leave it (verified email, a full name). */
export async function createAccount(key: string, googleName: string): Promise<Account> {
  const email = `${EMAIL_PREFIX}${key}-${RUN}@example.com`;
  const password = `pw-${randomBytes(12).toString('hex')}`;
  const user = await api<{ id: string }>('/auth/v1/admin/users', {
    key: 'service',
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: googleName } }),
  });
  return { id: user.id, email, password, googleName };
}

/** A session for the account (password grant), in the shape supabase-js stores. */
async function signIn(account: Account): Promise<unknown> {
  return api('/auth/v1/token?grant_type=password', {
    key: 'anon',
    method: 'POST',
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
}

/** Ids of every home in the database (the service role sees them all). */
export async function homeIds(): Promise<string[]> {
  const rows = await api<{ id: string }[]>('/rest/v1/households?select=id', { key: 'service' });
  return rows.map((r) => r.id);
}

/**
 * Removes the homes of this suite's accounts (this run's and any left by an earlier run that
 * stopped half way), then the accounts. Nothing anyone else made is touched.
 */
export async function removeOwnData(): Promise<void> {
  const users: { id: string; email?: string }[] = [];
  for (let page = 1; ; page += 1) {
    const res = await api<{ users: { id: string; email?: string }[] }>(`/auth/v1/admin/users?page=${page}&per_page=200`, {
      key: 'service',
    });
    users.push(...res.users);
    if (res.users.length < 200) break;
  }
  const ours = users.filter((u) => (u.email ?? '').startsWith(EMAIL_PREFIX)).map((u) => u.id);
  if (!ours.length) return;
  const members = await api<{ household_id: string }[]>(
    `/rest/v1/members?select=household_id&user_id=in.(${ours.join(',')})`,
    { key: 'service' },
  );
  const homes = [...new Set(members.map((m) => m.household_id))];
  if (homes.length) {
    await api(`/rest/v1/households?id=in.(${homes.join(',')})`, { key: 'service', method: 'DELETE' });
  }
  for (const id of ours) await api(`/auth/v1/admin/users/${id}`, { key: 'service', method: 'DELETE' });
}

/**
 * Waits until no home exists (the import is only offered, and only accepted, then). The local
 * database is shared with other test runs, which make and remove their own homes.
 */
export async function waitForNoHome(timeoutMs = 90_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const ids = await homeIds();
    if (!ids.length) return;
    if (Date.now() > until) {
      throw new Error(
        `The database holds ${ids.length} home(s) this suite did not make, and bringing a home over needs none. ` +
          'Run the live e2e tests again once the other test runs have finished.',
      );
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

export interface Device {
  context: BrowserContext;
  page: Page;
  /** Console errors and uncaught exceptions seen so far. */
  errors: string[];
  /** Requests (REST, RPC, auth) not answered yet. */
  inFlight: () => number;
}

/**
 * A phone signed in as `account`: a fresh browser context whose storage already holds the
 * session (and, for the phone the demo home lives on, `extra` such as homeos.demo.v1).
 */
export async function openDevice(
  browser: Browser,
  baseURL: string,
  account: Account,
  extra: Record<string, string> = {},
): Promise<Device> {
  const session = await signIn(account);
  const localStorage = [
    { name: AUTH_STORAGE_KEY, value: JSON.stringify(session) },
    ...Object.entries(extra).map(([name, value]) => ({ name, value })),
  ];
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 402, height: 874 },
    deviceScaleFactor: 2,
    hasTouch: true,
    timezoneId: 'Europe/London',
    locale: 'en-GB',
    serviceWorkers: 'block',
    storageState: { cookies: [], origins: [{ origin: new URL(baseURL).origin, localStorage }] },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  const pending = new Set<unknown>();
  page.on('request', (req) => pending.add(req));
  page.on('requestfinished', (req) => pending.delete(req));
  page.on('requestfailed', (req) => pending.delete(req));
  await page.goto('/');
  // Marks this page load: if the page reloads or navigates, the mark is gone (see expectNoReload).
  await page.evaluate(() => {
    (window as unknown as { __homeosLive?: string }).__homeosLive = 'same page';
  });
  return { context, page, errors, inFlight: () => pending.size };
}

/**
 * Waits until the device has had no request open for a moment, so nothing it loads by
 * itself can bring in a change made after this: what shows next came over Realtime.
 */
export async function quiet(device: Device): Promise<void> {
  let since = Date.now();
  await expect
    .poll(
      () => {
        if (device.inFlight() > 0) since = Date.now();
        return Date.now() - since >= 400;
      },
      { timeout: 10_000, intervals: [50] },
    )
    .toBe(true);
}

/** The device never reloaded or navigated since it opened, and nothing went wrong in it. */
export async function expectNoReload(device: Device): Promise<void> {
  expect(await device.page.evaluate(() => (window as unknown as { __homeosLive?: string }).__homeosLive)).toBe(
    'same page',
  );
  expect(device.errors, 'errors in the page').toEqual([]);
}

// ── Screens ──────────────────────────────────────────────

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function homeScreen(page: Page): Locator {
  return page.getByRole('region', { name: 'Home', exact: true });
}

export function statsScreen(page: Page): Locator {
  return page.getByRole('region', { name: 'Stats', exact: true });
}

export function chatScreen(page: Page): Locator {
  return page.getByRole('region', { name: 'Chat', exact: true });
}

export function area(page: Page, name: string): Locator {
  return homeScreen(page).getByRole('region', { name, exact: true });
}

export function areaHeadings(page: Page): Locator {
  return homeScreen(page).getByRole('heading', { level: 2 });
}

/**
 * The part of a Home row that opens the Item sheet, by its accessible name
 * "<title>, <Red|Amber|Green>." or "<title>, <RAG>, to maintain." (then the meta line).
 */
export function itemButton(scope: Locator, title: string): Locator {
  return scope.getByRole('button', { name: new RegExp(`^${escapeRe(title)} ?, (Red|Amber|Green)(, to maintain)?\\.`) });
}

/** The ring that completes a To do. */
export function ring(scope: Locator, title: string): Locator {
  return scope.getByRole('button', { name: `Mark ${title} as done`, exact: true });
}

/** The meta line of a row: `🦔 Shea · Tue 20 Oct`. */
export function meta(scope: Locator, title: string): Locator {
  return itemButton(scope, title).locator('[data-meta]');
}

export function tabs(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Tabs' });
}

export async function goToTab(page: Page, name: 'Home' | 'Chat' | 'Stats'): Promise<void> {
  const tab = tabs(page).getByRole('button', { name: name === 'Chat' ? /^Chat(, unread messages)?$/ : name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-current', 'page');
}

export function chips(page: Page): Locator {
  return homeScreen(page).getByRole('radiogroup', { name: 'Show tasks for' });
}

export function itemSheet(page: Page, kind: 'Edit item' | 'New item' = 'Edit item'): Locator {
  return page.getByRole('dialog', { name: kind });
}

export function profile(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Profile' });
}

export function toast(page: Page, message: string | RegExp): Locator {
  return page.getByRole('status').filter({ hasText: message });
}

/** Waits for a sheet or cover to stop sliding: `control` is on screen, still and takes taps. */
export async function settled(control: Locator): Promise<void> {
  await expect(control).toBeInViewport({ ratio: 1 });
  await control.hover({ trial: true });
}

export async function openItem(page: Page, scope: Locator, title: string): Promise<Locator> {
  await itemButton(scope, title).click();
  const sheet = itemSheet(page);
  await settled(sheet.getByRole('button', { name: 'Close' }));
  return sheet;
}

export async function confirmation(page: Page, title: string): Promise<Locator> {
  const sheet = page.getByRole('alertdialog', { name: title });
  await settled(sheet.getByRole('button').last());
  return sheet;
}

export async function openProfile(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  const dialog = profile(page);
  await settled(dialog.getByRole('button', { name: 'Done' }));
  return dialog;
}

export async function closeProfile(page: Page): Promise<void> {
  const done = profile(page).getByRole('button', { name: 'Done' });
  await settled(done);
  await done.click();
  await expect(profile(page)).toHaveCount(0);
}

/** Profile, then Household inside it. */
export async function openHousehold(page: Page): Promise<Locator> {
  const dialog = await openProfile(page);
  await dialog.getByRole('button', { name: /^Household/ }).click();
  await expect(dialog.getByRole('heading', { name: 'Household', level: 1 })).toBeVisible();
  await settled(dialog.getByRole('button', { name: 'Profile', exact: true }));
  return dialog;
}

/** From Household back to Profile, then closed. */
export async function closeHousehold(page: Page, dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Household', level: 1 })).toHaveCount(0);
  await closeProfile(page);
}

export function people(dialog: Locator): Locator {
  return dialog.getByRole('region', { name: 'People' });
}

export function personRow(dialog: Locator, name: string): Locator {
  return people(dialog).getByRole('button', { name: new RegExp(`^${escapeRe(name)}\\b`) });
}

export async function openPersonPage(dialog: Locator, name: string): Promise<void> {
  await personRow(dialog, name).click();
  await expect(dialog.getByRole('heading', { name, level: 1 })).toBeVisible();
  await settled(dialog.getByRole('button', { name: 'Household', exact: true }));
}

/** The notifications step after creating, importing or joining: on to Home. */
export async function finishSetup(page: Page): Promise<void> {
  const step = page.getByRole('region', { name: /^(You're all set|Notifications|Add to Home Screen)$/ });
  await expect(step).toBeVisible();
  const notNow = step.getByRole('button', { name: 'Not Now' });
  await (await notNow.count() ? notNow : step.getByRole('button', { name: 'Continue' })).click();
  await expect(homeScreen(page).getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
}

/** "Fri 16 Oct" for 2026-10-16 (the app's day format, en-GB). */
export function dayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  const rest = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${weekday} ${rest}`;
}

/** Today in London as YYYY-MM-DD, plus `days`. */
export function londonDate(days = 0): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
