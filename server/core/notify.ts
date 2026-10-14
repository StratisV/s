// Phone notifications in server mode (docs/ARCHITECTURE.md "Server mode (no setup)",
// "Notifications"): what each person ticked in Profile, their own reminders, each device's
// Web Push subscription, and the morning run that works out what is due and sends it.
//
// Pure functions over a ServerDoc (the handler stores them through HomeStore.write, as 'meta'
// writes: browsers do not reload for them). Like auth.ts they never edit in place: doc.notify
// and doc.auth.devices are replaced, so a pure write rolls back cleanly.
//
// The morning run (op tick, once a day from Vercel Cron; see planMorning for the rules) claims
// what it sends in the same write that plans it, before anything goes out: each notification
// is sent at most once per person and period, even when the cron calls twice or two instances
// run at once (the second plans on the stored claims and finds nothing). A push that then fails
// is not tried again.
//
// Sending is Web Push with VAPID, using supabase/functions/_shared/webpush.ts (WebCrypto only,
// no npm package; esbuild bundles it into the function). Only endpoints on the known push
// services are stored or contacted (isAllowedPushEndpoint).

import {
  isAllowedPushEndpoint,
  MAX_PAYLOAD_BYTES,
  sendWebPush,
  type PushSubscriptionKeys,
  type VapidKeys,
  type WebPushResult,
} from '../../supabase/functions/_shared/webpush.ts';
import { REMINDERS_MAX } from '../../src/lib/backend/serverApi';
import { BackendError } from '../../src/lib/backend/types';
import { TEXT_LIMITS } from '../../src/lib/constants';
import { addDays, formatDay, parseISODate, todayIn } from '../../src/lib/logic/dates';
import { formatPrice } from '../../src/lib/logic/housekeeping';
import type { ISODate, NotifyPrefs, NotifySettings, Reminder } from '../../src/lib/types';
import { ApiError } from './errors';
import type { DevicePush, DeviceRow, NotifyPersonRow, ReminderRow, ServerDoc, ServerNotify } from './serverDoc';

/** The longest push endpoint stored (push services hand out a few hundred characters at most). */
export const PUSH_ENDPOINT_MAX = 1024;
/** How long a push service keeps a notification for a phone that is off (seconds): the day it is for. */
export const PUSH_TTL_SECONDS = 12 * 60 * 60;
/** Each push request's time limit (the function may run 15 s in all). */
export const PUSH_TIMEOUT_MS = 8000;
/** A housekeeping visit older than this many days is not reported any more. */
export const HOUSEKEEPING_REPORT_DAYS = 7;
/** At most this many of a person's reminders go out in one morning. */
export const REMINDERS_PER_MORNING = 10;
/** How many titles a line of the weekly status or the housekeeping report names. */
const NAMED = 3;
/** Notification bodies are cut to this many characters (the encrypted payload must stay under 4 KB). */
const BODY_MAX = 700;
const TITLE_MAX = 120;

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const NO_PREFS: NotifyPrefs = { weeklyStatus: false, housekeeping: false, reminders: false };

// ── Reading ──────────────────────────────────────────────

function notifyOf(doc: ServerDoc): ServerNotify {
  return doc.notify ?? { people: [] };
}

function rowOf(doc: ServerDoc, memberId: string): NotifyPersonRow | undefined {
  return notifyOf(doc).people.find((p) => p.memberId === memberId);
}

function toReminder(r: ReminderRow): Reminder {
  return { id: r.id, title: r.title, days: [...r.days] };
}

/** What Profile shows the signed-in person: their choices and reminders, and this device. */
export function notifySettings(doc: ServerDoc, memberId: string, deviceId: string, publicKey: string | null): NotifySettings {
  const row = rowOf(doc, memberId);
  const device = doc.auth.devices.find((d) => d.id === deviceId);
  return {
    prefs: row ? { weeklyStatus: row.weeklyStatus, housekeeping: row.housekeeping, reminders: row.reminders } : { ...NO_PREFS },
    reminders: row ? row.list.map(toReminder) : [],
    publicKey,
    subscribed: !!device?.push,
  };
}

// ── Changing a person's row ──────────────────────────────

const invalid = (what: string) => new ApiError('invalid_input', `invalid_input: ${what}`);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The member a signed-in caller is, joined (notifications are only for people who have joined). */
function joinedMember(doc: ServerDoc, memberId: string) {
  const member = doc.home.members.find((m) => m.id === memberId);
  if (!member || member.user_id === null) throw new BackendError('not_found', 'No such person');
  return member;
}

/** Replaces `memberId`'s row with what `change` makes of it (a fresh row when they have none). */
function updateRow(doc: ServerDoc, memberId: string, change: (row: NotifyPersonRow) => NotifyPersonRow): NotifyPersonRow {
  joinedMember(doc, memberId);
  const people = notifyOf(doc).people;
  const current = people.find((p) => p.memberId === memberId) ?? { memberId, ...NO_PREFS, list: [], sent: {} };
  const next = change(current);
  doc.notify = { people: [...people.filter((p) => p !== current), next] };
  return next;
}

/** Ticks or unticks what the person gets: only the keys present, each a boolean (else 'invalid_input'). */
export function setNotifyPrefs(doc: ServerDoc, memberId: string, patch: unknown): void {
  if (!isRecord(patch)) throw invalid('prefs');
  const keys = Object.keys(NO_PREFS) as (keyof NotifyPrefs)[];
  const next: Partial<NotifyPrefs> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!(keys as string[]).includes(key) || typeof value !== 'boolean') throw invalid(`prefs.${key}`);
    next[key as keyof NotifyPrefs] = value;
  }
  updateRow(doc, memberId, (row) => ({ ...row, ...next }));
}

/** A reminder's title, trimmed: 1 to TEXT_LIMITS.reminderTitle characters (code points). */
function reminderTitle(value: unknown): string {
  if (typeof value !== 'string') throw invalid('title');
  const title = value.replace(/\s+/g, ' ').trim();
  if (!title) throw invalid('title');
  if (Array.from(title).length > TEXT_LIMITS.reminderTitle) throw invalid(`title is longer than ${TEXT_LIMITS.reminderTitle} characters`);
  return title;
}

/** Weekdays 0 to 6, at least one; duplicates go, ascending. */
function reminderDays(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 7) throw invalid('days');
  for (const day of value) if (typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6) throw invalid('days');
  return [...new Set(value as number[])].sort((a, b) => a - b);
}

/**
 * Adds a reminder (no `id`; at most REMINDERS_MAX a person) or changes one of the person's own
 * (`id`: 'not_found' when they have none such). Returns it as saved.
 */
export function saveReminder(
  doc: ServerDoc,
  memberId: string,
  input: unknown,
  deps: { now: () => Date; newId: () => string },
): Reminder {
  if (!isRecord(input)) throw invalid('reminder');
  for (const key of Object.keys(input)) if (!['id', 'title', 'days'].includes(key)) throw invalid(`reminder.${key}`);
  const title = reminderTitle(input.title);
  const days = reminderDays(input.days);
  const id = input.id;
  if (id !== undefined && (typeof id !== 'string' || id.length < 1 || id.length > 100)) throw invalid('reminder.id');
  let saved!: ReminderRow;
  updateRow(doc, memberId, (row) => {
    if (id === undefined) {
      if (row.list.length >= REMINDERS_MAX) throw invalid(`at most ${REMINDERS_MAX} reminders`);
      saved = { id: deps.newId(), title, days, createdAt: deps.now().toISOString() };
      return { ...row, list: [...row.list, saved] };
    }
    const at = row.list.findIndex((r) => r.id === id);
    if (at < 0) throw new BackendError('not_found', 'No such reminder');
    saved = { ...row.list[at], title, days };
    return { ...row, list: row.list.map((r, i) => (i === at ? saved : r)) };
  });
  return toReminder(saved);
}

/** Deletes one of the person's reminders ('not_found' when they have none such). */
export function deleteReminder(doc: ServerDoc, memberId: string, id: unknown): void {
  if (typeof id !== 'string' || id.length < 1 || id.length > 100) throw invalid('id');
  updateRow(doc, memberId, (row) => {
    if (!row.list.some((r) => r.id === id)) throw new BackendError('not_found', 'No such reminder');
    return { ...row, list: row.list.filter((r) => r.id !== id) };
  });
}

// ── Devices' subscriptions ───────────────────────────────

/** base64url that decodes to exactly `length` bytes (and, for a key, an uncompressed point). */
function keyBytes(value: unknown, length: number): boolean {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value) || value.length > 200) return false;
  const bytes = Buffer.from(value.replace(/=+$/, ''), 'base64url');
  return bytes.length === length && (length !== 65 || bytes[0] === 0x04);
}

/**
 * Keeps `subscription` (PushSubscription.toJSON(): { endpoint, keys: { p256dh, auth } }) on the
 * device `deviceId`, in place of the one it had. An endpoint that is not https on a known push
 * service, or keys that are not a P-256 point and a 16-byte secret, are 'invalid_input'. The
 * same endpoint on another device (the browser signed in again since) goes from there, so a
 * phone never gets a notification twice.
 */
export function subscribeDevice(doc: ServerDoc, deviceId: string, subscription: unknown, now: Date): void {
  if (!isRecord(subscription) || !isRecord(subscription.keys)) throw invalid('subscription');
  const { endpoint } = subscription;
  if (typeof endpoint !== 'string' || endpoint.length > PUSH_ENDPOINT_MAX || !isAllowedPushEndpoint(endpoint)) throw invalid('endpoint');
  const { p256dh, auth } = subscription.keys;
  if (!keyBytes(p256dh, 65)) throw invalid('p256dh');
  if (!keyBytes(auth, 16)) throw invalid('auth');
  if (!doc.auth.devices.some((d) => d.id === deviceId)) throw new ApiError('not_signed_in');
  const push: DevicePush = {
    endpoint,
    p256dh: (p256dh as string).replace(/=+$/, ''),
    auth: (auth as string).replace(/=+$/, ''),
    createdAt: now.toISOString(),
  };
  doc.auth.devices = doc.auth.devices.map((d): DeviceRow => {
    if (d.id === deviceId) {
      // The same subscription again (Profile opened on a phone that has it): nothing changes.
      if (d.push && d.push.endpoint === push.endpoint && d.push.p256dh === push.p256dh && d.push.auth === push.auth) return d;
      return { ...d, push };
    }
    return d.push?.endpoint === endpoint ? withoutPush(d) : d;
  });
}

function withoutPush(device: DeviceRow): DeviceRow {
  const { push: _gone, ...rest } = device;
  return rest;
}

/** Forgets the device's subscription. False when it had none. */
export function unsubscribeDevice(doc: ServerDoc, deviceId: string): boolean {
  const device = doc.auth.devices.find((d) => d.id === deviceId);
  if (!device?.push) return false;
  doc.auth.devices = doc.auth.devices.map((d) => (d === device ? withoutPush(d) : d));
  return true;
}

/** Forgets every subscription with one of these endpoints (a push service said they are gone). */
export function forgetEndpoints(doc: ServerDoc, endpoints: ReadonlySet<string>): number {
  let n = 0;
  doc.auth.devices = doc.auth.devices.map((d) => {
    if (!d.push || !endpoints.has(d.push.endpoint)) return d;
    n += 1;
    return withoutPush(d);
  });
  return n;
}

/** Run before every put (pruneAuth): rows of people who are gone, or no longer joined, go. */
export function pruneNotify(doc: ServerDoc): void {
  if (!doc.notify) return;
  const joined = new Set(doc.home.members.filter((m) => m.user_id !== null).map((m) => m.id));
  const people = doc.notify.people.filter((p) => joined.has(p.memberId));
  if (people.length !== doc.notify.people.length) doc.notify = { people };
}

// ── The morning run ──────────────────────────────────────

/** What the service worker shows (public/sw.js: { title, body, url, tag }). */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export type NotificationKind = 'weekly' | 'housekeeping' | 'reminder';

export interface PlannedNotification {
  kind: NotificationKind;
  memberId: string;
  payload: PushPayload;
  /** The person's devices that have a subscription, as the document holds them now. */
  to: (PushSubscriptionKeys & { deviceId: string })[];
}

export interface MorningPlan {
  notifications: PlannedNotification[];
  /** What to record as sent, per person (member id). */
  sent: Map<string, NotifyPersonRow['sent']>;
}

/** 0 = Sunday … 6 = Saturday. */
function weekdayOf(date: ISODate): number {
  const { y, m, d } = parseISODate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The Monday of the week `date` is in (weeks run Monday to Sunday). */
export function mondayOf(date: ISODate): ISODate {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : flat;
}

/** "A, B and 2 more" (at most NAMED names). */
function named(names: string[]): string {
  const shown = names.slice(0, NAMED).map((n) => clip(n, 60));
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  if (shown.length <= 1) return shown.join('');
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** The payload, cut until its JSON fits a Web Push message. */
function fit(payload: PushPayload): PushPayload {
  let out = { ...payload, title: clip(payload.title, TITLE_MAX) };
  let body = out.body.length > BODY_MAX ? `${Array.from(out.body).slice(0, BODY_MAX - 1).join('')}…` : out.body;
  out = { ...out, body };
  while (Buffer.byteLength(JSON.stringify(out), 'utf8') > MAX_PAYLOAD_BYTES && body.length > 1) {
    body = `${Array.from(body).slice(0, Math.floor(Array.from(body).length * 0.8)).join('')}…`;
    out = { ...out, body };
  }
  return out;
}

/**
 * The weekly status for the week starting `monday`: what is overdue on `today`, what is due
 * from today to Sunday, and what was done Monday to Sunday the week before (household time).
 * To do items only (a To maintain item is never due).
 */
export function weeklyStatus(doc: ServerDoc, householdId: string, today: ISODate, monday: ISODate, timeZone: string): PushPayload {
  const household = doc.home.households.find((h) => h.id === householdId);
  const open = doc.home.items
    .filter((it) => it.household_id === householdId && it.status === 'open' && it.kind !== 'state' && it.due_date)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : a.title.localeCompare(b.title)));
  const sunday = addDays(monday, 6);
  const overdue = open.filter((it) => it.due_date! < today);
  const due = open.filter((it) => it.due_date! >= today && it.due_date! <= sunday);
  const lastMonday = addDays(monday, -7);
  const done = doc.home.completions
    .filter((c) => c.household_id === householdId)
    .filter((c) => {
      const day = todayIn(timeZone, new Date(c.completed_at));
      return day >= lastMonday && day < monday;
    })
    .sort((a, b) => (a.completed_at < b.completed_at ? -1 : 1));
  const when = (d: ISODate) => (d === today ? 'today' : WEEKDAY_SHORT[weekdayOf(d)]);
  const lines: string[] = [];
  if (overdue.length) lines.push(`Overdue (${overdue.length}): ${named(overdue.map((it) => it.title))}`);
  lines.push(due.length ? `Due this week (${due.length}): ${named(due.map((it) => `${clip(it.title, 60)} (${when(it.due_date!)})`))}` : 'Nothing due this week.');
  lines.push(done.length ? `Done last week (${done.length}): ${named(done.map((c) => c.item_title))}` : 'Nothing done last week.');
  return fit({
    title: household?.name.trim() ? `This week at ${household.name.trim()}` : 'This week at home',
    body: lines.join('\n'),
    url: '/',
    tag: `weekly:${monday}`,
  });
}

/** The housekeeping report for one visit: what was ticked, the comments, the price, the message left. */
export function housekeepingReport(doc: ServerDoc, visitId: string, today: ISODate): PushPayload {
  const visit = doc.home.housekeeping_visits.find((v) => v.id === visitId)!;
  const tasks = doc.home.housekeeping_visit_tasks
    .filter((t) => t.visit_id === visitId)
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  const ticked = tasks.filter((t) => t.done);
  const lines: string[] = [];
  if (tasks.length) lines.push(ticked.length ? `Done ${ticked.length} of ${tasks.length}: ${named(ticked.map((t) => t.title))}` : 'Nothing ticked.');
  if (visit.comments.trim()) lines.push(`Comments: ${clip(visit.comments, 300)}`);
  if (visit.price_pence !== null) lines.push(`Price: ${formatPrice(visit.price_pence)}`);
  if (visit.note.trim()) lines.push(`Message left: ${clip(visit.note, 200)}`);
  return fit({
    title: `Housekeeping, ${formatDay(visit.visit_date, today)}`,
    body: lines.join('\n') || 'Visit recorded.',
    url: '/',
    tag: `housekeeping:${visitId}`,
  });
}

/** Whether a visit has anything recorded (as isRecorded() in src/lib/logic/housekeeping.ts). */
function recorded(doc: ServerDoc, visitId: string): boolean {
  const visit = doc.home.housekeeping_visits.find((v) => v.id === visitId);
  if (!visit) return false;
  return (
    visit.price_pence !== null ||
    visit.comments !== '' ||
    doc.home.housekeeping_visit_tasks.some((t) => t.visit_id === visitId && t.done)
  );
}

/**
 * What the morning run sends now (`now`), in each person's household time zone. Only people
 * who have joined, ticked something, and have at least one device with a subscription:
 * - Weekly status: on Monday (or Tuesday, when Monday's run did not send it), once per week.
 * - Housekeeping report: the household's latest visit with something recorded, dated before
 *   today and at most HOUSEKEEPING_REPORT_DAYS ago, once per visit; so the morning after the
 *   visit day, or after the visit was saved when that was later. An older visit is never
 *   reported once a newer one has been.
 * - Reminders: each of their reminders whose days include today's weekday (at most
 *   REMINDERS_PER_MORNING), once per day. A day the run missed is not made up later.
 * Pure: the document is not changed (takeDue() records `sent`).
 */
export function planMorning(doc: ServerDoc, now: Date): MorningPlan {
  const notifications: PlannedNotification[] = [];
  const sent = new Map<string, NotifyPersonRow['sent']>();
  for (const row of notifyOf(doc).people) {
    if (!row.weeklyStatus && !row.housekeeping && !(row.reminders && row.list.length)) continue;
    const member = doc.home.members.find((m) => m.id === row.memberId);
    if (!member || member.user_id === null) continue;
    const to = doc.auth.devices
      .filter((d) => d.userId === member.user_id && d.push)
      .map((d) => ({ deviceId: d.id, endpoint: d.push!.endpoint, p256dh: d.push!.p256dh, auth: d.push!.auth }));
    if (!to.length) continue;
    const household = doc.home.households.find((h) => h.id === member.household_id);
    if (!household) continue;
    const timeZone = household.timezone || 'Europe/London';
    const today = todayIn(timeZone, now);
    const weekday = weekdayOf(today);
    const marks: NotifyPersonRow['sent'] = { ...row.sent };
    const add = (kind: NotificationKind, payload: PushPayload) => notifications.push({ kind, memberId: member.id, payload, to });

    if (row.weeklyStatus) {
      const monday = mondayOf(today);
      if ((weekday === 1 || weekday === 2) && row.sent.weekly !== monday) {
        add('weekly', weeklyStatus(doc, household.id, today, monday, timeZone));
        marks.weekly = monday;
      }
    }

    if (row.housekeeping) {
      const from = addDays(today, -HOUSEKEEPING_REPORT_DAYS);
      const latest = doc.home.housekeeping_visits
        .filter((v) => v.household_id === household.id && v.visit_date < today && v.visit_date >= from && recorded(doc, v.id))
        .sort((a, b) => (a.visit_date < b.visit_date ? 1 : a.visit_date > b.visit_date ? -1 : 0))[0];
      if (latest && row.sent.housekeeping !== latest.id) {
        add('housekeeping', housekeepingReport(doc, latest.id, today));
        marks.housekeeping = latest.id;
      }
    }

    if (row.reminders && row.sent.reminders !== today) {
      const due = row.list.filter((r) => r.days.includes(weekday)).slice(0, REMINDERS_PER_MORNING);
      for (const r of due) {
        add(
          'reminder',
          fit({ title: r.title, body: `Reminder for ${WEEKDAY_LONG[weekday]}`, url: '/', tag: `reminder:${r.id}:${today}` }),
        );
      }
      if (due.length) marks.reminders = today;
    }

    if (JSON.stringify(marks) !== JSON.stringify(row.sent)) sent.set(row.memberId, marks);
  }
  return { notifications, sent };
}

/**
 * planMorning(), with what it plans recorded as sent in `doc` (the morning run's write): the
 * notifications to send now. Nothing due: the document is left as it was (no put).
 */
export function takeDue(doc: ServerDoc, now: Date): PlannedNotification[] {
  const plan = planMorning(doc, now);
  if (plan.sent.size) {
    doc.notify = { people: notifyOf(doc).people.map((p) => (plan.sent.has(p.memberId) ? { ...p, sent: plan.sent.get(p.memberId)! } : p)) };
  }
  return plan.notifications;
}

// ── Sending ──────────────────────────────────────────────

/** Sends one push (the handler's ServerContext.push; tests give their own). */
export type PushSender = (subscription: PushSubscriptionKeys, payload: string, keys: VapidKeys) => Promise<WebPushResult>;

/** Web Push to the push service, over the network (fetch), with PUSH_TTL_SECONDS and PUSH_TIMEOUT_MS. */
export const webPushSender: PushSender = (subscription, payload, keys) =>
  sendWebPush(subscription, payload, keys, (input, init) => fetch(input, init), {
    ttl: PUSH_TTL_SECONDS,
    urgency: 'normal',
    timeoutMs: PUSH_TIMEOUT_MS,
  });

export interface Delivery {
  sent: number;
  failed: number;
  /** Endpoints the push service says are gone (404, 410), or that are not a push service's. */
  gone: Set<string>;
}

/** Sends every planned notification to each of its devices, all at once. Never throws. */
export async function deliver(notifications: PlannedNotification[], keys: VapidKeys, send: PushSender): Promise<Delivery> {
  const out: Delivery = { sent: 0, failed: 0, gone: new Set() };
  const jobs = notifications.flatMap((n) => n.to.map((sub) => ({ sub, payload: JSON.stringify(n.payload) })));
  const results = await Promise.allSettled(jobs.map(async (job) => send(job.sub, job.payload, keys)));
  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value.ok) out.sent += 1;
    else {
      out.failed += 1;
      if (result.status === 'fulfilled' && result.value.gone) out.gone.add(jobs[i].sub.endpoint);
      // Which push service, and its status; never the endpoint (it is a credential of sorts).
      const host = (() => {
        try {
          return new URL(jobs[i].sub.endpoint).host;
        } catch {
          return '?';
        }
      })();
      const why = result.status === 'fulfilled' ? `${result.value.status}` : (result.reason as Error)?.name ?? 'error';
      console.warn(`home.os: a notification to ${host} was not delivered (${why})`);
    }
  });
  return out;
}
