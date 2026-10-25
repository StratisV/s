// The notifications' rules (./notify.ts): what each person's choices and reminders may be,
// devices' subscriptions, and what the morning run sends when (docs/ARCHITECTURE.md "Server
// mode (no setup)", "Notifications"). Pure: documents made here, a clock given.

import { createECDH, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { REMINDERS_MAX } from '../../src/lib/backend/serverApi';
import type { DemoDoc, HousekeepingVisitRow, HousekeepingVisitTaskRow, ItemRow, MemberRow } from '../../src/lib/backend/demo';
import { BackendError } from '../../src/lib/backend/types';
import { pruneAuth } from './auth';
import { ApiError } from './errors';
import {
  deleteReminder,
  forgetEndpoints,
  mondayOf,
  notifySettings,
  planMorning,
  saveReminder,
  setNotifyPrefs,
  subscribeDevice,
  takeDue,
  unsubscribeDevice,
  type PlannedNotification,
} from './notify';
import { newServerDoc, type ServerDoc } from './serverDoc';

const H = 'h-1';
const T = '2026-09-01T09:00:00.000Z';
/** Monday 12 October 2026, 07:30 UTC: 08:30 in London (BST), when the daily run comes. */
const MONDAY = new Date('2026-10-12T07:30:00.000Z');
const day = (n: number) => new Date(MONDAY.getTime() + n * 86_400_000);

function member(over: Partial<MemberRow> & Pick<MemberRow, 'id' | 'name'>): MemberRow {
  return {
    household_id: H,
    user_id: null,
    email: '',
    emoji: '🦔',
    color: '#007AFF',
    role: 'member',
    weekly_email: false,
    push_enabled: false,
    created_at: T,
    ...over,
  };
}

function item(over: Partial<ItemRow> & Pick<ItemRow, 'id' | 'title'>): ItemRow {
  return {
    household_id: H,
    area_id: 'a-1',
    kind: 'task',
    note: '',
    good: '',
    rag: 'amber',
    due_date: null,
    assignee_id: null,
    repeat: 'none',
    notify: 'none',
    status: 'open',
    created_by: null,
    updated_by: null,
    created_at: T,
    updated_at: T,
    completed_at: null,
    ...over,
  };
}

function visit(id: string, date: string, over: Partial<HousekeepingVisitRow> = {}): HousekeepingVisitRow {
  return {
    id,
    household_id: H,
    visit_date: date,
    note: '',
    comments: '',
    price_pence: null,
    created_by: null,
    created_at: T,
    updated_by: null,
    updated_at: T,
    ...over,
  };
}

function task(visitId: string, title: string, position: number, done: boolean): HousekeepingVisitTaskRow {
  return {
    id: `${visitId}-${position}`,
    visit_id: visitId,
    household_id: H,
    task_id: null,
    title,
    section_id: null,
    section_title: '',
    position,
    done,
    done_by: null,
    done_at: done ? T : null,
  };
}

const completion = (id: string, title: string, at: string) => ({
  id,
  household_id: H,
  item_id: null,
  item_title: title,
  credited_to: 'm-stratis',
  completed_by: 'm-stratis',
  completed_at: at,
  prev_due_date: null,
  prev_status: 'open' as const,
});

/** A browser's subscription keys: a P-256 public key and a 16-byte secret. */
function keys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
}

const subscription = (endpoint = `https://web.push.apple.com/${randomBytes(8).toString('hex')}`) => ({ endpoint, keys: keys() });

/**
 * "Our home" in London: Stratis and Shea have joined (a phone each), Pat has not. To do items
 * overdue, due this week and next, a To maintain item, things done last week and before, and
 * housekeeping visits on Thu 1 Oct, Thu 8 Oct (the latest before Monday) and Monday itself.
 */
function home(): ServerDoc {
  const demo: DemoDoc = {
    version: 1,
    session: null,
    users: [],
    households: [
      {
        id: H,
        name: 'Our home',
        address: '21 Alderbrook Road',
        timezone: 'Europe/London',
        weekly_email_day: 1,
        weekly_email_time: '08:00',
        created_at: T,
        updated_at: T,
        updated_by: null,
      },
    ],
    members: [
      member({ id: 'm-stratis', name: 'Stratis', user_id: 'u-stratis', role: 'owner' }),
      member({ id: 'm-shea', name: 'Shea', user_id: 'u-shea' }),
      member({ id: 'm-pat', name: 'Pat' }),
    ],
    areas: [{ id: 'a-1', household_id: H, name: 'Kitchen', position: 0, created_at: T }],
    items: [
      item({ id: 'i-gutters', title: 'Clean the gutters', due_date: '2026-10-05' }),
      item({ id: 'i-bins', title: 'Bins', due_date: '2026-10-12' }),
      item({ id: 'i-boiler', title: 'Boiler service', due_date: '2026-10-15' }),
      item({ id: 'i-sunday', title: 'Sweep the patio', due_date: '2026-10-18' }),
      item({ id: 'i-next', title: 'Smoke alarm', due_date: '2026-10-19' }),
      item({ id: 'i-jacuzzi', title: 'Jacuzzi', kind: 'state' }),
      item({ id: 'i-done', title: 'Paint the gate', due_date: '2026-10-10', status: 'done' }),
    ],
    completions: [
      completion('c-before', 'Last month', '2026-10-04T12:00:00.000Z'),
      completion('c-tue', 'Water the plants', '2026-10-06T10:00:00.000Z'),
      // 23:30 on Sunday in London (BST): still last week.
      completion('c-sun', 'Hoover the stairs', '2026-10-11T22:30:00.000Z'),
      // 07:00 on Monday in London: this week.
      completion('c-mon', 'Today', '2026-10-12T06:00:00.000Z'),
    ],
    invites: [],
    push_subs: [],
    messages: [],
    message_reactions: [],
    housekeeping_notes: [],
    housekeeping_tasks: [],
    housekeeping_visits: [
      visit('v-1oct', '2026-10-01', { comments: 'All fine' }),
      visit('v-8oct', '2026-10-08', { comments: 'Out of bin bags', price_pence: 4500, note: 'Please do the windows' }),
      visit('v-today', '2026-10-12', { comments: 'Here now' }),
    ],
    housekeeping_visit_tasks: [
      task('v-8oct', 'Kitchen', 0, true),
      task('v-8oct', 'Bathrooms', 1, true),
      task('v-8oct', 'Floors', 2, false),
    ],
    housekeeping_sections: [],
    goals: [],
    goal_links: [],
  };
  const doc = newServerDoc(demo, new Date(T), { secret: 'c2VjcmV0' });
  doc.auth.devices = [
    { id: 'd-stratis', keyHash: 'k1', userId: 'u-stratis', label: 'iPhone · Home Screen app', createdAt: T },
    { id: 'd-shea', keyHash: 'k2', userId: 'u-shea', label: 'iPhone · Home Screen app', createdAt: T },
  ];
  return doc;
}

let ids = 0;
const deps = { now: () => MONDAY, newId: () => `r-${++ids}` };

/** Stratis with this device subscribed, every choice ticked and two reminders. */
function stratisWantsEverything(doc = home()) {
  subscribeDevice(doc, 'd-stratis', subscription('https://web.push.apple.com/stratis'), MONDAY);
  setNotifyPrefs(doc, 'm-stratis', { weeklyStatus: true, housekeeping: true, reminders: true });
  saveReminder(doc, 'm-stratis', { title: 'Take the bins out', days: [1] }, deps);
  saveReminder(doc, 'm-stratis', { title: 'Water the garden', days: [0, 3] }, deps);
  return doc;
}

const kinds = (list: PlannedNotification[]) => list.map((n) => n.kind);

describe('planMorning: what goes out when', () => {
  it('on Monday morning: the weekly status, the latest visit, and Monday’s reminders', () => {
    const doc = stratisWantsEverything();
    const plan = planMorning(doc, MONDAY);
    expect(kinds(plan.notifications)).toEqual(['weekly', 'housekeeping', 'reminder']);
    expect(plan.notifications.every((n) => n.memberId === 'm-stratis')).toBe(true);
    expect(plan.notifications[0].to).toEqual([expect.objectContaining({ deviceId: 'd-stratis', endpoint: 'https://web.push.apple.com/stratis' })]);
    expect(plan.sent.get('m-stratis')).toEqual({ weekly: '2026-10-12', housekeeping: 'v-8oct', reminders: '2026-10-12' });
  });

  it('words the weekly status: overdue, due this week (to Sunday), done last week (Monday to Sunday)', () => {
    const [weekly] = planMorning(stratisWantsEverything(), MONDAY).notifications;
    expect(weekly.payload).toEqual({
      title: 'This week at Our home',
      body: [
        'Overdue (1): Clean the gutters',
        'Due this week (3): Bins (today), Boiler service (Thu) and Sweep the patio (Sun)',
        'Done last week (2): Water the plants and Hoover the stairs',
      ].join('\n'),
      url: '/',
      tag: 'weekly:2026-10-12',
    });
  });

  it('says so when nothing is due or was done, and names at most three with the rest counted', () => {
    const doc = stratisWantsEverything();
    doc.home.items = doc.home.items.filter((it) => it.kind === 'state');
    doc.home.completions = [];
    expect(planMorning(doc, MONDAY).notifications[0].payload.body).toBe('Nothing due this week.\nNothing done last week.');
    const busy = stratisWantsEverything();
    busy.home.items = ['A', 'B', 'C', 'D', 'E'].map((t, i) => item({ id: `x-${i}`, title: t, due_date: '2026-10-01' }));
    expect(planMorning(busy, MONDAY).notifications[0].payload.body.split('\n')[0]).toBe('Overdue (5): A, B, C and 2 more');
  });

  it('words the housekeeping report: what was ticked, the comments, the price and the message left', () => {
    const report = planMorning(stratisWantsEverything(), MONDAY).notifications[1];
    expect(report.payload).toEqual({
      title: 'Housekeeping, Thu 8 Oct',
      body: 'Done 2 of 3: Kitchen and Bathrooms\nComments: Out of bin bags\nPrice: £45.00\nMessage left: Please do the windows',
      url: '/',
      tag: 'housekeeping:v-8oct',
    });
  });

  it('sends a reminder on its days only, titled with what to do', () => {
    const doc = stratisWantsEverything();
    const reminder = planMorning(doc, MONDAY).notifications[2];
    expect(reminder.payload).toMatchObject({ title: 'Take the bins out', body: 'Reminder for Monday', tag: expect.stringMatching(/^reminder:r-\d+:2026-10-12$/) });
    // Tuesday: no reminder of his (the weekly status went on Monday; Monday's visit is reported now).
    takeDue(doc, MONDAY);
    expect(kinds(takeDue(doc, day(1)))).toEqual(['housekeeping']);
    // Wednesday and Sunday: Water the garden.
    expect(planMorning(doc, day(2)).notifications.map((n) => n.payload.title)).toEqual(['Water the garden']);
    expect(planMorning(doc, day(6)).notifications.map((n) => n.payload.title)).toEqual(['Water the garden']);
  });

  it('sends each notification once per person and period, however often it runs', () => {
    const doc = stratisWantsEverything();
    expect(takeDue(doc, MONDAY)).toHaveLength(3);
    expect(takeDue(doc, MONDAY)).toEqual([]);
    expect(takeDue(doc, new Date(MONDAY.getTime() + 50 * 60_000))).toEqual([]);
    // Next Monday: a new week, last Monday's visit (the latest now), and Monday's reminder again.
    const next = takeDue(doc, day(7));
    expect(next.map((n) => n.payload.tag.replace(/r-\d+/, 'r'))).toEqual(['weekly:2026-10-19', 'housekeeping:v-today', 'reminder:r:2026-10-19']);
    expect(takeDue(doc, day(7))).toEqual([]);
  });

  it('makes up a missed Monday on Tuesday (the weekly status only), never on Wednesday', () => {
    const tuesday = stratisWantsEverything();
    const sent = takeDue(tuesday, day(1));
    expect(kinds(sent)).toEqual(['weekly', 'housekeeping']);
    expect(sent[0].payload.tag).toBe('weekly:2026-10-12');
    // Overdue and due counted from Tuesday: Bins is overdue now.
    expect(sent[0].payload.body.split('\n').slice(0, 2)).toEqual([
      'Overdue (2): Clean the gutters and Bins',
      'Due this week (2): Boiler service (Thu) and Sweep the patio (Sun)',
    ]);
    expect(kinds(takeDue(stratisWantsEverything(), day(2)))).toEqual(['housekeeping', 'reminder']);
  });

  it('reports the latest visit with something in it from before today, within a week, once', () => {
    const doc = stratisWantsEverything();
    setNotifyPrefs(doc, 'm-stratis', { weeklyStatus: false, reminders: false });
    expect(takeDue(doc, MONDAY).map((n) => n.payload.tag)).toEqual(['housekeeping:v-8oct']);
    // Tuesday: Monday's visit (today's, on Monday) is the latest now.
    expect(takeDue(doc, day(1)).map((n) => n.payload.tag)).toEqual(['housekeeping:v-today']);
    expect(takeDue(doc, day(2))).toEqual([]);
    // An older visit filled in later is never reported once a newer one was.
    doc.home.housekeeping_visits = [...doc.home.housekeeping_visits, visit('v-late', '2026-10-09', { price_pence: 0 })];
    expect(takeDue(doc, day(3))).toEqual([]);
  });

  it('leaves out visits with nothing recorded and visits more than a week old', () => {
    const doc = stratisWantsEverything();
    setNotifyPrefs(doc, 'm-stratis', { weeklyStatus: false, reminders: false });
    doc.home.housekeeping_visits = [visit('v-empty', '2026-10-10'), visit('v-old', '2026-10-04', { comments: 'Old' })];
    expect(planMorning(doc, MONDAY).notifications).toEqual([]);
    // A visit saved after the morning it would have gone: the next morning.
    doc.home.housekeeping_visits.push(visit('v-sat', '2026-10-10', { comments: 'Saved on Monday evening' }));
    expect(planMorning(doc, day(1)).notifications.map((n) => n.payload.title)).toEqual(['Housekeeping, Sat 10 Oct']);
  });

  it('sends nothing to someone without a subscribed device, nothing they did not tick, nothing to anyone else', () => {
    const doc = home();
    setNotifyPrefs(doc, 'm-shea', { weeklyStatus: true, housekeeping: true, reminders: true });
    saveReminder(doc, 'm-shea', { title: 'Feed the cat', days: [1] }, deps);
    expect(planMorning(doc, MONDAY).notifications).toEqual([]);
    subscribeDevice(doc, 'd-shea', subscription(), MONDAY);
    expect(planMorning(doc, MONDAY).notifications.every((n) => n.memberId === 'm-shea')).toBe(true);
    setNotifyPrefs(doc, 'm-shea', { weeklyStatus: false, housekeeping: false });
    expect(kinds(planMorning(doc, MONDAY).notifications)).toEqual(['reminder']);
    setNotifyPrefs(doc, 'm-shea', { reminders: false });
    expect(planMorning(doc, MONDAY).notifications).toEqual([]);
  });

  it('goes by the household’s day: late on Sunday in London is still Sunday', () => {
    const doc = stratisWantsEverything();
    // 23:30 on Sunday 11 Oct in London (22:30 UTC): no weekly status yet, Sunday's reminder.
    const sunday = planMorning(doc, new Date('2026-10-11T22:30:00.000Z'));
    expect(sunday.notifications.map((n) => n.payload.title)).toEqual(['Housekeeping, Thu 8 Oct', 'Water the garden']);
    // In GMT (November), 07:xx UTC is 07:xx in London: Monday.
    expect(mondayOf('2026-11-02')).toBe('2026-11-02');
    expect(mondayOf('2026-11-08')).toBe('2026-11-02');
  });

  it('keeps the payload small enough for Web Push', () => {
    const doc = stratisWantsEverything();
    doc.home.items = Array.from({ length: 50 }, (_, i) => item({ id: `x-${i}`, title: '🦔'.repeat(200), due_date: '2026-10-01' }));
    doc.home.completions = Array.from({ length: 50 }, (_, i) => completion(`c-${i}`, '🦆'.repeat(200), '2026-10-07T10:00:00.000Z'));
    for (const n of planMorning(doc, MONDAY).notifications) {
      expect(Buffer.byteLength(JSON.stringify(n.payload))).toBeLessThan(3993);
    }
  });
});

describe('choices and reminders', () => {
  it('starts with nothing ticked and no reminders; ticks only the choices given', () => {
    const doc = home();
    expect(notifySettings(doc, 'm-stratis', 'd-stratis', 'PUB')).toEqual({
      prefs: { weeklyStatus: false, housekeeping: false, reminders: false },
      reminders: [],
      publicKey: 'PUB',
      subscribed: false,
    });
    setNotifyPrefs(doc, 'm-stratis', { housekeeping: true });
    setNotifyPrefs(doc, 'm-stratis', { weeklyStatus: true });
    expect(notifySettings(doc, 'm-stratis', 'd-stratis', null).prefs).toEqual({ weeklyStatus: true, housekeeping: true, reminders: false });
    // Shea's are her own.
    expect(notifySettings(doc, 'm-shea', 'd-shea', null).prefs.housekeeping).toBe(false);
  });

  it('refuses anything but those three booleans, and anyone who has not joined', () => {
    const doc = home();
    for (const bad of [null, [], 'yes', { weeklyStatus: 'yes' }, { everything: true }, { __proto__: true, constructor: true }]) {
      expect(() => setNotifyPrefs(doc, 'm-stratis', bad)).toThrow(ApiError);
    }
    expect(() => setNotifyPrefs(doc, 'm-pat', { weeklyStatus: true })).toThrow(BackendError);
    expect(() => setNotifyPrefs(doc, 'm-nobody', { weeklyStatus: true })).toThrow(BackendError);
    expect(doc.notify).toBeUndefined();
  });

  it('adds, changes and deletes reminders: titles trimmed, days sorted once each', () => {
    const doc = home();
    const bins = saveReminder(doc, 'm-stratis', { title: '  Take the   bins out ', days: [0, 3, 0] }, deps);
    expect(bins).toEqual({ id: expect.any(String), title: 'Take the bins out', days: [0, 3] });
    const changed = saveReminder(doc, 'm-stratis', { id: bins.id, title: 'Bins and recycling', days: [6, 1] }, deps);
    expect(changed).toEqual({ id: bins.id, title: 'Bins and recycling', days: [1, 6] });
    expect(notifySettings(doc, 'm-stratis', 'd-stratis', null).reminders).toEqual([changed]);
    deleteReminder(doc, 'm-stratis', bins.id);
    expect(notifySettings(doc, 'm-stratis', 'd-stratis', null).reminders).toEqual([]);
  });

  it('refuses a blank or long title, no days or wrong ones, unknown keys, and someone else’s reminder', () => {
    const doc = home();
    const mine = saveReminder(doc, 'm-stratis', { title: 'Mine', days: [1] }, deps);
    const bad = [
      { title: '   ', days: [1] },
      { title: 'x'.repeat(81), days: [1] },
      { title: 'x', days: [] },
      { title: 'x', days: [7] },
      { title: 'x', days: [1.5] },
      { title: 'x', days: '1' },
      { title: 'x', days: [1], at: '19:00' },
      { title: 'x', days: [1], id: '' },
      'Take the bins out',
    ];
    for (const input of bad) expect(() => saveReminder(doc, 'm-stratis', input, deps)).toThrow(ApiError);
    // Characters as code points (as the other limits count them): 80 of them fit.
    expect(Array.from(saveReminder(doc, 'm-stratis', { title: '🦔'.repeat(80), days: [1] }, deps).title)).toHaveLength(80);
    expect(() => saveReminder(doc, 'm-shea', { id: mine.id, title: 'Hers now', days: [1] }, deps)).toThrow(BackendError);
    expect(() => deleteReminder(doc, 'm-shea', mine.id)).toThrow(BackendError);
    expect(() => deleteReminder(doc, 'm-stratis', 'r-none')).toThrow(BackendError);
    expect(notifySettings(doc, 'm-stratis', 'd-stratis', null).reminders.map((r) => r.title)).toContain('Mine');
  });

  it(`keeps at most ${REMINDERS_MAX} reminders a person`, () => {
    const doc = home();
    for (let i = 0; i < REMINDERS_MAX; i++) saveReminder(doc, 'm-stratis', { title: `R${i}`, days: [i % 7] }, deps);
    expect(() => saveReminder(doc, 'm-stratis', { title: 'One more', days: [1] }, deps)).toThrow(/at most/);
  });

  it('forgets the choices of someone who is gone or no longer joined (before every put)', () => {
    const doc = stratisWantsEverything();
    setNotifyPrefs(doc, 'm-shea', { housekeeping: true });
    doc.home = { ...doc.home, members: doc.home.members.map((m) => (m.id === 'm-shea' ? { ...m, user_id: null } : m)) };
    pruneAuth(doc, MONDAY);
    expect(doc.notify!.people.map((p) => p.memberId)).toEqual(['m-stratis']);
    expect(doc.auth.devices.map((d) => d.id)).toEqual(['d-stratis']);
  });
});

describe('devices’ subscriptions', () => {
  it('keeps one per device, says so to that device only, and forgets it when asked', () => {
    const doc = home();
    subscribeDevice(doc, 'd-stratis', subscription('https://fcm.googleapis.com/fcm/send/abc'), MONDAY);
    expect(notifySettings(doc, 'm-stratis', 'd-stratis', null).subscribed).toBe(true);
    expect(notifySettings(doc, 'm-shea', 'd-shea', null).subscribed).toBe(false);
    expect(unsubscribeDevice(doc, 'd-stratis')).toBe(true);
    expect(unsubscribeDevice(doc, 'd-stratis')).toBe(false);
    expect(doc.auth.devices[0]).not.toHaveProperty('push');
  });

  it('only takes https endpoints of the known push services, and real keys', () => {
    const doc = home();
    const good = keys();
    const bad: unknown[] = [
      { endpoint: 'https://evil.example.com/push', keys: good },
      { endpoint: 'http://fcm.googleapis.com/fcm/send/x', keys: good },
      { endpoint: 'https://fcm.googleapis.com:8443/x', keys: good },
      { endpoint: `https://fcm.googleapis.com/${'x'.repeat(1100)}`, keys: good },
      { endpoint: 'https://fcm.googleapis.com/x', keys: { ...good, p256dh: 'AAAA' } },
      { endpoint: 'https://fcm.googleapis.com/x', keys: { ...good, auth: randomBytes(15).toString('base64url') } },
      { endpoint: 'https://fcm.googleapis.com/x' },
      null,
    ];
    for (const sub of bad) expect(() => subscribeDevice(doc, 'd-stratis', sub, MONDAY)).toThrow(ApiError);
    expect(doc.auth.devices.some((d) => d.push)).toBe(false);
  });

  it('moves an endpoint to the device that sent it last, so a phone never gets one twice', () => {
    const doc = home();
    const sub = subscription();
    subscribeDevice(doc, 'd-stratis', sub, MONDAY);
    subscribeDevice(doc, 'd-shea', sub, MONDAY);
    expect(doc.auth.devices.map((d) => !!d.push)).toEqual([false, true]);
  });

  it('goes with its device, and when a push service says it is gone', () => {
    const doc = stratisWantsEverything();
    subscribeDevice(doc, 'd-shea', subscription('https://web.push.apple.com/shea'), MONDAY);
    expect(forgetEndpoints(doc, new Set(['https://web.push.apple.com/shea']))).toBe(1);
    expect(doc.auth.devices.find((d) => d.id === 'd-shea')!.push).toBeUndefined();
    doc.auth.devices = doc.auth.devices.filter((d) => d.id !== 'd-stratis');
    expect(planMorning(doc, MONDAY).notifications).toEqual([]);
  });
});
