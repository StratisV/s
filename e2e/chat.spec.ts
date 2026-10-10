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
  addButton,
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

/**
 * A second tab on the same device (same storage), at the same moment. It opens on the tab
 * last open on this device (the first tab's), whichever that is.
 */
async function secondTab(page: Page): Promise<Page> {
  const other = await page.context().newPage();
  await other.clock.install({ time: NOW });
  await other.goto('/');
  await expect(other.getByRole('navigation', { name: 'Tabs' })).toBeVisible();
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
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(composerBox.y);
    // The composer is at the bottom (the tab switch is at the top, under the hero).
    expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(874);
    expect(composerBox.y + composerBox.height).toBeGreaterThan(874 - 24);
    expect((await tabs(page).boundingBox())!.y).toBeLessThan(composerBox.y);

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

    // Only emoji: large, with no bubble.
    await field(page).fill('🎉');
    await field(page).press('Enter');
    await expect(bubbles(page).last()).toHaveText('🎉');
    await expect(bubbles(page).last()).toHaveCSS('font-size', '46px');
    await expect(bubbles(page).last()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    await reopen(page);
    await openChat(page);
    await expect(bubbles(page)).toHaveCount(11);
    await expect(bubbles(page).nth(8)).toHaveText('Bin day tomorrow');
  });

  test('tapped with a finger, Return starts a new line and the round button sends', async ({ page }) => {
    await openSeeded(page);
    await openChat(page);
    const form = chatScreen(page).getByRole('form', { name: 'New message' });
    const resting = (await form.boundingBox())!;
    // A stand-in for the iPhone's visual viewport, so the keyboard can be simulated.
    await page.evaluate(() => {
      const vv = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0, width: window.innerWidth });
      (window as unknown as { visualViewport: unknown }).visualViewport = vv;
      (window as unknown as { __vv: typeof vv }).__vv = vv;
    });
    await field(page).tap();
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveAttribute('enterkeyhint', 'enter');
    // The keyboard is on its way: the composer waits where it was instead of dropping first.
    const waiting = await page.evaluate(() => ({
      pending: document.querySelector('section[aria-label="Chat"]')!.hasAttribute('data-kb-pending'),
      bottom: document.querySelector('form[aria-label="New message"]')!.getBoundingClientRect().bottom,
    }));
    expect(waiting.pending).toBe(true);
    expect(Math.abs(waiting.bottom - (resting.y + resting.height))).toBeLessThan(2);
    await page.evaluate(() => {
      const vv = (window as unknown as { __vv: EventTarget & { height: number } }).__vv;
      vv.height = window.innerHeight - 336;
      vv.dispatchEvent(new Event('resize'));
    });
    await expect(async () => {
      const lifted = (await form.boundingBox())!;
      expect(Math.round(lifted.y + lifted.height)).toBe(874 - 336 - 8);
    }).toPass();

    await page.keyboard.type('Shopping list');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Milk');
    await expect(field(page)).toHaveValue('Shopping list\nMilk');
    await chatScreen(page).getByRole('button', { name: 'Send' }).tap();
    await expect(bubbles(page).last()).toHaveText('Shopping list\nMilk');
    await expect(field(page)).toBeFocused();
  });

  test('Tab from the empty composer goes to Send', async ({ page }) => {
    await openSeeded(page);
    await openChat(page);
    // Reached from the keyboard.
    await field(page).focus();
    await page.keyboard.press('Tab');
    const send = chatScreen(page).getByRole('button', { name: 'Send' });
    await expect(send).toBeFocused();
    await expect(send).toBeDisabled(); // aria-disabled: off, but reachable
    await page.keyboard.press('Enter');
    await expect(bubbles(page)).toHaveCount(8);
    // The tab switch never went anywhere.
    await expect(tabs(page)).toBeVisible();
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

  test('deleting from the keyboard moves focus to the next message', async ({ page }) => {
    await openSeeded(page);
    await openChat(page);
    await bubble(page, "I'm in all morning").focus();
    await page.keyboard.press('Enter');
    await menu(page).getByRole('button', { name: 'Delete' }).focus();
    await page.keyboard.press('Enter');
    const confirm = await confirmation(page, 'Delete this message?');
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirm.getByRole('button', { name: 'Delete Message' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(bubble(page, "I'm in all morning")).toHaveCount(0);
    await expect(bubble(page, 'Thank you! The hallway')).toBeFocused();
  });

  test('a menu opened while a message is sending is placed again once it is stored', async ({ page }) => {
    await openSeeded(page);
    await openChat(page);
    // Hold the demo backend's (timer-driven) answer, as a slow network would.
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 1000);
    await field(page).fill('Slow one');
    await field(page).press('Enter');
    const sending = bubble(page, 'Slow one');
    await expect(sending).toHaveAttribute('aria-label', /, sending$/);
    await sending.click({ button: 'right' });
    await expect(menu(page).getByRole('button', { name: 'Copy' })).toBeVisible();
    await expect(menu(page).getByRole('group', { name: 'Reactions' })).toHaveCount(0);
    await expect(menu(page).getByRole('button', { name: 'Delete' })).toHaveCount(0);

    await page.clock.resume();
    const bar = menu(page).getByRole('group', { name: 'Reactions' });
    await expect(bar).toBeVisible();
    await expect(menu(page).getByRole('button', { name: 'Delete' })).toBeVisible();
    const box = (await bar.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(402);
    const remove = (await menu(page).getByRole('button', { name: 'Delete' }).boundingBox())!;
    expect(remove.y + remove.height).toBeLessThanOrEqual(874);
    // The bar sits above the lifted copy of the bubble, not on it.
    const copy = (await menu(page).locator('[aria-hidden="true"]', { hasText: 'Slow one' }).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(copy.y);
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

  test('while typing the composer follows the keyboard and the tab switch stays', async ({ page }) => {
    await openSeeded(page);
    await openChat(page);
    // No + on Chat.
    await expect(addButton(page)).toHaveCount(0);
    const form = chatScreen(page).getByRole('form', { name: 'New message' });
    const resting = (await form.boundingBox())!;

    // A stand-in for the iPhone's visual viewport, so the keyboard can be simulated.
    await page.evaluate(() => {
      const vv = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0, width: window.innerWidth });
      (window as unknown as { visualViewport: unknown }).visualViewport = vv;
      (window as unknown as { __vv: typeof vv }).__vv = vv;
    });
    await field(page).focus();
    await expect(tabs(page)).toBeVisible();
    // No keyboard yet (a hardware one): the composer stays at the bottom.
    await expect(async () => {
      const typing = (await form.boundingBox())!;
      expect(Math.abs(typing.y - resting.y)).toBeLessThan(2);
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

    // Done typing: the composer goes back to the bottom.
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

  test('a toast floats above the composer, clear of the field', async ({ page }) => {
    await openSeeded(page);
    await openChat(page);
    // Signed out behind this tab's back: reacting fails with a toast.
    await page.evaluate((key) => {
      const doc = JSON.parse(localStorage.getItem(key)!);
      doc.session = null;
      localStorage.setItem(key, JSON.stringify(doc));
    }, DEMO_STORAGE_KEY);
    await messageRow(page, 'Restocked the olive oil').getByRole('button', { name: '👍, 1 reaction from Shea' }).click();
    const toast = page.getByText('Couldn’t react. Please sign in again.');
    await expect(toast).toBeVisible();
    const form = (await chatScreen(page).getByRole('form', { name: 'New message' }).boundingBox())!;
    // Once it has slid in (it rises 16px as it appears).
    await expect(async () => {
      const toastBox = (await toast.boundingBox())!;
      expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(form.y - 8);
    }).toPass();
    // A tap on the field reaches the field.
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.tagName,
      [form.x + 60, form.y + form.height / 2] as const,
    );
    expect(hit).toBe('TEXTAREA');
  });
});

test.describe('Chat with Reduce Motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('the + comes back from Chat without the pop', async ({ page }) => {
    await openSeeded(page);
    await openChat(page);
    await goToTab(page, 'Home');
    const add = addButton(page);
    await expect(add).toBeVisible();
    expect(await add.evaluate((el) => el.getAnimations().length)).toBe(0);
  });
});
