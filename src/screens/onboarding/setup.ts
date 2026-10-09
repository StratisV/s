// Pure helpers for the setup steps (kept out of the components so they can be unit tested).
import { DEFAULT_AREAS, TEXT_LIMITS } from '../../lib/constants';

/** Default profile emoji (the README's first pick). */
export const DEFAULT_EMOJI = '🦔';

/** Input limits: the same as Profile and the Household editor, and the database's. */
export const MAX_NAME = TEXT_LIMITS.memberName;
export const MAX_HOUSEHOLD_NAME = TEXT_LIMITS.householdName;
export const MAX_ADDRESS = TEXT_LIMITS.address;
export const MAX_AREA_NAME = TEXT_LIMITS.areaName;

/** An area row in the create form. `key` is local only (stable across renames). */
export interface AreaDraft {
  key: string;
  name: string;
}

export interface HomeDraft {
  name: string;
  address: string;
  areas: AreaDraft[];
  /** "Start with our current list": seed SEED_ITEMS for the areas that match. */
  seed: boolean;
}

let nextKey = 0;
export function areaKey(): string {
  nextKey += 1;
  return `area-${nextKey}`;
}

export function initialHomeDraft(): HomeDraft {
  return {
    name: '',
    address: '',
    areas: DEFAULT_AREAS.map((name) => ({ key: areaKey(), name })),
    seed: true,
  };
}

/**
 * The area names to create, in order: trimmed, blanks dropped, and repeats
 * (ignoring case) kept once, so seeded items never have two homes.
 */
export function cleanAreaNames(areas: AreaDraft[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of areas) {
    const name = a.name.trim().replace(/\s+/g, ' ');
    const k = name.toLowerCase();
    if (!name || seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  return out;
}

/**
 * The name to prefill from the Google account: the first name, as the household
 * sees it on items and in Stats ("🦔 Stratis"). Editable, so a full name is one tap away.
 */
export function suggestedName(googleName: string | null | undefined): string {
  const first = (googleName ?? '').trim().split(/\s+/)[0] ?? '';
  return first.slice(0, MAX_NAME);
}
