import { area, detailValue, expect, homeScreen, itemSheet, openSeeded, settled, test, titlesIn } from './fixtures';

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
});

test.describe('Adding an item from an area', () => {
  test('the + in an area header opens a new item in that area, and it is saved there', async ({ page }) => {
    const add = area(page, 'Jacuzzi').getByRole('button', { name: 'Add item to Jacuzzi' });
    await add.click();
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await expect(detailValue(sheet, 'Area')).toHaveText('Jacuzzi');
    await sheet.getByLabel('Title', { exact: true }).fill('Top up the chlorine');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    expect(await titlesIn(page, 'Jacuzzi')).toContain('Top up the chlorine');
    expect(await titlesIn(page, 'Kitchen')).not.toContain('Top up the chlorine');

    // An empty area too.
    await area(page, 'Bedroom Small').getByRole('button', { name: 'Add item to Bedroom Small' }).click();
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await expect(detailValue(sheet, 'Area')).toHaveText('Bedroom Small');
    await sheet.getByLabel('Title', { exact: true }).fill('Vacuum under the bed');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    expect(await titlesIn(page, 'Bedroom Small')).toEqual(['Vacuum under the bed']);
  });

  test('every area has one, in the tint colour', async ({ page }) => {
    // Header layout (name, counts, +) is covered by e2e/areas.spec.ts and the 3a comparison.
    const buttons = homeScreen(page).getByRole('button', { name: /^Add item to / });
    await expect(buttons).toHaveCount(11);
    const add = area(page, 'Kitchen').getByRole('button', { name: 'Add item to Kitchen' });
    // The 28px icon has an invisible 44px tap area (a pseudo-element), so its box isn't measured here.
    const b = (await add.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(402 - 8);
    await expect(add).toHaveCSS('color', 'rgb(0, 122, 255)');
  });

  test('works from the keyboard and focus comes back to the +', async ({ page }) => {
    const add = area(page, 'Garden').getByRole('button', { name: 'Add item to Garden' });
    await add.focus();
    await page.keyboard.press('Enter');
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await expect(detailValue(sheet, 'Area')).toHaveText('Garden');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(add).toBeFocused();
  });
});
