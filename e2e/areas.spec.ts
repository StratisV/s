import {
  addButton,
  area,
  areaAction,
  areaCard,
  areaCards,
  areaStatus,
  closeArea,
  confirmation,
  DEFAULT_AREAS,
  DEMO_STORAGE_KEY,
  detailValue,
  expect,
  homeScreen,
  itemSheet,
  openArea,
  openSeeded,
  reopen,
  ring,
  rowButton,
  settled,
  tabs,
  test,
  titlesIn,
  toast,
  type Locator,
  type Page,
} from './fixtures';

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
});

/** Focuses a control as the keyboard would (so it matches :focus-visible). */
async function keyboardFocus(control: Locator): Promise<void> {
  // A key press first, so focus is shown even after a tap.
  await control.page().keyboard.press('Shift');
  await control.focus();
  await expect.poll(() => control.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
}

/** Drags from the middle of `handle` down by `dy` with the mouse. */
async function dragDown(page: Page, handle: Locator, dy: number): Promise<void> {
  await handle.hover();
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 8 });
  await page.mouse.up();
}

test.describe('Area cards', () => {
  test('each card is one target, at least 44 by 44, named by its area first', async ({ page }) => {
    await expect(areaCards(page)).toHaveCount(DEFAULT_AREAS.length);
    for (const name of DEFAULT_AREAS) {
      const card = areaCard(page, name);
      await expect(card, name).toHaveCount(1);
      const box = (await card.boundingBox())!;
      expect(box.width, name).toBeGreaterThanOrEqual(44);
      expect(box.height, name).toBeGreaterThanOrEqual(44);
    }
    // Nothing else to tap in a card.
    for (let i = 0; i < DEFAULT_AREAS.length; i++) await expect(areaCards(page).nth(i).getByRole('button')).toHaveCount(1);
  });

  test('a tap opens the area; Close, a drag down and Escape close it, and focus is back on its card', async ({ page }) => {
    const sheet = await openArea(page, 'Kitchen');
    await expect(sheet).toBeFocused();
    await closeArea(page);
    await expect(areaCard(page, 'Kitchen')).toBeFocused();

    // Down from its drawing, which is the sheet's handle.
    await openArea(page, 'Garden');
    await dragDown(page, area(page, 'Garden').locator('[data-sheet-handle]'), 220);
    await expect(area(page, 'Garden')).toHaveCount(0);

    // From the keyboard: Enter opens, Escape closes, focus back where it was.
    await keyboardFocus(areaCard(page, 'Jacuzzi'));
    await page.keyboard.press('Enter');
    await settled(area(page, 'Jacuzzi').getByRole('button', { name: 'Close', exact: true }));
    await page.keyboard.press('Escape');
    await expect(area(page, 'Jacuzzi')).toHaveCount(0);
    await expect(areaCard(page, 'Jacuzzi')).toBeFocused();
  });

  test('a card for each area follows the household: a new area gets a card, a deleted one loses it', async ({ page }) => {
    await page.evaluate((key) => {
      const doc = JSON.parse(localStorage.getItem(key)!);
      const hallway = doc.areas.find((a: { name: string }) => a.name === 'Hallway');
      doc.areas.push({ ...hallway, id: '00000000-0000-4000-8000-0000000000aa', name: 'Shed', position: 99 });
      doc.areas = doc.areas.filter((a: { name: string }) => a.name !== 'Jacuzzi');
      doc.items = doc.items.filter((i: { area_id: string }) => doc.areas.some((a: { id: string }) => a.id === i.area_id));
      localStorage.setItem(key, JSON.stringify(doc));
    }, DEMO_STORAGE_KEY);
    await reopen(page);
    const names = [...DEFAULT_AREAS.filter((n) => n !== 'Jacuzzi'), 'Shed'];
    await expect(areaCards(page)).toHaveCount(names.length);
    await expect(areaCards(page).last().getByRole('button')).toHaveAccessibleName(/^Shed\b.*All clear/);
    await expect(areaCard(page, 'Jacuzzi')).toHaveCount(0);
  });
});

test.describe('An area’s sheet', () => {
  test('its rows sit in one card under To do, lined up with the page; things looked after under Looking after', async ({ page }) => {
    const sheet = await openArea(page, 'Garden');
    const card = sheet.locator('[data-area-tasks] > div');
    const sheetBox = (await sheet.boundingBox())!;
    const box = (await card.boundingBox())!;
    expect(box.x).toBe(sheetBox.x + 16);
    expect(box.width).toBe(sheetBox.width - 32);
    await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(sheet.locator('[data-area-tasks]').getByRole('heading', { level: 2 })).toHaveText('To do');
    await expect(sheet.locator('[data-area-looking]').getByRole('heading', { level: 2 })).toHaveText('Looking after');
    // Its name: the sheet's title, 28px bold.
    await expect(sheet.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '28px');
    await expect(sheet.getByRole('heading', { level: 1 })).toHaveCSS('font-weight', '700');
    // Add Item and Share Room side by side, each a target of 44px or more.
    for (const action of ['Add Item', 'Share Room'] as const) {
      const b = (await areaAction(page, 'Garden', action).boundingBox())!;
      expect(b.height, action).toBeGreaterThanOrEqual(44);
    }
  });

  test('a busy area shows three jobs, then "Show 2 more"', async ({ page }) => {
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
    await expect(areaCard(page, 'Kitchen')).toHaveAccessibleName(/^Kitchen\b.*\b5\b/);
    await openArea(page, 'Kitchen');
    const more = area(page, 'Kitchen').getByRole('button', { name: 'Show 2 more' });
    await expect(more).toBeVisible();
    expect(await titlesIn(page, 'Kitchen')).toEqual(['Kitchen paper', 'Olive oil', 'Kitchen job 1']);
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    expect(await titlesIn(page, 'Kitchen')).toEqual(['Kitchen paper', 'Olive oil', 'Kitchen job 1', 'Kitchen job 2', 'Kitchen job 3']);
    await area(page, 'Kitchen').getByRole('button', { name: 'Show fewer' }).click();
    expect(await titlesIn(page, 'Kitchen')).toHaveLength(3);
  });

  test('its state, in words and colour: red needs attention, amber coming up, green all good or all clear', async ({ page }) => {
    const expectations: [string, string, string][] = [
      ['Hallway', '1 needs attention', 'rgb(215, 0, 21)'],
      ['Jacuzzi', '1 coming up', 'rgb(154, 91, 0)'],
      ['Kitchen', 'All good', 'rgb(31, 122, 54)'],
      ['Bedroom Small', 'All clear', 'rgb(31, 122, 54)'],
    ];
    for (const [name, words, colour] of expectations) {
      await openArea(page, name);
      await expect(areaStatus(page, name), name).toHaveText(words);
      await expect(areaStatus(page, name), name).toHaveCSS('color', colour);
      // Said with the name to assistive tech.
      await expect(area(page, name).getByRole('heading', { level: 1 })).toHaveAccessibleDescription(new RegExp(`^${words} `));
      await closeArea(page);
    }
  });

  test('follows the items: completing and adding', async ({ page }) => {
    await openArea(page, 'Bathroom Large');
    await ring(page, 'Shower draining slowly').click();
    await expect(ring(page, 'Shower draining slowly')).toHaveCount(0);
    // Its only item: All clear.
    await expect(areaStatus(page, 'Bathroom Large')).toHaveText('All clear');
    await closeArea(page);
    await expect(areaCard(page, 'Bathroom Large')).toHaveAccessibleName(/^Bathroom Large\b.*All clear/);

    // Add an urgent item to the Hallway from its sheet.
    await openArea(page, 'Hallway');
    await areaAction(page, 'Hallway', 'Add Item').click();
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await expect(detailValue(sheet, 'Area')).toHaveText('Hallway');
    await sheet.getByLabel('Title', { exact: true }).fill('Fix the coat hook');
    await sheet.getByRole('radiogroup', { name: 'How urgent?' }).getByText('Urgent', { exact: true }).click();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(areaStatus(page, 'Hallway')).toHaveText('2 need attention');
    // It can be seen where it went, lit up for a moment.
    const row = area(page, 'Hallway').getByRole('listitem').filter({ hasText: 'Fix the coat hook' });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-lit');
    await expect(row).not.toHaveAttribute('data-lit', { timeout: 5_000 });
    await closeArea(page);
    await expect(areaCard(page, 'Hallway')).toHaveAccessibleName(/^Hallway\b.*2 need attention/);
  });

  test('moving an item to another area: it leaves this one, and a toast says where it went', async ({ page }) => {
    await openArea(page, 'Bedroom Large');
    await rowButton(page, 'Wardrobe door hinge').click();
    const sheet = itemSheet(page);
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await sheet.getByLabel('Area', { exact: true }).selectOption({ label: 'Garden' });
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(toast(page, 'Saved in Garden.')).toBeVisible();
    await expect(ring(page, 'Wardrobe door hinge')).toHaveCount(0);
    await closeArea(page);
    await openArea(page, 'Garden');
    expect(await titlesIn(page, 'Garden')).toContain('Wardrobe door hinge');
  });

  test('saved from Home’s +: the card of the area it went into lights up', async ({ page }) => {
    await addButton(page).click();
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await sheet.getByLabel('Title', { exact: true }).fill('Descale the kettle');
    await sheet.getByLabel('Area', { exact: true }).selectOption({ label: 'Kitchen' });
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    const cell = areaCards(page).first();
    await expect(cell).toHaveAttribute('data-lit');
    await expect(areaCard(page, 'Kitchen')).toHaveAccessibleName(/^Kitchen\b.*\b3\b/);
    await expect(cell).not.toHaveAttribute('data-lit', { timeout: 5_000 });
  });

  test('the tab bar and the round + are behind it, out of reach', async ({ page }) => {
    await openArea(page, 'Kitchen');
    await expect(tabs(page).locator('xpath=ancestor::*[@inert]')).toHaveCount(1);
    await expect(addButton(page).locator('xpath=ancestor::*[@inert]')).toHaveCount(1);
    await expect(homeScreen(page).locator('xpath=ancestor-or-self::*[@inert]')).toHaveCount(1);
  });
});

/** Presses a button from the keyboard (later focus() calls then count as keyboard focus). */
async function pressKey(control: Locator): Promise<void> {
  await control.focus();
  await control.press('Enter');
}

test.describe('Keyboard focus in an area’s sheet', () => {
  test('completing from the keyboard moves to the next row', async ({ page }) => {
    await openArea(page, 'Jacuzzi');
    await keyboardFocus(ring(page, 'Water test strips running low'));
    await page.keyboard.press('Enter');
    await expect(ring(page, 'Water test strips running low')).toHaveCount(0);
    await expect(rowButton(page, 'Change the filter')).toBeFocused();
  });

  test('with no other row to go to, focus goes to To do', async ({ page }) => {
    await pressKey(areaCard(page, 'Living Room'));
    await settled(area(page, 'Living Room').getByRole('button', { name: 'Close', exact: true }));
    await keyboardFocus(ring(page, 'Mirror lights not level'));
    await page.keyboard.press('Enter');
    await expect(ring(page, 'Mirror lights not level')).toHaveCount(0);
    await expect(area(page, 'Living Room').getByRole('heading', { level: 2, name: 'To do' })).toBeFocused();
  });

  test('after deleting from the keyboard, focus goes to the row beside it', async ({ page }) => {
    await openArea(page, 'Jacuzzi');
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
    // The row above it in the Jacuzzi.
    await expect(rowButton(page, 'Water test strips running low')).toBeFocused();
  });
});

test.describe('Long area names at 375 wide', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('a long name wraps whole in its sheet, and is one name to assistive tech', async ({ page }) => {
    await page.evaluate((key) => {
      const doc = JSON.parse(localStorage.getItem(key)!);
      doc.areas.find((a: { name: string }) => a.name === 'Bathroom Large').name = 'Upstairs family bathroom with the big window';
      localStorage.setItem(key, JSON.stringify(doc));
    }, DEMO_STORAGE_KEY);
    await reopen(page);
    const name = 'Upstairs family bathroom with the big window';
    const names = DEFAULT_AREAS.map((n) => (n === 'Bathroom Large' ? name : n));
    await expect(areaCard(page, name, names)).toHaveAccessibleName(new RegExp(`^${name}\\b`));
    const sheet = await openArea(page, name, names);
    const title = sheet.getByRole('heading', { level: 1 });
    await expect(title).toHaveAccessibleName(name);
    // Whole words on each line, inside the sheet.
    const fits = await title.evaluate((el) => el.scrollWidth <= el.clientWidth + 0.5);
    expect(fits).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
});
