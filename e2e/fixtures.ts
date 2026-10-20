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

/** Needs attention's two views, as its view switch names them. */
export type ViewName = 'List' | 'Calendar';

/**
 * Signed in as Stratis in the prototype household (Shea, Ela, seeded items and history), on
 * Home: the hero, the sentence, a card for each area. `view` opens Needs attention instead, on
 * its list or its calendar (the phone then remembers the view).
 */
export async function openSeeded(page: Page, view?: ViewName): Promise<void> {
  await page.goto('/?demo-seed=1');
  // The phone reopens on the tab last open: back to Home.
  await expect(tabs(page)).toBeVisible();
  if ((await tabButton(page, 'Home').getAttribute('aria-current')) !== 'page') await goToTab(page, 'Home');
  await expect(homeScreen(page).getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  if (view) await openAttention(page, view);
}

/** The Needs attention tab, on its list (or its calendar). */
export async function openAttention(page: Page, view: ViewName = 'List'): Promise<void> {
  await goToTab(page, 'Attention');
  await expect(attentionScreen(page).getByRole('heading', { name: 'Needs attention', level: 1 })).toBeVisible();
  await showView(page, view);
}

/** The view switch under Needs attention's sentence (a radio group "View"). */
export function views(page: Page): Locator {
  return attentionScreen(page).getByRole('radiogroup', { name: 'View' });
}

/** Chooses one of Needs attention's views. */
export async function showView(page: Page, name: ViewName): Promise<void> {
  const radio = views(page).getByRole('radio', { name, exact: true });
  await radio.click();
  await expect(radio).toHaveAttribute('aria-checked', 'true');
}

/** Needs attention's one sentence on what needs doing (whose items it shows). */
export function summary(page: Page): Locator {
  return attentionScreen(page).locator('[data-attention-summary]');
}

/** Home's one sentence on what needs doing across the house (a button: it opens Needs attention). */
export function homeSummary(page: Page): Locator {
  return homeScreen(page).locator('[data-home-summary]');
}

/** A group of Needs attention's list ('attention', 'today', 'week', 'later', 'looking'). */
export function group(page: Page, id: 'attention' | 'today' | 'week' | 'later' | 'looking'): Locator {
  return attentionScreen(page).locator(`section[data-group="${id}"]`);
}

/** Mine: one tap for only your items. */
export function mine(page: Page): Locator {
  return attentionScreen(page).getByRole('button', { name: 'Mine', exact: true });
}

/** The people menu's button, "Show tasks for: Everyone" (or whoever is chosen). */
export function peopleButton(page: Page): Locator {
  return attentionScreen(page).getByRole('button', { name: /^Show tasks for: / });
}

/** Chooses whose items Needs attention shows from the people menu ("Everyone", "Shea", "Unassigned"...). */
export async function chooseWho(page: Page, name: RegExp): Promise<void> {
  await peopleButton(page).click();
  await page.getByRole('menu', { name: 'Show tasks for' }).getByRole('menuitemradio', { name }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
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

/** The Needs attention tab (the outer region: its first group is named "Needs attention" too). */
export function attentionScreen(page: Page): Locator {
  return page.getByRole('region', { name: 'Needs attention', exact: true }).first();
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

export type TabName = 'Home' | 'Attention' | 'Chat' | 'Housekeeping' | 'Stats';

export function tabs(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Tabs' });
}

/** The round + floating over the tab bar on Home, Needs attention and Stats. */
export function addButton(page: Page): Locator {
  return page.getByRole('button', { name: 'New item', exact: true });
}

/**
 * A tab button. Attention is named "Attention, 2 items" while things need attention, Chat
 * "Chat, unread messages" while it has its dot, Housekeeping "Housekeeping, new message"
 * while it has its.
 */
export function tabButton(page: Page, name: TabName): Locator {
  const named = {
    Attention: /^Attention(, \d+ items?)?$/,
    Chat: /^Chat(, unread messages)?$/,
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

/** The area sheet that is open (its rows; never Needs attention's). */
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

/** Needs attention's calendar, its own view (the week strip or the month, and the chosen day under it). */
export function calendar(page: Page): Locator {
  return attentionScreen(page).locator('section[data-calendar]');
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

// ── Needs attention as one list of cards, and the areas' status lines ──────
// (Needs attention lost its List / Calendar switch: openAttention(), showView(), views(),
// group() and calendar() above are left from it; use these instead.)

/** The Needs attention tab: its one list. */
export async function openNeedsAttention(page: Page): Promise<void> {
  await goToTab(page, 'Attention');
  await expect(attentionScreen(page).getByRole('heading', { name: 'Needs attention', level: 1 })).toBeVisible();
}

/** Signed in as Stratis in the prototype household (openSeeded()), on Needs attention. */
export async function openSeededAttention(page: Page): Promise<void> {
  await openSeeded(page);
  await openNeedsAttention(page);
}

/** Needs attention's list: a card for each item, or one card that says there is nothing. */
export function attentionList(page: Page): Locator {
  return attentionScreen(page).locator('[data-attention-list]');
}

/** The cards on Needs attention, top to bottom. */
export function attentionCards(page: Page): Locator {
  return attentionList(page).locator('li[data-item-id]');
}

/** The part of a card on Needs attention that opens its item, by the item's title. */
export function attentionCard(page: Page, title: string): Locator {
  return attentionList(page).getByRole('button', { name: new RegExp(`^${escapeRe(title)} ?, `) });
}

/** The titles of Needs attention's cards, top to bottom. */
export function attentionTitles(page: Page): Promise<string[]> {
  return attentionList(page)
    .locator('[data-item-open]')
    .evaluateAll((els) => els.map((el) => (el.textContent ?? '').split(',')[0].trim()));
}

/** An area's status lines in its sheet ("1 urgent task", "2 non-urgent tasks", "All good"). */
export function areaStatusLines(page: Page, name: string): Locator {
  return area(page, name).locator('[data-area-status] [data-tone]');
}

/** An area's status lines on its card on Home. */
export function cardStatusLines(page: Page, name: string, all?: readonly string[]): Locator {
  return areaCard(page, name, all).locator('[data-tone]');
}
