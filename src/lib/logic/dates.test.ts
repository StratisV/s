import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  deviceTimeZone,
  formatDay,
  longDay,
  monthKey,
  monthName,
  parseISODate,
  todayIn,
  zonedParts,
} from './dates';

const at = (iso: string) => new Date(iso);

describe('zonedParts / todayIn', () => {
  it('reads the wall clock in different zones for the same instant', () => {
    const t = at('2026-10-08T23:30:00Z');
    expect(zonedParts(t, 'UTC')).toEqual({ date: '2026-10-08', hour: 23, minute: 30 });
    expect(zonedParts(t, 'Europe/London')).toEqual({ date: '2026-10-09', hour: 0, minute: 30 }); // BST
    expect(zonedParts(t, 'America/Los_Angeles')).toEqual({ date: '2026-10-08', hour: 16, minute: 30 });
    expect(zonedParts(t, 'Asia/Tokyo')).toEqual({ date: '2026-10-09', hour: 8, minute: 30 });
    expect(zonedParts(t, 'Asia/Kolkata')).toEqual({ date: '2026-10-09', hour: 5, minute: 0 });
    expect(zonedParts(t, 'Pacific/Kiritimati')).toEqual({ date: '2026-10-09', hour: 13, minute: 30 });
  });

  it('reports midnight as hour 0, not 24', () => {
    expect(zonedParts(at('2026-10-08T23:00:00Z'), 'Europe/London')).toEqual({ date: '2026-10-09', hour: 0, minute: 0 });
    expect(zonedParts(at('2026-10-09T00:00:00Z'), 'UTC')).toEqual({ date: '2026-10-09', hour: 0, minute: 0 });
  });

  it('changes date exactly at local midnight', () => {
    expect(todayIn('Europe/London', at('2026-10-08T22:59:59Z'))).toBe('2026-10-08');
    expect(todayIn('Europe/London', at('2026-10-08T23:00:00Z'))).toBe('2026-10-09');
    expect(todayIn('America/New_York', at('2026-10-09T03:59:00Z'))).toBe('2026-10-08');
    expect(todayIn('America/New_York', at('2026-10-09T04:00:00Z'))).toBe('2026-10-09');
  });

  it('follows the clocks going back (London, 25 Oct 2026)', () => {
    // 01:30 happens twice: first in BST (UTC+1), then in GMT.
    expect(zonedParts(at('2026-10-25T00:30:00Z'), 'Europe/London')).toEqual({ date: '2026-10-25', hour: 1, minute: 30 });
    expect(zonedParts(at('2026-10-25T01:30:00Z'), 'Europe/London')).toEqual({ date: '2026-10-25', hour: 1, minute: 30 });
    // Midnight before the change is 23:00 UTC, after it 00:00 UTC.
    expect(todayIn('Europe/London', at('2026-10-24T23:00:00Z'))).toBe('2026-10-25');
    expect(todayIn('Europe/London', at('2026-10-25T23:30:00Z'))).toBe('2026-10-25');
    expect(todayIn('Europe/London', at('2026-10-26T00:00:00Z'))).toBe('2026-10-26');
  });

  it('follows the clocks going forward (London, 29 Mar 2026)', () => {
    expect(zonedParts(at('2026-03-29T00:59:00Z'), 'Europe/London')).toEqual({ date: '2026-03-29', hour: 0, minute: 59 });
    expect(zonedParts(at('2026-03-29T01:00:00Z'), 'Europe/London')).toEqual({ date: '2026-03-29', hour: 2, minute: 0 });
  });

  it('falls back to UTC for an unknown zone', () => {
    expect(zonedParts(at('2026-10-08T23:30:00Z'), 'Mars/Olympus')).toEqual({ date: '2026-10-08', hour: 23, minute: 30 });
    expect(todayIn('', at('2026-10-08T23:30:00Z'))).toBe('2026-10-08');
  });

  it('defaults to the current time', () => {
    expect(todayIn('UTC')).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe('deviceTimeZone', () => {
  it('returns a usable IANA zone', () => {
    const tz = deviceTimeZone();
    expect(tz).toBeTruthy();
    expect(() => new Intl.DateTimeFormat('en-GB', { timeZone: tz })).not.toThrow();
  });
});

describe('parseISODate', () => {
  it('splits a date (and ignores a time part)', () => {
    expect(parseISODate('2026-10-08')).toEqual({ y: 2026, m: 10, d: 8 });
    expect(parseISODate('2026-01-31T12:00:00Z')).toEqual({ y: 2026, m: 1, d: 31 });
  });
});

describe('addDays', () => {
  it('crosses months and years in both directions', () => {
    expect(addDays('2026-10-08', 0)).toBe('2026-10-08');
    expect(addDays('2026-10-08', 7)).toBe('2026-10-15');
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-10-08', -2)).toBe('2026-10-06');
    expect(addDays('2026-10-08', 365)).toBe('2027-10-08');
  });

  it('is unaffected by DST changes', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
  });
});

describe('addMonths', () => {
  it('adds calendar months across years', () => {
    expect(addMonths('2026-10-20', 1)).toBe('2026-11-20');
    expect(addMonths('2026-11-02', 3)).toBe('2027-02-02');
    expect(addMonths('2026-10-20', 6)).toBe('2027-04-20');
    expect(addMonths('2026-10-20', 12)).toBe('2027-10-20');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2026-10-01', -7)).toBe('2026-03-01');
    expect(addMonths('2026-10-08', 0)).toBe('2026-10-08');
  });

  it('clamps to the end of shorter months, including leap years', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2028-02-29', 12)).toBe('2029-02-28');
    expect(addMonths('2027-02-28', 12)).toBe('2028-02-28');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2024-03-31', -1)).toBe('2024-02-29');
  });
});

describe('daysBetween', () => {
  it('counts whole days, signed', () => {
    expect(daysBetween('2026-10-06', '2026-10-08')).toBe(2);
    expect(daysBetween('2026-10-08', '2026-10-06')).toBe(-2);
    expect(daysBetween('2026-10-08', '2026-10-08')).toBe(0);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2); // across the DST change
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });
});

describe('formatDay', () => {
  it('reads like "Tue 20 Oct" in the current year', () => {
    expect(formatDay('2026-10-20', '2026-10-08')).toBe('Tue 20 Oct');
    expect(formatDay('2026-10-06', '2026-10-08')).toBe('Tue 6 Oct');
    expect(formatDay('2026-10-08', '2026-10-08')).toBe('Thu 8 Oct');
    expect(formatDay('2026-11-02', '2026-10-08')).toBe('Mon 2 Nov');
    expect(formatDay('2026-01-01', '2026-10-08')).toBe('Thu 1 Jan');
  });

  it('adds the year when it is not this year', () => {
    expect(formatDay('2027-01-05', '2026-10-08')).toBe('Tue 5 Jan 2027');
    expect(formatDay('2026-12-31', '2027-01-02')).toBe('Thu 31 Dec 2026');
    expect(formatDay('2027-01-05', '2027-01-02')).toBe('Tue 5 Jan');
  });
});

describe('monthName', () => {
  it('gives the full English month', () => {
    expect(monthName('2026-10-08')).toBe('October');
    expect(monthName('2026-03-01')).toBe('March');
  });
});

describe('monthKey', () => {
  it('buckets a timestamp by month in the given zone', () => {
    // 23:30 UTC on 31 Oct (after the clocks went back): still October in London, November in Athens.
    expect(monthKey('2026-10-31T23:30:00Z', 'Europe/London')).toBe('2026-10');
    expect(monthKey('2026-10-31T23:30:00Z', 'Europe/Athens')).toBe('2026-11');
    expect(monthKey('2026-10-31T23:30:00Z', 'America/Los_Angeles')).toBe('2026-10');
    // 23:30 UTC on 30 Sep is 00:30 on 1 Oct in London (BST).
    expect(monthKey('2026-09-30T23:30:00Z', 'Europe/London')).toBe('2026-10');
    expect(monthKey('2026-09-30T23:30:00Z', 'UTC')).toBe('2026-09');
  });

  it('accepts a Date and handles the year boundary', () => {
    expect(monthKey(at('2026-12-31T23:30:00Z'), 'Europe/London')).toBe('2026-12');
    expect(monthKey(at('2026-12-31T23:30:00Z'), 'Europe/Berlin')).toBe('2027-01');
    expect(monthKey(at('2027-01-01T03:00:00Z'), 'America/New_York')).toBe('2026-12');
  });
});

describe('longDay', () => {
  it('writes the day out in full, UK style', () => {
    expect(longDay('2026-10-09')).toBe('Friday 9 October');
    expect(longDay('2027-01-01')).toBe('Friday 1 January');
  });
});
