// Goals for the week in the demo backend (the server runs the same code): the contract in
// src/lib/backend/types.ts and docs/ARCHITECTURE.md "Goals for the week". The database tests
// (supabase/tests/goals.test.mjs) hold the Supabase side to the same rules.

import { beforeEach, describe, expect, it } from 'vitest';
import { GOALS_DEMO, GOALS_PER_WEEK_MAX } from '../constants';
import { goalsOf } from '../logic/goals';
import { seedItemsFor } from '../logic/items';
import type { AuthUser, CreateHouseholdInput, Goal } from '../types';
import { DEMO_STORAGE_KEY, DemoBackend, publicGoalsFor, type DemoBackendOptions, type DemoDoc, type StorageLike } from './demo';
import { BackendError } from './types';

class MemStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const BOB: AuthUser = { id: 'user-bob', email: 'bob@example.com', name: 'Bob' };
const CAROL: AuthUser = { id: 'user-carol', email: 'carol@example.com', name: 'Carol' };
/** Thu 8 Oct 2026, 10:30 in London: this week is 5 to 11 Oct. */
const THIS = '2026-10-05';
const LAST = '2026-09-28';
const NEXT = '2026-10-12';

let storage: MemStorage;
let clock: Date;

function make(opts: DemoBackendOptions = {}) {
  return new DemoBackend({ storage, now: () => clock, search: '', latency: 0, ...opts });
}

function input(over: Partial<CreateHouseholdInput> = {}): CreateHouseholdInput {
  const areas = ['Kitchen', 'Garden'];
  return { name: 'Flat 2', address: '1 Test Street', timezone: 'Europe/London', memberName: 'Stratis Vlachos', memberEmoji: '🦔', areas, items: seedItemsFor(areas), ...over };
}

const stored = (): DemoDoc => JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
const save = (doc: DemoDoc) => storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(doc));

/** Stratis's household with the demo's goals taken out, so each test starts from none. */
async function setup() {
  const b = make();
  await b.signInWithGoogle();
  const hid = await b.createHousehold(input());
  const doc = stored();
  doc.goals = [];
  save(doc);
  const data = await b.load(hid);
  return { b, hid, data, me: data.members[0], shea: data.members[1] };
}

/** Bob joins; the shared document is then signed in as Bob until `b.signInWithGoogle()`. */
async function joinBob(b: DemoBackend) {
  const token = await b.createInvite();
  const bob = make({ user: BOB });
  await bob.signInWithGoogle();
  await bob.joinHousehold({ token, memberName: 'Bob', memberEmoji: '🐻' });
  return bob;
}

async function rejectsWith(p: Promise<unknown>, code: string, message?: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BackendError);
  expect((err as BackendError).code).toBe(code);
  if (message) expect((err as BackendError).message).toMatch(message);
}

const titles = (list: Goal[], week = THIS) => goalsOf(list, week).map((g) => g.title);

beforeEach(() => {
  storage = new MemStorage();
  clock = new Date('2026-10-08T09:30:00Z');
});

describe('the demo seed', () => {
  it('gives every new household last week’s goals and this week’s, half done, one brought over', async () => {
    const b = make();
    await b.signInWithGoogle();
    const hid = await b.createHousehold(input());
    const { goals, members } = await b.load(hid);
    const [me, shea, ela] = members;
    const byKey = { me, shea, ela };
    expect(goals.link).toBeNull();
    for (const [weeksBack, week] of [
      [1, LAST],
      [0, THIS],
    ] as const) {
      const seeds = GOALS_DEMO.filter((s) => s.weeksBack === weeksBack);
      const list = goalsOf(goals.list, week);
      expect(list.map((g) => g.title)).toEqual(seeds.map((s) => s.title));
      expect(list.map((g) => g.position)).toEqual(seeds.map((_, i) => i));
      list.forEach((g, i) => {
        const seed = seeds[i];
        expect(g.member_id).toBe(seed.who ? byKey[seed.who].id : null);
        expect(g.done).toBe(!!seed.done);
        expect(g.done_by).toBe(seed.done ? byKey[seed.done.by].id : null);
        if (g.done_at) {
          // Within its week (London time), and in the past.
          expect(new Date(g.done_at).getTime()).toBeLessThanOrEqual(clock.getTime());
          expect(new Date(g.done_at).getTime()).toBeGreaterThanOrEqual(new Date(`${week}T00:00:00+01:00`).getTime());
        }
        expect(new Date(g.created_at).getTime()).toBeLessThanOrEqual(clock.getTime());
      });
    }
    const rota = goalsOf(goals.list, THIS)[0];
    const lastRota = goalsOf(goals.list, LAST).find((g) => g.title === rota.title)!;
    expect(rota.carried_from).toBe(lastRota.id);
    expect(lastRota.done).toBe(false);
  });

  it('a Monday just after midnight: nothing in the future, nothing before the week began', async () => {
    clock = new Date('2026-10-04T23:05:00Z'); // Mon 5 Oct, 00:05 in London
    const b = make();
    await b.signInWithGoogle();
    const hid = await b.createHousehold(input());
    const { goals } = await b.load(hid);
    for (const g of goalsOf(goals.list, THIS)) {
      for (const at of [g.created_at, g.done_at]) {
        if (!at) continue;
        expect(new Date(at).getTime()).toBeLessThanOrEqual(clock.getTime());
        expect(new Date(at).getTime()).toBeGreaterThanOrEqual(new Date('2026-10-04T23:00:00Z').getTime());
      }
    }
  });
});

describe('a week of goals', () => {
  it('anyone at home adds one: trimmed, last, not done, who added it; it loads with the household', async () => {
    const { b, hid, me, shea } = await setup();
    const a = await b.addGoal(hid, THIS, '  Book the boiler service ');
    const c = await b.addGoal(hid, THIS, 'Fix the bike lights', shea.id);
    expect(a).toMatchObject({ household_id: hid, week: THIS, title: 'Book the boiler service', member_id: null, position: 0, done: false, done_by: null, done_at: null, carried_from: null, created_by: me.id });
    expect(c).toMatchObject({ position: 1, member_id: shea.id });
    expect(a.created_at).toBe(clock.toISOString());
    const bob = await joinBob(b);
    const loaded = await bob.load(hid);
    expect(titles(loaded.goals.list)).toEqual(['Book the boiler service', 'Fix the bike lights']);
    // Bob adds to the same week; Stratis sees it.
    const bobs = await bob.addGoal(hid, THIS, 'Bob’s goal');
    expect(bobs.created_by).toBe(loaded.members.find((m) => m.user_id === BOB.id)!.id);
    await b.signInWithGoogle();
    expect(titles((await b.load(hid)).goals.list)).toEqual(['Book the boiler service', 'Fix the bike lights', 'Bob’s goal']);
  });

  it('refuses a week that is not a Monday, a blank or long title, a person or household from elsewhere', async () => {
    const { b, hid } = await setup();
    await rejectsWith(b.addGoal(hid, '2026-10-06', 'Tuesday'), 'unknown', /^invalid_input: week/);
    await rejectsWith(b.addGoal(hid, 'next week', 'x'), 'unknown', /^invalid_input: week/);
    await rejectsWith(b.addGoal(hid, THIS, '   '), 'unknown', /^invalid_input: title/);
    await rejectsWith(b.addGoal(hid, THIS, 'x'.repeat(121)), 'unknown', /^invalid_input: title/);
    expect((await b.addGoal(hid, THIS, '🦆'.repeat(120))).title).toHaveLength(240);
    await rejectsWith(b.addGoal(hid, THIS, 'Someone', 'm-nobody'), 'not_found');
    await rejectsWith(b.addGoal('h-elsewhere', THIS, 'Elsewhere'), 'not_found');

    // Carol's own home: Stratis's goals and people are not hers.
    const carol = make({ user: CAROL });
    await carol.signInWithGoogle();
    const theirs = await carol.createHousehold(input({ memberName: 'Carol' }));
    await rejectsWith(carol.addGoal(hid, THIS, 'Sneaky'), 'not_found');
    const mine = await carol.load(theirs);
    await b.signInWithGoogle();
    const stratisGoal = await b.addGoal(hid, THIS, 'Mine');
    await rejectsWith(b.addGoal(hid, THIS, 'Hers', mine.members[0].id), 'not_found');
    await carol.signInWithGoogle();
    await rejectsWith(carol.renameGoal(stratisGoal.id, 'Hacked'), 'not_found');
    await rejectsWith(carol.setGoalDone(stratisGoal.id, true), 'not_found');
    await rejectsWith(carol.moveGoal(stratisGoal.id, 0), 'not_found');
    await rejectsWith(carol.deleteGoal(stratisGoal.id), 'not_found');
    await rejectsWith(carol.bringOverGoals(hid, THIS), 'not_found');
    await rejectsWith(carol.goalsLink(hid), 'not_found');
    await rejectsWith(carol.stopGoalsLink(hid), 'not_found');
  });

  it('a week holds GOALS_PER_WEEK_MAX goals; other weeks are their own', async () => {
    const { b, hid } = await setup();
    for (let i = 0; i < GOALS_PER_WEEK_MAX; i++) await b.addGoal(hid, THIS, `Goal ${i}`);
    await rejectsWith(b.addGoal(hid, THIS, 'One more'), 'unknown', /^invalid_input: goals/);
    expect((await b.addGoal(hid, NEXT, 'Next week')).position).toBe(0);
  });

  it('rename, who is on it, and tick and untick with who and when', async () => {
    const { b, hid, me, shea } = await setup();
    const goal = await b.addGoal(hid, THIS, 'Book the boiler');
    await b.renameGoal(goal.id, '  Book the boiler service ');
    await rejectsWith(b.renameGoal(goal.id, ' '), 'unknown', /^invalid_input: title/);
    await b.setGoalPerson(goal.id, shea.id);
    await rejectsWith(b.setGoalPerson(goal.id, 'm-nobody'), 'not_found');
    let [g] = (await b.load(hid)).goals.list;
    expect(g).toMatchObject({ title: 'Book the boiler service', member_id: shea.id });
    await b.setGoalPerson(goal.id, null);

    await b.setGoalDone(goal.id, true);
    [g] = (await b.load(hid)).goals.list;
    expect(g).toMatchObject({ done: true, done_by: me.id, done_at: clock.toISOString(), member_id: null });
    // Ticking again (later, someone else) keeps the stamp.
    const bob = await joinBob(b);
    clock = new Date(clock.getTime() + 60_000);
    await bob.setGoalDone(goal.id, true);
    [g] = (await bob.load(hid)).goals.list;
    expect(g.done_by).toBe(me.id);
    await bob.setGoalDone(goal.id, false);
    [g] = (await bob.load(hid)).goals.list;
    expect(g).toMatchObject({ done: false, done_by: null, done_at: null });
    await rejectsWith(bob.setGoalDone(goal.id, 'yes' as unknown as boolean), 'unknown', /^invalid_input: done/);
  });

  it('moving: one goal to a place, the week closing up; other weeks stay', async () => {
    const { b, hid } = await setup();
    for (const t of ['A', 'B', 'C', 'D']) await b.addGoal(hid, THIS, t);
    await b.addGoal(hid, NEXT, 'Next');
    const id =async (t: string) => (await b.load(hid)).goals.list.find((g) => g.title === t)!.id;
    await b.moveGoal(await id('A'), 2);
    expect(titles((await b.load(hid)).goals.list)).toEqual(['B', 'C', 'A', 'D']);
    await b.moveGoal(await id('D'), 0);
    await b.moveGoal(await id('B'), 99);
    const list = (await b.load(hid)).goals.list;
    expect(titles(list)).toEqual(['D', 'C', 'A', 'B']);
    expect(goalsOf(list, THIS).map((g) => g.position)).toEqual([0, 1, 2, 3]);
    expect(goalsOf(list, NEXT).map((g) => g.position)).toEqual([0]);
    await rejectsWith(b.moveGoal(await id('A'), -1), 'unknown', /^invalid_input: index/);
    await rejectsWith(b.moveGoal(await id('A'), 1.5), 'unknown', /^invalid_input: index/);
    await rejectsWith(b.moveGoal('g-gone', 0), 'not_found');
  });

  it('deleting: the rest close up; a goal brought over from it keeps going', async () => {
    const { b, hid } = await setup();
    const a = await b.addGoal(hid, LAST, 'A');
    await b.bringOverGoals(hid, THIS);
    for (const t of ['B', 'C']) await b.addGoal(hid, THIS, t);
    const [carried] = goalsOf((await b.load(hid)).goals.list, THIS);
    expect(carried.carried_from).toBe(a.id);
    await b.deleteGoal(a.id);
    await b.deleteGoal(goalsOf((await b.load(hid)).goals.list, THIS)[1].id);
    const list = (await b.load(hid)).goals.list;
    expect(titles(list)).toEqual(['A', 'C']);
    expect(goalsOf(list, THIS).map((g) => g.position)).toEqual([0, 1]);
    expect(goalsOf(list, THIS)[0].carried_from).toBeNull();
    await rejectsWith(b.deleteGoal(a.id), 'not_found');
  });

  it('removing a person takes them off goals and ticks; the goals stay', async () => {
    const { b, hid } = await setup();
    const pat = await b.addPerson(hid, { name: 'Pat', emoji: '🦊', email: '' });
    const goal = await b.addGoal(hid, THIS, "Pat's goal", pat.id);
    await b.setGoalDone(goal.id, true);
    await b.removePerson(pat.id);
    const [g] = (await b.load(hid)).goals.list;
    expect(g).toMatchObject({ title: "Pat's goal", member_id: null, done: true });
  });

  it('documents from before goals load with none, and take goals from then on', async () => {
    const { b, hid } = await setup();
    const doc = stored() as Partial<DemoDoc>;
    delete doc.goals;
    delete doc.goal_links;
    save(doc as DemoDoc);
    expect((await b.load(hid)).goals).toEqual({ list: [], link: null });
    expect(await b.publicGoals('A'.repeat(22))).toBeNull();
    await b.addGoal(hid, THIS, 'First');
    expect(stored().goals).toHaveLength(1);
  });
});

describe('Bring over', () => {
  it('brings last week’s unfinished goals in order, each once, with who is on them', async () => {
    const { b, hid, me, shea } = await setup();
    const a = await b.addGoal(hid, LAST, 'Unfinished A', shea.id);
    const done = await b.addGoal(hid, LAST, 'Done B');
    await b.addGoal(hid, LAST, 'Unfinished C');
    await b.setGoalDone(done.id, true);
    await b.addGoal(hid, '2026-09-21', 'Two weeks ago');
    await b.addGoal(hid, THIS, 'Already here');

    const brought = await b.bringOverGoals(hid, THIS);
    expect(brought.map((g) => [g.title, g.position, g.carried_from === a.id])).toEqual([
      ['Unfinished A', 1, true],
      ['Unfinished C', 2, false],
    ]);
    expect(brought[0]).toMatchObject({ week: THIS, member_id: shea.id, done: false, created_by: me.id });
    // A second tap (or another phone) brings nothing more.
    expect(await b.bringOverGoals(hid, THIS)).toEqual([]);
    expect(titles((await b.load(hid)).goals.list)).toEqual(['Already here', 'Unfinished A', 'Unfinished C']);
    await rejectsWith(b.bringOverGoals(hid, '2026-10-07'), 'unknown', /^invalid_input: week/);
  });

  it('a nearly full week brings what fits', async () => {
    const { b, hid } = await setup();
    for (let i = 0; i < GOALS_PER_WEEK_MAX - 1; i++) await b.addGoal(hid, THIS, `Here ${i}`);
    await b.addGoal(hid, LAST, 'A');
    await b.addGoal(hid, LAST, 'B');
    expect((await b.bringOverGoals(hid, THIS)).map((g) => g.title)).toEqual(['A']);
    expect(await b.bringOverGoals(hid, THIS)).toEqual([]);
  });
});

describe('the public link', () => {
  it('one per home: the same link again, off for good, then a new token', async () => {
    const { b, hid, me } = await setup();
    const link = await b.goalsLink(hid);
    expect(link).toEqual({ token: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), created_by: me.id, created_at: clock.toISOString() });
    expect(await b.goalsLink(hid)).toEqual(link);
    expect((await b.load(hid)).goals.link).toEqual(link);
    await b.stopGoalsLink(hid);
    await b.stopGoalsLink(hid);
    expect((await b.load(hid)).goals.link).toBeNull();
    expect(await b.publicGoals(link.token)).toBeNull();
    const next = await b.goalsLink(hid);
    expect(next.token).not.toBe(link.token);
  });

  it('anyone with the token, signed in or not, sees this week’s goals and nothing else', async () => {
    const { b, hid, shea } = await setup();
    await b.addGoal(hid, THIS, 'Plan Saturday dinner');
    const fridge = await b.addGoal(hid, THIS, 'Deep clean the fridge', shea.id);
    await b.addGoal(hid, LAST, 'Last week secret');
    await b.addGoal(hid, NEXT, 'Next week secret');
    await b.setGoalDone(fridge.id, true);
    const { token } = await b.goalsLink(hid);
    await b.signOut();

    const view = await make().publicGoals(token);
    expect(view).toEqual({
      week: THIS,
      goals: [
        { title: 'Plan Saturday dinner', done: false, person: null },
        { title: 'Deep clean the fridge', done: true, person: { name: 'Shea', emoji: '🦆' } },
      ],
    });
    const json = JSON.stringify(view);
    for (const leak of ['secret', 'Test Street', 'example.com', 'Vlachos', hid, fridge.id, shea.id]) expect(json).not.toContain(leak);

    // The week turns over at midnight on Sunday, London time.
    clock = new Date('2026-10-11T22:59:00Z');
    expect((await make().publicGoals(token))!.week).toBe(THIS);
    clock = new Date('2026-10-11T23:00:00Z');
    expect(await make().publicGoals(token)).toEqual({ week: NEXT, goals: [{ title: 'Next week secret', done: false, person: null }] });
  });

  it('unknown, malformed and turned-off tokens show nothing', async () => {
    const { b, hid } = await setup();
    await b.addGoal(hid, THIS, 'Hidden');
    const { token } = await b.goalsLink(hid);
    const other = token.startsWith('A') ? `B${token.slice(1)}` : `A${token.slice(1)}`;
    for (const t of [other, '', 'short', `${token}x`, token.slice(1)]) expect(await b.publicGoals(t)).toBeNull();
    await b.stopGoalsLink(hid);
    expect(await b.publicGoals(token)).toBeNull();
  });

  it('publicGoalsFor (what the server answers with) is the same view', async () => {
    const { b, hid } = await setup();
    await b.addGoal(hid, THIS, 'Shared');
    const { token } = await b.goalsLink(hid);
    expect(publicGoalsFor(stored(), hid, clock)).toEqual(await b.publicGoals(token));
  });
});
