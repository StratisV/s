import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEXT_LIMITS } from '../constants';
import type { ImportPayload } from '../types';
import {
  buildImportPayload,
  DEMO_DOC_KEY,
  demoHomeSummary,
  IMPORT_LIMITS,
  markDemoImported,
  readDemoDoc,
  type StoredDemoDoc,
} from './importHome';
import { USER_DEMO_DOC } from './importHome.fixture';

/** The payload the database tests import (supabase/tests/one_home.test.mjs). */
const PAYLOAD_FILE = new URL('../../../supabase/tests/fixtures/demo-import.json', import.meta.url);

class MemoryStorage {
  map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

function stored(doc: unknown): MemoryStorage {
  const s = new MemoryStorage();
  s.setItem(DEMO_DOC_KEY, JSON.stringify(doc));
  return s;
}

const userDoc = (): StoredDemoDoc => readDemoDoc(stored(USER_DEMO_DOC))!;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('readDemoDoc', () => {
  it('reads the stored demo document', () => {
    const doc = userDoc();
    expect(doc.session).toBe('demo-user-stratis');
    expect(doc.households).toHaveLength(1);
    expect(doc.members).toHaveLength(3);
    expect(doc.items).toHaveLength(20);
    expect(doc.imported).toBeUndefined();
  });

  it('is null for nothing stored, unreadable JSON, another version or a storage that throws', () => {
    expect(readDemoDoc(new MemoryStorage())).toBeNull();
    expect(readDemoDoc(null)).toBeNull();
    const bad = new MemoryStorage();
    bad.setItem(DEMO_DOC_KEY, '{nope');
    expect(readDemoDoc(bad)).toBeNull();
    expect(readDemoDoc(stored({ ...USER_DEMO_DOC, version: 2 }))).toBeNull();
    expect(
      readDemoDoc({
        getItem() {
          throw new Error('denied');
        },
      }),
    ).toBeNull();
  });

  it('drops rows without an id and treats missing lists as empty', () => {
    const doc = readDemoDoc(stored({ version: 1, session: null, members: [{ name: 'No id' }, 'x', null] }))!;
    expect(doc.members).toEqual([]);
    expect(doc.households).toEqual([]);
    expect(doc.items).toEqual([]);
  });
});

describe('buildImportPayload: the household’s own home', () => {
  const payload = buildImportPayload(userDoc())!;

  it('is the payload the database tests import', () => {
    if (process.env.UPDATE_IMPORT_FIXTURE) writeFileSync(PAYLOAD_FILE, `${JSON.stringify(payload, null, 2)}\n`);
    const file = JSON.parse(readFileSync(PAYLOAD_FILE, 'utf8')) as ImportPayload;
    expect(payload).toEqual(file);
  });

  it('brings the home with its name, address and time zone', () => {
    expect(payload.version).toBe(1);
    expect(payload.household).toEqual({ name: 'Our home', address: '21 Alderbrook Road', timezone: 'Europe/London' });
  });

  it('maps the phone’s own person to the Google account and everyone else as not joined, without emails', () => {
    expect(payload.people).toEqual([
      { key: 'p1', name: 'Stratis', emoji: '🦆', color: '#007AFF', me: true },
      { key: 'p2', name: 'Shea', emoji: '🦔', color: '#AF52DE' },
      { key: 'p3', name: 'Ela', emoji: '🦊', color: '#30B0C7' },
    ]);
    expect(JSON.stringify(payload)).not.toContain('@example.com');
  });

  it('keeps the areas in order', () => {
    expect(payload.areas.map((a) => [a.key, a.name])).toEqual([
      ['a1', 'Kitchen'],
      ['a2', 'Living Room'],
      ['a3', 'Bathroom Small'],
      ['a4', 'Garden'],
      ['a5', 'Garden Lounge'],
      ['a6', 'Jacuzzi'],
    ]);
  });

  it('brings every open and done item with all its fields and assignments', () => {
    expect(payload.items).toHaveLength(20);
    const byTitle = (area: string, title: string) => payload.items.find((i) => i.area === area && i.title === title)!;
    expect(byTitle('a2', 'Fix the cracks on the wall')).toEqual({
      key: 'i4',
      area: 'a2',
      kind: 'task',
      title: 'Fix the cracks on the wall',
      note: '',
      good: '',
      rag: 'red',
      due_date: '2026-10-16',
      repeat: 'none',
      notify: 'day_before',
      status: 'open',
      assignee: null,
      created_by: 'p1',
      updated_by: 'p1',
      created_at: '2026-10-08T09:17:00.000Z',
      updated_at: '2026-10-08T09:17:00.000Z',
      completed_at: null,
    });
    expect(byTitle('a1', 'Tidiness')).toMatchObject({
      kind: 'state',
      assignee: 'p2',
      note: 'Restocked, 5L tin is in the pantry.',
      due_date: null,
      repeat: 'none',
      notify: 'none',
      updated_at: '2026-10-09T07:45:00.000Z',
    });
    expect(byTitle('a4', 'Plants healthy').good).toBe('Watered twice a week, no yellow leaves, pots drained.');
    expect(byTitle('a6', 'Change the filter')).toMatchObject({ repeat: 'monthly', due_date: '2026-10-21', assignee: 'p2' });
    expect(byTitle('a6', 'Order water test strips')).toMatchObject({
      status: 'done',
      completed_at: '2026-10-08T17:05:00.000Z',
    });
  });

  it('brings the Stats history, linked to the items that still exist', () => {
    expect(payload.completions).toHaveLength(7);
    expect(payload.completions[0]).toEqual({
      item: null,
      item_title: 'Clean the oven',
      credited_to: 'p3',
      completed_by: 'p3',
      completed_at: '2026-08-03T10:17:00.000Z',
      prev_due_date: null,
      prev_status: 'open',
    });
    const strips = payload.completions.find((c) => c.item_title === 'Order water test strips')!;
    expect(strips).toMatchObject({ item: 'i20', credited_to: 'p2', completed_by: 'p2', prev_due_date: '2026-10-08' });
    const filter = payload.completions.find((c) => c.item_title === 'Change the filter')!;
    expect(filter).toMatchObject({ item: 'i19', credited_to: 'p2', completed_by: 'p1', prev_due_date: '2026-09-21' });
  });

  it('leaves the chat behind', () => {
    expect(Object.keys(payload).sort()).toEqual(['areas', 'completions', 'household', 'items', 'people', 'version']);
  });
});

describe('buildImportPayload: who is me', () => {
  it('without a session, the earliest owner', () => {
    const doc = userDoc();
    doc.session = null;
    expect(buildImportPayload(doc)!.people.find((p) => p.me)!.name).toBe('Stratis');
  });

  it('with a session that has no person (signed out, someone else signed in), the earliest owner', () => {
    const doc = userDoc();
    doc.session = 'demo-user-someone';
    expect(buildImportPayload(doc)!.people.filter((p) => p.me)).toHaveLength(1);
  });

  it('with no owner, the earliest person', () => {
    const doc = userDoc();
    doc.session = null;
    for (const m of doc.members) m.role = 'member';
    expect(buildImportPayload(doc)!.people[0]).toMatchObject({ name: 'Stratis', me: true });
  });

  it('only the signed-in person’s home comes along', () => {
    type Rows = Record<string, unknown>[];
    const raw = clone(USER_DEMO_DOC) as unknown as { households: Rows; members: Rows; areas: Rows };
    raw.households.push({ ...raw.households[0], id: 'hh-other', name: 'Other' });
    raw.members.push({ ...raw.members[1], id: 'm-other', household_id: 'hh-other', role: 'owner' });
    raw.areas.push({ ...raw.areas[0], id: 'a-other', household_id: 'hh-other' });
    const payload = buildImportPayload(readDemoDoc(stored(raw))!)!;
    expect(payload.household.name).toBe('Our home');
    expect(payload.people).toHaveLength(3);
    expect(payload.areas).toHaveLength(6);
  });

  it('is null without a home', () => {
    expect(buildImportPayload(readDemoDoc(stored({ version: 1, session: null }))!)).toBeNull();
    const noPeople = userDoc();
    noPeople.members = [];
    expect(buildImportPayload(noPeople)).toBeNull();
  });
});

describe('buildImportPayload: anything the database would refuse is repaired or left out', () => {
  it('cuts text to the limits and fills blanks', () => {
    const doc = userDoc();
    doc.households[0].name = `  ${'h'.repeat(80)}  `;
    doc.households[0].address = 'a'.repeat(200);
    doc.members[1].name = '   ';
    doc.members[1].emoji = '';
    doc.members[2].emoji = '🦊'.repeat(17);
    doc.members[2].color = 'blue';
    doc.areas[0].name = 'k'.repeat(61);
    doc.items[3].title = `  ${'t'.repeat(201)}`;
    doc.items[3].note = 'n'.repeat(4001);
    doc.items[3].good = 'g'.repeat(4001);
    const p = buildImportPayload(doc)!;
    expect(Array.from(p.household.name)).toHaveLength(TEXT_LIMITS.householdName);
    expect(Array.from(p.household.address)).toHaveLength(TEXT_LIMITS.address);
    expect(p.people[1]).toEqual({ key: 'p2', name: 'Someone', emoji: '🦔', color: '#AF52DE' });
    expect(p.people[2]).toEqual({ key: 'p3', name: 'Ela', emoji: '🦔' });
    expect(Array.from(p.areas[0].name)).toHaveLength(TEXT_LIMITS.areaName);
    expect(Array.from(p.items[3].title)).toHaveLength(TEXT_LIMITS.itemTitle);
    expect(Array.from(p.items[3].note)).toHaveLength(TEXT_LIMITS.itemNote);
    expect(Array.from(p.items[3].good)).toHaveLength(TEXT_LIMITS.itemGood);
  });

  it('repairs unknown values and drops what cannot be imported', () => {
    const doc = userDoc();
    doc.items[0].kind = undefined; // stored before kinds existed: a task
    doc.items[3].rag = 'purple';
    doc.items[3].due_date = '2026-02-30';
    doc.items[3].repeat = 'daily';
    doc.items[3].notify = 'loudly';
    doc.items[3].created_at = 'yesterday';
    doc.items[3].assignee_id = 'm-gone';
    doc.items[4].title = '   ';
    doc.items[5].status = 'done'; // a state is never done
    doc.items[6].area_id = 'a-gone';
    doc.completions[0].completed_at = 'soon';
    doc.completions[1].item_title = '';
    doc.completions[2].item_id = 'i-gone';
    doc.completions[2].credited_to = 'm-gone';
    const p = buildImportPayload(doc)!;
    expect(p.items).toHaveLength(17);
    expect(p.items[0]).toMatchObject({ title: 'Rubbish fill level', kind: 'task' });
    expect(p.items.find((i) => i.title === 'Fix the cracks on the wall')).toMatchObject({
      rag: 'amber',
      due_date: null,
      repeat: 'none',
      notify: 'day_before',
      created_at: null,
      assignee: null,
    });
    expect(p.items.some((i) => i.title === 'Remove AC' || i.title === 'Hand towels solution')).toBe(false);
    expect(p.completions).toHaveLength(5);
    const oven = p.completions.find((c) => c.item_title === 'Clean the oven')!;
    expect(oven).toMatchObject({ item: null, credited_to: null });
  });

  it('never sends more than the database takes', () => {
    const doc = userDoc();
    doc.completions = Array.from({ length: IMPORT_LIMITS.completions + 5 }, (_, i) => ({
      ...doc.completions[2],
      id: `c-${i}`,
      completed_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
    }));
    const p = buildImportPayload(doc)!;
    expect(p.completions).toHaveLength(IMPORT_LIMITS.completions);
    expect(p.completions[0].completed_at).toBe(new Date(Date.UTC(2026, 0, 1) + 5 * 60_000).toISOString());
  });
});

describe('demoHomeSummary and markDemoImported', () => {
  it('summarises the home for the offer', () => {
    expect(demoHomeSummary(userDoc())).toEqual({
      householdName: 'Our home',
      address: '21 Alderbrook Road',
      areas: 6,
      items: 19,
      people: [
        { name: 'Stratis', emoji: '🦆', me: true },
        { name: 'Shea', emoji: '🦔', me: false },
        { name: 'Ela', emoji: '🦊', me: false },
      ],
    });
  });

  it('is null without a document or a home', () => {
    expect(demoHomeSummary(null)).toBeNull();
    expect(demoHomeSummary(readDemoDoc(stored({ version: 1, session: null })))).toBeNull();
  });

  it('marks the document imported, keeps everything else, and the offer does not come back', () => {
    const storage = stored(USER_DEMO_DOC);
    markDemoImported(storage, { at: '2026-10-09T20:00:00.000Z', household_id: 'h-real' });
    const raw = JSON.parse(storage.getItem(DEMO_DOC_KEY)!);
    expect(raw.imported).toEqual({ at: '2026-10-09T20:00:00.000Z', household_id: 'h-real' });
    expect({ ...raw, imported: undefined }).toEqual({ ...USER_DEMO_DOC, imported: undefined });
    const doc = readDemoDoc(storage)!;
    expect(doc.imported).toEqual({ at: '2026-10-09T20:00:00.000Z', household_id: 'h-real' });
    expect(demoHomeSummary(doc)).toBeNull();
  });

  it('leaves a missing or unwritable document alone', () => {
    const empty = new MemoryStorage();
    markDemoImported(empty, { at: 'x', household_id: 'h' });
    expect(empty.getItem(DEMO_DOC_KEY)).toBeNull();
    expect(() =>
      markDemoImported(
        {
          getItem: () => JSON.stringify(USER_DEMO_DOC),
          setItem() {
            throw new Error('full');
          },
        },
        { at: 'x', household_id: 'h' },
      ),
    ).not.toThrow();
  });
});
