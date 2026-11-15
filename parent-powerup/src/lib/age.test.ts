import { ageInMonths, formatAge, formatRange, inRange, overlaps, stageOf } from './age';

const on = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

describe('ageInMonths', () => {
  it('counts whole months from the 15th of the birth month', () => {
    expect(ageInMonths('2024-05', on(2026, 11, 15))).toBe(30);
    expect(ageInMonths('2024-05', on(2026, 11, 14))).toBe(29);
  });

  it('is never negative, and 0 for a bad birth month', () => {
    expect(ageInMonths('2027-01', on(2026, 11, 15))).toBe(0);
    expect(ageInMonths('nonsense', on(2026, 11, 15))).toBe(0);
  });
});

describe('formatAge', () => {
  it('reads naturally at every age', () => {
    expect(formatAge(0)).toBe('Newborn');
    expect(formatAge(1)).toBe('1 month');
    expect(formatAge(18)).toBe('18 months');
    expect(formatAge(24)).toBe('2 years');
    expect(formatAge(27)).toBe('2 years 3 months');
    expect(formatAge(49)).toBe('4 years 1 month');
    expect(formatAge(62)).toBe('5 years');
    expect(formatAge(155)).toBe('12 years');
  });

  it('has a short form', () => {
    expect(formatAge(7, true)).toBe('7 mo');
    expect(formatAge(27, true)).toBe('2 y 3 m');
    expect(formatAge(110, true)).toBe('9 y');
  });
});

describe('stageOf', () => {
  it('places ages in their stage, edges going to the older stage', () => {
    expect(stageOf(0).id).toBe('baby');
    expect(stageOf(0.99).id).toBe('baby');
    expect(stageOf(1).id).toBe('toddler');
    expect(stageOf(4.9).id).toBe('preschool');
    expect(stageOf(5).id).toBe('early-school');
    expect(stageOf(11.5).id).toBe('middle-years');
    expect(stageOf(12).id).toBe('teen');
  });

  it('keeps 18 and over in the teen stage', () => {
    expect(stageOf(18).id).toBe('teen');
    expect(stageOf(25).id).toBe('teen');
  });
});

describe('ranges', () => {
  it('includes the start and not the end', () => {
    expect(inRange(1, { from: 1, to: 3 })).toBe(true);
    expect(inRange(3, { from: 1, to: 3 })).toBe(false);
  });

  it('overlaps only when they share ages', () => {
    expect(overlaps({ from: 1, to: 3 }, { from: 2, to: 5 })).toBe(true);
    expect(overlaps({ from: 1, to: 3 }, { from: 3, to: 5 })).toBe(false);
  });

  it('says a range in words', () => {
    expect(formatRange({ from: 0, to: 1 })).toBe('Birth to 1');
    expect(formatRange({ from: 1.5, to: 4 })).toBe('18 months to 4');
    expect(formatRange({ from: 12, to: 18 })).toBe('12 to 18');
  });
});
