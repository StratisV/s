import { addDays, dateKey, daysBetween, formatDate, isoWeek } from './dates';

describe('dates', () => {
  it('keys dates in local time', () => {
    expect(dateKey(new Date(2026, 10, 15, 23, 59))).toBe('2026-11-15');
  });

  it('counts days across months and DST', () => {
    expect(daysBetween('2026-10-24', '2026-11-02')).toBe(9);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
  });

  it('finds the ISO week', () => {
    expect(isoWeek(new Date(2026, 10, 9))).toBe('2026-W46');
    expect(isoWeek(new Date(2026, 10, 15))).toBe('2026-W46');
    expect(isoWeek(new Date(2026, 10, 16))).toBe('2026-W47');
    expect(isoWeek(new Date(2021, 0, 3))).toBe('2020-W53');
  });

  it('formats a date', () => {
    expect(formatDate('2026-11-09')).toBe('9 Nov 2026');
    expect(formatDate('2026-11-09', false)).toBe('9 Nov');
    expect(formatDate('2026-11')).toBe('Nov 2026');
  });
});
