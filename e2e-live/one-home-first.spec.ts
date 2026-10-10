import { expect, test } from '@playwright/test';
import { USER_DEMO_DOC } from '../src/lib/logic/importHome.fixture';
import {
  areaHeadings,
  chips,
  closeHousehold,
  confirmation,
  createAccount,
  createInviteAs,
  expectNoReload,
  finishSetup,
  homeIds,
  homeScreen,
  openDevice,
  openHousehold,
  people,
  personRow,
  quiet,
  removeOwnData,
  settled,
  SYNC_MS,
  waitForNoHome,
  type Account,
  type Device,
} from './live';

// The home on the phone still gets there when someone else sets up a home first (the review's
// "lost for good" case): Shea signs in first on her own phone and creates an empty home. Stratis's
// phone, which kept the home in demo mode, is told it can't come over while he is not in a home.
// Shea adds him; once he is in, the home still has nothing in it, so his phone's home takes its
// place, in place, with Shea matched by name. Then Ela, who came along without an email, joins
// through an invite link as herself ("Are you one of these people?"), not as a second Ela.
//
// Runs before one-home.spec.ts (file order) and leaves nothing behind, so that one starts with no home.
test.describe.configure({ mode: 'serial' });

const DEMO_DOC_KEY = 'homeos.demo.v1';
const doc = USER_DEMO_DOC;

let accounts: { stratis: Account; shea: Account; ela: Account };
let stratis: Device;
let shea: Device;

test.beforeAll(async () => {
  await removeOwnData();
  accounts = {
    stratis: await createAccount('first-stratis', 'Stratis Google'),
    shea: await createAccount('first-shea', 'Shea Google'),
    ela: await createAccount('first-ela', 'Ela Google'),
  };
});

test.afterAll(async () => {
  await stratis?.context.close();
  await shea?.context.close();
  await removeOwnData();
});

test('someone else sets up an empty home first: Create Home says to bring a home over first, and asks', async ({
  browser,
  baseURL,
}) => {
  await waitForNoHome();
  shea = await openDevice(browser, baseURL!, accounts.shea);
  const b = shea.page;
  const profile = b.getByRole('region', { name: 'Your profile' });
  await expect(profile.getByRole('textbox', { name: 'Name' })).toHaveValue('Shea');
  await profile.getByRole('button', { name: 'Continue' }).click();

  const home = b.getByRole('region', { name: 'Your home' });
  await expect(home).toContainText('Used home.os on your phone before? Sign in on that phone first to bring your home over.');
  await home.getByRole('textbox', { name: 'Name', exact: true }).fill('Shea’s place');
  await home.getByRole('button', { name: 'Create Home' }).click();
  const sheet = await confirmation(b, 'Create a new home?');
  await expect(sheet).toContainText('If your home is already on another phone, sign in on that phone first to bring it over.');
  await sheet.getByRole('button', { name: 'Create Home', exact: true }).click();
  await finishSetup(b);
  expect((await homeIds()).length).toBe(1);
});

test('the phone that kept the home is told it can’t come over yet', async ({ browser, baseURL }) => {
  stratis = await openDevice(browser, baseURL!, accounts.stratis, { [DEMO_DOC_KEY]: JSON.stringify(doc) });
  const shut = stratis.page.getByRole('region', { name: 'This home is private' });
  await expect(shut.getByRole('heading', { name: 'This home is private', level: 1 })).toBeVisible();
  await expect(shut).toContainText(
    'This phone still has Our home (6 areas · 19 items · 3 done). Someone has already set up a home here, so it can’t be brought over now.',
  );
  await expect(shut.getByRole('button')).toHaveText(['Check Again', 'Sign Out']);
  // The phone's copy is untouched.
  const kept = await stratis.page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), DEMO_DOC_KEY);
  expect(kept.imported).toBeUndefined();
  expect(kept.declined).toBeUndefined();
});

test('once Shea adds him, his phone’s home takes the place of the empty one, in place', async () => {
  const a = stratis.page;
  const b = shea.page;
  // Shea adds Stratis; the new person starts on an emoji nobody has (Shea has the hedgehog).
  const dialog = await openHousehold(b);
  await people(dialog).getByRole('button', { name: 'Add Person' }).click();
  const name = dialog.getByPlaceholder('Name', { exact: true });
  await expect(name).toBeFocused();
  await settled(name);
  await name.fill('Stratis');
  await expect(dialog.getByRole('radiogroup', { name: 'Emoji', exact: true }).getByRole('radio', { name: '🦆' })).toBeChecked();
  await dialog.getByRole('textbox', { name: 'Google Email' }).fill(accounts.stratis.email);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(personRow(dialog, 'Stratis')).toHaveText(`🦆Stratis, Not joined yet · , ${accounts.stratis.email}`);
  await closeHousehold(b, dialog);

  // Stratis checks again: he is the Stratis Shea added, and can say he isn't.
  const shut = a.getByRole('region', { name: 'This home is private' });
  await shut.getByRole('button', { name: 'Check Again' }).click();
  const welcome = a.getByRole('region', { name: 'Welcome home, Stratis' });
  await expect(welcome.getByRole('button', { name: 'Not Stratis? Sign Out' })).toBeVisible();
  await welcome.getByRole('button', { name: 'Continue' }).click();

  // The home is still empty: his phone's home may take its place.
  const offer = a.getByRole('region', { name: 'Bring over the home from this phone' });
  await expect(offer).toContainText(
    'It takes the place of Shea’s place, which has nothing in it yet. Everyone already in Shea’s place stays.',
  );
  await expect(offer.getByRole('button', { name: 'Keep Shea’s place' })).toBeVisible();
  await expect(offer.getByRole('button', { name: 'Sign Out' })).toHaveCount(0);
  await quiet(shea);
  await offer.getByRole('button', { name: 'Bring It Over' }).click();

  // Shea is the Shea who joined (by name); only Ela still has no email.
  const waiting = a.getByRole('region', { name: 'Ela hasn’t joined yet' });
  await expect(waiting.getByRole('textbox', { name: 'Ela’s Google email' })).toBeVisible();
  await waiting.getByRole('button', { name: 'Continue' }).click();
  await finishSetup(a);
  await expect(areaHeadings(a)).toHaveText(doc.areas.map((x) => x.name));
  await expect(homeScreen(a).locator('[data-item-open]')).toHaveCount(19);
  expect(await chips(a).getByRole('radio').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual([
    'Everyone, 19 items',
    'Stratis (you), 11 items',
    'Shea, 5 items',
    'Ela, 0 items, not joined yet',
    'Unassigned, 3 items',
  ]);

  // Shea's phone shows the home that came over, without a reload: it is the same home.
  await expect(areaHeadings(b)).toHaveText(
    doc.areas.map((x) => x.name),
    { timeout: SYNC_MS },
  );
  await expect(chips(b).getByRole('radio', { name: 'Shea (you), 5 items', exact: true })).toBeVisible({ timeout: SYNC_MS });
  expect((await homeIds()).length).toBe(1);
  const mark = await a.evaluate((key) => JSON.parse(localStorage.getItem(key)!).imported, DEMO_DOC_KEY);
  expect(await homeIds()).toEqual([mark.household_id]);

  await expectNoReload(stratis);
  await expectNoReload(shea);
});

test('Ela opens an invite link and joins as the Ela who came along, not as a second Ela', async ({ browser, baseURL }) => {
  const token = await createInviteAs(accounts.shea);
  const ela = await openDevice(browser, baseURL!, accounts.ela, {}, `/?invite=${token}`);
  const c = ela.page;
  const profile = c.getByRole('region', { name: 'Your profile' });
  await expect(profile.getByRole('textbox', { name: 'Name' })).toHaveValue('Ela');
  // A newcomer starts on an emoji nobody in that home has.
  await expect(profile.getByRole('radiogroup', { name: 'Your emoji' }).getByRole('radio', { name: '🐻' })).toBeChecked();
  await profile.getByRole('button', { name: 'Continue' }).click();

  const join = c.getByRole('region', { name: 'Join Our home' });
  const who = join.getByRole('radiogroup', { name: 'Are you one of these people?' });
  await expect(who.getByRole('radio')).toHaveText(['🦊Ela', '🐻Someone new (Ela)']);
  // The name she typed picks her already.
  await expect(who.getByRole('radio').first()).toHaveAttribute('aria-checked', 'true');
  await expect(who.getByRole('radio').last()).toHaveAttribute('aria-checked', 'false');
  await quiet(stratis);
  await join.getByRole('button', { name: 'Join as Ela' }).click();
  const welcome = c.getByRole('region', { name: 'Welcome home, Ela' });
  await expect(welcome.getByRole('radiogroup', { name: 'Your emoji' }).getByRole('radio', { name: '🦊' })).toBeChecked();
  await welcome.getByRole('button', { name: 'Continue' }).click();
  await finishSetup(c);

  // One Ela, who has joined, on Stratis's phone straight away.
  await expect(chips(stratis.page).getByRole('radio', { name: 'Ela, 0 items', exact: true })).toBeVisible({ timeout: SYNC_MS });
  const dialog = await openHousehold(stratis.page);
  await expect(people(dialog).getByRole('button')).toHaveText([
    '🦔Shea',
    '🦆Stratis, You',
    '🦊Ela',
    'Add Person',
  ]);
  await closeHousehold(stratis.page, dialog);
  await expectNoReload(ela);
  await ela.context.close();
  await expectNoReload(stratis);
});
