import { writeFileSync } from 'node:fs';
// Builds src/lib/logic/savedHome.json: the household's home as it was on Stratis's phone
// (from his screenshot of 11 Oct 2026), written with the app's own DemoBackend so it is a valid
// homeos.demo.v1 document. Server mode's setup can bring it online when the phone's own copy is
// not there ("Use my saved copy"). Run: npx vite-node scripts/build-saved-home.ts src/lib/logic/savedHome.json
import { DemoBackend, DEMO_STORAGE_KEY } from '../src/lib/backend/demo';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}
import { DEFAULT_ADDRESS, DEFAULT_AREAS } from '../src/lib/constants';
import type { ItemDraft } from '../src/lib/types';

const storage = new MemoryStorage();
const at = (iso: string) => () => new Date(iso);
let clock = at('2026-10-09T12:00:00+01:00');
const b = new DemoBackend({ storage, search: '', latency: 0, now: () => clock(), user: { id: 'demo-user-stratis', email: 'stratis@example.com', name: 'Stratis' } });
await b.signInWithGoogle();
const hid = await b.createHousehold({
  name: 'Our home',
  address: DEFAULT_ADDRESS,
  timezone: 'Europe/London',
  memberName: 'Stratis',
  memberEmoji: '🦆',
  areas: [...DEFAULT_AREAS],
  items: [],
});
let data = await b.load(hid);
const stratis = data.members[0].id;
const shea = (await b.addPerson(hid, { name: 'Shea', emoji: '🦔', email: '' })).id;
data = await b.load(hid);
const area = (name: string) => data.areas.find((a) => a.name === name)!.id;

type Row = [area: string, kind: 'task' | 'state', title: string, rag: 'red' | 'amber' | 'green', who: string | null, due: string | null, note?: string, repeat?: 'none' | 'monthly'];
const rows: Row[] = [
  ['Kitchen', 'state', 'Rubbish fill level', 'green', shea, null],
  ['Kitchen', 'state', 'Shared supplies', 'green', stratis, null, 'Restocked.'],
  ['Kitchen', 'state', 'Tidiness', 'green', shea, null, 'Restocked, 5L tin is in the pantry.'],
  ['Living Room', 'task', 'Fix the cracks on the wall', 'red', null, '2026-10-16'],
  ['Living Room', 'task', 'Remove AC', 'amber', null, '2026-10-16'],
  ['Living Room', 'state', 'Tidiness', 'green', stratis, null],
  ['Bathroom Small', 'task', 'Hand towels solution', 'red', null, '2026-10-16'],
  ['Bathroom Small', 'state', 'Tidiness', 'green', shea, null],
  ['Bedroom Large', 'state', 'Tidiness', 'green', stratis, null],
  ['Garden', 'task', 'Install leaf blower', 'amber', stratis, '2026-10-16'],
  ['Garden', 'state', 'Clean surfaces', 'green', stratis, null],
  ['Garden', 'state', 'Leaves', 'green', stratis, null],
  ['Garden', 'state', 'Plants healthy', 'green', stratis, null],
  ['Garden', 'state', 'Weeds', 'green', stratis, null],
  ['Garden Lounge', 'task', 'More long term AC hole solution', 'amber', stratis, '2026-10-16'],
  ['Garden Lounge', 'state', 'Decking cleanness', 'green', stratis, null],
  ['Garden Lounge', 'state', 'Rubbish', 'green', stratis, null],
  ['Garden Lounge', 'state', 'Tidiness', 'green', stratis, null],
  ['Jacuzzi', 'task', 'Check Chemicals', 'green', shea, '2026-10-20', 'Order a new pack.'],
  ['Jacuzzi', 'task', 'Change the filter', 'green', shea, '2026-10-21', '', 'monthly'],
  // Hallway shows one red item, collapsed in the screenshot: the sample home's one, which this home kept.
  ['Hallway', 'task', 'Heaters not working', 'red', shea, '2026-10-07', 'No heat since the weekend. Engineer needs booking.'],
];
let minute = 0;
for (const [a, kind, title, rag, who, due, note = '', repeat = 'none'] of rows) {
  clock = at(new Date(Date.parse('2026-10-09T12:00:00+01:00') + ++minute * 60_000).toISOString());
  const draft: ItemDraft = {
    area_id: area(a),
    kind,
    title,
    note,
    good: '',
    rag,
    due_date: kind === 'state' ? null : due,
    assignee_id: who,
    repeat: kind === 'state' ? 'none' : repeat,
    notify: kind === 'state' ? 'none' : 'day_before',
  };
  await b.createItem(hid, draft);
}
const raw = storage.getItem(DEMO_STORAGE_KEY)!;
writeFileSync(process.argv[2], JSON.stringify(JSON.parse(raw), null, 1) + '\n');
const final = await b.load(hid);
console.log('areas', final.areas.length, 'items', final.items.length, 'people', final.members.map((m) => `${m.emoji} ${m.name}`).join(', '));

// Keep only this home: Stratis and Shea (not joined yet), no sample history or visits.
const doc = JSON.parse(raw);
const keepShea = doc.members.find((m: { name: string; user_id: string | null }) => m.name === 'Shea' && m.user_id === null).id;
const keep = new Set([stratis, keepShea]);
doc.members = doc.members.filter((m: { id: string }) => keep.has(m.id));
doc.users = doc.users.filter((u: { id: string }) => u.id === 'demo-user-stratis');
doc.completions = [];
doc.housekeeping_visits = [];
doc.housekeeping_visit_tasks = [];
doc.housekeeping_notes = doc.housekeeping_notes.map((n: object) => ({ ...n, body: '', updated_at: null, updated_by: null }));
const check = new MemoryStorage();
check.setItem(DEMO_STORAGE_KEY, JSON.stringify(doc));
const again = new DemoBackend({ storage: check, search: '', latency: 0, now: () => new Date('2026-10-11T09:00:00+01:00'), user: { id: 'demo-user-stratis', email: 'stratis@example.com', name: 'Stratis' } });
const loaded = await again.load(hid);
console.log('clean:', loaded.members.map((m) => `${m.emoji} ${m.name}${m.user_id ? '' : ' (not joined)'}`).join(', '), '| items', loaded.items.length, '| completions', loaded.completions.length, '| hk tasks', loaded.housekeeping.tasks.length, '| visits', loaded.housekeeping.visits.length);
const dangling = loaded.items.filter((it) => it.assignee_id && !loaded.members.some((m) => m.id === it.assignee_id));
console.log('dangling assignees', dangling.length);
writeFileSync(process.argv[2], JSON.stringify(doc, null, 1) + '\n');
