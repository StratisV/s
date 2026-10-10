import {
  closeProfile,
  confirmation,
  DEMO_STORAGE_KEY,
  expect,
  goToTab,
  homeScreen,
  meta,
  NOW,
  openItem,
  openProfile,
  openSeeded,
  reopen,
  ring,
  rowButton,
  settled,
  statsScreen,
  test,
  type Locator,
  type Page,
} from './fixtures';

// People before they join (docs/ARCHITECTURE.md "People before they join"), in demo mode:
// Household > People > Add Person, their email, Remove, and giving them items.

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
});

/** Opens Profile, then Household inside it. */
async function openPeople(page: Page): Promise<Locator> {
  const dialog = await openProfile(page);
  await dialog.getByRole('button', { name: /^Household/ }).click();
  await expect(dialog.getByRole('heading', { name: 'Household', level: 1 })).toBeVisible();
  const back = dialog.getByRole('button', { name: 'Profile' });
  await expect(back).toBeFocused();
  await settled(back);
  return dialog;
}

function people(dialog: Locator): Locator {
  return dialog.getByRole('region', { name: 'People' });
}

function personRow(dialog: Locator, name: string): Locator {
  return people(dialog).getByRole('button', { name: new RegExp(`^${name}\\b`) });
}

/** The Add Person page, once it has slid in (its Name field focused). */
async function openAddPerson(dialog: Locator): Promise<Locator> {
  await people(dialog).getByRole('button', { name: 'Add Person' }).click();
  const name = dialog.getByPlaceholder('Name', { exact: true });
  await expect(name).toBeFocused();
  await settled(name);
  return dialog;
}

async function addPerson(dialog: Locator, input: { name: string; emoji?: string; email?: string }): Promise<void> {
  await openAddPerson(dialog);
  await dialog.getByPlaceholder('Name', { exact: true }).fill(input.name);
  if (input.emoji) await dialog.getByRole('radiogroup', { name: 'Emoji', exact: true }).getByRole('radio', { name: input.emoji }).click();
  if (input.email) await dialog.getByRole('textbox', { name: 'Google Email' }).fill(input.email);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Add Person', level: 1 })).toHaveCount(0);
}

async function openPersonPage(dialog: Locator, name: string): Promise<void> {
  await personRow(dialog, name).click();
  const back = dialog.getByRole('button', { name: 'Household', exact: true });
  await expect(back).toBeFocused();
  await settled(back);
}

/** From Household back to Profile, then closed. */
async function closePeople(page: Page, dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Household', level: 1 })).toHaveCount(0);
  await closeProfile(page);
}

/** Gives an item to someone from the Item sheet. */
async function assign(page: Page, title: string, option: string): Promise<void> {
  const sheet = await openItem(page, title);
  await sheet.getByLabel('Assigned to', { exact: true }).selectOption({ label: option });
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
}

function chips(page: Page): Locator {
  return homeScreen(page).getByRole('radiogroup', { name: 'Show tasks for' });
}

test.describe('People before they join', () => {
  test('Add Person: name, emoji and Google email; they show as "Not joined yet", also after a reload', async ({ page }) => {
    const dialog = await openPeople(page);
    await expect(people(dialog).getByRole('button')).toHaveText(['🦔Stratis, You', '🦆Shea', '🦊Ela', 'Add Person']);

    await openAddPerson(dialog);
    await expect(dialog.getByRole('heading', { name: 'Add Person', level: 1 })).toBeAttached();
    const grid = dialog.getByRole('radiogroup', { name: 'Emoji', exact: true });
    await expect(grid.getByRole('radio', { name: '🦔' })).toBeChecked();
    const email = dialog.getByRole('textbox', { name: 'Google Email' });
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('placeholder', 'name@gmail.com');
    await expect(
      dialog.getByText('When they sign in with Google using this email, they join as this person, with their items.'),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();

    await dialog.getByPlaceholder('Name', { exact: true }).fill('Robin');
    await grid.getByRole('radio', { name: '🐳' }).click();
    await email.fill(' Robin@Gmail.com ');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Add Person', level: 1 })).toHaveCount(0);

    // Last in People, with the email as stored, and focus on the new row.
    const robin = personRow(dialog, 'Robin');
    await expect(robin).toHaveText('🐳Robin, Not joined yet · , robin@gmail.com');
    await expect(robin).toBeFocused();
    await expect(people(dialog).getByRole('button')).toHaveText([
      '🦔Stratis, You',
      '🦆Shea',
      '🦊Ela',
      /^🐳Robin/,
      'Add Person',
    ]);

    await reopen(page);
    const again = await openPeople(page);
    await expect(personRow(again, 'Robin')).toHaveText('🐳Robin, Not joined yet · , robin@gmail.com');
  });

  test('Add is off until there is a name and a real email; an email someone has is refused', async ({ page }) => {
    const dialog = await openPeople(page);
    await openAddPerson(dialog);
    const add = dialog.getByRole('button', { name: 'Add', exact: true });
    const email = dialog.getByRole('textbox', { name: 'Google Email' });

    await dialog.getByPlaceholder('Name', { exact: true }).fill('Robin');
    await expect(add).toBeEnabled();
    await email.fill('robin@gmail');
    await expect(add).toBeDisabled();
    await email.press('Tab');
    await expect(dialog.getByRole('alert')).toHaveText('Enter the full email address, like name@gmail.com.');

    // Shea already has this one (any case).
    await email.fill('SHEA@example.com');
    await expect(add).toBeEnabled();
    await add.click();
    await expect(dialog.getByRole('alert')).toHaveText('Someone at home already has that email.');
    // Still here, with everything typed.
    await expect(dialog.getByPlaceholder('Name', { exact: true })).toHaveValue('Robin');
    await expect(email).toHaveValue('SHEA@example.com');
    await dialog.getByRole('button', { name: 'Household', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Add Person', level: 1 })).toHaveCount(0);
    await expect(personRow(dialog, 'Robin')).toHaveCount(0);
  });

  test('someone who has not joined can be given items, shows in the filter and is credited in Stats', async ({
    page,
  }) => {
    const dialog = await openPeople(page);
    await addPerson(dialog, { name: 'Robin', emoji: '🐳' });
    await closePeople(page, dialog);

    // The assignee list says who hasn't signed in yet; the row itself doesn't.
    const sheet = await openItem(page, 'Kitchen paper');
    await expect(sheet.getByLabel('Assigned to', { exact: true }).getByRole('option')).toHaveText([
      '🦔 Stratis',
      '🦆 Shea',
      '🦊 Ela',
      '🐳 Robin · Not joined yet',
      'Unassigned',
    ]);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
    await assign(page, 'Kitchen paper', '🐳 Robin · Not joined yet');
    await expect(meta(page, 'Kitchen paper')).toHaveText('🐳 Robin · Thu 5 Nov');

    // In the person filter like anyone else (VoiceOver hears "not joined yet").
    const chip = chips(page).getByRole('radio', { name: 'Robin, 1 item, not joined yet' });
    await expect(chip).toHaveText('🐳Robin1');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-checked', 'true');
    await expect(rowButton(page, 'Kitchen paper')).toBeVisible();
    await expect(homeScreen(page).locator('[data-meta]')).toHaveText(['🐳 Robin · Thu 5 Nov']);

    // Done for Robin: credited to Robin.
    await ring(page, 'Kitchen paper').click();
    await expect(meta(page, 'Kitchen paper')).toHaveText('🐳 Robin · Sat 5 Dec');
    await goToTab(page, 'Stats');
    await expect(
      statsScreen(page).getByRole('list', { name: 'Done per person' }).getByRole('listitem').last(),
    ).toHaveText('🐳Robin1');
  });

  test('set their email later, then remove them: their items become unassigned', async ({ page }) => {
    let dialog = await openPeople(page);
    await addPerson(dialog, { name: 'Robin', emoji: '🐳' });
    await expect(personRow(dialog, 'Robin')).toHaveText('🐳Robin, Not joined yet · , No email yet');
    await closePeople(page, dialog);
    await assign(page, 'Kitchen paper', '🐳 Robin · Not joined yet');

    dialog = await openPeople(page);
    await openPersonPage(dialog, 'Robin');
    await expect(dialog.getByText('Not joined yet', { exact: true })).toBeVisible();
    const email = dialog.getByRole('textbox', { name: 'Google Email' });
    await expect(email).toHaveValue('');
    await email.fill('robin@gmail.com');
    await email.press('Enter');
    await expect(email).not.toBeFocused();
    await dialog.getByRole('button', { name: 'Household', exact: true }).click();
    await expect(personRow(dialog, 'Robin')).toHaveText('🐳Robin, Not joined yet · , robin@gmail.com');

    // Someone who has joined has neither.
    await openPersonPage(dialog, 'Shea');
    await expect(dialog.getByRole('textbox', { name: 'Google Email' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Household', exact: true }).click();

    await openPersonPage(dialog, 'Robin');
    await dialog.getByRole('button', { name: 'Remove Robin' }).click();
    const sheet = await confirmation(page, 'Remove Robin?');
    await expect(sheet).toContainText('Their items become unassigned.');
    await sheet.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Robin', level: 1 })).toHaveCount(0);
    await expect(personRow(dialog, 'Robin')).toHaveCount(0);
    await expect(people(dialog).getByRole('button', { name: 'Add Person' })).toBeFocused();
    await closePeople(page, dialog);

    await expect(meta(page, 'Kitchen paper')).toHaveText('Unassigned · Thu 5 Nov');
    await expect(chips(page).getByRole('radio', { name: /^Robin/ })).toHaveCount(0);
  });
});

test.describe('Joining as someone who was added', () => {
  test('signing in with the email someone added makes you that person, after a short welcome', async ({ page }) => {
    // Stratis's row as if someone at home had added him with his email and he hasn't signed in.
    await page.evaluate((key) => {
      const doc = JSON.parse(localStorage.getItem(key)!);
      const me = doc.members.find((m: { user_id: string | null }) => m.user_id === doc.session);
      me.user_id = null;
      me.emoji = '🦉';
      localStorage.setItem(key, JSON.stringify(doc));
    }, DEMO_STORAGE_KEY);
    await reopen(page);

    const welcome = page.getByRole('region', { name: 'Welcome home, Stratis' });
    await expect(welcome.getByRole('heading', { name: 'Welcome home, Stratis', level: 1 })).toBeVisible();
    await expect(welcome.getByText('Our home is all set up for you. Pick your emoji.')).toBeVisible();
    const grid = welcome.getByRole('radiogroup', { name: 'Your emoji' });
    await expect(grid.getByRole('radio', { name: '🦉' })).toBeChecked();
    // No profile to fill in and no home to set up.
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await grid.getByRole('radio', { name: '🐳' }).click();
    await welcome.getByRole('button', { name: 'Continue' }).click();

    const done = page.getByRole('region', { name: "You're all set" });
    await done.getByRole('button', { name: 'Continue' }).click();
    // In the home as Stratis, with his items and the new emoji.
    await expect(homeScreen(page).getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Profile', exact: true })).toHaveText('🐳');
    await expect(meta(page, 'Kitchen paper')).toHaveText('🐳 Stratis · Thu 5 Nov');
  });
});

test.describe('People on two phones', () => {
  test('a person added, given an email or removed on one shows on the other without a reload', async ({
    page,
    context,
  }) => {
    // Two pages of one browser share the demo's storage, like two phones share the database.
    const other = await context.newPage();
    await other.clock.install({ time: NOW });
    await other.goto('/');
    await expect(homeScreen(other).getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();

    const dialog = await openPeople(page);
    await addPerson(dialog, { name: 'Robin', emoji: '🐳' });
    const chip = chips(other).getByRole('radio', { name: /^Robin, 0 items, not joined yet$/ });
    await expect(chip).toBeVisible();

    const otherPeople = await openPeople(other);
    await expect(personRow(otherPeople, 'Robin')).toHaveText('🐳Robin, Not joined yet · , No email yet');
    await openPersonPage(dialog, 'Robin');
    const email = dialog.getByRole('textbox', { name: 'Google Email' });
    await email.fill('robin@gmail.com');
    await email.press('Enter');
    await expect(personRow(otherPeople, 'Robin')).toHaveText('🐳Robin, Not joined yet · , robin@gmail.com');

    await dialog.getByRole('button', { name: 'Remove Robin' }).click();
    await (await confirmation(page, 'Remove Robin?')).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(personRow(otherPeople, 'Robin')).toHaveCount(0);
    await other.close();
  });
});

test.describe('People at 320 px', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('Add Person and a long email fit without sideways scrolling', async ({ page }) => {
    const dialog = await openPeople(page);
    await addPerson(dialog, { name: 'Robin', email: 'robin.with.a.rather.long.address@gmail.com' });
    const row = personRow(dialog, 'Robin');
    await expect(row).toBeVisible();
    const box = (await row.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);

    await openAddPerson(dialog);
    // Back, title and Add side by side in the bar, all on screen.
    const back = (await dialog.getByRole('button', { name: 'Household', exact: true }).boundingBox())!;
    const add = (await dialog.getByRole('button', { name: 'Add', exact: true }).boundingBox())!;
    expect(back.x).toBeGreaterThanOrEqual(0);
    expect(add.x + add.width).toBeLessThanOrEqual(320);
    expect(back.x + back.width).toBeLessThanOrEqual(add.x);
    // No page in the cover scrolls sideways (long text is cut with an ellipsis instead).
    const sideways = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] *'))
        .filter((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX))
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.className),
    );
    expect(sideways).toEqual([]);
  });
});
