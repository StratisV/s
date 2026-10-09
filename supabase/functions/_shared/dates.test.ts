import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, formatDay, minutesOfDay, todayIn, weekdayOf, zonedParts } from './dates.ts';

describe('zonedParts', () => {
  it('reads the wall clock and weekday in the household zone', () => {
    const t = new Date('2026-10-08T23:30:00Z');
    expect(zonedParts(t, 'UTC')).toEqual({ date: '2026-10-08', hour: 23, minute: 30, weekday: 4 });
    expect(zonedParts(t, 'Europe/London')).toEqual({ date: '2026-10-09', hour: 0, minute: 30, weekday: 5 });
    expect(zonedParts(t, 'America/Los_Angeles')).toEqual({ date: '2026-10-08', hour: 16, minute: 30, weekday: 4 });
  });

  it('follows daylight saving changes', () => {
    // London goes back to GMT on Sun 25 Oct 2026.
    expect(zonedParts(new Date('2026-10-24T07:00:00Z'), 'Europe/London').hour).toBe(8);
    expect(zonedParts(new Date('2026-10-26T07:00:00Z'), 'Europe/London').hour).toBe(7);
  });

  it('falls back to UTC for an unknown zone', () => {
    expect(todayIn('Not/AZone', new Date('2026-10-08T23:30:00Z'))).toBe('2026-10-08');
  });
});

describe('calendar arithmetic', () => {
  it('adds days across months and years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-10-06', '2026-10-08')).toBe(2);
    expect(daysBetween('2026-10-08', '2026-10-06')).toBe(-2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2); // across the clock change
  });

  it('numbers weekdays like households.weekly_email_day', () => {
    expect(weekdayOf('2026-10-11')).toBe(0); // Sunday
    expect(weekdayOf('2026-10-12')).toBe(1); // Monday
    expect(weekdayOf('2026-10-17')).toBe(6); // Saturday
  });
});

describe('formatDay', () => {
  it('matches the app ("Tue 20 Oct", year only when it differs)', () => {
    expect(formatDay('2026-10-20', '2026-10-08')).toBe('Tue 20 Oct');
    expect(formatDay('2026-10-06', '2026-10-08')).toBe('Tue 6 Oct');
    expect(formatDay('2027-01-05', '2026-10-08')).toBe('Tue 5 Jan 2027');
  });
});

describe('minutesOfDay', () => {
  it('reads Postgres time values', () => {
    expect(minutesOfDay('08:00:00')).toBe(480);
    expect(minutesOfDay('18:30')).toBe(1110);
    expect(minutesOfDay('7:05')).toBe(425);
    expect(minutesOfDay('00:00:00')).toBe(0);
  });

  it('falls back to 08:00 for anything unreadable', () => {
    expect(minutesOfDay('')).toBe(480);
    expect(minutesOfDay(null)).toBe(480);
    expect(minutesOfDay('25:00')).toBe(480);
    expect(minutesOfDay('noon')).toBe(480);
  });
});
