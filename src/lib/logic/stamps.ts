// Who and when, for bylines: times in the household's time zone ("Today 08:05") and the
// person behind a member id (or a former member).

import type { ISOTimestamp, Member } from '../types';
import { addDays, formatDay, zonedParts } from './dates';

/** Milliseconds since the epoch; any ISO form (`Z` or `+00:00`) compares the same. */
export const timeOf = (ts: ISOTimestamp): number => new Date(ts).getTime();

// ── Time ──────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

/** "18:42" in the household's time zone (24-hour, as in the rest of the app's en-GB dates). */
export function formatClock(ts: ISOTimestamp, timeZone: string): string {
  const { hour, minute } = zonedParts(new Date(ts), timeZone);
  return `${pad(hour)}:${pad(minute)}`;
}

/** "Today", "Yesterday" or "Tue 6 Oct" (with the year when it is not this year). */
export function dayLabel(ts: ISOTimestamp, timeZone: string, now: Date): string {
  const day = zonedParts(new Date(ts), timeZone).date;
  const today = zonedParts(now, timeZone).date;
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  return formatDay(day, today);
}

/** "Today 08:05", as a day and a time. */
export function stampLabel(ts: ISOTimestamp, timeZone: string, now: Date): { day: string; time: string } {
  return { day: dayLabel(ts, timeZone, now), time: formatClock(ts, timeZone) };
}

// ── People ────────────────────────────────────────────────

export const FORMER_MEMBER = 'Former member';

/** Who a member id is: the member, or a former member (left, or row gone). */
export function senderOf(memberId: string | null, members: Member[]): { name: string; emoji: string; known: boolean } {
  const member = memberId ? members.find((m) => m.id === memberId) : undefined;
  return member
    ? { name: member.name, emoji: member.emoji, known: true }
    : { name: FORMER_MEMBER, emoji: '👤', known: false };
}
