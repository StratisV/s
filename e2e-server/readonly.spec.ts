import { expect, request as requestFor, test } from '@playwright/test';
import {
  closeArea,
  DEMO_DOC_KEY,
  expectNoReload,
  homeHeading,
  homeScreen,
  inArea,
  openDevice,
  PHONE_DOC,
  resetServer,
  ring,
  rowFor,
  SETUP_CODE,
  SYNC_MS,
  toast,
} from './helpers';

// The month's saving used up (docs/ARCHITECTURE.md "Server mode (no setup)", "Budget"): the
// second local server of playwright.server.config.ts makes 4 puts a month. Then saving
// pauses instead of the store being blocked: Home says so, and a save says why it failed.

/** The second server (E2E_PORT + 1). */
function readOnlyBase(baseURL: string): string {
  const url = new URL(baseURL);
  url.port = String(Number(url.port) + 1);
  return url.origin;
}

test('once the month’s saving is used up, Home says so and a save says why it failed', async ({ browser, baseURL }) => {
  const base = readOnlyBase(baseURL!);
  const api = await requestFor.newContext({ baseURL: base });
  await resetServer(api);
  await api.dispose();

  // Bringing the home online is the first put; the phone's first use of its key the second.
  const phone = await openDevice(browser, base, {
    localStorage: { [DEMO_DOC_KEY]: JSON.stringify(PHONE_DOC) },
    signIn: { setup: SETUP_CODE },
  });
  const page = phone.page;
  await expect(homeHeading(page)).toBeVisible();
  const line = homeScreen(page).getByText('Saving is paused until next month: the free storage limit is used up.');
  await expect(line).toHaveCount(0);

  // Two more: done, and Undo.
  await ring(await inArea(page, 'Garden'), 'Install leaf blower').click();
  await toast(page, 'Marked as done').getByRole('button', { name: 'Undo' }).click();
  await expect(rowFor(page, 'Install leaf blower', 'Garden')).toBeVisible();

  // That was the month's last: the next poll says saving is paused, on Home.
  await closeArea(page);
  await expect(line).toBeVisible({ timeout: SYNC_MS });

  // A change now is not saved: it comes back, and the toast says why.
  await ring(await inArea(page, 'Garden'), 'Install leaf blower').click();
  await expect(toast(page, 'Couldn’t save. Saving is paused until next month.')).toBeVisible();
  await expect(rowFor(page, 'Install leaf blower', 'Garden')).toBeVisible();
  // Everything can still be read.
  await page.reload();
  await expect(homeHeading(page)).toBeVisible();
  await inArea(page, 'Garden');
  await expect(rowFor(page, 'Install leaf blower', 'Garden')).toBeVisible();
  await closeArea(page);
  await expect(line).toBeVisible({ timeout: SYNC_MS });
  // The browser logs the refused save (503).
  phone.errors.splice(0, phone.errors.length, ...phone.errors.filter((e) => !/status of 503\b/.test(e)));
  await phone.page.evaluate(() => {
    (window as unknown as { __homeosE2e?: string }).__homeosE2e = 'same page';
  });
  await expectNoReload(phone);
  await phone.context.close();
});
