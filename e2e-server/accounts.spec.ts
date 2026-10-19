import { expect, test } from '@playwright/test';
import { DEMO_DOC_KEY, expectAreas, expectNoReload, homeHeading, openDevice, PHONE_DOC, resetServer, SETUP_CODE, welcome } from './helpers';

// Create Account and Sign In (server mode): no codes, no Google.

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

test('people create an account, see the same home, and sign in again on another phone', async ({ browser, baseURL }) => {
  // The home is online (brought from Stratis's phone).
  const stratis = await openDevice(browser, baseURL!, {
    localStorage: { [DEMO_DOC_KEY]: JSON.stringify(PHONE_DOC) },
    path: `/?setup=${SETUP_CODE}`,
  });
  await stratis.page.getByRole('region', { name: 'Bring this home online' }).getByRole('button', { name: 'Bring It Online' }).click();
  await stratis.page.getByRole('region', { name: 'Shea hasn’t joined yet' }).getByRole('button', { name: 'Continue' }).click();
  await expect(homeHeading(stratis.page)).toBeVisible();

  // Shea opens home.os: Join your home.
  const shea = await openDevice(browser, baseURL!);
  const door = welcome(shea.page);
  await expect(door.getByText('Join your home', { exact: true })).toBeVisible();
  await door.getByLabel('Your name').fill('Shea');
  await door.getByLabel('Email').fill('shea@example.com');
  await door.getByLabel('Password').fill('hedgehog1');
  await door.getByRole('button', { name: 'Create Account' }).click();
  // Her profile: the welcome step, then the same home as Stratis.
  const hello = shea.page.getByRole('region', { name: 'Welcome home, Shea' });
  await hello.getByRole('button', { name: 'Continue' }).click();
  await expect(homeHeading(shea.page)).toBeVisible();
  await expectAreas(shea.page, PHONE_DOC.areas.map((a) => a.name));

  // Another phone: Sign In with the same email and password.
  const laptop = await openDevice(browser, baseURL!);
  const again = welcome(laptop.page);
  await again.getByRole('button', { name: 'Have an account? Sign In' }).click();
  await again.getByLabel('Email').fill('shea@example.com');
  await again.getByLabel('Password').fill('wrong-password');
  await again.getByRole('button', { name: 'Sign In' }).click();
  await expect(again.getByRole('alert')).toHaveText('Wrong password. Check it and try again.');
  await again.getByLabel('Password').fill('hedgehog1');
  await again.getByRole('button', { name: 'Sign In' }).click();
  await expect(homeHeading(laptop.page)).toBeVisible();
  await expectAreas(laptop.page, PHONE_DOC.areas.map((a) => a.name));

  // Still signed in after a reload.
  await laptop.page.reload();
  await expect(homeHeading(laptop.page)).toBeVisible();

  // Someone new gets their own profile in the same home.
  const maria = await openDevice(browser, baseURL!);
  const m = welcome(maria.page);
  await m.getByLabel('Your name').fill('Maria');
  await m.getByLabel('Email').fill('maria@example.com');
  await m.getByLabel('Password').fill('cleaning1');
  await m.getByRole('button', { name: 'Create Account' }).click();
  await maria.page.getByRole('region', { name: 'Welcome home, Maria' }).getByRole('button', { name: 'Continue' }).click();
  await expectAreas(maria.page, PHONE_DOC.areas.map((a) => a.name));

  await expectNoReload(stratis);
  await expectNoReload(shea);
  for (const d of [stratis, shea, laptop, maria]) await d.context.close();
});
