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

/**
 * Signed in as Stratis in the prototype household (Shea, Ela, seeded items, history and this
 * week's goals), on Home: the hero, the sentence, a card for each area.
 */
export async function openSeeded(page: Page): Promise<void> {
  await page.goto('/?demo-seed=1');
  // The phone reopens on the tab last open: back to Home.
  await expect(tabs(page)).toBeVisible();
  if ((await tabButton(page, 'Home').getAttribute('aria-current')) !== 'page') await goToTab(page, 'Home');
  await expect(homeScreen(page).getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
}

/** Home's one sentence on what needs doing across the house (plain words, not a button). */
export function homeSummary(page: Page): Locator {
  return homeScreen(page).locator('[data-home-summary]');
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The accessible name of an area's card: it starts with the area's name (the agreed contract:
 * then its state, how many To dos and who). Not one of a longer name that starts the same
 * ("Garden" is not "Garden Lounge").
 */
export function cardName(name: string, all: readonly string[] = DEFAULT_AREAS): RegExp {
  const longer = all.filter((n) => n !== name && n.startsWith(name)).map((n) => escapeRe(n.slice(name.length)));
  return new RegExp(`^${escapeRe(name)}${longer.length ? `(?!${longer.join('|')})` : ''}`);
}

/** Home's grid of areas: one list item a card. */
export function areaCards(page: Page): Locator {
  return homeScreen(page).getByRole('list', { name: 'Areas' }).getByRole('listitem');
}

/** An area's card on Home: one button, named first by its area. */
export function areaCard(page: Page, name: string, all?: readonly string[]): Locator {
  return homeScreen(page).getByRole('list', { name: 'Areas' }).getByRole('button', { name: cardName(name, all) });
}

/** The cards on Home are these areas, in this order. */
export async function expectAreas(page: Page, names: readonly string[]): Promise<void> {
  await expect(areaCards(page)).toHaveCount(names.length);
  for (const [i, name] of names.entries()) {
    await expect(areaCards(page).nth(i).getByRole('button'), name).toHaveAccessibleName(cardName(name, names));
  }
}

/** Opens an area's sheet from its card on Home; resolves once the sheet is in place. */
export async function openArea(page: Page, name: string, all?: readonly string[]): Promise<Locator> {
  await areaCard(page, name, all).click();
  const sheet = area(page, name);
  await settled(sheet.getByRole('button', { name: 'Close', exact: true }));
  return sheet;
}

/** Closes the open area's sheet with its Close button. */
export async function closeArea(page: Page): Promise<void> {
  const sheet = areas(page);
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

/** An area's sheet's Add Item ("Add item to Garden") or Share Room. */
export function areaAction(page: Page, name: string, action: 'Add Item' | 'Share Room'): Locator {
  return area(page, name).getByRole('button', { name: action === 'Add Item' ? `Add item to ${name}` : 'Share Room', exact: true });
}

/** An area's state in its sheet ("1 needs attention", "1 coming up", "All good"). */
export function areaStatus(page: Page, name: string): Locator {
  return area(page, name).locator('[data-area-status]');
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

export function housekeepingScreen(page: Page): Locator {
  return page.getByRole('region', { name: 'Housekeeping', exact: true });
}

export type TabName = 'Home' | 'Goals' | 'Housekeeping' | 'Stats';

export function tabs(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Tabs' });
}

/** The round + floating over the tab bar on Home and Stats. */
export function addButton(page: Page): Locator {
  return page.getByRole('button', { name: 'New item', exact: true });
}

/**
 * A tab button. Goals is named "Goals, 2 not done" while this week has goals not done,
 * Housekeeping "Housekeeping, new message" while it has its dot.
 */
export function tabButton(page: Page, name: TabName): Locator {
  const named = {
    Goals: /^Goals(, \d+ not done)?$/,
    Housekeeping: /^Housekeeping(, new message)?$/,
  } as const;
  return tabs(page).getByRole('button', { name: name in named ? named[name as keyof typeof named] : name, exact: true });
}

export async function goToTab(page: Page, name: TabName): Promise<void> {
  await tabButton(page, name).click();
  await expect(tabButton(page, name)).toHaveAttribute('aria-current', 'page');
}

/** An area's sheet (open from its card), named by its area. */
export function area(page: Page, name: string): Locator {
  return page.getByRole('dialog', { name, exact: true });
}

/** The area sheet that is open (its rows). */
export function areas(page: Page): Locator {
  return page.locator('[role="dialog"]:has([data-area-sheet])');
}

/** The status ring that completes an item, in the open area's sheet. */
export function ring(page: Page, title: string): Locator {
  return areas(page).getByRole('button', { name: `Mark ${title} as done`, exact: true });
}

/** A row in the open area's sheet (ring + title, meta). */
export function row(page: Page, title: string): Locator {
  const ringButton = page.getByRole('button', { name: `Mark ${title} as done`, exact: true });
  return areas(page).getByRole('listitem').filter({ has: ringButton });
}

/** The part of a row that opens the Item sheet. */
export function rowButton(page: Page, title: string): Locator {
  return row(page, title).getByRole('button').nth(1);
}

/** Item titles in an area's sheet (open), To dos top to bottom. */
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
  if (!(await row(page, title).count())) await showItem(page, title);
  await rowButton(page, title).click();
  const sheet = itemSheet(page);
  await settled(sheet.getByRole('button', { name: 'Close' }));
  return sheet;
}

/**
 * Opens the sheet of the area an open item is in (found in the stored demo household), from
 * Home, closing another area's sheet first; resolves to it. Its rows then answer ring(),
 * row(), meta() and who().
 */
export async function showItem(page: Page, title: string): Promise<Locator> {
  const found = await page.evaluate(
    ([key, wanted]) => {
      const doc = JSON.parse(localStorage.getItem(key)!);
      const item = doc.items.find((i: { title: string; status: string }) => i.title === wanted && i.status === 'open');
      const areas = [...doc.areas].sort((a: { position: number }, b: { position: number }) => a.position - b.position);
      return {
        name: item ? (areas.find((a: { id: string }) => a.id === item.area_id)?.name ?? null) : null,
        all: areas.map((a: { name: string }) => a.name as string),
      };
    },
    [DEMO_STORAGE_KEY, title] as const,
  );
  if (!found.name) throw new Error(`No open item called ${title}`);
  const sheet = area(page, found.name);
  if (await sheet.count()) return sheet;
  if (await areas(page).count()) await closeArea(page);
  if ((await tabButton(page, 'Home').getAttribute('aria-current')) !== 'page') await goToTab(page, 'Home');
  return openArea(page, found.name, found.all);
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

// ── The areas' status lines ──────

/** An area's status lines in its sheet ("1 urgent task", "2 non-urgent tasks", "All good"). */
export function areaStatusLines(page: Page, name: string): Locator {
  return area(page, name).locator('[data-area-status] [data-tone]');
}

/** An area's status lines on its card on Home. */
export function cardStatusLines(page: Page, name: string, all?: readonly string[]): Locator {
  return areaCard(page, name, all).locator('[data-tone]');
}

// ── Goals for the week ──────

/** The Goals tab. */
export function goalsScreen(page: Page): Locator {
  return page.getByRole('region', { name: 'Goals for the week', exact: true });
}

/** Goes to the Goals tab; resolves once it shows a week. */
export async function openGoals(page: Page): Promise<void> {
  await goToTab(page, 'Goals');
  await expect(goalsScreen(page).getByRole('heading', { name: 'Goals for the week', level: 1 })).toBeVisible();
}

/** The card of the week shown (its name a level 2 heading: "This week, 5 to 11 Oct"). */
export function goalsWeek(page: Page): Locator {
  return goalsScreen(page).locator('[data-goals-week]');
}

/** A goal's tick (a checkbox named by its title), in the week shown. */
export function goalTick(page: Page, title: string): Locator {
  return goalsWeek(page).getByRole('checkbox', { name: title, exact: true });
}

/** A goal's row, in the week shown. */
export function goalRow(page: Page, title: string): Locator {
  return goalsWeek(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('checkbox', { name: title, exact: true }) });
}

/** The titles of the week shown, top to bottom. */
export function goalTitles(page: Page): Promise<string[]> {
  return goalsWeek(page)
    .locator('[data-goal-tick]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
}

/** "2 of 4 done" over the week. */
export function goalsProgress(page: Page): Locator {
  return goalsScreen(page).locator('[data-goals-progress]');
}

/** Adds goals to the week shown with Add a Goal, Enter after each; resolves once they show. */
export async function addGoals(page: Page, ...titles: string[]): Promise<void> {
  const before = (await goalTitles(page)).length;
  await goalsWeek(page).getByRole('button', { name: 'Add a Goal', exact: true }).click();
  for (const title of titles) {
    const field = goalsWeek(page).getByRole('textbox', { name: 'New goal', exact: true });
    await expect(field).toBeFocused();
    await field.fill(title);
    await field.press('Enter');
  }
  await goalsWeek(page).getByRole('textbox', { name: 'New goal', exact: true }).press('Escape');
  await expect(goalsWeek(page).locator('[data-goal-tick]')).toHaveCount(before + titles.length);
}

/** The share sheet of Goals, once it has slid up. */
export async function openGoalsShare(page: Page): Promise<Locator> {
  await goalsScreen(page).getByRole('button', { name: 'Share', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Share this week’s goals' });
  await settled(sheet.getByRole('button', { name: 'Done', exact: true }));
  return sheet;
}
