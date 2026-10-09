import {
  area,
  confirmation,
  DEMO_STORAGE_KEY,
  detailValue,
  expect,
  homeScreen,
  itemSheet,
  openSeeded,
  reopen,
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

/** The area name: a disclosure button that collapses or expands the area's card. */
function disclosure(page: Page, name: string) {
  return area(page, name).getByRole('button', { name, exact: true });
}

function toggleAll(page: Page, label: 'Collapse All' | 'Expand All') {
  return homeScreen(page).getByRole('button', { name: label, exact: true });
}

interface StoredDoc {
  areas: { id: string; name: string; household_id: string }[];
  items: { area_id: string; rag: 'red' | 'amber' | 'green'; status: string }[];
}

async function stored(page: Page): Promise<StoredDoc> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), DEMO_STORAGE_KEY);
}

/** "1 urgent, 2 at risk, 3 on track" for the open items stored in an area ('' when none). */
function expectedLabel(doc: StoredDoc, areaName: string): string {
  const areaId = doc.areas.find((a) => a.name === areaName)!.id;
  const open = doc.items.filter((it) => it.area_id === areaId && it.status === 'open');
  const words = { red: 'urgent', amber: 'at risk', green: 'on track' } as const;
  return (['red', 'amber', 'green'] as const)
    .map((rag) => [open.filter((it) => it.rag === rag).length, words[rag]] as const)
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`)
    .join(', ');
}

test.describe('Collapsible areas', () => {
  test('tapping an area name collapses and expands just that area', async ({ page }) => {
    const kitchen = disclosure(page, 'Kitchen');
    await expect(kitchen).toHaveAttribute('aria-expanded', 'true');
    const panelId = await kitchen.getAttribute('aria-controls');
    const panel = page.locator(`[id="${panelId}"]`);
    await expect(panel.getByRole('button', { name: 'Mark Kitchen paper as done' })).toBeVisible();

    await kitchen.click();
    await expect(kitchen).toHaveAttribute('aria-expanded', 'false');
    await expect(ring(page, 'Kitchen paper')).toBeHidden();
    await expect(ring(page, 'Olive oil')).toBeHidden();
    // The card shrinks away (animated), leaving the header.
    await expect.poll(async () => (await panel.boundingBox())?.height ?? 0).toBe(0);
    await expect(area(page, 'Kitchen').getByRole('heading', { level: 2, name: 'Kitchen' })).toBeVisible();
    // The chevron turns from down to right.
    await expect(kitchen.locator('svg')).toHaveCSS('transform', 'none');
    // Other areas stay open.
    await expect(ring(page, 'Mirror lights not level')).toBeVisible();

    await kitchen.click();
    await expect(kitchen).toHaveAttribute('aria-expanded', 'true');
    await expect(ring(page, 'Kitchen paper')).toBeVisible();
    expect(await titlesIn(page, 'Kitchen')).toEqual(['Kitchen paper', 'Olive oil']);
    await expect(kitchen.locator('svg')).not.toHaveCSS('transform', 'none');
  });

  test('works from the keyboard', async ({ page }) => {
    const garden = disclosure(page, 'Garden');
    await garden.focus();
    await page.keyboard.press('Enter');
    await expect(garden).toHaveAttribute('aria-expanded', 'false');
    // Collapsed rows are out of the tab order.
    await page.keyboard.press('Tab');
    await expect(area(page, 'Garden').getByRole('button', { name: 'Add item to Garden' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(disclosure(page, 'Garden Lounge')).toBeFocused();
    await garden.focus();
    await page.keyboard.press('Space');
    await expect(garden).toHaveAttribute('aria-expanded', 'true');
  });

  test('Collapse All and Expand All', async ({ page }) => {
    const names = (await stored(page)).areas.map((a) => a.name);
    await expect(toggleAll(page, 'Collapse All')).toBeVisible();
    await expect(toggleAll(page, 'Collapse All')).toHaveCSS('color', 'rgb(0, 122, 255)');
    await expect(toggleAll(page, 'Collapse All')).toHaveCSS('font-size', '15px');

    await toggleAll(page, 'Collapse All').click();
    for (const name of names) await expect(disclosure(page, name)).toHaveAttribute('aria-expanded', 'false');
    await expect(homeScreen(page).getByRole('button', { name: /^Mark .* as done$/ })).toHaveCount(0);
    await expect(toggleAll(page, 'Collapse All')).toHaveCount(0);

    await toggleAll(page, 'Expand All').click();
    for (const name of names) await expect(disclosure(page, name)).toHaveAttribute('aria-expanded', 'true');
    await expect(ring(page, 'Heaters not working')).toBeVisible();

    // With one area still open, the button offers Collapse All.
    await toggleAll(page, 'Collapse All').click();
    await disclosure(page, 'Hallway').click();
    await expect(toggleAll(page, 'Collapse All')).toBeVisible();
    await expect(ring(page, 'Heaters not working')).toBeVisible();
  });

  test('collapsed areas are remembered on this device', async ({ page }) => {
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

  test('looks like 3a when everything is expanded', async ({ page }) => {
    const header = area(page, 'Kitchen').getByRole('heading', { level: 2 });
    await expect(header).toHaveCSS('font-size', '20px');
    await expect(header).toHaveCSS('font-weight', '600');
    await expect(header).toHaveCSS('line-height', '25px');
    // Header text 20px from the left; the card 8px under the header, 16px from each side.
    const [h, card] = await Promise.all([
      header.boundingBox(),
      area(page, 'Living Room').getByRole('list').locator('xpath=..').boundingBox(),
    ]);
    expect(h!.x).toBe(20);
    expect(h!.height).toBe(25);
    expect(card!.x).toBe(16);
    expect(card!.width).toBe(402 - 32);
    const living = (await area(page, 'Living Room').getByRole('heading', { level: 2 }).boundingBox())!;
    expect(card!.y - (living.y + living.height)).toBe(8);
  });
});

test.describe('Status counts', () => {
  test('each area shows its red, amber and green counts, open or collapsed', async ({ page }) => {
    const doc = await stored(page);
    for (const { name } of doc.areas) {
      const label = expectedLabel(doc, name);
      const counts = area(page, name).getByRole('img');
      if (!label) {
        await expect(counts, name).toHaveCount(0);
        continue;
      }
      await expect(counts, name).toHaveAccessibleName(label);
      // One chip per non-zero status, red first: a dot and the number.
      const numbers = label.split(', ').map((part) => part.split(' ')[0]);
      await expect(counts.locator('[data-rag]'), name).toHaveText(numbers);
    }
    await expect(area(page, 'Hallway').getByRole('img')).toHaveAccessibleName('1 urgent');

    // Colours: the RAG ring colour for the dot, the accessible tone for the number.
    const hallway = area(page, 'Hallway').locator('[data-rag="red"]');
    await expect(hallway).toHaveCSS('color', 'rgb(215, 0, 21)');
    await expect(hallway).toHaveCSS('font-size', '13px');
    await expect(hallway).toHaveCSS('font-weight', '600');
    await expect(hallway.locator('span')).toHaveCSS('background-color', 'rgb(255, 59, 48)');
    await expect(area(page, 'Living Room').locator('[data-rag="amber"]')).toHaveCSS('color', 'rgb(201, 52, 0)');
    await expect(area(page, 'Kitchen').locator('[data-rag="green"]')).toHaveCSS('color', 'rgb(36, 138, 61)');

    // Still shown with everything collapsed.
    await toggleAll(page, 'Collapse All').click();
    for (const { name } of doc.areas) {
      const label = expectedLabel(doc, name);
      if (label) await expect(area(page, name).getByRole('img'), name).toHaveAccessibleName(label);
    }
  });

  test('counts follow the items: completing and adding', async ({ page }) => {
    await expect(area(page, 'Bathroom Large').getByRole('img')).toHaveAccessibleName(
      expectedLabel(await stored(page), 'Bathroom Large'),
    );
    await ring(page, 'Shower draining slowly').click();
    await expect(ring(page, 'Shower draining slowly')).toHaveCount(0);
    // Its only item: no counts left.
    expect(expectedLabel(await stored(page), 'Bathroom Large')).toBe('');
    await expect(area(page, 'Bathroom Large').getByRole('img')).toHaveCount(0);
    await ring(page, 'Kitchen paper').click();
    await expect(area(page, 'Kitchen').getByRole('img')).toHaveAccessibleName(expectedLabel(await stored(page), 'Kitchen'));

    // Add a red item to the (collapsed) Hallway from its +.
    await disclosure(page, 'Hallway').click();
    await area(page, 'Hallway').getByRole('button', { name: 'Add item to Hallway' }).click();
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await sheet.getByLabel('Title', { exact: true }).fill('Fix the coat hook');
    await sheet.getByRole('radiogroup', { name: 'Status' }).getByText('Red', { exact: true }).click();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(area(page, 'Hallway').getByRole('img')).toHaveAccessibleName('2 urgent');
    // Hallway opened so the new item can be seen.
    await expect(disclosure(page, 'Hallway')).toHaveAttribute('aria-expanded', 'true');
    await expect(ring(page, 'Fix the coat hook')).toBeVisible();
  });
});

test.describe('Add to an area', () => {
  test('the + on an area header opens the new-item sheet with that area', async ({ page }) => {
    const add = area(page, 'Garden').getByRole('button', { name: 'Add item to Garden' });
    // A small tinted circle with a 44 × 44 tap target.
    await expect(add).toHaveCSS('color', 'rgb(0, 122, 255)');
    await add.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const box = (await add.boundingBox())!;
    const hit = await page.evaluate(
      ({ x, y }) =>
        [
          [x - 21, y],
          [x + 21, y],
          [x, y - 21],
          [x, y + 21],
        ].map(([px, py]) => document.elementFromPoint(px, py)?.closest('button')?.getAttribute('aria-label')),
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    expect(hit).toEqual(Array(4).fill('Add item to Garden'));

    await add.click();
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await expect(detailValue(sheet, 'Area')).toHaveText('Garden');
    await sheet.getByLabel('Title', { exact: true }).fill('Fix the gate latch');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(ring(page, 'Fix the gate latch')).toBeVisible();
    expect(await titlesIn(page, 'Garden')).toContain('Fix the gate latch');

    // Another area, collapsed: still that area.
    await disclosure(page, 'Jacuzzi').click();
    await area(page, 'Jacuzzi').getByRole('button', { name: 'Add item to Jacuzzi' }).click();
    const again = itemSheet(page, 'New item');
    await settled(again.getByRole('button', { name: 'Close' }));
    await expect(detailValue(again, 'Area')).toHaveText('Jacuzzi');
  });

  test('saving into a collapsed area opens it; closing without saving leaves it collapsed', async ({ page }) => {
    // Cancelled: still collapsed.
    await disclosure(page, 'Garden Lounge').click();
    await area(page, 'Garden Lounge').getByRole('button', { name: 'Add item to Garden Lounge' }).click();
    let sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(disclosure(page, 'Garden Lounge')).toHaveAttribute('aria-expanded', 'false');

    // Saved: opened, with the new item showing.
    await area(page, 'Garden Lounge').getByRole('button', { name: 'Add item to Garden Lounge' }).click();
    sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await sheet.getByLabel('Title', { exact: true }).fill('Oil the bench');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(disclosure(page, 'Garden Lounge')).toHaveAttribute('aria-expanded', 'true');
    await expect(ring(page, 'Oil the bench')).toBeVisible();

    // The round + in the tab bar too (it starts on the first area, Kitchen).
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
    // Other collapsed areas stay as they were.
    await disclosure(page, 'Jacuzzi').click();
    await expect(disclosure(page, 'Jacuzzi')).toHaveAttribute('aria-expanded', 'false');
  });

  test('moving an item into a collapsed area opens that area', async ({ page }) => {
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
  await control.focus();
  await expect.poll(() => control.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
}

/** Presses a button from the keyboard (later focus() calls then count as keyboard focus). */
async function pressKey(control: Locator): Promise<void> {
  await control.focus();
  await control.press('Enter');
}

test.describe('Keyboard focus and collapsed areas', () => {
  test('completing from the keyboard skips rows in a collapsed area', async ({ page }) => {
    await pressKey(disclosure(page, 'Bathroom Small'));
    await keyboardFocus(ring(page, 'Mirror lights not level'));
    await page.keyboard.press('Enter');
    await expect(ring(page, 'Mirror lights not level')).toHaveCount(0);
    // Not "Re-seal around the shower" (Bathroom Small is collapsed): the next row that can be seen.
    await expect(rowButton(page, 'Shower draining slowly')).toBeFocused();
  });

  test('with no other row to go to, focus goes to the area’s name', async ({ page }) => {
    await pressKey(toggleAll(page, 'Collapse All'));
    await pressKey(disclosure(page, 'Living Room'));
    await keyboardFocus(ring(page, 'Mirror lights not level'));
    await page.keyboard.press('Enter');
    await expect(ring(page, 'Mirror lights not level')).toHaveCount(0);
    await expect(disclosure(page, 'Living Room')).toBeFocused();
  });

  test('after deleting from the keyboard, focus skips rows in collapsed areas', async ({ page }) => {
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

test.describe('Area headers at 375 wide', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('the chevron stays on the line with the end of the name', async ({ page }) => {
    // Bathroom Large with 10 red, 3 amber and 11 green: three wide chips.
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
    await expect(area(page, 'Bathroom Large').getByRole('img')).toHaveAccessibleName('10 urgent, 3 at risk, 11 on track');
    for (const name of ['Bathroom Large', 'Kitchen', 'Front garden']) {
      const button = disclosure(page, name);
      const { lastLine, chevron } = await button.evaluate((el) => {
        const svg = el.querySelector('svg')!;
        const text = svg.previousSibling!;
        const range = document.createRange();
        range.selectNodeContents(text);
        const rects = range.getClientRects();
        const last = rects[rects.length - 1];
        const icon = svg.getBoundingClientRect();
        return { lastLine: { top: last.top, bottom: last.bottom }, chevron: { top: icon.top, bottom: icon.bottom } };
      });
      // The chevron sits inside the line box of the name's last letter.
      expect(chevron.top, name).toBeGreaterThanOrEqual(lastLine.top - 1);
      expect(chevron.bottom, name).toBeLessThanOrEqual(lastLine.bottom + 1);
    }
    // And the name is still read as one word.
    await expect(area(page, 'Bathroom Large').getByRole('heading', { level: 2 })).toHaveAccessibleName('Bathroom Large');
  });
});
