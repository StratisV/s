// The public goals link in server mode (docs/ARCHITECTURE.md "Goals for the week"): goals
// written through the RPCs as the signed-in person, and GET ?op=publicGoals for anyone, with
// no sign-in and no X-HomeOS header, answering only the public fields, cached at the edge.

import { describe, expect, it } from 'vitest';
import { ServerBackend } from '../../src/lib/backend/server';
import { API_PATH, PUBLIC_GOALS_CACHE } from '../../src/lib/backend/serverApi';
import { USER_DEMO_DOC } from '../../src/lib/logic/importHome.fixture';
import type { Goal, GoalsLink, HouseholdData } from '../../src/lib/types';
import { createHarness, TEST_SETUP_CODE, type Browser, type Harness } from '../testing/harness';

const PHONE = JSON.stringify(USER_DEMO_DOC);
/** Fri 9 Oct 2026 (the harness's start): this week is 5 to 11 Oct. */
const THIS = '2026-10-05';

async function post(browser: Browser, op: string, body: Record<string, unknown>) {
  const res = await browser.fetch(API_PATH, {
    method: 'POST',
    headers: { 'X-HomeOS': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, ...body }),
  });
  return { status: res.status, json: (await res.json()) as any };
}
const rpc = async (browser: Browser, method: string, args: unknown[]) => {
  const res = await post(browser, 'rpc', { method, args });
  if (res.status !== 200) throw new Error(`${method}: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.result;
};

/** Stratis brings the user's home online; Shea joins with a code. */
async function online(h: Harness) {
  const stratis = h.browser();
  const setup = await post(stratis, 'setup', { code: TEST_SETUP_CODE, phone: PHONE });
  expect(setup.status).toBe(200);
  const hid: string = setup.json.entry.householdId;
  const data: HouseholdData = await rpc(stratis, 'load', [hid]);
  const person = (name: string) => data.members.find((m) => m.name === name)!;
  const code = (await post(stratis, 'createCode', { memberId: person('Shea').id })).json.code as string;
  const shea = h.browser();
  expect((await post(shea, 'redeem', { code })).status).toBe(200);
  return { stratis, shea, hid, person };
}

/** GET ?op=publicGoals as a stranger's browser would: no X-HomeOS header, no cookie. */
const publicGet = (h: Harness, token: string, extra: Record<string, string> = {}) =>
  h.request({ method: 'GET', url: `${API_PATH}?op=publicGoals&token=${encodeURIComponent(token)}`, headers: { 'x-homeos': undefined, ...extra } });

describe('goals through the RPCs', () => {
  it('two phones edit the same week; everyone sees one list', async () => {
    const h = createHarness();
    const { stratis, shea, hid, person } = await online(h);
    const a: Goal = await rpc(stratis, 'addGoal', [hid, THIS, 'Book the boiler service']);
    const b: Goal = await rpc(shea, 'addGoal', [hid, THIS, 'Deep clean the fridge', person('Shea').id]);
    await rpc(shea, 'renameGoal', [a.id, 'Book the boiler service for Friday']);
    await rpc(stratis, 'setGoalDone', [b.id, true]);
    await rpc(shea, 'moveGoal', [b.id, 0]);
    const list = ((await rpc(stratis, 'load', [hid])) as HouseholdData).goals.list;
    expect(list.map((g) => [g.title, g.position, g.done])).toEqual([
      ['Deep clean the fridge', 0, true],
      ['Book the boiler service for Friday', 1, false],
    ]);
    expect(list[0].done_by).toBe(person('Stratis').id);
    expect(list[0].created_by).toBe(person('Shea').id);
  });

  it('checks the arguments before DemoBackend runs, and refuses a week that is not a Monday', async () => {
    const h = createHarness();
    const { stratis, hid } = await online(h);
    expect((await post(stratis, 'rpc', { method: 'addGoal', args: [hid, 'Monday', 'x'] })).json.error.message).toBe('invalid_input: args[1]');
    expect((await post(stratis, 'rpc', { method: 'moveGoal', args: ['g', -1] })).json.error.message).toBe('invalid_input: args[1]');
    expect((await post(stratis, 'rpc', { method: 'addGoal', args: [hid, '2026-10-06', 'Tuesday'] })).json.error.message).toBe('invalid_input: week');
  });
});

describe('GET ?op=publicGoals', () => {
  async function shared(h: Harness) {
    const home = await online(h);
    const { stratis, hid, person } = home;
    await rpc(stratis, 'addGoal', [hid, THIS, 'Plan Saturday dinner']);
    const fridge: Goal = await rpc(stratis, 'addGoal', [hid, THIS, 'Deep clean the fridge', person('Shea').id]);
    await rpc(stratis, 'setGoalDone', [fridge.id, true]);
    await rpc(stratis, 'addGoal', [hid, '2026-09-28', 'Last week secret']);
    const link: GoalsLink = await rpc(stratis, 'goalsLink', [hid]);
    return { ...home, link, fridge };
  }

  it('answers anyone, without sign-in or the X-HomeOS header, with only the public fields, cached at the edge', async () => {
    const h = createHarness();
    const { link, hid, fridge, person } = await shared(h);
    const res = await publicGet(h, link.token);
    expect(res.status).toBe(200);
    expect(res.headers['Cache-Control']).toBe(PUBLIC_GOALS_CACHE);
    expect(res.headers['Cache-Control']).toMatch(/^public, .*s-maxage=60, stale-while-revalidate=\d+$/);
    expect(res.headers['Set-Cookie']).toBeUndefined();
    expect(JSON.parse(res.body)).toEqual({
      week: THIS,
      goals: [
        { title: 'Plan Saturday dinner', done: false, person: null },
        { title: 'Deep clean the fridge', done: true, person: { name: 'Shea', emoji: person('Shea').emoji } },
      ],
    });
    // Nothing private: no ids, no address, no emails, no other week, no one not on a goal.
    for (const leak of [hid, fridge.id, person('Shea').id, person('Stratis').id, 'Stratis', 'Ela', 'secret', 'Alderbrook', '@', 'token', link.token]) {
      expect(res.body).not.toContain(leak);
    }
  });

  it('is the same for a signed-in browser (its cookie is not needed, and changes nothing)', async () => {
    const h = createHarness();
    const { link, stratis } = await shared(h);
    const anon = await publicGet(h, link.token);
    const res = await stratis.fetch(`${API_PATH}?op=publicGoals&token=${link.token}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(anon.body);
  });

  it('a ServerBackend signed out reads it too (and null for a link that is off)', async () => {
    const h = createHarness();
    const { link, stratis, hid } = await shared(h);
    const stranger = h.browser();
    const backend = new ServerBackend({ fetch: stranger.fetch, appUrl: 'https://home-os.example/' });
    expect((await backend.publicGoals(link.token))!.goals).toHaveLength(2);
    expect(await backend.publicGoals('not a token')).toBeNull();
    await rpc(stratis, 'stopGoalsLink', [hid]);
    expect(await backend.publicGoals(link.token)).toBeNull();
  });

  it('404s, never cached, for an unknown token, a turned-off one, one not shaped like a token, or no home', async () => {
    const h = createHarness();
    expect((await publicGet(h, 'A'.repeat(22))).status).toBe(404);
    const { link, stratis, hid } = await shared(h);
    const other = link.token.startsWith('A') ? `B${link.token.slice(1)}` : `A${link.token.slice(1)}`;
    for (const token of [other, '', 'short', `${link.token}x`, link.token.slice(1), `${link.token.slice(0, 21)}=`]) {
      const res = await publicGet(h, token);
      expect(res.status, token).toBe(404);
      expect(JSON.parse(res.body)).toEqual({ error: { code: 'not_found', message: 'This link is no longer active' } });
      expect(res.headers['Cache-Control']).toBe('no-store');
    }
    expect((await publicGet(h, link.token)).status).toBe(200);
    await rpc(stratis, 'stopGoalsLink', [hid]);
    const off = await publicGet(h, link.token);
    expect(off.status).toBe(404);
    expect(off.headers['Cache-Control']).toBe('no-store');
    // A new link: a new token; the old one stays off.
    const next: GoalsLink = await rpc(stratis, 'goalsLink', [hid]);
    expect(next.token).not.toBe(link.token);
    expect((await publicGet(h, next.token)).status).toBe(200);
    expect((await publicGet(h, link.token)).status).toBe(404);
  });

  it('a malformed token is refused without reading the store', async () => {
    let gets = 0;
    const h = createHarness();
    const blobs = h.blobs;
    const get = blobs.get.bind(blobs);
    blobs.get = (...args: Parameters<typeof blobs.get>) => {
      gets += 1;
      return get(...args);
    };
    expect((await publicGet(h, '../../etc')).status).toBe(404);
    expect(gets).toBe(0);
  });

  it('is only a GET of its own: other methods go through the usual checks', async () => {
    const h = createHarness();
    const { link } = await shared(h);
    const post = await h.request({ method: 'POST', url: `${API_PATH}?op=publicGoals&token=${link.token}`, headers: { 'x-homeos': undefined } });
    expect(post.status).toBe(403);
    const asOp = await h.request({ method: 'POST', json: { op: 'publicGoals', token: link.token } });
    expect(asOp.status).toBe(400);
  });

  it('follows the household’s week: a new week shows its own goals', async () => {
    const h = createHarness();
    const { link, stratis, hid } = await shared(h);
    await rpc(stratis, 'addGoal', [hid, '2026-10-12', 'Next week']);
    // Sunday 11 Oct, 23:59 in London: still this week.
    h.clock.now = Date.parse('2026-10-11T22:59:00Z');
    expect(JSON.parse((await publicGet(h, link.token)).body).week).toBe(THIS);
    h.clock.now = Date.parse('2026-10-11T23:00:00Z');
    expect(JSON.parse((await publicGet(h, link.token)).body)).toEqual({ week: '2026-10-12', goals: [{ title: 'Next week', done: false, person: null }] });
  });
});
