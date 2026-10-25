import { expect, test } from '@playwright/test';
import { API_PATH } from '../src/lib/backend/serverApi';
import {
  addGoals,
  confirmation,
  expectNoReload,
  goalRow,
  goalsScreen,
  goalsWeek,
  goalTick,
  goalTitles,
  goToTab,
  openDevice,
  resetServer,
  settled,
  stratisAndShea,
  SYNC_MS,
  tabButton,
  type Device,
} from './helpers';

// Goals for the week in server mode (docs/ARCHITECTURE.md "Goals for the week"): two phones
// build and edit the same week, each change showing on the other without a reload; the public
// link opens in a browser that has never signed in (GET /api/home?op=publicGoals, no session,
// no X-HomeOS header), and says it is no longer active once turned off.

let stratis: Device;
let shea: Device;
let stranger: Device | undefined;

test.beforeEach(async ({ browser, baseURL, request }) => {
  await resetServer(request);
  ({ stratis, shea } = await stratisAndShea(browser, baseURL!));
});

test.afterEach(async () => {
  await stratis?.context.close();
  await shea?.context.close();
  await stranger?.context.close();
  stranger = undefined;
});

test('two phones build and edit the same week', async () => {
  const a = stratis.page;
  const b = shea.page;
  await goToTab(a, 'Goals');
  await goToTab(b, 'Goals');
  // A home brought online starts with no goals.
  await expect(goalsWeek(a).getByRole('heading', { level: 2 })).toHaveText(/^This week, /);
  await expect(goalsScreen(a).locator('[data-goals-progress]')).toHaveText('Nothing planned yet');
  await expect(tabButton(a, 'Goals')).toHaveAccessibleName('Goals');

  await addGoals(a, 'Fix the fence', 'Book the boiler service');
  // On Shea's phone, without a reload.
  await expect.poll(() => goalTitles(b), { timeout: SYNC_MS }).toEqual(['Fix the fence', 'Book the boiler service']);
  await expect(tabButton(b, 'Goals')).toHaveAccessibleName('Goals, 2 not done');

  // Shea ticks one, takes the other and adds her own.
  await goalTick(b, 'Fix the fence').click();
  await goalsWeek(b).getByRole('button', { name: 'Choose who is on Book the boiler service' }).click();
  await b.getByRole('menu', { name: 'Who’s on it' }).getByRole('menuitemradio', { name: 'Shea' }).click();
  await addGoals(b, 'Clean the gutters');

  // Stratis sees all of it: who ticked it, who is on it.
  await expect(goalTick(a, 'Fix the fence')).toHaveAttribute('aria-checked', 'true', { timeout: SYNC_MS });
  await expect(goalRow(a, 'Fix the fence').locator('[data-goal-done]')).toHaveText(/^Done by Shea · Today \d\d:\d\d$/);
  await expect(goalRow(a, 'Book the boiler service').locator('[data-goal-person]')).toHaveText(/Shea$/, { timeout: SYNC_MS });
  await expect.poll(() => goalTitles(a), { timeout: SYNC_MS }).toEqual(['Fix the fence', 'Book the boiler service', 'Clean the gutters']);
  await expect(goalsScreen(a).locator('[data-goals-progress]')).toHaveText('1 of 3 done');

  // Stratis renames hers and moves it to the top; Shea sees both.
  const title = goalRow(a, 'Clean the gutters').getByRole('textbox', { name: 'Goal' });
  await title.fill('Clean the gutters before the rain');
  await title.press('Enter');
  await goalsWeek(a).getByRole('button', { name: 'Clean the gutters before the rain options' }).click();
  await a.getByRole('menu', { name: 'Clean the gutters before the rain options' }).getByRole('menuitem', { name: 'Move Up' }).click();
  await goalsWeek(a).getByRole('button', { name: 'Clean the gutters before the rain options' }).click();
  await a.getByRole('menu', { name: 'Clean the gutters before the rain options' }).getByRole('menuitem', { name: 'Move Up' }).click();
  await expect
    .poll(() => goalTitles(b), { timeout: SYNC_MS })
    .toEqual(['Clean the gutters before the rain', 'Fix the fence', 'Book the boiler service']);

  // Shea deletes the fence; it goes on Stratis's phone too.
  await goalsWeek(b).getByRole('button', { name: 'Fix the fence options' }).click();
  await b.getByRole('menu', { name: 'Fix the fence options' }).getByRole('menuitem', { name: 'Delete Goal' }).click();
  await (await confirmation(b, 'Delete Fix the fence?')).getByRole('button', { name: 'Delete Goal' }).click();
  await expect.poll(() => goalTitles(a), { timeout: SYNC_MS }).toEqual(['Clean the gutters before the rain', 'Book the boiler service']);
  await expect(tabButton(a, 'Goals')).toHaveAccessibleName('Goals, 2 not done');

  await expectNoReload(stratis);
  await expectNoReload(shea);
});

test('the public link: anyone, signed out, sees this week; Turn Off ends it', async ({ browser, baseURL }) => {
  const a = stratis.page;
  await goToTab(a, 'Goals');
  await addGoals(a, 'Fix the fence', 'Book the boiler service');
  await goalsWeek(a).getByRole('button', { name: 'Choose who is on Book the boiler service' }).click();
  await a.getByRole('menu', { name: 'Who’s on it' }).getByRole('menuitemradio', { name: 'Shea' }).click();
  await expect(goalRow(a, 'Book the boiler service').locator('[data-goal-person]')).toHaveText(/Shea$/);

  await stratis.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await goalsScreen(a).getByRole('button', { name: 'Share', exact: true }).click();
  const sheet = a.getByRole('dialog', { name: 'Share this week’s goals' });
  await settled(sheet.getByRole('button', { name: 'Done', exact: true }));
  await sheet.getByRole('button', { name: 'Copy Link' }).last().click();
  await expect(sheet.getByRole('status')).toHaveText('Link copied.');
  const link = new URL(await a.evaluate(() => navigator.clipboard.readText()));
  const token = link.searchParams.get('goals')!;
  expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(link.origin).toBe(new URL(baseURL!).origin);
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(sheet).toHaveCount(0);

  // A browser that has never signed in: the page, and nothing else of the home.
  stranger = await openDevice(browser, baseURL!, { path: `${link.pathname}${link.search}` });
  const p = stranger.page;
  await expect(p.getByRole('heading', { name: 'Goals for the week', level: 1 })).toBeVisible();
  await expect(p.locator('[data-public-progress]')).toHaveText('0 of 2 done');
  await expect(p.locator('[data-public-list] li')).toHaveText(['Fix the fence', /^Book the boiler service.+ Shea$/]);
  await expect(p.getByRole('navigation', { name: 'Tabs' })).toHaveCount(0);
  await expect(p.getByRole('textbox')).toHaveCount(0);
  expect(stranger.errors).toEqual([]);
  expect((await stranger.context.cookies()).length).toBe(0);
  // The answer itself: no session, no X-HomeOS header; public fields only; cached at the edge.
  const res = await stranger.context.request.get(`${API_PATH}?op=publicGoals&token=${token}`);
  expect(res.status()).toBe(200);
  // The edge keeps it a minute; its stale-while-revalidate is the proxy's own, and not passed on
  // (server/entry/local.ts does as Vercel's proxy does), so the browser always asks again.
  expect(res.headers()['cache-control']).toBe('public, max-age=0, s-maxage=60');
  expect(res.headers()['set-cookie']).toBeUndefined();
  const body = (await res.json()) as { week: string; goals: Record<string, unknown>[] };
  expect(Object.keys(body).sort()).toEqual(['goals', 'week']);
  expect(body.goals.map((g) => Object.keys(g).sort())).toEqual([
    ['done', 'person', 'title'],
    ['done', 'person', 'title'],
  ]);

  // A tick at home shows the next time the page asks.
  await goalTick(a, 'Fix the fence').click();
  await expect(goalTick(a, 'Fix the fence')).toHaveAttribute('aria-checked', 'true');
  await expect(goalsScreen(a).locator('[data-goals-progress]')).toHaveText('1 of 2 done');
  await expect
    .poll(
      async () => {
        await p.reload();
        return p.locator('[data-public-progress]').textContent();
      },
      { timeout: SYNC_MS * 2 },
    )
    .toBe('1 of 2 done');

  // Turned off: the page says so; the answer is 404.
  await goalsScreen(a).getByRole('button', { name: 'Share', exact: true }).click();
  await settled(sheet.getByRole('button', { name: 'Done', exact: true }));
  await sheet.getByRole('button', { name: 'Turn Off Link' }).click();
  await (await confirmation(a, 'Turn off the link?')).getByRole('button', { name: 'Turn Off Link' }).click();
  await expect(sheet.getByRole('status')).toHaveText('The link is off. Anyone who opens it now sees that it is no longer active.');
  await p.reload();
  await expect(p.getByRole('heading', { name: 'This link is no longer active' })).toBeVisible();
  expect((await stranger.context.request.get(`${API_PATH}?op=publicGoals&token=${token}`)).status()).toBe(404);

  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expectNoReload(stratis);
});
