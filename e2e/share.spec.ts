import {
  addButton,
  area,
  chooseWho,
  confirmation,
  DEMO_STORAGE_KEY,
  expect,
  homeScreen,
  itemSheet,
  openItem,
  openProfile,
  openRoomMenu,
  openSeeded,
  peopleButton,
  reopen,
  roomMenu,
  settled,
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

/** Lines a room's name takes, and whether any word is broken across two of them. */
async function nameLines(page: Page, name: string): Promise<{ lines: number; brokenWord: boolean }> {
  return area(page, name)
    .getByRole('heading', { level: 2 })
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

/** What takes a tap at (x, y): the label of the button there, if any. */
async function buttonAt(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(
    ([px, py]) => document.elementFromPoint(px, py)?.closest('button')?.getAttribute('aria-label') ?? null,
    [x, y] as const,
  );
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
    await homeScreen(page).getByRole('button', { name: /^Firepit ?, to maintain, Good,/ }).click();
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
    await expect(homeScreen(page).getByRole('button', { name: 'Mark Heaters not working as done' })).toBeVisible();
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
    const sheet = await openItem(page, 'Olive oil');
    await sheet.getByRole('button', { name: 'Share item' }).click();
    await page.waitForTimeout(300);
    await expect(toast(page, /./)).toHaveCount(0);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('before');
  });
});

test.describe('Sharing an area', () => {
  test('Share Room in a room’s menu shares its open items, in the order its card lists them', async ({ page, baseURL }) => {
    await stubShareSheet(page);
    await openSeeded(page);
    const garden = (await ids(page)).area('Garden');
    await roomMenu(page, 'Garden', 'Share Room');
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
  });

  test('copies where there is no share sheet; an empty room says so', async ({ page, baseURL }) => {
    await openSeeded(page);
    const small = (await ids(page)).area('Bedroom Small');
    await roomMenu(page, 'Bedroom Small', 'Share Room');
    await expect(toast(page, 'Copied to share')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `Bedroom Small\nNothing to do\n\n${baseURL}/?area=${small}`,
    );
  });

  test('every room’s "..." is a 44px target at the card’s edge, its dots lined up with the rows', async ({ page }) => {
    await openSeeded(page);
    await expect(homeScreen(page).getByRole('button', { name: / options$/ })).toHaveCount(11);
    const section = area(page, 'Hallway');
    const options = section.getByRole('button', { name: 'Hallway options' });
    await options.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const box = (await options.boundingBox())!;
    expect(box.width).toBe(44);
    expect(box.height).toBe(44);
    const card = (await section.locator('[data-room-card]').boundingBox())!;
    // 4px in from the card's edge, so its dots end where the rows' words do (16px in).
    expect(card.x + card.width - (box.x + box.width)).toBeCloseTo(4, 0);
    const dots = (await options.locator('svg').boundingBox())!;
    const meta = (await section.locator('[data-meta]').first().boundingBox())!;
    const rowEnd = card.x + card.width - 16;
    expect(dots.x + dots.width).toBeLessThanOrEqual(rowEnd + 2);
    expect(dots.x + dots.width).toBeGreaterThan(rowEnd - 4);
    expect(meta.x + meta.width).toBeLessThanOrEqual(rowEnd + 0.5);
    const cy = box.y + box.height / 2;
    const status = (await section.locator('[data-toggles]').boundingBox())!;
    const hits = await page.evaluate(
      (points) => points.map(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null),
      [
        [box.x + 1, cy],
        [box.x + box.width - 1, cy],
        [box.x + box.width / 2, box.y + 1],
        [box.x + box.width / 2, box.y + box.height - 1],
        // The quiet word before it is no button.
        [status.x + status.width / 2, cy],
      ] as [number, number][],
    );
    expect(hits).toEqual(['Hallway options', 'Hallway options', 'Hallway options', 'Hallway options', null]);
    expect(box.x).toBeGreaterThanOrEqual(status.x + status.width);
    // The glyph is the quiet grey of the room's other words, not the tint.
    await expect(options).toHaveCSS('color', 'rgb(110, 110, 115)');
  });

  for (const width of [320, 402]) {
    test(`tapping a room’s quiet word never opens its menu: it folds or opens the room, like the name (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await stubShareSheet(page);
      await openSeeded(page);
      // Hallway says "1 late" open or folded; Garden says nothing open, "3 open" folded.
      for (const name of ['Hallway', 'Garden']) {
        const section = area(page, name);
        const disclosure = section.getByRole('button', { name, exact: true });
        await section.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        if (name === 'Garden') {
          await expect(section.locator('[data-toggles]')).toHaveCount(0);
          await disclosure.click();
          await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
          await expect(section.locator('[data-toggles]')).toHaveText('3 open');
        } else {
          await expect(section.locator('[data-toggles]')).toHaveText('1 late');
        }
        const word = section.locator('[data-toggles]');
        const b = (await word.boundingBox())!;
        // Its left edge, its middle and its right edge (next to the "...").
        for (const x of [b.x + 1, b.x + b.width / 2, b.x + b.width - 1]) {
          if (!(await word.count())) break;
          expect(await buttonAt(page, x, b.y + b.height / 2), name).toBeNull();
          const before = (await disclosure.getAttribute('aria-expanded'))!;
          await page.touchscreen.tap(x, b.y + b.height / 2);
          await expect(disclosure, name).toHaveAttribute('aria-expanded', before === 'true' ? 'false' : 'true');
        }
      }
      await page.waitForTimeout(300);
      await expect(page.getByRole('menu')).toHaveCount(0);
      expect(await sharedPayloads(page)).toEqual([]);
      await expect(toast(page, /./)).toHaveCount(0);
      // The "..." itself, tapped at the left end of its target (once Garden has finished
      // opening: a menu closes when the page moves it).
      const options = area(page, 'Hallway').getByRole('button', { name: 'Hallway options' });
      const menu = page.getByRole('menu', { name: 'Hallway' });
      await expect(async () => {
        if (!(await menu.isVisible())) {
          await options.evaluate((el) => el.scrollIntoView({ block: 'center' }));
          const o = (await options.boundingBox())!;
          await page.touchscreen.tap(o.x + 2, o.y + o.height / 2);
        }
        await expect(menu).toBeVisible({ timeout: 1_000 });
      }).toPass();
    });
  }

  test('a room with nothing open: one quiet line, its name a plain heading, its menu still there', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await stubShareSheet(page);
    await openSeeded(page);
    await reshapeAreas(page, { 'Bedroom Small': 'Downstairs bathroom' });
    const section = area(page, 'Downstairs bathroom');
    await expect(section).toHaveAttribute('data-empty');
    // Nothing to fold: no button, no rows.
    await expect(section.getByRole('button', { name: 'Downstairs bathroom', exact: true })).toHaveCount(0);
    await expect(section.getByRole('heading', { level: 2, name: 'Downstairs bathroom' })).toBeVisible();
    await expect(section.getByText('All clear', { exact: true })).toBeVisible();
    await expect(section.getByRole('listitem')).toHaveCount(0);
    const heading = (await section.getByRole('heading', { level: 2 }).boundingBox())!;
    expect(await buttonAt(page, heading.x + heading.width / 2, heading.y + heading.height / 2)).toBeNull();
    // At 320px the long name takes two lines, broken between its words; "All clear" and the
    // "..." stay beside it.
    expect(await nameLines(page, 'Downstairs bathroom')).toEqual({ lines: 2, brokenWord: false });
    const status = (await section.getByText('All clear', { exact: true }).boundingBox())!;
    const options = (await section.getByRole('button', { name: 'Downstairs bathroom options' }).boundingBox())!;
    expect(heading.x + heading.width).toBeLessThanOrEqual(status.x);
    expect(status.x + status.width).toBeLessThanOrEqual(options.x);
    expect(options.x + options.width).toBeLessThanOrEqual(320 - 16);
    const menu = await openRoomMenu(page, 'Downstairs bathroom');
    await menu.getByRole('menuitem', { name: 'Share Room' }).click();
    await expect.poll(async () => (await sharedPayloads(page)).length).toBe(1);
  });

  for (const [width, lines] of [
    [320, { 'Children’s Bedroom': 2, 'Utility Room Upstairs': 2 }],
    [402, { 'Children’s Bedroom': 1, 'Utility Room Upstairs': 1 }],
  ] as const) {
    test(`long names break only between words, with the quiet word and "..." after (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await openSeeded(page);
      await reshapeAreas(page, { Kitchen: 'Children’s Bedroom', 'Living Room': 'Utility Room Upstairs' }, true);
      for (const [name, expected] of Object.entries(lines)) {
        const section = area(page, name);
        await expect(section.locator('[data-toggles]'), name).toHaveText('1 urgent');
        expect(await nameLines(page, name), name).toEqual({ lines: expected, brokenWord: false });
        const heading = (await section.getByRole('heading', { level: 2 }).boundingBox())!;
        const status = (await section.locator('[data-toggles]').boundingBox())!;
        const options = (await section.getByRole('button', { name: `${name} options` }).boundingBox())!;
        expect(heading.x + heading.width, name).toBeLessThanOrEqual(status.x);
        expect(status.x + status.width, name).toBeLessThanOrEqual(options.x);
        expect(options.x + options.width, name).toBeLessThanOrEqual(width - 16);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    });
  }

  test('at 320px every room’s header fits: name on one line, then its word and "..."', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await openSeeded(page);
    for (const name of ['Kitchen', 'Bathroom Small', 'Bathroom Large', 'Garden Lounge', 'Garden', 'Front garden', 'Hallway']) {
      const section = area(page, name);
      expect(await nameLines(page, name), name).toEqual({ lines: 1, brokenWord: false });
      const heading = (await section.getByRole('heading', { level: 2 }).boundingBox())!;
      const options = (await section.getByRole('button', { name: `${name} options` }).boundingBox())!;
      expect(heading.height, name).toBeLessThanOrEqual(44);
      expect(heading.x + heading.width, name).toBeLessThanOrEqual(options.x);
      expect(options.x + options.width, name).toBeLessThanOrEqual(320 - 16);
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

  test('?area= shows that area under the tab switch, opened, and lights it up', async ({ page, baseURL }) => {
    await openSeeded(page);
    const garden = (await ids(page)).area('Garden');
    const disclosure = area(page, 'Garden').getByRole('button', { name: 'Garden', exact: true });
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await page.goto(`/?frame&area=${garden}`);
    expect(new URL(page.url()).search).toBe('?frame');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(area(page, 'Garden')).toHaveAttribute('data-linked');
    // Scrolled so the area starts just under the stuck tab switch (the screen's scroll-padding:
    // 54px inset + 64px).
    await expect
      .poll(async () => (await area(page, 'Garden').boundingBox())!.y, { timeout: 3000 })
      .toBeCloseTo(54 + 64, -1);
    await expect(page.getByRole('button', { name: 'Mark Give away the old firepit as done' })).toBeInViewport();
    expect(page.url()).toBe(`${baseURL}/?frame`);
    // Focus is on its name (VoiceOver reads "Garden, expanded"), without moving the page, and
    // without a ring until a key is pressed.
    await expect(disclosure).toBeFocused();
    expect((await area(page, 'Garden').boundingBox())!.y).toBeCloseTo(54 + 64, -1);
    await expect(disclosure).toHaveCSS('outline-style', 'none');
    await page.keyboard.press('Shift');
    await expect(disclosure).toBeFocused();
    await expect(disclosure).toHaveCSS('outline-style', 'solid');
  });

  test('?area= for an area the person filter hides shows everyone’s items', async ({ page }) => {
    await openSeeded(page);
    const hallway = (await ids(page)).area('Hallway');
    // Hallway's only item is Shea's.
    await chooseWho(page, /^Unassigned,/);
    await expect(area(page, 'Hallway')).toHaveCount(0);
    await page.goto(`/?area=${hallway}`);
    await expect(peopleButton(page)).toHaveAccessibleName('Show tasks for: Everyone');
    await expect(area(page, 'Hallway')).toHaveAttribute('data-linked');
    await expect(page.getByRole('button', { name: 'Mark Heaters not working as done' })).toBeInViewport();
    await expect(area(page, 'Hallway').getByRole('button', { name: 'Hallway', exact: true })).toBeFocused();
  });

  test('?area= shows Rooms for the link only: opened again, Home is on the view the person picked', async ({ page }) => {
    await openSeeded(page, 'Up next');
    const garden = (await ids(page)).area('Garden');
    await page.goto(`/?area=${garden}`);
    await expect(area(page, 'Garden')).toHaveAttribute('data-linked');
    await expect(views(page).getByRole('radio', { name: 'Rooms' })).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => localStorage.getItem('homeos.homeView'))).toBeNull();
    await reopen(page);
    await expect(views(page).getByRole('radio', { name: 'Up next' })).toHaveAttribute('aria-checked', 'true');
    // A view picked on the switch is remembered, as ever.
    await views(page).getByRole('radio', { name: 'Calendar' }).click();
    await reopen(page);
    await expect(views(page).getByRole('radio', { name: 'Calendar' })).toHaveAttribute('aria-checked', 'true');
  });

  test('leaving Home before an area link has scrolled drops it', async ({ page }) => {
    await openSeeded(page);
    const garden = (await ids(page)).area('Garden');
    const disclosure = area(page, 'Garden').getByRole('button', { name: 'Garden', exact: true });
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    // Garden opens; its scroll waits for the card to finish opening (about 0.36s). Leave for
    // Stats the moment it opens.
    await page.addInitScript((id) => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector(`section[data-area-id="${id}"] button[aria-expanded="true"]`)) return;
        observer.disconnect();
        const stats = Array.from(document.querySelectorAll('nav[aria-label="Tabs"] button')).find(
          (b) => b.textContent === 'Stats',
        );
        (stats as HTMLElement).click();
      });
      observer.observe(document, { subtree: true, childList: true, attributes: true });
    }, garden);
    await page.goto(`/?area=${garden}`);
    await expect(page.getByRole('heading', { name: 'Stats', level: 1 })).toBeVisible();
    await page.waitForTimeout(600);
    await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Home' }).click();
    await expect(homeScreen(page).getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
    await page.waitForTimeout(800);
    // Home is as it was: at the top, nothing lit up.
    await expect(homeScreen(page).getByRole('heading', { name: 'Home', level: 1 })).toBeInViewport();
    await expect(area(page, 'Garden')).not.toHaveAttribute('data-linked');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
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
    await expect(area(page, 'Jacuzzi')).toHaveAttribute('data-linked');
    await expect(area(page, 'Jacuzzi').getByRole('heading', { level: 2 })).toBeInViewport();
  });

  test('a shared link opens what was shared (round trip)', async ({ page }) => {
    await stubShareSheet(page);
    await openSeeded(page);
    const sheet = await openItem(page, 'Change the filter');
    await sheet.getByRole('button', { name: 'Share item' }).click();
    await expect.poll(async () => (await sharedPayloads(page)).length).toBe(1);
    const link = (await sharedPayloads(page))[0].text!.split('\n').pop()!;
    await page.goto(link);
    await settled(itemSheet(page).getByRole('button', { name: 'Close' }));
    await expect(itemSheet(page).getByLabel('Title', { exact: true })).toHaveValue('Change the filter');
  });
});
