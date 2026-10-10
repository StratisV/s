import {
  area,
  areaHeadings,
  closeProfile,
  confirmation,
  DEFAULT_AREAS,
  expect,
  goToTab,
  homeScreen,
  keepOnlyAreas,
  meta,
  openItem,
  openProfile,
  openSeeded,
  profile,
  reopen,
  ring,
  settled,
  statsScreen,
  test,
  toast,
  type Locator,
  type Page,
} from './fixtures';

test.use({
  timezoneId: 'Europe/London',
  serviceWorkers: 'block',
  permissions: ['clipboard-read', 'clipboard-write'],
});

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
});

/** Opens Profile, then Household inside it. */
async function openHouseholdEditor(page: Page): Promise<Locator> {
  const dialog = await openProfile(page);
  await dialog.getByRole('button', { name: /^Household/ }).click();
  await expect(dialog.getByRole('heading', { name: 'Household', level: 1 })).toBeVisible();
  const back = dialog.getByRole('button', { name: 'Profile' });
  await expect(back).toBeFocused();
  await settled(back);
  return dialog;
}

function areaNames(dialog: Locator): Locator {
  return dialog.getByRole('textbox', { name: 'Area name' });
}

function areaRow(dialog: Locator, name: string): Locator {
  return dialog.getByRole('listitem').filter({ has: dialog.page().getByRole('button', { name: `Delete ${name}`, exact: true }) });
}

test.describe('Profile', () => {
  test('shows the avatar, name and emoji grid', async ({ page }) => {
    const dialog = await openProfile(page);
    await expect(dialog.getByRole('textbox', { name: 'Your name' })).toHaveValue('Stratis');
    const grid = dialog.getByRole('radiogroup', { name: 'Your emoji' });
    await expect(grid.getByRole('radio')).toHaveCount(24);
    await expect(grid.getByRole('radio', { name: '🦔' })).toBeChecked();
    await expect(dialog.getByText('Shown next to your name on items and in Stats.')).toBeVisible();
    await closeProfile(page);
  });

  test('a new emoji shows on the Home avatar, the meta lines and in Stats', async ({ page }) => {
    const dialog = await openProfile(page);
    const grid = dialog.getByRole('radiogroup', { name: 'Your emoji' });
    await grid.getByRole('radio', { name: '🐙' }).click();
    await expect(grid.getByRole('radio', { name: '🐙' })).toBeChecked();
    await expect(grid.getByRole('radio', { name: '🦔' })).not.toBeChecked();
    await closeProfile(page);

    await expect(page.getByRole('button', { name: 'Profile', exact: true })).toHaveText('🐙');
    await expect(meta(page, 'Kitchen paper')).toHaveText('🐙 Stratis · Thu 5 Nov');
    await expect(meta(page, 'Garden room wall panel')).toHaveText('🐙 Stratis · Fri 30 Oct');
    // Other people keep theirs.
    await expect(meta(page, 'Heaters not working')).toHaveText('🦆 Shea · Missed · Tue 6 Oct');

    await goToTab(page, 'Stats');
    await expect(statsScreen(page).getByRole('list', { name: 'Done per person' }).getByRole('listitem').first()).toHaveText(
      '🐙Stratis4',
    );
  });

  test('editing the name updates the items and Stats', async ({ page }) => {
    const dialog = await openProfile(page);
    const name = dialog.getByRole('textbox', { name: 'Your name' });
    await name.fill('Stratos');
    await name.press('Enter');
    await expect(name).not.toBeFocused();
    await closeProfile(page);
    await expect(meta(page, 'Kitchen paper')).toHaveText('🦔 Stratos · Thu 5 Nov');

    // A blank name is not saved.
    const again = await openProfile(page);
    const field = again.getByRole('textbox', { name: 'Your name' });
    await field.fill('');
    await field.press('Enter');
    await expect(field).toHaveValue('Stratos');
    await closeProfile(page);
    await expect(meta(page, 'Kitchen paper')).toHaveText('🦔 Stratos · Thu 5 Nov');

    // The item sheet's assignee list follows too.
    const sheet = await openItem(page, 'Kitchen paper');
    await expect(sheet.getByLabel('Assigned to', { exact: true }).getByRole('option').first()).toHaveText('🦔 Stratos');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);

    await goToTab(page, 'Stats');
    await expect(statsScreen(page).getByRole('img', { name: /Stratos 4, Shea 2, Ela 1\.$/ })).toBeVisible();
  });

  test('weekly email can be switched off and stays off', async ({ page }) => {
    let dialog = await openProfile(page);
    const weekly = () => profile(page).getByRole('switch', { name: 'Weekly email' });
    await expect(weekly()).toHaveAttribute('aria-checked', 'true');
    await weekly().click();
    await expect(weekly()).toHaveAttribute('aria-checked', 'false');
    await closeProfile(page);

    dialog = await openProfile(page);
    await expect(weekly()).toHaveAttribute('aria-checked', 'false');
    await closeProfile(page);

    await reopen(page);
    dialog = await openProfile(page);
    await expect(weekly()).toHaveAttribute('aria-checked', 'false');
    await weekly().click();
    await expect(weekly()).toHaveAttribute('aria-checked', 'true');
    await expect(dialog).toBeVisible();
  });

  test('push notifications explain when they are not available', async ({ page }) => {
    const dialog = await openProfile(page);
    // This build has no VAPID key.
    await expect(dialog.getByRole('switch', { name: 'Push notifications' })).toBeDisabled();
    await expect(dialog.getByText(/^Push notifications aren.t set up yet\.$/)).toBeVisible();
  });

  test('Invite someone copies a reusable invite link', async ({ page, baseURL }) => {
    const dialog = await openProfile(page);
    await dialog.getByRole('button', { name: 'Invite someone' }).click();
    await expect(toast(page, 'Invite link copied')).toBeVisible();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(new RegExp(`^${baseURL}/\\?invite=[0-9a-f]{32}$`));

    // Tapping again shares the same link.
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await dialog.getByRole('button', { name: 'Invite someone' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  });

  // Two emoji taps ~12ms apart: with the demo backend's 0-20ms simulated latency, a load
  // that started before the second edit can finish after it. HomeProvider drops such stale
  // loads, so the screen always ends on the last value.
  test('quick successive edits end on the last value', async ({ page }) => {
    // 60 rounds with a 300ms pause each take about 27s on their own, too close to the
    // default 30s when other suites share the machine.
    test.setTimeout(60_000);
    const dialog = await openProfile(page);
    const grid = dialog.getByRole('radiogroup', { name: 'Your emoji' });
    const pairs = [['🦊', '🐻'], ['🐼', '🐨'], ['🐸', '🐢'], ['🐙', '🦉'], ['🐝', '🦋']];
    for (let round = 0; round < 60; round++) {
      const [first, second] = pairs[round % pairs.length];
      await page.evaluate(async ([a, b]) => {
        const cell = (e: string) =>
          Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]')).find((el) => el.textContent === e);
        cell(a)?.click();
        await new Promise((r) => setTimeout(r, 12));
        cell(b)?.click();
      }, [first, second]);
      await page.waitForTimeout(300);
      await expect(grid.getByRole('radio', { name: second }), `round ${round}`).toBeChecked({ timeout: 1_000 });
    }
  });

  test('Done and Escape close Profile', async ({ page }) => {
    await openProfile(page);
    await closeProfile(page);
    const dialog = await openProfile(page);
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(profile(page)).toHaveCount(0);
  });
});

test.describe('Household editor', () => {
  test('renames the household and changes the address', async ({ page }) => {
    const dialog = await openHouseholdEditor(page);
    const name = dialog.getByLabel('Name', { exact: true });
    const address = dialog.getByLabel('Address', { exact: true });
    await expect(name).toHaveValue('Our home');
    await expect(address).toHaveValue('21 Alderbrook Road');
    await expect(dialog.getByLabel('Time zone', { exact: true })).toHaveValue('Europe/London');

    await name.fill('The Burrow');
    await name.press('Enter');
    await address.fill('22 Alderbrook Road');
    await address.press('Enter');

    await dialog.getByRole('button', { name: 'Profile' }).click();
    await expect(dialog.getByRole('button', { name: /^Household/ })).toContainText('The Burrow');
    await closeProfile(page);
    await expect(homeScreen(page).getByText('22 Alderbrook Road', { exact: true })).toBeVisible();

    await reopen(page);
    await expect(homeScreen(page).getByText('22 Alderbrook Road', { exact: true })).toBeVisible();
  });

  test('a blank address removes the subtitle; a blank name is not saved', async ({ page }) => {
    const dialog = await openHouseholdEditor(page);
    const name = dialog.getByLabel('Name', { exact: true });
    await name.fill('');
    await name.press('Enter');
    await expect(name).toHaveValue('Our home');
    const address = dialog.getByLabel('Address', { exact: true });
    await address.fill('');
    await address.press('Enter');
    await page.keyboard.press('Escape'); // back to Profile
    await page.keyboard.press('Escape'); // close
    await expect(profile(page)).toHaveCount(0);
    await expect(homeScreen(page).getByText('21 Alderbrook Road')).toHaveCount(0);
  });

  test('adds, renames and deletes areas', async ({ page }) => {
    const dialog = await openHouseholdEditor(page);
    await expect(areaNames(dialog)).toHaveCount(DEFAULT_AREAS.length);
    for (const [i, n] of DEFAULT_AREAS.entries()) await expect(areaNames(dialog).nth(i)).toHaveValue(n);

    // Add: a "New area" row appears with its name selected, ready to type over.
    await dialog.getByRole('button', { name: 'Add Area' }).click();
    const added = areaNames(dialog).last();
    await expect(added).toHaveValue('New area');
    await expect(added).toBeFocused();
    await page.keyboard.type('Garage');
    await page.keyboard.press('Enter');
    await expect(added).toHaveValue('Garage');

    // Rename.
    const front = areaRow(dialog, 'Front garden').getByRole('textbox', { name: 'Area name' });
    await front.fill('Front yard');
    await front.press('Enter');
    await expect(dialog.getByRole('button', { name: 'Delete Front yard' })).toBeVisible();

    // Delete an empty area.
    await dialog.getByRole('button', { name: 'Delete Bedroom Small' }).click();
    let confirm = await confirmation(page, 'Delete Bedroom Small?');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete Area' }).click();
    await expect(dialog.getByRole('button', { name: 'Delete Bedroom Small' })).toHaveCount(0);

    // Deleting an area with items says so; Cancel keeps it.
    await dialog.getByRole('button', { name: 'Delete Hallway' }).click();
    confirm = await confirmation(page, 'Delete Hallway?');
    await expect(confirm).toContainText('Its 1 item will be deleted too.');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog.getByRole('button', { name: 'Delete Hallway' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete Hallway' }).click();
    await (await confirmation(page, 'Delete Hallway?')).getByRole('button', { name: 'Delete Area' }).click();
    await expect(dialog.getByRole('button', { name: 'Delete Hallway' })).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Profile' }).click();
    await closeProfile(page);
    const expected = DEFAULT_AREAS.filter((n) => n !== 'Bedroom Small' && n !== 'Hallway')
      .map((n) => (n === 'Front garden' ? 'Front yard' : n))
      .concat('Garage');
    await expect(areaHeadings(page)).toHaveText(expected);
    await expect(area(page, 'Garage').getByText('Nothing to do')).toBeVisible();
    await expect(ring(page, 'Trim the hedges')).toBeVisible(); // kept its items through the rename
    await expect(ring(page, 'Heaters not working')).toHaveCount(0);

    await reopen(page);
    await expect(areaHeadings(page)).toHaveText(expected);
  });

  test('the last area cannot be deleted', async ({ page }) => {
    await keepOnlyAreas(page, ['Kitchen', 'Garden']);
    await expect(areaHeadings(page)).toHaveText(['Kitchen', 'Garden']);
    const dialog = await openHouseholdEditor(page);
    const caption = 'Items live in an area, so keep at least one.';
    await expect(dialog.getByText(caption)).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Delete Garden', exact: true }).click();
    await (await confirmation(page, 'Delete Garden?')).getByRole('button', { name: 'Delete Area' }).click();
    await expect(areaNames(dialog)).toHaveCount(1);

    const last = dialog.getByRole('button', { name: 'Delete Kitchen', exact: true });
    await expect(last).toBeDisabled();
    await expect(last).toHaveAccessibleDescription(caption);
    await expect(dialog.getByText(caption)).toBeVisible();
    await last.click({ force: true });
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    // Adding an area makes the minus work again.
    await dialog.getByRole('button', { name: 'Add Area' }).click();
    await expect(areaNames(dialog).last()).toBeFocused();
    await page.keyboard.type('Garage');
    await page.keyboard.press('Enter');
    await expect(last).toBeEnabled();
    await expect(dialog.getByText(caption)).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Profile', exact: true }).click();
    await closeProfile(page);
    await expect(areaHeadings(page)).toHaveText(['Kitchen', 'Garage']);
    await expect(homeScreen(page).getByText('No areas yet')).toHaveCount(0);
  });

  test('reorders areas with the arrow keys on the grip', async ({ page }) => {
    const dialog = await openHouseholdEditor(page);
    const grip = dialog.getByRole('button', { name: 'Reorder Jacuzzi' });
    await grip.focus();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(grip).toBeFocused();
    const order = [...DEFAULT_AREAS];
    order.splice(order.indexOf('Jacuzzi'), 1);
    order.splice(order.indexOf('Garden'), 0, 'Jacuzzi');
    for (const [i, n] of order.entries()) await expect(areaNames(dialog).nth(i)).toHaveValue(n);

    // And the first area can move down.
    await dialog.getByRole('button', { name: 'Reorder Kitchen' }).focus();
    await page.keyboard.press('ArrowDown');
    order.splice(0, 2, order[1], order[0]);
    for (const [i, n] of order.entries()) await expect(areaNames(dialog).nth(i)).toHaveValue(n);

    await dialog.getByRole('button', { name: 'Profile' }).click();
    await closeProfile(page);
    await expect(areaHeadings(page)).toHaveText(order);
    await reopen(page);
    await expect(areaHeadings(page)).toHaveText(order);
  });

  test('reorders areas by dragging the grip', async ({ page }) => {
    const dialog = await openHouseholdEditor(page);
    const grip = dialog.getByRole('button', { name: 'Reorder Living Room' });
    const target = dialog.getByRole('button', { name: 'Reorder Bathroom Large' });
    // hover() waits for the pushed page to stop moving.
    await grip.hover();
    const from = (await grip.boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, to.y + to.height / 2 + 6, { steps: 12 });
    await page.mouse.up();
    const order = ['Kitchen', 'Bathroom Small', 'Bathroom Large', 'Living Room', ...DEFAULT_AREAS.slice(4)];
    for (const [i, n] of order.entries()) await expect(areaNames(dialog).nth(i)).toHaveValue(n);
    await dialog.getByRole('button', { name: 'Profile' }).click();
    await closeProfile(page);
    await expect(areaHeadings(page)).toHaveText(order);
  });
});

test.describe('People', () => {
  test('lists everyone in the household; your own row says You', async ({ page }) => {
    const dialog = await openHouseholdEditor(page);
    const people = dialog.getByRole('region', { name: 'People' });
    await expect(people.getByRole('button')).toHaveText(['🦔Stratis, You', '🦆Shea', '🦊Ela']);

    await people.getByRole('button', { name: /Stratis/ }).click();
    await expect(dialog.getByRole('heading', { name: 'Stratis', level: 1 })).toBeVisible();
    await expect(dialog.getByRole('radiogroup', { name: 'Your emoji' }).last()).toBeVisible();
    await page.keyboard.press('Escape'); // back to Household
    await expect(people.getByRole('button', { name: /Stratis/ })).toBeFocused();
  });

  test('anyone can change another member’s name and emoji; Home and Stats follow', async ({ page }) => {
    const dialog = await openHouseholdEditor(page);
    const people = dialog.getByRole('region', { name: 'People' });
    await people.getByRole('button', { name: /Shea/ }).click();
    await expect(dialog.getByRole('heading', { name: 'Shea', level: 1 })).toBeVisible();
    const back = dialog.getByRole('button', { name: 'Household', exact: true });
    await expect(back).toBeFocused();
    await settled(back);

    // The member page is the last page in the cover; the Household editor under it is inert.
    const name = dialog.getByRole('textbox', { name: 'Name', exact: true }).last();
    await expect(name).toHaveValue('Shea');
    await expect(name).toHaveAttribute('maxlength', '40');
    await name.fill('Shay');
    await name.press('Enter');
    const grid = dialog.getByRole('radiogroup', { name: 'Emoji', exact: true });
    await expect(grid.getByRole('radio', { name: '🦆' })).toBeChecked();
    await grid.getByRole('radio', { name: '🐧' }).click();
    await expect(grid.getByRole('radio', { name: '🐧' })).toBeChecked();
    await expect(dialog.getByText('Shown next to their name on items and in Stats.')).toBeVisible();

    await back.click();
    const row = people.getByRole('button', { name: /Shay/ });
    await expect(row).toHaveText('🐧Shay');
    await expect(row).toBeFocused();
    await dialog.getByRole('button', { name: 'Profile', exact: true }).click();
    await closeProfile(page);

    // Home: Shea's items show the new name and emoji; your own avatar is unchanged.
    await expect(meta(page, 'Heaters not working')).toHaveText('🐧 Shay · Missed · Tue 6 Oct');
    await expect(meta(page, 'Shower draining slowly')).toHaveText('🐧 Shay · Wed 14 Oct');
    await expect(page.getByRole('button', { name: 'Profile', exact: true })).toHaveText('🦔');

    await goToTab(page, 'Stats');
    const legend = statsScreen(page).getByRole('list', { name: 'Done per person' }).getByRole('listitem');
    await expect(legend).toHaveText(['🦔Stratis4', '🐧Shay2', '🦊Ela1']);
    await expect(statsScreen(page).getByRole('img', { name: /Stratis 4, Shay 2, Ela 1\.$/ })).toBeVisible();

    // Stored, not just on screen (the app reopens on Stats, the tab last open).
    await reopen(page);
    await goToTab(page, 'Home');
    await expect(meta(page, 'Heaters not working')).toHaveText('🐧 Shay · Missed · Tue 6 Oct');
  });
});

test.describe('Sign out', () => {
  test('Sign Out returns to Welcome; signing in again restores the household', async ({ page }) => {
    // Something to recognise the household by.
    let dialog = await openProfile(page);
    await dialog.getByRole('radiogroup', { name: 'Your emoji' }).getByRole('radio', { name: '🐳' }).click();
    await closeProfile(page);
    await ring(page, 'Mirror lights not level').click();
    await expect(ring(page, 'Mirror lights not level')).toHaveCount(0);

    dialog = await openProfile(page);
    await dialog.getByRole('button', { name: 'Sign Out' }).click();
    const confirm = await confirmation(page, 'Sign out of home.os?');
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Sign Out' }).click();
    await (await confirmation(page, 'Sign out of home.os?')).getByRole('button', { name: 'Sign Out' }).click();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'home.os' })).toBeVisible();
    // Still signed out after a reload.
    await reopen(page);
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();

    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await expect(homeScreen(page).getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
    await expect(homeScreen(page).getByText('21 Alderbrook Road', { exact: true })).toBeVisible();
    await expect(areaHeadings(page)).toHaveText(DEFAULT_AREAS);
    await expect(page.getByRole('button', { name: 'Profile', exact: true })).toHaveText('🐳');
    await expect(ring(page, 'Mirror lights not level')).toHaveCount(0);
    await expect(ring(page, 'Heaters not working')).toBeVisible();
  });
});
