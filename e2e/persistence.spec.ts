import {
  areaHeadings,
  closeProfile,
  confirmation,
  DEFAULT_AREAS,
  expect,
  goToTab,
  homeScreen,
  itemSheet,
  meta,
  NOW,
  openItem,
  openNewItem,
  openProfile,
  openSeeded,
  reopen,
  ring,
  statsScreen,
  test,
  titlesIn,
} from './fixtures';

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

test.describe('Persistence', () => {
  test('changes survive a reload', async ({ page }) => {
    await openSeeded(page);

    // Complete one item, repeat another, add one, edit one, change the emoji.
    await ring(page, 'Mirror lights not level').click();
    await expect(ring(page, 'Mirror lights not level')).toHaveCount(0);
    await ring(page, 'Olive oil').click();
    await expect(meta(page, 'Olive oil')).toHaveText('🦔 Stratis · Sat 12 Dec');

    const sheet = await openNewItem(page);
    await sheet.getByLabel('Title', { exact: true }).fill('Service the boiler');
    await sheet.getByLabel('Area', { exact: true }).selectOption({ label: 'Hallway' });
    await sheet.getByLabel('Repeat', { exact: true }).selectOption({ label: 'Yearly' });
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);

    const edit = await openItem(page, 'Shower draining slowly');
    await edit.getByLabel('Note', { exact: true }).fill('Plumber on Friday.');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit).toHaveCount(0);

    const dialog = await openProfile(page);
    await dialog.getByRole('radiogroup', { name: 'Your emoji' }).getByRole('radio', { name: '🌻' }).click();
    await closeProfile(page);

    await reopen(page);
    await expect(areaHeadings(page)).toHaveText(DEFAULT_AREAS);
    await expect(ring(page, 'Mirror lights not level')).toHaveCount(0);
    await expect(meta(page, 'Olive oil')).toHaveText('🌻 Stratis · Sat 12 Dec');
    expect(await titlesIn(page, 'Hallway')).toEqual(['Heaters not working', 'Service the boiler']);
    await expect(meta(page, 'Service the boiler')).toHaveText('Unassigned · Thu 15 Oct');
    await expect(homeScreen(page).getByRole('button', { name: /^Shower draining slowly/ })).toContainText(
      'Plumber on Friday.',
    );
    await expect(page.getByRole('button', { name: 'Profile', exact: true })).toHaveText('🌻');
    await goToTab(page, 'Stats');
    await expect(statsScreen(page).getByRole('img', { name: /^9 tasks done this month/ })).toBeVisible();

    // A second reload (not a reseed) keeps the same state.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Profile', exact: true })).toHaveText('🌻');
    await expect(ring(page, 'Service the boiler')).toBeVisible();
  });

  test('another tab sees changes without reloading', async ({ page, context }) => {
    await openSeeded(page);
    const other = await context.newPage();
    await other.clock.install({ time: NOW });
    await other.goto('/');
    await expect(ring(other, 'Heaters not working')).toBeVisible();

    await ring(page, 'Heaters not working').click();
    await expect(ring(page, 'Heaters not working')).toHaveCount(0);
    await expect(ring(other, 'Heaters not working')).toHaveCount(0);

    // And the other way round.
    const sheet = await openItem(other, 'Olive oil');
    await sheet.getByLabel('Title', { exact: true }).fill('Olive oil, 5L');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(ring(page, 'Olive oil, 5L')).toBeVisible();
  });

  test('an item open in the sheet that is deleted elsewhere closes the sheet', async ({ page, context }) => {
    await openSeeded(page);
    const other = await context.newPage();
    await other.clock.install({ time: NOW });
    await other.goto('/');

    await openItem(page, 'Trim the hedges');
    const otherSheet = await openItem(other, 'Trim the hedges');
    await otherSheet.getByRole('button', { name: 'Delete' }).click();
    await (await confirmation(other, 'Delete this item?')).getByRole('button', { name: 'Delete Item' }).click();

    await expect(itemSheet(page)).toHaveCount(0);
    await expect(ring(page, 'Trim the hedges')).toHaveCount(0);
  });
});
