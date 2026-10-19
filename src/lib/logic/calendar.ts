// Needs attention's calendar (docs/ARCHITECTURE.md "Needs attention: the calendar"): what each day holds. The To
// do items due that day (missed when the day is past), the later repeats of repeating items
// (projected, shown faint), and the housekeeping visit. Pure: callers pass today (the
// household's day) and the items already narrowed to whoever the person filter shows.
//
// Each function's doc comment is its spec; the tests are in src/lib/logic/calendar.test.ts.

import { RAG_ORDER, URGENCY_LABEL } from '../constants';
import type { HousekeepingVisit, ISODate, Item, Rag } from '../types';
import { daysBetween, formatDay, parseISODate } from './dates';
import { doneCount, formatPrice, isRecorded } from './housekeeping';
import { isState, nextDueDate } from './items';
import { fullDay, monthName, monthOf, monthRange, weekOf, type YearMonth } from './months';
import { SHARE_REPEAT } from './share';

/** The compact week strip, or the whole month. */
export type CalendarView = 'week' | 'month';

/** What one day holds on Needs attention's calendar. */
export interface CalendarDay {
  /** Open To do items due that day, when it is today or later, in the order given (Home's). */
  due: Item[];
  /** Open To do items due that day, when it is before today. */
  missed: Item[];
  /**
   * Repeating items coming round again that day, after their next due date: where Mark as
   * Done would move them. Shown faint, and not completable until they are due.
   */
  repeats: Item[];
  /** The housekeeping visit that day, when something is recorded on it (isRecorded()). */
  visit: HousekeepingVisit | null;
}

/** A day with nothing on it. */
export const EMPTY_DAY: CalendarDay = Object.freeze({ due: [], missed: [], repeats: [], visit: null }) as CalendarDay;

/** Repeats are followed this many steps at most (a weekly item: over 90 years). */
const MAX_STEPS = 5000;

/**
 * Whether an item marks the calendar: an open To do with a due date. To maintain items have
 * no date, and done items have left the list.
 * Tests: an open task with a date; without a date; done; a state.
 */
export function isDated(item: Pick<Item, 'status' | 'due_date' | 'kind'>): boolean {
  return !isState(item) && item.status === 'open' && item.due_date !== null;
}

/**
 * The days between `from` and `to` (both included) when a repeating item comes round again
 * after its next due date, as Mark as Done would move it, one completion after another
 * (nextDueDate(), as complete_item does): one interval after its due date, or one interval
 * after today when that is still past (a missed item), then one interval at a time.
 * Monthly-type intervals clamp to the month's end and carry on from there (31 Jan, 28 Feb,
 * 28 Mar). Nothing for an item that doesn't repeat or has no date. Never the due date itself.
 * Tests: weekly in a month; monthly, quarterly, biannual and yearly; from the 31st and
 * 29 Feb; a missed weekly item (from today, not from its old date); a range before the due
 * date; the range's ends included; none; weeks across the clock changes in London keep
 * their weekday.
 */
export function repeatDates(
  item: Pick<Item, 'repeat' | 'due_date'>,
  from: ISODate,
  to: ISODate,
  today: ISODate,
): ISODate[] {
  if (item.repeat === 'none' || item.due_date === null || to < from) return [];
  const out: ISODate[] = [];
  let day = nextDueDate(item.repeat, item.due_date, today);
  for (let i = 0; day !== null && day <= to && i < MAX_STEPS; i++) {
    if (day >= from) out.push(day);
    day = nextDueDate(item.repeat, day, today);
  }
  return out;
}

function dayIn(days: Map<ISODate, CalendarDay>, date: ISODate): CalendarDay {
  let day = days.get(date);
  if (!day) {
    day = { due: [], missed: [], repeats: [], visit: null };
    days.set(date, day);
  }
  return day;
}

/**
 * Every day from `from` to `to` (both included) that has something on it: items (only those
 * isDated(), in the order given) on their due date, as due or missed (before today), their
 * repeats (repeatDates()), and the recorded visits. Days with nothing are left out (read
 * them with dayOn()).
 * Tests: due and missed by date; a state, a done item and an undated one leave no mark;
 * repeats after the due date only; a visit with nothing recorded leaves no mark; days
 * outside the range are left out; the order given is kept.
 */
export function calendarDays(
  items: Item[],
  visits: HousekeepingVisit[],
  from: ISODate,
  to: ISODate,
  today: ISODate,
): Map<ISODate, CalendarDay> {
  const days = new Map<ISODate, CalendarDay>();
  for (const item of items) {
    if (!isDated(item)) continue;
    const due = item.due_date!;
    if (due >= from && due <= to) {
      const day = dayIn(days, due);
      if (due < today) day.missed.push(item);
      else day.due.push(item);
    }
    for (const date of repeatDates(item, from, to, today)) dayIn(days, date).repeats.push(item);
  }
  for (const visit of visits) {
    if (visit.visit_date >= from && visit.visit_date <= to && isRecorded(visit)) {
      dayIn(days, visit.visit_date).visit = visit;
    }
  }
  return days;
}

/** What `date` holds in `days` (from calendarDays()); EMPTY_DAY when nothing. */
export function dayOn(days: Map<ISODate, CalendarDay>, date: ISODate): CalendarDay {
  return days.get(date) ?? EMPTY_DAY;
}

/**
 * What any day holds, worked out a month at a time (calendarDays() over the month) the first
 * time a day of that month is asked for, then remembered: the calendar asks day by day, for
 * a week that may straddle two months, or a month far ahead.
 * Tests: the same answers as calendarDays() over the month; a week across two months; the
 * same object for the same day.
 */
export function calendarLookup(
  items: Item[],
  visits: HousekeepingVisit[],
  today: ISODate,
): (date: ISODate) => CalendarDay {
  const months = new Map<YearMonth, Map<ISODate, CalendarDay>>();
  return (date) => {
    const month = monthOf(date);
    let days = months.get(month);
    if (!days) {
      const [from, to] = monthRange(month);
      days = calendarDays(items, visits, from, to, today);
      months.set(month, days);
    }
    return dayOn(days, date);
  };
}

/** Whether a day has nothing on it at all. */
export function isEmptyDay(day: CalendarDay): boolean {
  return !day.due.length && !day.missed.length && !day.repeats.length && !day.visit;
}

/** One mark under a day's number: a dot in the item's status colour, hollow and faint for a repeat. */
export interface DayDot {
  rag: Rag;
  repeat: boolean;
}

const byRag = (a: { rag: Rag }, b: { rag: Rag }) => RAG_ORDER.indexOf(a.rag) - RAG_ORDER.indexOf(b.rag);

/**
 * A day's items in the order its marks show them: missed first, then the rest due, each red,
 * then amber, then green (the order given, Home's, breaks ties); then its repeats, the same way.
 * The list under the calendar is in this order, so its most urgent row is at the top.
 * Tests: a missed green before a due red; red, amber, green; ties keep the order given; repeats.
 */
export function dayRows(day: CalendarDay): { rows: Item[]; repeats: Item[] } {
  // Array.prototype.sort is stable, so equal statuses keep Home's order.
  return {
    rows: [...[...day.missed].sort(byRag), ...[...day.due].sort(byRag)],
    repeats: [...day.repeats].sort(byRag),
  };
}

/**
 * The To dos still open from days before today, for today's list under the calendar: marked
 * only on their own day, they left today reading "Nothing due" while something urgent was
 * days late (Reminders and Todoist put them at the top of Today too). Most urgent first (red,
 * amber, green), then the longest late; ties keep the order given (Home's).
 * Tests: only open To dos with a date before today; the order; none.
 */
export function lateItems(items: Item[], today: ISODate): Item[] {
  const byDue = (a: Item, b: Item) => (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : 0);
  return items.filter((it) => isDated(it) && it.due_date! < today).sort((a, b) => byRag(a, b) || byDue(a, b));
}

/**
 * The marks under a day's number: a dot per item due or missed, red first, then amber,
 * then green; then a faint one per repeat in the same order; at most `max` (3), and how
 * many more there are (shown as "+2").
 * Tests: none; one of each colour sorted red, amber, green; four gives three and 1 more;
 * repeats after the items due; only repeats.
 */
export function dayDots(day: CalendarDay, max = 3): { dots: DayDot[]; more: number } {
  const solid = [...day.missed, ...day.due].sort(byRag).map((it) => ({ rag: it.rag, repeat: false }));
  const faint = [...day.repeats].sort(byRag).map((it) => ({ rag: it.rag, repeat: true }));
  const all = [...solid, ...faint];
  return { dots: all.slice(0, max), more: Math.max(0, all.length - max) };
}

/**
 * How urgent some items are, in the words of their dots' colours: `'urgent'` when they all
 * share one, else how many of each, most urgent first: `'1 urgent, 2 not urgent'`.
 */
function urgencyOf(items: Item[]): string {
  const counts = RAG_ORDER.map((rag) => ({ rag, n: items.filter((it) => it.rag === rag).length })).filter((c) => c.n);
  const word = (rag: Rag) => URGENCY_LABEL[rag].toLowerCase();
  if (counts.length === 1) return word(counts[0].rag);
  return counts.map((c) => `${c.n} ${word(c.rag)}`).join(', ');
}

/**
 * What a day holds, read out, the colours of its dots in words: `['3 due (1 urgent, 2 not
 * urgent)', '1 missed (urgent)', '2 repeats', 'housekeeping visit']`, without the empty parts.
 */
function dayParts(day: CalendarDay): string[] {
  const parts: string[] = [];
  if (day.due.length) parts.push(`${day.due.length} due (${urgencyOf(day.due)})`);
  if (day.missed.length) parts.push(`${day.missed.length} missed (${urgencyOf(day.missed)})`);
  if (day.repeats.length) parts.push(`${day.repeats.length} ${day.repeats.length === 1 ? 'repeat' : 'repeats'}`);
  if (day.visit) parts.push('housekeeping visit');
  return parts;
}

/**
 * The accessible name of a day's button on Needs attention's calendar: fullDay() ("Friday 16 October",
 * with the year when it is not this year's), `', today'`, then what it holds, with how
 * urgent in words for the coloured dots (`', 3 due (1 urgent, 2 not urgent)'`, `', 1 missed
 * (urgent)'`, `', 2 repeats'`, `', housekeeping visit'`), then `', selected'` for the day
 * shown under the calendar. Examples: `'Friday 16 October, 3 due (1 urgent, 2 not urgent),
 * housekeeping visit'`, `'Tuesday 6 October, 1 missed (urgent)'`, `'Thursday 8 October,
 * today, selected'`, `'Tuesday 20 October, 2 due (within the month), 1 repeat'`,
 * `'Saturday 9 January 2027'`.
 * Tests: each example; singular and plural repeats.
 */
export function calendarDayName(date: ISODate, today: ISODate, day: CalendarDay, selected = false): string {
  let label = fullDay(date, today);
  if (date === today) label += ', today';
  for (const part of dayParts(day)) label += `, ${part}`;
  if (selected) label += ', selected';
  return label;
}

/**
 * What the live region says when a day is chosen (its details show under the calendar):
 * `'Friday 16 October: 3 due (not urgent), 1 repeat. Details below the calendar.'`,
 * `'Thursday 8 October, today: nothing due. Details below the calendar.'`,
 * `'Tuesday 6 October: 1 missed (urgent), housekeeping visit. Details below the calendar.'`.
 * For today, what is late (lateItems(), listed first under it) comes first: `'Thursday 8
 * October, today: 1 late (urgent), 1 due (not urgent). Details below the calendar.'`.
 * Tests: each example.
 */
export function calendarDayAnnouncement(date: ISODate, today: ISODate, day: CalendarDay, late: Item[] = []): string {
  const parts = dayParts(day);
  if (late.length) parts.unshift(`${late.length} late (${urgencyOf(late)})`);
  const name = `${fullDay(date, today)}${date === today ? ', today' : ''}`;
  return `${name}: ${parts.length ? parts.join(', ') : 'nothing due'}. Details below the calendar.`;
}

/**
 * The week strip's accessible name (it has no visible title): `'Week of Monday 5 October'`.
 * Tests: a week in this year; one in another year.
 */
export function weekName(monday: ISODate, today: ISODate): string {
  return `Week of ${fullDay(monday, today)}`;
}

/**
 * The second line of a repeat's row under the calendar, after who it is for: `when`, the due
 * date it repeats, worded so it can't be read as due on another day than the one chosen
 * (`'Repeat of Thu 8 Oct'`, or `'Repeat of Tue 6 Oct, missed'` when that date has passed;
 * `'Repeat'` without a date), then `every`, how often (`'Every week'`), which gives way first
 * on a narrow screen. Both empty for an item that doesn't repeat.
 * Tests: weekly; every 3 months; missed; no repeat; no date.
 */
export function repeatMeta(item: Pick<Item, 'repeat' | 'due_date'>, today: ISODate): { when: string; every: string } {
  if (item.repeat === 'none') return { when: '', every: '' };
  const every = SHARE_REPEAT[item.repeat];
  if (!item.due_date) return { when: 'Repeat', every };
  const missed = item.due_date < today ? ', missed' : '';
  return { when: `Repeat of ${formatDay(item.due_date, today)}${missed}`, every };
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
 * The heading over Home's week strip, always relative, so it says what the card's dates
 * don't: `'This week'`, `'Next week'`, `'Last week'`, else `'In 3 weeks'` or `'3 weeks ago'`.
 * `monday` is the week's first day.
 * Tests: this, next and last week; further away both ways.
 */
export function weekHeading(monday: ISODate, today: ISODate): string {
  const weeks = Math.round(daysBetween(weekOf(today)[0], monday) / 7);
  return relative(weeks, 'week');
}

/**
 * The heading over Home's month, always relative: `'This month'`, `'Next month'`,
 * `'Last month'`, else `'In 2 months'` or `'2 months ago'`. The card under it names the month.
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

/**
 * A visit's line on Home: `'6 of 7 done · £60.00'`, or `'6 of 7 done'` without a price.
 * Tests: both.
 */
export function visitSummary(visit: HousekeepingVisit): string {
  const { done, total } = doneCount(visit);
  const count = `${done} of ${total} done`;
  return visit.price_pence === null ? count : `${count} · ${formatPrice(visit.price_pence)}`;
}
