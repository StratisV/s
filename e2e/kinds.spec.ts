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

// "To do" (task) and "To maintain" (state) items. A state has a condition gauge instead of
// the ring, is never completed, has no due date, repeat or reminder, and reads
// "<condition> · Updated <day>" on Home.

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
});

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A state's row button, by its accessible name "<title>, to maintain, Good, …" (Chromium
 * puts a space before the comma, as it does for to-do rows).
 */
function stateName(title: string): RegExp {
  return new RegExp(`^${escape(title)} ?, to maintain, (Needs work|Okay|Good),`);
}

function stateButton(page: Page, title: string): Locator {
  return homeScreen(page).getByRole('button', { name: stateName(title) });
}

function stateRow(page: Page, title: string): Locator {
  // `has` is matched inside each list item.
  return homeScreen(page).getByRole('listitem').filter({ has: page.getByRole('button', { name: stateName(title) }) });
}

/** The quiet line of a state's row: `Good·Updated today`, its condition in words. */
function stateMeta(page: Page, title: string): Locator {
  return stateButton(page, title).locator('[data-meta]');
}

/** Focuses a control as the keyboard would (so it matches :focus-visible). */
async function keyboardFocus(control: Locator): Promise<void> {
  // A key press first, so focus is shown even after a tap (Home's view switch, say).
  await control.page().keyboard.press('Shift');
  await control.focus();
  await expect.poll(() => control.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
}

/** The condition gauge in a state's row, in the ring's place: three bars, as many filled as it is good. */
function gauge(page: Page, title: string): Locator {
  return stateRow(page, title).locator('[data-variant="row"]');
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
    .locator('[data-item-open]')
    .evaluateAll((els) => els.map((el) => (el.textContent ?? '').split(',')[0].trim()));
}

const GREEN = 'rgb(52, 199, 89)';
const RED = 'rgb(255, 59, 48)';
const AMBER = 'rgb(255, 149, 0)';

/** The colour of a gauge's filled bars, and how many there are. */
async function filled(g: Locator): Promise<{ colour: string; bars: number }> {
  const on = g.locator('[data-on]');
  return { colour: await on.first().evaluate((el) => getComputedStyle(el).backgroundColor), bars: await on.count() };
}

/** The rows a To do has and a To maintain does not (Mark as Done only once it exists). */
async function expectTaskRows(sheet: Locator, shown: boolean, saved = true): Promise<void> {
  for (const label of ['Due', 'Repeat', 'Notify', 'Assigned to']) {
    await expect(sheet.getByLabel(label, { exact: true }), label).toHaveCount(shown ? 1 : 0);
  }
  await expect(sheet.getByLabel('Looked after by', { exact: true })).toHaveCount(shown ? 0 : 1);
  await expect(sheet.getByRole('button', { name: 'Mark as Done' })).toHaveCount(shown && saved ? 1 : 0);
}

test.describe('To maintain', () => {
  test('the seeded Firepit is a state in the Garden: a gauge, under "Looking after", "Good", "Updated"', async ({ page }) => {
    const firepit = stateRow(page, 'Firepit');
    await expect(firepit).toBeVisible();
    // The note is in the sheet, not on Home.
    await expect(firepit).not.toContainText('New one installed');
    await expect(stateMeta(page, 'Firepit')).toHaveText('Good·Updated today');
    await expect(stateButton(page, 'Firepit').locator('[data-who]')).toHaveText('🦊Ela');
    // A gauge in its colour, all three bars for Good: not a ring and not a button.
    expect(await filled(gauge(page, 'Firepit'))).toEqual({ colour: GREEN, bars: 3 });
    await expect(firepit.getByRole('button')).toHaveCount(1);
    await expect(ring(page, 'Firepit')).toHaveCount(0);
    // Assistive tech hears the kind and the condition after the title.
    await expect(stateButton(page, 'Firepit')).toHaveAccessibleName(
      /^Firepit ?, to maintain, Good, Ela, updated today, has a note\.$/,
    );
    // To-dos first (most urgent first), then, under "Looking after", the things it looks after.
    expect(await rowTitlesIn(page, 'Garden')).toEqual(['Garden room wall panel', 'Give away the old firepit', 'Firepit']);
    expect(await titlesIn(page, 'Garden')).toEqual(['Garden room wall panel', 'Give away the old firepit']);
    await expect(area(page, 'Garden').getByText('Looking after', { exact: true })).toBeVisible();
  });

  test('cannot be completed from Home: tapping the gauge opens it instead', async ({ page }) => {
    await gauge(page, 'Firepit').click({ force: true });
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
    // Its condition, in words, each with what it means.
    const condition = sheet.getByRole('radiogroup', { name: 'Condition' });
    await expect(condition.getByRole('radio')).toHaveCount(3);
    await expect(sheet.getByRole('radio', { name: 'Good' })).toBeChecked();
    await expect(condition).toContainText(/Needs work.*Not as it should be.*Okay.*Fine for now, keep an eye on it.*Good.*Just as it should be/);
    await expect(sheet.getByRole('radio', { name: 'Okay' })).toHaveAccessibleDescription('Fine for now, keep an eye on it');
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
    await sheet.getByRole('radiogroup', { name: 'Condition' }).getByText('Needs work', { exact: true }).click();
    await sheet.getByLabel('Looked after by', { exact: true }).selectOption({ label: '🦆 Shea' });
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);

    const created = stateRow(page, 'Jacuzzi water');
    await expect(created).toBeVisible();
    await expect(stateMeta(page, 'Jacuzzi water')).toHaveText('Needs workUpdated today');
    expect(await filled(gauge(page, 'Jacuzzi water'))).toEqual({ colour: RED, bars: 1 });
    // It needs work: the room says so, in red.
    await expect(area(page, 'Jacuzzi').locator('h2 + span')).toHaveText('1 needs work');
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
    await expect(sheet.getByLabel('Due', { exact: true })).toHaveValue('');
    await expect(detailValue(sheet, 'Due')).toHaveText('None');
    await expect(detailValue(sheet, 'Assigned to')).toHaveText('🦊 Ela');
    await expect(detailValue(sheet, 'Repeat')).toHaveText('Never');
    await expect(detailValue(sheet, 'Notify')).toHaveText('1 day before');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);

    // Now a to-do: the ring is back, with no date yet, after the dated to-dos as urgent as it.
    await expect(stateRow(page, 'Firepit')).toHaveCount(0);
    await expect(ring(page, 'Firepit')).toBeVisible();
    await expect(meta(page, 'Firepit')).toHaveText('Not urgent');
    expect(await titlesIn(page, 'Garden')).toEqual(['Garden room wall panel', 'Give away the old firepit', 'Firepit']);

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
    // Its colour carries over as its condition: amber is Okay, two bars.
    expect(await filled(gauge(page, 'Mirror lights not level'))).toEqual({ colour: AMBER, bars: 2 });
    await expect(stateMeta(page, 'Mirror lights not level')).toHaveText('Okay·Updated today');
    await expect(area(page, 'Living Room').getByText('All clear')).toHaveCount(0);
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
    await expect(meta(page, 'Olive oil')).toHaveText('Not urgent·In 5 weeks');
  });
});

test.describe('What good looks like', () => {
  const FIREPIT_GOOD = 'Cover on when not in use, ash cleared out, logs dry and stacked under the bench.';

  function goodField(sheet: Locator): Locator {
    return sheet.getByRole('textbox', { name: 'What good looks like', exact: true });
  }

  test('the seeded Firepit shows it between the type and the condition picker; a To do has none', async ({ page }) => {
    const sheet = await openState(page, 'Firepit');
    const field = goodField(sheet);
    await expect(field).toBeVisible();
    await expect(field).toHaveValue(FIREPIT_GOOD);
    // The note (how it is now) stays its own field.
    await expect(sheet.getByLabel('Note', { exact: true })).toHaveValue("New one installed. Keep the cover on when it's not in use.");
    // Laid out top to bottom: type, header, field, RAG picker.
    const header = sheet.getByText('What good looks like', { exact: true });
    const boxes = await Promise.all(
      [sheet.getByRole('radiogroup', { name: 'Type' }), header, field, sheet.getByRole('radiogroup', { name: 'Condition' })].map(
        async (l) => (await l.boundingBox())!,
      ),
    );
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height);
    // A white card the width of the others, the text wrapping inside it (nothing cut off).
    expect(Math.round(boxes[2].width)).toBe(Math.round(boxes[3].width));
    await expect(field).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    expect(await field.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    // Tapping the header puts the cursor in the field.
    await header.click();
    await expect(field).toBeFocused();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);

    const task = await openItem(page, 'Heaters not working');
    await expect(goodField(task)).toHaveCount(0);
    await expect(task.getByText('What good looks like', { exact: true })).toHaveCount(0);
  });

  test('adds a To maintain item with it: saved, kept when reopened and after a reload', async ({ page }) => {
    const sheet = await openNewItem(page);
    // A To do has no such field.
    await expect(goodField(sheet)).toHaveCount(0);
    await sheet.getByLabel('Title', { exact: true }).fill('Log store');
    await sheet.getByLabel('Note', { exact: true }).fill('Half full.');
    await sheet.getByRole('radio', { name: 'To maintain' }).click();

    const field = goodField(sheet);
    await expect(field).toBeVisible();
    await expect(field).toHaveValue('');
    await expect(field).toHaveAttribute('placeholder', 'Describe how it should be kept, e.g. cover on, logs dry and stacked');
    const empty = (await field.boundingBox())!.height;
    const good = 'Logs dry and stacked bark side up.\nKindling in the crate on the left.\nCover on when it rains.\nNo more than two rows deep.';
    await field.fill(good);
    // It grows with the text instead of scrolling.
    await expect.poll(async () => (await field.boundingBox())!.height).toBeGreaterThan(empty);
    expect(await field.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);

    // Switching to To do hides it; switching back brings the text back.
    await sheet.getByRole('radio', { name: 'To do' }).click();
    await expect(goodField(sheet)).toHaveCount(0);
    await sheet.getByRole('radio', { name: 'To maintain' }).click();
    await expect(goodField(sheet)).toHaveValue(good);

    await sheet.getByLabel('Area', { exact: true }).selectOption({ label: 'Garden' });
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(stateRow(page, 'Log store')).toBeVisible();

    const again = await openState(page, 'Log store');
    await expect(goodField(again)).toHaveValue(good);
    await expect(again.getByLabel('Note', { exact: true })).toHaveValue('Half full.');
    // An edit to it is a change: closing asks first.
    await goodField(again).fill(`${good}\nSweep the floor.`);
    await again.getByRole('button', { name: 'Close' }).click();
    const discard = page.getByRole('alertdialog', { name: 'Discard your changes?' });
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: 'Keep Editing' }).click();
    await again.getByRole('button', { name: 'Save' }).click();
    await expect(again).toHaveCount(0);

    await reopen(page);
    const reloaded = await openState(page, 'Log store');
    await expect(goodField(reloaded)).toHaveValue(`${good}\nSweep the floor.`);
    await expectTaskRows(reloaded, false);
  });

  test('a To maintain item turned into a To do keeps it, hidden, for when it is To maintain again', async ({ page }) => {
    const sheet = await openState(page, 'Firepit');
    await sheet.getByRole('radio', { name: 'To do' }).click();
    await expect(goodField(sheet)).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(ring(page, 'Firepit')).toBeVisible();

    const task = await openItem(page, 'Firepit');
    await expect(goodField(task)).toHaveCount(0);
    await task.getByRole('radio', { name: 'To maintain' }).click();
    await expect(goodField(task)).toHaveValue(FIREPIT_GOOD);
    await task.getByRole('button', { name: 'Save' }).click();
    await expect(task).toHaveCount(0);

    const state = await openState(page, 'Firepit');
    await expect(goodField(state)).toHaveValue(FIREPIT_GOOD);
  });
});
