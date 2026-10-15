import { describe, expect, it } from 'vitest';
import { DEMO_STORAGE_KEY, DemoBackend, emptyDoc, type DemoDoc, type StorageLike } from '../backend/demo';
import { HOUSEKEEPING_STARTER_TASKS } from '../constants';
import { demoCreatedDoc, USER_DEMO_DOC } from './importHome.fixture';
import { buildServerHome, serverSetupSummary } from './serverImport';

const NOW = new Date('2026-10-09T11:00:00.000Z');

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

function build(doc: unknown, now = NOW) {
  return buildServerHome(JSON.stringify(doc), { now, ownerUserId: 'u-owner', newId: ids() });
}

class MapStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

/** The server's home as the owner sees it through DemoBackend (what the app will load). */
async function loadAsOwner(home: DemoDoc, householdId: string, now = NOW) {
  const storage = new MapStorage();
  const user = { id: 'u-owner', email: '', name: 'Stratis' };
  storage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ ...home, session: user.id, users: [user] }));
  const backend = new DemoBackend({ storage, user, now: () => now, search: '', latency: 0 });
  return { backend, data: await backend.load(householdId), chat: await backend.listMessages(householdId) };
}

describe("buildServerHome: the user's home", () => {
  it('brings Stratis as the owner and Shea, with her items, as not joined yet; Ela stays behind', () => {
    const built = build(USER_DEMO_DOC)!;
    const { home } = built;
    expect(home.members.map((m) => ({ name: m.name, emoji: m.emoji, user_id: m.user_id, role: m.role, email: m.email }))).toEqual([
      { name: 'Stratis', emoji: '🦆', user_id: 'u-owner', role: 'owner', email: '' },
      { name: 'Shea', emoji: '🦔', user_id: null, role: 'member', email: '' },
    ]);
    const shea = home.members[1];
    expect(home.items.filter((i) => i.assignee_id === shea.id).map((i) => i.title).sort()).toEqual(
      ['Change the filter', 'Check Chemicals', 'Order water test strips', 'Rubbish fill level', 'Tidiness', 'Tidiness'].sort(),
    );
    expect(built.ownerMemberId).toBe(home.members[0].id);
    expect(home.members.every((m) => m.push_enabled === false && m.weekly_email === true && !m.claimed_at)).toBe(true);
  });

  it('keeps the household, the areas in order, and every item with all its fields', () => {
    const { home } = build(USER_DEMO_DOC)!;
    expect(home.households).toEqual([
      expect.objectContaining({ name: 'Our home', address: '21 Alderbrook Road', timezone: 'Europe/London', weekly_email_day: 1, weekly_email_time: '08:00', updated_by: null }),
    ]);
    expect(home.areas.map((a) => [a.name, a.position])).toEqual([
      ['Kitchen', 0],
      ['Living Room', 1],
      ['Bathroom Small', 2],
      ['Garden', 3],
      ['Garden Lounge', 4],
      ['Jacuzzi', 5],
    ]);
    expect(home.items).toHaveLength(20);
    const filter = home.items.find((i) => i.title === 'Change the filter')!;
    expect(filter).toMatchObject({
      kind: 'task',
      rag: 'green',
      due_date: '2026-10-21',
      repeat: 'monthly',
      notify: 'day_before',
      status: 'open',
      created_at: '2026-10-08T09:32:00.000Z',
      updated_at: '2026-10-09T08:30:00.000Z',
      area_id: home.areas[5].id,
    });
    const plants = home.items.find((i) => i.title === 'Plants healthy')!;
    expect(plants).toMatchObject({ kind: 'state', good: 'Watered twice a week, no yellow leaves, pots drained.', due_date: null, repeat: 'none', notify: 'none' });
    const strips = home.items.find((i) => i.title === 'Order water test strips')!;
    expect(strips).toMatchObject({ status: 'done', completed_at: '2026-10-08T17:05:00.000Z' });
  });

  it('keeps the real Stats history, linked to the new items, and leaves the made-up history behind', () => {
    const { home } = build(USER_DEMO_DOC)!;
    expect(home.completions.map((c) => c.item_title).sort()).toEqual(['Change the filter', 'Fix the doorbell', 'Order water test strips']);
    const filter = home.items.find((i) => i.title === 'Change the filter')!;
    expect(home.completions.find((c) => c.item_title === 'Change the filter')).toMatchObject({
      item_id: filter.id,
      credited_to: home.members[1].id,
      completed_by: home.members[0].id,
      prev_due_date: '2026-09-21',
    });
    expect(home.completions.find((c) => c.item_title === 'Fix the doorbell')!.item_id).toBeNull();
  });

  it('leaves the made-up chat behind and gives the starter task list to a home from before housekeeping', () => {
    const { home, summary } = build(USER_DEMO_DOC)!;
    expect(home.messages).toEqual([]);
    expect(home.housekeeping_tasks.map((t) => [t.title, t.position])).toEqual(HOUSEKEEPING_STARTER_TASKS.map((t, i) => [t, i]));
    expect(home.housekeeping_notes).toEqual([]);
    expect(home.housekeeping_visits).toEqual([]);
    expect(summary).toEqual({
      householdName: 'Our home',
      address: '21 Alderbrook Road',
      areas: 6,
      items: 19,
      done: 3,
      people: [
        { name: 'Stratis', emoji: '🦆', me: true },
        { name: 'Shea', emoji: '🦔', me: false },
      ],
      messages: 0,
      visits: 0,
      // The newest change on the phone (an item edited that morning), so an older copy shows its age.
      lastChanged: '2026-10-09T08:30:00.000Z',
    });
  });

  it('is a home DemoBackend reads as it is, at rest, with fresh ids', async () => {
    const built = build(USER_DEMO_DOC)!;
    const { home } = built;
    expect(home.session).toBeNull();
    expect(home.users).toEqual([]);
    expect(home.invites).toEqual([]);
    expect(home.push_subs).toEqual([]);
    // Key order as DemoBackend writes it, so the first write stores only what changed.
    expect(Object.keys(home)).toEqual(Object.keys(emptyDoc()));
    const raw = JSON.stringify(USER_DEMO_DOC);
    for (const row of [...home.members, ...home.areas, ...home.items, ...home.completions]) expect(raw).not.toContain(`"${row.id}"`);
    const { data } = await loadAsOwner(home, built.householdId);
    expect(data.items).toHaveLength(19);
    expect(data.members.map((m) => m.name)).toEqual(['Stratis', 'Shea']);
  });

  it('is the same for the same input (fresh ids from newId)', () => {
    expect(JSON.stringify(build(USER_DEMO_DOC))).toBe(JSON.stringify(build(USER_DEMO_DOC)));
  });
});

describe('buildServerHome: a home the demo set up, then used', () => {
  it('brings the one thing really done, and none of the made-up history, chat or visits', async () => {
    const doc = await demoCreatedDoc();
    const built = build(doc, new Date('2026-10-09T12:00:00.000Z'))!;
    expect(built.home.completions).toHaveLength(1);
    expect(built.home.messages).toEqual([]);
    expect(built.home.housekeeping_visits).toEqual([]);
    expect(built.home.housekeeping_notes).toEqual([]);
    expect(built.home.housekeeping_tasks.map((t) => t.title)).toEqual([...HOUSEKEEPING_STARTER_TASKS]);
    // The demo's list assigns items to both made-up housemates, so both come along with them.
    expect(built.summary.people.map((p) => p.name)).toEqual(['Stratis', 'Shea', 'Ela']);
    expect(built.home.members.filter((m) => m.user_id === null).map((m) => m.name)).toEqual(['Shea', 'Ela']);
  });

  it('brings the chat and housekeeping the household wrote after set-up', async () => {
    const storage = new MapStorage();
    let now = new Date('2026-10-08T09:12:00.000Z');
    const demo = new DemoBackend({ storage, now: () => now, search: '', latency: 0 });
    await demo.signInWithGoogle();
    const hid = await demo.createHousehold({
      name: 'Our home',
      address: '',
      timezone: 'Europe/London',
      memberName: 'Stratis',
      memberEmoji: '🦆',
      areas: ['Kitchen'],
      items: [],
    });
    now = new Date('2026-10-09T08:00:00.000Z');
    const sent = await demo.sendMessage(hid, '  Bins go out tonight  ');
    await demo.setReaction(sent.id, '👍', true);
    await demo.setHousekeepingNote(hid, 'Windows, please');
    const tasks = (await demo.load(hid)).housekeeping.tasks;
    await demo.setHousekeepingTaskDone(hid, '2026-10-09', { taskId: tasks[0].id }, true);
    await demo.saveHousekeepingVisit(hid, '2026-10-09', { comments: 'All good', price_pence: 4500 });
    await demo.renameHousekeepingTask(tasks[1].id, 'Hoover the stairs');

    const raw = storage.getItem(DEMO_STORAGE_KEY)!;
    const built = buildServerHome(raw, { now, ownerUserId: 'u-owner', newId: ids() })!;
    const { home, summary } = built;
    const owner = home.members.find((m) => m.user_id === 'u-owner')!;
    expect(home.messages.map((m) => [m.body, m.member_id])).toEqual([['Bins go out tonight', owner.id]]);
    expect(home.message_reactions).toEqual([
      expect.objectContaining({ message_id: home.messages[0].id, member_id: owner.id, emoji: '👍', household_id: built.householdId }),
    ]);
    expect(home.housekeeping_notes).toEqual([
      expect.objectContaining({ body: 'Windows, please', updated_by: owner.id, cleared_body: null }),
    ]);
    expect(home.housekeeping_tasks[1].title).toBe('Hoover the stairs');
    expect(home.housekeeping_visits).toEqual([expect.objectContaining({ visit_date: '2026-10-09', comments: 'All good', price_pence: 4500 })]);
    const rows = home.housekeeping_visit_tasks;
    expect(rows.filter((r) => r.done)).toEqual([expect.objectContaining({ task_id: home.housekeeping_tasks[0].id, done_by: owner.id })]);
    expect(rows.every((r) => r.visit_id === home.housekeeping_visits[0].id)).toBe(true);
    // The made-up housemates stay behind: nothing that came along is theirs.
    expect(home.members.map((m) => m.name)).toEqual(['Stratis']);
    expect(summary).toMatchObject({ messages: 1, visits: 1, people: [{ name: 'Stratis', me: true }] });

    // And it all reads back through DemoBackend.
    const { data, chat } = await loadAsOwner(home, built.householdId, now);
    expect(chat.messages.map((m) => [m.body, m.reactions.length])).toEqual([['Bins go out tonight', 1]]);
    expect(data.housekeeping.visits[0].tasks.filter((t) => t.done)).toHaveLength(1);
    expect(data.housekeeping.note.body).toBe('Windows, please');
  });

  it('brings the task list’s sections: each task in its section, visits keeping theirs by name', async () => {
    const storage = new MapStorage();
    let now = new Date('2026-10-08T09:12:00.000Z');
    const demo = new DemoBackend({ storage, now: () => now, search: '', latency: 0 });
    await demo.signInWithGoogle();
    const hid = await demo.createHousehold({
      name: 'Our home',
      address: '',
      timezone: 'Europe/London',
      memberName: 'Stratis',
      memberEmoji: '🦆',
      areas: ['Kitchen'],
      items: [],
    });
    now = new Date('2026-10-09T08:00:00.000Z');
    const ids0 = (await demo.load(hid)).housekeeping.tasks.map((t) => t.id);
    const kitchen = await demo.createHousekeepingSection(hid, 'Kitchen');
    const baths = await demo.createHousekeepingSection(hid, 'Bathrooms');
    await demo.arrangeHousekeepingTasks(hid, [
      { sectionId: null, taskIds: [ids0[0], ids0[1], ids0[4], ids0[6]] },
      { sectionId: kitchen.id, taskIds: [ids0[3], ids0[5]] },
      { sectionId: baths.id, taskIds: [ids0[2]] },
    ]);
    await demo.setHousekeepingTaskDone(hid, '2026-10-09', { taskId: ids0[3] }, true);
    // A section deleted after the visit: the visit keeps it by its name.
    await demo.addHousekeepingVisit(hid, '2026-10-08');
    await demo.deleteHousekeepingSection(baths.id);

    const raw = storage.getItem(DEMO_STORAGE_KEY)!;
    const built = buildServerHome(raw, { now, ownerUserId: 'u-owner', newId: ids() })!;
    const { home } = built;
    expect(home.housekeeping_sections.map((s) => [s.title, s.position])).toEqual([['Kitchen', 0]]);
    const newKitchen = home.housekeeping_sections[0].id;
    expect(newKitchen).not.toBe(kitchen.id);
    expect(home.housekeeping_tasks.map((t) => [t.title, t.section_id, t.position])).toEqual([
      ['Change the bed sheets', null, 0],
      ['Hoover and mop the floors', null, 1],
      ['Dust the surfaces', null, 2],
      ['Ironing', null, 3],
      ['Clean the bathrooms', null, 4],
      ['Clean the kitchen', newKitchen, 0],
      ['Empty the bins', newKitchen, 1],
    ]);
    const { data } = await loadAsOwner(home, built.householdId, now);
    const day = (date: string) => data.housekeeping.visits.find((v) => v.visit_date === date)!;
    expect(day('2026-10-09').tasks.filter((r) => r.section_title === 'Kitchen').map((r) => [r.title, r.section_id, r.done])).toEqual([
      ['Clean the kitchen', newKitchen, true],
      ['Empty the bins', newKitchen, false],
    ]);
    expect(day('2026-10-08').tasks.find((r) => r.title === 'Clean the bathrooms')).toMatchObject({ section_id: null, section_title: 'Bathrooms' });
    expect(data.housekeeping.sections.map((s) => s.title)).toEqual(['Kitchen']);
  });

  it('brings at most 30 sections, leaves blank ones out, and none from a home from before sections', () => {
    const doc = structuredClone(USER_DEMO_DOC) as unknown as Record<string, unknown>;
    const at = '2026-10-09T08:00:00.000Z';
    doc.housekeeping_sections = [
      { id: 's-blank', household_id: 'hh-our-home', title: '   ', position: 0, created_at: at },
      ...Array.from({ length: 31 }, (_, i) => ({ id: `s-${i}`, household_id: 'hh-our-home', title: ` Room ${i} `, position: i + 1, created_at: at })),
      { id: 's-other', household_id: 'elsewhere', title: 'Not ours', position: 0, created_at: at },
    ];
    const { home } = build(doc)!;
    expect(home.housekeeping_sections.map((s) => s.title)).toEqual(Array.from({ length: 30 }, (_, i) => `Room ${i}`));
    expect(build(USER_DEMO_DOC)!.home.housekeeping_sections).toEqual([]);
  });

  it('brings a made-up housemate along when the household used them', async () => {
    const doc = structuredClone(USER_DEMO_DOC) as typeof USER_DEMO_DOC & { message_reactions: unknown[] };
    doc.messages.push({ id: 'msg-2', household_id: 'hh-our-home', member_id: 'm-stratis', body: 'Ela, the firepit?', created_at: '2026-10-09T07:00:00.000Z' });
    doc.message_reactions.push({ message_id: 'msg-2', member_id: 'm-ela', household_id: 'hh-our-home', emoji: '👍', created_at: '2026-10-09T07:01:00.000Z' });
    const { home } = build(doc)!;
    expect(home.members.map((m) => m.name)).toEqual(['Stratis', 'Shea', 'Ela']);
    expect(home.messages.map((m) => m.body)).toEqual(['Ela, the firepit?']);
  });
});

describe('buildServerHome: anything at all', () => {
  it('gives null for a document with no home, and never throws', () => {
    for (const raw of ['', 'null', '[]', 'not json', '{"version":2}', '{"version":1}', JSON.stringify({ version: 1, households: [{ id: 'h' }], members: [] })]) {
      expect(buildServerHome(raw, { now: NOW, ownerUserId: 'u' })).toBeNull();
    }
    expect(buildServerHome(undefined as unknown as string, { now: NOW, ownerUserId: 'u' })).toBeNull();
  });

  it('repairs what it can: an unknown zone, junk rows, times from the future', () => {
    const doc = structuredClone(USER_DEMO_DOC) as unknown as Record<string, unknown[]> & { households: Record<string, unknown>[] };
    doc.households[0].timezone = 'Mars/Olympus';
    doc.items.push(null as never, 'x' as never);
    (doc.items[0] as Record<string, unknown>).updated_at = '2030-01-01T00:00:00.000Z';
    doc.messages = [{ id: 'm', household_id: 'hh-our-home', member_id: 'm-shea', body: 'From the future', created_at: '2030-01-01T00:00:00.000Z' }];
    const { home } = build(doc)!;
    expect(home.households[0].timezone).toBe('Europe/London');
    expect(home.items).toHaveLength(20);
    expect(home.items.find((i) => i.title === 'Rubbish fill level')!.updated_at).toBe(NOW.toISOString());
    expect(home.messages).toEqual([]);
  });
});

describe('serverSetupSummary', () => {
  it('summarises what comes along, whatever the marks, and null when there is nothing', () => {
    expect(serverSetupSummary(JSON.stringify(USER_DEMO_DOC), NOW)).toMatchObject({ householdName: 'Our home', areas: 6, items: 19, done: 3 });
    const imported = { ...USER_DEMO_DOC, imported: { at: NOW.toISOString(), household_id: 'x' }, declined: { at: NOW.toISOString() } };
    expect(serverSetupSummary(JSON.stringify(imported), NOW)).not.toBeNull();
    expect(serverSetupSummary(null)).toBeNull();
    expect(serverSetupSummary('{}')).toBeNull();
  });
});
