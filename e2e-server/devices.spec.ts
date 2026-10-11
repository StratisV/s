import { expect, test } from '@playwright/test';
import {
  chips,
  closeProfile,
  codeField,
  codeFor,
  codeSheet,
  confirmation,
  DEMO_DOC_KEY,
  devicesOf,
  expectNoReload,
  homeHeading,
  openDevice,
  openHousehold,
  openPersonPage,
  openProfile,
  personRow,
  PHONE_DOC,
  resetServer,
  SETUP_CODE,
  shownCode,
  stratisAndShea,
  SYNC_MS,
  welcome,
} from './helpers';

// Devices, Sign Out and "Not Shea?" (docs/ARCHITECTURE.md "Server mode (no setup)": "Signing
// in", "Screens"). Each test starts from a server with no home.

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

test('Add another device signs a second phone in as Stratis; removing it from the first signs it out', async ({ browser, baseURL }) => {
  const phone = await openDevice(browser, baseURL!, {
    localStorage: { [DEMO_DOC_KEY]: JSON.stringify(PHONE_DOC) },
    signIn: { setup: SETUP_CODE },
  });
  const a = phone.page;
  await expect(homeHeading(a)).toBeVisible();

  // Profile says which device this is; no Google, no notifications, no weekly email.
  let dialog = await openProfile(a);
  await expect(dialog.getByText(/^This device · /)).toBeVisible();
  await expect(dialog.getByText('Signed in with Google')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Invite someone' })).toHaveCount(0);
  await expect(dialog.getByText(/notifications/i)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Add another device' }).click();
  const sheet = codeSheet(a, 'Code for another device');
  await expect(sheet).toContainText('On your other phone or tablet, open home.os and enter it, or open the link.');
  const code = await shownCode(sheet);
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toHaveCount(0);
  // Focus goes back to the button that asked for the code; Profile is still open.
  await expect(dialog.getByRole('button', { name: 'Add another device' })).toBeFocused();
  await closeProfile(a);

  // The tablet types it: it is Stratis, straight to Home (he has joined already).
  const tablet = await openDevice(browser, baseURL!);
  const b = tablet.page;
  await codeField(b).click();
  await codeField(b).pressSequentially(code);
  await welcome(b).getByRole('button', { name: 'Join' }).click();
  await expect(homeHeading(b)).toBeVisible();
  await expect(b.getByRole('button', { name: 'Profile', exact: true })).toHaveText('🦆');
  await expect(chips(b).getByRole('radio', { name: /^Stratis \(you\),/ })).toBeVisible();
  expect(await devicesOf(phone.context)).toHaveLength(2);

  // On the phone, Stratis's page lists both, this one first said to be this device.
  dialog = await openHousehold(a);
  await openPersonPage(dialog, 'Stratis');
  const devices = dialog.getByRole('region', { name: 'Devices' });
  const removes = devices.getByRole('button', { name: /^Remove / });
  await expect(removes).toHaveCount(2);
  await expect(devices.getByRole('button', { name: /, this device$/ })).toHaveCount(1);
  await expect(devices.getByText(/This device · Signed in /)).toBeVisible();
  await devices.getByRole('button', { name: /^Remove .*(?<!, this device)$/ }).click();
  const ask = await confirmation(a, 'Remove this device?');
  await expect(ask).toContainText('It will need a new code to get back in.');
  await ask.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(removes).toHaveCount(1);

  // The tablet is signed out at its next poll: the Welcome screen, without a reload.
  await expect(welcome(b).getByText('This home is private.', { exact: true })).toBeVisible({ timeout: SYNC_MS });
  await expect(codeField(b)).toBeVisible();
  // And it stays out after a reload (the key is no good any more).
  await b.reload();
  await expect(welcome(b).getByText('This home is private.', { exact: true })).toBeVisible();
  // The code was used up when the tablet signed in.
  await codeField(b).pressSequentially(code);
  await welcome(b).getByRole('button', { name: 'Join' }).click();
  await expect(welcome(b).getByRole('alert')).toHaveText('That code didn’t work. Check it, or ask for a new one.');

  expect(await devicesOf(phone.context)).toHaveLength(1);
  await expectNoReload(phone);
  await phone.context.close();
  await tablet.context.close();
});

test('Sign Out forgets this device; it needs a new code to get back in', async ({ browser, baseURL }) => {
  const { stratis, shea } = await stratisAndShea(browser, baseURL!);
  const b = shea.page;
  const profile = await openProfile(b);
  await profile.getByRole('button', { name: 'Sign Out' }).click();
  const ask = await confirmation(b, 'Sign out of home.os?');
  await expect(ask).toContainText('To sign in again, you’ll need a new code from someone at home.');
  await ask.getByRole('button', { name: 'Sign Out' }).click();
  await expect(welcome(b).getByText('This home is private.', { exact: true })).toBeVisible();
  await b.reload();
  await expect(welcome(b).getByText('This home is private.', { exact: true })).toBeVisible();

  // On Stratis's phone, Shea has joined but has no device now; he can make her a new code.
  const dialog = await openHousehold(stratis.page);
  await openPersonPage(dialog, 'Shea');
  const devices = dialog.getByRole('region', { name: 'Devices' });
  await expect(devices.getByText('No devices signed in.')).toBeVisible();
  await devices.getByRole('button', { name: 'Sign in on a new phone' }).click();
  const sheet = codeSheet(stratis.page, 'Code for Shea');
  const code = await shownCode(sheet);
  await sheet.getByRole('button', { name: 'Done' }).click();

  await codeField(b).pressSequentially(code);
  await welcome(b).getByRole('button', { name: 'Join' }).click();
  // She had joined already: straight to Home, as Shea.
  await expect(homeHeading(b)).toBeVisible();
  await expect(chips(b).getByRole('radio', { name: /^Shea \(you\),/ })).toBeVisible();
  await expect(devices.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  await expectNoReload(stratis);
  await stratis.context.close();
  await shea.context.close();
});

test('the only signed-in device is warned before signing out', async ({ browser, baseURL }) => {
  const phone = await openDevice(browser, baseURL!, {
    localStorage: { [DEMO_DOC_KEY]: JSON.stringify(PHONE_DOC) },
    signIn: { setup: SETUP_CODE },
  });
  const profile = await openProfile(phone.page);
  await profile.getByRole('button', { name: 'Sign Out' }).click();
  const ask = await confirmation(phone.page, 'Sign out of home.os?');
  await expect(ask).toContainText(
    'This is the only device signed in to Our home. Add another device first, or nobody can make a code to get back in.',
  );
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(profile).toBeVisible();
  await expectNoReload(phone);
  await phone.context.close();
});

test('“Not Shea?” signs out and puts Shea back to waiting to join', async ({ browser, baseURL }) => {
  const stratis = await openDevice(browser, baseURL!, {
    localStorage: { [DEMO_DOC_KEY]: JSON.stringify(PHONE_DOC) },
    signIn: { setup: SETUP_CODE },
  });
  await expect(homeHeading(stratis.page)).toBeVisible();
  const dialog = await openHousehold(stratis.page);
  await expect(personRow(dialog, 'Shea')).toHaveText('🦔Shea, Not joined yet');

  // Someone else is handed Shea's code by mistake.
  const code = await codeFor(stratis.context, 'Shea');
  const other = await openDevice(browser, baseURL!, { path: `/?code=${code}` });
  const hello = other.page.getByRole('region', { name: 'Welcome home, Shea' });
  await expect(hello.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(personRow(dialog, 'Shea')).toHaveText('🦔Shea', { timeout: SYNC_MS });
  await hello.getByRole('button', { name: 'Not Shea? Sign Out' }).click();
  const ask = await confirmation(other.page, 'Not Shea?');
  await expect(ask).toContainText("You'll be signed out and Shea goes back to waiting to join. Ask someone at home for a new code.".replace("'", '’'));
  await ask.getByRole('button', { name: 'Sign Out' }).click();
  await expect(welcome(other.page).getByText('This home is private.', { exact: true })).toBeVisible();

  // Stratis's phone hears it; Shea can be invited again.
  await expect(personRow(dialog, 'Shea')).toHaveText('🦔Shea, Not joined yet', { timeout: SYNC_MS });
  await openPersonPage(dialog, 'Shea');
  await expect(dialog.getByRole('button', { name: 'Invite Shea' })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Google Email' })).toHaveCount(0);
  await expectNoReload(stratis);
  await stratis.context.close();
  await other.context.close();
});

test('Sign Out while offline sticks: once back online the phone stays signed out, and its device goes', async ({ browser, baseURL }) => {
  const { stratis, shea } = await stratisAndShea(browser, baseURL!);
  const b = shea.page;
  const sheaId = (await devicesOf(shea.context)).find((d) => d.current)!.memberId;
  const profile = await openProfile(b);
  await shea.context.setOffline(true);
  await profile.getByRole('button', { name: 'Sign Out' }).click();
  const ask = await confirmation(b, 'Sign out of home.os?');
  await ask.getByRole('button', { name: 'Sign Out' }).click();
  await expect(welcome(b).getByText('This home is private.', { exact: true })).toBeVisible();
  // Back online, the app starts again: the sign-out goes through first, and it stays out.
  await shea.context.setOffline(false);
  await b.reload();
  await expect(welcome(b).getByText('This home is private.', { exact: true })).toBeVisible();
  await expect(codeField(b)).toBeVisible();
  await expect.poll(async () => (await devicesOf(stratis.context)).filter((d) => d.memberId === sheaId).length).toBe(0);
  const res = await shea.context.request.get('/api/home?op=version', { headers: { 'X-HomeOS': '1' } });
  expect(res.status()).toBe(401);
  // The browser logs the requests that failed while offline.
  shea.errors.splice(0, shea.errors.length, ...shea.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e)));
  expect(shea.errors).toEqual([]);
  await expectNoReload(stratis);
  await stratis.context.close();
  await shea.context.close();
});
