import {
  area,
  areaCard,
  areaCards,
  areaStatus,
  attentionScreen,
  closeArea,
  DEFAULT_AREAS,
  DEMO_STORAGE_KEY,
  detailValue,
  expect,
  expectAreas,
  group,
  homeScreen,
  homeSummary,
  keepOnlyAreas,
  meta,
  mine,
  NOW,
  openArea,
  openAttention,
  openFresh,
  openItem,
  openNewItem,
  openSeeded,
  profile,
  ring,
  row,
  rowButton,
  summary,
  tabButton,
  tabs,
  test,
  titlesIn,
  toast,
  views,
  who,
  type Locator,
  type Page,
} from './fixtures';

/** The hero at the top of the screen (sky, house, duck and hedgehog). */
function hero(page: Page): Locator {
  return page.locator('[data-phase][data-tone]').first();
}

/** Animations running in the hero (paused ones, off screen or for Reduce Motion, don't count). */
function running(page: Page): Promise<number> {
  return hero(page).evaluate(
    (el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length,
  );
}

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

/** How long a ticked row takes to leave: its check (ItemRow's COMPLETE_FEEDBACK_MS), then its fold (LEAVE_MS). */
const ROW_LEAVES_MS = 420 + 260;

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
});

test.describe('Home', () => {
  test('shows the address, one sentence, and a card for each area in the household order', async ({ page }) => {
    const home = homeScreen(page);
    await expect(home.getByText('21 Alderbrook Road', { exact: true })).toBeVisible();
    await expect(hero(page)).toBeVisible();
    await expect(homeSummary(page)).toHaveText('2 things need attention and 1 is due today. Everything else can wait.');
    await expectAreas(page, DEFAULT_AREAS);
    // Two cards to a row, the same width, 12px apart, inside the page's 16px gutter.
    const first = (await areaCards(page).nth(0).boundingBox())!;
    const second = (await areaCards(page).nth(1).boundingBox())!;
    const third = (await areaCards(page).nth(2).boundingBox())!;
    expect(first.x).toBe(16);
    expect(Math.round(second.x + second.width)).toBe(402 - 16);
    expect(second.y).toBe(first.y);
    expect(Math.abs(first.width - second.width)).toBeLessThan(1);
    expect(Math.round(second.x - (first.x + first.width))).toBe(12);
    expect(third.x).toBe(16);
    expect(third.y).toBeGreaterThan(first.y + first.height);
    // Each card says its area's state, how many To dos are open and who is on them.
    await expect(areaCard(page, 'Hallway')).toHaveAccessibleName(/^Hallway\b.*1 needs attention/);
    await expect(areaCard(page, 'Living Room')).toHaveAccessibleName(/^Living Room\b.*1 coming up/);
    await expect(areaCard(page, 'Garden')).toHaveAccessibleName(/^Garden\b.*1 coming up.*\b2\b.*Ela.*Stratis/);
    await expect(areaCard(page, 'Bedroom Small')).toHaveAccessibleName(/^Bedroom Small\b.*All clear/);
  });

  test('every card has its own drawing of its area, hidden from assistive tech', async ({ page }) => {
    const art = homeScreen(page).locator('[data-area-grid] [data-area-art]');
    await expect(art).toHaveCount(DEFAULT_AREAS.length);
    // The drawings arrive as one chunk, a moment after the cards.
    await expect(homeScreen(page).locator('[data-area-grid] [data-area-art] svg')).toHaveCount(DEFAULT_AREAS.length);
    const pictures = await art.evaluateAll((els) =>
      els.map((el) => ({ key: el.getAttribute('data-area-art') ?? '', hidden: el.getAttribute('aria-hidden') })),
    );
    // The scene and its composition come from the name: eleven areas, eleven different scenes.
    const scenes = pictures.map(({ key }) => key.split(':')[0]);
    expect(new Set(scenes).size).toBe(DEFAULT_AREAS.length);
    expect(scenes.slice(2, 6)).toEqual(['bathroom-alt', 'bathroom', 'bedroom-alt', 'bedroom']);
    for (const { hidden } of pictures) expect(hidden).toBe('true');
    // Inset in its card, the full width of it but for the card's 6px.
    const card = (await areaCard(page, 'Kitchen').boundingBox())!;
    const picture = (await areaCard(page, 'Kitchen').locator('[data-area-art]').boundingBox())!;
    expect(Math.round(picture.x - card.x)).toBe(6);
    expect(Math.round(card.x + card.width - (picture.x + picture.width))).toBe(6);
    expect(Math.round((picture.width / picture.height) * 7)).toBe(8);
  });

  test('the sentence opens Needs attention', async ({ page }) => {
    await homeSummary(page).click();
    await expect(tabButton(page, 'Attention')).toHaveAttribute('aria-current', 'page');
    await expect(summary(page)).toHaveText('2 things need attention and 1 is due today. Everything else can wait.');
  });

  test('a card opens its area in a sheet: its drawing, its name, its state and who is on it', async ({ page }) => {
    const sheet = await openArea(page, 'Garden');
    await expect(sheet.getByRole('heading', { level: 1 })).toHaveText('Garden');
    await expect(areaStatus(page, 'Garden')).toHaveText('1 coming up');
    await expect(sheet.locator('[data-area-people]')).toHaveText('Ela and Stratis are on it');
    // The drawing is a wide banner across the sheet's top, under its rounded corners.
    const art = (await sheet.locator('[data-area-art]').boundingBox())!;
    const box = (await sheet.boundingBox())!;
    expect(art.y).toBe(box.y);
    expect(art.width).toBe(box.width);
    expect(art.height).toBeGreaterThanOrEqual(150);
    await expect(sheet.getByRole('button', { name: 'Add item to Garden', exact: true })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Share Room', exact: true })).toBeVisible();
    // Home is behind it, pushed back and out of reach; Close goes back to it.
    await expect(tabs(page).locator('xpath=ancestor::*[@inert]')).toHaveCount(1);
    await closeArea(page);
    await expect(tabs(page).locator('xpath=ancestor::*[@inert]')).toHaveCount(0);
  });

  test('lists an area’s To dos most urgent first, then by date', async ({ page }) => {
    // The wall panel (Within the month, 30 Oct) before the firepit (Not urgent, 15 Oct).
    await openArea(page, 'Garden');
    expect(await titlesIn(page, 'Garden')).toEqual(['Garden room wall panel', 'Give away the old firepit']);
    await closeArea(page);
    await openArea(page, 'Kitchen');
    expect(await titlesIn(page, 'Kitchen')).toEqual(['Kitchen paper', 'Olive oil']);
    await closeArea(page);
    await openArea(page, 'Jacuzzi');
    expect(await titlesIn(page, 'Jacuzzi')).toEqual(['Water test strips running low', 'Change the filter']);
  });

  test('items without a due date go last', async ({ page }) => {
    await openArea(page, 'Kitchen');
    const sheet = await openItem(page, 'Kitchen paper');
    await sheet.getByLabel('Due', { exact: true }).fill('');
    await expect(detailValue(sheet, 'Due')).toHaveText('None');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    expect(await titlesIn(page, 'Kitchen')).toEqual(['Olive oil', 'Kitchen paper']);
    await expect(meta(page, 'Kitchen paper')).toHaveText('Not urgent');
  });

  test('each row says its urgency in words, when it is due, and who it is for; late in red', async ({ page }) => {
    // Quiet words (Within the month, Not urgent) with a dot after them; Urgent is a pill.
    const check = async (name: string, rows: [title: string, meta: string, who: string | null][]) => {
      await openArea(page, name);
      for (const [title, words, person] of rows) {
        await expect(meta(page, title), title).toHaveText(words);
        if (person) await expect(who(page, title), title).toHaveText(person);
        // Unassigned: nothing there (VoiceOver says "Unassigned").
        else await expect(who(page, title), title).toHaveCount(0);
      }
      await closeArea(page);
    };
    await check('Kitchen', [['Kitchen paper', 'Not urgent·In 4 weeks', '🦔Stratis']]);
    await check('Bathroom Large', [['Shower draining slowly', 'Within the month·In 6 days', '🦆Shea']]);
    await check('Garden', [['Give away the old firepit', 'Not urgent·In 7 days', '🦊Ela']]);
    await check('Front garden', [['Trim the hedges', 'Not urgent·In 4 weeks', null]]);
    await check('Living Room', [['Mirror lights not level', 'Within the month·In 12 days', null]]);
    await openArea(page, 'Living Room');
    await expect(rowButton(page, 'Mirror lights not level')).toHaveAccessibleName(/, Unassigned, has a note\.$/);
    // A note is never on the row, not even as a glyph (VoiceOver hears "has a note"; it is in the sheet).
    await expect(row(page, 'Mirror lights not level')).not.toContainText('One is 3cm higher');
    await expect(rowButton(page, 'Mirror lights not level').locator('svg')).toHaveCount(0);
    // A date that is not late stays in the secondary colour.
    await expect(meta(page, 'Mirror lights not level').getByText('In 12 days')).toHaveCSS('color', 'rgb(110, 110, 115)');
    await closeArea(page);

    await openArea(page, 'Hallway');
    const heaters = meta(page, 'Heaters not working');
    await expect(heaters).toHaveText('Urgent2 days late');
    const late = heaters.getByText('2 days late', { exact: true });
    await expect(late).toHaveCSS('color', 'rgb(215, 0, 21)');
    await expect(late).toHaveCSS('font-weight', '600');
    // One sentence for VoiceOver (Chromium puts a space before the visually hidden part).
    await expect(rowButton(page, 'Heaters not working')).toHaveAccessibleName(
      /^Heaters not working ?, Urgent, 2 days late, Shea, has a note\.$/,
    );
    await closeArea(page);
    // A repeat has its glyph, by the date.
    await openArea(page, 'Jacuzzi');
    await expect(rowButton(page, 'Change the filter').locator('svg')).toHaveCount(1);
    await expect(rowButton(page, 'Change the filter').locator('[data-meta] svg')).toHaveCount(1);
  });

  test('the ring is a neutral grey; the colour is in the words, never alone', async ({ page }) => {
    const label = (title: string) => meta(page, title).locator('[data-rag]');
    // Three volumes: Urgent a filled red pill, Within the month amber words (a hue well apart
    // from the red), Not urgent grey words.
    await openArea(page, 'Hallway');
    await expect(ring(page, 'Heaters not working')).toHaveCSS('border-top-color', 'rgb(142, 142, 147)');
    await expect(label('Heaters not working')).toHaveText('Urgent');
    await expect(label('Heaters not working')).toHaveCSS('color', 'rgb(215, 0, 21)');
    await expect(label('Heaters not working')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await closeArea(page);
    await openArea(page, 'Living Room');
    await expect(ring(page, 'Mirror lights not level')).toHaveCSS('border-top-color', 'rgb(142, 142, 147)');
    await expect(label('Mirror lights not level')).toHaveText('Within the month');
    await expect(label('Mirror lights not level')).toHaveCSS('color', 'rgb(154, 91, 0)');
    await expect(label('Mirror lights not level')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(label('Mirror lights not level')).toHaveCSS('font-weight', '500');
    await closeArea(page);
    await openArea(page, 'Kitchen');
    await expect(ring(page, 'Kitchen paper')).toHaveCSS('border-top-color', 'rgb(142, 142, 147)');
    await expect(label('Kitchen paper')).toHaveText('Not urgent');
    await expect(label('Kitchen paper')).toHaveCSS('color', 'rgb(110, 110, 115)');
    await expect(label('Kitchen paper')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });

  test('the ring takes taps in a 44px circle', async ({ page }) => {
    await openArea(page, 'Hallway');
    await ring(page, 'Heaters not working').scrollIntoViewIfNeeded();
    const box = (await ring(page, 'Heaters not working').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // 21px from the centre (inside 22px) still lands on the ring; to the side, above and below.
    const hits = await page.evaluate(
      ([cx, cy]) =>
        [
          [cx - 21, cy],
          [cx + 21, cy],
          [cx, cy - 21],
          [cx, cy + 21],
        ].map(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null),
      [cx, cy],
    );
    expect(hits).toEqual(Array(4).fill('Mark Heaters not working as done'));
  });

  test('tapping a ring completes the item, with Undo', async ({ page }) => {
    await openArea(page, 'Living Room');
    await expect(areaStatus(page, 'Living Room')).toHaveText('1 coming up');
    await ring(page, 'Mirror lights not level').click();
    await expect(ring(page, 'Mirror lights not level')).toHaveCount(0);
    await expect(areaStatus(page, 'Living Room')).toHaveText('All clear');
    await expect(area(page, 'Living Room').getByText('Nothing to do here.')).toBeVisible();
    const done = toast(page, 'Marked as done');
    await expect(done).toBeVisible();

    await done.getByRole('button', { name: 'Undo' }).click();
    await expect(ring(page, 'Mirror lights not level')).toBeVisible();
    await expect(meta(page, 'Mirror lights not level')).toHaveText('Within the month·In 12 days');
    await expect(areaStatus(page, 'Living Room')).toHaveText('1 coming up');
    await expect(done).toHaveCount(0);
  });

  test('a ticked row is struck through for a moment, then folds away', async ({ page }) => {
    await openArea(page, 'Living Room');
    const item = row(page, 'Mirror lights not level');
    const title = item.locator('[data-item-open] > span > span').first();
    // The line is always there, in no colour: only its colour shows it.
    await expect(title).toHaveCSS('text-decoration-color', 'rgba(0, 0, 0, 0)');
    // Time stands still once tapped, so the moment lasts as long as the check needs.
    await page.clock.pauseAt(new Date(NOW.getTime() + 60_000));
    await ring(page, 'Mirror lights not level').click();
    await expect(item).toHaveAttribute('data-completing');
    await expect(title).toHaveCSS('text-decoration-color', 'rgb(110, 110, 115)');
    await page.clock.resume();
    await expect(ring(page, 'Mirror lights not level')).toHaveCount(0);
  });

  test('Ctrl+Z undoes a completion from the keyboard', async ({ page }) => {
    await openArea(page, 'Living Room');
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
    await openArea(page, 'Bathroom Large');
    await ring(page, 'Shower draining slowly').click();
    const done = toast(page, 'Marked as done');
    const undo = done.getByRole('button', { name: 'Undo' });
    await undo.focus();
    await page.clock.runFor(10_000);
    await expect(done).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(ring(page, 'Shower draining slowly')).toBeVisible();
    await expect(done).toHaveCount(0);
  });

  test('two rings tapped 12ms apart both stay done', async ({ page }) => {
    // Three rounds of four pairs, each waiting out the feedback and the fold: slow on a busy machine.
    test.setTimeout(60_000);
    // One-off items, so a completed one leaves Home. A load that started before the
    // second tap must not put the second item back once it lands.
    const pairs = [
      ['Mirror lights not level', 'Re-seal around the shower'],
      ['Shower draining slowly', 'Wardrobe door hinge'],
      ['Garden room wall panel', 'Give away the old firepit'],
      ['Water test strips running low', 'Heaters not working'],
    ];
    const storedDone = () =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).items.filter((i: { status: string }) => i.status === 'done').length,
        DEMO_STORAGE_KEY,
      );
    // On Needs attention's list, where every room's rows are (Later opened).
    const ringIn = (title: string) => attentionScreen(page).getByRole('button', { name: `Mark ${title} as done`, exact: true });
    for (let round = 0; round < 3; round++) {
      await openSeeded(page, 'List');
      await group(page, 'later').getByRole('button', { name: /^Show \d+ more$/ }).click();
      for (const [i, [a, b]] of pairs.entries()) {
        await page.evaluate(async ([a, b]) => {
          const ringFor = (title: string) =>
            document.querySelector<HTMLElement>(`[aria-label="Mark ${title} as done"]`);
          ringFor(a)!.click();
          await new Promise((resolve) => setTimeout(resolve, 12));
          ringFor(b)!.click();
        }, [a, b]);
        // Both saved (after the check and the fold), then time for any load already under way to land.
        await expect.poll(storedDone, { timeout: 10_000 }).toBe((i + 1) * 2);
        await page.waitForTimeout(ROW_LEAVES_MS);
        // Checked once, without waiting: a stale load would have put a row back by now.
        expect(await ringIn(a).count(), `round ${round}: ${a}`).toBe(0);
        expect(await ringIn(b).count(), `round ${round}: ${b}`).toBe(0);
      }
      expect(await storedDone()).toBe(pairs.length * 2);
    }
  });

  test('Undo stays 8 seconds (a finger can’t hold it), then goes by itself', async ({ page }) => {
    await openArea(page, 'Jacuzzi');
    await ring(page, 'Water test strips running low').click();
    const done = toast(page, 'Marked as done');
    await expect(done).toBeVisible();
    // A finger resting on it: still there well past the 4 seconds words alone get.
    await done.getByText('Marked as done').tap();
    await page.clock.runFor(6_500);
    await expect(done).toBeVisible();
    await expect(done).toHaveCount(0, { timeout: 5_000 });
    await expect(ring(page, 'Water test strips running low')).toHaveCount(0);
  });

  test('completing a late item removes it, and its area says All clear, on its card too', async ({ page }) => {
    await openArea(page, 'Hallway');
    await expect(areaStatus(page, 'Hallway')).toHaveText('1 needs attention');
    await ring(page, 'Heaters not working').click();
    await expect(ring(page, 'Heaters not working')).toHaveCount(0);
    await expect(areaStatus(page, 'Hallway')).toHaveText('All clear');
    await closeArea(page);
    await expect(areaCard(page, 'Hallway')).toHaveAccessibleName(/^Hallway\b.*All clear/);
    await expect(homeSummary(page)).toHaveText(/^1 thing needs attention/);
    await expect(tabButton(page, 'Attention')).toHaveAccessibleName('Attention, 1 item');
  });

  test('a repeating item moves its date instead of disappearing', async ({ page }) => {
    // Monthly, due Thu 5 Nov.
    await openArea(page, 'Kitchen');
    await ring(page, 'Kitchen paper').click();
    await expect(toast(page, 'Done. Next one in 8 weeks')).toBeVisible();
    await expect(ring(page, 'Kitchen paper')).toBeVisible();
    await expect(meta(page, 'Kitchen paper')).toHaveText('Not urgent·In 8 weeks');
    // Re-sorted: Olive oil (12 Nov) is now first.
    expect(await titlesIn(page, 'Kitchen')).toEqual(['Olive oil', 'Kitchen paper']);

    await toast(page, 'Done. Next one in 8 weeks').getByRole('button', { name: 'Undo' }).click();
    await expect(meta(page, 'Kitchen paper')).toHaveText('Not urgent·In 4 weeks');
    expect(await titlesIn(page, 'Kitchen')).toEqual(['Kitchen paper', 'Olive oil']);
  });

  test('a repeating item that is long overdue steps forward from today', async ({ page }) => {
    // Monthly; make it due 1 Sep. One month on (1 Oct) is still past, so: today + 1 month.
    await openArea(page, 'Jacuzzi');
    const sheet = await openItem(page, 'Change the filter');
    await sheet.getByLabel('Due', { exact: true }).fill('2026-09-01');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(meta(page, 'Change the filter')).toHaveText('Not urgent·37 days late');

    await ring(page, 'Change the filter').click();
    await expect(toast(page, 'Done. Next one in 4 weeks')).toBeVisible();
    await expect(meta(page, 'Change the filter')).toHaveText('Not urgent·In 4 weeks');
  });

  test('a repeating item without a due date gets one, an interval from today', async ({ page }) => {
    // Quarterly.
    await openArea(page, 'Front garden');
    const sheet = await openItem(page, 'Trim the hedges');
    await sheet.getByLabel('Due', { exact: true }).fill('');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(meta(page, 'Trim the hedges')).toHaveText('Not urgent');
    await ring(page, 'Trim the hedges').click();
    // Next year's dates carry the year.
    await expect(toast(page, 'Done. Next one in 3 months')).toBeVisible();
    await expect(meta(page, 'Trim the hedges')).toHaveText('Not urgent·In 3 months');
  });

  test('a quick double tap on a repeating ring completes it once', async ({ page }) => {
    await openArea(page, 'Jacuzzi');
    await ring(page, 'Change the filter').dblclick();
    await expect(meta(page, 'Change the filter')).toHaveText('Not urgent·In 6 weeks');
    // Give a second completion time to land, then check it did not.
    await page.waitForTimeout(1_000);
    await expect(meta(page, 'Change the filter')).toHaveText('Not urgent·In 6 weeks');
  });

  test('tapping a row (not the ring) opens the Item sheet, over the area’s', async ({ page }) => {
    const hallway = await openArea(page, 'Hallway');
    const sheet = await openItem(page, 'Heaters not working');
    // The area's sheet steps back under it.
    await expect(hallway).toHaveAttribute('data-behind', 'true');
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

test.describe('Needs attention', () => {
  test.beforeEach(async ({ page }) => {
    await openAttention(page);
  });

  test('the second tab: one sentence, then what needs attention, today, the next 7 days and later', async ({ page }) => {
    await expect(tabs(page).getByRole('button').nth(1)).toHaveAttribute('aria-current', 'page');
    await expect(attentionScreen(page).getByRole('heading', { level: 1 })).toHaveText('Needs attention');
    await expect(views(page).getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
    await expect(summary(page)).toHaveText('2 things need attention and 1 is due today. Everything else can wait.');
    const titles = (id: 'attention' | 'today' | 'week' | 'later') =>
      group(page, id)
        .locator('[data-item-open]')
        .evaluateAll((els) => els.map((el) => el.textContent!.split(',')[0].trim()));
    await expect(group(page, 'attention').getByRole('heading', { level: 2 })).toHaveText('Needs attention');
    expect(await titles('attention')).toEqual(['Heaters not working', 'Clear the gutters']);
    expect(await titles('today')).toEqual(['Empty the dehumidifier']);
    // In date order: in 2 days, in 4, in 6 (most urgent first on one day), in 7.
    expect(await titles('week')).toEqual([
      'Water the plants',
      'Water test strips running low',
      'Shower draining slowly',
      'Cover the garden furniture',
      'Put the bins out',
      'Give away the old firepit',
    ]);
    // Later: three, then the rest behind "Show 6 more".
    expect(await titles('later')).toHaveLength(3);
    const more = group(page, 'later').getByRole('button', { name: 'Show 6 more' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    expect(await titles('later')).toHaveLength(9);
    // Each row says its room, as the list mixes rooms.
    await expect(group(page, 'attention').locator('[data-room]').first()).toHaveText('Hallway');
    // The firepit is looked after and in good shape: at the foot, out of the way.
    await expect(group(page, 'looking').getByRole('button', { name: /^Firepit ?, to maintain, Good, Garden, Ela/ })).toBeVisible();
  });

  test('the late and urgent jobs are on the first screen', async ({ page }) => {
    await expect(summary(page)).toBeInViewport();
    for (const title of ['Heaters not working', 'Clear the gutters']) {
      await expect(group(page, 'attention').getByRole('button', { name: `Mark ${title} as done` })).toBeInViewport({ ratio: 1 });
    }
  });

  test('a ticked row leaves the list and the sentence follows', async ({ page }) => {
    await group(page, 'today').getByRole('button', { name: 'Mark Empty the dehumidifier as done' }).click();
    await expect(group(page, 'today')).toHaveCount(0);
    await expect(summary(page)).toHaveText('2 things need attention. Everything else can wait.');
    // Weekly: it comes round again in a week.
    await expect(group(page, 'week').locator('[data-item-open]').filter({ hasText: 'Empty the dehumidifier' })).toHaveCount(1);
  });

  test('Mine shows only your items in one tap, and the sentence says whose they are', async ({ page }) => {
    await mine(page).click();
    await expect(mine(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(summary(page)).toHaveText('For you, nothing urgent today. Next up: Put the bins out, in 6 days.');
    await expect(attentionScreen(page).locator('[data-who]')).toHaveCount(0);
    await mine(page).click();
    await expect(summary(page)).toHaveText('2 things need attention and 1 is due today. Everything else can wait.');
  });

  test('the view switch takes taps 44px tall, not just on its 28px pill', async ({ page }) => {
    for (const name of ['Calendar', 'List'] as const) {
      const radio = views(page).getByRole('radio', { name, exact: true });
      const box = (await radio.boundingBox())!;
      // 3px above and below the pill still count.
      for (const y of [box.y - 3, box.y + box.height + 3]) {
        await page.mouse.click(box.x + box.width / 2, y);
        await expect(radio).toHaveAttribute('aria-checked', 'true');
      }
    }
  });

  test('Looking after says how the things looked after are', async ({ page }) => {
    await expect(group(page, 'looking').getByText('All in good shape.', { exact: true })).toBeVisible();
  });
});

for (const width of [375, 402, 430]) {
  test.describe(`Needs attention at ${width}px`, () => {
    test.use({ viewport: { width, height: 874 } });

    test('a room’s name is never cut short: it takes the next line whole when it does not fit', async ({ page }) => {
      await openAttention(page);
      await group(page, 'later').getByRole('button', { name: /^Show \d+ more$/ }).click();
      const names = attentionScreen(page).locator('[data-room] > span:last-child');
      expect(await names.count()).toBeGreaterThan(15);
      const cut = await names.evaluateAll((els) =>
        els.filter((el) => el.scrollWidth > el.clientWidth + 0.5).map((el) => el.textContent),
      );
      expect(cut).toEqual([]);
    });
  });
}

test.describe('In dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('the Undo toast stands off the dark cards', async ({ page }) => {
    await openArea(page, 'Living Room');
    await ring(page, 'Mirror lights not level').click();
    const done = page.locator('[role="status"] > div').filter({ hasText: 'Marked as done' });
    await expect(done).toBeVisible();
    await expect(done).toHaveCSS('background-color', 'rgba(58, 58, 60, 0.96)');
    await expect(area(page, 'Living Room').locator('[data-area-tasks] > div')).toHaveCSS('background-color', 'rgb(28, 28, 30)');
  });
});

test.describe('Without areas', () => {
  test('Home says where to add one, and the new-item sheet says why it can’t save', async ({ page }) => {
    // Another member deleted the last areas at the same time (one person can't: see profile.spec.ts).
    await keepOnlyAreas(page, []);
    const home = homeScreen(page);
    await expect(home.getByText('No areas yet')).toBeVisible();
    await expect(home.getByText(/Add one in Profile, under Household\.$/)).toBeVisible();
    await expect(areaCards(page)).toHaveCount(0);

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
  test('a ring tap fires 14 hedgehogs and ducks from the ring, gone after ~3s', async ({ page }) => {
    await openArea(page, 'Kitchen');
    const particles = page.locator('[data-confetti] img');
    await ring(page, 'Olive oil').click();
    await expect(particles).toHaveCount(14);
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
    await openArea(page, 'Kitchen');
    const sheet = await openItem(page, 'Olive oil');
    await sheet.getByRole('button', { name: 'Mark as Done' }).click();
    await expect(page.locator('[data-confetti] img')).toHaveCount(14);
  });

  test.describe('with Reduce Motion', () => {
    test.use({ contextOptions: { reducedMotion: 'reduce' } });

    test('the hero stands still and the burst is small', async ({ page }) => {
      await expect(hero(page)).toBeVisible();
      expect(await running(page)).toBe(0);
      await openArea(page, 'Kitchen');
      await ring(page, 'Olive oil').click();
      await expect(page.locator('[data-confetti] img')).toHaveCount(6);
      await closeArea(page);

      await page.clock.setSystemTime(new Date('2026-10-08T22:00:00+01:00'));
      await page.reload();
      await expect(hero(page)).toHaveAttribute('data-phase', 'night');
      expect(await running(page)).toBe(0);
    });
  });

  test('the hero moves without Reduce Motion', async ({ page }) => {
    await expect(hero(page)).toBeVisible();
    await expect.poll(() => running(page)).toBeGreaterThan(0);
  });
});

test.describe('Hero', () => {
  test('runs from the very top of the screen, with the title, address and avatar on it', async ({ page }) => {
    const box = (await hero(page).boundingBox())!;
    expect(box.y).toBe(0);
    expect(box.width).toBe(402);
    for (const el of [
      homeScreen(page).getByRole('heading', { name: 'Home', level: 1 }),
      homeScreen(page).getByText('21 Alderbrook Road'),
      homeScreen(page).getByRole('button', { name: 'Profile' }),
    ]) {
      const b = (await el.boundingBox())!;
      expect(b.y + b.height).toBeLessThan(box.y + box.height);
    }
  });

  test('the drawing is decorative; a hidden sentence describes it', async ({ page }) => {
    await expect(hero(page).locator('[aria-hidden="true"]').first()).toBeAttached();
    await expect(hero(page)).toContainText(/duck/);
    await expect(hero(page)).toContainText(/hedgehog/);
  });

  test('follows the sun in London through the day (8 October)', async ({ page }) => {
    const sky = hero(page);
    // 10:00 (the fixtures' NOW): daytime.
    await expect(sky).toHaveAttribute('data-phase', 'day');
    const expected: [string, string][] = [
      ['03:00', 'night'],
      ['07:30', 'sunrise'],
      ['12:00', 'day'],
      ['18:05', 'sunset'],
      ['18:45', 'dusk'],
    ];
    // Recomputed every minute: move the clock, let a minute pass.
    for (const [time, phase] of expected) {
      await page.clock.setSystemTime(new Date(`2026-10-08T${time}:00+01:00`));
      await page.clock.runFor(61_000);
      await expect(sky, time).toHaveAttribute('data-phase', phase);
    }
    // And right away when the app is opened at that time.
    for (const [time, phase] of expected) {
      await page.clock.setSystemTime(new Date(`2026-10-08T${time}:00+01:00`));
      await page.reload();
      await expect(sky, `${time} after reload`).toHaveAttribute('data-phase', phase);
    }
  });

  test('a strip of sky sits behind the status bar once the hero has scrolled away', async ({ page }) => {
    // As on an iPhone: a 54px status bar.
    await page.evaluate(() => document.documentElement.style.setProperty('--top-inset', '54px'));
    const strip = page.locator('[data-status-sky]');
    await expect(strip).toHaveCSS('height', '54px');
    await expect(strip).toHaveCSS('opacity', '0');
    await homeScreen(page).evaluate((el) => {
      (el.firstElementChild as HTMLElement).scrollTop = 900;
    });
    await expect(strip).toHaveCSS('opacity', '1');
    // The tab bar stays where it floats, over the foot of the screen.
    await expect.poll(async () => Math.round((await tabs(page).boundingBox())!.y)).toBe(874 - 22 - 62);
    await homeScreen(page).evaluate((el) => {
      (el.firstElementChild as HTMLElement).scrollTop = 0;
    });
    await expect(strip).toHaveCSS('opacity', '0');
    // The other tabs' slim band of sky is under the status bar at the top too.
    await openAttention(page);
    await expect(attentionScreen(page).locator('[data-sky-band]')).toBeVisible();
    await expect(strip).toHaveCSS('opacity', '0');
    await attentionScreen(page).evaluate((el) => {
      (el.firstElementChild as HTMLElement).scrollTop = 600;
    });
    await expect(strip).toHaveCSS('opacity', '1');
  });

  test('the Welcome screen shows the same sky', async ({ page }) => {
    await page.clock.setSystemTime(new Date('2026-10-08T18:05:00+01:00'));
    await openFresh(page);
    await expect(hero(page)).toHaveAttribute('data-phase', 'sunset');
    expect((await hero(page).boundingBox())!.y).toBe(0);
  });
});

test.describe('Long text', () => {
  test('a long title wraps to two lines at most; a long note never shows on its row', async ({ page }) => {
    const long = 'Olive oil, and the big tin of tomatoes, and the rice, and the lentils for the soup next week';
    await openArea(page, 'Kitchen');
    const sheet = await openItem(page, 'Olive oil');
    await sheet.getByLabel('Title', { exact: true }).fill(long);
    await sheet.getByLabel('Note', { exact: true }).fill('Restocked, 5L tin is in the pantry. '.repeat(8).trim());
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    const button = rowButton(page, long);
    await expect(button).not.toContainText('Restocked, 5L tin');
    const title = button.locator(':scope > span > span').first();
    // Two lines of 22px at most, cut with an ellipsis.
    expect((await title.boundingBox())!.height).toBeLessThanOrEqual(44);
    await expect(title).toHaveCSS('-webkit-line-clamp', '2');
    // The row: two title lines and the quiet line.
    expect((await button.boundingBox())!.height).toBeLessThan(96);
  });
});
