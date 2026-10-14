// Sign-in without Google: device keys, sign-in codes and the setup code. Pure functions over a
// ServerDoc (the caller stores it through HomeStore.write) with the clock and randomness passed
// in. docs/ARCHITECTURE.md "Server mode (no setup)", "Signing in".
//
// - Device key: 32 random bytes, base64url (43 characters), made on setup or redeem. Stored as
//   DeviceRow.keyHash = base64url(SHA-256(key)). The browser gets it inside a device token,
//   only in the Set-Cookie header: `<key>.<device id>.<rev>.<mac>`, where rev is the home's rev
//   that first holds the device and mac = HMAC-SHA256(auth.secret, "<device id>.<rev>.<key
//   hash>") (16 bytes, base64url). The token lets an instance whose copy is older than `rev`
//   tell a device another instance signed in a moment ago (worth one read, and only real ones
//   can ask for it) from a made-up key, and a removed device (its copy is at `rev` or newer
//   and has no such key) from both. A bare key (Authorization: Bearer, tools) still works.
// - Sign-in code: 8 letters of CODE_ALPHABET from random bytes (byte & 31), stored as
//   CodeRow.codeHash = hex(SHA-256(normalised code)), returned once as formatCode(). Up to
//   MAX_LIVE_CODES live per person; each single use.
// - Who may make a code (issueCode): anyone in the home, for someone not joined yet, for
//   themselves ("Add another device"), or for someone joined who has no device signed in any
//   more (a lost phone, once someone removed it from their page). Never for someone joined
//   who is signed in somewhere: only they can add a device of their own.
// - Every comparison of a presented secret with stored hashes hashes the presented value and
//   compares it with EVERY stored hash using crypto.timingSafeEqual, without stopping at a
//   match; the setup code and device token MACs are compared the same way.
// - Failed attempts (a wrong code or setup code) are counted by AttemptLimiter (./limits.ts) and
//   never cause a Blob write.
// - Changes never edit doc.home in place: a member that changes is replaced (HomeStore rolls a
//   failed write back by putting the previous objects back).

import { createHash, createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import { CODE_ALPHABET, CODE_LENGTH, CODE_TTL_MS, formatCode, isSignInCode, normaliseCode } from '../../src/lib/backend/serverApi';
import { BackendError } from '../../src/lib/backend/types';
import type { HomeEntry, DeviceInfo } from '../../src/lib/types';
import { DEVICE_LABEL_MAX } from './deviceLabel';
import { ApiError } from './errors';
import { pruneNotify } from './notify';
import { runAs, type Caller } from './runAs';
import type { AccountRow, CodeRow, DeviceRow, ServerDoc } from './serverDoc';

export const DEVICE_LIMITS = {
  /** A person's oldest device is signed out when they sign in on one more. */
  perPerson: 10,
  /** The home's oldest device is signed out when one more signs in. */
  perHome: 50,
} as const;

/** Live codes a person may have at once; a new one past this replaces their oldest. */
export const MAX_LIVE_CODES = 5;
/** How long a used code is kept so that the same code again can replace a device whose reply was lost. */
export const CODE_REPLAY_MS = 15 * 60_000;

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

/** hex SHA-256 of a setup code, normalised (ServerAuth.setupHash). */
export function setupHashOf(code: string): string {
  return createHash('sha256').update(normaliseCode(code), 'utf8').digest('hex');
}

/** Whether two strings are the same, in time that does not depend on where they differ. */
function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length ? timingSafeEqual(x, y) : !timingSafeEqual(x, x);
}

/**
 * Whether `presented` equals one of `stored` (both the same kind of hash), comparing with every
 * one in constant time without stopping at a match. Returns the index of the match, or -1.
 */
function matchHash(presented: string, stored: readonly string[]): number {
  let found = -1;
  stored.forEach((hash, i) => {
    const same = sameText(typeof hash === 'string' ? hash : '', presented);
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

// ── Device tokens ────────────────────────────────────────

/** A cookie (or Bearer) value taken apart: the key, and the token's claims when it is one. */
export interface PresentedToken {
  key: string;
  deviceId?: string;
  rev?: number;
  mac?: string;
}

const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

/** `value` as a device token or a bare key; null when it is neither. */
export function parseDeviceToken(value: string): PresentedToken | null {
  if (typeof value !== 'string' || value.length > 300) return null;
  const parts = value.split('.');
  if (parts.length === 1) return KEY_RE.test(parts[0]) ? { key: parts[0] } : null;
  if (parts.length !== 4) return null;
  const [key, deviceId, rev, mac] = parts;
  if (!KEY_RE.test(key) || !/^[A-Za-z0-9-]{1,100}$/.test(deviceId) || !/^[1-9]\d{0,14}$/.test(rev) || !/^[A-Za-z0-9_-]{22}$/.test(mac)) {
    return null;
  }
  return { key, deviceId, rev: Number(rev), mac };
}

function tokenMac(secret: string, deviceId: string, rev: number, key: string): string {
  return createHmac('sha256', Buffer.from(secret, 'base64url'))
    .update(`${deviceId}.${rev}.${hashKey(key)}`, 'utf8')
    .digest()
    .subarray(0, 16)
    .toString('base64url');
}

/** The token for a device first held at `rev` (see the top), or the bare key when the home has no secret. */
export function deviceToken(doc: ServerDoc, device: DeviceRow, key: string, rev: number): string {
  const secret = doc.auth.secret;
  if (!secret) return key;
  return `${key}.${device.id}.${rev}.${tokenMac(secret, device.id, rev, key)}`;
}

/** Whether `token` was made by this home (its MAC matches the home's secret). */
export function tokenVerifies(doc: ServerDoc, token: PresentedToken): boolean {
  const secret = doc.auth.secret;
  if (!secret || token.deviceId === undefined || token.rev === undefined || token.mac === undefined) return false;
  return sameText(tokenMac(secret, token.deviceId, token.rev, token.key), token.mac);
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

/** Marks a device as used (DeviceRow.seenAt), once. False when it was already, or is gone. */
export function markSeen(doc: ServerDoc, deviceId: string, now: Date): boolean {
  const at = doc.auth.devices.findIndex((d) => d.id === deviceId);
  if (at < 0 || doc.auth.devices[at].seenAt) return false;
  const devices = [...doc.auth.devices];
  devices[at] = { ...devices[at], seenAt: now.toISOString() };
  doc.auth.devices = devices;
  return true;
}

// ── Codes ────────────────────────────────────────────────

/** CODE_LENGTH letters of CODE_ALPHABET from random bytes (byte & 31: 32 letters, no bias). */
function newCode(deps: AuthDeps): string {
  const bytes = deps.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] & 31];
  return code;
}

/** Whether the person with `userId` has a device signed in. */
function hasDevice(doc: ServerDoc, userId: string): boolean {
  return doc.auth.devices.some((d) => d.userId === userId);
}

/**
 * A new code for `memberId`, made by the member `createdBy` (see the top for who may:
 * 'not_found' for nobody in the home, ApiError 'forbidden' for someone joined and signed in
 * somewhere who is not `createdBy`). Their earlier codes keep working (at most MAX_LIVE_CODES:
 * past that, their oldest goes). Expires after CODE_TTL_MS. Returns the code formatted ("ABCD-EFGH").
 */
export function issueCode(doc: ServerDoc, memberId: string, createdBy: string, deps: AuthDeps): { code: string; row: CodeRow } {
  const member = doc.home.members.find((m) => m.id === memberId);
  if (!member) throw new BackendError('not_found', 'No such person');
  if (member.user_id !== null && member.id !== createdBy && hasDevice(doc, member.user_id)) {
    throw new ApiError('forbidden', `${member.name} is signed in already: only they can add a device`);
  }
  // Never one that is in the list already (40 bits: in practice the first one).
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
  let codes = [...doc.auth.codes, row];
  // Past MAX_LIVE_CODES live codes for them, their oldest goes.
  const live = codes.filter((c) => c.memberId === memberId && !c.usedAt);
  if (live.length > MAX_LIVE_CODES) {
    const drop = new Set(live.slice(0, live.length - MAX_LIVE_CODES));
    codes = codes.filter((c) => !drop.has(c));
  }
  doc.auth.codes = codes;
  return { code: formatCode(code), row };
}

/** The row `normalised` matches (constant time over every row), or null. */
function codeRow(doc: ServerDoc, normalised: string): CodeRow | null {
  const at = matchHash(
    hashCode(normalised),
    doc.auth.codes.map((c) => c.codeHash),
  );
  return isSignInCode(normalised) && at >= 0 ? doc.auth.codes[at] : null;
}

/** A used row whose device never used its key, within CODE_REPLAY_MS: the same code again may replace that device. */
function replayable(doc: ServerDoc, row: CodeRow, now: Date): boolean {
  if (!row.usedAt || !row.usedBy) return false;
  if (!(now.getTime() - Date.parse(row.usedAt) <= CODE_REPLAY_MS)) return false;
  const device = doc.auth.devices.find((d) => d.id === row.usedBy);
  return !!device && !device.seenAt;
}

/**
 * Whether `normalised` would sign someone in on `doc` (a live code, or a replay; see
 * redeemCode), without changing anything: the handler checks this on its cached copy first,
 * so a wrong code never reaches the write queue.
 */
export function codeWorks(doc: ServerDoc, normalised: string, now: Date): boolean {
  const row = codeRow(doc, normaliseCode(normalised));
  if (!row || !(Date.parse(row.expiresAt) > now.getTime())) return false;
  if (!doc.home.members.some((m) => m.id === row.memberId)) return false;
  return row.usedAt ? replayable(doc, row, now) : true;
}

export interface SignedInDevice {
  key: string;
  /** What the cookie holds (deviceToken()). */
  token: string;
  device: DeviceRow;
  caller: Caller;
  entry: HomeEntry;
}

/**
 * Uses up `code` (normalised; must be isSignInCode) when a live code matches. When its person
 * has not joined yet, they join: user_id = 'u-' + newId(), claimed_at = now (so "Not Shea?"
 * works for a day, as DemoBackend.releaseClaim checks); then addDevice() for them. The code
 * is kept as used (usedAt, usedBy) for CODE_REPLAY_MS, and the person's other live codes made
 * by someone else go (they have joined: only they make codes for themselves now). The entry
 * is 'claimed' for a person who joined just now, else 'member'.
 * The same code again within CODE_REPLAY_MS, while the device it signed in has never been
 * used (the reply was lost), replaces that device with a new one and gives the same entry.
 * Null when nothing matches (the caller counts a failed attempt).
 */
export function redeemCode(doc: ServerDoc, code: string, label: string, deps: AuthDeps): SignedInDevice | null {
  const normalised = normaliseCode(code);
  const row = codeRow(doc, normalised);
  const now = deps.now();
  if (!row || !(Date.parse(row.expiresAt) > now.getTime())) return null;
  let member = doc.home.members.find((m) => m.id === row.memberId);
  if (!member) return null;
  // The next put stores this as rev + 1 (HomeStore), which is where the device first is.
  const rev = doc.rev + 1;

  if (row.usedAt) {
    if (!replayable(doc, row, now) || member.user_id === null) return null;
    doc.auth.devices = doc.auth.devices.filter((d) => d.id !== row.usedBy);
    const { key, device } = addDevice(doc, member.user_id, label, deps);
    doc.auth.codes = doc.auth.codes.map((c) => (c === row ? { ...c, usedBy: device.id } : c));
    const status = row.usedClaimed ? 'claimed' : 'member';
    return {
      key,
      token: deviceToken(doc, device, key, rev),
      device,
      caller: { userId: member.user_id, memberId: member.id, name: member.name },
      entry: { status, householdId: member.household_id, memberId: member.id, canImport: false },
    };
  }

  let status: 'member' | 'claimed' = 'member';
  if (member.user_id === null) {
    const joined = { ...member, user_id: `u-${deps.newId()}`, claimed_at: now.toISOString(), email: '', push_enabled: false };
    doc.home = { ...doc.home, members: doc.home.members.map((m) => (m === member ? joined : m)) };
    member = joined;
    status = 'claimed';
  }
  const userId = member.user_id!;
  const { key, device } = addDevice(doc, userId, label, deps);
  const memberId = member.id;
  doc.auth.codes = doc.auth.codes
    // Their other codes from someone else go: they are signed in now.
    .filter((c) => c === row || c.usedAt || c.memberId !== memberId || c.createdBy === memberId)
    .map((c) => (c === row ? { ...c, usedAt: now.toISOString(), usedBy: device.id, usedClaimed: status === 'claimed' } : c));
  return {
    key,
    token: deviceToken(doc, device, key, rev),
    device,
    caller: { userId, memberId, name: member.name },
    entry: { status, householdId: member.household_id, memberId, canImport: false },
  };
}

/**
 * Continue with Google: this browser signs in as the person whose email `email` (verified by
 * Google, lower case) is: their member email, else `people`'s name for it (HOMEOS_GOOGLE_PEOPLE)
 * when that person has no email yet, which is then kept as theirs. Someone who has not joined
 * yet joins as redeemCode() does ('claimed'); else one more device ('member'). Null: the email
 * is nobody's in the home.
 */
export function signInByEmail(
  doc: ServerDoc,
  email: string,
  people: Record<string, string>,
  label: string,
  deps: AuthDeps,
): SignedInDevice | null {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return null;
  const members = doc.home.members;
  let member = members.find((m) => (m.email ?? '').trim().toLowerCase() === wanted);
  if (!member) {
    const name = people[wanted]?.trim().toLowerCase();
    member = name ? members.find((m) => m.name.trim().toLowerCase() === name && !(m.email ?? '').trim()) : undefined;
  }
  if (!member) return null;
  const now = deps.now();
  // The next put stores this as rev + 1 (HomeStore), which is where the device first is.
  const rev = doc.rev + 1;
  let status: 'member' | 'claimed' = 'member';
  const before = member;
  const after =
    member.user_id === null
      ? { ...member, user_id: `u-${deps.newId()}`, claimed_at: now.toISOString(), email: wanted, push_enabled: false }
      : { ...member, email: wanted };
  if (before.user_id === null) status = 'claimed';
  doc.home = { ...doc.home, members: members.map((m) => (m === before ? after : m)) };
  member = after;
  const userId = member.user_id!;
  const { key, device } = addDevice(doc, userId, label, deps);
  return {
    key,
    token: deviceToken(doc, device, key, rev),
    device,
    caller: { userId, memberId: member.id, name: member.name },
    entry: { status, householdId: member.household_id, memberId: member.id, canImport: false },
  };
}

/**
 * Setup's second chance (the home is online already and the setup code `code` checked out):
 * when the owner has no device that was ever used (the reply to "Bring It Online" was lost,
 * or every device of theirs was signed out or removed), their unused devices go and this
 * browser becomes theirs. The code must be the one that brought the home online (setupHash).
 * Null when that does not apply (the caller answers 'home_exists').
 */
export function recoverOwner(doc: ServerDoc, code: string, label: string, deps: AuthDeps): SignedInDevice | null {
  if (doc.auth.setupHash && !sameText(doc.auth.setupHash, setupHashOf(code))) return null;
  const owner = doc.home.members.find((m) => m.role === 'owner' && m.user_id !== null);
  if (!owner || owner.user_id === null) return null;
  const userId = owner.user_id;
  if (doc.auth.devices.some((d) => d.userId === userId && d.seenAt)) return null;
  doc.auth.devices = doc.auth.devices.filter((d) => d.userId !== userId);
  const { key, device } = addDevice(doc, userId, label, deps);
  return {
    key,
    token: deviceToken(doc, device, key, doc.rev + 1),
    device,
    caller: { userId, memberId: owner.id, name: owner.name },
    entry: { status: 'member', householdId: owner.household_id, memberId: owner.id, canImport: false },
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
 * Run before every put: removes expired codes, used ones older than CODE_REPLAY_MS, codes for
 * people who are gone, and devices whose user id no member has any more (a person released
 * with "Not Shea?" is signed out everywhere, and their push subscriptions go with the
 * devices), and the notification choices of anyone no longer joined (pruneNotify).
 */
export function pruneAuth(doc: ServerDoc, now: Date): void {
  const members = new Set(doc.home.members.map((m) => m.id));
  const users = new Set(doc.home.members.flatMap((m) => (m.user_id ? [m.user_id] : [])));
  doc.auth.codes = doc.auth.codes
    .filter(
      (c) =>
        members.has(c.memberId) &&
        Date.parse(c.expiresAt) > now.getTime() &&
        !(c.usedAt && !(now.getTime() - Date.parse(c.usedAt) <= CODE_REPLAY_MS)),
    )
    .map((c) => (c.createdBy !== null && !members.has(c.createdBy) ? { ...c, createdBy: null } : c));
  doc.auth.devices = doc.auth.devices.filter((d) => users.has(d.userId));
  if (doc.auth.accounts) doc.auth.accounts = doc.auth.accounts.filter((a) => users.has(a.userId));
  // Notification choices and reminders of people who are gone (their devices, and with them
  // their push subscriptions, went just above).
  pruneNotify(doc);
}

// ── Accounts (email and password) ───────────────────────

export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 200;
const SCRYPT = { N: 16384, r: 8, p: 1 } as const;

/** "scrypt$<salt>$<hash>" (base64url) for `password`, with a fresh 16-byte salt. */
export function hashPassword(password: string, deps: Pick<AuthDeps, 'randomBytes'>): string {
  const salt = Buffer.from(deps.randomBytes(16));
  const hash = scryptSync(password.normalize('NFKC'), salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

/** Whether `password` is the one `stored` (hashPassword()) was made from. */
export function passwordMatches(password: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = scryptSync(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), want.length, SCRYPT);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** A hash to check wrong emails against, so a missing account takes as long as a wrong password. */
const DUMMY_HASH = `scrypt$${Buffer.alloc(16).toString('base64url')}$${Buffer.alloc(32).toString('base64url')}`;

function accountsOf(doc: ServerDoc): AccountRow[] {
  return doc.auth.accounts ?? [];
}

function signedInAs(doc: ServerDoc, member: ServerDoc['home']['members'][number], status: 'member' | 'claimed', label: string, deps: AuthDeps): SignedInDevice {
  // The next put stores this as rev + 1 (HomeStore), which is where the device first is.
  const rev = doc.rev + 1;
  const userId = member.user_id!;
  const { key, device } = addDevice(doc, userId, label, deps);
  return {
    key,
    token: deviceToken(doc, device, key, rev),
    device,
    caller: { userId, memberId: member.id, name: member.name },
    entry: { status, householdId: member.household_id, memberId: member.id, canImport: false },
  };
}

/**
 * Create Account: `email` (lower case) and `password` become this person's sign-in, and this
 * browser is signed in. Who they are in the home: the person already called `name` who has no
 * account yet (joined or not: Shea, or Stratis who brought the home online), else someone new
 * (added as the owner would add them). A person who had not joined joins ('claimed', so the
 * welcome step follows: their emoji); someone who had keeps their place ('member').
 * Throws BackendError 'email_taken' when the email has an account.
 */
export async function createAccount(
  doc: ServerDoc,
  input: { name: string; email: string; password: string },
  label: string,
  deps: AuthDeps,
): Promise<SignedInDevice> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const accounts = accountsOf(doc);
  if (accounts.some((a) => a.email === email)) throw new BackendError('email_taken', 'That email has an account');
  const now = deps.now();
  const withAccount = new Set(accounts.map((a) => a.userId));
  const household = doc.home.households[0];
  if (!household) throw new BackendError('not_found', 'No home');
  let member = doc.home.members.find(
    (m) => m.household_id === household.id && m.name.trim().toLowerCase() === name.toLowerCase() && !(m.user_id && withAccount.has(m.user_id)),
  );
  if (!member) {
    // Someone new: added as the owner adds people (the same checks and colours), then joined below.
    const owner = doc.home.members.find((m) => m.household_id === household.id && m.role === 'owner' && m.user_id);
    if (!owner) throw new BackendError('not_found', 'No owner');
    const ran = await runAs(
      doc.home,
      { userId: owner.user_id!, memberId: owner.id, name: owner.name },
      (b) => b.addPerson(household.id, { name, emoji: '', email: '' }),
      { now: () => now, kind: 'write' },
    );
    doc.home = ran.home!;
    member = doc.home.members.find((m) => m.id === ran.result.id)!;
  }
  let status: 'member' | 'claimed' = 'member';
  const before = member;
  const emailFree = !doc.home.members.some((m) => m !== before && (m.email ?? '').trim().toLowerCase() === email);
  const after =
    before.user_id === null
      ? { ...before, user_id: `u-${deps.newId()}`, claimed_at: now.toISOString(), email: emailFree ? email : '', push_enabled: false }
      : { ...before, email: emailFree ? email : before.email };
  if (before.user_id === null) status = 'claimed';
  doc.home = { ...doc.home, members: doc.home.members.map((m) => (m === before ? after : m)) };
  doc.auth.accounts = [...accounts, { userId: after.user_id!, email, passHash: hashPassword(input.password, deps), createdAt: now.toISOString() }];
  return signedInAs(doc, after, status, label, deps);
}

/** Whether `email` (any case) has an account. */
export function hasAccount(doc: ServerDoc, email: string): boolean {
  const wanted = email.trim().toLowerCase();
  return accountsOf(doc).some((a) => a.email === wanted);
}

/** Forgets the account for `email` (the person stays, and can create their account again). False: there was none. */
export function removeAccount(doc: ServerDoc, email: string): boolean {
  const wanted = email.trim().toLowerCase();
  const before = accountsOf(doc);
  const after = before.filter((a) => a.email !== wanted);
  if (after.length === before.length) return false;
  doc.auth.accounts = after;
  return true;
}

/** Sign In: the account for `email`, when `password` is right. Null otherwise (wrong email or password alike). */
export function signInWithPassword(doc: ServerDoc, email: string, password: string, label: string, deps: AuthDeps): SignedInDevice | null {
  const wanted = email.trim().toLowerCase();
  const account = accountsOf(doc).find((a) => a.email === wanted);
  const ok = passwordMatches(password, account?.passHash ?? DUMMY_HASH);
  if (!account || !ok) return null;
  const member = memberFor(doc, account.userId);
  if (!member) return null;
  return signedInAs(doc, member, 'member', label, deps);
}
