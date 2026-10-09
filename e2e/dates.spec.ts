import {
  closeProfile,
  detailValue,
  expect,
  goToTab,
  meta,
  openItem,
  openNewItem,
  openProfile,
  openSeeded,
  statsScreen,
  test,
  type Page,
} from './fixtures';

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

/** Lets the clock jump to `iso` with the app left open (timers due on the way fire once). */
async function jumpTo(page: Page, iso: string) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.fastForward(new Date(iso).getTime() - now);
}

async function addItemDueToday(page: Page, title: string) {
  const sheet = await openNewItem(page);
  await sheet.getByLabel('Title', { exact: true }).fill(title);
  await sheet.getByLabel('Due', { exact: true }).fill('2026-10-08');
  await expect(detailValue(sheet, 'Due')).toHaveText('Thu 8 Oct');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
});

test.describe('Dates and time zones', () => {
  test('an item due today is not missed; after midnight it is', async ({ page }) => {
    await addItemDueToday(page, 'Put the bins out');
    await expect(meta(page, 'Put the bins out')).toHaveText('Unassigned · Thu 8 Oct');

    await jumpTo(page, '2026-10-09T00:01:00+01:00');
    await expect(meta(page, 'Put the bins out')).toHaveText('Unassigned · Missed · Thu 8 Oct');
    await expect(meta(page, 'Put the bins out').getByText('Missed · Thu 8 Oct')).toHaveCSS('color', 'rgb(215, 0, 21)');
    const sheet = await openItem(page, 'Put the bins out');
    await expect(detailValue(sheet, 'Due')).toHaveText('Thu 8 Oct · 1 day late');
  });

  test('missed is decided in the household’s time zone', async ({ page }) => {
    await addItemDueToday(page, 'Put the bins out');
    // 23:30 in London is already 9 Oct in Auckland.
    await jumpTo(page, '2026-10-08T23:30:00+01:00');
    await expect(meta(page, 'Put the bins out')).toHaveText('Unassigned · Thu 8 Oct');

    const dialog = await openProfile(page);
    await dialog.getByRole('button', { name: /^Household/ }).click();
    await dialog.getByLabel('Time zone', { exact: true }).selectOption('Pacific/Auckland');
    await expect(dialog.getByText('Auckland', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Profile' }).click();
    await closeProfile(page);
    await expect(meta(page, 'Put the bins out')).toHaveText('Unassigned · Missed · Thu 8 Oct');

    // New items are due 7 days after today there.
    await expect(detailValue(await openNewItem(page), 'Due')).toHaveText('Fri 16 Oct');
  });

  test('This Month starts again on the 1st', async ({ page }) => {
    await goToTab(page, 'Stats');
    const stats = statsScreen(page);
    await expect(stats.getByRole('img', { name: /^7 tasks done this month/ })).toBeVisible();

    // Clocks have gone back by then: London is on GMT.
    await jumpTo(page, '2026-11-01T00:01:00Z');
    await expect(stats.getByRole('img', { name: '0 tasks done this month: Stratis 0, Shea 0, Ela 0.' })).toBeVisible();
    await stats.getByRole('radio', { name: 'Lifetime' }).click();
    await expect(stats.getByRole('img', { name: /^111 tasks done in total/ })).toBeVisible();
  });
});
