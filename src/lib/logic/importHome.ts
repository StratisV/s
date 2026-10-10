// "Bring over the home from this phone": the home a browser kept in demo mode
// (localStorage homeos.demo.v1, written by lib/backend/demo.ts) turned into the payload of the
// import_household RPC (supabase/migrations/20261010000500_one_home.sql). Pure apart from
// readDemoDoc() and markDemoImported(), which take the storage to use.
//
// docs/ARCHITECTURE.md "Bring over the home from this phone" is the contract. In short:
// - The home is the one the demo's signed-in person belongs to (doc.session); without a
//   session, the home of the earliest owner, else of the earliest person.
// - That person becomes the Google account signing in now ("me"), keeping their demo name,
//   emoji and colour. Everyone else in the home comes along as not joined yet, without the
//   demo's made-up emails.
// - Areas in order, every open and done item with all its fields and history, and every real
//   completion (Stats). The made-up history the demo adds to every new home (no item, done
//   before the home was set up) stays behind, as do chat, invites and push subscriptions.
// - Text is trimmed and cut to the database's limits, and anything the database would refuse
//   is repaired or left out (an item without a title, a done state, a completion without a
//   time), so a payload from this builder is always accepted while no home exists.
// - Afterwards the document is kept as it is, marked `imported`, so the offer never repeats.
//   Turning the offer down for good (Start Fresh then creating a home, Keep, or the notice that
//   it can't come over) marks it `declined`, which does the same.

import { TEXT_LIMITS } from '../constants';
import type {
  DemoHomeSummary,
  ImportArea,
  ImportCompletion,
  ImportItem,
  ImportPayload,
  ImportPerson,
  ISODate,
  ISOTimestamp,
  ItemKind,
  ItemStatus,
  Notify,
  Rag,
  Repeat,
  Role,
} from '../types';
import { applyKindRules } from './items';

/** Where the demo backend keeps its document (DEMO_STORAGE_KEY in lib/backend/demo.ts). */
export const DEMO_DOC_KEY = 'homeos.demo.v1';

/** The most import_household takes of each list (the migration refuses more). */
export const IMPORT_LIMITS = { people: 50, areas: 100, items: 2000, completions: 20000 } as const;

/** Stored in the demo document once the offer was turned down for good. */
export interface DemoDeclineMark {
  /** When. */
  at: ISOTimestamp;
}

/** Stored in the demo document once its home was brought over. */
export interface DemoImportMark {
  /** When it was brought over. */
  at: ISOTimestamp;
  /** The household it became. */
  household_id: string;
}

// ── The demo document as stored, as far as the import reads it ──
// Every field may be missing or of the wrong type in an old or hand-edited document, so the
// builder checks each one; only `id` is guaranteed (readDemoDoc drops rows without one).

export interface StoredHousehold {
  id: string;
  name?: unknown;
  address?: unknown;
  timezone?: unknown;
  created_at?: unknown;
}
export interface StoredMember {
  id: string;
  household_id?: unknown;
  user_id?: unknown;
  name?: unknown;
  emoji?: unknown;
  color?: unknown;
  role?: unknown;
  created_at?: unknown;
}
export interface StoredArea {
  id: string;
  household_id?: unknown;
  name?: unknown;
  position?: unknown;
  created_at?: unknown;
}
export interface StoredItem {
  id: string;
  household_id?: unknown;
  area_id?: unknown;
  kind?: unknown;
  title?: unknown;
  note?: unknown;
  good?: unknown;
  rag?: unknown;
  due_date?: unknown;
  assignee_id?: unknown;
  repeat?: unknown;
  notify?: unknown;
  status?: unknown;
  created_by?: unknown;
  updated_by?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  completed_at?: unknown;
}
export interface StoredCompletion {
  id: string;
  household_id?: unknown;
  item_id?: unknown;
  item_title?: unknown;
  credited_to?: unknown;
  completed_by?: unknown;
  completed_at?: unknown;
  prev_due_date?: unknown;
  prev_status?: unknown;
}

export interface StoredDemoDoc {
  version: 1;
  /** The demo's signed-in user id, or null. */
  session: string | null;
  households: StoredHousehold[];
  members: StoredMember[];
  areas: StoredArea[];
  items: StoredItem[];
  completions: StoredCompletion[];
  /** Set by markDemoImported(). */
  imported?: DemoImportMark;
  /** Set by markDemoDeclined(). */
  declined?: DemoDeclineMark;
}

// ── Reading and marking ──

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Rows that are objects with a string id; anything else in the list is dropped. */
function rows<T extends { id: string }>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((r): r is T => isRecord(r) && typeof r.id === 'string' && r.id !== '');
}

/**
 * The demo document in `storage` (DEMO_DOC_KEY), or null when there is none, it cannot be
 * read or parsed, or it is not version 1. Never throws.
 */
export function readDemoDoc(storage: Pick<Storage, 'getItem'> | null | undefined): StoredDemoDoc | null {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(DEMO_DOC_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== 1) return null;
  const imported = isRecord(parsed.imported) && typeof parsed.imported.household_id === 'string'
    ? { at: String(parsed.imported.at ?? ''), household_id: parsed.imported.household_id }
    : undefined;
  const declined = isRecord(parsed.declined) ? { at: String(parsed.declined.at ?? '') } : undefined;
  return {
    version: 1,
    session: typeof parsed.session === 'string' ? parsed.session : null,
    households: rows<StoredHousehold>(parsed.households),
    members: rows<StoredMember>(parsed.members),
    areas: rows<StoredArea>(parsed.areas),
    items: rows<StoredItem>(parsed.items),
    completions: rows<StoredCompletion>(parsed.completions),
    ...(imported ? { imported } : {}),
    ...(declined ? { declined } : {}),
  };
}

/**
 * Marks the stored demo document as brought over (`imported`), leaving everything else in it
 * as it is, so the offer never comes back on this browser. A document that cannot be read or
 * written is left alone (never throws).
 */
export function markDemoImported(storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined, mark: DemoImportMark): void {
  markDoc(storage, 'imported', mark);
}

/**
 * Marks the stored demo document as turned down for good (`declined`), leaving everything else
 * in it as it is, so the offer (and the notice that it can't come over) never comes back on
 * this browser. Never throws.
 */
export function markDemoDeclined(storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined, mark: DemoDeclineMark): void {
  markDoc(storage, 'declined', mark);
}

function markDoc(storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined, key: 'imported' | 'declined', mark: object) {
  try {
    const raw = storage?.getItem(DEMO_DOC_KEY);
    if (!raw) return;
    const doc: unknown = JSON.parse(raw);
    if (!isRecord(doc)) return;
    storage?.setItem(DEMO_DOC_KEY, JSON.stringify({ ...doc, [key]: mark }));
  } catch {
    /* storage unavailable or full: the offer may show again */
  }
}

// ── Values ──

/** Characters as Postgres length() counts them (code points). */
const chars = (s: string) => Array.from(s);

/** Trimmed like the database trims (spaces, tabs, line breaks). */
const trim = (s: string) => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');

/** A string, trimmed when asked, cut to `max` characters; '' for anything else. */
function text(value: unknown, max: number, trimmed = true): string {
  if (typeof value !== 'string') return '';
  const v = trimmed ? trim(value) : value;
  const cs = chars(v);
  return cs.length > max ? (trimmed ? trim(cs.slice(0, max).join('')) : cs.slice(0, max).join('')) : v;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const KINDS: readonly ItemKind[] = ['task', 'state'];
const RAGS: readonly Rag[] = ['red', 'amber', 'green'];
const REPEATS: readonly Repeat[] = ['none', 'weekly', 'monthly', 'quarterly', 'biannual', 'yearly'];
const NOTIFIES: readonly Notify[] = ['none', 'same_day', 'day_before', 'week_before'];
const STATUSES: readonly ItemStatus[] = ['open', 'done'];

/** The timestamps import_household reads (import_timestamp in the migration). */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** An ISO timestamp the database will read, passed on as it is; null for anything else. */
function timestamp(value: unknown): ISOTimestamp | null {
  return typeof value === 'string' && TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** A real calendar date `YYYY-MM-DD`; null for anything else. */
function date(value: unknown): ISODate | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? value : null;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const byCreated = (a: { created_at?: unknown; id: string }, b: { created_at?: unknown; id: string }) =>
  str(a.created_at) < str(b.created_at) ? -1 : str(a.created_at) > str(b.created_at) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

// ── Which home and who is "me" ──

interface Picked {
  household: StoredHousehold;
  me: StoredMember;
  people: StoredMember[];
}

/**
 * The home to bring over: the demo's signed-in person's, else the earliest owner's, else the
 * earliest person's (only people in a household that exists count). Null when there is none.
 */
function pick(doc: StoredDemoDoc): Picked | null {
  const households = new Map(doc.households.map((h) => [h.id, h]));
  const members = doc.members.filter((m) => typeof m.household_id === 'string' && households.has(m.household_id)).sort(byCreated);
  const me =
    (doc.session ? members.find((m) => m.user_id === doc.session) : undefined) ??
    members.find((m) => (m.role as Role | undefined) === 'owner') ??
    members[0];
  if (!me) return null;
  const household = households.get(me.household_id as string)!;
  let people = members.filter((m) => m.household_id === household.id);
  if (people.length > IMPORT_LIMITS.people) {
    // "me" always comes along; then the earliest others.
    const others = people.filter((m) => m.id !== me.id).slice(0, IMPORT_LIMITS.people - 1);
    people = people.filter((m) => m.id === me.id || others.includes(m));
  }
  return { household, me, people };
}

/**
 * What the offer shows: the demo home this browser holds. Null when there is nothing to bring
 * over (no document, no home in it), it was brought over already (`imported`), or the offer
 * was turned down for good (`declined`).
 */
export function demoHomeSummary(doc: StoredDemoDoc | null): DemoHomeSummary | null {
  if (!doc || doc.imported || doc.declined) return null;
  const payload = buildImportPayload(doc);
  if (!payload) return null;
  return {
    householdName: payload.household.name,
    address: payload.household.address,
    areas: payload.areas.length,
    items: payload.items.filter((i) => i.status === 'open').length,
    done: payload.completions.length,
    people: payload.people.map((p) => ({ name: p.name, emoji: p.emoji, me: p.me === true })),
  };
}

/**
 * Whether `home` (as loaded) is the home in `doc` brought over already: same name, the same
 * areas in the same order, everyone from the phone there by name, and the same open items.
 * For an import whose reply was lost (the document was never marked): it must not be offered,
 * or said to be stuck on the phone, again.
 */
export function demoHomeMatches(
  doc: StoredDemoDoc | null,
  home: {
    household: { name: string };
    areas: { name: string }[];
    members: { name: string }[];
    items: { title: string }[];
  },
): boolean {
  const payload = doc ? buildImportPayload(doc) : null;
  if (!payload) return false;
  const lower = (v: string) => v.trim().toLowerCase();
  const sorted = (titles: string[]) => titles.map(lower).sort().join('\n');
  const names = new Set(home.members.map((m) => lower(m.name)));
  return (
    lower(payload.household.name) === lower(home.household.name) &&
    payload.areas.map((a) => lower(a.name)).join('\n') === home.areas.map((a) => lower(a.name)).join('\n') &&
    payload.people.every((p) => names.has(lower(p.name))) &&
    sorted(payload.items.filter((i) => i.status === 'open').map((i) => i.title)) === sorted(home.items.map((i) => i.title))
  );
}

/**
 * The made-up Stats history the demo adds to every home it sets up (DemoBackend addHistory):
 * not linked to an item, and done no later than the home was set up. Anything really done in
 * the demo was done after that (and was linked to its item, until the item was deleted).
 */
function seededHistory(c: StoredCompletion, householdCreated: number): boolean {
  if (typeof c.item_id === 'string' && c.item_id !== '') return false;
  if (Number.isNaN(householdCreated)) return false;
  const at = typeof c.completed_at === 'string' ? Date.parse(c.completed_at) : NaN;
  return !Number.isNaN(at) && at <= householdCreated;
}

/**
 * The import_household payload for the demo home in `doc` (see the top of this file), or null
 * when the document holds no home. Deterministic: the same document always gives the same
 * payload. Keys are p1… for people (join order), a1… for areas (their order) and i1… for
 * items (oldest first).
 */
export function buildImportPayload(doc: StoredDemoDoc): ImportPayload | null {
  const picked = pick(doc);
  if (!picked) return null;
  const { household, me } = picked;

  const personKey = new Map<string, string>();
  const people: ImportPerson[] = picked.people.map((m, i) => {
    const key = `p${i + 1}`;
    personKey.set(m.id, key);
    const emoji = text(m.emoji, Number.MAX_SAFE_INTEGER);
    const person: ImportPerson = {
      key,
      name: text(m.name, TEXT_LIMITS.memberName) || 'Someone',
      emoji: emoji && chars(emoji).length <= TEXT_LIMITS.memberEmoji ? emoji : '🦔',
    };
    if (typeof m.color === 'string' && HEX.test(m.color)) person.color = m.color;
    if (m.id === me.id) person.me = true;
    return person;
  });
  const personRef = (id: unknown): string | null => (typeof id === 'string' ? (personKey.get(id) ?? null) : null);

  const areaKey = new Map<string, string>();
  const areas: ImportArea[] = doc.areas
    .filter((a) => a.household_id === household.id)
    .sort((a, b) => {
      const pa = typeof a.position === 'number' ? a.position : Number.MAX_SAFE_INTEGER;
      const pb = typeof b.position === 'number' ? b.position : Number.MAX_SAFE_INTEGER;
      return pa - pb || byCreated(a, b);
    })
    .slice(0, IMPORT_LIMITS.areas)
    .map((a, i) => {
      const key = `a${i + 1}`;
      areaKey.set(a.id, key);
      return { key, name: text(a.name, TEXT_LIMITS.areaName) || 'Area' };
    });

  const itemKey = new Map<string, string>();
  const items: ImportItem[] = [];
  // Over the limit (never in practice): the open items first, then the most recently done.
  let stored = doc.items.filter((i) => i.household_id === household.id);
  if (stored.length > IMPORT_LIMITS.items) {
    const open = stored.filter((i) => i.status !== 'done');
    const done = stored.filter((i) => i.status === 'done').sort((a, b) => byCreated(b, a));
    stored = [...open, ...done].slice(0, IMPORT_LIMITS.items);
  }
  for (const it of stored.sort(byCreated)) {
    const area = typeof it.area_id === 'string' ? areaKey.get(it.area_id) : undefined;
    const title = text(it.title, TEXT_LIMITS.itemTitle);
    const kind = oneOf(it.kind, KINDS, 'task');
    const status = oneOf(it.status, STATUSES, 'open');
    // No area, no title, or a done state (a state is never done): the database would refuse it.
    if (!area || !title || (kind === 'state' && status === 'done')) continue;
    const key = `i${items.length + 1}`;
    itemKey.set(it.id, key);
    items.push(
      applyKindRules({
        key,
        area,
        kind,
        title,
        note: text(it.note, TEXT_LIMITS.itemNote, false),
        good: text(it.good, TEXT_LIMITS.itemGood, false),
        rag: oneOf(it.rag, RAGS, 'amber'),
        due_date: date(it.due_date),
        repeat: oneOf(it.repeat, REPEATS, 'none'),
        notify: oneOf(it.notify, NOTIFIES, 'day_before'),
        status,
        assignee: personRef(it.assignee_id),
        created_by: personRef(it.created_by),
        updated_by: personRef(it.updated_by),
        created_at: timestamp(it.created_at),
        updated_at: timestamp(it.updated_at),
        completed_at: status === 'done' ? timestamp(it.completed_at) : null,
      }),
    );
  }

  const completions: ImportCompletion[] = [];
  const byCompleted = (a: StoredCompletion, b: StoredCompletion) =>
    str(a.completed_at) < str(b.completed_at) ? -1 : str(a.completed_at) > str(b.completed_at) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const householdCreated = typeof household.created_at === 'string' ? Date.parse(household.created_at) : NaN;
  for (const c of doc.completions.filter((x) => x.household_id === household.id).sort(byCompleted)) {
    // The demo's made-up history stays behind (it would read as real in Stats).
    if (seededHistory(c, householdCreated)) continue;
    const title = text(c.item_title, TEXT_LIMITS.itemTitle);
    const completedAt = timestamp(c.completed_at);
    if (!title || !completedAt) continue;
    completions.push({
      item: typeof c.item_id === 'string' ? (itemKey.get(c.item_id) ?? null) : null,
      item_title: title,
      credited_to: personRef(c.credited_to),
      completed_by: personRef(c.completed_by),
      completed_at: completedAt,
      prev_due_date: date(c.prev_due_date),
      prev_status: oneOf(c.prev_status, STATUSES, 'open'),
    });
  }
  // Over the limit (never in practice): the most recent ones.
  if (completions.length > IMPORT_LIMITS.completions) completions.splice(0, completions.length - IMPORT_LIMITS.completions);

  return {
    version: 1,
    household: {
      name: text(household.name, TEXT_LIMITS.householdName) || 'Our home',
      address: text(household.address, TEXT_LIMITS.address),
      timezone: text(household.timezone, 100) || 'Europe/London',
    },
    people,
    areas,
    items,
    completions,
  };
}
