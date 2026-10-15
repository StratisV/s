// Housekeeping: pure logic for the Housekeeping tab (docs/ARCHITECTURE.md "Housekeeping").
// Calendar months (Monday first), month totals, prices in GBP (en-GB), finding a day's
// visit, the task list's order and sections, the checklist a day shows (section by
// section), bylines, and the optimistic edits HomeProvider makes before a write lands.
// Dates are ISODate days in the household's time zone; nothing here reads the clock
// (callers pass `today`, `now` and the zone).
//
// Each function's doc comment is its spec; the unit tests it lists ("Tests:") are in
// src/lib/logic/housekeeping.test.ts.

import { HOUSEKEEPING_PRICE_MAX_PENCE } from '../constants';
import type {
  HousekeepingData,
  HousekeepingNote,
  HousekeepingSection,
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
import { formatDay, zonedParts } from './dates';
import { fullDay, monthOf, type YearMonth } from './months';

// The month grid's helpers live in ./months (Home's calendar shares them); Housekeeping
// keeps exporting them under the names it has always had.
export { WEEKDAYS, monthGrid, monthOf, monthTitle, shiftMonth, type YearMonth } from './months';

const pad = (n: number) => String(n).padStart(2, '0');

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A visit's rows in their order: position, then title, then id (as the backends load them). */
const byRowOrder = (a: HousekeepingVisitTask, b: HousekeepingVisitTask) =>
  a.position - b.position || compareText(a.title, b.title) || compareText(a.id, b.id);

/** Sections in their order (a stable sort keeps the loaded order for equal positions). */
const bySectionPosition = (a: HousekeepingSection, b: HousekeepingSection) => a.position - b.position;

// ── Empty state ───────────────────────────────────────────

/** A household's housekeeping before anything is written: no message, no sections, no tasks, no visits. */
export function emptyHousekeeping(): HousekeepingData {
  return { note: { body: '', updated_at: null, updated_by: null }, sections: [], tasks: [], visits: [] };
}

// ── The task list's order (docs/ARCHITECTURE.md "Housekeeping", "Sections") ──

/**
 * Where each section comes on the list: 1 for the first section, 2 for the next…; the tasks
 * in no section are 0 (first). A section id that is not among `sections` (gone) also gives 0.
 */
function sectionRanks(sections: HousekeepingSection[]): (sectionId: string | null) => number {
  const rank = new Map([...sections].sort(bySectionPosition).map((s, i) => [s.id, i + 1]));
  return (sectionId) => (sectionId === null ? 0 : (rank.get(sectionId) ?? 0));
}

/**
 * The task list in its order (HousekeepingData.tasks): the tasks in no section first, then
 * section by section in the sections' order, each by position. A task whose section is not
 * among `sections` counts as in no section. A stable sort: equal positions keep the order the
 * tasks came in (the backends break ties by created_at, then id, as they load them).
 * Tests: no sections (by position); tasks in no section first, then each section in order;
 * a section moved first brings its tasks with it; a task in a section that is gone sorts
 * with no section; equal positions keep their order; the input is not mutated.
 */
export function listOrder(sections: HousekeepingSection[], tasks: HousekeepingTask[]): HousekeepingTask[] {
  const rank = sectionRanks(sections);
  return [...tasks].sort((a, b) => rank(a.section_id) - rank(b.section_id) || a.position - b.position);
}

/** The list's tasks in one section (or in none), in order. */
export interface TaskListGroup {
  /** null: the tasks in no section (first, with no heading). */
  section: HousekeepingSection | null;
  tasks: HousekeepingTask[];
}

/**
 * The task list as the editor shows it: the tasks in no section first (that group is always
 * there, even with no task in it: it is where Add Task with no section goes, and where a task
 * is dropped to take it out of its section), then every section in order with its tasks
 * (a section may have none).
 * Tests: no sections gives one group; groups in the sections' order; an empty section is
 * kept; a task in a section that is gone is in the first group.
 */
export function taskListGroups(housekeeping: HousekeepingData): TaskListGroup[] {
  const sections = [...housekeeping.sections].sort(bySectionPosition);
  const known = new Set(sections.map((s) => s.id));
  const ordered = listOrder(sections, housekeeping.tasks);
  const inSection = (task: HousekeepingTask) => (task.section_id !== null && known.has(task.section_id) ? task.section_id : null);
  return [
    { section: null, tasks: ordered.filter((t) => inSection(t) === null) },
    ...sections.map((section) => ({ section, tasks: ordered.filter((t) => inSection(t) === section.id) })),
  ];
}

/**
 * A visit laid out as the list now stands: "today's visit follows the list", as the backends
 * do after every change to the list (housekeeping_relay() in
 * supabase/migrations/20261015000100_housekeeping_sections.sql, DemoBackend.relay()). Each row
 * whose task is on the list takes that task's section (its id, and its name as
 * section_title) and the task's place; a row whose task is gone (a ticked row, kept as a
 * record) keeps its section while that section is on the list (and follows its name), else
 * has none, and comes after the rows of that section's tasks, in the order it had. Positions
 * then run 0…n-1, section by section, the rows in no section first. Titles and ticks are left
 * alone. Returns the same visit when nothing changes.
 * Tests: rows follow their tasks' sections and order; names follow; a row whose task is gone
 * stays in its section, after the others; its section deleted: no section; nothing to change
 * gives the same object; the input is not mutated.
 */
export function relayVisit(
  visit: HousekeepingVisit,
  sections: HousekeepingSection[],
  tasks: HousekeepingTask[],
): HousekeepingVisit {
  const rank = sectionRanks(sections);
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const place = new Map(listOrder(sections, tasks).map((t, i) => [t.id, i]));
  const laid = [...visit.tasks].sort(byRowOrder).map((row) => {
    const task = row.task_id !== null ? taskById.get(row.task_id) : undefined;
    const sectionId = task ? task.section_id : row.section_id;
    const section = sectionId !== null ? sectionById.get(sectionId) : undefined;
    return { row, task, section };
  });
  laid.sort(
    (a, b) =>
      rank(a.section?.id ?? null) - rank(b.section?.id ?? null) ||
      (a.task ? 0 : 1) - (b.task ? 0 : 1) ||
      (a.task && b.task ? place.get(a.task.id)! - place.get(b.task.id)! : 0),
  );
  let changed = false;
  const rows = laid.map(({ row, section }, position) => {
    const section_id = section?.id ?? null;
    const section_title = section?.title ?? '';
    if (row.position === position && row.section_id === section_id && row.section_title === section_title) {
      if (visit.tasks[position] !== row) changed = true;
      return row;
    }
    changed = true;
    return { ...row, position, section_id, section_title };
  });
  return changed ? { ...visit, tasks: rows } : visit;
}

// ── Calendar ──────────────────────────────────────────────

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
 * today's year (`'Thursday 31 December 2025'`): fullDay() in ./months.
 * Tests: same year; a different year; the 1st of a month.
 */
export const longDay: (date: ISODate, today: ISODate) => string = fullDay;

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
 * What the screen says (politely) when a day is chosen in the calendar, since its details
 * show under the calendar (and the message), out of sight on a small screen: `'Thursday 1
 * October: 6 of 7 done, £60.00. Details below the calendar.'`, `'Tuesday 6 October: no visit
 * recorded. Details below the calendar.'`, `'Tuesday 6 October: nothing recorded yet.
 * Details below the calendar.'` (a visit with nothing recorded), and for today, `', today'`
 * after the date and `'not started yet'` until something is recorded: `'Thursday 8 October,
 * today: not started yet. Details below the calendar.'`, `'Thursday 8 October, today: 1 of 7
 * done. Details below the calendar.'`.
 * Tests: each example; a visit without a price; today with a visit with nothing recorded.
 */
export function daySelectedAnnouncement(date: ISODate, today: ISODate, visit: HousekeepingVisit | undefined): string {
  const isToday = date === today;
  const day = isToday ? `${longDay(date, today)}, today` : longDay(date, today);
  let what: string;
  if (visit && isRecorded(visit)) {
    const { done, total } = doneCount(visit);
    what = `${done} of ${total} done`;
    if (visit.price_pence !== null) what += `, ${formatPrice(visit.price_pence)}`;
  } else if (isToday) what = 'not started yet';
  else what = visit ? 'nothing recorded yet' : 'no visit recorded';
  return `${day}: ${what}. Details below the calendar.`;
}

/**
 * The line beside the calendar while today is chosen and shown, as Home's says what is due
 * today: `'No visit yet today'` until something is recorded (isRecorded()), then `'6 of 7
 * done today'`, with the price when there is one (`'6 of 7 done today · £60.00'`);
 * `'Visit today'` for a visit without tasks (`'Visit today · £60.00'`).
 * Tests: no visit; a visit with nothing recorded; ticks; ticks and a price; no tasks.
 */
export function todayLine(visit: HousekeepingVisit | undefined): string {
  if (!visit || !isRecorded(visit)) return 'No visit yet today';
  const { done, total } = doneCount(visit);
  const line = total ? `${done} of ${total} done today` : 'Visit today';
  return visit.price_pence === null ? line : `${line} · ${formatPrice(visit.price_pence)}`;
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
 * The days that have a recorded visit (isRecorded(); to mark them in the grid), in `month`
 * when given, else in any month (a week strip may show two).
 * Tests: visits in the month, the month before and after (only the month's count); without
 * a month, all of them; none; a visit with nothing recorded is left out.
 */
export function visitDays(visits: HousekeepingVisit[], month?: YearMonth): Set<ISODate> {
  return new Set(
    visits.filter((v) => (month === undefined || monthOf(v.visit_date) === month) && isRecorded(v)).map((v) => v.visit_date),
  );
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

/** One section of a day's checklist (or the tasks in no section, which come first). */
export interface ChecklistSection {
  /**
   * Stable React key: `none` for the tasks in no section, `section:<id>` for a section, and
   * `title:<n>:<name>` for a section deleted since (an earlier visit keeps it by its name, in
   * its place; `n` counts the deleted sections up to it on the visit).
   */
  key: string;
  /** The section's name as the day has it; null for the tasks in no section (no heading). */
  title: string | null;
  rows: ChecklistRow[];
  /** How many of its rows are ticked. */
  done: number;
}

const checklistRow = (row: HousekeepingVisitTask): ChecklistRow => ({
  key: row.task_id !== null ? `task:${row.task_id}` : `row:${row.id}`,
  title: row.title,
  done: row.done,
  doneBy: row.done ? row.done_by : null,
  doneAt: row.done ? row.done_at : null,
  target: row.task_id !== null ? { taskId: row.task_id } : { visitTaskId: row.id },
});

/**
 * The checklist for `date`, section by section. With a visit that day: its rows in their
 * order, grouped by the section each row had on the visit (its id; for a section deleted
 * since, which its rows know only by the name they kept, each run of rows next to each other
 * with that name, so two deleted sections of the same name with something between them stay
 * two, in their places), in the order the sections come on the visit, under the name the
 * visit has for them (an earlier visit keeps the sections it had). Without one: the task
 * list, none done (what ticking would start the visit with), grouped by the list's sections.
 * Either way the tasks in no section come first (title null, no heading), and a section with
 * no tasks is left out.
 * Tests: no sections gives one untitled group; a day without a visit groups the list by its
 * sections in order and leaves an empty one out; a visit keeps the sections and names it had
 * (renamed or reordered since); a section deleted since stays by its name; two deleted
 * sections of the same name stay apart, in their places; rows in no section come first; done
 * counts; a visit with no rows gives [].
 */
export function checklistSections(housekeeping: HousekeepingData, date: ISODate): ChecklistSection[] {
  const visit = visitOn(housekeeping.visits, date);
  const groups = new Map<string, ChecklistSection>();
  const add = (key: string, title: string | null, row: ChecklistRow) => {
    let group = groups.get(key);
    if (!group) {
      group = { key, title, rows: [], done: 0 };
      groups.set(key, group);
    }
    group.rows.push(row);
    if (row.done) group.done += 1;
  };
  if (visit) {
    // A deleted section's rows are told apart only by the name they kept: a run of them next
    // to each other on the visit is one section, counted so that its key is its own.
    let runs = 0;
    let run: string | null = null;
    for (const row of [...visit.tasks].sort(byRowOrder)) {
      const deleted = row.section_id === null && row.section_title !== '';
      if (deleted && run !== row.section_title) runs += 1;
      run = deleted ? row.section_title : null;
      if (row.section_id !== null) add(`section:${row.section_id}`, row.section_title, checklistRow(row));
      else if (deleted) add(`title:${runs}:${row.section_title}`, row.section_title, checklistRow(row));
      else add('none', null, checklistRow(row));
    }
  } else {
    for (const { section, tasks } of taskListGroups(housekeeping)) {
      for (const task of tasks) {
        const row: ChecklistRow = {
          key: `task:${task.id}`,
          title: task.title,
          done: false,
          doneBy: null,
          doneAt: null,
          target: { taskId: task.id },
        };
        if (section) add(`section:${section.id}`, section.title, row);
        else add('none', null, row);
      }
    }
  }
  const none = groups.get('none');
  return none ? [none, ...[...groups.values()].filter((g) => g !== none)] : [...groups.values()];
}

/**
 * The checklist for `date` as one list: checklistSections()' rows, section by section.
 * Tests: a day with a visit; a visit with a row whose task was deleted (task_id null:
 * `row:` key and `{ visitTaskId }` target); a day with no visit gives the task list in
 * its order, unticked, with `task:` keys and `{ taskId }` targets; empty task list
 * and no visit gives [].
 */
export function checklistFor(housekeeping: HousekeepingData, date: ISODate): ChecklistRow[] {
  return checklistSections(housekeeping, date).flatMap((g) => g.rows);
}

/**
 * A section's progress on the checklist, as its header shows it: `'2 of 5'`; once every task
 * is ticked `'All done'`, or `'Done'` for a section of one task.
 * Tests: some done; none; all; one task, ticked and not.
 */
export function sectionProgress(done: number, total: number): string {
  if (total > 0 && done === total) return total === 1 ? 'Done' : 'All done';
  return `${done} of ${total}`;
}

/**
 * A section's progress in words, as its heading says it after the name: `'2 of 5 done'`;
 * once every task is ticked `'all 5 done'`, or `'done'` for a section of one task.
 * Tests: some done; all done; one task, ticked and not.
 */
export function sectionDoneWords(done: number, total: number): string {
  if (total > 0 && done === total) return total === 1 ? 'done' : `all ${total} done`;
  return `${done} of ${total} done`;
}

/**
 * What a section's heading is called, its progress included, as VoiceOver reads it:
 * `'Kitchen, 2 of 5 done'`; once every task is ticked `'Kitchen, all 5 done'` (`'Bins, done'`
 * for a section of one task).
 * Tests: some done; all done; one task.
 */
export function sectionHeadingLabel(title: string, done: number, total: number): string {
  return `${title}, ${sectionDoneWords(done, total)}`;
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
 * A visit as the database creates it: the task list copied in its order (title, task_id,
 * the section's id and name, none done, positions 0…n-1 running section by section), the
 * message via snapshotNote(), empty comments, no price.
 * Tests: rows copy the list in its order with the given ids and their sections; the note
 * rule; empty task list gives no rows; the input data is not mutated.
 */
export function newVisit(housekeeping: HousekeepingData, input: NewVisitInput): HousekeepingVisit {
  const sections = new Map(housekeeping.sections.map((s) => [s.id, s]));
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
    tasks: listOrder(housekeeping.sections, housekeeping.tasks).map((task, position) => {
      const section = task.section_id !== null ? sections.get(task.section_id) : undefined;
      return {
        id: input.rowId(task.id),
        visit_id: input.id,
        household_id: input.householdId,
        task_id: task.id,
        title: task.title,
        section_id: section?.id ?? null,
        section_title: section?.title ?? '',
        position,
        done: false,
        done_by: null,
        done_at: null,
      };
    }),
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
 * `housekeeping` with its sections and tasks in their order and today's visit (if any) laid
 * out as the list now stands (relayVisit()). The other visits are left as they were. The
 * with* helpers below end with it, and the provider's reverts too, after putting values back.
 * Tests: sorts the sections and the list; lays out today, not last week; nothing to change
 * keeps today's visit as it was.
 */
export function withListSettled(housekeeping: HousekeepingData, today: ISODate): HousekeepingData {
  const sections = [...housekeeping.sections].sort(bySectionPosition);
  const tasks = listOrder(sections, housekeeping.tasks);
  return {
    ...housekeeping,
    sections,
    tasks,
    visits: withTodaysVisit(housekeeping, today, (visit) => relayVisit(visit, sections, tasks)),
  };
}

/**
 * The task list with `task` added (at the end of its section, where its position puts it),
 * and today's visit (if any) with a row for it (not done, `pending:<task.id>` id unless the
 * visit already has it) in the task's place.
 * Tests: added to the list and to today's visit; into a section, in its place on both;
 * earlier visits untouched; no visit today; added twice is once.
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
      section_id: null,
      section_title: '',
      position: visit.tasks.length,
      done: false,
      done_by: null,
      done_at: null,
    };
    return { ...visit, tasks: [...visit.tasks, row] };
  });
  return withListSettled({ ...housekeeping, tasks, visits }, today);
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
 * on every other visit (and today's done row) the row's task_id becomes null. Today's done
 * row stays in its section, after the rows of the tasks still in it (relayVisit()).
 * Tests: undone row removed today; done row kept today with task_id null, at the end of its
 * section; earlier visits keep the row with task_id null in its place; unknown id leaves
 * everything as it was.
 */
export function withTaskDeleted(housekeeping: HousekeepingData, id: string, today: ISODate): HousekeepingData {
  if (!housekeeping.tasks.some((t) => t.id === id)) return housekeeping;
  const tasks = housekeeping.tasks.filter((t) => t.id !== id);
  return {
    ...housekeeping,
    tasks,
    visits: housekeeping.visits.map((visit) => {
      if (!visit.tasks.some((row) => row.task_id === id)) return visit;
      const isToday = visit.visit_date === today;
      const rows = visit.tasks
        .filter((row) => !(isToday && row.task_id === id && !row.done))
        .map((row) => (row.task_id === id ? { ...row, task_id: null } : row));
      const next = { ...visit, tasks: rows };
      return isToday ? relayVisit(next, housekeeping.sections, tasks) : next;
    }),
  };
}

/**
 * The task moved into `sectionId` (null: the tasks in no section) at `index` among that
 * section's other tasks (0 first; past the end: last), as moveHousekeepingTask() stores it:
 * the places in the section it joined, and in the one it left, run 0…n-1 again, and every
 * other task keeps its place. Today's visit follows; earlier visits never change. A task or
 * a section that is not on the list leaves everything as it was.
 * Tests: within a section, down and up; into another section at its start, in the middle and
 * past its end; out of a section to the tasks in no section; into an empty section; today
 * follows (a ticked row keeps its title), last week does not; unknown task or section; the
 * input is not mutated.
 */
export function withTaskMoved(
  housekeeping: HousekeepingData,
  id: string,
  sectionId: string | null,
  index: number,
  today: ISODate,
): HousekeepingData {
  const groups = taskListGroups(housekeeping);
  const from = groups.find((g) => g.tasks.some((t) => t.id === id));
  const to = groups.find((g) => (g.section?.id ?? null) === sectionId);
  if (!from || !to) return housekeeping;
  const placed = new Map<string, { section_id: string | null; position: number }>();
  if (from !== to) {
    from.tasks
      .filter((t) => t.id !== id)
      .forEach((t, position) => placed.set(t.id, { section_id: from.section?.id ?? null, position }));
  }
  const ids = to.tasks.map((t) => t.id).filter((x) => x !== id);
  ids.splice(Math.min(Math.max(Math.trunc(index) || 0, 0), ids.length), 0, id);
  ids.forEach((x, position) => placed.set(x, { section_id: sectionId, position }));
  const tasks = housekeeping.tasks.map((t) => {
    const at = placed.get(t.id);
    return at && (at.section_id !== t.section_id || at.position !== t.position) ? { ...t, ...at } : t;
  });
  return withListSettled({ ...housekeeping, tasks }, today);
}

/**
 * The sections with `section` added (where its position puts it; already there: once).
 * Tests: added last; added twice is once.
 */
export function withSectionAdded(housekeeping: HousekeepingData, section: HousekeepingSection): HousekeepingData {
  if (housekeeping.sections.some((s) => s.id === section.id)) return housekeeping;
  return { ...housekeeping, sections: [...housekeeping.sections, section].sort(bySectionPosition) };
}

/**
 * The section renamed (trimmed); today's visit follows the name, ticked rows included (a
 * ticked row keeps the title it was ticked under, not its section's old name). Earlier
 * visits keep the name they had.
 * Tests: the list and today renamed; last week keeps the old name; unknown id leaves
 * everything as it was.
 */
export function withSectionRenamed(housekeeping: HousekeepingData, id: string, title: string, today: ISODate): HousekeepingData {
  if (!housekeeping.sections.some((s) => s.id === id)) return housekeeping;
  const clean = title.trim();
  const sections = housekeeping.sections.map((s) => (s.id === id ? { ...s, title: clean } : s));
  return withListSettled({ ...housekeeping, sections }, today);
}

/**
 * The section deleted, keeping its tasks: they move to the top, with no section (after the
 * tasks already there, in their order), on the list and on today's visit (a ticked row whose
 * task is gone comes along too). Earlier visits keep the section by its name (section_id
 * null, section_title as it was).
 * Tests: tasks move to the top in order, after the ones with no section; today follows;
 * last week keeps the section's name; unknown id leaves everything as it was.
 */
export function withSectionDeleted(housekeeping: HousekeepingData, id: string, today: ISODate): HousekeepingData {
  if (!housekeeping.sections.some((s) => s.id === id)) return housekeeping;
  const sections = housekeeping.sections.filter((s) => s.id !== id);
  // After the tasks already in no section, in the order they had in the section.
  let next = housekeeping.tasks.reduce((n, t) => (t.section_id === null ? Math.max(n, t.position + 1) : n), 0);
  const moved = new Map<string, number>();
  for (const task of listOrder(housekeeping.sections, housekeeping.tasks)) {
    if (task.section_id === id) moved.set(task.id, next++);
  }
  const tasks = housekeeping.tasks.map((t) => (moved.has(t.id) ? { ...t, section_id: null, position: moved.get(t.id)! } : t));
  const visits = housekeeping.visits.map((visit) =>
    visit.visit_date !== today && visit.tasks.some((row) => row.section_id === id)
      ? { ...visit, tasks: visit.tasks.map((row) => (row.section_id === id ? { ...row, section_id: null } : row)) }
      : visit,
  );
  return withListSettled({ ...housekeeping, sections, tasks, visits }, today);
}

/**
 * The section moved to `index` among the others (0 first; past the end: last), as
 * moveHousekeepingSection() stores it: the sections' positions run 0…n-1 again, its tasks
 * coming along. Today's visit follows; earlier visits never change. A section that is not on
 * the list leaves everything as it was.
 * Tests: moved first brings its tasks; moved down one; past the end is last; today follows,
 * last week does not; unknown id.
 */
export function withSectionMoved(housekeeping: HousekeepingData, id: string, index: number, today: ISODate): HousekeepingData {
  if (!housekeeping.sections.some((s) => s.id === id)) return housekeeping;
  const ids = [...housekeeping.sections]
    .sort(bySectionPosition)
    .map((s) => s.id)
    .filter((x) => x !== id);
  ids.splice(Math.min(Math.max(Math.trunc(index) || 0, 0), ids.length), 0, id);
  const position = new Map(ids.map((x, i) => [x, i]));
  const sections = housekeeping.sections.map((s) => (position.get(s.id) !== s.position ? { ...s, position: position.get(s.id)! } : s));
  return withListSettled({ ...housekeeping, sections }, today);
}
