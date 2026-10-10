// Housekeeping: pure logic for the Housekeeping tab (docs/ARCHITECTURE.md "Housekeeping").
// Calendar months (Monday first), month totals, prices in GBP (en-GB), finding a day's
// visit, the checklist a day shows, bylines, and the optimistic edits HomeProvider makes
// before a write lands. Dates are ISODate days in the household's time zone; nothing here
// reads the clock (callers pass `today`, `now` and the zone).
//
// Each function's doc comment is its spec; the unit tests it lists ("Tests:") are in
// src/lib/logic/housekeeping.test.ts.

import { HOUSEKEEPING_PRICE_MAX_PENCE } from '../constants';
import type {
  HousekeepingData,
  HousekeepingNote,
  HousekeepingTask,
  HousekeepingTickTarget,
  HousekeepingVisit,
  HousekeepingVisitPatch,
  HousekeepingVisitTask,
  ISODate,
  ISOTimestamp,
  Member,
} from '../types';
import { senderOf, stampLabel, timeOf } from './chat';
import { formatDay, parseISODate, zonedParts } from './dates';

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

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A visit's rows in their order: position, then title, then id (as the backends load them). */
const byRowOrder = (a: HousekeepingVisitTask, b: HousekeepingVisitTask) =>
  a.position - b.position || compareText(a.title, b.title) || compareText(a.id, b.id);

/** The task list in its order (a stable sort keeps the loaded order for equal positions). */
const byPosition = (a: HousekeepingTask, b: HousekeepingTask) => a.position - b.position;

// ── Empty state ───────────────────────────────────────────

/** A household's housekeeping before anything is written: no message, no tasks, no visits. */
export function emptyHousekeeping(): HousekeepingData {
  return { note: { body: '', updated_at: null, updated_by: null }, tasks: [], visits: [] };
}

// ── Calendar ──────────────────────────────────────────────

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

/**
 * Whether a day may have a visit: today or earlier (`date <= today`). Future days are
 * shown dimmed and can't be chosen.
 * Tests: yesterday true; today true; tomorrow false; across a month and a year end.
 */
export function canHaveVisit(date: ISODate, today: ISODate): boolean {
  return date <= today;
}

/**
 * The selected day's heading, `'Thursday 1 October'`, with the year when it is not
 * today's year (`'Thursday 31 December 2025'`).
 * Tests: same year; a different year; the 1st of a month.
 */
export function longDay(date: ISODate, today: ISODate): string {
  const { y, m, d } = parseISODate(date);
  const weekday = DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const base = `${weekday} ${d} ${MONTH_NAMES[m - 1]}`;
  return parseISODate(today).y === y ? base : `${base} ${y}`;
}

/**
 * The accessible name of a day in the month grid: longDay(), then `', today'` when it is
 * today, then for a day with a recorded visit (isRecorded()) `', visit, 6 of 7 done'` plus
 * `', £60.00'` when it has a price, then `', selected'` for the day shown under the
 * calendar. Examples: `'Thursday 1 October, visit, 6 of 7 done, £60.00'`,
 * `'Thursday 8 October, today'`, `'Thursday 8 October, today, visit, 1 of 7 done'`,
 * `'Friday 9 October'` (a future day; the button is disabled),
 * `'Thursday 1 October, visit, 6 of 7 done, £60.00, selected'`.
 * Tests: each example above; a visit without a price; a visit with no tasks but a price
 * (`0 of 0 done, £0.00`); a visit with nothing recorded reads like a day without one.
 */
export function calendarDayLabel(
  date: ISODate,
  today: ISODate,
  visit: HousekeepingVisit | undefined,
  selected = false,
): string {
  let label = longDay(date, today);
  if (date === today) label += ', today';
  if (visit && isRecorded(visit)) {
    const { done, total } = doneCount(visit);
    label += `, visit, ${done} of ${total} done`;
    if (visit.price_pence !== null) label += `, ${formatPrice(visit.price_pence)}`;
  }
  if (selected) label += ', selected';
  return label;
}

/**
 * The day the calendar shows under it for `month`: the latest recorded visit (isRecorded())
 * in that month before today (today's visit has its own section above); null when there is
 * none (nothing selected, the hint shows). `month` defaults to today's: the day chosen
 * when the tab opens; changing month picks that month's.
 * Tests: the e2e seed (today Thu 8 Oct, visits 1 Oct and earlier) gives 2026-10-01; only a
 * visit today gives null; only visits last month give null; no visits gives null; a visit
 * with nothing recorded is passed over; September of the seed gives 2026-09-24; a month
 * without visits gives null.
 */
export function defaultSelectedDay(
  visits: HousekeepingVisit[],
  today: ISODate,
  month: YearMonth = monthOf(today),
): ISODate | null {
  let best: ISODate | null = null;
  for (const v of visits) {
    if (
      v.visit_date < today &&
      monthOf(v.visit_date) === month &&
      isRecorded(v) &&
      (best === null || v.visit_date > best)
    ) {
      best = v.visit_date;
    }
  }
  return best;
}

/**
 * What the screen says (politely) when a day is chosen in the calendar, since its details
 * show under the calendar, out of sight on a small screen: `'Thursday 1 October: 6 of 7
 * done, £60.00. Details below the calendar.'`, `'Tuesday 6 October: no visit recorded.
 * Details below the calendar.'`, `'Tuesday 6 October: nothing recorded yet. Details below
 * the calendar.'` (a visit with nothing recorded), and for today `'Thursday 8 October:
 * today's visit is above the calendar.'`.
 * Tests: each example; a visit without a price.
 */
export function daySelectedAnnouncement(date: ISODate, today: ISODate, visit: HousekeepingVisit | undefined): string {
  const day = longDay(date, today);
  if (date === today) return `${day}: today's visit is above the calendar.`;
  let what: string;
  if (!visit) what = 'no visit recorded';
  else if (!isRecorded(visit)) what = 'nothing recorded yet';
  else {
    const { done, total } = doneCount(visit);
    what = `${done} of ${total} done`;
    if (visit.price_pence !== null) what += `, ${formatPrice(visit.price_pence)}`;
  }
  return `${day}: ${what}. Details below the calendar.`;
}

// ── Visits ────────────────────────────────────────────────

/**
 * Whether a visit has anything recorded: a task ticked, comments or a price. One with none
 * of these (a stray tick taken back, "Add a visit" with nothing filled in yet) is still
 * stored and editable, but it is not counted as a visit: no dot in the calendar, not in the
 * month's total, not "Today's visit" or the last visit in the subtitle.
 * Tests: a tick; comments only; a price only (0 counts); none of them.
 */
export function isRecorded(visit: HousekeepingVisit): boolean {
  return visit.price_pence !== null || visit.comments !== '' || visit.tasks.some((t) => t.done);
}

/**
 * The visit on `date`, if any (there is at most one per day).
 * Tests: found; not found; the right one among several months.
 */
export function visitOn(visits: HousekeepingVisit[], date: ISODate): HousekeepingVisit | undefined {
  return visits.find((v) => v.visit_date === date);
}

/**
 * The days in `month` that have a recorded visit (isRecorded(); to mark them in the grid).
 * Tests: visits in the month, the month before and after (only the month's count); none; a
 * visit with nothing recorded is left out.
 */
export function visitDays(visits: HousekeepingVisit[], month: YearMonth): Set<ISODate> {
  return new Set(visits.filter((v) => monthOf(v.visit_date) === month && isRecorded(v)).map((v) => v.visit_date));
}

export interface MonthTotals {
  /** Visits in the month. */
  visits: number;
  /** Sum of the prices entered, in pence (visits without a price add nothing). */
  pence: number;
  /** Visits in the month that have a price. */
  priced: number;
}

/**
 * Totals for `month`, over its recorded visits (isRecorded()). Tests: the e2e seed
 * (October: 1 visit, 6000p; September: 4 visits, 24000p); a visit without a price counts as
 * a visit but adds no pence; a price of 0 counts as priced; visits in neighbouring months
 * are left out; no visits; a visit with nothing recorded is left out.
 */
export function monthTotals(visits: HousekeepingVisit[], month: YearMonth): MonthTotals {
  const totals: MonthTotals = { visits: 0, pence: 0, priced: 0 };
  for (const v of visits) {
    if (monthOf(v.visit_date) !== month || !isRecorded(v)) continue;
    totals.visits += 1;
    if (v.price_pence !== null) {
      totals.pence += v.price_pence;
      totals.priced += 1;
    }
  }
  return totals;
}

/**
 * The line under the calendar's header: `'4 visits · £180.00'`, `'1 visit · £45.00'`;
 * `'2 visits'` when none of them has a price; `'No visits'` for none. (The separator is a
 * middle dot with a space either side.)
 * Tests: each example; 1 visit priced at £0.00 reads `'1 visit · £0.00'`.
 */
export function monthSummary(totals: MonthTotals): string {
  if (totals.visits === 0) return 'No visits';
  const count = `${totals.visits} ${totals.visits === 1 ? 'visit' : 'visits'}`;
  return totals.priced > 0 ? `${count} · ${formatPrice(totals.pence)}` : count;
}

/**
 * How many of a visit's tasks are done, of how many.
 * Tests: all, some, none, a visit with no tasks.
 */
export function doneCount(visit: HousekeepingVisit): { done: number; total: number } {
  return { done: visit.tasks.filter((t) => t.done).length, total: visit.tasks.length };
}

/**
 * The secondary line under the Housekeeping title: `"Today's visit"` when there is a
 * recorded visit (isRecorded()) today; otherwise `'Last visit Thu 1 Oct'` for the latest
 * recorded visit (formatDay(): the year is added when it differs from today's); `'Weekly'`
 * when there are none at all.
 * Tests: each case; the latest is picked whatever the array order; a visit dated in the
 * future (bad data) is ignored; a visit with nothing recorded (today or earlier) is passed
 * over.
 */
export function housekeepingSubtitle(visits: HousekeepingVisit[], today: ISODate): string {
  let latest: ISODate | null = null;
  for (const v of visits) {
    if (v.visit_date > today || !isRecorded(v)) continue;
    if (latest === null || v.visit_date > latest) latest = v.visit_date;
  }
  if (latest === null) return 'Weekly';
  if (latest === today) return "Today's visit";
  return `Last visit ${formatDay(latest, today)}`;
}

// ── Prices (GBP, en-GB) ───────────────────────────────────

const GBP = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * A price for display: `formatPrice(6000)` is `'£60.00'`, `formatPrice(123450)` is
 * `'£1,234.50'`, `formatPrice(0)` is `'£0.00'` (Intl.NumberFormat en-GB, GBP).
 * Tests: those three; 1 penny `'£0.01'`; HOUSEKEEPING_PRICE_MAX_PENCE `'£10,000.00'`.
 */
export function formatPrice(pence: number): string {
  return GBP.format(pence / 100);
}

/**
 * What the price field shows: `'60.00'` for 6000, `'1234.50'` for 123450 (no £ sign and no
 * thousands separator; the £ is drawn before the field), `''` for null.
 * Tests: those; 0 gives `'0.00'`; 5 gives `'0.05'`.
 */
export function priceInputValue(pence: number | null): string {
  if (pence === null) return '';
  const whole = Math.round(pence);
  const sign = whole < 0 ? '-' : '';
  const abs = Math.abs(whole);
  return `${sign}${Math.floor(abs / 100)}.${pad(abs % 100)}`;
}

export type PriceParse = { ok: true; pence: number | null } | { ok: false };

/** Whole pounds, optionally with thousands commas (`'1,234'`), then optional decimals. */
const WITH_DOT = /^(\d{1,3}(?:,\d{3})+|\d*)\.(\d{0,2})$/;
const THOUSANDS = /^\d{1,3}(?:,\d{3})+$/;
const WHOLE = /^\d+$/;
/** A decimal comma from a keypad that types one: `'45,50'`, `'45,5'`. */
const DECIMAL_COMMA = /^(\d+),(\d{1,2})$/;

/**
 * Reads what was typed in the price field. Blank (or only spaces) is `{ ok: true, pence:
 * null }` (clears the price). Accepted: digits with up to 2 decimals after a `.`
 * (`'45'`, `'45.5'`, `'45.50'`, `'.5'`), an optional leading `£`, surrounding spaces,
 * thousands commas when there is a `.` or no decimals (`'1,234.50'`, `'1,234'`), and a
 * decimal comma when there is no `.` and the comma has 1 or 2 digits after it (`'45,50'`,
 * `'45,5'`, from a keypad that types a comma). Rejected (`{ ok: false }`): letters,
 * negative numbers, more than 2 decimals, several dots, and more than
 * HOUSEKEEPING_PRICE_MAX_PENCE. Converted without floating-point error
 * (`'0.29'` is 29, `'19.99'` is 1999).
 * Tests: every accepted and rejected example above; `'10000'` and `'10000.00'` are
 * 1000000; `'10000.01'` is rejected; `'0'` is 0; `' £ 45 '` is 4500; `'4 5'` is rejected.
 */
export function parsePrice(text: string): PriceParse {
  let value = (text ?? '').trim();
  if (value === '') return { ok: true, pence: null };
  if (value.startsWith('£')) value = value.slice(1).trim();

  let whole: string;
  let fraction: string;
  let match: RegExpExecArray | null;
  if ((match = WITH_DOT.exec(value))) {
    [, whole, fraction] = match;
  } else if (THOUSANDS.test(value) || WHOLE.test(value)) {
    whole = value;
    fraction = '';
  } else if ((match = DECIMAL_COMMA.exec(value))) {
    [, whole, fraction] = match;
  } else {
    return { ok: false };
  }
  whole = whole.replace(/,/g, '');
  // '.' alone has no digits at all.
  if (whole === '' && fraction === '') return { ok: false };
  // More digits than any allowed price: never a valid amount (and keeps Number exact).
  const pounds = whole.replace(/^0+(?=\d)/, '');
  if (pounds.length > 9) return { ok: false };
  const pence = Number(pounds || '0') * 100 + Number(fraction.padEnd(2, '0'));
  if (pence > HOUSEKEEPING_PRICE_MAX_PENCE) return { ok: false };
  return { ok: true, pence };
}

// ── Checklist ─────────────────────────────────────────────

/** One row of a day's checklist, as the UI shows and ticks it. */
export interface ChecklistRow {
  /**
   * Stable React key: `task:<task_id>` for a row whose task is on the list (the same
   * before and after the day's visit is created, so a checkbox keeps focus), else
   * `row:<visit task id>`.
   */
  key: string;
  title: string;
  done: boolean;
  /** Who ticked it (member id), when done. */
  doneBy: string | null;
  doneAt: ISOTimestamp | null;
  /** What to pass to setHousekeepingTaskDone: `{ taskId }` when task_id is set, else `{ visitTaskId }`. */
  target: HousekeepingTickTarget;
}

/**
 * The checklist for `date`: the rows of that day's visit (in its order) when there is
 * one; otherwise the task list, none done (what ticking would start the visit with).
 * Tests: a day with a visit; a visit with a row whose task was deleted (task_id null:
 * `row:` key and `{ visitTaskId }` target); a day with no visit gives the task list in
 * position order, unticked, with `task:` keys and `{ taskId }` targets; empty task list
 * and no visit gives [].
 */
export function checklistFor(housekeeping: HousekeepingData, date: ISODate): ChecklistRow[] {
  const visit = visitOn(housekeeping.visits, date);
  if (visit) {
    return visit.tasks.map((row) => ({
      key: row.task_id !== null ? `task:${row.task_id}` : `row:${row.id}`,
      title: row.title,
      done: row.done,
      doneBy: row.done ? row.done_by : null,
      doneAt: row.done ? row.done_at : null,
      target: row.task_id !== null ? { taskId: row.task_id } : { visitTaskId: row.id },
    }));
  }
  return [...housekeeping.tasks].sort(byPosition).map((task) => ({
    key: `task:${task.id}`,
    title: task.title,
    done: false,
    doneBy: null,
    doneAt: null,
    target: { taskId: task.id },
  }));
}

/**
 * Whether a visit's row is the one a tick target names (`taskId` matches task_id, or
 * `visitTaskId` matches id).
 * Tests: both kinds of target, matching and not; a `{ taskId }` never matches a row with
 * task_id null.
 */
export function matchesTarget(row: HousekeepingVisitTask, target: HousekeepingTickTarget): boolean {
  if ('taskId' in target) return row.task_id !== null && row.task_id === target.taskId;
  return row.id === target.visitTaskId;
}

// ── Bylines (who and when, household time zone) ───────────

/** "🦊 Ela", or "👤 Former member" for someone no longer in the household. */
function who(memberId: string | null, members: Member[]): string {
  const { emoji, name } = senderOf(memberId, members);
  return `${emoji} ${name}`;
}

/** "Today 10:42", "Yesterday 19:20", "Thu 1 Oct 10:05" (chat's stampLabel()). */
function when(ts: ISOTimestamp, timeZone: string, now: Date): string {
  const { day, time } = stampLabel(ts, timeZone, now);
  return `${day} ${time}`;
}

/**
 * Under the visit: `'Recorded by 🦊 Ela · Today 10:42'` (created_by, created_at), then,
 * when someone changed it later, `' · Updated by 🦆 Shea · Today 11:05'` (updated_by,
 * updated_at; left out when updated_at is within a minute of created_at). Days and times
 * as chat's stampLabel() ('Today', 'Yesterday', 'Thu 1 Oct'), names as senderOf() (a gone
 * member reads 'Former member' with 👤).
 * Tests: recorded only; recorded and updated by someone else; updated by the same person
 * later (still shown); updated within the minute (left out); a former member; yesterday and
 * an older day; another time zone moves the day.
 */
export function visitByline(visit: HousekeepingVisit, members: Member[], timeZone: string, now: Date): string {
  const recorded = `Recorded by ${who(visit.created_by, members)} · ${when(visit.created_at, timeZone, now)}`;
  if (timeOf(visit.updated_at) - timeOf(visit.created_at) < 60_000) return recorded;
  return `${recorded} · Updated by ${who(visit.updated_by, members)} · ${when(visit.updated_at, timeZone, now)}`;
}

/**
 * Under the message: `'🦆 Shea · Yesterday 19:20'` (updated_by, updated_at), or null when
 * there is no message (body '') or it was never written.
 * Tests: a message; an empty one (null); never written (null); a former member.
 */
export function noteByline(note: HousekeepingNote, members: Member[], timeZone: string, now: Date): string | null {
  if (note.body === '' || note.updated_at === null) return null;
  return `${who(note.updated_by, members)} · ${when(note.updated_at, timeZone, now)}`;
}

/**
 * Whether the message is new to this member, for the dot on the Housekeeping tab: there is
 * a message, someone else wrote it (or changed it last), and it was changed after `seen`
 * (when this member last had the tab open on this device; null: never).
 * Tests: someone else's message never seen (true); seen since (false); changed after it was
 * seen (true); your own (false); an empty or never written message (false).
 */
export function hasNewNote(note: HousekeepingNote, meId: string, seen: ISOTimestamp | null): boolean {
  if (note.body === '' || note.updated_at === null || note.updated_by === meId) return false;
  return seen === null || timeOf(note.updated_at) > timeOf(seen);
}

/**
 * Under a ticked row: `'🦊 Ela · 10:42'` when it was ticked on the visit's day (household
 * time), else `'🦊 Ela · Fri 2 Oct 09:00'`; null when not done.
 * Tests: same day; a later day; not done (null); a former member.
 */
export function doneByline(
  row: HousekeepingVisitTask,
  visitDate: ISODate,
  members: Member[],
  timeZone: string,
  now: Date,
): string | null {
  if (!row.done) return null;
  const person = who(row.done_by, members);
  if (row.done_at === null) return person;
  const { day, time } = stampLabel(row.done_at, timeZone, now);
  const tickedOn = zonedParts(new Date(row.done_at), timeZone).date;
  return tickedOn === visitDate ? `${person} · ${time}` : `${person} · ${day} ${time}`;
}

// ── Optimistic edits (HomeProvider shows these before the write lands) ──
// They return new objects and never mutate their input. They follow the database rules
// (docs/ARCHITECTURE.md "Housekeeping"), so the reload that follows a write rarely moves
// anything.

/**
 * The visit's copy of the message: `note.body` when it was last changed on or before
 * `date` in `timeZone` (always so for today), else ''. Never written: ''.
 * Tests: written yesterday, visit today (copied); written today, visit today (copied);
 * written today, visit last week (''); never written (''); the day boundary in the zone
 * (23:30 UTC on 7 Oct is 8 Oct in London in summer).
 */
export function snapshotNote(note: HousekeepingNote, date: ISODate, timeZone: string): string {
  if (note.updated_at === null) return '';
  const changedOn = zonedParts(new Date(note.updated_at), timeZone).date;
  return changedOn <= date ? note.body : '';
}

export interface NewVisitInput {
  id: string;
  householdId: string;
  date: ISODate;
  /** The member recording it (created_by and updated_by). */
  memberId: string | null;
  /** created_at and updated_at. */
  at: ISOTimestamp;
  timeZone: string;
  /** Id for the row copied from a task (the provider uses `pending:<taskId>`). */
  rowId(taskId: string): string;
}

/**
 * A visit as the database creates it: the task list copied (title, position, task_id,
 * none done, in list order), the message via snapshotNote(), empty comments, no price.
 * Tests: rows copy the list in position order with the given ids; the note rule; empty
 * task list gives no rows; the input data is not mutated.
 */
export function newVisit(housekeeping: HousekeepingData, input: NewVisitInput): HousekeepingVisit {
  return {
    id: input.id,
    household_id: input.householdId,
    visit_date: input.date,
    note: snapshotNote(housekeeping.note, input.date, input.timeZone),
    comments: '',
    price_pence: null,
    created_by: input.memberId,
    created_at: input.at,
    updated_by: input.memberId,
    updated_at: input.at,
    tasks: [...housekeeping.tasks].sort(byPosition).map((task) => ({
      id: input.rowId(task.id),
      visit_id: input.id,
      household_id: input.householdId,
      task_id: task.id,
      title: task.title,
      position: task.position,
      done: false,
      done_by: null,
      done_at: null,
    })),
  };
}

/**
 * The visit with one row ticked (done_by = memberId, done_at = at) or unticked (both
 * null), and updated_by/updated_at stamped. Already in that state: the same visit back,
 * unchanged. No row matches the target: null (the backend would say not_found).
 * Tests: tick; untick; tick an already ticked row (unchanged, same object); unknown target
 * (null); a `{ visitTaskId }` target; other rows untouched.
 */
export function applyTick(
  visit: HousekeepingVisit,
  target: HousekeepingTickTarget,
  done: boolean,
  memberId: string,
  at: ISOTimestamp,
): HousekeepingVisit | null {
  const index = visit.tasks.findIndex((row) => matchesTarget(row, target));
  if (index < 0) return null;
  const row = visit.tasks[index];
  if (row.done === done) return visit;
  const tasks = [...visit.tasks];
  tasks[index] = { ...row, done, done_by: done ? memberId : null, done_at: done ? at : null };
  return { ...visit, tasks, updated_by: memberId, updated_at: at };
}

/**
 * The visit with the patch applied (comments trimmed; only the keys present) and
 * updated_by/updated_at stamped.
 * Tests: comments only; price only; price null clears; both; comments trimmed; an empty
 * patch only stamps.
 */
export function applyVisitPatch(
  visit: HousekeepingVisit,
  patch: HousekeepingVisitPatch,
  memberId: string,
  at: ISOTimestamp,
): HousekeepingVisit {
  const next: HousekeepingVisit = { ...visit, updated_by: memberId, updated_at: at };
  if (patch.comments !== undefined) next.comments = patch.comments.trim();
  if (patch.price_pence !== undefined) next.price_pence = patch.price_pence;
  return next;
}

/** `housekeeping` with today's visit (if any) replaced by `change(visit)`. */
function withTodaysVisit(
  housekeeping: HousekeepingData,
  today: ISODate,
  change: (visit: HousekeepingVisit) => HousekeepingVisit,
): HousekeepingVisit[] {
  return housekeeping.visits.map((v) => (v.visit_date === today ? change(v) : v));
}

/**
 * The task list with `task` added at the end, and today's visit (if any) with a row for
 * it (not done, `pending:<task.id>` id unless the visit already has it).
 * Tests: added to the list and to today's visit; earlier visits untouched; no visit today.
 */
export function withTaskAdded(housekeeping: HousekeepingData, task: HousekeepingTask, today: ISODate): HousekeepingData {
  const tasks = housekeeping.tasks.some((t) => t.id === task.id) ? housekeeping.tasks : [...housekeeping.tasks, task];
  const visits = withTodaysVisit(housekeeping, today, (visit) => {
    if (visit.tasks.some((row) => row.task_id === task.id)) return visit;
    const row: HousekeepingVisitTask = {
      id: `pending:${task.id}`,
      visit_id: visit.id,
      household_id: visit.household_id,
      task_id: task.id,
      title: task.title,
      position: task.position,
      done: false,
      done_by: null,
      done_at: null,
    };
    return { ...visit, tasks: [...visit.tasks, row].sort(byRowOrder) };
  });
  return { ...housekeeping, tasks, visits };
}

/**
 * The task renamed on the list and on today's visit (if it has the task and it is not
 * ticked there: a ticked row keeps the title it was ticked under, as history); earlier
 * visits keep their titles. The title is trimmed.
 * Tests: list and today renamed; last week's visit keeps the old title; a row ticked today
 * keeps its title; unknown id leaves everything as it was.
 */
export function withTaskRenamed(housekeeping: HousekeepingData, id: string, title: string, today: ISODate): HousekeepingData {
  if (!housekeeping.tasks.some((t) => t.id === id)) return housekeeping;
  const clean = title.trim();
  const follows = (row: HousekeepingVisitTask) => row.task_id === id && !row.done;
  return {
    ...housekeeping,
    tasks: housekeeping.tasks.map((t) => (t.id === id ? { ...t, title: clean } : t)),
    visits: withTodaysVisit(housekeeping, today, (visit) =>
      visit.tasks.some(follows)
        ? { ...visit, tasks: visit.tasks.map((row) => (follows(row) ? { ...row, title: clean } : row)) }
        : visit,
    ),
  };
}

/**
 * The task removed from the list; today's visit loses its row unless that row is done;
 * on every other visit (and today's done row) the row's task_id becomes null.
 * Tests: undone row removed today; done row kept today with task_id null; earlier visits
 * keep the row with task_id null; unknown id leaves everything as it was.
 */
export function withTaskDeleted(housekeeping: HousekeepingData, id: string, today: ISODate): HousekeepingData {
  if (!housekeeping.tasks.some((t) => t.id === id)) return housekeeping;
  return {
    ...housekeeping,
    tasks: housekeeping.tasks.filter((t) => t.id !== id),
    visits: housekeeping.visits.map((visit) => {
      if (!visit.tasks.some((row) => row.task_id === id)) return visit;
      const isToday = visit.visit_date === today;
      const tasks = visit.tasks
        .filter((row) => !(isToday && row.task_id === id && !row.done))
        .map((row) => (row.task_id === id ? { ...row, task_id: null } : row));
      return { ...visit, tasks };
    }),
  };
}

/**
 * Positions set to the index in `orderedIds` (ids not on the list are ignored, tasks not
 * named keep their position), the list sorted by position, and today's visit's rows
 * (those with a task_id) given the same positions and re-sorted. Earlier visits untouched.
 * Tests: a move to the top; to the bottom; an unknown id; today's visit follows; last
 * week's does not.
 */
export function withTasksReordered(housekeeping: HousekeepingData, orderedIds: string[], today: ISODate): HousekeepingData {
  const onList = new Set(housekeeping.tasks.map((t) => t.id));
  const position = new Map<string, number>();
  orderedIds.forEach((id, index) => {
    // The first mention wins, like the database's update from the array.
    if (onList.has(id) && !position.has(id)) position.set(id, index);
  });
  const tasks = housekeeping.tasks.map((t) => (position.has(t.id) ? { ...t, position: position.get(t.id)! } : t));
  tasks.sort(byPosition);
  const visits = withTodaysVisit(housekeeping, today, (visit) => ({
    ...visit,
    tasks: visit.tasks
      .map((row) =>
        row.task_id !== null && position.has(row.task_id) ? { ...row, position: position.get(row.task_id)! } : row,
      )
      .sort(byRowOrder),
  }));
  return { ...housekeeping, tasks, visits };
}
