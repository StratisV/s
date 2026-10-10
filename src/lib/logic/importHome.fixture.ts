// The home a household set up on one phone in demo mode, as that phone stores it
// (localStorage homeos.demo.v1, the shape lib/backend/demo.ts writes): the realistic fixture
// for "Bring over the home from this phone". Stratis signed in on this phone (the demo
// account) and set his emoji to the duck; Shea took the hedgehog; Ela is the demo's third
// person. Today is Fri 9 Oct 2026; most tasks are due Fri 16 Oct. Its Stats history holds
// three real completions and some of the demo's made-up history (which stays behind).
// DEMO_CREATED_DOC below is a home as the demo itself sets one up, history and all.
//
// supabase/tests/fixtures/demo-import.json is buildImportPayload() of this document
// (importHome.test.ts checks they agree), and the database tests import that payload.

import { DEMO_STORAGE_KEY, DemoBackend } from '../backend/demo';
import { DEFAULT_AREAS } from '../constants';
import { seedItemsFor } from './items';

const HOUSEHOLD = 'hh-our-home';
const STRATIS = 'm-stratis';
const SHEA = 'm-shea';
const ELA = 'm-ela';

const AREAS = {
  kitchen: 'a-kitchen',
  living: 'a-living-room',
  bathroom: 'a-bathroom-small',
  garden: 'a-garden',
  lounge: 'a-garden-lounge',
  jacuzzi: 'a-jacuzzi',
} as const;

type Who = typeof STRATIS | typeof SHEA | typeof ELA | null;

let seq = 0;
/** A stored item: everything the demo backend keeps for one, in the order it was created. */
function item(
  area: string,
  fields: {
    kind: 'task' | 'state';
    title: string;
    rag: 'red' | 'amber' | 'green';
    assignee: Who;
    note?: string;
    good?: string;
    due?: string | null;
    repeat?: 'none' | 'monthly';
    status?: 'open' | 'done';
    updated?: string;
    completed?: string | null;
  },
) {
  seq += 1;
  const created = `2026-10-08T09:${String(13 + seq).padStart(2, '0')}:00.000Z`;
  const state = fields.kind === 'state';
  return {
    id: `i-${String(seq).padStart(2, '0')}`,
    household_id: HOUSEHOLD,
    area_id: area,
    kind: fields.kind,
    title: fields.title,
    note: fields.note ?? '',
    good: fields.good ?? '',
    rag: fields.rag,
    due_date: state ? null : (fields.due ?? null),
    assignee_id: fields.assignee,
    repeat: state ? 'none' : (fields.repeat ?? 'none'),
    notify: state ? 'none' : 'day_before',
    status: fields.status ?? 'open',
    created_by: STRATIS,
    updated_by: STRATIS,
    created_at: created,
    updated_at: fields.updated ?? created,
    completed_at: fields.completed ?? null,
  };
}

const FRI_16 = '2026-10-16';

export const USER_DEMO_DOC = {
  version: 1,
  session: 'demo-user-stratis',
  users: [{ id: 'demo-user-stratis', email: 'stratis@example.com', name: 'Stratis' }],
  households: [
    {
      id: HOUSEHOLD,
      name: 'Our home',
      address: '21 Alderbrook Road',
      timezone: 'Europe/London',
      weekly_email_day: 1,
      weekly_email_time: '08:00',
      created_at: '2026-10-08T09:12:00.000Z',
      updated_at: '2026-10-08T09:12:00.000Z',
      updated_by: null,
    },
  ],
  members: [
    {
      id: STRATIS,
      household_id: HOUSEHOLD,
      user_id: 'demo-user-stratis',
      name: 'Stratis',
      email: 'stratis@example.com',
      emoji: '🦆',
      color: '#007AFF',
      role: 'owner',
      weekly_email: true,
      push_enabled: false,
      created_at: '2026-10-08T09:12:00.000Z',
    },
    {
      id: SHEA,
      household_id: HOUSEHOLD,
      user_id: 'demo-user-shea-hhourhom',
      name: 'Shea',
      email: 'shea@example.com',
      emoji: '🦔',
      color: '#AF52DE',
      role: 'member',
      weekly_email: true,
      push_enabled: false,
      created_at: '2026-10-08T09:12:00.001Z',
    },
    {
      id: ELA,
      household_id: HOUSEHOLD,
      user_id: 'demo-user-ela-hhourhom',
      name: 'Ela',
      email: 'ela@example.com',
      emoji: '🦊',
      color: '#30B0C7',
      role: 'member',
      weekly_email: true,
      push_enabled: false,
      created_at: '2026-10-08T09:12:00.002Z',
    },
  ],
  areas: [
    { id: AREAS.kitchen, household_id: HOUSEHOLD, name: 'Kitchen', position: 0, created_at: '2026-10-08T09:12:00.000Z' },
    { id: AREAS.living, household_id: HOUSEHOLD, name: 'Living Room', position: 1, created_at: '2026-10-08T09:12:00.001Z' },
    { id: AREAS.bathroom, household_id: HOUSEHOLD, name: 'Bathroom Small', position: 2, created_at: '2026-10-08T09:12:00.002Z' },
    { id: AREAS.garden, household_id: HOUSEHOLD, name: 'Garden', position: 3, created_at: '2026-10-08T09:12:00.003Z' },
    { id: AREAS.lounge, household_id: HOUSEHOLD, name: 'Garden Lounge', position: 4, created_at: '2026-10-08T09:12:00.004Z' },
    { id: AREAS.jacuzzi, household_id: HOUSEHOLD, name: 'Jacuzzi', position: 5, created_at: '2026-10-08T09:12:00.005Z' },
  ],
  items: [
    item(AREAS.kitchen, { kind: 'state', title: 'Rubbish fill level', rag: 'green', assignee: SHEA }),
    item(AREAS.kitchen, {
      kind: 'state',
      title: 'Shared supplies',
      rag: 'green',
      assignee: STRATIS,
      note: 'Restocked.',
      updated: '2026-10-09T07:40:00.000Z',
    }),
    item(AREAS.kitchen, {
      kind: 'state',
      title: 'Tidiness',
      rag: 'green',
      assignee: SHEA,
      note: 'Restocked, 5L tin is in the pantry.',
      updated: '2026-10-09T07:45:00.000Z',
    }),
    item(AREAS.living, { kind: 'task', title: 'Fix the cracks on the wall', rag: 'red', assignee: null, due: FRI_16 }),
    item(AREAS.living, { kind: 'task', title: 'Remove AC', rag: 'amber', assignee: null, due: FRI_16 }),
    item(AREAS.living, { kind: 'state', title: 'Tidiness', rag: 'green', assignee: STRATIS }),
    item(AREAS.bathroom, { kind: 'task', title: 'Hand towels solution', rag: 'red', assignee: null, due: FRI_16 }),
    item(AREAS.bathroom, { kind: 'state', title: 'Tidiness', rag: 'green', assignee: SHEA }),
    item(AREAS.garden, { kind: 'task', title: 'Install leaf blower', rag: 'amber', assignee: STRATIS, due: FRI_16 }),
    item(AREAS.garden, { kind: 'state', title: 'Clean surfaces', rag: 'green', assignee: STRATIS }),
    item(AREAS.garden, { kind: 'state', title: 'Leaves', rag: 'green', assignee: STRATIS }),
    item(AREAS.garden, {
      kind: 'state',
      title: 'Plants healthy',
      rag: 'green',
      assignee: STRATIS,
      good: 'Watered twice a week, no yellow leaves, pots drained.',
    }),
    item(AREAS.garden, { kind: 'state', title: 'Weeds', rag: 'green', assignee: STRATIS }),
    item(AREAS.lounge, { kind: 'task', title: 'More long term AC hole solution', rag: 'amber', assignee: STRATIS, due: FRI_16 }),
    item(AREAS.lounge, { kind: 'state', title: 'Decking cleanness', rag: 'green', assignee: STRATIS }),
    item(AREAS.lounge, { kind: 'state', title: 'Rubbish', rag: 'green', assignee: STRATIS }),
    item(AREAS.lounge, { kind: 'state', title: 'Tidiness', rag: 'green', assignee: STRATIS }),
    item(AREAS.jacuzzi, {
      kind: 'task',
      title: 'Check Chemicals',
      rag: 'green',
      assignee: SHEA,
      due: '2026-10-20',
      note: 'Order a new pack.',
    }),
    item(AREAS.jacuzzi, {
      kind: 'task',
      title: 'Change the filter',
      rag: 'green',
      assignee: SHEA,
      due: '2026-10-21',
      repeat: 'monthly',
      updated: '2026-10-09T08:30:00.000Z',
    }),
    // Done yesterday: no longer on Home, but it comes along with its completion.
    item(AREAS.jacuzzi, {
      kind: 'task',
      title: 'Order water test strips',
      rag: 'amber',
      assignee: SHEA,
      due: '2026-10-08',
      status: 'done',
      updated: '2026-10-08T17:05:00.000Z',
      completed: '2026-10-08T17:05:00.000Z',
    }),
  ],
  completions: [
    {
      id: 'c-done-strips',
      household_id: HOUSEHOLD,
      item_id: 'i-20',
      item_title: 'Order water test strips',
      credited_to: SHEA,
      completed_by: SHEA,
      completed_at: '2026-10-08T17:05:00.000Z',
      prev_due_date: '2026-10-08',
      prev_status: 'open',
    },
    {
      id: 'c-filter',
      household_id: HOUSEHOLD,
      item_id: 'i-19',
      item_title: 'Change the filter',
      credited_to: SHEA,
      completed_by: STRATIS,
      completed_at: '2026-10-09T08:30:00.000Z',
      prev_due_date: '2026-09-21',
      prev_status: 'open',
    },
    // Done, and the item deleted afterwards: real history, not linked to an item any more.
    { id: 'c-gone', household_id: HOUSEHOLD, item_id: null, item_title: 'Fix the doorbell', credited_to: STRATIS, completed_by: STRATIS, completed_at: '2026-10-09T07:40:00.000Z', prev_due_date: '2026-10-09', prev_status: 'open' },
    // The made-up history the demo adds to every home it sets up (DemoBackend addHistory): no
    // item, done before the home was set up. It stays behind.
    { id: 'c-h1', household_id: HOUSEHOLD, item_id: null, item_title: 'Clean the oven', credited_to: ELA, completed_by: ELA, completed_at: '2026-08-03T10:17:00.000Z', prev_due_date: null, prev_status: 'open' },
    { id: 'c-h2', household_id: HOUSEHOLD, item_id: null, item_title: 'Mow the lawn', credited_to: STRATIS, completed_by: STRATIS, completed_at: '2026-09-12T14:34:00.000Z', prev_due_date: null, prev_status: 'open' },
    { id: 'c-h3', household_id: HOUSEHOLD, item_id: null, item_title: 'Bleed the radiators', credited_to: SHEA, completed_by: SHEA, completed_at: '2026-10-04T11:45:00.000Z', prev_due_date: null, prev_status: 'open' },
    { id: 'c-h4', household_id: HOUSEHOLD, item_id: null, item_title: 'Kitchen paper', credited_to: STRATIS, completed_by: STRATIS, completed_at: '2026-10-06T10:05:00.000Z', prev_due_date: null, prev_status: 'open' },
    { id: 'c-h5', household_id: HOUSEHOLD, item_id: null, item_title: 'Install the new firepit', credited_to: ELA, completed_by: ELA, completed_at: '2026-10-07T18:20:00.000Z', prev_due_date: null, prev_status: 'open' },
  ],
  invites: [],
  push_subs: [],
  // Chat stays behind (the demo's chat starts with a made-up conversation).
  messages: [
    { id: 'msg-1', household_id: HOUSEHOLD, member_id: SHEA, body: 'Legend. We are nearly out of the jacuzzi test strips too.', created_at: '2026-10-08T08:19:00.000Z' },
  ],
  message_reactions: [],
};

/**
 * A home as the demo itself sets one up on a phone, made by the real DemoBackend: Continue with
 * Google, then Create Home with the default areas and the current list. Like every home the
 * demo sets up, it comes with 111 made-up completions (Stats history) and a made-up chat. A
 * day later, one thing really gets done. Deterministic for a given clock (the payload uses
 * keys, not the demo's random ids).
 *
 * Bringing it over must bring that one completion and none of the made-up history
 * (importHome.test.ts, supabase/tests/fixtures/demo-created-import.json and the database
 * tests).
 */
export async function demoCreatedDoc(created = new Date('2026-10-08T09:12:00.000Z')): Promise<Record<string, unknown>> {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
  let now = created;
  const demo = new DemoBackend({ storage, now: () => now, search: '', latency: 0 });
  await demo.signInWithGoogle();
  const hid = await demo.createHousehold({
    name: 'Our home',
    address: '21 Alderbrook Road',
    timezone: 'Europe/London',
    memberName: 'Stratis',
    memberEmoji: '🦆',
    areas: [...DEFAULT_AREAS],
    items: seedItemsFor([...DEFAULT_AREAS]),
  });
  now = new Date(created.getTime() + 86_400_000);
  const data = await demo.load(hid);
  const task = data.items
    .filter((i) => i.kind === 'task')
    .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))[0];
  await demo.completeItem(task.id);
  return JSON.parse(map.get(DEMO_STORAGE_KEY)!) as Record<string, unknown>;
}
