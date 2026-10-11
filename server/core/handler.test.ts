import { describe, expect, it, vi } from 'vitest';
import { API_PATH, CODE_TTL_MS, RPC_BODY_MAX, SETUP_BODY_MAX, SMALL_BODY_MAX } from '../../src/lib/backend/serverApi';
import type { HouseholdData } from '../../src/lib/types';
import { USER_DEMO_DOC } from '../../src/lib/logic/importHome.fixture';
import { MemoryBlobStore } from '../store/memory';
import { BlobUnavailableError, type BlobStore } from '../store/types';
import { createHarness, TEST_SETUP_CODE, type Browser, type Harness } from '../testing/harness';
import { errorResponse, keyCookie } from './handler';
import { ApiError } from './errors';
import { parseServerDoc } from './serverDoc';

const PHONE = JSON.stringify(USER_DEMO_DOC);

async function call(browser: Browser, op: string, body?: Record<string, unknown>) {
  const res = body
    ? await browser.fetch(API_PATH, {
        method: 'POST',
        headers: { 'X-HomeOS': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, ...body }),
      })
    : await browser.fetch(`${API_PATH}?op=${op}`, { headers: { 'X-HomeOS': '1' } });
  return { status: res.status, json: (await res.json()) as any, headers: res.headers };
}

const rpc = (browser: Browser, method: string, args: unknown[], minRev?: number) =>
  call(browser, 'rpc', { method, args, ...(minRev !== undefined ? { minRev } : {}) });

/** Stratis brings the user's home online from his phone; Shea is waiting to join. */
async function online(h: Harness) {
  const stratis = h.browser();
  const setup = await call(stratis, 'setup', { code: TEST_SETUP_CODE, phone: PHONE });
  expect(setup.status).toBe(200);
  const hid: string = setup.json.entry.householdId;
  const load = async (b: Browser = stratis): Promise<HouseholdData> => (await rpc(b, 'load', [hid])).json.result;
  const data = await load();
  const person = (name: string) => data.members.find((m) => m.name === name)!;
  return { stratis, hid, load, data, person, setup: setup.json };
}

/** Shea joins with a code Stratis made for her. */
async function sheaJoins(h: Harness, home: Awaited<ReturnType<typeof online>>) {
  const code = (await call(home.stratis, 'createCode', { memberId: home.person('Shea').id })).json.code as string;
  const shea = h.browser();
  const joined = await call(shea, 'redeem', { code });
  expect(joined.status).toBe(200);
  return { shea, joined: joined.json, code };
}

describe('every request', () => {
  it('needs the X-HomeOS header, and a POST needs JSON (no cross-site requests)', async () => {
    const h = createHarness();
    expect((await h.request({ method: 'GET', url: `${API_PATH}?op=status`, headers: { 'x-homeos': undefined } })).status).toBe(403);
    const form = await h.request({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'op=signOut' });
    expect(form.status).toBe(403);
    expect(JSON.parse(form.body)).toEqual({ error: { code: 'forbidden', message: 'Not JSON' } });
    const text = await h.request({ method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"op":"signOut"}' });
    expect(text.status).toBe(403);
    const ok = await h.request({ method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{"op":"signOut"}' });
    expect(ok.status).toBe(200);
  });

  it('answers only at /api/home, to GET and POST, as JSON that is never cached', async () => {
    const h = createHarness();
    expect((await h.request({ method: 'GET', url: '/api/other?op=status' })).status).toBe(404);
    expect((await h.request({ method: 'PUT', url: `${API_PATH}?op=status` })).status).toBe(405);
    const res = await h.request({ method: 'GET', url: `${API_PATH}?op=status` });
    expect(res.status).toBe(200);
    expect(res.headers).toMatchObject({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    expect(JSON.parse(res.body)).toEqual({ home: false });
  });

  it('refuses unknown ops and bodies that are not JSON objects', async () => {
    const h = createHarness();
    const codeOf = async (r: Promise<{ body: string; status: number }>) => {
      const res = await r;
      return [res.status, JSON.parse(res.body).error.code];
    };
    expect(await codeOf(h.request({ method: 'GET', url: `${API_PATH}?op=export` }))).toEqual([400, 'unknown_op']);
    expect(await codeOf(h.request({ method: 'GET', url: API_PATH }))).toEqual([400, 'unknown_op']);
    expect(await codeOf(h.request({ method: 'POST', json: { op: 'dropEverything' } }))).toEqual([400, 'unknown_op']);
    expect(await codeOf(h.request({ method: 'POST', json: { op: 'constructor' } }))).toEqual([400, 'unknown_op']);
    expect(await codeOf(h.request({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' }))).toEqual([400, 'invalid_input']);
    expect(await codeOf(h.request({ method: 'POST', json: [1, 2] }))).toEqual([400, 'invalid_input']);
  });

  it('keeps bodies within their limits: setup 4 MiB, rpc 256 KiB, the rest 4 KiB', async () => {
    const h = createHarness();
    const big = (n: number) => 'x'.repeat(n);
    expect((await h.request({ method: 'POST', json: { op: 'redeem', code: big(SMALL_BODY_MAX) } })).status).toBe(413);
    expect((await h.request({ method: 'POST', json: { op: 'rpc', method: 'load', args: [big(RPC_BODY_MAX)] } })).status).toBe(413);
    expect((await h.request({ method: 'POST', json: { op: 'setup', code: 'x', phone: big(SETUP_BODY_MAX) } })).status).toBe(413);
    // Under the limit: answered as usual.
    expect((await h.request({ method: 'POST', json: { op: 'rpc', method: 'load', args: [big(1000)] } })).status).toBe(401);
  });

  it('maps errors to their statuses, and says nothing about an unexpected one', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = errorResponse(new Error('secret detail'));
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: { code: 'unknown', message: 'Something went wrong' } });
    expect(spy).toHaveBeenCalledOnce();
    expect(errorResponse(new ApiError('too_many_attempts', 'x', 120)).headers['Retry-After']).toBe('120');
    expect(errorResponse(new BlobUnavailableError()).status).toBe(503);
    spy.mockRestore();
  });

  it('sets the key in an HttpOnly cookie for the API only, Secure on https', () => {
    expect(keyCookie('k3y', true)).toBe('homeos_key=k3y; Path=/api; HttpOnly; SameSite=Lax; Max-Age=34560000; Secure');
    expect(keyCookie('k3y', false)).toBe('homeos_key=k3y; Path=/api; HttpOnly; SameSite=Lax; Max-Age=34560000');
    expect(keyCookie(null, true)).toBe('homeos_key=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
  });
});

describe('bringing the home online (setup)', () => {
  it("brings the user's home online once, with Stratis signed in as its owner and Shea waiting to join", async () => {
    const h = createHarness();
    const res = await h.request({ method: 'POST', json: { op: 'setup', code: 'test-setu-pcde', phone: PHONE } });
    expect(res.status).toBe(200);
    expect(res.headers['Set-Cookie']).toMatch(/^homeos_key=[A-Za-z0-9_-]{43}; Path=\/api; HttpOnly; SameSite=Lax; Max-Age=34560000; Secure$/);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ user: { email: '', name: 'Stratis' }, entry: { status: 'member', canImport: false }, rev: 1 });
    expect(body.device).toMatchObject({ label: 'Device · Browser', current: true });

    const home = await online(createHarness());
    const data = home.data;
    expect(data.household).toMatchObject({ name: 'Our home', address: '21 Alderbrook Road', timezone: 'Europe/London' });
    expect(data.members.map((m) => [m.name, m.role, m.user_id !== null, m.email])).toEqual([
      ['Stratis', 'owner', true, ''],
      ['Shea', 'member', false, ''],
    ]);
    expect(data.areas.map((a) => a.name)).toEqual(['Kitchen', 'Living Room', 'Bathroom Small', 'Garden', 'Garden Lounge', 'Jacuzzi']);
    expect(data.items).toHaveLength(19);
    expect(data.items.filter((i) => i.assignee_id === home.person('Shea').id).map((i) => i.title).sort()).toEqual(
      ['Change the filter', 'Check Chemicals', 'Rubbish fill level', 'Tidiness', 'Tidiness'].sort(),
    );
    expect(data.completions.map((c) => c.item_title).sort()).toEqual(['Change the filter', 'Fix the doorbell', 'Order water test strips']);
    expect(data.housekeeping.tasks.length).toBeGreaterThan(0);
  });

  it('works only with the right setup code, and only while no home is online', async () => {
    const h = createHarness();
    const wrong = await h.request({ method: 'POST', json: { op: 'setup', code: 'WRON-GCOD-EXXX', phone: PHONE } });
    expect([wrong.status, JSON.parse(wrong.body).error.code]).toEqual([400, 'invalid_code']);
    expect(wrong.headers['Set-Cookie']).toBeUndefined();
    await online(h);
    const again = await h.request({ method: 'POST', json: { op: 'setup', code: TEST_SETUP_CODE, phone: PHONE } });
    expect([again.status, JSON.parse(again.body).error.code]).toEqual([409, 'home_exists']);
    // Another instance that had not seen the home yet: the store says no too.
    const other = h.instance();
    const raced = await h.request({ method: 'POST', json: { op: 'setup', code: TEST_SETUP_CODE, phone: PHONE } }, other);
    expect(JSON.parse(raced.body).error.code).toBe('home_exists');
    expect(JSON.parse((await h.request({ method: 'GET', url: `${API_PATH}?op=status` })).body)).toEqual({ home: true });
  });

  it('refuses everything when no setup code is configured', async () => {
    const h = createHarness({ env: { HOMEOS_SETUP_CODE: undefined } });
    const res = await h.request({ method: 'POST', json: { op: 'setup', code: '', phone: PHONE } });
    expect(JSON.parse(res.body).error.code).toBe('invalid_code');
    // A sign-in-shaped code is too short to be the setup code: setup is off (and the log says so).
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const short = createHarness({ env: { HOMEOS_SETUP_CODE: 'ABCD-EFGH' } });
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).not.toContain('ABCD');
    warn.mockRestore();
    const res2 = await short.request({ method: 'POST', json: { op: 'setup', code: 'ABCD-EFGH', phone: PHONE } });
    expect(JSON.parse(res2.body).error.code).toBe('invalid_code');
  });

  it('refuses a phone with no home in it', async () => {
    const h = createHarness();
    for (const phone of ['', 'not json', '{"version":2}', JSON.stringify({ version: 1, households: [], members: [] })]) {
      const res = await h.request({ method: 'POST', json: { op: 'setup', code: TEST_SETUP_CODE, phone } });
      expect([res.status, JSON.parse(res.body).error]).toEqual([400, { code: 'invalid_input', message: 'invalid_input: phone' }]);
    }
    expect(JSON.parse((await h.request({ method: 'GET', url: `${API_PATH}?op=status` })).body)).toEqual({ home: false });
  });

  it('limits wrong setup codes like sign-in codes', async () => {
    const h = createHarness({ attempts: { perIp: 3, global: 50, windowMs: 60_000 } });
    for (let i = 0; i < 3; i++) await h.request({ method: 'POST', json: { op: 'setup', code: 'NOPE-NOPE-NOPE', phone: PHONE } });
    const blocked = await h.request({ method: 'POST', json: { op: 'setup', code: TEST_SETUP_CODE, phone: PHONE } });
    expect(blocked.status).toBe(429);
    expect(blocked.headers['Retry-After']).toBe('60');
  });
});

describe('signing in with a code', () => {
  it('lets Shea join with her code, as herself, with her items', async () => {
    const h = createHarness();
    const home = await online(h);
    const { shea, joined } = await sheaJoins(h, home);
    expect(joined.entry).toMatchObject({ status: 'claimed', memberId: home.person('Shea').id });
    expect(joined.user).toMatchObject({ name: 'Shea', email: '' });
    const data = await home.load(shea);
    const me = data.members.find((m) => m.user_id === joined.user.id)!;
    expect(me.name).toBe('Shea');
    expect(data.items.filter((i) => i.assignee_id === me.id)).toHaveLength(5);
    // Her session says member from now on.
    expect((await call(shea, 'session')).json.entry.status).toBe('member');
  });

  it('takes a code typed any way, once, for 7 days', async () => {
    const h = createHarness();
    const home = await online(h);
    const made = (await call(home.stratis, 'createCode', { memberId: home.person('Shea').id })).json;
    expect(made).toMatchObject({ code: expect.stringMatching(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/), memberId: home.person('Shea').id });
    expect(Date.parse(made.expiresAt) - h.clock.now).toBe(CODE_TTL_MS);
    const typed = ` ${made.code.toLowerCase().replace('-', ' ')} `;
    expect((await call(h.browser(), 'redeem', { code: typed })).status).toBe(200);
    const twice = await call(h.browser(), 'redeem', { code: made.code });
    expect([twice.status, twice.json.error.code]).toEqual([400, 'invalid_code']);

    const late = (await call(home.stratis, 'createCode', { memberId: home.person('Stratis').id })).json.code;
    h.clock.advance(CODE_TTL_MS);
    expect((await call(h.browser(), 'redeem', { code: late })).json.error.code).toBe('invalid_code');
  });

  it("gives someone who has joined another device ('member')", async () => {
    const h = createHarness();
    const home = await online(h);
    const code = (await call(home.stratis, 'createCode', { memberId: home.person('Stratis').id })).json.code;
    const ipad = h.browser({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1' });
    const res = await call(ipad, 'redeem', { code });
    expect(res.json.entry.status).toBe('member');
    expect(res.json.user.id).toBe(home.setup.user.id);
    const devices = (await call(home.stratis, 'devices')).json.devices;
    expect(devices.map((d: { label: string; current: boolean }) => [d.label, d.current])).toEqual([
      ['iPhone · Safari', true],
      ['iPad · Safari', false],
    ]);
  });

  it('turns guessing away: wrong codes are counted per address and in all, then refused without being tried', async () => {
    const h = createHarness({ attempts: { perIp: 3, global: 5, windowMs: 60_000 } });
    const home = await online(h);
    const code = (await call(home.stratis, 'createCode', { memberId: home.person('Shea').id })).json.code;
    const puts = (h.blobs as MemoryBlobStore).calls.put;
    const guesser = h.browser({ ip: '203.0.113.9' });
    for (const guess of ['AAAA-AAAA', 'BBBB-BBBB', 'not-a-code']) {
      expect((await call(guesser, 'redeem', { code: guess })).json.error.code).toBe('invalid_code');
    }
    const blocked = await call(guesser, 'redeem', { code });
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe('too_many_attempts');
    expect(blocked.headers.get('Retry-After')).toBe('60');
    // Wrong codes never write to the Blob store.
    expect((h.blobs as MemoryBlobStore).calls.put).toBe(puts);
    // Two more wrong codes from elsewhere: now everyone waits.
    await call(h.browser(), 'redeem', { code: 'CCCC-CCCC' });
    await call(h.browser(), 'redeem', { code: 'DDDD-DDDD' });
    expect((await call(h.browser(), 'redeem', { code })).status).toBe(429);
    h.clock.advance(60_001);
    expect((await call(h.browser(), 'redeem', { code })).status).toBe(200);
  });

  it('turns a stranger away', async () => {
    const h = createHarness();
    const home = await online(h);
    const stranger = h.browser();
    for (const op of ['session', 'version', 'devices']) {
      const res = await call(stranger, op);
      expect([res.status, res.json.error.code]).toEqual([401, 'not_signed_in']);
    }
    expect((await rpc(stranger, 'load', [home.hid])).status).toBe(401);
    const forged = await h.request({ method: 'GET', url: `${API_PATH}?op=version`, headers: { authorization: 'Bearer ' + 'A'.repeat(43) } });
    expect(forged.status).toBe(401);
    expect(forged.headers['Set-Cookie']).toBe('homeos_key=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
    // Whether a home is online is all a stranger can learn.
    const res = await h.request({ method: 'GET', url: `${API_PATH}?op=status` });
    expect(JSON.parse(res.body)).toEqual({ home: true });
  });

  it('finds a device another instance signed in a moment ago', async () => {
    const h = createHarness();
    const home = await online(h);
    const other = h.instance();
    await h.request({ method: 'GET', url: `${API_PATH}?op=status` }, other);
    const code = (await call(home.stratis, 'createCode', { memberId: home.person('Shea').id })).json.code;
    h.clock.advance(3000);
    // Shea redeems on this instance, then her next request reaches the other one.
    const shea = h.browser();
    await call(shea, 'redeem', { code });
    const res = await h.request({ method: 'GET', url: `${API_PATH}?op=version`, headers: { authorization: `Bearer ${shea.key()}` } }, other);
    expect(res.status).toBe(200);
  });
});

describe('signed in', () => {
  it('answers session (renewing the cookie), version and devices', async () => {
    const h = createHarness();
    const home = await online(h);
    const session = await call(home.stratis, 'session');
    expect(session.json).toMatchObject({ user: home.setup.user, entry: { status: 'member', householdId: home.hid }, rev: 1 });
    expect(session.json.device.current).toBe(true);
    const version = await call(home.stratis, 'version');
    expect(version.json).toEqual({ rev: 1, chatRev: 1, pollMs: 3000, readOnly: false });
    // With a Bearer key (tools), no cookie is set.
    const bearer = await h.request({ method: 'GET', url: `${API_PATH}?op=session`, headers: { authorization: `Bearer ${home.stratis.key()}` } });
    expect(bearer.status).toBe(200);
    expect(bearer.headers['Set-Cookie']).toBeUndefined();
  });

  it('runs allowed RPCs as the caller, with the data rules of demo mode', async () => {
    const h = createHarness();
    const home = await online(h);
    const area = await rpc(home.stratis, 'createArea', [home.hid, '  Garage  ']);
    expect(area.json).toMatchObject({ result: { name: 'Garage', household_id: home.hid }, rev: 2 });
    const blank = await rpc(home.stratis, 'createArea', [home.hid, '   ']);
    expect([blank.status, blank.json.error]).toEqual([400, { code: 'invalid_input', message: 'invalid_input: name' }]);
    const shape = await rpc(home.stratis, 'createArea', [home.hid, 42]);
    expect(shape.json.error).toEqual({ code: 'invalid_input', message: 'invalid_input: args[1]' });
    const unknown = await rpc(home.stratis, 'importHousehold', [{}]);
    expect([unknown.status, unknown.json.error.code]).toEqual([400, 'unknown_op']);
    const missing = await rpc(home.stratis, 'deleteItem', ['no-such-item']);
    expect([missing.status, missing.json.error.code]).toEqual([404, 'not_found']);
    const done = await rpc(home.stratis, 'deleteArea', [area.json.result.id]);
    expect(done.json).toEqual({ result: null, rev: 3 });
    expect((await call(home.stratis, 'version')).json.rev).toBe(3);
  });

  it('answers a read from a copy at least as new as the caller has seen', async () => {
    const h = createHarness();
    const home = await online(h);
    const other = h.instance();
    const stratisThere = h.browser({ ctx: other });
    // The other instance's copy is from before the write below.
    const code = (await call(home.stratis, 'createCode', { memberId: home.person('Stratis').id })).json.code;
    expect((await call(stratisThere, 'redeem', { code })).status).toBe(200);
    const created = await rpc(home.stratis, 'createArea', [home.hid, 'Garage']);
    const read = await rpc(stratisThere, 'load', [home.hid], created.json.rev);
    expect(read.json.rev).toBe(created.json.rev);
    expect(read.json.result.areas.map((a: { name: string }) => a.name)).toContain('Garage');
  });

  it('never loses a change when two people write at the same moment', async () => {
    const h = createHarness({ blobs: new MemoryBlobStore(2) });
    const home = await online(h);
    const { shea } = await sheaJoins(h, home);
    // Shea's phone talks to another instance.
    const sheaThere = h.browser({ ctx: h.instance() });
    const code = (await call(shea, 'createCode', { memberId: home.person('Shea').id })).json.code;
    await call(sheaThere, 'redeem', { code });
    const data = await home.load();
    const [t1, t2] = data.housekeeping.tasks;
    const item = data.items.find((i) => i.title === 'Remove AC')!;
    const today = '2026-10-09';
    const results = await Promise.all([
      rpc(home.stratis, 'setHousekeepingTaskDone', [home.hid, today, { taskId: t1.id }, true]),
      rpc(sheaThere, 'setHousekeepingTaskDone', [home.hid, today, { taskId: t2.id }, true]),
      rpc(home.stratis, 'updateItem', [item.id, { note: 'Booked for Saturday' }]),
      rpc(sheaThere, 'updateItem', [item.id, { rag: 'green' }]),
      rpc(sheaThere, 'sendMessage', [home.hid, 'On it']),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const after = await home.load();
    const visit = after.housekeeping.visits.find((v) => v.visit_date === today)!;
    expect(visit.tasks.filter((t) => t.done).map((t) => t.task_id).sort()).toEqual([t1.id, t2.id].sort());
    expect(after.items.find((i) => i.id === item.id)).toMatchObject({ note: 'Booked for Saturday', rag: 'green' });
    expect((await rpc(home.stratis, 'listMessages', [home.hid])).json.result.messages.map((m: { body: string }) => m.body)).toEqual(['On it']);
    expect((await call(home.stratis, 'version')).json.chatRev).toBe(2);
  });

  it('removes devices: anyone in the home may, and the removed browser is signed out', async () => {
    const h = createHarness();
    const home = await online(h);
    const { shea } = await sheaJoins(h, home);
    const devices = (await call(home.stratis, 'devices')).json.devices;
    const sheas = devices.find((d: { memberId: string }) => d.memberId === home.person('Shea').id);
    const removed = await call(home.stratis, 'removeDevice', { deviceId: sheas.id });
    expect(removed.json).toEqual({ ok: true });
    expect(removed.headers.get('Set-Cookie')).toBeNull();
    expect((await call(shea, 'version')).status).toBe(401);
    expect(shea.key()).toBeNull();
    const again = await call(home.stratis, 'removeDevice', { deviceId: sheas.id });
    expect([again.status, again.json.error.code]).toEqual([404, 'not_found']);
    // Removing your own signs you out here.
    const mine = (await call(home.stratis, 'session')).json.device.id;
    expect((await call(home.stratis, 'removeDevice', { deviceId: mine })).status).toBe(200);
    expect(home.stratis.key()).toBeNull();
  });

  it('signs out (revoking this device), always with 200', async () => {
    const h = createHarness();
    const home = await online(h);
    const key = home.stratis.key();
    const out = await call(home.stratis, 'signOut', {});
    expect(out).toMatchObject({ status: 200, json: { ok: true } });
    expect(home.stratis.key()).toBeNull();
    const reused = await h.request({ method: 'GET', url: `${API_PATH}?op=version`, headers: { authorization: `Bearer ${key}` } });
    expect(reused.status).toBe(401);
    expect((await call(h.browser(), 'signOut', {})).status).toBe(200);
  });

  it('lets someone who just joined say "Not Shea?" for a day: Shea waits to join again, signed out everywhere', async () => {
    const h = createHarness();
    const home = await online(h);
    const { shea } = await sheaJoins(h, home);
    const released = await call(shea, 'release', {});
    expect(released.json).toEqual({ ok: true });
    expect(shea.key()).toBeNull();
    const data = await home.load();
    expect(data.members.find((m) => m.name === 'Shea')!.user_id).toBeNull();
    expect((await call(home.stratis, 'devices')).json.devices).toHaveLength(1);

    const later = await sheaJoins(h, home);
    h.clock.advance(86_400_001);
    const tooLate = await call(later.shea, 'release', {});
    expect([tooLate.status, tooLate.json.error.code]).toEqual([404, 'not_found']);
  });

  it('pauses saving at the write budget (read-only), and says so', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = createHarness({ env: { HOMEOS_BLOB_WRITES_PER_MONTH: '2' } });
    const home = await online(h);
    expect((await rpc(home.stratis, 'createArea', [home.hid, 'Garage'])).status).toBe(200);
    const paused = await rpc(home.stratis, 'createArea', [home.hid, 'Shed']);
    expect([paused.status, paused.json.error.code]).toEqual([503, 'read_only']);
    expect((await call(home.stratis, 'version')).json.readOnly).toBe(true);
    expect((await rpc(home.stratis, 'load', [home.hid])).status).toBe(200);
    vi.restoreAllMocks();
  });

  it("answers 'unavailable' when the Blob store can't be reached", async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const down: BlobStore = {
      get: () => Promise.reject(new BlobUnavailableError()),
      put: () => Promise.reject(new BlobUnavailableError()),
    };
    const h = createHarness({ blobs: down });
    const res = await h.request({ method: 'GET', url: `${API_PATH}?op=status` });
    expect([res.status, JSON.parse(res.body).error.code]).toEqual([503, 'unavailable']);
    spy.mockRestore();
  });
});

describe('secrets', () => {
  it('never sends a key, a hash or a code that was not just made, in any response', async () => {
    const h = createHarness();
    const home = await online(h);
    const { shea, code } = await sheaJoins(h, home);
    await rpc(shea, 'sendMessage', [home.hid, 'Hello']);
    await call(home.stratis, 'devices');
    await call(shea, 'session');
    await rpc(home.stratis, 'load', [home.hid]);
    const doc = parseServerDoc((h.blobs as MemoryBlobStore).peek('homeos/test/home.json')!.body);
    const secrets = [
      ...doc.auth.devices.map((d) => d.keyHash),
      ...doc.auth.codes.map((c) => c.codeHash),
      home.stratis.key()!,
      shea.key()!,
    ];
    const everything = [...home.stratis.bodies, ...shea.bodies];
    expect(everything.length).toBeGreaterThan(5);
    for (const body of everything) {
      for (const secret of secrets) expect(body).not.toContain(secret);
      expect(body).not.toContain('keyHash');
      expect(body).not.toContain('codeHash');
    }
    // The only place a code appears is the createCode answer that made it.
    expect(everything.filter((b) => b.includes(code))).toHaveLength(1);
    // And the stored home holds no session.
    expect(doc.home.session).toBeNull();
    expect(doc.home.users).toEqual([]);
  });
});
