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
  openFresh,
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
  type Locator,
  type Page,
} from './fixtures';

/** The home scene (sky, house, duck and hedgehog). */
function scene(page: Page): Locator {
  return page.getByRole('img', { name: /^A duck and a hedgehog outside their house/ });
}

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
    const particles = page.locator('[data-confetti] img');
    await ring(page, 'Olive oil').click();
    await expect(particles).toHaveCount(36);
    // The scene's own drawings (green duck, brown hedgehog), not emoji.
    const kinds = await particles.evaluateAll((els) =>
      els.map((el) => [el.getAttribute('data-animal'), el.getAttribute('alt'), (el as HTMLImageElement).src.startsWith('data:image/svg+xml')]),
    );
    for (const [kind, alt, src] of kinds) {
      expect(['hedgehog', 'duck']).toContain(kind);
      expect(alt).toBe('');
      expect(src).toBe(true);
    }
    await expect(page.locator('[data-confetti]')).not.toContainText(/🦔|🦆/);
    // Never in the way of taps.
    await expect(page.locator('[data-confetti]')).toHaveCSS('pointer-events', 'none');
    await expect(particles).toHaveCount(0, { timeout: 5_000 });
  });

  test('Mark as Done fires the confetti too', async ({ page }) => {
    const sheet = await openItem(page, 'Olive oil');
    await sheet.getByRole('button', { name: 'Mark as Done' }).click();
    await expect(page.locator('[data-confetti] img')).toHaveCount(36);
  });

  test.describe('with Reduce Motion', () => {
    test.use({ contextOptions: { reducedMotion: 'reduce' } });

    test('the animals and stars stay still and the burst is small', async ({ page }) => {
      await expect(scene(page).locator('[data-animal="duck"]')).toHaveCSS('animation-name', 'none');
      await expect(scene(page).locator('[data-animal="hedgehog"]')).toHaveCSS('animation-name', 'none');
      await ring(page, 'Olive oil').click();
      await expect(page.locator('[data-confetti] img')).toHaveCount(6);

      await page.clock.setSystemTime(new Date('2026-10-08T22:00:00+01:00'));
      await page.reload();
      expect(await twinkles(page)).toEqual(['none']);
    });
  });

  test('the animals move without Reduce Motion, and the stars twinkle at night', async ({ page }) => {
    await expect(scene(page).locator('[data-animal="duck"]')).not.toHaveCSS('animation-name', 'none');
    await expect(scene(page).locator('[data-animal="hedgehog"]')).not.toHaveCSS('animation-name', 'none');
    // Nothing twinkles by day.
    expect(await twinkles(page)).toEqual(['none']);
    await page.clock.setSystemTime(new Date('2026-10-08T22:00:00+01:00'));
    await page.reload();
    const names = await twinkles(page);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/twinkle/);
  });
});

/** The scene's box, and the boxes (relative to it) of the suns that can be seen. */
async function sunBoxes(page: Page) {
  return scene(page).evaluate((el) => {
    const b = el.getBoundingClientRect();
    const shown = Array.from(el.querySelectorAll<HTMLElement>('[data-side]'))
      .filter((s) => Number(getComputedStyle(s).opacity) > 0.5)
      .map((s) => {
        const r = s.getBoundingClientRect();
        return { x: r.x - b.x, y: r.y - b.y, width: r.width, height: r.height };
      });
    return { box: { width: b.width, height: b.height }, shown };
  });
}

/** The distinct animations running on the scene's stars. */
async function twinkles(page: Page): Promise<string[]> {
  const stars = scene(page).locator('[data-star]');
  await expect(stars.first()).toBeAttached();
  const names = await stars.evaluateAll((els) => els.map((el) => getComputedStyle(el, '::before').animationName));
  return [...new Set(names)];
}

test.describe('Home scene', () => {
  test('a green duck facing the house on the left, a brown hedgehog on the right', async ({ page }) => {
    const duck = scene(page).locator('img[data-animal="duck"]');
    const hedgehog = scene(page).locator('img[data-animal="hedgehog"]');
    await expect(duck).toHaveAttribute('alt', '');
    await expect(hedgehog).toHaveAttribute('alt', '');
    // No emoji animals in the scene (the house is still the 🏡).
    await expect(scene(page)).not.toContainText(/🦔|🦆/);
    // Drawn: the duck mostly green, the hedgehog mostly brown.
    const colours = await page.evaluate(async () => {
      const tally = async (img: HTMLImageElement) => {
        await img.decode();
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0, 64, 64);
        const px = g.getImageData(0, 0, 64, 64).data;
        let green = 0;
        let brown = 0;
        let solid = 0;
        for (let i = 0; i < px.length; i += 4) {
          const [r, gr, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
          if (a < 200) continue;
          solid++;
          if (gr > r + 25 && gr > b + 25) green++;
          if (r > gr + 20 && gr > b + 10 && r < 200) brown++;
        }
        return { green: green / solid, brown: brown / solid };
      };
      const imgs = (name: string) => document.querySelector<HTMLImageElement>(`[role="img"] img[data-animal="${name}"]`)!;
      return { duck: await tally(imgs('duck')), hedgehog: await tally(imgs('hedgehog')) };
    });
    expect(colours.duck.green).toBeGreaterThan(0.6);
    expect(colours.hedgehog.brown).toBeGreaterThan(0.4);
    expect(colours.hedgehog.green).toBe(0);
    // Either side of the house, both on the ground.
    const [d, h, house] = await Promise.all([duck.boundingBox(), hedgehog.boundingBox(), scene(page).getByText('🏡').boundingBox()]);
    expect(d!.x + d!.width).toBeLessThan(house!.x + 12);
    expect(h!.x).toBeGreaterThan(house!.x + house!.width - 12);
  });

  test('follows the sun in London through the day (8 October)', async ({ page }) => {
    const sky = scene(page);
    // 10:00 (the fixtures' NOW): daytime, the 3a look.
    await expect(sky).toHaveAttribute('data-phase', 'day');
    await expect(sky).toHaveAccessibleName('A duck and a hedgehog outside their house in the daytime');
    await expect(sky).toHaveCSS('--sky-top', 'rgb(234, 243, 255)');

    const expected: [string, string, string][] = [
      ['03:00', 'night', 'at night'],
      ['07:30', 'sunrise', 'at sunrise'],
      ['12:00', 'day', 'in the daytime'],
      ['18:05', 'sunset', 'at sunset'],
      ['18:45', 'dusk', 'at dusk'],
    ];
    // Recomputed every minute: move the clock, let a minute pass.
    for (const [time, phase, phrase] of expected) {
      await page.clock.setSystemTime(new Date(`2026-10-08T${time}:00+01:00`));
      await page.clock.runFor(61_000);
      await expect(sky, time).toHaveAttribute('data-phase', phase);
      await expect(sky).toHaveAccessibleName(`A duck and a hedgehog outside their house ${phrase}`);
    }
    // And right away when the app is opened at that time.
    for (const [time, phase] of expected) {
      await page.clock.setSystemTime(new Date(`2026-10-08T${time}:00+01:00`));
      await page.reload();
      await expect(sky, `${time} after reload`).toHaveAttribute('data-phase', phase);
    }
  });

  test('night: navy sky, moon and stars, the house lit; the sun sets on the right', async ({ page }) => {
    await page.clock.setSystemTime(new Date('2026-10-08T22:00:00+01:00'));
    await page.reload();
    const sky = scene(page);
    await expect(sky).toHaveAttribute('data-phase', 'night');
    await expect(sky).toHaveCSS('--sky-top', 'rgb(11, 21, 51)');
    await expect(sky).toHaveCSS('--moon', '1');
    await expect(sky).toHaveCSS('--lamps', '1');

    await expect(sky.locator('[data-side]').first()).toHaveCSS('opacity', '0');
    await expect(sky.locator('[data-side]').last()).toHaveCSS('opacity', '0');

    // Sunrise on the left (east), sunset on the right (west), low in both.
    for (const [time, side] of [
      ['07:45', 'east'],
      ['17:55', 'west'],
    ] as const) {
      await page.clock.setSystemTime(new Date(`2026-10-08T${time}:00+01:00`));
      await page.reload();
      await expect(sky).toHaveAttribute('data-sun', side);
      const { box, shown } = await sunBoxes(page);
      expect(shown, time).toHaveLength(1);
      const sun = shown[0];
      if (side === 'east') expect(sun.x + sun.width / 2).toBeLessThan(box.width / 4);
      else expect(sun.x + sun.width / 2).toBeGreaterThan((box.width * 3) / 4);
      // Low: its centre in the bottom half of the sky (the horizon is at 66%).
      expect(sun.y + sun.height / 2).toBeGreaterThan(box.height * 0.33);
    }
  });

  test('by day the sun is in the 3a spot, never on the house, morning or afternoon', async ({ page }) => {
    const sky = scene(page);
    const house = sky.getByText('🏡');
    for (const at of [
      '2026-10-08T09:30:00+01:00',
      '2026-10-08T12:50:00+01:00', // solar noon
      '2026-10-08T15:30:00+01:00',
      '2026-12-21T12:00:00Z',
      '2026-06-21T13:00:00+01:00',
    ]) {
      await page.clock.setSystemTime(new Date(at));
      await page.reload();
      await expect(sky, at).toHaveAttribute('data-phase', 'day');
      const { box, shown } = await sunBoxes(page);
      expect(shown, at).toHaveLength(1);
      const sun = shown[0];
      // 28px circle, 22px from the top and 28px from the right (design/README.md "Home scene card").
      expect(sun.width).toBe(28);
      expect(sun.y).toBeCloseTo(22, 0);
      expect(box.width - (sun.x + sun.width)).toBeCloseTo(28, 0);
      // Clear of the house, halo (9px) and all.
      const [h, s] = [(await house.boundingBox())!, (await sky.boundingBox())!];
      const hx = h.x - s.x;
      const hy = h.y - s.y;
      const apart =
        sun.x - 9 > hx + h.width || sun.x + sun.width + 9 < hx || sun.y - 9 > hy + h.height || sun.y + sun.height + 9 < hy;
      expect(apart, at).toBe(true);
    }
    // The morning sun climbs on the left first.
    await page.clock.setSystemTime(new Date('2026-10-08T08:15:00+01:00'));
    await page.reload();
    await expect(sky).toHaveAttribute('data-sun', 'east');
  });

  test('back from the background a day later, the sun is just in its new place (no glide)', async ({ page }) => {
    const sky = scene(page);
    const lift = () => sky.evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--sun-lift')));
    await page.clock.setSystemTime(new Date('2026-10-08T17:30:00+01:00'));
    await page.reload();
    await expect(sky).toHaveAttribute('data-sun', 'west');
    const before = await lift();
    expect(before).toBeLessThan(0.9);

    // The next morning, low in the east: the app comes back into view.
    await page.clock.setSystemTime(new Date('2026-10-09T07:50:00+01:00'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(sky).toHaveAttribute('data-sun', 'east');
    await page.waitForTimeout(120);
    const soon = await lift();
    await page.waitForTimeout(2000);
    // Already there after about 0.1s, not part-way through a 1.6s glide.
    expect(soon).toBeCloseTo(await lift(), 3);
    expect(Math.abs(soon - before)).toBeGreaterThan(0.1);

    // A minute passing still glides (the transitions are back on).
    await expect(sky).not.toHaveAttribute('data-jump');
    await expect(sky).toHaveCSS('transition-property', /--sun-lift/);
  });

  test('the Welcome screen shows the same sky', async ({ page }) => {
    await page.clock.setSystemTime(new Date('2026-10-08T18:05:00+01:00'));
    await openFresh(page);
    await expect(scene(page)).toHaveAttribute('data-phase', 'sunset');
    await expect(scene(page)).toHaveAccessibleName('A duck and a hedgehog outside their house at sunset');
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

