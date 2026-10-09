import {
  closeProfile,
  confirmation,
  expect,
  goToTab,
  homeScreen,
  itemSheet,
  NOW,
  openFresh,
  openItem,
  openNewItem,
  openProfile,
  openSeeded,
  ring,
  rowButton,
  statsScreen,
  tabs,
  test,
  toast,
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
    const sheet = await openItem(page, 'Olive oil');
    const status = sheet.getByRole('radiogroup', { name: 'Status' });
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
  });

  test('a finger tap on a ring completes the item', async ({ page }) => {
    await openSeeded(page);
    await ring(page, 'Olive oil').tap();
    await expect(toast(page, 'Done. Next due Sat 12 Dec')).toBeVisible();
    await rowButton(page, 'Mirror lights not level').tap();
    await expect(itemSheet(page)).toBeVisible();
  });

  test('the last item can be scrolled clear of the floating tab bar', async ({ page }) => {
    await openSeeded(page);
    // Scroll Home all the way down.
    await homeScreen(page).evaluate((el) => {
      const scroller = el.firstElementChild as HTMLElement;
      scroller.scrollTop = scroller.scrollHeight;
    });
    const row = (await rowButton(page, 'Trim the hedges').boundingBox())!;
    const bar = (await tabs(page).boundingBox())!;
    expect(row.y + row.height).toBeLessThanOrEqual(bar.y);
  });

  test('signing out in one tab signs out the other', async ({ page, context }) => {
    await openSeeded(page);
    const other = await context.newPage();
    await other.clock.install({ time: NOW });
    await other.goto('/');
    await expect(ring(other, 'Olive oil')).toBeVisible();

    const dialog = await openProfile(page);
    await dialog.getByRole('button', { name: 'Sign Out' }).click();
    await (await confirmation(page, 'Sign out of home.os?')).getByRole('button', { name: 'Sign Out' }).click();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });

  test('the screen behind a sheet or Profile cannot be used', async ({ page }) => {
    await openSeeded(page);
    await openItem(page, 'Olive oil');
    await expect(itemSheet(page)).toBeFocused();
    // Inert while covered: no taps, no focus.
    const coveredTabs = tabs(page).locator('xpath=ancestor::*[@inert]');
    await expect(coveredTabs).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(itemSheet(page)).toHaveCount(0);
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
      const add = (await tabs(page).getByRole('button', { name: 'New item' }).boundingBox())!;
      const stats = (await tabs(page).getByRole('button', { name: 'Stats' }).boundingBox())!;
      expect(stats.x + stats.width).toBeLessThan(add.x);
      expect(add.x + add.width).toBeLessThanOrEqual(width);

      await openItem(page, 'Heaters not working');
      await noSideways('Item sheet');
      await page.keyboard.press('Escape');
      await goToTab(page, 'Stats');
      await noSideways('Stats');
      const dialog = await openProfile(page);
      await noSideways('Profile');
      await dialog.getByRole('button', { name: /^Household/ }).click();
      await noSideways('Household');
    });
  });
}

