import {
  addGoals,
  confirmation,
  DEMO_STORAGE_KEY,
  expect,
  goalRow,
  goalsProgress,
  goalsScreen,
  goalsWeek,
  goalTick,
  goalTitles,
  NOW,
  openGoals,
  openGoalsShare,
  openSeeded,
  reopen,
  tabButton,
  test,
  type Locator,
  type Page,
} from './fixtures';

// Goals for the week (docs/ARCHITECTURE.md "Goals for the week"), the second tab, against the
// demo seed at the e2e clock (Thu 8 Oct 2026, 10:00 London): this week is 5 to 11 Oct with four
// goals, two done; last week (28 Sep to 4 Oct) had three, one not finished.

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

const THIS_WEEK = ['Sort out the recycling rota', 'Deep clean the fridge', 'Pay the window cleaner', 'Plan Saturday’s dinner'];

/** A goal's "…" menu, opened. */
async function goalMenu(page: Page, title: string): Promise<Locator> {
  await goalsWeek(page).getByRole('button', { name: `${title} options`, exact: true }).click();
  const menu = page.getByRole('menu', { name: `${title} options` });
  await expect(menu).toBeVisible();
  return menu;
}

/** Holds `grip` and moves it, in steps as a finger does, to the middle of `onto`. */
async function drag(page: Page, grip: Locator, onto: Locator): Promise<void> {
  const from = (await grip.boundingBox())!;
  const to = (await onto.boundingBox())!;
  const x = from.x + from.width / 2;
  const y0 = from.y + from.height / 2;
  const y1 = to.y + to.height / 2;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(x, y0 + ((y1 - y0) * i) / 12);
  await page.mouse.up();
}

/** The stored demo household, as JSON (for a signed-out copy, or a session switch). */
function storedDoc(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), DEMO_STORAGE_KEY);
}

/** Signs this phone in as someone else at home who has joined (Shea, say), then reopens the app. */
async function signInAs(page: Page, first: string): Promise<void> {
  await page.evaluate(
    ([key, first]) => {
      const doc = JSON.parse(localStorage.getItem(key)!);
      const member = doc.members.find((m: { name: string }) => m.name.split(' ')[0] === first);
      if (!doc.users.some((u: { id: string }) => u.id === member.user_id)) {
        doc.users.push({ id: member.user_id, email: member.email, name: member.name });
      }
      doc.session = member.user_id;
      localStorage.setItem(key, JSON.stringify(doc));
    },
    [DEMO_STORAGE_KEY, first] as const,
  );
  await reopen(page);
  await expect(tabButton(page, 'Goals')).toBeVisible();
}

/** The token of the home's public link, as stored. */
async function token(page: Page): Promise<string | null> {
  const doc = (await storedDoc(page)) as { goal_links: { token: string }[] };
  return doc.goal_links[0]?.token ?? null;
}

test.beforeEach(async ({ page }) => {
  await openSeeded(page);
});

test.describe('Goals for the week', () => {
  test('the second tab: this week, how much is done, and the weeks either side', async ({ page }) => {
    await expect(tabButton(page, 'Goals')).toHaveAccessibleName('Goals, 2 not done');
    await openGoals(page);
    await expect(goalsWeek(page).getByRole('heading', { level: 2 })).toHaveText('This week, 5 to 11 Oct');
    expect(await goalTitles(page)).toEqual(THIS_WEEK);
    await expect(goalsProgress(page)).toHaveText('2 of 4 done');
    await expect(goalTick(page, 'Deep clean the fridge')).toHaveAttribute('aria-checked', 'true');
    await expect(goalRow(page, 'Deep clean the fridge').locator('[data-goal-done]')).toHaveText('Done · Yesterday 14:00');
    await expect(goalRow(page, 'Deep clean the fridge').locator('[data-goal-person]')).toHaveText('🦆Shea');
    // No round + here: Add a Goal is in the list.
    await expect(page.getByRole('button', { name: 'New item', exact: true })).toHaveCount(0);

    await goalsWeek(page).getByRole('button', { name: 'Previous week' }).click();
    await expect(goalsWeek(page).getByRole('heading', { level: 2 })).toHaveText('Last week, 28 Sep to 4 Oct');
    expect(await goalTitles(page)).toEqual(['Book the boiler service', 'Sort out the recycling rota', 'Fix the bike lights']);
    await goalsScreen(page).getByRole('button', { name: 'This Week', exact: true }).click();
    await expect(goalsWeek(page).getByRole('heading', { level: 2 })).toHaveText('This week, 5 to 11 Oct');
  });

  test('build next week’s list: add, rename, who is on it, drag, delete; all kept', async ({ page }) => {
    await openGoals(page);
    await goalsWeek(page).getByRole('button', { name: 'Next week' }).click();
    await expect(goalsWeek(page).getByRole('heading', { level: 2 })).toHaveText('Next week, 12 to 18 Oct');
    await expect(goalsWeek(page).getByText('Plan ahead: what should get done that week?')).toBeVisible();
    await addGoals(page, 'Mow the lawn', 'Clean the windows', 'Call the plumber');
    expect(await goalTitles(page)).toEqual(['Mow the lawn', 'Clean the windows', 'Call the plumber']);
    await expect(goalsProgress(page)).toHaveText('0 of 3 done');

    // Rename: the title in place, selected, so typing replaces it.
    await (await goalMenu(page, 'Call the plumber')).getByRole('menuitem', { name: 'Rename' }).click();
    const title = goalRow(page, 'Call the plumber').getByRole('textbox', { name: 'Goal' });
    await expect(title).toBeFocused();
    await page.keyboard.type('Call the plumber about the tap');
    await page.keyboard.press('Enter');
    await expect(goalTick(page, 'Call the plumber about the tap')).toBeVisible();

    // Who is on it.
    await goalsWeek(page).getByRole('button', { name: 'Choose who is on Mow the lawn' }).click();
    await page.getByRole('menu', { name: 'Who’s on it' }).getByRole('menuitemradio', { name: 'Ela' }).click();
    await expect(goalRow(page, 'Mow the lawn').locator('[data-goal-person]')).toHaveText('🦊Ela');

    // Drag the last to the top by its grip (again if a busy machine dropped the gesture).
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(async () => {
      await drag(
        page,
        goalsWeek(page).getByRole('button', { name: 'Reorder Call the plumber about the tap' }),
        goalsWeek(page).getByRole('button', { name: /^Reorder / }).first(),
      );
      await expect.poll(() => goalTitles(page), { timeout: 2_000 }).toEqual([
        'Call the plumber about the tap',
        'Mow the lawn',
        'Clean the windows',
      ]);
    }).toPass({ timeout: 15_000 });
    // And Move Down from its menu.
    await (await goalMenu(page, 'Call the plumber about the tap')).getByRole('menuitem', { name: 'Move Down' }).click();
    await expect.poll(() => goalTitles(page)).toEqual(['Mow the lawn', 'Call the plumber about the tap', 'Clean the windows']);

    // Delete, after asking.
    await (await goalMenu(page, 'Clean the windows')).getByRole('menuitem', { name: 'Delete Goal' }).click();
    const sheet = await confirmation(page, 'Delete Clean the windows?');
    await expect(sheet).toContainText('It goes for everyone at home.');
    await sheet.getByRole('button', { name: 'Delete Goal' }).click();
    await expect.poll(() => goalTitles(page)).toEqual(['Mow the lawn', 'Call the plumber about the tap']);

    // All kept: after a reload, on the same tab, the same week.
    await reopen(page);
    await expect(goalsWeek(page).getByRole('heading', { level: 2 })).toHaveText('This week, 5 to 11 Oct');
    await goalsWeek(page).getByRole('button', { name: 'Next week' }).click();
    expect(await goalTitles(page)).toEqual(['Mow the lawn', 'Call the plumber about the tap']);
    await expect(goalRow(page, 'Mow the lawn').locator('[data-goal-person]')).toHaveText('🦊Ela');
    // This week's count on the tab is this week's alone.
    await expect(tabButton(page, 'Goals')).toHaveAccessibleName('Goals, 2 not done');
  });

  test('anyone at home edits the same week: Shea ticks, renames and deletes what Stratis added', async ({ page }) => {
    await openGoals(page);
    await addGoals(page, 'Book the chimney sweep');

    await signInAs(page, 'Shea');
    await expect(page.getByRole('button', { name: 'Profile', exact: true })).toHaveText('🦆');
    await expect(goalsScreen(page).getByRole('heading', { name: 'Goals for the week', level: 1 })).toBeVisible();
    expect(await goalTitles(page)).toEqual([...THIS_WEEK, 'Book the chimney sweep']);
    await goalTick(page, 'Sort out the recycling rota').click();
    await expect(goalTick(page, 'Sort out the recycling rota')).toHaveAttribute('aria-checked', 'true');
    // Ela is on it and Shea ticked it: it says so.
    await expect(goalRow(page, 'Sort out the recycling rota').locator('[data-goal-done]')).toHaveText(/^Done by Shea · Today 10:0\d$/);
    const name = goalRow(page, 'Book the chimney sweep').getByRole('textbox', { name: 'Goal' });
    await name.fill('Book the chimney sweep for Friday');
    await name.press('Enter');
    await expect(goalTick(page, 'Book the chimney sweep for Friday')).toBeVisible();
    await (await goalMenu(page, 'Pay the window cleaner')).getByRole('menuitem', { name: 'Delete Goal' }).click();
    await (await confirmation(page, 'Delete Pay the window cleaner?')).getByRole('button', { name: 'Delete Goal' }).click();
    await expect(goalTick(page, 'Pay the window cleaner')).toHaveCount(0);
    await expect(tabButton(page, 'Goals')).toHaveAccessibleName('Goals, 2 not done');

    // Back on Stratis's phone: all of it.
    await signInAs(page, 'Stratis');
    await expect(page.getByRole('button', { name: 'Profile', exact: true })).toHaveText('🦔');
    expect(await goalTitles(page)).toEqual([
      'Sort out the recycling rota',
      'Deep clean the fridge',
      'Plan Saturday’s dinner',
      'Book the chimney sweep for Friday',
    ]);
    await expect(goalRow(page, 'Sort out the recycling rota').locator('[data-goal-done]')).toHaveText(/^Done by Shea · Today 10:0\d$/);
    await expect(goalsProgress(page)).toHaveText('2 of 4 done');
  });

  test('ticking follows on the tab; the last of the week celebrates', async ({ page }) => {
    await openGoals(page);
    await goalTick(page, 'Sort out the recycling rota').click();
    await expect(tabButton(page, 'Goals')).toHaveAccessibleName('Goals, 1 not done');
    await goalTick(page, 'Plan Saturday’s dinner').click();
    await expect(tabButton(page, 'Goals')).toHaveAccessibleName('Goals');
    await expect(goalsProgress(page)).toHaveText('All 4 done');
    // Untick: back again.
    await goalTick(page, 'Plan Saturday’s dinner').click();
    await expect(tabButton(page, 'Goals')).toHaveAccessibleName('Goals, 1 not done');
    await expect(goalRow(page, 'Plan Saturday’s dinner').locator('[data-goal-done]')).toHaveCount(0);
  });

  test('an empty week with last week unfinished: Bring over', async ({ page }) => {
    await page.evaluate((key) => {
      const doc = JSON.parse(localStorage.getItem(key)!);
      doc.goals = doc.goals.filter((g: { week: string }) => g.week !== '2026-10-05');
      localStorage.setItem(key, JSON.stringify(doc));
    }, DEMO_STORAGE_KEY);
    await reopen(page);
    await openGoals(page);
    await expect(goalsWeek(page).getByText('What would make it a good week at home?')).toBeVisible();
    await expect(goalsProgress(page)).toHaveText('Nothing planned yet');
    await goalsWeek(page).getByRole('button', { name: 'Bring over 1 from last week' }).click();
    await expect.poll(() => goalTitles(page)).toEqual(['Sort out the recycling rota']);
    await expect(goalRow(page, 'Sort out the recycling rota').locator('[data-goal-person]')).toHaveText('🦊Ela');
    await expect(goalsWeek(page).getByRole('button', { name: /^Bring over/ })).toHaveCount(0);
  });
});

test.describe('The public link', () => {
  test('Share makes a link anyone can open, signed out, that follows the week; Turn Off ends it', async ({ page, context, browser }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openGoals(page);
    let sheet = await openGoalsShare(page);
    await expect(sheet.getByRole('heading', { name: 'Share this week’s goals' })).toBeVisible();
    await expect(sheet.getByRole('figure', { name: 'What the link shows' })).toContainText('5 to 11 Oct');
    await expect(sheet.getByRole('button', { name: 'Turn Off Link' })).toHaveCount(0);
    await sheet.getByRole('button', { name: /^(Share|Copy) Link$/ }).first().click();
    await expect.poll(() => token(page)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const first = (await token(page))!;
    const url = `/?goals=${first}`;
    await expect(sheet.locator('[data-goals-url]')).toContainText(url);
    // Copy Link copies the same one.
    await sheet.getByRole('button', { name: 'Copy Link' }).last().click();
    await expect(sheet.getByRole('status')).toHaveText('Link copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/\\?goals=${first}$`));
    expect(await token(page)).toBe(first);
    await sheet.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await expect(goalsScreen(page).locator('[data-goals-link-on]')).toHaveText(
      'Shared with a link. Anyone with it can see this week’s goals.',
    );

    // Someone signed out, on another phone (this demo keeps the home in the browser, so the
    // other phone gets a copy of it with nobody signed in).
    const doc = { ...(await storedDoc(page)), session: null, users: [] };
    const visitor = await browser.newContext({ viewport: { width: 402, height: 874 }, timezoneId: 'Europe/London', serviceWorkers: 'block' });
    await visitor.addInitScript(
      ([key, json]) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, json);
      },
      [DEMO_STORAGE_KEY, JSON.stringify(doc)] as const,
    );
    const stranger = await visitor.newPage();
    await stranger.clock.install({ time: NOW });
    await stranger.goto(url);
    await expect(stranger.getByRole('heading', { name: 'Goals for the week', level: 1 })).toBeVisible();
    await expect(stranger.getByText('5 to 11 Oct', { exact: true })).toBeVisible();
    await expect(stranger.locator('[data-public-progress]')).toHaveText('2 of 4 done');
    await expect(stranger.locator('[data-public-list] li')).toHaveText([
      'Sort out the recycling rota🦊 Ela',
      'Deep clean the fridge🦆 Shea',
      'Pay the window cleaner🦔 Stratis',
      'Plan Saturday’s dinner',
    ]);
    // Nothing else of the home: no tabs, no sign-in, nothing to change.
    await expect(stranger.getByRole('navigation', { name: 'Tabs' })).toHaveCount(0);
    await expect(stranger.getByRole('button')).toHaveCount(0);
    await expect(stranger.getByRole('checkbox')).toHaveCount(0);
    expect(await stranger.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(402);
    await visitor.close();

    // On a phone at home, the page follows the week as it changes.
    const watching = await context.newPage();
    await watching.clock.install({ time: NOW });
    await watching.goto(url);
    await expect(watching.locator('[data-public-progress]')).toHaveText('2 of 4 done');
    await goalTick(page, 'Plan Saturday’s dinner').click();
    await expect(goalTick(page, 'Plan Saturday’s dinner')).toHaveAttribute('aria-checked', 'true');
    await watching.clock.runFor(61_000);
    await expect(watching.locator('[data-public-progress]')).toHaveText('3 of 4 done');

    // Turn Off: the link says it is no longer active.
    sheet = await openGoalsShare(page);
    await sheet.getByRole('button', { name: 'Turn Off Link' }).click();
    await (await confirmation(page, 'Turn off the link?')).getByRole('button', { name: 'Turn Off Link' }).click();
    await expect(sheet.getByRole('status')).toHaveText(
      'The link is off. Anyone who opens it now sees that it is no longer active.',
    );
    await expect(sheet.locator('[data-goals-url]')).toHaveCount(0);
    await watching.reload();
    await expect(watching.getByRole('heading', { name: 'This link is no longer active' })).toBeVisible();
    await expect(watching.getByText('Ask whoever shared it for a new one.')).toBeVisible();
    await watching.close();

    // A new link later: a new token.
    await sheet.getByRole('button', { name: 'Copy Link' }).last().click();
    await expect(sheet.getByRole('status')).toHaveText('Link copied.');
    const second = await token(page);
    expect(second).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(second).not.toBe(first);
    await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  });
});
