// Calendar helpers for the scheduler. They mirror src/lib/logic/dates.ts (the app cannot be
// imported from here) so "today", "missed" and the date labels match what people see in the
// app. Runs unchanged in Deno and in Node (Vitest): only Intl and Date.

/** Calendar date without time, `YYYY-MM-DD`. */
export type ISODate = string;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');

function partsFormatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/** Wall-clock parts of `now` in `timeZone`. Falls back to UTC for an unknown zone. */
export function zonedParts(
  now: Date,
  timeZone: string,
): { date: ISODate; hour: number; minute: number; weekday: number } {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = partsFormatter(timeZone);
  } catch {
    fmt = partsFormatter('UTC');
  }
  const p: Record<string, string> = {};
  for (const { type, value } of fmt.formatToParts(now)) p[type] = value;
  const date = `${p.year}-${p.month}-${p.day}`;
  return {
    date,
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    weekday: weekdayOf(date),
  };
}

/** Today's date in `timeZone`. */
export function todayIn(timeZone: string, now: Date = new Date()): ISODate {
  return zonedParts(now, timeZone).date;
}

export function parseISODate(d: ISODate): { y: number; m: number; d: number } {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return { y, m, d: day };
}

function toUTC(d: ISODate): Date {
  const { y, m, d: day } = parseISODate(d);
  return new Date(Date.UTC(y, m - 1, day));
}

function fromUTC(dt: Date): ISODate {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addDays(d: ISODate, n: number): ISODate {
  const dt = toUTC(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUTC(dt);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toUTC(to).getTime() - toUTC(from).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday (the same numbering as households.weekly_email_day). */
export function weekdayOf(d: ISODate): number {
  return toUTC(d).getUTCDay();
}

/** "Tue 20 Oct"; the year is added when it differs from today's ("Tue 5 Jan 2027"). */
export function formatDay(d: ISODate, today: ISODate): string {
  const dt = toUTC(d);
  const base = `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
  return parseISODate(today).y === dt.getUTCFullYear() ? base : `${base} ${dt.getUTCFullYear()}`;
}

/**
 * Minutes after midnight for a Postgres `time` ("08:00", "08:00:00", "8:30").
 * Anything unreadable counts as 08:00, the default send time.
 */
export function minutesOfDay(time: string | null | undefined): number {
  const m = /^(\d{1,2}):(\d{2})/.exec((time ?? '').trim());
  if (!m) return 8 * 60;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return 8 * 60;
  return h * 60 + min;
}
