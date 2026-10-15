// "Bring this home online" (server mode): the home a browser kept in demo mode (localStorage
// homeos.demo.v1) turned into the server's home document. Pure and deterministic for a given
// `now` and `newId`. The browser calls serverSetupSummary() for the setup screen, and the server
// (server/core/setup.ts) calls buildServerHome() on the same raw string, so what the screen
// promises is what comes along. docs/ARCHITECTURE.md "Server mode (no setup)", "Setup".
//
// What comes along, and what stays behind (on top of buildImportPayloadWithIds(), whose rules
// apply unchanged: the made-up Stats history stays behind, text is cut to the limits, anything
// the database would refuse is repaired or left out):
//
// - The household: name, address, time zone (an unknown zone becomes Europe/London); weekly
//   email Monday 08:00; created_at, updated_at = now; updated_by null.
// - People: `me` (the payload's) becomes the owner, signed in as `ownerUserId`, email ''.
//   Everyone else comes as not joined yet (user_id null, email '', push off, weekly email on,
//   role member), with their name, emoji and colour (MEMBER_COLORS by position when the payload
//   has none). Join order kept: created_at = now + index ms. claimed_at null for all.
//   Left behind: a person the demo made up (DemoBackend's DEMO_PEOPLE: user_id
//   `demo-user-<key>-…`) whom nothing that comes along refers to: no item assigned, created or
//   updated by them, no completion credited to or completed by them, no message or reaction
//   from them, nothing in housekeeping by them. So a demo housemate the household used (Shea,
//   with her items) comes along, and one nobody used (Ela) does not. `me` always comes along.
// - Areas in order (position 0…n-1, created_at = now + index ms).
// - Items, open and done, every field (kind, title, note, good, rag, due date, repeat, notify,
//   status, assignee, created and updated by, created, updated and completed times), each time
//   no later than now (missing: now), the kind rules applied (applyKindRules).
// - Completions: the payload's (real ones only), linked to their new items.
// - Chat: the messages written after the household was set up on the phone (created_at later
//   than the stored household's created_at; the demo's made-up conversation is dated before
//   it), body trimmed and 1 to TEXT_LIMITS.chatMessage characters (else left out), created_at a
//   timestamp no later than now (else left out), sender mapped (someone who does not come
//   along: null, "Former member"). Their reactions by people who come along, emoji one of
//   REACTION_EMOJIS, once per (message, person, emoji). At most the newest 5000 messages.
// - Housekeeping: the task list's sections as they are (names 1 to 40 characters, at most
//   HOUSEKEEPING_SECTIONS_MAX, positions 0…n-1 in their order; none in a document from before
//   sections) and the task list as it is (titles 1 to 200 characters, each in its section, or in
//   none when that section does not come along, positions 0…n-1 within each section in the
//   list's order; a document without the housekeeping_tasks key gets HOUSEKEEPING_STARTER_TASKS,
//   as DemoBackend.read() does); the message for the housekeeper if it was written after the
//   household was set up (else none: the demo's is made up), without its Clear/Undo copy; the
//   visits created after the household was set up (the demo's seeded visits are dated before),
//   one per date, never after today in the household's time zone, with their rows (task_id
//   mapped to the new task, or null; section_id to the new section, or null; the section's
//   name as stored), ticks, comments and price as stored, within the limits (else the value is
//   cut or, for a price, cleared). At most 2000 visits (the newest).
// - Not: invites, push subscriptions, users, the session, the `imported`/`declined` marks.
//
// Every row gets a fresh id from `newId`; nothing from the document is used as an id.

import { emptyDoc, type DemoDoc, type MemberRow, type ReactionRow } from '../backend/demo';
import {
  HOUSEKEEPING_PRICE_MAX_PENCE,
  HOUSEKEEPING_SECTIONS_MAX,
  HOUSEKEEPING_STARTER_TASKS,
  MEMBER_COLORS,
  REACTION_EMOJIS,
  TEXT_LIMITS,
} from '../constants';
import type { ISODate, ISOTimestamp, ServerSetupSummary } from '../types';
import { todayIn } from './dates';
import { buildImportPayloadWithIds, readDemoDoc } from './importHome';
import { applyKindRules } from './items';

export interface BuildServerHomeOptions {
  now: Date;
  /** The user id the owner signs in as (members.user_id of `me`); the server makes it. */
  ownerUserId: string;
  /** Fresh ids. Default crypto.randomUUID(). */
  newId?: () => string;
}

export interface ServerHome {
  /** The home as DemoBackend stores it, with `session` null and `users`, `invites`, `push_subs` empty. */
  home: DemoDoc;
  householdId: string;
  /** The owner's member id (`me`). */
  ownerMemberId: string;
  summary: ServerSetupSummary;
}

/** The most messages and visits that come along (the newest). */
export const SERVER_IMPORT_LIMITS = { messages: 5000, visits: 2000 } as const;

/** A person DemoBackend made up for every new demo home (DEMO_PEOPLE): user_id `demo-user-<key>-<household>`. */
const MADE_UP_USER = /^demo-user-(shea|ela)-/;

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const rowsOf = (v: unknown): Row[] => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const chars = (s: string) => Array.from(s);
/** Trimmed like the database trims (spaces, tabs, line breaks). */
const trim = (s: string) => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
/** A string trimmed, then cut to `max` characters (code points) and trimmed again; '' for anything else. */
function cut(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const cs = chars(trim(value));
  return cs.length > max ? trim(cs.slice(0, max).join('')) : cs.join('');
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}(:?\d{2})?)$/;
/** A timestamp's time (ms), or NaN for anything that is not one. */
function timeOf(value: unknown): number {
  return typeof value === 'string' && TIMESTAMP.test(value) ? Date.parse(value) : NaN;
}
const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
function isDate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  return d <= [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

function isValidZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function defaultId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // No secure context (never on the server): ids only need to be unique in the document.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The server's home from `raw` (the homeos.demo.v1 string as the browser stores it), or null
 * when it holds no home (not JSON, not version 1, no household with a person in it). Never
 * throws for any input.
 */
export function buildServerHome(raw: string, opts: BuildServerHomeOptions): ServerHome | null {
  try {
    return build(raw, opts);
  } catch {
    return null;
  }
}

function build(raw: string, opts: BuildServerHomeOptions): ServerHome | null {
  if (typeof raw !== 'string' || !raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.version !== 1) return null;
  const stored = readDemoDoc({ getItem: () => raw });
  if (!stored) return null;
  const built = buildImportPayloadWithIds(stored);
  if (!built) return null;
  const { payload, ids } = built;
  const newId = opts.newId ?? defaultId;
  const nowMs = opts.now.getTime();
  const nowIso = opts.now.toISOString();
  /** A stored time no later than now; `fallback` (now) when it is not a time. */
  const clamp = (value: unknown, fallback: ISOTimestamp = nowIso): ISOTimestamp => {
    const t = timeOf(value);
    return Number.isNaN(t) ? fallback : t > nowMs ? nowIso : (value as string);
  };
  const at = (offsetMs: number) => new Date(nowMs + offsetMs).toISOString();

  const storedHousehold = stored.households.find((h) => h.id === ids.household)!;
  const setUp = timeOf(storedHousehold.created_at);
  /** Written on the phone after its home was set up (the demo's made-up rows are dated before). */
  const afterSetUp = (value: unknown) => {
    const t = timeOf(value);
    return !Number.isNaN(t) && (Number.isNaN(setUp) || t > setUp);
  };
  const timezone = isValidZone(payload.household.timezone) ? payload.household.timezone : 'Europe/London';
  const today = todayIn(timezone, opts.now);

  // ── Who is who: stored member id ↔ payload key ──
  const keyOfStored = ids.people;
  const storedOfKey = new Map([...keyOfStored].map(([id, key]) => [key, id]));
  const storedMembers = new Map(stored.members.map((m) => [m.id, m]));
  const payloadPerson = (storedId: unknown) => (typeof storedId === 'string' ? keyOfStored.get(storedId) : undefined);

  // ── Chat and housekeeping as stored (only this home's rows) ──
  const householdOf = (r: Row) => r.household_id === ids.household;
  const messageRows = rowsOf(parsed.messages)
    .filter((m) => householdOf(m) && typeof m.id === 'string' && afterSetUp(m.created_at) && timeOf(m.created_at) <= nowMs)
    .map((m) => ({ row: m, body: cut(m.body, Number.MAX_SAFE_INTEGER) }))
    .filter(({ body }) => body !== '' && chars(body).length <= TEXT_LIMITS.chatMessage)
    .sort((a, b) => timeOf(a.row.created_at) - timeOf(b.row.created_at) || (str(a.row.id) < str(b.row.id) ? -1 : 1))
    .slice(-SERVER_IMPORT_LIMITS.messages);
  const messageIds = new Set(messageRows.map(({ row }) => row.id as string));
  const reactionRows = rowsOf(parsed.message_reactions).filter(
    (r) =>
      typeof r.message_id === 'string' &&
      messageIds.has(r.message_id) &&
      payloadPerson(r.member_id) !== undefined &&
      typeof r.emoji === 'string' &&
      (REACTION_EMOJIS as readonly string[]).includes(r.emoji),
  );

  /** Rows in their order: `rank` (a task's section), then position, created_at, id. */
  const inOrder =
    (rank: (r: Row) => number = () => 0) =>
    (a: Row, b: Row) =>
      rank(a) - rank(b) ||
      (typeof a.position === 'number' ? a.position : 0) - (typeof b.position === 'number' ? b.position : 0) ||
      (str(a.created_at) < str(b.created_at) ? -1 : str(a.created_at) > str(b.created_at) ? 1 : 0) ||
      (str(a.id) < str(b.id) ? -1 : 1);
  const sectionRows = rowsOf(parsed.housekeeping_sections)
    .filter((s) => householdOf(s) && typeof s.id === 'string')
    .sort(inOrder())
    .map((s) => ({ row: s, title: cut(s.title, TEXT_LIMITS.housekeepingSection) }))
    .filter(({ title }) => title !== '')
    .slice(0, HOUSEKEEPING_SECTIONS_MAX);
  const sectionRank = new Map(sectionRows.map(({ row }, i) => [row.id as string, i + 1]));
  /** Where a task's section comes (0: none, or one that does not come along). */
  const rankOf = (t: Row) => (typeof t.section_id === 'string' ? (sectionRank.get(t.section_id) ?? 0) : 0);
  const hasTaskList = Array.isArray(parsed.housekeeping_tasks);
  const taskRows = rowsOf(parsed.housekeeping_tasks)
    .filter((t) => householdOf(t) && typeof t.id === 'string')
    .sort(inOrder(rankOf))
    .map((t) => ({ row: t, title: cut(t.title, TEXT_LIMITS.housekeepingTask) }))
    .filter(({ title }) => title !== '');
  const noteRow = rowsOf(parsed.housekeeping_notes).find((n) => householdOf(n) && afterSetUp(n.updated_at));
  const visitRows: Row[] = [];
  {
    const seenDates = new Set<string>();
    const candidates = rowsOf(parsed.housekeeping_visits)
      .filter((v) => householdOf(v) && typeof v.id === 'string' && afterSetUp(v.created_at) && isDate(v.visit_date) && v.visit_date <= today)
      .sort((a, b) => timeOf(a.created_at) - timeOf(b.created_at) || (str(a.id) < str(b.id) ? -1 : 1));
    for (const v of candidates) {
      if (seenDates.has(v.visit_date as string)) continue;
      seenDates.add(v.visit_date as string);
      visitRows.push(v);
    }
    visitRows.sort((a, b) => (str(a.visit_date) < str(b.visit_date) ? -1 : 1));
    visitRows.splice(0, Math.max(0, visitRows.length - SERVER_IMPORT_LIMITS.visits));
  }
  const visitIds = new Set(visitRows.map((v) => v.id as string));
  const visitTaskRows = rowsOf(parsed.housekeeping_visit_tasks).filter(
    (r) => typeof r.id === 'string' && typeof r.visit_id === 'string' && visitIds.has(r.visit_id) && cut(r.title, TEXT_LIMITS.housekeepingTask) !== '',
  );

  // ── Who comes along: everyone, except someone the demo made up whom nothing coming along refers to ──
  const referenced = new Set<string>();
  const refKey = (key: string | null) => {
    if (key) referenced.add(key);
  };
  const refStored = (id: unknown) => refKey(payloadPerson(id) ?? null);
  for (const item of payload.items) [item.assignee, item.created_by, item.updated_by].forEach(refKey);
  for (const c of payload.completions) [c.credited_to, c.completed_by].forEach(refKey);
  for (const { row } of messageRows) refStored(row.member_id);
  for (const r of reactionRows) refStored(r.member_id);
  if (noteRow) refStored(noteRow.updated_by);
  for (const v of visitRows) [v.created_by, v.updated_by].forEach(refStored);
  for (const r of visitTaskRows) if (r.done === true) refStored(r.done_by);
  const comes = payload.people.filter((p) => {
    if (p.me) return true;
    const member = storedMembers.get(storedOfKey.get(p.key) ?? '');
    const madeUp = MADE_UP_USER.test(str(member?.user_id));
    return !madeUp || referenced.has(p.key);
  });

  // ── The household ──
  const householdId = newId();
  const home: DemoDoc = emptyDoc();
  home.households.push({
    id: householdId,
    name: payload.household.name,
    address: payload.household.address,
    timezone,
    weekly_email_day: 1,
    weekly_email_time: '08:00',
    created_at: nowIso,
    updated_at: nowIso,
    updated_by: null,
  });

  // ── People ──
  const memberOfKey = new Map<string, string>();
  let ownerMemberId = '';
  comes.forEach((p, i) => {
    const id = newId();
    memberOfKey.set(p.key, id);
    if (p.me) ownerMemberId = id;
    const member: MemberRow = {
      id,
      household_id: householdId,
      user_id: p.me ? opts.ownerUserId : null,
      name: p.name,
      email: '',
      emoji: p.emoji,
      color: p.color ?? MEMBER_COLORS[i % MEMBER_COLORS.length],
      role: p.me ? 'owner' : 'member',
      weekly_email: true,
      push_enabled: false,
      created_at: at(i),
      claimed_at: null,
    };
    home.members.push(member);
  });
  const person = (key: string | null): string | null => (key ? (memberOfKey.get(key) ?? null) : null);
  const personOfStored = (id: unknown): string | null => person(payloadPerson(id) ?? null);

  // ── Areas, items, completions ──
  const areaOfKey = new Map<string, string>();
  payload.areas.forEach((a, i) => {
    const id = newId();
    areaOfKey.set(a.key, id);
    home.areas.push({ id, household_id: householdId, name: a.name, position: i, created_at: at(i) });
  });
  const itemOfKey = new Map<string, string>();
  for (const it of payload.items) {
    const areaId = areaOfKey.get(it.area);
    if (!areaId) continue;
    const id = newId();
    itemOfKey.set(it.key, id);
    home.items.push(
      applyKindRules({
        id,
        household_id: householdId,
        area_id: areaId,
        kind: it.kind,
        title: it.title,
        note: it.note,
        good: it.good,
        rag: it.rag,
        due_date: it.due_date,
        assignee_id: person(it.assignee),
        repeat: it.repeat,
        notify: it.notify,
        status: it.status,
        created_by: person(it.created_by) ?? ownerMemberId,
        updated_by: person(it.updated_by) ?? ownerMemberId,
        created_at: clamp(it.created_at),
        updated_at: clamp(it.updated_at),
        completed_at: it.status === 'done' ? clamp(it.completed_at) : null,
      }),
    );
  }
  for (const c of payload.completions) {
    home.completions.push({
      id: newId(),
      household_id: householdId,
      item_id: c.item ? (itemOfKey.get(c.item) ?? null) : null,
      item_title: c.item_title,
      credited_to: person(c.credited_to),
      completed_by: person(c.completed_by),
      completed_at: clamp(c.completed_at),
      prev_due_date: c.prev_due_date,
      prev_status: c.prev_status,
    });
  }

  // ── Chat ──
  const messageOf = new Map<string, string>();
  for (const { row, body } of messageRows) {
    const id = newId();
    messageOf.set(row.id as string, id);
    home.messages.push({
      id,
      household_id: householdId,
      member_id: personOfStored(row.member_id),
      body,
      created_at: row.created_at as string,
    });
  }
  const reactionSeen = new Set<string>();
  for (const r of reactionRows) {
    const messageId = messageOf.get(r.message_id as string);
    const memberId = personOfStored(r.member_id);
    if (!messageId || !memberId) continue;
    const key = `${messageId}\n${memberId}\n${r.emoji as string}`;
    if (reactionSeen.has(key)) continue;
    reactionSeen.add(key);
    const reaction: ReactionRow = {
      message_id: messageId,
      member_id: memberId,
      household_id: householdId,
      emoji: r.emoji as string,
      created_at: clamp(r.created_at),
    };
    home.message_reactions.push(reaction);
  }

  // ── Housekeeping ──
  const sectionOf = new Map<string, string>();
  sectionRows.forEach(({ row, title }, i) => {
    const id = newId();
    sectionOf.set(row.id as string, id);
    home.housekeeping_sections.push({ id, household_id: householdId, title, position: i, created_at: at(i) });
  });
  /** The new id of a section that comes along, else null (no section). */
  const sectionIdOf = (from: unknown): string | null => (typeof from === 'string' ? (sectionOf.get(from) ?? null) : null);
  const taskOf = new Map<string, string>();
  const titles = hasTaskList
    ? taskRows.map(({ row, title }) => ({ from: row.id as string, title, section: sectionIdOf(row.section_id) }))
    : HOUSEKEEPING_STARTER_TASKS.map((title) => ({ from: '', title, section: null }));
  /** Positions run 0…n-1 within each section (and within no section), in the list's order. */
  const next = new Map<string | null, number>();
  titles.forEach(({ from, title, section }, i) => {
    const id = newId();
    if (from) taskOf.set(from, id);
    const position = next.get(section) ?? 0;
    next.set(section, position + 1);
    home.housekeeping_tasks.push({ id, household_id: householdId, title, section_id: section, position, created_at: at(i) });
  });
  if (noteRow) {
    home.housekeeping_notes.push({
      household_id: householdId,
      body: cut(noteRow.body, TEXT_LIMITS.housekeepingNote),
      updated_at: clamp(noteRow.updated_at),
      updated_by: personOfStored(noteRow.updated_by),
      cleared_body: null,
      cleared_updated_at: null,
      cleared_updated_by: null,
    });
  }
  const visitOf = new Map<string, string>();
  for (const v of visitRows) {
    const id = newId();
    visitOf.set(v.id as string, id);
    const price = v.price_pence;
    home.housekeeping_visits.push({
      id,
      household_id: householdId,
      visit_date: v.visit_date as ISODate,
      note: cut(v.note, TEXT_LIMITS.housekeepingNote),
      comments: cut(v.comments, TEXT_LIMITS.housekeepingComments),
      price_pence:
        typeof price === 'number' && Number.isInteger(price) && price >= 0 && price <= HOUSEKEEPING_PRICE_MAX_PENCE ? price : null,
      created_by: personOfStored(v.created_by),
      created_at: clamp(v.created_at),
      updated_by: personOfStored(v.updated_by),
      updated_at: clamp(v.updated_at, clamp(v.created_at)),
    });
  }
  const visitTaskSeen = new Set<string>();
  visitTaskRows.forEach((r, i) => {
    const visitId = visitOf.get(r.visit_id as string)!;
    const taskId = typeof r.task_id === 'string' ? (taskOf.get(r.task_id) ?? null) : null;
    if (taskId) {
      const key = `${visitId}\n${taskId}`;
      if (visitTaskSeen.has(key)) return;
      visitTaskSeen.add(key);
    }
    const done = r.done === true;
    home.housekeeping_visit_tasks.push({
      id: newId(),
      visit_id: visitId,
      household_id: householdId,
      task_id: taskId,
      title: cut(r.title, TEXT_LIMITS.housekeepingTask),
      // The section the row had: the new one when it comes along; its name either way.
      section_id: sectionIdOf(r.section_id),
      section_title: cut(r.section_title, TEXT_LIMITS.housekeepingSection),
      position: typeof r.position === 'number' && Number.isInteger(r.position) ? r.position : i,
      done,
      done_by: done ? personOfStored(r.done_by) : null,
      done_at: done ? clamp(r.done_at) : null,
    });
  });

  const summary: ServerSetupSummary = {
    householdName: payload.household.name,
    address: payload.household.address,
    areas: home.areas.length,
    items: home.items.filter((i) => i.status === 'open').length,
    done: home.completions.length,
    people: comes.map((p) => ({ name: p.name, emoji: p.emoji, me: p.me === true })),
    messages: home.messages.length,
    visits: home.housekeeping_visits.length,
    lastChanged: newestOf([
      ...home.items.flatMap((i) => [i.updated_at, i.completed_at]),
      ...home.completions.map((c) => c.completed_at),
      ...home.messages.map((m) => m.created_at),
      ...home.housekeeping_visits.map((v) => v.updated_at),
      ...home.housekeeping_notes.map((n) => n.updated_at),
    ]),
  };
  return { home, householdId, ownerMemberId, summary };
}

/** The latest of these times (ISO), or null. */
function newestOf(times: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const t of times) {
    const ms = typeof t === 'string' ? Date.parse(t) : NaN;
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = new Date(ms).toISOString();
    }
  }
  return best;
}

/**
 * What "Bring this home online" shows for `raw`: buildServerHome()'s summary (same rules), or
 * null when there is nothing to bring. Ignores the document's `imported` and `declined` marks
 * (a home brought to Supabase or turned down there can still come online here). Never throws.
 */
export function serverSetupSummary(raw: string | null, now: Date = new Date()): ServerSetupSummary | null {
  if (!raw) return null;
  let n = 0;
  return buildServerHome(raw, { now, ownerUserId: 'u-summary', newId: () => `s${++n}` })?.summary ?? null;
}
