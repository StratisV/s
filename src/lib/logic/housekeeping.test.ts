import { describe, expect, it } from 'vitest';
import { HOUSEKEEPING_PRICE_MAX_PENCE } from '../constants';
import type { HousekeepingData, HousekeepingSection, HousekeepingTask, HousekeepingVisit, HousekeepingVisitTask, Member } from '../types';
import {
  applyTick,
  applyVisitPatch,
  calendarDayLabel,
  canHaveVisit,
  checklistFor,
  checklistSections,
  daySelectedAnnouncement,
  doneByline,
  doneCount,
  emptyHousekeeping,
  formatPrice,
  hasNewNote,
  housekeepingSubtitle,
  isRecorded,
  listOrder,
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
  relayVisit,
  sectionDoneWords,
  sectionHeadingLabel,
  sectionProgress,
  shiftMonth,
  snapshotNote,
  taskListGroups,
  todayLine,
  visitByline,
  visitDays,
  visitOn,
  WEEKDAYS,
  withSectionAdded,
  withSectionDeleted,
  withSectionMoved,
  withSectionRenamed,
  withTaskAdded,
  withTaskDeleted,
  withTaskMoved,
  withTaskRenamed,
  withListSettled,
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
  return titles.map((title, i) => ({ id: `t${i}`, household_id: 'h1', title, section_id: null, position: i }));
}

function row(visitId: string, i: number, over: Partial<HousekeepingVisitTask> = {}): HousekeepingVisitTask {
  return {
    id: `${visitId}-r${i}`,
    visit_id: visitId,
    household_id: 'h1',
    task_id: `t${i}`,
    title: TITLES[i] ?? `Task ${i}`,
    section_id: null,
    section_title: '',
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
  return { note: { body: '', updated_at: null, updated_by: null }, sections: [], tasks: tasks(), visits: [], ...over };
}

/** Deep copy, to prove a function left its input alone. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const section = (id: string, title: string, position: number): HousekeepingSection => ({ id, household_id: 'h1', title, position });
const KITCHEN = section('s-kitchen', 'Kitchen', 0);
const BATH = section('s-bath', 'Bathrooms', 1);
const GARDEN = section('s-garden', 'Garden', 2);

/** The same items in another order (the backends' order is not what decides). */
const shuffle = <T>(items: T[]): T[] => [...items.slice(3), ...items.slice(0, 3).reverse()];

/**
 * The starter list in sections: Change the bed sheets, Hoover and mop the floors, Dust the
 * surfaces and Ironing in no section; Kitchen: Clean the kitchen, Empty the bins; Bathrooms:
 * Clean the bathrooms. List order: t0, t1, t4, t6, t3, t5, t2. With `today` and `lastWeek`,
 * visits that copied it (nothing ticked).
 */
function sectioned(opts: { sections?: HousekeepingSection[]; today?: boolean; lastWeek?: boolean } = {}): HousekeepingData {
  const place: Record<string, [string | null, number]> = {
    t0: [null, 0],
    t1: [null, 1],
    t4: [null, 2],
    t6: [null, 3],
    t3: [KITCHEN.id, 0],
    t5: [KITCHEN.id, 1],
    t2: [BATH.id, 0],
  };
  const list = tasks().map((t) => ({ ...t, section_id: place[t.id][0], position: place[t.id][1] }));
  const base = data({ sections: opts.sections ?? [KITCHEN, BATH], tasks: listOrder(opts.sections ?? [KITCHEN, BATH], list) });
  const copy = (date: string) =>
    newVisit(base, {
      id: `v-${date}`,
      householdId: 'h1',
      date,
      memberId: 'ela',
      at: `${date}T09:05:00Z`,
      timeZone: TZ,
      rowId: (id) => `v-${date}-${id}`,
    });
  const visits = [...(opts.today ? [copy(TODAY)] : []), ...(opts.lastWeek ? [copy('2026-10-01')] : [])];
  return { ...base, visits };
}

describe('empty state', () => {
  it('has no message, no sections, no tasks and no visits', () => {
    expect(emptyHousekeeping()).toEqual({ sections: [], note: { body: '', updated_at: null, updated_by: null }, tasks: [], visits: [] });
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
    // Today's details are under the calendar too, once a visit starts.
    expect(daySelectedAnnouncement(TODAY, TODAY, undefined)).toBe(
      'Thursday 8 October, today: not started yet. Details below the calendar.',
    );
    expect(daySelectedAnnouncement(TODAY, TODAY, visit(TODAY))).toBe(
      'Thursday 8 October, today: not started yet. Details below the calendar.',
    );
    expect(daySelectedAnnouncement(TODAY, TODAY, ticked(visit(TODAY), [0]))).toBe(
      'Thursday 8 October, today: 1 of 7 done. Details below the calendar.',
    );
  });

  it('todayLine: no visit, nothing recorded, ticks, a price, no tasks', () => {
    expect(todayLine(undefined)).toBe('No visit yet today');
    expect(todayLine(visit(TODAY))).toBe('No visit yet today');
    expect(todayLine(ticked(visit(TODAY), [0, 1, 2]))).toBe('3 of 7 done today');
    expect(todayLine(ticked(visit(TODAY, { price_pence: 6000 }), [0]))).toBe('1 of 7 done today · £60.00');
    expect(todayLine(visit(TODAY, { tasks: [], comments: 'Out of bin bags.' }))).toBe('Visit today');
    expect(todayLine(visit(TODAY, { tasks: [], price_pence: 4550 }))).toBe('Visit today · £45.50');
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

  it('visitDays: only the month’s days (all of them without one), and only visits with something recorded', () => {
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
    // A week strip across two months asks for any month.
    expect([...visitDays(visits)].sort()).toEqual(['2026-08-31', '2026-09-03', '2026-09-30', '2026-10-01']);
    expect(visitDays([]).size).toBe(0);
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

  it('newVisit: copies the list in its order with the given ids, the note by the rule', () => {
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
        { id: 'pending:t1', visit_id: 'pending:2026-10-08', household_id: 'h1', task_id: 't1', title: 'B', section_id: null, section_title: '', position: 0, done: false, done_by: null, done_at: null },
        { id: 'pending:t2', visit_id: 'pending:2026-10-08', household_id: 'h1', task_id: 't2', title: 'C', section_id: null, section_title: '', position: 1, done: false, done_by: null, done_at: null },
        { id: 'pending:t0', visit_id: 'pending:2026-10-08', household_id: 'h1', task_id: 't0', title: 'A', section_id: null, section_title: '', position: 2, done: false, done_by: null, done_at: null },
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
    const task7 = (over: Partial<HousekeepingTask> = {}): HousekeepingTask => ({
      id: 't7',
      household_id: 'h1',
      title: 'Windows',
      section_id: null,
      position: 7,
      ...over,
    });

    it('withTaskAdded: on the list and today’s visit, not last week’s', () => {
      const base = hk();
      const before = clone(base);
      const task = task7();
      const next = withTaskAdded(base, task, TODAY);
      expect(next.tasks.at(-1)).toEqual(task);
      expect(next.visits[0].tasks.at(-1)).toEqual({
        id: 'pending:t7',
        visit_id: `v-${TODAY}`,
        household_id: 'h1',
        task_id: 't7',
        title: 'Windows',
        section_id: null,
        section_title: '',
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

    it('withTaskAdded: into a section, in its place on the list and on today’s visit', () => {
      const base = sectioned({ today: true });
      const next = withTaskAdded(base, task7({ section_id: KITCHEN.id, position: 2 }), TODAY);
      expect(next.tasks.map((t) => t.id)).toEqual(['t0', 't1', 't4', 't6', 't3', 't5', 't7', 't2']);
      const today = visitOn(next.visits, TODAY)!;
      expect(today.tasks.map((r) => [r.task_id, r.section_title, r.position])).toEqual([
        ['t0', '', 0],
        ['t1', '', 1],
        ['t4', '', 2],
        ['t6', '', 3],
        ['t3', 'Kitchen', 4],
        ['t5', 'Kitchen', 5],
        ['t7', 'Kitchen', 6],
        ['t2', 'Bathrooms', 7],
      ]);
    });

    it('withTaskAdded: no visit today', () => {
      const base = data({ visits: [visit(lastWeek)] });
      const next = withTaskAdded(base, task7(), TODAY);
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

    it('withTaskDeleted: today’s done row stays in its section, after the others; last week’s keeps its place', () => {
      const base = sectioned({ today: true, lastWeek: true });
      const today = visitOn(base.visits, TODAY)!;
      today.tasks = today.tasks.map((r) => (r.task_id === 't3' ? { ...r, done: true, done_by: 'ela', done_at: NOW.toISOString() } : r));
      const next = withTaskDeleted(base, 't3', TODAY);
      expect(visitOn(next.visits, TODAY)!.tasks.map((r) => [r.title, r.section_title, r.position])).toEqual([
        ['Change the bed sheets', '', 0],
        ['Hoover and mop the floors', '', 1],
        ['Dust the surfaces', '', 2],
        ['Ironing', '', 3],
        ['Empty the bins', 'Kitchen', 4],
        ['Clean the kitchen', 'Kitchen', 5],
        ['Clean the bathrooms', 'Bathrooms', 6],
      ]);
      const before = visitOn(base.visits, lastWeek)!.tasks.find((r) => r.task_id === 't3')!;
      expect(visitOn(next.visits, lastWeek)!.tasks.find((r) => r.title === 'Clean the kitchen')).toEqual({ ...before, task_id: null });
    });

    /** Each task's section (by name) and place, in the list's order. */
    const placesOf = (hk: HousekeepingData) =>
      hk.tasks.map((t) => `${t.id} ${hk.sections.find((s) => s.id === t.section_id)?.title ?? '-'} ${t.position}`);

    it('withTaskMoved: within a section, down and up; the places run 0…n-1', () => {
      const base = sectioned({ sections: [KITCHEN, BATH, GARDEN] });
      const before = clone(base);
      const down = withTaskMoved(base, 't3', KITCHEN.id, 1, TODAY);
      expect(placesOf(down)).toEqual(['t0 - 0', 't1 - 1', 't4 - 2', 't6 - 3', 't5 Kitchen 0', 't3 Kitchen 1', 't2 Bathrooms 0']);
      const up = withTaskMoved(base, 't6', null, 0, TODAY);
      expect(placesOf(up).slice(0, 4)).toEqual(['t6 - 0', 't0 - 1', 't1 - 2', 't4 - 3']);
      expect(base).toEqual(before);
    });

    it('withTaskMoved: into another section at its start, in the middle and past its end; the section it left closes up', () => {
      const base = sectioned({ sections: [KITCHEN, BATH, GARDEN] });
      const start = withTaskMoved(base, 't5', BATH.id, 0, TODAY);
      expect(placesOf(start)).toEqual(['t0 - 0', 't1 - 1', 't4 - 2', 't6 - 3', 't3 Kitchen 0', 't5 Bathrooms 0', 't2 Bathrooms 1']);
      const middle = withTaskMoved(base, 't0', KITCHEN.id, 1, TODAY);
      expect(placesOf(middle)).toEqual(['t1 - 0', 't4 - 1', 't6 - 2', 't3 Kitchen 0', 't0 Kitchen 1', 't5 Kitchen 2', 't2 Bathrooms 0']);
      const end = withTaskMoved(base, 't1', KITCHEN.id, 99, TODAY);
      expect(placesOf(end).slice(3, 6)).toEqual(['t3 Kitchen 0', 't5 Kitchen 1', 't1 Kitchen 2']);
    });

    it('withTaskMoved: out of a section to the tasks in no section, and into an empty section', () => {
      const base = sectioned({ sections: [KITCHEN, BATH, GARDEN] });
      const out = withTaskMoved(base, 't2', null, 0, TODAY);
      expect(placesOf(out)).toEqual(['t2 - 0', 't0 - 1', 't1 - 2', 't4 - 3', 't6 - 4', 't3 Kitchen 0', 't5 Kitchen 1']);
      const garden = withTaskMoved(base, 't6', GARDEN.id, 0, TODAY);
      expect(placesOf(garden).at(-1)).toBe('t6 Garden 0');
    });

    it('withTaskMoved: only the task moved and the places in its two sections change (another move made meanwhile stands)', () => {
      const base = sectioned({ sections: [KITCHEN, BATH, GARDEN] });
      // Someone else's move (t6 into Garden) is already shown; this one (t0 into Bathrooms) keeps it.
      const both = withTaskMoved(withTaskMoved(base, 't6', GARDEN.id, 0, TODAY), 't0', BATH.id, 1, TODAY);
      expect(placesOf(both)).toEqual(['t1 - 0', 't4 - 1', 't3 Kitchen 0', 't5 Kitchen 1', 't2 Bathrooms 0', 't0 Bathrooms 1', 't6 Garden 0']);
      // Unknown task or section: as it was.
      expect(withTaskMoved(base, 'nope', KITCHEN.id, 0, TODAY)).toBe(base);
      expect(withTaskMoved(base, 't0', 'gone', 0, TODAY)).toBe(base);
    });

    it('withTaskMoved: today’s visit follows, a ticked row keeping its title; last week does not', () => {
      const base = sectioned({ today: true, lastWeek: true });
      const today = visitOn(base.visits, TODAY)!;
      today.tasks = today.tasks.map((r) => (r.task_id === 't6' ? { ...r, title: 'Ironing (old)', done: true, done_by: 'ela', done_at: NOW.toISOString() } : r));
      const next = withTaskMoved(base, 't6', KITCHEN.id, 0, TODAY);
      expect(visitOn(next.visits, TODAY)!.tasks.map((r) => [r.title, r.section_id, r.section_title, r.position, r.done])).toEqual([
        ['Change the bed sheets', null, '', 0, false],
        ['Hoover and mop the floors', null, '', 1, false],
        ['Dust the surfaces', null, '', 2, false],
        ['Ironing (old)', KITCHEN.id, 'Kitchen', 3, true],
        ['Clean the kitchen', KITCHEN.id, 'Kitchen', 4, false],
        ['Empty the bins', KITCHEN.id, 'Kitchen', 5, false],
        ['Clean the bathrooms', BATH.id, 'Bathrooms', 6, false],
      ]);
      expect(visitOn(next.visits, lastWeek)).toBe(visitOn(base.visits, lastWeek));
    });

  });

  describe('section edits', () => {
    const lastWeek = '2026-10-01';

    it('withSectionAdded: last; added twice is once', () => {
      const base = sectioned();
      const next = withSectionAdded(base, GARDEN);
      expect(next.sections.map((s) => s.title)).toEqual(['Kitchen', 'Bathrooms', 'Garden']);
      expect(withSectionAdded(next, GARDEN)).toBe(next);
    });

    it('withSectionRenamed: the list and today follow (ticked rows too); last week keeps the old name', () => {
      const base = sectioned({ today: true, lastWeek: true });
      const today = visitOn(base.visits, TODAY)!;
      today.tasks = today.tasks.map((r) => (r.task_id === 't3' ? { ...r, done: true, done_by: 'ela', done_at: NOW.toISOString() } : r));
      const before = clone(base);
      const next = withSectionRenamed(base, KITCHEN.id, '  Kitchen and dining ', TODAY);
      expect(next.sections[0].title).toBe('Kitchen and dining');
      expect(visitOn(next.visits, TODAY)!.tasks.filter((r) => r.section_id === KITCHEN.id).map((r) => r.section_title)).toEqual([
        'Kitchen and dining',
        'Kitchen and dining',
      ]);
      expect(visitOn(next.visits, lastWeek)!.tasks.filter((r) => r.section_id === KITCHEN.id).map((r) => r.section_title)).toEqual([
        'Kitchen',
        'Kitchen',
      ]);
      expect(base).toEqual(before);
      expect(withSectionRenamed(base, 'nope', 'X', TODAY)).toBe(base);
    });

    it('withSectionDeleted: its tasks move to the top in order, after those already there; today follows; last week keeps the name', () => {
      const base = sectioned({ today: true, lastWeek: true });
      const today = visitOn(base.visits, TODAY)!;
      // A ticked row whose task was deleted earlier today, in Kitchen.
      today.tasks = [...today.tasks, { ...row(today.id, 9, { task_id: null, title: 'Descale the kettle' }), section_id: KITCHEN.id, section_title: 'Kitchen', position: 9, done: true }];
      const before = clone(base);
      const next = withSectionDeleted(base, KITCHEN.id, TODAY);
      expect(next.sections.map((s) => s.id)).toEqual([BATH.id]);
      expect(next.tasks.map((t) => [t.id, t.section_id, t.position])).toEqual([
        ['t0', null, 0],
        ['t1', null, 1],
        ['t4', null, 2],
        ['t6', null, 3],
        ['t3', null, 4],
        ['t5', null, 5],
        ['t2', BATH.id, 0],
      ]);
      expect(visitOn(next.visits, TODAY)!.tasks.map((r) => [r.title, r.section_id, r.section_title, r.position])).toEqual([
        ['Change the bed sheets', null, '', 0],
        ['Hoover and mop the floors', null, '', 1],
        ['Dust the surfaces', null, '', 2],
        ['Ironing', null, '', 3],
        ['Clean the kitchen', null, '', 4],
        ['Empty the bins', null, '', 5],
        ['Descale the kettle', null, '', 6],
        ['Clean the bathrooms', BATH.id, 'Bathrooms', 7],
      ]);
      // Last week keeps the section by its name, in its place.
      const kept = visitOn(next.visits, lastWeek)!.tasks.filter((r) => r.section_title === 'Kitchen');
      expect(kept.map((r) => [r.title, r.section_id, r.position])).toEqual([
        ['Clean the kitchen', null, 4],
        ['Empty the bins', null, 5],
      ]);
      expect(checklistSections(next, lastWeek).map((g) => g.title)).toEqual([null, 'Kitchen', 'Bathrooms']);
      expect(base).toEqual(before);
      expect(withSectionDeleted(base, 'nope', TODAY)).toBe(base);
    });

    it('withSectionMoved: a section moved first brings its tasks; today follows, last week does not; unknown id', () => {
      const base = sectioned({ today: true, lastWeek: true });
      const before = clone(base);
      const next = withSectionMoved(base, BATH.id, 0, TODAY);
      expect(next.sections.map((s) => [s.title, s.position])).toEqual([
        ['Bathrooms', 0],
        ['Kitchen', 1],
      ]);
      expect(next.tasks.map((t) => t.id)).toEqual(['t0', 't1', 't4', 't6', 't2', 't3', 't5']);
      expect(visitOn(next.visits, TODAY)!.tasks.map((r) => r.task_id)).toEqual(['t0', 't1', 't4', 't6', 't2', 't3', 't5']);
      expect(visitOn(next.visits, lastWeek)).toBe(visitOn(base.visits, lastWeek));
      expect(base).toEqual(before);
      expect(withSectionMoved(base, 'nope', 0, TODAY)).toBe(base);
    });

    it('withSectionMoved: down one, and past the end is last; only the order changes', () => {
      const base = sectioned({ sections: [KITCHEN, BATH, GARDEN] });
      expect(withSectionMoved(base, KITCHEN.id, 1, TODAY).sections.map((s) => [s.title, s.position])).toEqual([
        ['Bathrooms', 0],
        ['Kitchen', 1],
        ['Garden', 2],
      ]);
      expect(withSectionMoved(base, KITCHEN.id, 99, TODAY).sections.map((s) => s.title)).toEqual(['Bathrooms', 'Garden', 'Kitchen']);
    });
  });
});

describe('sections and the list’s order', () => {
  it('listOrder: by position with no sections; no section first, then section by section', () => {
    const plain = tasks().reverse().map((t, i) => ({ ...t, position: 6 - i }));
    expect(listOrder([], plain).map((t) => t.id)).toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6']);
    const base = sectioned();
    const before = clone(base);
    expect(listOrder(base.sections, shuffle(base.tasks)).map((t) => t.id)).toEqual(['t0', 't1', 't4', 't6', 't3', 't5', 't2']);
    // Bathrooms first: its task comes before Kitchen's.
    const moved = [{ ...BATH, position: 0 }, { ...KITCHEN, position: 1 }];
    expect(listOrder(moved, base.tasks).map((t) => t.id)).toEqual(['t0', 't1', 't4', 't6', 't2', 't3', 't5']);
    // A task whose section is gone sorts with no section; equal positions keep their order.
    const odd = [...base.tasks, { ...tasks(['Gone'])[0], id: 'tg', section_id: 'gone', position: 1 }];
    expect(listOrder(base.sections, odd).map((t) => t.id)).toEqual(['t0', 't1', 'tg', 't4', 't6', 't3', 't5', 't2']);
    expect(base).toEqual(before);
  });

  it('taskListGroups: no section first (always), then every section in order, empty ones too', () => {
    expect(taskListGroups(data()).map((g) => [g.section, g.tasks.length])).toEqual([[null, 7]]);
    const base = sectioned({ sections: [KITCHEN, BATH, GARDEN] });
    expect(taskListGroups(base).map((g) => [g.section?.title ?? null, g.tasks.map((t) => t.id)])).toEqual([
      [null, ['t0', 't1', 't4', 't6']],
      ['Kitchen', ['t3', 't5']],
      ['Bathrooms', ['t2']],
      ['Garden', []],
    ]);
    // A task whose section is gone is in the first group.
    const odd = { ...base, tasks: [...base.tasks, { ...tasks(['Gone'])[0], id: 'tg', section_id: 'gone', position: 9 }] };
    expect(taskListGroups(odd)[0].tasks.map((t) => t.id)).toEqual(['t0', 't1', 't4', 't6', 'tg']);
    expect(taskListGroups(data({ tasks: [] }))).toEqual([{ section: null, tasks: [] }]);
  });

  it('relayVisit: rows follow their tasks’ sections, names and order; nothing to change gives the same visit', () => {
    const base = sectioned({ today: true });
    const today = visitOn(base.visits, TODAY)!;
    expect(relayVisit(today, base.sections, base.tasks)).toBe(today);
    const before = clone(today);
    const renamed = base.sections.map((s) => (s.id === KITCHEN.id ? { ...s, title: 'Cooking' } : s));
    const moved = base.tasks.map((t) => (t.id === 't0' ? { ...t, section_id: BATH.id, position: 1 } : t));
    const next = relayVisit(today, renamed, moved);
    expect(next.tasks.map((r) => [r.task_id, r.section_title, r.position])).toEqual([
      ['t1', '', 0],
      ['t4', '', 1],
      ['t6', '', 2],
      ['t3', 'Cooking', 3],
      ['t5', 'Cooking', 4],
      ['t2', 'Bathrooms', 5],
      ['t0', 'Bathrooms', 6],
    ]);
    expect(today).toEqual(before);
  });

  it('relayVisit: a row whose task is gone stays in its section, after the others, and has none once its section is gone', () => {
    const base = sectioned({ today: true });
    const today = visitOn(base.visits, TODAY)!;
    const orphan = { ...today.tasks[4], task_id: null, done: true }; // was Clean the kitchen
    const visitWithOrphan = { ...today, tasks: today.tasks.map((r, i) => (i === 4 ? orphan : r)) };
    const tasksLeft = base.tasks.filter((t) => t.id !== 't3');
    expect(relayVisit(visitWithOrphan, base.sections, tasksLeft).tasks.map((r) => [r.title, r.section_title])).toEqual([
      ['Change the bed sheets', ''],
      ['Hoover and mop the floors', ''],
      ['Dust the surfaces', ''],
      ['Ironing', ''],
      ['Empty the bins', 'Kitchen'],
      ['Clean the kitchen', 'Kitchen'],
      ['Clean the bathrooms', 'Bathrooms'],
    ]);
    const noKitchen = base.sections.filter((s) => s.id !== KITCHEN.id);
    const out = relayVisit(visitWithOrphan, noKitchen, tasksLeft.map((t) => (t.section_id === KITCHEN.id ? { ...t, section_id: null, position: 4 } : t)));
    expect(out.tasks.find((r) => r.task_id === null)).toMatchObject({ section_id: null, section_title: '', position: 5 });
  });

  it('checklistSections: no sections is one untitled group', () => {
    const groups = checklistSections(data(), TODAY);
    expect(groups.map((g) => [g.key, g.title, g.rows.length, g.done])).toEqual([['none', null, 7, 0]]);
    expect(checklistSections(emptyHousekeeping(), TODAY)).toEqual([]);
  });

  it('checklistSections: a day without a visit groups the list by its sections and leaves an empty one out', () => {
    const groups = checklistSections(sectioned({ sections: [KITCHEN, BATH, GARDEN] }), TODAY);
    expect(groups.map((g) => [g.key, g.title, g.rows.map((r) => r.key)])).toEqual([
      ['none', null, ['task:t0', 'task:t1', 'task:t4', 'task:t6']],
      [`section:${KITCHEN.id}`, 'Kitchen', ['task:t3', 'task:t5']],
      [`section:${BATH.id}`, 'Bathrooms', ['task:t2']],
    ]);
  });

  it('checklistSections: a visit keeps the sections and names it had; done counts; no section first', () => {
    const base = sectioned({ lastWeek: true });
    const last = visitOn(base.visits, '2026-10-01')!;
    last.tasks = last.tasks.map((r) => (r.task_id === 't3' || r.task_id === 't5' || r.task_id === 't1' ? { ...r, done: true } : r));
    // Since then: Kitchen renamed and moved after Bathrooms.
    const now = withSectionMoved(withSectionRenamed(base, KITCHEN.id, 'Cooking', TODAY), BATH.id, 0, TODAY);
    const groups = checklistSections(now, '2026-10-01');
    expect(groups.map((g) => [g.title, g.done, g.rows.length])).toEqual([
      [null, 1, 4],
      ['Kitchen', 2, 2],
      ['Bathrooms', 0, 1],
    ]);
    expect(checklistFor(now, '2026-10-01').map((r) => r.title)).toEqual([
      'Change the bed sheets',
      'Hoover and mop the floors',
      'Dust the surfaces',
      'Ironing',
      'Clean the kitchen',
      'Empty the bins',
      'Clean the bathrooms',
    ]);
    // Rows in no section come first even if a visit stored them later.
    const odd = { ...last, tasks: last.tasks.map((r) => (r.task_id === 't0' ? { ...r, position: 99 } : r)) };
    expect(checklistSections({ ...now, visits: [odd] }, '2026-10-01')[0].rows.at(-1)!.title).toBe('Change the bed sheets');
  });

  it('checklistSections: two deleted sections of the same name stay apart, in their places', () => {
    // A visit whose rows ran: no section, "New section", Kitchen, "New section", Kitchen
    // (each deleted since, so known only by name), then Bathrooms (still on the list).
    const v = visit('2026-10-06');
    const titles: [string | null, string][] = [
      [null, ''],
      [null, ''],
      [null, 'New section'],
      [null, 'Kitchen'],
      [null, 'New section'],
      [null, 'Kitchen'],
      [BATH.id, 'Bathrooms'],
    ];
    v.tasks = v.tasks.map((r, i) => ({ ...r, section_id: titles[i][0], section_title: titles[i][1], done: i === 4 }));
    const shown = checklistSections({ ...sectioned({ sections: [BATH] }), visits: [v] }, '2026-10-06');
    expect(shown.map((g) => [g.title, g.rows.map((r) => r.title), g.done])).toEqual([
      [null, ['Change the bed sheets', 'Hoover and mop the floors'], 0],
      ['New section', ['Clean the bathrooms'], 0],
      ['Kitchen', ['Clean the kitchen'], 0],
      ['New section', ['Dust the surfaces'], 1],
      ['Kitchen', ['Empty the bins'], 0],
      ['Bathrooms', ['Ironing'], 0],
    ]);
    // Each its own key, so React keeps them apart too.
    expect(new Set(shown.map((g) => g.key)).size).toBe(shown.length);
  });

  it('sectionProgress and sectionHeadingLabel', () => {
    expect(sectionProgress(2, 5)).toBe('2 of 5');
    expect(sectionProgress(0, 3)).toBe('0 of 3');
    expect(sectionProgress(3, 3)).toBe('All done');
    expect(sectionProgress(0, 1)).toBe('0 of 1');
    expect(sectionProgress(1, 1)).toBe('Done');
    expect(sectionHeadingLabel('Kitchen', 2, 5)).toBe('Kitchen, 2 of 5 done');
    expect(sectionHeadingLabel('Kitchen', 0, 5)).toBe('Kitchen, 0 of 5 done');
    expect(sectionHeadingLabel('Kitchen', 5, 5)).toBe('Kitchen, all 5 done');
    // One task: plain words, not "all 1 done".
    expect(sectionHeadingLabel('Bins', 1, 1)).toBe('Bins, done');
    expect(sectionHeadingLabel('Bins', 0, 1)).toBe('Bins, 0 of 1 done');
    expect(sectionDoneWords(2, 5)).toBe('2 of 5 done');
    expect(sectionDoneWords(5, 5)).toBe('all 5 done');
    expect(sectionDoneWords(1, 1)).toBe('done');
    expect(sectionDoneWords(0, 0)).toBe('0 of 0 done');
  });

  it('newVisit: copies the list section by section, with each section’s name', () => {
    const v = newVisit(sectioned(), {
      id: 'v1',
      householdId: 'h1',
      date: TODAY,
      memberId: 'me',
      at: NOW.toISOString(),
      timeZone: TZ,
      rowId: (id) => `pending:${id}`,
    });
    expect(v.tasks.map((r) => [r.task_id, r.section_id, r.section_title, r.position])).toEqual([
      ['t0', null, '', 0],
      ['t1', null, '', 1],
      ['t4', null, '', 2],
      ['t6', null, '', 3],
      ['t3', KITCHEN.id, 'Kitchen', 4],
      ['t5', KITCHEN.id, 'Kitchen', 5],
      ['t2', BATH.id, 'Bathrooms', 6],
    ]);
  });

  it('withListSettled: sorts the sections and the list, and lays out today only', () => {
    const before = sectioned({ today: true, lastWeek: true });
    // Kitchen moved after Bathrooms by hand, as a revert puts a position back.
    const moved = { ...before, sections: [{ ...KITCHEN, position: 5 }, BATH], tasks: shuffle(before.tasks) };
    const input = clone(moved);
    const next = withListSettled(moved, TODAY);
    expect(moved).toEqual(input);
    expect(next.sections.map((s) => s.id)).toEqual([BATH.id, KITCHEN.id]);
    expect(next.tasks.map((t) => t.id)).toEqual(['t0', 't1', 't4', 't6', 't2', 't3', 't5']);
    expect(visitOn(next.visits, TODAY)!.tasks.map((r) => [r.task_id, r.position])).toEqual([
      ['t0', 0],
      ['t1', 1],
      ['t4', 2],
      ['t6', 3],
      ['t2', 4],
      ['t3', 5],
      ['t5', 6],
    ]);
    expect(visitOn(next.visits, '2026-10-01')).toBe(visitOn(moved.visits, '2026-10-01'));
    // Nothing to change: today's visit is the same object.
    const settled = withListSettled(before, TODAY);
    expect(visitOn(settled.visits, TODAY)).toBe(visitOn(before.visits, TODAY));
  });
});
