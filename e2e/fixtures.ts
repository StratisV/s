import { expect, test as base, type Locator, type Page } from '@playwright/test';

/** Thu 8 Oct 2026, 10:00 in London: the day the household's notes list was captured. */
export const NOW = new Date('2026-10-08T10:00:00+01:00');

/** The seeded areas, in the household's order (design/README.md "Seed data"). */
export const DEFAULT_AREAS = [
  'Kitchen',
  'Living Room',
  'Bathroom Small',
  'Bathroom Large',
  'Bedroom Small',
  'Bedroom Large',
  'Garden',
  'Garden Lounge',
  'Jacuzzi',
  'Hallway',
  'Front garden',
];

/** Every test starts at NOW (time keeps flowing from there) in Europe/London. */
export const test = base.extend({
  page: async ({ page }, use) => {
    // Uncaught exceptions and console errors fail the test.
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    await page.clock.install({ time: NOW });
    await use(page);
    expect(errors, 'errors in the page').toEqual([]);
  },
});

export { expect };
export type { Locator, Page };

/** Home's three views, as the view switch names them. */
export type HomeViewName = 'Up next' | 'Rooms' | 'Calendar';

/**
 * Signed in as Stratis in the prototype household (Shea, Ela, seeded items and history). Most
 * tests are about the rooms and their rows, so Home is switched to its Rooms view (the phone
 * then remembers it) unless `view` says otherwise; Up next is what Home opens on at first.
 */
export async function openSeeded(page: Page, view: HomeViewName = 'Rooms'): Promise<void> {
  await page.goto('/?demo-seed=1');
  await expect(homeScreen(page).getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  if (view !== 'Up next') await showView(page, view);
}

/** The view switch under Home's summary sentence (a radio group "View"). */
export function views(page: Page): Locator {
  return homeScreen(page).getByRole('radiogroup', { name: 'View' });
}

/** Chooses one of Home's views. */
export async function showView(page: Page, name: HomeViewName): Promise<void> {
  const radio = views(page).getByRole('radio', { name, exact: true });
  await radio.click();
  await expect(radio).toHaveAttribute('aria-checked', 'true');
}

/** Home's one sentence on what needs doing. */
export function summary(page: Page): Locator {
  return homeScreen(page).locator('[data-home-summary]');
}

/** A group of Up next ('attention', 'today', 'week', 'later', 'looking'). */
export function group(page: Page, id: 'attention' | 'today' | 'week' | 'later' | 'looking'): Locator {
  return homeScreen(page).locator(`section[data-group="${id}"]`);
}

/** Mine: one tap for only your items. */
export function mine(page: Page): Locator {
  return homeScreen(page).getByRole('button', { name: 'Mine', exact: true });
}

/** The people menu's button, "Show tasks for: Everyone" (or whoever is chosen). */
export function peopleButton(page: Page): Locator {
  return homeScreen(page).getByRole('button', { name: /^Show tasks for: / });
}

/** Chooses whose items Home shows from the people menu ("Everyone", "Shea", "Unassigned"...). */
export async function chooseWho(page: Page, name: RegExp): Promise<void> {
  await peopleButton(page).click();
  await page.getByRole('menu', { name: 'Show tasks for' }).getByRole('menuitemradio', { name }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}

/**
 * Opens a room's "..." menu; resolves to the menu. A scroll closes a menu, so while rooms are
 * still folding (the page shrinking under it) it may take a second tap.
 */
export async function openRoomMenu(page: Page, room: string): Promise<Locator> {
  const button = homeScreen(page).getByRole('button', { name: `${room} options`, exact: true });
  const menu = page.getByRole('menu', { name: room, exact: true });
  await expect(async () => {
    if (!(await menu.isVisible())) await button.click();
    await expect(menu).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return menu;
}

/** Chooses `item` in a room's "..." menu ("Add item to Garden", "Share Room"). */
export async function roomMenu(page: Page, room: string, item: string): Promise<void> {
  const menu = await openRoomMenu(page, room);
  await menu.getByRole('menuitem', { name: item, exact: true }).click();
}

/** Signed out with nothing stored. */
export async function openFresh(page: Page): Promise<void> {
  await page.goto('/?demo-reset=1');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
}

/** Back to the app without the demo switches (keeps what is stored). */
export async function reopen(page: Page): Promise<void> {
  await page.goto('/');
}

/** Where the demo backend keeps its data (src/lib/backend/demo.ts). */
export const DEMO_STORAGE_KEY = 'homeos.demo.v1';

/**
 * Leaves only the named areas (and their items) in the stored demo household, then
 * reopens the app. An empty list gives a household without areas, a state one person
 * can't reach through the UI (the last area can't be deleted) but two people can.
 */
export async function keepOnlyAreas(page: Page, names: string[]): Promise<void> {
  await page.evaluate(
    ([key, keep]) => {
      const doc = JSON.parse(localStorage.getItem(key)!);
      const ids = new Set(doc.areas.filter((a: { name: string }) => keep.includes(a.name)).map((a: { id: string }) => a.id));
      doc.areas = doc.areas.filter((a: { id: string }) => ids.has(a.id));
      doc.items = doc.items.filter((i: { area_id: string }) => ids.has(i.area_id));
      localStorage.setItem(key, JSON.stringify(doc));
    },
    [DEMO_STORAGE_KEY, names] as const,
  );
  await reopen(page);
}

export function homeScreen(page: Page): Locator {
  return page.getByRole('region', { name: 'Home', exact: true });
}

export function statsScreen(page: Page): Locator {
  return page.getByRole('region', { name: 'Stats', exact: true });
}

export function chatScreen(page: Page): Locator {
  return page.getByRole('region', { name: 'Chat', exact: true });
}

export function housekeepingScreen(page: Page): Locator {
  return page.getByRole('region', { name: 'Housekeeping', exact: true });
}

export type TabName = 'Home' | 'Chat' | 'Housekeeping' | 'Stats';

export function tabs(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Tabs' });
}

/** The round + floating at the bottom right on Home and Stats. */
export function addButton(page: Page): Locator {
  return page.getByRole('button', { name: 'New item', exact: true });
}

/**
 * A tab button. Chat is named "Chat, unread messages" while it has its dot, Housekeeping
 * "Housekeeping, new message" while it has its.
 */
export function tabButton(page: Page, name: TabName): Locator {
  const dotted = { Chat: /^Chat(, unread messages)?$/, Housekeeping: /^Housekeeping(, new message)?$/ } as const;
  return tabs(page).getByRole('button', { name: name === 'Chat' || name === 'Housekeeping' ? dotted[name] : name, exact: true });
}

export async function goToTab(page: Page, name: TabName): Promise<void> {
  await tabButton(page, name).click();
  await expect(tabButton(page, name)).toHaveAttribute('aria-current', 'page');
}

/** An area section on Home. */
export function area(page: Page, name: string): Locator {
  return homeScreen(page).getByRole('region', { name, exact: true });
}

/** Home's areas (not the calendar above them, whose chosen day lists rows of its own). */
export function areas(page: Page): Locator {
  return homeScreen(page).locator('section[data-area-id]');
}

/** Area names on Home, top to bottom. */
export function areaHeadings(page: Page): Locator {
  return areas(page).getByRole('heading', { level: 2 });
}

/** The status ring that completes an item, in its area. */
export function ring(page: Page, title: string): Locator {
  return areas(page).getByRole('button', { name: `Mark ${title} as done`, exact: true });
}

/** A Home row in its area (ring + title, note, meta). */
export function row(page: Page, title: string): Locator {
  const ringButton = page.getByRole('button', { name: `Mark ${title} as done`, exact: true });
  return areas(page).getByRole('listitem').filter({ has: ringButton });
}

/** Home's calendar section, its own view (the week strip or the month, and the chosen day under it). */
export function calendar(page: Page): Locator {
  return homeScreen(page).locator('section[data-calendar]');
}

/** The part of a row that opens the Item sheet. */
export function rowButton(page: Page, title: string): Locator {
  return row(page, title).getByRole('button').nth(1);
}

/** Item titles in an area, top to bottom. */
export async function titlesIn(page: Page, areaName: string): Promise<string[]> {
  const rings = area(page, areaName).getByRole('button', { name: /^Mark .* as done$/ });
  const labels = await rings.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
  return labels.map((l) => l.replace(/^Mark /, '').replace(/ as done$/, ''));
}

/** The quiet line under a row's title: `Within the month·In 6 days`, its urgency in words and when. */
export function meta(page: Page, title: string): Locator {
  return rowButton(page, title).locator('[data-meta]');
}

/** Who a row is for, at the end of its title's line: `🦆 Shea` (their emoji and first name). */
export function who(page: Page, title: string): Locator {
  return rowButton(page, title).locator('[data-who]');
}

/** The undo / error toast showing `message`. */
export function toast(page: Page, message: string | RegExp): Locator {
  return page.getByRole('status').filter({ hasText: message });
}

export function itemSheet(page: Page, kind: 'Edit item' | 'New item' = 'Edit item'): Locator {
  return page.getByRole('dialog', { name: kind });
}

export function profile(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Profile' });
}

/**
 * Waits for a sheet or cover to finish sliding in: `control` is fully on screen, has
 * stopped moving and takes taps. Tapping during the slide can miss (the target moves
 * between press and release).
 */
export async function settled(control: Locator): Promise<void> {
  await expect(control).toBeInViewport({ ratio: 1 });
  await control.hover({ trial: true });
}

/** Opens an item from its Home row; resolves once the sheet is in place. */
export async function openItem(page: Page, title: string): Promise<Locator> {
  await rowButton(page, title).click();
  const sheet = itemSheet(page);
  await settled(sheet.getByRole('button', { name: 'Close' }));
  return sheet;
}

/** The + button; resolves once the new-item sheet is in place. */
export async function openNewItem(page: Page): Promise<Locator> {
  await addButton(page).click();
  const sheet = itemSheet(page, 'New item');
  await settled(sheet.getByRole('button', { name: 'Close' }));
  return sheet;
}

/** An action sheet (confirmation) once it has slid up. */
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

/** The value shown on the right of a row in the Item sheet's details card. */
export function detailValue(sheet: Locator, label: string): Locator {
  return sheet.getByLabel(label, { exact: true }).locator('xpath=..').locator('span[aria-hidden="true"]');
}
