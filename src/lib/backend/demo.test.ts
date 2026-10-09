import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ADDRESS, DEFAULT_AREAS, MEMBER_COLORS, SEED_ITEMS } from '../constants';
import { addDays, deviceTimeZone, monthKey, todayIn } from '../logic/dates';
import { seedItemsFor } from '../logic/items';
import { countCompletions } from '../logic/stats';
import type { AuthUser, CreateHouseholdInput, HouseholdData, ItemDraft } from '../types';
import { DEMO_STORAGE_KEY, DEMO_USER, DemoBackend, type DemoBackendOptions, type StorageLike } from './demo';
import { BackendError } from './types';

class MemStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const TZ = 'Europe/London';
const BOB: AuthUser = { id: 'user-bob', email: 'bob@example.com', name: 'Bob' };
const CAROL: AuthUser = { id: 'user-carol', email: 'carol@example.com', name: 'Carol' };

let storage: MemStorage;
let clock: Date;
const now = () => clock;

function make(opts: DemoBackendOptions = {}) {
  return new DemoBackend({ storage, now, search: '', latency: 0, ...opts });
}

async function rejectsWith(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BackendError);
  expect((err as BackendError).code).toBe(code);
}

/** A BackendError('unknown') whose message matches, as the database's check violations map. */
async function rejectsWithMessage(p: Promise<unknown>, message: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BackendError);
  expect((err as BackendError).code).toBe('unknown');
  expect((err as BackendError).message).toMatch(message);
}

function input(over: Partial<CreateHouseholdInput> = {}): CreateHouseholdInput {
  const areas = over.areas ?? ['Kitchen', '  ', 'Garden', 'Jacuzzi'];
  return {
    name: 'Flat 2',
    address: '1 Test Street',
    timezone: TZ,
    memberName: 'Stratis',
    memberEmoji: '🦔',
    areas,
    items: seedItemsFor(areas),
    ...over,
  };
}

function storedDoc() {
  return JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
}

/** Signed-in Stratis with a fresh household. */
async function setup(over: Partial<CreateHouseholdInput> = {}) {
  const b = make();
  await b.signInWithGoogle();
  const hid = await b.createHousehold(input(over));
  const data = await b.load(hid);
  const me = data.members[0];
  return { b, hid, data, me };
}

function draft(data: HouseholdData, over: Partial<ItemDraft> = {}): ItemDraft {
  return {
    area_id: data.areas[0].id,
    title: 'Fix the tap',
    note: 'Drips at night.',
    rag: 'red',
    due_date: '2026-10-20',
    assignee_id: null,
    repeat: 'none',
    notify: 'day_before',
    ...over,
  };
}

beforeEach(() => {
  storage = new MemStorage();
  clock = new Date('2026-10-08T09:30:00Z'); // Thu 8 Oct, 10:30 in London
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('auth', () => {
  it('signs in as the demo Google user and notifies listeners', async () => {
    const b = make();
    expect(b.kind).toBe('demo');
    expect(await b.getUser()).toBeNull();
    const seen: (AuthUser | null)[] = [];
    const unsub = b.onAuthChange((u) => seen.push(u));

    await b.signInWithGoogle();
    expect(await b.getUser()).toEqual(DEMO_USER);
    expect(DEMO_USER).toEqual({ id: 'demo-user-stratis', email: 'stratis@example.com', name: 'Stratis' });

    await b.signOut();
    expect(await b.getUser()).toBeNull();
    expect(seen).toEqual([DEMO_USER, null]);

    unsub();
    await b.signInWithGoogle();
    expect(seen).toHaveLength(2);
  });

  it('keeps data on sign-out and restores it on sign-in', async () => {
    const { b, hid } = await setup();
    await b.signOut();
    await rejectsWith(b.getMyHouseholdId(), 'not_signed_in');
    await rejectsWith(b.load(hid), 'not_signed_in');
    await b.signInWithGoogle();
    expect(await b.getMyHouseholdId()).toBe(hid);
  });

  it('persists the session and data in one localStorage document', async () => {
    const { hid } = await setup();
    const doc = storedDoc();
    expect(doc.version).toBe(1);
    expect(doc.session).toBe(DEMO_USER.id);
    expect(doc.households).toHaveLength(1);
    const again = make();
    expect(await again.getUser()).toEqual(DEMO_USER);
    expect(await again.getMyHouseholdId()).toBe(hid);
  });

  it('starts empty when the stored document is corrupt', async () => {
    storage.setItem(DEMO_STORAGE_KEY, '{not json');
    const b = make();
    expect(await b.getUser()).toBeNull();
  });

  it('throws not_signed_in for every call that needs a user', async () => {
    const b = make();
    await rejectsWith(b.getMyHouseholdId(), 'not_signed_in');
    await rejectsWith(b.createHousehold(input()), 'not_signed_in');
    await rejectsWith(b.createInvite(), 'not_signed_in');
    await rejectsWith(b.getInvitePreview('x'), 'not_signed_in');
    await rejectsWith(b.joinHousehold({ token: 'x', memberName: 'S', memberEmoji: '🦔' }), 'not_signed_in');
    await rejectsWith(b.completeItem('x'), 'not_signed_in');
    await rejectsWith(b.deletePushSubscription('x'), 'not_signed_in');
  });

  it('is async and settles after a short simulated delay', async () => {
    const b = new DemoBackend({ storage, now, search: '' });
    const p = b.getUser();
    expect(p).toBeInstanceOf(Promise);
    const t0 = Date.now();
    await p;
    expect(Date.now() - t0).toBeLessThan(200);
  });
});

describe('createHousehold', () => {
  it('creates the household with the caller as owner and the demo housemates', async () => {
    const b = make();
    await b.signInWithGoogle();
    expect(await b.getMyHouseholdId()).toBeNull();
    const hid = await b.createHousehold(input());
    expect(await b.getMyHouseholdId()).toBe(hid);

    const data = await b.load(hid);
    expect(data.household).toEqual({
      id: hid,
      name: 'Flat 2',
      address: '1 Test Street',
      timezone: TZ,
      weekly_email_day: 1,
      weekly_email_time: '08:00',
    });
    expect(data.members.map((m) => [m.name, m.emoji, m.color, m.role, m.email])).toEqual([
      ['Stratis', '🦔', '#007AFF', 'owner', 'stratis@example.com'],
      ['Shea', '🦆', '#AF52DE', 'member', 'shea@example.com'],
      ['Ela', '🦊', '#30B0C7', 'member', 'ela@example.com'],
    ]);
    const [me] = data.members;
    expect(me.user_id).toBe(DEMO_USER.id);
    expect(me).toMatchObject({ household_id: hid, weekly_email: true, push_enabled: false });
    expect(new Set(data.members.map((m) => m.user_id)).size).toBe(3);
  });

  it('creates areas in order (blank names skipped) and seeds items relative to today in the zone', async () => {
    // 23:30 UTC on 8 Oct is already 9 Oct in London (BST).
    clock = new Date('2026-10-08T23:30:00Z');
    const { data } = await setup();
    expect(data.areas.map((a) => [a.name, a.position])).toEqual([
      ['Kitchen', 0],
      ['Garden', 1],
      ['Jacuzzi', 2],
    ]);
    const seeds = seedItemsFor(['Kitchen', 'Garden', 'Jacuzzi']);
    expect(data.items).toHaveLength(seeds.length);
    const [stratis, shea, ela] = data.members;
    const ids = { me: stratis.id, shea: shea.id, ela: ela.id };
    for (const seed of seeds) {
      const item = data.items.find((i) => i.title === seed.title)!;
      const area = data.areas.find((a) => a.id === item.area_id)!;
      expect(area.name).toBe(seed.area);
      expect(item.due_date).toBe(seed.due_in_days === null ? null : addDays('2026-10-09', seed.due_in_days));
      expect(item.assignee_id).toBe(seed.demo_assignee ? ids[seed.demo_assignee] : null);
      expect(item).toMatchObject({
        note: seed.note,
        rag: seed.rag,
        repeat: seed.repeat,
        notify: seed.notify,
        status: 'open',
        created_by: stratis.id,
        updated_by: stratis.id,
      });
    }
  });

  it('matches seed areas case-insensitively and skips unknown ones', async () => {
    const { data } = await setup({
      areas: ['kitchen'],
      items: [...seedItemsFor(['Kitchen']), { ...SEED_ITEMS[0], area: 'Attic', title: 'Nope' }],
    });
    expect(data.items.map((i) => i.title).sort()).toEqual(['Kitchen paper', 'Olive oil']);
  });

  it('adds history so Stats reads 4/2/1 this month and 58/37/16 lifetime', async () => {
    const { data } = await setup();
    const month = countCompletions(data.members, data.completions, 'month', TZ, clock);
    const life = countCompletions(data.members, data.completions, 'lifetime', TZ, clock);
    expect(month.rows.map((r) => r.count)).toEqual([4, 2, 1]);
    expect(life.rows.map((r) => r.count)).toEqual([58, 37, 16]);
    expect(life.total).toBe(111);
    for (const c of data.completions) {
      expect(c.item_id).toBeNull();
      expect(c.item_title).not.toBe('');
      expect(c.completed_by).toBe(c.credited_to);
      expect(new Date(c.completed_at).getTime()).toBeLessThanOrEqual(clock.getTime());
    }
    // This month's are earlier this month; older ones go back about seven months.
    const thisMonth = data.completions.filter((c) => monthKey(c.completed_at, TZ) === '2026-10');
    expect(thisMonth).toHaveLength(7);
    for (const c of thisMonth) expect(todayIn(TZ, new Date(c.completed_at)) < '2026-10-08').toBe(true);
    const months = new Set(data.completions.map((c) => monthKey(c.completed_at, TZ)));
    expect([...months].sort()).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    // Newest first.
    const times = data.completions.map((c) => c.completed_at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('keeps this month at 4/2/1 on the 1st, with nothing in the future', async () => {
    clock = new Date('2026-11-01T00:10:00Z'); // 00:10 on 1 Nov in London (GMT)
    const { data } = await setup();
    const month = countCompletions(data.members, data.completions, 'month', TZ, clock);
    expect(month.rows.map((r) => r.count)).toEqual([4, 2, 1]);
    for (const c of data.completions) expect(new Date(c.completed_at).getTime()).toBeLessThanOrEqual(clock.getTime());
    expect(countCompletions(data.members, data.completions, 'lifetime', TZ, clock).total).toBe(111);
  });

  it('uses the household zone for the month, not UTC', async () => {
    // 22:30 UTC on 31 Oct is 00:30 on 1 Nov in Athens.
    clock = new Date('2026-10-31T22:30:00Z');
    const { data } = await setup({ timezone: 'Europe/Athens' });
    const month = countCompletions(data.members, data.completions, 'month', 'Europe/Athens', clock);
    expect(month.rows.map((r) => r.count)).toEqual([4, 2, 1]);
    const inNov = data.completions.filter((c) => monthKey(c.completed_at, 'Europe/Athens') === '2026-11');
    expect(inNov).toHaveLength(7);
  });

  it('falls back to Europe/London for an unknown zone', async () => {
    const { data } = await setup({ timezone: 'Mars/Olympus' });
    expect(data.household.timezone).toBe('Europe/London');
  });

  it('rejects a second household and a blank name', async () => {
    const { b } = await setup();
    await rejectsWith(b.createHousehold(input()), 'already_member');

    const other = make({ user: BOB });
    await other.signInWithGoogle();
    await rejectsWith(other.createHousehold(input({ name: '   ' })), 'unknown');
    expect(await other.getMyHouseholdId()).toBeNull();
  });
});

describe('load', () => {
  it('returns exactly the contract shape', async () => {
    const { data } = await setup();
    expect(Object.keys(data).sort()).toEqual(['areas', 'completions', 'household', 'items', 'members']);
    expect(Object.keys(data.areas[0]).sort()).toEqual(['household_id', 'id', 'name', 'position']);
    expect(Object.keys(data.items[0]).sort()).toEqual(
      [
        'area_id',
        'assignee_id',
        'created_at',
        'created_by',
        'due_date',
        'household_id',
        'id',
        'note',
        'notify',
        'rag',
        'repeat',
        'status',
        'title',
        'updated_at',
        'updated_by',
      ].sort(),
    );
    expect(Object.keys(data.completions[0]).sort()).toEqual(
      ['completed_at', 'completed_by', 'credited_to', 'household_id', 'id', 'item_id', 'item_title'].sort(),
    );
    expect(Object.keys(data.members[0]).sort()).toEqual(
      ['color', 'created_at', 'email', 'emoji', 'household_id', 'id', 'name', 'push_enabled', 'role', 'user_id', 'weekly_email'].sort(),
    );
  });

  it('is not_found for a household the caller is not in', async () => {
    const { hid } = await setup();
    const bob = make({ user: BOB });
    await bob.signInWithGoogle();
    await rejectsWith(bob.load(hid), 'not_found');
    await rejectsWith(bob.createInvite(), 'not_found');
  });
});

describe('items', () => {
  it('creates, updates and deletes items with created_by/updated_by', async () => {
    const { b, hid, data, me } = await setup();
    clock = new Date('2026-10-08T10:00:00Z');
    const shea = data.members[1];
    const item = await b.createItem(hid, draft(data));
    expect(item).toMatchObject({
      household_id: hid,
      title: 'Fix the tap',
      status: 'open',
      created_by: me.id,
      updated_by: me.id,
      created_at: '2026-10-08T10:00:00.000Z',
      updated_at: '2026-10-08T10:00:00.000Z',
    });

    clock = new Date('2026-10-08T11:00:00Z');
    await b.updateItem(item.id, { title: '  Fix the kitchen tap ', assignee_id: shea.id, area_id: data.areas[2].id, due_date: null });
    let loaded = (await b.load(hid)).items.find((i) => i.id === item.id)!;
    expect(loaded).toMatchObject({
      title: 'Fix the kitchen tap',
      assignee_id: shea.id,
      area_id: data.areas[2].id,
      due_date: null,
      note: 'Drips at night.',
      created_at: '2026-10-08T10:00:00.000Z',
      updated_at: '2026-10-08T11:00:00.000Z',
    });

    await rejectsWith(b.updateItem(item.id, { title: '  ' }), 'unknown');
    await rejectsWith(b.updateItem(item.id, { area_id: 'nope' }), 'not_found');
    await rejectsWith(b.updateItem(item.id, { assignee_id: 'nope' }), 'unknown');
    loaded = (await b.load(hid)).items.find((i) => i.id === item.id)!;
    expect(loaded.title).toBe('Fix the kitchen tap');

    await rejectsWith(b.createItem(hid, draft(data, { title: '' })), 'unknown');
    await rejectsWith(b.createItem(hid, draft(data, { area_id: 'nope' })), 'not_found');

    await b.deleteItem(item.id);
    expect((await b.load(hid)).items.some((i) => i.id === item.id)).toBe(false);
    await rejectsWith(b.deleteItem(item.id), 'not_found');
    await rejectsWith(b.updateItem(item.id, { title: 'x' }), 'not_found');
  });

  it('keeps completions (item_id null, title kept) when an item is deleted', async () => {
    const { b, hid, data } = await setup();
    const item = await b.createItem(hid, draft(data, { repeat: 'weekly' }));
    const cid = await b.completeItem(item.id);
    await b.deleteItem(item.id);
    const c = (await b.load(hid)).completions.find((x) => x.id === cid)!;
    expect(c).toMatchObject({ item_id: null, item_title: 'Fix the tap' });
    // Undo still deletes the completion even though the item is gone.
    await b.undoCompletion(cid);
    expect((await b.load(hid)).completions.some((x) => x.id === cid)).toBe(false);
  });
});

describe('areas', () => {
  it('appends new areas, renames, reorders and cascades deletes', async () => {
    const { b, hid, data } = await setup();
    const shed = await b.createArea(hid, '  Shed ');
    expect(shed).toEqual({ id: shed.id, household_id: hid, name: 'Shed', position: 3 });
    await rejectsWith(b.createArea(hid, ' '), 'unknown');
    await rejectsWith(b.createArea('other-household', 'Loft'), 'not_found');

    await b.renameArea(shed.id, 'Garden shed');
    await rejectsWith(b.renameArea('nope', 'x'), 'not_found');

    const [kitchen, garden, jacuzzi] = data.areas;
    await b.reorderAreas(hid, [shed.id, jacuzzi.id, kitchen.id, garden.id, 'not-an-area']);
    let loaded = await b.load(hid);
    expect(loaded.areas.map((a) => [a.name, a.position])).toEqual([
      ['Garden shed', 0],
      ['Jacuzzi', 1],
      ['Kitchen', 2],
      ['Garden', 3],
    ]);

    const gardenItems = loaded.items.filter((i) => i.area_id === garden.id);
    expect(gardenItems.length).toBeGreaterThan(0);
    const cid = await b.completeItem(gardenItems[0].id);
    await b.deleteArea(garden.id);
    loaded = await b.load(hid);
    expect(loaded.areas.map((a) => a.name)).toEqual(['Garden shed', 'Jacuzzi', 'Kitchen']);
    expect(loaded.items.some((i) => i.area_id === garden.id)).toBe(false);
    expect(storedDoc().items.some((i: { area_id: string }) => i.area_id === garden.id)).toBe(false);
    expect(loaded.completions.find((c) => c.id === cid)).toMatchObject({ item_id: null, item_title: gardenItems[0].title });

    // New areas go after the last position, even with gaps.
    const loft = await b.createArea(hid, 'Loft');
    expect(loft.position).toBe(3);
  });
});

describe('completing', () => {
  it('completes a non-repeating unassigned item for the caller and undo restores it', async () => {
    const { b, hid, data, me } = await setup();
    const item = await b.createItem(hid, draft(data));
    const before = (await b.load(hid)).items.find((i) => i.id === item.id)!;

    clock = new Date('2026-10-08T12:00:00Z');
    const cid = await b.completeItem(item.id);
    let loaded = await b.load(hid);
    expect(loaded.items.some((i) => i.id === item.id)).toBe(false);
    expect(loaded.completions[0]).toEqual({
      id: cid,
      household_id: hid,
      item_id: item.id,
      item_title: 'Fix the tap',
      credited_to: me.id,
      completed_by: me.id,
      completed_at: '2026-10-08T12:00:00.000Z',
    });
    const row = storedDoc().items.find((i: { id: string }) => i.id === item.id);
    expect(row).toMatchObject({ status: 'done', completed_at: '2026-10-08T12:00:00.000Z' });
    await rejectsWith(b.completeItem(item.id), 'not_found');

    await b.undoCompletion(cid);
    loaded = await b.load(hid);
    const after = loaded.items.find((i) => i.id === item.id)!;
    expect({ ...after, updated_at: before.updated_at }).toEqual(before);
    expect(loaded.completions.some((c) => c.id === cid)).toBe(false);
    expect(storedDoc().items.find((i: { id: string }) => i.id === item.id).completed_at).toBeNull();
    await rejectsWith(b.undoCompletion(cid), 'not_found');
  });

  it('credits the assignee, not the person who tapped done', async () => {
    const { b, hid, data, me } = await setup();
    const ela = data.members[2];
    const item = await b.createItem(hid, draft(data, { assignee_id: ela.id }));
    const cid = await b.completeItem(item.id);
    const c = (await b.load(hid)).completions.find((x) => x.id === cid)!;
    expect(c.credited_to).toBe(ela.id);
    expect(c.completed_by).toBe(me.id);
  });

  it('moves repeating items forward and keeps them open', async () => {
    const { b, hid, data } = await setup();
    const make1 = (over: Partial<ItemDraft>) => b.createItem(hid, draft(data, over));
    const monthly = await make1({ repeat: 'monthly', due_date: '2026-10-20' });
    const pastWeekly = await make1({ repeat: 'weekly', due_date: '2026-09-01' });
    const undated = await make1({ repeat: 'quarterly', due_date: null });
    const monthEnd = await make1({ repeat: 'monthly', due_date: '2026-10-31' });
    const yearly = await make1({ repeat: 'yearly', due_date: '2026-10-06' });

    const ids = [monthly, pastWeekly, undated, monthEnd, yearly].map((i) => i.id);
    const cids: string[] = [];
    for (const id of ids) cids.push(await b.completeItem(id));
    const loaded = await b.load(hid);
    const due = (id: string) => loaded.items.find((i) => i.id === id)!;
    expect(due(monthly.id)).toMatchObject({ status: 'open', due_date: '2026-11-20' });
    expect(due(pastWeekly.id).due_date).toBe('2026-10-15'); // a week from today, not from 1 Sep
    expect(due(undated.id).due_date).toBe('2027-01-08');
    expect(due(monthEnd.id).due_date).toBe('2026-11-30');
    expect(due(yearly.id).due_date).toBe('2027-10-06');

    // Undo puts the old due date back.
    await b.undoCompletion(cids[1]);
    expect((await b.load(hid)).items.find((i) => i.id === pastWeekly.id)!.due_date).toBe('2026-09-01');
  });

  it('uses today in the household time zone', async () => {
    // 11:30 UTC on 8 Oct is already 9 Oct (00:30) in Auckland.
    clock = new Date('2026-10-08T11:30:00Z');
    const { b, hid, data } = await setup({ timezone: 'Pacific/Auckland' });
    const item = await b.createItem(hid, draft(data, { repeat: 'weekly', due_date: null }));
    await b.completeItem(item.id);
    expect((await b.load(hid)).items.find((i) => i.id === item.id)!.due_date).toBe('2026-10-16');
  });
});

describe('invites', () => {
  it('creates reusable 14-day tokens with a preview', async () => {
    const { b, hid } = await setup();
    const token = await b.createInvite();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(await b.getInvitePreview(token)).toEqual({ household_name: 'Flat 2', address: '1 Test Street' });
    expect(await b.getInvitePreview('0'.repeat(32))).toBeNull();
    expect(await b.getInvitePreview('')).toBeNull();

    // Already in that household: joining is a no-op that returns it.
    expect(await b.joinHousehold({ token, memberName: 'S', memberEmoji: '🦔' })).toBe(hid);
    expect((await b.load(hid)).members).toHaveLength(3);

    clock = new Date(clock.getTime() + 14 * 86_400_000 - 1);
    expect(await b.getInvitePreview(token)).not.toBeNull();
    clock = new Date(clock.getTime() + 1);
    expect(await b.getInvitePreview(token)).toBeNull();
    await rejectsWith(b.joinHousehold({ token, memberName: 'S', memberEmoji: '🦔' }), 'invalid_invite');
  });

  it('lets other people join with the next colour, and edit everything', async () => {
    const { b, hid, me } = await setup();
    const token = await b.createInvite();

    const bob = make({ user: BOB });
    await bob.signInWithGoogle();
    await rejectsWith(bob.joinHousehold({ token: 'bogus', memberName: 'Bob', memberEmoji: '🐻' }), 'invalid_invite');
    expect(await bob.joinHousehold({ token, memberName: ' Bobby ', memberEmoji: '🐻' })).toBe(hid);
    let data = await bob.load(hid);
    const bobMember = data.members[3];
    expect(bobMember).toMatchObject({
      user_id: BOB.id,
      name: 'Bobby',
      emoji: '🐻',
      email: 'bob@example.com',
      role: 'member',
      color: MEMBER_COLORS[3],
    });
    await rejectsWith(bob.createHousehold(input()), 'already_member');

    // Every member edits everything: household, other people's profiles, areas, items.
    await bob.updateHousehold(hid, { name: 'Our place', address: '2 New Road', timezone: 'Europe/Athens' });
    await bob.updateMember(me.id, { name: 'Strat', emoji: '🐼', weekly_email: false });
    await rejectsWith(bob.updateHousehold(hid, { timezone: 'Nowhere/Land' }), 'unknown');
    await rejectsWith(bob.updateMember(me.id, { name: ' ' }), 'unknown');
    data = await bob.load(hid);
    expect(data.household).toMatchObject({ name: 'Our place', address: '2 New Road', timezone: 'Europe/Athens' });
    expect(data.members[0]).toMatchObject({ name: 'Strat', emoji: '🐼', weekly_email: false });
    expect(storedDoc().households[0].updated_by).toBe(bobMember.id);

    const item = data.items[0];
    await bob.updateItem(item.id, { rag: 'red' });
    const cid = await bob.completeItem(item.id);
    const c = (await bob.load(hid)).completions.find((x) => x.id === cid)!;
    expect(c.completed_by).toBe(bobMember.id);
    expect(c.credited_to).toBe(item.assignee_id ?? bobMember.id);

    // The same token works again (reusable).
    const carol = make({ user: CAROL });
    await carol.signInWithGoogle();
    expect(await carol.joinHousehold({ token, memberName: 'Carol', memberEmoji: '🦉' })).toBe(hid);
    expect((await carol.load(hid)).members.map((m) => m.color)).toEqual(MEMBER_COLORS.slice(0, 5));
  });

  it('refuses to join a second household', async () => {
    const { b, hid } = await setup();
    const token = await b.createInvite();
    const bob = make({ user: BOB });
    await bob.signInWithGoogle();
    const bobHid = await bob.createHousehold(input({ name: "Bob's" }));
    await rejectsWith(bob.joinHousehold({ token, memberName: 'Bob', memberEmoji: '🐻' }), 'already_member');
    expect(await bob.getMyHouseholdId()).toBe(bobHid);

    // Items and members of another household are out of reach.
    const bobData = await bob.load(bobHid);
    await b.signInWithGoogle();
    const myData = await b.load(hid);
    await rejectsWith(b.updateItem(bobData.items[0].id, { title: 'x' }), 'not_found');
    await rejectsWith(b.updateMember(bobData.members[0].id, { name: 'x' }), 'not_found');
    await rejectsWith(b.createItem(myData.household.id, draft(myData, { assignee_id: bobData.members[0].id })), 'unknown');
  });
});

describe('push subscriptions', () => {
  it('stores and removes the caller’s own subscriptions only', async () => {
    const { b, data, me } = await setup();
    const sub = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } };
    await b.savePushSubscription(me.id, sub);
    await b.savePushSubscription(me.id, { ...sub, keys: { p256dh: 'p2', auth: 'a2' } });
    expect(storedDoc().push_subs).toMatchObject([{ member_id: me.id, user_id: DEMO_USER.id, endpoint: sub.endpoint, p256dh: 'p2', auth: 'a2' }]);
    await rejectsWith(b.savePushSubscription(data.members[1].id, sub), 'not_found');
    await b.deletePushSubscription(sub.endpoint);
    expect(storedDoc().push_subs).toEqual([]);
  });
});

describe('push subscriptions: the database rules', () => {
  const keys = { p256dh: 'p', auth: 'a' };

  it('only takes https endpoints of at most 2048 characters and keys of at most 256', async () => {
    const { b, me } = await setup();
    for (const endpoint of [
      'http://127.0.0.1:54321/rest/v1/',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://',
      'https://fcm.googleapis.com/fcm send/x',
      `https://fcm.googleapis.com/${'x'.repeat(2048)}`,
    ]) {
      await rejectsWithMessage(b.savePushSubscription(me.id, { endpoint, keys }), /^invalid_input: push endpoint/);
    }
    const ok = 'https://fcm.googleapis.com/';
    await b.savePushSubscription(me.id, { endpoint: ok + 'x'.repeat(2048 - ok.length), keys });
    await rejectsWithMessage(
      b.savePushSubscription(me.id, { endpoint: `${ok}k`, keys: { p256dh: 'p'.repeat(257), auth: 'a' } }),
      /^invalid_input: p256dh is longer than 256 characters$/,
    );
    await rejectsWithMessage(
      b.savePushSubscription(me.id, { endpoint: `${ok}k`, keys: { p256dh: 'p', auth: 'a'.repeat(257) } }),
      /^invalid_input: auth is longer than 256 characters$/,
    );
    expect(storedDoc().push_subs).toHaveLength(1);
  });

  it("cuts a long user agent to 512 characters", async () => {
    const { b, me } = await setup();
    vi.stubGlobal('navigator', { userAgent: 'U'.repeat(600) });
    try {
      await b.savePushSubscription(me.id, { endpoint: 'https://fcm.googleapis.com/ua', keys });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(storedDoc().push_subs[0].user_agent).toBe('U'.repeat(512));
  });

  it("moves an endpoint to another account only with the same keys", async () => {
    const { b, hid, me } = await setup();
    const endpoint = 'https://fcm.googleapis.com/fcm/send/shared';
    await b.savePushSubscription(me.id, { endpoint, keys });
    const token = await b.createInvite();

    const bob = make({ user: BOB });
    await bob.signInWithGoogle();
    await bob.joinHousehold({ token, memberName: 'Bob', memberEmoji: '🐻' });
    const bobMe = (await bob.load(hid)).members.find((m) => m.user_id === BOB.id)!;
    // Knowing the endpoint is not enough.
    await rejectsWith(bob.savePushSubscription(bobMe.id, { endpoint, keys: { p256dh: 'p2', auth: 'a2' } }), 'not_found');
    expect(storedDoc().push_subs).toMatchObject([{ endpoint, user_id: DEMO_USER.id, p256dh: 'p', auth: 'a' }]);
    // The same browser subscription (same keys) moves over.
    await bob.savePushSubscription(bobMe.id, { endpoint, keys });
    expect(storedDoc().push_subs).toMatchObject([{ endpoint, user_id: BOB.id, member_id: bobMe.id }]);
  });
});

describe('text limits (the database check constraints)', () => {
  const long = (n: number, c = 'x') => c.repeat(n);

  it('items: title up to 200 characters, note up to 4000', async () => {
    const { b, hid, data } = await setup();
    const item = await b.createItem(hid, draft(data, { title: long(200), note: long(4000) }));
    expect(item.title).toHaveLength(200);
    await rejectsWithMessage(b.createItem(hid, draft(data, { title: long(201) })), /^invalid_input: title is longer than 200/);
    await rejectsWithMessage(b.createItem(hid, draft(data, { note: long(4001) })), /^invalid_input: note is longer than 4000/);
    await rejectsWithMessage(b.updateItem(item.id, { title: long(201) }), /^invalid_input: title/);
    await rejectsWithMessage(b.updateItem(item.id, { note: long(4001), rag: 'green' }), /^invalid_input: note/);
    const after = (await b.load(hid)).items.find((i) => i.id === item.id)!;
    expect([after.title, after.note.length, after.rag]).toEqual([long(200), 4000, 'red']);
  });

  it('counts characters like Postgres: an emoji is one', async () => {
    const { b, hid, data } = await setup();
    const item = await b.createItem(hid, draft(data, { title: long(200, '🦔') }));
    expect(Array.from(item.title)).toHaveLength(200);
    await rejectsWithMessage(b.createItem(hid, draft(data, { title: long(201, '🦔') })), /^invalid_input: title/);
  });

  it('members: name up to 40, emoji up to 16', async () => {
    const { b, hid, me } = await setup();
    await b.updateMember(me.id, { name: long(40) });
    await rejectsWithMessage(b.updateMember(me.id, { name: long(41) }), /^invalid_input: name is longer than 40/);
    await b.updateMember(me.id, { emoji: '👨‍👩‍👧‍👦' });
    await rejectsWithMessage(b.updateMember(me.id, { name: 'Ok', emoji: long(17, '🦔') }), /^invalid_input: emoji/);
    const after = (await b.load(hid)).members[0];
    expect([after.name, after.emoji]).toEqual([long(40), '👨‍👩‍👧‍👦']);
  });

  it('households: name up to 60, address up to 120', async () => {
    const { b, hid } = await setup();
    await b.updateHousehold(hid, { name: long(60), address: long(120) });
    await rejectsWithMessage(b.updateHousehold(hid, { name: long(61) }), /^invalid_input: name is longer than 60/);
    await rejectsWithMessage(b.updateHousehold(hid, { name: 'Ok', address: long(121) }), /^invalid_input: address/);
    const { household } = await b.load(hid);
    expect([household.name, household.address]).toEqual([long(60), long(120)]);
  });

  it('areas: name up to 60', async () => {
    const { b, hid, data } = await setup();
    const area = await b.createArea(hid, long(60));
    expect(area.name).toHaveLength(60);
    await rejectsWithMessage(b.createArea(hid, long(61)), /^invalid_input: name is longer than 60/);
    await rejectsWithMessage(b.renameArea(data.areas[0].id, long(61)), /^invalid_input: name/);
  });

  it('createHousehold and joinHousehold check the same limits and store nothing on failure', async () => {
    const b = make();
    await b.signInWithGoogle();
    await rejectsWithMessage(b.createHousehold(input({ name: long(61) })), /^invalid_input: name/);
    await rejectsWithMessage(b.createHousehold(input({ address: long(121) })), /^invalid_input: address/);
    await rejectsWithMessage(b.createHousehold(input({ memberName: long(41) })), /^invalid_input: name/);
    await rejectsWithMessage(b.createHousehold(input({ memberEmoji: long(17, '🦔') })), /^invalid_input: emoji/);
    await rejectsWithMessage(b.createHousehold(input({ areas: [long(61)], items: [] })), /^invalid_input: area name/);
    const seed = { area: 'Kitchen', note: '', rag: 'green', due_in_days: 1, repeat: 'none', notify: 'none' } as const;
    await rejectsWithMessage(
      b.createHousehold(input({ areas: ['Kitchen'], items: [{ ...seed, title: long(201) }] })),
      /^invalid_input: title/,
    );
    await rejectsWithMessage(
      b.createHousehold(input({ areas: ['Kitchen'], items: [{ ...seed, title: 'Ok', note: long(4001) }] })),
      /^invalid_input: note/,
    );
    expect(await b.getMyHouseholdId()).toBeNull();
    expect(storedDoc().households).toEqual([]);

    const hid = await b.createHousehold(input());
    const token = await b.createInvite();
    const bob = make({ user: BOB });
    await bob.signInWithGoogle();
    await rejectsWithMessage(bob.joinHousehold({ token, memberName: long(41), memberEmoji: '🐻' }), /^invalid_input: name/);
    await rejectsWithMessage(bob.joinHousehold({ token, memberName: 'Bob', memberEmoji: long(17, '🐻') }), /^invalid_input: emoji/);
    expect(await bob.getMyHouseholdId()).toBeNull();
    expect(await bob.joinHousehold({ token, memberName: long(40), memberEmoji: '🐻' })).toBe(hid);
  });
});

describe('subscribe', () => {
  it('is a no-op outside a browser', async () => {
    const { b, hid } = await setup();
    const unsub = b.subscribe(hid, () => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('reports changes made in other tabs through storage events', async () => {
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    const { b, hid } = await setup();
    const onChange = vi.fn();
    const onAuth = vi.fn();
    const unsub = b.subscribe(hid, onChange);
    const unsubAuth = b.onAuthChange(onAuth);
    const fire = (key: string | null) => win.dispatchEvent(Object.assign(new Event('storage'), { key }));

    fire('something-else');
    expect(onChange).not.toHaveBeenCalled();
    fire(DEMO_STORAGE_KEY);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onAuth).not.toHaveBeenCalled(); // session unchanged

    // Another tab signs out.
    const doc = storedDoc();
    doc.session = null;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(doc));
    fire(DEMO_STORAGE_KEY);
    expect(onAuth).toHaveBeenCalledWith(null);

    unsub();
    unsubAuth();
    fire(DEMO_STORAGE_KEY);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onAuth).toHaveBeenCalledTimes(1);
  });
});

describe('URL switches', () => {
  it('?demo-seed=1 wipes and recreates the prototype household, signed in', async () => {
    // Something else there first: it must be gone.
    const bob = make({ user: BOB });
    await bob.signInWithGoogle();
    await bob.createHousehold(input({ name: "Bob's" }));

    const b = make({ search: '?demo-seed=1' });
    expect(await b.getUser()).toEqual(DEMO_USER);
    const hid = (await b.getMyHouseholdId())!;
    expect(hid).toBeTruthy();
    const data = await b.load(hid);
    expect(storedDoc().households).toHaveLength(1);
    expect(data.household).toMatchObject({ name: 'Our home', address: DEFAULT_ADDRESS, timezone: deviceTimeZone() });
    expect(data.areas.map((a) => a.name)).toEqual(DEFAULT_AREAS);
    expect(data.members.map((m) => `${m.emoji} ${m.name}`)).toEqual(['🦔 Stratis', '🦆 Shea', '🦊 Ela']);
    expect(data.items).toHaveLength(SEED_ITEMS.length);

    const today = todayIn(data.household.timezone, clock);
    const heaters = data.items.find((i) => i.title === 'Heaters not working')!;
    expect(heaters.due_date).toBe(addDays(today, -2));
    expect(heaters.assignee_id).toBe(data.members[1].id);
    const mirror = data.items.find((i) => i.title === 'Mirror lights not level')!;
    expect(mirror.assignee_id).toBeNull();

    const tz = data.household.timezone;
    expect(countCompletions(data.members, data.completions, 'month', tz, clock).rows.map((r) => r.count)).toEqual([4, 2, 1]);
    expect(countCompletions(data.members, data.completions, 'lifetime', tz, clock).rows.map((r) => r.count)).toEqual([
      58, 37, 16,
    ]);

    // A later start without the switch keeps the data.
    const later = make();
    expect(await later.getMyHouseholdId()).toBe(hid);
  });

  it('?demo-reset=1 wipes everything and starts signed out', async () => {
    await setup();
    const b = make({ search: '?demo-reset=1' });
    expect(await b.getUser()).toBeNull();
    await b.signInWithGoogle();
    expect(await b.getMyHouseholdId()).toBeNull();
    expect(storedDoc().households).toEqual([]);
  });

  it('ignores the switches when set to 0', async () => {
    const { hid } = await setup();
    const b = make({ search: '?demo-reset=0' });
    expect(await b.getMyHouseholdId()).toBe(hid);
  });
});
