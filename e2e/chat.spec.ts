import {
  chatScreen,
  confirmation,
  DEMO_STORAGE_KEY,
  expect,
  goToTab,
  NOW,
  openSeeded,
  reopen,
  tabButton,
  tabs,
  test,
  type Locator,
  type Page,
} from './fixtures';

test.use({ timezoneId: 'Europe/London', serviceWorkers: 'block' });

const log = (page: Page) => chatScreen(page).getByRole('log', { name: 'Messages' });
const bubbles = (page: Page) => log(page).getByRole('article');
const bubble = (page: Page, text: string | RegExp) => bubbles(page).filter({ hasText: text });
/** A message with its name, avatar and reaction chips. */
const messageRow = (page: Page, text: string | RegExp) =>
  log(page)
    .locator('[data-state]')
    .filter({ has: page.getByRole('article').filter({ hasText: text }) });
const field = (page: Page) => chatScreen(page).getByRole('textbox', { name: 'Message' });
const menu = (page: Page) => page.getByRole('dialog', { name: 'Message actions' });
const scroller = (page: Page) => chatScreen(page).locator(':scope > div').first();

async function openChat(page: Page) {
  await goToTab(page, 'Chat');
  await expect(bubbles(page).first()).toBeVisible();
}

/** Press and hold with the mouse. */
async function longPress(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

/** Writes a message from Shea straight into storage, as her phone would (the open tab hears it). */
async function messageFromShea(page: Page, body: string) {
  await page.evaluate(
    ([key, text]) => {
      const doc = JSON.parse(localStorage.getItem(key)!);
      const shea = doc.members.find((m: { name: string }) => m.name === 'Shea');
      const newest = Math.max(...doc.messages.map((m: { created_at: string }) => Date.parse(m.created_at)), Date.now());
      doc.messages.push({
        id: crypto.randomUUID(),
        household_id: shea.household_id,
        member_id: shea.id,
        body: text,
        created_at: new Date(newest + 1000).toISOString(),
      });
      localStorage.setItem(key, JSON.stringify(doc));
    },
    [DEMO_STORAGE_KEY, body] as const,
  );
}

/** A second tab on the same device (same storage), at the same moment. */
async function secondTab(page: Page): Promise<Page> {
  const other = await page.context().newPage();
  await other.clock.install({ time: NOW });
  await other.goto('/');
  await expect(other.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  return other;
}

test.describe('Chat', () => {
  test('shows the conversation, newest at the bottom, above the composer', async ({ page }) => {
    await openSeeded(page);
    await openChat(page);
    await expect(chatScreen(page).getByRole('heading', { name: 'Chat', level: 1 })).toBeAttached();
    await expect(bubbles(page)).toHaveCount(8);
    await expect(log(page).getByText('Yesterday', { exact: true }).first()).toBeAttached();
    await expect(log(page).locator('p').filter({ hasText: 'Today 08:05' })).toBeVisible();
    await expect(bubble(page, 'The heating engineer')).toHaveAttribute('aria-label', 'Shea, Yesterday 18:42');
    await expect(bubble(page, 'Restocked the olive oil')).toHaveAttribute('aria-label', 'You, Today 08:05');

    // Starts at the bottom: the newest message is in view, clear of the composer.
    const last = bubble(page, "I'll order a new pack today.");
    await expect(last).toBeInViewport();
    const lastBox = (await messageRow(page, "I'll order a new pack today.").boundingBox())!;
    const composerBox = (await chatScreen(page).getByRole('form', { name: 'New message' }).boundingBox())!;
    const barBox = (await tabs(page).boundingBox())!;
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(composerBox.y);
    expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(barBox.y);

    // Others on the left in white, yours on the right in the tint.
    await expect(bubble(page, 'The heating engineer')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(bubble(page, 'Restocked the olive oil')).toHaveCSS('background-color', 'rgb(0, 122, 255)');
    await expect(bubble(page, 'Restocked the olive oil')).toHaveCSS('color', 'rgb(255, 255, 255)');
    const mine = (await bubble(page, 'Restocked the olive oil').boundingBox())!;
    const theirs = (await bubble(page, 'Legend.').boundingBox())!;
    expect(mine.x + mine.width).toBeGreaterThan(theirs.x + theirs.width);
    expect(theirs.x).toBeLessThan(mine.x);
  });

  test('sends with Enter (Shift+Enter is a new line), and keeps messages', async ({ page }) => {
    await openSeeded(page);
    await openChat(page);
    const send = chatScreen(page).getByRole('button', { name: 'Send' });
    await expect(send).toBeDisabled();
    await field(page).fill('Bin day tomorrow');
    await expect(send).toBeEnabled();
    await field(page).press('Enter');
    await expect(field(page)).toHaveValue('');
    await expect(send).toBeDisabled();
    await expect(bubble(page, 'Bin day tomorrow')).toBeInViewport();
    await expect(bubble(page, 'Bin day tomorrow')).toHaveAttribute('aria-label', /^You, Today 10:0\d$/);

    await field(page).pressSequentially('Line one');
    await field(page).press('Shift+Enter');
    await field(page).pressSequentially('Line two');
    await expect(field(page)).toHaveValue('Line one\nLine two');
    await send.click();
    await expect(bubbles(page).last()).toHaveText('Line one\nLine two');
    // The send button keeps the field focused (and the iPhone keyboard up).
    await expect(field(page)).toBeFocused();

    await reopen(page);
    await openChat(page);
    await expect(bubbles(page)).toHaveCount(10);
    await expect(bubbles(page).nth(8)).toHaveText('Bin day tomorrow');
  });

  test('messages from another tab or person arrive live; scrolled up, a pill offers them', async ({ page }) => {
    await openSeeded(page);
    await openChat(page);
    const other = await secondTab(page);
    await goToTab(other, 'Chat');
    await other.getByRole('textbox', { name: 'Message' }).fill('Sent from the other tab');
    await other.getByRole('textbox', { name: 'Message' }).press('Enter');
    await expect(bubble(page, 'Sent from the other tab')).toBeInViewport();

    await messageFromShea(other, 'Boiler pressure looks fine');
    await expect(bubble(page, 'Boiler pressure looks fine')).toBeInViewport();
    await expect(bubble(page, 'Boiler pressure looks fine')).toHaveAttribute('aria-label', /^Shea, /);

    // Scrolled up: the new message waits behind a pill.
    await scroller(page).evaluate((el) => (el.scrollTop = 0));
    await messageFromShea(other, 'Also, the gate is open');
    const pill = chatScreen(page).getByRole('button', { name: 'New messages' });
    await expect(pill).toBeVisible();
    await expect(bubble(page, 'Also, the gate is open')).not.toBeInViewport();
    await pill.click();
    await expect(bubble(page, 'Also, the gate is open')).toBeInViewport();
    await expect(pill).toHaveCount(0);
  });

  test('a long press opens the reaction bar; chips show and toggle reactions', async ({ page }) => {
    await openSeeded(page);
    await openChat(page);
    const target = bubble(page, 'Thank you! The hallway');
    await longPress(page, target);
    await expect(menu(page)).toBeVisible();
    // The finger lifting didn't close it.
    await page.waitForTimeout(300);
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole('button', { name: /^React with / })).toHaveText(['❤️', '👍', '😂', '😮', '😢', '🙏']);
    await menu(page).getByRole('button', { name: 'React with 😂' }).click();
    await expect(menu(page)).toHaveCount(0);
    const chip = messageRow(page, 'Thank you! The hallway').getByRole('button', { name: '😂, 1 reaction from you' });
    await expect(chip).toHaveAttribute('aria-pressed', 'true');

    // The fuller grid behind +.
    await longPress(page, target);
    await menu(page).getByRole('button', { name: 'More reactions' }).click();
    await expect(menu(page).getByRole('group', { name: 'All reactions' }).getByRole('button')).toHaveCount(32);
    await menu(page).getByRole('button', { name: 'React with 🏡' }).click();
    await expect(messageRow(page, 'Thank you! The hallway').getByRole('button', { name: '🏡, 1 reaction from you' })).toBeVisible();

    // Tapping someone else's chip adds you; tapping yours takes you off.
    const olive = messageRow(page, 'Restocked the olive oil');
    await olive.getByRole('button', { name: '👍, 1 reaction from Shea' }).click();
    await expect(olive.getByRole('button', { name: '👍, 2 reactions from Shea and you' })).toHaveAttribute('aria-pressed', 'true');
    await chip.click();
    await expect(messageRow(page, 'Thank you! The hallway').getByRole('button', { name: /^😂/ })).toHaveCount(0);

    // Stored: still there after a reload.
    await reopen(page);
    await openChat(page);
    await expect(
      messageRow(page, 'Restocked the olive oil').getByRole('button', { name: '👍, 2 reactions from Shea and you' }),
    ).toBeVisible();
    await expect(messageRow(page, 'Thank you! The hallway').getByRole('button', { name: '🏡, 1 reaction from you' })).toBeVisible();
  });

  test('a finger long press opens the menu too; Escape and a tap outside close it', async ({ page, context }) => {
    await openSeeded(page);
    await openChat(page);
    const box = (await bubble(page, 'Legend.').boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const point = { x: box.x + 30, y: box.y + box.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);

    await bubble(page, 'Legend.').click({ button: 'right' });
    await expect(menu(page)).toBeVisible();
    await page.mouse.click(200, 120);
    await expect(menu(page)).toHaveCount(0);
  });

  test('the keyboard opens the menu and focus comes back', async ({ page }) => {
    await openSeeded(page);
    await openChat(page);
    const target = bubble(page, 'Legend.');
    await target.focus();
    await page.keyboard.press('Enter');
    await expect(menu(page).getByRole('button', { name: 'React with ❤️' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(menu(page).getByRole('button', { name: 'React with 👍' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await expect(target).toBeFocused();
  });

  test('you can delete your own message after confirming, not someone else’s', async ({ page }) => {
    await openSeeded(page);
    await openChat(page);
    await bubble(page, 'Legend.').click({ button: 'right' });
    await expect(menu(page).getByRole('button', { name: 'Copy' })).toBeVisible();
    await expect(menu(page).getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await bubble(page, 'Restocked the olive oil').click({ button: 'right' });
    await menu(page).getByRole('button', { name: 'Delete' }).click();
    const confirm = await confirmation(page, 'Delete this message?');
    await confirm.getByRole('button', { name: 'Delete Message' }).click();
    await expect(bubble(page, 'Restocked the olive oil')).toHaveCount(0);
    await expect(bubbles(page)).toHaveCount(7);
    await reopen(page);
    await openChat(page);
    await expect(bubbles(page)).toHaveCount(7);
    await expect(bubble(page, 'Restocked the olive oil')).toHaveCount(0);
  });

  test('Copy puts the message on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openSeeded(page);
    await openChat(page);
    await bubble(page, 'Legend.').click({ button: 'right' });
    await menu(page).getByRole('button', { name: 'Copy' }).click();
    await expect(menu(page)).toHaveCount(0);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "Legend. We're nearly out of the jacuzzi test strips too.",
    );
  });

  test('older messages load as you scroll up, keeping your place', async ({ page }) => {
    await openSeeded(page);
    // 70 older messages from Ela, an hour apart, before the seeded conversation.
    await page.evaluate((key) => {
      const doc = JSON.parse(localStorage.getItem(key)!);
      const ela = doc.members.find((m: { name: string }) => m.name === 'Ela');
      const first = Math.min(...doc.messages.map((m: { created_at: string }) => Date.parse(m.created_at)));
      for (let i = 0; i < 70; i++) {
        doc.messages.push({
          id: crypto.randomUUID(),
          household_id: ela.household_id,
          member_id: ela.id,
          body: `Older message ${i + 1}`,
          created_at: new Date(first - (70 - i) * 3_600_000).toISOString(),
        });
      }
      localStorage.setItem(key, JSON.stringify(doc));
    }, DEMO_STORAGE_KEY);
    await reopen(page);
    await openChat(page);
    await expect(bubbles(page)).toHaveCount(50);
    await expect(bubbles(page).first()).toHaveText('Older message 29');
    await expect(bubbles(page).last()).toBeInViewport();

    // Scroll to the top: the next page loads above without moving what you see.
    await scroller(page).evaluate((el) => (el.scrollTop = 0));
    const anchor = bubble(page, /^Older message 29$/);
    await expect(bubbles(page)).toHaveCount(78);
    await expect(anchor).toBeInViewport();
    await expect(bubbles(page).first()).toHaveText('Older message 1');
    await expect(bubbles(page).first()).not.toBeInViewport();
    // Nothing older left: the title sits at the very top.
    await scroller(page).evaluate((el) => (el.scrollTop = 0));
    await expect(chatScreen(page).getByRole('heading', { name: 'Chat', level: 1 })).toBeInViewport();
    await expect(bubbles(page)).toHaveCount(78);
  });

  test('a dot on the Chat tab until the chat is read, and again when someone writes', async ({ page }) => {
    await openSeeded(page);
    // Never opened on this device: the seeded messages are unread.
    await expect(tabs(page).getByRole('button', { name: 'Chat, unread messages', exact: true })).toBeVisible();
    await openChat(page);
    await expect(tabs(page).getByRole('button', { name: 'Chat', exact: true })).toBeVisible();
    await goToTab(page, 'Home');
    await expect(tabs(page).getByRole('button', { name: 'Chat', exact: true })).toBeVisible();
    // Read state survives a reload.
    await reopen(page);
    await expect(tabs(page).getByRole('button', { name: 'Chat', exact: true })).toBeVisible();

    // Shea writes from her phone: the dot comes back.
    const other = await secondTab(page);
    await messageFromShea(other, 'Pizza tonight?');
    await expect(tabs(page).getByRole('button', { name: 'Chat, unread messages', exact: true })).toBeVisible();
    await openChat(page);
    await expect(bubble(page, 'Pizza tonight?')).toBeInViewport();
    await expect(tabButton(page, 'Chat')).toHaveAccessibleName('Chat');
    // Your own messages never light it up.
    await goToTab(other, 'Chat');
    await goToTab(page, 'Home');
    await other.getByRole('textbox', { name: 'Message' }).fill('On it');
    await other.getByRole('textbox', { name: 'Message' }).press('Enter');
    await expect(bubble(other, 'On it')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(tabButton(page, 'Chat')).toHaveAccessibleName('Chat');
  });

  test('while typing the tab bar steps aside and the composer follows the keyboard', async ({ page }) => {
    await openSeeded(page);
    await openChat(page);
    // No + on Chat.
    await expect(tabs(page).getByRole('button', { name: 'New item' })).toHaveCount(0);
    const form = chatScreen(page).getByRole('form', { name: 'New message' });
    const resting = (await form.boundingBox())!;

    // A stand-in for the iPhone's visual viewport, so the keyboard can be simulated.
    await page.evaluate(() => {
      const vv = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0, width: window.innerWidth });
      (window as unknown as { visualViewport: unknown }).visualViewport = vv;
      (window as unknown as { __vv: typeof vv }).__vv = vv;
    });
    await field(page).focus();
    await expect(tabs(page)).toHaveCount(0); // hidden from assistive tech while it is away
    await expect(page.locator('nav[data-hidden]')).toHaveCount(1);
    await expect(async () => {
      const typing = (await form.boundingBox())!;
      expect(typing.y).toBeGreaterThan(resting.y + 50);
      expect(typing.y + typing.height).toBeGreaterThan(874 - 20);
    }).toPass();

    // The keyboard comes up (336px): the composer sits on top of it, the newest message above.
    await page.evaluate(() => {
      const vv = (window as unknown as { __vv: EventTarget & { height: number } }).__vv;
      vv.height = window.innerHeight - 336;
      vv.dispatchEvent(new Event('resize'));
    });
    await expect(async () => {
      const lifted = (await form.boundingBox())!;
      expect(Math.round(lifted.y + lifted.height)).toBe(874 - 336 - 8);
    }).toPass();
    await expect(bubble(page, "I'll order a new pack today.")).toBeInViewport();

    // Sending keeps the keyboard (focus) and the new message shows above the composer.
    await field(page).fill('Typed on the keyboard');
    await page.keyboard.press('Enter');
    await expect(field(page)).toBeFocused();
    const sent = (await bubble(page, 'Typed on the keyboard').boundingBox())!;
    const lifted = (await form.boundingBox())!;
    expect(sent.y + sent.height).toBeLessThanOrEqual(lifted.y);

    // Done typing: the tab bar comes back.
    await page.evaluate(() => {
      const vv = (window as unknown as { __vv: EventTarget & { height: number } }).__vv;
      vv.height = window.innerHeight;
      vv.dispatchEvent(new Event('resize'));
    });
    await field(page).blur();
    await expect(tabs(page)).toBeVisible();
    await expect(async () => {
      const back = (await form.boundingBox())!;
      expect(Math.abs(back.y - resting.y)).toBeLessThan(2);
    }).toPass();
  });

  test('a failed send shows Not Delivered with a retry', async ({ page }) => {
    await openSeeded(page);
    await openChat(page);
    // The stored session goes (this tab isn't told), so the send fails as not signed in.
    await page.evaluate((key) => {
      const doc = JSON.parse(localStorage.getItem(key)!);
      (window as unknown as { __session: string }).__session = doc.session;
      doc.session = null;
      localStorage.setItem(key, JSON.stringify(doc));
    }, DEMO_STORAGE_KEY);
    await field(page).fill('Are you there?');
    await field(page).press('Enter');
    const retry = chatScreen(page).getByRole('button', { name: 'Not delivered. Try again' });
    await expect(retry).toBeVisible();
    await expect(chatScreen(page).getByText('Not Delivered', { exact: true })).toBeVisible();
    await page.evaluate((key) => {
      const doc = JSON.parse(localStorage.getItem(key)!);
      doc.session = (window as unknown as { __session: string }).__session;
      localStorage.setItem(key, JSON.stringify(doc));
    }, DEMO_STORAGE_KEY);
    await retry.click();
    await expect(retry).toHaveCount(0);
    await expect(bubble(page, 'Are you there?')).toHaveAttribute('aria-label', /^You, Today \d\d:\d\d$/);
  });
});
