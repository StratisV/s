import {
  area,
  areaHeadings,
  chooseWho,
  DEMO_STORAGE_KEY,
  expect,
  homeScreen,
  mine,
  openSeeded,
  peopleButton,
  reopen,
  rowButton,
  showView,
  summary,
  test,
  type Page,
} from './fixtures';

test.use({ timezoneId: 'Europe/London' });

/** The people menu, opened. */
async function peopleMenu(page: Page) {
  await peopleButton(page).click();
  const menu = page.getByRole('menu', { name: 'Show tasks for' });
  await expect(menu).toBeVisible();
  return menu;
}

test.describe('Filter Home by person', () => {
  test('the people menu: Everyone, you, the others and Unassigned, each with how many are open', async ({ page }) => {
    await openSeeded(page);
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

  test("one person's items only, in the rooms where they have some; remembered after a reload", async ({ page }) => {
    await openSeeded(page);
    const all = await areaHeadings(page).count();
    await chooseWho(page, /^Shea,/);
    await expect(peopleButton(page)).toHaveAccessibleName('Show tasks for: Shea');
    // The pill shows who, on a tint wash.
    await expect(peopleButton(page)).toHaveAttribute('data-filtered', 'true');
    await expect(rowButton(page, 'Change the filter')).toBeVisible();
    await expect(rowButton(page, 'Olive oil')).toHaveCount(0);
    expect(await areaHeadings(page).count()).toBeLessThan(all);
    // Every row shown is Shea's (VoiceOver hears whose; the rows don't need to say it).
    const names = await homeScreen(page)
      .locator('[data-item-open]')
      .evaluateAll((els) => els.map((el) => el.textContent ?? ''));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toContain(', Shea');
    await expect(homeScreen(page).locator('[data-who]')).toHaveCount(0);
    await expect(summary(page)).toHaveText(/^For Shea, /);

    await reopen(page);
    await expect(peopleButton(page)).toHaveAccessibleName('Show tasks for: Shea');
    await expect(rowButton(page, 'Olive oil')).toHaveCount(0);

    await chooseWho(page, /^Everyone,/);
    await expect(rowButton(page, 'Olive oil')).toBeVisible();
    expect(await areaHeadings(page).count()).toBe(all);
  });

  test('Mine is one tap, and a second tap shows everyone’s again', async ({ page }) => {
    await openSeeded(page, 'Up next');
    await expect(mine(page)).toHaveAttribute('aria-pressed', 'false');
    await mine(page).click();
    await expect(mine(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(peopleButton(page)).toHaveAccessibleName('Show tasks for: Stratis (you)');
    // Mine shows it: the pill stays quiet.
    await expect(peopleButton(page)).not.toHaveAttribute('data-filtered');
    await expect(summary(page)).toHaveText(/^For you, /);
    const names = await homeScreen(page)
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
    await openSeeded(page);
    await chooseWho(page, /^Unassigned,/);
    await expect(peopleButton(page)).toHaveAccessibleName('Show tasks for: Unassigned');
    const names = await homeScreen(page)
      .locator('[data-item-open]')
      .evaluateAll((els) => els.map((el) => el.textContent ?? ''));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toContain(', Unassigned');
    await expect(summary(page)).toHaveText(/^Unassigned: /);
  });

  test('someone with nothing open sees that said plainly', async ({ page }) => {
    await openSeeded(page);
    // Ela hands everything back: her items become unassigned.
    await page.evaluate((key) => {
      const doc = JSON.parse(localStorage.getItem(key)!);
      const ela = doc.members.find((m: { name: string }) => m.name === 'Ela').id;
      for (const it of doc.items) if (it.assignee_id === ela) it.assignee_id = null;
      localStorage.setItem(key, JSON.stringify(doc));
    }, DEMO_STORAGE_KEY);
    await reopen(page);
    await chooseWho(page, /^Ela, 0 items/);
    await expect(homeScreen(page).getByText('Nothing for Ela right now.', { exact: true })).toBeVisible();
    await expect(area(page, 'Kitchen')).toHaveCount(0);
    await expect(summary(page)).toHaveText('All clear for Ela. Nothing to do right now.');
    await showView(page, 'Up next');
    await expect(homeScreen(page).getByRole('status').filter({ hasText: 'Nothing for Ela' })).toHaveText('Nothing hereNothing for Ela right now.');
  });
});
