import {
  addButton,
  confirmation,
  expect,
  goToTab,
  homeScreen,
  housekeepingScreen,
  openSeeded,
  reopen,
  settled,
  showView,
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

  test('its text buttons are one blue, readable on the page: Show month, Clear and Edit', async ({ page }) => {
    const screen = await openHousekeeping(page);
    const buttons = [
      control(screen, 'Show month'),
      screen.getByRole('button', { name: 'Clear message' }),
      today(screen).getByRole('button', { name: 'Edit task list' }),
    ];
    // The darker tint words use: 6:1 on the page (the system blue was 3.6:1), and in dark mode
    // its lighter twin, so the three always match.
    for (const button of buttons) await expect(button).toHaveCSS('color', 'rgb(0, 88, 185)');
    await page.emulateMedia({ colorScheme: 'dark' });
    for (const button of buttons) await expect(button).toHaveCSS('color', 'rgb(90, 169, 255)');
    // Section headings weigh the same as Home's.
    await expect(screen.getByRole('heading', { name: 'Today', level: 2 })).toHaveCSS('font-weight', '600');
    await goToTab(page, 'Home');
    await showView(page, 'Up next');
    await expect(homeScreen(page).getByRole('heading', { name: 'Needs attention', level: 2 })).toHaveCSS('font-weight', '600');
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
    // Add: the row becomes the new name's field, focused in the tap; the task is made with
    // what is typed, and focus is back on Add Task for the next.
    const addTask = sheet.getByRole('button', { name: 'Add Task' });
    await addTask.click();
    await expect(names).toHaveCount(8);
    await expect(names.nth(7)).toBeFocused();
    await expect(names.nth(7)).toHaveValue('');
    await expect(names.nth(7)).toHaveAttribute('placeholder', 'New task');
    await page.keyboard.type('Clean the windows');
    await page.keyboard.press('Enter');
    await expect(addTask).toBeFocused();
    await expect(names.nth(7)).toHaveValue('Clean the windows');
    // Escape drops a new one: nothing is added, and the sheet stays.
    await addTask.click();
    await page.keyboard.type('Oven');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeVisible();
    await expect(addTask).toBeFocused();
    await expect(names).toHaveCount(8);
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

// ── Sections (docs/ARCHITECTURE.md "Housekeeping", "Sections") ──

test.describe('Sections', () => {
  async function openEditor(page: Page, screen: Locator): Promise<Locator> {
    await today(screen).getByRole('button', { name: 'Edit task list' }).click();
    const sheet = page.getByRole('dialog', { name: 'Task list' });
    await settled(sheet.getByRole('button', { name: 'Done' }));
    return sheet;
  }

  async function closeEditor(sheet: Locator): Promise<void> {
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(sheet).toHaveCount(0);
  }

  /** Add Section, then its name typed into the field it becomes. */
  async function addSection(page: Page, sheet: Locator, name: string): Promise<void> {
    await sheet.getByRole('button', { name: 'Add Section' }).click();
    const field = sheet.getByRole('textbox', { name: 'Section name' }).last();
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('');
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    await expect(sheet.getByRole('group', { name, exact: true })).toBeVisible();
  }

  /** A task's "…": Move to Section, then the section. */
  async function moveTo(page: Page, sheet: Locator, task: string, section: string): Promise<void> {
    await sheet.getByRole('button', { name: `Move ${task} to a section` }).click();
    const menu = page.getByRole('menu', { name: 'Move to Section' });
    await menu.getByRole('menuitemradio', { name: section, exact: true }).click();
    await expect(menu).toHaveCount(0);
  }

  /** A section's "…", then one of its items. */
  async function sectionMenu(page: Page, sheet: Locator, section: string, item: string): Promise<void> {
    await sheet.getByRole('button', { name: `${section} options` }).click();
    await page.getByRole('menu', { name: `${section} options` }).getByRole('menuitem', { name: item }).click();
  }

  /** Holds `grip` and moves it, in steps as a finger does, to the middle of `onto`. */
  async function drag(page: Page, grip: Locator, onto: Locator): Promise<void> {
    const from = (await grip.boundingBox())!;
    const to = (await onto.boundingBox())!;
    const x = from.x + from.width / 2;
    const y0 = from.y + from.height / 2;
    const y1 = to.y + to.height / 2;
    await page.mouse.move(x, y0);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) await page.mouse.move(x, y0 + ((y1 - y0) * i) / 12);
    await page.mouse.up();
  }

  const names = (group: Locator) =>
    group.getByRole('textbox', { name: 'Task name' }).evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  /** Today's section headings as heard: "Kitchen, 1 of 2 done". */
  const headings = (tasks: Locator) =>
    tasks.getByRole('heading', { level: 3 }).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  const taskMoves = (sheet: Locator) => sheet.locator('[data-task-moves]');
  const sectionMoves = (sheet: Locator) => sheet.locator('[data-section-moves]');

  test('the task list in sections: added, filled by menu and by dragging, reordered and renamed; today follows', async ({
    page,
  }) => {
    const screen = await openHousekeeping(page);
    // Today's visit has started, so it follows the list.
    await today(screen).getByRole('checkbox', { name: 'Clean the kitchen' }).click();
    await expect(said(screen)).toHaveText('Clean the kitchen done');

    const sheet = await openEditor(page, screen);
    // No sections yet: no Move to Section, and a word on what they are for.
    await expect(sheet.getByRole('button', { name: /to a section$/ })).toHaveCount(0);
    await expect(sheet.getByText(/^Sections group the tasks, such as Kitchen or Bathrooms\./)).toBeVisible();

    await addSection(page, sheet, 'Kitchen');
    // The tasks in no section are headed now.
    await expect(sheet.getByRole('group', { name: 'No Section', exact: true })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Add Task to No Section' })).toBeVisible();
    const scroller = sheet.locator('[data-sheet-scroll]');
    const scrolled = await scroller.evaluate((el) => el.scrollTop);
    await moveTo(page, sheet, 'Clean the kitchen', 'Kitchen');
    await expect(taskMoves(sheet)).toHaveText('Clean the kitchen moved to Kitchen, position 1 of 1.');
    // The place is kept: focus on the next task's "…", ready for the next move, and no scrolling.
    await expect(sheet.getByRole('button', { name: 'Move Dust the surfaces to a section' })).toBeFocused();
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(scrolled);
    // Dragged onto the kitchen's Add Task: last in the kitchen.
    await drag(page, sheet.getByRole('button', { name: 'Reorder Empty the bins' }), sheet.getByRole('button', { name: 'Add Task to Kitchen' }));
    await expect(taskMoves(sheet)).toHaveText('Empty the bins moved to Kitchen, position 2 of 2.');
    expect(await names(sheet.getByRole('group', { name: 'Kitchen', exact: true }))).toEqual(['Clean the kitchen', 'Empty the bins']);

    // A second section, with a task moved in and one added straight into it.
    await addSection(page, sheet, 'Bathrooms');
    await moveTo(page, sheet, 'Clean the bathrooms', 'Bathrooms');
    await sheet.getByRole('button', { name: 'Add Task to Bathrooms' }).click();
    const bathrooms = sheet.getByRole('group', { name: 'Bathrooms', exact: true });
    const added = bathrooms.getByRole('textbox', { name: 'Task name' }).last();
    await expect(added).toBeFocused();
    await expect(added).toHaveValue('');
    await page.keyboard.type('Fresh towels');
    await page.keyboard.press('Enter');
    await expect.poll(() => names(bathrooms)).toEqual(['Clean the bathrooms', 'Fresh towels']);

    // The bathrooms up, from its menu; the kitchen renamed from its.
    await sectionMenu(page, sheet, 'Bathrooms', 'Move Up');
    await expect(sectionMoves(sheet)).toHaveText('Bathrooms moved to position 1 of 2.');
    await sectionMenu(page, sheet, 'Kitchen', 'Rename');
    const kitchenName = sheet.getByRole('group', { name: 'Kitchen', exact: true }).getByRole('textbox', { name: 'Section name' });
    await expect(kitchenName).toBeFocused();
    await page.keyboard.type('Kitchen and utility');
    await page.keyboard.press('Enter');
    await expect(sheet.getByRole('group', { name: 'Kitchen and utility', exact: true })).toBeVisible();
    await closeEditor(sheet);

    // Today: the tasks in no section first, then each section in order, its progress in its heading.
    const tasks = today(screen).getByRole('group', { name: 'Tasks today' });
    expect(await checklist(tasks)).toEqual([
      { title: 'Change the bed sheets', done: false },
      { title: 'Hoover and mop the floors', done: false },
      { title: 'Dust the surfaces', done: false },
      { title: 'Ironing', done: false },
      { title: 'Clean the bathrooms', done: false },
      { title: 'Fresh towels', done: false },
      { title: 'Clean the kitchen', done: true },
      { title: 'Empty the bins', done: false },
    ]);
    await expect.poll(() => headings(tasks)).toEqual(['Bathrooms, 0 of 2 done', 'Kitchen and utility, 1 of 2 done']);
    const kitchen = tasks.getByRole('group', { name: /^Kitchen and utility, / });
    await expect(kitchen.getByText('1 of 2', { exact: true })).toBeVisible();

    // The last one in a section: all done, shown and said.
    await kitchen.getByRole('checkbox', { name: 'Empty the bins' }).click();
    await expect(said(screen)).toHaveText('Empty the bins done. Kitchen and utility, all 2 done');
    await expect.poll(() => headings(tasks)).toEqual(['Bathrooms, 0 of 2 done', 'Kitchen and utility, all 2 done']);
    await expect(kitchen.getByText('All done', { exact: true })).toBeVisible();
    await expect(kitchen).toHaveAttribute('data-all-done', 'true');
    await expect(line(screen)).toHaveText('2 of 8 done today');

    // Kept on this phone.
    await reopen(page);
    await expect.poll(() => headings(today(housekeepingScreen(page)).getByRole('group', { name: 'Tasks today' }))).toEqual([
      'Bathrooms, 0 of 2 done',
      'Kitchen and utility, all 2 done',
    ]);
  });

  test('a tap on another Add Task while a name is typed: the name is kept and that field opens, in one tap', async ({ page }) => {
    const screen = await openHousekeeping(page);
    const sheet = await openEditor(page, screen);
    await addSection(page, sheet, 'Kitchen');
    await sheet.getByRole('button', { name: 'Add Task to No Section' }).tap();
    await page.keyboard.type('Windows');
    // The kitchen's Add Task is below the field: the list must not move under the finger.
    await sheet.getByRole('button', { name: 'Add Task to Kitchen' }).tap();
    const kitchen = sheet.getByRole('group', { name: 'Kitchen', exact: true });
    await expect(kitchen.getByRole('textbox', { name: 'Task name' })).toBeFocused();
    await page.keyboard.type('Oven');
    await page.keyboard.press('Enter');
    await expect.poll(() => names(kitchen)).toEqual(['Oven']);
    expect((await names(sheet.getByRole('group', { name: 'No Section', exact: true }))).at(-1)).toBe('Windows');
  });

  test('a section moves by dragging its header, and by the arrow keys on its grip', async ({ page }) => {
    const screen = await openHousekeeping(page);
    const sheet = await openEditor(page, screen);
    await addSection(page, sheet, 'Kitchen');
    await moveTo(page, sheet, 'Clean the kitchen', 'Kitchen');
    await addSection(page, sheet, 'Bathrooms');
    await moveTo(page, sheet, 'Clean the bathrooms', 'Bathrooms');
    const order = () => sheet.getByRole('textbox', { name: 'Section name' }).evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    expect(await order()).toEqual(['Kitchen', 'Bathrooms']);

    // Carried by its header above the kitchen: its card goes with it.
    await drag(page, sheet.getByRole('button', { name: 'Reorder Bathrooms section' }), sheet.getByRole('button', { name: 'Reorder Kitchen section' }));
    await expect(sectionMoves(sheet)).toHaveText('Bathrooms moved to position 1 of 2.');
    expect(await order()).toEqual(['Bathrooms', 'Kitchen']);
    expect(await names(sheet.getByRole('group', { name: 'Bathrooms', exact: true }))).toEqual(['Clean the bathrooms']);

    // Back down with the keyboard.
    const grip = sheet.getByRole('button', { name: 'Reorder Bathrooms section' });
    await grip.focus();
    await page.keyboard.press('ArrowDown');
    await expect(sectionMoves(sheet)).toHaveText('Bathrooms moved to position 2 of 2.');
    expect(await order()).toEqual(['Kitchen', 'Bathrooms']);
    await expect(grip).toBeFocused();
    // A task's grip crosses into the section before it at the top of its own.
    await sheet.getByRole('button', { name: 'Reorder Clean the bathrooms' }).focus();
    await page.keyboard.press('ArrowUp');
    await expect(taskMoves(sheet)).toHaveText('Clean the bathrooms moved to Kitchen, position 2 of 2.');
    await closeEditor(sheet);
    await expect.poll(() => headings(today(screen).getByRole('group', { name: 'Tasks today' }))).toEqual(['Kitchen, 0 of 2 done']);
  });

  test('deleting a section asks first, then keeps its tasks: at the top, on today’s visit too', async ({ page }) => {
    const screen = await openHousekeeping(page);
    let sheet = await openEditor(page, screen);
    await addSection(page, sheet, 'Kitchen');
    await moveTo(page, sheet, 'Clean the kitchen', 'Kitchen');
    await moveTo(page, sheet, 'Empty the bins', 'Kitchen');
    await closeEditor(sheet);
    const tasks = today(screen).getByRole('group', { name: 'Tasks today' });
    await tasks.getByRole('checkbox', { name: 'Clean the kitchen' }).click();
    await expect(said(screen)).toHaveText('Clean the kitchen done');
    await expect.poll(() => headings(tasks)).toEqual(['Kitchen, 1 of 2 done']);

    sheet = await openEditor(page, screen);
    await sectionMenu(page, sheet, 'Kitchen', 'Delete Section');
    const confirm = await confirmation(page, 'Delete Kitchen?');
    await expect(
      confirm.getByText('Its 2 tasks move to the top of the list. Earlier visits keep this section.', { exact: true }),
    ).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete Section' }).click();
    await expect(sheet.getByRole('group', { name: 'Kitchen', exact: true })).toHaveCount(0);
    // After the tasks already at the top, in their order.
    expect(await names(sheet)).toEqual([
      'Change the bed sheets',
      'Hoover and mop the floors',
      'Clean the bathrooms',
      'Dust the surfaces',
      'Ironing',
      'Clean the kitchen',
      'Empty the bins',
    ]);
    await expect(sheet.getByRole('button', { name: 'Add Section' })).toBeFocused();
    await closeEditor(sheet);
    await expect.poll(() => headings(tasks)).toEqual([]);
    expect((await checklist(tasks)).slice(-2)).toEqual([
      { title: 'Clean the kitchen', done: true },
      { title: 'Empty the bins', done: false },
    ]);
  });

  test('an earlier visit keeps the sections it had, by their names then', async ({ page }) => {
    const screen = await openHousekeeping(page);
    let sheet = await openEditor(page, screen);
    await addSection(page, sheet, 'Kitchen');
    await moveTo(page, sheet, 'Clean the kitchen', 'Kitchen');
    await closeEditor(sheet);

    // A visit added on Tuesday copies the list as it is: the kitchen with its task.
    await day(screen, 'Tuesday 6 October').click();
    await detail(screen).getByRole('button', { name: 'Add a visit' }).click();
    const tuesday = detail(screen).getByRole('group', { name: 'Tasks on Tuesday 6 October' });
    await expect.poll(() => headings(tuesday)).toEqual(['Kitchen, 0 of 1 done']);

    // Renamed, then deleted, today.
    await control(screen, 'Today').click();
    sheet = await openEditor(page, screen);
    await sectionMenu(page, sheet, 'Kitchen', 'Rename');
    // The name takes the focus, its text selected, once the menu has gone.
    await expect(sheet.getByRole('group', { name: 'Kitchen', exact: true }).getByRole('textbox', { name: 'Section name' })).toBeFocused();
    await page.keyboard.type('Cooking');
    await page.keyboard.press('Enter');
    await expect(sheet.getByRole('group', { name: 'Cooking', exact: true })).toBeVisible();
    await sectionMenu(page, sheet, 'Cooking', 'Delete Section');
    await (await confirmation(page, 'Delete Cooking?')).getByRole('button', { name: 'Delete Section' }).click();
    await closeEditor(sheet);
    await expect.poll(() => headings(today(screen).getByRole('group', { name: 'Tasks today' }))).toEqual([]);

    // Tuesday's visit still has its kitchen.
    await day(screen, 'Tuesday 6 October').click();
    await expect.poll(() => headings(detail(screen).getByRole('group', { name: 'Tasks on Tuesday 6 October' }))).toEqual([
      'Kitchen, 0 of 1 done',
    ]);
  });

  for (const width of [375, 430]) {
    test(`sections fit at ${width}px: no sideways scroll, the progress beside each name, 44px targets`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const screen = await openHousekeeping(page);
      const sheet = await openEditor(page, screen);
      await addSection(page, sheet, 'Bathrooms and the downstairs cloakroom');
      await moveTo(page, sheet, 'Clean the bathrooms', 'Bathrooms and the downstairs cloakroom');
      for (const name of [
        'Bathrooms and the downstairs cloakroom options',
        'Reorder Bathrooms and the downstairs cloakroom section',
        'Move Ironing to a section',
        'Reorder Ironing',
        'Delete Ironing',
      ]) {
        const box = (await sheet.getByRole('button', { name, exact: true }).boundingBox())!;
        expect(box.height, name).toBeGreaterThanOrEqual(44);
        expect(box.width, name).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await closeEditor(sheet);
      const card = today(screen).getByRole('group', { name: /^Bathrooms and the downstairs cloakroom, / });
      const heading = (await card.getByRole('heading', { level: 3 }).boundingBox())!;
      const count = (await card.getByText('0 of 1', { exact: true }).boundingBox())!;
      // The long name wraps; the count stays on the right, within the card.
      expect(count.x).toBeGreaterThan(heading.x + heading.width - 1);
      expect(count.x + count.width).toBeLessThanOrEqual(width - 16);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
});
