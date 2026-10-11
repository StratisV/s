import { describe, expect, it } from 'vitest';
import { BackendError } from '../../src/lib/backend/types';
import { USER_DEMO_DOC } from '../../src/lib/logic/importHome.fixture';
import { buildServerHome } from '../../src/lib/logic/serverImport';
import { runAs, type Caller } from './runAs';

const NOW = new Date('2026-10-09T11:00:00.000Z');
const now = () => NOW;

function home() {
  return buildServerHome(JSON.stringify(USER_DEMO_DOC), { now: NOW, ownerUserId: 'u-owner' })!;
}

describe('runAs', () => {
  it('runs a write as the caller and keeps no session in the home', async () => {
    const built = home();
    const caller: Caller = { userId: 'u-owner', memberId: built.ownerMemberId, name: 'Stratis' };
    const { result, home: after } = await runAs(built.home, caller, (b) => b.createArea(built.householdId, 'Garage'), { now, kind: 'write' });
    expect(result).toMatchObject({ name: 'Garage', household_id: built.householdId });
    expect(after!.areas.map((a) => a.name)).toContain('Garage');
    expect(after!.session).toBeNull();
    expect(after!.users).toEqual([]);
    expect(JSON.stringify(after)).not.toContain('"session":"u-owner"');
    // The home it was given is left as it was.
    expect(built.home.areas.map((a) => a.name)).not.toContain('Garage');
  });

  it('reads without handing back a home', async () => {
    const built = home();
    const caller: Caller = { userId: 'u-owner', memberId: built.ownerMemberId, name: 'Stratis' };
    const { result, home: after } = await runAs(built.home, caller, (b) => b.load(built.householdId), { now, kind: 'read' });
    expect(result.household.name).toBe('Our home');
    expect(after).toBeNull();
  });

  it('applies the data rules as the demo backend does, and changes nothing when refused', async () => {
    const built = home();
    const before = JSON.stringify(built.home);
    const caller: Caller = { userId: 'u-owner', memberId: built.ownerMemberId, name: 'Stratis' };
    await expect(runAs(built.home, caller, (b) => b.createArea(built.householdId, '   '), { now, kind: 'write' })).rejects.toMatchObject({
      code: 'unknown',
      message: 'invalid_input: name',
    });
    expect(JSON.stringify(built.home)).toBe(before);
  });

  it('lets in only someone who is in the home', async () => {
    const built = home();
    const stranger: Caller = { userId: 'u-stranger', memberId: 'x', name: 'Stranger' };
    await expect(runAs(built.home, stranger, (b) => b.load(built.householdId), { now, kind: 'read' })).rejects.toBeInstanceOf(BackendError);
  });
});
