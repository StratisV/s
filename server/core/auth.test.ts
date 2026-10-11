import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_TTL_MS, normaliseCode } from '../../src/lib/backend/serverApi';
import { BackendError } from '../../src/lib/backend/types';
import { USER_DEMO_DOC } from '../../src/lib/logic/importHome.fixture';
import { buildServerHome } from '../../src/lib/logic/serverImport';
import {
  CODE_REPLAY_MS,
  DEVICE_LIMITS,
  MAX_LIVE_CODES,
  addDevice,
  codeWorks,
  deviceInfos,
  deviceToken,
  findDevice,
  hashCode,
  hashKey,
  issueCode,
  markSeen,
  parseDeviceToken,
  pruneAuth,
  recoverOwner,
  redeemCode,
  removeDevice,
  setupCodeMatches,
  setupHashOf,
  tokenVerifies,
  type AuthDeps,
} from './auth';
import { newServerDoc } from './serverDoc';

const START = Date.parse('2026-10-09T11:00:00.000Z');

function setUp() {
  let now = START;
  const deps: AuthDeps = { now: () => new Date(now), randomBytes: (n) => new Uint8Array(randomBytes(n)), newId: () => randomUUID() };
  const built = buildServerHome(JSON.stringify(USER_DEMO_DOC), { now: new Date(now), ownerUserId: 'u-owner' })!;
  const doc = newServerDoc(built.home, new Date(now));
  const person = (name: string) => doc.home.members.find((m) => m.name === name)!;
  return {
    doc,
    deps,
    person,
    owner: person('Stratis'),
    shea: person('Shea'),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('keys and codes', () => {
  it('hashes keys as base64url and codes as hex', () => {
    expect(hashKey('abc')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashCode('ABCDEFGH')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the setup code however it is typed, and never without one', () => {
    expect(setupCodeMatches('test-setu-pcde', 'TESTSETUPCDE')).toBe(true);
    expect(setupCodeMatches(' TEST SETU PCDE ', 'TESTSETUPCDE')).toBe(true);
    expect(setupCodeMatches('TEST-SETU-PCDF', 'TESTSETUPCDE')).toBe(false);
    expect(setupCodeMatches('', null)).toBe(false);
    expect(setupCodeMatches('anything', null)).toBe(false);
  });

  it('makes 8-letter codes from the alphabet, shown in two groups, valid for 7 days', () => {
    const { doc, deps, shea } = setUp();
    const { code, row } = issueCode(doc, shea.id, 'someone', deps);
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect([...normaliseCode(code)].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
    expect(row.codeHash).toBe(hashCode(normaliseCode(code)));
    expect(Date.parse(row.expiresAt) - Date.parse(row.createdAt)).toBe(CODE_TTL_MS);
    // Only the hash is kept.
    expect(JSON.stringify(doc)).not.toContain(normaliseCode(code));
  });

  it('keeps a new code from cancelling the one sent before: up to 5 live a person, the oldest going past that', () => {
    const { doc, deps, shea, owner } = setUp();
    const codes = Array.from({ length: MAX_LIVE_CODES + 1 }, () => issueCode(doc, shea.id, owner.id, deps).code);
    expect(doc.auth.codes).toHaveLength(MAX_LIVE_CODES);
    // The oldest went; the first of the rest still works.
    expect(codeWorks(doc, normaliseCode(codes[0]), deps.now())).toBe(false);
    expect(redeemCode(doc, normaliseCode(codes[1]), 'x', deps)).not.toBeNull();
    // Shea has joined: the other codes someone else made for her go with it.
    expect(codes.slice(2).some((c) => codeWorks(doc, normaliseCode(c), deps.now()))).toBe(false);
  });

  it('keeps every "Add another device" code someone made for themselves', () => {
    const { doc, deps, owner } = setUp();
    const ipad = issueCode(doc, owner.id, owner.id, deps).code;
    const app = issueCode(doc, owner.id, owner.id, deps).code;
    expect(redeemCode(doc, normaliseCode(ipad), 'iPad · Safari', deps)).not.toBeNull();
    expect(redeemCode(doc, normaliseCode(app), 'iPhone · Home Screen app', deps)).not.toBeNull();
  });

  it('lets nobody make a code for someone who has joined and is signed in somewhere, but themselves', () => {
    const { doc, deps, owner, person } = setUp();
    const shea = person('Shea');
    const joined = redeemCode(doc, normaliseCode(issueCode(doc, shea.id, owner.id, deps).code), 'x', deps)!;
    // Stratis can't make one for Shea (it would sign him in as her) ...
    expect(() => issueCode(doc, shea.id, owner.id, deps)).toThrow(expect.objectContaining({ code: 'forbidden' }));
    // ... nor Shea for Stratis, the owner; each can for themselves.
    addDevice(doc, 'u-owner', 'iPhone · Safari', deps);
    expect(() => issueCode(doc, owner.id, shea.id, deps)).toThrow(expect.objectContaining({ code: 'forbidden' }));
    expect(issueCode(doc, shea.id, shea.id, deps).code).toBeTruthy();
    // Once every device of hers is gone (a lost phone, removed from her page), someone at home may.
    removeDevice(doc, joined.device.id);
    expect(issueCode(doc, shea.id, owner.id, deps).code).toBeTruthy();
  });

  it('refuses a code for someone who is not in the home', () => {
    const { doc, deps, owner } = setUp();
    expect(() => issueCode(doc, 'nobody', owner.id, deps)).toThrow(BackendError);
  });
});

describe('redeeming a code', () => {
  it('makes someone not joined yet join, once', () => {
    const { doc, deps, shea: before, owner, person } = setUp();
    expect(before.user_id).toBeNull();
    const homeBefore = doc.home;
    const { code } = issueCode(doc, before.id, owner.id, deps);
    const redeemed = redeemCode(doc, normaliseCode(code), 'iPhone · Safari', deps)!;
    // The home is replaced, never edited in place (HomeStore rolls writes back that way).
    expect(doc.home).not.toBe(homeBefore);
    expect(before.user_id).toBeNull();
    const shea = person('Shea');
    expect(redeemed.entry).toEqual({ status: 'claimed', householdId: shea.household_id, memberId: shea.id, canImport: false });
    expect(shea.user_id).toMatch(/^u-/);
    expect(shea.claimed_at).toBe(new Date(START).toISOString());
    expect(redeemed.caller).toEqual({ userId: shea.user_id, memberId: shea.id, name: 'Shea' });
    expect(findDevice(doc, redeemed.key)?.caller.memberId).toBe(shea.id);
    // Single use, once the phone has used its key.
    markSeen(doc, redeemed.device.id, deps.now());
    expect(redeemCode(doc, normaliseCode(code), 'x', deps)).toBeNull();
    expect(codeWorks(doc, normaliseCode(code), deps.now())).toBe(false);
  });

  it('gives the same code a second go when the reply to the first was lost (its device never used its key)', () => {
    const { doc, deps, owner, person, advance } = setUp();
    const { code } = issueCode(doc, person('Shea').id, owner.id, deps);
    const lost = redeemCode(doc, normaliseCode(code), 'iPhone · Safari', deps)!;
    advance(60_000);
    expect(codeWorks(doc, normaliseCode(code), deps.now())).toBe(true);
    const again = redeemCode(doc, normaliseCode(code), 'iPhone · Safari', deps)!;
    // The same person, the same welcome; the lost device is gone, the new one is in.
    expect(again.entry).toEqual(lost.entry);
    expect(again.caller).toEqual(lost.caller);
    expect(findDevice(doc, lost.key)).toBeNull();
    expect(findDevice(doc, again.key)?.caller.memberId).toBe(person('Shea').id);
    expect(doc.auth.devices.filter((d) => d.userId === lost.caller.userId)).toHaveLength(1);
    // Not once that device has used its key, nor after CODE_REPLAY_MS.
    markSeen(doc, again.device.id, deps.now());
    expect(redeemCode(doc, normaliseCode(code), 'x', deps)).toBeNull();
    const late = setUp();
    const other = issueCode(late.doc, late.person('Shea').id, late.owner.id, late.deps);
    redeemCode(late.doc, normaliseCode(other.code), 'x', late.deps);
    late.advance(CODE_REPLAY_MS + 1);
    expect(redeemCode(late.doc, normaliseCode(other.code), 'x', late.deps)).toBeNull();
  });

  it('signs a device token with the home’s secret, and knows a made-up one', () => {
    const { deps, owner } = setUp();
    const built = buildServerHome(JSON.stringify(USER_DEMO_DOC), { now: new Date(START), ownerUserId: 'u-owner' })!;
    const doc = newServerDoc(built.home, new Date(START), { secret: Buffer.from(randomBytes(32)).toString('base64url') });
    const { key, device } = addDevice(doc, 'u-owner', 'x', deps);
    const token = deviceToken(doc, device, key, 7);
    const parsed = parseDeviceToken(token)!;
    expect(parsed).toMatchObject({ key, deviceId: device.id, rev: 7 });
    expect(tokenVerifies(doc, parsed)).toBe(true);
    expect(tokenVerifies(doc, { ...parsed, rev: 8 })).toBe(false);
    expect(tokenVerifies(doc, { ...parsed, key: key.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) })).toBe(false);
    const other = newServerDoc(built.home, new Date(START), { secret: Buffer.from(randomBytes(32)).toString('base64url') });
    expect(tokenVerifies(other, parsed)).toBe(false);
    // A bare key still reads as one; anything else is not a key at all.
    expect(parseDeviceToken(key)).toEqual({ key });
    expect(parseDeviceToken('x.y')).toBeNull();
    expect(parseDeviceToken('')).toBeNull();
    // Without a secret (a home from before tokens), the cookie is the bare key.
    const plain = setUp();
    const bare = addDevice(plain.doc, 'u-owner', 'x', deps);
    expect(deviceToken(plain.doc, bare.device, bare.key, 2)).toBe(bare.key);
    expect(owner.id).toBeTruthy();
  });

  it('adds another device for someone who has joined', () => {
    const { doc, deps, owner } = setUp();
    const { code } = issueCode(doc, owner.id, owner.id, deps);
    const redeemed = redeemCode(doc, normaliseCode(code), 'Mac · Safari', deps)!;
    expect(redeemed.entry.status).toBe('member');
    expect(owner.user_id).toBe('u-owner');
  });

  it('works for 7 days and not a moment longer', () => {
    const early = setUp();
    const a = issueCode(early.doc, early.shea.id, early.owner.id, early.deps);
    early.advance(CODE_TTL_MS - 1);
    expect(redeemCode(early.doc, normaliseCode(a.code), 'x', early.deps)).not.toBeNull();
    const late = setUp();
    const b = issueCode(late.doc, late.shea.id, late.owner.id, late.deps);
    late.advance(CODE_TTL_MS);
    expect(redeemCode(late.doc, normaliseCode(b.code), 'x', late.deps)).toBeNull();
  });

  it('knows nothing of a wrong or malformed code', () => {
    const { doc, deps, shea, owner } = setUp();
    issueCode(doc, shea.id, owner.id, deps);
    expect(redeemCode(doc, 'ABCDEFGH', 'x', deps)).toBeNull();
    expect(redeemCode(doc, 'not a code', 'x', deps)).toBeNull();
    expect(redeemCode(doc, '', 'x', deps)).toBeNull();
  });
});

describe('setup again with a home online (recoverOwner)', () => {
  it('signs this browser in as the owner while none of the owner’s devices was ever used, with the code that brought it online', () => {
    const { doc, deps, owner } = setUp();
    doc.auth.setupHash = setupHashOf('TEST-SETU-PCDE');
    const lost = addDevice(doc, 'u-owner', 'iPhone · Safari', deps);
    expect(recoverOwner(doc, 'WRON-GCOD-EXXX', 'x', deps)).toBeNull();
    const again = recoverOwner(doc, 'test setu pcde', 'iPhone · Safari', deps)!;
    expect(again.caller).toEqual({ userId: 'u-owner', memberId: owner.id, name: 'Stratis' });
    expect(again.entry.status).toBe('member');
    expect(findDevice(doc, lost.key)).toBeNull();
    expect(findDevice(doc, again.key)).not.toBeNull();
    // Once the owner has used the home, the setup code does nothing.
    markSeen(doc, again.device.id, deps.now());
    expect(recoverOwner(doc, 'TEST-SETU-PCDE', 'x', deps)).toBeNull();
  });
});

describe('devices', () => {
  it('finds a device by its key only, and only while its person is in the home', () => {
    const { doc, deps, owner } = setUp();
    const { key, device } = addDevice(doc, 'u-owner', 'iPhone · Safari', deps);
    expect(device.keyHash).toBe(hashKey(key));
    expect(JSON.stringify(doc)).not.toContain(key);
    expect(findDevice(doc, key)).toEqual({ device, caller: { userId: 'u-owner', memberId: owner.id, name: 'Stratis' } });
    expect(findDevice(doc, key.slice(1))).toBeNull();
    expect(findDevice(doc, '')).toBeNull();
    owner.user_id = 'u-someone-else';
    expect(findDevice(doc, key)).toBeNull();
  });

  it('signs out the oldest device past 10 a person and 50 a home', () => {
    const { doc, deps } = setUp();
    const keys = Array.from({ length: DEVICE_LIMITS.perPerson + 1 }, (_, i) => addDevice(doc, 'u-owner', `d${i}`, deps).key);
    expect(doc.auth.devices).toHaveLength(DEVICE_LIMITS.perPerson);
    expect(findDevice(doc, keys[0])).toBeNull();
    expect(findDevice(doc, keys[1])).not.toBeNull();
    // Others' devices fill the home: its oldest go.
    for (let i = 0; i < DEVICE_LIMITS.perHome; i++) addDevice(doc, `u-x${i}`, 'x', deps);
    expect(doc.auth.devices).toHaveLength(DEVICE_LIMITS.perHome);
  });

  it('lists devices in sign-in order with this one marked, and removes them', () => {
    const { doc, deps, owner } = setUp();
    const a = addDevice(doc, 'u-owner', 'iPhone · Safari', deps);
    const b = addDevice(doc, 'u-owner', 'Mac · Safari', deps);
    expect(deviceInfos(doc, b.device.id)).toEqual([
      { id: a.device.id, memberId: owner.id, label: 'iPhone · Safari', createdAt: a.device.createdAt, current: false },
      { id: b.device.id, memberId: owner.id, label: 'Mac · Safari', createdAt: b.device.createdAt, current: true },
    ]);
    expect(removeDevice(doc, a.device.id)).toBe(true);
    expect(removeDevice(doc, a.device.id)).toBe(false);
    expect(doc.auth.devices.map((d) => d.id)).toEqual([b.device.id]);
  });
});

describe('pruneAuth', () => {
  it('drops expired codes, codes and devices of people who are gone, and devices of people released', () => {
    const { doc, deps, shea, owner, advance } = setUp();
    const keep = issueCode(doc, owner.id, owner.id, deps);
    issueCode(doc, shea.id, owner.id, deps);
    const sheaCode = doc.auth.codes.find((c) => c.memberId === shea.id)!;
    const ownerDevice = addDevice(doc, 'u-owner', 'x', deps);
    const sheaDevice = addDevice(doc, 'u-shea', 'x', deps);
    shea.user_id = 'u-shea';
    pruneAuth(doc, new Date(START));
    expect(doc.auth.codes).toHaveLength(2);
    expect(doc.auth.devices).toHaveLength(2);
    // "Not Shea?": Shea is not joined any more; her devices go.
    shea.user_id = null;
    pruneAuth(doc, new Date(START));
    expect(doc.auth.devices.map((d) => d.id)).toEqual([ownerDevice.device.id]);
    expect(sheaDevice.key).toBeTruthy();
    // Removed from the home: her code goes.
    doc.home.members = doc.home.members.filter((m) => m.id !== shea.id);
    pruneAuth(doc, new Date(START));
    expect(doc.auth.codes.map((c) => c.id)).not.toContain(sheaCode.id);
    // Expired.
    advance(CODE_TTL_MS + 1);
    pruneAuth(doc, new Date(START + CODE_TTL_MS + 1));
    expect(doc.auth.codes).toEqual([]);
    expect(keep.code).toBeTruthy();
  });

  it('keeps a code whose maker is gone, without the maker', () => {
    const { doc, deps, shea } = setUp();
    issueCode(doc, shea.id, 'gone-member', deps);
    pruneAuth(doc, new Date(START));
    expect(doc.auth.codes[0].createdBy).toBeNull();
  });
});
