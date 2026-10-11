// Months and weeks for the calendars (Home's and Housekeeping's, src/ui/MonthCalendar.tsx):
// Monday first, en-GB names. Pure date arithmetic on ISODate days (no clock, no time zone:
// a day is a day, whatever the clocks do).
//
// Each function's doc comment is its spec. The ones that came from Housekeeping are
// re-exported by src/lib/logic/housekeeping.ts and tested in housekeeping.test.ts; the
// week helpers are tested in src/lib/logic/calendar.test.ts.

import type { ISODate } from '../types';
import { addDays, parseISODate } from './dates';

/** A calendar month, `YYYY-MM`. */
export type YearMonth = string;

const pad = (n: number) => String(n).padStart(2, '0');

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Sunday first, as Date.getUTCDay() counts. */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Column headers of the month grid, Monday first: the letter shown and the name read out. */
export const WEEKDAYS: readonly { short: string; long: string }[] = [
  { short: 'M', long: 'Monday' },
  { short: 'T', long: 'Tuesday' },
  { short: 'W', long: 'Wednesday' },
  { short: 'T', long: 'Thursday' },
  { short: 'F', long: 'Friday' },
  { short: 'S', long: 'Saturday' },
  { short: 'S', long: 'Sunday' },
];

function parseMonth(month: YearMonth): { y: number; m: number } {
  const [y, m] = month.split('-').map(Number);
  return { y, m };
}

/**
 * The month a day is in: `monthOf('2026-10-08')` is `'2026-10'`.
 * Tests: a mid-month day; the 1st and the last day of a month; 31 Dec.
 */
export function monthOf(date: ISODate): YearMonth {
  return date.slice(0, 7);
}

/**
 * The month `n` months after `month` (before, for negative n):
 * `shiftMonth('2026-12', 1)` is `'2027-01'`, `shiftMonth('2026-01', -1)` is `'2025-12'`.
 * Tests: +1 and -1 inside a year; across a year end both ways; n = 0; n = ±13.
 */
export function shiftMonth(month: YearMonth, n: number): YearMonth {
  const { y, m } = parseMonth(month);
  const total = y * 12 + (m - 1) + Math.trunc(n);
  const year = Math.floor(total / 12);
  const index = total - year * 12;
  return `${year}-${pad(index + 1)}`;
}

/**
 * The month's name, without the year: `monthName('2026-10-08')` is `'October'` (a day or a month).
 * Tests: October; January.
 */
export function monthName(dateOrMonth: ISODate | YearMonth): string {
  return MONTH_NAMES[Number(dateOrMonth.slice(5, 7)) - 1];
}

/**
 * The month's heading, `'October 2026'` (en-GB, always with the year).
 * Tests: October 2026; January; a different year.
 */
export function monthTitle(month: YearMonth): string {
  const { y, m } = parseMonth(month);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/**
 * The month as weeks of seven days, Monday first. Days of the month are ISODates; the
 * cells before the 1st and after the last day are null. 4 to 6 weeks, each exactly 7 cells.
 * Tests: Oct 2026 (starts Thu: 3 nulls, 5 weeks); Feb 2021 (starts Mon, 28 days: exactly
 * 4 full weeks, no nulls); Aug 2026 (starts Sat, 31 days: 6 weeks); a leap February
 * (2028-02 has 29 days); a month ending on a Sunday has no trailing nulls; every date of
 * the month appears once, in order.
 */
export function monthGrid(month: YearMonth): (ISODate | null)[][] {
  const { y, m } = parseMonth(month);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Monday = 0 … Sunday = 6.
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (ISODate | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${y}-${pad(m)}-${pad(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (ISODate | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The first and last day of a month: `monthRange('2026-02')` is `['2026-02-01', '2026-02-28']`. */
export function monthRange(month: YearMonth): [ISODate, ISODate] {
  const { y, m } = parseMonth(month);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(days)}`];
}

/**
 * A day's place in its week, Monday first: 0 for a Monday … 6 for a Sunday.
 * Tests: Mon 5 Oct 2026 is 0; Sun 11 Oct 2026 is 6; Sun 25 Oct 2026 (the clocks go back
 * in London) is 6.
 */
export function weekdayIndex(date: ISODate): number {
  const { y, m, d } = parseISODate(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * The seven days of the week a day is in, Monday to Sunday.
 * Tests: Thu 8 Oct 2026 gives 5 to 11 Oct; a Monday and a Sunday give their own week; a
 * week across a month end (28 Sep to 4 Oct) and a year end; the weeks the clocks change
 * in London (19 to 25 Oct 2026, 22 to 28 Mar 2027) are seven different days.
 */
export function weekOf(date: ISODate): ISODate[] {
  const monday = addDays(date, -weekdayIndex(date));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/**
 * A day written out for headings and accessible names, `'Thursday 1 October'`, with the
 * year when it is not today's year (`'Thursday 31 December 2025'`). Housekeeping exports
 * it as `longDay`.
 * Tests: same year; a different year; the 1st of a month.
 */
export function fullDay(date: ISODate, today: ISODate): string {
  const { y, m, d } = parseISODate(date);
  const weekday = DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const base = `${weekday} ${d} ${MONTH_NAMES[m - 1]}`;
  return parseISODate(today).y === y ? base : `${base} ${y}`;
}
