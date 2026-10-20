import { expect, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { API_HEADER, API_HEADER_VALUE, API_PATH } from '../src/lib/backend/serverApi';
import { ragWord } from '../src/lib/constants';
import { USER_DEMO_DOC } from '../src/lib/logic/importHome.fixture';
import { relativeDue } from '../src/lib/logic/upNext';
import type { HouseholdData, Rag } from '../src/lib/types';

// Helpers for the server-mode e2e suite (playwright.server.config.ts; docs/ARCHITECTURE.md
// "Server mode (no setup)", "Local server and tests"). Each person is their own browser
// context, signed in with a code the way a phone would be: by the screens, or (to start a
// test quickly) by the same API calls through the context's own cookie jar.

/** HOMEOS_SETUP_CODE of the local server the suite runs (playwright.server.config.ts). */
export const SETUP_CODE = 'TEST-SETU-PCDE-2345-6789';

/** CRON_SECRET of the local server the suite runs (playwright.server.config.ts): the morning run's. */
export const CRON_SECRET = 'e2e-cron-secret-not-a-real-one';

/** How long a change on one phone may take to show on another (a 3 s poll, the debounce, the load). */
export const SYNC_MS = 5_000;

/** Where the demo backend keeps the phone's home. */
export const DEMO_DOC_KEY = 'homeos.demo.v1';

/** The user's home as their phone kept it in demo mode (Stratis, Shea, Ela; 6 areas, 19 open items). */
export const PHONE_DOC = USER_DEMO_DOC;

const JSON_HEADERS = { [API_HEADER]: API_HEADER_VALUE, 'Content-Type': 'application/json' };

/** Wipes the local server's store, cache and attempt limits (--allow-reset). */
export async function resetServer(request: APIRequestContext): Promise<void> {
  const res = await request.post('/__homeos/reset', { headers: { [API_HEADER]: API_HEADER_VALUE } });
  expect(res.status(), 'reset the local server').toBe(200);
}

async function api<T>(request: APIRequestContext, body: Record<string, unknown>): Promise<T> {
  const res = await request.post(API_PATH, { headers: JSON_HEADERS, data: body });
  const text = await res.text();
  if (!res.ok()) throw new Error(`${String(body.op)}: HTTP ${res.status()} ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

async function apiGet<T>(request: APIRequestContext, op: string): Promise<T> {
  const res = await request.get(`${API_PATH}?op=${op}`, { headers: { [API_HEADER]: API_HEADER_VALUE } });
  const text = await res.text();
  if (!res.ok()) throw new Error(`${op}: HTTP ${res.status()} ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

/** The home as `context`'s person sees it (the app's own load, through the API). */
export async function loadHome(context: BrowserContext): Promise<HouseholdData> {
  const { result: id } = await api<{ result: string }>(context.request, { op: 'rpc', method: 'getMyHouseholdId', args: [] });
  const { result } = await api<{ result: HouseholdData }>(context.request, { op: 'rpc', method: 'load', args: [id] });
  return result;
}

/** A fresh code for the person called `name`, made by `context`'s person ("Invite Shea"). */
export async function codeFor(context: BrowserContext, name: string): Promise<string> {
  const data = await loadHome(context);
  const member = data.members.find((m) => m.name === name);
  if (!member) throw new Error(`nobody called ${name} in the home`);
  const { code } = await api<{ code: string }>(context.request, { op: 'createCode', memberId: member.id });
  return code;
}

/** The ids and labels of the devices signed in to the home. */
export async function devicesOf(context: BrowserContext): Promise<{ id: string; memberId: string; current: boolean }[]> {
  const { devices } = await apiGet<{ devices: { id: string; memberId: string; current: boolean }[] }>(context.request, 'devices');
  return devices;
}

/** The home's rev and chatRev now (GET version, as `context`'s person). */
export async function version(context: BrowserContext): Promise<{ rev: number; chatRev: number }> {
  return apiGet(context.request, 'version');
}

export interface Device {
  context: BrowserContext;
  page: Page;
  /** Console errors and uncaught exceptions seen so far (a signed-out session check's 401 is not one). */
  errors: string[];
  /** Requests not answered yet. */
  inFlight: () => number;
}

export interface DeviceOptions {
  /** What this browser keeps in localStorage before the app loads (the phone's demo home, say). */
  localStorage?: Record<string, string>;
  /** Signs this browser in before the app loads: 'setup' brings the home online as the phone's owner; a code redeems it. */
  signIn?: { setup: string } | { code: string };
  /** Where the app opens (a link). */
  path?: string;
  viewport?: { width: number; height: number };
  /** The browser's user agent (an iPhone's Safari, say); default Chromium's. */
  userAgent?: string;
  /**
   * Someone is looking at this phone (default true): a harmless input event every 20 s, so a
   * phone that only watches another's changes keeps polling at its usual pace (ServerBackend
   * slows to a poll a minute after 3 minutes without input). False: left alone, as on a stand.
   */
  inUse?: boolean;
}

/** Safari on an iPhone, as a ?code= link from Messages opens it. */
export const IPHONE_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/**
 * A phone: a fresh browser context (its own cookies and storage), opened at `path`. With
 * `signIn` it is signed in first through its own cookie jar, as the screens would leave it.
 */
export async function openDevice(browser: Browser, baseURL: string, opts: DeviceOptions = {}): Promise<Device> {
  const origin = new URL(baseURL).origin;
  const context = await browser.newContext({
    baseURL,
    viewport: opts.viewport ?? { width: 402, height: 874 },
    deviceScaleFactor: 2,
    hasTouch: true,
    timezoneId: 'Europe/London',
    locale: 'en-GB',
    serviceWorkers: 'block',
    ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
    storageState: {
      cookies: [],
      origins: [{ origin, localStorage: Object.entries(opts.localStorage ?? {}).map(([name, value]) => ({ name, value })) }],
    },
  });
  if (opts.inUse !== false) {
    // A wheel event with no movement: nothing on the page reacts to it but the poller.
    await context.addInitScript(() => {
      setInterval(() => window.dispatchEvent(new WheelEvent('wheel')), 20_000);
    });
  }
  if (opts.signIn && 'setup' in opts.signIn) {
    const phone = opts.localStorage?.[DEMO_DOC_KEY] ?? JSON.stringify(PHONE_DOC);
    await api(context.request, { op: 'setup', code: opts.signIn.setup, phone });
  } else if (opts.signIn) {
    await api(context.request, { op: 'redeem', code: opts.signIn.code });
  }
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    // The browser logs every 4xx: a signed-out session check (401), a refused code (400) or a
    // limit (429) are answers the app expects and shows.
    if (/status of (400|401|429)\b/.test(msg.text())) return;
    errors.push(`console.error: ${msg.text()}`);
  });
  const pending = new Set<unknown>();
  page.on('request', (req) => pending.add(req));
  page.on('requestfinished', (req) => pending.delete(req));
  page.on('requestfailed', (req) => pending.delete(req));
  await page.goto(opts.path ?? '/');
  // Marks this page load: if the page reloads or navigates, the mark is gone (see expectNoReload).
  await page.evaluate(() => {
    (window as unknown as { __homeosE2e?: string }).__homeosE2e = 'same page';
  });
  return { context, page, errors, inFlight: () => pending.size };
}

/**
 * Stratis's phone with the home online (brought online through the API from his phone's demo
 * home), and Shea's phone signed in with a code Stratis made, both on Home.
 */
export async function stratisAndShea(browser: Browser, baseURL: string): Promise<{ stratis: Device; shea: Device }> {
  const stratis = await openDevice(browser, baseURL, {
    localStorage: { [DEMO_DOC_KEY]: JSON.stringify(PHONE_DOC) },
    signIn: { setup: SETUP_CODE },
  });
  await expect(homeHeading(stratis.page)).toBeVisible();
  const shea = await openDevice(browser, baseURL, { signIn: { code: await codeFor(stratis.context, 'Shea') } });
  await expect(homeHeading(shea.page)).toBeVisible();
  // Stratis's phone hears that she joined.
  await expectPerson(stratis.page, /^Shea, \d+ items?$/, SYNC_MS);
  return { stratis, shea };
}

/**
 * Waits until the device has had no request open for a moment, so what shows next on it came
 * from a later poll, not from something it was already loading.
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
  expect(await device.page.evaluate(() => (window as unknown as { __homeosE2e?: string }).__homeosE2e)).toBe('same page');
  expect(device.errors, 'errors in the page').toEqual([]);
}

// ── Screens ──────────────────────────────────────────────

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function homeScreen(page: Page): Locator {
  return page.getByRole('region', { name: 'Home', exact: true });
}

export function homeHeading(page: Page): Locator {
  return homeScreen(page).getByRole('heading', { name: 'Home', level: 1 });
}

/** The Needs attention tab (not its own Needs attention group, a region of that name inside it). */
export function attentionScreen(page: Page): Locator {
  return page.getByRole('region', { name: 'Needs attention', exact: true }).first();
}

export function chatScreen(page: Page): Locator {
  return page.getByRole('region', { name: 'Chat', exact: true });
}

export function housekeepingScreen(page: Page): Locator {
  return page.getByRole('region', { name: 'Housekeeping', exact: true });
}

export function statsScreen(page: Page): Locator {
  return page.getByRole('region', { name: 'Stats', exact: true });
}

/** Every area these tests meet, so a card is found by its own name, not by a longer one that starts the same. */
const AREA_NAMES = [
  ...PHONE_DOC.areas.map((a) => a.name),
  'Bathroom Large',
  'Bedroom Small',
  'Bedroom Large',
  'Hallway',
  'Front garden',
  'Shed',
  'Garden Shed',
];

/** A card's name starts with its area's ("Garden", and not "Garden Lounge"). */
function cardName(name: string): RegExp {
  const longer = AREA_NAMES.filter((n) => n !== name && n.startsWith(name)).map((n) => escapeRe(n.slice(name.length)));
  return new RegExp(`^${escapeRe(name)}${longer.length ? `(?!${longer.join('|')})` : ''}`);
}

/** Home's grid of areas: one list item a card. */
export function areaCards(page: Page): Locator {
  return homeScreen(page).getByRole('list', { name: 'Areas' }).getByRole('listitem');
}

/** An area's card on Home: one button, named first by its area, then how it is, its count and who looks after it. */
export function areaCard(page: Page, name: string): Locator {
  return homeScreen(page).getByRole('list', { name: 'Areas' }).getByRole('button', { name: cardName(name) });
}

/**
 * Home's cards are these areas, in this order, within `timeout` (another phone's change takes a
 * poll). Goes to Home first (an area's sheet closed).
 */
export async function expectAreas(page: Page, names: readonly string[], timeout = 5_000): Promise<void> {
  await toTab(page, 'Home');
  await expect(async () => {
    await expect(areaCards(page)).toHaveCount(names.length, { timeout: 1_000 });
    for (const [i, name] of names.entries()) {
      await expect(areaCards(page).nth(i).getByRole('button'), name).toHaveAccessibleName(cardName(name), { timeout: 1_000 });
    }
  }).toPass({ timeout });
}

/** An area's sheet, named by the area (open it with inArea()). */
export function area(page: Page, name: string): Locator {
  return page.getByRole('dialog', { name, exact: true });
}

/** The area's sheet that is open, whichever it is. */
export function areas(page: Page): Locator {
  return page.locator('[role="dialog"]:has([data-area-sheet])');
}

/**
 * The area's sheet, opened from its card on Home unless it is open already (another area's
 * sheet closed first, and Home's tab opened); with `all`, its To do list unfolded ("Show 2
 * more"). Resolves to the sheet, which stays open and follows the home as it changes.
 */
export async function inArea(page: Page, name: string, opts: { all?: boolean } = {}): Promise<Locator> {
  const sheet = area(page, name);
  if (!(await sheet.count())) {
    await toTab(page, 'Home');
    await areaCard(page, name).click();
    await settled(sheet.getByRole('button', { name: 'Close', exact: true }));
  }
  if (opts.all) {
    const more = sheet.getByRole('button', { name: /^Show \d+ more$/ });
    if (await more.count()) await more.click();
  }
  return sheet;
}

/** Closes the open area's sheet with its Close button. */
export async function closeArea(page: Page): Promise<void> {
  const sheet = areas(page);
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

/** The words for how urgent a To do is, and for the condition of a thing looked after. */
const RAG_WORDS = 'Urgent|Within the month|Not urgent|Needs work|Okay|Good';

/**
 * The part of a row that opens the Item sheet, named "<title>, <how urgent>, ..." or
 * "<title>, to maintain, <condition>, ..." (Chromium puts a space before the first comma).
 */
export function itemButton(scope: Locator, title: string): Locator {
  return scope.getByRole('button', { name: new RegExp(`^${escapeRe(title)} ?, (to maintain, )?(${RAG_WORDS}),`) });
}

/** An item's row in its area's sheet (open it with inArea() first: a closed sheet has no rows). */
export function rowFor(page: Page, title: string, areaName: string): Locator {
  return itemButton(area(page, areaName), title);
}

/** The ring that completes a To do. */
export function ring(scope: Locator, title: string): Locator {
  return scope.getByRole('button', { name: `Mark ${title} as done`, exact: true });
}

/** The quiet line under a row's title: `Not urgent·In 6 days`, how urgent in words and when. */
export function meta(scope: Locator, title: string): Locator {
  return itemButton(scope, title).locator('[data-meta]');
}

/** Who a row is for, at the end of its title's line: `🦔Shea` (none when nobody has it). */
export function who(scope: Locator, title: string): Locator {
  return itemButton(scope, title).locator('[data-who]');
}

/**
 * A To do row's quiet line as its area's sheet shows it today: its urgency in words, then when it is due
 * ("Not urgent·In 6 days", "Within the month·In 4 days", "Urgent2 days late": quiet words take
 * a dot after them, Urgent is a pill).
 */
export function taskMeta(rag: Rag, due: string): string {
  return `${ragWord('task', rag)}${rag === 'red' ? '' : '·'}${relativeDue(due, londonDate())!.text}`;
}

export function tabs(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Tabs' });
}

export type TabName = 'Home' | 'Attention' | 'Chat' | 'Housekeeping' | 'Stats';

const TAB_NAMES: TabName[] = ['Home', 'Attention', 'Chat', 'Housekeeping', 'Stats'];

/** A tab in the tab bar, named with its count or dot after it ("Attention, 2 items", "Chat, unread messages"). */
export function tabButton(page: Page, name: TabName): Locator {
  return tabs(page).getByRole('button', { name: new RegExp(`^${name}(,.*)?$`) });
}

/** Opens a tab (an area's sheet closed first: the tab bar is behind it). */
export async function goToTab(page: Page, name: TabName): Promise<void> {
  if (await areas(page).count()) await closeArea(page);
  const tab = tabButton(page, name);
  await tab.click();
  await expect(tab).toHaveAttribute('aria-current', 'page');
}

/** The tab that is open. */
async function openTab(page: Page): Promise<TabName> {
  for (const name of TAB_NAMES) if ((await tabButton(page, name).getAttribute('aria-current')) === 'page') return name;
  throw new Error('No tab is open');
}

/** Opens a tab unless it is open already (an area's sheet closed first). */
async function toTab(page: Page, name: TabName): Promise<void> {
  if (await areas(page).count()) await closeArea(page);
  if ((await openTab(page)) !== name) await goToTab(page, name);
}

/** Needs attention's people menu button, "Show tasks for: Everyone" (or whoever is chosen). */
export function peopleButton(page: Page): Locator {
  return attentionScreen(page).getByRole('button', { name: /^Show tasks for: / });
}

/** Mine, on Needs attention: one tap for only your items. */
export function mine(page: Page): Locator {
  return attentionScreen(page).getByRole('button', { name: 'Mine', exact: true });
}

/** Opens Needs attention's people menu (that tab opened first, if it isn't open); resolves to it. */
export async function peopleMenu(page: Page): Promise<Locator> {
  const menu = page.getByRole('menu', { name: 'Show tasks for' });
  if (!(await menu.isVisible())) {
    await toTab(page, 'Attention');
    await peopleButton(page).click();
  }
  await expect(menu).toBeVisible();
  return menu;
}

/** Looks in the people menu, then closes it and goes back to the tab the phone was on. */
async function lookInPeopleMenu<T>(page: Page, look: (menu: Locator) => Promise<T>): Promise<T> {
  const was = await openTab(page);
  const menu = await peopleMenu(page);
  try {
    return await look(menu);
  } finally {
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    if (was !== 'Attention') await goToTab(page, was);
  }
}

/**
 * Someone in the people menu, named as VoiceOver hears them ("Shea, 3 items", "Kim, 0 items,
 * not joined yet"), within `timeout` (another phone's change takes a poll); then the menu
 * closes and the phone goes back to the tab it was on (an area's sheet is closed).
 */
export async function expectPerson(page: Page, name: string | RegExp, timeout?: number): Promise<void> {
  await lookInPeopleMenu(page, (menu) =>
    expect(menu.getByRole('menuitemradio', { name, exact: typeof name === 'string' })).toBeVisible({ timeout }),
  );
}

/** Chooses whose items Needs attention shows from the people menu (and stays there). */
export async function chooseWho(page: Page, name: string | RegExp): Promise<void> {
  const menu = await peopleMenu(page);
  await menu.getByRole('menuitemradio', { name, exact: typeof name === 'string' }).click();
  await expect(menu).toHaveCount(0);
}

/** The labels of everyone in the people menu, top to bottom; then as expectPerson() leaves it. */
export async function peopleInMenu(page: Page): Promise<string[]> {
  return lookInPeopleMenu(page, (menu) =>
    menu.getByRole('menuitemradio').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? '')),
  );
}

/**
 * Needs attention's list with Later unfolded: every open item in the home (for whoever the
 * people menu shows), one row or tile each. Resolves to the rows.
 */
export async function showAllRows(page: Page): Promise<Locator> {
  await toTab(page, 'Attention');
  const screen = attentionScreen(page);
  const list = screen.getByRole('radio', { name: 'List', exact: true });
  if (!(await list.isChecked())) await list.click();
  const more = screen.getByRole('button', { name: /^Show \d+ more$/ });
  while ((await more.count()) > 0) await more.first().click();
  return screen.locator('[data-item-open]');
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

/** Opens Profile (an area's sheet closed first: Profile's button is behind it). */
export async function openProfile(page: Page): Promise<Locator> {
  if (await areas(page).count()) await closeArea(page);
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

/** The Welcome screen when this browser has no key: the hero, then "This home is private." and the code field. */
export function welcome(page: Page): Locator {
  return page.getByRole('region', { name: 'Welcome to home.os', exact: true });
}

export function codeField(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Have a code?' });
}

/** The Welcome screen opens on Create Account when a home is online: "Have a code?" shows the code field. */
export async function openCodes(page: Page): Promise<void> {
  const button = welcome(page).getByRole('button', { name: 'Have a code?' });
  await expect(codeField(page).or(button)).toBeVisible({ timeout: SYNC_MS });
  if (await button.isVisible()) await button.click();
}

/** The code sheet ("Code for Shea", "Code for another device"). */
export function codeSheet(page: Page, title: string): Locator {
  return page.getByRole('dialog', { name: title });
}

/** The code the code sheet shows, as "ABCD-EFGH". */
export async function shownCode(sheet: Locator): Promise<string> {
  const text = (await sheet.locator('[aria-hidden="true"]').filter({ hasText: /^[0-9A-Z]{4}-[0-9A-Z]{4}$/ }).textContent()) ?? '';
  expect(text).toMatch(/^[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/);
  return text;
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

/**
 * Needs attention's list (one list of cards since round 3; showAllRows() above is from its
 * List / Calendar days): every card it shows for whoever the people menu shows, which is
 * every open item but the things looked after that are Good. Resolves to the cards' buttons.
 */
export async function showAllCards(page: Page): Promise<Locator> {
  await toTab(page, 'Attention');
  return attentionScreen(page).locator('[data-attention-list] [data-item-open]');
}
