import {
  areas,
  calendar,
  expect,
  goToTab,
  housekeepingScreen,
  homeScreen,
  openSeeded,
  reopen,
  ring,
  tabButton,
  test,
  type Locator,
  type Page,
} from './fixtures';

// Home's calendar (docs/ARCHITECTURE.md "Home: the calendar") against the demo seed at the
// e2e clock (Thu 8 Oct 2026, 10:00 London). This week: Heaters missed on Tue 6, the
// dehumidifier due today (weekly), the plants on Sat 10 (weekly). Wed 14 has four things
// due (the gutters red, the shower amber, the garden furniture and the bins (weekly) green;
// DEMO_CALENDAR_ITEMS in src/lib/constants.ts), the weekly jobs
// come round faint after that, and the housekeeper came on Thu 1 Oct (6 of 7 done, £60.00).

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

const grid = (page: Page) => calendar(page).getByRole('grid');
const day = (page: Page, name: string | RegExp) =>
  grid(page).getByRole('button', { name: typeof name === 'string' ? new RegExp(`^${name}(,|$)`) : name });
/** The chosen day, under the calendar. */
const panel = (page: Page) => calendar(page).locator('[data-calendar-day]');
const said = (page: Page) => calendar(page).locator('[data-announcer]');
const toggle = (page: Page, name: 'Show month' | 'Show week') => calendar(page).getByRole('button', { name, exact: true });

/** The status colours of a day's dots, in order (faint ones end in "(repeat)"). */
function dots(button: Locator): Promise<string[]> {
  return button
    .locator('[data-rag]')
    .evaluateAll((els) => els.map((el) => `${el.getAttribute('data-rag')}${el.hasAttribute('data-repeat') ? ' (repeat)' : ''}`));
}

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
});

test.describe('Home calendar', () => {
  test('the week strip: this week, today chosen and ringed, each day marked', async ({ page }) => {
    // Under the person filter, above the areas.
    const order = await homeScreen(page)
      .locator('[role="radiogroup"], section[data-calendar], section[data-area-id]')
      .evaluateAll((els) => els.slice(0, 3).map((el) => el.getAttribute('aria-label') ?? (el.hasAttribute('data-calendar') ? 'calendar' : 'area')));
    expect(order).toEqual(['Show tasks for', 'calendar', 'area']);

    await expect(grid(page)).toHaveAccessibleName('Week of Monday 5 October');
    await expect(grid(page).getByRole('button')).toHaveCount(7);
    await expect(day(page, 'Tuesday 6 October')).toHaveAccessibleName('Tuesday 6 October, 1 missed');
    await expect(day(page, 'Thursday 8 October')).toHaveAccessibleName('Thursday 8 October, today, 1 due, selected');
    await expect(day(page, 'Saturday 10 October')).toHaveAccessibleName('Saturday 10 October, 1 due');
    await expect(day(page, 'Friday 9 October')).toHaveAccessibleName('Friday 9 October');
    expect(await dots(day(page, 'Tuesday 6 October'))).toEqual(['red']);
    // Missed: the number in red.
    await expect(day(page, 'Tuesday 6 October')).toHaveCSS('color', 'rgb(215, 0, 21)');
    // Today is chosen: filled with the tint, its cell selected.
    await expect(day(page, 'Thursday 8 October').locator('xpath=..')).toHaveAttribute('aria-selected', 'true');

    await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText('Thursday 8 October');
    await expect(panel(page).getByRole('button', { name: 'Mark Empty the dehumidifier as done' })).toBeVisible();
  });

  test('Show month: the busy day, faint repeats, the broom and the legend; remembered on this device', async ({ page }) => {
    await toggle(page, 'Show month').click();
    await expect(grid(page)).toHaveAccessibleName('October 2026');
    await expect(toggle(page, 'Show week')).toBeVisible();
    await expect(calendar(page).getByRole('button', { name: 'Previous month' })).toBeVisible();
    await expect(calendar(page).getByRole('button', { name: 'Next month' })).toBeEnabled();

    // Four due: three dots, red first, and "+1".
    const busy = day(page, 'Wednesday 14 October');
    await expect(busy).toHaveAccessibleName('Wednesday 14 October, 4 due');
    expect(await dots(busy)).toEqual(['red', 'amber', 'green']);
    await expect(busy).toContainText('+1');
    // The bins come round every week after, clearly lighter.
    const later = day(page, 'Wednesday 21 October');
    await expect(later).toHaveAccessibleName('Wednesday 21 October, 1 repeat');
    expect(await dots(later)).toEqual(['green (repeat)']);
    await expect(later.locator('[data-repeat]')).toHaveCSS('opacity', '0.55');
    await expect(day(page, 'Thursday 15 October')).toHaveAccessibleName('Thursday 15 October, 1 due, 1 repeat');
    // The housekeeper's visit: a broom.
    const visit = day(page, 'Thursday 1 October');
    await expect(visit).toHaveAccessibleName('Thursday 1 October, housekeeping visit');
    await expect(visit.locator('[data-broom]')).toBeVisible();
    // Today keeps its ring when another day is chosen.
    await busy.click();
    const today = day(page, 'Thursday 8 October');
    await expect(today).toHaveAccessibleName('Thursday 8 October, today, 1 due');
    await expect(today.locator('span').first()).toHaveCSS('box-shadow', 'rgb(0, 122, 255) 0px 0px 0px 1.5px inset');
    await expect(calendar(page).locator('[data-legend]')).toHaveText(/Due.*Missed.*Repeats.*Housekeeping/);

    // Remembered after a reload; the week again, also remembered.
    await reopen(page);
    await expect(toggle(page, 'Show week')).toBeVisible();
    await expect(grid(page)).toHaveAccessibleName('October 2026');
    await toggle(page, 'Show week').click();
    await expect(grid(page)).toHaveAccessibleName('Week of Monday 5 October');
    await reopen(page);
    await expect(toggle(page, 'Show month')).toBeVisible();
    await expect(grid(page)).toHaveAccessibleName('Week of Monday 5 October');
  });

  test('the person filter: only their items mark the calendar, the visit stays', async ({ page }) => {
    await toggle(page, 'Show month').click();
    await expect(day(page, 'Monday 12 October')).toHaveAccessibleName('Monday 12 October, 1 due');
    await homeScreen(page).getByRole('radiogroup', { name: 'Show tasks for' }).getByRole('radio', { name: /^Shea,/ }).click();
    // Shea's two: the shower and the garden furniture.
    await expect(day(page, 'Wednesday 14 October')).toHaveAccessibleName('Wednesday 14 October, 2 due');
    expect(await dots(day(page, 'Wednesday 14 October'))).toEqual(['amber', 'green']);
    // The water test strips are unassigned, the plants Ela's.
    await expect(day(page, 'Monday 12 October')).toHaveAccessibleName('Monday 12 October');
    await expect(day(page, 'Saturday 10 October')).toHaveAccessibleName('Saturday 10 October');
    await expect(day(page, 'Thursday 1 October')).toHaveAccessibleName('Thursday 1 October, housekeeping visit');
    await day(page, 'Saturday 10 October').click();
    await expect(panel(page)).toContainText('Nothing due for Shea.');
  });

  test('choosing a day shows its items; one completes from there, everywhere', async ({ page }) => {
    await toggle(page, 'Show month').click();
    // A repeat to come: labelled, opened but not completed.
    await day(page, 'Wednesday 21 October').click();
    await expect(said(page)).toHaveText('Wednesday 21 October: 1 repeat. Details below the calendar.');
    await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText('Wednesday 21 October');
    await expect(panel(page).getByRole('button', { name: /^Mark / })).toHaveCount(0);
    await expect(panel(page).locator('[data-meta]')).toHaveText('🦔 Stratis · Repeats every week · Due Wed 14 Oct');

    await day(page, 'Wednesday 14 October').click();
    await expect(said(page)).toHaveText('Wednesday 14 October: 4 due. Details below the calendar.');
    await expect(day(page, 'Wednesday 14 October')).toHaveAccessibleName('Wednesday 14 October, 4 due, selected');
    const rings = panel(page).getByRole('button', { name: /^Mark / });
    await expect(rings).toHaveCount(4);
    // A one-off: gone from the day and from its area.
    await panel(page).getByRole('button', { name: 'Mark Cover the garden furniture as done' }).click();
    await expect(rings).toHaveCount(3);
    await expect(ring(page, 'Cover the garden furniture')).toHaveCount(0);
    await expect(day(page, 'Wednesday 14 October')).toHaveAccessibleName('Wednesday 14 October, 3 due, selected');
    // A weekly one moves on a week: due on the 21st, its repeat on the 28th.
    await panel(page).getByRole('button', { name: 'Mark Put the bins out as done' }).click();
    await expect(rings).toHaveCount(2);
    await expect(day(page, 'Wednesday 21 October')).toHaveAccessibleName('Wednesday 21 October, 1 due');
    await expect(day(page, 'Wednesday 28 October')).toHaveAccessibleName('Wednesday 28 October, 1 repeat');
    await expect(areas(page).getByRole('listitem').filter({ hasText: 'Put the bins out' }).locator('[data-meta]')).toHaveText(
      '🦔 Stratis · Wed 21 Oct',
    );
    // The row opens the Item sheet.
    await panel(page).getByRole('button', { name: /^Shower draining slowly/ }).click();
    await expect(page.getByRole('dialog', { name: 'Edit item' })).toBeVisible();
  });

  test('the visit opens that day in Housekeeping', async ({ page }) => {
    await toggle(page, 'Show month').click();
    await day(page, 'Thursday 1 October').click();
    await expect(panel(page)).toContainText('Nothing due.');
    await panel(page).getByRole('button', { name: 'Housekeeping visit, 6 of 7 done, £60.00. Show in Housekeeping' }).click();
    await expect(tabButton(page, 'Housekeeping')).toHaveAttribute('aria-current', 'page');
    const screen = housekeepingScreen(page);
    const heading = screen.getByRole('heading', { level: 3, name: 'Thursday 1 October' });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    await expect(screen.getByRole('grid').getByRole('button', { name: /^Thursday 1 October/ })).toHaveAccessibleName(
      'Thursday 1 October, visit, 6 of 7 done, £60.00, selected',
    );
  });

  test('keyboard: arrows move a day or a week, the strip follows, Enter chooses', async ({ page }) => {
    const today = day(page, 'Thursday 8 October');
    await today.focus();
    await page.keyboard.press('End');
    await expect(day(page, 'Sunday 11 October')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(grid(page)).toHaveAccessibleName('Week of Monday 12 October');
    await expect(day(page, 'Monday 12 October')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(day(page, 'Wednesday 14 October')).toBeFocused();
    await expect(said(page)).toHaveText('Wednesday 14 October: 4 due. Details below the calendar.');
    await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText('Wednesday 14 October');
    // Only the chosen day is in the tab order.
    await expect(grid(page).locator('button[tabindex="0"]')).toHaveCount(1);
  });

  test('Reduce Motion: no transitions', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await toggle(page, 'Show month').click();
    await expect(day(page, 'Wednesday 14 October').locator('span').first()).toHaveCSS('transition-duration', '0s');
  });
});

test.describe('Home calendar fits', () => {
  for (const width of [320, 375, 402]) {
    test(`at ${width}px: no sideways scroll, days at least 40 by 44, the rest 44px targets`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await openSeeded(page);
      await toggle(page, 'Show month').click();
      await day(page, 'Thursday 1 October').click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const boxes = await grid(page)
        .getByRole('button')
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height })));
      for (const box of boxes) {
        expect(box.h).toBeGreaterThanOrEqual(44);
        // Below 360 wide the whole cell is the target (about 40 wide), as on Housekeeping.
        expect(box.w).toBeGreaterThanOrEqual(width < 360 ? 39.5 : 44);
      }
      // The broom's badge stays inside its day's cell.
      const cell = (await day(page, 'Thursday 1 October').boundingBox())!;
      const broom = (await day(page, 'Thursday 1 October').locator('[data-broom]').boundingBox())!;
      expect(broom.x + broom.width).toBeLessThanOrEqual(cell.x + cell.width + 1.5);
      const visit = (await panel(page).getByRole('button', { name: /^Housekeeping visit/ }).boundingBox())!;
      expect(visit.height).toBeGreaterThanOrEqual(44);
      // Show week: its tap target reaches 10px above and below the text.
      const control = toggle(page, 'Show week');
      await control.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const text = (await control.boundingBox())!;
      for (const dy of [-10, text.height + 10]) {
        const hit = await page.evaluate(
          ([x, y]) => document.elementFromPoint(x, y)?.textContent,
          [text.x + text.width / 2, text.y + dy] as const,
        );
        expect(hit).toBe('Show week');
      }
      for (const name of ['Previous month', 'Next month']) {
        const nav = (await calendar(page).getByRole('button', { name }).boundingBox())!;
        expect(nav.width).toBeGreaterThanOrEqual(44);
        expect(nav.height).toBeGreaterThanOrEqual(44);
      }
    });
  }
});

test.describe('the Housekeeping calendar, unchanged', () => {
  test('the same card: month title and total, 46px days with 40px circles, a dot for a visit, no marks or legend', async ({ page }) => {
    await goToTab(page, 'Housekeeping');
    const screen = housekeepingScreen(page);
    const hkGrid = screen.getByRole('grid');
    await expect(hkGrid).toHaveAccessibleName('October 2026');
    await expect(screen.getByText('1 visit · £60.00', { exact: true })).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    await expect(screen.getByRole('button', { name: 'Show month' })).toHaveCount(0);
    const card = hkGrid.locator('xpath=..');
    const box = (await card.boundingBox())!;
    expect(box.width).toBe(370);
    expect(box.height).toBe(328);
    const oct1 = hkGrid.getByRole('button', { name: /^Thursday 1 October/ });
    expect((await oct1.boundingBox())!.height).toBe(46);
    expect((await oct1.locator('span').first().boundingBox())!.width).toBe(40);
    await expect(oct1).toHaveAttribute('data-visit', 'true');
    await expect(oct1.locator('span').first()).toHaveCSS('background-color', 'rgb(0, 122, 255)');
    await expect(card.locator('[data-legend], [data-broom], [data-rag]')).toHaveCount(0);
    await expect(hkGrid.getByRole('button', { name: /^Friday 9 October/ })).toBeDisabled();
  });
});
