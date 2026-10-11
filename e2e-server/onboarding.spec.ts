import { expect, request as requestFor, test, type Locator, type Page } from '@playwright/test';
import {
  devicesOf,
  IPHONE_SAFARI_UA,
  openHousehold as openHouseholdOf,
  openPersonPage,
  area,
  areaHeadings,
  areas,
  chips,
  codeField,
  codeFor,
  codeSheet,
  DEMO_DOC_KEY,
  escapeRe,
  expectNoReload,
  goToTab,
  homeHeading,
  homeScreen,
  loadHome,
  meta,
  openDevice,
  openHousehold,
  people,
  personRow,
  PHONE_DOC,
  resetServer,
  ring,
  rowFor,
  SETUP_CODE,
  shownCode,
  statsScreen,
  SYNC_MS,
  version,
  welcome,
  dayLabel,
} from './helpers';

// Bringing the home online and signing in with codes (docs/ARCHITECTURE.md "Server mode (no
// setup)": "Setup", "Signing in", "Screens"). Each test starts from a server with no home.

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

const doc = PHONE_DOC;
const areaName = (id: string) => doc.areas.find((a) => a.id === id)!.name;
const who = (id: string | null) => {
  const m = id ? doc.members.find((p) => p.id === id) : null;
  return m ? `${m.emoji} ${m.name}` : 'Unassigned';
};
/** The London day of a stored time, as YYYY-MM-DD. */
const londonDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const RAG = { red: 'Red', amber: 'Amber', green: 'Green' } as const;

/** The phone's open items, as Home shows them. */
const OPEN_ITEMS = doc.items
  .filter((i) => i.status === 'open')
  .map((i) => ({
    area: areaName(i.area_id),
    title: i.title,
    state: i.kind === 'state',
    rag: RAG[i.rag],
    who: who(i.assignee_id),
    date: i.kind === 'state' ? `Updated ${dayLabel(londonDay(i.updated_at))}` : dayLabel(i.due_date!),
    note: i.note,
  }));
const SHEAS = OPEN_ITEMS.filter((it) => it.who === '🦔 Shea');

/** Every area in order, every open item with its kind, status, person, date and note. */
async function expectPhoneHome(page: Page): Promise<void> {
  await expect(areaHeadings(page)).toHaveText(doc.areas.map((a) => a.name));
  for (const it of OPEN_ITEMS) {
    const row = rowFor(page, it.title, it.area);
    await expect(row, `${it.area}: ${it.title}`).toHaveAccessibleName(
      new RegExp(`^${escapeRe(it.title)} ?, ${it.rag}${it.state ? ', to maintain' : ''}\\.`),
    );
    await expect(meta(area(page, it.area), it.title), `${it.area}: ${it.title}`).toHaveText(
      new RegExp(`^${escapeRe(it.who)} · ${it.state ? '' : '(Missed · )?'}${escapeRe(it.date)}$`),
    );
    if (it.note) await expect(row).toContainText(it.note);
    await expect(ring(area(page, it.area), it.title)).toHaveCount(it.state ? 0 : 1);
  }
  await expect(areas(page).locator('[data-item-open]')).toHaveCount(OPEN_ITEMS.length);
}

/** Types into the code field a letter at a time, as a phone keyboard would. */
async function typeCode(field: Locator, code: string): Promise<void> {
  await field.click();
  await field.pressSequentially(code.replace(/-/g, '').toLowerCase());
}

test('Stratis brings the home on his phone online with the setup link, invites Shea, and she joins with her code', async ({
  browser,
  baseURL,
}) => {
  const stratis = await openDevice(browser, baseURL!, {
    localStorage: { [DEMO_DOC_KEY]: JSON.stringify(doc) },
    path: `/?setup=${SETUP_CODE}`,
  });
  const a = stratis.page;

  // What comes along, and the setup code from the link. Nothing else on the step.
  const step = a.getByRole('region', { name: 'Bring this home online' });
  await expect(step.getByRole('heading', { level: 1 })).toHaveText('Bring this home online');
  await expect(step).toContainText('Our home');
  await expect(step).toContainText('21 Alderbrook Road');
  // What was really done comes along (3), the demo's made-up history does not.
  await expect(step).toContainText('6 areas · 19 items · 3 done');
  // Ela, whom the demo made up and nothing refers to, stays behind.
  await expect(step.getByRole('list', { name: 'People' }).getByRole('listitem')).toHaveText(['🦆Stratis (you)', '🦔Shea']);
  await expect(step.getByRole('textbox', { name: 'Setup code' })).toHaveValue(SETUP_CODE);
  await expect(step).toContainText('Everyone else joins with a code you send them from Profile.');
  // Paste is there where the browser lets the page read the clipboard.
  // The household's saved copy is the one other choice.
  await expect(step.getByRole('button')).toHaveText(['Use the Saved Copy Instead', 'Paste', 'Bring It Online']);
  // The link is gone from the address.
  expect(new URL(a.url()).search).toBe('');
  await step.getByRole('button', { name: 'Bring It Online' }).click();

  // Next, the people who came along without having joined: an Invite for each.
  const waiting = a.getByRole('region', { name: 'Shea hasn’t joined yet' });
  await expect(waiting.getByRole('heading', { level: 1 })).toHaveText('Shea hasn’t joined yet');
  await expect(waiting).toContainText('Send each of them a code. They type it in home.os, or open the link.');
  await expect(waiting).toContainText('You can invite them later in Profile > Household > People.');
  await waiting.getByRole('button', { name: 'Invite Shea' }).click();
  const sheet = codeSheet(a, 'Code for Shea');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Works once, for 7 days. On Shea’s phone, open home.os and enter it, or open the link.');
  const code = await shownCode(sheet);
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toHaveCount(0);
  await waiting.getByRole('button', { name: 'Continue' }).click();

  // No notifications step in server mode: straight to Home, with everything from the phone.
  await expect(homeHeading(a)).toBeVisible();
  await expectPhoneHome(a);
  expect(await chips(a).getByRole('radio').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual([
    'Everyone, 19 items',
    'Stratis (you), 11 items',
    `Shea, ${SHEAS.length} items, not joined yet`,
    'Unassigned, 3 items',
  ]);
  await expect(areas(a).getByText('Order water test strips')).toHaveCount(0);
  await goToTab(a, 'Stats');
  await statsScreen(a).getByRole('radio', { name: 'Lifetime' }).click();
  await expect(statsScreen(a).getByRole('img', { name: /tasks? done/ })).toHaveAccessibleName('3 tasks done in total: Stratis 1, Shea 2.');
  await goToTab(a, 'Home');
  // The phone's own copy is left as it was.
  expect(await a.evaluate((key) => localStorage.getItem(key), DEMO_DOC_KEY)).toBe(JSON.stringify(doc));

  // Shea opens home.os on her phone: the home is private; she types her code.
  const shea = await openDevice(browser, baseURL!);
  const b = shea.page;
  const door = welcome(b);
  await expect(door.getByText('This home is private.', { exact: true })).toBeVisible();
  await expect(door.getByText('Ask someone at home for a code.', { exact: true })).toBeVisible();
  await expect(door.getByRole('button', { name: /Google/ })).toHaveCount(0);
  const field = codeField(b);
  await expect(field).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(field).toHaveAttribute('placeholder', 'ABCD-EFGH');
  const join = door.getByRole('button', { name: 'Join' });
  await expect(join).toBeDisabled();
  await typeCode(field, code);
  // Shown in groups as typed, in capitals.
  await expect(field).toHaveValue(code);
  await join.click();

  const hello = b.getByRole('region', { name: 'Welcome home, Shea' });
  await expect(hello.getByRole('heading', { name: 'Welcome home, Shea', level: 1 })).toBeVisible();
  await expect(hello.getByRole('radiogroup', { name: 'Your emoji' }).getByRole('radio', { name: '🦔' })).toBeChecked();
  // Stratis's phone hears that she joined, without a reload.
  await expect(chips(a).getByRole('radio', { name: `Shea, ${SHEAS.length} items`, exact: true })).toBeVisible({ timeout: SYNC_MS });
  await hello.getByRole('button', { name: 'Continue' }).click();
  await expect(homeHeading(b)).toBeVisible();
  await expect(b.getByRole('button', { name: 'Profile', exact: true })).toHaveText('🦔');
  const mine = chips(b).getByRole('radio', { name: `Shea (you), ${SHEAS.length} items`, exact: true });
  await mine.click();
  await expect(areas(b).locator('[data-item-open]')).toHaveCount(SHEAS.length);
  for (const it of SHEAS) await expect(rowFor(b, it.title, it.area)).toBeVisible();
  await chips(b).getByRole('radio', { name: /^Everyone,/ }).click();
  await expectPhoneHome(b);

  // The code is used up: on a third phone it does not work.
  const third = await openDevice(browser, baseURL!);
  await typeCode(codeField(third.page), code);
  await welcome(third.page).getByRole('button', { name: 'Join' }).click();
  await expect(welcome(third.page).getByRole('alert')).toHaveText('That code didn’t work. Check it, or ask for a new one.');

  // The setup link is used up too: another phone with a demo home only hears that the home is online.
  const late = await openDevice(browser, baseURL!, {
    localStorage: { [DEMO_DOC_KEY]: JSON.stringify(doc) },
    path: `/?setup=${SETUP_CODE}`,
  });
  await expect(welcome(late.page).getByText('This home is already online. Ask someone at home for a code.')).toBeVisible();
  await expect(late.page.getByRole('region', { name: 'Bring this home online' })).toHaveCount(0);

  await expectNoReload(stratis);
  await expectNoReload(shea);
  for (const d of [stratis, shea, third, late]) await d.context.close();
});

test('the setup code can be typed (a Home Screen app keeps its own storage); a wrong one is refused', async ({ browser, baseURL }) => {
  const phone = await openDevice(browser, baseURL!, { localStorage: { [DEMO_DOC_KEY]: JSON.stringify(doc) } });
  const page = phone.page;
  const step = page.getByRole('region', { name: 'Bring this home online' });
  const field = step.getByRole('textbox', { name: 'Setup code' });
  await expect(field).toHaveValue('');
  await expect(field).toHaveAttribute('placeholder', 'XXXX-XXXX-XXXX');
  const go = step.getByRole('button', { name: 'Bring It Online' });
  await expect(go).toBeDisabled();
  await typeCode(field, 'WRON-GCOD-EXYZ');
  await expect(field).toHaveValue('WRON-GCOD-EXYZ');
  await go.click();
  await expect(step.getByRole('alert')).toHaveText('That code didn’t work. Check it, or ask for a new one.');
  await field.fill('');
  await typeCode(field, SETUP_CODE);
  await go.click();
  await page.getByRole('region', { name: 'Shea hasn’t joined yet' }).getByRole('button', { name: 'Continue' }).click();
  await expect(homeHeading(page)).toBeVisible();
  await expect(areaHeadings(page)).toHaveText(doc.areas.map((a) => a.name));
  await expectNoReload(phone);
  await phone.context.close();
});

test('the whole setup code goes in when pasted, from the keyboard or as its link', async ({ browser, baseURL }) => {
  // The Home Screen app with the home in it, the code copied from a message (24 characters grouped).
  const phone = await openDevice(browser, baseURL!, { localStorage: { [DEMO_DOC_KEY]: JSON.stringify(doc) } });
  await phone.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = phone.page;
  const step = page.getByRole('region', { name: 'Bring this home online' });
  const field = step.getByRole('textbox', { name: 'Setup code' });
  await page.evaluate((text) => navigator.clipboard.writeText(text), `https://home-os-orpin.vercel.app/?setup=${SETUP_CODE}`);
  await field.click();
  await page.keyboard.press('ControlOrMeta+V');
  await expect(field).toHaveValue(SETUP_CODE);
  await field.fill('');
  await page.evaluate((text) => navigator.clipboard.writeText(text), SETUP_CODE);
  await field.click();
  await page.keyboard.press('ControlOrMeta+V');
  await expect(field).toHaveValue(SETUP_CODE);
  await step.getByRole('button', { name: 'Bring It Online' }).click();
  await page.getByRole('region', { name: 'Shea hasn’t joined yet' }).getByRole('button', { name: 'Continue' }).click();
  await expect(homeHeading(page)).toBeVisible();
  await expect(areaHeadings(page)).toHaveText(doc.areas.map((a) => a.name));
  await expectNoReload(phone);
  await phone.context.close();
});

test('the setup code pasted in “Have a code?” before the home is online brings the saved copy online', async ({ browser, baseURL }) => {
  // A phone with no home in it: "This home is private." and "Have a code?".
  const phone = await openDevice(browser, baseURL!);
  await phone.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = phone.page;
  const field = codeField(page);
  await page.evaluate((text) => navigator.clipboard.writeText(text), SETUP_CODE);
  await field.click();
  await page.keyboard.press('ControlOrMeta+V');
  // Whole, not two of its groups taken for a sign-in code.
  await expect(field).toHaveValue(SETUP_CODE);
  await welcome(page).getByRole('button', { name: 'Join' }).click();

  const step = page.getByRole('region', { name: 'Bring this home online' });
  await expect(step.getByText('This is your saved copy of the home.')).toBeVisible();
  await expect(step).toContainText('11 areas · 21 items');
  await expect(step.getByRole('textbox', { name: 'Setup code' })).toHaveValue(SETUP_CODE);
  await step.getByRole('button', { name: 'Bring It Online' }).click();
  await page.getByRole('region', { name: 'Shea hasn’t joined yet' }).getByRole('button', { name: 'Continue' }).click();
  await expect(homeHeading(page)).toBeVisible();
  await expect(areas(page).locator('[data-item-open]')).toHaveCount(21);
  await expect(rowFor(page, 'Heaters not working', 'Hallway')).toBeVisible();
  await expectNoReload(phone);
  await phone.context.close();
});

test('a code also works as a link, and a link whose code does not work says so', async ({ browser, baseURL }) => {
  const stratis = await openDevice(browser, baseURL!, {
    localStorage: { [DEMO_DOC_KEY]: JSON.stringify(doc) },
    signIn: { setup: SETUP_CODE },
  });
  await expect(homeHeading(stratis.page)).toBeVisible();

  // A link to a code that was never made: the field holds it, and a notice says the link didn't work.
  const wrong = await openDevice(browser, baseURL!, { path: '/?code=ABCD-EFGH' });
  await expect(welcome(wrong.page).getByText('That link’s code didn’t work. Ask for a new one.')).toBeVisible();
  await expect(codeField(wrong.page)).toHaveValue('ABCD-EFGH');
  expect(new URL(wrong.page.url()).search).toBe('');
  await wrong.context.close();

  const code = await codeFor(stratis.context, 'Shea');
  const shea = await openDevice(browser, baseURL!, { path: `/?code=${code}` });
  const hello = shea.page.getByRole('region', { name: 'Welcome home, Shea' });
  await expect(hello.getByRole('heading', { name: 'Welcome home, Shea', level: 1 })).toBeVisible();
  expect(new URL(shea.page.url()).search).toBe('');
  await hello.getByRole('button', { name: 'Continue' }).click();
  await expect(chips(shea.page).getByRole('radio', { name: `Shea (you), ${SHEAS.length} items`, exact: true })).toBeVisible();
  await expect(chips(stratis.page).getByRole('radio', { name: `Shea, ${SHEAS.length} items`, exact: true })).toBeVisible({
    timeout: SYNC_MS,
  });
  await expectNoReload(stratis);
  await expectNoReload(shea);
  await stratis.context.close();
  await shea.context.close();
});

test('with no home online, a phone without a demo home is told home.os isn’t set up here yet', async ({ browser, baseURL }) => {
  const phone = await openDevice(browser, baseURL!);
  const door = welcome(phone.page);
  await expect(door.getByText('This home is private.', { exact: true })).toBeVisible();
  await expect(door.getByText('home.os isn’t set up here yet.', { exact: true })).toBeVisible();
  await expect(codeField(phone.page)).toBeVisible();
  await expect(phone.page.getByRole('region', { name: 'Bring this home online' })).toHaveCount(0);
  await expectNoReload(phone);
  await phone.context.close();
});

test('a stranger without a code stays out; wrong codes are refused, then limited, and never stored', async ({ browser, baseURL }) => {
  const stratis = await openDevice(browser, baseURL!, {
    localStorage: { [DEMO_DOC_KEY]: JSON.stringify(doc) },
    signIn: { setup: SETUP_CODE },
  });
  await expect(homeHeading(stratis.page)).toBeVisible();
  const before = await version(stratis.context);
  const real = await codeFor(stratis.context, 'Shea');
  const afterCode = await version(stratis.context);
  expect(afterCode.rev).toBe(before.rev + 1);

  const robin = await openDevice(browser, baseURL!);
  const page = robin.page;
  const door = welcome(page);
  await expect(door.getByText('This home is private.', { exact: true })).toBeVisible();
  await expect(door.getByText('Ask someone at home for a code.', { exact: true })).toBeVisible();
  // Nothing of the home shows.
  await expect(homeScreen(page)).toHaveCount(0);
  await expect(page.getByText('Our home', { exact: true })).toHaveCount(0);
  await expect(page.getByText('21 Alderbrook Road', { exact: true })).toHaveCount(0);
  const field = codeField(page);
  const join = door.getByRole('button', { name: 'Join' });
  // The local server allows 5 tries per address in its window (playwright.server.config.ts).
  for (let i = 0; i < 5; i++) {
    await field.fill('');
    await typeCode(field, `ZZZZ-ZZZ${'23456'[i]}`);
    await join.click();
    await expect(door.getByRole('alert')).toHaveText('That code didn’t work. Check it, or ask for a new one.');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
  }
  // Then even the right code waits: guessing is limited.
  await field.fill('');
  await typeCode(field, real);
  await join.click();
  await expect(door.getByRole('alert')).toHaveText('Too many tries. Wait 15 minutes, then try again.');
  await expect(homeScreen(page)).toHaveCount(0);
  // No wrong code wrote anything.
  expect(await version(stratis.context)).toEqual(afterCode);
  // And the API says no to a browser without a key.
  const res = await robin.context.request.get('/api/home?op=version', { headers: { 'X-HomeOS': '1' } });
  expect(res.status()).toBe(401);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_signed_in');
  // Shea is still waiting to join, and her code still works once the limit has passed.
  const dialog = await openHousehold(stratis.page);
  await expect(personRow(dialog, 'Shea')).toHaveText('🦔Shea, Not joined yet');
  expect((await loadHome(stratis.context)).members.find((m) => m.name === 'Shea')!.user_id).toBeNull();
  await expect(people(dialog).getByRole('button', { name: 'Add Person' })).toBeVisible();
  await expectNoReload(stratis);
  await expectNoReload(robin);
  await stratis.context.close();
  await robin.context.close();
});

test('the Welcome screen works on the smallest phone', async ({ browser, baseURL }) => {
  const phone = await openDevice(browser, baseURL!, {
    viewport: { width: 320, height: 568 },
    localStorage: { [DEMO_DOC_KEY]: JSON.stringify(doc) },
    path: `/?setup=${SETUP_CODE}`,
  });
  const page = phone.page;
  const step = page.getByRole('region', { name: 'Bring this home online' });
  await expect(step.getByRole('button', { name: 'Bring It Online' })).toBeVisible();
  // Nothing wider than the screen; the button can be reached.
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(320);
  await step.getByRole('button', { name: 'Bring It Online' }).scrollIntoViewIfNeeded();
  await expect(step.getByRole('button', { name: 'Bring It Online' })).toBeInViewport();
  await phone.context.close();

  const other = await openDevice(browser, baseURL!, { viewport: { width: 320, height: 568 } });
  await expect(codeField(other.page)).toBeVisible();
  expect(await other.page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(320);
  const join = welcome(other.page).getByRole('button', { name: 'Join' });
  await join.scrollIntoViewIfNeeded();
  await expect(join).toBeInViewport();
  await other.context.close();
});


test('Bring It Online again after its reply was lost: the phone gets in as the owner, and the home is not built twice', async ({
  browser,
  baseURL,
}) => {
  const stratis = await openDevice(browser, baseURL!, {
    localStorage: { [DEMO_DOC_KEY]: JSON.stringify(doc) },
    path: `/?setup=${SETUP_CODE}`,
  });
  const a = stratis.page;
  const step = a.getByRole('region', { name: 'Bring this home online' });
  await expect(step.getByRole('textbox', { name: 'Setup code' })).toHaveValue(SETUP_CODE);
  // The first tap reaches the server, but neither its reply nor its cookie ever arrives (the
  // connection dropped, or the app was put away straight after the tap).
  let dropped = false;
  await a.route('**/api/home', async (route) => {
    if (!dropped && (route.request().postData() ?? '').includes('"op":"setup"')) {
      dropped = true;
      await route.fetch();
      await stratis.context.clearCookies();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await step.getByRole('button', { name: 'Bring It Online' }).click();
  await expect(step.getByRole('alert')).toHaveText('No connection. Try again in a moment.');
  expect(dropped).toBe(true);
  const api = await requestFor.newContext({ baseURL });
  const status = await api.get('/api/home?op=status', { headers: { 'X-HomeOS': '1' } });
  expect(await status.json()).toEqual({ home: true });
  await api.dispose();

  // Tapped again: this phone becomes the owner's device, on the home that is online.
  await step.getByRole('button', { name: 'Bring It Online' }).click();
  await a.getByRole('region', { name: 'Shea hasn’t joined yet' }).getByRole('button', { name: 'Continue' }).click();
  await expect(homeHeading(a)).toBeVisible();
  await expectPhoneHome(a);
  expect(await devicesOf(stratis.context)).toHaveLength(1);
  // It stays signed in.
  await a.reload();
  await expect(homeHeading(a)).toBeVisible();
  // Once the owner has used it, the setup code is used up for good.
  const late = await openDevice(browser, baseURL!, {
    localStorage: { [DEMO_DOC_KEY]: JSON.stringify(doc) },
    path: `/?setup=${SETUP_CODE}`,
  });
  await expect(welcome(late.page).getByText('This home is already online. Ask someone at home for a code.')).toBeVisible();
  // The browser logs the dropped request.
  stratis.errors.splice(0, stratis.errors.length, ...stratis.errors.filter((e) => !/ERR_FAILED/.test(e)));
  expect(stratis.errors).toEqual([]);
  expect(late.errors).toEqual([]);
  await stratis.context.close();
  await late.context.close();
});

test('a setup link opened where the home is not says where to use it, with the code to copy', async ({ browser, baseURL }) => {
  // Safari on an iPhone with no home in it: the home is in the Home Screen app.
  const safari = await openDevice(browser, baseURL!, { path: `/?setup=${SETUP_CODE}`, userAgent: IPHONE_SAFARI_UA });
  await safari.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const door = welcome(safari.page);
  await expect(door.getByText('Open home.os from your Home Screen.')).toBeVisible();
  await expect(
    door.getByText('Your home is kept in the home.os app on your Home Screen, not in Safari. Open it there and enter this setup code.'),
  ).toBeVisible();
  await expect(door.getByText(SETUP_CODE, { exact: true })).toBeVisible();
  await door.getByRole('button', { name: 'Copy Code' }).click();
  await expect(door.getByText('Copied.')).toBeVisible();
  expect(await safari.page.evaluate(() => navigator.clipboard.readText())).toBe(SETUP_CODE);
  await expect(safari.page.getByRole('region', { name: 'Bring this home online' })).toHaveCount(0);
  expect(await safari.page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(402);

  // Safari holding a copy too (say, from trying home.os before adding it to the Home Screen):
  // the same, with that copy's age and a way to bring it online after all.
  const withCopy = await openDevice(browser, baseURL!, {
    path: `/?setup=${SETUP_CODE}`,
    userAgent: IPHONE_SAFARI_UA,
    localStorage: { [DEMO_DOC_KEY]: JSON.stringify(doc) },
  });
  const there = welcome(withCopy.page);
  await expect(there.getByText(/^This browser has a copy too: Our home, 6\sareas · 19\sitems · 3\sdone, last changed /)).toBeVisible();
  await there.getByRole('button', { name: 'Use This Copy Instead' }).click();
  const step = withCopy.page.getByRole('region', { name: 'Bring this home online' });
  await expect(step.getByRole('textbox', { name: 'Setup code' })).toHaveValue(SETUP_CODE);
  await expect(step.getByText('Use home.os from your Home Screen? Bring it online from there.')).toBeVisible();
  await expect(step.getByText(/^Last changed /)).toBeVisible();
  await expectNoReload(safari);
  await expectNoReload(withCopy);
  await safari.context.close();
  await withCopy.context.close();
});

test('a setup link opened on a phone without the home can bring the saved copy online', async ({ browser, baseURL }) => {
  const safari = await openDevice(browser, baseURL!, { path: `/?setup=${SETUP_CODE}`, userAgent: IPHONE_SAFARI_UA });
  const a = safari.page;
  const door = welcome(a);
  await expect(door.getByText(/^Or bring your saved copy online from here: Our home, 11\sareas · 21\sitems\.$/)).toBeVisible();
  await door.getByRole('button', { name: 'Use the Saved Copy' }).click();

  const step = a.getByRole('region', { name: 'Bring this home online' });
  await expect(step).toContainText('11 areas · 21 items');
  await expect(step.getByRole('list', { name: 'People' }).getByRole('listitem')).toHaveText(['🦆Stratis (you)', '🦔Shea']);
  await expect(step.getByText('This is your saved copy of the home.')).toBeVisible();
  await expect(step.getByRole('textbox', { name: 'Setup code' })).toHaveValue(SETUP_CODE);
  await step.getByRole('button', { name: 'Bring It Online' }).click();

  const waiting = a.getByRole('region', { name: 'Shea hasn’t joined yet' });
  await waiting.getByRole('button', { name: 'Continue' }).click();
  await expect(homeHeading(a)).toBeVisible();
  await expect(areaHeadings(a)).toHaveText([
    'Kitchen',
    'Living Room',
    'Bathroom Small',
    'Bathroom Large',
    'Bedroom Small',
    'Bedroom Large',
    'Garden',
    'Garden Lounge',
    'Jacuzzi',
    'Hallway',
    'Front garden',
  ]);
  await expect(areas(a).locator('[data-item-open]')).toHaveCount(21);
  await expect(rowFor(a, 'Rubbish fill level', 'Kitchen')).toBeVisible();
  await expect(rowFor(a, 'Check Chemicals', 'Jacuzzi')).toContainText('Order a new pack.');
  // Nothing was kept in Safari: the home lives on the server.
  expect(await a.evaluate((key) => localStorage.getItem(key), DEMO_DOC_KEY)).toBeNull();
  await expectNoReload(safari);
  await safari.context.close();
});

test('a code link opened in Safari on an iPhone is not used up there: typed in the Home Screen app, it works', async ({
  browser,
  baseURL,
}) => {
  const stratis = await openDevice(browser, baseURL!, {
    localStorage: { [DEMO_DOC_KEY]: JSON.stringify(doc) },
    signIn: { setup: SETUP_CODE },
  });
  await expect(homeHeading(stratis.page)).toBeVisible();
  const code = await codeFor(stratis.context, 'Shea');

  // Shea taps the link in Messages: Safari opens it.
  const safari = await openDevice(browser, baseURL!, { path: `/?code=${code}`, userAgent: IPHONE_SAFARI_UA });
  const door = welcome(safari.page);
  await expect(door.getByText('Using home.os from your Home Screen? Open it there and type this code. Or join in this browser.')).toBeVisible();
  await expect(codeField(safari.page)).toHaveValue(code);
  await expect(door.getByRole('button', { name: 'Join in This Browser' })).toBeVisible();
  await expect(door.getByRole('button', { name: 'Copy Code' })).toBeVisible();
  expect(new URL(safari.page.url()).search).toBe('');

  // She opens home.os on her Home Screen and types it there.
  const app = await openDevice(browser, baseURL!, { userAgent: IPHONE_SAFARI_UA });
  await app.context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await app.page.reload();
  await typeCode(codeField(app.page), code);
  await welcome(app.page).getByRole('button', { name: 'Join' }).click();
  const hello = app.page.getByRole('region', { name: 'Welcome home, Shea' });
  await expect(hello.getByRole('heading', { name: 'Welcome home, Shea', level: 1 })).toBeVisible();
  await hello.getByRole('button', { name: 'Continue' }).click();
  await expect(homeHeading(app.page)).toBeVisible();

  // Stratis sees which of her devices it is.
  const dialog = await openHouseholdOf(stratis.page);
  await openPersonPage(dialog, 'Shea');
  const devices = dialog.getByRole('region', { name: 'Devices' });
  await expect(devices.getByText('iPhone · Home Screen app')).toBeVisible();
  // He can't make her a code while she is signed in: only she can add a device.
  await expect(devices.getByRole('button', { name: 'Sign in on a new phone' })).toHaveCount(0);
  await expect(dialog.getByText(/^Only Shea can sign in on another device/)).toBeVisible();
  await expectNoReload(stratis);
  await expectNoReload(safari);
  for (const d of [stratis, safari, app]) await d.context.close();
});
