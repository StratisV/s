// Housekeeping: pure logic for the Housekeeping tab (docs/ARCHITECTURE.md "Housekeeping").
// Calendar months (Monday first), month totals, prices in GBP (en-GB), finding a day's
// visit, the checklist a day shows, bylines, and the optimistic edits HomeProvider makes
// before a write lands. Dates are ISODate days in the household's time zone; nothing here
// reads the clock (callers pass `today`, `now` and the zone).
//
// CONTRACT STUB: everything but emptyHousekeeping() and WEEKDAYS still throws. Each
// function's doc comment is its spec; the unit tests it needs are listed under it
// ("Tests:") and belong in src/lib/logic/housekeeping.test.ts.

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

/** A calendar month, `YYYY-MM`. */
export type YearMonth = string;

function notYet(name: string, ..._args: unknown[]): never {
  throw new Error(`not implemented yet: ${name} (src/lib/logic/housekeeping.ts)`);
}

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

/**
 * The month a day is in: `monthOf('2026-10-08')` is `'2026-10'`.
 * Tests: a mid-month day; the 1st and the last day of a month; 31 Dec.
 */
export function monthOf(date: ISODate): YearMonth {
  return notYet('monthOf', date);
}

/**
 * The month `n` months after `month` (before, for negative n):
 * `shiftMonth('2026-12', 1)` is `'2027-01'`, `shiftMonth('2026-01', -1)` is `'2025-12'`.
 * Tests: +1 and -1 inside a year; across a year end both ways; n = 0; n = ±13.
 */
export function shiftMonth(month: YearMonth, n: number): YearMonth {
  return notYet('shiftMonth', month, n);
}

/**
 * The month's heading, `'October 2026'` (en-GB, always with the year).
 * Tests: October 2026; January; a different year.
 */
export function monthTitle(month: YearMonth): string {
  return notYet('monthTitle', month);
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
  return notYet('monthGrid', month);
}

/**
 * Whether a day may have a visit: today or earlier (`date <= today`). Future days are
 * shown dimmed and can't be chosen.
 * Tests: yesterday true; today true; tomorrow false; across a month and a year end.
 */
export function canHaveVisit(date: ISODate, today: ISODate): boolean {
  return notYet('canHaveVisit', date, today);
}

/**
 * The selected day's heading, `'Thursday 1 October'`, with the year when it is not
 * today's year (`'Thursday 31 December 2025'`).
 * Tests: same year; a different year; the 1st of a month.
 */
export function longDay(date: ISODate, today: ISODate): string {
  return notYet('longDay', date, today);
}

/**
 * The accessible name of a day in the month grid: longDay(), then `', today'` when it is
 * today, then for a day with a visit `', visit, 6 of 7 done'` plus `', £60.00'` when it
 * has a price. Examples: `'Thursday 1 October, visit, 6 of 7 done, £60.00'`,
 * `'Thursday 8 October, today'`, `'Thursday 8 October, today, visit, 0 of 7 done'`,
 * `'Friday 9 October'` (a future day; the button is disabled).
 * Tests: each example above; a visit without a price; a visit with no tasks (`0 of 0 done`).
 */
export function calendarDayLabel(date: ISODate, today: ISODate, visit: HousekeepingVisit | undefined): string {
  return notYet('calendarDayLabel', date, today, visit);
}

/**
 * The day the calendar selects when the tab opens: the latest visit in today's month that
 * is before today; null when there is none (nothing selected, the hint shows).
 * Tests: the e2e seed (today Thu 8 Oct, visits 1 Oct and earlier) gives 2026-10-01; only a
 * visit today gives null; only visits last month give null; no visits gives null.
 */
export function defaultSelectedDay(visits: HousekeepingVisit[], today: ISODate): ISODate | null {
  return notYet('defaultSelectedDay', visits, today);
}

// ── Visits ────────────────────────────────────────────────

/**
 * The visit on `date`, if any (there is at most one per day).
 * Tests: found; not found; the right one among several months.
 */
export function visitOn(visits: HousekeepingVisit[], date: ISODate): HousekeepingVisit | undefined {
  return notYet('visitOn', visits, date);
}

/**
 * The days in `month` that have a visit (to mark them in the grid).
 * Tests: visits in the month, the month before and after (only the month's count); none.
 */
export function visitDays(visits: HousekeepingVisit[], month: YearMonth): Set<ISODate> {
  return notYet('visitDays', visits, month);
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
 * Totals for `month`. Tests: the e2e seed (October: 1 visit, 6000p; September: 4 visits,
 * 24000p); a visit without a price counts as a visit but adds no pence; a price of 0 counts
 * as priced; visits in neighbouring months are left out; no visits.
 */
export function monthTotals(visits: HousekeepingVisit[], month: YearMonth): MonthTotals {
  return notYet('monthTotals', visits, month);
}

/**
 * The line under the calendar's header: `'4 visits · £180.00'`, `'1 visit · £45.00'`;
 * `'2 visits'` when none of them has a price; `'No visits'` for none. (The separator is a
 * middle dot with a space either side.)
 * Tests: each example; 1 visit priced at £0.00 reads `'1 visit · £0.00'`.
 */
export function monthSummary(totals: MonthTotals): string {
  return notYet('monthSummary', totals);
}

/**
 * How many of a visit's tasks are done, of how many.
 * Tests: all, some, none, a visit with no tasks.
 */
export function doneCount(visit: HousekeepingVisit): { done: number; total: number } {
  return notYet('doneCount', visit);
}

/**
 * The secondary line under the Housekeeping title: `"Today's visit"` when there is a visit
 * today; otherwise `'Last visit Thu 1 Oct'` for the latest visit (formatDay(): the year is
 * added when it differs from today's); `'Weekly'` when there are no visits at all.
 * Tests: each case; the latest is picked whatever the array order; a visit dated in the
 * future (bad data) is ignored.
 */
export function housekeepingSubtitle(visits: HousekeepingVisit[], today: ISODate): string {
  return notYet('housekeepingSubtitle', visits, today);
}

// ── Prices (GBP, en-GB) ───────────────────────────────────

/**
 * A price for display: `formatPrice(6000)` is `'£60.00'`, `formatPrice(123450)` is
 * `'£1,234.50'`, `formatPrice(0)` is `'£0.00'` (Intl.NumberFormat en-GB, GBP).
 * Tests: those three; 1 penny `'£0.01'`; HOUSEKEEPING_PRICE_MAX_PENCE `'£10,000.00'`.
 */
export function formatPrice(pence: number): string {
  return notYet('formatPrice', pence);
}

/**
 * What the price field shows: `'60.00'` for 6000, `'1234.50'` for 123450 (no £ sign and no
 * thousands separator; the £ is drawn before the field), `''` for null.
 * Tests: those; 0 gives `'0.00'`; 5 gives `'0.05'`.
 */
export function priceInputValue(pence: number | null): string {
  return notYet('priceInputValue', pence);
}

export type PriceParse = { ok: true; pence: number | null } | { ok: false };

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
  return notYet('parsePrice', text);
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
  return notYet('checklistFor', housekeeping, date);
}

/**
 * Whether a visit's row is the one a tick target names (`taskId` matches task_id, or
 * `visitTaskId` matches id).
 * Tests: both kinds of target, matching and not; a `{ taskId }` never matches a row with
 * task_id null.
 */
export function matchesTarget(row: HousekeepingVisitTask, target: HousekeepingTickTarget): boolean {
  return notYet('matchesTarget', row, target);
}

// ── Bylines (who and when, household time zone) ───────────

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
  return notYet('visitByline', visit, members, timeZone, now);
}

/**
 * Under the message: `'🦆 Shea · Yesterday 19:20'` (updated_by, updated_at), or null when
 * there is no message (body '') or it was never written.
 * Tests: a message; an empty one (null); never written (null); a former member.
 */
export function noteByline(note: HousekeepingNote, members: Member[], timeZone: string, now: Date): string | null {
  return notYet('noteByline', note, members, timeZone, now);
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
  return notYet('doneByline', row, visitDate, members, timeZone, now);
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
  return notYet('snapshotNote', note, date, timeZone);
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
  return notYet('newVisit', housekeeping, input);
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
  return notYet('applyTick', visit, target, done, memberId, at);
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
  return notYet('applyVisitPatch', visit, patch, memberId, at);
}

/**
 * The task list with `task` added at the end, and today's visit (if any) with a row for
 * it (not done, `pending:<task.id>` id unless the visit already has it).
 * Tests: added to the list and to today's visit; earlier visits untouched; no visit today.
 */
export function withTaskAdded(housekeeping: HousekeepingData, task: HousekeepingTask, today: ISODate): HousekeepingData {
  return notYet('withTaskAdded', housekeeping, task, today);
}

/**
 * The task renamed on the list and on today's visit (if it has the task); earlier visits
 * keep their titles. The title is trimmed.
 * Tests: list and today renamed; last week's visit keeps the old title; unknown id leaves
 * everything as it was.
 */
export function withTaskRenamed(housekeeping: HousekeepingData, id: string, title: string, today: ISODate): HousekeepingData {
  return notYet('withTaskRenamed', housekeeping, id, title, today);
}

/**
 * The task removed from the list; today's visit loses its row unless that row is done;
 * on every other visit (and today's done row) the row's task_id becomes null.
 * Tests: undone row removed today; done row kept today with task_id null; earlier visits
 * keep the row with task_id null; unknown id leaves everything as it was.
 */
export function withTaskDeleted(housekeeping: HousekeepingData, id: string, today: ISODate): HousekeepingData {
  return notYet('withTaskDeleted', housekeeping, id, today);
}

/**
 * Positions set to the index in `orderedIds` (ids not on the list are ignored, tasks not
 * named keep their position), the list sorted by position, and today's visit's rows
 * (those with a task_id) given the same positions and re-sorted. Earlier visits untouched.
 * Tests: a move to the top; to the bottom; an unknown id; today's visit follows; last
 * week's does not.
 */
export function withTasksReordered(housekeeping: HousekeepingData, orderedIds: string[], today: ISODate): HousekeepingData {
  return notYet('withTasksReordered', housekeeping, orderedIds, today);
}
