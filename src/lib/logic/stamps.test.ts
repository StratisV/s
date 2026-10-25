import { describe, expect, it } from 'vitest';
import type { Member } from '../types';
import { dayLabel, formatClock, senderOf, stampLabel, timeOf } from './stamps';

const TZ = 'Europe/London';
/** Thu 8 Oct 2026, 10:00 in London (BST, UTC+1). */
const NOW = new Date('2026-10-08T09:00:00Z');

function member(id: string, name: string, emoji: string): Member {
  return {
    id,
    household_id: 'h1',
    user_id: `u-${id}`,
    name,
    email: '',
    emoji,
    color: '#007AFF',
    role: 'member',
    weekly_email: true,
    push_enabled: false,
    created_at: '2026-01-01T00:00:00Z',
  };
}

const MEMBERS = [member('me', 'Stratis', '🦔'), member('shea', 'Shea', '🦆'), member('ela', 'Ela', '🦊')];

describe('times in the household time zone', () => {
  it('reads any ISO form as the same instant', () => {
    expect(timeOf('2026-10-08T08:00:00+00:00')).toBe(timeOf('2026-10-08T08:00:00.000Z'));
    expect(timeOf('2026-10-08T07:59:59Z')).toBeLessThan(timeOf('2026-10-08T08:00:00Z'));
  });

  it('formats the clock as 24-hour local time', () => {
    expect(formatClock('2026-10-08T07:05:00Z', TZ)).toBe('08:05');
    expect(formatClock('2026-10-07T17:42:00Z', TZ)).toBe('18:42');
    expect(formatClock('2026-10-07T17:42:00Z', 'Asia/Tokyo')).toBe('02:42');
  });

  it('says Today, Yesterday, or the date (with the year when it is another year)', () => {
    expect(dayLabel('2026-10-08T06:00:00Z', TZ, NOW)).toBe('Today');
    expect(dayLabel('2026-10-07T12:00:00Z', TZ, NOW)).toBe('Yesterday');
  });

  it('uses the local day, not the UTC one', () => {
    // 23:30 UTC on the 7th is 00:30 on the 8th in London.
    expect(dayLabel('2026-10-07T23:30:00Z', TZ, NOW)).toBe('Today');
    expect(dayLabel('2026-10-07T22:59:00Z', TZ, NOW)).toBe('Yesterday');
    expect(dayLabel('2026-10-06T12:00:00Z', TZ, NOW)).toBe('Tue 6 Oct');
    expect(dayLabel('2025-12-24T12:00:00Z', TZ, NOW)).toBe('Wed 24 Dec 2025');
    expect(stampLabel('2026-10-07T17:42:00Z', TZ, NOW)).toEqual({ day: 'Yesterday', time: '18:42' });
  });
});

describe('people', () => {
  it('names the member, or a former member', () => {
    expect(senderOf('shea', MEMBERS)).toEqual({ name: 'Shea', emoji: '🦆', known: true });
    expect(senderOf(null, MEMBERS)).toMatchObject({ name: 'Former member', emoji: '👤', known: false });
    expect(senderOf('someone-gone', MEMBERS)).toMatchObject({ name: 'Former member', known: false });
  });
});
