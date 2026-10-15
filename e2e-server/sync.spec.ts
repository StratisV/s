import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  area,
  areaHeadings,
  chatScreen,
  closeHousehold,
  closeProfile,
  codeFor,
  confirmation,
  dayLabel,
  expectNoReload,
  expectPerson,
  goToTab,
  homeHeading,
  homeScreen,
  housekeepingScreen,
  itemSheet,
  loadHome,
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
  resetServer,
  ring,
  rowFor,
  settled,
  statsScreen,
  stratisAndShea,
  SYNC_MS,
  taskMeta,
  toast,
  type Device,
  who,
} from './helpers';

// Every kind of change one phone makes shows on the other within SYNC_MS, without a reload,
// heard by polling (docs/ARCHITECTURE.md "Server mode (no setup)", "Sync guarantees in server
// mode"), and two people writing at the same moment never lose a change. Each test starts
// from a fresh home: Stratis brought it online from his phone, Shea joined with a code.

let stratis: Device;
let shea: Device;

test.beforeEach(async ({ browser, baseURL, request }) => {
  await resetServer(request);
  ({ stratis, shea } = await stratisAndShea(browser, baseURL!));
});

test.afterEach(async () => {
  await stratis?.context.close();
  await shea?.context.close();
});

test('items: create, edit, What good looks like, kind, done, undo and delete show on the other phone', async () => {
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
  await sheet.getByRole('radiogroup', { name: 'How urgent?' }).getByText('Urgent', { exact: true }).click();
  await sheet.getByLabel('Assigned to', { exact: true }).selectOption({ label: '🦔 Shea' });
  await sheet.getByLabel('Due', { exact: true }).fill(due);
  // Server mode sends no per-item reminders (only Profile's notifications), so the sheet doesn't offer them.
  await expect(sheet.getByText('Notify', { exact: true })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  const kettle = rowFor(b, 'Descale the kettle', 'Kitchen');
  await expect(kettle).toHaveAccessibleName(/^Descale the kettle ?, Urgent, In 5 days, Shea, has a note\.$/, { timeout: SYNC_MS });
  await expect(meta(area(b, 'Kitchen'), 'Descale the kettle')).toHaveText(taskMeta('red', due));
  await expect(who(area(b, 'Kitchen'), 'Descale the kettle')).toHaveText('🦔Shea');

  // Shea edits a To do: title, note, status, due date and who.
  await quiet(stratis);
  sheet = await openItem(b, area(b, 'Living Room'), 'Remove AC');
  const later = londonDate(13);
  await sheet.getByLabel('Title', { exact: true }).fill('Remove the AC unit');
  await sheet.getByLabel('Note', { exact: true }).fill('Bracket bolts are 13 mm.');
  await sheet.getByRole('radiogroup', { name: 'How urgent?' }).getByText('Urgent', { exact: true }).click();
  await sheet.getByLabel('Due', { exact: true }).fill(later);
  await sheet.getByLabel('Assigned to', { exact: true }).selectOption({ label: '🦆 Stratis' });
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  const ac = rowFor(a, 'Remove the AC unit', 'Living Room');
  await expect(ac).toHaveAccessibleName(/^Remove the AC unit ?, Urgent, In 13 days, Stratis, has a note\.$/, { timeout: SYNC_MS });
  await expect(meta(area(a, 'Living Room'), 'Remove the AC unit')).toHaveText(taskMeta('red', later));
  await expect(who(area(a, 'Living Room'), 'Remove the AC unit')).toHaveText('🦆Stratis');
  sheet = await openItem(a, area(a, 'Living Room'), 'Remove the AC unit');
  await expect(sheet.getByLabel('Note', { exact: true })).toHaveValue('Bracket bolts are 13 mm.');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(rowFor(a, 'Remove AC', 'Living Room')).toHaveCount(0);

  // Stratis writes what good looks like for a To maintain, and calls it Okay.
  await quiet(shea);
  const good = 'Watered twice a week.\nNo yellow leaves.\nPots drained after rain.';
  sheet = await openItem(a, area(a, 'Garden'), 'Plants healthy');
  await sheet.getByRole('textbox', { name: 'What good looks like', exact: true }).fill(good);
  await sheet.getByRole('radiogroup', { name: 'Condition' }).getByText('Okay', { exact: true }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(rowFor(b, 'Plants healthy', 'Garden')).toHaveAccessibleName(/^Plants healthy ?, to maintain, Okay,/, {
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
  // Urgent carries over as Needs work.
  await expect(rowFor(a, 'Fix the cracks on the wall', 'Living Room')).toHaveAccessibleName(
    /^Fix the cracks on the wall ?, to maintain, Needs work,/,
    { timeout: SYNC_MS },
  );
  await expect(ring(area(a, 'Living Room'), 'Fix the cracks on the wall')).toHaveCount(0);

  // Stratis marks one of his done: gone on Shea's phone; Undo brings it back there too.
  await quiet(shea);
  await ring(area(a, 'Garden'), 'Install leaf blower').click();
  const undo = toast(a, 'Marked as done').getByRole('button', { name: 'Undo' });
  await undo.focus(); // holds the toast while we look at the other phone
  await expect(rowFor(b, 'Install leaf blower', 'Garden')).toHaveCount(0, { timeout: SYNC_MS });
  await quiet(shea);
  await undo.click();
  await expect(rowFor(b, 'Install leaf blower', 'Garden')).toBeVisible({ timeout: SYNC_MS });
  await expect(meta(area(b, 'Garden'), 'Install leaf blower')).toHaveText(taskMeta('amber', '2026-10-16'));
  await expect(who(area(b, 'Garden'), 'Install leaf blower')).toHaveText('🦆Stratis');

  // Shea does a monthly one: Stratis sees its next date, and her count in Stats.
  await quiet(stratis);
  await ring(area(b, 'Jacuzzi'), 'Change the filter').click();
  await expect(toast(b, /^Done\. Next one/)).toBeVisible();
  // Monthly: next on Sat 21 Nov.
  await expect(meta(area(a, 'Jacuzzi'), 'Change the filter')).toHaveText(taskMeta('green', '2026-11-21'), {
    timeout: SYNC_MS,
  });
  await goToTab(a, 'Stats');
  await statsScreen(a).getByRole('radio', { name: 'Lifetime' }).click();
  await expect(statsScreen(a).getByRole('img', { name: /tasks? done/ })).toHaveAccessibleName('4 tasks done in total: Stratis 1, Shea 3.');
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
  await expect(area(b, 'Shed').getByText('All clear', { exact: true })).toBeVisible({ timeout: SYNC_MS });

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

test('people: an emoji, a name, someone added (then invited) and someone removed show on the other phone', async () => {
  const a = stratis.page;
  const b = shea.page;

  // Shea picks another emoji: Stratis sees it on her items.
  await quiet(stratis);
  let profile = await openProfile(b);
  await profile.getByRole('radiogroup', { name: 'Your emoji' }).getByRole('radio', { name: '🐧' }).click();
  await closeProfile(b);
  await expect(who(area(a, 'Jacuzzi'), 'Check Chemicals')).toHaveText('🐧Shea', {
    timeout: SYNC_MS,
  });

  // Stratis adds Kim (name and emoji only), who hasn't joined.
  await quiet(shea);
  const dialog = await openHousehold(a);
  await people(dialog).getByRole('button', { name: 'Add Person' }).click();
  const newName = dialog.getByPlaceholder('Name', { exact: true });
  await expect(newName).toBeFocused();
  await settled(newName);
  await expect(dialog.getByRole('textbox', { name: 'Google Email' })).toHaveCount(0);
  await expect(dialog.getByText('Then send them a code from their page.')).toBeVisible();
  await newName.fill('Kim');
  await dialog.getByRole('radiogroup', { name: 'Emoji', exact: true }).getByRole('radio', { name: '🐳' }).click();
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(personRow(dialog, 'Kim')).toHaveText('🐳Kim, Not joined yet');
  await expectPerson(b, 'Kim, 0 items, not joined yet', SYNC_MS);

  // Stratis renames Kim before inviting her.
  await quiet(shea);
  await openPersonPage(dialog, 'Kim');
  const name = dialog.getByRole('textbox', { name: 'Name', exact: true }).last();
  await name.fill('Kim L');
  await name.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Invite Kim L' })).toBeVisible();
  await expectPerson(b, 'Kim L, 0 items, not joined yet', SYNC_MS);

  // Shea, in her People, sees Kim L too; Stratis removes Kim L, and she is gone there too.
  profile = await openHousehold(b);
  await expect(personRow(profile, 'Kim L')).toHaveText('🐳Kim L, Not joined yet');
  await quiet(shea);
  await dialog.getByRole('button', { name: 'Remove Kim L' }).click();
  await (await confirmation(a, 'Remove Kim L?')).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(personRow(dialog, 'Kim L')).toHaveCount(0);
  await expect(personRow(profile, 'Kim L')).toHaveCount(0, { timeout: SYNC_MS });
  await expect(people(profile).getByRole('button')).toHaveText(['🦆Stratis', '🐧Shea, You', 'Add Person']);
  await closeHousehold(b, profile);
  await closeHousehold(a, dialog);

  await expectNoReload(stratis);
  await expectNoReload(shea);
});

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

test('chat: a message, a reaction on and off, and a delete show on the other phone', async () => {
  const a = stratis.page;
  const b = shea.page;
  await goToTab(a, 'Chat');
  await goToTab(b, 'Chat');
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
  await expect(messageRow(a, 'Bins go out tonight.').getByRole('button', { name: '❤️, 1 reaction from Shea' })).toBeVisible({
    timeout: SYNC_MS,
  });
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

  // A message while Stratis is on Home: the Chat tab says there is something unread.
  await goToTab(a, 'Home');
  await quiet(stratis);
  await chatScreen(b).getByRole('textbox', { name: 'Message' }).fill('Back at six.');
  await chatScreen(b).getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(a.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Chat, unread messages' })).toBeVisible({
    timeout: SYNC_MS,
  });

  await expectNoReload(stratis);
  await expectNoReload(shea);
});

// ── Housekeeping ─────────────────────────────────────────

const today = (screen: Locator) => screen.getByRole('region', { name: 'Today', exact: true });
const calendar = (screen: Locator) => screen.getByRole('region', { name: 'Calendar', exact: true });
const grid = (screen: Locator) => screen.getByRole('grid');
const day = (screen: Locator, name: string) => grid(screen).getByRole('button', { name: new RegExp(`^${name}(,|$)`) });
const detail = (screen: Locator) => screen.locator('[data-day-detail]');
const noteField = (screen: Locator) => screen.getByRole('textbox', { name: 'Message for the housekeeper' });

/** The Monday of the week a day (YYYY-MM-DD) is in: the calendar's week strip starts there. */
function mondayOf(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** "Friday 9 October" for 2026-10-09 (the calendar's day names). */
function longDay(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const rest = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `${weekday} ${rest}`;
}

/** The task titles of a checklist, top to bottom, and which are ticked. */
async function checklist(group: Locator): Promise<{ title: string; done: boolean }[]> {
  return group.getByRole('checkbox').evaluateAll((boxes) =>
    boxes.map((box) => ({
      title: document.getElementById(box.getAttribute('aria-labelledby')!)!.textContent ?? '',
      done: (box as HTMLInputElement).checked,
    })),
  );
}

test('housekeeping: the message, ticks, comments, price, the task list and visits show on the other phone', async () => {
  const a = stratis.page;
  const b = shea.page;
  await goToTab(a, 'Housekeeping');
  await goToTab(b, 'Housekeeping');
  const sa = housekeepingScreen(a);
  const sb = housekeepingScreen(b);
  await expect(today(sa).getByRole('group', { name: 'Tasks today' })).toBeVisible();
  await expect(today(sb).getByRole('group', { name: 'Tasks today' })).toBeVisible();
  await quiet(stratis);
  await quiet(shea);

  // Shea writes the message for the housekeeper.
  await noteField(sb).fill('Please do the oven this week.');
  await noteField(sb).blur();
  await expect(noteField(sa)).toHaveValue('Please do the oven this week.', { timeout: SYNC_MS });

  // Stratis ticks a task: today's visit starts on both phones.
  await quiet(shea);
  await today(sa).getByRole('checkbox', { name: 'Clean the kitchen' }).click();
  await expect(today(sb).getByRole('checkbox', { name: 'Clean the kitchen' })).toBeChecked({ timeout: SYNC_MS });

  // Shea writes the comments and the price.
  await quiet(stratis);
  const comments = today(sb).getByRole('textbox', { name: 'Comments', exact: true });
  await comments.fill('Out of bin bags.');
  await comments.blur();
  const price = today(sb).getByRole('textbox', { name: 'Price for the day', exact: true });
  await price.fill('45');
  await price.press('Enter');
  await expect(today(sa).getByRole('textbox', { name: 'Comments', exact: true })).toHaveValue('Out of bin bags.', { timeout: SYNC_MS });
  await expect(today(sa).getByRole('textbox', { name: 'Price for the day', exact: true })).toHaveValue('45.00', { timeout: SYNC_MS });

  // Stratis adds a task to the list and renames one.
  await quiet(shea);
  await today(sa).getByRole('button', { name: 'Edit task list' }).click();
  const list = a.getByRole('dialog', { name: 'Task list' });
  const done = list.getByRole('button', { name: 'Done' });
  await settled(done);
  const names = list.getByRole('textbox', { name: 'Task name' });
  await names.last().fill('Ironing and folding');
  await names.last().press('Enter');
  await list.getByRole('button', { name: 'Add Task' }).click();
  await expect(names.last()).toBeFocused();
  await a.keyboard.type('Clean the windows');
  await a.keyboard.press('Enter');
  await done.click();
  await expect(list).toHaveCount(0);
  await expect
    .poll(async () => (await checklist(today(sb).getByRole('group', { name: 'Tasks today' }))).map((t) => t.title), { timeout: SYNC_MS })
    .toEqual([
      'Change the bed sheets',
      'Hoover and mop the floors',
      'Clean the bathrooms',
      'Clean the kitchen',
      'Dust the surfaces',
      'Empty the bins',
      'Ironing and folding',
      'Clean the windows',
    ]);

  // Shea adds a visit on a past day: Stratis's calendar shows it.
  await quiet(stratis);
  const past = londonDate(-2);
  if (mondayOf(past) !== mondayOf(londonDate())) {
    for (const s of [sa, sb]) await calendar(s).getByRole('button', { name: 'Previous week' }).click();
  }
  const pastName = longDay(past);
  await day(sb, pastName).click();
  await detail(sb).getByRole('button', { name: 'Add a visit' }).click();
  await detail(sb).getByRole('group', { name: `Tasks on ${pastName}` }).getByRole('checkbox', { name: 'Clean the windows' }).click();
  await expect(day(sa, pastName)).toHaveAttribute('data-visit', 'true', { timeout: SYNC_MS });
  await expect(day(sa, pastName)).toHaveAccessibleName(new RegExp(`^${pastName}, visit, 1 of 8 done`));

  // Stratis deletes it again.
  await quiet(shea);
  await day(sa, pastName).click();
  await detail(sa).getByRole('button', { name: 'Delete Visit' }).click();
  await (await confirmation(a, `Delete the visit on ${dayLabel(past)}?`)).getByRole('button', { name: 'Delete Visit' }).click();
  await expect(day(sb, pastName)).not.toHaveAttribute('data-visit', 'true', { timeout: SYNC_MS });

  // Shea clears the message.
  await quiet(stratis);
  await sb.getByRole('button', { name: 'Clear message' }).click();
  await expect(noteField(sa)).toHaveValue('', { timeout: SYNC_MS });
  // Back to today on Stratis's phone: today's visit is the only one left.
  await calendar(sa).getByRole('button', { name: 'Today', exact: true }).click();
  await expect(calendar(sa).locator('[role="grid"] [data-visit]')).toHaveCount(1);
  await expect(calendar(sa).locator('[data-today-summary]')).toHaveText(/^1 of 8 done today/);

  await expectNoReload(stratis);
  await expectNoReload(shea);
});

test('housekeeping sections: added, filled, renamed, reordered and deleted on one phone show on the other', async () => {
  const a = stratis.page;
  const b = shea.page;
  await goToTab(a, 'Housekeeping');
  await goToTab(b, 'Housekeeping');
  const sa = housekeepingScreen(a);
  const sb = housekeepingScreen(b);
  const tasksA = today(sa).getByRole('group', { name: 'Tasks today' });
  const tasksB = today(sb).getByRole('group', { name: 'Tasks today' });
  await expect(tasksA).toBeVisible();
  await expect(tasksB).toBeVisible();
  /** Today's section headings as heard: "Kitchen, 1 of 2 done". */
  const headings = (tasks: Locator) =>
    tasks.getByRole('heading', { level: 3 }).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  const openList = async (page: Page, screen: Locator) => {
    await today(screen).getByRole('button', { name: 'Edit task list' }).click();
    const list = page.getByRole('dialog', { name: 'Task list' });
    await settled(list.getByRole('button', { name: 'Done' }));
    return list;
  };
  const closeList = async (list: Locator) => {
    await list.getByRole('button', { name: 'Done' }).click();
    await expect(list).toHaveCount(0);
  };
  const moveTo = async (page: Page, list: Locator, task: string, section: string) => {
    await list.getByRole('button', { name: `Move ${task} to a section` }).click();
    await page.getByRole('menu', { name: 'Move to Section' }).getByRole('menuitemradio', { name: section, exact: true }).click();
  };
  const sectionMenu = async (page: Page, list: Locator, section: string, item: string) => {
    await list.getByRole('button', { name: `${section} options` }).click();
    await page.getByRole('menu', { name: `${section} options` }).getByRole('menuitem', { name: item }).click();
  };
  await quiet(stratis);
  await quiet(shea);

  // Stratis adds two sections and moves tasks into them.
  let list = await openList(a, sa);
  for (const [name, tasks] of [
    ['Kitchen', ['Clean the kitchen', 'Empty the bins']],
    ['Bathrooms', ['Clean the bathrooms']],
  ] as const) {
    await list.getByRole('button', { name: 'Add Section' }).click();
    await expect(list.getByRole('textbox', { name: 'Section name' }).last()).toBeFocused();
    await a.keyboard.type(name);
    await a.keyboard.press('Enter');
    await expect(list.getByRole('group', { name, exact: true })).toBeVisible();
    for (const task of tasks) await moveTo(a, list, task, name);
  }
  await closeList(list);
  await expect.poll(() => headings(tasksB), { timeout: SYNC_MS }).toEqual(['Kitchen, 0 of 2 done', 'Bathrooms, 0 of 1 done']);
  expect((await checklist(tasksB)).map((t) => t.title)).toEqual([
    'Change the bed sheets',
    'Hoover and mop the floors',
    'Dust the surfaces',
    'Ironing',
    'Clean the kitchen',
    'Empty the bins',
    'Clean the bathrooms',
  ]);

  // Shea ticks in the kitchen: Stratis sees its progress.
  await quiet(stratis);
  await tasksB.getByRole('checkbox', { name: 'Clean the kitchen' }).click();
  await expect.poll(() => headings(tasksA), { timeout: SYNC_MS }).toEqual(['Kitchen, 1 of 2 done', 'Bathrooms, 0 of 1 done']);

  // Shea renames the kitchen and moves the bathrooms first.
  await quiet(stratis);
  list = await openList(b, sb);
  await sectionMenu(b, list, 'Kitchen', 'Rename');
  await expect(list.getByRole('group', { name: 'Kitchen', exact: true }).getByRole('textbox', { name: 'Section name' })).toBeFocused();
  await b.keyboard.type('Kitchen and utility');
  await b.keyboard.press('Enter');
  await expect(list.getByRole('group', { name: 'Kitchen and utility', exact: true })).toBeVisible();
  await sectionMenu(b, list, 'Bathrooms', 'Move Up');
  await closeList(list);
  await expect
    .poll(() => headings(tasksA), { timeout: SYNC_MS })
    .toEqual(['Bathrooms, 0 of 1 done', 'Kitchen and utility, 1 of 2 done']);

  // Stratis deletes the kitchen: its tasks go to the top on both phones, the tick kept.
  await quiet(shea);
  list = await openList(a, sa);
  await sectionMenu(a, list, 'Kitchen and utility', 'Delete Section');
  await (await confirmation(a, 'Delete Kitchen and utility?')).getByRole('button', { name: 'Delete Section' }).click();
  await closeList(list);
  await expect.poll(() => headings(tasksB), { timeout: SYNC_MS }).toEqual(['Bathrooms, 0 of 1 done']);
  expect(await checklist(tasksB)).toEqual([
    { title: 'Change the bed sheets', done: false },
    { title: 'Hoover and mop the floors', done: false },
    { title: 'Dust the surfaces', done: false },
    { title: 'Ironing', done: false },
    { title: 'Clean the kitchen', done: true },
    { title: 'Empty the bins', done: false },
    { title: 'Clean the bathrooms', done: false },
  ]);

  await expectNoReload(stratis);
  await expectNoReload(shea);
});

test('three phones: two people writing at the same moment never lose a change', async ({ browser, baseURL }) => {
  // Stratis's tablet watches as well.
  const tablet = await openDevice(browser, baseURL!, { signIn: { code: await codeFor(stratis.context, 'Stratis') } });
  await expect(homeHeading(tablet.page)).toBeVisible();
  const a = stratis.page;
  const b = shea.page;
  const c = tablet.page;

  // Both edit different fields of one item and save at once: the note, and how urgent it is.
  const sa = await openItem(a, area(a, 'Jacuzzi'), 'Check Chemicals');
  const sb = await openItem(b, area(b, 'Jacuzzi'), 'Check Chemicals');
  await sa.getByLabel('Note', { exact: true }).fill('Chlorine tablets are in the shed.');
  await sb.getByRole('radiogroup', { name: 'How urgent?' }).getByText('Urgent', { exact: true }).click();
  await Promise.all([sa.getByRole('button', { name: 'Save' }).click(), sb.getByRole('button', { name: 'Save' }).click()]);
  await expect(sa).toHaveCount(0);
  await expect(sb).toHaveCount(0);
  for (const page of [a, b, c]) {
    const row = rowFor(page, 'Check Chemicals', 'Jacuzzi');
    await expect(row).toHaveAccessibleName(/^Check Chemicals ?, Urgent, .*, has a note\.$/, { timeout: SYNC_MS });
  }
  for (const page of [a, b, c]) {
    const sheet = await openItem(page, area(page, 'Jacuzzi'), 'Check Chemicals');
    await expect(sheet.getByLabel('Note', { exact: true })).toHaveValue('Chlorine tablets are in the shed.');
    await expect(sheet.getByRole('radio', { name: 'Urgent', exact: true })).toBeChecked();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
  }

  // Both tick a different To do at the same moment.
  await Promise.all([
    ring(area(a, 'Garden'), 'Install leaf blower').click(),
    ring(area(b, 'Living Room'), 'Remove AC').click(),
  ]);
  for (const page of [a, b, c]) {
    await expect(rowFor(page, 'Install leaf blower', 'Garden')).toHaveCount(0, { timeout: SYNC_MS });
    await expect(rowFor(page, 'Remove AC', 'Living Room')).toHaveCount(0, { timeout: SYNC_MS });
  }

  // A message and a tick of a housekeeping task at the same moment, and two ticks at once.
  await goToTab(a, 'Housekeeping');
  await goToTab(b, 'Chat');
  await goToTab(c, 'Housekeeping');
  const ha = housekeepingScreen(a);
  const hc = housekeepingScreen(c);
  await expect(today(ha).getByRole('group', { name: 'Tasks today' })).toBeVisible();
  await chatScreen(b).getByRole('textbox', { name: 'Message' }).fill('Leaving the key under the mat.');
  await Promise.all([
    chatScreen(b).getByRole('textbox', { name: 'Message' }).press('Enter'),
    today(ha).getByRole('checkbox', { name: 'Empty the bins' }).click(),
  ]);
  await expect(today(hc).getByRole('checkbox', { name: 'Empty the bins' })).toBeChecked({ timeout: SYNC_MS });
  await goToTab(b, 'Housekeeping');
  const hb = housekeepingScreen(b);
  await expect(today(hb).getByRole('checkbox', { name: 'Empty the bins' })).toBeChecked();
  await Promise.all([
    today(ha).getByRole('checkbox', { name: 'Ironing' }).click(),
    today(hb).getByRole('checkbox', { name: 'Dust the surfaces' }).click(),
  ]);
  for (const s of [ha, hb, hc]) {
    for (const task of ['Empty the bins', 'Ironing', 'Dust the surfaces']) {
      await expect(today(s).getByRole('checkbox', { name: task }), task).toBeChecked({ timeout: SYNC_MS });
    }
  }
  await goToTab(a, 'Chat');
  await expect(bubble(a, 'Leaving the key under the mat.')).toBeVisible({ timeout: SYNC_MS });

  // And it is all in the stored home, once.
  const stored = await loadHome(stratis.context);
  const chem = stored.items.find((i) => i.title === 'Check Chemicals')!;
  expect(chem).toMatchObject({ rag: 'red', note: 'Chlorine tablets are in the shed.' });
  // Both done: no longer open, and each has its completion (the phone's 3, then these 2).
  expect(stored.items.filter((i) => ['Install leaf blower', 'Remove AC'].includes(i.title))).toEqual([]);
  expect(stored.completions).toHaveLength(5);
  const visit = stored.housekeeping.visits.find((v) => v.visit_date === londonDate())!;
  const ticked = visit.tasks
    .filter((t) => t.done)
    .map((t) => t.title)
    .sort();
  expect(ticked).toEqual(['Dust the surfaces', 'Empty the bins', 'Ironing']);

  await expectNoReload(stratis);
  await expectNoReload(shea);
  await expectNoReload(tablet);
  await tablet.context.close();
});

test('a phone that was offline catches up as soon as it is back online; a hidden one waits until it is seen', async () => {
  const a = stratis.page;
  const b = shea.page;
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
  await b.waitForTimeout(2_000);
  await expect(rowFor(b, 'Bleed the radiators', 'Living Room')).toHaveCount(0);

  // Back online: it polls at once.
  await shea.context.setOffline(false);
  await expect(rowFor(b, 'Bleed the radiators', 'Living Room')).toBeVisible({ timeout: SYNC_MS });

  // And it hears the next change by polling again.
  await quiet(shea);
  await openItem(a, area(a, 'Living Room'), 'Bleed the radiators').then(async (s) => {
    await s.getByRole('radiogroup', { name: 'How urgent?' }).getByText('Not urgent', { exact: true }).click();
    await s.getByRole('button', { name: 'Save' }).click();
    await expect(s).toHaveCount(0);
  });
  await expect(rowFor(b, 'Bleed the radiators', 'Living Room')).toHaveAccessibleName(/^Bleed the radiators ?, Not urgent,/, {
    timeout: SYNC_MS,
  });

  // A phone in someone's pocket (the page hidden) asks nothing; seen again, it catches up at once.
  const versionCalls: string[] = [];
  b.on('request', (req) => {
    if (req.url().includes('op=version')) versionCalls.push(req.url());
  });
  await b.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await b.waitForTimeout(500);
  versionCalls.length = 0;
  await ring(area(a, 'Garden'), 'Install leaf blower').click();
  await b.waitForTimeout(4_000);
  expect(versionCalls, 'no polls while hidden').toEqual([]);
  await expect(rowFor(b, 'Install leaf blower', 'Garden')).toBeVisible();
  await b.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(rowFor(b, 'Install leaf blower', 'Garden')).toHaveCount(0, { timeout: 2_000 });

  // The browser logs the requests that failed while offline; nothing else may go wrong.
  shea.errors.splice(0, shea.errors.length, ...shea.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e)));
  await expectNoReload(stratis);
  await expectNoReload(shea);
});
