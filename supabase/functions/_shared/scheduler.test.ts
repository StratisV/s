import { createECDH, randomBytes, type ECDH } from 'node:crypto';
import ece from 'http_ece';
import { beforeAll, describe, expect, it } from 'vitest';
import { RESEND_URL } from './resend.ts';
import {
  runScheduler,
  type LogClaim,
  type SchedulerConfig,
  type SchedulerData,
  type SchedulerStore,
} from './scheduler.ts';
import { area, household, item, member } from './test-fixtures.ts';
import type { PushSubRow } from './types.ts';
import { generateVapidKeys, type VapidKeys } from './webpush.ts';

const APP = 'https://home.example.com/';
// Mon 12 Oct 2026, 08:00 BST: reminders, missed alerts and the weekly email are all due.
const NOW = new Date('2026-10-12T07:00:00Z');

class MemoryStore implements SchedulerStore {
  log: (LogClaim & { id: string })[] = [];
  claims = 0;
  failClaims = false;
  private seq = 0;
  constructor(
    public data: SchedulerData,
    public subs: PushSubRow[],
  ) {}
  async load(_since: Date) {
    return this.data;
  }
  async pushSubs(memberIds: string[]) {
    return this.subs.filter((s) => memberIds.includes(s.member_id));
  }
  async claim(row: LogClaim) {
    this.claims++;
    if (this.failClaims) throw new Error('database unavailable');
    const same = (r: LogClaim) =>
      r.kind === row.kind && r.member_id === row.member_id && r.item_id === row.item_id && r.ref_date === row.ref_date;
    if (this.log.some(same)) return null;
    const id = `log-${++this.seq}`;
    this.log.push({ ...row, id });
    return id;
  }
  async unclaim(id: string) {
    this.log = this.log.filter((r) => r.id !== id);
  }
  async deletePushSub(id: string) {
    this.subs = this.subs.filter((s) => s.id !== id);
  }
}

interface Device {
  sub: PushSubRow;
  ecdh: ECDH;
  auth: Buffer;
}

function device(memberId: string, endpoint: string): Device {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh,
    auth,
    sub: {
      id: `sub-${endpoint}`,
      member_id: memberId,
      endpoint: `https://push.example.com/${endpoint}`,
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: auth.toString('base64url'),
    },
  };
}

/** Answers push endpoints from `statuses` (default 201) and Resend with `resendStatus`. */
function network(statuses: Record<string, number> = {}, resendStatus = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url === RESEND_URL) {
      return new Response(JSON.stringify(resendStatus === 200 ? { id: 'e1' } : { message: 'nope' }), { status: resendStatus });
    }
    const key = url.replace('https://push.example.com/', '');
    return new Response('', { status: statuses[key] ?? 201 });
  };
  return { calls, impl, pushCalls: () => calls.filter((c) => c.url !== RESEND_URL) };
}

let vapid: VapidKeys;
beforeAll(async () => {
  vapid = { ...(await generateVapidKeys()), subject: 'mailto:home@example.com' };
});

/** Stratis (owner, two phones), Shea (one phone), Ela (push off). One item due tomorrow for Shea. */
function world() {
  const h = household();
  const stratis = member(h, { name: 'Stratis', role: 'owner', created_at: '2026-01-01T00:00:00Z' });
  const shea = member(h, { name: 'Shea', emoji: '🦆', created_at: '2026-01-02T00:00:00Z' });
  const ela = member(h, { name: 'Ela', push_enabled: false, weekly_email: false, created_at: '2026-01-03T00:00:00Z' });
  const kitchen = area(h, 'Kitchen');
  const devices = {
    stratisA: device(stratis.id, 'stratis-a'),
    stratisB: device(stratis.id, 'stratis-b'),
    shea: device(shea.id, 'shea'),
  };
  const data: SchedulerData = {
    households: [h],
    members: [stratis, shea, ela],
    areas: [kitchen],
    items: [],
    completions: [],
  };
  return { h, stratis, shea, ela, kitchen, devices, data };
}

const sleeps: number[] = [];

function config(over: Partial<SchedulerConfig> & Pick<SchedulerConfig, 'fetch'>): SchedulerConfig {
  return {
    appUrl: APP,
    vapid,
    resend: { apiKey: 're_x', from: 'home.os <home@example.com>' },
    // The test devices live on push.example.com instead of a real push service.
    pushHosts: ['push.example.com'],
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...over,
  };
}

function decrypt(d: Device, body: unknown): unknown {
  const plain = ece.decrypt(Buffer.from(body as Uint8Array), { version: 'aes128gcm', privateKey: d.ecdh, authSecret: d.auth });
  return JSON.parse(plain.toString('utf8'));
}

describe('runScheduler: pushes', () => {
  it('sends one push per device, logs one row per member, and never repeats', async () => {
    const w = world();
    // Unassigned and due tomorrow: everyone with push on gets it.
    const it1 = item(w.kitchen, { title: 'Kitchen paper', due_date: '2026-10-13', notify: 'day_before' });
    w.data.items = [it1];
    const store = new MemoryStore(w.data, [w.devices.stratisA.sub, w.devices.stratisB.sub, w.devices.shea.sub]);
    const net = network();

    const first = await runScheduler(store, config({ fetch: net.impl }), { now: NOW });
    expect(first.push).toMatchObject({ enabled: true, planned: 2, sent: 2, alreadySent: 0, failed: 0, noDevice: 0 });
    expect(first.push.devices).toEqual({ sent: 3, failed: 0, removed: 0 });
    expect(net.pushCalls().map((c) => c.url).sort()).toEqual([
      'https://push.example.com/shea',
      'https://push.example.com/stratis-a',
      'https://push.example.com/stratis-b',
    ]);
    expect(store.log.map((r) => [r.kind, r.member_id, r.item_id, r.ref_date])).toEqual(
      expect.arrayContaining([
        ['reminder', w.stratis.id, it1.id, '2026-10-13'],
        ['reminder', w.shea.id, it1.id, '2026-10-13'],
      ]),
    );
    expect(store.log.filter((r) => r.kind === 'reminder')).toHaveLength(2);

    // What the phone receives.
    const toShea = net.pushCalls().find((c) => c.url.endsWith('/shea'))!;
    expect(decrypt(w.devices.shea, toShea.init.body)).toEqual({
      title: 'Due tomorrow',
      body: 'Kitchen paper · Kitchen',
      url: APP,
      tag: `reminder:${it1.id}`,
    });

    // 15 minutes later: claimed already, nothing goes out.
    const net2 = network();
    const second = await runScheduler(store, config({ fetch: net2.impl }), { now: new Date(NOW.getTime() + 15 * 60_000) });
    expect(second.push).toMatchObject({ planned: 2, sent: 0, alreadySent: 2 });
    expect(net2.pushCalls()).toEqual([]);
  });

  it('deletes a subscription the push service says is gone, keeping the claim if another device got it', async () => {
    const w = world();
    w.data.items = [item(w.kitchen, { due_date: '2026-10-13', assignee_id: w.stratis.id })];
    const store = new MemoryStore(w.data, [w.devices.stratisA.sub, w.devices.stratisB.sub]);
    const net = network({ 'stratis-a': 410 });

    const summary = await runScheduler(store, config({ fetch: net.impl }), { now: NOW });
    expect(summary.push).toMatchObject({ sent: 1, failed: 0 });
    expect(summary.push.devices).toEqual({ sent: 1, failed: 1, removed: 1 });
    expect(store.subs.map((s) => s.id)).toEqual([w.devices.stratisB.sub.id]);
    expect(store.log.filter((r) => r.kind === 'reminder')).toHaveLength(1);
    expect(summary.errors).toEqual([]);
  });

  it('releases the claim when no device got it, so the next run retries', async () => {
    const w = world();
    w.data.items = [item(w.kitchen, { due_date: '2026-10-13', assignee_id: w.shea.id })];
    const store = new MemoryStore(w.data, [w.devices.shea.sub]);

    const failing = network({ shea: 500 });
    const summary = await runScheduler(store, config({ fetch: failing.impl, resend: null }), { now: NOW });
    expect(summary.push).toMatchObject({ planned: 1, sent: 0, failed: 1 });
    expect(store.log).toEqual([]);
    expect(store.subs).toHaveLength(1);
    expect(summary.errors[0]).toMatch(/HTTP 500/);

    const ok = network();
    const retry = await runScheduler(store, config({ fetch: ok.impl, resend: null }), { now: NOW });
    expect(retry.push).toMatchObject({ sent: 1, failed: 0 });
    expect(store.log).toHaveLength(1);
  });

  it('removes every gone device and releases the claim', async () => {
    const w = world();
    w.data.items = [item(w.kitchen, { due_date: '2026-10-13', assignee_id: w.stratis.id })];
    const store = new MemoryStore(w.data, [w.devices.stratisA.sub, w.devices.stratisB.sub]);
    const net = network({ 'stratis-a': 404, 'stratis-b': 410 });

    const summary = await runScheduler(store, config({ fetch: net.impl, resend: null }), { now: NOW });
    expect(summary.push).toMatchObject({ sent: 0, failed: 1 });
    expect(summary.push.devices.removed).toBe(2);
    expect(store.subs).toEqual([]);
    expect(store.log).toEqual([]);
  });

  it('does not claim anything for a member without a device', async () => {
    const w = world();
    w.data.items = [item(w.kitchen, { due_date: '2026-10-13', assignee_id: w.shea.id })];
    const store = new MemoryStore(w.data, []);
    const net = network();
    const summary = await runScheduler(store, config({ fetch: net.impl, resend: null }), { now: NOW });
    expect(summary.push).toMatchObject({ planned: 1, sent: 0, noDevice: 1 });
    expect(store.claims).toBe(0);
    expect(net.pushCalls()).toEqual([]);
  });

  it('sends nothing when the claim fails', async () => {
    const w = world();
    w.data.items = [item(w.kitchen, { due_date: '2026-10-13', assignee_id: w.shea.id })];
    const store = new MemoryStore(w.data, [w.devices.shea.sub]);
    store.failClaims = true;
    const net = network();
    const summary = await runScheduler(store, config({ fetch: net.impl, resend: null }), { now: NOW });
    expect(summary.push).toMatchObject({ sent: 0, failed: 1 });
    expect(summary.errors[0]).toMatch(/database unavailable/);
    expect(net.calls).toEqual([]);
  });

  it('sends missed alerts to the assignee and the owner', async () => {
    const w = world();
    const late = item(w.kitchen, { title: 'Heaters', due_date: '2026-10-10', assignee_id: w.shea.id, notify: 'none' });
    w.data.items = [late];
    const store = new MemoryStore(w.data, [w.devices.stratisA.sub, w.devices.shea.sub]);
    const net = network();
    const summary = await runScheduler(store, config({ fetch: net.impl, resend: null }), { now: NOW });
    expect(summary.push).toMatchObject({ planned: 2, sent: 2 });
    const toOwner = net.pushCalls().find((c) => c.url.endsWith('/stratis-a'))!;
    expect(decrypt(w.devices.stratisA, toOwner.init.body)).toEqual({
      title: 'Missed: Heaters',
      body: 'Was due Sat 10 Oct · Kitchen',
      url: APP,
      tag: `missed:${late.id}`,
    });
    expect(store.log.map((r) => r.kind)).toEqual(['missed', 'missed']);
  });
});

describe('runScheduler: weekly email', () => {
  it('sends one email per member with weekly_email on, once', async () => {
    const w = world();
    const store = new MemoryStore(w.data, []);
    const net = network();
    const summary = await runScheduler(store, config({ fetch: net.impl }), { now: NOW });
    expect(summary.email).toEqual({ enabled: true, planned: 2, sent: 2, alreadySent: 0, failed: 0, deferred: 0 });
    const sent = net.calls.filter((c) => c.url === RESEND_URL);
    expect(sent.map((c) => JSON.parse(c.init.body as string).to[0]).sort()).toEqual([w.shea.email, w.stratis.email].sort());
    expect((sent[0].init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^weekly\/.+\/2026-10-12$/);
    expect(store.log.map((r) => [r.kind, r.item_id, r.ref_date])).toEqual([
      ['weekly', null, '2026-10-12'],
      ['weekly', null, '2026-10-12'],
    ]);

    const again = await runScheduler(store, config({ fetch: network().impl }), { now: NOW });
    expect(again.email).toMatchObject({ sent: 0, alreadySent: 2 });
  });

  it('spaces emails out and retries when Resend says too many requests', async () => {
    const w = world();
    const store = new MemoryStore(w.data, []);
    let resendCalls = 0;
    const impl = async (url: string) => {
      if (url !== RESEND_URL) return new Response('', { status: 201 });
      resendCalls++;
      // The first attempt is rate limited, everything after goes through.
      return resendCalls === 1
        ? new Response(JSON.stringify({ message: 'Too many requests' }), { status: 429 })
        : new Response(JSON.stringify({ id: `e${resendCalls}` }), { status: 200 });
    };
    sleeps.length = 0;
    const summary = await runScheduler(store, config({ fetch: impl, emailIntervalMs: 600 }), { now: NOW });
    expect(summary.email).toMatchObject({ sent: 2, failed: 0 });
    expect(resendCalls).toBe(3);
    expect(sleeps).toEqual([1000, 600]);
  });

  it('gives up on 429 after two retries and releases the claim', async () => {
    const w = world();
    w.data.members = [w.stratis];
    const store = new MemoryStore(w.data, []);
    const summary = await runScheduler(store, config({ fetch: network({}, 429).impl }), { now: NOW });
    expect(summary.email).toMatchObject({ sent: 0, failed: 1 });
    expect(store.log).toEqual([]);
  });

  it('releases the claim when Resend refuses, so the next run retries', async () => {
    const w = world();
    const store = new MemoryStore(w.data, []);
    const summary = await runScheduler(store, config({ fetch: network({}, 500).impl }), { now: NOW });
    expect(summary.email).toMatchObject({ sent: 0, failed: 2 });
    expect(store.log).toEqual([]);
    expect(summary.errors[0]).toMatch(/HTTP 500 nope/);

    const retry = await runScheduler(store, config({ fetch: network().impl }), { now: NOW });
    expect(retry.email).toMatchObject({ sent: 2 });
  });
});

describe('runScheduler: configuration and dry runs', () => {
  it('skips a channel whose secrets are missing, and says so', async () => {
    const w = world();
    w.data.items = [item(w.kitchen, { due_date: '2026-10-13', assignee_id: w.shea.id })];
    const store = new MemoryStore(w.data, [w.devices.shea.sub]);
    const net = network();
    const summary = await runScheduler(store, config({ fetch: net.impl, vapid: null, resend: null }), { now: NOW });
    expect(summary.push).toMatchObject({ enabled: false, planned: 1, sent: 0 });
    expect(summary.push.skipped).toMatch(/VAPID/);
    expect(summary.email).toMatchObject({ enabled: false, planned: 2, sent: 0 });
    expect(summary.email.skipped).toMatch(/RESEND_API_KEY/);
    expect(net.calls).toEqual([]);
    expect(store.claims).toBe(0);
  });

  it('skips email without APP_URL, and pushes open "/"', async () => {
    const w = world();
    w.data.items = [item(w.kitchen, { due_date: '2026-10-13', assignee_id: w.shea.id })];
    const store = new MemoryStore(w.data, [w.devices.shea.sub]);
    const net = network();
    const summary = await runScheduler(store, config({ fetch: net.impl, appUrl: '' }), { now: NOW });
    expect(summary.email.skipped).toMatch(/APP_URL/);
    expect(summary.push.sent).toBe(1);
    expect(decrypt(w.devices.shea, net.pushCalls()[0].init.body)).toMatchObject({ url: '/' });
  });

  it('a dry run returns the plan without claiming or sending', async () => {
    const w = world();
    w.data.items = [item(w.kitchen, { due_date: '2026-10-13', assignee_id: w.shea.id })];
    const store = new MemoryStore(w.data, [w.devices.shea.sub]);
    const net = network();
    const summary = await runScheduler(store, config({ fetch: net.impl }), { now: NOW, dry: true });
    expect(summary.dry).toBe(true);
    expect(summary.plan?.pushes).toHaveLength(1);
    expect(summary.plan?.emails).toHaveLength(2);
    expect(store.claims).toBe(0);
    expect(net.calls).toEqual([]);
  });

  it('asks the store for completions from the last 8 days', async () => {
    const w = world();
    const store = new MemoryStore(w.data, []);
    let since: Date | null = null;
    store.load = async (s: Date) => {
      since = s;
      return w.data;
    };
    await runScheduler(store, config({ fetch: network().impl }), { now: NOW, dry: true });
    expect(since).toEqual(new Date('2026-10-04T07:00:00Z'));
  });
});

describe('runScheduler: slow push services and untrusted endpoints', () => {
  /** Due tomorrow, unassigned: a reminder for Stratis (two phones) and Shea (one phone). */
  function dueTomorrow() {
    const w = world();
    w.data.items = [item(w.kitchen, { title: 'Kitchen paper', due_date: '2026-10-13', notify: 'day_before' })];
    const store = new MemoryStore(w.data, [w.devices.stratisA.sub, w.devices.stratisB.sub, w.devices.shea.sub]);
    return { w, store };
  }

  /** Like network(), but requests to `hang` never get an answer and ignore every abort. */
  function hangingNetwork(hang: string) {
    const net = network();
    const impl = (url: string, init: RequestInit) =>
      url === `https://push.example.com/${hang}` ? new Promise<Response>(() => {}) : net.impl(url, init);
    return { ...net, impl };
  }

  /** Requests to `slow` only end when their signal aborts (the time limit or the deadline). */
  function abortableNetwork(slow: (url: string) => boolean) {
    const net = network();
    const impl = (url: string, init: RequestInit) => {
      if (!slow(url)) return net.impl(url, init);
      net.calls.push({ url, init });
      return new Promise<Response>((_, reject) => {
        const signal = init.signal as AbortSignal;
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    };
    return { ...net, impl };
  }

  it('a push endpoint that never answers does not hold up the weekly email or the summary', async () => {
    const { w, store } = dueTomorrow();
    const net = hangingNetwork('shea');
    const started = Date.now();

    const summary = await runScheduler(store, config({ fetch: net.impl, deadlineMs: 100, graceMs: 20 }), { now: NOW });

    expect(Date.now() - started).toBeLessThan(2000);
    expect(summary.timedOut).toBe(true);
    expect(summary.email).toMatchObject({ planned: 2, sent: 2, failed: 0, deferred: 0 });
    expect(net.calls.filter((c) => c.url === RESEND_URL)).toHaveLength(2);
    // Stratis got the reminder; Shea's is reported as still running.
    expect(summary.push).toMatchObject({ planned: 2, sent: 1, failed: 1, deferred: 0 });
    expect(summary.errors).toContainEqual(expect.stringMatching(new RegExp(`${w.shea.id}: still running`)));
  });

  it('gives each push request a time limit; a timed-out send is retried by the next run', async () => {
    const { w, store } = dueTomorrow();
    const net = abortableNetwork((url) => url.endsWith('/shea'));

    const summary = await runScheduler(store, config({ fetch: net.impl, requestTimeoutMs: 20 }), { now: NOW });

    expect(summary.timedOut).toBe(false);
    expect(summary.push).toMatchObject({ sent: 1, failed: 1, deferred: 0 });
    expect(summary.email.sent).toBe(2);
    expect(summary.errors).toContainEqual(expect.stringMatching(new RegExp(`to ${w.shea.id}: .*(timed out|timeout|aborted)`, 'i')));
    // Shea's claim was released, so the next run tries again.
    expect(store.log.filter((r) => r.kind === 'reminder').map((r) => r.member_id)).toEqual([w.stratis.id]);
    expect(store.subs).toHaveLength(3);
  });

  it('at the deadline it stops starting pushes and releases the claim of the one it aborted', async () => {
    const { store } = dueTomorrow();
    // Every push waits until it is aborted; one at a time.
    const net = abortableNetwork((url) => url !== RESEND_URL);

    const summary = await runScheduler(
      store,
      config({ fetch: net.impl, concurrency: 1, deadlineMs: 50, requestTimeoutMs: 10_000 }),
      { now: NOW },
    );

    expect(summary.timedOut).toBe(true);
    expect(summary.push).toMatchObject({ planned: 2, sent: 0, failed: 1, deferred: 1 });
    expect(summary.errors).toContainEqual(expect.stringMatching(/deadline/));
    expect(summary.email.sent).toBe(2);
    expect(store.log.filter((r) => r.kind === 'reminder')).toEqual([]);
    // Only the first message (Stratis, two phones) was started and aborted; Shea's never was.
    expect(net.pushCalls().map((c) => c.url).sort()).toEqual([
      'https://push.example.com/stratis-a',
      'https://push.example.com/stratis-b',
    ]);
  });

  it('at the deadline it stops starting emails and releases the claim of the one it aborted', async () => {
    const w = world();
    const store = new MemoryStore(w.data, []);
    const net = abortableNetwork((url) => url === RESEND_URL);

    const summary = await runScheduler(store, config({ fetch: net.impl, deadlineMs: 50 }), { now: NOW });

    expect(summary.timedOut).toBe(true);
    expect(summary.email).toMatchObject({ planned: 2, sent: 0, failed: 1, deferred: 1 });
    expect(store.log).toEqual([]);
    expect(net.calls.filter((c) => c.url === RESEND_URL)).toHaveLength(1);
  });

  it('still sends the weekly email when loading push subscriptions fails', async () => {
    const { store } = dueTomorrow();
    store.pushSubs = async () => {
      throw new Error('push_subs unavailable');
    };
    const net = network();
    const summary = await runScheduler(store, config({ fetch: net.impl }), { now: NOW });
    expect(summary.email.sent).toBe(2);
    expect(summary.push).toMatchObject({ planned: 2, sent: 0, deferred: 0 });
    expect(summary.errors).toEqual(['push: push_subs unavailable']);
    expect(net.pushCalls()).toEqual([]);
  });

  it('never contacts an endpoint outside the push service allowlist, and deletes it', async () => {
    const { w, store } = dueTomorrow();
    const internal = { ...w.devices.shea.sub, id: 'sub-internal', endpoint: 'https://169.254.169.254/latest/meta-data/' };
    const plain = { ...w.devices.shea.sub, id: 'sub-http', endpoint: 'http://push.example.com/shea' };
    store.subs = [w.devices.stratisA.sub, internal, plain];
    const net = network();

    const summary = await runScheduler(store, config({ fetch: net.impl, resend: null }), { now: NOW });

    expect(net.pushCalls().map((c) => c.url)).toEqual(['https://push.example.com/stratis-a']);
    expect(summary.push).toMatchObject({ sent: 1, failed: 1 });
    expect(summary.push.devices).toEqual({ sent: 1, failed: 2, removed: 2 });
    expect(store.subs.map((s) => s.id)).toEqual([w.devices.stratisA.sub.id]);
    expect(summary.errors).toEqual([
      expect.stringMatching(/sub-internal: endpoint is not a known push service/),
      expect.stringMatching(/sub-http: endpoint is not a known push service/),
    ]);
  });

  it('only contacts the real push services by default', async () => {
    const { store } = dueTomorrow();
    const net = network();
    const summary = await runScheduler(store, config({ fetch: net.impl, resend: null, pushHosts: undefined }), { now: NOW });
    // push.example.com is not a browser push service: nothing is sent and the rows go.
    expect(net.pushCalls()).toEqual([]);
    expect(summary.push.devices.removed).toBe(3);
    expect(store.subs).toEqual([]);
  });

  it('does not follow redirects and passes a signal on every request', async () => {
    const { store } = dueTomorrow();
    const net = network();
    await runScheduler(store, config({ fetch: net.impl }), { now: NOW });
    expect(net.calls.length).toBeGreaterThan(0);
    for (const c of net.calls) expect(c.init.signal).toBeInstanceOf(AbortSignal);
    for (const c of net.pushCalls()) expect(c.init.redirect).toBe('manual');
  });
});
