// The notifications ops through the real handler (docs/ARCHITECTURE.md "Server mode (no
// setup)", "Notifications"): GET notify, pushSubscribe, pushUnsubscribe, setNotify,
// saveReminder, deleteReminder, and the morning run (GET ?op=tick, Vercel Cron with CRON_SECRET),
// over the user's home brought online, with push sending faked (or real, over a fake network).

import { createECDH, generateKeyPairSync, randomBytes } from 'node:crypto';
import ece from 'http_ece';
import { describe, expect, it, vi } from 'vitest';
import { sendWebPush, type PushSubscriptionKeys } from '../../supabase/functions/_shared/webpush.ts';
import { API_PATH } from '../../src/lib/backend/serverApi';
import { ServerBackend } from '../../src/lib/backend/server';
import { USER_DEMO_DOC } from '../../src/lib/logic/importHome.fixture';
import { MemoryBlobStore } from '../store/memory';
import { createHarness, TEST_SETUP_CODE, type Browser, type Harness } from '../testing/harness';
import type { PushSender } from './notify';
import { homeBlobPath, parseServerDoc } from './serverDoc';

const PHONE = JSON.stringify(USER_DEMO_DOC);
const CRON_SECRET = 'test-cron-secret-0123456789';

/** A VAPID key pair in the web-push format, made for this run. */
function vapid() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]).toString('base64url');
  return { publicKey, privateKey: jwk.d! };
}
const KEYS = vapid();
const ENV = {
  HOMEOS_VAPID_PUBLIC_KEY: KEYS.publicKey,
  HOMEOS_VAPID_PRIVATE_KEY: KEYS.privateKey,
  HOMEOS_VAPID_SUBJECT: 'mailto:home@example.com',
  CRON_SECRET,
};
/** Monday 12 October 2026, 07:30 UTC (08:30 in London): when Vercel Cron calls. */
const MONDAY = Date.parse('2026-10-12T07:30:00.000Z');

/** A browser's push subscription whose private key the test holds, so it can read what arrives. */
function pushBrowser(endpoint = `https://web.push.apple.com/${randomBytes(6).toString('hex')}`) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const subscription = { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  const decrypt = (body: Uint8Array) => ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ecdh, authSecret: auth }).toString('utf8');
  return { subscription, decrypt };
}

async function call(browser: Browser, op: string, body?: Record<string, unknown>) {
  const res = body
    ? await browser.fetch(API_PATH, {
        method: 'POST',
        headers: { 'X-HomeOS': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, ...body }),
      })
    : await browser.fetch(`${API_PATH}?op=${op}`, { headers: { 'X-HomeOS': '1' } });
  return { status: res.status, json: (await res.json()) as any };
}

/** What a push sender was asked to send. */
function fakeSender(answer: (sub: PushSubscriptionKeys) => { status: number } = () => ({ status: 201 })) {
  const sent: { endpoint: string; payload: any }[] = [];
  const send: PushSender = async (sub, payload) => {
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    const { status } = answer(sub);
    return { status, ok: status >= 200 && status < 300, gone: status === 404 || status === 410 };
  };
  return { sent, send };
}

/** Stratis brings the user's home online; Shea joins with a code. */
async function online(h: Harness) {
  const stratis = h.browser();
  expect((await call(stratis, 'setup', { code: TEST_SETUP_CODE, phone: PHONE })).status).toBe(200);
  const hid: string = (await call(stratis, 'session')).json.entry.householdId;
  const data = (await call(stratis, 'rpc', { method: 'load', args: [hid] })).json.result;
  const sheaId: string = data.members.find((m: { name: string }) => m.name === 'Shea').id;
  const code = (await call(stratis, 'createCode', { memberId: sheaId })).json.code;
  const shea = h.browser();
  expect((await call(shea, 'redeem', { code })).status).toBe(200);
  return { stratis, shea, hid };
}

const tick = (h: Harness, headers: Record<string, string | undefined> = { authorization: `Bearer ${CRON_SECRET}` }, ctx = h.ctx) =>
  h.request({ method: 'GET', url: `${API_PATH}?op=tick`, headers: { 'x-homeos': undefined, 'user-agent': 'vercel-cron/1.0', ...headers } }, ctx);

const stored = (h: Harness) => parseServerDoc((h.blobs as MemoryBlobStore).peek(homeBlobPath({ VERCEL_ENV: 'test' }))!.body);

describe('GET notify and the choices', () => {
  it('gives each person their own choices, the public key (never the private one) and this device', async () => {
    const h = createHarness({ env: ENV });
    const { stratis, shea } = await online(h);
    const mine = await call(stratis, 'notify');
    expect(mine.status).toBe(200);
    expect(mine.json).toEqual({
      prefs: { weeklyStatus: false, housekeeping: false, reminders: false },
      reminders: [],
      publicKey: KEYS.publicKey,
      subscribed: false,
    });
    const set = await call(stratis, 'setNotify', { prefs: { weeklyStatus: true, reminders: true } });
    expect(set.json.prefs).toEqual({ weeklyStatus: true, housekeeping: false, reminders: true });
    const saved = await call(stratis, 'saveReminder', { reminder: { title: 'Take the bins out', days: [0] } });
    expect(saved.json.reminders).toEqual([{ id: expect.any(String), title: 'Take the bins out', days: [0] }]);
    // Shea sees her own, not his.
    expect((await call(shea, 'notify')).json).toMatchObject({ prefs: { weeklyStatus: false }, reminders: [] });
    // Every device of his gets the same choices.
    expect((await call(stratis, 'notify')).json).toEqual({ ...saved.json, subscribed: false });
    for (const b of [stratis, shea]) for (const body of b.bodies) expect(body).not.toContain(KEYS.privateKey);
  });

  it('changes and deletes reminders, keeps the rev (browsers do not reload), and says why it refuses', async () => {
    const h = createHarness({ env: ENV });
    const { stratis, shea } = await online(h);
    const rev = (await call(stratis, 'version')).json.rev;
    const { id } = (await call(stratis, 'saveReminder', { reminder: { title: 'Bins', days: [0] } })).json.reminders[0];
    const changed = await call(stratis, 'saveReminder', { reminder: { id, title: 'Bins and recycling', days: [0, 3] } });
    expect(changed.json.reminders).toEqual([{ id, title: 'Bins and recycling', days: [0, 3] }]);
    expect((await call(shea, 'deleteReminder', { id })).status).toBe(404);
    expect((await call(stratis, 'deleteReminder', { id })).json.reminders).toEqual([]);
    expect((await call(stratis, 'deleteReminder', { id })).json.error.code).toBe('not_found');
    expect((await call(stratis, 'version')).json.rev).toBe(rev);
    const refused = await call(stratis, 'saveReminder', { reminder: { title: '', days: [1] } });
    expect([refused.status, refused.json.error.code]).toEqual([400, 'invalid_input']);
    expect((await call(stratis, 'setNotify', { prefs: { weeklyStatus: 1 } })).status).toBe(400);
    // Signed out: 401, as every signed-in op.
    const stranger = h.browser();
    expect((await call(stranger, 'notify')).status).toBe(401);
    expect((await call(stranger, 'setNotify', { prefs: { weeklyStatus: true } })).status).toBe(401);
  });
});

describe('push subscriptions', () => {
  it('keeps this device’s subscription, forgets it on pushUnsubscribe, and refuses other endpoints', async () => {
    const h = createHarness({ env: ENV });
    const { stratis, shea } = await online(h);
    const { subscription } = pushBrowser();
    expect((await call(stratis, 'pushSubscribe', { subscription })).json).toEqual({ ok: true });
    expect((await call(stratis, 'notify')).json.subscribed).toBe(true);
    expect((await call(shea, 'notify')).json.subscribed).toBe(false);
    expect(stored(h).auth.devices.filter((d) => d.push).map((d) => d.push!.endpoint)).toEqual([subscription.endpoint]);
    const evil = await call(stratis, 'pushSubscribe', { subscription: { ...subscription, endpoint: 'https://evil.example/x' } });
    expect([evil.status, evil.json.error.message]).toEqual([400, 'invalid_input: endpoint']);
    expect((await call(stratis, 'pushUnsubscribe', {})).json).toEqual({ ok: true });
    expect((await call(stratis, 'notify')).json.subscribed).toBe(false);
  });

  it('goes with its device: removed, signed out, or its person released', async () => {
    const h = createHarness({ env: ENV });
    const { stratis, shea } = await online(h);
    await call(shea, 'pushSubscribe', { subscription: pushBrowser().subscription });
    const sheas = (await call(stratis, 'devices')).json.devices.find((d: { current: boolean }) => !d.current);
    expect((await call(stratis, 'removeDevice', { deviceId: sheas.id })).status).toBe(200);
    expect(stored(h).auth.devices.some((d) => d.push)).toBe(false);
    await call(stratis, 'pushSubscribe', { subscription: pushBrowser().subscription });
    await call(stratis, 'signOut', {});
    expect(stored(h).auth.devices.some((d) => d.push)).toBe(false);
  });

  it('is refused while the server has no VAPID keys, and Profile is told there is no key', async () => {
    const h = createHarness();
    const { stratis } = await online(h);
    expect((await call(stratis, 'notify')).json.publicKey).toBeNull();
    const res = await call(stratis, 'pushSubscribe', { subscription: pushBrowser().subscription });
    expect([res.status, res.json.error.code]).toEqual([400, 'invalid_input']);
  });

  it('round-trips through ServerBackend: savePushSubscription, the settings, deletePushSubscription', async () => {
    const h = createHarness({ env: ENV });
    const browser = h.browser();
    const backend = new ServerBackend({ fetch: browser.fetch, appUrl: 'https://home-os.example/', sleep: async () => {} });
    const entry = await backend.bringOnline(TEST_SETUP_CODE, PHONE);
    if (entry.status !== 'member') throw new Error('setup');
    const { subscription } = pushBrowser();
    await backend.savePushSubscription(entry.memberId, subscription);
    expect(await backend.notifySettings()).toMatchObject({ publicKey: KEYS.publicKey, subscribed: true });
    expect((await backend.setNotifyPrefs({ housekeeping: true })).prefs.housekeeping).toBe(true);
    const saved = await backend.saveReminder({ title: 'Water the garden', days: [3] });
    expect(saved.reminders).toEqual([{ id: expect.any(String), title: 'Water the garden', days: [3] }]);
    expect((await backend.deleteReminder(saved.reminders[0].id)).reminders).toEqual([]);
    await backend.deletePushSubscription(subscription.endpoint);
    expect((await backend.notifySettings()).subscribed).toBe(false);
  });
});

describe('the morning run (GET ?op=tick)', () => {
  /** Stratis on Monday morning: subscribed, everything ticked, a Monday reminder, Friday's visit recorded. */
  async function monday(h: Harness) {
    const home = await online(h);
    // Friday 9 Oct (the harness's today): the housekeeper came.
    const visit = await call(home.stratis, 'rpc', {
      method: 'saveHousekeepingVisit',
      args: [home.hid, '2026-10-09', { comments: 'Out of bin bags', price_pence: 4500 }],
    });
    expect(visit.status).toBe(200);
    const phone = pushBrowser('https://web.push.apple.com/stratis');
    await call(home.stratis, 'pushSubscribe', { subscription: phone.subscription });
    await call(home.stratis, 'setNotify', { prefs: { weeklyStatus: true, housekeeping: true, reminders: true } });
    await call(home.stratis, 'saveReminder', { reminder: { title: 'Take the bins out', days: [1] } });
    h.clock.now = MONDAY;
    return { ...home, phone };
  }

  it('only answers Vercel Cron’s Authorization: Bearer <CRON_SECRET>, and needs no X-HomeOS header', async () => {
    const pusher = fakeSender();
    const h = createHarness({ env: ENV, push: pusher.send });
    await monday(h);
    for (const headers of [{}, { authorization: 'Bearer nope' }, { authorization: CRON_SECRET }, { authorization: `Bearer ${CRON_SECRET}x` }]) {
      const res = await tick(h, headers);
      expect([res.status, JSON.parse(res.body).error.code]).toEqual([403, 'forbidden']);
    }
    // A signed-in phone's own request is not the cron either.
    expect((await h.request({ method: 'GET', url: `${API_PATH}?op=tick` })).status).toBe(403);
    expect(pusher.sent).toEqual([]);
    const ok = await tick(h);
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ ok: true, sent: 3, failed: 0, gone: 0 });
  });

  it('is off without a CRON_SECRET (or with one too short to trust)', async () => {
    for (const env of [{ ...ENV, CRON_SECRET: undefined }, { ...ENV, CRON_SECRET: 'short' }]) {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const pusher = fakeSender();
      const h = createHarness({ env, push: pusher.send });
      await monday(h);
      expect((await tick(h, { authorization: `Bearer ${env.CRON_SECRET}` })).status).toBe(403);
      expect((await tick(h, { authorization: 'Bearer undefined' })).status).toBe(403);
      expect(pusher.sent).toEqual([]);
      warn.mockRestore();
    }
  });

  it('sends what is due once: a second call (or Vercel calling twice) sends nothing and stores nothing', async () => {
    const pusher = fakeSender();
    const h = createHarness({ env: ENV, push: pusher.send });
    const { stratis } = await monday(h);
    const before = stored(h);
    await tick(h);
    expect(pusher.sent.map((s) => s.payload.tag.split(':')[0])).toEqual(['weekly', 'housekeeping', 'reminder']);
    expect(pusher.sent.every((s) => s.endpoint === 'https://web.push.apple.com/stratis')).toBe(true);
    expect(pusher.sent[0].payload.title).toMatch(/^This week at /);
    expect(pusher.sent[1].payload).toMatchObject({
      title: 'Housekeeping, Fri 9 Oct',
      body: expect.stringMatching(/Comments: Out of bin bags\nPrice: £45\.00/),
    });
    expect(pusher.sent[2].payload).toMatchObject({ title: 'Take the bins out', body: 'Reminder for Monday', url: '/' });
    const after = stored(h);
    // Recorded as sent, in a write that keeps the rev (browsers do not reload for it).
    expect(after.rev).toBe(before.rev);
    expect(after.notify!.people[0].sent).toMatchObject({ weekly: '2026-10-12', reminders: '2026-10-12' });
    const puts = (h.blobs as MemoryBlobStore).calls.put;
    expect(JSON.parse((await tick(h)).body)).toEqual({ ok: true, sent: 0, failed: 0, gone: 0 });
    expect((h.blobs as MemoryBlobStore).calls.put).toBe(puts);
    expect(pusher.sent).toHaveLength(3);
    // The run's answer holds counts only.
    expect((await call(stratis, 'notify')).json.prefs.weeklyStatus).toBe(true);
  });

  it('sends once when two instances run at the same moment', async () => {
    const pusher = fakeSender();
    const h = createHarness({ env: ENV, push: pusher.send, sleep: async () => {} });
    await monday(h);
    const other = h.instance();
    other.push = pusher.send;
    const [a, b] = await Promise.all([tick(h), tick(h, undefined, other)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(JSON.parse(a.body).sent + JSON.parse(b.body).sent).toBe(3);
    expect(pusher.sent).toHaveLength(3);
  });

  it('forgets a subscription the push service says is gone, and does not try a failure again', async () => {
    const pusher = fakeSender((sub) => ({ status: sub.endpoint.endsWith('stratis') ? 410 : 201 }));
    const h = createHarness({ env: ENV, push: pusher.send });
    await monday(h);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(JSON.parse((await tick(h)).body)).toEqual({ ok: true, sent: 0, failed: 3, gone: 1 });
    expect(warn.mock.calls.every(([line]) => !String(line).includes('/stratis'))).toBe(true);
    warn.mockRestore();
    expect(stored(h).auth.devices.some((d) => d.push)).toBe(false);
    expect(JSON.parse((await tick(h)).body)).toEqual({ ok: true, sent: 0, failed: 0, gone: 0 });
  });

  it('does nothing without VAPID keys or a home, and also answers the cron’s bare /api/home', async () => {
    const pusher = fakeSender();
    const empty = createHarness({ env: ENV, push: pusher.send });
    expect(JSON.parse((await tick(empty)).body)).toEqual({ ok: true, sent: 0, failed: 0, gone: 0 });
    const noKeys = createHarness({ env: { CRON_SECRET }, push: pusher.send });
    await online(noKeys);
    const gets = (noKeys.blobs as MemoryBlobStore).calls.get;
    expect(JSON.parse((await tick(noKeys)).body)).toEqual({ ok: true, sent: 0, failed: 0, gone: 0 });
    expect((noKeys.blobs as MemoryBlobStore).calls.get).toBe(gets);
    const h = createHarness({ env: ENV, push: pusher.send });
    await monday(h);
    const bare = await h.request({
      method: 'GET',
      url: API_PATH,
      headers: { 'x-homeos': undefined, authorization: `Bearer ${CRON_SECRET}`, 'x-vercel-cron-schedule': '0 7 * * *' },
    });
    expect(JSON.parse(bare.body)).toMatchObject({ ok: true, sent: 3 });
  });

  it('sends real Web Push: VAPID-signed with the keys from the environment, readable only by the phone', async () => {
    const posts: { url: string; headers: Record<string, string>; body: Uint8Array }[] = [];
    const network = (async (url: string, init: RequestInit) => {
      posts.push({ url, headers: init.headers as Record<string, string>, body: init.body as Uint8Array });
      return new Response('', { status: 201 });
    }) as never;
    const h = createHarness({ env: ENV, push: (sub, payload, keys) => sendWebPush(sub, payload, keys, network) });
    const { phone } = await monday(h);
    expect(JSON.parse((await tick(h)).body)).toMatchObject({ sent: 3 });
    expect(posts.map((p) => p.url)).toEqual(Array(3).fill('https://web.push.apple.com/stratis'));
    expect(posts[0].headers.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${KEYS.publicKey}$`));
    expect(posts[0].headers['Content-Encoding']).toBe('aes128gcm');
    // Sent all at once, so in no particular order.
    const read = posts.map((p) => JSON.parse(phone.decrypt(p.body)) as { title: string; url: string });
    expect(read.map((p) => p.title).sort()).toEqual(['Housekeeping, Fri 9 Oct', 'Take the bins out', 'This week at Our home']);
    expect(read.every((p) => p.url === '/')).toBe(true);
  });
});
