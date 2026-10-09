import {
  area,
  areaHeadings,
  DEFAULT_AREAS,
  DEMO_STORAGE_KEY,
  detailValue,
  expect,
  homeScreen,
  keepOnlyAreas,
  meta,
  openItem,
  openNewItem,
  openSeeded,
  profile,
  ring,
  row,
  rowButton,
  test,
  titlesIn,
  toast,
} from './fixtures';

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
});

test.describe('Home', () => {
  test('shows the address and the areas in the household order', async ({ page }) => {
    const home = homeScreen(page);
    await expect(home.getByText('21 Alderbrook Road', { exact: true })).toBeVisible();
    await expect(home.getByRole('img', { name: /duck and a hedgehog/ })).toBeVisible();
    await expect(areaHeadings(page)).toHaveText(DEFAULT_AREAS);
    await expect(area(page, 'Bedroom Small').getByText('Nothing to do', { exact: true })).toBeVisible();
  });

  test('sorts items in an area by due date, earliest first', async ({ page }) => {
    // Seeded as "wall panel" (30 Oct) then "firepit" (15 Oct).
    expect(await titlesIn(page, 'Garden')).toEqual(['Give away the old firepit', 'Garden room wall panel']);
    expect(await titlesIn(page, 'Kitchen')).toEqual(['Kitchen paper', 'Olive oil']);
    expect(await titlesIn(page, 'Jacuzzi')).toEqual(['Water test strips running low', 'Change the filter']);
  });

  test('items without a due date go last', async ({ page }) => {
    const sheet = await openItem(page, 'Give away the old firepit');
    await sheet.getByLabel('Due', { exact: true }).fill('');
    await expect(detailValue(sheet, 'Due')).toHaveText('None');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    expect(await titlesIn(page, 'Garden')).toEqual(['Garden room wall panel', 'Give away the old firepit']);
    await expect(meta(page, 'Give away the old firepit')).toHaveText('🦊 Ela');
  });

  test('meta lines: assignee or Unassigned, then the date; missed dates in red', async ({ page }) => {
    await expect(meta(page, 'Kitchen paper')).toHaveText('🦔 Stratis · Thu 5 Nov');
    await expect(meta(page, 'Shower draining slowly')).toHaveText('🦆 Shea · Wed 14 Oct');
    await expect(meta(page, 'Give away the old firepit')).toHaveText('🦊 Ela · Thu 15 Oct');
    await expect(meta(page, 'Mirror lights not level')).toHaveText('Unassigned · Tue 20 Oct');
    await expect(meta(page, 'Trim the hedges')).toHaveText('Unassigned · Mon 2 Nov');

    const heaters = meta(page, 'Heaters not working');
    await expect(heaters).toHaveText('🦆 Shea · Missed · Tue 6 Oct');
    const missed = heaters.getByText('Missed · Tue 6 Oct', { exact: true });
    await expect(missed).toHaveCSS('color', 'rgb(215, 0, 21)');
    await expect(missed).toHaveCSS('font-weight', '700');
    // A date that is not missed stays in the secondary colour.
    await expect(meta(page, 'Mirror lights not level').getByText('Tue 20 Oct')).toHaveCSS('color', 'rgb(110, 110, 115)');

    // The note is shown under the title; an item without one has no note line.
    await expect(row(page, 'Mirror lights not level')).toContainText('One is 3cm higher.');
    await expect(rowButton(page, 'Change the filter').locator(':scope > span')).toHaveCount(2);
  });

  test('status rings are coloured by RAG', async ({ page }) => {
    await expect(ring(page, 'Heaters not working')).toHaveCSS('border-top-color', 'rgb(255, 59, 48)');
    await expect(ring(page, 'Mirror lights not level')).toHaveCSS('border-top-color', 'rgb(255, 149, 0)');
    await expect(ring(page, 'Kitchen paper')).toHaveCSS('border-top-color', 'rgb(52, 199, 89)');
  });

  test('tapping a ring completes the item, with Undo', async ({ page }) => {
    await ring(page, 'Mirror lights not level').click();
    await expect(ring(page, 'Mirror lights not level')).toHaveCount(0);
    await expect(area(page, 'Living Room').getByText('Nothing to do')).toBeVisible();
    const done = toast(page, 'Marked as done');
    await expect(done).toBeVisible();

    await done.getByRole('button', { name: 'Undo' }).click();
    await expect(ring(page, 'Mirror lights not level')).toBeVisible();
    await expect(meta(page, 'Mirror lights not level')).toHaveText('Unassigned · Tue 20 Oct');
    await expect(area(page, 'Living Room').getByText('Nothing to do')).toHaveCount(0);
    await expect(done).toHaveCount(0);
  });

  test('Ctrl+Z undoes a completion from the keyboard', async ({ page }) => {
    await ring(page, 'Mirror lights not level').click();
    await expect(ring(page, 'Mirror lights not level')).toHaveCount(0);
    const done = toast(page, 'Marked as done');
    await expect(done.getByRole('button', { name: 'Undo' })).toHaveAttribute('aria-keyshortcuts', 'Meta+Z Control+Z');
    await page.keyboard.press('Control+z');
    await expect(ring(page, 'Mirror lights not level')).toBeVisible();
    await expect(done).toHaveCount(0);
    // Nothing left to undo: another Ctrl+Z changes nothing.
    await page.keyboard.press('Control+z');
    await expect(ring(page, 'Mirror lights not level')).toBeVisible();
  });

  test('the toast stays while Undo has keyboard focus', async ({ page }) => {
    await ring(page, 'Shower draining slowly').click();
    const done = toast(page, 'Marked as done');
    const undo = done.getByRole('button', { name: 'Undo' });
    await undo.focus();
    await page.clock.runFor(6_000);
    await expect(done).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(ring(page, 'Shower draining slowly')).toBeVisible();
    await expect(done).toHaveCount(0);
  });

  test('two rings tapped 12ms apart both stay done', async ({ page }) => {
    // One-off items, so a completed one leaves Home. A load that started before the
    // second tap must not put the second item back once it lands.
    const pairs = [
      ['Mirror lights not level', 'Re-seal around the shower'],
      ['Shower draining slowly', 'Wardrobe door hinge'],
      ['Garden room wall panel', 'Give away the old firepit'],
      ['Water test strips running low', 'Heaters not working'],
    ];
    for (let round = 0; round < 3; round++) {
      if (round > 0) await openSeeded(page);
      for (const [a, b] of pairs) {
        await page.evaluate(async ([a, b]) => {
          const ringFor = (title: string) =>
            document.querySelector<HTMLElement>(`[aria-label="Mark ${title} as done"]`);
          ringFor(a)!.click();
          await new Promise((resolve) => setTimeout(resolve, 12));
          ringFor(b)!.click();
        }, [a, b]);
        await page.waitForTimeout(1_000);
        // Checked once, without waiting: a stale load would have put a row back by now.
        expect(await ring(page, a).count(), `round ${round}: ${a}`).toBe(0);
        expect(await ring(page, b).count(), `round ${round}: ${b}`).toBe(0);
      }
      const stored = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).items.filter((i: { status: string }) => i.status === 'done').length,
        DEMO_STORAGE_KEY,
      );
      expect(stored).toBe(pairs.length * 2);
    }
  });

  test('the toast goes away by itself after about 4 seconds', async ({ page }) => {
    await ring(page, 'Water test strips running low').click();
    const done = toast(page, 'Marked as done');
    await expect(done).toBeVisible();
    await expect(done).toHaveCount(0, { timeout: 6_000 });
    await expect(ring(page, 'Water test strips running low')).toHaveCount(0);
  });

  test('completing a missed item removes it', async ({ page }) => {
    await ring(page, 'Heaters not working').click();
    await expect(ring(page, 'Heaters not working')).toHaveCount(0);
    await expect(area(page, 'Hallway').getByText('Nothing to do')).toBeVisible();
  });

  test('a repeating item moves its date instead of disappearing', async ({ page }) => {
    // Monthly, due Thu 5 Nov.
    await ring(page, 'Kitchen paper').click();
    await expect(toast(page, 'Done. Next due Sat 5 Dec')).toBeVisible();
    await expect(ring(page, 'Kitchen paper')).toBeVisible();
    await expect(meta(page, 'Kitchen paper')).toHaveText('🦔 Stratis · Sat 5 Dec');
    // Re-sorted: Olive oil (12 Nov) is now first.
    expect(await titlesIn(page, 'Kitchen')).toEqual(['Olive oil', 'Kitchen paper']);

    await toast(page, 'Done. Next due Sat 5 Dec').getByRole('button', { name: 'Undo' }).click();
    await expect(meta(page, 'Kitchen paper')).toHaveText('🦔 Stratis · Thu 5 Nov');
    expect(await titlesIn(page, 'Kitchen')).toEqual(['Kitchen paper', 'Olive oil']);
  });

  test('a repeating item that is long overdue steps forward from today', async ({ page }) => {
    // Monthly; make it due 1 Sep. One month on (1 Oct) is still past, so: today + 1 month.
    const sheet = await openItem(page, 'Change the filter');
    await sheet.getByLabel('Due', { exact: true }).fill('2026-09-01');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(meta(page, 'Change the filter')).toHaveText('🦆 Shea · Missed · Tue 1 Sep');

    await ring(page, 'Change the filter').click();
    await expect(meta(page, 'Change the filter')).toHaveText('🦆 Shea · Sun 8 Nov');
  });

  test('a repeating item without a due date gets one, an interval from today', async ({ page }) => {
    // Quarterly.
    const sheet = await openItem(page, 'Trim the hedges');
    await sheet.getByLabel('Due', { exact: true }).fill('');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(meta(page, 'Trim the hedges')).toHaveText('Unassigned');
    await ring(page, 'Trim the hedges').click();
    // Next year's dates carry the year.
    await expect(meta(page, 'Trim the hedges')).toHaveText('Unassigned · Fri 8 Jan 2027');
  });

  test('a quick double tap on a repeating ring completes it once', async ({ page }) => {
    await ring(page, 'Change the filter').dblclick();
    await expect(meta(page, 'Change the filter')).toHaveText('🦆 Shea · Fri 20 Nov');
    // Give a second completion time to land, then check it did not.
    await page.waitForTimeout(1_000);
    await expect(meta(page, 'Change the filter')).toHaveText('🦆 Shea · Fri 20 Nov');
  });

  test('tapping a row (not the ring) opens the Item sheet', async ({ page }) => {
    const sheet = await openItem(page, 'Heaters not working');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel('Title', { exact: true })).toHaveValue('Heaters not working');
    await expect(ring(page, 'Heaters not working')).toHaveCount(1);
  });

  test('the avatar opens Profile', async ({ page }) => {
    const avatar = page.getByRole('button', { name: 'Profile', exact: true });
    await expect(avatar).toHaveText('🦔');
    await avatar.click();
    await expect(page.getByRole('dialog', { name: 'Profile' })).toBeVisible();
  });
});

test.describe('Without areas', () => {
  test('Home says where to add one, and the new-item sheet says why it can’t save', async ({ page }) => {
    // Another member deleted the last areas at the same time (one person can't: see profile.spec.ts).
    await keepOnlyAreas(page, []);
    const home = homeScreen(page);
    await expect(home.getByText('No areas yet')).toBeVisible();
    await expect(home.getByText(/Add one in Profile, under Household\.$/)).toBeVisible();
    await expect(areaHeadings(page)).toHaveCount(0);

    const sheet = await openNewItem(page);
    await sheet.getByLabel('Title', { exact: true }).fill('Fix the gate latch');
    const save = sheet.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    await expect(save).toHaveAccessibleDescription('Items live in an area. Add one in Profile, under Household.');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('alertdialog', { name: 'Discard this item?' }).getByRole('button', { name: 'Discard Changes' }).click();
    await expect(sheet).toHaveCount(0);

    await home.getByRole('button', { name: 'Open Profile' }).click();
    await expect(profile(page)).toBeVisible();
  });
});

test.describe('Confetti and motion', () => {
  test('a ring tap fires 36 hedgehogs and ducks from the ring, gone after ~3s', async ({ page }) => {
    const particles = page.locator('[data-confetti] span');
    await ring(page, 'Olive oil').click();
    await expect(particles).toHaveCount(36);
    const texts = await particles.allTextContents();
    expect(new Set(texts).size).toBeLessThanOrEqual(2);
    for (const t of texts) expect(['🦔', '🦆']).toContain(t);
    // Never in the way of taps.
    await expect(page.locator('[data-confetti]')).toHaveCSS('pointer-events', 'none');
    await expect(particles).toHaveCount(0, { timeout: 5_000 });
  });

  test('Mark as Done fires the confetti too', async ({ page }) => {
    const sheet = await openItem(page, 'Olive oil');
    await sheet.getByRole('button', { name: 'Mark as Done' }).click();
    await expect(page.locator('[data-confetti] span')).toHaveCount(36);
  });

  test.describe('with Reduce Motion', () => {
    test.use({ contextOptions: { reducedMotion: 'reduce' } });

    test('the animals stay still and the burst is small', async ({ page }) => {
      const scene = homeScreen(page).getByRole('img', { name: /duck and a hedgehog/ });
      await expect(scene.getByText('🦆')).toHaveCSS('animation-name', 'none');
      await expect(scene.getByText('🦔')).toHaveCSS('animation-name', 'none');
      await ring(page, 'Olive oil').click();
      await expect(page.locator('[data-confetti] span')).toHaveCount(6);
    });
  });

  test('the animals move without Reduce Motion', async ({ page }) => {
    const scene = homeScreen(page).getByRole('img', { name: /duck and a hedgehog/ });
    await expect(scene.getByText('🦆')).not.toHaveCSS('animation-name', 'none');
    await expect(scene.getByText('🦔')).not.toHaveCSS('animation-name', 'none');
  });
});

test.describe('Long text', () => {
  test('a long note is cut off at two lines on Home', async ({ page }) => {
    const sheet = await openItem(page, 'Olive oil');
    await sheet.getByLabel('Note', { exact: true }).fill(
      'Restocked, 5L tin is in the pantry. ' .repeat(8).trim(),
    );
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    const note = rowButton(page, 'Olive oil').locator(':scope > span').nth(1);
    await expect(note).toContainText('Restocked, 5L tin');
    const box = (await note.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(41);
    expect(box.height).toBeGreaterThan(30);
  });
});

