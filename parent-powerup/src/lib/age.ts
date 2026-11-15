import { MAX_AGE, STAGES } from '../data/stages';
import type { AgeRange, Kid, Stage } from '../types';

/**
 * A child's age in whole months, from their birth month ('YYYY-MM'). Only the month is known,
 * so they are taken to be born on the 15th. Never negative.
 */
export function ageInMonths(birth: string, today: Date = new Date()): number {
  const [by, bm] = birth.split('-').map(Number);
  if (!by || !bm) return 0;
  const months = (today.getFullYear() - by) * 12 + (today.getMonth() + 1 - bm) - (today.getDate() < 15 ? 1 : 0);
  return Math.max(0, months);
}

/** Age in years, as a decimal (18 months is 1.5). */
export function ageInYears(birth: string, today: Date = new Date()): number {
  return ageInMonths(birth, today) / 12;
}

export function kidAge(kid: Pick<Kid, 'birth'>, today: Date = new Date()): number {
  return ageInYears(kid.birth, today);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * An age in words: "Newborn", "7 months", "2 years 3 months", "9 years".
 * `short` gives "7 mo", "2 y 3 m", "9 y" for tight spaces.
 */
export function formatAge(months: number, short = false): string {
  const m = Math.max(0, Math.floor(months));
  if (m < 1) return short ? 'New' : 'Newborn';
  if (m < 24) return short ? `${m} mo` : plural(m, 'month');
  const years = Math.floor(m / 12);
  const rest = m % 12;
  if (years >= 5 || rest === 0) return short ? `${years} y` : plural(years, 'year');
  return short ? `${years} y ${rest} m` : `${plural(years, 'year')} ${plural(rest, 'month')}`;
}

/** The stage an age falls in. 18 and over count as teen, the last stage. */
export function stageOf(age: number): Stage {
  const clamped = Math.min(Math.max(age, 0), MAX_AGE - 1e-9);
  return STAGES.find((stage) => clamped >= stage.from && clamped < stage.to) ?? STAGES[STAGES.length - 1];
}

export function inRange(age: number, range: AgeRange): boolean {
  return age >= range.from && age < range.to;
}

/** Whether two ranges share any ages. */
export function overlaps(a: AgeRange, b: AgeRange): boolean {
  return a.from < b.to && b.from < a.to;
}

/** "18 months to 4", "3 to 5", "12 to 18": a range in words, for labels. */
export function formatRange(range: AgeRange): string {
  const end = (age: number) => (age < 2 && age % 1 !== 0 ? `${Math.round(age * 12)} months` : String(age));
  const from = range.from === 0 ? 'Birth' : end(range.from);
  return `${from} to ${end(range.to)}`;
}
