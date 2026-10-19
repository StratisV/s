import {
  closeArea,
  expect,
  goToTab,
  openArea,
  openSeeded,
  ring,
  settled,
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

  test('a tap on a person’s slice opens their tasks, the middle everyone’s; each person a 44px target', async ({ page }) => {
    const chart = donut(page);
    const sheet = page.getByRole('dialog', { name: 'Done this month' });
    const done = sheet.getByRole('button', { name: 'Done', exact: true });
    // The slices are in member order: Stratis, Shea, Ela.
    for (const [i, name, count] of [
      [0, 'Stratis', 4],
      [1, 'Shea', 2],
      [2, 'Ela', 1],
    ] as const) {
      const id = await chart.locator('svg g circle').nth(i).getAttribute('data-member');
      // A point on the ring where a finger lands on that slice: nothing over the ring takes it.
      const point = await chart.evaluate((el, member) => {
        const box = el.getBoundingClientRect();
        const [cx, cy] = [box.left + box.width / 2, box.top + box.height / 2];
        for (let deg = 0; deg < 360; deg += 2) {
          const [x, y] = [cx + 97 * Math.cos((deg * Math.PI) / 180), cy + 97 * Math.sin((deg * Math.PI) / 180)];
          if (document.elementFromPoint(x, y)?.getAttribute('data-member') === member) return { x, y };
        }
        return null;
      }, id);
      expect(point, name).not.toBeNull();
      await page.touchscreen.tap(point!.x, point!.y);
      await settled(done);
      await expect(sheet.getByRole('radio', { name: `${name}, ${count}` })).toHaveAttribute('aria-checked', 'true');
      await expect(sheet.locator('[data-done-row]')).toHaveCount(count);
      await done.click();
      await expect(sheet).toHaveCount(0);
    }

    // The middle, over the total: everyone's.
    const box = (await chart.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await settled(done);
    await expect(sheet.getByRole('radio', { name: /^Everyone/ })).toHaveAttribute('aria-checked', 'true');
    await expect(sheet.locator('[data-done-row]')).toHaveCount(7);
    // Each person is drawn 36px tall and takes a finger 44px tall; the chosen one is white on
    // the deeper tint fill, its count too (4.7:1).
    const chips = sheet.getByRole('radiogroup', { name: 'Show tasks done by' }).getByRole('radio');
    const reach = await chips.evaluateAll((els) =>
      els.map((el) => {
        // The row scrolls sideways: each in view first.
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const hit = (y: number) => el.contains(document.elementFromPoint(x, y));
        return { drawn: Math.round(r.height), reach: hit(r.top - 3.5) && hit(r.bottom + 3.5) };
      }),
    );
    expect(reach).toEqual(Array.from({ length: 4 }, () => ({ drawn: 36, reach: true })));
    const everyone = sheet.getByRole('radio', { name: /^Everyone/ });
    await expect(everyone).toHaveCSS('background-color', 'rgb(0, 113, 227)');
    await expect(everyone.locator('span')).toHaveCSS('opacity', '1');
    // Done, in the darker tint words use (6:1 on the sheet; the system blue was 3.6:1).
    await expect(done).toHaveCSS('color', 'rgb(0, 88, 185)');
  });

  test('a completion counts for the assignee, or for whoever marked an unassigned item done', async ({ page }) => {
    await goToTab(page, 'Home');
    // Assigned to Shea.
    await openArea(page, 'Bathroom Large');
    await ring(page, 'Shower draining slowly').click();
    await expect(ring(page, 'Shower draining slowly')).toHaveCount(0);
    await closeArea(page);
    // Unassigned: credited to me (Stratis).
    await openArea(page, 'Jacuzzi');
    await ring(page, 'Water test strips running low').click();
    await expect(ring(page, 'Water test strips running low')).toHaveCount(0);
    await closeArea(page);

    await goToTab(page, 'Stats');
    await expectStats(page, 9, [['🦔', 'Stratis', 5], ['🦆', 'Shea', 3], ['🦊', 'Ela', 1]], 'this month');
    await statsScreen(page).getByRole('radio', { name: 'Lifetime' }).click();
    await expectStats(page, 113, [['🦔', 'Stratis', 59], ['🦆', 'Shea', 38], ['🦊', 'Ela', 16]], 'in total');
  });

  test('undoing a completion takes it off again', async ({ page }) => {
    await goToTab(page, 'Home');
    await openArea(page, 'Garden');
    await ring(page, 'Give away the old firepit').click();
    await toast(page, 'Marked as done').getByRole('button', { name: 'Undo' }).click();
    await expect(ring(page, 'Give away the old firepit')).toBeVisible();
    await closeArea(page);
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
