import { expect, test, type Locator, type Page } from '@playwright/test';
import { USER_DEMO_DOC } from '../src/lib/logic/importHome.fixture';
import {
  area,
  areaHeadings,
  chatScreen,
  chips,
  closeHousehold,
  closeProfile,
  confirmation,
  createAccount,
  dayLabel,
  escapeRe,
  expectNoReload,
  finishSetup,
  goToTab,
  homeIds,
  homeScreen,
  itemButton,
  itemSheet,
  londonDate,
  meta,
  openDevice,
  openHousehold,
  openItem,
  openPersonPage,
  openProfile,
  people,
  personRow,
  quiet,
  removeOwnData,
  ring,
  settled,
  statsScreen,
  SYNC_MS,
  toast,
  waitForNoHome,
  type Account,
  type Device,
} from './live';

// One home on the real backend, with two phones (docs/ARCHITECTURE.md "One home", "Bring over
// the home from this phone" and "Sync guarantees"). Stratis brings over the home his phone
// kept in demo mode, adds Shea's Google email, Shea signs in and is Shea; someone else sees
// "This home is private" until they are added. Then every kind of change one of them makes
// shows on the other phone without a reload, within SYNC_MS.
//
// The steps build on each other (one home per deployment), so they run in order.
test.describe.configure({ mode: 'serial' });

const DEMO_DOC_KEY = 'homeos.demo.v1';
const doc = USER_DEMO_DOC;

let accounts: { stratis: Account; shea: Account; stranger: Account };
let stratis: Device;
let shea: Device;

test.beforeAll(async () => {
  // Anything an earlier run of this suite left behind (only its own accounts and their home).
  await removeOwnData();
  accounts = {
    stratis: await createAccount('stratis', 'Stratis Google'),
    shea: await createAccount('shea', 'Shea Google'),
    stranger: await createAccount('robin', 'Robin Google'),
  };
});

test.afterAll(async () => {
  await stratis?.context.close();
  await shea?.context.close();
  await removeOwnData();
});

// ── What the phone kept, as Home should show it ──────────────

const areaName = (id: string) => doc.areas.find((a) => a.id === id)!.name;
const who = (id: string | null) => {
  const m = id ? doc.members.find((p) => p.id === id) : null;
  return m ? `${m.emoji} ${m.name}` : 'Unassigned';
};
/** The London day of a stored time, as YYYY-MM-DD. */
const londonDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const RAG = { red: 'Red', amber: 'Amber', green: 'Green' } as const;

const OPEN_ITEMS = doc.items
  .filter((i) => i.status === 'open')
  .map((i) => ({
    area: areaName(i.area_id),
    title: i.title,
    state: i.kind === 'state',
    rag: RAG[i.rag],
    who: who(i.assignee_id),
    // A To do shows its due day (Missed once it has passed); a To maintain the day it was last updated.
    date: i.kind === 'state' ? `Updated ${dayLabel(londonDay(i.updated_at))}` : dayLabel(i.due_date!),
    note: i.note,
  }));

function rowFor(page: Page, title: string, areaTitle: string): Locator {
  return itemButton(area(page, areaTitle), title);
}

function log(page: Page): Locator {
  return chatScreen(page).getByRole('log', { name: 'Messages' });
}

function bubble(page: Page, text: string): Locator {
  return log(page).getByRole('article').filter({ hasText: text });
}

/** A message with its name, avatar and reaction chips. */
function messageRow(page: Page, text: string): Locator {
  return log(page)
    .locator('[data-state]')
    .filter({ has: page.getByRole('article').filter({ hasText: text }) });
}

test('the first person to sign in brings over the home from this phone', async ({ browser, baseURL }) => {
  await waitForNoHome();
  stratis = await openDevice(browser, baseURL!, accounts.stratis, { [DEMO_DOC_KEY]: JSON.stringify(doc) });
  const page = stratis.page;

  const offer = page.getByRole('region', { name: 'Bring over the home from this phone' });
  await expect(offer.getByRole('heading', { level: 1 })).toHaveText('Bring over the home from this phone');
  await expect(offer).toContainText('Our home');
  await expect(offer).toContainText('21 Alderbrook Road');
  await expect(offer).toContainText('6 areas · 19 items');
  await expect(offer.getByRole('list', { name: 'People' }).getByRole('listitem')).toHaveText([
    '🦆Stratis (you)',
    '🦔Shea',
    '🦊Ela',
  ]);
  await expect(offer).toContainText(
    /Everyone else joins when someone adds their Google email in Profile\s>\sHousehold\s>\sPeople\./,
  );
  await expect(offer.getByRole('button', { name: 'Start Fresh' })).toBeVisible();
  // On a small phone the card keeps everyone (the step scrolls instead).
  await page.setViewportSize({ width: 320, height: 568 });
  const card = offer.getByRole('list', { name: 'People' }).locator('..');
  expect(await card.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await offer.getByRole('listitem').last().scrollIntoViewIfNeeded();
  await expect(offer.getByRole('listitem').last()).toBeInViewport();
  await page.setViewportSize({ width: 402, height: 874 });
  // Never a Profile step or a second home on the way.
  await offer.getByRole('button', { name: 'Bring It Over' }).click();
  await finishSetup(page);

  // Every area in order, every open item with its kind, status, person, date and note.
  await expect(areaHeadings(page)).toHaveText(doc.areas.map((a) => a.name));
  for (const it of OPEN_ITEMS) {
    const row = rowFor(page, it.title, it.area);
    await expect(row, `${it.area}: ${it.title}`).toHaveAccessibleName(
      new RegExp(`^${escapeRe(it.title)} ?, ${it.rag}${it.state ? ', to maintain' : ''}\\.`),
    );
    await expect(meta(area(page, it.area), it.title), `${it.area}: ${it.title}`).toHaveText(
      new RegExp(`^${escapeRe(it.who)} · ${it.state ? '' : '(Missed · )?'}${escapeRe(it.date)}$`),
    );
    if (it.note) await expect(row).toContainText(it.note);
    await expect(ring(area(page, it.area), it.title)).toHaveCount(it.state ? 0 : 1);
  }
  const rows = homeScreen(page).locator('[data-item-open]');
  await expect(rows).toHaveCount(OPEN_ITEMS.length);
  // Done before it came over: in Stats, not on Home.
  await expect(homeScreen(page).getByText('Order water test strips')).toHaveCount(0);

  // Who has what: Stratis signed in, Shea and Ela not yet.
  expect(await chips(page).getByRole('radio').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual([
    'Everyone, 19 items',
    'Stratis (you), 11 items',
    'Shea, 5 items, not joined yet',
    'Ela, 0 items, not joined yet',
    'Unassigned, 3 items',
  ]);

  // He kept his demo name and duck, not his Google name.
  await expect(page.getByRole('button', { name: 'Profile', exact: true })).toHaveText('🦆');
  const dialog = await openProfile(page);
  await expect(dialog.getByRole('textbox', { name: 'Your name' })).toHaveValue('Stratis');
  await expect(dialog.getByRole('button', { name: /^Household/ })).toContainText('Our home');
  await closeProfile(page);

  // The Stats history came along.
  await goToTab(page, 'Stats');
  await statsScreen(page).getByRole('radio', { name: 'Lifetime' }).click();
  await expect(statsScreen(page).getByRole('img', { name: /tasks? done/ })).toHaveAccessibleName(
    '7 tasks done in total: Stratis 2, Shea 3, Ela 2.',
  );
  await goToTab(page, 'Home');

  // The phone's copy stays, marked so the offer never comes back; one home in the database.
  const mark = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).imported, DEMO_DOC_KEY);
  expect(mark?.household_id).toEqual(expect.any(String));
  expect(await homeIds()).toEqual([mark.household_id]);
  await expectNoReload(stratis);
});

test('Stratis adds Shea’s Google email; Shea signs in and is Shea, with her items', async ({ browser, baseURL }) => {
  const a = stratis.page;
  const dialog = await openHousehold(a);
  await expect(people(dialog).getByRole('button')).toHaveText([
    '🦆Stratis, You',
    '🦔Shea, Not joined yet · , No email yet',
    '🦊Ela, Not joined yet · , No email yet',
    'Add Person',
  ]);
  await openPersonPage(dialog, 'Shea');
  const email = dialog.getByRole('textbox', { name: 'Google Email' });
  // Typed any old way: stored trimmed and lower case.
  await email.fill(` ${accounts.shea.email.toUpperCase()} `);
  await email.press('Enter');
  await expect(email).not.toBeFocused();
  await dialog.getByRole('button', { name: 'Household', exact: true }).click();
  await expect(personRow(dialog, 'Shea')).toHaveText(`🦔Shea, Not joined yet · , ${accounts.shea.email}`);

  // Shea signs in with Google on her phone: no invite, no profile, no new home.
  await quiet(stratis);
  shea = await openDevice(browser, baseURL!, accounts.shea);
  const b = shea.page;
  const welcome = b.getByRole('region', { name: 'Welcome home, Shea' });
  await expect(welcome.getByRole('heading', { name: 'Welcome home, Shea', level: 1 })).toBeVisible();
  await expect(welcome.getByText('Our home is all set up for you. Pick your emoji.')).toBeVisible();
  await expect(welcome.getByRole('radiogroup', { name: 'Your emoji' }).getByRole('radio', { name: '🦔' })).toBeChecked();
  await expect(b.getByRole('textbox')).toHaveCount(0);

  // Stratis's phone hears that she joined, without a reload.
  await expect(personRow(dialog, 'Shea')).toHaveText('🦔Shea', { timeout: SYNC_MS });

  await welcome.getByRole('button', { name: 'Continue' }).click();
  await finishSetup(b);
  await expect(b.getByRole('button', { name: 'Profile', exact: true })).toHaveText('🦔');
  const mine = chips(b).getByRole('radio', { name: 'Shea (you), 5 items', exact: true });
  await mine.click();
  await expect(mine).toHaveAttribute('aria-checked', 'true');
  const hers = OPEN_ITEMS.filter((it) => it.who === '🦔 Shea');
  await expect(homeScreen(b).locator('[data-item-open]')).toHaveCount(hers.length);
  for (const it of hers) await expect(rowFor(b, it.title, it.area)).toBeVisible();
  await chips(b).getByRole('radio', { name: /^Everyone,/ }).click();
  await expect(homeScreen(b).locator('[data-item-open]')).toHaveCount(OPEN_ITEMS.length);

  await expectNoReload(stratis);
  await expectNoReload(shea);
});

test('anyone else sees "This home is private" until someone adds their email', async ({ browser, baseURL }) => {
  const robin = await openDevice(browser, baseURL!, accounts.stranger);
  const c = robin.page;
  const shut = c.getByRole('region', { name: 'This home is private' });
  await expect(shut.getByRole('heading', { name: 'This home is private', level: 1 })).toBeVisible();
  await expect(shut).toContainText(
    new RegExp(`Ask someone at home to add ${escapeRe(accounts.stranger.email)} in Profile\\s>\\sHousehold\\s>\\sPeople, then check again\\.`),
  );
  // Nothing but Check Again and Sign Out: no way to make a second home.
  await expect(shut.getByRole('button')).toHaveText(['Check Again', 'Sign Out']);
  await shut.getByRole('button', { name: 'Check Again' }).click();
  await expect(shut.getByRole('button', { name: 'Check Again' })).toBeEnabled();
  await expect(shut.getByRole('heading', { name: 'This home is private', level: 1 })).toBeVisible();
  expect((await homeIds()).length).toBe(1);

  // Stratis adds Robin with that email (his Household page is still open).
  await quiet(shea);
  const dialog = stratis.page.getByRole('dialog', { name: 'Profile' });
  await people(dialog).getByRole('button', { name: 'Add Person' }).click();
  const name = dialog.getByPlaceholder('Name', { exact: true });
  await expect(name).toBeFocused();
  await settled(name);
  await name.fill('Robin');
  await dialog.getByRole('radiogroup', { name: 'Emoji', exact: true }).getByRole('radio', { name: '🐳' }).click();
  await dialog.getByRole('textbox', { name: 'Google Email' }).fill(accounts.stranger.email);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(personRow(dialog, 'Robin')).toHaveText(`🐳Robin, Not joined yet · , ${accounts.stranger.email}`);

  // Shea's phone shows the new person straight away.
  await expect(chips(shea.page).getByRole('radio', { name: 'Robin, 0 items, not joined yet', exact: true })).toBeVisible({
    timeout: SYNC_MS,
  });

  // Check Again: Robin is in, as the Robin Stratis added.
  await quiet(stratis);
  await quiet(shea);
  await shut.getByRole('button', { name: 'Check Again' }).click();
  const welcome = c.getByRole('region', { name: 'Welcome home, Robin' });
  await expect(welcome.getByRole('radiogroup', { name: 'Your emoji' }).getByRole('radio', { name: '🐳' })).toBeChecked();
  await expect(personRow(dialog, 'Robin')).toHaveText('🐳Robin', { timeout: SYNC_MS });
  await expect(chips(shea.page).getByRole('radio', { name: 'Robin, 0 items', exact: true })).toBeVisible({ timeout: SYNC_MS });
  await welcome.getByRole('button', { name: 'Continue' }).click();
  await finishSetup(c);
  await expect(areaHeadings(c)).toHaveText(doc.areas.map((x) => x.name));
  await expectNoReload(robin);
  await robin.context.close();

  await closeHousehold(stratis.page, dialog);
  await expectNoReload(stratis);
  await expectNoReload(shea);
});

test('items: create, edit, What good looks like, kind, complete, undo and delete show on the other phone', async () => {
  const a = stratis.page;
  const b = shea.page;

  // Stratis adds a To do for Shea.
  await quiet(shea);
  await a.getByRole('button', { name: 'New item', exact: true }).click();
  let sheet = itemSheet(a, 'New item');
  await settled(sheet.getByRole('button', { name: 'Close' }));
  const due = londonDate(5);
  await sheet.getByLabel('Title', { exact: true }).fill('Descale the kettle');
  await sheet.getByLabel('Note', { exact: true }).fill('Vinegar is under the sink.');
  await sheet.getByLabel('Area', { exact: true }).selectOption({ label: 'Kitchen' });
  await sheet.getByRole('radiogroup', { name: 'Status' }).getByText('Red', { exact: true }).click();
  await sheet.getByLabel('Assigned to', { exact: true }).selectOption({ label: '🦔 Shea' });
  await sheet.getByLabel('Due', { exact: true }).fill(due);
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  const kettle = rowFor(b, 'Descale the kettle', 'Kitchen');
  await expect(kettle).toHaveAccessibleName(/^Descale the kettle ?, Red\./, { timeout: SYNC_MS });
  await expect(meta(area(b, 'Kitchen'), 'Descale the kettle')).toHaveText(`🦔 Shea · ${dayLabel(due)}`);
  await expect(kettle).toContainText('Vinegar is under the sink.');

  // Shea edits a To do: title, note, status, due date and who.
  await quiet(stratis);
  sheet = await openItem(b, area(b, 'Living Room'), 'Remove AC');
  const later = londonDate(13);
  await sheet.getByLabel('Title', { exact: true }).fill('Remove the AC unit');
  await sheet.getByLabel('Note', { exact: true }).fill('Bracket bolts are 13 mm.');
  await sheet.getByRole('radiogroup', { name: 'Status' }).getByText('Red', { exact: true }).click();
  await sheet.getByLabel('Due', { exact: true }).fill(later);
  await sheet.getByLabel('Assigned to', { exact: true }).selectOption({ label: '🦆 Stratis' });
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  const ac = rowFor(a, 'Remove the AC unit', 'Living Room');
  await expect(ac).toHaveAccessibleName(/^Remove the AC unit ?, Red\./, { timeout: SYNC_MS });
  await expect(meta(area(a, 'Living Room'), 'Remove the AC unit')).toHaveText(`🦆 Stratis · ${dayLabel(later)}`);
  await expect(ac).toContainText('Bracket bolts are 13 mm.');
  await expect(rowFor(a, 'Remove AC', 'Living Room')).toHaveCount(0);

  // Stratis writes what good looks like for a To maintain, and calls it Amber.
  await quiet(shea);
  const good = 'Watered twice a week.\nNo yellow leaves.\nPots drained after rain.';
  sheet = await openItem(a, area(a, 'Garden'), 'Plants healthy');
  await sheet.getByRole('textbox', { name: 'What good looks like', exact: true }).fill(good);
  await sheet.getByRole('radiogroup', { name: 'Status' }).getByText('Amber', { exact: true }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(rowFor(b, 'Plants healthy', 'Garden')).toHaveAccessibleName(/^Plants healthy ?, Amber, to maintain\./, {
    timeout: SYNC_MS,
  });
  sheet = await openItem(b, area(b, 'Garden'), 'Plants healthy');
  await expect(sheet.getByRole('textbox', { name: 'What good looks like', exact: true })).toHaveValue(good);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);

  // Shea turns a To do into a To maintain.
  await quiet(stratis);
  sheet = await openItem(b, area(b, 'Living Room'), 'Fix the cracks on the wall');
  await sheet.getByRole('radiogroup', { name: 'Type' }).getByRole('radio', { name: 'To maintain' }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(rowFor(a, 'Fix the cracks on the wall', 'Living Room')).toHaveAccessibleName(
    /^Fix the cracks on the wall ?, Red, to maintain\./,
    { timeout: SYNC_MS },
  );
  await expect(ring(area(a, 'Living Room'), 'Fix the cracks on the wall')).toHaveCount(0);
  await expect(meta(area(a, 'Living Room'), 'Fix the cracks on the wall')).toHaveText(
    `Unassigned · Updated ${dayLabel(londonDate())}`,
  );

  // Stratis marks one of his done: gone on Shea's phone; Undo brings it back there too.
  await quiet(shea);
  await ring(area(a, 'Garden'), 'Install leaf blower').click();
  const undo = toast(a, 'Marked as done').getByRole('button', { name: 'Undo' });
  await undo.focus(); // holds the toast while we look at the other phone
  await expect(rowFor(b, 'Install leaf blower', 'Garden')).toHaveCount(0, { timeout: SYNC_MS });
  await quiet(shea);
  await undo.click();
  await expect(rowFor(b, 'Install leaf blower', 'Garden')).toBeVisible({ timeout: SYNC_MS });
  await expect(meta(area(b, 'Garden'), 'Install leaf blower')).toHaveText(/^🦆 Stratis · (Missed · )?Fri 16 Oct$/);

  // Shea does a monthly one: Stratis sees its next date, and her count in Stats.
  await quiet(stratis);
  await ring(area(b, 'Jacuzzi'), 'Change the filter').click();
  await expect(toast(b, /^Done\. Next due/)).toBeVisible();
  await expect(meta(area(a, 'Jacuzzi'), 'Change the filter')).toHaveText(`🦔 Shea · ${dayLabel('2026-11-21')}`, {
    timeout: SYNC_MS,
  });
  await goToTab(a, 'Stats');
  await expect(statsScreen(a).getByRole('radio', { name: 'Lifetime' })).toBeChecked();
  await expect(statsScreen(a).getByRole('img', { name: /tasks? done/ })).toHaveAccessibleName(
    /^8 tasks done in total: Stratis 2, Shea 4, Ela 2(, Robin 0)?\.$/,
  );
  await goToTab(a, 'Home');

  // Shea deletes one.
  await quiet(stratis);
  sheet = await openItem(b, area(b, 'Bathroom Small'), 'Hand towels solution');
  await sheet.getByRole('button', { name: 'Delete' }).click();
  await (await confirmation(b, 'Delete this item?')).getByRole('button', { name: 'Delete Item' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(rowFor(a, 'Hand towels solution', 'Bathroom Small')).toHaveCount(0, { timeout: SYNC_MS });
  await expect(rowFor(a, 'Tidiness', 'Bathroom Small')).toBeVisible();

  await expectNoReload(stratis);
  await expectNoReload(shea);
});

test('areas and the household: add, rename, reorder, delete, name and address show on the other phone', async () => {
  const a = stratis.page;
  const b = shea.page;
  const areaName = (dialog: Locator, name: string) =>
    dialog
      .getByRole('listitem')
      .filter({ has: dialog.page().getByRole('button', { name: `Delete ${name}`, exact: true }) })
      .getByRole('textbox', { name: 'Area name' });

  // Stratis adds an area.
  await quiet(shea);
  let dialog = await openHousehold(a);
  await dialog.getByRole('button', { name: 'Add Area' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Area name' }).last()).toBeFocused();
  await a.keyboard.type('Shed');
  await a.keyboard.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Delete Shed', exact: true })).toBeVisible();
  await closeHousehold(a, dialog);
  await expect(area(b, 'Shed').getByText('Nothing to do')).toBeVisible({ timeout: SYNC_MS });

  // Shea renames it.
  await quiet(stratis);
  dialog = await openHousehold(b);
  const shed = areaName(dialog, 'Shed');
  await shed.fill('Garden Shed');
  await shed.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Delete Garden Shed', exact: true })).toBeVisible();
  const order = ['Kitchen', 'Living Room', 'Bathroom Small', 'Garden', 'Garden Lounge', 'Jacuzzi', 'Garden Shed'];
  await expect(areaHeadings(a)).toHaveText(order, { timeout: SYNC_MS });

  // Shea moves the Jacuzzi up one.
  await quiet(stratis);
  await dialog.getByRole('button', { name: 'Reorder Jacuzzi' }).focus();
  await b.keyboard.press('ArrowUp');
  const reordered = ['Kitchen', 'Living Room', 'Bathroom Small', 'Garden', 'Jacuzzi', 'Garden Lounge', 'Garden Shed'];
  for (const [i, n] of reordered.entries()) await expect(dialog.getByRole('textbox', { name: 'Area name' }).nth(i)).toHaveValue(n);
  await expect(areaHeadings(a)).toHaveText(reordered, { timeout: SYNC_MS });

  // Shea deletes it.
  await quiet(stratis);
  await dialog.getByRole('button', { name: 'Delete Garden Shed', exact: true }).click();
  await (await confirmation(b, 'Delete Garden Shed?')).getByRole('button', { name: 'Delete Area' }).click();
  await expect(dialog.getByRole('button', { name: 'Delete Garden Shed', exact: true })).toHaveCount(0);
  await expect(areaHeadings(a)).toHaveText(reordered.slice(0, -1), { timeout: SYNC_MS });

  // Shea renames the household and changes the address.
  await quiet(stratis);
  const address = dialog.getByLabel('Address', { exact: true });
  await address.fill('23 Alderbrook Road');
  await address.press('Enter');
  const name = dialog.getByLabel('Name', { exact: true });
  await name.fill('The Burrow');
  await name.press('Enter');
  await expect(homeScreen(a).getByText('23 Alderbrook Road', { exact: true })).toBeVisible({ timeout: SYNC_MS });
  await closeHousehold(b, dialog);
  await expect
    .poll(
      async () => {
        const profile = await openProfile(a);
        const text = await profile.getByRole('button', { name: /^Household/ }).textContent();
        await closeProfile(a);
        return text ?? '';
      },
      { timeout: SYNC_MS },
    )
    .toContain('The Burrow');

  await expectNoReload(stratis);
  await expectNoReload(shea);
});

test('people: an emoji, a name, someone added and someone removed show on the other phone', async () => {
  const a = stratis.page;
  const b = shea.page;

  // Shea picks another emoji: Stratis sees it on her items.
  await quiet(stratis);
  let profile = await openProfile(b);
  await profile.getByRole('radiogroup', { name: 'Your emoji' }).getByRole('radio', { name: '🐧' }).click();
  await closeProfile(b);
  await expect(meta(area(a, 'Jacuzzi'), 'Check Chemicals')).toHaveText(/^🐧 Shea · (Missed · )?Tue 20 Oct$/, {
    timeout: SYNC_MS,
  });

  // Stratis renames Robin (who has joined).
  await quiet(shea);
  const dialog = await openHousehold(a);
  await openPersonPage(dialog, 'Robin');
  const name = dialog.getByRole('textbox', { name: 'Name', exact: true }).last();
  await name.fill('Robin H');
  await name.press('Enter');
  await dialog.getByRole('button', { name: 'Household', exact: true }).click();
  await expect(personRow(dialog, 'Robin H')).toHaveText('🐳Robin H');
  await expect(chips(b).getByRole('radio', { name: 'Robin H, 0 items', exact: true })).toBeVisible({ timeout: SYNC_MS });

  // Stratis adds someone who has not signed in yet, then removes them.
  await quiet(shea);
  await people(dialog).getByRole('button', { name: 'Add Person' }).click();
  const newName = dialog.getByPlaceholder('Name', { exact: true });
  await expect(newName).toBeFocused();
  await settled(newName);
  await newName.fill('Kim');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(personRow(dialog, 'Kim')).toHaveText('🦔Kim, Not joined yet · , No email yet');
  await expect(chips(b).getByRole('radio', { name: 'Kim, 0 items, not joined yet', exact: true })).toBeVisible({
    timeout: SYNC_MS,
  });
  profile = await openHousehold(b);
  await expect(personRow(profile, 'Kim')).toHaveText('🦔Kim, Not joined yet · , No email yet');
  await quiet(shea);
  await openPersonPage(dialog, 'Kim');
  await dialog.getByRole('button', { name: 'Remove Kim' }).click();
  await (await confirmation(a, 'Remove Kim?')).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(personRow(dialog, 'Kim')).toHaveCount(0);
  await expect(personRow(profile, 'Kim')).toHaveCount(0, { timeout: SYNC_MS });
  await expect(people(profile).getByRole('button')).toHaveText([
    '🦆Stratis',
    '🐧Shea, You',
    '🦊Ela, Not joined yet · , No email yet',
    '🐳Robin H',
    'Add Person',
  ]);
  await closeHousehold(b, profile);
  await closeHousehold(a, dialog);

  await expectNoReload(stratis);
  await expectNoReload(shea);
});

test('chat: a message, a reaction on and off, and a delete show on the other phone', async () => {
  const a = stratis.page;
  const b = shea.page;
  await goToTab(a, 'Chat');
  await goToTab(b, 'Chat');
  // Both chats loaded, nothing in flight: what shows next on the other phone came over Realtime.
  await expect(chatScreen(a).getByText('Say hello', { exact: true })).toBeVisible();
  await expect(chatScreen(b).getByText('Say hello', { exact: true })).toBeVisible();
  await quiet(stratis);
  await quiet(shea);

  await chatScreen(a).getByRole('textbox', { name: 'Message' }).fill('Bins go out tonight.');
  await chatScreen(a).getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(bubble(b, 'Bins go out tonight.')).toBeVisible({ timeout: SYNC_MS });
  await expect(bubble(b, 'Bins go out tonight.')).toHaveAttribute('aria-label', /^Stratis, /);

  // Shea reacts, then takes it back.
  await quiet(stratis);
  await bubble(b, 'Bins go out tonight.').click({ button: 'right' });
  await b.getByRole('dialog', { name: 'Message actions' }).getByRole('button', { name: 'React with ❤️' }).click();
  await expect(messageRow(b, 'Bins go out tonight.').getByRole('button', { name: '❤️, 1 reaction from you' })).toBeVisible();
  await expect(
    messageRow(a, 'Bins go out tonight.').getByRole('button', { name: '❤️, 1 reaction from Shea' }),
  ).toBeVisible({ timeout: SYNC_MS });
  await quiet(stratis);
  await messageRow(b, 'Bins go out tonight.').getByRole('button', { name: '❤️, 1 reaction from you' }).click();
  await expect(messageRow(a, 'Bins go out tonight.').getByRole('button', { name: /^❤️/ })).toHaveCount(0, {
    timeout: SYNC_MS,
  });

  // Shea answers, then deletes her message.
  await quiet(stratis);
  await chatScreen(b).getByRole('textbox', { name: 'Message' }).fill('On it, I will take the recycling too.');
  await chatScreen(b).getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(bubble(a, 'On it, I will take the recycling too.')).toBeVisible({ timeout: SYNC_MS });
  await expect(bubble(a, 'On it, I will take the recycling too.')).toHaveAttribute('aria-label', /^Shea, /);
  await quiet(stratis);
  await bubble(b, 'On it, I will take the recycling too.').click({ button: 'right' });
  await b.getByRole('dialog', { name: 'Message actions' }).getByRole('button', { name: 'Delete' }).click();
  await (await confirmation(b, 'Delete this message?')).getByRole('button', { name: 'Delete Message' }).click();
  await expect(bubble(b, 'On it, I will take the recycling too.')).toHaveCount(0);
  await expect(bubble(a, 'On it, I will take the recycling too.')).toHaveCount(0, { timeout: SYNC_MS });
  await expect(bubble(a, 'Bins go out tonight.')).toBeVisible();

  await expectNoReload(stratis);
  await expectNoReload(shea);
});

test('a phone that was offline catches up as soon as it is back online', async () => {
  const a = stratis.page;
  const b = shea.page;
  await goToTab(a, 'Home');
  await goToTab(b, 'Home');
  await quiet(stratis);
  await quiet(shea);

  // Shea's phone loses its connection; Stratis adds something meanwhile.
  await shea.context.setOffline(true);
  await a.getByRole('button', { name: 'New item', exact: true }).click();
  const sheet = itemSheet(a, 'New item');
  await settled(sheet.getByRole('button', { name: 'Close' }));
  await sheet.getByLabel('Title', { exact: true }).fill('Bleed the radiators');
  await sheet.getByLabel('Area', { exact: true }).selectOption({ label: 'Living Room' });
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(rowFor(a, 'Bleed the radiators', 'Living Room')).toBeVisible();
  // Nothing can reach Shea's phone while it is offline.
  await b.waitForTimeout(2_000);
  await expect(rowFor(b, 'Bleed the radiators', 'Living Room')).toHaveCount(0);

  // Back online: it reconnects and loads at once (no reload, no waiting for the next change).
  await shea.context.setOffline(false);
  await expect(rowFor(b, 'Bleed the radiators', 'Living Room')).toBeVisible({ timeout: SYNC_MS });
  // And it hears the next change over Realtime again.
  await quiet(shea);
  await openItem(a, area(a, 'Living Room'), 'Bleed the radiators').then(async (s) => {
    await s.getByRole('radiogroup', { name: 'Status' }).getByText('Green', { exact: true }).click();
    await s.getByRole('button', { name: 'Save' }).click();
    await expect(s).toHaveCount(0);
  });
  await expect(rowFor(b, 'Bleed the radiators', 'Living Room')).toHaveAccessibleName(/^Bleed the radiators ?, Green\./, {
    timeout: SYNC_MS,
  });

  // The browser logs the requests that failed while offline; nothing else may go wrong.
  shea.errors.splice(0, shea.errors.length, ...shea.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e)));
  await expectNoReload(stratis);
  await expectNoReload(shea);
});
