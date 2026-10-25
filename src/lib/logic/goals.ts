// Goals for the week: pure logic for the Goals tab and its public link (docs/ARCHITECTURE.md
// "Goals for the week"). Weeks, the order of a week's goals, Bring over, the words the screen
// and the public page use, the link's token, and the optimistic edits HomeProvider makes
// before a write lands.
// Dates are ISODate days in the household's time zone; nothing here reads the clock (callers
// pass `today`, `now` and the zone).
//
// Each function's doc comment is its spec; the unit tests it lists ("Tests:") are in
// src/lib/logic/goals.test.ts.

import { GOALS_PER_WEEK_MAX } from '../constants';
import type { Goal, GoalsData, ISODate, ISOTimestamp, Member, PublicGoals } from '../types';
import { addDays, daysBetween, formatDay, parseISODate, zonedParts } from './dates';
import { weekdayIndex } from './months';

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ── Empty state ───────────────────────────────────────────

/** A household's goals before anyone adds one: none, and no public link. */
export function emptyGoals(): GoalsData {
  return { list: [], link: null };
}

// ── Weeks (Monday to Sunday, household time zone) ─────────

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** A real calendar day written YYYY-MM-DD. */
export function isISODay(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { y, m, d } = parseISODate(value);
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  return d <= [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/**
 * The Monday of the week `date` is in.
 * Tests: a Thursday; a Monday is its own; a Sunday belongs to the Monday before; across a
 * month end and a year end.
 */
export function weekStart(date: ISODate): ISODate {
  return addDays(date, -weekdayIndex(date));
}

/**
 * Whether `value` names a week: a real day that is a Monday. The backends refuse any other.
 * Tests: a Monday; a Sunday; not a date; 30 February.
 */
export function isWeekStart(value: unknown): value is ISODate {
  return isISODay(value) && weekdayIndex(value) === 0;
}

/** The week before (`n` = -1) or after (1), n weeks away. */
export function shiftWeek(monday: ISODate, n: number): ISODate {
  return addDays(monday, 7 * n);
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A week's days, short: `'5 to 11 Oct'`; across two months `'28 Sep to 4 Oct'`; the year when
 * it is not today's, after the day it belongs to (`'4 to 10 Jan 2027'`, `'28 Dec to 3 Jan
 * 2027'`, or seen from 2027, `'28 Dec 2026 to 3 Jan'`).
 * Tests: one month; two months; another year; across a year end, from either year.
 */
export function weekDates(monday: ISODate, today: ISODate): string {
  const first = parseISODate(monday);
  const last = parseISODate(addDays(monday, 6));
  const year = parseISODate(today).y;
  const lastYear = last.y === year ? '' : ` ${last.y}`;
  if (first.m === last.m) return `${first.d} to ${last.d} ${SHORT_MONTHS[last.m - 1]}${lastYear}`;
  const firstYear = first.y === year || first.y === last.y ? '' : ` ${first.y}`;
  return `${first.d} ${SHORT_MONTHS[first.m - 1]}${firstYear} to ${last.d} ${SHORT_MONTHS[last.m - 1]}${lastYear}`;
}

/** How many weeks `monday` is from today's week (0 this week, 1 next, -1 last). */
export function weeksFromNow(monday: ISODate, today: ISODate): number {
  return Math.round(daysBetween(weekStart(today), monday) / 7);
}

/**
 * The week as the screen names it: `'This week, 5 to 11 Oct'`, `'Next week, 12 to 18 Oct'`,
 * `'Last week, 28 Sep to 4 Oct'`; any other week by its days alone (`'19 to 25 Oct'`).
 * Tests: this, next and last week; two weeks away either way; another year.
 */
export function weekLabel(monday: ISODate, today: ISODate): string {
  const n = weeksFromNow(monday, today);
  const dates = weekDates(monday, today);
  if (n === 0) return `This week, ${dates}`;
  if (n === 1) return `Next week, ${dates}`;
  if (n === -1) return `Last week, ${dates}`;
  return dates;
}

// ── A week's goals ────────────────────────────────────────

/** Goals in their order: week, then position, then created_at, then id (as the backends load them). */
export function byGoalOrder(a: Goal, b: Goal): number {
  return (
    compareText(a.week, b.week) ||
    a.position - b.position ||
    compareText(a.created_at, b.created_at) ||
    compareText(a.id, b.id)
  );
}

/**
 * The goals of the week starting `monday`, in their order.
 * Tests: only that week's; in order whatever the list's order.
 */
export function goalsOf(list: Goal[], monday: ISODate): Goal[] {
  return list.filter((g) => g.week === monday).sort(byGoalOrder);
}

/** How many of `goals` are done, of how many. */
export function goalsProgress(goals: { done: boolean }[]): { done: number; total: number } {
  return { done: goals.filter((g) => g.done).length, total: goals.length };
}

/**
 * The line under the screen's title, for the week shown: `'2 of 5 done'`, `'All 3 done'`
 * (`'Done'` for a week of one), or with nothing in it `'Nothing planned yet'` for this week
 * and later, `'Nothing planned that week'` for an earlier one.
 * Tests: some done; none done; all done; one goal done; empty now, later and earlier.
 */
export function progressLine(goals: Goal[], monday: ISODate, today: ISODate): string {
  const { done, total } = goalsProgress(goals);
  if (total === 0) return weeksFromNow(monday, today) < 0 ? 'Nothing planned that week' : 'Nothing planned yet';
  if (done === total) return total === 1 ? 'Done' : `All ${total} done`;
  return `${done} of ${total} done`;
}

/**
 * The count on the Goals tab: how many of this week's goals (the week `today` is in) are not
 * done; 0 shows no badge.
 * Tests: this week's open goals only (last and next week's left out); none.
 */
export function openThisWeek(list: Goal[], today: ISODate): number {
  const monday = weekStart(today);
  return list.filter((g) => g.week === monday && !g.done).length;
}

/**
 * What Bring over brings into the week starting `monday`: the week before's goals that are not
 * done and have not been brought into it already (no goal of `monday`'s week has one as its
 * carried_from), in their order, as many as fit under GOALS_PER_WEEK_MAX.
 * Tests: the unfinished ones in order; done ones stay; ones brought already stay; nothing
 * last week; a full week brings what fits.
 */
export function toBringOver(list: Goal[], monday: ISODate): Goal[] {
  const here = list.filter((g) => g.week === monday);
  const brought = new Set(here.map((g) => g.carried_from).filter((id): id is string => id !== null));
  const room = Math.max(0, GOALS_PER_WEEK_MAX - here.length);
  return goalsOf(list, shiftWeek(monday, -1))
    .filter((g) => !g.done && !brought.has(g.id))
    .slice(0, room);
}

/**
 * The Bring over button: `'Bring over 2 from last week'` (`'Bring over 1 from last week'`).
 * Tests: one; several.
 */
export function bringOverLabel(count: number): string {
  return `Bring over ${count} from last week`;
}

// ── People and times ──────────────────────────────────────

/**
 * The first word of a name, as the public page and the done line use it: `'Stratis'` from
 * `'Stratis Vlachos'`; a name of one word stays as it is; blank gives ''.
 * Tests: two words; one word; extra spaces; blank.
 */
export function firstName(name: string): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * When something happened, for the line under a goal: `'Today 10:42'`, `'Yesterday 19:20'`,
 * else `'Tue 6 Oct 10:05'` (with the year when it is not this year's), in `timeZone`.
 * Tests: today; yesterday; earlier this year; another year; the zone moves the day.
 */
export function stampLabel(ts: ISOTimestamp, timeZone: string, now: Date): string {
  const at = zonedParts(new Date(ts), timeZone);
  const today = zonedParts(now, timeZone).date;
  const time = `${String(at.hour).padStart(2, '0')}:${String(at.minute).padStart(2, '0')}`;
  if (at.date === today) return `Today ${time}`;
  if (at.date === addDays(today, -1)) return `Yesterday ${time}`;
  return `${formatDay(at.date, today)} ${time}`;
}

/**
 * Under a ticked goal, after who is on it: `'Done · Today 10:42'` when the person on it (or
 * nobody, or someone since removed) ticked it, else `'Done by Shea · Today 10:42'` (their
 * first name); without the time when it has none. Null while it is not done.
 * Tests: not done (null); ticked by the person on it; by someone else; on nobody; by someone
 * removed; no time.
 */
export function doneLine(goal: Goal, members: Member[], timeZone: string, now: Date): string | null {
  if (!goal.done) return null;
  const by = goal.done_by && goal.done_by !== goal.member_id ? members.find((m) => m.id === goal.done_by) : undefined;
  const who = by ? `Done by ${firstName(by.name)}` : 'Done';
  return goal.done_at ? `${who} · ${stampLabel(goal.done_at, timeZone, now)}` : who;
}

// ── The public link ───────────────────────────────────────

/** A link's token: 16 random bytes as base64url without padding (22 characters). */
export const GOALS_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** Whether `value` is shaped like a link's token (anything else names no link, without a lookup). */
export function isGoalsToken(value: unknown): value is string {
  return typeof value === 'string' && GOALS_TOKEN.test(value);
}

/**
 * A fresh token: 16 bytes from `random` (default crypto.getRandomValues) as base64url.
 * Tests: 22 characters of the alphabet; different each time; the bytes as given.
 */
export function newGoalsToken(random: (bytes: Uint8Array) => Uint8Array = defaultRandom): string {
  const bytes = random(new Uint8Array(16));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function defaultRandom(bytes: Uint8Array): Uint8Array {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') throw new Error('No secure random numbers here');
  return c.getRandomValues(bytes);
}

/**
 * Whether two tokens are the same, in time that does not depend on where they differ (the
 * server compares SHA-256 digests with timingSafeEqual instead; this is for the demo).
 * Tests: equal; one character different; different lengths.
 */
export function sameToken(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** The query parameter the public link carries its token in. */
export const GOALS_PARAM = 'goals';

/**
 * The public link: `<appUrl>?goals=<token>` (appUrl is the app's address, ending in `/`).
 * Tests: the root; a sub-path.
 */
export function goalsLinkUrl(appUrl: string, token: string): string {
  const url = new URL(appUrl);
  url.search = '';
  url.hash = '';
  url.searchParams.set(GOALS_PARAM, token);
  return url.toString();
}

/**
 * The token a page address carries (`?goals=<token>`), or null when it has none; a value that
 * is not a token is returned as it is (the page then says the link is not active).
 * Tests: a token; none; another parameter alongside; empty.
 */
export function goalsTokenIn(search: string): string | null {
  const value = new URLSearchParams(search).get(GOALS_PARAM);
  return value === null ? null : value;
}

/** What a share sheet sends: the words, and the link on its own line. */
export function goalsShareText(url: string): string {
  return `Our goals for the week\n${url}`;
}

/**
 * What the public link shows for the week starting `monday`: its goals in order, each with its
 * tick and who is on it by first name and emoji (null for nobody, or someone not in `members`).
 * Nothing else: no ids, no dates of ticks, nobody who is not on a goal.
 * Tests: the fields and nothing more; order; a person; nobody; someone gone; other weeks left out.
 */
export function publicGoalsOf(list: Goal[], members: Member[], monday: ISODate): PublicGoals {
  const people = new Map(members.map((m) => [m.id, m]));
  return {
    week: monday,
    goals: goalsOf(list, monday).map((g) => {
      const m = g.member_id ? people.get(g.member_id) : undefined;
      return { title: g.title, done: g.done, person: m ? { name: firstName(m.name), emoji: m.emoji } : null };
    }),
  };
}

// ── Optimistic edits (HomeProvider shows these before the write lands) ──
// They return new objects and never change their input. They follow the backends' rules, so
// the reload after a write rarely moves anything.

/** `list` with the goals of `monday`'s week given positions 0…n-1 in `order` (their ids). */
function placed(list: Goal[], ids: string[]): Goal[] {
  const at = new Map(ids.map((id, i) => [id, i]));
  return list.map((g) => {
    const position = at.get(g.id);
    return position === undefined || position === g.position ? g : { ...g, position };
  });
}

/**
 * A goal just stored (or brought over), at the end of its week; one already there is replaced.
 * Tests: added last; replaces one with the same id.
 */
export function withGoalAdded(data: GoalsData, goal: Goal): GoalsData {
  const list = [...data.list.filter((g) => g.id !== goal.id), goal].sort(byGoalOrder);
  return { ...data, list };
}

/** Changes some fields of one goal (nothing when it is gone). */
export function withGoalPatched(data: GoalsData, id: string, patch: Partial<Goal>): GoalsData {
  if (!data.list.some((g) => g.id === id)) return data;
  return { ...data, list: data.list.map((g) => (g.id === id ? { ...g, ...patch } : g)) };
}

/**
 * Ticks (`by` and `at` stamped) or unticks (both cleared) a goal.
 * Tests: tick stamps; untick clears; a goal that is gone changes nothing.
 */
export function withGoalDone(data: GoalsData, id: string, done: boolean, by: string | null, at: ISOTimestamp): GoalsData {
  return withGoalPatched(data, id, done ? { done, done_by: by, done_at: at } : { done, done_by: null, done_at: null });
}

/**
 * Moves a goal within its week to `index` among the others (0 first; past the end: last); the
 * week's positions run 0…n-1 again. Other weeks never change.
 * Tests: down; up; past the end; a goal that is gone.
 */
export function withGoalMoved(data: GoalsData, id: string, index: number): GoalsData {
  const goal = data.list.find((g) => g.id === id);
  if (!goal) return data;
  const others = goalsOf(data.list, goal.week)
    .filter((g) => g.id !== id)
    .map((g) => g.id);
  others.splice(Math.max(0, Math.min(index, others.length)), 0, id);
  return { ...data, list: placed(data.list, others).sort(byGoalOrder) };
}

/**
 * Deletes a goal; the rest of its week close up (positions 0…n-1), and a goal brought over
 * from it forgets where it came from (carried_from null).
 * Tests: closes up; carried_from cleared; a goal that is gone.
 */
export function withGoalDeleted(data: GoalsData, id: string): GoalsData {
  const goal = data.list.find((g) => g.id === id);
  if (!goal) return data;
  const rest = data.list
    .filter((g) => g.id !== id)
    .map((g) => (g.carried_from === id ? { ...g, carried_from: null } : g));
  const ids = goalsOf(rest, goal.week).map((g) => g.id);
  return { ...data, list: placed(rest, ids).sort(byGoalOrder) };
}
