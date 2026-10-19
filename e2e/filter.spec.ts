import {
  addButton,
  attentionScreen,
  chooseWho,
  DEMO_STORAGE_KEY,
  expect,
  itemSheet,
  mine,
  openSeeded,
  peopleButton,
  reopen,
  settled,
  summary,
  test,
  type Page,
} from './fixtures';

/** A row on Needs attention, by its title. */
function listRow(page: Page, title: string) {
  return attentionScreen(page).getByRole('button', { name: new RegExp(`^${title} ?, `) });
}

/** How many rows Needs attention shows (Later opened). */
async function rowCount(page: Page): Promise<number> {
  const more = attentionScreen(page).getByRole('button', { name: /^Show \d+ more$/ });
  if (await more.count()) await more.click();
  return attentionScreen(page).locator('[data-item-open]').count();
}

test.use({ timezoneId: 'Europe/London' });

/** The people menu, opened. */
async function peopleMenu(page: Page) {
  await peopleButton(page).click();
  const menu = page.getByRole('menu', { name: 'Show tasks for' });
  await expect(menu).toBeVisible();
  return menu;
}

test.describe('Filter Needs attention by person', () => {
  test('the people menu: Everyone, you, the others and Unassigned, each with how many are open', async ({ page }) => {
    await openSeeded(page, 'List');
    await expect(peopleButton(page)).toHaveAccessibleName('Show tasks for: Everyone');
    const menu = await peopleMenu(page);
    const radios = menu.getByRole('menuitemradio');
    await expect(radios.first()).toHaveAccessibleName(/^Everyone, \d+ items$/);
    await expect(radios.first()).toHaveAttribute('aria-checked', 'true');
    await expect(radios.first()).toBeFocused();
    await expect(radios.nth(1)).toHaveAccessibleName(/^Stratis \(you\), \d+ items?$/);
    await expect(radios.last()).toHaveAccessibleName(/^Unassigned, \d+ items?$/);
    // On screen: "5 open".
    await expect(radios.first()).toContainText(/\d+ open$/);
    // The counts add up.
    const names = await radios.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')!));
    const n = (s: string) => Number(/, (\d+) items?$/.exec(s)![1]);
    expect(names.slice(1).reduce((sum, s) => sum + n(s), 0)).toBe(n(names[0]));
    // The arrow keys move, Escape closes it and focus goes back to the button.
    await page.keyboard.press('ArrowDown');
    await expect(radios.nth(1)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(peopleButton(page)).toBeFocused();
  });

  test("one person's items only; remembered after a reload", async ({ page }) => {
    await openSeeded(page, 'List');
    const all = await rowCount(page);
    await chooseWho(page, /^Shea,/);
    await expect(peopleButton(page)).toHaveAccessibleName('Show tasks for: Shea');
    // The pill shows who, on a tint wash.
    await expect(peopleButton(page)).toHaveAttribute('data-filtered', 'true');
    await expect(listRow(page, 'Change the filter')).toBeVisible();
    await expect(listRow(page, 'Olive oil')).toHaveCount(0);
    expect(await rowCount(page)).toBeLessThan(all);
    // Every row shown is Shea's (VoiceOver hears whose; the rows don't need to say it).
    const names = await attentionScreen(page)
      .locator('[data-item-open]')
      .evaluateAll((els) => els.map((el) => el.textContent ?? ''));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toContain(', Shea');
    await expect(attentionScreen(page).locator('[data-who]')).toHaveCount(0);
    await expect(summary(page)).toHaveText(/^For Shea, /);

    // The phone reopens on Needs attention, as it was left.
    await reopen(page);
    await expect(peopleButton(page)).toHaveAccessibleName('Show tasks for: Shea');
    await expect(listRow(page, 'Olive oil')).toHaveCount(0);

    await chooseWho(page, /^Everyone,/);
    expect(await rowCount(page)).toBe(all);
    await expect(listRow(page, 'Olive oil')).toBeVisible();
  });

  test('a job added for someone else shows everyone’s for now, and Mine stays the choice it opens on', async ({ page }) => {
    await openSeeded(page, 'List');
    await mine(page).click();
    await expect(summary(page)).toHaveText(/^For you, /);
    await addButton(page).click();
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await sheet.getByLabel('Title', { exact: true }).fill('Return the ladder');
    await sheet.getByLabel('Assigned to', { exact: true }).selectOption({ label: '🦊 Ela' });
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    // Everyone's for this visit, so the new job can be seen where it went.
    await expect(mine(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(attentionScreen(page).getByRole('button', { name: /^Return the ladder ?, / })).toBeVisible();
    // Opened again, Needs attention is as the person left it: Mine.
    await reopen(page);
    await expect(mine(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(summary(page)).toHaveText(/^For you, /);
  });

  test('Mine is one tap, and a second tap shows everyone’s again', async ({ page }) => {
    await openSeeded(page, 'List');
    await expect(mine(page)).toHaveAttribute('aria-pressed', 'false');
    await mine(page).click();
    await expect(mine(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(peopleButton(page)).toHaveAccessibleName('Show tasks for: Stratis (you)');
    // Mine shows it: the pill stays quiet.
    await expect(peopleButton(page)).not.toHaveAttribute('data-filtered');
    await expect(summary(page)).toHaveText(/^For you, /);
    const names = await attentionScreen(page)
      .locator('[data-item-open]')
      .evaluateAll((els) => els.map((el) => el.textContent ?? ''));
    for (const name of names) expect(name).toContain(', Stratis');
    // Remembered, like any choice.
    await reopen(page);
    await expect(mine(page)).toHaveAttribute('aria-pressed', 'true');
    await mine(page).click();
    await expect(peopleButton(page)).toHaveAccessibleName('Show tasks for: Everyone');
    await expect(summary(page)).toHaveText(/^2 things need attention/);
  });

  test('Unassigned: only the items nobody has', async ({ page }) => {
    await openSeeded(page, 'List');
    await chooseWho(page, /^Unassigned,/);
    await expect(peopleButton(page)).toHaveAccessibleName('Show tasks for: Unassigned');
    const names = await attentionScreen(page)
      .locator('[data-item-open]')
      .evaluateAll((els) => els.map((el) => el.textContent ?? ''));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toContain(', Unassigned');
    await expect(summary(page)).toHaveText(/^Unassigned: /);
  });

  test('someone with nothing open sees that said plainly', async ({ page }) => {
    await openSeeded(page, 'List');
    // Ela hands everything back: her items become unassigned.
    await page.evaluate((key) => {
      const doc = JSON.parse(localStorage.getItem(key)!);
      const ela = doc.members.find((m: { name: string }) => m.name === 'Ela').id;
      for (const it of doc.items) if (it.assignee_id === ela) it.assignee_id = null;
      localStorage.setItem(key, JSON.stringify(doc));
    }, DEMO_STORAGE_KEY);
    await reopen(page);
    await chooseWho(page, /^Ela, 0 items/);
    await expect(attentionScreen(page).getByRole('status').filter({ hasText: 'Nothing for Ela right now.' })).toBeVisible();
    await expect(attentionScreen(page).locator('section[data-group]')).toHaveCount(0);
    await expect(summary(page)).toHaveText('All clear for Ela. Nothing to do right now.');
    await expect(attentionScreen(page).getByRole('status').filter({ hasText: 'Nothing for Ela' })).toHaveText('Nothing hereNothing for Ela right now.');
  });
});

for (const width of [320, 360]) {
  test.describe(`Mine at ${width}px`, () => {
    test.use({ viewport: { width, height: 700 } });

    test('keeps its word, every view’s name stays whole, and each control takes taps 44px wide and tall', async ({ page }) => {
      await openSeeded(page, 'List');
      // "Mine" in words (the emoji alone looked like the profile button on the hero).
      await expect(mine(page).getByText('Mine', { exact: true })).toBeVisible();
      for (const name of ['List', 'Calendar']) {
        const label = attentionScreen(page).getByRole('radio', { name, exact: true }).locator('span');
        expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth + 0.5), name).toBe(true);
      }
      // 21px either side of each control's centre, and 21px above and below, is still that control.
      for (const control of [mine(page), peopleButton(page)]) {
        const box = (await control.boundingBox())!;
        const name = await control.getAttribute('aria-label');
        const hits = await page.evaluate(
          ([cx, cy]) =>
            [
              [cx - 21, cy],
              [cx + 21, cy],
              [cx, cy - 21],
              [cx, cy + 21],
            ].map(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null),
          [box.x + box.width / 2, box.y + box.height / 2],
        );
        expect(hits, name!).toEqual(Array(4).fill(name));
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  });
}
