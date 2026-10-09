import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_PAGE_SIZE, DEFAULT_ADDRESS, DEFAULT_AREAS, MEMBER_COLORS, REACTION_EMOJIS, SEED_ITEMS } from '../constants';
import { addDays, deviceTimeZone, monthKey, todayIn } from '../logic/dates';
import { seedItemsFor } from '../logic/items';
import { countCompletions } from '../logic/stats';
import type { AuthUser, ChatChange, CreateHouseholdInput, HouseholdData, ItemDraft } from '../types';
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
    kind: 'task',
    title: 'Fix the tap',
    note: 'Drips at night.',
    good: '',
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
    expect(Object.keys(data).sort()).toEqual(['areas', 'completions', 'household', 'housekeeping', 'items', 'members']);
    expect(Object.keys(data.housekeeping).sort()).toEqual(['note', 'tasks', 'visits']);
    expect(Object.keys(data.housekeeping.note).sort()).toEqual(['body', 'updated_at', 'updated_by']);
    expect(Object.keys(data.areas[0]).sort()).toEqual(['household_id', 'id', 'name', 'position']);
    expect(Object.keys(data.items[0]).sort()).toEqual(
      [
        'area_id',
        'assignee_id',
        'created_at',
        'created_by',
        'due_date',
        'household_id',
        'good',
        'id',
        'kind',
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

describe('kinds: To do (task) and To maintain (state)', () => {
  it('seeds the Firepit as a state in the Garden, looked after by Ela, without a due date', async () => {
    const { data } = await setup();
    const garden = data.areas.find((a) => a.name === 'Garden')!;
    const ela = data.members[2];
    const firepit = data.items.find((i) => i.title === 'Firepit')!;
    expect(firepit).toMatchObject({
      area_id: garden.id,
      kind: 'state',
      rag: 'green',
      note: "New one installed. Keep the cover on when it's not in use.",
      due_date: null,
      repeat: 'none',
      notify: 'none',
      assignee_id: ela.id,
      status: 'open',
    });
    // Every other seed item is a to-do.
    expect(data.items.filter((i) => i.kind === 'state').map((i) => i.title)).toEqual(['Firepit']);
    for (const seed of seedItemsFor(['Kitchen', 'Garden', 'Jacuzzi'])) {
      expect(data.items.find((i) => i.title === seed.title)!.kind, seed.title).toBe(seed.kind ?? 'task');
    }
  });

  it('creates a state without a due date, repeat or reminder, whatever the draft says', async () => {
    const { b, hid, data } = await setup();
    const created = await b.createItem(
      hid,
      draft(data, { kind: 'state', title: 'Jacuzzi', due_date: '2026-10-20', repeat: 'weekly', notify: 'week_before' }),
    );
    expect(created).toMatchObject({ kind: 'state', title: 'Jacuzzi', due_date: null, repeat: 'none', notify: 'none' });
    expect((await b.load(hid)).items.find((i) => i.id === created.id)).toEqual(created);
  });

  it('a draft without a kind makes a task; an unknown kind is invalid_input and stores nothing', async () => {
    const { b, hid, data } = await setup();
    const { kind: _kind, ...bare } = draft(data);
    expect((await b.createItem(hid, bare as ItemDraft)).kind).toBe('task');
    const count = (await b.load(hid)).items.length;
    await rejectsWithMessage(b.createItem(hid, draft(data, { kind: 'done' as never })), /invalid_input: kind/);
    expect((await b.load(hid)).items).toHaveLength(count);
  });

  it('turns a task into a state (dropping its due date) and back into a task', async () => {
    const { b, hid, data } = await setup();
    const task = await b.createItem(hid, draft(data, { repeat: 'monthly', notify: 'week_before' }));
    clock = new Date('2026-10-08T12:00:00Z');
    await b.updateItem(task.id, { kind: 'state' });
    let row = (await b.load(hid)).items.find((i) => i.id === task.id)!;
    expect(row).toMatchObject({ kind: 'state', due_date: null, repeat: 'none', notify: 'none', updated_at: '2026-10-08T12:00:00.000Z' });

    // While it is a state, due dates and reminders do not stick; everything else does.
    await b.updateItem(task.id, { due_date: '2026-12-01', notify: 'same_day', rag: 'green', title: 'Tap' });
    row = (await b.load(hid)).items.find((i) => i.id === task.id)!;
    expect(row).toMatchObject({ kind: 'state', due_date: null, notify: 'none', rag: 'green', title: 'Tap' });

    await b.updateItem(task.id, { kind: 'task', due_date: '2026-10-15', notify: 'day_before' });
    row = (await b.load(hid)).items.find((i) => i.id === task.id)!;
    expect(row).toMatchObject({ kind: 'task', due_date: '2026-10-15', repeat: 'none', notify: 'day_before' });

    await rejectsWithMessage(b.updateItem(task.id, { kind: 'archived' as never }), /invalid_input: kind/);
    expect((await b.load(hid)).items.find((i) => i.id === task.id)!.kind).toBe('task');
  });

  it('never completes a state: invalid_input: state, nothing logged', async () => {
    const { b, hid, data } = await setup();
    const firepit = data.items.find((i) => i.title === 'Firepit')!;
    const completions = data.completions.length;
    const err = await b.completeItem(firepit.id).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BackendError);
    expect([(err as BackendError).code, (err as BackendError).message]).toEqual(['unknown', 'invalid_input: state']);
    const after = await b.load(hid);
    expect(after.completions).toHaveLength(completions);
    expect(after.items.find((i) => i.id === firepit.id)).toEqual(firepit);
  });

  it('undoing a completion of an item that has since become a state keeps it without a due date', async () => {
    const { b, hid, data } = await setup();
    const item = await b.createItem(hid, draft(data, { repeat: 'monthly', due_date: '2026-10-20' }));
    const cid = await b.completeItem(item.id);
    await b.updateItem(item.id, { kind: 'state' });
    await b.undoCompletion(cid);
    expect((await b.load(hid)).items.find((i) => i.id === item.id)).toMatchObject({ kind: 'state', due_date: null, status: 'open' });
  });

  it('reads items stored before kinds existed as tasks', async () => {
    const { hid } = await setup();
    const doc = storedDoc();
    for (const item of doc.items) delete item.kind;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(doc));
    const items = (await make().load(hid)).items;
    expect(items.length).toBeGreaterThan(0);
    expect(new Set(items.map((i) => i.kind))).toEqual(new Set(['task']));
  });

  it('refuses a seed item with an unknown kind and stores nothing', async () => {
    const b = make();
    await b.signInWithGoogle();
    await rejectsWithMessage(
      b.createHousehold(input({ items: [{ ...SEED_ITEMS[0], kind: 'done' as never }] })),
      /invalid_input: kind/,
    );
    expect(await b.getMyHouseholdId()).toBeNull();
  });
});

describe('"What good looks like" (items.good)', () => {
  const GOOD = 'Cover on when not in use, ash cleared out, logs dry and stacked under the bench.';

  it('seeds the Firepit with one; every other seed item has none', async () => {
    const { data } = await setup();
    const firepit = data.items.find((i) => i.title === 'Firepit')!;
    expect(firepit).toMatchObject({ kind: 'state', good: GOOD, note: "New one installed. Keep the cover on when it's not in use." });
    expect(data.items.filter((i) => i.good !== '').map((i) => i.title)).toEqual(['Firepit']);
  });

  it('is created and edited by any member, and kept through kind changes, completion and undo', async () => {
    const { b, hid, data } = await setup();
    const created = await b.createItem(hid, draft(data, { kind: 'state', title: 'Jacuzzi', good: 'Clear water, cover on.' }));
    expect(created).toMatchObject({ kind: 'state', good: 'Clear water, cover on.', due_date: null });
    // A draft from older code without it stores the column's default.
    const { good: _good, ...bare } = draft(data, { kind: 'state', title: 'Aga' });
    expect((await b.createItem(hid, bare as ItemDraft)).good).toBe('');

    await b.updateItem(created.id, { good: 'Clear water, cover on, filter rinsed.' });
    const row = () => b.load(hid).then((d) => d.items.find((i) => i.id === created.id)!);
    expect(await row()).toMatchObject({ good: 'Clear water, cover on, filter rinsed.', kind: 'state' });

    // Becomes a task (it is kept, just not shown), is done and undone, then a state again.
    await b.updateItem(created.id, { kind: 'task', due_date: '2026-10-08', repeat: 'weekly' });
    const cid = await b.completeItem(created.id);
    expect(await row()).toMatchObject({ kind: 'task', due_date: '2026-10-15', good: 'Clear water, cover on, filter rinsed.' });
    await b.undoCompletion(cid);
    await b.updateItem(created.id, { kind: 'state' });
    expect(await row()).toMatchObject({ kind: 'state', due_date: null, good: 'Clear water, cover on, filter rinsed.' });

    // Other edits leave it alone; clearing it is an edit like any other.
    await b.updateItem(created.id, { rag: 'green', note: 'Tested today.' });
    expect((await row()).good).toBe('Clear water, cover on, filter rinsed.');
    await b.updateItem(created.id, { good: '' });
    expect((await row()).good).toBe('');
  });

  it('reads items stored before it existed as having none', async () => {
    const { hid } = await setup();
    const doc = storedDoc();
    for (const item of doc.items) delete item.good;
    doc.items[0].good = null;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(doc));
    const items = (await make().load(hid)).items;
    expect(items.length).toBeGreaterThan(0);
    expect(new Set(items.map((i) => i.good))).toEqual(new Set(['']));
    // And can be given one.
    const firepit = items.find((i) => i.title === 'Firepit')!;
    await make().updateItem(firepit.id, { good: GOOD });
    expect((await make().load(hid)).items.find((i) => i.id === firepit.id)!.good).toBe(GOOD);
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

  it('items: "What good looks like" up to 4000 characters', async () => {
    const { b, hid, data } = await setup();
    const item = await b.createItem(hid, draft(data, { kind: 'state', good: long(4000, '🦔') }));
    expect(Array.from(item.good)).toHaveLength(4000);
    await rejectsWithMessage(b.createItem(hid, draft(data, { good: long(4001) })), /^invalid_input: good is longer than 4000/);
    await rejectsWithMessage(b.updateItem(item.id, { good: long(4001), rag: 'green' }), /^invalid_input: good/);
    const after = (await b.load(hid)).items.find((i) => i.id === item.id)!;
    expect([Array.from(after.good).length, after.rag]).toEqual([4000, 'red']);
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
    await rejectsWithMessage(
      b.createHousehold(input({ areas: ['Kitchen'], items: [{ ...seed, kind: 'state', title: 'Ok', good: long(4001) }] })),
      /^invalid_input: good/,
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

describe('chat', () => {
  const later = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  type StoredReaction = { message_id: string; member_id: string; household_id: string; emoji: string };
  const reactionsOf = (doc: { message_reactions: StoredReaction[] }, id: string) =>
    doc.message_reactions.filter((r) => r.message_id === id);

  /** Bob joins Stratis's household; the shared document is left signed in as Bob. */
  async function joinBob(b: DemoBackend, hid: string) {
    const token = await b.createInvite();
    const bob = make({ user: BOB });
    await bob.signInWithGoogle();
    await bob.joinHousehold({ token, memberName: 'Bob', memberEmoji: '🐻' });
    const bobMe = (await bob.load(hid)).members.find((m) => m.user_id === BOB.id)!;
    return { bob, bobMe };
  }

  it('starts every demo household with a short conversation about the house, with reactions', async () => {
    const { b, hid, data } = await setup();
    const page = await b.listMessages(hid);
    expect(page.hasMore).toBe(false);
    const { messages } = page;
    expect(messages.length).toBeGreaterThanOrEqual(6);
    expect(messages.length).toBeLessThanOrEqual(10);

    const all = messages.map((m) => m.body).join('\n');
    expect(all).toMatch(/heating engineer/i);
    expect(all).toMatch(/firepit/i);
    expect(all).toMatch(/olive oil/i);
    expect(all).not.toMatch(/\u2014/); // no em dashes in copy
    const [stratis, shea, ela] = data.members;
    expect(new Set(messages.map((m) => m.member_id))).toEqual(new Set([stratis.id, shea.id, ela.id]));

    // Yesterday evening and this morning (10:30 in London), oldest first, all in the past.
    const times = messages.map((m) => new Date(m.created_at).getTime());
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    expect(times[times.length - 1]).toBeLessThan(clock.getTime());
    expect(new Set(messages.map((m) => todayIn(TZ, new Date(m.created_at))))).toEqual(new Set(['2026-10-07', '2026-10-08']));

    // A few reactions, from members, after their message, once each; some of them Stratis's own.
    const reactions = messages.flatMap((m) => m.reactions.map((r) => ({ ...r, sent: m.created_at, id: m.id })));
    expect(reactions.length).toBeGreaterThanOrEqual(3);
    expect(messages.some((m) => m.reactions.length >= 2)).toBe(true);
    expect(reactions.some((r) => r.member_id === stratis.id)).toBe(true);
    const keys = new Set<string>();
    for (const r of reactions) {
      expect(r.message_id).toBe(r.id);
      expect(data.members.some((m) => m.id === r.member_id)).toBe(true);
      expect(REACTION_EMOJIS as readonly string[]).toContain(r.emoji);
      expect(r.created_at > r.sent).toBe(true);
      expect(new Date(r.created_at).getTime()).toBeLessThanOrEqual(clock.getTime());
      keys.add(`${r.message_id} ${r.member_id} ${r.emoji}`);
    }
    expect(keys.size).toBe(reactions.length);
    for (const m of messages) {
      const stamps = m.reactions.map((r) => r.created_at);
      expect([...stamps].sort()).toEqual(stamps);
    }

    // Each household gets its own copy.
    const bob = make({ user: BOB });
    await bob.signInWithGoogle();
    const bobHid = await bob.createHousehold(input({ name: "Bob's" }));
    const bobChat = (await bob.listMessages(bobHid)).messages;
    expect(bobChat.map((m) => m.body)).toEqual(messages.map((m) => m.body));
    expect(bobChat.every((m) => m.household_id === bobHid && !messages.some((x) => x.id === m.id))).toBe(true);
  });

  it('moves the seeded conversation a day earlier while this morning is still ahead', async () => {
    clock = new Date('2026-10-08T06:00:00Z'); // 07:00 in London
    const { b, hid } = await setup();
    const { messages } = await b.listMessages(hid);
    expect(new Set(messages.map((m) => todayIn(TZ, new Date(m.created_at))))).toEqual(new Set(['2026-10-06', '2026-10-07']));
    for (const m of messages) {
      expect(new Date(m.created_at).getTime()).toBeLessThan(clock.getTime());
      for (const r of m.reactions) expect(new Date(r.created_at).getTime()).toBeLessThanOrEqual(clock.getTime());
    }
  });

  it('?demo-seed=1 comes with the conversation', async () => {
    const b = make({ search: '?demo-seed=1' });
    const hid = (await b.getMyHouseholdId())!;
    const { members } = await b.load(hid);
    const page = await b.listMessages(hid);
    expect(page.messages.length).toBeGreaterThanOrEqual(6);
    expect(page.messages.length).toBeLessThanOrEqual(10);
    expect(new Set(page.messages.map((m) => m.member_id))).toEqual(new Set(members.map((m) => m.id)));
    expect(page.messages.some((m) => m.reactions.length > 0)).toBe(true);
  });

  it('returns exactly the contract shape', async () => {
    const { b, hid } = await setup();
    const { messages } = await b.listMessages(hid);
    const reacted = messages.find((m) => m.reactions.length)!;
    expect(Object.keys(reacted).sort()).toEqual(['body', 'created_at', 'household_id', 'id', 'member_id', 'reactions']);
    expect(Object.keys(reacted.reactions[0]).sort()).toEqual(['created_at', 'emoji', 'member_id', 'message_id']);
    const [got] = await b.getMessages([reacted.id]);
    expect(got).toEqual(reacted);
  });

  it('posts trimmed messages of 1 to 4000 characters as the signed-in member', async () => {
    const { b, hid, me } = await setup();
    const seeded = storedDoc().messages.length;
    clock = new Date('2026-10-08T10:00:00Z');
    const msg = await b.sendMessage(hid, '  The engineer is here \n');
    expect(msg).toEqual({
      id: msg.id,
      household_id: hid,
      member_id: me.id,
      body: 'The engineer is here',
      created_at: '2026-10-08T10:00:00.000Z',
      reactions: [],
    });
    expect((await b.listMessages(hid)).messages.at(-1)).toEqual(msg);

    expect((await b.sendMessage(hid, 'x'.repeat(4000))).body).toHaveLength(4000);
    expect((await b.sendMessage(hid, ` ${'x'.repeat(4000)}\n`)).body).toHaveLength(4000);
    // Characters as Postgres counts them: an emoji is one.
    expect(Array.from((await b.sendMessage(hid, '🦔'.repeat(4000))).body)).toHaveLength(4000);
    for (const body of ['', '   ', '\n\t ', 'x'.repeat(4001), '🦔'.repeat(4001)]) {
      await rejectsWithMessage(b.sendMessage(hid, body), /^invalid_input: body$/);
    }
    expect(storedDoc().messages).toHaveLength(seeded + 4);
    await rejectsWith(b.sendMessage('another-household', 'Hi'), 'not_found');
  });

  it('stamps created_at strictly after the newest message, even within one millisecond', async () => {
    const { b, hid } = await setup();
    const sent = [];
    for (const body of ['one', 'two', 'three']) sent.push(await b.sendMessage(hid, body));
    expect(sent.map((m) => m.created_at)).toEqual([
      '2026-10-08T09:30:00.000Z',
      '2026-10-08T09:30:00.001Z',
      '2026-10-08T09:30:00.002Z',
    ]);
    later(1); // the clock catches up by one millisecond only
    expect((await b.sendMessage(hid, 'four')).created_at).toBe('2026-10-08T09:30:00.003Z');
    later(60_000);
    expect((await b.sendMessage(hid, 'five')).created_at).toBe('2026-10-08T09:31:00.001Z');
    const { messages } = await b.listMessages(hid, { limit: 5 });
    expect(messages.map((m) => m.body)).toEqual(['one', 'two', 'three', 'four', 'five']);
  });

  it('pages backwards by created_at: the newest page first, each page oldest first', async () => {
    const { b, hid } = await setup();
    const seeded = (await b.listMessages(hid)).messages;
    const n = 2 * CHAT_PAGE_SIZE + 20;
    for (let i = 1; i <= n; i++) {
      later(1000);
      await b.sendMessage(hid, `Message ${i}`);
    }
    const bodies = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `Message ${from + i}`);

    const first = await b.listMessages(hid);
    expect(first.hasMore).toBe(true);
    expect(first.messages.map((m) => m.body)).toEqual(bodies(n - CHAT_PAGE_SIZE + 1, n));

    const second = await b.listMessages(hid, { before: first.messages[0].created_at });
    expect(second.hasMore).toBe(true);
    expect(second.messages.map((m) => m.body)).toEqual(bodies(21, n - CHAT_PAGE_SIZE));

    const third = await b.listMessages(hid, { before: second.messages[0].created_at });
    expect(third.hasMore).toBe(false);
    expect(third.messages).toEqual([...seeded, ...(await b.listMessages(hid, { before: second.messages[0].created_at, limit: 20 })).messages]);
    expect(third.messages.slice(seeded.length).map((m) => m.body)).toEqual(bodies(1, 20));

    // Together: every message once, in order.
    const everything = [...third.messages, ...second.messages, ...first.messages];
    expect(everything).toHaveLength(seeded.length + n);
    expect(new Set(everything.map((m) => m.id)).size).toBe(everything.length);
    const times = everything.map((m) => new Date(m.created_at).getTime());
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);

    // `before` is strict, and any spelling of the instant works.
    const newest = first.messages[first.messages.length - 1];
    expect((await b.listMessages(hid, { before: newest.created_at, limit: 1 })).messages.map((m) => m.body)).toEqual([
      `Message ${n - 1}`,
    ]);
    const offset = newest.created_at.replace('Z', '+00:00');
    expect((await b.listMessages(hid, { before: offset, limit: 1 })).messages.map((m) => m.body)).toEqual([`Message ${n - 1}`]);
    expect(await b.listMessages(hid, { before: seeded[0].created_at })).toEqual({ messages: [], hasMore: false });
    await rejectsWithMessage(b.listMessages(hid, { before: 'yesterday-ish' }), /^invalid_input: before$/);

    // Limits: a positive whole number, the page size when missing.
    const three = await b.listMessages(hid, { limit: 3 });
    expect(three).toMatchObject({ hasMore: true });
    expect(three.messages.map((m) => m.body)).toEqual(bodies(n - 2, n));
    expect((await b.listMessages(hid, { limit: 0 })).messages.map((m) => m.body)).toEqual([`Message ${n}`]);
    expect((await b.listMessages(hid, { limit: 2.7 })).messages).toHaveLength(2);
    expect((await b.listMessages(hid, { limit: Number.NaN })).messages).toHaveLength(CHAT_PAGE_SIZE);
    const huge = await b.listMessages(hid, { limit: 10_000 });
    expect(huge).toMatchObject({ hasMore: false });
    expect(huge.messages).toEqual(everything);
  });

  it('getMessages reloads the messages that still exist, with their reactions', async () => {
    const { b, hid, me } = await setup();
    const a = await b.sendMessage(hid, 'A');
    later(1000);
    const c = await b.sendMessage(hid, 'C');
    later(1000);
    await b.setReaction(a.id, '👍', true);
    const got = await b.getMessages([c.id, 'missing', a.id, a.id]);
    expect(got.map((m) => m.body)).toEqual(['A', 'C']);
    expect(got[0].reactions).toEqual([{ message_id: a.id, member_id: me.id, emoji: '👍', created_at: '2026-10-08T09:30:02.000Z' }]);
    await b.deleteMessage(c.id);
    expect((await b.getMessages([a.id, c.id])).map((m) => m.body)).toEqual(['A']);
    expect(await b.getMessages([])).toEqual([]);
  });

  it("keeps each household's chat to its members", async () => {
    const { b, hid } = await setup();
    const msg = await b.sendMessage(hid, 'Only for us');

    const bob = make({ user: BOB });
    await bob.signInWithGoogle();
    const outsider = async () => {
      await rejectsWith(bob.listMessages(hid), 'not_found');
      await rejectsWith(bob.sendMessage(hid, 'Hi'), 'not_found');
      expect(await bob.getMessages([msg.id])).toEqual([]);
      await rejectsWith(bob.setReaction(msg.id, '👍', true), 'not_found');
      await bob.setReaction(msg.id, '👍', false); // a delete that matches nothing
      await rejectsWith(bob.deleteMessage(msg.id), 'not_found');
    };
    await outsider(); // no household yet
    const bobHid = await bob.createHousehold(input({ name: "Bob's" }));
    await outsider(); // a household of his own
    expect((await bob.listMessages(bobHid)).messages.some((m) => m.id === msg.id)).toBe(false);

    await b.signInWithGoogle();
    expect(await b.getMessages([msg.id])).toEqual([msg]);
    await rejectsWith(b.listMessages(bobHid), 'not_found');
  });

  it('deletes only your own messages, and their reactions with them', async () => {
    const { b, hid, data } = await setup();
    const { bob } = await joinBob(b, hid);
    const bobs = await bob.sendMessage(hid, 'Hello from Bob');
    await b.signInWithGoogle();
    later(1000);
    const mine = await b.sendMessage(hid, 'Hi Bob');
    await b.setReaction(bobs.id, '❤️', true);

    await rejectsWith(b.deleteMessage(bobs.id), 'not_found');
    const sheas = (await b.listMessages(hid)).messages.find((m) => m.member_id === data.members[1].id)!;
    await rejectsWith(b.deleteMessage(sheas.id), 'not_found');
    await rejectsWith(b.deleteMessage('nope'), 'not_found');
    expect(await b.getMessages([bobs.id, sheas.id])).toHaveLength(2);

    await bob.signInWithGoogle();
    await bob.setReaction(mine.id, '👍', true);
    await bob.deleteMessage(bobs.id);
    expect(storedDoc().messages.some((m: { id: string }) => m.id === bobs.id)).toBe(false);
    expect(reactionsOf(storedDoc(), bobs.id)).toEqual([]);
    await rejectsWith(bob.deleteMessage(bobs.id), 'not_found');

    await b.signInWithGoogle();
    expect(reactionsOf(storedDoc(), mine.id)).toHaveLength(1);
    await b.deleteMessage(mine.id); // someone else's reaction on it goes too
    expect(reactionsOf(storedDoc(), mine.id)).toEqual([]);
    expect(await b.getMessages([bobs.id, mine.id])).toEqual([]);
  });

  it('reactions: several emoji per member, once each, idempotent, and only your own', async () => {
    const { b, hid, me } = await setup();
    const msg = await b.sendMessage(hid, 'The firepit has gone to its new home');
    const { bob, bobMe } = await joinBob(b, hid);

    await b.signInWithGoogle();
    later(1000);
    await b.setReaction(msg.id, '❤️', true);
    later(1000);
    await b.setReaction(msg.id, '❤️', true); // again: still one, first time kept
    later(1000);
    await b.setReaction(msg.id, '🎉', true);
    await bob.signInWithGoogle();
    later(1000);
    await bob.setReaction(msg.id, '❤️', true);

    let [got] = await bob.getMessages([msg.id]);
    expect(got.reactions).toEqual([
      { message_id: msg.id, member_id: me.id, emoji: '❤️', created_at: '2026-10-08T09:30:01.000Z' },
      { message_id: msg.id, member_id: me.id, emoji: '🎉', created_at: '2026-10-08T09:30:03.000Z' },
      { message_id: msg.id, member_id: bobMe.id, emoji: '❤️', created_at: '2026-10-08T09:30:04.000Z' },
    ]);

    // Removing touches only your own reaction.
    await bob.setReaction(msg.id, '❤️', false);
    await bob.setReaction(msg.id, '❤️', false); // already off
    await bob.setReaction(msg.id, '🎉', false); // Stratis's 🎉 stays
    [got] = await bob.getMessages([msg.id]);
    expect(got.reactions.map((r) => [r.member_id, r.emoji])).toEqual([
      [me.id, '❤️'],
      [me.id, '🎉'],
    ]);

    // message_reactions.emoji: one of REACTION_EMOJIS (message_reactions_emoji_allowed).
    for (const emoji of ['', '🦔'.repeat(17), '👨‍👩‍👧‍👦', '❤', 'pay rent 1234']) {
      await rejectsWithMessage(bob.setReaction(msg.id, emoji, true), /^invalid_input: emoji$/);
    }
    await bob.setReaction(msg.id, '🛠️', true); // two code points (U+FE0F)
    await rejectsWith(bob.setReaction('nope', '👍', true), 'not_found');
    await bob.setReaction('nope', '👍', false);

    const rows = reactionsOf(storedDoc(), msg.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.household_id === hid)).toBe(true);
    expect(rows.filter((r) => r.member_id === bobMe.id)).toHaveLength(1);
  });

  it('needs a signed-in user for every chat call', async () => {
    const { b, hid } = await setup();
    const msg = await b.sendMessage(hid, 'Hi');
    await b.signOut();
    await rejectsWith(b.listMessages(hid), 'not_signed_in');
    await rejectsWith(b.getMessages([msg.id]), 'not_signed_in');
    await rejectsWith(b.getMessages([]), 'not_signed_in');
    await rejectsWith(b.sendMessage(hid, 'Hi'), 'not_signed_in');
    await rejectsWith(b.sendMessage(hid, ''), 'not_signed_in');
    await rejectsWith(b.deleteMessage(msg.id), 'not_signed_in');
    await rejectsWith(b.setReaction(msg.id, '👍', true), 'not_signed_in');
    await rejectsWith(b.setReaction(msg.id, '👍', false), 'not_signed_in');
  });

  it('works with a document stored before chat existed', async () => {
    const { hid } = await setup();
    const doc = storedDoc();
    delete doc.messages;
    delete doc.message_reactions;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(doc));

    const b = make();
    expect(await b.load(hid)).toBeTruthy();
    expect(await b.listMessages(hid)).toEqual({ messages: [], hasMore: false });
    const msg = await b.sendMessage(hid, 'First!');
    await b.setReaction(msg.id, '🎉', true);
    expect((await b.listMessages(hid)).messages.map((m) => [m.body, m.reactions.length])).toEqual([['First!', 1]]);
    expect(storedDoc().version).toBe(1);
  });

  describe('subscribeChat', () => {
    it('reports every chat write made through this backend, and only real changes', async () => {
      const { b, hid } = await setup();
      const changes: ChatChange[] = [];
      const unsub = b.subscribeChat(hid, (c) => changes.push(c));
      const elsewhere = vi.fn();
      const unsubElsewhere = b.subscribeChat('another-household', elsewhere);

      const msg = await b.sendMessage(hid, 'Hi');
      await b.setReaction(msg.id, '👍', true);
      await b.setReaction(msg.id, '👍', true); // nothing changed
      await b.setReaction(msg.id, '👍', false);
      await b.setReaction(msg.id, '👍', false); // nothing changed
      await rejectsWith(b.sendMessage(hid, ' '), 'unknown'); // failed writes are silent
      await rejectsWith(b.setReaction('nope', '👍', true), 'not_found');
      await rejectsWith(b.deleteMessage('nope'), 'not_found');
      await b.deleteMessage(msg.id);
      expect(changes).toEqual([
        { type: 'message', messageId: msg.id, deleted: false },
        { type: 'reaction', messageId: msg.id },
        { type: 'reaction', messageId: msg.id },
        { type: 'message', messageId: msg.id, deleted: true },
      ]);
      expect(elsewhere).not.toHaveBeenCalled();

      unsub();
      unsubElsewhere();
      await b.sendMessage(hid, 'Anyone?');
      expect(changes).toHaveLength(4);
    });

    it('reports a send before its promise settles, with the message already readable', async () => {
      const { b, hid } = await setup();
      let settled = false;
      let readable: Promise<number> | null = null;
      b.subscribeChat(hid, (c) => {
        expect(settled).toBe(false);
        if (c.type === 'message') readable = b.getMessages([c.messageId]).then((m) => m.length);
      });
      await b.sendMessage(hid, 'Hi').then(() => (settled = true));
      expect(await readable).toBe(1);
    });

    it('keeps the write when a listener throws', async () => {
      const { b, hid } = await setup();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const after = vi.fn();
        b.subscribeChat(hid, () => {
          throw new Error('boom');
        });
        b.subscribeChat(hid, after);
        const msg = await b.sendMessage(hid, 'Still sent');
        expect(after).toHaveBeenCalledTimes(1);
        expect(errors).toHaveBeenCalledTimes(1);
        expect(await b.getMessages([msg.id])).toHaveLength(1);
      } finally {
        errors.mockRestore();
      }
    });

    it("resyncs when another tab changes this household's chat", async () => {
      const win = new EventTarget();
      vi.stubGlobal('window', win);
      const { b, hid } = await setup();
      const fire = (key: string | null) => win.dispatchEvent(Object.assign(new Event('storage'), { key }));
      const changes: ChatChange[] = [];
      const unsub = b.subscribeChat(hid, (c) => changes.push(c));
      const otherTab = make(); // same storage and session, as another tab has

      fire(DEMO_STORAGE_KEY); // the chat has not changed
      expect(changes).toEqual([]);

      const msg = await otherTab.sendMessage(hid, 'From the other tab');
      fire('something-else');
      expect(changes).toEqual([]);
      fire(DEMO_STORAGE_KEY);
      expect(changes).toEqual([{ type: 'resync' }]);
      fire(DEMO_STORAGE_KEY); // already seen
      expect(changes).toHaveLength(1);

      // Items edited elsewhere leave the chat alone.
      const data = await otherTab.load(hid);
      await otherTab.updateItem(data.items[0].id, { rag: 'red' });
      fire(DEMO_STORAGE_KEY);
      expect(changes).toHaveLength(1);

      await otherTab.setReaction(msg.id, '👍', true);
      fire(null); // storage cleared or replaced wholesale counts too
      expect(changes).toEqual([{ type: 'resync' }, { type: 'resync' }]);

      // This tab's own write reports itself once, not again as a resync.
      const mine = await b.sendMessage(hid, 'From this tab');
      fire(DEMO_STORAGE_KEY);
      expect(changes.slice(2)).toEqual([{ type: 'message', messageId: mine.id, deleted: false }]);

      unsub();
      await otherTab.sendMessage(hid, 'Unheard');
      fire(DEMO_STORAGE_KEY);
      expect(changes).toHaveLength(3);
    });

    it('is safe outside a browser', async () => {
      const { b, hid } = await setup();
      const unsub = b.subscribeChat(hid, () => {});
      expect(typeof unsub).toBe('function');
      unsub();
    });
  });
});
