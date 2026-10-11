// Sign-in without Google: device keys, sign-in codes and the setup code. Pure functions over a
// ServerDoc (the caller stores it through HomeStore.write) with the clock and randomness passed
// in. docs/ARCHITECTURE.md "Server mode (no setup)", "Signing in".
//
// - Device key: 32 random bytes, base64url (43 characters), made on setup or redeem, sent to the
//   browser only in the Set-Cookie header. Stored as DeviceRow.keyHash = base64url(SHA-256(key)).
// - Sign-in code: 8 letters of CODE_ALPHABET from random bytes (byte & 31), stored as
//   CodeRow.codeHash = hex(SHA-256(normalised code)), returned once as formatCode().
// - Every comparison of a presented secret with stored hashes hashes the presented value and
//   compares it with EVERY stored hash using crypto.timingSafeEqual, without stopping at a
//   match; the setup code is compared the same way (both hashed, timingSafeEqual).
// - Failed attempts (a wrong code or setup code) are counted by AttemptLimiter (./limits.ts) and
//   never cause a Blob write.
//
// SKELETON: the types and limits are the contract; the functions are not implemented yet.

import type { HomeEntry, DeviceInfo } from '../../src/lib/types';
import type { Caller } from './runAs';
import type { CodeRow, DeviceRow, ServerDoc } from './serverDoc';

export const DEVICE_LIMITS = {
  /** A person's oldest device is signed out when they sign in on one more. */
  perPerson: 10,
  /** The home's oldest device is signed out when one more signs in. */
  perHome: 50,
} as const;

export interface AuthDeps {
  now: () => Date;
  /** crypto.randomBytes in production; a seeded stub in tests. */
  randomBytes: (n: number) => Uint8Array;
  /** crypto.randomUUID in production. */
  newId: () => string;
}

/** base64url(SHA-256(value)) for keys; hex for codes (see the top of this file). */
export function hashKey(_key: string): string {
  throw new Error('hashKey: not implemented yet');
}
export function hashCode(_normalisedCode: string): string {
  throw new Error('hashCode: not implemented yet');
}

/** Whether `given` is the setup code `expected` (both normalised first), in constant time. False when `expected` is null. */
export function setupCodeMatches(_given: string, _expected: string | null): boolean {
  throw new Error('setupCodeMatches: not implemented yet');
}

/**
 * The device `key` belongs to and who it is signed in as, or null (unknown key, or a device
 * whose user id no member has any more). Compares with every device (see the top).
 */
export function findDevice(_doc: ServerDoc, _key: string): { device: DeviceRow; caller: Caller } | null {
  throw new Error('findDevice: not implemented yet');
}

/**
 * A new device for the person with `userId`: a fresh key, its row added (the oldest of theirs
 * or the home's removed past DEVICE_LIMITS). Returns the key, to be set as the cookie.
 */
export function addDevice(_doc: ServerDoc, _userId: string, _label: string, _deps: AuthDeps): { key: string; device: DeviceRow } {
  throw new Error('addDevice: not implemented yet');
}

/**
 * A new code for `memberId` (anyone in the home; 'not_found' otherwise), replacing their
 * previous one; expires after CODE_TTL_MS. Returns the code formatted ("ABCD-EFGH").
 */
export function issueCode(
  _doc: ServerDoc,
  _memberId: string,
  _createdBy: string,
  _deps: AuthDeps,
): { code: string; row: CodeRow } {
  throw new Error('issueCode: not implemented yet');
}

/**
 * Uses up `code` (normalised; must be isSignInCode) when a live code matches: removes the
 * code; when its person has not joined yet, they join: user_id = 'u-' + newId(), claimed_at =
 * now (so "Not Shea?" works for a day, as DemoBackend.releaseClaim checks); then addDevice()
 * for them. The entry is 'claimed' for a person who joined just now, else 'member'.
 * Null when no live code matches (the caller counts a failed attempt).
 */
export function redeemCode(
  _doc: ServerDoc,
  _code: string,
  _label: string,
  _deps: AuthDeps,
): { key: string; device: DeviceRow; caller: Caller; entry: HomeEntry } | null {
  throw new Error('redeemCode: not implemented yet');
}

/** The devices as DeviceInfo, in sign-in order, `current` for `currentDeviceId`. */
export function deviceInfos(_doc: ServerDoc, _currentDeviceId: string | null): DeviceInfo[] {
  throw new Error('deviceInfos: not implemented yet');
}

/** Removes a device; false when there is no such device. */
export function removeDevice(_doc: ServerDoc, _deviceId: string): boolean {
  throw new Error('removeDevice: not implemented yet');
}

/**
 * Run before every put: removes expired codes, codes for people who are gone, and devices whose
 * user id no member has any more (a person released with "Not Shea?" is signed out everywhere).
 */
export function pruneAuth(_doc: ServerDoc, _now: Date): void {
  throw new Error('pruneAuth: not implemented yet');
}
