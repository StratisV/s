import {
  addButton,
  area,
  areas,
  detailValue,
  expect,
  homeScreen,
  itemSheet,
  openRoomMenu,
  openSeeded,
  roomMenu,
  settled,
  showView,
  test,
  titlesIn,
} from './fixtures';

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
});

test.describe('Adding an item from a room', () => {
  test('Add Item in a room’s menu opens a new item in that room, and it is saved there', async ({ page }) => {
    await roomMenu(page, 'Jacuzzi', 'Add item to Jacuzzi');
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await expect(detailValue(sheet, 'Area')).toHaveText('Jacuzzi');
    await sheet.getByLabel('Title', { exact: true }).fill('Top up the chlorine');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    expect(await titlesIn(page, 'Jacuzzi')).toContain('Top up the chlorine');
    expect(await titlesIn(page, 'Kitchen')).not.toContain('Top up the chlorine');

    // A room with nothing open too.
    await roomMenu(page, 'Bedroom Small', 'Add item to Bedroom Small');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await expect(detailValue(sheet, 'Area')).toHaveText('Bedroom Small');
    await sheet.getByLabel('Title', { exact: true }).fill('Vacuum under the bed');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    expect(await titlesIn(page, 'Bedroom Small')).toEqual(['Vacuum under the bed']);
  });

  test('every room has one "..." menu: Add Item and Share Room', async ({ page }) => {
    // One quiet button a room in place of a share button, a + and the counts.
    const buttons = areas(page).getByRole('button', { name: / options$/ });
    await expect(buttons).toHaveCount(11);
    await expect(homeScreen(page).getByRole('button', { name: /^Add item to / })).toHaveCount(0);
    const menu = await openRoomMenu(page, 'Kitchen');
    await expect(menu.getByRole('menuitem')).toHaveText(['Add Item', 'Share Room']);
    // Its spoken name holds the words on screen, for Voice Control ("Tap Share Room").
    await expect(menu.getByRole('menuitem', { name: 'Share Room', exact: true })).toBeVisible();
    // The glass is nearly opaque: nothing behind shows through the words.
    const background = await menu.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(Number(background.match(/[\d.]+\)$/)?.[0].replace(')', '') ?? '1')).toBeGreaterThanOrEqual(0.95);
    await expect(area(page, 'Kitchen').getByRole('button', { name: 'Kitchen options' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('works from the keyboard and focus comes back to the room’s menu button', async ({ page }) => {
    const options = area(page, 'Garden').getByRole('button', { name: 'Garden options' });
    await options.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: 'Garden' }).getByRole('menuitem', { name: 'Add item to Garden' })).toBeFocused();
    await page.keyboard.press('Enter');
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await expect(detailValue(sheet, 'Area')).toHaveText('Garden');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(options).toBeFocused();
  });
});

test.describe('After saving, the item can be seen where it went', () => {
  test('a fifth job in a room that shows three: its room shows it, scrolled to and lit up', async ({ page }) => {
    // Garden Lounge has four To dos, all not urgent: a fifth due in a week sorts fourth, behind "Show 2 more".
    await roomMenu(page, 'Garden Lounge', 'Add item to Garden Lounge');
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await sheet.getByLabel('Title', { exact: true }).fill('Oil the decking');
    await sheet.getByRole('radiogroup', { name: 'How urgent?' }).getByText('Not urgent', { exact: true }).click();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    const row = area(page, 'Garden Lounge').getByRole('listitem').filter({ hasText: 'Oil the decking' });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-lit');
    await expect(row).toBeInViewport();
    await expect(area(page, 'Garden Lounge').getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
    // The light fades after a moment.
    await expect(row).not.toHaveAttribute('data-lit', { timeout: 5_000 });
  });

  test('Up next: a job for later, deep in Later, opens it and comes into view', async ({ page }) => {
    await showView(page, 'Up next');
    await addButton(page).click();
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await sheet.getByLabel('Title', { exact: true }).fill('Service the boiler');
    await sheet.getByRole('radiogroup', { name: 'How urgent?' }).getByText('Not urgent', { exact: true }).click();
    await sheet.getByLabel('Due', { exact: true }).fill('2026-12-01');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    const later = homeScreen(page).locator('section[data-group="later"]');
    const row = later.getByRole('listitem').filter({ hasText: 'Service the boiler' });
    await expect(row).toBeVisible();
    await expect(row).toBeInViewport();
    await expect(later.getByRole('button', { name: 'Show fewer' })).toBeVisible();
  });
});

test.describe('The round + after a shared room link', () => {
  test('says it adds to that room, and does, until another view', async ({ page }) => {
    const garden = await area(page, 'Garden').getAttribute('data-area-id');
    await showView(page, 'Up next');
    await page.goto(`/?area=${garden}`);
    const add = page.getByRole('button', { name: 'New item in Garden', exact: true });
    await expect(add).toBeVisible();
    await expect(add).toHaveText('Garden');
    await add.click();
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await expect(detailValue(sheet, 'Area')).toHaveText('Garden');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
    await showView(page, 'Up next');
    await expect(addButton(page)).toBeVisible();
    await expect(addButton(page)).toHaveText('');
  });
});
