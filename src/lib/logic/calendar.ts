// The date picker's words (ui/DatePicker.tsx, which Housekeeping uses; docs/ARCHITECTURE.md
// "The date picker"): the week strip's name and title, and the relative headings over the
// week and the month. Pure: callers pass today (the household's day).
//
// Each function's doc comment is its spec; the tests are in src/lib/logic/calendar.test.ts.

import type { ISODate } from '../types';
import { daysBetween, parseISODate } from './dates';
import { fullDay, monthName, monthOf, weekOf, type YearMonth } from './months';

/** The compact week strip, or the whole month. */
export type CalendarView = 'week' | 'month';

/**
 * The week strip's accessible name (it has no visible title): `'Week of Monday 5 October'`.
 * Tests: a week in this year; one in another year.
 */
export function weekName(monday: ISODate, today: ISODate): string {
  return `Week of ${fullDay(monday, today)}`;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The week strip's visible title, between Previous week and Next week, from its seven days:
 * `'5 to 11 October'`; across two months, short names (`'28 Sep to 4 Oct'`); the year when it
 * is not today's, after the day it belongs to (`'4 to 10 January 2027'`, `'28 Dec to 3 Jan
 * 2027'`, or seen from 2027, `'28 Dec 2026 to 3 Jan'`).
 * Tests: one month; two months; next year; across a year end, from either year.
 */
export function weekTitle(week: ISODate[], today: ISODate): string {
  const first = parseISODate(week[0]);
  const last = parseISODate(week[week.length - 1]);
  const year = parseISODate(today).y;
  const lastYear = last.y === year ? '' : ` ${last.y}`;
  if (first.m === last.m && first.y === last.y) return `${first.d} to ${last.d} ${monthName(week[0])}${lastYear}`;
  const firstYear = first.y === year || first.y === last.y ? '' : ` ${first.y}`;
  return `${first.d} ${SHORT_MONTHS[first.m - 1]}${firstYear} to ${last.d} ${SHORT_MONTHS[last.m - 1]}${lastYear}`;
}

/**
 * The heading over the week strip, always relative, so it says what the card's dates don't:
 * `'This week'`, `'Next week'`, `'Last week'`, else `'In 3 weeks'` or `'3 weeks ago'`.
 * `monday` is the week's first day.
 * Tests: this, next and last week; further away both ways.
 */
export function weekHeading(monday: ISODate, today: ISODate): string {
  const weeks = Math.round(daysBetween(weekOf(today)[0], monday) / 7);
  return relative(weeks, 'week');
}

/**
 * The heading over the month, always relative: `'This month'`, `'Next month'`, `'Last
 * month'`, else `'In 2 months'` or `'2 months ago'`. The card under it names the month.
 * Tests: this, next and last month; further away both ways; across a new year.
 */
export function monthHeading(month: YearMonth, today: ISODate): string {
  const a = parseISODate(`${monthOf(today)}-01`);
  const b = parseISODate(`${month}-01`);
  return relative((b.y - a.y) * 12 + (b.m - a.m), 'month');
}

function relative(n: number, unit: 'week' | 'month'): string {
  if (n === 0) return `This ${unit}`;
  if (n === 1) return `Next ${unit}`;
  if (n === -1) return `Last ${unit}`;
  return n > 0 ? `In ${n} ${unit}s` : `${-n} ${unit}s ago`;
}
