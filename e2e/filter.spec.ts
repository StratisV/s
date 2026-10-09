import { area, areaHeadings, DEMO_STORAGE_KEY, expect, homeScreen, openSeeded, reopen, rowButton, test } from './fixtures';

test.use({ timezoneId: 'Europe/London' });

function chips(page: import('@playwright/test').Page) {
  return homeScreen(page).getByRole('radiogroup', { name: 'Show tasks for' });
}

test.describe('Filter Home by person', () => {
  test('Everyone first, then you, the others and Unassigned, each with a count', async ({ page }) => {
    await openSeeded(page);
    const radios = chips(page).getByRole('radio');
    await expect(radios.first()).toHaveAccessibleName(/^Everyone, \d+ items$/);
    await expect(radios.first()).toHaveAttribute('aria-checked', 'true');
    await expect(radios.nth(1)).toHaveAccessibleName(/^Stratis \(you\), \d+ items?$/);
    await expect(radios.last()).toHaveAccessibleName(/^Unassigned, \d+ items?$/);
    // The counts add up.
    const names = await radios.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')!));
    const n = (s: string) => Number(/, (\d+) items?$/.exec(s)![1]);
    expect(names.slice(1).reduce((sum, s) => sum + n(s), 0)).toBe(n(names[0]));
  });

  test("one person's items only, in the areas where they have some; remembered after a reload", async ({ page }) => {
    await openSeeded(page);
    const all = await areaHeadings(page).count();
    await chips(page).getByRole('radio', { name: /^Shea,/ }).click();
    await expect(chips(page).getByRole('radio', { name: /^Shea,/ })).toHaveAttribute('aria-checked', 'true');
    await expect(rowButton(page, 'Change the filter')).toBeVisible();
    await expect(rowButton(page, 'Olive oil')).toHaveCount(0);
    expect(await areaHeadings(page).count()).toBeLessThan(all);
    // Every row shown is Shea's.
    const metas = await homeScreen(page).locator('[data-meta]').allTextContents();
    expect(metas.length).toBeGreaterThan(0);
    for (const m of metas) expect(m).toMatch(/^🦆 Shea/);

    await reopen(page);
    await expect(chips(page).getByRole('radio', { name: /^Shea,/ })).toHaveAttribute('aria-checked', 'true');
    await expect(rowButton(page, 'Olive oil')).toHaveCount(0);

    await chips(page).getByRole('radio', { name: /^Everyone,/ }).click();
    await expect(rowButton(page, 'Olive oil')).toBeVisible();
    expect(await areaHeadings(page).count()).toBe(all);
  });

  test('Unassigned, and arrow keys move the choice', async ({ page }) => {
    await openSeeded(page);
    await chips(page).getByRole('radio', { name: /^Unassigned,/ }).click();
    const metas = await homeScreen(page).locator('[data-meta]').allTextContents();
    for (const m of metas) expect(m).toMatch(/^Unassigned/);
    await chips(page).getByRole('radio', { name: /^Unassigned,/ }).focus();
    await page.keyboard.press('Home');
    await expect(chips(page).getByRole('radio', { name: /^Everyone,/ })).toBeFocused();
    await expect(chips(page).getByRole('radio', { name: /^Everyone,/ })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(chips(page).getByRole('radio', { name: /^Stratis \(you\),/ })).toHaveAttribute('aria-checked', 'true');
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
    await chips(page).getByRole('radio', { name: 'Ela, 0 items' }).click();
    await expect(homeScreen(page).getByText('Nothing for Ela right now.', { exact: true })).toBeVisible();
    await expect(area(page, 'Kitchen')).toHaveCount(0);
    await expect(homeScreen(page).getByRole('button', { name: /^(Collapse|Expand) All$/ })).toHaveCount(0);
  });
});
