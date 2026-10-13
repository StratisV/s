import {
  addButton,
  confirmation,
  expect,
  goToTab,
  housekeepingScreen,
  openSeeded,
  reopen,
  settled,
  tabButton,
  tabs,
  test,
  toast,
  type Locator,
  type Page,
} from './fixtures';

// The Housekeeping tab (docs/ARCHITECTURE.md "Housekeeping") against the demo seed, at the
// e2e clock (Thu 8 Oct 2026, 10:00 London): the message from Shea yesterday at 19:20, the
// starter task list, no visit today, and visits on Thu 1 Oct, 24 Sep, 17 Sep, 10 Sep and
// 3 Sep (HOUSEKEEPING_DEMO_VISITS). The calendar is Home's date picker: this week (5 to 11
// October) at first, with today chosen.

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

const STARTER = [
  'Change the bed sheets',
  'Hoover and mop the floors',
  'Clean the bathrooms',
  'Clean the kitchen',
  'Dust the surfaces',
  'Empty the bins',
  'Ironing',
];

async function openHousekeeping(page: Page): Promise<Locator> {
  await openSeeded(page);
  await goToTab(page, 'Housekeeping');
  const screen = housekeepingScreen(page);
  await expect(screen.getByRole('heading', { name: 'Housekeeping', level: 1 })).toBeVisible();
  return screen;
}

const today = (screen: Locator) => screen.getByRole('region', { name: 'Today', exact: true });
const calendar = (screen: Locator) => screen.getByRole('region', { name: 'Calendar', exact: true });
const grid = (screen: Locator) => screen.getByRole('grid');
const day = (screen: Locator, name: string | RegExp) =>
  grid(screen).getByRole('button', { name: typeof name === 'string' ? new RegExp(`^${name}(,|$)`) : name });
/** A button of the calendar: Today, Show month, Previous week… */
const control = (screen: Locator, name: string) => calendar(screen).getByRole('button', { name, exact: true });
/** The line beside the calendar while today is chosen and shown. */
const line = (screen: Locator) => calendar(screen).locator('[data-today-summary]');
/** The chosen day before today, in place of the Today section. */
const detail = (screen: Locator) => screen.locator('[data-day-detail]');
/** Last week in the strip, and its visit (Thu 1 Oct) chosen. */
async function chooseLastVisit(screen: Locator): Promise<void> {
  await control(screen, 'Previous week').click();
  await day(screen, 'Thursday 1 October').click();
  await expect(detail(screen).getByRole('heading', { level: 2 })).toHaveText('Thursday 1 October');
}
/** What the screen last said was saved (its polite live region). */
const said = (screen: Locator) => screen.locator('[data-announcer]');
const message = (screen: Locator) => screen.getByRole('textbox', { name: 'Message for the housekeeper' });

/** The task titles of a checklist, top to bottom, and which are ticked. */
async function checklist(group: Locator): Promise<{ title: string; done: boolean }[]> {
  return group.getByRole('checkbox').evaluateAll((boxes) =>
    boxes.map((box) => ({
      title: document.getElementById(box.getAttribute('aria-labelledby')!)!.textContent ?? '',
      done: (box as HTMLInputElement).checked,
    })),
  );
}

test.describe('Housekeeping tab', () => {
  test('is the third tab; the + is not on it and pops back on Stats', async ({ page }) => {
    await openSeeded(page);
    await expect(tabs(page).getByRole('button')).toHaveText(['Home', /^Chat/, 'Housekeeping', 'Stats']);
    await expect(addButton(page)).toBeVisible();
    await goToTab(page, 'Housekeeping');
    for (const name of ['Home', 'Chat', 'Stats'] as const) {
      await expect(tabButton(page, name)).not.toHaveAttribute('aria-current', 'page');
    }
    await expect(addButton(page)).toHaveCount(0);
    await goToTab(page, 'Stats');
    await expect(addButton(page)).toBeVisible();
  });

  for (const width of [320, 375, 402]) {
    test(`the four tabs fit at ${width}px, untruncated, with the thumb under the open one`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      const screen = await openHousekeeping(page);
      const fit = await tabs(page).evaluate((nav) => {
        const buttons = Array.from(nav.querySelectorAll('button'));
        /** The label's words fit inside the button: not cut off, not spilling out. */
        const whole = (b: HTMLElement) => {
          const range = document.createRange();
          range.selectNodeContents(b.querySelector('span')!.firstChild!);
          const text = range.getBoundingClientRect();
          const box = b.getBoundingClientRect();
          return text.left >= box.left - 0.5 && text.right <= box.right + 0.5 && b.scrollWidth <= b.clientWidth;
        };
        return {
          nav: nav.getBoundingClientRect().toJSON() as DOMRect,
          scroll: document.scrollingElement!.scrollWidth,
          inner: window.innerWidth,
          tops: buttons.map((b) => b.getBoundingClientRect().top),
          clipped: buttons.filter((b) => !whole(b)).map((b) => b.textContent),
          overflow: nav.scrollWidth > nav.clientWidth,
          last: buttons[3].getBoundingClientRect().right,
        };
      });
      expect(fit.scroll).toBeLessThanOrEqual(fit.inner);
      expect(fit.nav.x).toBeGreaterThanOrEqual(16);
      expect(fit.nav.x + fit.nav.width).toBeLessThanOrEqual(width - 16 + 0.5);
      expect(fit.last).toBeLessThanOrEqual(fit.nav.x + fit.nav.width);
      expect(new Set(fit.tops).size).toBe(1);
      expect(fit.clipped).toEqual([]);
      expect(fit.overflow).toBe(false);
      // The white thumb sits under Housekeeping once it has slid there.
      const open = tabButton(page, 'Housekeeping');
      const thumb = tabs(page).locator('span[aria-hidden="true"]').first();
      await expect
        .poll(async () => {
          const [a, b] = [(await open.boundingBox())!, (await thumb.boundingBox())!];
          return Math.abs(a.x - b.x) + Math.abs(a.width - b.width);
        })
        .toBeLessThan(1);
      // Nothing on the screen scrolls sideways either.
      await expect(screen.getByRole('grid')).toBeVisible();
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }

  test('shows today’s date, the date picker under the tab switch, the message, then today’s list', async ({ page }) => {
    const screen = await openHousekeeping(page);
    await expect(screen.getByText('Last visit Thu 1 Oct', { exact: true })).toBeVisible();
    // Today's date over the title, as on Home.
    await expect(screen.locator('time')).toHaveText('THURSDAY 8 OCTOBER', { useInnerText: true });
    await expect(screen.locator('time')).toHaveAttribute('datetime', '2026-10-08');
    await expect(screen.getByRole('heading', { level: 2 })).toHaveText([
      'Calendar',
      'Message for the housekeeper',
      'Today',
    ]);
    await expect(message(screen)).toHaveValue('Guests arrive Friday, please do the spare room first.');
    await expect(screen.getByText('🦆 Shea · Yesterday 19:20', { exact: true })).toBeVisible();

    const tasks = today(screen).getByRole('group', { name: 'Tasks today' });
    expect(await checklist(tasks)).toEqual(STARTER.map((title) => ({ title, done: false })));
    await expect(today(screen).getByText("Not started yet. Ticking a task starts today's visit.")).toBeVisible();

    // Right under the tab switch: this week, today chosen and ringed, a line on today's visit.
    const below = await calendar(screen).evaluate((el) => {
      const nav = document.querySelector('nav[aria-label="Tabs"]')!.getBoundingClientRect();
      return el.getBoundingClientRect().top - nav.bottom;
    });
    expect(below).toBeGreaterThanOrEqual(0);
    expect(below).toBeLessThanOrEqual(12);
    await expect(grid(screen)).toHaveAccessibleName('Week of Monday 5 October');
    await expect(calendar(screen).getByText('5 to 11 October', { exact: true })).toBeVisible();
    await expect(day(screen, 'Thursday 8 October')).toHaveAccessibleName('Thursday 8 October, today, selected');
    await expect(day(screen, 'Thursday 8 October')).toHaveAttribute('data-today', 'true');
    await expect(line(screen)).toHaveText('No visit yet today');
    await expect(control(screen, 'Today')).toHaveCount(0);
    await expect(control(screen, 'Show month')).toBeVisible();
    // Days to come can't have a visit, and there is no week after this one yet.
    await expect(day(screen, 'Friday 9 October')).toBeDisabled();
    await expect(control(screen, 'Next week')).toBeDisabled();

    // Last week: the visit's dot; chosen, what was asked that day and what was done, in place of today's.
    await control(screen, 'Previous week').click();
    await expect(calendar(screen).getByText('28 Sep to 4 Oct', { exact: true })).toBeVisible();
    await expect(day(screen, 'Thursday 1 October')).toHaveAccessibleName('Thursday 1 October, visit, 6 of 7 done, £60.00');
    await expect(day(screen, 'Thursday 1 October')).toHaveAttribute('data-visit', 'true');
    await day(screen, 'Thursday 1 October').click();
    await expect(today(screen)).toHaveCount(0);
    const visit = detail(screen);
    await expect(visit.getByRole('heading', { level: 2 })).toHaveText('Thursday 1 October');
    await expect(visit.getByText('Please leave the ironing for next week.', { exact: true })).toBeVisible();
    expect(await checklist(visit.getByRole('group', { name: 'Tasks on Thursday 1 October' }))).toEqual(
      STARTER.map((title) => ({ title, done: title !== 'Ironing' })),
    );
    // Named with their day, apart from today's.
    await expect(visit.getByRole('textbox', { name: 'Comments, Thursday 1 October', exact: true })).toHaveValue(
      "Ironing left for next week as asked. We're out of bin bags.",
    );
    await expect(visit.getByRole('textbox', { name: 'Price for the day, Thursday 1 October', exact: true })).toHaveValue(
      '60.00',
    );
    await expect(visit.getByText(/^Recorded by 🦊 Ela · Thu 1 Oct 10:05/)).toBeVisible();
  });

  test('ticking a task starts today’s visit; unticking takes the tick back', async ({ page }) => {
    const screen = await openHousekeeping(page);
    const box = today(screen).getByRole('checkbox', { name: 'Change the bed sheets' });
    await box.click();
    await expect(box).toBeChecked();
    await expect(said(screen)).toHaveText('Change the bed sheets done');
    await expect(box).toHaveAccessibleDescription('🦔 Stratis · 10:00');
    await expect(screen.getByText("Today's visit", { exact: true })).toBeVisible();
    await expect(today(screen).getByText(/^Recorded by 🦔 Stratis · Today 10:00/)).toBeVisible();
    await expect(day(screen, 'Thursday 8 October')).toHaveAccessibleName(
      'Thursday 8 October, today, visit, 1 of 7 done, selected',
    );
    await expect(line(screen)).toHaveText('1 of 7 done today');

    await box.click();
    await expect(box).not.toBeChecked();
    await expect(said(screen)).toHaveText('Change the bed sheets not done');
    // Nothing recorded any more: not a visit, anywhere.
    await expect(day(screen, 'Thursday 8 October')).toHaveAccessibleName('Thursday 8 October, today, selected');
    await expect(day(screen, 'Thursday 8 October')).not.toHaveAttribute('data-visit', 'true');
    await expect(line(screen)).toHaveText('No visit yet today');
    await expect(screen.getByText('Last visit Thu 1 Oct', { exact: true })).toBeVisible();
    await expect(today(screen).getByText("Not started yet. Ticking a task starts today's visit.")).toBeVisible();
    await expect(today(screen).getByRole('button', { name: 'Delete Visit' })).toHaveCount(0);

    // A tap anywhere on the row toggles it.
    await today(screen).getByText('Ironing', { exact: true }).click();
    await expect(today(screen).getByRole('checkbox', { name: 'Ironing' })).toBeChecked();
  });

  test('comments and the price save themselves and are still there after a reload', async ({ page }) => {
    let screen = await openHousekeeping(page);
    const comments = today(screen).getByRole('textbox', { name: 'Comments' });
    await comments.fill('Out of bin bags.');
    // Saved a moment after typing stops, without leaving the field.
    await expect(said(screen)).toHaveText('Saved');
    await expect(screen.getByText("Today's visit", { exact: true })).toBeVisible();

    const price = today(screen).getByRole('textbox', { name: 'Price for the day' });
    await expect(price).toHaveAttribute('inputmode', 'decimal');
    await price.fill('12.345');
    await price.press('Enter');
    await expect(price).toHaveAttribute('aria-invalid', 'true');
    await expect(today(screen).getByRole('alert')).toHaveText('Enter an amount like 45.00, up to £10,000.00.');
    await price.fill('£45.5');
    await price.press('Enter');
    await expect(price).toHaveValue('45.50');
    await expect(price).not.toHaveAttribute('aria-invalid', 'true');
    await expect(today(screen).getByRole('alert')).toHaveCount(0);
    await expect(said(screen)).toHaveText('Saved');
    await expect(line(screen)).toHaveText('0 of 7 done today · £45.50');
    await control(screen, 'Show month').click();
    await expect(calendar(screen).getByText('2 visits · £105.50', { exact: true })).toBeVisible();

    await reopen(page);
    await goToTab(page, 'Housekeeping');
    screen = housekeepingScreen(page);
    await expect(today(screen).getByRole('textbox', { name: 'Comments' })).toHaveValue('Out of bin bags.');
    await expect(today(screen).getByRole('textbox', { name: 'Price for the day' })).toHaveValue('45.50');
    await expect(day(screen, 'Thursday 8 October')).toHaveAccessibleName(
      'Thursday 8 October, today, visit, 0 of 7 done, £45.50, selected',
    );
    // The month is remembered on this device.
    await expect(calendar(screen).getByText('2 visits · £105.50', { exact: true })).toBeVisible();
  });

  test('the message saves itself, and Clear can be undone', async ({ page }) => {
    let screen = await openHousekeeping(page);
    // Undo puts Shea's message back under Shea's name, not as a new edit.
    await screen.getByRole('button', { name: 'Clear message' }).click();
    await expect(message(screen)).toHaveValue('');
    await toast(page, 'Message cleared').getByRole('button', { name: 'Undo' }).click();
    await expect(message(screen)).toHaveValue('Guests arrive Friday, please do the spare room first.');
    await expect(screen.getByText('🦆 Shea · Yesterday 19:20', { exact: true })).toBeVisible();

    await message(screen).fill('Please do the oven this week.');
    await expect(said(screen)).toHaveText('Saved');
    await expect(screen.getByText('🦔 Stratis · Today 10:00', { exact: true })).toBeVisible();

    await reopen(page);
    await goToTab(page, 'Housekeeping');
    screen = housekeepingScreen(page);
    await expect(message(screen)).toHaveValue('Please do the oven this week.');

    const clear = screen.getByRole('button', { name: 'Clear message' });
    await clear.click();
    await expect(message(screen)).toHaveValue('');
    // Clear stays put, dimmed, with focus still on it.
    await expect(clear).toHaveAttribute('aria-disabled', 'true');
    await expect(clear).toBeFocused();
    await toast(page, 'Message cleared').getByRole('button', { name: 'Undo' }).click();
    await expect(message(screen)).toHaveValue('Please do the oven this week.');
    await expect(clear).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('Show month: each month’s visits and total; a past visit’s details', async ({ page }) => {
    const screen = await openHousekeeping(page);
    await control(screen, 'Show month').click();
    await expect(grid(screen)).toHaveAccessibleName('October 2026');
    await expect(calendar(screen).getByText('1 visit · £60.00', { exact: true })).toBeVisible();
    await expect(control(screen, 'Next month')).toBeDisabled();
    await control(screen, 'Previous month').click();
    await expect(calendar(screen).getByText('September 2026', { exact: true })).toBeVisible();
    await expect(calendar(screen).getByText('4 visits · £240.00', { exact: true })).toBeVisible();
    // Another month keeps the chosen day: today's visit is still the one shown.
    await expect(today(screen).getByRole('group', { name: 'Tasks today' })).toBeVisible();
    for (const date of [
      'Thursday 3 September',
      'Thursday 10 September',
      'Thursday 17 September',
      'Thursday 24 September',
    ]) {
      await expect(day(screen, date)).toHaveAttribute('data-visit', 'true');
    }
    await expect(day(screen, 'Friday 25 September')).not.toHaveAttribute('data-visit', 'true');

    await day(screen, 'Thursday 24 September').click();
    await expect(day(screen, 'Thursday 24 September').locator('xpath=..')).toHaveAttribute('aria-selected', 'true');
    const visit = detail(screen);
    await expect(visit.getByRole('heading', { level: 2 })).toHaveText('Thursday 24 September');
    await expect(visit.getByText('No message that day.', { exact: true })).toBeVisible();
    expect(await checklist(visit.getByRole('group', { name: 'Tasks on Thursday 24 September' }))).toEqual(
      STARTER.map((title) => ({ title, done: true })),
    );
    await expect(visit.getByRole('textbox', { name: 'Comments' })).toHaveValue(
      'Oven cleaned as well, it took an extra half hour.',
    );
    await expect(visit.getByRole('textbox', { name: 'Price for the day' })).toHaveValue('65.00');
    await expect(visit.getByText(/^Recorded by 🦆 Shea · Thu 24 Sep 09:50/)).toBeVisible();

    // A past visit is edited like today's.
    await visit.getByRole('checkbox', { name: 'Ironing' }).click();
    await expect(visit.getByRole('checkbox', { name: 'Ironing' })).not.toBeChecked();
    await expect(day(screen, 'Thursday 24 September')).toHaveAccessibleName(
      'Thursday 24 September, visit, 6 of 7 done, £65.00, selected',
    );

    // Show week: that day's week. Today comes back to this week and today's visit.
    await control(screen, 'Show week').click();
    await expect(grid(screen)).toHaveAccessibleName('Week of Monday 21 September');
    await control(screen, 'Today').click();
    await expect(grid(screen)).toHaveAccessibleName('Week of Monday 5 October');
    await expect(day(screen, 'Thursday 8 October')).toHaveAccessibleName('Thursday 8 October, today, selected');
    await expect(detail(screen)).toHaveCount(0);
    await expect(today(screen).getByRole('group', { name: 'Tasks today' })).toBeVisible();
    await expect(line(screen)).toHaveText('No visit yet today');
  });

  test('the calendar works from the keyboard', async ({ page }) => {
    const screen = await openHousekeeping(page);
    await day(screen, 'Thursday 8 October').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(day(screen, 'Wednesday 7 October')).toBeFocused();
    // Past the strip's edge, into the week before.
    await page.keyboard.press('ArrowUp');
    await expect(day(screen, 'Wednesday 30 September')).toBeFocused();
    await expect(calendar(screen).getByText('28 Sep to 4 Oct', { exact: true })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(detail(screen).getByRole('heading', { level: 2 })).toHaveText('Thursday 1 October');
    await expect(day(screen, 'Thursday 1 October')).toBeFocused();
    // A month on is still to come: as far as today.
    await page.keyboard.press('PageDown');
    await expect(day(screen, 'Thursday 8 October')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(day(screen, 'Thursday 8 October')).toBeFocused();
  });

  test('deleting a visit asks first, then takes it off the calendar for good', async ({ page }) => {
    let screen = await openHousekeeping(page);
    await chooseLastVisit(screen);
    await detail(screen).getByRole('button', { name: 'Delete Visit' }).click();
    const sheet = await confirmation(page, 'Delete the visit on Thu 1 Oct?');
    await expect(sheet.getByText('Its ticks, comments and price will be deleted for everyone.')).toBeVisible();
    await sheet.getByRole('button', { name: 'Delete Visit' }).click();
    await expect(detail(screen).getByText('No visit recorded.', { exact: true })).toBeVisible();
    await expect(detail(screen).getByRole('button', { name: 'Add a visit' })).toBeFocused();
    await expect(said(screen)).toHaveText('Visit deleted');
    await expect(day(screen, 'Thursday 1 October')).toHaveAccessibleName('Thursday 1 October, selected');
    await expect(day(screen, 'Thursday 1 October')).not.toHaveAttribute('data-visit', 'true');
    await expect(screen.getByText('Last visit Thu 24 Sep', { exact: true })).toBeVisible();
    await control(screen, 'Show month').click();
    await expect(calendar(screen).getByText('No visits', { exact: true })).toBeVisible();

    await reopen(page);
    await goToTab(page, 'Housekeeping');
    screen = housekeepingScreen(page);
    await expect(calendar(screen).getByText('No visits', { exact: true })).toBeVisible();
  });

  test('a past day without a visit says so, and can have one added', async ({ page }) => {
    const screen = await openHousekeeping(page);
    await day(screen, 'Tuesday 6 October').click();
    await expect(today(screen)).toHaveCount(0);
    await expect(detail(screen).getByRole('heading', { level: 2 })).toHaveText('Tuesday 6 October');
    await expect(detail(screen).getByText('No visit recorded.', { exact: true })).toBeVisible();
    await detail(screen).getByRole('button', { name: 'Add a visit' }).click();
    const tasks = detail(screen).getByRole('group', { name: 'Tasks on Tuesday 6 October' });
    expect(await checklist(tasks)).toEqual(STARTER.map((title) => ({ title, done: false })));
    await expect(tasks.getByRole('checkbox').first()).toBeFocused();
    await expect(said(screen)).toHaveText('Visit added');
    // Counted once something is recorded on it.
    await expect(detail(screen).getByText('Nothing recorded yet.', { exact: true })).toBeVisible();
    await expect(day(screen, 'Tuesday 6 October')).toHaveAccessibleName('Tuesday 6 October, selected');
    await tasks.getByRole('checkbox', { name: 'Ironing' }).click();
    await expect(day(screen, 'Tuesday 6 October')).toHaveAccessibleName('Tuesday 6 October, visit, 1 of 7 done, selected');
    await expect(day(screen, 'Tuesday 6 October')).toHaveAttribute('data-visit', 'true');
    await control(screen, 'Show month').click();
    await expect(calendar(screen).getByText('2 visits · £60.00', { exact: true })).toBeVisible();
  });

  test('today’s visit can be deleted, after asking, once something is recorded', async ({ page }) => {
    let screen = await openHousekeeping(page);
    await today(screen).getByRole('checkbox', { name: 'Dust the surfaces' }).click();
    await expect(screen.getByText("Today's visit", { exact: true })).toBeVisible();
    await expect(line(screen)).toHaveText('1 of 7 done today');
    await today(screen).getByRole('button', { name: 'Delete Visit' }).click();
    const sheet = await confirmation(page, "Delete today's visit?");
    await sheet.getByRole('button', { name: 'Delete Visit' }).click();
    await expect(today(screen).getByRole('checkbox', { name: 'Dust the surfaces' })).not.toBeChecked();
    await expect(today(screen).getByRole('heading', { name: 'Today', level: 2 })).toBeFocused();
    await expect(said(screen)).toHaveText('Visit deleted');
    await expect(screen.getByText('Last visit Thu 1 Oct', { exact: true })).toBeVisible();
    await expect(line(screen)).toHaveText('No visit yet today');

    await reopen(page);
    screen = housekeepingScreen(page);
    await expect(line(screen)).toHaveText('No visit yet today');
    await expect(day(screen, 'Thursday 8 October')).toHaveAccessibleName('Thursday 8 October, today, selected');
  });

  test('comments and the price say “Saved” for a moment where they are', async ({ page }) => {
    const screen = await openHousekeeping(page);
    await today(screen).getByRole('textbox', { name: 'Comments', exact: true }).fill('Out of bin bags.');
    const commentsRow = today(screen).getByRole('heading', { name: 'Comments', level: 3 }).locator('xpath=..');
    await expect(commentsRow.getByText('Saved', { exact: true })).toBeVisible();
    await expect(commentsRow.getByText('Saved', { exact: true })).toBeHidden({ timeout: 4000 });

    const price = today(screen).getByRole('textbox', { name: 'Price for the day', exact: true });
    await price.fill('45');
    await price.press('Enter');
    const caption = today(screen).locator('[data-visit-caption]');
    await expect(caption).toHaveText(/^Saved ·\s*Recorded by 🦔 Stratis · Today 10:00$/);
    await expect(caption).toHaveText(/^Recorded by/, { timeout: 4000 });
  });

  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`choosing a day brings its details up under the strip, which stays in sight; focus stays on the day (${reducedMotion})`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion });
      await page.setViewportSize({ width: 320, height: 700 });
      const screen = await openHousekeeping(page);
      const target = day(screen, 'Tuesday 6 October');
      await target.click();
      const heading = detail(screen).getByRole('heading', { level: 2 });
      await expect(heading).toHaveText('Tuesday 6 October');
      await expect(detail(screen).getByRole('button', { name: 'Add a visit' })).toBeInViewport({ ratio: 1 });
      // The week strip is still there to choose another day, clear of the docked tab switch.
      await expect
        .poll(async () => {
          const nav = (await tabs(page).boundingBox())!;
          const days = (await target.boundingBox())!;
          return days.y >= nav.y + nav.height;
        })
        .toBe(true);
      await expect(target).toBeFocused();
      await expect(said(screen)).toHaveText('Tuesday 6 October: no visit recorded. Details below the calendar.');
    });
  }

  test('a tap anywhere in a day’s cell chooses it, on the narrowest phone too', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const screen = await openHousekeeping(page);
    await control(screen, 'Previous week').click();
    const cell = day(screen, 'Friday 2 October').locator('xpath=..');
    await cell.scrollIntoViewIfNeeded();
    const box = (await cell.boundingBox())!;
    const button = (await day(screen, 'Friday 2 October').boundingBox())!;
    expect(Math.abs(button.width - box.width)).toBeLessThan(1);
    expect(button.height).toBeGreaterThanOrEqual(44);
    await page.mouse.click(box.x + 2, box.y + 2);
    await expect(detail(screen).getByRole('heading', { level: 2 })).toHaveText('Friday 2 October');
  });

  for (const width of [320, 375, 402]) {
    test(`the date picker fits at ${width}px: no sideways scroll, 44px targets`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      const screen = await openHousekeeping(page);
      await control(screen, 'Previous week').click();
      for (const name of ['Today', 'Show month', 'Previous week', 'Next week']) {
        const target = (await control(screen, name).boundingBox())!;
        expect(target.height, name).toBeGreaterThanOrEqual(44);
        expect(target.width, name).toBeGreaterThanOrEqual(44);
      }
      const days = await grid(screen)
        .getByRole('button')
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height })));
      for (const box of days) {
        expect(box.h).toBeGreaterThanOrEqual(44);
        expect(box.w).toBeGreaterThanOrEqual(width < 360 ? 39.5 : 44);
      }
      await control(screen, 'Show month').click();
      for (const name of ['Show week', 'Previous month', 'Next month']) {
        const target = (await control(screen, name).boundingBox())!;
        expect(target.height, name).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }

  test('reopens on Housekeeping, and its dot shows a message from someone else until seen', async ({ page }) => {
    await openSeeded(page);
    // Shea's message from yesterday has not been seen on this device.
    await expect(tabs(page).getByRole('button', { name: 'Housekeeping, new message', exact: true })).toBeVisible();
    await goToTab(page, 'Housekeeping');
    await expect(tabs(page).getByRole('button', { name: 'Housekeeping', exact: true })).toBeVisible();
    await reopen(page);
    const screen = housekeepingScreen(page);
    await expect(screen.getByRole('heading', { name: 'Housekeeping', level: 1 })).toBeVisible();
    await expect(tabButton(page, 'Housekeeping')).toHaveAttribute('aria-current', 'page');
    await goToTab(page, 'Home');
    await expect(tabs(page).getByRole('button', { name: 'Housekeeping', exact: true })).toBeVisible();
  });

  test('closing the task list by touch puts focus back on Edit', async ({ page }) => {
    const screen = await openHousekeeping(page);
    const edit = today(screen).getByRole('button', { name: 'Edit task list' });
    await edit.click();
    const sheet = page.getByRole('dialog', { name: 'Task list' });
    const done = sheet.getByRole('button', { name: 'Done' });
    await settled(done);
    await done.click();
    await expect(sheet).toHaveCount(0);
    await expect(edit).toBeFocused();
  });

  test('the task list sheet edits today’s list; last week’s visit keeps its own', async ({ page }) => {
    const screen = await openHousekeeping(page);
    // Today's visit exists (a tick), so it follows the list.
    await today(screen).getByRole('checkbox', { name: 'Clean the kitchen' }).click();
    await expect(said(screen)).toHaveText('Clean the kitchen done');

    await today(screen).getByRole('button', { name: 'Edit task list' }).click();
    const sheet = page.getByRole('dialog', { name: 'Task list' });
    const done = sheet.getByRole('button', { name: 'Done' });
    await settled(done);
    const names = sheet.getByRole('textbox', { name: 'Task name' });
    await expect(names).toHaveCount(7);

    // Rename.
    await names.nth(6).fill('Ironing and folding');
    await names.nth(6).press('Enter');
    // Add: "New task", selected, typed over.
    await sheet.getByRole('button', { name: 'Add Task' }).click();
    await expect(names).toHaveCount(8);
    await expect(names.nth(7)).toBeFocused();
    await expect(names.nth(7)).toHaveValue('New task');
    await page.keyboard.type('Clean the windows');
    await page.keyboard.press('Enter');
    // Reorder with the keyboard: up one.
    await sheet.getByRole('button', { name: 'Reorder Clean the windows' }).focus();
    await page.keyboard.press('ArrowUp');
    await expect(sheet.getByText('Clean the windows moved to position 7 of 8.')).toBeAttached();
    // Delete, after asking.
    await sheet.getByRole('button', { name: 'Delete Empty the bins' }).click();
    const confirm = await confirmation(page, 'Delete Empty the bins?');
    await expect(confirm.getByText('Earlier visits keep it.')).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete Task' }).click();
    await expect(names).toHaveCount(7);
    expect(await names.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))).toEqual([
      'Change the bed sheets',
      'Hoover and mop the floors',
      'Clean the bathrooms',
      'Clean the kitchen',
      'Dust the surfaces',
      'Clean the windows',
      'Ironing and folding',
    ]);
    await done.click();
    await expect(sheet).toHaveCount(0);

    expect(await checklist(today(screen).getByRole('group', { name: 'Tasks today' }))).toEqual([
      { title: 'Change the bed sheets', done: false },
      { title: 'Hoover and mop the floors', done: false },
      { title: 'Clean the bathrooms', done: false },
      { title: 'Clean the kitchen', done: true },
      { title: 'Dust the surfaces', done: false },
      { title: 'Clean the windows', done: false },
      { title: 'Ironing and folding', done: false },
    ]);
    // Last week's visit (chosen in the calendar) keeps its own list.
    await chooseLastVisit(screen);
    expect(await checklist(detail(screen).getByRole('group', { name: 'Tasks on Thursday 1 October' }))).toEqual(
      STARTER.map((title) => ({ title, done: title !== 'Ironing' })),
    );
  });
});
