import { DEFAULT_AREAS, TEXT_LIMITS } from '../../lib/constants';
import {
  cleanAreaNames,
  initialHomeDraft,
  MAX_ADDRESS,
  MAX_AREA_NAME,
  MAX_HOUSEHOLD_NAME,
  MAX_NAME,
  suggestedName,
} from './setup';

describe('cleanAreaNames', () => {
  const rows = (...names: string[]) => names.map((name, i) => ({ key: String(i), name }));

  it('trims, collapses spaces and drops blank rows, keeping order', () => {
    expect(cleanAreaNames(rows('  Kitchen ', '', '   ', 'Living   Room', 'Garage'))).toEqual([
      'Kitchen',
      'Living Room',
      'Garage',
    ]);
  });

  it('keeps the first of names that differ only in case', () => {
    expect(cleanAreaNames(rows('Garden', 'garden', 'GARDEN ', 'Hallway'))).toEqual(['Garden', 'Hallway']);
  });

  it('returns nothing for an empty list', () => {
    expect(cleanAreaNames([])).toEqual([]);
  });
});

describe('initialHomeDraft', () => {
  it('starts with the default areas, blank name and address, and the current list on', () => {
    const d = initialHomeDraft();
    expect(d.name).toBe('');
    expect(d.address).toBe('');
    expect(d.seed).toBe(true);
    expect(d.areas.map((a) => a.name)).toEqual(DEFAULT_AREAS);
  });

  it('gives every area row its own key, also across drafts', () => {
    const keys = [...initialHomeDraft().areas, ...initialHomeDraft().areas].map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('suggestedName', () => {
  it('uses the first name from the Google account', () => {
    expect(suggestedName('Stratis Vassilopoulos')).toBe('Stratis');
    expect(suggestedName('  Shea  ')).toBe('Shea');
  });

  it('is blank when Google has no name', () => {
    expect(suggestedName('')).toBe('');
    expect(suggestedName(undefined)).toBe('');
    expect(suggestedName(null)).toBe('');
  });

  it('fits the name field', () => {
    expect(suggestedName('x'.repeat(100))).toHaveLength(MAX_NAME);
  });
});

describe('input limits', () => {
  it('match the app-wide limits the database enforces', () => {
    expect([MAX_NAME, MAX_HOUSEHOLD_NAME, MAX_ADDRESS, MAX_AREA_NAME]).toEqual([
      TEXT_LIMITS.memberName,
      TEXT_LIMITS.householdName,
      TEXT_LIMITS.address,
      TEXT_LIMITS.areaName,
    ]);
  });
});
