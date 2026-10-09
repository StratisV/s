import type { ISODate, ISOTimestamp } from '../types';

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
export function zonedParts(now: Date, timeZone: string): { date: ISODate; hour: number; minute: number } {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = partsFormatter(timeZone);
  } catch {
    fmt = partsFormatter('UTC');
  }
  const p: Record<string, string> = {};
  for (const { type, value } of fmt.formatToParts(now)) p[type] = value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
  };
}

/** Today's date in `timeZone`. */
export function todayIn(timeZone: string, now: Date = new Date()): ISODate {
  return zonedParts(now, timeZone).date;
}

/** The browser's IANA time zone (for new households). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
  } catch {
    return 'Europe/London';
  }
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

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Adds calendar months, clamping to the end of the month (31 Jan + 1 → 28/29 Feb). */
export function addMonths(d: ISODate, n: number): ISODate {
  const { y, m, d: day } = parseISODate(d);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(day, daysInMonth(ny, nm)))}`;
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toUTC(to).getTime() - toUTC(from).getTime()) / 86_400_000);
}

/** "Tue 20 Oct"; the year is added when it differs from today's ("Tue 5 Jan 2027"). */
export function formatDay(d: ISODate, today: ISODate): string {
  const dt = toUTC(d);
  const base = `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
  return parseISODate(today).y === dt.getUTCFullYear() ? base : `${base} ${dt.getUTCFullYear()}`;
}

/** "October", for captions. */
/** "Friday 9 October": a day written out in full (UK style). */
export function longDay(d: ISODate): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(toUTC(d));
}

export function monthName(d: ISODate): string {
  return toUTC(d).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
}

/** `YYYY-MM` of a timestamp in `timeZone`. */
export function monthKey(ts: ISOTimestamp | Date, timeZone: string): string {
  const date = zonedParts(typeof ts === 'string' ? new Date(ts) : ts, timeZone).date;
  return date.slice(0, 7);
}
