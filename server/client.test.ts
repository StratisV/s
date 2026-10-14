// ServerBackend (src/lib/backend/server.ts) against the real handler, in-process: each "phone"
// is a ServerBackend whose fetch goes straight to handleApi with its own cookie jar
// (server/testing/harness.ts). docs/ARCHITECTURE.md "Server mode (no setup)", "Local server and tests".

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_POLL_MS,
  IDLE_POLL_MS,
  IDLE_SLOW_MS,
  IDLE_STOP_MS,
  PENDING_SIGN_OUT_KEY,
  REQUEST_TIMEOUT_MS,
  ServerBackend,
} from '../src/lib/backend/server';
import { normaliseCode } from '../src/lib/backend/serverApi';
import { USER_DEMO_DOC } from '../src/lib/logic/importHome.fixture';
import type { AuthUser, ChatChange } from '../src/lib/types';
import { createHarness, TEST_SETUP_CODE, type Browser, type Harness } from './testing/harness';

const PHONE = JSON.stringify(USER_DEMO_DOC);
const APP = 'https://home-os.example/';

interface Phone {
  backend: ServerBackend;
  browser: Browser;
  /** Every request this phone made: method, op and body. */
  requests: { method: string; op: string | null; body: Record<string, unknown> | null }[];
}

function phone(h: Harness, opts: { fetch?: (browser: Browser) => typeof fetch; userAgent?: string } = {}): Phone {
  const browser = h.browser({ userAgent: opts.userAgent });
  const requests: Phone['requests'] = [];
  const fetchSpy = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    requests.push({ method: init?.method ?? 'GET', op: url.searchParams.get('op') ?? (body?.op as string) ?? null, body });
    return (opts.fetch ? opts.fetch(browser) : browser.fetch)(input, init);
  }) as typeof fetch;
  // Retries wait for nothing here (their waits are tested on their own).
  return { backend: new ServerBackend({ fetch: fetchSpy, appUrl: APP, sleep: async () => {} }), browser, requests };
}

/** Stratis's phone brings the home online; Shea's phone joins with a code. */
async function home(h: Harness) {
  const stratis = phone(h);
  const entry = await stratis.backend.bringOnline(TEST_SETUP_CODE, PHONE);
  if (entry.status !== 'member') throw new Error('setup');
  const hid = entry.householdId;
  const data = await stratis.backend.load(hid);
  const sheaId = data.members.find((m) => m.name === 'Shea')!.id;
  const join = async () => {
    const issued = await stratis.backend.createCode(sheaId);
    const shea = phone(h);
    const sheaEntry = await shea.backend.redeemCode(issued.code);
    return { shea, sheaEntry, issued };
  };
  return { stratis, hid, data, sheaId, join };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ServerBackend: signing in', () => {
  it('brings the home online, then says so once to enterHome and every listener', async () => {
    const h = createHarness();
    const stratis = phone(h);
    const heard: (AuthUser | null)[] = [];
    stratis.backend.onAuthChange((u) => heard.push(u));
    expect(await stratis.backend.homeOnline()).toBe(false);
    expect(await stratis.backend.getUser()).toBeNull();
    const entry = await stratis.backend.bringOnline(TEST_SETUP_CODE, PHONE);
    expect(entry).toMatchObject({ status: 'member', canImport: false });
    expect(heard).toEqual([expect.objectContaining({ name: 'Stratis', email: '' })]);
    expect(await stratis.backend.enterHome()).toEqual(entry);
    expect(await stratis.backend.getUser()).toEqual(heard[0]);
    expect(await stratis.backend.homeOnline()).toBe(true);
    // The cookie holds a device token: the key, the device, the rev that first holds it, the signature.
    expect(stratis.browser.key()).toMatch(/^[A-Za-z0-9_-]{43}\.[0-9a-f-]{36}\.1\.[A-Za-z0-9_-]{22}$/);
  });

  it("gives a claim's welcome once: 'claimed' from the redeem, then 'member'", async () => {
    const h = createHarness();
    const { join, sheaId } = await home(h);
    const { shea, sheaEntry } = await join();
    expect(sheaEntry).toMatchObject({ status: 'claimed', memberId: sheaId });
    expect(await shea.backend.enterHome()).toMatchObject({ status: 'claimed', memberId: sheaId });
    expect(await shea.backend.enterHome()).toMatchObject({ status: 'member', memberId: sheaId });
  });

  it('refuses a malformed code without asking the server, and says why for a wrong one', async () => {
    const h = createHarness();
    await home(h);
    const stranger = phone(h);
    await expect(stranger.backend.redeemCode('ABC')).rejects.toMatchObject({ code: 'invalid_code' });
    expect(stranger.requests).toEqual([]);
    await expect(stranger.backend.redeemCode('abcd efgh')).rejects.toMatchObject({ code: 'invalid_code' });
    expect(stranger.requests).toHaveLength(1);
    await expect(stranger.backend.enterHome()).rejects.toMatchObject({ code: 'not_signed_in' });
  });

  it('makes codes with a link that signs in', async () => {
    const h = createHarness();
    const { stratis, sheaId } = await home(h);
    const issued = await stratis.backend.createCode(sheaId);
    expect(issued.link).toBe(`${APP}?code=${issued.code}`);
    expect(issued).toMatchObject({ memberId: sheaId, code: expect.stringMatching(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/) });
    expect(normaliseCode(new URL(issued.link).searchParams.get('code')!)).toBe(normaliseCode(issued.code));
  });

  it('lists devices, and removing its own signs this browser out', async () => {
    const h = createHarness();
    const { stratis } = await home(h);
    const devices = await stratis.backend.listDevices();
    expect(devices).toEqual([expect.objectContaining({ label: 'iPhone · Safari', current: true })]);
    const heard: (AuthUser | null)[] = [];
    stratis.backend.onAuthChange((u) => heard.push(u));
    await stratis.backend.removeDevice(devices[0].id);
    expect(heard).toEqual([null]);
    expect(await stratis.backend.getUser()).toBeNull();
  });

  it('is signed out by any 401, saying so once', async () => {
    const h = createHarness();
    const { stratis, hid, join } = await home(h);
    const { shea } = await join();
    const heard: (AuthUser | null)[] = [];
    shea.backend.onAuthChange((u) => heard.push(u));
    const sheas = (await stratis.backend.listDevices()).find((d) => !d.current)!;
    await stratis.backend.removeDevice(sheas.id);
    await expect(shea.backend.load(hid)).rejects.toMatchObject({ code: 'not_signed_in' });
    await expect(shea.backend.load(hid)).rejects.toMatchObject({ code: 'not_signed_in' });
    expect(heard).toEqual([null]);
  });

  it('signs out without ever failing, and "Not Shea?" puts Shea back', async () => {
    const h = createHarness();
    const { stratis, hid, join, sheaId } = await home(h);
    const { shea } = await join();
    const heard: (AuthUser | null)[] = [];
    shea.backend.onAuthChange((u) => heard.push(u));
    await shea.backend.releaseClaim();
    expect(heard).toEqual([null]);
    expect((await stratis.backend.load(hid)).members.find((m) => m.id === sheaId)!.user_id).toBeNull();
    await shea.backend.signOut();
    shea.browser.offline = true;
    await expect(shea.backend.signOut()).resolves.toBeUndefined();
    await stratis.backend.signOut();
    expect(await stratis.backend.getUser()).toBeNull();
  });
});

describe('ServerBackend: the Backend methods', () => {
  it('runs every allowed method on the server, with the answers demo mode gives', async () => {
    const h = createHarness();
    const { stratis, hid, sheaId } = await home(h);
    const b = stratis.backend;
    expect(await b.getMyHouseholdId()).toBe(hid);
    await b.updateHousehold(hid, { address: '22 Alderbrook Road' });
    const area = await b.createArea(hid, 'Garage');
    await b.renameArea(area.id, 'Shed');
    const data = await b.load(hid);
    await b.reorderAreas(hid, [area.id, ...data.areas.filter((a) => a.id !== area.id).map((a) => a.id)]);
    const item = await b.createItem(hid, {
      area_id: area.id,
      kind: 'task',
      title: 'Oil the hinges',
      note: '',
      good: '',
      rag: 'amber',
      due_date: '2026-10-12',
      assignee_id: sheaId,
      repeat: 'none',
      notify: 'day_before',
    });
    await b.updateItem(item.id, { rag: 'red', note: 'Squeaks' });
    const completion = await b.completeItem(item.id);
    await b.undoCompletion(completion);
    const person = await b.addPerson(hid, { name: 'Ela', emoji: '🦊', email: '' });
    await b.updateMember(person.id, { emoji: '🦉' });
    await b.removePerson(person.id);
    const message = await b.sendMessage(hid, 'Hello');
    await b.setReaction(message.id, '👍', true);
    expect((await b.getMessages([message.id]))[0].reactions).toHaveLength(1);
    expect((await b.listMessages(hid)).messages.map((m) => m.body)).toEqual(['Hello']);
    expect((await b.listMessages(hid, { before: message.created_at, limit: 10 })).messages).toEqual([]);
    await b.setReaction(message.id, '👍', false);
    await b.deleteMessage(message.id);
    await b.setHousekeepingNote(hid, 'Windows please');
    await b.setHousekeepingNote(hid, '');
    await b.undoClearHousekeepingNote(hid);
    const task = await b.createHousekeepingTask(hid, 'Fridge');
    await b.renameHousekeepingTask(task.id, 'Clean the fridge');
    const visitId = await b.setHousekeepingTaskDone(hid, '2026-10-09', { taskId: task.id }, true);
    expect(await b.saveHousekeepingVisit(hid, '2026-10-09', { comments: 'Great', price_pence: 4500 })).toBe(visitId);
    const earlier = await b.addHousekeepingVisit(hid, '2026-10-02');
    await b.deleteHousekeepingVisit(earlier);
    const tasks = (await b.load(hid)).housekeeping.tasks;
    await b.reorderHousekeepingTasks(hid, [...tasks].reverse().map((t) => t.id));
    await b.deleteItem(item.id);
    await b.deleteArea(area.id);
    await b.deleteHousekeepingTask(task.id);

    const after = await b.load(hid);
    expect(after.household.address).toBe('22 Alderbrook Road');
    expect(after.areas.map((a) => a.name)).not.toContain('Shed');
    expect(after.members.map((m) => m.name)).toEqual(['Stratis', 'Shea']);
    expect(after.housekeeping.note.body).toBe('Windows please');
    expect(after.housekeeping.visits).toEqual([
      expect.objectContaining({ visit_date: '2026-10-09', comments: 'Great', price_pence: 4500 }),
    ]);
  });

  it('says what the server refuses the way the app expects', async () => {
    const h = createHarness();
    const { stratis, hid } = await home(h);
    const b = stratis.backend;
    await expect(b.createArea(hid, '  ')).rejects.toMatchObject({ code: 'unknown', message: 'invalid_input: name' });
    await expect(b.deleteItem('gone')).rejects.toMatchObject({ code: 'not_found' });
    await expect(b.updateMember('x', { push_enabled: true })).rejects.toMatchObject({ code: 'unknown', message: 'invalid_input: args[1].push_enabled' });
    await expect(b.addPerson(hid, { name: 'Ela', emoji: '🦊', email: 'ela@example.com' })).rejects.toMatchObject({ code: 'unknown' });
  });

  it('does what NOT_RPC says for the methods that are not RPCs', async () => {
    const h = createHarness();
    const { stratis } = await home(h);
    const b = stratis.backend;
    const before = stratis.requests.length;
    await expect(b.signInWithGoogle()).rejects.toMatchObject({ code: 'unknown' });
    await expect(b.createHousehold({} as never)).rejects.toMatchObject({ code: 'home_exists' });
    await expect(b.joinHousehold({} as never)).rejects.toMatchObject({ code: 'invalid_invite' });
    await expect(b.createInvite()).rejects.toMatchObject({ code: 'invalid_invite' });
    await expect(b.getInvitePreview('t')).resolves.toBeNull();
    await expect(b.importHousehold({} as never)).rejects.toMatchObject({ code: 'unknown' });
    await expect(b.setPersonEmail('x', 'a@b.co')).rejects.toMatchObject({ code: 'unknown', message: 'invalid_input: email' });
    expect(b.takeAuthError()).toBeNull();
    expect(stratis.requests.length).toBe(before);
    // Push goes to this device's own ops (this server has no VAPID keys: a subscription is refused).
    await expect(b.savePushSubscription('x', { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } })).rejects.toMatchObject({
      code: 'unknown',
      message: expect.stringMatching(/^invalid_input/),
    });
    await expect(b.deletePushSubscription('https://push')).resolves.toBeUndefined();
    expect(stratis.requests.slice(before).map((r) => r.op)).toEqual(['pushSubscribe', 'pushUnsubscribe']);
  });

  it('never reads older than it has seen: every RPC carries the newest rev', async () => {
    const h = createHarness();
    const { stratis, hid } = await home(h);
    await stratis.backend.createArea(hid, 'Garage');
    await stratis.backend.load(hid);
    const rpcs = stratis.requests.filter((r) => r.op === 'rpc');
    expect(rpcs.at(-1)!.body!.minRev).toBe(2);
    // Arguments left out are left off the end (JSON has no undefined).
    await stratis.backend.listMessages(hid);
    expect(stratis.requests.at(-1)!.body!.args).toEqual([hid]);
  });

  it("fails as 'network' when offline or when the server does not answer in 15 s", async () => {
    const h = createHarness();
    const { stratis, hid } = await home(h);
    stratis.browser.offline = true;
    await expect(stratis.backend.load(hid)).rejects.toMatchObject({ code: 'network' });
    vi.useFakeTimers();
    const hanging = new ServerBackend({
      fetch: ((_: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch,
    });
    const pending = hanging.load(hid);
    const caught = pending.catch((e) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(await caught).toMatchObject({ code: 'network', message: 'timeout' });
  });
});

describe('ServerBackend: polling', () => {
  /** Runs timers due now (DemoBackend answers after a zero-length timer) until `p` settles. */
  async function settle<T>(p: Promise<T>): Promise<T> {
    let done = false;
    p.then(
      () => (done = true),
      () => (done = true),
    );
    for (let i = 0; i < 500 && !done; i++) await vi.advanceTimersByTimeAsync(0);
    return p;
  }
  const flush = async () => {
    for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(0);
  };
  const tick = async (ms = DEFAULT_POLL_MS) => {
    await vi.advanceTimersByTimeAsync(ms);
    await flush();
  };

  /** A page that can be hidden, and a window for focus, online and input. */
  function page() {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    const win = new EventTarget();
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', win);
    return {
      input(name: 'pointerdown' | 'keydown' | 'scroll') {
        win.dispatchEvent(new Event(name));
      },
      hide() {
        doc.visibilityState = 'hidden';
        doc.dispatchEvent(new Event('visibilitychange'));
      },
      show() {
        doc.visibilityState = 'visible';
        doc.dispatchEvent(new Event('visibilitychange'));
      },
      fire(name: 'focus' | 'online') {
        win.dispatchEvent(new Event(name));
      },
    };
  }

  async function setUp() {
    vi.useFakeTimers();
    const h = createHarness();
    const stratis = phone(h);
    const entry = await settle(stratis.backend.bringOnline(TEST_SETUP_CODE, PHONE));
    const hid = (entry as { householdId: string }).householdId;
    const data = await settle(stratis.backend.load(hid));
    const issued = await settle(stratis.backend.createCode(data.members.find((m) => m.name === 'Shea')!.id));
    const shea = phone(h);
    await settle(shea.backend.redeemCode(issued.code));
    const polls = (p: Phone) => p.requests.filter((r) => r.op === 'version').length;
    return { h, stratis, shea, hid, polls, settle };
  }

  it('hears every change: at once on subscribing, then when the rev goes up', async () => {
    const { stratis, shea, hid, polls } = await setUp();
    const changed = vi.fn();
    const unsubscribe = stratis.backend.subscribe(hid, changed);
    await flush();
    expect(polls(stratis)).toBe(1);
    expect(changed).toHaveBeenCalledTimes(1);
    await tick();
    expect(polls(stratis)).toBe(2);
    expect(changed).toHaveBeenCalledTimes(1);
    await settle(shea.backend.createArea(hid, 'Garage'));
    await tick();
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
    await tick();
    await tick();
    expect(polls(stratis)).toBe(3);
  });

  it('tells the chat to resync when the chat changed, and its own writes at once', async () => {
    const { stratis, shea, hid } = await setUp();
    const heard: ChatChange[] = [];
    stratis.backend.subscribeChat(hid, (c) => heard.push(c));
    await flush();
    expect(heard).toEqual([{ type: 'resync' }]);
    await settle(shea.backend.createArea(hid, 'Garage'));
    await tick();
    expect(heard).toHaveLength(1);
    await settle(shea.backend.sendMessage(hid, 'Hi'));
    await tick();
    expect(heard).toEqual([{ type: 'resync' }, { type: 'resync' }]);
    const mine = await settle(stratis.backend.sendMessage(hid, 'Hello'));
    expect(heard.at(-1)).toEqual({ type: 'message', messageId: mine.id, deleted: false });
    await settle(stratis.backend.setReaction(mine.id, '👍', true));
    expect(heard.at(-1)).toEqual({ type: 'reaction', messageId: mine.id });
    await settle(stratis.backend.deleteMessage(mine.id));
    expect(heard.at(-1)).toEqual({ type: 'message', messageId: mine.id, deleted: true });
  });

  it('never polls while hidden; polls at once on visible, focus, online and reconnect', async () => {
    const view = page();
    const { stratis, hid, polls } = await setUp();
    stratis.backend.subscribe(hid, () => {});
    await flush();
    expect(polls(stratis)).toBe(1);
    view.hide();
    await tick();
    await tick(60_000);
    expect(polls(stratis)).toBe(1);
    view.show();
    await flush();
    expect(polls(stratis)).toBe(2);
    view.fire('focus');
    await flush();
    expect(polls(stratis)).toBe(3);
    view.fire('online');
    await flush();
    expect(polls(stratis)).toBe(4);
    stratis.backend.reconnect();
    await flush();
    expect(polls(stratis)).toBe(5);
    await tick();
    expect(polls(stratis)).toBe(6);
  });

  it('counts a failed poll as a dropped connection: the next success asks for a reload', async () => {
    const { stratis, hid } = await setUp();
    const changed = vi.fn();
    const chat = vi.fn();
    stratis.backend.subscribe(hid, changed);
    stratis.backend.subscribeChat(hid, chat);
    await flush();
    expect([changed.mock.calls.length, chat.mock.calls.length]).toEqual([1, 1]);
    stratis.browser.offline = true;
    await tick();
    stratis.browser.offline = false;
    await tick();
    expect([changed.mock.calls.length, chat.mock.calls.length]).toEqual([2, 2]);
    await tick();
    expect([changed.mock.calls.length, chat.mock.calls.length]).toEqual([2, 2]);
  });

  it('says when saving is paused, at once and with each change', async () => {
    vi.useFakeTimers();
    // Setup and the phone's first use of its key are two puts; the third uses the month up.
    const h = createHarness({ env: { HOMEOS_BLOB_WRITES_PER_MONTH: '3' } });
    const stratis = phone(h);
    const entry = (await settle(stratis.backend.bringOnline(TEST_SETUP_CODE, PHONE))) as { householdId: string };
    const statuses: boolean[] = [];
    stratis.backend.onStatus((s) => statuses.push(s.readOnly));
    expect(statuses).toEqual([false]);
    await flush();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await settle(stratis.backend.createArea(entry.householdId, 'Garage'));
    await tick();
    expect(statuses).toEqual([false, true]);
    await expect(settle(stratis.backend.createArea(entry.householdId, 'Shed'))).rejects.toMatchObject({ code: 'read_only' });
  });

  it('slows to a poll a minute when nobody has used the page for 3 minutes, stops after 15, and picks up at once on input', async () => {
    const view = page();
    const { stratis, hid, polls } = await setUp();
    stratis.backend.subscribe(hid, () => {});
    await flush();
    await tick(IDLE_SLOW_MS);
    const busy = polls(stratis);
    expect(busy).toBeGreaterThanOrEqual(IDLE_SLOW_MS / DEFAULT_POLL_MS);
    await tick(IDLE_POLL_MS * 4);
    expect(polls(stratis) - busy).toBeLessThanOrEqual(5);
    await tick(IDLE_STOP_MS);
    const parked = polls(stratis);
    await tick(5 * 3_600_000);
    expect(polls(stratis)).toBe(parked);
    // Someone taps: a poll at once, then the usual pace.
    view.input('pointerdown');
    await flush();
    expect(polls(stratis)).toBe(parked + 1);
    await tick();
    expect(polls(stratis)).toBe(parked + 2);
    // Coming back into view, focus and online count too.
    await tick(IDLE_STOP_MS + IDLE_POLL_MS);
    const again = polls(stratis);
    await tick(IDLE_POLL_MS * 3);
    expect(polls(stratis)).toBe(again);
    view.fire('focus');
    await flush();
    expect(polls(stratis)).toBe(again + 1);
  });

  it('keeps a tab left open for five days to a handful of reads (the Blob budget)', async () => {
    page();
    vi.useFakeTimers();
    const h = createHarness();
    const stratis = phone(h);
    const entry = (await settle(stratis.backend.bringOnline(TEST_SETUP_CODE, PHONE))) as { householdId: string };
    stratis.backend.subscribe(entry.householdId, () => {});
    // Five days of an iPad on a stand: the server's clock moves on with the browser's.
    const gets = (h.blobs as unknown as { calls: { get: number } }).calls.get;
    for (let hour = 0; hour < 120; hour++) {
      h.clock.advance(3_600_000);
      await tick(3_600_000);
    }
    expect(polls(stratis)).toBeLessThan(80);
    expect((h.blobs as unknown as { calls: { get: number } }).calls.get - gets).toBeLessThan(30);
    function polls(p: Phone) {
      return p.requests.filter((r) => r.op === 'version').length;
    }
  });

  it('polls at the interval the server asks for', async () => {
    const { stratis, hid, polls } = await setUp();
    stratis.backend.subscribe(hid, () => {});
    await flush();
    expect(polls(stratis)).toBe(1);
    await tick(DEFAULT_POLL_MS - 1);
    expect(polls(stratis)).toBe(1);
    await tick(1);
    expect(polls(stratis)).toBe(2);
  });
});

describe('ServerBackend: when things go wrong', () => {
  /** A window with storage (the pending sign-out flag) and events. */
  function windowWithStorage() {
    const map = new Map<string, string>();
    const localStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
    };
    const win = Object.assign(new EventTarget(), { localStorage });
    vi.stubGlobal('window', win);
    return { win, map };
  }

  it('signs out for good when offline: the sign-out waits, and is sent first once back online', async () => {
    const { win, map } = windowWithStorage();
    const h = createHarness();
    const { stratis, join } = await home(h);
    const { shea } = await join();
    shea.browser.offline = true;
    const heard: (AuthUser | null)[] = [];
    shea.backend.onAuthChange((u) => heard.push(u));
    await shea.backend.signOut();
    expect(heard).toEqual([null]);
    expect(map.get(PENDING_SIGN_OUT_KEY)).toBe('1');
    // The key is still in its cookie, but this browser counts as signed out.
    expect(shea.browser.key()).not.toBeNull();
    expect(await shea.backend.getUser()).toBeNull();
    // Back online: the sign-out goes through before anything else.
    shea.browser.offline = false;
    const before = shea.requests.length;
    win.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(map.has(PENDING_SIGN_OUT_KEY)).toBe(false));
    expect(shea.requests.slice(before).map((r) => r.op)).toEqual(['signOut']);
    expect(shea.browser.key()).toBeNull();
    expect((await stratis.backend.listDevices()).map((d) => d.label)).toEqual(['iPhone · Safari']);
  });

  it('finishes a waiting sign-out at start-up (a reload) before asking who is signed in', async () => {
    const { map } = windowWithStorage();
    const h = createHarness();
    const { join } = await home(h);
    const { shea } = await join();
    shea.browser.offline = true;
    await shea.backend.signOut();
    shea.browser.offline = false;
    // The page reloads: a new ServerBackend over the same browser.
    const reloaded = new ServerBackend({ fetch: shea.browser.fetch, appUrl: APP });
    expect(await reloaded.getUser()).toBeNull();
    expect(map.has(PENDING_SIGN_OUT_KEY)).toBe(false);
    expect(shea.browser.key()).toBeNull();
    expect(await reloaded.getUser()).toBeNull();
  });

  it('opens the home when “Bring It Online” says the home exists but this browser is signed in (the first reply was lost)', async () => {
    const h = createHarness();
    let lose = true;
    const stratis = phone(h, {
      fetch: (browser) =>
        (async (input: RequestInfo | URL, init?: RequestInit) => {
          const res = await browser.fetch(input, init);
          // The reply to the first setup never arrives (the cookie did).
          if (lose && typeof init?.body === 'string' && init.body.includes('"op":"setup"')) {
            lose = false;
            throw new TypeError('Failed to fetch');
          }
          return res;
        }) as typeof fetch,
    });
    await expect(stratis.backend.bringOnline(TEST_SETUP_CODE, PHONE)).rejects.toMatchObject({ code: 'network' });
    // Another tab used the key meanwhile, so the setup code can't hand out a new one.
    await stratis.browser.fetch('/api/home?op=session', { headers: { 'X-HomeOS': '1' } });
    const entry = await stratis.backend.bringOnline(TEST_SETUP_CODE, PHONE);
    expect(entry).toMatchObject({ status: 'member' });
    expect((await stratis.backend.getUser())?.name).toBe('Stratis');
  });

  it('asks once more after a 401 just after signing in, and after a busy server, before giving up', async () => {
    const h = createHarness();
    const { stratis, hid, sheaId } = await home(h);
    let failNext: 'unauthorised' | 'busy' | null = null;
    const issued = await stratis.backend.createCode(sheaId);
    const shea = phone(h, {
      fetch: (browser) =>
        (async (input: RequestInfo | URL, init?: RequestInit) => {
          if (failNext === 'unauthorised') {
            failNext = null;
            return new Response(JSON.stringify({ error: { code: 'not_signed_in', message: 'x' } }), { status: 401 });
          }
          if (failNext === 'busy' && typeof init?.body === 'string' && init.body.includes('"op":"rpc"')) {
            failNext = null;
            return new Response(JSON.stringify({ error: { code: 'busy', message: 'The home is busy; try again' } }), { status: 503 });
          }
          return browser.fetch(input, init);
        }) as typeof fetch,
    });
    const heard: (AuthUser | null)[] = [];
    shea.backend.onAuthChange((u) => heard.push(u));
    await shea.backend.redeemCode(issued.code);
    failNext = 'unauthorised';
    expect(await shea.backend.load(hid)).toMatchObject({ household: { id: hid } });
    expect(heard.filter((u) => u === null)).toEqual([]);
    failNext = 'busy';
    expect((await shea.backend.createArea(hid, 'Garage')).name).toBe('Garage');
  });

  it('says when it runs as the Home Screen app, so the device list can tell it from Safari', async () => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { navigator: { standalone: true } }));
    const h = createHarness();
    const { stratis } = await home(h);
    const devices = await stratis.backend.listDevices();
    expect(devices.map((d) => d.label)).toEqual(['iPhone · Home Screen app']);
    expect(stratis.requests.find((r) => r.op === 'setup')!.body!.app).toBe('standalone');
  });
});
