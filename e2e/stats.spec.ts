import {
  expect,
  goToTab,
  openSeeded,
  ring,
  statsScreen,
  test,
  toast,
  type Page,
} from './fixtures';

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

function legend(page: Page) {
  return statsScreen(page).getByRole('list', { name: 'Done per person' }).getByRole('listitem');
}

function donut(page: Page) {
  return statsScreen(page).getByRole('img', { name: /tasks? done/ });
}

async function expectStats(page: Page, total: number, counts: [string, string, number][], period: 'this month' | 'in total') {
  const summary = `${total} tasks done ${period}: ${counts.map(([, name, n]) => `${name} ${n}`).join(', ')}.`;
  await expect(donut(page)).toHaveAccessibleName(summary);
  await expect(donut(page)).toContainText(`${total}done`);
  await expect(legend(page)).toHaveText(counts.map(([emoji, name, n]) => `${emoji}${name}${n}`));
}

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
  await goToTab(page, 'Stats');
});

test.describe('Stats', () => {
  test('This Month and Lifetime totals with the legend in member order', async ({ page }) => {
    const stats = statsScreen(page);
    await expect(stats.getByRole('heading', { name: 'Stats', level: 1 })).toBeVisible();
    const period = stats.getByRole('radiogroup', { name: 'Period' });
    await expect(period.getByRole('radio', { name: 'This Month' })).toBeChecked();
    await expectStats(page, 7, [['🦔', 'Stratis', 4], ['🦆', 'Shea', 2], ['🦊', 'Ela', 1]], 'this month');

    await period.getByRole('radio', { name: 'Lifetime' }).click();
    await expect(period.getByRole('radio', { name: 'Lifetime' })).toBeChecked();
    await expectStats(page, 111, [['🦔', 'Stratis', 58], ['🦆', 'Shea', 37], ['🦊', 'Ela', 16]], 'in total');

    await period.getByRole('radio', { name: 'This Month' }).click();
    await expectStats(page, 7, [['🦔', 'Stratis', 4], ['🦆', 'Shea', 2], ['🦊', 'Ela', 1]], 'this month');
  });

  test('one donut segment per member, in the member colours', async ({ page }) => {
    const segments = donut(page).locator('svg g circle');
    await expect(segments).toHaveCount(3);
    await expect(segments.nth(0)).toHaveAttribute('stroke', '#007AFF');
    await expect(segments.nth(1)).toHaveAttribute('stroke', '#AF52DE');
    await expect(segments.nth(2)).toHaveAttribute('stroke', '#30B0C7');
  });

  test('a completion counts for the assignee, or for whoever marked an unassigned item done', async ({ page }) => {
    await goToTab(page, 'Home');
    // Assigned to Shea.
    await ring(page, 'Shower draining slowly').click();
    await expect(ring(page, 'Shower draining slowly')).toHaveCount(0);
    // Unassigned: credited to me (Stratis).
    await ring(page, 'Water test strips running low').click();
    await expect(ring(page, 'Water test strips running low')).toHaveCount(0);

    await goToTab(page, 'Stats');
    await expectStats(page, 9, [['🦔', 'Stratis', 5], ['🦆', 'Shea', 3], ['🦊', 'Ela', 1]], 'this month');
    await statsScreen(page).getByRole('radio', { name: 'Lifetime' }).click();
    await expectStats(page, 113, [['🦔', 'Stratis', 59], ['🦆', 'Shea', 38], ['🦊', 'Ela', 16]], 'in total');
  });

  test('undoing a completion takes it off again', async ({ page }) => {
    await goToTab(page, 'Home');
    await ring(page, 'Give away the old firepit').click();
    await toast(page, 'Marked as done').getByRole('button', { name: 'Undo' }).click();
    await expect(ring(page, 'Give away the old firepit')).toBeVisible();
    await goToTab(page, 'Stats');
    await expectStats(page, 7, [['🦔', 'Stratis', 4], ['🦆', 'Shea', 2], ['🦊', 'Ela', 1]], 'this month');
  });

  test('the chosen period is kept when switching tabs', async ({ page }) => {
    await statsScreen(page).getByRole('radio', { name: 'Lifetime' }).click();
    await goToTab(page, 'Home');
    await goToTab(page, 'Stats');
    await expect(statsScreen(page).getByRole('radio', { name: 'Lifetime' })).toBeChecked();
  });
});
