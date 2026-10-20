import {
  areas,
  closeArea,
  closeProfile,
  confirmation,
  DEFAULT_AREAS,
  expect,
  expectAreas,
  goToTab,
  itemSheet,
  meta,
  NOW,
  openArea,
  openItem,
  openNewItem,
  openProfile,
  openSeeded,
  reopen,
  ring,
  statsScreen,
  tabButton,
  test,
  titlesIn,
  who,
} from './fixtures';

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

test.describe('Persistence', () => {
  test('changes survive a reload', async ({ page }) => {
    // A long walk (each area sheet opened and closed in turn, two reloads): about 32s here,
    // over the default 30s, so it gets the slow-test allowance.
    test.slow();
    await openSeeded(page);

    // Complete one item, repeat another, add one, edit one, change the emoji.
    await openArea(page, 'Living Room');
    await ring(page, 'Mirror lights not level').click();
    await expect(ring(page, 'Mirror lights not level')).toHaveCount(0);
    await closeArea(page);
    await openArea(page, 'Kitchen');
    await ring(page, 'Olive oil').click();
    // Monthly: next on Sat 12 Dec.
    await expect(meta(page, 'Olive oil')).toHaveText('Not urgent·In 2 months');
    await closeArea(page);

    const sheet = await openNewItem(page);
    await sheet.getByLabel('Title', { exact: true }).fill('Service the boiler');
    await sheet.getByLabel('Area', { exact: true }).selectOption({ label: 'Hallway' });
    await sheet.getByLabel('Repeat', { exact: true }).selectOption({ label: 'Yearly' });
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);

    await openArea(page, 'Bathroom Large');
    const edit = await openItem(page, 'Shower draining slowly');
    await edit.getByLabel('Note', { exact: true }).fill('Plumber on Friday.');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit).toHaveCount(0);
    await closeArea(page);

    const dialog = await openProfile(page);
    await dialog.getByRole('radiogroup', { name: 'Your emoji' }).getByRole('radio', { name: '🌻' }).click();
    await closeProfile(page);

    await reopen(page);
    await expectAreas(page, DEFAULT_AREAS);
    await openArea(page, 'Living Room');
    await expect(ring(page, 'Mirror lights not level')).toHaveCount(0);
    await closeArea(page);
    await openArea(page, 'Kitchen');
    await expect(meta(page, 'Olive oil')).toHaveText('Not urgent·In 2 months');
    await expect(who(page, 'Olive oil')).toHaveText('🌻Stratis');
    await closeArea(page);
    await openArea(page, 'Hallway');
    expect(await titlesIn(page, 'Hallway')).toEqual(['Heaters not working', 'Service the boiler']);
    await expect(meta(page, 'Service the boiler')).toHaveText('Within the month');
    await expect(areas(page).getByRole('button', { name: /^Service the boiler ?, .*, Unassigned, repeats yearly\.$/ })).toBeVisible();
    await closeArea(page);
    await openArea(page, 'Bathroom Large');
    const shower = await openItem(page, 'Shower draining slowly');
    await expect(shower.getByLabel('Note', { exact: true })).toHaveValue('Plumber on Friday.');
    await shower.getByRole('button', { name: 'Close' }).click();
    await expect(shower).toHaveCount(0);
    await closeArea(page);
    await expect(page.getByRole('button', { name: 'Profile', exact: true })).toHaveText('🌻');
    await goToTab(page, 'Stats');
    await expect(statsScreen(page).getByRole('img', { name: /^9 tasks done this month/ })).toBeVisible();

    // A second reload (not a reseed) keeps the same state, and the tab that was open.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Profile', exact: true })).toHaveText('🌻');
    await expect(tabButton(page, 'Stats')).toHaveAttribute('aria-current', 'page');
    await goToTab(page, 'Home');
    await openArea(page, 'Hallway');
    await expect(ring(page, 'Service the boiler')).toBeVisible();
  });

  test('another tab sees changes without reloading', async ({ page, context }) => {
    await openSeeded(page);
    const other = await context.newPage();
    await other.clock.install({ time: NOW });
    await other.goto('/');
    await openArea(other, 'Hallway');
    await expect(ring(other, 'Heaters not working')).toBeVisible();

    await openArea(page, 'Hallway');
    await ring(page, 'Heaters not working').click();
    await expect(ring(page, 'Heaters not working')).toHaveCount(0);
    await expect(ring(other, 'Heaters not working')).toHaveCount(0);
    await closeArea(page);

    // And the other way round.
    await closeArea(other);
    await openArea(other, 'Kitchen');
    const sheet = await openItem(other, 'Olive oil');
    await sheet.getByLabel('Title', { exact: true }).fill('Olive oil, 5L');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await openArea(page, 'Kitchen');
    await expect(ring(page, 'Olive oil, 5L')).toBeVisible();
  });

  test('an item open in the sheet that is deleted elsewhere closes the sheet', async ({ page, context }) => {
    await openSeeded(page);
    const other = await context.newPage();
    await other.clock.install({ time: NOW });
    await other.goto('/');

    await openArea(page, 'Front garden');
    await openItem(page, 'Trim the hedges');
    await openArea(other, 'Front garden');
    const otherSheet = await openItem(other, 'Trim the hedges');
    await otherSheet.getByRole('button', { name: 'Delete' }).click();
    await (await confirmation(other, 'Delete this item?')).getByRole('button', { name: 'Delete Item' }).click();

    await expect(itemSheet(page)).toHaveCount(0);
    await expect(ring(page, 'Trim the hedges')).toHaveCount(0);
    // The area's sheet is still there, under where the item's was.
    await expect(areas(page)).toHaveCount(1);
  });
});
