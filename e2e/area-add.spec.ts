import {
  addButton,
  area,
  areaAction,
  attentionCards,
  closeArea,
  detailValue,
  expect,
  itemSheet,
  openArea,
  openNeedsAttention,
  openSeeded,
  settled,
  test,
  titlesIn,
  toast,
  type Locator,
  type Page,
} from './fixtures';

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

/**
 * A row just saved comes up whole, clear of the round + and the tab bar floating over the
 * bottom of the screen (it used to stop flush with the bottom edge, under the +).
 */
async function clearOfAdd(page: Page, row: Locator) {
  await expect
    .poll(async () => {
      const box = await row.boundingBox();
      const add = await addButton(page).boundingBox();
      return !!box && !!add && box.y >= 0 && box.y + box.height <= add.y;
    })
    .toBe(true);
}

/** A row just saved in an area's sheet comes up whole, inside the screen. */
async function inSheet(page: Page, row: Locator) {
  const height = page.viewportSize()!.height;
  await expect
    .poll(async () => {
      const box = await row.boundingBox();
      return !!box && box.y >= 0 && box.y + box.height <= height;
    })
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
});

test.describe('Adding an item from an area', () => {
  test('Add Item in an area’s sheet opens a new item in that area, and it is saved there', async ({ page }) => {
    await openArea(page, 'Jacuzzi');
    await areaAction(page, 'Jacuzzi', 'Add Item').click();
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await expect(detailValue(sheet, 'Area')).toHaveText('Jacuzzi');
    await sheet.getByLabel('Title', { exact: true }).fill('Top up the chlorine');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    expect(await titlesIn(page, 'Jacuzzi')).toContain('Top up the chlorine');
    await closeArea(page);
    await openArea(page, 'Kitchen');
    expect(await titlesIn(page, 'Kitchen')).not.toContain('Top up the chlorine');
    await closeArea(page);

    // An area with nothing open too.
    await openArea(page, 'Bedroom Small');
    await areaAction(page, 'Bedroom Small', 'Add Item').click();
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await expect(detailValue(sheet, 'Area')).toHaveText('Bedroom Small');
    await sheet.getByLabel('Title', { exact: true }).fill('Vacuum under the bed');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    expect(await titlesIn(page, 'Bedroom Small')).toEqual(['Vacuum under the bed']);
  });

  test('every area’s sheet has Add Item and Share Room, named by their words', async ({ page }) => {
    for (const name of ['Kitchen', 'Bedroom Small', 'Front garden']) {
      await openArea(page, name);
      // Voice Control: "Tap Add Item", "Tap Share Room".
      await expect(areaAction(page, name, 'Add Item')).toHaveText('Add Item');
      await expect(areaAction(page, name, 'Add Item')).toHaveAccessibleName(`Add item to ${name}`);
      await expect(areaAction(page, name, 'Share Room')).toHaveText('Share Room');
      await closeArea(page);
    }
  });

  test('works from the keyboard and focus comes back to Add Item', async ({ page }) => {
    await openArea(page, 'Garden');
    const add = areaAction(page, 'Garden', 'Add Item');
    await add.focus();
    await page.keyboard.press('Enter');
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await expect(detailValue(sheet, 'Area')).toHaveText('Garden');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    // Only the Item sheet closed.
    await expect(area(page, 'Garden')).toBeVisible();
    await expect(add).toBeFocused();
  });
});

test.describe('After saving, the item can be seen where it went', () => {
  test('a fifth job in an area that shows three: its sheet shows it, scrolled to and lit up', async ({ page }) => {
    // Garden Lounge has four To dos, all not urgent: a fifth with no date sorts last, behind "Show 2 more".
    await openArea(page, 'Garden Lounge');
    await areaAction(page, 'Garden Lounge', 'Add Item').click();
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await sheet.getByLabel('Title', { exact: true }).fill('Oil the decking');
    await sheet.getByRole('radiogroup', { name: 'How urgent?' }).getByText('Not urgent', { exact: true }).click();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    const row = area(page, 'Garden Lounge').getByRole('listitem').filter({ hasText: 'Oil the decking' });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-lit');
    await inSheet(page, row);
    await expect(area(page, 'Garden Lounge').getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
    // The light fades after a moment.
    await expect(row).not.toHaveAttribute('data-lit', { timeout: 5_000 });
  });

  test('Needs attention: a job for later, low in the list, comes into view and lights up', async ({ page }) => {
    await openNeedsAttention(page);
    await addButton(page).click();
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await sheet.getByLabel('Title', { exact: true }).fill('Service the boiler');
    await sheet.getByRole('radiogroup', { name: 'How urgent?' }).getByText('Not urgent', { exact: true }).click();
    await sheet.getByLabel('Due', { exact: true }).fill('2026-12-01');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    const card = attentionCards(page).filter({ hasText: 'Service the boiler' });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-lit');
    await clearOfAdd(page, card);
    await expect(card).not.toHaveAttribute('data-lit', { timeout: 5_000 });
  });

  test('Needs attention: one it doesn’t list (a thing looked after in good shape) says where it went', async ({ page }) => {
    await openNeedsAttention(page);
    const before = await attentionCards(page).count();
    await addButton(page).click();
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await sheet.getByLabel('Title', { exact: true }).fill('Grout');
    await sheet.getByRole('radio', { name: 'To maintain' }).click();
    await sheet.getByRole('radiogroup', { name: 'Condition' }).getByText('Good', { exact: true }).click();
    await sheet.getByLabel('Area', { exact: true }).selectOption({ label: 'Bathroom Large' });
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(toast(page, 'Saved in Bathroom Large.')).toBeVisible();
    await expect(attentionCards(page)).toHaveCount(before);
  });
});

test.describe('A shared area link', () => {
  test('opens the area’s sheet, whose Add Item adds to it; the round + stays a plain one', async ({ page }) => {
    const garden = await page.evaluate(() => {
      const doc = JSON.parse(localStorage.getItem('homeos.demo.v1')!);
      return doc.areas.find((a: { name: string }) => a.name === 'Garden').id as string;
    });
    await openNeedsAttention(page);
    await page.goto(`/?area=${garden}`);
    const sheet = area(page, 'Garden');
    await settled(sheet.getByRole('button', { name: 'Close', exact: true }));
    await areaAction(page, 'Garden', 'Add Item').click();
    const item = itemSheet(page, 'New item');
    await settled(item.getByRole('button', { name: 'Close' }));
    await expect(detailValue(item, 'Area')).toHaveText('Garden');
    await item.getByRole('button', { name: 'Close' }).click();
    await expect(item).toHaveCount(0);
    await closeArea(page);
    await expect(addButton(page)).toBeVisible();
    await expect(addButton(page)).toHaveText('');
  });
});
