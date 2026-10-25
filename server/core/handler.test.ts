import { describe, expect, it, vi } from 'vitest';
import { API_PATH, CODE_TTL_MS, RPC_BODY_MAX, SETUP_BODY_MAX, SMALL_BODY_MAX } from '../../src/lib/backend/serverApi';
import type { HouseholdData } from '../../src/lib/types';
import { USER_DEMO_DOC } from '../../src/lib/logic/importHome.fixture';
import { newItemDraft } from '../../src/lib/logic/items';
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
    expect(JSON.parse(res.body)).toEqual({ home: false, google: false });
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
    expect(res.headers['Set-Cookie']).toMatch(
      /^homeos_key=[A-Za-z0-9_-]{43}\.[0-9a-f-]{36}\.1\.[A-Za-z0-9_-]{22}; Path=\/api; HttpOnly; SameSite=Lax; Max-Age=34560000; Secure$/,
    );
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
    expect(JSON.parse((await h.request({ method: 'GET', url: `${API_PATH}?op=status` })).body)).toEqual({ home: true, google: false });
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
    expect(JSON.parse((await h.request({ method: 'GET', url: `${API_PATH}?op=status` })).body)).toEqual({ home: false, google: false });
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
    const first = h.browser();
    expect((await call(first, 'redeem', { code: typed })).status).toBe(200);
    // The phone that used it is in (its first request marks its key used): the code is spent.
    expect((await call(first, 'session')).status).toBe(200);
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

  it('turns guessing away: wrong codes are counted per address, then refused without being tried', async () => {
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
    // Someone else, with no failures of their own, is not held up by the guesser.
    expect((await call(h.browser(), 'redeem', { code })).status).toBe(200);
    h.clock.advance(60_001);
    expect((await call(guesser, 'redeem', { code: 'EEEE-EEEE' })).json.error.code).toBe('invalid_code');
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
    expect(JSON.parse(res.body)).toEqual({ home: true, google: false });
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
    expect(version.json).toEqual({ rev: 1, pollMs: 3000, readOnly: false });
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

  it('loads the home as stored before sections (the live home’s shape), and keeps working on it', async () => {
    const h = createHarness();
    const home = await online(h);
    const [task] = (await home.load()).housekeeping.tasks;
    expect((await rpc(home.stratis, 'setHousekeepingTaskDone', [home.hid, '2026-10-09', { taskId: task.id }, true])).status).toBe(200);
    const before = await home.load();
    // Today's shape: no list of sections, no section fields on any row.
    const path = 'homeos/test/home.json';
    const blobs = h.blobs as MemoryBlobStore;
    const stored = JSON.parse(blobs.peek(path)!.body);
    delete stored.home.housekeeping_sections;
    for (const t of stored.home.housekeeping_tasks) delete t.section_id;
    for (const r of stored.home.housekeeping_visit_tasks) {
      delete r.section_id;
      delete r.section_title;
    }
    await blobs.put(path, JSON.stringify(stored), { ifMatch: blobs.peek(path)!.etag });
    h.clock.advance(60_000); // past freshMs: the instance reads the store again
    expect(JSON.stringify(storedDoc(h).home)).not.toContain('section');
    expect(await home.load()).toEqual(before);
    expect(before.housekeeping.sections).toEqual([]);

    // Writes work on it, and the first section is stored with the rest.
    const kitchen = await rpc(home.stratis, 'createHousekeepingSection', [home.hid, 'Kitchen']);
    expect(kitchen.status).toBe(200);
    const ids = before.housekeeping.tasks.map((t) => t.id);
    const moved = await rpc(home.stratis, 'moveHousekeepingTask', [ids[0], kitchen.json.result.id, 0]);
    expect(moved.status).toBe(200);
    const after = await home.load();
    expect(after.housekeeping.sections.map((s) => s.title)).toEqual(['Kitchen']);
    expect(after.housekeeping.visits[0].tasks.at(-1)).toMatchObject({ task_id: ids[0], section_title: 'Kitchen', done: true });
    expect(storedDoc(h).home.housekeeping_sections).toHaveLength(1);
    // The 31st section is refused (DemoBackend's rule; HOME_ROW_LIMITS caps it too).
    for (let i = 1; i < 30; i++) expect((await rpc(home.stratis, 'createHousekeepingSection', [home.hid, `Room ${i}`])).status).toBe(200);
    const more = await rpc(home.stratis, 'createHousekeepingSection', [home.hid, 'One more']);
    expect([more.status, more.json.error.code]).toEqual([400, 'invalid_input']);
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
      rpc(sheaThere, 'createArea', [home.hid, 'Shed']),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const after = await home.load();
    const visit = after.housekeeping.visits.find((v) => v.visit_date === today)!;
    expect(visit.tasks.filter((t) => t.done).map((t) => t.task_id).sort()).toEqual([t1.id, t2.id].sort());
    expect(after.items.find((i) => i.id === item.id)).toMatchObject({ note: 'Booked for Saturday', rag: 'green' });
    expect(after.areas.map((a) => a.name)).toContain('Shed');
  });

  it('keeps both when two people move different tasks into sections at the same moment, and a task added meanwhile', async () => {
    const h = createHarness({ blobs: new MemoryBlobStore(2) });
    const home = await online(h);
    const { shea } = await sheaJoins(h, home);
    const sheaThere = h.browser({ ctx: h.instance() });
    const code = (await call(shea, 'createCode', { memberId: home.person('Shea').id })).json.code;
    await call(sheaThere, 'redeem', { code });
    const kitchen = (await rpc(home.stratis, 'createHousekeepingSection', [home.hid, 'Kitchen'])).json.result;
    const baths = (await rpc(home.stratis, 'createHousekeepingSection', [home.hid, 'Bathrooms'])).json.result;
    const [t1, t2] = (await home.load()).housekeeping.tasks;
    // Each names only its task and where it goes: neither can put the other's back.
    const results = await Promise.all([
      rpc(home.stratis, 'moveHousekeepingTask', [t1.id, kitchen.id, 0]),
      rpc(sheaThere, 'moveHousekeepingTask', [t2.id, baths.id, 0]),
      rpc(home.stratis, 'createHousekeepingTask', [home.hid, 'Windows', kitchen.id]),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    // Read at least as new as every write (one landed through the other instance).
    const rev = Math.max(...results.map((r) => r.json.rev as number));
    const after = ((await rpc(home.stratis, 'load', [home.hid], rev)).json.result as HouseholdData).housekeeping.tasks;
    expect(after.find((t) => t.id === t1.id)!.section_id).toBe(kitchen.id);
    expect(after.find((t) => t.id === t2.id)!.section_id).toBe(baths.id);
    expect(after.filter((t) => t.section_id === kitchen.id).map((t) => t.title).sort()).toEqual([t1.title, 'Windows'].sort());
  });

  it('still takes the reorder of an app from before sections, open on a phone after an update: each task keeps its section', async () => {
    const h = createHarness();
    const home = await online(h);
    const kitchen = (await rpc(home.stratis, 'createHousekeepingSection', [home.hid, 'Kitchen'])).json.result;
    const ids = (await home.load()).housekeeping.tasks.map((t) => t.id);
    expect((await rpc(home.stratis, 'moveHousekeepingTask', [ids[0], kitchen.id, 0])).status).toBe(200);
    // That app sends the whole list in the order it shows it: here the last task moved to the top.
    const old = await rpc(home.stratis, 'reorderHousekeepingTasks', [home.hid, [ids.at(-1), ...ids.slice(0, -1)]]);
    expect(old.status).toBe(200);
    const after = (await home.load()).housekeeping.tasks;
    expect(after[0].id).toBe(ids.at(-1));
    expect(after.at(-1)).toMatchObject({ id: ids[0], section_id: kitchen.id });
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
    // Setup and Stratis's first use of his key are two puts; the third uses the month up.
    const h = createHarness({ env: { HOMEOS_BLOB_WRITES_PER_MONTH: '3' } });
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
    await rpc(shea, 'createArea', [home.hid, 'Shed']);
    await call(home.stratis, 'devices');
    await call(shea, 'session');
    await rpc(home.stratis, 'load', [home.hid]);
    const doc = parseServerDoc((h.blobs as MemoryBlobStore).peek('homeos/test/home.json')!.body);
    expect(doc.auth.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const secrets = [
      ...doc.auth.devices.map((d) => d.keyHash),
      ...doc.auth.codes.map((c) => c.codeHash),
      doc.auth.secret!,
      doc.auth.setupHash!,
      home.stratis.key()!,
      home.stratis.key()!.split('.')[0],
      shea.key()!,
      shea.key()!.split('.')[0],
    ];
    const everything = [...home.stratis.bodies, ...shea.bodies];
    expect(everything.length).toBeGreaterThan(5);
    for (const body of everything) {
      for (const secret of secrets) expect(body).not.toContain(secret);
      expect(body).not.toContain('keyHash');
      expect(body).not.toContain('codeHash');
      expect(body).not.toContain('setupHash');
      expect(body).not.toContain('"secret"');
    }
    // The only place a code appears is the createCode answer that made it.
    expect(everything.filter((b) => b.includes(code))).toHaveLength(1);
    // And the stored home holds no session.
    expect(doc.home.session).toBeNull();
    expect(doc.home.users).toEqual([]);
  });
});

// ── The review's findings (docs/ARCHITECTURE.md "Server mode (no setup)": "Signing in",
// "Budget", "Storage, reads and writes") ─────────────────────────────────────────────────

const cookieOf = (res: { headers: Record<string, string | string[]> }) => {
  const v = res.headers['Set-Cookie'];
  return (Array.isArray(v) ? v[0] : v) ?? '';
};
const tokenOf = (res: { headers: Record<string, string | string[]> }) => /homeos_key=([^;]*)/.exec(cookieOf(res))?.[1] ?? '';
const getsOf = (h: Harness) => (h.blobs as MemoryBlobStore).calls.get;
const putsOf = (h: Harness) => (h.blobs as MemoryBlobStore).calls.put;
const storedDoc = (h: Harness) => parseServerDoc((h.blobs as MemoryBlobStore).peek('homeos/test/home.json')!.body);

describe('who may make a code', () => {
  it('never for someone who has joined and is signed in elsewhere: Shea can’t sign in as Stratis, nor he as her', async () => {
    const h = createHarness();
    const home = await online(h);
    const { shea } = await sheaJoins(h, home);
    const forStratis = await call(shea, 'createCode', { memberId: home.person('Stratis').id });
    expect([forStratis.status, forStratis.json.error.code]).toEqual([403, 'forbidden']);
    const forShea = await call(home.stratis, 'createCode', { memberId: home.person('Shea').id });
    expect([forShea.status, forShea.json.error.code]).toEqual([403, 'forbidden']);
    // Each may add a device of their own, and anyone may invite someone who has not joined.
    expect((await call(shea, 'createCode', { memberId: home.person('Shea').id })).status).toBe(200);
    expect((await call(home.stratis, 'createCode', { memberId: home.person('Stratis').id })).status).toBe(200);
    const added = (await rpc(shea, 'addPerson', [home.hid, { name: 'Robin', emoji: '🦉', email: '' }])).json.result;
    expect((await call(shea, 'createCode', { memberId: added.id })).status).toBe(200);
    // Shea lost her phone: once Stratis removes it from her page, he can send her a new code.
    const devices = (await call(home.stratis, 'devices')).json.devices as { id: string; memberId: string }[];
    const hers = devices.filter((d) => d.memberId === home.person('Shea').id);
    for (const d of hers) expect((await call(home.stratis, 'removeDevice', { deviceId: d.id })).status).toBe(200);
    const fresh = (await call(home.stratis, 'createCode', { memberId: home.person('Shea').id })).json.code;
    const newPhone = h.browser();
    const back = await call(newPhone, 'redeem', { code: fresh });
    expect([back.status, back.json.user.name, back.json.entry.status]).toEqual([200, 'Shea', 'member']);
  });

  it('keeps a code working when another is made for the same person (Invite tapped twice)', async () => {
    const h = createHarness();
    const home = await online(h);
    const first = (await call(home.stratis, 'createCode', { memberId: home.person('Shea').id })).json.code;
    const second = (await call(home.stratis, 'createCode', { memberId: home.person('Shea').id })).json.code;
    expect(second).not.toBe(first);
    const shea = h.browser();
    expect((await call(shea, 'redeem', { code: first })).json.user.name).toBe('Shea');
    expect((await call(shea, 'session')).status).toBe(200);
    // She has joined: the other code Stratis made for her goes, so nobody else can be her.
    expect((await call(h.browser(), 'redeem', { code: second })).json.error.code).toBe('invalid_code');
    // "Add another device" twice: both codes work.
    const ipad = (await call(home.stratis, 'createCode', { memberId: home.person('Stratis').id })).json.code;
    const app = (await call(home.stratis, 'createCode', { memberId: home.person('Stratis').id })).json.code;
    expect((await call(h.browser(), 'redeem', { code: ipad })).status).toBe(200);
    expect((await call(h.browser(), 'redeem', { code: app })).status).toBe(200);
  });
});

describe('guessing codes', () => {
  it('limits a burst of codes sent all at once from one address like the same codes one after another, without a write', async () => {
    const h = createHarness();
    const home = await online(h);
    const live = (await call(home.stratis, 'createCode', { memberId: home.person('Shea').id })).json.code as string;
    h.clock.advance(5000);
    const A = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    const guesses = Array.from({ length: 200 }, (_, i) => {
      let s = '';
      let n = i + 1;
      for (let k = 0; k < 8; k++) {
        s += A[n & 31];
        n >>= 5;
      }
      return s;
    });
    guesses[150] = live;
    const writes = vi.spyOn(h.ctx.store, 'write');
    const puts = putsOf(h);
    const results = await Promise.all(guesses.map((code) => h.request({ method: 'POST', json: { op: 'redeem', code }, ip: '203.0.113.7' })));
    const codes = results.map((r) => JSON.parse(r.body).error?.code ?? 'signed in');
    // perIp (10) were looked at; everything else waited without being tried.
    expect(codes.filter((c) => c === 'invalid_code')).toHaveLength(10);
    expect(codes.filter((c) => c === 'too_many_attempts')).toHaveLength(190);
    expect(codes[150]).toBe('too_many_attempts');
    // A wrong code never reaches the write queue, so it can't hold up anyone's change.
    expect(writes).not.toHaveBeenCalled();
    expect(putsOf(h)).toBe(puts);
  });

  it('never locks the household out because a stranger is guessing from many addresses', async () => {
    const h = createHarness();
    const home = await online(h);
    for (let ip = 0; ip < 10; ip++) {
      for (let i = 0; i < 10; i++) await h.request({ method: 'POST', json: { op: 'redeem', code: 'ZZZZ-ZZZZ' }, ip: `198.51.100.${ip}` });
    }
    const code = (await call(home.stratis, 'createCode', { memberId: home.person('Shea').id })).json.code;
    const shea = h.browser({ ip: '192.0.2.10' });
    expect((await call(shea, 'redeem', { code })).status).toBe(200);
  });

  it('counts an IPv6 guesser by its /64', async () => {
    const h = createHarness();
    await online(h);
    for (let i = 1; i <= 10; i++) {
      await h.request({ method: 'POST', json: { op: 'redeem', code: 'ZZZZ-ZZZZ' }, ip: `2001:db8:5:6::${i.toString(16)}` });
    }
    const next = await h.request({ method: 'POST', json: { op: 'redeem', code: 'ZZZZ-ZZZZ' }, ip: '2001:db8:5:6:ffff::1' });
    expect(JSON.parse(next.body).error.code).toBe('too_many_attempts');
  });

  it('does not count a phone’s old key against codes from the same Wi-Fi', async () => {
    const h = createHarness();
    const home = await online(h);
    for (let i = 0; i < 20; i++) {
      h.clock.advance(61_000);
      await h.request({ method: 'GET', url: `${API_PATH}?op=version`, headers: { authorization: `Bearer ${'B'.repeat(43)}` }, ip: '192.0.2.10' });
    }
    const code = (await call(home.stratis, 'createCode', { memberId: home.person('Shea').id })).json.code;
    expect((await h.request({ method: 'POST', json: { op: 'redeem', code }, ip: '192.0.2.10' })).status).toBe(200);
  });
});

describe('a device another instance signed in a moment ago', () => {
  async function twoInstances(opts: Parameters<typeof createHarness>[0] = {}) {
    const h = createHarness(opts);
    const home = await online(h); // instance A: h.ctx
    const B = h.instance();
    const code = (await call(home.stratis, 'createCode', { memberId: home.person('Shea').id })).json.code as string;
    return { h, home, B, code };
  }

  it('is signed in on the other instance at once, even when that one checked its copy just now', async () => {
    const { h, B, code } = await twoInstances();
    h.clock.advance(11_000);
    await h.request({ method: 'GET', url: `${API_PATH}?op=status` });
    await h.request({ method: 'POST', json: { op: 'rpc', method: 'getMyHouseholdId', args: [] }, headers: { authorization: 'Bearer x' } });
    h.clock.advance(500);
    const redeemed = await h.request({ method: 'POST', json: { op: 'redeem', code } }, B);
    expect(redeemed.status).toBe(200);
    const token = tokenOf(redeemed);
    h.clock.advance(300);
    for (const req of [
      { method: 'GET', url: `${API_PATH}?op=session` },
      { method: 'POST', json: { op: 'rpc', method: 'getMyHouseholdId', args: [], minRev: JSON.parse(redeemed.body).rev } },
    ]) {
      const res = await h.request({ ...req, headers: { cookie: `homeos_key=${token}` } });
      expect(res.status).toBe(200);
      expect(cookieOf(res)).not.toMatch(/Max-Age=0/);
    }
  });

  it('is signed in on the other instance while a stranger has tripped its limits', async () => {
    const { h, B, code } = await twoInstances();
    for (let ip = 0; ip < 5; ip++) {
      for (let i = 0; i < 10; i++) await h.request({ method: 'POST', json: { op: 'redeem', code: 'ZZZZ-ZZZZ' }, ip: `198.51.100.${ip}` });
    }
    const redeemed = await h.request({ method: 'POST', json: { op: 'redeem', code } }, B);
    const res = await h.request({ method: 'GET', url: `${API_PATH}?op=version`, headers: { cookie: `homeos_key=${tokenOf(redeemed)}` } });
    expect(res.status).toBe(200);
  });

  it('is signed in on the other instance when reads are under budget pressure, even at the ceiling', async () => {
    for (const reads of ['60', '30', '24']) {
      const { h, B, code } = await twoInstances({ env: { HOMEOS_BLOB_READS_PER_MONTH: reads, HOMEOS_BLOB_WRITES_PER_MONTH: '0' } });
      // Instance A has read enough to be at level 1 or 2, or at the ceiling.
      for (let i = 0; i < 20; i++) await h.ctx.store.read({ maxAgeMs: 0 });
      const redeemed = await h.request({ method: 'POST', json: { op: 'redeem', code } }, B);
      expect(redeemed.status).toBe(200);
      const res = await h.request({ method: 'GET', url: `${API_PATH}?op=version`, headers: { cookie: `homeos_key=${tokenOf(redeemed)}` } });
      expect([reads, res.status]).toEqual([reads, 200]);
    }
  });

  it('finds a code made on another instance a moment ago, under budget pressure too', async () => {
    const h = createHarness({ env: { HOMEOS_BLOB_READS_PER_MONTH: '60' } });
    const home = await online(h);
    const B = h.instance();
    for (let i = 0; i < 40; i++) await B.store.read({ maxAgeMs: 0 });
    expect(B.store.pressure().freshMs).toBeGreaterThan(10_000);
    h.clock.advance(1000);
    const code = (await call(home.stratis, 'createCode', { memberId: home.person('Shea').id })).json.code;
    const res = await h.request({ method: 'POST', json: { op: 'redeem', code } }, B);
    expect(res.status).toBe(200);
  });

  it('signs out (and clears the cookie) only when a copy new enough says so', async () => {
    const h = createHarness();
    const home = await online(h);
    const { shea } = await sheaJoins(h, home);
    const token = shea.key()!;
    // A token this home never signed: out, with no read of the store.
    const gets = getsOf(h);
    // A made-up key with Shea's device id, a later rev and a made-up signature.
    const [, deviceId] = token.split('.');
    const forged = `${'K'.repeat(43)}.${deviceId}.999.${'A'.repeat(22)}`;
    const res = await h.request({ method: 'GET', url: `${API_PATH}?op=version`, headers: { cookie: `homeos_key=${forged}` } });
    expect([res.status, cookieOf(res)]).toEqual([401, 'homeos_key=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0; Secure']);
    expect(getsOf(h)).toBe(gets);
    // Removed on another instance whose change this one has not read yet: out once its copy has it.
    const B = h.instance();
    const sheas = ((await call(home.stratis, 'devices')).json.devices as { id: string; memberId: string }[]).find(
      (d) => d.memberId === home.person('Shea').id,
    )!;
    expect((await h.request({ method: 'POST', json: { op: 'removeDevice', deviceId: sheas.id }, headers: { authorization: `Bearer ${home.stratis.key()}` } }, B)).status).toBe(200);
    h.clock.advance(10_001);
    const gone = await h.request({ method: 'GET', url: `${API_PATH}?op=version`, headers: { cookie: `homeos_key=${token}` } });
    expect([gone.status, cookieOf(gone)]).toEqual([401, 'homeos_key=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0; Secure']);
  });

  it('says “try again” instead of signing out when it can’t tell (no copy of the home yet)', async () => {
    const h = createHarness();
    const A = h.ctx;
    // Instance A looked a moment ago: no home online.
    await h.request({ method: 'GET', url: `${API_PATH}?op=status` });
    // The home comes online on instance B; the owner's next request reaches A.
    const B = h.instance();
    const setup = await h.request({ method: 'POST', json: { op: 'setup', code: TEST_SETUP_CODE, phone: PHONE } }, B);
    const token = tokenOf(setup);
    const res = await h.request({ method: 'GET', url: `${API_PATH}?op=session`, headers: { cookie: `homeos_key=${token}` } }, A);
    expect([res.status, JSON.parse(res.body).error.code]).toEqual([503, 'unavailable']);
    expect(cookieOf(res)).toBe('');
    h.clock.advance(2001);
    expect((await h.request({ method: 'GET', url: `${API_PATH}?op=session`, headers: { cookie: `homeos_key=${token}` } }, A)).status).toBe(200);
  });

  it('removes a device another instance signed in a moment ago (not a 404)', async () => {
    const { h, home, B, code } = await twoInstances();
    await h.request({ method: 'GET', url: `${API_PATH}?op=status` });
    const redeemed = await h.request({ method: 'POST', json: { op: 'redeem', code } }, B);
    const deviceId = JSON.parse(redeemed.body).device.id;
    expect((await call(home.stratis, 'removeDevice', { deviceId })).status).toBe(200);
  });

  it('lets a removed device read on an instance that has not seen the removal for at most freshMs (a known limit)', async () => {
    const { h, home, B, code } = await twoInstances();
    const shea = h.browser({ ctx: B });
    const sheaId = (await call(shea, 'redeem', { code })).json.device.id;
    await call(shea, 'session');
    await call(home.stratis, 'removeDevice', { deviceId: sheaId });
    h.clock.advance(5000);
    expect((await call(shea, 'version')).status).toBe(200);
    h.clock.advance(5001);
    expect((await call(shea, 'version')).status).toBe(401);
  });
});

describe('the Blob read budget', () => {
  it('answers status from memory once a home is known: a stranger polling it costs no reads', async () => {
    const h = createHarness();
    await online(h);
    const other = h.instance();
    const gets = getsOf(h);
    for (let i = 0; i < 1000; i++) {
      h.clock.advance(20_000);
      const res = await h.request({ method: 'GET', url: `${API_PATH}?op=status` }, other);
      expect(JSON.parse(res.body)).toEqual({ home: true, google: false });
    }
    expect(getsOf(h) - gets).toBe(1);
  });

  it('before setup, asks the store at most every 30 s for status', async () => {
    const h = createHarness();
    for (let i = 0; i < 60; i++) {
      h.clock.advance(1000);
      await h.request({ method: 'GET', url: `${API_PATH}?op=status` });
    }
    expect(getsOf(h)).toBeLessThanOrEqual(2);
  });

  it('reads at most once a second for a rev nobody stored (minRev), never twice a request', async () => {
    const h = createHarness();
    const home = await online(h);
    h.clock.advance(1000);
    const gets = getsOf(h);
    for (let i = 0; i < 10; i++) await rpc(home.stratis, 'getMyHouseholdId', [], 999);
    expect(getsOf(h) - gets).toBe(1);
    h.clock.advance(1000);
    await rpc(home.stratis, 'getMyHouseholdId', [], 999);
    expect(getsOf(h) - gets).toBe(2);
  });

  it('stores its read count every 50 reads, so an instance that goes away loses few (no new rev)', async () => {
    const h = createHarness();
    const home = await online(h);
    const before = storedDoc(h);
    const other = h.instance();
    for (let i = 0; i < 60; i++) {
      h.clock.advance(10_001);
      await h.request({ method: 'GET', url: `${API_PATH}?op=version`, headers: { authorization: `Bearer ${home.stratis.key()}` } }, other);
    }
    const after = storedDoc(h);
    expect(after.meta.usage.reads - before.meta.usage.reads).toBeGreaterThanOrEqual(50);
    expect(after.rev).toBe(before.rev);
  });

  it('stops reading at the ceiling: polls, sign-in checks and status come from the copy', async () => {
    const h = createHarness({ env: { HOMEOS_BLOB_READS_PER_MONTH: '20' } });
    const home = await online(h);
    for (let i = 0; i < 20; i++) await h.ctx.store.read({ maxAgeMs: 0 });
    expect(h.ctx.store.pressure().ceiling).toBe(true);
    const gets = getsOf(h);
    for (let i = 0; i < 100; i++) {
      h.clock.advance(60_000);
      expect((await call(home.stratis, 'version')).json.pollMs).toBe(60_000);
      await h.request({ method: 'GET', url: `${API_PATH}?op=status` });
      await h.request({ method: 'POST', json: { op: 'redeem', code: 'ZZZZ-ZZZZ' }, ip: `198.51.100.${i}` });
      await h.request({ method: 'GET', url: `${API_PATH}?op=version`, headers: { authorization: `Bearer ${'C'.repeat(43)}` }, ip: `198.51.100.${i}` });
    }
    expect(getsOf(h)).toBe(gets);
    // Writes still work (and still check for conflicts).
    expect((await rpc(home.stratis, 'createArea', [home.hid, 'Garage'])).status).toBe(200);
  });
});

describe('a reply that was lost', () => {
  it('lets “Bring It Online” be tapped again: the owner gets in, and the home is not built twice', async () => {
    const h = createHarness();
    const lost = await h.request({ method: 'POST', json: { op: 'setup', code: TEST_SETUP_CODE, phone: PHONE } });
    expect(lost.status).toBe(200);
    const built = storedDoc(h);
    // The phone never saw that reply, so it never used the key; it taps again.
    const stratis = h.browser();
    const again = await call(stratis, 'setup', { code: TEST_SETUP_CODE, phone: PHONE });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ user: { name: 'Stratis' }, entry: { status: 'member', householdId: JSON.parse(lost.body).entry.householdId } });
    const after = storedDoc(h);
    expect(after.home.items.map((i) => i.id)).toEqual(built.home.items.map((i) => i.id));
    expect(after.auth.devices).toHaveLength(1);
    // The lost key is no good any more; the new one is.
    expect((await h.request({ method: 'GET', url: `${API_PATH}?op=session`, headers: { cookie: `homeos_key=${tokenOf(lost)}` } })).status).toBe(401);
    expect((await call(stratis, 'session')).status).toBe(200);
    // Once the owner has used the home, the setup code does nothing.
    const late = await call(h.browser(), 'setup', { code: TEST_SETUP_CODE, phone: PHONE });
    expect([late.status, late.json.error.code]).toEqual([409, 'home_exists']);
  });

  it('lets a code be entered again when the first reply was lost: same person, same welcome', async () => {
    const h = createHarness();
    const home = await online(h);
    const code = (await call(home.stratis, 'createCode', { memberId: home.person('Shea').id })).json.code;
    const lost = await h.request({ method: 'POST', json: { op: 'redeem', code } });
    expect(JSON.parse(lost.body).entry.status).toBe('claimed');
    const shea = h.browser();
    const again = await call(shea, 'redeem', { code });
    expect([again.status, again.json.entry.status, again.json.user.name]).toEqual([200, 'claimed', 'Shea']);
    expect((await call(shea, 'session')).status).toBe(200);
    expect((await call(h.browser(), 'redeem', { code })).json.error.code).toBe('invalid_code');
  });
});

describe('the size of the home', () => {
  it('puts at most 25 writes in one put', async () => {
    const h = createHarness();
    const home = await online(h);
    const puts = putsOf(h);
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => rpc(home.stratis, 'createArea', [home.hid, `Room ${i}`])));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(putsOf(h) - puts).toBeGreaterThanOrEqual(3);
  });

  it('refuses a change that grows the home past its size or row limits; one that shrinks it still works', async () => {
    const h = createHarness();
    const home = await online(h);
    // A home already holding the most areas it may.
    await h.ctx.store.write((doc) => {
      const base = doc.home.areas[0];
      const more = Array.from({ length: 200 - doc.home.areas.length }, (_, i) => ({ ...base, id: `extra-${i}`, name: `Extra ${i}`, position: 100 + i }));
      doc.home = { ...doc.home, areas: [...doc.home.areas, ...more] };
    });
    const full = await rpc(home.stratis, 'createArea', [home.hid, 'One more']);
    expect([full.status, full.json.error.code]).toEqual([413, 'too_large']);
    expect((await rpc(home.stratis, 'deleteArea', ['extra-0'])).status).toBe(200);
    // A home near its size (here filled by messages from when there was a chat, which count
    // too): a long note that would take it past the limit is refused.
    await h.ctx.store.write((doc) => {
      const filler = { id: 'filler', household_id: home.hid, member_id: home.person('Stratis').id, body: 'x'.repeat(4 * 1024 * 1024 - 60_000), created_at: new Date(h.clock.now).toISOString() };
      doc.home = { ...doc.home, messages: [filler] } as typeof doc.home;
    });
    const areaId = (await home.load()).areas[0].id;
    const withNote = (note: string) => ({ ...newItemDraft(areaId), title: 'Long note', note });
    const big = await rpc(home.stratis, 'createItem', [home.hid, withNote('y'.repeat(3900))]);
    const sent = await rpc(home.stratis, 'createItem', [home.hid, withNote('Hello')]);
    expect(sent.status).toBe(200);
    for (let i = 0; i < 20 && big.status === 200; i++) {
      const more = await rpc(home.stratis, 'createItem', [home.hid, withNote('y'.repeat(3900))]);
      if (more.status !== 200) {
        expect([more.status, more.json.error.code]).toEqual([413, 'too_large']);
        return;
      }
    }
    expect([big.status, big.json.error?.code]).toEqual([413, 'too_large']);
  });
});

describe('device labels', () => {
  it('tells the Home Screen app from Safari on the same iPhone', async () => {
    const h = createHarness();
    const home = await online(h);
    const code = (await call(home.stratis, 'createCode', { memberId: home.person('Stratis').id })).json.code;
    const app = h.browser();
    const res = await call(app, 'redeem', { code, app: 'standalone' });
    expect(res.json.device.label).toBe('iPhone · Home Screen app');
    expect(((await call(home.stratis, 'devices')).json.devices as { label: string }[]).map((d) => d.label)).toEqual([
      'iPhone · Safari',
      'iPhone · Home Screen app',
    ]);
  });
});
