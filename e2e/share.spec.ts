import {
  addButton,
  area,
  areaAction,
  areaCard,
  areaCards,
  areas,
  attentionScreen,
  chooseWho,
  closeArea,
  confirmation,
  DEFAULT_AREAS,
  DEMO_STORAGE_KEY,
  expect,
  goToTab,
  homeScreen,
  itemSheet,
  openArea,
  openAttention,
  openItem,
  openProfile,
  openSeeded,
  peopleButton,
  reopen,
  settled,
  showView,
  tabButton,
  test,
  toast,
  views,
  type Page,
} from './fixtures';

test.use({
  timezoneId: 'Europe/London',
  serviceWorkers: 'block',
  permissions: ['clipboard-read', 'clipboard-write'],
});

/** Stands in for the iPhone share sheet: every navigator.share() payload lands in window.__shared. */
async function stubShareSheet(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shared: ShareData[] = [];
    (window as unknown as { __shared: ShareData[] }).__shared = shared;
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        shared.push(data);
      },
    });
  });
}

async function sharedPayloads(page: Page): Promise<ShareData[]> {
  return page.evaluate(() => (window as unknown as { __shared: ShareData[] }).__shared);
}

/** Ids from the stored demo household. */
async function ids(page: Page): Promise<{ item(title: string): string; area(name: string): string }> {
  const doc = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), DEMO_STORAGE_KEY);
  return {
    item: (title) => doc.items.find((i: { title: string }) => i.title === title).id,
    area: (name) => doc.areas.find((a: { name: string }) => a.name === name).id,
  };
}

/**
 * Edits the stored demo household, then reopens the app: renames areas (`from` to `to`) and
 * gives each renamed area one more urgent, within-the-month and not-urgent item when
 * `allThree` is set.
 */
async function reshapeAreas(page: Page, renames: Record<string, string>, allThree = false): Promise<void> {
  await page.evaluate(
    ([key, renames, allThree]) => {
      const doc = JSON.parse(localStorage.getItem(key)!);
      for (const a of doc.areas) {
        if (!(a.name in renames)) continue;
        a.name = renames[a.name];
        const model = doc.items.find((i: { area_id: string; status: string }) => i.area_id === a.id && i.status === 'open');
        if (!allThree || !model) continue;
        for (const rag of ['red', 'amber', 'green']) doc.items.push({ ...model, id: crypto.randomUUID(), title: `${model.title} ${rag}`, rag });
      }
      localStorage.setItem(key, JSON.stringify(doc));
    },
    [DEMO_STORAGE_KEY, renames, allThree] as const,
  );
  await page.goto('/');
  await expect(homeScreen(page).getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
}

/** Lines an area's name takes in its sheet, and whether any word is broken across two of them. */
async function nameLines(page: Page, name: string): Promise<{ lines: number; brokenWord: boolean }> {
  return area(page, name)
    .getByRole('heading', { level: 1 })
    .evaluate((button) => {
      const range = document.createRange();
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      const chars: { c: string; top: number }[] = [];
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        for (let i = 0; i < node.length; i++) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          chars.push({ c: node.data[i], top: Math.round(range.getBoundingClientRect().top) });
        }
      }
      const brokenWord = chars.some((ch, i) => i > 0 && ch.top !== chars[i - 1].top && ch.c !== ' ' && chars[i - 1].c !== ' ');
      return { lines: new Set(chars.map((ch) => ch.top)).size, brokenWord };
    });
}

async function signOut(page: Page): Promise<void> {
  const dialog = await openProfile(page);
  await dialog.getByRole('button', { name: 'Sign Out' }).click();
  await (await confirmation(page, 'Sign out of home.os?')).getByRole('button', { name: 'Sign Out' }).click();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
}

test.describe('Sharing an item', () => {
  test('Share in the Item sheet opens the share sheet with a summary and a link back', async ({ page, baseURL }) => {
    await stubShareSheet(page);
    await openSeeded(page);
    const id = (await ids(page)).item('Heaters not working');
    await openArea(page, 'Hallway');
    const sheet = await openItem(page, 'Heaters not working');
    await sheet.getByRole('button', { name: 'Share item' }).click();
    await expect.poll(async () => (await sharedPayloads(page)).length).toBe(1);
    const [payload] = await sharedPayloads(page);
    expect(payload).toEqual({
      title: 'Heaters not working',
      text: [
        'Heaters not working',
        'Hallway · Urgent · Missed · Tue 6 Oct',
        'Assigned to Shea',
        'No heat since the weekend. Engineer needs booking.',
        '',
        `${baseURL}/?item=${id}`,
      ].join('\n'),
    });
    // Nothing else happens: the sheet stays, no toast.
    await expect(sheet).toBeVisible();
    await expect(toast(page, /./)).toHaveCount(0);
  });

  test('a To maintain item carries what good looks like', async ({ page }) => {
    await stubShareSheet(page);
    await openSeeded(page);
    // A To maintain row has no ring: its button is named "Firepit, to maintain, Good, ..."
    // (Chromium puts a space before the comma).
    await openArea(page, 'Garden');
    await areas(page).getByRole('button', { name: /^Firepit ?, to maintain, Good,/ }).click();
    const sheet = itemSheet(page);
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await sheet.getByRole('button', { name: 'Share item' }).click();
    await expect.poll(async () => (await sharedPayloads(page)).length).toBe(1);
    const [{ text }] = await sharedPayloads(page);
    expect(text!.split('\n').slice(0, 5)).toEqual([
      'Firepit',
      'Garden · Good · Updated Thu 8 Oct',
      'Looked after by Ela',
      "New one installed. Keep the cover on when it's not in use.",
      'What good looks like: Cover on when not in use, ash cleared out, logs dry and stacked under the bench.',
    ]);
  });

  test('Share sends what the sheet shows, edits not yet saved included', async ({ page, baseURL }) => {
    await stubShareSheet(page);
    await openSeeded(page);
    const id = (await ids(page)).item('Heaters not working');
    await openArea(page, 'Hallway');
    const sheet = await openItem(page, 'Heaters not working');
    await sheet.getByRole('radiogroup', { name: 'How urgent?' }).getByText('Not urgent', { exact: true }).click();
    await expect(sheet.getByRole('radio', { name: 'Not urgent' })).toBeChecked();
    await sheet.getByLabel('Title', { exact: true }).fill('Heaters not working (engineer booked Fri)');
    await sheet.getByRole('button', { name: 'Share item' }).click();
    await expect.poll(async () => (await sharedPayloads(page)).length).toBe(1);
    expect((await sharedPayloads(page))[0]).toEqual({
      title: 'Heaters not working (engineer booked Fri)',
      text: [
        'Heaters not working (engineer booked Fri)',
        'Hallway · Not urgent · Missed · Tue 6 Oct',
        'Assigned to Shea',
        'No heat since the weekend. Engineer needs booking.',
        '',
        `${baseURL}/?item=${id}`,
      ].join('\n'),
    });
    // Sharing saves nothing: closing still asks about the changes.
    await sheet.getByRole('button', { name: 'Close' }).click();
    await (await confirmation(page, 'Discard your changes?')).getByRole('button', { name: 'Discard Changes' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(areas(page).getByRole('button', { name: 'Mark Heaters not working as done' })).toBeVisible();
  });

  test('a new item has no Share', async ({ page }) => {
    await openSeeded(page);
    await addButton(page).click();
    const sheet = itemSheet(page, 'New item');
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await expect(sheet.getByRole('button', { name: 'Share item' })).toHaveCount(0);
  });

  test('without a share sheet, the text is copied and a toast says so', async ({ page, baseURL }) => {
    await openSeeded(page);
    expect(await page.evaluate(() => typeof navigator.share)).toBe('undefined');
    const id = (await ids(page)).item('Olive oil');
    await openArea(page, 'Kitchen');
    const sheet = await openItem(page, 'Olive oil');
    await sheet.getByRole('button', { name: 'Share item' }).click();
    await expect(toast(page, 'Copied to share')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      [
        'Olive oil',
        'Kitchen · Not urgent · Due Thu 12 Nov · Every month',
        'Assigned to Stratis',
        'Restocked, 5L tin is in the pantry.',
        '',
        `${baseURL}/?item=${id}`,
      ].join('\n'),
    );
    // The toast shows over the sheet, which stays open.
    await expect(sheet).toBeVisible();
  });

  test('cancelling the share sheet does nothing', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async () => {
          throw new DOMException('Share canceled', 'AbortError');
        },
      });
    });
    await openSeeded(page);
    await page.evaluate(() => navigator.clipboard.writeText('before'));
    await openArea(page, 'Kitchen');
    const sheet = await openItem(page, 'Olive oil');
    await sheet.getByRole('button', { name: 'Share item' }).click();
    await page.waitForTimeout(300);
    await expect(toast(page, /./)).toHaveCount(0);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('before');
  });
});

test.describe('Sharing an area', () => {
  test('Share Room in an area’s sheet shares its open items, in the order its sheet lists them', async ({ page, baseURL }) => {
    await stubShareSheet(page);
    await openSeeded(page);
    const garden = (await ids(page)).area('Garden');
    await openArea(page, 'Garden');
    await areaAction(page, 'Garden', 'Share Room').click();
    await expect.poll(async () => (await sharedPayloads(page)).length).toBe(1);
    expect((await sharedPayloads(page))[0]).toEqual({
      title: 'Garden',
      text: [
        'Garden (3 items)',
        '• Garden room wall panel · Within the month · Due Fri 30 Oct',
        '• Give away the old firepit · Not urgent · Due Thu 15 Oct',
        '• Firepit · Good · Updated Thu 8 Oct',
        '',
        `${baseURL}/?area=${garden}`,
      ].join('\n'),
    });
    // Nothing else happens: the sheet stays, no toast.
    await expect(area(page, 'Garden')).toBeVisible();
    await expect(toast(page, /./)).toHaveCount(0);
  });

  test('copies where there is no share sheet; an empty area says so', async ({ page, baseURL }) => {
    await openSeeded(page);
    const small = (await ids(page)).area('Bedroom Small');
    await openArea(page, 'Bedroom Small');
    await areaAction(page, 'Bedroom Small', 'Share Room').click();
    await expect(toast(page, 'Copied to share')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `Bedroom Small\nNothing to do\n\n${baseURL}/?area=${small}`,
    );
  });

  for (const width of [320, 402]) {
    test(`Add Item and Share Room sit side by side, each wholly a target of 44px or more (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await stubShareSheet(page);
      await openSeeded(page);
      await openArea(page, 'Hallway');
      const add = (await areaAction(page, 'Hallway', 'Add Item').boundingBox())!;
      const share = (await areaAction(page, 'Hallway', 'Share Room').boundingBox())!;
      expect(add.height).toBeGreaterThanOrEqual(44);
      expect(share.height).toBeGreaterThanOrEqual(44);
      expect(share.y).toBe(add.y);
      expect(add.x + add.width).toBeLessThanOrEqual(share.x);
      expect(share.x + share.width).toBeLessThanOrEqual(width - 16 + 0.5);
      // Every corner of each is that button.
      for (const [b, name] of [
        [add, 'Add item to Hallway'],
        [share, null],
      ] as const) {
        const hits = await page.evaluate(
          (points) => points.map(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? null),
          [
            [b.x + 2, b.y + 2],
            [b.x + b.width - 2, b.y + 2],
            [b.x + 2, b.y + b.height - 2],
            [b.x + b.width - 2, b.y + b.height - 2],
          ] as [number, number][],
        );
        expect(hits, name ?? 'Share Room').toEqual(Array(4).fill(name ? 'Add Item' : 'Share Room'));
      }
      // The words stay whole on one line.
      for (const action of ['Add Item', 'Share Room'] as const) {
        const fits = await areaAction(page, 'Hallway', action).evaluate((el) => el.scrollWidth <= el.clientWidth + 0.5);
        expect(fits, action).toBe(true);
      }
      await areaAction(page, 'Hallway', 'Share Room').click();
      await expect.poll(async () => (await sharedPayloads(page)).length).toBe(1);
    });
  }

  test('an area with nothing open: its sheet says so, and can still be shared and added to', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await stubShareSheet(page);
    await openSeeded(page);
    await reshapeAreas(page, { 'Bedroom Small': 'Downstairs bathroom' });
    const names = DEFAULT_AREAS.map((n) => (n === 'Bedroom Small' ? 'Downstairs bathroom' : n));
    await expect(areaCard(page, 'Downstairs bathroom', names)).toHaveAccessibleName(/^Downstairs bathroom\b.*All clear/);
    const sheet = await openArea(page, 'Downstairs bathroom', names);
    await expect(sheet.locator('[data-area-status]')).toHaveText('All clear');
    await expect(sheet.getByText('Nothing to do here.', { exact: true })).toBeVisible();
    await expect(sheet.getByRole('button', { name: /^Mark / })).toHaveCount(0);
    await areaAction(page, 'Downstairs bathroom', 'Share Room').click();
    await expect.poll(async () => (await sharedPayloads(page)).length).toBe(1);
    await expect(areaAction(page, 'Downstairs bathroom', 'Add Item')).toBeVisible();
  });

  for (const width of [320, 402]) {
    test(`long names break only between words, on cards and in the sheet (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await openSeeded(page);
      await reshapeAreas(page, { Kitchen: 'Children’s Bedroom', 'Living Room': 'Utility Room Upstairs' }, true);
      const names = DEFAULT_AREAS.map((n) => (n === 'Kitchen' ? 'Children’s Bedroom' : n === 'Living Room' ? 'Utility Room Upstairs' : n));
      for (const name of ['Children’s Bedroom', 'Utility Room Upstairs']) {
        await expect(areaCard(page, name, names), name).toHaveAccessibleName(new RegExp(`^${name}\\b.*needs attention`));
        await openArea(page, name, names);
        await expect(area(page, name).locator('[data-area-status]'), name).toHaveText('1 needs attention');
        const { lines, brokenWord } = await nameLines(page, name);
        expect(brokenWord, name).toBe(false);
        expect(lines, name).toBeLessThanOrEqual(2);
        await closeArea(page);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    });
  }

  test('at 320px every card fits, two to a row, and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await openSeeded(page);
    const count = await areaCards(page).count();
    expect(count).toBe(DEFAULT_AREAS.length);
    for (let i = 0; i < count; i++) {
      const box = (await areaCards(page).nth(i).boundingBox())!;
      expect(box.x, DEFAULT_AREAS[i]).toBeGreaterThanOrEqual(16);
      expect(box.x + box.width, DEFAULT_AREAS[i]).toBeLessThanOrEqual(320 - 16 + 0.5);
      expect(box.width, DEFAULT_AREAS[i]).toBeGreaterThan(130);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  });
});

test.describe('Opening a shared link', () => {
  test('?item= opens that item, and the address loses it', async ({ page, baseURL }) => {
    await openSeeded(page);
    const id = (await ids(page)).item('Wardrobe door hinge');
    await page.goto(`/?item=${id}`);
    const sheet = itemSheet(page);
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await expect(sheet.getByLabel('Title', { exact: true })).toHaveValue('Wardrobe door hinge');
    expect(page.url()).toBe(`${baseURL}/`);
    // Closing shows Home; a reload doesn't open it again.
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
    await page.reload();
    await expect(homeScreen(page).getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(itemSheet(page)).toHaveCount(0);
  });

  test('?area= opens that area’s sheet over Home, and the address loses it', async ({ page, baseURL }) => {
    await openSeeded(page);
    const garden = (await ids(page)).area('Garden');
    await page.goto(`/?frame&area=${garden}`);
    expect(new URL(page.url()).search).toBe('?frame');
    const sheet = area(page, 'Garden');
    await settled(sheet.getByRole('button', { name: 'Close', exact: true }));
    await expect(sheet.getByRole('heading', { level: 1 })).toHaveText('Garden');
    await expect(sheet.getByRole('button', { name: 'Mark Give away the old firepit as done' })).toBeInViewport();
    expect(page.url()).toBe(`${baseURL}/?frame`);
    // Focus is in the sheet, without a ring (a link brought them here, not the keyboard).
    await expect(sheet).toBeFocused();
    await expect(sheet).toHaveCSS('outline-style', 'none');
    // Closing leaves Home, on Garden's card; a reload doesn't open it again.
    await closeArea(page);
    await expect(areaCard(page, 'Garden')).toBeFocused();
    await page.reload();
    await expect(homeScreen(page).getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(areas(page)).toHaveCount(0);
  });

  test('?area= shows all the area’s items, whoever Needs attention is narrowed to', async ({ page }) => {
    await openSeeded(page);
    const hallway = (await ids(page)).area('Hallway');
    // Hallway's only item is Shea's.
    await openAttention(page);
    await chooseWho(page, /^Unassigned,/);
    await page.goto(`/?area=${hallway}`);
    await settled(area(page, 'Hallway').getByRole('button', { name: 'Close', exact: true }));
    await expect(area(page, 'Hallway').getByRole('button', { name: 'Mark Heaters not working as done' })).toBeVisible();
    // Needs attention keeps its own choice.
    await closeArea(page);
    await goToTab(page, 'Attention');
    await expect(peopleButton(page)).toHaveAccessibleName('Show tasks for: Unassigned');
  });

  test('?area= from another tab: Home with the sheet over it; Needs attention keeps the view picked', async ({ page }) => {
    await openSeeded(page, 'Calendar');
    const garden = (await ids(page)).area('Garden');
    await page.goto(`/?area=${garden}`);
    await settled(area(page, 'Garden').getByRole('button', { name: 'Close', exact: true }));
    await expect(tabButton(page, 'Home')).toHaveAttribute('aria-current', 'page');
    await closeArea(page);
    await goToTab(page, 'Attention');
    await expect(views(page).getByRole('radio', { name: 'Calendar' })).toHaveAttribute('aria-checked', 'true');
    // A view picked on the switch is remembered, as ever.
    await showView(page, 'List');
    await reopen(page);
    await expect(views(page).getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
    await expect(attentionScreen(page).locator('section[data-group]').first()).toBeVisible();
  });

  test('a link to an item this home does not have only says so', async ({ page }) => {
    await openSeeded(page);
    await page.goto('/?item=7f1c2d3e-0000-4000-8000-000000000001');
    await expect(toast(page, 'That item isn’t in your home')).toBeVisible();
    await expect(itemSheet(page)).toHaveCount(0);
    await page.goto('/?area=7f1c2d3e-0000-4000-8000-000000000001');
    await expect(toast(page, 'That area isn’t in your home')).toBeVisible();
  });

  test('signed out: the link waits through sign-in, then opens', async ({ page, baseURL }) => {
    await openSeeded(page);
    const known = await ids(page);
    const id = known.item('Re-seal around the shower');
    await signOut(page);
    await page.goto(`/?item=${id}`);
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    expect(page.url()).toBe(`${baseURL}/`);
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    const sheet = itemSheet(page);
    await settled(sheet.getByRole('button', { name: 'Close' }));
    await expect(sheet.getByLabel('Title', { exact: true })).toHaveValue('Re-seal around the shower');

    // An area link the same way.
    await sheet.getByRole('button', { name: 'Close' }).click();
    await signOut(page);
    await page.goto(`/?area=${known.area('Jacuzzi')}`);
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await settled(area(page, 'Jacuzzi').getByRole('button', { name: 'Close', exact: true }));
    await expect(area(page, 'Jacuzzi').getByRole('heading', { level: 1 })).toBeInViewport();
  });

  test('a shared link opens what was shared (round trip)', async ({ page }) => {
    await stubShareSheet(page);
    await openSeeded(page);
    await openArea(page, 'Jacuzzi');
    const sheet = await openItem(page, 'Change the filter');
    await sheet.getByRole('button', { name: 'Share item' }).click();
    await expect.poll(async () => (await sharedPayloads(page)).length).toBe(1);
    const link = (await sharedPayloads(page))[0].text!.split('\n').pop()!;
    await page.goto(link);
    await settled(itemSheet(page).getByRole('button', { name: 'Close' }));
    await expect(itemSheet(page).getByLabel('Title', { exact: true })).toHaveValue('Change the filter');

    // An area too.
    await page.keyboard.press('Escape');
    await expect(itemSheet(page)).toHaveCount(0);
    await openArea(page, 'Front garden');
    await areaAction(page, 'Front garden', 'Share Room').click();
    await expect.poll(async () => (await sharedPayloads(page)).length).toBe(1);
    const areaLink = (await sharedPayloads(page))[0].text!.split('\n').pop()!;
    await page.goto(areaLink);
    await settled(area(page, 'Front garden').getByRole('button', { name: 'Close', exact: true }));
  });
});
