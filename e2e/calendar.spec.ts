import {
  areaCards,
  attentionScreen,
  calendar,
  chooseWho,
  closeArea,
  expect,
  goToTab,
  housekeepingScreen,
  meta,
  openArea,
  openSeeded,
  reopen,
  ring,
  tabButton,
  test,
  views,
  type Locator,
  type Page,
} from './fixtures';

// Needs attention's calendar (docs/ARCHITECTURE.md "Needs attention: the calendar") against the demo seed at the
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
const control = (page: Page, name: 'Today' | 'Previous week' | 'Next week' | 'Previous month' | 'Next month') =>
  calendar(page).getByRole('button', { name, exact: true });
/** The line Housekeeping's bar shows for today; Needs attention never shows it (today's list is open at once). */
const summary = (page: Page) => calendar(page).locator('[data-today-summary]');
/** The calendar's heading over the card: "This week", "Next week", "This month"... */
const heading = (page: Page) => calendar(page).getByRole('heading', { level: 2 });
/** The accessible name of the focused element. */
const focusedName = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName) : null;
  });

/** The status colours of a day's dots, in order (faint ones end in "(repeat)"). */
function dots(button: Locator): Promise<string[]> {
  return button
    .locator('[data-rag]')
    .evaluateAll((els) => els.map((el) => `${el.getAttribute('data-rag')}${el.hasAttribute('data-repeat') ? ' (repeat)' : ''}`));
}

test.beforeEach(async ({ page }) => {
  await openSeeded(page, 'Calendar');
});

test.describe('Needs attention calendar', () => {
  test('the week strip: this week, today chosen and ringed, each day marked', async ({ page }) => {
    // Needs attention's second view, under the view switch, on its own: no list with it.
    await expect(views(page).getByRole('radio', { name: 'Calendar' })).toHaveAttribute('aria-checked', 'true');
    await expect(attentionScreen(page).locator('section[data-group]')).toHaveCount(0);
    // A section named by its heading, which says which week it is.
    await expect(heading(page)).toHaveText('This week');
    await expect(attentionScreen(page).getByRole('region', { name: 'This week' })).toBeVisible();

    await expect(grid(page)).toHaveAccessibleName('Week of Monday 5 October');
    await expect(grid(page).getByRole('button')).toHaveCount(7);
    await expect(calendar(page).getByText('5 to 11 October', { exact: true })).toBeVisible();
    await expect(control(page, 'Previous week')).toBeVisible();
    await expect(control(page, 'Next week')).toBeVisible();
    await expect(day(page, 'Tuesday 6 October')).toHaveAccessibleName('Tuesday 6 October, 1 missed (urgent)');
    await expect(day(page, 'Thursday 8 October')).toHaveAccessibleName('Thursday 8 October, today, 1 due (not urgent), selected');
    await expect(day(page, 'Saturday 10 October')).toHaveAccessibleName('Saturday 10 October, 1 due (not urgent)');
    await expect(day(page, 'Friday 9 October')).toHaveAccessibleName('Friday 9 October');
    expect(await dots(day(page, 'Tuesday 6 October'))).toEqual(['red']);
    // Missed: the number in red.
    await expect(day(page, 'Tuesday 6 October')).toHaveCSS('color', 'rgb(215, 0, 21)');
    // Under the strip too, what the dots mean in words (each day's name says it for VoiceOver).
    const legend = calendar(page).locator('[data-legend]');
    await expect(legend).toBeVisible();
    await expect(legend).toHaveAttribute('aria-hidden', 'true');
    await expect(legend).toContainText('UrgentWithin the monthNot urgent');
    // Today is chosen: filled with the tint, its cell selected.
    await expect(day(page, 'Thursday 8 October').locator('xpath=..')).toHaveAttribute('aria-selected', 'true');

    // Today's list is open at once, with no line in its place.
    await expect(summary(page)).toHaveCount(0);
    await expect(control(page, 'Today')).toHaveCount(0);
    await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText('Thursday 8 October');
    // What is late comes first, "1 late" beside the heading (marked only on its own day, it left
    // today reading "Nothing due"), then today's own, under "Due today".
    await expect(panel(page).locator('[data-late-count]')).toHaveText('1 late');
    await expect(panel(page).locator('[data-late-count]')).toHaveCSS('color', 'rgb(215, 0, 21)');
    await expect(panel(page).locator('p')).toHaveText(['Due today']);
    expect(
      await panel(page)
        .getByRole('button', { name: /^Mark .* as done$/ })
        .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))),
    ).toEqual(['Mark Heaters not working as done', 'Mark Empty the dehumidifier as done']);
    // A row due that day leaves its date out, a late one says how late; each its urgency, its
    // room and who it is for.
    await expect(panel(page).locator('[data-meta]')).toHaveText(['Urgent2 days late·Hallway', 'Not urgent·Garden Lounge']);
    await expect(panel(page).locator('[data-who]')).toHaveText(['🦆Shea', '🦆Shea']);
    await day(page, 'Thursday 8 October').click();
    await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText('Thursday 8 October');
  });

  test('the strip moves a week at a time by taps, and Today comes back, also on a Sunday', async ({ page }) => {
    await control(page, 'Next week').click();
    await expect(grid(page)).toHaveAccessibleName('Week of Monday 12 October');
    await expect(calendar(page).getByText('12 to 18 October', { exact: true })).toBeVisible();
    await expect(heading(page)).toHaveText('Next week');
    await expect(grid(page).locator('[data-today]')).toHaveCount(0);
    // Today's list would read as part of next week: one quiet line asks for a day instead.
    await expect(panel(page)).toHaveCount(0);
    await expect(calendar(page).locator('[data-calendar-pick]')).toHaveText('Pick a day to see what is due.');
    await day(page, 'Wednesday 14 October').click();
    await expect(calendar(page).locator('[data-calendar-pick]')).toHaveCount(0);
    await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText('Wednesday 14 October');
    await control(page, 'Previous week').click();
    await control(page, 'Previous week').click();
    await expect(calendar(page).getByText('28 Sep to 4 Oct', { exact: true })).toBeVisible();
    await expect(heading(page)).toHaveText('Last week');
    await control(page, 'Today').click();
    await expect(grid(page)).toHaveAccessibleName('Week of Monday 5 October');
    await expect(day(page, 'Thursday 8 October')).toHaveAccessibleName('Thursday 8 October, today, 1 due (not urgent), selected');
    await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText('Thursday 8 October');
    await expect(heading(page)).toHaveText('This week');
    await expect(control(page, 'Today')).toHaveCount(0);
  });

  test('a December day, then Show week: back to this week with taps only', async ({ page }) => {
    await toggle(page, 'Show month').click();
    await control(page, 'Next month').click();
    await control(page, 'Next month').click();
    await expect(grid(page)).toHaveAccessibleName('December 2026');
    await expect(heading(page)).toHaveText('In 2 months');
    await day(page, 'Thursday 3 December').click();
    await toggle(page, 'Show week').click();
    // The chosen day's week, named, with its title.
    await expect(grid(page)).toHaveAccessibleName('Week of Monday 30 November');
    await expect(heading(page)).toHaveText('In 8 weeks');
    await expect(calendar(page).locator('[aria-live]').filter({ hasText: /^30 Nov to 6 Dec$/ })).toBeVisible();
    await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText('Thursday 3 December');
    await control(page, 'Today').click();
    await expect(grid(page)).toHaveAccessibleName('Week of Monday 5 October');
    await expect(grid(page).locator('[data-today][data-selected]')).toHaveCount(1);
  });

  test('Show month: the busy day, faint repeats, the visit and the legend; remembered on this device', async ({ page }) => {
    await toggle(page, 'Show month').click();
    await expect(grid(page)).toHaveAccessibleName('October 2026');
    await expect(heading(page)).toHaveText('This month');
    await expect(toggle(page, 'Show week')).toBeVisible();
    await expect(calendar(page).getByRole('button', { name: 'Previous month' })).toBeVisible();
    await expect(calendar(page).getByRole('button', { name: 'Next month' })).toBeEnabled();

    // Four due: three dots, red first, and "+1".
    const busy = day(page, 'Wednesday 14 October');
    await expect(busy).toHaveAccessibleName('Wednesday 14 October, 4 due (1 urgent, 1 within the month, 2 not urgent)');
    expect(await dots(busy)).toEqual(['red', 'amber', 'green']);
    await expect(busy).toContainText('+1');
    // The bins come round every week after, clearly lighter.
    const later = day(page, 'Wednesday 21 October');
    await expect(later).toHaveAccessibleName('Wednesday 21 October, 1 repeat');
    expect(await dots(later)).toEqual(['green (repeat)']);
    // Lighter, but 3:1 against the card: a hollow ring in the darker green at 80%.
    await expect(later.locator('[data-repeat]')).toHaveCSS('opacity', '0.8');
    await expect(later.locator('[data-repeat]')).toHaveCSS('box-shadow', 'rgb(31, 122, 54) 0px 0px 0px 1.5px inset');
    await expect(day(page, 'Thursday 15 October')).toHaveAccessibleName('Thursday 15 October, 1 due (not urgent), 1 repeat');
    // The housekeeper's visit: the dot in the circle Housekeeping's calendar uses.
    const visit = day(page, 'Thursday 1 October');
    await expect(visit).toHaveAccessibleName('Thursday 1 October, housekeeping visit');
    await expect(visit).toHaveAttribute('data-dot', 'true');
    // Today keeps its ring when another day is chosen.
    await busy.click();
    const today = day(page, 'Thursday 8 October');
    await expect(today).toHaveAccessibleName('Thursday 8 October, today, 1 due (not urgent)');
    // In the darker tint words use: 7:1 on the card (the system blue was 4:1).
    await expect(today).toHaveCSS('color', 'rgb(0, 88, 185)');
    await expect(today.locator('span').first()).toHaveCSS('box-shadow', 'rgb(0, 88, 185) 0px 0px 0px 1.5px inset');
    // What the marks mean, in words: the dots' colours, a repeat, the visit, a missed day.
    await expect(calendar(page).locator('[data-legend]')).toHaveText(
      'UrgentWithin the monthNot urgentRepeatHousekeepingRed date: missed',
    );

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
    await expect(day(page, 'Monday 12 October')).toHaveAccessibleName('Monday 12 October, 1 due (within the month)');
    await chooseWho(page, /^Shea,/);
    // Shea's two: the shower and the garden furniture.
    await expect(day(page, 'Wednesday 14 October')).toHaveAccessibleName('Wednesday 14 October, 2 due (1 within the month, 1 not urgent)');
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
    // Worded as a repeat of its due date, how often after it.
    await expect(panel(page).locator('[data-meta]')).toHaveText('Not urgent·Repeat of Wed 14 Oct·Every week·Front garden');
    await expect(panel(page).locator('[data-who]')).toHaveText('🦔Stratis');

    await day(page, 'Wednesday 14 October').click();
    await expect(said(page)).toHaveText('Wednesday 14 October: 4 due (1 urgent, 1 within the month, 2 not urgent). Details below the calendar.');
    await expect(day(page, 'Wednesday 14 October')).toHaveAccessibleName('Wednesday 14 October, 4 due (1 urgent, 1 within the month, 2 not urgent), selected');
    const rings = panel(page).getByRole('button', { name: /^Mark / });
    await expect(rings).toHaveCount(4);
    // In the order of its marks: the red one first, then amber, then green.
    expect(await rings.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual([
      'Mark Clear the gutters as done',
      'Mark Shower draining slowly as done',
      'Mark Cover the garden furniture as done',
      'Mark Put the bins out as done',
    ]);
    // A one-off: gone from the day (and from its room, below).
    await panel(page).getByRole('button', { name: 'Mark Cover the garden furniture as done' }).click();
    await expect(rings).toHaveCount(3);
    await expect(day(page, 'Wednesday 14 October')).toHaveAccessibleName('Wednesday 14 October, 3 due (1 urgent, 1 within the month, 1 not urgent), selected');
    // A weekly one moves on a week: due on the 21st, its repeat on the 28th.
    await panel(page).getByRole('button', { name: 'Mark Put the bins out as done' }).click();
    await expect(rings).toHaveCount(2);
    await expect(day(page, 'Wednesday 21 October')).toHaveAccessibleName('Wednesday 21 October, 1 due (not urgent)');
    await expect(day(page, 'Wednesday 28 October')).toHaveAccessibleName('Wednesday 28 October, 1 repeat');
    // The row opens the Item sheet.
    await panel(page).getByRole('button', { name: /^Shower draining slowly/ }).click();
    await expect(page.getByRole('dialog', { name: 'Edit item' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Edit item' })).toHaveCount(0);
    // Everywhere: the areas say the same.
    await goToTab(page, 'Home');
    await openArea(page, 'Garden Lounge');
    await expect(ring(page, 'Cover the garden furniture')).toHaveCount(0);
    await closeArea(page);
    await openArea(page, 'Front garden');
    await expect(meta(page, 'Put the bins out')).toHaveText('Not urgent·In 13 days');
  });

  test('the visit opens that day in Housekeeping', async ({ page }) => {
    await toggle(page, 'Show month').click();
    await day(page, 'Thursday 1 October').click();
    await expect(panel(page)).toContainText('Nothing due.');
    await panel(page).getByRole('button', { name: 'Housekeeping visit, 6 of 7 done, £60.00. Show in Housekeeping' }).click();
    await expect(tabButton(page, 'Housekeeping')).toHaveAttribute('aria-current', 'page');
    const screen = housekeepingScreen(page);
    const heading = screen.getByRole('heading', { level: 2, name: 'Thursday 1 October' });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    // Chosen in Housekeeping's date picker, in its week.
    await expect(screen.getByRole('grid')).toHaveAccessibleName('Week of Monday 28 September');
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
    await expect(said(page)).toHaveText('Wednesday 14 October: 4 due (1 urgent, 1 within the month, 2 not urgent). Details below the calendar.');
    await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText('Wednesday 14 October');
    // Only the chosen day is in the tab order.
    await expect(grid(page).locator('button[tabindex="0"]')).toHaveCount(1);
  });

  test('keyboard: completing from today’s list keeps focus in it, then on the day', async ({ page }) => {
    await day(page, 'Thursday 8 October').click();
    // From the day, Tab goes to the first row's ring: the late job, listed first.
    await page.keyboard.press('Tab');
    const late = panel(page).getByRole('button', { name: 'Mark Heaters not working as done' });
    await expect(late).toBeFocused();
    const ringButton = panel(page).getByRole('button', { name: 'Mark Empty the dehumidifier as done' });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(ringButton).toBeFocused();
    await page.keyboard.press('Enter');
    // The weekly job moved on a week, out of today's list: focus goes to the row left, not lost.
    await expect(ringButton).toHaveCount(0);
    await expect(panel(page)).toContainText('Nothing due today.');
    await expect(panel(page).getByRole('button', { name: /^Heaters not working/ })).toBeFocused();
    // The late one done too: nothing left, so focus is on today.
    await page.keyboard.press('Shift+Tab');
    await expect(late).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(day(page, 'Thursday 8 October')).toBeFocused();
    await expect(day(page, 'Thursday 8 October')).toHaveAccessibleName('Thursday 8 October, today, selected');
    await expect(panel(page)).toContainText('Nothing due today.');
    await expect(panel(page).locator('p')).toHaveText(['Nothing due today.']);
    await expect(panel(page).locator('[data-late-count]')).toHaveCount(0);
  });

  test('Shea’s late job is on her today, not only on the day it was due', async ({ page }) => {
    await chooseWho(page, /^Shea,/);
    // Her only job due today, done: what is left today is the late one.
    await panel(page).getByRole('button', { name: 'Mark Empty the dehumidifier as done' }).click();
    await expect(panel(page).getByRole('button', { name: 'Mark Empty the dehumidifier as done' })).toHaveCount(0);
    await expect(panel(page).locator('[data-late-count]')).toHaveText('1 late');
    await expect(panel(page).locator('p')).toHaveText(['Nothing due for Shea today.']);
    await expect(panel(page).getByRole('button', { name: /^Heaters not working ?, Urgent, 2 days late, Hallway/ })).toBeVisible();
  });

  test('keyboard: moving into another week leaves the chosen day’s list out until Enter chooses a day', async ({ page }) => {
    await day(page, 'Tuesday 6 October').click();
    await page.keyboard.press('ArrowDown');
    await expect(grid(page)).toHaveAccessibleName('Week of Monday 12 October');
    expect(await focusedName(page)).toMatch(/^Tuesday 13 October/);
    await expect(panel(page)).toHaveCount(0);
    await expect(calendar(page).locator('[data-calendar-pick]')).toHaveText('Pick a day to see what is due.');
    await page.keyboard.press('Enter');
    await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText('Tuesday 13 October');
    // Back to the day with its row, from the keyboard, and it completes from there.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(panel(page).getByRole('button', { name: 'Mark Heaters not working as done' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toContainText('Nothing due.');
    await expect(day(page, 'Tuesday 6 October')).toBeFocused();
  });

  test('a new day after midnight: the strip shows the new week, even after a tap', async ({ page }) => {
    await day(page, 'Sunday 11 October').click();
    await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText('Sunday 11 October');
    // Back from the background on Monday morning (Home rechecks the day every minute).
    await page.clock.fastForward(94 * 60 * 60 * 1000);
    await expect(grid(page)).toHaveAccessibleName('Week of Monday 12 October');
    await expect(grid(page).locator('[data-today][data-selected]')).toHaveAccessibleName(/^Monday 12 October, today/);
    await expect(grid(page).locator('button[tabindex="0"]')).toHaveAccessibleName(/^Monday 12 October, today/);
    await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText('Monday 12 October');
  });

  test('Reduce Motion: no transitions', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await toggle(page, 'Show month').click();
    await expect(day(page, 'Wednesday 14 October').locator('span').first()).toHaveCSS('transition-duration', '0s');
  });
});

test.describe('Needs attention calendar fits', () => {
  for (const width of [320, 375, 402]) {
    test(`at ${width}px: no sideways scroll, days at least 40 by 44, the rest 44px targets`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await openSeeded(page, 'Calendar');
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
      const visit = (await panel(page).getByRole('button', { name: /^Housekeeping visit/ }).boundingBox())!;
      expect(visit.height).toBeGreaterThanOrEqual(44);
      // Show week: a 44px tap target of its own, reaching 12px above and below the text,
      // and nothing else's target over it.
      const showWeek = toggle(page, 'Show week');
      await showWeek.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const target = (await showWeek.boundingBox())!;
      expect(target.height).toBeGreaterThanOrEqual(44);
      for (const dy of [1, target.height - 1]) {
        const hit = await page.evaluate(
          ([x, y]) => document.elementFromPoint(x, y)?.textContent,
          [target.x + target.width / 2, target.y + dy] as const,
        );
        expect(hit).toBe('Show week');
      }
      for (const name of ['Previous month', 'Next month', 'Today'] as const) {
        const nav = (await control(page, name).boundingBox())!;
        expect(nav.width).toBeGreaterThanOrEqual(44);
        expect(nav.height).toBeGreaterThanOrEqual(44);
      }
      await toggle(page, 'Show week').click();
      for (const name of ['Previous week', 'Next week'] as const) {
        const nav = (await control(page, name).boundingBox())!;
        expect(nav.width).toBeGreaterThanOrEqual(44);
        expect(nav.height).toBeGreaterThanOrEqual(44);
      }
      // The week's title fits on one line between them.
      const title = (await calendar(page).getByText('28 Sep to 4 Oct', { exact: true }).boundingBox())!;
      expect(title.height).toBeLessThanOrEqual(23);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }

  test('a view of its own: at 402 by 874 its heading, the strip and today’s first row on the first screen', async ({ page }) => {
    await expect(heading(page)).toBeInViewport({ ratio: 1 });
    await expect(grid(page)).toBeInViewport({ ratio: 1 });
    await expect(panel(page).getByRole('listitem').first()).toBeInViewport({ ratio: 1 });
    // Home has no calendar: the first cards are on the first screen.
    await goToTab(page, 'Home');
    await expect(areaCards(page).first()).toBeInViewport();
    await expect(areaCards(page).nth(1)).toBeInViewport();
  });

  test('at 320 by 700 the first area’s card shows on the first screen of Home', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await openSeeded(page);
    await expect(areaCards(page).first()).toBeInViewport();
  });

  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`at 320 by 700, a day low in the month comes up above the + (${reducedMotion})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      await page.setViewportSize({ width: 320, height: 700 });
      await openSeeded(page, 'Calendar');
      await toggle(page, 'Show month').click();
      // The month's top near the top of the screen, its last row low on it.
      await calendar(page).evaluate((el) => {
        const scroller = el.closest('[class*="scroll"]')!;
        scroller.scrollTop += el.getBoundingClientRect().top - 60;
      });
      await day(page, 'Wednesday 28 October').click();
      const firstRow = panel(page).getByRole('listitem').first();
      await expect(firstRow).toBeVisible();
      await expect
        .poll(async () => {
          const row = (await firstRow.boundingBox())!;
          const add = (await page.getByRole('button', { name: 'New item', exact: true }).boundingBox())!;
          return row.y + row.height <= add.y && row.y >= 0;
        })
        .toBe(true);
      // Focus stays on the day.
      await expect(day(page, 'Wednesday 28 October')).toBeFocused();
    });
  }
});

test.describe('the Housekeeping calendar: the same date picker', () => {
  test('the same bar and card: the week strip, 46px days with 40px circles, a dot for a visit, no marks or legend; the month with its total', async ({
    page,
  }) => {
    const homeBar = (await calendar(page).locator('[data-calendar-bar]').boundingBox())!;
    const homeCard = (await grid(page).locator('xpath=..').boundingBox())!;
    await goToTab(page, 'Housekeeping');
    const screen = housekeepingScreen(page);
    const hkCalendar = screen.getByRole('region', { name: 'Calendar', exact: true });
    const hkGrid = hkCalendar.getByRole('grid');
    await expect(hkGrid).toHaveAccessibleName('Week of Monday 5 October');
    await expect(hkCalendar.getByText('5 to 11 October', { exact: true })).toBeVisible();
    await expect(hkCalendar.getByRole('button', { name: 'Show month', exact: true })).toBeVisible();
    await expect(hkCalendar.getByRole('button', { name: 'Next week' })).toBeDisabled();
    // The bar is Needs attention's (that one is 48px tall, for its heading); the card is as wide, a little
    // taller without marks under the days.
    const bar = (await hkCalendar.locator('[data-calendar-bar]').boundingBox())!;
    expect([bar.x, bar.width]).toEqual([homeBar.x, homeBar.width]);
    expect([bar.height, homeBar.height]).toEqual([44, 48]);
    const card = hkGrid.locator('xpath=..');
    const box = (await card.boundingBox())!;
    expect([box.x, box.width]).toEqual([homeCard.x, homeCard.width]);
    expect(box.width).toBe(370);
    expect(box.height).toBe(140);
    const oct8 = hkGrid.getByRole('button', { name: /^Thursday 8 October/ });
    expect((await oct8.boundingBox())!.height).toBe(46);
    expect((await oct8.locator('span').first().boundingBox())!.width).toBe(40);
    // The chosen day: white on the deeper tint fill, 4.7:1 (the system blue was 4:1).
    await expect(oct8.locator('span').first()).toHaveCSS('background-color', 'rgb(0, 113, 227)');
    await expect(card.locator('[data-legend], [data-rag]')).toHaveCount(0);
    await expect(hkGrid.getByRole('button', { name: /^Friday 9 October/ })).toBeDisabled();

    // The month: its title and total, as before, and the visit's dot.
    await hkCalendar.getByRole('button', { name: 'Show month', exact: true }).click();
    await expect(hkGrid).toHaveAccessibleName('October 2026');
    await expect(hkCalendar.getByText('1 visit · £60.00', { exact: true })).toBeVisible();
    await expect(hkCalendar.getByRole('button', { name: 'Next month' })).toBeDisabled();
    expect((await card.boundingBox())!.height).toBe(328);
    await expect(hkGrid.getByRole('button', { name: /^Thursday 1 October/ })).toHaveAttribute('data-visit', 'true');
    await expect(card.locator('[data-legend], [data-rag]')).toHaveCount(0);
    // Needs attention's choice is its own.
    await goToTab(page, 'Attention');
    await expect(toggle(page, 'Show month')).toBeVisible();
  });

  test('a visit is marked the same way on both calendars: the tint dot in the circle', async ({ page }) => {
    const mark = (button: Locator) =>
      button.locator('span').first().evaluate((el) => {
        const after = getComputedStyle(el, '::after');
        return { content: after.content, size: `${after.width} x ${after.height}`, colour: after.backgroundColor, bottom: after.bottom };
      });
    await toggle(page, 'Show month').click();
    // Not chosen on Needs attention, so the dot is the tint.
    const home = await mark(day(page, 'Thursday 1 October'));
    expect(home).toEqual({ content: '""', size: '5px x 5px', colour: 'rgb(0, 122, 255)', bottom: '4px' });
    await goToTab(page, 'Housekeeping');
    const hkCalendar = housekeepingScreen(page).getByRole('region', { name: 'Calendar', exact: true });
    // Today is chosen at first: last week's visit is not.
    await hkCalendar.getByRole('button', { name: 'Previous week' }).click();
    const hk = hkCalendar.getByRole('grid').getByRole('button', { name: /^Thursday 1 October/ });
    expect(await mark(hk)).toEqual(home);
  });
});
