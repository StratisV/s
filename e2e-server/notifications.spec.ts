import { expect, test, type Locator, type Page } from '@playwright/test';
import { API_PATH } from '../src/lib/backend/serverApi';
import {
  closeProfile,
  codeFor,
  CRON_SECRET,
  DEMO_DOC_KEY,
  expectNoReload,
  homeHeading,
  IPHONE_SAFARI_UA,
  openDevice,
  openProfile,
  PHONE_DOC,
  resetServer,
  settled,
  SETUP_CODE,
} from './helpers';

// Phone notifications in server mode (docs/ARCHITECTURE.md "Server mode (no setup)",
// "Notifications"): Profile's choices and reminders are kept by the server for every device of
// the person, and the morning run answers only Vercel Cron's secret. Nothing is pushed here:
// service workers are blocked, so no browser subscribes. Each test starts from a server with
// no home.

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

const choice = (dialog: Locator, name: string) => dialog.getByRole('checkbox', { name });

async function addReminder(page: Page, dialog: Locator, title: string, days: string[]) {
  await dialog.getByRole('button', { name: 'Add Reminder' }).click();
  const field = dialog.getByRole('textbox', { name: 'Remind me to' });
  await expect(field).toBeFocused();
  await field.fill(title);
  for (const day of days) await dialog.getByRole('group', { name: 'Days' }).getByRole('button', { name: day }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(field).toHaveCount(0);
  // Back on Profile once it has slid in again.
  await settled(dialog.getByRole('button', { name: 'Done', exact: true }));
  await expect(page.getByRole('dialog', { name: 'Profile' })).toBeVisible();
}

test('choices and reminders are kept for the person on every device, and only theirs', async ({ browser, baseURL }) => {
  const phone = await openDevice(browser, baseURL!, {
    localStorage: { [DEMO_DOC_KEY]: JSON.stringify(PHONE_DOC) },
    signIn: { setup: SETUP_CODE },
  });
  await expect(homeHeading(phone.page)).toBeVisible();
  let dialog = await openProfile(phone.page);
  await expect(dialog.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(dialog.getByRole('switch', { name: 'Notifications on this device' })).toBeVisible();
  for (const name of ['Weekly status', 'Housekeeping report', 'My reminders']) {
    await expect(choice(dialog, name)).toHaveAttribute('aria-checked', 'false');
  }
  await choice(dialog, 'Weekly status').click();
  await choice(dialog, 'My reminders').click();
  await expect(choice(dialog, 'Weekly status')).toHaveAttribute('aria-checked', 'true');
  await addReminder(phone.page, dialog, 'Take the bins out', ['Sunday']);
  await expect(dialog.getByRole('button', { name: /^Take the bins out/ })).toHaveText(/Every Sunday · Morning/);
  await expect(dialog.getByText('Reminders come in the morning, between 7 and 9.')).toBeVisible();
  await closeProfile(phone.page);

  // His tablet: the same choices and reminder.
  const tablet = await openDevice(browser, baseURL!, { signIn: { code: await codeFor(phone.context, 'Stratis') } });
  await expect(homeHeading(tablet.page)).toBeVisible();
  dialog = await openProfile(tablet.page);
  await expect(choice(dialog, 'Weekly status')).toHaveAttribute('aria-checked', 'true');
  await expect(choice(dialog, 'Housekeeping report')).toHaveAttribute('aria-checked', 'false');
  // Changed there: Wednesday too.
  await dialog.getByRole('button', { name: /^Take the bins out/ }).click();
  await expect(dialog.getByRole('textbox', { name: 'Remind me to' })).toHaveValue('Take the bins out');
  const days = dialog.getByRole('group', { name: 'Days' });
  await expect(days.getByRole('button', { name: 'Sunday' })).toHaveAttribute('aria-pressed', 'true');
  await days.getByRole('button', { name: 'Wednesday' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('button', { name: /^Take the bins out/ })).toHaveText(/Wed, Sun · Morning/);
  await closeProfile(tablet.page);

  // Back on the phone, Profile shows the change; deleting it there deletes it everywhere.
  dialog = await openProfile(phone.page);
  const bins = dialog.getByRole('button', { name: /^Take the bins out/ });
  await expect(bins).toHaveText(/Wed, Sun · Morning/);
  await bins.click();
  await dialog.getByRole('button', { name: 'Delete Reminder' }).click();
  await expect(dialog.getByRole('button', { name: /^Take the bins out/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Add Reminder' })).toBeFocused();
  await closeProfile(phone.page);

  // Shea sees none of his: her own choices, nothing ticked.
  const shea = await openDevice(browser, baseURL!, { signIn: { code: await codeFor(phone.context, 'Shea') } });
  await expect(homeHeading(shea.page)).toBeVisible();
  const hers = await openProfile(shea.page);
  await expect(choice(hers, 'Weekly status')).toHaveAttribute('aria-checked', 'false');
  await expect(hers.getByRole('heading', { name: 'My reminders' })).toHaveCount(0);
  await closeProfile(shea.page);
  for (const device of [phone, tablet, shea]) await expectNoReload(device);
});

test('on an iPhone in Safari, Profile says to add home.os to the Home Screen first', async ({ browser, baseURL }) => {
  const phone = await openDevice(browser, baseURL!, {
    localStorage: { [DEMO_DOC_KEY]: JSON.stringify(PHONE_DOC) },
    signIn: { setup: SETUP_CODE },
    userAgent: IPHONE_SAFARI_UA,
  });
  await expect(homeHeading(phone.page)).toBeVisible();
  const dialog = await openProfile(phone.page);
  await expect(dialog.getByText('On iPhone, add home.os to your Home Screen first: Share, then Add to Home Screen.')).toBeVisible();
  await expect(dialog.getByRole('switch', { name: 'Notifications on this device' })).toBeDisabled();
  // The choices still work: they go to his other devices.
  await choice(dialog, 'Housekeeping report').click();
  await expect(choice(dialog, 'Housekeeping report')).toHaveAttribute('aria-checked', 'true');
  await expectNoReload(phone);
});

test('the morning run answers only the cron secret, and sends nothing to nobody', async ({ browser, baseURL, request }) => {
  const phone = await openDevice(browser, baseURL!, {
    localStorage: { [DEMO_DOC_KEY]: JSON.stringify(PHONE_DOC) },
    signIn: { setup: SETUP_CODE },
  });
  await expect(homeHeading(phone.page)).toBeVisible();
  const url = `${API_PATH}?op=tick`;
  const attempts: Record<string, string>[] = [{}, { Authorization: 'Bearer wrong-secret-0123456789' }, { 'X-HomeOS': '1' }];
  for (const headers of attempts) {
    const refused = await request.get(url, { headers });
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toEqual({ error: { code: 'forbidden', message: 'Only the scheduled run may do this' } });
  }
  // As Vercel Cron calls it: no X-HomeOS header, the secret as a Bearer token.
  const ran = await request.get(url, { headers: { Authorization: `Bearer ${CRON_SECRET}`, 'User-Agent': 'vercel-cron/1.0' } });
  expect(ran.status()).toBe(200);
  expect(await ran.json()).toEqual({ ok: true, sent: 0, failed: 0, gone: 0 });
  await expectNoReload(phone);
});
