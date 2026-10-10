import { describe, expect, it } from 'vitest';
import { HOUSEKEEPING_PRICE_MAX_PENCE } from '../constants';
import type { HousekeepingData, HousekeepingTask, HousekeepingVisit, HousekeepingVisitTask, Member } from '../types';
import {
  applyTick,
  applyVisitPatch,
  calendarDayLabel,
  canHaveVisit,
  checklistFor,
  daySelectedAnnouncement,
  defaultSelectedDay,
  doneByline,
  doneCount,
  emptyHousekeeping,
  formatPrice,
  hasNewNote,
  housekeepingSubtitle,
  isRecorded,
  longDay,
  matchesTarget,
  monthGrid,
  monthOf,
  monthSummary,
  monthTitle,
  monthTotals,
  newVisit,
  noteByline,
  parsePrice,
  priceInputValue,
  shiftMonth,
  snapshotNote,
  visitByline,
  visitDays,
  visitOn,
  WEEKDAYS,
  withTaskAdded,
  withTaskDeleted,
  withTaskRenamed,
  withTasksReordered,
} from './housekeeping';

const TZ = 'Europe/London';
/** Thu 8 Oct 2026, 10:00 in London (BST, UTC+1): the e2e clock. */
const NOW = new Date('2026-10-08T09:00:00Z');
const TODAY = '2026-10-08';

function member(id: string, name: string, emoji: string): Member {
  return {
    id,
    household_id: 'h1',
    user_id: `u-${id}`,
    name,
    email: '',
    emoji,
    color: '#007AFF',
    role: 'member',
    weekly_email: true,
    push_enabled: false,
    created_at: '2026-01-01T00:00:00Z',
  };
}

const MEMBERS = [member('me', 'Stratis', '🦔'), member('shea', 'Shea', '🦆'), member('ela', 'Ela', '🦊')];

const TITLES = [
  'Change the bed sheets',
  'Hoover and mop the floors',
  'Clean the bathrooms',
  'Clean the kitchen',
  'Dust the surfaces',
  'Empty the bins',
  'Ironing',
];

function tasks(titles: string[] = TITLES): HousekeepingTask[] {
  return titles.map((title, i) => ({ id: `t${i}`, household_id: 'h1', title, position: i }));
}

function row(visitId: string, i: number, over: Partial<HousekeepingVisitTask> = {}): HousekeepingVisitTask {
  return {
    id: `${visitId}-r${i}`,
    visit_id: visitId,
    household_id: 'h1',
    task_id: `t${i}`,
    title: TITLES[i] ?? `Task ${i}`,
    position: i,
    done: false,
    done_by: null,
    done_at: null,
    ...over,
  };
}

function visit(date: string, over: Partial<HousekeepingVisit> = {}): HousekeepingVisit {
  const id = `v-${date}`;
  return {
    id,
    household_id: 'h1',
    visit_date: date,
    note: '',
    comments: '',
    price_pence: null,
    created_by: 'ela',
    created_at: `${date}T09:05:00Z`,
    updated_by: 'ela',
    updated_at: `${date}T09:05:00Z`,
    tasks: TITLES.map((_, i) => row(id, i)),
    ...over,
  };
}

/** Ticks rows `done` (indexes) of a visit, by Ela at 10:05 London on its day. */
function ticked(v: HousekeepingVisit, done: number[]): HousekeepingVisit {
  return {
    ...v,
    tasks: v.tasks.map((r, i) => (done.includes(i) ? { ...r, done: true, done_by: 'ela', done_at: `${v.visit_date}T09:05:00Z` } : r)),
  };
}

/** The e2e seed's visits: Thursdays 1 Oct, 24, 17, 10 and 3 Sep. */
const SEED_VISITS: HousekeepingVisit[] = [
  ticked(visit('2026-10-01', { price_pence: 6000 }), [0, 1, 2, 3, 4, 5]),
  ticked(visit('2026-09-24', { price_pence: 6500 }), [0, 1, 2, 3, 4, 5, 6]),
  ticked(visit('2026-09-17', { price_pence: 6000 }), [1, 2, 3, 4, 5, 6]),
  ticked(visit('2026-09-10', { price_pence: 6000 }), [0, 1, 2, 3, 5]),
  ticked(visit('2026-09-03', { price_pence: 5500 }), [0, 1, 2, 3, 4, 5]),
];

function data(over: Partial<HousekeepingData> = {}): HousekeepingData {
  return { note: { body: '', updated_at: null, updated_by: null }, tasks: tasks(), visits: [], ...over };
}

/** Deep copy, to prove a function left its input alone. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('empty state', () => {
  it('has no message, no tasks and no visits', () => {
    expect(emptyHousekeeping()).toEqual({ note: { body: '', updated_at: null, updated_by: null }, tasks: [], visits: [] });
    expect(emptyHousekeeping()).not.toBe(emptyHousekeeping());
  });
});

describe('calendar', () => {
  it('WEEKDAYS start on Monday', () => {
    expect(WEEKDAYS.map((d) => d.short).join('')).toBe('MTWTFSS');
    expect(WEEKDAYS.map((d) => d.long)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  });

  it('monthOf: a mid-month day; the 1st and the last day of a month; 31 Dec', () => {
    expect(monthOf('2026-10-08')).toBe('2026-10');
    expect(monthOf('2026-10-01')).toBe('2026-10');
    expect(monthOf('2026-10-31')).toBe('2026-10');
    expect(monthOf('2026-12-31')).toBe('2026-12');
  });

  it('shiftMonth: inside a year, across a year end both ways, 0 and ±13', () => {
    expect(shiftMonth('2026-10', 1)).toBe('2026-11');
    expect(shiftMonth('2026-10', -1)).toBe('2026-09');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
    expect(shiftMonth('2026-10', 13)).toBe('2027-11');
    expect(shiftMonth('2026-10', -13)).toBe('2025-09');
    expect(shiftMonth('2026-01', -13)).toBe('2024-12');
  });

  it('monthTitle: October 2026; January; a different year', () => {
    expect(monthTitle('2026-10')).toBe('October 2026');
    expect(monthTitle('2027-01')).toBe('January 2027');
    expect(monthTitle('1999-12')).toBe('December 1999');
  });

  describe('monthGrid', () => {
    const flat = (month: string) => monthGrid(month).flat();

    it('Oct 2026 starts on a Thursday: 3 nulls, 5 weeks', () => {
      const weeks = monthGrid('2026-10');
      expect(weeks).toHaveLength(5);
      expect(weeks[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
      expect(weeks[4]).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', null]);
    });

    it('Feb 2021 starts on a Monday with 28 days: exactly 4 full weeks', () => {
      const weeks = monthGrid('2021-02');
      expect(weeks).toHaveLength(4);
      expect(weeks.flat()).not.toContain(null);
      expect(weeks[0][0]).toBe('2021-02-01');
      expect(weeks[3][6]).toBe('2021-02-28');
    });

    it('Aug 2026 starts on a Saturday with 31 days: 6 weeks', () => {
      const weeks = monthGrid('2026-08');
      expect(weeks).toHaveLength(6);
      expect(weeks[0].slice(0, 5)).toEqual([null, null, null, null, null]);
      expect(weeks[0][5]).toBe('2026-08-01');
      expect(weeks[5][0]).toBe('2026-08-31');
    });

    it('a leap February has 29 days', () => {
      const days = flat('2028-02').filter(Boolean);
      expect(days).toHaveLength(29);
      expect(days.at(-1)).toBe('2028-02-29');
      expect(flat('2027-02').filter(Boolean)).toHaveLength(28);
    });

    it('a month ending on a Sunday has no trailing nulls', () => {
      // May 2026 ends on Sunday 31 May.
      const weeks = monthGrid('2026-05');
      expect(weeks.at(-1)!.at(-1)).toBe('2026-05-31');
    });

    it('every week has 7 cells and every date of the month appears once, in order', () => {
      for (const month of ['2026-01', '2026-02', '2026-03', '2026-06', '2026-09', '2026-10', '2026-12', '2028-02']) {
        const weeks = monthGrid(month);
        expect(weeks.length).toBeGreaterThanOrEqual(4);
        expect(weeks.length).toBeLessThanOrEqual(6);
        for (const week of weeks) expect(week).toHaveLength(7);
        const days = weeks.flat().filter((d): d is string => d !== null);
        expect(days.every((d) => d.startsWith(month))).toBe(true);
        expect(days.map((d) => Number(d.slice(8)))).toEqual(days.map((_, i) => i + 1));
        // Each date sits in its weekday's column (Monday first).
        weeks.forEach((week) =>
          week.forEach((d, col) => {
            if (d) expect((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7).toBe(col);
          }),
        );
      }
    });
  });

  it('canHaveVisit: yesterday and today yes, tomorrow no, across a month and a year end', () => {
    expect(canHaveVisit('2026-10-07', TODAY)).toBe(true);
    expect(canHaveVisit(TODAY, TODAY)).toBe(true);
    expect(canHaveVisit('2026-10-09', TODAY)).toBe(false);
    expect(canHaveVisit('2026-09-30', '2026-10-01')).toBe(true);
    expect(canHaveVisit('2026-11-01', '2026-10-31')).toBe(false);
    expect(canHaveVisit('2025-12-31', '2026-01-01')).toBe(true);
    expect(canHaveVisit('2027-01-01', '2026-12-31')).toBe(false);
  });

  it('longDay: same year; a different year; the 1st of a month', () => {
    expect(longDay('2026-10-01', TODAY)).toBe('Thursday 1 October');
    expect(longDay('2025-12-31', TODAY)).toBe('Wednesday 31 December 2025');
    expect(longDay('2026-11-01', TODAY)).toBe('Sunday 1 November');
    expect(longDay('2026-10-08', TODAY)).toBe('Thursday 8 October');
  });

  it('calendarDayLabel: each example, a visit without a price and one with no tasks', () => {
    expect(calendarDayLabel('2026-10-01', TODAY, SEED_VISITS[0])).toBe('Thursday 1 October, visit, 6 of 7 done, £60.00');
    expect(calendarDayLabel(TODAY, TODAY, undefined)).toBe('Thursday 8 October, today');
    expect(calendarDayLabel(TODAY, TODAY, ticked(visit(TODAY), [0]))).toBe('Thursday 8 October, today, visit, 1 of 7 done');
    expect(calendarDayLabel('2026-10-09', TODAY, undefined)).toBe('Friday 9 October');
    expect(calendarDayLabel('2026-10-01', TODAY, SEED_VISITS[0], true)).toBe(
      'Thursday 1 October, visit, 6 of 7 done, £60.00, selected',
    );
    expect(calendarDayLabel('2026-10-06', TODAY, undefined, true)).toBe('Tuesday 6 October, selected');
    // Nothing recorded (a tick taken back): read like a day without a visit.
    expect(calendarDayLabel(TODAY, TODAY, visit(TODAY))).toBe('Thursday 8 October, today');
    expect(calendarDayLabel('2026-10-06', TODAY, visit('2026-10-06'))).toBe('Tuesday 6 October');
    expect(calendarDayLabel('2026-10-05', TODAY, ticked(visit('2026-10-05'), [0, 1]))).toBe(
      'Monday 5 October, visit, 2 of 7 done',
    );
    expect(calendarDayLabel('2026-10-06', TODAY, visit('2026-10-06', { tasks: [], price_pence: 0 }))).toBe(
      'Tuesday 6 October, visit, 0 of 0 done, £0.00',
    );
  });

  it('defaultSelectedDay: the latest visit this month before today', () => {
    expect(defaultSelectedDay(SEED_VISITS, TODAY)).toBe('2026-10-01');
    // Order does not matter.
    expect(defaultSelectedDay([...SEED_VISITS, visit('2026-10-05', { price_pence: 0 })].reverse(), TODAY)).toBe(
      '2026-10-05',
    );
    // A visit with nothing recorded is passed over.
    expect(defaultSelectedDay([...SEED_VISITS, visit('2026-10-05')], TODAY)).toBe('2026-10-01');
    expect(defaultSelectedDay([ticked(visit(TODAY), [0])], TODAY)).toBeNull();
    expect(defaultSelectedDay(SEED_VISITS.slice(1), TODAY)).toBeNull();
    expect(defaultSelectedDay([], TODAY)).toBeNull();
    // A future visit (bad data) is never chosen.
    expect(defaultSelectedDay([ticked(visit('2026-10-20'), [0])], TODAY)).toBeNull();
    // Another month: its latest visit.
    expect(defaultSelectedDay(SEED_VISITS, TODAY, '2026-09')).toBe('2026-09-24');
    expect(defaultSelectedDay(SEED_VISITS, TODAY, '2026-05')).toBeNull();
  });

  it('daySelectedAnnouncement: a visit, no visit, nothing recorded, today', () => {
    expect(daySelectedAnnouncement('2026-10-01', TODAY, SEED_VISITS[0])).toBe(
      'Thursday 1 October: 6 of 7 done, £60.00. Details below the calendar.',
    );
    expect(daySelectedAnnouncement('2026-10-05', TODAY, ticked(visit('2026-10-05'), [0, 1]))).toBe(
      'Monday 5 October: 2 of 7 done. Details below the calendar.',
    );
    expect(daySelectedAnnouncement('2026-10-06', TODAY, undefined)).toBe(
      'Tuesday 6 October: no visit recorded. Details below the calendar.',
    );
    expect(daySelectedAnnouncement('2026-10-06', TODAY, visit('2026-10-06'))).toBe(
      'Tuesday 6 October: nothing recorded yet. Details below the calendar.',
    );
    expect(daySelectedAnnouncement(TODAY, TODAY, ticked(visit(TODAY), [0]))).toBe(
      "Thursday 8 October: today's visit is above the calendar.",
    );
  });
});

describe('visits', () => {
  it('visitOn: found; not found; the right one among several months', () => {
    expect(visitOn(SEED_VISITS, '2026-09-17')).toBe(SEED_VISITS[2]);
    expect(visitOn(SEED_VISITS, '2026-09-18')).toBeUndefined();
    const months = [visit('2026-08-01'), visit('2026-09-01'), visit('2026-10-01')];
    expect(visitOn(months, '2026-09-01')?.id).toBe('v-2026-09-01');
    expect(visitOn([], TODAY)).toBeUndefined();
  });

  it('isRecorded: a tick, comments or a price (0 too); none of them is not a visit yet', () => {
    expect(isRecorded(ticked(visit(TODAY), [3]))).toBe(true);
    expect(isRecorded(visit(TODAY, { comments: 'Out of bin bags.' }))).toBe(true);
    expect(isRecorded(visit(TODAY, { price_pence: 0 }))).toBe(true);
    expect(isRecorded(visit(TODAY))).toBe(false);
    expect(isRecorded(visit(TODAY, { tasks: [] }))).toBe(false);
  });

  it('visitDays: only the month’s days, and only visits with something recorded', () => {
    const visits = [
      ticked(visit('2026-08-31'), [0]),
      ticked(visit('2026-09-03'), [0]),
      visit('2026-09-10'),
      visit('2026-09-30', { comments: 'Done.' }),
      ticked(visit('2026-10-01'), [0]),
    ];
    expect([...visitDays(visits, '2026-09')].sort()).toEqual(['2026-09-03', '2026-09-30']);
    expect(visitDays(visits, '2026-11').size).toBe(0);
    expect(visitDays([], '2026-09').size).toBe(0);
  });

  it('monthTotals: the e2e seed, unpriced and free visits, neighbours left out, none', () => {
    expect(monthTotals(SEED_VISITS, '2026-10')).toEqual({ visits: 1, pence: 6000, priced: 1 });
    expect(monthTotals(SEED_VISITS, '2026-09')).toEqual({ visits: 4, pence: 24000, priced: 4 });
    const mixed = [
      visit('2026-07-31', { price_pence: 9999 }),
      ticked(visit('2026-08-06', { price_pence: null }), [0]),
      visit('2026-08-13', { price_pence: 0 }),
      visit('2026-08-20', { price_pence: 4550 }),
      // Nothing recorded: not counted.
      visit('2026-08-27'),
      visit('2026-09-01', { price_pence: 9999 }),
    ];
    expect(monthTotals(mixed, '2026-08')).toEqual({ visits: 3, pence: 4550, priced: 2 });
    expect(monthTotals([], '2026-08')).toEqual({ visits: 0, pence: 0, priced: 0 });
  });

  it('monthSummary: each example', () => {
    expect(monthSummary({ visits: 4, pence: 18000, priced: 4 })).toBe('4 visits · £180.00');
    expect(monthSummary({ visits: 1, pence: 4500, priced: 1 })).toBe('1 visit · £45.00');
    expect(monthSummary({ visits: 2, pence: 0, priced: 0 })).toBe('2 visits');
    expect(monthSummary({ visits: 0, pence: 0, priced: 0 })).toBe('No visits');
    expect(monthSummary({ visits: 1, pence: 0, priced: 1 })).toBe('1 visit · £0.00');
    expect(monthSummary(monthTotals(SEED_VISITS, '2026-10'))).toBe('1 visit · £60.00');
    expect(monthSummary(monthTotals(SEED_VISITS, '2026-09'))).toBe('4 visits · £240.00');
  });

  it('doneCount: all, some, none, no tasks', () => {
    expect(doneCount(SEED_VISITS[1])).toEqual({ done: 7, total: 7 });
    expect(doneCount(SEED_VISITS[0])).toEqual({ done: 6, total: 7 });
    expect(doneCount(visit(TODAY))).toEqual({ done: 0, total: 7 });
    expect(doneCount(visit(TODAY, { tasks: [] }))).toEqual({ done: 0, total: 0 });
  });

  it('housekeepingSubtitle: today, the last visit, none; any order; future ignored', () => {
    expect(housekeepingSubtitle([ticked(visit(TODAY), [0]), ...SEED_VISITS], TODAY)).toBe("Today's visit");
    // Nothing recorded today (a tick taken back), or on a later empty visit: passed over.
    expect(housekeepingSubtitle([visit(TODAY), visit('2026-10-05'), ...SEED_VISITS], TODAY)).toBe('Last visit Thu 1 Oct');
    expect(housekeepingSubtitle([visit(TODAY)], TODAY)).toBe('Weekly');
    expect(housekeepingSubtitle(SEED_VISITS, TODAY)).toBe('Last visit Thu 1 Oct');
    expect(housekeepingSubtitle([...SEED_VISITS].reverse(), TODAY)).toBe('Last visit Thu 1 Oct');
    expect(housekeepingSubtitle([], TODAY)).toBe('Weekly');
    expect(housekeepingSubtitle([visit('2025-12-18', { price_pence: 5000 })], TODAY)).toBe('Last visit Thu 18 Dec 2025');
    expect(housekeepingSubtitle([ticked(visit('2026-10-15'), [0]), ...SEED_VISITS], TODAY)).toBe('Last visit Thu 1 Oct');
    expect(housekeepingSubtitle([ticked(visit('2026-10-15'), [0])], TODAY)).toBe('Weekly');
  });
});

describe('prices', () => {
  it('formatPrice: en-GB pounds and pence', () => {
    expect(formatPrice(6000)).toBe('£60.00');
    expect(formatPrice(123450)).toBe('£1,234.50');
    expect(formatPrice(0)).toBe('£0.00');
    expect(formatPrice(1)).toBe('£0.01');
    expect(formatPrice(HOUSEKEEPING_PRICE_MAX_PENCE)).toBe('£10,000.00');
    expect(formatPrice(1999)).toBe('£19.99');
    expect(formatPrice(29)).toBe('£0.29');
  });

  it('priceInputValue: what the field shows', () => {
    expect(priceInputValue(6000)).toBe('60.00');
    expect(priceInputValue(123450)).toBe('1234.50');
    expect(priceInputValue(null)).toBe('');
    expect(priceInputValue(0)).toBe('0.00');
    expect(priceInputValue(5)).toBe('0.05');
    expect(priceInputValue(HOUSEKEEPING_PRICE_MAX_PENCE)).toBe('10000.00');
  });

  it('parsePrice: blank clears', () => {
    expect(parsePrice('')).toEqual({ ok: true, pence: null });
    expect(parsePrice('   ')).toEqual({ ok: true, pence: null });
  });

  it.each([
    ['45', 4500],
    ['45.5', 4550],
    ['45.50', 4550],
    ['.5', 50],
    ['£45', 4500],
    ['£45.00', 4500],
    [' 45 ', 4500],
    [' £ 45 ', 4500],
    ['1,234.50', 123450],
    ['1,234', 123400],
    ['45,50', 4550],
    ['45,5', 4550],
    ['0', 0],
    ['0.00', 0],
    ['0.29', 29],
    ['19.99', 1999],
    ['0.01', 1],
    ['10000', 1000000],
    ['10000.00', 1000000],
    ['10,000.00', 1000000],
    ['007.5', 750],
    ['45.', 4500],
  ])('parsePrice accepts %j as %i pence', (text, pence) => {
    expect(parsePrice(text)).toEqual({ ok: true, pence });
  });

  it.each([
    'abc',
    '45p',
    'GBP 45',
    '-5',
    '-0.50',
    '45.505',
    '1.2.3',
    '45..5',
    '10000.01',
    '10001',
    '99999999999999999999',
    '4 5',
    '.',
    '£',
    '£-5',
    '1,23,456',
    '12,3456',
    '1,234,5',
    '1,234.5.6',
    '45$',
    '1e3',
    '0x10',
  ])('parsePrice rejects %j', (text) => {
    expect(parsePrice(text)).toEqual({ ok: false });
  });

  it('parsePrice and priceInputValue round-trip every price in range', () => {
    for (const pence of [0, 1, 9, 10, 99, 100, 101, 4550, 6000, 123450, 999999, HOUSEKEEPING_PRICE_MAX_PENCE]) {
      expect(parsePrice(priceInputValue(pence))).toEqual({ ok: true, pence });
      expect(parsePrice(formatPrice(pence))).toEqual({ ok: true, pence });
    }
  });
});

describe('checklist', () => {
  it('a day with a visit: its rows in order, with who ticked them', () => {
    const v = ticked(visit('2026-10-01'), [0]);
    const rows = checklistFor(data({ visits: [v] }), '2026-10-01');
    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual({
      key: 'task:t0',
      title: 'Change the bed sheets',
      done: true,
      doneBy: 'ela',
      doneAt: '2026-10-01T09:05:00Z',
      target: { taskId: 't0' },
    });
    expect(rows[1]).toMatchObject({ key: 'task:t1', done: false, doneBy: null, doneAt: null, target: { taskId: 't1' } });
  });

  it('a visit row whose task was deleted is named by its own id', () => {
    const v = visit('2026-10-01');
    v.tasks[6] = { ...v.tasks[6], task_id: null };
    const rows = checklistFor(data({ visits: [v] }), '2026-10-01');
    expect(rows[6]).toMatchObject({ key: `row:${v.tasks[6].id}`, title: 'Ironing', target: { visitTaskId: v.tasks[6].id } });
  });

  it('a visit keeps its own list, whatever the task list says now', () => {
    const v = visit('2026-10-01', { tasks: [row('v', 0, { title: 'Old name' })] });
    const rows = checklistFor(data({ visits: [v], tasks: tasks(['New name', 'Another']) }), '2026-10-01');
    expect(rows.map((r) => r.title)).toEqual(['Old name']);
  });

  it('a day without a visit: the task list in position order, unticked', () => {
    const list = tasks().reverse().map((t, i) => ({ ...t, position: 6 - i }));
    const rows = checklistFor(data({ tasks: list, visits: SEED_VISITS }), TODAY);
    expect(rows.map((r) => r.title)).toEqual(TITLES);
    expect(rows.every((r) => !r.done && r.doneBy === null && r.doneAt === null)).toBe(true);
    expect(rows.map((r) => r.key)).toEqual(TITLES.map((_, i) => `task:t${i}`));
    expect(rows.map((r) => r.target)).toEqual(TITLES.map((_, i) => ({ taskId: `t${i}` })));
  });

  it('no tasks and no visit gives nothing', () => {
    expect(checklistFor(emptyHousekeeping(), TODAY)).toEqual([]);
  });

  it('keys stay the same when the day’s visit is created', () => {
    const before = checklistFor(data(), TODAY).map((r) => r.key);
    const created = newVisit(data(), {
      id: 'v1',
      householdId: 'h1',
      date: TODAY,
      memberId: 'me',
      at: NOW.toISOString(),
      timeZone: TZ,
      rowId: (id) => `pending:${id}`,
    });
    expect(checklistFor(data({ visits: [created] }), TODAY).map((r) => r.key)).toEqual(before);
  });

  it('matchesTarget: both kinds of target; a taskId never matches a row without one', () => {
    const r = row('v', 2);
    expect(matchesTarget(r, { taskId: 't2' })).toBe(true);
    expect(matchesTarget(r, { taskId: 't3' })).toBe(false);
    expect(matchesTarget(r, { visitTaskId: r.id })).toBe(true);
    expect(matchesTarget(r, { visitTaskId: 'other' })).toBe(false);
    const orphan = row('v', 2, { task_id: null });
    expect(matchesTarget(orphan, { taskId: 't2' })).toBe(false);
    expect(matchesTarget(orphan, { taskId: null as unknown as string })).toBe(false);
    expect(matchesTarget(orphan, { visitTaskId: orphan.id })).toBe(true);
  });
});

describe('bylines', () => {
  /** 10:42 London time today. */
  const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+01:00`).toISOString();

  it('visitByline: recorded only', () => {
    const v = visit(TODAY, { created_at: at(TODAY, '10:42'), updated_at: at(TODAY, '10:42') });
    expect(visitByline(v, MEMBERS, TZ, NOW)).toBe('Recorded by 🦊 Ela · Today 10:42');
  });

  it('visitByline: updated later by someone else, or by the same person', () => {
    const v = visit(TODAY, { created_at: at(TODAY, '10:42'), updated_by: 'shea', updated_at: at(TODAY, '11:05') });
    expect(visitByline(v, MEMBERS, TZ, NOW)).toBe('Recorded by 🦊 Ela · Today 10:42 · Updated by 🦆 Shea · Today 11:05');
    const same = { ...v, updated_by: 'ela' };
    expect(visitByline(same, MEMBERS, TZ, NOW)).toBe('Recorded by 🦊 Ela · Today 10:42 · Updated by 🦊 Ela · Today 11:05');
  });

  it('visitByline: an update within the minute is left out', () => {
    const v = visit(TODAY, {
      created_at: '2026-10-08T09:42:00.000Z',
      updated_by: 'shea',
      updated_at: '2026-10-08T09:42:59.999Z',
    });
    expect(visitByline(v, MEMBERS, TZ, NOW)).toBe('Recorded by 🦊 Ela · Today 10:42');
    const minute = { ...v, updated_at: '2026-10-08T09:43:00.000Z' };
    expect(visitByline(minute, MEMBERS, TZ, NOW)).toBe('Recorded by 🦊 Ela · Today 10:42 · Updated by 🦆 Shea · Today 10:43');
  });

  it('visitByline: a former member', () => {
    const v = visit(TODAY, { created_by: null, created_at: at(TODAY, '10:42'), updated_by: 'gone', updated_at: at(TODAY, '12:00') });
    expect(visitByline(v, MEMBERS, TZ, NOW)).toBe(
      'Recorded by 👤 Former member · Today 10:42 · Updated by 👤 Former member · Today 12:00',
    );
  });

  it('visitByline: yesterday and an older day', () => {
    const yesterday = visit('2026-10-07', { created_at: at('2026-10-07', '19:20'), updated_at: at('2026-10-07', '19:20') });
    expect(visitByline(yesterday, MEMBERS, TZ, NOW)).toBe('Recorded by 🦊 Ela · Yesterday 19:20');
    const older = visit('2026-10-01', { created_at: at('2026-10-01', '10:05'), updated_at: at('2026-10-01', '10:11') });
    expect(visitByline(older, MEMBERS, TZ, NOW)).toBe(
      'Recorded by 🦊 Ela · Thu 1 Oct 10:05 · Updated by 🦊 Ela · Thu 1 Oct 10:11',
    );
  });

  it('visitByline: another time zone moves the day', () => {
    // 23:30 UTC on 7 Oct: 00:30 on 8 Oct in London, 19:30 on 7 Oct in New York.
    const v = visit(TODAY, { created_at: '2026-10-07T23:30:00Z', updated_at: '2026-10-07T23:30:00Z' });
    expect(visitByline(v, MEMBERS, 'Europe/London', NOW)).toBe('Recorded by 🦊 Ela · Today 00:30');
    expect(visitByline(v, MEMBERS, 'America/New_York', NOW)).toBe('Recorded by 🦊 Ela · Yesterday 19:30');
  });

  it('hasNewNote: someone else’s message, unseen or changed since; never your own or an empty one', () => {
    const note = { body: 'Spare room first.', updated_at: '2026-10-07T18:20:00Z', updated_by: 'shea' };
    expect(hasNewNote(note, 'me', null)).toBe(true);
    expect(hasNewNote(note, 'me', '2026-10-07T18:20:00Z')).toBe(false);
    expect(hasNewNote(note, 'me', '2026-10-08T09:00:00.000Z')).toBe(false);
    expect(hasNewNote(note, 'me', '2026-10-07T18:19:59Z')).toBe(true);
    // The same moment written two ways is the same moment.
    expect(hasNewNote(note, 'me', '2026-10-07T19:20:00+01:00')).toBe(false);
    expect(hasNewNote(note, 'shea', null)).toBe(false);
    expect(hasNewNote({ ...note, body: '' }, 'me', null)).toBe(false);
    expect(hasNewNote({ body: '', updated_at: null, updated_by: null }, 'me', null)).toBe(false);
  });

  it('noteByline: a message; empty; never written; a former member', () => {
    const note = { body: 'Spare room first.', updated_at: at('2026-10-07', '19:20'), updated_by: 'shea' };
    expect(noteByline(note, MEMBERS, TZ, NOW)).toBe('🦆 Shea · Yesterday 19:20');
    expect(noteByline({ ...note, body: '' }, MEMBERS, TZ, NOW)).toBeNull();
    expect(noteByline({ body: '', updated_at: null, updated_by: null }, MEMBERS, TZ, NOW)).toBeNull();
    expect(noteByline({ ...note, updated_by: null }, MEMBERS, TZ, NOW)).toBe('👤 Former member · Yesterday 19:20');
  });

  it('doneByline: same day; a later day; not done; a former member', () => {
    const r = row('v', 0, { done: true, done_by: 'ela', done_at: at('2026-10-01', '10:42') });
    expect(doneByline(r, '2026-10-01', MEMBERS, TZ, NOW)).toBe('🦊 Ela · 10:42');
    const later = { ...r, done_at: at('2026-10-02', '09:00') };
    expect(doneByline(later, '2026-10-01', MEMBERS, TZ, NOW)).toBe('🦊 Ela · Fri 2 Oct 09:00');
    expect(doneByline({ ...later, done_at: at(TODAY, '09:00') }, '2026-10-01', MEMBERS, TZ, NOW)).toBe('🦊 Ela · Today 09:00');
    expect(doneByline(row('v', 0), '2026-10-01', MEMBERS, TZ, NOW)).toBeNull();
    expect(doneByline({ ...r, done_by: null }, '2026-10-01', MEMBERS, TZ, NOW)).toBe('👤 Former member · 10:42');
  });
});

describe('optimistic edits', () => {
  const written = (iso: string) => ({ body: 'Spare room first.', updated_at: iso, updated_by: 'shea' });

  it('snapshotNote: copied when it stood on that day', () => {
    expect(snapshotNote(written('2026-10-07T18:20:00Z'), TODAY, TZ)).toBe('Spare room first.');
    expect(snapshotNote(written('2026-10-08T08:00:00Z'), TODAY, TZ)).toBe('Spare room first.');
    expect(snapshotNote(written('2026-10-08T08:00:00Z'), '2026-10-01', TZ)).toBe('');
    expect(snapshotNote({ body: '', updated_at: null, updated_by: null }, TODAY, TZ)).toBe('');
    // 23:30 UTC on 7 Oct is 00:30 on 8 Oct in London (BST): it changed on the 8th.
    expect(snapshotNote(written('2026-10-07T23:30:00Z'), '2026-10-07', TZ)).toBe('');
    expect(snapshotNote(written('2026-10-07T23:30:00Z'), TODAY, TZ)).toBe('Spare room first.');
    expect(snapshotNote(written('2026-10-07T23:30:00Z'), '2026-10-07', 'UTC')).toBe('Spare room first.');
  });

  const input = {
    id: 'pending:2026-10-08',
    householdId: 'h1',
    date: TODAY,
    memberId: 'me',
    at: NOW.toISOString(),
    timeZone: TZ,
    rowId: (id: string) => `pending:${id}`,
  };

  it('newVisit: copies the list in position order with the given ids, the note by the rule', () => {
    const list = tasks(['A', 'B', 'C']).map((t, i) => ({ ...t, position: [2, 0, 1][i] }));
    const hk = data({ tasks: list, note: written('2026-10-07T18:20:00Z') });
    const before = clone(hk);
    const v = newVisit(hk, input);
    expect(v).toEqual({
      id: 'pending:2026-10-08',
      household_id: 'h1',
      visit_date: TODAY,
      note: 'Spare room first.',
      comments: '',
      price_pence: null,
      created_by: 'me',
      created_at: NOW.toISOString(),
      updated_by: 'me',
      updated_at: NOW.toISOString(),
      tasks: [
        { id: 'pending:t1', visit_id: 'pending:2026-10-08', household_id: 'h1', task_id: 't1', title: 'B', position: 0, done: false, done_by: null, done_at: null },
        { id: 'pending:t2', visit_id: 'pending:2026-10-08', household_id: 'h1', task_id: 't2', title: 'C', position: 1, done: false, done_by: null, done_at: null },
        { id: 'pending:t0', visit_id: 'pending:2026-10-08', household_id: 'h1', task_id: 't0', title: 'A', position: 2, done: false, done_by: null, done_at: null },
      ],
    });
    expect(hk).toEqual(before);
    // The message changed after that day: not copied.
    expect(newVisit(hk, { ...input, date: '2026-10-01' }).note).toBe('');
  });

  it('newVisit: an empty task list gives no rows', () => {
    expect(newVisit(data({ tasks: [] }), input).tasks).toEqual([]);
  });

  describe('applyTick', () => {
    const at = '2026-10-08T09:30:00.000Z';
    const v = visit(TODAY);

    it('ticks one row, stamping who and when, and the visit', () => {
      const before = clone(v);
      const next = applyTick(v, { taskId: 't2' }, true, 'shea', at)!;
      expect(next.tasks[2]).toMatchObject({ done: true, done_by: 'shea', done_at: at });
      expect(next).toMatchObject({ updated_by: 'shea', updated_at: at });
      // Other rows untouched (the same objects), the input unchanged.
      next.tasks.forEach((r, i) => i !== 2 && expect(r).toBe(v.tasks[i]));
      expect(v).toEqual(before);
    });

    it('unticks, clearing who and when', () => {
      const done = ticked(v, [2]);
      const next = applyTick(done, { taskId: 't2' }, false, 'me', at)!;
      expect(next.tasks[2]).toMatchObject({ done: false, done_by: null, done_at: null });
      expect(next).toMatchObject({ updated_by: 'me', updated_at: at });
    });

    it('a row already in that state comes back as the same visit', () => {
      const done = ticked(v, [2]);
      expect(applyTick(done, { taskId: 't2' }, true, 'me', at)).toBe(done);
      expect(applyTick(v, { taskId: 't3' }, false, 'me', at)).toBe(v);
    });

    it('an unknown target is null', () => {
      expect(applyTick(v, { taskId: 'nope' }, true, 'me', at)).toBeNull();
      expect(applyTick(v, { visitTaskId: 'nope' }, true, 'me', at)).toBeNull();
    });

    it('a { visitTaskId } target ticks a row whose task is gone', () => {
      const orphaned = { ...v, tasks: v.tasks.map((r, i) => (i === 6 ? { ...r, task_id: null } : r)) };
      const next = applyTick(orphaned, { visitTaskId: orphaned.tasks[6].id }, true, 'me', at)!;
      expect(next.tasks[6]).toMatchObject({ done: true, done_by: 'me', task_id: null });
      expect(applyTick(orphaned, { taskId: 't6' }, true, 'me', at)).toBeNull();
    });
  });

  describe('applyVisitPatch', () => {
    const at = '2026-10-08T09:30:00.000Z';
    const v = visit(TODAY, { comments: 'Old', price_pence: 6000 });

    it('comments only, trimmed', () => {
      const next = applyVisitPatch(v, { comments: '  Out of bin bags.\n' }, 'shea', at);
      expect(next).toMatchObject({ comments: 'Out of bin bags.', price_pence: 6000, updated_by: 'shea', updated_at: at });
    });

    it('price only; null clears it', () => {
      expect(applyVisitPatch(v, { price_pence: 4550 }, 'me', at)).toMatchObject({ comments: 'Old', price_pence: 4550 });
      expect(applyVisitPatch(v, { price_pence: null }, 'me', at)).toMatchObject({ comments: 'Old', price_pence: null });
    });

    it('both', () => {
      expect(applyVisitPatch(v, { comments: 'New', price_pence: 0 }, 'me', at)).toMatchObject({ comments: 'New', price_pence: 0 });
    });

    it('an empty patch only stamps; the input is left alone', () => {
      const before = clone(v);
      const next = applyVisitPatch(v, {}, 'me', at);
      expect(next).toEqual({ ...v, updated_by: 'me', updated_at: at });
      expect(v).toEqual(before);
      expect(next.tasks).toBe(v.tasks);
    });
  });

  describe('task list edits', () => {
    const lastWeek = '2026-10-01';
    const hk = () => data({ visits: [visit(TODAY), visit(lastWeek)] });

    it('withTaskAdded: on the list and today’s visit, not last week’s', () => {
      const base = hk();
      const before = clone(base);
      const task = { id: 't7', household_id: 'h1', title: 'Windows', position: 7 };
      const next = withTaskAdded(base, task, TODAY);
      expect(next.tasks.at(-1)).toEqual(task);
      expect(next.visits[0].tasks.at(-1)).toEqual({
        id: 'pending:t7',
        visit_id: `v-${TODAY}`,
        household_id: 'h1',
        task_id: 't7',
        title: 'Windows',
        position: 7,
        done: false,
        done_by: null,
        done_at: null,
      });
      expect(next.visits[1]).toBe(base.visits[1]);
      expect(base).toEqual(before);
      // Added twice (the reload already brought it): once.
      const again = withTaskAdded(next, task, TODAY);
      expect(again.tasks.filter((t) => t.id === 't7')).toHaveLength(1);
      expect(again.visits[0].tasks.filter((r) => r.task_id === 't7')).toHaveLength(1);
    });

    it('withTaskAdded: no visit today', () => {
      const base = data({ visits: [visit(lastWeek)] });
      const next = withTaskAdded(base, { id: 't7', household_id: 'h1', title: 'Windows', position: 7 }, TODAY);
      expect(next.tasks).toHaveLength(8);
      expect(next.visits[0]).toBe(base.visits[0]);
    });

    it('withTaskRenamed: the list and today, trimmed; last week keeps the old title', () => {
      const base = hk();
      const before = clone(base);
      const next = withTaskRenamed(base, 't0', '  Bed sheets (all rooms) ', TODAY);
      expect(next.tasks[0].title).toBe('Bed sheets (all rooms)');
      expect(next.visits[0].tasks[0].title).toBe('Bed sheets (all rooms)');
      expect(next.visits[1].tasks[0].title).toBe('Change the bed sheets');
      expect(base).toEqual(before);
      expect(withTaskRenamed(base, 'nope', 'X', TODAY)).toBe(base);
    });

    it('withTaskRenamed: a row already ticked today keeps the title it was ticked under', () => {
      const base = data({ visits: [ticked(visit(TODAY), [6])] });
      const next = withTaskRenamed(base, 't6', 'Clean the windows', TODAY);
      expect(next.tasks[6].title).toBe('Clean the windows');
      expect(next.visits[0].tasks[6]).toMatchObject({ title: 'Ironing', task_id: 't6', done: true });
      // Nothing on today's visit follows: it stays the same object.
      expect(next.visits[0]).toBe(base.visits[0]);
    });

    it('withTaskDeleted: today drops an undone row, keeps a done one; earlier visits keep theirs', () => {
      const base = data({ visits: [ticked(visit(TODAY), [6]), visit(lastWeek)] });
      const before = clone(base);
      const bins = withTaskDeleted(base, 't5', TODAY);
      expect(bins.tasks.map((t) => t.id)).not.toContain('t5');
      expect(bins.visits[0].tasks.some((r) => r.title === 'Empty the bins')).toBe(false);
      expect(bins.visits[1].tasks.find((r) => r.title === 'Empty the bins')).toMatchObject({ task_id: null });

      const ironing = withTaskDeleted(base, 't6', TODAY);
      expect(ironing.visits[0].tasks.find((r) => r.title === 'Ironing')).toMatchObject({ task_id: null, done: true });
      expect(ironing.visits[1].tasks.find((r) => r.title === 'Ironing')).toMatchObject({ task_id: null, done: false });
      expect(base).toEqual(before);
      expect(withTaskDeleted(base, 'nope', TODAY)).toBe(base);
    });

    it('withTasksReordered: to the top; to the bottom; unknown ids; today follows, last week does not', () => {
      const base = hk();
      const before = clone(base);
      const ids = base.tasks.map((t) => t.id);

      const top = withTasksReordered(base, ['t6', ...ids.slice(0, 6)], TODAY);
      expect(top.tasks.map((t) => [t.id, t.position])).toEqual([
        ['t6', 0],
        ['t0', 1],
        ['t1', 2],
        ['t2', 3],
        ['t3', 4],
        ['t4', 5],
        ['t5', 6],
      ]);
      expect(top.visits[0].tasks.map((r) => r.title)).toEqual(['Ironing', ...TITLES.slice(0, 6)]);
      expect(top.visits[0].tasks.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(top.visits[1]).toBe(base.visits[1]);

      const bottom = withTasksReordered(base, [...ids.slice(1), 't0'], TODAY);
      expect(bottom.tasks.map((t) => t.id)).toEqual([...ids.slice(1), 't0']);
      expect(bottom.visits[0].tasks.at(-1)!.title).toBe('Change the bed sheets');

      // An unknown id takes its place in the order (like the database) and changes nothing else.
      const unknown = withTasksReordered(base, ['nope', 't1', 't0'], TODAY);
      expect(unknown.tasks.find((t) => t.id === 't1')!.position).toBe(1);
      expect(unknown.tasks.find((t) => t.id === 't0')!.position).toBe(2);
      expect(unknown.tasks.find((t) => t.id === 't2')!.position).toBe(2);
      expect(base).toEqual(before);
    });

    it('withTasksReordered: a row whose task is gone keeps its place among today’s rows', () => {
      const today = visit(TODAY);
      today.tasks[3] = { ...today.tasks[3], task_id: null, done: true };
      const base = data({ visits: [today] });
      const next = withTasksReordered(base, ['t6', 't0', 't1', 't2', 't4', 't5'], TODAY);
      const orphan = next.visits[0].tasks.find((r) => r.task_id === null)!;
      expect(orphan.position).toBe(3);
    });
  });
});
