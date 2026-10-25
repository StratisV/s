import { expect, goToTab, housekeepingScreen, openSeeded, test, type Locator, type Page } from './fixtures';

// The date picker (docs/ARCHITECTURE.md "The date picker": ui/DatePicker.tsx and its calendar
// card ui/MonthCalendar.tsx) as Housekeeping uses it, against the demo seed at the e2e clock
// (Thu 8 Oct 2026, 10:00 London): the housekeeper came on Thu 1 Oct (6 of 7 done, £60.00).

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

/** Housekeeping's calendar (a region named "Calendar"). */
async function openCalendar(page: Page): Promise<Locator> {
  await goToTab(page, 'Housekeeping');
  return housekeepingScreen(page).getByRole('region', { name: 'Calendar', exact: true });
}

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
});

test.describe('the Housekeeping calendar', () => {
  test('the bar and the card: the week strip, 46px days with 40px circles, a dot for a visit, no marks or legend; the month with its total', async ({
    page,
  }) => {
    const calendar = await openCalendar(page);
    const grid = calendar.getByRole('grid');
    await expect(grid).toHaveAccessibleName('Week of Monday 5 October');
    await expect(calendar.getByText('5 to 11 October', { exact: true })).toBeVisible();
    await expect(calendar.getByRole('button', { name: 'Show month', exact: true })).toBeVisible();
    await expect(calendar.getByRole('button', { name: 'Next week' })).toBeDisabled();
    // A 44px bar, then the card inside the page's 16px gutter.
    expect((await calendar.locator('[data-calendar-bar]').boundingBox())!.height).toBe(44);
    const card = grid.locator('xpath=..');
    const box = (await card.boundingBox())!;
    expect([box.x, box.width, box.height]).toEqual([16, 370, 140]);
    const oct8 = grid.getByRole('button', { name: /^Thursday 8 October/ });
    expect((await oct8.boundingBox())!.height).toBe(46);
    expect((await oct8.locator('span').first().boundingBox())!.width).toBe(40);
    // The chosen day: white on the deeper tint fill, 4.7:1 (the system blue was 4:1).
    await expect(oct8.locator('span').first()).toHaveCSS('background-color', 'rgb(0, 113, 227)');
    await expect(card.locator('[data-legend], [data-rag]')).toHaveCount(0);
    await expect(grid.getByRole('button', { name: /^Friday 9 October/ })).toBeDisabled();

    // The month: its title and total, and the visit's dot.
    await calendar.getByRole('button', { name: 'Show month', exact: true }).click();
    await expect(grid).toHaveAccessibleName('October 2026');
    await expect(calendar.getByText('1 visit · £60.00', { exact: true })).toBeVisible();
    await expect(calendar.getByRole('button', { name: 'Next month' })).toBeDisabled();
    expect((await card.boundingBox())!.height).toBe(328);
    await expect(grid.getByRole('button', { name: /^Thursday 1 October/ })).toHaveAttribute('data-visit', 'true');
    await expect(card.locator('[data-legend], [data-rag]')).toHaveCount(0);
  });

  test('a visit is marked with the tint dot in the circle under its number', async ({ page }) => {
    const calendar = await openCalendar(page);
    // Today is chosen at first: last week's visit is not.
    await calendar.getByRole('button', { name: 'Previous week' }).click();
    const visit = calendar.getByRole('grid').getByRole('button', { name: /^Thursday 1 October/ });
    const mark = await visit
      .locator('span')
      .first()
      .evaluate((el) => {
        const after = getComputedStyle(el, '::after');
        return { content: after.content, size: `${after.width} x ${after.height}`, colour: after.backgroundColor, bottom: after.bottom };
      });
    expect(mark).toEqual({ content: '""', size: '5px x 5px', colour: 'rgb(0, 122, 255)', bottom: '4px' });
  });
});
