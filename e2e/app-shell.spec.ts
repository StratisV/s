import {
  areaCard,
  areaCards,
  attentionScreen,
  closeArea,
  closeProfile,
  confirmation,
  expect,
  goToTab,
  homeScreen,
  itemSheet,
  NOW,
  openArea,
  openAttention,
  openFresh,
  openItem,
  openNewItem,
  openProfile,
  openSeeded,
  ring,
  rowButton,
  statsScreen,
  tabButton,
  tabs,
  test,
  toast,
  addButton,
  type TabName,
} from './fixtures';

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

test.describe('App shell', () => {
  test('the app is called home.os, also when installed', async ({ page, request }) => {
    await openFresh(page);
    await expect(page).toHaveTitle('home.os');
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest).toMatchObject({ name: 'home.os', short_name: 'home.os', display: 'standalone' });
    for (const icon of manifest.icons as { src: string }[]) {
      const res = await request.get(`/${icon.src}`);
      expect(res.status(), icon.src).toBe(200);
      expect(res.headers()['content-type']).toContain('image/png');
    }
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon.png');
    expect((await request.get('/icons/apple-touch-icon.png')).status()).toBe(200);
  });

  test('tabs switch between Home and Stats; the + button stays', async ({ page }) => {
    await openSeeded(page);
    await expect(tabs(page).getByRole('button', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
    await goToTab(page, 'Stats');
    await expect(statsScreen(page)).toBeVisible();
    await expect(homeScreen(page)).toHaveCount(0);
    // New item from Stats too.
    const sheet = await openNewItem(page);
    await sheet.getByLabel('Title', { exact: true }).fill('Order more salt');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
    await goToTab(page, 'Home');
    // In the first area, Kitchen.
    await openArea(page, 'Kitchen');
    await expect(ring(page, 'Order more salt')).toBeVisible();
  });

  test('Escape on a confirmation only closes the confirmation', async ({ page }) => {
    await openSeeded(page);
    const sheet = await openNewItem(page);
    await sheet.getByLabel('Title', { exact: true }).fill('Paint the fence');
    await sheet.getByRole('button', { name: 'Close' }).click();
    const confirm = await confirmation(page, 'Discard this item?');
    // Focus starts on the least destructive choice.
    await expect(confirm.getByRole('button', { name: 'Keep Editing' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(confirm).toHaveCount(0);
    await expect(sheet.getByLabel('Title', { exact: true })).toHaveValue('Paint the fence');
  });

  test('dragging the sheet down dismisses it (and asks first when there are changes)', async ({ page }) => {
    await openSeeded(page);
    await openArea(page, 'Kitchen');
    const sheet = await openItem(page, 'Olive oil');
    await expect(sheet).toBeFocused();
    const handle = sheet.locator('[data-sheet-handle]');
    await handle.hover(); // waits for the sheet to finish sliding up
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 220, { steps: 8 });
    await page.mouse.up();
    await expect(sheet).toHaveCount(0);

    await openItem(page, 'Olive oil');
    await sheet.getByLabel('Note', { exact: true }).fill('Get the 5L tin.');
    await handle.hover();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 220, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeVisible();
  });

  test('swiping the sheet down with a finger dismisses it', async ({ page, context }) => {
    await openSeeded(page);
    await openArea(page, 'Kitchen');
    const sheet = await openItem(page, 'Olive oil');
    const status = sheet.getByRole('radiogroup', { name: 'How urgent?' });
    await status.hover(); // waits for the sheet to finish sliding up
    const box = (await status.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const x = box.x + 30;
    const y = box.y + box.height / 2;
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', dy = 0) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: y + dy }] });
    await touch('touchStart');
    for (let i = 1; i <= 10; i++) await touch('touchMove', i * 25);
    await touch('touchEnd');
    await expect(sheet).toHaveCount(0);
    // Only the item's sheet: the area's is still there.
    await expect(page.getByRole('dialog', { name: 'Kitchen' })).toBeVisible();
  });

  test('a finger tap on a ring completes the item', async ({ page }) => {
    await openSeeded(page);
    await openArea(page, 'Kitchen');
    await ring(page, 'Olive oil').tap();
    await expect(toast(page, 'Done. Next one in 2 months')).toBeVisible();
    await closeArea(page);
    await openArea(page, 'Living Room');
    await rowButton(page, 'Mirror lights not level').tap();
    await expect(itemSheet(page)).toBeVisible();
  });

  test('the last card, and the last row, can be scrolled clear of the round + and the tab bar', async ({ page }) => {
    await openSeeded(page);
    const toBottom = (screen: ReturnType<typeof homeScreen>) =>
      screen.evaluate((el) => {
        const scroller = el.firstElementChild as HTMLElement;
        scroller.scrollTop = scroller.scrollHeight;
      });
    await toBottom(homeScreen(page));
    const card = (await areaCards(page).last().boundingBox())!;
    const add = (await addButton(page).boundingBox())!;
    expect(card.y + card.height).toBeLessThanOrEqual(add.y);
    // Needs attention's list too: its last row (Later opened).
    await openAttention(page);
    await attentionScreen(page).getByRole('button', { name: /^Show \d+ more$/ }).click();
    await toBottom(attentionScreen(page));
    const last = (await attentionScreen(page).locator('[data-item-open]').last().boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual((await addButton(page).boundingBox())!.y);
  });

  test('the tab bar sits on the foot of every tab, flush with the bottom edge and full width, and stays there as pages scroll', async ({ page }) => {
    await openSeeded(page);
    const hero = homeScreen(page).locator('[data-phase]').first();
    expect((await hero.boundingBox())!.y).toBe(0); // the hero reaches the top of the screen
    const at = async () => {
      const box = (await tabs(page).boundingBox())!;
      return [Math.round(box.x), Math.round(box.y + box.height), Math.round(box.width), Math.round(box.height)];
    };
    expect(await at()).toEqual([0, 874, 402, 56]);
    await homeScreen(page).evaluate((el) => {
      (el.firstElementChild as HTMLElement).scrollTop = 900;
    });
    expect(await at()).toEqual([0, 874, 402, 56]);
    // The round + over it, 16px in from the right edge.
    const add = (await addButton(page).boundingBox())!;
    expect(Math.round(add.x + add.width)).toBe(402 - 16);
    expect(add.y + add.height).toBeLessThanOrEqual(874 - 56 - 8);
    for (const name of ['Attention', 'Chat', 'Housekeeping', 'Stats'] as TabName[]) {
      await goToTab(page, name);
      expect(await at(), name).toEqual([0, 874, 402, 56]);
      // Each tab keeps Profile in reach, at the top right.
      const profile = (await page.getByRole('button', { name: 'Profile', exact: true }).boundingBox())!;
      expect(profile.y, name).toBeLessThan(60);
    }
    // Chat's composer floats over the bar.
    await goToTab(page, 'Chat');
    const composer = (await page.getByRole('form', { name: 'New message' }).boundingBox())!;
    expect(composer.y + composer.height).toBeLessThanOrEqual(874 - 56);
  });

  test('the open tab is in the tint, on a soft highlight; every tab a target of 44 by 44 or more', async ({ page }) => {
    await openSeeded(page);
    for (const name of ['Home', 'Attention', 'Chat', 'Housekeeping', 'Stats'] as TabName[]) {
      await goToTab(page, name);
      const open = tabButton(page, name);
      await expect(open).toHaveCSS('color', 'rgb(0, 122, 255)');
      const box = (await open.boundingBox())!;
      expect(box.width, name).toBeGreaterThanOrEqual(44);
      expect(box.height, name).toBeGreaterThanOrEqual(44);
      // The highlight sits under it once it has slid there.
      const highlight = tabs(page).locator(':scope > span[aria-hidden="true"]');
      await expect
        .poll(async () => {
          const h = (await highlight.boundingBox())!;
          return Math.abs(h.x - box.x) + Math.abs(h.width - box.width);
        })
        .toBeLessThan(1);
      for (const other of ['Home', 'Chat', 'Stats'] as TabName[]) {
        if (other !== name) await expect(tabButton(page, other)).toHaveCSS('color', 'rgb(28, 28, 30)');
      }
    }
  });

  test('signing out in one tab signs out the other', async ({ page, context }) => {
    await openSeeded(page);
    const other = await context.newPage();
    await other.clock.install({ time: NOW });
    await other.goto('/');
    await expect(areaCard(other, 'Kitchen')).toBeVisible();

    const dialog = await openProfile(page);
    await dialog.getByRole('button', { name: 'Sign Out' }).click();
    await (await confirmation(page, 'Sign out of home.os?')).getByRole('button', { name: 'Sign Out' }).click();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });

  test('the screen behind a sheet or Profile cannot be used', async ({ page }) => {
    await openSeeded(page);
    await openNewItem(page);
    // Focus is in the sheet (a new item starts on its title).
    await expect(itemSheet(page, 'New item').getByLabel('Title', { exact: true })).toBeFocused();
    // Inert while covered: no taps, no focus.
    const coveredTabs = tabs(page).locator('xpath=ancestor::*[@inert]');
    await expect(coveredTabs).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(itemSheet(page, 'New item')).toHaveCount(0);
    await expect(coveredTabs).toHaveCount(0);

    // An area's sheet, and an item's over it.
    await openArea(page, 'Kitchen');
    await expect(coveredTabs).toHaveCount(1);
    await openItem(page, 'Olive oil');
    await expect(page.getByRole('dialog', { name: 'Kitchen' })).toHaveAttribute('inert', '');
    await page.keyboard.press('Escape');
    await expect(itemSheet(page)).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Kitchen' })).not.toHaveAttribute('inert');
    await expect(coveredTabs).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Kitchen' })).toHaveCount(0);
    await expect(coveredTabs).toHaveCount(0);

    await openProfile(page);
    await expect(coveredTabs).toHaveCount(1);
    await closeProfile(page);
    await expect(coveredTabs).toHaveCount(0);
    await goToTab(page, 'Stats');
  });
});

test.describe('Setup details', () => {
  test('Back from the household step keeps what was typed', async ({ page }) => {
    await openFresh(page);
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    const profileStep = page.getByRole('region', { name: 'Your profile' });
    await profileStep.getByLabel('Name', { exact: true }).fill('Strat');
    await profileStep.getByRole('radio', { name: '🐸' }).click();
    await profileStep.getByRole('button', { name: 'Continue' }).click();

    const homeStep = page.getByRole('region', { name: 'Your home' });
    await homeStep.getByLabel('Address', { exact: true }).fill('7 Mill Lane');
    await homeStep.getByRole('button', { name: 'Back' }).click();
    await expect(profileStep.getByLabel('Name', { exact: true })).toHaveValue('Strat');
    await expect(profileStep.getByRole('radio', { name: '🐸' })).toBeChecked();
    await profileStep.getByRole('button', { name: 'Continue' }).click();
    await expect(homeStep.getByLabel('Address', { exact: true })).toHaveValue('7 Mill Lane');
  });

  test('a home needs at least one area', async ({ page }) => {
    await openFresh(page);
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await page.getByRole('region', { name: 'Your profile' }).getByRole('button', { name: 'Continue' }).click();
    const homeStep = page.getByRole('region', { name: 'Your home' });
    const removes = homeStep.getByRole('button', { name: /^Remove / });
    while ((await removes.count()) > 0) await removes.first().click();
    await expect(homeStep.getByRole('alert')).toHaveText('Add at least one area.');
    await expect(homeStep.getByRole('button', { name: 'Create Home' })).toBeDisabled();
    await expect(homeStep.getByRole('switch', { name: 'Start with our current list' })).toBeDisabled();
  });
});

for (const width of [320, 375]) {
  test.describe(`${width}px wide`, () => {
    test.use({ viewport: { width, height: 667 } });

    test('no screen scrolls sideways', async ({ page }) => {
      const noSideways = async (screen: string) => {
        const { scroll, inner } = await page.evaluate(() => ({
          scroll: document.scrollingElement!.scrollWidth,
          inner: window.innerWidth,
        }));
        expect(scroll, screen).toBeLessThanOrEqual(inner);
      };
      await openFresh(page);
      await noSideways('Welcome');
      await page.getByRole('button', { name: 'Continue with Google' }).click();
      await page.getByRole('region', { name: 'Your profile' }).getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('heading', { name: 'Your home' })).toBeVisible();
      await noSideways('Your home');

      await openSeeded(page);
      await noSideways('Home');
      // The tab bar and the add button both fit.
      const add = (await addButton(page).boundingBox())!;
      const bar = (await tabs(page).boundingBox())!;
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(width);
      expect(add.x + add.width).toBeLessThanOrEqual(width);

      await openArea(page, 'Hallway');
      await noSideways('Area sheet');
      await openItem(page, 'Heaters not working');
      await noSideways('Item sheet');
      await page.keyboard.press('Escape');
      await expect(itemSheet(page)).toHaveCount(0);
      await closeArea(page);
      await openAttention(page);
      await noSideways('Needs attention');
      await goToTab(page, 'Stats');
      await noSideways('Stats');
      await goToTab(page, 'Chat');
      await expect(page.getByRole('log', { name: 'Messages' }).getByRole('article').first()).toBeVisible();
      await noSideways('Chat');
      // The composer fits.
      const composer = (await page.getByRole('form', { name: 'New message' }).boundingBox())!;
      expect(composer.x).toBeGreaterThanOrEqual(0);
      expect(composer.x + composer.width).toBeLessThanOrEqual(width);
      const dialog = await openProfile(page);
      await noSideways('Profile');
      await dialog.getByRole('button', { name: /^Household/ }).click();
      await noSideways('Household');
    });
  });
}

