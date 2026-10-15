import { describe, expect, it } from 'vitest';
import type { HousekeepingVisit, HousekeepingVisitTask, ISODate, Item } from '../types';
import {
  calendarDayAnnouncement,
  calendarDayName,
  calendarDays,
  calendarLookup,
  dayDots,
  dayOn,
  dayRows,
  EMPTY_DAY,
  isDated,
  isEmptyDay,
  lateItems,
  monthHeading,
  repeatDates,
  repeatMeta,
  visitSummary,
  weekHeading,
  weekName,
  weekTitle,
  type CalendarDay,
} from './calendar';
import { todayIn } from './dates';
import { nextDueDate } from './items';
import { monthName, monthRange, weekdayIndex, weekOf } from './months';

/** Thu 8 Oct 2026, the e2e clock's day. */
const TODAY = '2026-10-08';

function item(over: Partial<Item> & Pick<Item, 'id'>): Item {
  return {
    household_id: 'h1',
    area_id: 'a1',
    kind: 'task',
    title: over.id,
    note: '',
    good: '',
    rag: 'amber',
    due_date: '2026-10-16',
    assignee_id: null,
    repeat: 'none',
    notify: 'day_before',
    status: 'open',
    created_by: null,
    updated_by: null,
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
    ...over,
  };
}

function visit(date: ISODate, over: Partial<HousekeepingVisit> = {}, done = 6): HousekeepingVisit {
  const id = `v-${date}`;
  const tasks: HousekeepingVisitTask[] = Array.from({ length: 7 }, (_, i) => ({
    id: `${id}-${i}`,
    visit_id: id,
    household_id: 'h1',
    task_id: `t${i}`,
    title: `Task ${i}`,
    section_id: null,
    section_title: '',
    position: i,
    done: i < done,
    done_by: i < done ? 'ela' : null,
    done_at: i < done ? `${date}T09:05:00Z` : null,
  }));
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
    tasks,
    ...over,
  };
}

const day = (over: Partial<CalendarDay>): CalendarDay => ({ ...EMPTY_DAY, ...over });

describe('weeks', () => {
  it('weekdayIndex counts from Monday', () => {
    expect(weekdayIndex('2026-10-05')).toBe(0);
    expect(weekdayIndex('2026-10-11')).toBe(6);
    // The clocks go back in London that night: still a Sunday.
    expect(weekdayIndex('2026-10-25')).toBe(6);
  });

  it('weekOf gives Monday to Sunday', () => {
    const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
    expect(weekOf('2026-10-08')).toEqual(week);
    expect(weekOf('2026-10-05')).toEqual(week);
    expect(weekOf('2026-10-11')).toEqual(week);
    expect(weekOf('2026-10-01')).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(weekOf('2027-01-01')[0]).toBe('2026-12-28');
    expect(weekOf('2027-01-01')[6]).toBe('2027-01-03');
  });

  it('the weeks the clocks change in London are seven different days', () => {
    for (const date of ['2026-10-25', '2027-03-28']) {
      const week = weekOf(date);
      expect(new Set(week).size).toBe(7);
      expect(week[6]).toBe(date);
      expect(week.map(weekdayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    }
  });

  it('monthRange gives the first and last day', () => {
    expect(monthRange('2026-10')).toEqual(['2026-10-01', '2026-10-31']);
    expect(monthRange('2026-02')).toEqual(['2026-02-01', '2026-02-28']);
    expect(monthRange('2028-02')).toEqual(['2028-02-01', '2028-02-29']);
  });

  it('weekName names the week by its Monday', () => {
    expect(weekName('2026-10-05', TODAY)).toBe('Week of Monday 5 October');
    expect(weekName('2027-01-04', TODAY)).toBe('Week of Monday 4 January 2027');
  });

  it('weekTitle: the strip’s title, short month names across two months, the year when not today’s', () => {
    expect(weekTitle(weekOf('2026-10-08'), TODAY)).toBe('5 to 11 October');
    expect(weekTitle(weekOf('2026-10-01'), TODAY)).toBe('28 Sep to 4 Oct');
    expect(weekTitle(weekOf('2027-01-06'), TODAY)).toBe('4 to 10 January 2027');
    expect(weekTitle(weekOf('2026-12-30'), TODAY)).toBe('28 Dec to 3 Jan 2027');
    expect(weekTitle(weekOf('2026-12-30'), '2027-01-02')).toBe('28 Dec 2026 to 3 Jan');
    // The week the clocks go back in London: still Monday to Sunday.
    expect(weekTitle(weekOf('2026-10-25'), TODAY)).toBe('19 to 25 October');
  });

  it('weekHeading: this, next and last week in words, else how many weeks away', () => {
    expect(weekHeading('2026-10-05', TODAY)).toBe('This week');
    expect(weekHeading('2026-10-12', TODAY)).toBe('Next week');
    expect(weekHeading('2026-09-28', TODAY)).toBe('Last week');
    expect(weekHeading('2026-10-19', TODAY)).toBe('In 2 weeks');
    expect(weekHeading('2026-11-30', TODAY)).toBe('In 8 weeks');
    expect(weekHeading('2026-09-21', TODAY)).toBe('2 weeks ago');
    // Across the clocks going back (25 Oct): still whole weeks.
    expect(weekHeading('2026-11-02', TODAY)).toBe('In 4 weeks');
  });

  it('monthHeading: this, next and last month in words, else how many months away', () => {
    expect(monthHeading('2026-10', TODAY)).toBe('This month');
    expect(monthHeading('2026-11', TODAY)).toBe('Next month');
    expect(monthHeading('2026-09', TODAY)).toBe('Last month');
    expect(monthHeading('2026-12', TODAY)).toBe('In 2 months');
    expect(monthHeading('2027-01', TODAY)).toBe('In 3 months');
    expect(monthHeading('2026-07', TODAY)).toBe('3 months ago');
    expect(monthHeading('2027-01', '2026-12-31')).toBe('Next month');
  });

  it('monthName: the month without its year', () => {
    expect(monthName('2026-10-08')).toBe('October');
    expect(monthName('2027-01')).toBe('January');
  });
});

describe('isDated', () => {
  it('is an open To do with a due date', () => {
    expect(isDated(item({ id: 'a' }))).toBe(true);
    expect(isDated(item({ id: 'a', due_date: null }))).toBe(false);
    expect(isDated(item({ id: 'a', status: 'done' }))).toBe(false);
    expect(isDated(item({ id: 'a', kind: 'state', due_date: null }))).toBe(false);
    // Even a state that somehow kept a date stays off the calendar.
    expect(isDated(item({ id: 'a', kind: 'state' }))).toBe(false);
  });
});

describe('repeatDates', () => {
  it('weekly: every week after the due date, within the range', () => {
    const bins = { repeat: 'weekly' as const, due_date: '2026-10-13' };
    expect(repeatDates(bins, '2026-10-01', '2026-10-31', TODAY)).toEqual(['2026-10-20', '2026-10-27']);
    // The ends are included.
    expect(repeatDates(bins, '2026-10-20', '2026-10-27', TODAY)).toEqual(['2026-10-20', '2026-10-27']);
    // Never the due date itself.
    expect(repeatDates(bins, '2026-10-13', '2026-10-13', TODAY)).toEqual([]);
    // A range before the due date.
    expect(repeatDates(bins, '2026-09-01', '2026-09-30', TODAY)).toEqual([]);
  });

  it('monthly, quarterly, biannual and yearly', () => {
    expect(repeatDates({ repeat: 'monthly', due_date: '2026-10-20' }, '2026-11-01', '2027-01-31', TODAY)).toEqual([
      '2026-11-20',
      '2026-12-20',
      '2027-01-20',
    ]);
    expect(repeatDates({ repeat: 'quarterly', due_date: '2026-11-02' }, '2026-11-01', '2027-08-31', TODAY)).toEqual([
      '2027-02-02',
      '2027-05-02',
      '2027-08-02',
    ]);
    expect(repeatDates({ repeat: 'biannual', due_date: '2026-11-02' }, '2026-11-01', '2027-12-31', TODAY)).toEqual([
      '2027-05-02',
      '2027-11-02',
    ]);
    expect(repeatDates({ repeat: 'yearly', due_date: '2026-11-02' }, '2026-01-01', '2028-12-31', TODAY)).toEqual([
      '2027-11-02',
      '2028-11-02',
    ]);
  });

  it('clamps to the month end and carries on from there, as completing does', () => {
    const from31 = { repeat: 'monthly' as const, due_date: '2027-01-31' };
    expect(repeatDates(from31, '2027-01-01', '2027-04-30', TODAY)).toEqual(['2027-02-28', '2027-03-28', '2027-04-28']);
    // The same dates completing it on time, one after another, gives.
    let due: string | null = '2027-01-31';
    const chain: string[] = [];
    for (let i = 0; i < 3; i++) {
      due = nextDueDate('monthly', due, TODAY);
      chain.push(due!);
    }
    expect(chain).toEqual(['2027-02-28', '2027-03-28', '2027-04-28']);
    expect(repeatDates({ repeat: 'yearly', due_date: '2028-02-29' }, '2028-01-01', '2030-12-31', TODAY)).toEqual([
      '2029-02-28',
      '2030-02-28',
    ]);
  });

  it('a missed item comes round from today, as Mark as Done would move it', () => {
    // Due Tue 6 Oct, missed: done today it moves to Tue 13 Oct (one week after its date).
    expect(repeatDates({ repeat: 'weekly', due_date: '2026-10-06' }, '2026-10-01', '2026-10-31', TODAY)).toEqual([
      '2026-10-13',
      '2026-10-20',
      '2026-10-27',
    ]);
    // Due 1 Sep, a week after is still past: one week after today, a Thursday.
    expect(repeatDates({ repeat: 'weekly', due_date: '2026-09-01' }, '2026-10-01', '2026-10-31', TODAY)).toEqual([
      '2026-10-15',
      '2026-10-22',
      '2026-10-29',
    ]);
  });

  it('nothing for an item that does not repeat or has no date', () => {
    expect(repeatDates({ repeat: 'none', due_date: '2026-10-13' }, '2026-10-01', '2026-12-31', TODAY)).toEqual([]);
    expect(repeatDates({ repeat: 'weekly', due_date: null }, '2026-10-01', '2026-12-31', TODAY)).toEqual([]);
    expect(repeatDates({ repeat: 'weekly', due_date: '2026-10-13' }, '2026-10-31', '2026-10-01', TODAY)).toEqual([]);
  });

  it('keeps its weekday across the clock changes in London', () => {
    // Sunday 18 Oct 2026, weekly: the clocks go back on 25 Oct, forward on 28 Mar 2027.
    const sundays = repeatDates({ repeat: 'weekly', due_date: '2026-10-18' }, '2026-10-19', '2026-11-08', TODAY);
    expect(sundays).toEqual(['2026-10-25', '2026-11-01', '2026-11-08']);
    const spring = repeatDates({ repeat: 'weekly', due_date: '2026-10-18' }, '2027-03-20', '2027-04-05', TODAY);
    expect(spring).toEqual(['2027-03-21', '2027-03-28', '2027-04-04']);
    for (const d of [...sundays, ...spring]) expect(weekdayIndex(d)).toBe(6);
  });

  it('today in London around the clock changes, then the repeats from it', () => {
    // 00:30 on Sunday 25 Oct in London is still Saturday 24 Oct in UTC.
    const today = todayIn('Europe/London', new Date('2026-10-24T23:30:00Z'));
    expect(today).toBe('2026-10-25');
    // Missed by a fortnight: done today, next Sunday, then every Sunday.
    expect(repeatDates({ repeat: 'weekly', due_date: '2026-10-11' }, '2026-10-25', '2026-11-08', today)).toEqual([
      '2026-11-01',
      '2026-11-08',
    ]);
    // 00:30 on Sunday 28 Mar 2027 (still GMT) and 01:30 BST that morning are the same day.
    expect(todayIn('Europe/London', new Date('2027-03-28T00:30:00Z'))).toBe('2027-03-28');
    expect(todayIn('Europe/London', new Date('2027-03-28T00:59:00Z'))).toBe('2027-03-28');
    expect(todayIn('Europe/London', new Date('2027-03-27T23:59:00Z'))).toBe('2027-03-27');
  });
});

describe('calendarDays', () => {
  const [from, to] = monthRange('2026-10');

  it('puts items on their due date, as due or missed', () => {
    const heaters = item({ id: 'heaters', rag: 'red', due_date: '2026-10-06' });
    const strips = item({ id: 'strips', due_date: '2026-10-12' });
    const today = item({ id: 'today', rag: 'green', due_date: TODAY });
    const days = calendarDays([heaters, strips, today], [], from, to, TODAY);
    expect(dayOn(days, '2026-10-06')).toEqual(day({ missed: [heaters] }));
    expect(dayOn(days, '2026-10-12')).toEqual(day({ due: [strips] }));
    // Due today is due, not missed.
    expect(dayOn(days, TODAY)).toEqual(day({ due: [today] }));
    expect(dayOn(days, '2026-10-07')).toBe(EMPTY_DAY);
    expect([...days.keys()].sort()).toEqual(['2026-10-06', '2026-10-08', '2026-10-12']);
  });

  it('a state, a done item and an undated one leave no mark', () => {
    const days = calendarDays(
      [
        item({ id: 'firepit', kind: 'state', due_date: null }),
        item({ id: 'done', status: 'done' }),
        item({ id: 'undated', due_date: null }),
      ],
      [],
      from,
      to,
      TODAY,
    );
    expect(days.size).toBe(0);
  });

  it('marks repeats after the due date only, and keeps the order given', () => {
    const bins = item({ id: 'bins', rag: 'green', repeat: 'weekly', due_date: '2026-10-13' });
    const filter = item({ id: 'filter', repeat: 'monthly', due_date: '2026-10-20' });
    const mirror = item({ id: 'mirror', due_date: '2026-10-20' });
    const days = calendarDays([filter, mirror, bins], [], from, to, TODAY);
    expect(dayOn(days, '2026-10-13')).toEqual(day({ due: [bins] }));
    expect(dayOn(days, '2026-10-20')).toEqual(day({ due: [filter, mirror], repeats: [bins] }));
    expect(dayOn(days, '2026-10-27')).toEqual(day({ repeats: [bins] }));
    // The filter's next repeat is in November: outside the range.
    expect(dayOn(days, '2026-11-20')).toBe(EMPTY_DAY);
    const november = calendarDays([filter], [], ...monthRange('2026-11'), TODAY);
    expect(dayOn(november, '2026-11-20')).toEqual(day({ repeats: [filter] }));
  });

  it('marks recorded visits only, within the range', () => {
    const oct1 = visit('2026-10-01', { price_pence: 6000 });
    const blank = visit('2026-10-06', {}, 0);
    const sep24 = visit('2026-09-24');
    const days = calendarDays([], [oct1, blank, sep24], from, to, TODAY);
    expect(dayOn(days, '2026-10-01')).toEqual(day({ visit: oct1 }));
    expect(dayOn(days, '2026-10-06')).toBe(EMPTY_DAY);
    expect(days.size).toBe(1);
  });

  it('days outside the range are left out', () => {
    const days = calendarDays([item({ id: 'late', due_date: '2026-11-02' })], [], from, to, TODAY);
    expect(days.size).toBe(0);
  });

  it('isEmptyDay', () => {
    expect(isEmptyDay(EMPTY_DAY)).toBe(true);
    expect(isEmptyDay(day({ visit: visit('2026-10-01') }))).toBe(false);
    expect(isEmptyDay(day({ repeats: [item({ id: 'r' })] }))).toBe(false);
  });
});

describe('calendarLookup', () => {
  const bins = item({ id: 'bins', rag: 'green', repeat: 'weekly', due_date: '2026-10-27' });
  const heaters = item({ id: 'heaters', rag: 'red', due_date: '2026-10-06' });
  const oct1 = visit('2026-10-01', { price_pence: 6000 });

  it('answers as calendarDays() over the month', () => {
    const lookup = calendarLookup([bins, heaters], [oct1], TODAY);
    const october = calendarDays([bins, heaters], [oct1], ...monthRange('2026-10'), TODAY);
    for (let d = 1; d <= 31; d++) {
      const date = `2026-10-${String(d).padStart(2, '0')}`;
      expect(lookup(date)).toEqual(dayOn(october, date));
    }
    // The same object each time.
    expect(lookup('2026-10-06')).toBe(lookup('2026-10-06'));
  });

  it('a week across two months', () => {
    const lookup = calendarLookup([bins], [], TODAY);
    const week = weekOf('2026-11-01').map(lookup);
    expect(week[1]).toEqual(day({ due: [bins] }));
    expect(week.filter((d) => d !== EMPTY_DAY)).toHaveLength(1);
    expect(lookup('2026-11-03')).toEqual(day({ repeats: [bins] }));
  });
});

describe('dayDots', () => {
  it('none for an empty day', () => {
    expect(dayDots(EMPTY_DAY)).toEqual({ dots: [], more: 0 });
  });

  it('red, then amber, then green', () => {
    const d = day({
      due: [item({ id: 'g', rag: 'green' }), item({ id: 'a', rag: 'amber' }), item({ id: 'r', rag: 'red' })],
    });
    expect(dayDots(d)).toEqual({
      dots: [
        { rag: 'red', repeat: false },
        { rag: 'amber', repeat: false },
        { rag: 'green', repeat: false },
      ],
      more: 0,
    });
  });

  it('at most three, and how many more', () => {
    const d = day({ missed: ['green', 'amber', 'amber', 'red'].map((rag, i) => item({ id: `m${i}`, rag: rag as Item['rag'] })) });
    expect(dayDots(d)).toEqual({
      dots: [
        { rag: 'red', repeat: false },
        { rag: 'amber', repeat: false },
        { rag: 'amber', repeat: false },
      ],
      more: 1,
    });
  });

  it('repeats come after the items due, faint', () => {
    const d = day({ due: [item({ id: 'a', rag: 'green' })], repeats: [item({ id: 'b', rag: 'green' }), item({ id: 'c', rag: 'red' })] });
    expect(dayDots(d).dots).toEqual([
      { rag: 'green', repeat: false },
      { rag: 'red', repeat: true },
      { rag: 'green', repeat: true },
    ]);
    expect(dayDots(day({ repeats: [item({ id: 'b' })] })).dots).toEqual([{ rag: 'amber', repeat: true }]);
  });
});

describe('dayRows', () => {
  it('lists a day in the order of its marks: missed first, then red, amber, green, ties in the order given', () => {
    const shower = item({ id: 'shower', rag: 'amber' });
    const cover = item({ id: 'cover', rag: 'green' });
    const bins = item({ id: 'bins', rag: 'green' });
    const gutters = item({ id: 'gutters', rag: 'red' });
    expect(dayRows(day({ due: [shower, cover, bins, gutters] })).rows.map((i) => i.id)).toEqual([
      'gutters',
      'shower',
      'cover',
      'bins',
    ]);
    const old = item({ id: 'old', rag: 'green' });
    expect(dayRows(day({ missed: [old], due: [gutters] })).rows.map((i) => i.id)).toEqual(['old', 'gutters']);
    const r1 = item({ id: 'r1', rag: 'green' });
    const r2 = item({ id: 'r2', rag: 'red' });
    expect(dayRows(day({ repeats: [r1, r2] })).repeats.map((i) => i.id)).toEqual(['r2', 'r1']);
    expect(dayRows(EMPTY_DAY)).toEqual({ rows: [], repeats: [] });
  });
});

describe('lateItems', () => {
  it('lists the open To dos due before today, most urgent first, then the longest late', () => {
    const heaters = item({ id: 'heaters', rag: 'red', due_date: '2026-10-06' });
    const older = item({ id: 'older', rag: 'green', due_date: '2026-09-30' });
    const amber = item({ id: 'amber', rag: 'amber', due_date: '2026-10-07' });
    const amberOlder = item({ id: 'amberOlder', rag: 'amber', due_date: '2026-10-01' });
    const today = item({ id: 'today', rag: 'red', due_date: TODAY });
    const future = item({ id: 'future', due_date: '2026-10-20' });
    const undated = item({ id: 'undated', rag: 'red', due_date: null });
    const done = item({ id: 'done', due_date: '2026-10-01', status: 'done' });
    const state = item({ id: 'state', kind: 'state', rag: 'red', due_date: null });
    const all = [older, amber, today, heaters, future, undated, done, state, amberOlder];
    expect(lateItems(all, TODAY).map((i) => i.id)).toEqual(['heaters', 'amberOlder', 'amber', 'older']);
    expect(lateItems([today, future, undated], TODAY)).toEqual([]);
  });
});

describe('names and announcements', () => {
  const three = [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })];

  const urgent = item({ id: 'u', rag: 'red' });
  const green = (id: string) => item({ id, rag: 'green' });

  it('names each day with what it holds, the colours of its dots in words', () => {
    expect(calendarDayName('2026-10-16', TODAY, day({ due: three, visit: visit('2026-10-16') }))).toBe(
      'Friday 16 October, 3 due (within the month), housekeeping visit',
    );
    // Mixed: how many of each, most urgent first.
    expect(calendarDayName('2026-10-16', TODAY, day({ due: [green('g1'), three[0], green('g2'), urgent] }))).toBe(
      'Friday 16 October, 4 due (1 urgent, 1 within the month, 2 not urgent)',
    );
    expect(calendarDayName('2026-10-06', TODAY, day({ missed: [urgent] }))).toBe('Tuesday 6 October, 1 missed (urgent)');
    expect(calendarDayName(TODAY, TODAY, EMPTY_DAY, true)).toBe('Thursday 8 October, today, selected');
    expect(calendarDayName('2026-10-20', TODAY, day({ due: [green('g1'), green('g2')], repeats: [three[2]] }))).toBe(
      'Tuesday 20 October, 2 due (not urgent), 1 repeat',
    );
    expect(calendarDayName('2026-10-27', TODAY, day({ repeats: three.slice(0, 2) }), true)).toBe(
      'Tuesday 27 October, 2 repeats, selected',
    );
    expect(calendarDayName('2027-01-09', TODAY, EMPTY_DAY)).toBe('Saturday 9 January 2027');
  });

  it('announces a chosen day', () => {
    expect(calendarDayAnnouncement('2026-10-16', TODAY, day({ due: three, repeats: [three[0]] }))).toBe(
      'Friday 16 October: 3 due (within the month), 1 repeat. Details below the calendar.',
    );
    expect(calendarDayAnnouncement(TODAY, TODAY, EMPTY_DAY)).toBe(
      'Thursday 8 October, today: nothing due. Details below the calendar.',
    );
    expect(calendarDayAnnouncement('2026-10-06', TODAY, day({ missed: [urgent], visit: visit('2026-10-06') }))).toBe(
      'Tuesday 6 October: 1 missed (urgent), housekeeping visit. Details below the calendar.',
    );
    // Today lists what is late first, so it says that first.
    expect(calendarDayAnnouncement(TODAY, TODAY, day({ due: [green('g1')] }), [urgent])).toBe(
      'Thursday 8 October, today: 1 late (urgent), 1 due (not urgent). Details below the calendar.',
    );
    expect(calendarDayAnnouncement(TODAY, TODAY, EMPTY_DAY, [urgent, three[0]])).toBe(
      'Thursday 8 October, today: 2 late (1 urgent, 1 within the month). Details below the calendar.',
    );
  });

  it('describes a repeat', () => {
    expect(repeatMeta({ repeat: 'weekly', due_date: '2026-10-13' }, TODAY)).toEqual({
      when: 'Repeat of Tue 13 Oct',
      every: 'Every week',
    });
    expect(repeatMeta({ repeat: 'quarterly', due_date: '2026-11-02' }, TODAY)).toEqual({
      when: 'Repeat of Mon 2 Nov',
      every: 'Every 3 months',
    });
    expect(repeatMeta({ repeat: 'monthly', due_date: '2026-10-06' }, TODAY)).toEqual({
      when: 'Repeat of Tue 6 Oct, missed',
      every: 'Every month',
    });
    expect(repeatMeta({ repeat: 'yearly', due_date: null }, TODAY)).toEqual({ when: 'Repeat', every: 'Every year' });
    expect(repeatMeta({ repeat: 'none', due_date: '2026-10-06' }, TODAY)).toEqual({ when: '', every: '' });
  });

  it('sums up a visit', () => {
    expect(visitSummary(visit('2026-10-01', { price_pence: 6000 }))).toBe('6 of 7 done · £60.00');
    expect(visitSummary(visit('2026-10-01', {}, 7))).toBe('7 of 7 done');
  });
});
