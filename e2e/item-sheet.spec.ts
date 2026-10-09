import {
  area,
  confirmation,
  detailValue,
  expect,
  homeScreen,
  itemSheet,
  meta,
  openItem,
  openNewItem,
  openSeeded,
  ring,
  row,
  rowButton,
  test,
  titlesIn,
  toast,
} from './fixtures';

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
});

test.describe('Item sheet: edit', () => {
  test('opens with the item’s values', async ({ page }) => {
    const sheet = await openItem(page, 'Mirror lights not level');
    await expect(sheet.getByLabel('Title', { exact: true })).toHaveValue('Mirror lights not level');
    await expect(sheet.getByLabel('Note', { exact: true })).toHaveValue(
      'One is 3cm higher. We need to bring someone in to make it even.',
    );
    await expect(sheet.getByRole('radio', { name: 'Amber' })).toBeChecked();
    await expect(sheet.getByLabel('Due', { exact: true })).toHaveValue('2026-10-20');
    await expect(detailValue(sheet, 'Due')).toHaveText('Tue 20 Oct');
    await expect(detailValue(sheet, 'Assigned to')).toHaveText('Unassigned');
    await expect(detailValue(sheet, 'Repeat')).toHaveText('Never');
    await expect(detailValue(sheet, 'Notify')).toHaveText('1 day before');
    await expect(sheet.getByRole('button', { name: 'Mark as Done' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Delete' })).toBeVisible();
    // The assignee list is the household plus Unassigned.
    await expect(sheet.getByLabel('Assigned to', { exact: true }).getByRole('option')).toHaveText([
      '🦔 Stratis',
      '🦆 Shea',
      '🦊 Ela',
      'Unassigned',
    ]);
    await expect(sheet.getByLabel('Repeat', { exact: true }).getByRole('option')).toHaveText([
      'Never',
      'Weekly',
      'Monthly',
      'Every 3 months',
      'Every 6 months',
      'Yearly',
    ]);
    await expect(sheet.getByLabel('Notify', { exact: true }).getByRole('option')).toHaveText([
      'None',
      'On the day',
      '1 day before',
      '1 week before',
    ]);
  });

  test('a missed due date reads "N days late" in red', async ({ page }) => {
    const due = detailValue(await openItem(page, 'Heaters not working'), 'Due');
    await expect(due).toHaveText('Tue 6 Oct · 2 days late');
    await expect(due).toHaveCSS('color', 'rgb(215, 0, 21)');
  });

  test('saves title, note, RAG, due, assignee, repeat and notify', async ({ page }) => {
    const sheet = await openItem(page, 'Mirror lights not level');
    await sheet.getByLabel('Title', { exact: true }).fill('Level the mirror lights');
    await sheet.getByLabel('Note', { exact: true }).fill('Electrician booked for Sunday.');
    // The label is the visible control (the radio itself is visually hidden).
    await sheet.getByRole('radiogroup', { name: 'Status' }).getByText('Red', { exact: true }).click();
    await expect(sheet.getByRole('radio', { name: 'Red' })).toBeChecked();
    await sheet.getByLabel('Due', { exact: true }).fill('2026-10-25');
    await expect(detailValue(sheet, 'Due')).toHaveText('Sun 25 Oct');
    await sheet.getByLabel('Assigned to', { exact: true }).selectOption({ label: '🦊 Ela' });
    await expect(detailValue(sheet, 'Assigned to')).toHaveText('🦊 Ela');
    await sheet.getByLabel('Repeat', { exact: true }).selectOption({ label: 'Weekly' });
    await expect(detailValue(sheet, 'Repeat')).toHaveText('Weekly');
    await sheet.getByLabel('Notify', { exact: true }).selectOption({ label: 'On the day' });
    await expect(detailValue(sheet, 'Notify')).toHaveText('On the day');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);

    const title = 'Level the mirror lights';
    await expect(row(page, title)).toContainText('Electrician booked for Sunday.');
    await expect(meta(page, title)).toHaveText('🦊 Ela · Sun 25 Oct');
    await expect(ring(page, title)).toHaveCSS('border-top-color', 'rgb(255, 59, 48)');
    await expect(ring(page, 'Mirror lights not level')).toHaveCount(0);

    // Reopening shows what was saved.
    await rowButton(page, title).click();
    const again = itemSheet(page);
    await expect(again.getByRole('radio', { name: 'Red' })).toBeChecked();
    await expect(detailValue(again, 'Repeat')).toHaveText('Weekly');
    await expect(detailValue(again, 'Notify')).toHaveText('On the day');
    await expect(detailValue(again, 'Assigned to')).toHaveText('🦊 Ela');
  });

  test('moves an item to another area', async ({ page }) => {
    const sheet = await openItem(page, 'Mirror lights not level');
    await sheet.getByLabel('Area', { exact: true }).selectOption({ label: 'Hallway' });
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(area(page, 'Living Room').getByText('Nothing to do')).toBeVisible();
    expect(await titlesIn(page, 'Hallway')).toEqual(['Heaters not working', 'Mirror lights not level']);
  });

  test('closing with changes asks before discarding them', async ({ page }) => {
    const sheet = await openItem(page, 'Olive oil');
    await sheet.getByLabel('Title', { exact: true }).fill('Olive oil (big tin)');
    await sheet.getByRole('button', { name: 'Close' }).click();
    const confirm = await confirmation(page, 'Discard your changes?');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(sheet.getByLabel('Title', { exact: true })).toHaveValue('Olive oil (big tin)');

    await sheet.getByRole('button', { name: 'Close' }).click();
    await (await confirmation(page, 'Discard your changes?')).getByRole('button', { name: 'Discard Changes' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(ring(page, 'Olive oil')).toBeVisible();
    await expect(ring(page, 'Olive oil (big tin)')).toHaveCount(0);
  });

  test('closing without changes just closes (also with Escape)', async ({ page }) => {
    const sheet = await openItem(page, 'Olive oil');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    await rowButton(page, 'Olive oil').click();
    // Focus moves into the sheet once it has slid up.
    await expect(itemSheet(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(itemSheet(page)).toHaveCount(0);
  });

  test('Delete asks for confirmation, then removes the item', async ({ page }) => {
    const sheet = await openItem(page, 'Wardrobe door hinge');
    await sheet.getByRole('button', { name: 'Delete' }).click();
    const confirm = await confirmation(page, 'Delete this item?');
    await expect(confirm).toContainText('It will be removed for everyone in the household.');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(sheet).toBeVisible();

    await sheet.getByRole('button', { name: 'Delete' }).click();
    await (await confirmation(page, 'Delete this item?')).getByRole('button', { name: 'Delete Item' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(ring(page, 'Wardrobe door hinge')).toHaveCount(0);
    await expect(area(page, 'Bedroom Large').getByText('Nothing to do')).toBeVisible();
  });

  test('Mark as Done completes the item and closes the sheet', async ({ page }) => {
    const sheet = await openItem(page, 'Water test strips running low');
    await sheet.getByRole('button', { name: 'Mark as Done' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(ring(page, 'Water test strips running low')).toHaveCount(0);
    const done = toast(page, 'Marked as done');
    await expect(done).toBeVisible();
    await done.getByRole('button', { name: 'Undo' }).click();
    await expect(ring(page, 'Water test strips running low')).toBeVisible();
  });

  test('Mark as Done keeps edits made in the sheet', async ({ page }) => {
    const sheet = await openItem(page, 'Change the filter');
    await sheet.getByLabel('Note', { exact: true }).fill('Use the blue cartridge.');
    await sheet.getByRole('button', { name: 'Mark as Done' }).click();
    await expect(sheet).toHaveCount(0);
    // Monthly: still open, a month later, with the new note.
    await expect(meta(page, 'Change the filter')).toHaveText('🦆 Shea · Fri 20 Nov');
    await expect(row(page, 'Change the filter')).toContainText('Use the blue cartridge.');
  });
});

test.describe('Item sheet: new', () => {
  test('the + button opens a new item with the defaults', async ({ page }) => {
    const sheet = await openNewItem(page);
    await expect(sheet).toBeVisible();
    const title = sheet.getByLabel('Title', { exact: true });
    await expect(title).toHaveValue('');
    await expect(title).toBeFocused();
    await expect(title).toHaveAttribute('placeholder', 'Title');
    await expect(sheet.getByLabel('Note', { exact: true })).toHaveAttribute('placeholder', 'Add a note');
    await expect(sheet.getByRole('radio', { name: 'Amber' })).toBeChecked();
    await expect(detailValue(sheet, 'Area')).toHaveText('Kitchen');
    await expect(sheet.getByLabel('Due', { exact: true })).toHaveValue('2026-10-15');
    await expect(detailValue(sheet, 'Due')).toHaveText('Thu 15 Oct');
    await expect(detailValue(sheet, 'Assigned to')).toHaveText('Unassigned');
    await expect(detailValue(sheet, 'Repeat')).toHaveText('Never');
    await expect(detailValue(sheet, 'Notify')).toHaveText('1 day before');
    await expect(sheet.getByRole('button', { name: 'Mark as Done' })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'Delete' })).toHaveCount(0);

    const save = sheet.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    await title.fill('   ');
    await expect(save).toBeDisabled();
    await title.fill('Fix the gate latch');
    await expect(save).toBeEnabled();
  });

  test('saving adds it to Home in the chosen area, sorted by date', async ({ page }) => {
    const sheet = await openNewItem(page);
    await sheet.getByLabel('Title', { exact: true }).fill('Fix the gate latch');
    await sheet.getByLabel('Note', { exact: true }).fill('It sticks when wet.');
    await sheet.getByLabel('Area', { exact: true }).selectOption({ label: 'Garden' });
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);

    await expect(meta(page, 'Fix the gate latch')).toHaveText('Unassigned · Thu 15 Oct');
    await expect(row(page, 'Fix the gate latch')).toContainText('It sticks when wet.');
    await expect(ring(page, 'Fix the gate latch')).toHaveCSS('border-top-color', 'rgb(255, 149, 0)');
    // Same day as the firepit (added earlier), before the wall panel (30 Oct).
    expect(await titlesIn(page, 'Garden')).toEqual([
      'Give away the old firepit',
      'Fix the gate latch',
      'Garden room wall panel',
    ]);
  });

  test('a new item into an empty area replaces "Nothing to do"', async ({ page }) => {
    const sheet = await openNewItem(page);
    await sheet.getByLabel('Title', { exact: true }).fill('Fit blackout blinds');
    await sheet.getByLabel('Area', { exact: true }).selectOption({ label: 'Bedroom Small' });
    await sheet.getByLabel('Assigned to', { exact: true }).selectOption({ label: '🦆 Shea' });
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(area(page, 'Bedroom Small').getByText('Nothing to do')).toHaveCount(0);
    await expect(meta(page, 'Fit blackout blinds')).toHaveText('🦆 Shea · Thu 15 Oct');
  });

  test('closing a new item with a title asks before discarding it', async ({ page }) => {
    const sheet = await openNewItem(page);
    await sheet.getByLabel('Title', { exact: true }).fill('Paint the fence');
    await sheet.getByRole('button', { name: 'Close' }).click();
    const confirm = await confirmation(page, 'Discard this item?');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(sheet.getByLabel('Title', { exact: true })).toHaveValue('Paint the fence');

    await sheet.getByRole('button', { name: 'Close' }).click();
    await (await confirmation(page, 'Discard this item?')).getByRole('button', { name: 'Discard Changes' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(homeScreen(page).getByText('Paint the fence')).toHaveCount(0);
  });

  test('closing an untouched new item does not ask', async ({ page }) => {
    const sheet = await openNewItem(page);
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
});

test.describe('Item sheet: keyboard', () => {
  test('Enter in the title moves to the note; Ctrl+Enter saves', async ({ page }) => {
    const sheet = await openNewItem(page);
    const title = sheet.getByLabel('Title', { exact: true });
    await expect(title).toBeFocused();
    await page.keyboard.type('Clean the gutters');
    await page.keyboard.press('Enter');
    await expect(sheet.getByLabel('Note', { exact: true })).toBeFocused();
    await expect(title).toHaveValue('Clean the gutters');
    await page.keyboard.type('Before the leaves fall.');
    await page.keyboard.press('Control+Enter');
    await expect(sheet).toHaveCount(0);
    await expect(row(page, 'Clean the gutters')).toContainText('Before the leaves fall.');
  });

  test('a pasted title with line breaks becomes one line', async ({ page }) => {
    const title = (await openNewItem(page)).getByLabel('Title', { exact: true });
    await title.fill('Fix the\nback door');
    await expect(title).toHaveValue('Fix the back door');
  });
});

