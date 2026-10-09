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

  test('every area has one; the header keeps its height and text position', async ({ page }) => {
    const buttons = homeScreen(page).getByRole('button', { name: /^Add item to / });
    await expect(buttons).toHaveCount(11);
    const kitchen = area(page, 'Kitchen');
    const heading = kitchen.getByRole('heading', { level: 2 });
    const add = kitchen.getByRole('button', { name: 'Add item to Kitchen' });
    const h = (await heading.boundingBox())!;
    const b = (await add.boundingBox())!;
    // 24 + 25 + 8, text 20px in from the edge (design/README.md "Area sections").
    expect(h.height).toBe(57);
    await expect(heading).toHaveCSS('padding-left', '20px');
    await expect(heading).toHaveCSS('padding-top', '24px');
    // A 44px target on the right, level with the header text, tinted.
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.x + b.width).toBeLessThanOrEqual(402 - 8);
    expect(Math.abs(b.y + b.height / 2 - (h.y + 24 + 12.5))).toBeLessThanOrEqual(2);
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
