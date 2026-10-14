import {
  area,
  areas,
  confirmation,
  DEMO_STORAGE_KEY,
  detailValue,
  expect,
  homeScreen,
  itemSheet,
  openRoomMenu,
  openSeeded,
  reopen,
  roomMenu,
  ring,
  rowButton,
  settled,
  test,
  titlesIn,
  type Locator,
  type Page,
  addButton,
} from './fixtures';

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
});

/** The room's name: a disclosure button that folds or opens the room's card. */
function disclosure(page: Page, name: string) {
  return area(page, name).getByRole('button', { name, exact: true });
}

/** The chevron after a room's name (the last glyph in its button; the room's drawing comes first). */
function chevron(page: Page, name: string) {
  return disclosure(page, name).locator('svg').last();
}

/** The rooms with something open (a room with nothing open has nothing to fold). */
async function roomsWithItems(page: Page): Promise<string[]> {
  const doc = await stored(page);
  return doc.areas.filter((a) => doc.items.some((it) => it.area_id === a.id && it.status === 'open')).map((a) => a.name);
}

interface StoredDoc {
  areas: { id: string; name: string; household_id: string }[];
  items: { area_id: string; rag: 'red' | 'amber' | 'green'; status: string }[];
}

async function stored(page: Page): Promise<StoredDoc> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), DEMO_STORAGE_KEY);
}

test.describe('Collapsible rooms', () => {
  test('tapping a room’s name folds and opens just that room', async ({ page }) => {
    const kitchen = disclosure(page, 'Kitchen');
    await expect(kitchen).toHaveAttribute('aria-expanded', 'true');
    const panelId = await kitchen.getAttribute('aria-controls');
    const panel = page.locator(`[id="${panelId}"]`);
    await expect(panel.getByRole('button', { name: 'Mark Kitchen paper as done' })).toBeVisible();

    await kitchen.click();
    await expect(kitchen).toHaveAttribute('aria-expanded', 'false');
    await expect(ring(page, 'Kitchen paper')).toBeHidden();
    await expect(ring(page, 'Olive oil')).toBeHidden();
    // The rows shrink away (animated), leaving the header: one line, with how many are open.
    await expect.poll(async () => (await panel.boundingBox())?.height ?? 0).toBe(0);
    await expect(area(page, 'Kitchen').getByRole('heading', { level: 2, name: 'Kitchen' })).toBeVisible();
    await expect(area(page, 'Kitchen').getByText('2 open', { exact: true })).toBeVisible();
    // The chevron turns from down to pointing at the name.
    await expect(chevron(page, 'Kitchen')).toHaveCSS('transform', 'none');
    // Other rooms stay open.
    await expect(ring(page, 'Mirror lights not level')).toBeVisible();

    await kitchen.click();
    await expect(kitchen).toHaveAttribute('aria-expanded', 'true');
    await expect(ring(page, 'Kitchen paper')).toBeVisible();
    expect(await titlesIn(page, 'Kitchen')).toEqual(['Kitchen paper', 'Olive oil']);
    await expect(chevron(page, 'Kitchen')).not.toHaveCSS('transform', 'none');
  });

  test('works from the keyboard', async ({ page }) => {
    const garden = disclosure(page, 'Garden');
    await garden.focus();
    await page.keyboard.press('Enter');
    await expect(garden).toHaveAttribute('aria-expanded', 'false');
    // Folded rows are out of the tab order: next is the room's menu, then the next room.
    await page.keyboard.press('Tab');
    await expect(area(page, 'Garden').getByRole('button', { name: 'Garden options' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(disclosure(page, 'Garden Lounge')).toBeFocused();
    await garden.focus();
    await page.keyboard.press('Space');
    await expect(garden).toHaveAttribute('aria-expanded', 'true');
  });

  test('Collapse All Rooms and Expand All Rooms, in any room’s menu: an overview, one line a room', async ({ page }) => {
    const names = await roomsWithItems(page);
    await roomMenu(page, 'Kitchen', 'Collapse All Rooms');
    for (const name of names) await expect(disclosure(page, name)).toHaveAttribute('aria-expanded', 'false');
    // Every room's rows (the calendar is a view of its own).
    await expect(areas(page).getByRole('button', { name: /^Mark .* as done$/ })).toHaveCount(0);
    // Each room one line: its name and how many are open, or what is late.
    await expect(area(page, 'Garden').getByText('3 open', { exact: true })).toBeVisible();
    await expect(area(page, 'Hallway').getByText('1 late', { exact: true })).toBeVisible();
    await expect(area(page, 'Bedroom Small').getByText('All clear', { exact: true })).toBeVisible();
    for (const name of ['Kitchen', 'Garden', 'Bedroom Small']) {
      const card = area(page, name).locator(':scope > div');
      expect((await card.boundingBox())!.height, name).toBeLessThanOrEqual(58);
    }

    await roomMenu(page, 'Garden', 'Expand All Rooms');
    for (const name of names) await expect(disclosure(page, name)).toHaveAttribute('aria-expanded', 'true');
    await expect(ring(page, 'Heaters not working')).toBeVisible();

    // With one room still open, the menu offers Collapse All Rooms.
    await roomMenu(page, 'Garden', 'Collapse All Rooms');
    await disclosure(page, 'Hallway').click();
    const menu = await openRoomMenu(page, 'Kitchen');
    await expect(menu.getByRole('menuitem', { name: 'Collapse All Rooms' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(ring(page, 'Heaters not working')).toBeVisible();
  });

  test('folded rooms are remembered on this device', async ({ page }) => {
    await disclosure(page, 'Kitchen').click();
    await disclosure(page, 'Garden').click();
    const doc = await stored(page);
    const hid = doc.areas[0].household_id;
    const ids = ['Kitchen', 'Garden'].map((n) => doc.areas.find((a) => a.name === n)!.id);
    const saved = await page.evaluate((key) => localStorage.getItem(key), `homeos.collapsed.${hid}`);
    expect(JSON.parse(saved!).sort()).toEqual(ids.sort());

    await reopen(page);
    await expect(disclosure(page, 'Kitchen')).toHaveAttribute('aria-expanded', 'false');
    await expect(disclosure(page, 'Garden')).toHaveAttribute('aria-expanded', 'false');
    await expect(disclosure(page, 'Living Room')).toHaveAttribute('aria-expanded', 'true');
    await expect(ring(page, 'Kitchen paper')).toBeHidden();

    await disclosure(page, 'Kitchen').click();
    await page.reload();
    await expect(disclosure(page, 'Kitchen')).toHaveAttribute('aria-expanded', 'true');
    await expect(disclosure(page, 'Garden')).toHaveAttribute('aria-expanded', 'false');
  });

  test('each room is one card: its drawing, its name, and its rows lined up under the name', async ({ page }) => {
    const card = area(page, 'Living Room').locator(':scope > div');
    const box = (await card.boundingBox())!;
    expect(box.x).toBe(16);
    expect(box.width).toBe(402 - 32);
    await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    const header = area(page, 'Living Room').getByRole('heading', { level: 2 });
    await expect(header).toHaveCSS('font-size', '17px');
    await expect(header).toHaveCSS('font-weight', '600');
    // The drawing: a 32px rounded square in grey, in the card.
    const icon = disclosure(page, 'Living Room').locator('span[aria-hidden="true"]').first();
    const iconBox = (await icon.boundingBox())!;
    expect(iconBox.width).toBe(32);
    expect(iconBox.x).toBe(box.x + 12);
    // The name starts where the rows' titles do (within a few points).
    const name = (await disclosure(page, 'Living Room').locator(':scope > span').last().boundingBox())!;
    const title = (await rowButton(page, 'Mirror lights not level').locator(':scope > span > span').first().boundingBox())!;
    expect(Math.abs(name.x - title.x)).toBeLessThanOrEqual(4);
    // The "..." has a 44px target, its glyph lined up with the rows' right edge.
    const menu = (await area(page, 'Living Room').getByRole('button', { name: 'Living Room options' }).boundingBox())!;
    expect(menu.width).toBe(44);
    expect(menu.height).toBe(44);
    expect(Math.round(box.x + box.width - (menu.x + menu.width))).toBe(4);
  });

  test('a busy room shows three jobs, then "Show 2 more"', async ({ page }) => {
    await page.evaluate((key) => {
      const doc = JSON.parse(localStorage.getItem(key)!);
      const kitchen = doc.areas.find((a: { name: string }) => a.name === 'Kitchen');
      const model = doc.items.find((i: { area_id: string }) => i.area_id === kitchen.id);
      for (const n of [1, 2, 3]) {
        doc.items.push({ ...model, id: `00000000-0000-4000-8000-00000000000${n}`, title: `Kitchen job ${n}`, due_date: null, repeat: 'none' });
      }
      localStorage.setItem(key, JSON.stringify(doc));
    }, DEMO_STORAGE_KEY);
    await reopen(page);
    const more = area(page, 'Kitchen').getByRole('button', { name: 'Show 2 more' });
    await expect(more).toBeVisible();
    expect(await titlesIn(page, 'Kitchen')).toEqual(['Kitchen paper', 'Olive oil', 'Kitchen job 1']);
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    expect(await titlesIn(page, 'Kitchen')).toEqual(['Kitchen paper', 'Olive oil', 'Kitchen job 1', 'Kitchen job 2', 'Kitchen job 3']);
    await area(page, 'Kitchen').getByRole('button', { name: 'Show fewer' }).click();
    expect(await titlesIn(page, 'Kitchen')).toHaveLength(3);
  });
});

test.describe('Room status', () => {
  test('one quiet word: late or urgent in red, nothing while all is calm, All clear when empty', async ({ page }) => {
    const status = (name: string) => area(page, name).locator('h2 + span');
    await expect(status('Hallway')).toHaveText('1 late');
    await expect(status('Front garden')).toHaveText('1 urgent');
    await expect(status('Bedroom Small')).toHaveText('All clear');
    for (const name of ['Kitchen', 'Living Room', 'Garden', 'Jacuzzi']) await expect(status(name), name).toHaveCount(0);
    // Red and bold, with the room's drawing tinted red too.
    await expect(status('Hallway')).toHaveCSS('color', 'rgb(215, 0, 21)');
    await expect(status('Hallway')).toHaveCSS('font-weight', '600');
    await expect(disclosure(page, 'Hallway').locator('[data-alert]')).toHaveCSS('background-color', 'rgba(255, 59, 48, 0.12)');
    await expect(status('Bedroom Small')).toHaveCSS('color', 'rgb(110, 110, 115)');
    // The word is part of what VoiceOver hears for the name.
    await expect(disclosure(page, 'Hallway')).toHaveAccessibleDescription('1 late');
  });

  test('follows the items: completing and adding', async ({ page }) => {
    await ring(page, 'Shower draining slowly').click();
    await expect(ring(page, 'Shower draining slowly')).toHaveCount(0);
    // Its only item: All clear.
    await expect(area(page, 'Bathroom Large').getByText('All clear', { exact: true })).toBeVisible();

    // Add an urgent item to the (folded) Hallway from its menu.
    await disclosure(page, 'Hallway').click();
    await roomMenu(page, 'Hallway', 'Add item to Hallway');
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await sheet.getByLabel('Title', { exact: true }).fill('Fix the coat hook');
    await sheet.getByRole('radiogroup', { name: 'How urgent?' }).getByText('Urgent', { exact: true }).click();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(area(page, 'Hallway').locator('h2 + span')).toHaveText('1 late, 1 urgent');
    // Hallway opened so the new item can be seen.
    await expect(disclosure(page, 'Hallway')).toHaveAttribute('aria-expanded', 'true');
    await expect(ring(page, 'Fix the coat hook')).toBeVisible();
  });
});

test.describe('Add to a room', () => {
  test('Add Item in a room’s menu opens the new-item sheet with that room', async ({ page }) => {
    await roomMenu(page, 'Garden', 'Add item to Garden');
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await expect(detailValue(sheet, 'Area')).toHaveText('Garden');
    await sheet.getByLabel('Title', { exact: true }).fill('Fix the gate latch');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(ring(page, 'Fix the gate latch')).toBeVisible();
    expect(await titlesIn(page, 'Garden')).toContain('Fix the gate latch');

    // Another room, folded: still that room.
    await disclosure(page, 'Jacuzzi').click();
    await roomMenu(page, 'Jacuzzi', 'Add item to Jacuzzi');
    const again = itemSheet(page, 'New item');
    await settled(again.getByRole('button', { name: 'Close' }));
    await expect(detailValue(again, 'Area')).toHaveText('Jacuzzi');
  });

  test('saving into a folded room opens it; closing without saving leaves it folded', async ({ page }) => {
    // Cancelled: still folded.
    await disclosure(page, 'Garden Lounge').click();
    await roomMenu(page, 'Garden Lounge', 'Add item to Garden Lounge');
    let sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(disclosure(page, 'Garden Lounge')).toHaveAttribute('aria-expanded', 'false');

    // Saved: opened, with the new item showing.
    await roomMenu(page, 'Garden Lounge', 'Add item to Garden Lounge');
    sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await sheet.getByLabel('Title', { exact: true }).fill('Oil the bench');
    await sheet.getByRole('radiogroup', { name: 'How urgent?' }).getByText('Urgent', { exact: true }).click();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(disclosure(page, 'Garden Lounge')).toHaveAttribute('aria-expanded', 'true');
    await expect(ring(page, 'Oil the bench')).toBeVisible();

    // The round + too (it starts on the first room, Kitchen).
    await disclosure(page, 'Kitchen').click();
    await addButton(page).click();
    sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await expect(detailValue(sheet, 'Area')).toHaveText('Kitchen');
    await sheet.getByLabel('Title', { exact: true }).fill('Descale the kettle');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(disclosure(page, 'Kitchen')).toHaveAttribute('aria-expanded', 'true');
    await expect(ring(page, 'Descale the kettle')).toBeVisible();
    // Other folded rooms stay as they were.
    await disclosure(page, 'Jacuzzi').click();
    await expect(disclosure(page, 'Jacuzzi')).toHaveAttribute('aria-expanded', 'false');
  });

  test('moving an item into a folded room opens that room', async ({ page }) => {
    await disclosure(page, 'Garden').click();
    await rowButton(page, 'Wardrobe door hinge').click();
    const sheet = itemSheet(page);
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await sheet.getByLabel('Area', { exact: true }).selectOption({ label: 'Garden' });
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(disclosure(page, 'Garden')).toHaveAttribute('aria-expanded', 'true');
    expect(await titlesIn(page, 'Garden')).toContain('Wardrobe door hinge');
  });
});

/** Focuses a control as the keyboard would (so it matches :focus-visible). */
async function keyboardFocus(control: Locator): Promise<void> {
  // A key press first, so focus is shown even after a tap (Home's view switch, say).
  await control.page().keyboard.press('Shift');
  await control.focus();
  await expect.poll(() => control.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
}

/** Presses a button from the keyboard (later focus() calls then count as keyboard focus). */
async function pressKey(control: Locator): Promise<void> {
  await control.focus();
  await control.press('Enter');
}

test.describe('Keyboard focus and folded rooms', () => {
  test('completing from the keyboard skips rows in a folded room', async ({ page }) => {
    await pressKey(disclosure(page, 'Bathroom Small'));
    await keyboardFocus(ring(page, 'Mirror lights not level'));
    await page.keyboard.press('Enter');
    await expect(ring(page, 'Mirror lights not level')).toHaveCount(0);
    // Not "Re-seal around the shower" (Bathroom Small is folded): the next row that can be seen.
    await expect(rowButton(page, 'Shower draining slowly')).toBeFocused();
  });

  test('with no other row to go to, focus goes to the room’s name', async ({ page }) => {
    // Collapse All Rooms from the keyboard: the menu opens on its first item.
    await pressKey(homeScreen(page).getByRole('button', { name: 'Kitchen options' }));
    const menu = page.getByRole('menu', { name: 'Kitchen' });
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitem', { name: 'Collapse All Rooms' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(homeScreen(page).getByRole('button', { name: 'Kitchen options' })).toBeFocused();
    await pressKey(disclosure(page, 'Living Room'));
    await keyboardFocus(ring(page, 'Mirror lights not level'));
    await page.keyboard.press('Enter');
    await expect(ring(page, 'Mirror lights not level')).toHaveCount(0);
    // The room has nothing open now: its name is a heading, and focus is on it.
    await expect(area(page, 'Living Room').getByRole('heading', { level: 2 })).toBeFocused();
  });

  test('after deleting from the keyboard, focus skips rows in folded rooms', async ({ page }) => {
    await pressKey(disclosure(page, 'Hallway'));
    await pressKey(disclosure(page, 'Front garden'));
    await keyboardFocus(rowButton(page, 'Change the filter'));
    await page.keyboard.press('Enter');
    const sheet = itemSheet(page);
    await expect(sheet).toBeFocused();
    await keyboardFocus(sheet.getByRole('button', { name: 'Delete' }));
    await page.keyboard.press('Enter');
    const confirm = await confirmation(page, 'Delete this item?');
    await confirm.getByRole('button', { name: 'Delete Item' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(ring(page, 'Change the filter')).toHaveCount(0);
    // The row above it in the Jacuzzi, not the hidden ones below.
    await expect(rowButton(page, 'Water test strips running low')).toBeFocused();
  });
});

test.describe('Room headers at 375 wide', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('the chevron stays on the line with the end of the name', async ({ page }) => {
    // Bathroom Large with 10 urgent, 2 within the month and 11 not urgent.
    await page.evaluate((key) => {
      const doc = JSON.parse(localStorage.getItem(key)!);
      const target = doc.areas.find((a: { name: string }) => a.name === 'Bathroom Large');
      const model = doc.items.find((i: { area_id: string }) => i.area_id === target.id);
      const rags = [...Array(10).fill('red'), ...Array(2).fill('amber'), ...Array(11).fill('green')];
      rags.forEach((rag, n) =>
        doc.items.push({ ...model, id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, title: `Extra ${n}`, rag }),
      );
      localStorage.setItem(key, JSON.stringify(doc));
    }, DEMO_STORAGE_KEY);
    await reopen(page);
    await expect(area(page, 'Bathroom Large').locator('h2 + span')).toHaveText('10 urgent');
    for (const name of ['Bathroom Large', 'Kitchen', 'Front garden']) {
      const button = disclosure(page, name);
      const { lastLine, icon } = await button.evaluate((el) => {
        const svgs = el.querySelectorAll('svg');
        const svg = svgs[svgs.length - 1];
        const text = svg.previousSibling!;
        const range = document.createRange();
        range.selectNodeContents(text);
        const rects = range.getClientRects();
        const last = rects[rects.length - 1];
        const box = svg.getBoundingClientRect();
        return { lastLine: { top: last.top, bottom: last.bottom }, icon: { top: box.top, bottom: box.bottom } };
      });
      // The chevron sits inside the line box of the name's last letter.
      expect(icon.top, name).toBeGreaterThanOrEqual(lastLine.top - 1);
      expect(icon.bottom, name).toBeLessThanOrEqual(lastLine.bottom + 1);
    }
    // And the name is still read as one word.
    await expect(area(page, 'Bathroom Large').getByRole('heading', { level: 2 })).toHaveAccessibleName('Bathroom Large');
  });
});
