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

import { createHash, timingSafeEqual } from 'node:crypto';
import { CODE_ALPHABET, CODE_LENGTH, CODE_TTL_MS, formatCode, isSignInCode, normaliseCode } from '../../src/lib/backend/serverApi';
import { BackendError } from '../../src/lib/backend/types';
import type { HomeEntry, DeviceInfo } from '../../src/lib/types';
import { DEVICE_LABEL_MAX } from './deviceLabel';
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
export function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('base64url');
}
export function hashCode(normalisedCode: string): string {
  return createHash('sha256').update(normalisedCode, 'utf8').digest('hex');
}

/**
 * Whether `presented` equals one of `stored` (both the same kind of hash), comparing with every
 * one in constant time without stopping at a match. Returns the index of the match, or -1.
 */
function matchHash(presented: string, stored: readonly string[]): number {
  const given = Buffer.from(presented, 'utf8');
  let found = -1;
  stored.forEach((hash, i) => {
    const other = Buffer.from(typeof hash === 'string' ? hash : '', 'utf8');
    // Different lengths can't match; compare with itself so the time is the same.
    const same = other.length === given.length ? timingSafeEqual(other, given) : !timingSafeEqual(given, given);
    if (same && found === -1) found = i;
  });
  return found;
}

/** Whether `given` is the setup code `expected` (both normalised first), in constant time. False when `expected` is null. */
export function setupCodeMatches(given: string, expected: string | null): boolean {
  const a = createHash('sha256').update(normaliseCode(given), 'utf8').digest();
  const b = createHash('sha256').update(expected === null ? '' : normaliseCode(expected), 'utf8').digest();
  const same = timingSafeEqual(a, b);
  return expected !== null && normaliseCode(expected) !== '' && same;
}

/** The member a signed-in user id is, in the home. */
function memberFor(doc: ServerDoc, userId: string) {
  return doc.home.members.find((m) => m.user_id !== null && m.user_id === userId);
}

/**
 * The device `key` belongs to and who it is signed in as, or null (unknown key, or a device
 * whose user id no member has any more). Compares with every device (see the top).
 */
export function findDevice(doc: ServerDoc, key: string): { device: DeviceRow; caller: Caller } | null {
  if (typeof key !== 'string' || key === '' || key.length > 200) return null;
  const devices = doc.auth.devices;
  const at = matchHash(
    hashKey(key),
    devices.map((d) => d.keyHash),
  );
  if (at < 0) return null;
  const device = devices[at];
  const member = memberFor(doc, device.userId);
  if (!member) return null;
  return { device, caller: { userId: device.userId, memberId: member.id, name: member.name } };
}

/**
 * A new device for the person with `userId`: a fresh key, its row added (the oldest of theirs
 * or the home's removed past DEVICE_LIMITS). Returns the key, to be set as the cookie.
 */
export function addDevice(doc: ServerDoc, userId: string, label: string, deps: AuthDeps): { key: string; device: DeviceRow } {
  const key = Buffer.from(deps.randomBytes(32)).toString('base64url');
  const device: DeviceRow = {
    id: deps.newId(),
    keyHash: hashKey(key),
    userId,
    label: Array.from(label || 'Device · Browser').slice(0, DEVICE_LABEL_MAX).join(''),
    createdAt: deps.now().toISOString(),
  };
  const devices = [...doc.auth.devices, device];
  // Past the limits, the oldest go (the list is in sign-in order; the new one is last).
  while (devices.filter((d) => d.userId === userId).length > DEVICE_LIMITS.perPerson) {
    devices.splice(
      devices.findIndex((d) => d.userId === userId),
      1,
    );
  }
  while (devices.length > DEVICE_LIMITS.perHome) devices.shift();
  doc.auth.devices = devices;
  return { key, device };
}

/** CODE_LENGTH letters of CODE_ALPHABET from random bytes (byte & 31: 32 letters, no bias). */
function newCode(deps: AuthDeps): string {
  const bytes = deps.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] & 31];
  return code;
}

/**
 * A new code for `memberId` (anyone in the home; 'not_found' otherwise), replacing their
 * previous one; expires after CODE_TTL_MS. Returns the code formatted ("ABCD-EFGH").
 */
export function issueCode(doc: ServerDoc, memberId: string, createdBy: string, deps: AuthDeps): { code: string; row: CodeRow } {
  const member = doc.home.members.find((m) => m.id === memberId);
  if (!member) throw new BackendError('not_found', 'No such person');
  // Never one that is live already (40 bits: in practice the first one).
  const taken = new Set(doc.auth.codes.map((c) => c.codeHash));
  let code = newCode(deps);
  for (let i = 0; i < 10 && taken.has(hashCode(code)); i++) code = newCode(deps);
  if (taken.has(hashCode(code))) throw new BackendError('unknown', 'could not make a code');
  const now = deps.now();
  const row: CodeRow = {
    id: deps.newId(),
    codeHash: hashCode(code),
    memberId,
    createdBy,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
  };
  doc.auth.codes = [...doc.auth.codes.filter((c) => c.memberId !== memberId), row];
  return { code: formatCode(code), row };
}

/**
 * Uses up `code` (normalised; must be isSignInCode) when a live code matches: removes the
 * code; when its person has not joined yet, they join: user_id = 'u-' + newId(), claimed_at =
 * now (so "Not Shea?" works for a day, as DemoBackend.releaseClaim checks); then addDevice()
 * for them. The entry is 'claimed' for a person who joined just now, else 'member'.
 * Null when no live code matches (the caller counts a failed attempt).
 */
export function redeemCode(
  doc: ServerDoc,
  code: string,
  label: string,
  deps: AuthDeps,
): { key: string; device: DeviceRow; caller: Caller; entry: HomeEntry } | null {
  const normalised = normaliseCode(code);
  const at = matchHash(
    hashCode(normalised),
    doc.auth.codes.map((c) => c.codeHash),
  );
  if (!isSignInCode(normalised) || at < 0) return null;
  const row = doc.auth.codes[at];
  const now = deps.now();
  if (!(Date.parse(row.expiresAt) > now.getTime())) return null;
  const member = doc.home.members.find((m) => m.id === row.memberId);
  if (!member) return null;
  doc.auth.codes = doc.auth.codes.filter((c) => c !== row);
  let status: 'member' | 'claimed' = 'member';
  if (member.user_id === null) {
    member.user_id = `u-${deps.newId()}`;
    member.claimed_at = now.toISOString();
    member.email = '';
    member.push_enabled = false;
    status = 'claimed';
  }
  const userId = member.user_id;
  const { key, device } = addDevice(doc, userId, label, deps);
  return {
    key,
    device,
    caller: { userId, memberId: member.id, name: member.name },
    entry: { status, householdId: member.household_id, memberId: member.id, canImport: false },
  };
}

/** The devices as DeviceInfo, in sign-in order, `current` for `currentDeviceId`. */
export function deviceInfos(doc: ServerDoc, currentDeviceId: string | null): DeviceInfo[] {
  const infos: DeviceInfo[] = [];
  for (const d of doc.auth.devices) {
    const member = memberFor(doc, d.userId);
    if (!member) continue;
    infos.push({ id: d.id, memberId: member.id, label: d.label, createdAt: d.createdAt, current: d.id === currentDeviceId });
  }
  return infos;
}

/** Removes a device; false when there is no such device. */
export function removeDevice(doc: ServerDoc, deviceId: string): boolean {
  const before = doc.auth.devices.length;
  doc.auth.devices = doc.auth.devices.filter((d) => d.id !== deviceId);
  return doc.auth.devices.length < before;
}

/**
 * Run before every put: removes expired codes, codes for people who are gone, and devices whose
 * user id no member has any more (a person released with "Not Shea?" is signed out everywhere).
 */
export function pruneAuth(doc: ServerDoc, now: Date): void {
  const members = new Set(doc.home.members.map((m) => m.id));
  const users = new Set(doc.home.members.flatMap((m) => (m.user_id ? [m.user_id] : [])));
  doc.auth.codes = doc.auth.codes
    .filter((c) => members.has(c.memberId) && Date.parse(c.expiresAt) > now.getTime())
    .map((c) => (c.createdBy !== null && !members.has(c.createdBy) ? { ...c, createdBy: null } : c));
  doc.auth.devices = doc.auth.devices.filter((d) => users.has(d.userId));
}
