/** Dates as the phone sees them (local time), as 'YYYY-MM-DD' keys. */

const pad = (n: number) => String(n).padStart(2, '0');

export function dateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A 'YYYY-MM-DD' key as a local date at midday (midday keeps DST changes from moving the day). */
export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
}

/** Whole days from one key to another (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((fromKey(to).getTime() - fromKey(from).getTime()) / 86_400_000);
}

export function addDays(key: string, days: number): string {
  const date = fromKey(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

/** A steady number for a day, for picking "today's" content the same way all day. */
export function dayNumber(key: string): number {
  return daysBetween('2020-01-06', key);
}

/** The ISO week a date falls in: '2026-W46'. */
export function isoWeek(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad(week)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '9 Nov 2026', or '9 Nov' with `withYear` false. Takes 'YYYY-MM-DD' or 'YYYY-MM'. */
export function formatDate(key: string, withYear = true): string {
  const [y, m, d] = key.split('-').map(Number);
  const month = MONTHS[(m || 1) - 1];
  const head = d ? `${d} ${month}` : month;
  return withYear ? `${head} ${y}` : head;
}
