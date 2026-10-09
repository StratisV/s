import {
  confirmation,
  area,
  areaHeadings,
  DEFAULT_AREAS,
  expect,
  homeScreen,
  meta,
  openFresh,
  openProfile,
  openSeeded,
  reopen,
  ring,
  settled,
  test,
} from './fixtures';

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

test.describe('Sign-in and setup', () => {
  test('Welcome, Google, profile and a new home with the current list', async ({ page }) => {
    await openFresh(page);

    // Welcome: the app name and Google sign-in.
    await expect(page).toHaveTitle('home.os');
    await expect(page.getByRole('heading', { name: 'home.os', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Continue with Google' }).click();

    // Profile: the name comes from Google; the emoji is picked from the grid.
    const profileStep = page.getByRole('region', { name: 'Your profile' });
    await expect(profileStep.getByRole('heading', { name: 'Your profile' })).toBeVisible();
    await expect(profileStep.getByText('Signed in as stratis@example.com')).toBeVisible();
    const name = profileStep.getByLabel('Name', { exact: true });
    await expect(name).toHaveValue('Stratis');
    const emoji = profileStep.getByRole('radiogroup', { name: 'Your emoji' });
    await expect(emoji.getByRole('radio')).toHaveCount(24);
    await expect(emoji.getByRole('radio', { name: '🦔' })).toBeChecked();
    await emoji.getByRole('radio', { name: '🦊' }).click();
    await expect(emoji.getByRole('radio', { name: '🦊' })).toBeChecked();
    await expect(emoji.getByRole('radio', { name: '🦔' })).not.toBeChecked();

    // A blank name can't continue.
    await name.fill('  ');
    await expect(profileStep.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await name.fill('Stratis');
    await profileStep.getByRole('button', { name: 'Continue' }).click();

    // Household: name, address, the default areas, and the current list switched on.
    const homeStep = page.getByRole('region', { name: 'Your home' });
    await expect(homeStep.getByRole('heading', { name: 'Your home' })).toBeVisible();
    await homeStep.getByLabel('Name', { exact: true }).fill('Alderbrook');
    await homeStep.getByLabel('Address', { exact: true }).fill('21 Alderbrook Road');
    const areaInputs = homeStep.getByRole('textbox', { name: 'Area name' });
    await expect(areaInputs).toHaveCount(DEFAULT_AREAS.length);
    for (const [i, n] of DEFAULT_AREAS.entries()) await expect(areaInputs.nth(i)).toHaveValue(n);
    const seed = homeStep.getByRole('switch', { name: 'Start with our current list' });
    await expect(seed).toHaveAttribute('aria-checked', 'true');
    await expect(homeStep.getByText(/^Adds the 13 items from our current notes list/)).toBeVisible();
    await homeStep.getByRole('button', { name: 'Create Home' }).click();

    // Notifications step (push is not configured in this build, so it just confirms).
    const done = page.getByRole('region', { name: "You're all set" });
    await expect(done.getByRole('heading', { name: 'You’re all set' })).toBeVisible();
    await done.getByRole('button', { name: 'Continue' }).click();

    // Home: the address, the areas in order and the seeded items.
    const home = homeScreen(page);
    await expect(home.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
    await expect(home.getByText('21 Alderbrook Road', { exact: true })).toBeVisible();
    await expect(areaHeadings(page)).toHaveText(DEFAULT_AREAS);
    await expect(home.getByRole('button', { name: /^Mark .* as done$/ })).toHaveCount(13);
    await expect(ring(page, 'Heaters not working')).toBeVisible();
    await expect(ring(page, 'Mirror lights not level')).toBeVisible();
    await expect(area(page, 'Bedroom Small').getByText('Nothing to do')).toBeVisible();
    // The new profile: the fox avatar and name on the items assigned to "me".
    await expect(page.getByRole('button', { name: 'Profile', exact: true })).toHaveText('🦊');
    await expect(meta(page, 'Kitchen paper')).toHaveText('🦊 Stratis · Thu 5 Nov');

    // It is all still there after a reload.
    await reopen(page);
    await expect(areaHeadings(page)).toHaveText(DEFAULT_AREAS);
    await expect(ring(page, 'Heaters not working')).toBeVisible();
  });

  test('a new home without the current list starts with empty areas', async ({ page }) => {
    await openFresh(page);
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await page.getByRole('region', { name: 'Your profile' }).getByRole('button', { name: 'Continue' }).click();

    const homeStep = page.getByRole('region', { name: 'Your home' });
    const seed = homeStep.getByRole('switch', { name: 'Start with our current list' });
    await seed.click();
    await expect(seed).toHaveAttribute('aria-checked', 'false');
    await expect(homeStep.getByText('Start with an empty list and add things as they come up.')).toBeVisible();
    await homeStep.getByRole('button', { name: 'Create Home' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    const home = homeScreen(page);
    await expect(areaHeadings(page)).toHaveText(DEFAULT_AREAS);
    await expect(home.getByText('Nothing to do', { exact: true })).toHaveCount(DEFAULT_AREAS.length);
    await expect(home.getByRole('button', { name: /^Mark .* as done$/ })).toHaveCount(0);
    // No address entered: no subtitle under the title.
    await expect(home.getByText('21 Alderbrook Road')).toHaveCount(0);
  });

  test('editing the areas during setup decides the areas and which items are seeded', async ({ page }) => {
    await openFresh(page);
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await page.getByRole('region', { name: 'Your profile' }).getByRole('button', { name: 'Continue' }).click();

    const homeStep = page.getByRole('region', { name: 'Your home' });
    await homeStep.getByRole('button', { name: 'Remove Jacuzzi' }).click();
    await homeStep.getByRole('button', { name: 'Remove Hallway' }).click();
    await homeStep.getByRole('button', { name: 'Add Area' }).click();
    const inputs = homeStep.getByRole('textbox', { name: 'Area name' });
    await expect(inputs.last()).toBeFocused();
    await inputs.last().fill('Garage');
    await inputs.last().press('Enter');
    await expect(homeStep.getByText(/^Adds the 10 items/)).toBeVisible();
    await homeStep.getByRole('button', { name: 'Create Home' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    const expected = DEFAULT_AREAS.filter((n) => n !== 'Jacuzzi' && n !== 'Hallway').concat('Garage');
    await expect(areaHeadings(page)).toHaveText(expected);
    await expect(area(page, 'Garage').getByText('Nothing to do')).toBeVisible();
    await expect(homeScreen(page).getByRole('button', { name: /^Mark .* as done$/ })).toHaveCount(10);
    await expect(ring(page, 'Heaters not working')).toHaveCount(0);
  });

  test('Sign Out on the profile step goes back to Welcome', async ({ page }) => {
    await openFresh(page);
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    const profileStep = page.getByRole('region', { name: 'Your profile' });
    await profileStep.getByRole('button', { name: 'Sign Out' }).click();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });

  test('an invite link joins the existing household', async ({ page }) => {
    // Someone in the prototype household made an invite...
    await openSeeded(page);
    const token = await page.evaluate(() => {
      const doc = JSON.parse(localStorage.getItem('homeos.demo.v1')!);
      const token = 'a'.repeat(32);
      const me = doc.members.find((m: { user_id: string }) => m.user_id === doc.session);
      doc.invites.push({
        id: 'invite-1',
        household_id: me.household_id,
        token,
        created_by: me.id,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      });
      // ...and the demo Google account belongs to someone new: hand the owner row to another account.
      me.user_id = 'someone-else';
      doc.session = null;
      localStorage.setItem('homeos.demo.v1', JSON.stringify(doc));
      return token;
    });

    await page.goto(`/?invite=${token}`);
    await expect(page.getByText('You’ve been invited to join a home on home.os.')).toBeVisible();
    // The token is taken out of the address bar.
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    const profileStep = page.getByRole('region', { name: 'Your profile' });
    await profileStep.getByLabel('Name', { exact: true }).fill('Alex');
    await profileStep.getByRole('radio', { name: '🐼' }).click();
    await profileStep.getByRole('button', { name: 'Continue' }).click();

    const join = page.getByRole('region', { name: 'Join Our home' });
    await expect(join.getByRole('heading', { name: 'Join Our home' })).toBeVisible();
    await expect(join.getByText('21 Alderbrook Road')).toBeVisible();
    await join.getByRole('button', { name: 'Join' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(areaHeadings(page)).toHaveText(DEFAULT_AREAS);
    await expect(page.getByRole('button', { name: 'Profile', exact: true })).toHaveText('🐼');
    // The new member can edit everything: complete someone else's item, rename the household.
    await ring(page, 'Heaters not working').click();
    await expect(ring(page, 'Heaters not working')).toHaveCount(0);
    const profileDialog = await openProfile(page);
    await profileDialog.getByRole('button', { name: /^Household/ }).click();
    await settled(profileDialog.getByRole('button', { name: 'Profile' }));
    const householdName = profileDialog.getByLabel('Name', { exact: true });
    await householdName.fill('Alderbrook House');
    await householdName.press('Enter');
    await profileDialog.getByRole('button', { name: 'Profile' }).click();
    await expect(profileDialog.getByRole('button', { name: /^Household/ })).toContainText('Alderbrook House');
    await profileDialog.getByRole('button', { name: 'Done' }).click();
    await expect(profileDialog).toHaveCount(0);

    // ...and shows up in Stats (Shea's item was assigned to Shea, so it counts for Shea).
    await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Stats' }).click();
    await expect(page.getByRole('list', { name: 'Done per person' }).getByRole('listitem')).toHaveText([
      /Stratis\s*4/,
      /Shea\s*3/,
      /Ela\s*1/,
      /Alex\s*0/,
    ]);
  });

  test('an invite link opened by someone already at home just opens Home', async ({ page }) => {
    await openSeeded(page);
    await page.goto('/?invite=0123456789abcdef0123456789abcdef');
    await expect(areaHeadings(page)).toHaveText(DEFAULT_AREAS);
    await expect(page).toHaveURL(/\/$/);
    // Nothing left over: signing out shows a plain Welcome.
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('dialog', { name: 'Profile' }).getByRole('button', { name: 'Sign Out' }).click();
    await (await confirmation(page, 'Sign out of home.os?')).getByRole('button', { name: 'Sign Out' }).click();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByText(/invited to join a home/)).toHaveCount(0);
  });

  test('an invite link that is not valid offers to set up a new home', async ({ page }) => {
    await page.goto('/?demo-reset=1&invite=0123456789abcdef0123456789abcdef');
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await page.getByRole('region', { name: 'Your profile' }).getByRole('button', { name: 'Continue' }).click();
    const invalid = page.getByRole('region', { name: 'Invite link not valid' });
    await expect(invalid.getByRole('heading', { name: 'Invite link not valid' })).toBeVisible();
    await invalid.getByRole('button', { name: 'Set up a new home instead' }).click();
    await expect(page.getByRole('region', { name: 'Your home' }).getByRole('button', { name: 'Create Home' })).toBeVisible();
  });
});
