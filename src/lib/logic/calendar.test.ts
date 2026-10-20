import { describe, expect, it } from 'vitest';
import { monthHeading, weekHeading, weekName, weekTitle } from './calendar';
import { monthName, monthRange, weekdayIndex, weekOf } from './months';

/** Thu 8 Oct 2026, the e2e clock's day. */
const TODAY = '2026-10-08';

describe('weeks', () => {
  it('weekdayIndex counts from Monday', () => {
    expect(weekdayIndex('2026-10-05')).toBe(0);
    expect(weekdayIndex('2026-10-11')).toBe(6);
    // The clocks go back in London that night: still a Sunday.
    expect(weekdayIndex('2026-10-25')).toBe(6);
  });

  it('weekOf gives Monday to Sunday', () => {
    const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
    expect(weekOf('2026-10-08')).toEqual(week);
    expect(weekOf('2026-10-05')).toEqual(week);
    expect(weekOf('2026-10-11')).toEqual(week);
    expect(weekOf('2026-10-01')).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(weekOf('2027-01-01')[0]).toBe('2026-12-28');
    expect(weekOf('2027-01-01')[6]).toBe('2027-01-03');
  });

  it('the weeks the clocks change in London are seven different days', () => {
    for (const date of ['2026-10-25', '2027-03-28']) {
      const week = weekOf(date);
      expect(new Set(week).size).toBe(7);
      expect(week[6]).toBe(date);
      expect(week.map(weekdayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    }
  });

  it('monthRange gives the first and last day', () => {
    expect(monthRange('2026-10')).toEqual(['2026-10-01', '2026-10-31']);
    expect(monthRange('2026-02')).toEqual(['2026-02-01', '2026-02-28']);
    expect(monthRange('2028-02')).toEqual(['2028-02-01', '2028-02-29']);
  });

  it('weekName names the week by its Monday', () => {
    expect(weekName('2026-10-05', TODAY)).toBe('Week of Monday 5 October');
    expect(weekName('2027-01-04', TODAY)).toBe('Week of Monday 4 January 2027');
  });

  it('weekTitle: the strip’s title, short month names across two months, the year when not today’s', () => {
    expect(weekTitle(weekOf('2026-10-08'), TODAY)).toBe('5 to 11 October');
    expect(weekTitle(weekOf('2026-10-01'), TODAY)).toBe('28 Sep to 4 Oct');
    expect(weekTitle(weekOf('2027-01-06'), TODAY)).toBe('4 to 10 January 2027');
    expect(weekTitle(weekOf('2026-12-30'), TODAY)).toBe('28 Dec to 3 Jan 2027');
    expect(weekTitle(weekOf('2026-12-30'), '2027-01-02')).toBe('28 Dec 2026 to 3 Jan');
    // The week the clocks go back in London: still Monday to Sunday.
    expect(weekTitle(weekOf('2026-10-25'), TODAY)).toBe('19 to 25 October');
  });

  it('weekHeading: this, next and last week in words, else how many weeks away', () => {
    expect(weekHeading('2026-10-05', TODAY)).toBe('This week');
    expect(weekHeading('2026-10-12', TODAY)).toBe('Next week');
    expect(weekHeading('2026-09-28', TODAY)).toBe('Last week');
    expect(weekHeading('2026-10-19', TODAY)).toBe('In 2 weeks');
    expect(weekHeading('2026-11-30', TODAY)).toBe('In 8 weeks');
    expect(weekHeading('2026-09-21', TODAY)).toBe('2 weeks ago');
    // Across the clocks going back (25 Oct): still whole weeks.
    expect(weekHeading('2026-11-02', TODAY)).toBe('In 4 weeks');
  });

  it('monthHeading: this, next and last month in words, else how many months away', () => {
    expect(monthHeading('2026-10', TODAY)).toBe('This month');
    expect(monthHeading('2026-11', TODAY)).toBe('Next month');
    expect(monthHeading('2026-09', TODAY)).toBe('Last month');
    expect(monthHeading('2026-12', TODAY)).toBe('In 2 months');
    expect(monthHeading('2027-01', TODAY)).toBe('In 3 months');
    expect(monthHeading('2026-07', TODAY)).toBe('3 months ago');
    expect(monthHeading('2027-01', '2026-12-31')).toBe('Next month');
  });

  it('monthName: the month without its year', () => {
    expect(monthName('2026-10-08')).toBe('October');
    expect(monthName('2027-01')).toBe('January');
  });
});
