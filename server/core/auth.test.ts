import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_TTL_MS, normaliseCode } from '../../src/lib/backend/serverApi';
import { BackendError } from '../../src/lib/backend/types';
import { USER_DEMO_DOC } from '../../src/lib/logic/importHome.fixture';
import { buildServerHome } from '../../src/lib/logic/serverImport';
import {
  DEVICE_LIMITS,
  addDevice,
  deviceInfos,
  findDevice,
  hashCode,
  hashKey,
  issueCode,
  pruneAuth,
  redeemCode,
  removeDevice,
  setupCodeMatches,
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

  it('keeps one live code per person: a new one replaces it', () => {
    const { doc, deps, shea, owner } = setUp();
    const first = issueCode(doc, shea.id, owner.id, deps);
    const second = issueCode(doc, shea.id, owner.id, deps);
    expect(doc.auth.codes).toHaveLength(1);
    expect(redeemCode(doc, normaliseCode(first.code), 'x', deps)).toBeNull();
    expect(redeemCode(doc, normaliseCode(second.code), 'x', deps)).not.toBeNull();
  });

  it('refuses a code for someone who is not in the home', () => {
    const { doc, deps, owner } = setUp();
    expect(() => issueCode(doc, 'nobody', owner.id, deps)).toThrow(BackendError);
  });
});

describe('redeeming a code', () => {
  it('makes someone not joined yet join, once', () => {
    const { doc, deps, shea, owner } = setUp();
    expect(shea.user_id).toBeNull();
    const { code } = issueCode(doc, shea.id, owner.id, deps);
    const redeemed = redeemCode(doc, normaliseCode(code), 'iPhone · Safari', deps)!;
    expect(redeemed.entry).toEqual({ status: 'claimed', householdId: shea.household_id, memberId: shea.id, canImport: false });
    expect(shea.user_id).toMatch(/^u-/);
    expect(shea.claimed_at).toBe(new Date(START).toISOString());
    expect(redeemed.caller).toEqual({ userId: shea.user_id, memberId: shea.id, name: 'Shea' });
    expect(findDevice(doc, redeemed.key)?.caller.memberId).toBe(shea.id);
    // Single use.
    expect(redeemCode(doc, normaliseCode(code), 'x', deps)).toBeNull();
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
