import { describe, expect, it } from 'vitest';
import { GOALS_PER_WEEK_MAX } from '../constants';
import type { Goal, Member } from '../types';
import {
  bringOverLabel,
  doneLine,
  emptyGoals,
  firstName,
  goalsLinkUrl,
  goalsOf,
  goalsShareText,
  goalsTokenIn,
  isGoalsToken,
  isWeekStart,
  newGoalsToken,
  openThisWeek,
  progressLine,
  publicGoalsOf,
  sameToken,
  shiftWeek,
  stampLabel,
  toBringOver,
  weekDates,
  weekLabel,
  weekStart,
  withGoalAdded,
  withGoalDeleted,
  withGoalDone,
  withGoalMoved,
} from './goals';

const TODAY = '2026-10-08'; // Thursday
const THIS = '2026-10-05';
const LAST = '2026-09-28';
const NEXT = '2026-10-12';
const H = 'h-1';

let seq = 0;
function goal(over: Partial<Goal> & Pick<Goal, 'title'>): Goal {
  seq += 1;
  return {
    id: `g-${seq}`,
    household_id: H,
    week: THIS,
    member_id: null,
    position: 0,
    done: false,
    done_by: null,
    done_at: null,
    carried_from: null,
    created_by: null,
    created_at: `2026-10-05T09:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    ...over,
  };
}

function member(id: string, name: string, emoji = '🦆'): Member {
  return {
    id,
    household_id: H,
    user_id: `u-${id}`,
    name,
    email: '',
    emoji,
    color: '#AF52DE',
    role: 'member',
    weekly_email: true,
    push_enabled: false,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

const SHEA = member('m-shea', 'Shea Byrne', '🦆');
const ELA = member('m-ela', 'Ela', '🦊');

describe('weeks', () => {
  it('weekStart: the Monday of the week', () => {
    expect(weekStart('2026-10-08')).toBe('2026-10-05');
    expect(weekStart('2026-10-05')).toBe('2026-10-05');
    expect(weekStart('2026-10-11')).toBe('2026-10-05');
    expect(weekStart('2026-10-01')).toBe('2026-09-28');
    expect(weekStart('2027-01-02')).toBe('2026-12-28');
    // The clocks go back in London on Sunday 25 Oct 2026: still that week's Monday.
    expect(weekStart('2026-10-25')).toBe('2026-10-19');
  });

  it('isWeekStart: a real Monday only', () => {
    expect(isWeekStart('2026-10-05')).toBe(true);
    expect(isWeekStart('2026-10-11')).toBe(false);
    expect(isWeekStart('2026-02-30')).toBe(false);
    expect(isWeekStart('5 Oct')).toBe(false);
    expect(isWeekStart(null)).toBe(false);
  });

  it('shiftWeek: weeks before and after', () => {
    expect(shiftWeek(THIS, -1)).toBe(LAST);
    expect(shiftWeek(THIS, 1)).toBe(NEXT);
  });

  it('weekDates: short months, the year when it is not this year', () => {
    expect(weekDates('2026-10-05', TODAY)).toBe('5 to 11 Oct');
    expect(weekDates('2026-09-28', TODAY)).toBe('28 Sep to 4 Oct');
    expect(weekDates('2027-01-04', TODAY)).toBe('4 to 10 Jan 2027');
    expect(weekDates('2026-12-28', TODAY)).toBe('28 Dec to 3 Jan 2027');
    expect(weekDates('2026-12-28', '2027-01-02')).toBe('28 Dec 2026 to 3 Jan');
  });

  it('weekLabel: this, next and last week by name, others by their days', () => {
    expect(weekLabel(THIS, TODAY)).toBe('This week, 5 to 11 Oct');
    expect(weekLabel(NEXT, TODAY)).toBe('Next week, 12 to 18 Oct');
    expect(weekLabel(LAST, TODAY)).toBe('Last week, 28 Sep to 4 Oct');
    expect(weekLabel('2026-10-19', TODAY)).toBe('19 to 25 Oct');
    expect(weekLabel('2026-09-21', TODAY)).toBe('21 to 27 Sep');
    expect(weekLabel('2027-01-04', TODAY)).toBe('4 to 10 Jan 2027');
    // Seen on the Sunday: still this week.
    expect(weekLabel(THIS, '2026-10-11')).toBe('This week, 5 to 11 Oct');
  });
});

describe('a week of goals', () => {
  it('goalsOf: that week only, in order', () => {
    const a = goal({ title: 'A', position: 1 });
    const b = goal({ title: 'B', position: 0 });
    const c = goal({ title: 'C', week: LAST, position: 0 });
    expect(goalsOf([a, c, b], THIS).map((g) => g.title)).toEqual(['B', 'A']);
    expect(goalsOf([a, c, b], LAST).map((g) => g.title)).toEqual(['C']);
  });

  it('progressLine', () => {
    const open = goal({ title: 'Open' });
    const done = goal({ title: 'Done', done: true });
    expect(progressLine([open, done, goal({ title: 'x' })], THIS, TODAY)).toBe('1 of 3 done');
    expect(progressLine([open], THIS, TODAY)).toBe('0 of 1 done');
    expect(progressLine([done, { ...done, id: 'd2' }], THIS, TODAY)).toBe('All 2 done');
    expect(progressLine([done], THIS, TODAY)).toBe('Done');
    expect(progressLine([], THIS, TODAY)).toBe('Nothing planned yet');
    expect(progressLine([], NEXT, TODAY)).toBe('Nothing planned yet');
    expect(progressLine([], LAST, TODAY)).toBe('Nothing planned that week');
  });

  it('openThisWeek: the badge counts this week’s open goals only', () => {
    const list = [
      goal({ title: 'a' }),
      goal({ title: 'b', done: true }),
      goal({ title: 'c' }),
      goal({ title: 'last', week: LAST }),
      goal({ title: 'next', week: NEXT }),
    ];
    expect(openThisWeek(list, TODAY)).toBe(2);
    expect(openThisWeek([], TODAY)).toBe(0);
    // On the Sunday, Monday's goals are still this week's.
    expect(openThisWeek(list, '2026-10-11')).toBe(2);
    expect(openThisWeek(list, '2026-10-12')).toBe(1);
  });
});

describe('Bring over', () => {
  it('brings last week’s unfinished goals, in order', () => {
    const a = goal({ title: 'A', week: LAST, position: 0 });
    const b = goal({ title: 'B', week: LAST, position: 1, done: true });
    const c = goal({ title: 'C', week: LAST, position: 2 });
    expect(toBringOver([c, b, a], THIS).map((g) => g.title)).toEqual(['A', 'C']);
  });

  it('never brings one twice', () => {
    const a = goal({ title: 'A', week: LAST, position: 0 });
    const c = goal({ title: 'C', week: LAST, position: 1 });
    const brought = goal({ title: 'A', week: THIS, carried_from: a.id });
    expect(toBringOver([a, c, brought], THIS).map((g) => g.title)).toEqual(['C']);
  });

  it('nothing from last week, or only done ones: nothing', () => {
    expect(toBringOver([], THIS)).toEqual([]);
    expect(toBringOver([goal({ title: 'x', week: LAST, done: true })], THIS)).toEqual([]);
    // Two weeks ago is not last week.
    expect(toBringOver([goal({ title: 'x', week: '2026-09-21' })], THIS)).toEqual([]);
  });

  it('a nearly full week brings what fits', () => {
    const here = Array.from({ length: GOALS_PER_WEEK_MAX - 1 }, (_, i) => goal({ title: `t${i}`, position: i }));
    const before = [goal({ title: 'A', week: LAST, position: 0 }), goal({ title: 'B', week: LAST, position: 1 })];
    expect(toBringOver([...here, ...before], THIS).map((g) => g.title)).toEqual(['A']);
  });

  it('bringOverLabel', () => {
    expect(bringOverLabel(1)).toBe('Bring over 1 from last week');
    expect(bringOverLabel(3)).toBe('Bring over 3 from last week');
  });
});

describe('people and times', () => {
  it('firstName', () => {
    expect(firstName('Stratis Vlachos')).toBe('Stratis');
    expect(firstName('Shea')).toBe('Shea');
    expect(firstName('  Ela   Rose ')).toBe('Ela');
    expect(firstName('')).toBe('');
  });

  const NOW = new Date('2026-10-08T10:00:00+01:00');
  it('stampLabel', () => {
    expect(stampLabel('2026-10-08T08:42:00.000Z', 'Europe/London', NOW)).toBe('Today 09:42');
    expect(stampLabel('2026-10-07T18:20:00.000Z', 'Europe/London', NOW)).toBe('Yesterday 19:20');
    expect(stampLabel('2026-10-06T09:05:00.000Z', 'Europe/London', NOW)).toBe('Tue 6 Oct 10:05');
    expect(stampLabel('2025-12-30T09:05:00.000Z', 'Europe/London', NOW)).toBe('Tue 30 Dec 2025 09:05');
    // 23:30 UTC on 7 Oct is 8 Oct in London (summer time).
    expect(stampLabel('2026-10-07T23:30:00.000Z', 'Europe/London', NOW)).toBe('Today 00:30');
    expect(stampLabel('2026-10-07T23:30:00.000Z', 'UTC', NOW)).toBe('Yesterday 23:30');
  });

  it('doneLine', () => {
    const at = '2026-10-08T08:42:00.000Z';
    const members = [SHEA, ELA];
    const open = goal({ title: 'x', member_id: ELA.id });
    expect(doneLine(open, members, 'Europe/London', NOW)).toBeNull();
    const own = { ...open, done: true, done_by: ELA.id, done_at: at };
    expect(doneLine(own, members, 'Europe/London', NOW)).toBe('Done · Today 09:42');
    const other = { ...own, done_by: SHEA.id };
    expect(doneLine(other, members, 'Europe/London', NOW)).toBe('Done by Shea · Today 09:42');
    const nobody = { ...other, member_id: null };
    expect(doneLine(nobody, members, 'Europe/London', NOW)).toBe('Done by Shea · Today 09:42');
    const gone = { ...other, done_by: 'm-gone' };
    expect(doneLine(gone, members, 'Europe/London', NOW)).toBe('Done · Today 09:42');
    const removed = { ...other, done_by: null };
    expect(doneLine(removed, members, 'Europe/London', NOW)).toBe('Done · Today 09:42');
    expect(doneLine({ ...other, done_at: null }, members, 'Europe/London', NOW)).toBe('Done by Shea');
  });
});

describe('the public link', () => {
  it('tokens: 22 base64url characters, fresh each time', () => {
    const a = newGoalsToken();
    const b = newGoalsToken();
    expect(isGoalsToken(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(newGoalsToken((bytes) => bytes.fill(255))).toBe('_____________________w');
    expect(newGoalsToken((bytes) => bytes.fill(0))).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    expect(isGoalsToken('short')).toBe(false);
    expect(isGoalsToken('AAAAAAAAAAAAAAAAAAAAA=')).toBe(false);
    expect(isGoalsToken('AAAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
    expect(isGoalsToken(42)).toBe(false);
  });

  it('sameToken', () => {
    expect(sameToken('AAAAAAAAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA')).toBe(true);
    expect(sameToken('AAAAAAAAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAB')).toBe(false);
    expect(sameToken('AAAA', 'AAAAA')).toBe(false);
    expect(sameToken('', '')).toBe(true);
  });

  it('goalsLinkUrl and goalsTokenIn', () => {
    expect(goalsLinkUrl('https://home.example/', 'AAAAAAAAAAAAAAAAAAAAAA')).toBe('https://home.example/?goals=AAAAAAAAAAAAAAAAAAAAAA');
    expect(goalsLinkUrl('https://example.com/home/', 'abc_-')).toBe('https://example.com/home/?goals=abc_-');
    expect(goalsTokenIn('?goals=AAAAAAAAAAAAAAAAAAAAAA')).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    expect(goalsTokenIn('?frame&goals=abc')).toBe('abc');
    expect(goalsTokenIn('?item=1')).toBeNull();
    expect(goalsTokenIn('')).toBeNull();
    expect(goalsTokenIn('?goals=')).toBe('');
  });

  it('goalsShareText: the words, then the link', () => {
    expect(goalsShareText('https://x/?goals=a')).toBe('Our goals for the week\nhttps://x/?goals=a');
  });

  it('publicGoalsOf: titles, ticks and who is on it by first name and emoji, nothing else', () => {
    const list = [
      goal({ title: 'Second', position: 1, member_id: SHEA.id, done: true, done_by: SHEA.id, done_at: '2026-10-06T09:00:00.000Z' }),
      goal({ title: 'First', position: 0 }),
      goal({ title: 'Gone person', position: 2, member_id: 'm-gone' }),
      goal({ title: 'Last week', week: LAST }),
    ];
    const view = publicGoalsOf(list, [SHEA, ELA], THIS);
    expect(view).toEqual({
      week: THIS,
      goals: [
        { title: 'First', done: false, person: null },
        { title: 'Second', done: true, person: { name: 'Shea', emoji: '🦆' } },
        { title: 'Gone person', done: false, person: null },
      ],
    });
    // Nothing private rides along.
    const json = JSON.stringify(view);
    for (const leak of ['Byrne', 'Ela', 'm-shea', 'h-1', 'g-', '2026-10-06T']) expect(json).not.toContain(leak);
  });
});

describe('optimistic edits', () => {
  const data = () => {
    const a = goal({ title: 'A', position: 0 });
    const b = goal({ title: 'B', position: 1 });
    const c = goal({ title: 'C', position: 2 });
    const other = goal({ title: 'Other week', week: NEXT, position: 0 });
    return { ...emptyGoals(), list: [a, b, c, other] };
  };
  const titles = (d: ReturnType<typeof data>, week = THIS) => goalsOf(d.list, week).map((g) => `${g.title}${g.position}`);

  it('withGoalAdded: last, or replacing one with its id', () => {
    const d = data();
    const added = withGoalAdded(d, goal({ title: 'D', position: 3 }));
    expect(titles(added)).toEqual(['A0', 'B1', 'C2', 'D3']);
    const again = withGoalAdded(added, { ...added.list.find((g) => g.title === 'D')!, title: 'D!' });
    expect(titles(again)).toEqual(['A0', 'B1', 'C2', 'D!3']);
    expect(d.list).toHaveLength(4);
  });

  it('withGoalDone: stamps and clears', () => {
    const d = data();
    const id = d.list[0].id;
    const done = withGoalDone(d, id, true, 'm-1', '2026-10-08T09:00:00.000Z');
    expect(done.list[0]).toMatchObject({ done: true, done_by: 'm-1', done_at: '2026-10-08T09:00:00.000Z' });
    const undone = withGoalDone(done, id, false, 'm-1', '2026-10-08T09:01:00.000Z');
    expect(undone.list[0]).toMatchObject({ done: false, done_by: null, done_at: null });
    expect(withGoalDone(d, 'nope', true, 'm-1', 'x')).toBe(d);
  });

  it('withGoalMoved: within its week, positions 0…n-1', () => {
    const d = data();
    const [a, , c] = goalsOf(d.list, THIS);
    expect(titles(withGoalMoved(d, a.id, 2))).toEqual(['B0', 'C1', 'A2']);
    expect(titles(withGoalMoved(d, c.id, 0))).toEqual(['C0', 'A1', 'B2']);
    expect(titles(withGoalMoved(d, a.id, 99))).toEqual(['B0', 'C1', 'A2']);
    expect(titles(withGoalMoved(d, a.id, 2), NEXT)).toEqual(['Other week0']);
    expect(withGoalMoved(d, 'nope', 0)).toBe(d);
  });

  it('withGoalDeleted: the rest close up; carried_from forgotten', () => {
    const d = data();
    const [a] = goalsOf(d.list, THIS);
    const carried = goal({ title: 'Carried', week: NEXT, position: 1, carried_from: a.id });
    const out = withGoalDeleted({ ...d, list: [...d.list, carried] }, a.id);
    expect(titles(out)).toEqual(['B0', 'C1']);
    expect(out.list.find((g) => g.title === 'Carried')!.carried_from).toBeNull();
    expect(withGoalDeleted(d, 'nope')).toBe(d);
  });
});
