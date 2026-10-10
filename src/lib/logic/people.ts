// People in the home: who has joined, and the email rules the database applies
// (supabase/migrations/20261010000500_one_home.sql).

import { EMOJIS, TEXT_LIMITS } from '../constants';
import type { Member } from '../types';

/**
 * True once the person has signed in (their member row has an account). False for someone
 * added by name and email who has not signed in yet: shown as "Not joined yet".
 */
export function hasJoined(member: Pick<Member, 'user_id'>): boolean {
  return member.user_id !== null;
}

/** The form emails are stored and compared in: trimmed of spaces, tabs and line breaks, lower case. */
export function normaliseEmail(value: string): string {
  return (value ?? '').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '').toLowerCase();
}

/**
 * A plausible email (what Add Person and a person's email accept, like the database's
 * is_valid_email): one @, no spaces, a dot in the domain, at most TEXT_LIMITS.email
 * characters. Pass it through normaliseEmail() first.
 */
export function isValidEmail(value: string): boolean {
  return Array.from(value).length <= TEXT_LIMITS.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

/** Another person in the home already has this email (case-insensitive; blank never clashes). */
export function emailTaken(members: Pick<Member, 'id' | 'email'>[], email: string, exceptId?: string): boolean {
  const wanted = normaliseEmail(email);
  if (!wanted) return false;
  return members.some((m) => m.id !== exceptId && normaliseEmail(m.email) === wanted);
}

/**
 * The emoji a new person starts on (Add Person, and Your profile when joining): the first in
 * the grid (EMOJIS) that nobody in the home has, so people stay easy to tell apart. All taken:
 * the first one.
 */
export function firstFreeEmoji(taken: Iterable<string>): string {
  const used = new Set(taken);
  return EMOJIS.find((e) => !used.has(e)) ?? EMOJIS[0];
}
