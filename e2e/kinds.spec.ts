import {
  area,
  detailValue,
  expect,
  homeScreen,
  itemSheet,
  meta,
  openItem,
  openNewItem,
  openSeeded,
  reopen,
  ring,
  settled,
  test,
  titlesIn,
  toast,
  type Locator,
  type Page,
} from './fixtures';

// "To do" (task) and "To maintain" (state) items. A state has a solid dot instead of the
// ring, is never completed, has no due date, repeat or reminder, and reads
// "<who> · Updated <day>" on Home.

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
});

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A state's row button, by its accessible name "<title>, Green, to maintain. …" (Chromium
 * puts a space before the comma, as it does for to-do rows).
 */
function stateName(title: string): RegExp {
  return new RegExp(`^${escape(title)} ?, (Red|Amber|Green), to maintain\\.`);
}

function stateButton(page: Page, title: string): Locator {
  return homeScreen(page).getByRole('button', { name: stateName(title) });
}

function stateRow(page: Page, title: string): Locator {
  // `has` is matched inside each list item.
  return homeScreen(page).getByRole('listitem').filter({ has: page.getByRole('button', { name: stateName(title) }) });
}

/** The meta line of a state's row: `🦊 Ela · Updated Thu 8 Oct`. */
function stateMeta(page: Page, title: string): Locator {
  return stateButton(page, title).locator('[data-meta]');
}

/** Focuses a control as the keyboard would (so it matches :focus-visible). */
async function keyboardFocus(control: Locator): Promise<void> {
  await control.focus();
  await expect.poll(() => control.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
}

/** The solid dot in a state's row. */
function dot(page: Page, title: string): Locator {
  return stateRow(page, title).locator('[data-rag]');
}

/** Opens a state from its Home row; resolves once the sheet is in place. */
async function openState(page: Page, title: string): Promise<Locator> {
  await stateButton(page, title).click();
  const sheet = itemSheet(page);
  await settled(sheet.getByRole('button', { name: 'Close' }));
  return sheet;
}

/** Row titles in an area, top to bottom, tasks and states alike. */
async function rowTitlesIn(page: Page, areaName: string): Promise<string[]> {
  return area(page, areaName)
    .locator('[data-item-open] > span:first-child')
    .evaluateAll((els) => els.map((el) => el.firstChild?.textContent ?? ''));
}

const GREEN = 'rgb(52, 199, 89)';
const RED = 'rgb(255, 59, 48)';
const AMBER = 'rgb(255, 149, 0)';

/** The rows a To do has and a To maintain does not (Mark as Done only once it exists). */
async function expectTaskRows(sheet: Locator, shown: boolean, saved = true): Promise<void> {
  for (const label of ['Due', 'Repeat', 'Notify', 'Assigned to']) {
    await expect(sheet.getByLabel(label, { exact: true }), label).toHaveCount(shown ? 1 : 0);
  }
  await expect(sheet.getByLabel('Looked after by', { exact: true })).toHaveCount(shown ? 0 : 1);
  await expect(sheet.getByRole('button', { name: 'Mark as Done' })).toHaveCount(shown && saved ? 1 : 0);
}

test.describe('To maintain', () => {
  test('the seeded Firepit is a state in the Garden: a solid dot, after the to-dos, "Updated"', async ({ page }) => {
    const firepit = stateRow(page, 'Firepit');
    await expect(firepit).toBeVisible();
    await expect(firepit).toContainText("New one installed. Keep the cover on when it's not in use.");
    await expect(stateMeta(page, 'Firepit')).toHaveText('🦊 Ela · Updated Thu 8 Oct');
    // A solid dot in its RAG colour, not a ring and not a button.
    await expect(dot(page, 'Firepit')).toHaveCSS('background-color', GREEN);
    await expect(firepit.getByRole('button')).toHaveCount(1);
    await expect(ring(page, 'Firepit')).toHaveCount(0);
    // Assistive tech hears the status and the kind after the title.
    await expect(stateButton(page, 'Firepit')).toHaveAccessibleName(/^Firepit ?, Green, to maintain\. New one installed/);
    // To-dos first (by date), then states (by title).
    expect(await rowTitlesIn(page, 'Garden')).toEqual(['Give away the old firepit', 'Garden room wall panel', 'Firepit']);
    expect(await titlesIn(page, 'Garden')).toEqual(['Give away the old firepit', 'Garden room wall panel']);
  });

  test('cannot be completed from Home: tapping the dot opens it instead', async ({ page }) => {
    await dot(page, 'Firepit').click({ force: true });
    const sheet = itemSheet(page);
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await expect(sheet.getByLabel('Title', { exact: true })).toHaveValue('Firepit');
    await expect(page.locator('[data-confetti] > div > *')).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(stateRow(page, 'Firepit')).toBeVisible();
    await expect(toast(page, /done/i)).toHaveCount(0);
  });

  test('opens from the keyboard', async ({ page }) => {
    const open = stateButton(page, 'Firepit');
    await keyboardFocus(open);
    await page.keyboard.press('Enter');
    const sheet = itemSheet(page);
    await expect(sheet).toBeFocused();
    await expect(sheet.getByLabel('Title', { exact: true })).toHaveValue('Firepit');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test('the sheet has no Due, Repeat, Notify or Mark as Done, and says "Looked after by"', async ({ page }) => {
    const sheet = await openState(page, 'Firepit');
    const kinds = sheet.getByRole('radiogroup', { name: 'Type' });
    await expect(kinds.getByRole('radio')).toHaveText(['To do', 'To maintain']);
    await expect(kinds.getByRole('radio', { name: 'To maintain' })).toHaveAttribute('aria-checked', 'true');
    await expect(sheet.getByRole('radiogroup', { name: 'Status' }).getByRole('radio')).toHaveCount(3);
    await expect(sheet.getByRole('radio', { name: 'Green' })).toBeChecked();
    await expect(sheet.getByRole('radiogroup', { name: 'Status' })).toContainText('RedAmberGreen');
    await expectTaskRows(sheet, false);
    await expect(detailValue(sheet, 'Looked after by')).toHaveText('🦊 Ela');
    await expect(detailValue(sheet, 'Area')).toHaveText('Garden');
    await expect(sheet.getByRole('button', { name: 'Delete' })).toBeVisible();
  });

  test('creates a To maintain item: no due date, repeat or reminder; a dot and an Updated line', async ({ page }) => {
    const sheet = await openNewItem(page);
    const kinds = sheet.getByRole('radiogroup', { name: 'Type' });
    await expect(kinds.getByRole('radio', { name: 'To do' })).toHaveAttribute('aria-checked', 'true');
    await expectTaskRows(sheet, true, false);

    await sheet.getByLabel('Title', { exact: true }).fill('Jacuzzi water');
    await sheet.getByLabel('Note', { exact: true }).fill('Cloudy after the party.');
    await kinds.getByRole('radio', { name: 'To maintain' }).click();
    await expect(kinds.getByRole('radio', { name: 'To maintain' })).toHaveAttribute('aria-checked', 'true');
    for (const label of ['Due', 'Repeat', 'Notify', 'Assigned to']) {
      await expect(sheet.getByLabel(label, { exact: true }), label).toHaveCount(0);
    }
    await sheet.getByLabel('Area', { exact: true }).selectOption({ label: 'Jacuzzi' });
    await sheet.getByRole('radiogroup', { name: 'Status' }).getByText('Red', { exact: true }).click();
    await sheet.getByLabel('Looked after by', { exact: true }).selectOption({ label: '🦆 Shea' });
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);

    const created = stateRow(page, 'Jacuzzi water');
    await expect(created).toContainText('Cloudy after the party.');
    await expect(stateMeta(page, 'Jacuzzi water')).toHaveText('🦆 Shea · Updated Thu 8 Oct');
    await expect(dot(page, 'Jacuzzi water')).toHaveCSS('background-color', RED);
    await expect(ring(page, 'Jacuzzi water')).toHaveCount(0);
    expect(await rowTitlesIn(page, 'Jacuzzi')).toEqual(['Water test strips running low', 'Change the filter', 'Jacuzzi water']);

    // Reopened: still a state with no task rows. Survives a reload.
    await reopen(page);
    const again = await openState(page, 'Jacuzzi water');
    await expect(again.getByRole('radio', { name: 'To maintain' })).toHaveAttribute('aria-checked', 'true');
    await expectTaskRows(again, false);
    await expect(detailValue(again, 'Looked after by')).toHaveText('🦆 Shea');
  });

  test('editing a state to a To do restores the task rows with the new-item defaults', async ({ page }) => {
    const sheet = await openState(page, 'Firepit');
    await sheet.getByRole('radio', { name: 'To do' }).click();
    await expectTaskRows(sheet, true);
    await expect(sheet.getByLabel('Due', { exact: true })).toHaveValue('2026-10-15');
    await expect(detailValue(sheet, 'Due')).toHaveText('Thu 15 Oct');
    await expect(detailValue(sheet, 'Assigned to')).toHaveText('🦊 Ela');
    await expect(detailValue(sheet, 'Repeat')).toHaveText('Never');
    await expect(detailValue(sheet, 'Notify')).toHaveText('1 day before');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);

    // Now a to-do: the ring is back, with a due date, sorted with the other to-dos.
    await expect(stateRow(page, 'Firepit')).toHaveCount(0);
    await expect(ring(page, 'Firepit')).toHaveCSS('border-top-color', GREEN);
    await expect(meta(page, 'Firepit')).toHaveText('🦊 Ela · Thu 15 Oct');
    expect(await titlesIn(page, 'Garden')).toEqual(['Give away the old firepit', 'Firepit', 'Garden room wall panel']);

    // And it can be completed like any to-do.
    await ring(page, 'Firepit').click();
    await expect(ring(page, 'Firepit')).toHaveCount(0);
    await expect(toast(page, 'Marked as done')).toBeVisible();
  });

  test('editing a To do to To maintain drops its due date and its ring', async ({ page }) => {
    const sheet = await openItem(page, 'Mirror lights not level');
    await expectTaskRows(sheet, true);
    await sheet.getByRole('radio', { name: 'To maintain' }).click();
    await expectTaskRows(sheet, false);
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);

    await expect(ring(page, 'Mirror lights not level')).toHaveCount(0);
    await expect(dot(page, 'Mirror lights not level')).toHaveCSS('background-color', AMBER);
    await expect(stateMeta(page, 'Mirror lights not level')).toHaveText('Unassigned · Updated Thu 8 Oct');
    await expect(area(page, 'Living Room').getByText('Nothing to do')).toHaveCount(0);
  });

  test('switching kinds back and forth without saving changes nothing', async ({ page }) => {
    const sheet = await openItem(page, 'Olive oil');
    await sheet.getByRole('radio', { name: 'To maintain' }).click();
    await sheet.getByRole('radio', { name: 'To do' }).click();
    await expect(detailValue(sheet, 'Repeat')).toHaveText('Monthly');
    await expect(detailValue(sheet, 'Due')).toHaveText('Thu 12 Nov');
    await sheet.getByRole('button', { name: 'Close' }).click();
    // Nothing to discard.
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(meta(page, 'Olive oil')).toHaveText('🦔 Stratis · Thu 12 Nov');
  });
});
