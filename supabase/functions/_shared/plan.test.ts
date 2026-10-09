import { describe, expect, it } from 'vitest';
import { planNotifications, withItemKinds, type PlanInput, type PushMessage } from './plan.ts';
import { area, completion, household, item, member } from './test-fixtures.ts';
import type { AreaRow, HouseholdRow, ItemRow, MemberRow } from './types.ts';

const APP = 'https://home.example.com/';

// Thu 8 Oct 2026. London is on BST (UTC+1), Los Angeles on PDT (UTC-7).
const LONDON_8AM = new Date('2026-10-08T07:00:00Z');
const LONDON_0759 = new Date('2026-10-08T06:59:00Z');

function input(over: Partial<PlanInput> & Pick<PlanInput, 'now'>): PlanInput {
  return { households: [], members: [], areas: [], items: [], completions: [], appUrl: APP, ...over };
}

/** A London household with an owner (Stratis), a member (Shea) and someone with push off (Ela). */
function home(over: Partial<HouseholdRow> = {}) {
  const h = household(over);
  const owner = member(h, { name: 'Stratis', emoji: '🦔', role: 'owner', created_at: '2026-01-01T00:00:00Z' });
  const shea = member(h, { name: 'Shea', emoji: '🦆', created_at: '2026-01-02T00:00:00Z' });
  const ela = member(h, { name: 'Ela', emoji: '🦊', push_enabled: false, created_at: '2026-01-03T00:00:00Z' });
  const kitchen = area(h, 'Kitchen', 0);
  const hallway = area(h, 'Hallway', 1);
  return { h, owner, shea, ela, kitchen, hallway, members: [owner, shea, ela], areas: [kitchen, hallway] };
}

function run(
  ctx: { h: HouseholdRow; members: MemberRow[]; areas: AreaRow[] },
  items: ItemRow[],
  now: Date,
) {
  return planNotifications(input({ households: [ctx.h], members: ctx.members, areas: ctx.areas, items, now }));
}

const who = (pushes: PushMessage[]) => pushes.map((p) => p.memberId).sort();

describe('reminders', () => {
  it('fires on the day set by Notify, with the right copy', () => {
    const ctx = home();
    const sameDay = item(ctx.kitchen, { title: 'Olive oil', due_date: '2026-10-08', notify: 'same_day', assignee_id: ctx.shea.id });
    const dayBefore = item(ctx.kitchen, { title: 'Kitchen paper', due_date: '2026-10-09', notify: 'day_before', assignee_id: ctx.shea.id });
    const weekBefore = item(ctx.hallway, { title: 'Heaters', due_date: '2026-10-15', notify: 'week_before', assignee_id: ctx.shea.id });

    const { pushes } = run(ctx, [sameDay, dayBefore, weekBefore], LONDON_8AM);

    expect(pushes).toEqual([
      {
        kind: 'reminder',
        householdId: ctx.h.id,
        itemId: sameDay.id,
        memberId: ctx.shea.id,
        refDate: '2026-10-08',
        payload: { title: 'Due today', body: 'Olive oil · Kitchen', url: APP, tag: `reminder:${sameDay.id}` },
      },
      {
        kind: 'reminder',
        householdId: ctx.h.id,
        itemId: dayBefore.id,
        memberId: ctx.shea.id,
        refDate: '2026-10-09',
        payload: { title: 'Due tomorrow', body: 'Kitchen paper · Kitchen', url: APP, tag: `reminder:${dayBefore.id}` },
      },
      {
        kind: 'reminder',
        householdId: ctx.h.id,
        itemId: weekBefore.id,
        memberId: ctx.shea.id,
        refDate: '2026-10-15',
        payload: { title: 'Due in a week', body: 'Heaters · Hallway', url: APP, tag: `reminder:${weekBefore.id}` },
      },
    ]);
  });

  it('does not fire on other days, for Notify "none", without a due date, or for done items', () => {
    const ctx = home();
    const items = [
      item(ctx.kitchen, { due_date: '2026-10-09', notify: 'none', assignee_id: ctx.shea.id }),
      item(ctx.kitchen, { due_date: '2026-10-08', notify: 'none', assignee_id: ctx.shea.id }),
      item(ctx.kitchen, { due_date: '2026-10-10', notify: 'day_before', assignee_id: ctx.shea.id }),
      item(ctx.kitchen, { due_date: '2026-10-09', notify: 'same_day', assignee_id: ctx.shea.id }),
      item(ctx.kitchen, { due_date: '2026-10-14', notify: 'week_before', assignee_id: ctx.shea.id }),
      item(ctx.kitchen, { due_date: null, notify: 'same_day', assignee_id: ctx.shea.id }),
      item(ctx.kitchen, { due_date: '2026-10-09', notify: 'day_before', assignee_id: ctx.shea.id, status: 'done' }),
    ];
    expect(run(ctx, items, LONDON_8AM).pushes).toEqual([]);
  });

  it('goes to the assignee only, or to everyone with push on when unassigned', () => {
    const ctx = home();
    const assigned = item(ctx.kitchen, { due_date: '2026-10-09', assignee_id: ctx.owner.id });
    const unassigned = item(ctx.kitchen, { due_date: '2026-10-09', assignee_id: null });
    const { pushes } = run(ctx, [assigned, unassigned], LONDON_8AM);
    expect(who(pushes.filter((p) => p.itemId === assigned.id))).toEqual([ctx.owner.id]);
    // Ela has push off.
    expect(who(pushes.filter((p) => p.itemId === unassigned.id))).toEqual([ctx.owner.id, ctx.shea.id].sort());
  });

  it('skips an assignee who has push off', () => {
    const ctx = home();
    const forEla = item(ctx.kitchen, { due_date: '2026-10-09', assignee_id: ctx.ela.id });
    expect(run(ctx, [forEla], LONDON_8AM).pushes).toEqual([]);
  });

  it('treats an assignee from outside the household as unassigned', () => {
    const ctx = home();
    const stray = item(ctx.kitchen, { due_date: '2026-10-09', assignee_id: 'someone-else' });
    expect(who(run(ctx, [stray], LONDON_8AM).pushes)).toEqual([ctx.owner.id, ctx.shea.id].sort());
  });

  it('only sends at or after 08:00 household time (London, summer time)', () => {
    const ctx = home();
    const due = item(ctx.kitchen, { due_date: '2026-10-09', assignee_id: ctx.shea.id });
    expect(run(ctx, [due], LONDON_0759).pushes).toEqual([]); // 07:59 BST (06:59 UTC)
    expect(run(ctx, [due], LONDON_8AM).pushes).toHaveLength(1); // 08:00 BST (07:00 UTC)
    expect(run(ctx, [due], new Date('2026-10-08T22:59:00Z')).pushes).toHaveLength(1); // 23:59 BST
    // Just after local midnight it is the 9th: the day-before reminder is over and it is too early anyway.
    expect(run(ctx, [due], new Date('2026-10-08T23:30:00Z')).pushes).toEqual([]);
  });

  it('only sends at or after 08:00 household time (Los Angeles)', () => {
    const ctx = home({ timezone: 'America/Los_Angeles' });
    const due = item(ctx.kitchen, { due_date: '2026-10-09', assignee_id: ctx.shea.id });
    // 08:00 UTC and 08:00 London are the middle of the night in LA.
    expect(run(ctx, [due], new Date('2026-10-08T08:00:00Z')).pushes).toEqual([]);
    expect(run(ctx, [due], new Date('2026-10-08T14:59:00Z')).pushes).toEqual([]); // 07:59 PDT
    expect(run(ctx, [due], new Date('2026-10-08T15:00:00Z')).pushes).toHaveLength(1); // 08:00 PDT
    // 03:00 UTC on the 9th is still 20:00 on the 8th in LA: the day-before reminder still applies.
    expect(run(ctx, [due], new Date('2026-10-09T03:00:00Z')).pushes).toHaveLength(1);
  });

  it('works out "today" per household when several are planned together', () => {
    const london = home();
    const la = home({ timezone: 'America/Los_Angeles' });
    const a = item(london.kitchen, { due_date: '2026-10-09', assignee_id: london.shea.id });
    const b = item(la.kitchen, { due_date: '2026-10-09', assignee_id: la.shea.id });
    const { pushes } = planNotifications(
      input({
        now: LONDON_8AM,
        households: [london.h, la.h],
        members: [...london.members, ...la.members],
        areas: [...london.areas, ...la.areas],
        items: [a, b],
      }),
    );
    expect(pushes.map((p) => p.itemId)).toEqual([a.id]);
  });

  it('clips very long titles so the push payload stays small', () => {
    const ctx = home();
    const long = item(ctx.kitchen, { title: 'x'.repeat(5000), due_date: '2026-10-09', assignee_id: ctx.shea.id });
    const [push] = run(ctx, [long], LONDON_8AM).pushes;
    expect(JSON.stringify(push.payload).length).toBeLessThan(400);
    expect(push.payload.body.endsWith('… · Kitchen')).toBe(true);
  });
});

describe('missed alerts', () => {
  it('go out for open items due 1 to 3 days ago, with the right copy', () => {
    const ctx = home();
    const heaters = item(ctx.hallway, { title: 'Heaters not working', due_date: '2026-10-06', assignee_id: ctx.shea.id, notify: 'none' });
    const { pushes } = run(ctx, [heaters], LONDON_8AM);
    const forShea = pushes.find((p) => p.memberId === ctx.shea.id);
    expect(forShea).toEqual({
      kind: 'missed',
      householdId: ctx.h.id,
      itemId: heaters.id,
      memberId: ctx.shea.id,
      refDate: '2026-10-06',
      payload: { title: 'Missed: Heaters not working', body: 'Was due Tue 6 Oct · Hallway', url: APP, tag: `missed:${heaters.id}` },
    });
  });

  it('cover yesterday through three days ago only', () => {
    const ctx = home();
    const dates = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
    const items = dates.map((d) => item(ctx.kitchen, { due_date: d, assignee_id: ctx.owner.id, notify: 'none' }));
    const { pushes } = run(ctx, items, LONDON_8AM);
    expect(pushes.filter((p) => p.kind === 'missed').map((p) => p.refDate)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
  });

  it('go to the assignee and the owner, once each', () => {
    const ctx = home();
    const shea = item(ctx.kitchen, { due_date: '2026-10-07', assignee_id: ctx.shea.id });
    const owners = item(ctx.kitchen, { due_date: '2026-10-07', assignee_id: ctx.owner.id });
    const nobody = item(ctx.kitchen, { due_date: '2026-10-07', assignee_id: null });
    const { pushes } = run(ctx, [shea, owners, nobody], LONDON_8AM);
    expect(who(pushes.filter((p) => p.itemId === shea.id))).toEqual([ctx.owner.id, ctx.shea.id].sort());
    expect(who(pushes.filter((p) => p.itemId === owners.id))).toEqual([ctx.owner.id]);
    expect(who(pushes.filter((p) => p.itemId === nobody.id))).toEqual([ctx.owner.id]);
  });

  it('respect push_enabled for both the assignee and the owner', () => {
    const ctx = home();
    ctx.owner.push_enabled = false;
    const forEla = item(ctx.kitchen, { due_date: '2026-10-07', assignee_id: ctx.ela.id });
    const forShea = item(ctx.kitchen, { due_date: '2026-10-07', assignee_id: ctx.shea.id });
    const { pushes } = run(ctx, [forEla, forShea], LONDON_8AM);
    expect(pushes.map((p) => [p.itemId, p.memberId])).toEqual([[forShea.id, ctx.shea.id]]);
  });

  it('go to every owner when there are several', () => {
    const ctx = home();
    ctx.shea.role = 'owner';
    const nobody = item(ctx.kitchen, { due_date: '2026-10-07' });
    expect(who(run(ctx, [nobody], LONDON_8AM).pushes)).toEqual([ctx.owner.id, ctx.shea.id].sort());
  });

  it('wait for 08:00 too', () => {
    const ctx = home();
    const missed = item(ctx.kitchen, { due_date: '2026-10-07', assignee_id: ctx.shea.id });
    expect(run(ctx, [missed], LONDON_0759).pushes).toEqual([]);
  });
});

describe('weekly email', () => {
  // Monday 12 Oct 2026; the default is Monday 08:00.
  const MONDAY_0759 = new Date('2026-10-12T06:59:00Z');
  const MONDAY_8AM = new Date('2026-10-12T07:00:00Z');

  it('goes out on the day, at or after the time, to members with weekly_email on', () => {
    const ctx = home();
    ctx.ela.weekly_email = false;
    const before = planNotifications(input({ now: MONDAY_0759, households: [ctx.h], members: ctx.members, areas: ctx.areas }));
    expect(before.emails).toEqual([]);

    const { emails } = planNotifications(input({ now: MONDAY_8AM, households: [ctx.h], members: ctx.members, areas: ctx.areas }));
    expect(emails.map((e) => e.memberId)).toEqual([ctx.owner.id, ctx.shea.id]);
    expect(emails[0]).toMatchObject({
      householdId: ctx.h.id,
      refDate: '2026-10-12',
      to: ctx.owner.email,
      subject: 'home.os weekly: 21 Alderbrook Road',
    });
    expect(emails[0].html).toContain('Open home.os');
    expect(emails[0].text).toContain(APP);
    // Same content for everyone.
    expect(emails[1].html).toBe(emails[0].html);
  });

  it('keeps going for the rest of the day (the log stops repeats) but not on other days', () => {
    const ctx = home();
    const at = (iso: string) =>
      planNotifications(input({ now: new Date(iso), households: [ctx.h], members: ctx.members, areas: ctx.areas })).emails.length;
    expect(at('2026-10-12T22:59:00Z')).toBe(3); // 23:59 BST Monday
    expect(at('2026-10-12T23:00:00Z')).toBe(0); // 00:00 Tuesday
    expect(at('2026-10-11T12:00:00Z')).toBe(0); // Sunday
    expect(at('2026-10-19T07:00:00Z')).toBe(3); // next Monday
  });

  it('honours a custom day and time in the household zone', () => {
    const ctx = home({ timezone: 'America/Los_Angeles', weekly_email_day: 5, weekly_email_time: '18:30:00' });
    const at = (iso: string) =>
      planNotifications(input({ now: new Date(iso), households: [ctx.h], members: ctx.members, areas: ctx.areas })).emails;
    // Friday 9 Oct 2026, 18:29 and 18:30 PDT.
    expect(at('2026-10-10T01:29:00Z')).toEqual([]);
    const emails = at('2026-10-10T01:30:00Z');
    expect(emails).toHaveLength(3);
    expect(emails[0].refDate).toBe('2026-10-09');
    // Accepts "HH:MM" as well.
    ctx.h.weekly_email_time = '18:30';
    expect(at('2026-10-10T01:30:00Z')).toHaveLength(3);
  });

  it('skips members without an email address', () => {
    const ctx = home();
    ctx.shea.email = '  ';
    const { emails } = planNotifications(input({ now: MONDAY_8AM, households: [ctx.h], members: ctx.members, areas: ctx.areas }));
    expect(emails.map((e) => e.memberId)).toEqual([ctx.owner.id, ctx.ela.id]);
  });

  it("uses only the household's own items and completions", () => {
    const a = home();
    const b = home({ address: '', name: 'The Flat' });
    const mine = item(a.kitchen, { title: 'Mine', due_date: '2026-10-13' });
    const theirs = item(b.kitchen, { title: 'Theirs', due_date: '2026-10-13' });
    const done = completion(b.h, { item_title: 'Their chore', credited_to: b.shea.id, completed_at: '2026-10-10T09:00:00Z' });
    const { emails } = planNotifications(
      input({
        now: MONDAY_8AM,
        households: [a.h, b.h],
        members: [...a.members, ...b.members],
        areas: [...a.areas, ...b.areas],
        items: [mine, theirs],
        completions: [done],
      }),
    );
    const forA = emails.find((e) => e.householdId === a.h.id)!;
    const forB = emails.find((e) => e.householdId === b.h.id)!;
    expect(forA.text).toContain('Mine');
    expect(forA.text).not.toContain('Theirs');
    expect(forA.text).not.toContain('Their chore');
    expect(forB.subject).toBe('home.os weekly: The Flat');
    expect(forB.text).toContain('Their chore');
  });

  it('does not depend on the push hour', () => {
    const ctx = home({ weekly_email_time: '07:00:00' });
    const { emails, pushes } = planNotifications(
      input({ now: new Date('2026-10-12T06:00:00Z'), households: [ctx.h], members: ctx.members, areas: ctx.areas }),
    );
    expect(emails).toHaveLength(3);
    expect(pushes).toEqual([]);
  });
});

describe('states (To maintain)', () => {
  // Monday 12 Oct 2026, 08:00 BST: the default weekly email slot.
  const MONDAY_8AM = new Date('2026-10-12T07:00:00Z');

  it('never get a reminder or a missed alert, even if a row still had a due date', () => {
    const ctx = home();
    // A stale row as if the trigger had not run: due today, yesterday, tomorrow, all with Notify.
    const states = [
      item(ctx.kitchen, { kind: 'state', title: 'Firepit', due_date: '2026-10-08', notify: 'same_day', assignee_id: ctx.shea.id }),
      item(ctx.kitchen, { kind: 'state', title: 'Jacuzzi', due_date: '2026-10-07', notify: 'none', assignee_id: ctx.shea.id }),
      item(ctx.kitchen, { kind: 'state', title: 'Cover', due_date: '2026-10-09', notify: 'day_before', assignee_id: null }),
      item(ctx.kitchen, { kind: 'state', title: 'Undated', due_date: null, notify: 'none' }),
    ];
    expect(run(ctx, states, LONDON_8AM).pushes).toEqual([]);
    // The same rows as to-dos would all fire.
    const tasks = states.map((s) => ({ ...s, kind: 'task' as const }));
    expect(run(ctx, tasks, LONDON_8AM).pushes.length).toBeGreaterThan(0);
  });

  it('are listed in the weekly email under their area, marked "To maintain"', () => {
    const ctx = home();
    const firepit = item(ctx.kitchen, { kind: 'state', title: 'Firepit', rag: 'green', assignee_id: ctx.ela.id });
    const { emails } = planNotifications(
      input({ now: MONDAY_8AM, households: [ctx.h], members: ctx.members, areas: ctx.areas, items: [firepit] }),
    );
    expect(emails).toHaveLength(3);
    expect(emails[0].text).toContain('* [Green] Firepit\n  🦊 Ela · To maintain');
  });
});

describe('withItemKinds', () => {
  it('marks the listed ids as states and everything else as tasks', () => {
    const ctx = home();
    const a = item(ctx.kitchen, { title: 'A' });
    const b = item(ctx.kitchen, { title: 'B', kind: 'state' });
    const c = item(ctx.kitchen, { title: 'C' });
    const marked = withItemKinds([a, b, c], [c.id, 'unknown-id']);
    expect(marked.map((it) => [it.title, it.kind])).toEqual([
      ['A', 'task'],
      ['B', 'task'],
      ['C', 'state'],
    ]);
    // The rows themselves are left alone.
    expect(a.kind).toBeUndefined();
    expect(withItemKinds([], [])).toEqual([]);
  });
});
