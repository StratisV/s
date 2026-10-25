// Demo backend: the whole database lives in one JSON document in localStorage,
// so the app runs with no Supabase project (local dev, previews, e2e tests).
// Semantics mirror the SQL RPCs, triggers and RLS in docs/ARCHITECTURE.md.
//
// URL switches (read once at start-up, the URL is left alone):
//   ?demo-seed=1   wipe, sign in as Stratis, and recreate the prototype household
//                  (SEED_ITEMS plus DEMO_CALENDAR_ITEMS)
//   ?demo-reset=1  wipe everything (signed out, no household)

import {
  DEFAULT_ADDRESS,
  DEFAULT_AREAS,
  DEMO_CALENDAR_ITEMS,
  GOALS_DEMO,
  GOALS_PER_WEEK_MAX,
  HOUSEKEEPING_DEMO_NOTE,
  HOUSEKEEPING_DEMO_VISITS,
  HOUSEKEEPING_PRICE_MAX_PENCE,
  HOUSEKEEPING_SECTIONS_MAX,
  HOUSEKEEPING_STARTER_TASKS,
  MEMBER_COLORS,
  SEED_ITEMS,
  TEXT_LIMITS,
  type DemoPersonKey,
} from '../constants';
import { addDays, addMonths, daysBetween, deviceTimeZone, parseISODate, todayIn, zonedParts } from '../logic/dates';
import {
  byGoalOrder,
  isGoalsToken,
  isWeekStart,
  newGoalsToken,
  publicGoalsOf,
  sameToken,
  shiftWeek,
  toBringOver,
  weekStart,
} from '../logic/goals';
import { emptyHousekeeping } from '../logic/housekeeping';
import { applyKindRules, nextDueDate } from '../logic/items';
import { hasJoined, isValidEmail, normaliseEmail } from '../logic/people';
import type {
  Area,
  AuthUser,
  Completion,
  CreateHouseholdInput,
  Goal,
  GoalsData,
  GoalsLink,
  HomeEntry,
  Household,
  HouseholdData,
  HousekeepingData,
  HousekeepingSection,
  HousekeepingTask,
  HousekeepingTickTarget,
  HousekeepingVisit,
  HousekeepingVisitPatch,
  HousekeepingVisitTask,
  ImportPayload,
  InvitePreview,
  ISODate,
  ISOTimestamp,
  Item,
  ItemDraft,
  ItemKind,
  ItemStatus,
  JoinHouseholdInput,
  Member,
  NewPersonInput,
  PublicGoals,
  PushSubscriptionInput,
} from '../types';
import type { DemoImportMark } from '../logic/importHome';
import {
  BackendError,
  type Backend,
  type HouseholdPatch,
  type ItemPatch,
  type MemberPatch,
  type Unsubscribe,
} from './types';

export const DEMO_STORAGE_KEY = 'homeos.demo.v1';

/** The Google account the demo signs in with. */
export const DEMO_USER: AuthUser = { id: 'demo-user-stratis', email: 'stratis@example.com', name: 'Stratis' };

/** Housemates every demo household comes with (after the creator, in join order). */
const DEMO_PEOPLE = [
  { key: 'shea', name: 'Shea', emoji: '🦆', color: '#AF52DE', email: 'shea@example.com' },
  { key: 'ela', name: 'Ela', emoji: '🦊', color: '#30B0C7', email: 'ela@example.com' },
] as const;

type DemoPerson = DemoPersonKey;

/** Completions credited to each person so Stats matches the prototype. */
const HISTORY_TOTALS: Record<DemoPerson, { month: number; lifetime: number }> = {
  me: { month: 4, lifetime: 58 },
  shea: { month: 2, lifetime: 37 },
  ela: { month: 1, lifetime: 16 },
};

/**
 * This month's completions, newest first. Days back from today are
 * preferences: they are pulled in so nothing lands before the 1st.
 */
const RECENT_HISTORY: { who: DemoPerson; title: string; daysBack: number; hour: number; minute: number }[] = [
  { who: 'ela', title: 'Install the new firepit', daysBack: 2, hour: 18, minute: 20 },
  { who: 'me', title: 'Kitchen paper', daysBack: 3, hour: 10, minute: 5 },
  { who: 'shea', title: 'Bleed the radiators', daysBack: 5, hour: 11, minute: 45 },
  { who: 'me', title: 'Restock dishwasher tablets', daysBack: 6, hour: 19, minute: 30 },
  { who: 'me', title: 'Test the smoke alarms', daysBack: 8, hour: 9, minute: 15 },
  { who: 'shea', title: 'Clean the shower screen', daysBack: 11, hour: 17, minute: 50 },
  { who: 'me', title: 'Water the plants', daysBack: 14, hour: 12, minute: 40 },
];

const HISTORY_TITLES = [
  'Bleed the radiators',
  'Kitchen paper',
  'Clean the oven',
  'Descale the kettle',
  'Mow the lawn',
  'Clear the gutters',
  'Change the filter',
  'Test the smoke alarms',
  'Olive oil',
  'Defrost the freezer',
  'Clean the extractor fan',
  'Water the plants',
  'Wash the windows',
  'Sweep the patio',
  'Unblock the kitchen sink',
  'Oil the garden furniture',
  'Replace the hallway bulb',
  'Clean the shower screen',
  'Empty the dehumidifier',
  'Check the boiler pressure',
  'Weed the front garden',
  'Wash the cushion covers',
  'Hoover under the beds',
  'Restock dishwasher tablets',
  'Water test strips',
  'Trim the hedges',
];

/** Months of older history before the current one (the prototype says "since March 2026" in October). */
const HISTORY_MONTHS = 7;

// ── Stored rows (SQL columns, including the ones the UI types leave out) ──
// Exported for the server (server/), which keeps the same document for the home it holds.

export interface HouseholdRow extends Household {
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;
  updated_by: string | null;
}
export interface AreaRow extends Area {
  created_at: ISOTimestamp;
}
export interface ItemRow extends Item {
  completed_at: ISOTimestamp | null;
}
export interface CompletionRow extends Completion {
  prev_due_date: ISODate | null;
  prev_status: ItemStatus;
}
export interface InviteRow {
  id: string;
  household_id: string;
  token: string;
  created_by: string | null;
  created_at: ISOTimestamp;
  expires_at: ISOTimestamp;
}
export interface PushSubRow {
  id: string;
  member_id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: ISOTimestamp;
}
/** housekeeping_notes: one row per household (primary key household_id); none = never written. */
export interface HousekeepingNoteRow {
  household_id: string;
  body: string;
  updated_at: ISOTimestamp;
  updated_by: string | null;
  /** What the last Clear took away, for Undo; null (or absent, in older documents) otherwise. */
  cleared_body?: string | null;
  cleared_updated_at?: ISOTimestamp | null;
  cleared_updated_by?: string | null;
}
/** housekeeping_sections: the task list's sections. */
export interface HousekeepingSectionRow extends HousekeepingSection {
  created_at: ISOTimestamp;
}
/** housekeeping_tasks; section_id is null (or missing, in documents from before sections) for none. */
export interface HousekeepingTaskRow extends HousekeepingTask {
  created_at: ISOTimestamp;
}
/** housekeeping_visits (unique household_id + visit_date); its tasks are separate rows. */
export type HousekeepingVisitRow = Omit<HousekeepingVisit, 'tasks'>;
/**
 * housekeeping_visit_tasks (unique visit_id + task_id); household_id is copied from the visit.
 * section_id and section_title are missing in documents from before sections (none: null, '').
 */
export type HousekeepingVisitTaskRow = HousekeepingVisitTask;

/** goals: one of the household's goals for a week (every column is in the app's type). */
export type GoalRow = Goal;
/** goal_links: the household's public link to its goals (primary key household_id; token unique). */
export interface GoalLinkRow extends GoalsLink {
  household_id: string;
}

/** A member as stored: claimed_at (members.claimed_at) is kept for release_claim only. */
export interface MemberRow extends Member {
  /** When an account became this person by a claim (null or missing otherwise). */
  claimed_at?: ISOTimestamp | null;
}

/** How long after a claim "Not Shea?" (releaseClaim) may undo it, as release_claim. */
const RELEASE_MS = 86_400_000;

/**
 * The whole demo database: what DemoBackend stores under DEMO_STORAGE_KEY, and what the server
 * keeps as ServerDoc.home (with `session` null and `users` empty at rest; server/core/runAs.ts).
 */
export interface DemoDoc {
  version: 1;
  /** Signed-in user id, or null. */
  session: string | null;
  users: AuthUser[];
  households: HouseholdRow[];
  members: MemberRow[];
  areas: AreaRow[];
  items: ItemRow[];
  completions: CompletionRow[];
  invites: InviteRow[];
  push_subs: PushSubRow[];
  /**
   * Housekeeping came later still: read() fills these in for documents stored before it,
   * and gives each household the starter task list once (like the migration's backfill).
   */
  housekeeping_notes: HousekeepingNoteRow[];
  housekeeping_tasks: HousekeepingTaskRow[];
  housekeeping_visits: HousekeepingVisitRow[];
  housekeeping_visit_tasks: HousekeepingVisitTaskRow[];
  /**
   * Sections of the task list came later again: read() fills this in (none) for documents
   * stored before them, and reads their tasks as in no section and their visits' rows as
   * having none. The server's live home is such a document until its first write.
   */
  housekeeping_sections: HousekeepingSectionRow[];
  /**
   * Goals for the week, and the public link to them (one per household at most). They came
   * after everything else: read() fills them in (none) for documents stored before them. The
   * server's live home is such a document until its first write.
   */
  goals: GoalRow[];
  goal_links: GoalLinkRow[];
  /**
   * Set (by markDemoImported in lib/logic/importHome.ts, on the Supabase build) once this
   * document's home was brought over to the shared database. Kept as it is by read/write.
   */
  imported?: DemoImportMark;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface DemoBackendOptions {
  /** Where the document lives. Default: window.localStorage, else memory. */
  storage?: StorageLike;
  /** Clock. Default: () => new Date(). */
  now?: () => Date;
  /** Query string with the demo switches. Default: window.location.search in a browser. */
  search?: string;
  /** Account signInWithGoogle() signs in as. Default: DEMO_USER. */
  user?: AuthUser;
  /** Upper bound of the simulated network delay in ms. Default: 20. */
  latency?: number;
}

const INVITE_DAYS = 14;
const DAY_MS = 86_400_000;

/**
 * The database's size and format limits (supabase/migrations/20261009000100_hardening.sql)
 * beyond TEXT_LIMITS. Lengths count characters (code points), like Postgres length().
 */
const PUSH_ENDPOINT_MAX = 2048;
const PUSH_KEY_MAX = 256;
const USER_AGENT_MAX = 512;
const HTTPS_URL = /^https:\/\/\S+$/;

/** An empty document (nobody signed in, no household). */
export function emptyDoc(): DemoDoc {
  return {
    version: 1,
    session: null,
    users: [],
    households: [],
    members: [],
    areas: [],
    items: [],
    completions: [],
    invites: [],
    push_subs: [],
    housekeeping_notes: [],
    housekeeping_tasks: [],
    housekeeping_visits: [],
    housekeeping_visit_tasks: [],
    housekeeping_sections: [],
    goals: [],
    goal_links: [],
  };
}

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

function browserStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const probe = '__homeos_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

/** crypto.randomUUID needs a secure context; a phone on http://192.168.x.x has none. */
function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
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

/** The instant when the wall clock in `timeZone` reads `date hour:minute`. */
function zonedInstant(date: ISODate, hour: number, minute: number, timeZone: string): Date {
  const { y, m, d } = parseISODate(date);
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  let t = wall;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(t), timeZone);
    const seen = parseISODate(p.date);
    t += wall - Date.UTC(seen.y, seen.m - 1, seen.d, p.hour, p.minute);
  }
  return new Date(t);
}

const isKind = (value: unknown): value is ItemKind => value === 'task' || value === 'state';

/** items.kind check: 'task' unless given; anything else is invalid_input, like the check constraint. */
function kindOf(value: ItemKind | undefined): ItemKind {
  if (value === undefined) return 'task';
  if (!isKind(value)) throw invalidInput('kind');
  return value;
}

function invalidInput(what: string): BackendError {
  return new BackendError('unknown', `invalid_input: ${what}`);
}

function requireText(value: string | undefined, what: string): string {
  const v = (value ?? '').trim();
  if (!v) throw invalidInput(what);
  return v;
}

/** Characters as Postgres length() counts them (code points, so an emoji is one). */
function charCount(value: string): number {
  return Array.from(value).length;
}

/** The database's check constraints: too long is invalid_input, like a check violation. */
function withinLimit(value: string, max: number, what: string): string {
  if (charCount(value) > max) throw invalidInput(`${what} is longer than ${max} characters`);
  return value;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** A real calendar day written YYYY-MM-DD (what the SQL date parameter accepts). */
function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { y, m, d } = parseISODate(value);
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  return d <= [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

function requireDate(value: ISODate): ISODate {
  if (!isISODate(value)) throw invalidInput('date');
  return value;
}

/** A task title as the trigger stores it: trimmed, 1 to TEXT_LIMITS.housekeepingTask characters. */
function taskTitle(value: string): string {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title) throw invalidInput('title');
  return withinLimit(title, TEXT_LIMITS.housekeepingTask, 'title');
}

/** A section name as the trigger stores it: trimmed, 1 to TEXT_LIMITS.housekeepingSection characters. */
function sectionTitle(value: string): string {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title) throw invalidInput('title');
  return withinLimit(title, TEXT_LIMITS.housekeepingSection, 'title');
}

/** Tasks (or sections) in their order: position, then created_at, then id. */
function byTaskOrder(a: { position: number; created_at: ISOTimestamp; id: string }, b: { position: number; created_at: ISOTimestamp; id: string }): number {
  return a.position - b.position || compareText(a.created_at, b.created_at) || compareText(a.id, b.id);
}

/** A visit's tasks in their order: position, then title, then id. */
function byVisitTaskOrder(a: HousekeepingVisitTaskRow, b: HousekeepingVisitTaskRow): number {
  return a.position - b.position || compareText(a.title, b.title) || compareText(a.id, b.id);
}

/** The latest Thursday strictly before `today` (HousekeepingSeedVisit.weeksBack 0). */
function lastThursdayBefore(today: ISODate): ISODate {
  const { y, m, d } = parseISODate(today);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const back = (weekday - 4 + 7) % 7 || 7;
  return addDays(today, -back);
}

// ── Row → API shapes (leave out columns the UI types don't have) ──

const toHousehold = (h: HouseholdRow): Household => ({
  id: h.id,
  name: h.name,
  address: h.address,
  timezone: h.timezone,
  weekly_email_day: h.weekly_email_day,
  weekly_email_time: h.weekly_email_time,
});
const toArea = (a: AreaRow): Area => ({ id: a.id, household_id: a.household_id, name: a.name, position: a.position });
const toMember = ({ claimed_at: _c, ...member }: MemberRow): Member => member;
const toItem = ({ completed_at: _c, ...item }: ItemRow): Item => item;
const toCompletion = ({ prev_due_date: _d, prev_status: _s, ...c }: CompletionRow): Completion => c;
const toHousekeepingTask = (t: HousekeepingTaskRow): HousekeepingTask => ({
  id: t.id,
  household_id: t.household_id,
  title: t.title,
  section_id: t.section_id,
  position: t.position,
});
const toSection = (s: HousekeepingSectionRow): HousekeepingSection => ({
  id: s.id,
  household_id: s.household_id,
  title: s.title,
  position: s.position,
});
const toVisitTask = (r: HousekeepingVisitTaskRow): HousekeepingVisitTask => ({
  id: r.id,
  visit_id: r.visit_id,
  household_id: r.household_id,
  task_id: r.task_id,
  title: r.title,
  section_id: r.section_id,
  section_title: r.section_title,
  position: r.position,
  done: r.done,
  done_by: r.done_by,
  done_at: r.done_at,
});

export class DemoBackend implements Backend {
  readonly kind = 'demo' as const;

  private storage: StorageLike;
  private readonly now: () => Date;
  private readonly account: AuthUser;
  private readonly latency: number;
  private authListeners = new Set<(user: AuthUser | null) => void>();

  constructor(opts: DemoBackendOptions = {}) {
    this.storage = opts.storage ?? browserStorage() ?? new MemoryStorage();
    this.now = opts.now ?? (() => new Date());
    this.account = opts.user ?? DEMO_USER;
    this.latency = Math.max(0, opts.latency ?? 20);

    const search = opts.search ?? (typeof window !== 'undefined' ? window.location.search : '');
    const params = new URLSearchParams(search);
    const on = (name: string) => params.has(name) && params.get(name) !== '0' && params.get(name) !== 'false';
    if (on('demo-seed')) this.seedPrototype();
    else if (on('demo-reset')) this.write(emptyDoc());
  }

  // ── Storage ────────────────────────────────────────────

  private read(): DemoDoc {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(DEMO_STORAGE_KEY);
    } catch {
      /* storage unavailable: start empty */
    }
    if (!raw) return emptyDoc();
    try {
      const parsed = JSON.parse(raw) as Partial<DemoDoc> | null;
      if (!parsed || parsed.version !== 1) return emptyDoc();
      // Version 1 grows by adding collections; a document from before one starts it empty.
      const doc = { ...emptyDoc(), ...parsed };
      // Items stored before kinds existed are tasks, and before "What good looks like"
      // existed have none (the columns' defaults).
      if (Array.isArray(doc.items)) {
        for (const item of doc.items) {
          if (!isKind(item.kind)) item.kind = 'task';
          if (typeof item.good !== 'string') item.good = '';
        }
      }
      if (!Array.isArray(doc.housekeeping_notes)) doc.housekeeping_notes = [];
      if (!Array.isArray(doc.housekeeping_visits)) doc.housekeeping_visits = [];
      if (!Array.isArray(doc.housekeeping_visit_tasks)) doc.housekeeping_visit_tasks = [];
      // Sections came after housekeeping: a document from before them has none, its tasks are
      // in no section and its visits' rows had none (the columns' defaults).
      if (!Array.isArray(doc.housekeeping_sections)) doc.housekeeping_sections = [];
      for (const row of doc.housekeeping_visit_tasks) {
        if (row.section_id === undefined) row.section_id = null;
        if (typeof row.section_title !== 'string') row.section_title = '';
      }
      if (!Array.isArray(parsed.housekeeping_tasks)) {
        doc.housekeeping_tasks = [];
        this.backfillStarterTasks(doc);
      }
      for (const task of doc.housekeeping_tasks) if (task.section_id === undefined) task.section_id = null;
      // Goals came later: a document from before them has none, and no public link.
      if (!Array.isArray(doc.goals)) doc.goals = [];
      if (!Array.isArray(doc.goal_links)) doc.goal_links = [];
      return doc;
    } catch {
      return emptyDoc();
    }
  }

  /**
   * A document stored before housekeeping existed: each household without a task or a visit
   * gets the starter task list once, like the migration's backfill. Written back at once, so
   * the new tasks keep their ids from one read to the next. Should that fail, the households
   * just start with an empty list; the rest of the document is read as stored.
   */
  private backfillStarterTasks(doc: DemoDoc) {
    try {
      for (const household of doc.households) {
        if (doc.housekeeping_visits.some((v) => v.household_id === household.id)) continue;
        this.addStarterTasks(doc, household.id, this.now());
      }
      this.write(doc);
    } catch {
      doc.housekeeping_tasks = [];
    }
  }

  private write(doc: DemoDoc) {
    const json = JSON.stringify(doc);
    try {
      this.storage.setItem(DEMO_STORAGE_KEY, json);
    } catch {
      // Quota or a locked-down browser: keep going in memory for this tab.
      this.storage = new MemoryStorage();
      this.storage.setItem(DEMO_STORAGE_KEY, json);
    }
  }

  /** Runs `fn` now (so calls keep their order), then settles after a simulated network delay. */
  private async run<T>(fn: (doc: DemoDoc) => T, mutates: boolean): Promise<T> {
    let result: T | undefined;
    let error: unknown;
    let failed = false;
    try {
      const doc = this.read();
      result = fn(doc);
      if (mutates) this.write(doc);
    } catch (err) {
      failed = true;
      error = err;
    }
    await sleep(Math.random() * this.latency);
    if (failed) throw error;
    return result as T;
  }

  private query<T>(fn: (doc: DemoDoc) => T) {
    return this.run(fn, false);
  }

  private mutate<T>(fn: (doc: DemoDoc) => T) {
    return this.run(fn, true);
  }

  private stamp(offsetMs = 0): ISOTimestamp {
    return new Date(this.now().getTime() + offsetMs).toISOString();
  }

  // ── Access checks (what RLS and the RPCs enforce) ──────

  private userIn(doc: DemoDoc): AuthUser {
    const user = doc.session ? doc.users.find((u) => u.id === doc.session) : undefined;
    if (!user) throw new BackendError('not_signed_in');
    return user;
  }

  /** The caller's member row; not_found when they have no household. */
  private meIn(doc: DemoDoc): Member {
    const user = this.userIn(doc);
    const me = doc.members.find((m) => m.user_id === user.id);
    if (!me) throw new BackendError('not_found', 'No household');
    return me;
  }

  /** The caller's member row, which must belong to `householdId`. */
  private memberOf(doc: DemoDoc, householdId: string): Member {
    const me = this.meIn(doc);
    if (me.household_id !== householdId) throw new BackendError('not_found');
    return me;
  }

  private householdIn(doc: DemoDoc, householdId: string): HouseholdRow {
    const h = doc.households.find((x) => x.id === householdId);
    if (!h) throw new BackendError('not_found');
    return h;
  }

  private areaIn(doc: DemoDoc, me: Member, areaId: string): AreaRow {
    const area = doc.areas.find((a) => a.id === areaId && a.household_id === me.household_id);
    if (!area) throw new BackendError('not_found', 'Area not found');
    return area;
  }

  private itemIn(doc: DemoDoc, me: Member, itemId: string): ItemRow {
    const item = doc.items.find((i) => i.id === itemId && i.household_id === me.household_id);
    if (!item) throw new BackendError('not_found', 'Item not found');
    return item;
  }

  /** items trigger: an assignee must be a member of the item's household. */
  private checkAssignee(doc: DemoDoc, householdId: string, assigneeId: string | null) {
    if (assigneeId === null) return;
    if (!doc.members.some((m) => m.id === assigneeId && m.household_id === householdId)) {
      throw invalidInput('assignee');
    }
  }

  // ── Auth ───────────────────────────────────────────────

  getUser(): Promise<AuthUser | null> {
    return this.query((doc) => (doc.session ? (doc.users.find((u) => u.id === doc.session) ?? null) : null));
  }

  onAuthChange(cb: (user: AuthUser | null) => void): Unsubscribe {
    this.authListeners.add(cb);
    // Another tab signing in or out.
    let last = this.read().session;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== DEMO_STORAGE_KEY && e.key !== null) return;
      const doc = this.read();
      if (doc.session === last) return;
      last = doc.session;
      cb(doc.session ? (doc.users.find((u) => u.id === doc.session) ?? null) : null);
    };
    const hasWindow = typeof window !== 'undefined';
    if (hasWindow) window.addEventListener('storage', onStorage);
    return () => {
      this.authListeners.delete(cb);
      if (hasWindow) window.removeEventListener('storage', onStorage);
    };
  }

  private emitAuth(user: AuthUser | null) {
    for (const cb of [...this.authListeners]) cb(user);
  }

  async signInWithGoogle(): Promise<void> {
    const user = { ...this.account };
    await this.mutate((doc) => {
      doc.users = [...doc.users.filter((u) => u.id !== user.id), user];
      doc.session = user.id;
    });
    this.emitAuth(user);
  }

  async signOut(): Promise<void> {
    await this.mutate((doc) => {
      doc.session = null;
    });
    this.emitAuth(null);
  }

  // ── Household membership ───────────────────────────────

  /**
   * enter_home's rules on the demo document: member; else claim the earliest person with
   * user_id null whose email equals this account's (normaliseEmail; demo emails count as
   * verified); else 'no_home' (never 'private': a demo sign-in always gets a home).
   */
  enterHome(): Promise<HomeEntry> {
    // Storing an unchanged document fires no storage event, so only a claim reaches other tabs.
    // canImport is always false: the demo never brings a home over (it is where one comes from).
    return this.mutate((doc): HomeEntry => {
      const user = this.userIn(doc);
      const mine = doc.members.find((m) => m.user_id === user.id);
      if (mine) return { status: 'member', householdId: mine.household_id, memberId: mine.id, canImport: false };
      const person = this.waitingWith(doc, normaliseEmail(user.email));
      if (!person) return { status: 'no_home' };
      person.user_id = user.id;
      person.claimed_at = this.stamp();
      return { status: 'claimed', householdId: person.household_id, memberId: person.id, canImport: false };
    });
  }

  /**
   * release_claim on the demo document: within a day of a claim, the signed-in account stops
   * being that person (back to not joined, without the email, its push subscriptions gone).
   * not_found without a claim from the last day.
   */
  releaseClaim(): Promise<void> {
    return this.mutate((doc) => {
      const user = this.userIn(doc);
      const mine = doc.members.find((m) => m.user_id === user.id);
      const at = mine?.claimed_at ? new Date(mine.claimed_at).getTime() : NaN;
      if (!mine || Number.isNaN(at) || this.now().getTime() - at > RELEASE_MS) throw new BackendError('not_found');
      doc.push_subs = doc.push_subs.filter((sub) => sub.member_id !== mine.id);
      mine.user_id = null;
      mine.email = '';
      mine.claimed_at = null;
      mine.push_enabled = false;
    });
  }

  /**
   * The earliest person (join order, then id) who has not joined yet and has `email`, in
   * `householdId` when given: the one a sign-in with that email becomes.
   */
  private waitingWith(doc: DemoDoc, email: string, householdId?: string): MemberRow | undefined {
    if (!email) return undefined;
    return doc.members
      .filter(
        (m) =>
          !hasJoined(m) &&
          (householdId === undefined || m.household_id === householdId) &&
          normaliseEmail(m.email) === email,
      )
      .sort((a, b) => compareText(a.created_at, b.created_at) || compareText(a.id, b.id))[0];
  }

  /** The demo is where an import comes from: always BackendError('unknown', 'not supported in demo mode'). */
  importHousehold(_payload: ImportPayload): Promise<string> {
    return Promise.reject(new BackendError('unknown', 'not supported in demo mode'));
  }

  /**
   * add_person on the demo document, with its checks and errors: not_found outside the home;
   * invalid_input for a blank name or an email that fails isValidEmail(); email_taken when
   * someone in the home has it (normaliseEmail); then the name and emoji limits.
   */
  addPerson(householdId: string, input: NewPersonInput): Promise<Member> {
    return this.mutate((doc) => {
      this.memberOf(doc, householdId);
      const name = (input?.name ?? '').trim();
      const email = normaliseEmail(input?.email ?? '');
      if (!name) throw invalidInput('name');
      if (email && !isValidEmail(email)) throw invalidInput('email');
      const housemates = doc.members.filter((m) => m.household_id === householdId);
      if (email && housemates.some((m) => normaliseEmail(m.email) === email)) throw new BackendError('email_taken');
      const person: Member = {
        id: uuid(),
        household_id: householdId,
        user_id: null,
        name: withinLimit(name, TEXT_LIMITS.memberName, 'name'),
        email,
        emoji: withinLimit((input?.emoji ?? '').trim() || '🦔', TEXT_LIMITS.memberEmoji, 'emoji'),
        color: MEMBER_COLORS[housemates.length % MEMBER_COLORS.length],
        role: 'member',
        weekly_email: true,
        push_enabled: false,
        created_at: this.joinTime(housemates),
      };
      doc.members.push(person);
      return { ...person };
    });
  }

  /**
   * set_person_email on the demo document: not_found outside the caller's home; invalid_input
   * for someone who has joined or a value that is not an email; email_taken when another
   * person in the home has it. '' clears; the same value again changes nothing.
   */
  setPersonEmail(memberId: string, email: string): Promise<void> {
    return this.mutate((doc) => {
      const person = this.personIn(doc, memberId);
      const value = normaliseEmail(email ?? '');
      if (hasJoined(person) || (value && !isValidEmail(value))) throw invalidInput('email');
      const taken = doc.members.some(
        (m) => m.household_id === person.household_id && m.id !== person.id && normaliseEmail(m.email) === value,
      );
      if (value && taken) throw new BackendError('email_taken');
      person.email = value;
    });
  }

  /**
   * remove_person on the demo document: only someone who has not joined (invalid_input
   * otherwise; not_found outside the caller's home). What the foreign keys do when a member
   * row goes: items unassigned (and their author forgotten), completions credited to nobody,
   * push subscriptions and invites' author gone.
   */
  removePerson(memberId: string): Promise<void> {
    return this.mutate((doc) => {
      const person = this.personIn(doc, memberId);
      if (hasJoined(person)) throw invalidInput('joined');
      const id = person.id;
      doc.members = doc.members.filter((m) => m.id !== id);
      // goals: member_id, done_by and created_by on delete set null.
      for (const g of doc.goals) {
        if (g.member_id === id) g.member_id = null;
        if (g.done_by === id) g.done_by = null;
        if (g.created_by === id) g.created_by = null;
      }
      for (const l of doc.goal_links) if (l.created_by === id) l.created_by = null;
      for (const i of doc.items) {
        if (i.assignee_id === id) i.assignee_id = null;
        if (i.created_by === id) i.created_by = null;
        if (i.updated_by === id) i.updated_by = null;
      }
      for (const c of doc.completions) {
        if (c.credited_to === id) c.credited_to = null;
        if (c.completed_by === id) c.completed_by = null;
      }
      for (const i of doc.invites) if (i.created_by === id) i.created_by = null;
      for (const h of doc.households) if (h.updated_by === id) h.updated_by = null;
      doc.push_subs = doc.push_subs.filter((s) => s.member_id !== id);
    });
  }

  /** A member of the caller's home by id (joined or not); not_found otherwise. */
  private personIn(doc: DemoDoc, memberId: string): Member {
    const me = this.meIn(doc);
    const person = doc.members.find((m) => m.id === memberId && m.household_id === me.household_id);
    if (!person) throw new BackendError('not_found');
    return person;
  }

  /** Join order is created_at order, so never stamp before the latest person (fixed test clocks). */
  private joinTime(housemates: Member[]): ISOTimestamp {
    const latest = Math.max(-Infinity, ...housemates.map((m) => new Date(m.created_at).getTime()));
    return new Date(Math.max(this.now().getTime(), latest + 1)).toISOString();
  }

  getMyHouseholdId(): Promise<string | null> {
    return this.query((doc) => {
      const user = this.userIn(doc);
      return doc.members.find((m) => m.user_id === user.id)?.household_id ?? null;
    });
  }

  load(householdId: string): Promise<HouseholdData> {
    return this.query((doc) => {
      this.memberOf(doc, householdId);
      const household = this.householdIn(doc, householdId);
      const members = doc.members
        .filter((m) => m.household_id === householdId)
        .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
        .map(toMember);
      const areas = doc.areas
        .filter((a) => a.household_id === householdId)
        .sort((a, b) => a.position - b.position || (a.created_at < b.created_at ? -1 : 1))
        .map(toArea);
      const items = doc.items.filter((i) => i.household_id === householdId && i.status === 'open').map(toItem);
      const completions = doc.completions
        .filter((c) => c.household_id === householdId)
        .sort((a, b) => (a.completed_at < b.completed_at ? 1 : a.completed_at > b.completed_at ? -1 : 0))
        .map(toCompletion);
      const housekeeping = this.housekeepingOf(doc, householdId);
      const goals = this.goalsDataOf(doc, householdId);
      return { household: toHousehold(household), members, areas, items, completions, housekeeping, goals };
    });
  }

  subscribe(_householdId: string, onChange: () => void): Unsubscribe {
    if (typeof window === 'undefined') return () => {};
    const onStorage = (e: StorageEvent) => {
      if (e.key === DEMO_STORAGE_KEY || e.key === null) onChange();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }

  /** Tabs share one storage: nothing can drop. */
  reconnect(): void {}

  createHousehold(input: CreateHouseholdInput): Promise<string> {
    return this.mutate((doc) => this.createHouseholdIn(doc, input));
  }

  /** create_household, plus the demo's housemates and their history. */
  private createHouseholdIn(doc: DemoDoc, input: CreateHouseholdInput): string {
    const user = this.userIn(doc);
    if (doc.members.some((m) => m.user_id === user.id)) throw new BackendError('already_member');

    const now = this.now();
    const ts = (offsetMs = 0) => new Date(now.getTime() + offsetMs).toISOString();
    const timezone = isValidZone(input.timezone) ? input.timezone : 'Europe/London';
    const today = todayIn(timezone, now);

    const household: HouseholdRow = {
      id: uuid(),
      name: withinLimit(requireText(input.name, 'name'), TEXT_LIMITS.householdName, 'name'),
      address: withinLimit((input.address ?? '').trim(), TEXT_LIMITS.address, 'address'),
      timezone,
      weekly_email_day: 1,
      weekly_email_time: '08:00',
      created_at: ts(),
      updated_at: ts(),
      updated_by: null,
    };
    doc.households.push(household);

    const me: Member = {
      id: uuid(),
      household_id: household.id,
      user_id: user.id,
      name: withinLimit(
        (input.memberName ?? '').trim() || user.name.trim() || user.email.split('@')[0] || 'Me',
        TEXT_LIMITS.memberName,
        'name',
      ),
      email: normaliseEmail(user.email),
      emoji: withinLimit(input.memberEmoji || '🦔', TEXT_LIMITS.memberEmoji, 'emoji'),
      color: MEMBER_COLORS[0],
      role: 'owner',
      weekly_email: true,
      push_enabled: false,
      created_at: ts(),
    };
    doc.members.push(me);
    const people: Record<DemoPerson, Member> = { me, shea: me, ela: me };
    DEMO_PEOPLE.forEach((p, i) => {
      const member: Member = {
        id: uuid(),
        household_id: household.id,
        user_id: `demo-user-${p.key}-${household.id.slice(0, 8)}`,
        name: p.name,
        email: p.email,
        emoji: p.emoji,
        color: p.color,
        role: 'member',
        weekly_email: true,
        push_enabled: false,
        created_at: ts(i + 1),
      };
      doc.members.push(member);
      people[p.key] = member;
    });

    const areaByName = new Map<string, AreaRow>();
    for (const raw of input.areas) {
      const name = raw.trim();
      if (!name) continue;
      withinLimit(name, TEXT_LIMITS.areaName, 'area name');
      const area: AreaRow = {
        id: uuid(),
        household_id: household.id,
        name,
        position: areaByName.size,
        created_at: ts(areaByName.size),
      };
      doc.areas.push(area);
      if (!areaByName.has(name.toLowerCase())) areaByName.set(name.toLowerCase(), area);
    }

    input.items.forEach((seed, i) => {
      const area = areaByName.get(seed.area.trim().toLowerCase());
      if (!area || !seed.title.trim()) return;
      const row: ItemRow = {
        id: uuid(),
        household_id: household.id,
        area_id: area.id,
        kind: kindOf(seed.kind),
        title: withinLimit(seed.title.trim(), TEXT_LIMITS.itemTitle, 'title'),
        note: withinLimit(seed.note ?? '', TEXT_LIMITS.itemNote, 'note'),
        good: withinLimit(seed.good ?? '', TEXT_LIMITS.itemGood, 'good'),
        rag: seed.rag,
        due_date: seed.due_in_days === null ? null : addDays(today, seed.due_in_days),
        assignee_id: seed.demo_assignee ? people[seed.demo_assignee].id : null,
        repeat: seed.repeat,
        notify: seed.notify,
        status: 'open',
        created_by: me.id,
        updated_by: me.id,
        created_at: ts(i),
        updated_at: ts(i),
        completed_at: null,
      };
      // A seeded state has no due date, repeat or reminder (the items trigger in SQL).
      doc.items.push(applyKindRules(row));
    });

    this.addHistory(doc, household, people, now);
    this.addStarterTasks(doc, household.id, now);
    this.addHousekeepingHistory(doc, household, people, now);
    this.addDemoGoals(doc, household, people, now);
    return household.id;
  }

  /** The starter task list (create_household and the backfill), in order, last. */
  private addStarterTasks(doc: DemoDoc, householdId: string, now: Date) {
    for (const title of HOUSEKEEPING_STARTER_TASKS) {
      this.insertTask(doc, householdId, title, new Date(now.getTime() + doc.housekeeping_tasks.length).toISOString());
    }
  }

  /**
   * The demo's message for the housekeeper (HOUSEKEEPING_DEMO_NOTE) and past visits
   * (HOUSEKEEPING_DEMO_VISITS), on Thursdays before today in the household's time zone,
   * each with the starter tasks. Nothing is in the future.
   */
  private addHousekeepingHistory(doc: DemoDoc, household: HouseholdRow, people: Record<DemoPerson, Member>, now: Date) {
    const tz = household.timezone;
    const today = todayIn(tz, now);
    const note = HOUSEKEEPING_DEMO_NOTE;
    const written = zonedInstant(addDays(today, -note.daysBack), note.hour, note.minute, tz);
    doc.housekeeping_notes.push({
      household_id: household.id,
      body: note.body,
      updated_at: new Date(Math.min(written.getTime(), now.getTime())).toISOString(),
      updated_by: people[note.by].id,
    });

    const tasks = this.tasksOf(doc, household.id);
    const thursday = lastThursdayBefore(today);
    for (const seed of HOUSEKEEPING_DEMO_VISITS) {
      const date = addDays(thursday, -7 * seed.weeksBack);
      const by = people[seed.by].id;
      const created = zonedInstant(date, seed.hour, seed.minute, tz).getTime();
      const visit: HousekeepingVisitRow = {
        id: uuid(),
        household_id: household.id,
        visit_date: date,
        note: seed.note,
        comments: seed.comments,
        price_pence: seed.price_pence,
        created_by: by,
        created_at: new Date(created).toISOString(),
        updated_by: by,
        updated_at: new Date(created).toISOString(),
      };
      // Ticks one minute apart from the start, in list order; the last change a minute later.
      let ticks = 0;
      tasks.forEach((task, position) => {
        const done = seed.done.includes(task.title);
        const at = created + ticks * 60_000;
        if (done) ticks += 1;
        doc.housekeeping_visit_tasks.push({
          id: uuid(),
          visit_id: visit.id,
          household_id: household.id,
          task_id: task.id,
          title: task.title,
          section_id: null,
          section_title: '',
          position,
          done,
          done_by: done ? by : null,
          done_at: done ? new Date(at).toISOString() : null,
        });
      });
      if (ticks > 0) visit.updated_at = new Date(created + ticks * 60_000).toISOString();
      doc.housekeeping_visits.push(visit);
    }
  }

  /** Past completions (item_id null) so Stats reads 4/2/1 this month and 58/37/16 lifetime. */
  private addHistory(doc: DemoDoc, household: HouseholdRow, people: Record<DemoPerson, Member>, now: Date) {
    const tz = household.timezone;
    const today = todayIn(tz, now);
    const dayOfMonth = parseISODate(today).d;
    const add = (who: DemoPerson, title: string, at: Date) => {
      doc.completions.push({
        id: uuid(),
        household_id: household.id,
        item_id: null,
        item_title: title,
        credited_to: people[who].id,
        completed_by: people[who].id,
        completed_at: at.toISOString(),
        prev_due_date: null,
        prev_status: 'open',
      });
    };

    // This month: earlier days of the month; on the 1st, earlier today (never in the future).
    for (const r of RECENT_HISTORY) {
      const back = Math.min(r.daysBack, dayOfMonth - 1);
      const at = zonedInstant(addDays(today, -back), r.hour, r.minute, tz);
      add(r.who, r.title, at.getTime() > now.getTime() ? now : at);
    }

    // Older: evenly spread over the previous HISTORY_MONTHS months, people interleaved.
    const firstOfMonth = `${today.slice(0, 7)}-01`;
    const start = addMonths(firstOfMonth, -HISTORY_MONTHS);
    const span = daysBetween(start, firstOfMonth);
    const queue: { who: DemoPerson; pos: number }[] = [];
    (Object.keys(HISTORY_TOTALS) as DemoPerson[]).forEach((who, order) => {
      const n = HISTORY_TOTALS[who].lifetime - HISTORY_TOTALS[who].month;
      for (let i = 0; i < n; i++) queue.push({ who, pos: (i + 0.5) / n + order * 1e-6 });
    });
    queue.sort((a, b) => a.pos - b.pos);
    queue.forEach(({ who }, k) => {
      const day = addDays(start, Math.floor(((k + 0.5) * span) / queue.length));
      const at = zonedInstant(day, 9 + ((k * 5) % 12), (k * 17) % 60, tz);
      add(who, HISTORY_TITLES[(k * 7) % HISTORY_TITLES.length], at);
    });
  }

  /** ?demo-seed=1: the prototype's household, built through createHousehold's own path. */
  private seedPrototype() {
    const doc = emptyDoc();
    const user = { ...this.account };
    doc.users.push(user);
    doc.session = user.id;
    this.createHouseholdIn(doc, {
      name: 'Our home',
      address: DEFAULT_ADDRESS,
      timezone: deviceTimeZone(),
      memberName: user.name,
      memberEmoji: '🦔',
      areas: [...DEFAULT_AREAS],
      // The household's list, and a few more so Needs attention's calendar has a lively month.
      items: [...SEED_ITEMS, ...DEMO_CALENDAR_ITEMS],
    });
    this.write(doc);
  }

  joinHousehold(input: JoinHouseholdInput): Promise<string> {
    return this.mutate((doc) => {
      const user = this.userIn(doc);
      const invite = this.validInvite(doc, input.token);
      if (!invite) throw new BackendError('invalid_invite');
      const existing = doc.members.find((m) => m.user_id === user.id);
      if (existing) {
        if (existing.household_id === invite.household_id) return existing.household_id;
        throw new BackendError('already_member');
      }
      const email = normaliseEmail(user.email);
      // "Are you one of these people?" (join_as_person): someone the home is waiting for, with
      // no email or this account's; their email becomes the caller's unless someone has it.
      if (input.personId) {
        const person = doc.members.find(
          (m) =>
            m.id === input.personId &&
            m.household_id === invite.household_id &&
            !hasJoined(m) &&
            (normaliseEmail(m.email) === '' || normaliseEmail(m.email) === email),
        );
        if (!person) throw new BackendError('not_found');
        const taken = doc.members.some(
          (m) => m.household_id === invite.household_id && m.id !== person.id && normaliseEmail(m.email) === email,
        );
        person.user_id = user.id;
        person.email = taken ? '' : email;
        person.claimed_at = this.stamp();
        return invite.household_id;
      }
      // Someone at home added this person with the caller's email (demo emails count as
      // verified): the caller becomes them, keeping their name, emoji and colour.
      const waiting = this.waitingWith(doc, email, invite.household_id);
      if (waiting) {
        waiting.user_id = user.id;
        waiting.claimed_at = this.stamp();
        return invite.household_id;
      }
      const housemates = doc.members.filter((m) => m.household_id === invite.household_id);
      const count = housemates.length;
      doc.members.push({
        id: uuid(),
        household_id: invite.household_id,
        user_id: user.id,
        name: withinLimit(
          (input.memberName ?? '').trim() || user.name.trim() || user.email.split('@')[0] || 'Me',
          TEXT_LIMITS.memberName,
          'name',
        ),
        // One person per email in a home: if someone (who has joined) has it, join without it.
        email: housemates.some((m) => normaliseEmail(m.email) === email) ? '' : email,
        emoji: withinLimit(input.memberEmoji || '🦔', TEXT_LIMITS.memberEmoji, 'emoji'),
        color: MEMBER_COLORS[count % MEMBER_COLORS.length],
        role: 'member',
        weekly_email: true,
        push_enabled: false,
        created_at: this.joinTime(housemates),
      });
      return invite.household_id;
    });
  }

  private validInvite(doc: DemoDoc, token: string): InviteRow | null {
    const t = (token ?? '').trim();
    if (!t) return null;
    const invite = doc.invites.find((i) => i.token === t);
    if (!invite || new Date(invite.expires_at).getTime() <= this.now().getTime()) return null;
    return doc.households.some((h) => h.id === invite.household_id) ? invite : null;
  }

  getInvitePreview(token: string): Promise<InvitePreview | null> {
    return this.query((doc) => {
      this.userIn(doc);
      const invite = this.validInvite(doc, token);
      if (!invite) return null;
      const h = this.householdIn(doc, invite.household_id);
      const people = doc.members
        .filter((m) => m.household_id === h.id)
        .sort((a, b) => compareText(a.created_at, b.created_at) || compareText(a.id, b.id));
      return {
        household_name: h.name,
        address: h.address,
        people: people
          .filter((m) => !hasJoined(m) && normaliseEmail(m.email) === '')
          .map((m) => ({ id: m.id, name: m.name, emoji: m.emoji })),
        emojis: people.map((m) => m.emoji),
      };
    });
  }

  createInvite(): Promise<string> {
    return this.mutate((doc) => {
      const me = this.meIn(doc);
      const now = this.now();
      const token = uuid().replace(/-/g, '');
      doc.invites.push({
        id: uuid(),
        household_id: me.household_id,
        token,
        created_by: me.id,
        created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + INVITE_DAYS * DAY_MS).toISOString(),
      });
      return token;
    });
  }

  // ── Edits (any member may edit anything in their household) ──

  updateHousehold(id: string, patch: HouseholdPatch): Promise<void> {
    return this.mutate((doc) => {
      const me = this.memberOf(doc, id);
      const h = this.householdIn(doc, id);
      // A refused patch changes nothing: run() only stores the document when fn succeeds.
      if (patch.name !== undefined) {
        h.name = withinLimit(requireText(patch.name, 'name'), TEXT_LIMITS.householdName, 'name');
      }
      if (patch.address !== undefined) h.address = withinLimit(patch.address.trim(), TEXT_LIMITS.address, 'address');
      if (patch.timezone !== undefined) {
        if (!isValidZone(patch.timezone)) throw invalidInput('timezone');
        h.timezone = patch.timezone;
      }
      h.updated_at = this.stamp();
      h.updated_by = me.id;
    });
  }

  updateMember(id: string, patch: MemberPatch): Promise<void> {
    return this.mutate((doc) => {
      const me = this.meIn(doc);
      const member = doc.members.find((m) => m.id === id && m.household_id === me.household_id);
      if (!member) throw new BackendError('not_found');
      if (patch.name !== undefined) {
        member.name = withinLimit(requireText(patch.name, 'name'), TEXT_LIMITS.memberName, 'name');
      }
      if (patch.emoji !== undefined) member.emoji = withinLimit(requireText(patch.emoji, 'emoji'), TEXT_LIMITS.memberEmoji, 'emoji');
      if (patch.weekly_email !== undefined) member.weekly_email = patch.weekly_email;
      if (patch.push_enabled !== undefined) member.push_enabled = patch.push_enabled;
      // members_before_write: someone who has not joined has nowhere to be pushed to.
      if (!hasJoined(member)) member.push_enabled = false;
    });
  }

  createArea(householdId: string, name: string): Promise<Area> {
    return this.mutate((doc) => {
      this.memberOf(doc, householdId);
      const siblings = doc.areas.filter((a) => a.household_id === householdId);
      const area: AreaRow = {
        id: uuid(),
        household_id: householdId,
        name: withinLimit(requireText(name, 'name'), TEXT_LIMITS.areaName, 'name'),
        position: siblings.length ? Math.max(...siblings.map((a) => a.position)) + 1 : 0,
        created_at: this.stamp(),
      };
      doc.areas.push(area);
      return toArea(area);
    });
  }

  renameArea(id: string, name: string): Promise<void> {
    return this.mutate((doc) => {
      const area = this.areaIn(doc, this.meIn(doc), id);
      area.name = withinLimit(requireText(name, 'name'), TEXT_LIMITS.areaName, 'name');
    });
  }

  deleteArea(id: string): Promise<void> {
    return this.mutate((doc) => {
      const area = this.areaIn(doc, this.meIn(doc), id);
      const gone = new Set(doc.items.filter((i) => i.area_id === area.id).map((i) => i.id));
      doc.areas = doc.areas.filter((a) => a.id !== area.id);
      this.removeItems(doc, gone);
    });
  }

  /** Deletes items; their completions stay with item_id null (on delete set null). */
  private removeItems(doc: DemoDoc, ids: Set<string>) {
    if (!ids.size) return;
    doc.items = doc.items.filter((i) => !ids.has(i.id));
    for (const c of doc.completions) if (c.item_id && ids.has(c.item_id)) c.item_id = null;
  }

  reorderAreas(householdId: string, orderedIds: string[]): Promise<void> {
    return this.mutate((doc) => {
      this.memberOf(doc, householdId);
      orderedIds.forEach((id, index) => {
        const area = doc.areas.find((a) => a.id === id && a.household_id === householdId);
        if (area) area.position = index;
      });
    });
  }

  createItem(householdId: string, draft: ItemDraft): Promise<Item> {
    return this.mutate((doc) => {
      const me = this.memberOf(doc, householdId);
      const area = this.areaIn(doc, me, draft.area_id);
      this.checkAssignee(doc, area.household_id, draft.assignee_id);
      const at = this.stamp();
      const item: ItemRow = applyKindRules({
        id: uuid(),
        household_id: area.household_id,
        area_id: area.id,
        kind: kindOf(draft.kind),
        title: withinLimit(requireText(draft.title, 'title'), TEXT_LIMITS.itemTitle, 'title'),
        note: withinLimit(draft.note ?? '', TEXT_LIMITS.itemNote, 'note'),
        good: withinLimit(draft.good ?? '', TEXT_LIMITS.itemGood, 'good'),
        rag: draft.rag,
        due_date: draft.due_date,
        assignee_id: draft.assignee_id,
        repeat: draft.repeat,
        notify: draft.notify,
        status: 'open',
        created_by: me.id,
        updated_by: me.id,
        created_at: at,
        updated_at: at,
        completed_at: null,
      });
      doc.items.push(item);
      return toItem(item);
    });
  }

  updateItem(id: string, patch: ItemPatch): Promise<void> {
    return this.mutate((doc) => {
      const me = this.meIn(doc);
      const item = this.itemIn(doc, me, id);
      const next: ItemRow = { ...item };
      if (patch.area_id !== undefined) next.area_id = this.areaIn(doc, me, patch.area_id).id;
      if (patch.kind !== undefined) next.kind = kindOf(patch.kind);
      if (patch.title !== undefined) {
        next.title = withinLimit(requireText(patch.title, 'title'), TEXT_LIMITS.itemTitle, 'title');
      }
      if (patch.note !== undefined) next.note = withinLimit(patch.note, TEXT_LIMITS.itemNote, 'note');
      if (patch.good !== undefined) next.good = withinLimit(patch.good, TEXT_LIMITS.itemGood, 'good');
      if (patch.rag !== undefined) next.rag = patch.rag;
      if (patch.due_date !== undefined) next.due_date = patch.due_date;
      if (patch.assignee_id !== undefined) next.assignee_id = patch.assignee_id;
      if (patch.repeat !== undefined) next.repeat = patch.repeat;
      if (patch.notify !== undefined) next.notify = patch.notify;
      this.checkAssignee(doc, item.household_id, next.assignee_id);
      next.updated_at = this.stamp();
      next.updated_by = me.id;
      // A state keeps no due date, repeat or reminder; a state that becomes a task keeps
      // whatever the patch gives it.
      Object.assign(item, applyKindRules(next));
    });
  }

  deleteItem(id: string): Promise<void> {
    return this.mutate((doc) => {
      const item = this.itemIn(doc, this.meIn(doc), id);
      this.removeItems(doc, new Set([item.id]));
    });
  }

  completeItem(id: string): Promise<string> {
    return this.mutate((doc) => {
      const me = this.meIn(doc);
      const item = this.itemIn(doc, me, id);
      if (item.status !== 'open') throw new BackendError('not_found', 'Item is not open');
      // A state (To maintain) is never done (complete_item raises invalid_input).
      if (item.kind === 'state') throw invalidInput('state');
      const household = this.householdIn(doc, item.household_id);
      const now = this.now();
      const completion: CompletionRow = {
        id: uuid(),
        household_id: item.household_id,
        item_id: item.id,
        item_title: item.title,
        credited_to: item.assignee_id ?? me.id,
        completed_by: me.id,
        completed_at: now.toISOString(),
        prev_due_date: item.due_date,
        prev_status: item.status,
      };
      doc.completions.push(completion);
      if (item.repeat !== 'none') {
        item.due_date = nextDueDate(item.repeat, item.due_date, todayIn(household.timezone, now));
      } else {
        item.status = 'done';
        item.completed_at = now.toISOString();
      }
      item.updated_at = now.toISOString();
      item.updated_by = me.id;
      return completion.id;
    });
  }

  undoCompletion(completionId: string): Promise<void> {
    return this.mutate((doc) => {
      const me = this.meIn(doc);
      const completion = doc.completions.find((c) => c.id === completionId && c.household_id === me.household_id);
      if (!completion) throw new BackendError('not_found', 'Completion not found');
      const item = completion.item_id ? doc.items.find((i) => i.id === completion.item_id) : undefined;
      if (item) {
        item.status = completion.prev_status;
        item.due_date = completion.prev_due_date;
        item.completed_at = null;
        item.updated_at = this.stamp();
        item.updated_by = me.id;
        // Made a state since it was completed: it still has no due date.
        Object.assign(item, applyKindRules(item));
      }
      doc.completions = doc.completions.filter((c) => c.id !== completion.id);
    });
  }

  // ── Push (stored only; the demo never sends) ──────────

  savePushSubscription(memberId: string, sub: PushSubscriptionInput): Promise<void> {
    return this.mutate((doc) => {
      const user = this.userIn(doc);
      const me = this.meIn(doc);
      if (me.id !== memberId) throw new BackendError('not_found');
      const endpoint = sub?.endpoint ?? '';
      const p256dh = sub?.keys?.p256dh ?? '';
      const auth = sub?.keys?.auth ?? '';
      if (!endpoint || !p256dh || !auth) throw invalidInput('push subscription');
      // push_subs_endpoint_https and push_subs_keys_length.
      if (!HTTPS_URL.test(endpoint)) throw invalidInput('push endpoint must be an https URL');
      withinLimit(endpoint, PUSH_ENDPOINT_MAX, 'push endpoint');
      withinLimit(p256dh, PUSH_KEY_MAX, 'p256dh');
      withinLimit(auth, PUSH_KEY_MAX, 'auth');
      // The insert trigger only replaces a stored row with this endpoint when it is the
      // caller's own or has the same keys (the same browser subscription). Anyone else's
      // row stays, and the upsert fails on their RLS policy, which reads as not_found.
      const taken = doc.push_subs.some(
        (s) => s.endpoint === endpoint && s.user_id !== user.id && (s.p256dh !== p256dh || s.auth !== auth),
      );
      if (taken) throw new BackendError('not_found');
      const userAgent = typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : null;
      const row: PushSubRow = {
        id: uuid(),
        member_id: me.id,
        user_id: user.id,
        endpoint,
        p256dh,
        auth,
        // Cut, not refused, like the trigger does.
        user_agent: userAgent === null ? null : Array.from(userAgent).slice(0, USER_AGENT_MAX).join(''),
        created_at: this.stamp(),
      };
      doc.push_subs = [...doc.push_subs.filter((s) => s.endpoint !== endpoint), row];
    });
  }

  deletePushSubscription(endpoint: string): Promise<void> {
    return this.mutate((doc) => {
      const user = this.userIn(doc);
      doc.push_subs = doc.push_subs.filter((s) => !(s.endpoint === endpoint && s.user_id === user.id));
    });
  }

  /** Demo sign-in can't fail. */
  takeAuthError(): string | null {
    return null;
  }

  // ── Housekeeping (docs/ARCHITECTURE.md "Housekeeping") ──
  // Mirrors supabase/migrations/20261010000400_housekeeping.sql and
  // 20261015000100_housekeeping_sections.sql: the RPCs, the triggers that keep today's visit
  // in step with the task list (relay()), and RLS (every member edits everything; anything in
  // another household is not_found). A failed call stores nothing (run() only writes the
  // document when fn succeeds), so a visit created by a failed write goes too.

  /** The household's sections in order (position, created_at, id). */
  private sectionsOf(doc: DemoDoc, householdId: string): HousekeepingSectionRow[] {
    return doc.housekeeping_sections.filter((s) => s.household_id === householdId).sort(byTaskOrder);
  }

  /**
   * The household's task list in its order: the tasks in no section first, then section by
   * section in the sections' order, each by position, created_at, id.
   */
  private tasksOf(doc: DemoDoc, householdId: string): HousekeepingTaskRow[] {
    const rank = new Map(this.sectionsOf(doc, householdId).map((s, i) => [s.id, i + 1]));
    const rankOf = (t: HousekeepingTaskRow) => (t.section_id === null ? 0 : (rank.get(t.section_id) ?? 0));
    return doc.housekeeping_tasks
      .filter((t) => t.household_id === householdId)
      .sort((a, b) => rankOf(a) - rankOf(b) || byTaskOrder(a, b));
  }

  /** The household's visit on `date`, if any. */
  private visitOnDay(doc: DemoDoc, householdId: string, date: ISODate): HousekeepingVisitRow | undefined {
    return doc.housekeeping_visits.find((v) => v.household_id === householdId && v.visit_date === date);
  }

  /** Today's visit in the household's time zone (what the task list triggers keep in step). */
  private todaysVisit(doc: DemoDoc, householdId: string): HousekeepingVisitRow | undefined {
    const household = this.householdIn(doc, householdId);
    return this.visitOnDay(doc, householdId, todayIn(household.timezone, this.now()));
  }

  /**
   * housekeeping_relay(): a visit's rows laid out as the list stands. Each row whose task is on
   * the list takes the task's section (id and name) and place; a row whose task is gone keeps
   * its section while that is on the list (else none), after the rows of that section's tasks,
   * in the order it had. Positions run 0…n-1, section by section, no section first. Titles and
   * ticks are left alone.
   */
  private relay(doc: DemoDoc, visit: HousekeepingVisitRow) {
    const sections = this.sectionsOf(doc, visit.household_id);
    const sectionRank = new Map(sections.map((s, i) => [s.id, i + 1]));
    const sectionById = new Map(sections.map((s) => [s.id, s]));
    const list = this.tasksOf(doc, visit.household_id);
    const place = new Map(list.map((t, i) => [t.id, i]));
    const taskById = new Map(list.map((t) => [t.id, t]));
    const rows = doc.housekeeping_visit_tasks
      .filter((r) => r.visit_id === visit.id)
      .sort(byVisitTaskOrder)
      .map((row) => {
        const task = row.task_id !== null ? taskById.get(row.task_id) : undefined;
        const section = sectionById.get((task ? task.section_id : row.section_id) ?? '');
        return { row, place: task ? place.get(task.id)! : null, section };
      });
    rows.sort(
      (a, b) =>
        (a.section ? sectionRank.get(a.section.id)! : 0) - (b.section ? sectionRank.get(b.section.id)! : 0) ||
        (a.place === null ? 1 : 0) - (b.place === null ? 1 : 0) ||
        (a.place !== null && b.place !== null ? a.place - b.place : 0),
    );
    rows.forEach(({ row, section }, position) => {
      row.position = position;
      row.section_id = section?.id ?? null;
      row.section_title = section?.title ?? '';
    });
  }

  /** Today's visit (if any) laid out as the list now stands: it follows every change to the list. */
  private relayToday(doc: DemoDoc, householdId: string) {
    const today = this.todaysVisit(doc, householdId);
    if (today) this.relay(doc, today);
  }

  /**
   * housekeeping_tasks insert (and its triggers): last in its section (or among the tasks in
   * no section), and on today's visit, in its place.
   */
  private insertTask(
    doc: DemoDoc,
    householdId: string,
    title: string,
    createdAt: ISOTimestamp,
    sectionId: string | null = null,
  ): HousekeepingTaskRow {
    const siblings = doc.housekeeping_tasks.filter((t) => t.household_id === householdId && t.section_id === sectionId);
    const task: HousekeepingTaskRow = {
      id: uuid(),
      household_id: householdId,
      title,
      section_id: sectionId,
      position: siblings.length ? Math.max(...siblings.map((t) => t.position)) + 1 : 0,
      created_at: createdAt,
    };
    doc.housekeeping_tasks.push(task);
    const today = this.todaysVisit(doc, householdId);
    if (today && !doc.housekeeping_visit_tasks.some((r) => r.visit_id === today.id && r.task_id === task.id)) {
      doc.housekeeping_visit_tasks.push({
        id: uuid(),
        visit_id: today.id,
        household_id: householdId,
        task_id: task.id,
        title: task.title,
        section_id: null,
        section_title: '',
        position: Number.MAX_SAFE_INTEGER,
        done: false,
        done_by: null,
        done_at: null,
      });
      this.relay(doc, today);
    }
    return task;
  }

  /** The caller's task with this id; not_found when it is gone or in another household. */
  private taskIn(doc: DemoDoc, me: Member, id: string): HousekeepingTaskRow {
    const task = doc.housekeeping_tasks.find((t) => t.id === id && t.household_id === me.household_id);
    if (!task) throw new BackendError('not_found', 'Task not found');
    return task;
  }

  /** The household's section with this id; not_found when it is gone or in another household. */
  private sectionIn(doc: DemoDoc, householdId: string, id: unknown): HousekeepingSectionRow {
    const section = doc.housekeeping_sections.find((s) => s.id === id && s.household_id === householdId);
    if (!section) throw new BackendError('not_found', 'Section not found');
    return section;
  }

  /** Today's visit's row for a task (the triggers' target), if any. */
  private todaysRowFor(doc: DemoDoc, task: HousekeepingTaskRow): HousekeepingVisitTaskRow | undefined {
    const today = this.todaysVisit(doc, task.household_id);
    return today ? doc.housekeeping_visit_tasks.find((r) => r.visit_id === today.id && r.task_id === task.id) : undefined;
  }

  /**
   * housekeeping_visit_for(): the household's visit on `date`, created with its copies if
   * there is none (recorded by `me`). A day after today (household time zone) is
   * invalid_input: date. A new visit copies the task list in its order (none done, each row
   * with its task's section and that section's name) and the message as it stood that day:
   * its text if it was last changed on or before `date`, else ''.
   */
  private visitFor(doc: DemoDoc, householdId: string, date: ISODate, me: Member): HousekeepingVisitRow {
    const household = this.householdIn(doc, householdId);
    if (date > todayIn(household.timezone, this.now())) throw invalidInput('date');
    const existing = this.visitOnDay(doc, householdId, date);
    if (existing) return existing;
    const note = doc.housekeeping_notes.find((n) => n.household_id === householdId);
    const standing = note && zonedParts(new Date(note.updated_at), household.timezone).date <= date;
    const at = this.stamp();
    const visit: HousekeepingVisitRow = {
      id: uuid(),
      household_id: householdId,
      visit_date: date,
      note: standing ? note.body : '',
      comments: '',
      price_pence: null,
      created_by: me.id,
      created_at: at,
      updated_by: me.id,
      updated_at: at,
    };
    doc.housekeeping_visits.push(visit);
    this.tasksOf(doc, householdId).forEach((task, position) => {
      doc.housekeeping_visit_tasks.push({
        id: uuid(),
        visit_id: visit.id,
        household_id: householdId,
        task_id: task.id,
        title: task.title,
        section_id: task.section_id,
        section_title: '',
        position,
        done: false,
        done_by: null,
        done_at: null,
      });
    });
    this.relay(doc, visit);
    return visit;
  }

  /** HouseholdData.housekeeping: the message, the sections, the task list and every visit with its rows. */
  private housekeepingOf(doc: DemoDoc, householdId: string): HousekeepingData {
    const note = doc.housekeeping_notes.find((n) => n.household_id === householdId);
    const rows = new Map<string, HousekeepingVisitTaskRow[]>();
    for (const r of doc.housekeeping_visit_tasks) {
      if (r.household_id !== householdId) continue;
      const list = rows.get(r.visit_id) ?? [];
      list.push(r);
      rows.set(r.visit_id, list);
    }
    const visits = doc.housekeeping_visits
      .filter((v) => v.household_id === householdId)
      .sort((a, b) => compareText(b.visit_date, a.visit_date))
      .map((v) => ({
        id: v.id,
        household_id: v.household_id,
        visit_date: v.visit_date,
        note: v.note,
        comments: v.comments,
        price_pence: v.price_pence,
        created_by: v.created_by,
        created_at: v.created_at,
        updated_by: v.updated_by,
        updated_at: v.updated_at,
        tasks: (rows.get(v.id) ?? []).sort(byVisitTaskOrder).map(toVisitTask),
      }));
    return {
      note: note
        ? { body: note.body, updated_at: note.updated_at, updated_by: note.updated_by }
        : emptyHousekeeping().note,
      sections: this.sectionsOf(doc, householdId).map(toSection),
      tasks: this.tasksOf(doc, householdId).map(toHousekeepingTask),
      visits,
    };
  }

  setHousekeepingNote(householdId: string, body: string): Promise<void> {
    return this.mutate((doc) => {
      const me = this.memberOf(doc, householdId);
      const text = withinLimit((body ?? '').trim(), TEXT_LIMITS.housekeepingNote, 'note');
      const note = doc.housekeeping_notes.find((n) => n.household_id === householdId);
      // The same text again keeps the stamp; clearing a message never written stores nothing.
      if (note ? note.body === text : text === '') return;
      // Clearing keeps what it took away, for Undo; writing a new message forgets it.
      const row: HousekeepingNoteRow = {
        household_id: householdId,
        body: text,
        updated_at: this.stamp(),
        updated_by: me.id,
        cleared_body: text === '' && note ? note.body : null,
        cleared_updated_at: text === '' && note ? note.updated_at : null,
        cleared_updated_by: text === '' && note ? note.updated_by : null,
      };
      if (note) Object.assign(note, row);
      else doc.housekeeping_notes.push(row);
    });
  }

  undoClearHousekeepingNote(householdId: string): Promise<void> {
    return this.mutate((doc) => {
      this.memberOf(doc, householdId);
      const note = doc.housekeeping_notes.find((n) => n.household_id === householdId);
      // Only while it is still empty, and only what Clear took away.
      if (!note || note.body !== '' || note.cleared_body == null || note.cleared_updated_at == null) return;
      Object.assign(note, {
        body: note.cleared_body,
        updated_at: note.cleared_updated_at,
        updated_by: note.cleared_updated_by ?? null,
        cleared_body: null,
        cleared_updated_at: null,
        cleared_updated_by: null,
      });
    });
  }

  createHousekeepingTask(householdId: string, title: string, sectionId: string | null = null): Promise<HousekeepingTask> {
    return this.mutate((doc) => {
      const clean = taskTitle(title);
      this.memberOf(doc, householdId);
      const section = sectionId === null || sectionId === undefined ? null : this.sectionIn(doc, householdId, sectionId).id;
      return toHousekeepingTask(this.insertTask(doc, householdId, clean, this.stamp(), section));
    });
  }

  renameHousekeepingTask(id: string, title: string): Promise<void> {
    return this.mutate((doc) => {
      const clean = taskTitle(title);
      const task = this.taskIn(doc, this.meIn(doc), id);
      if (task.title === clean) return;
      task.title = clean;
      // Today's visit follows unless the task is ticked there (a ticked row keeps the title it
      // was ticked under, as history); earlier visits keep the title they had.
      const row = this.todaysRowFor(doc, task);
      if (row && !row.done) row.title = clean;
    });
  }

  deleteHousekeepingTask(id: string): Promise<void> {
    return this.mutate((doc) => {
      const task = this.taskIn(doc, this.meIn(doc), id);
      // Today's visit loses it unless it is ticked there; every other row keeps it, with
      // task_id null (on delete set null).
      const today = this.todaysRowFor(doc, task);
      doc.housekeeping_visit_tasks = doc.housekeeping_visit_tasks.filter((r) => !(r === today && !r.done));
      for (const r of doc.housekeeping_visit_tasks) if (r.task_id === task.id) r.task_id = null;
      doc.housekeeping_tasks = doc.housekeeping_tasks.filter((t) => t.id !== task.id);
      // A ticked row it leaves today goes after the rows of its section's tasks.
      this.relayToday(doc, task.household_id);
    });
  }

  moveHousekeepingTask(id: string, sectionId: string | null, index: number): Promise<void> {
    return this.mutate((doc) => {
      const me = this.meIn(doc);
      // move_housekeeping_task: a place from 0, the caller's task, a section of its household
      // (or none). Only this task and the places in its two sections change.
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) throw invalidInput('index');
      const task = this.taskIn(doc, me, id);
      const target = sectionId === null || sectionId === undefined ? null : this.sectionIn(doc, task.household_id, sectionId).id;
      const list = this.tasksOf(doc, task.household_id);
      if (task.section_id !== target) {
        // The section it leaves closes up.
        list.filter((t) => t.section_id === task.section_id && t !== task).forEach((t, position) => (t.position = position));
      }
      const joined = list.filter((t) => t.section_id === target && t !== task);
      joined.splice(Math.min(index, joined.length), 0, task);
      joined.forEach((t, position) => {
        t.section_id = target;
        t.position = position;
      });
      this.relayToday(doc, task.household_id);
    });
  }

  reorderHousekeepingTasks(householdId: string, orderedIds: string[]): Promise<void> {
    return this.mutate((doc) => {
      this.memberOf(doc, householdId);
      // reorder_housekeeping_tasks, for an app from before sections still running: position =
      // index, each task staying in its section; ids from elsewhere are ignored.
      (orderedIds ?? []).forEach((id, index) => {
        const task = doc.housekeeping_tasks.find((t) => t.id === id && t.household_id === householdId);
        if (task) task.position = index;
      });
      this.relayToday(doc, householdId);
    });
  }

  createHousekeepingSection(householdId: string, title: string): Promise<HousekeepingSection> {
    return this.mutate((doc) => {
      const clean = sectionTitle(title);
      this.memberOf(doc, householdId);
      const siblings = doc.housekeeping_sections.filter((s) => s.household_id === householdId);
      // housekeeping_sections_limit
      if (siblings.length >= HOUSEKEEPING_SECTIONS_MAX) throw invalidInput(`sections (at most ${HOUSEKEEPING_SECTIONS_MAX})`);
      const section: HousekeepingSectionRow = {
        id: uuid(),
        household_id: householdId,
        title: clean,
        position: siblings.length ? Math.max(...siblings.map((s) => s.position)) + 1 : 0,
        created_at: this.stamp(),
      };
      doc.housekeeping_sections.push(section);
      return toSection(section);
    });
  }

  renameHousekeepingSection(id: string, title: string): Promise<void> {
    return this.mutate((doc) => {
      const clean = sectionTitle(title);
      const me = this.meIn(doc);
      const section = this.sectionIn(doc, me.household_id, id);
      if (section.title === clean) return;
      section.title = clean;
      // Today's visit shows the new name; earlier visits keep the one they had.
      this.relayToday(doc, section.household_id);
    });
  }

  deleteHousekeepingSection(id: string): Promise<void> {
    return this.mutate((doc) => {
      const me = this.meIn(doc);
      const section = this.sectionIn(doc, me.household_id, id);
      // Its tasks move to the top, with no section, after the tasks already there, in order.
      const householdTasks = doc.housekeeping_tasks.filter((t) => t.household_id === section.household_id);
      let next = householdTasks.reduce((n, t) => (t.section_id === null ? Math.max(n, t.position + 1) : n), 0);
      for (const task of this.tasksOf(doc, section.household_id)) {
        if (task.section_id !== section.id) continue;
        task.section_id = null;
        task.position = next++;
      }
      // Every visit's rows forget it (on delete set null) but keep its name; today's follow below.
      for (const r of doc.housekeeping_visit_tasks) if (r.section_id === section.id) r.section_id = null;
      doc.housekeeping_sections = doc.housekeeping_sections.filter((s) => s.id !== section.id);
      this.relayToday(doc, section.household_id);
    });
  }

  moveHousekeepingSection(id: string, index: number): Promise<void> {
    return this.mutate((doc) => {
      const me = this.meIn(doc);
      // move_housekeeping_section: a place from 0 among the others; the positions run 0…n-1.
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) throw invalidInput('index');
      const section = this.sectionIn(doc, me.household_id, id);
      const order = this.sectionsOf(doc, section.household_id).filter((s) => s !== section);
      order.splice(Math.min(index, order.length), 0, section);
      order.forEach((s, position) => (s.position = position));
      this.relayToday(doc, section.household_id);
    });
  }

  setHousekeepingTaskDone(householdId: string, date: ISODate, target: HousekeepingTickTarget, done: boolean): Promise<string> {
    return this.mutate((doc) => {
      requireDate(date);
      const t = (target ?? {}) as { taskId?: unknown; visitTaskId?: unknown };
      const byTask = typeof t.taskId === 'string';
      const byRow = typeof t.visitTaskId === 'string';
      if (byTask === byRow) throw invalidInput('target');
      const me = this.memberOf(doc, householdId);
      if (typeof done !== 'boolean') throw invalidInput('done');

      let row: HousekeepingVisitTaskRow | undefined;
      if (byRow) {
        // That row on any of the household's visits; the date is not used.
        row = doc.housekeeping_visit_tasks.find((r) => r.id === t.visitTaskId && r.household_id === householdId);
      } else {
        const visit = this.visitFor(doc, householdId, date, me);
        row = doc.housekeeping_visit_tasks.find((r) => r.visit_id === visit.id && r.task_id === t.taskId);
      }
      // Throwing stores nothing: a visit this call created goes with it.
      if (!row) throw new BackendError('not_found', 'Task not found on that visit');
      const visit = doc.housekeeping_visits.find((v) => v.id === row.visit_id)!;
      if (row.done !== done) {
        const at = this.stamp();
        row.done = done;
        row.done_by = done ? me.id : null;
        row.done_at = done ? at : null;
        visit.updated_at = at;
        visit.updated_by = me.id;
      }
      return visit.id;
    });
  }

  saveHousekeepingVisit(householdId: string, date: ISODate, patch: HousekeepingVisitPatch): Promise<string> {
    return this.mutate((doc) => {
      requireDate(date);
      const me = this.memberOf(doc, householdId);
      if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw invalidInput('patch');
      const hasComments = patch.comments !== undefined;
      const hasPrice = patch.price_pence !== undefined;
      let comments = '';
      if (hasComments) {
        if (typeof patch.comments !== 'string') throw invalidInput('comments');
        comments = withinLimit(patch.comments.trim(), TEXT_LIMITS.housekeepingComments, 'comments');
      }
      const price = hasPrice ? patch.price_pence : null;
      if (
        price !== null &&
        price !== undefined &&
        (typeof price !== 'number' || !Number.isInteger(price) || price < 0 || price > HOUSEKEEPING_PRICE_MAX_PENCE)
      ) {
        throw invalidInput('price');
      }
      const visit = this.visitFor(doc, householdId, date, me);
      const changed = (hasComments && visit.comments !== comments) || (hasPrice && visit.price_pence !== price);
      if (changed) {
        if (hasComments) visit.comments = comments;
        if (hasPrice) visit.price_pence = price ?? null;
        visit.updated_at = this.stamp();
        visit.updated_by = me.id;
      }
      return visit.id;
    });
  }

  addHousekeepingVisit(householdId: string, date: ISODate): Promise<string> {
    return this.mutate((doc) => {
      requireDate(date);
      const me = this.memberOf(doc, householdId);
      return this.visitFor(doc, householdId, date, me).id;
    });
  }

  deleteHousekeepingVisit(id: string): Promise<void> {
    return this.mutate((doc) => {
      const me = this.meIn(doc);
      const visit = doc.housekeeping_visits.find((v) => v.id === id && v.household_id === me.household_id);
      if (!visit) throw new BackendError('not_found', 'Visit not found');
      doc.housekeeping_visits = doc.housekeeping_visits.filter((v) => v.id !== visit.id);
      // on delete cascade
      doc.housekeeping_visit_tasks = doc.housekeeping_visit_tasks.filter((r) => r.visit_id !== visit.id);
    });
  }

  // ── Goals for the week (docs/ARCHITECTURE.md "Goals for the week") ──
  // Mirrors supabase/migrations/20261025000100_goals.sql: every member edits every week's
  // goals and the public link; anything in another household is not_found; a failed call
  // stores nothing.

  /** HouseholdData.goals: every week's goals in order, and the public link if there is one. */
  private goalsDataOf(doc: DemoDoc, householdId: string): GoalsData {
    const link = doc.goal_links.find((l) => l.household_id === householdId);
    return {
      list: doc.goals
        .filter((g) => g.household_id === householdId)
        .sort(byGoalOrder)
        .map((g) => ({ ...g })),
      link: link ? { token: link.token, created_by: link.created_by, created_at: link.created_at } : null,
    };
  }

  /** The goals of the household's week starting `week`, in order. */
  private weekGoals(doc: DemoDoc, householdId: string, week: ISODate): GoalRow[] {
    return doc.goals.filter((g) => g.household_id === householdId && g.week === week).sort(byGoalOrder);
  }

  /** The caller's goal with this id; not_found when it is gone or in another household. */
  private goalIn(doc: DemoDoc, me: Member, id: string): GoalRow {
    const goal = doc.goals.find((g) => g.id === id && g.household_id === me.household_id);
    if (!goal) throw new BackendError('not_found', 'Goal not found');
    return goal;
  }

  /** Someone in the household (joined or not) to put on a goal; null for no one; not_found otherwise. */
  private goalPerson(doc: DemoDoc, householdId: string, memberId: string | null | undefined): string | null {
    if (memberId === null || memberId === undefined) return null;
    const person = doc.members.find((m) => m.id === memberId && m.household_id === householdId);
    if (!person) throw new BackendError('not_found', 'Person not found');
    return person.id;
  }

  /** A new goal at the end of its week (positions run 0…n-1). */
  private insertGoal(doc: DemoDoc, row: Omit<GoalRow, 'id' | 'position'>): GoalRow {
    const here = this.weekGoals(doc, row.household_id, row.week);
    const goal: GoalRow = { id: uuid(), position: here.length ? Math.max(...here.map((g) => g.position)) + 1 : 0, ...row };
    doc.goals.push(goal);
    return goal;
  }

  addGoal(householdId: string, week: ISODate, title: string, memberId: string | null = null): Promise<Goal> {
    return this.mutate((doc) => {
      const me = this.memberOf(doc, householdId);
      const monday = requireWeek(week);
      const clean = goalTitle(title);
      const person = this.goalPerson(doc, householdId, memberId);
      if (this.weekGoals(doc, householdId, monday).length >= GOALS_PER_WEEK_MAX) {
        throw invalidInput(`goals: a week has ${GOALS_PER_WEEK_MAX} at most`);
      }
      const goal = this.insertGoal(doc, {
        household_id: householdId,
        week: monday,
        title: clean,
        member_id: person,
        done: false,
        done_by: null,
        done_at: null,
        carried_from: null,
        created_by: me.id,
        created_at: this.stamp(),
      });
      return { ...goal };
    });
  }

  renameGoal(id: string, title: string): Promise<void> {
    return this.mutate((doc) => {
      const goal = this.goalIn(doc, this.meIn(doc), id);
      goal.title = goalTitle(title);
    });
  }

  setGoalPerson(id: string, memberId: string | null): Promise<void> {
    return this.mutate((doc) => {
      const goal = this.goalIn(doc, this.meIn(doc), id);
      goal.member_id = this.goalPerson(doc, goal.household_id, memberId);
    });
  }

  setGoalDone(id: string, done: boolean): Promise<void> {
    return this.mutate((doc) => {
      const me = this.meIn(doc);
      if (typeof done !== 'boolean') throw invalidInput('done');
      const goal = this.goalIn(doc, me, id);
      // The same state again keeps the stamp.
      if (goal.done === done) return;
      goal.done = done;
      goal.done_by = done ? me.id : null;
      goal.done_at = done ? this.stamp() : null;
    });
  }

  moveGoal(id: string, index: number): Promise<void> {
    return this.mutate((doc) => {
      const me = this.meIn(doc);
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) throw invalidInput('index');
      const goal = this.goalIn(doc, me, id);
      // Only this goal's place is decided; the week's places run 0…n-1 again.
      const week = this.weekGoals(doc, goal.household_id, goal.week).filter((g) => g !== goal);
      week.splice(Math.min(index, week.length), 0, goal);
      week.forEach((g, position) => (g.position = position));
    });
  }

  deleteGoal(id: string): Promise<void> {
    return this.mutate((doc) => {
      const goal = this.goalIn(doc, this.meIn(doc), id);
      doc.goals = doc.goals.filter((g) => g !== goal);
      // carried_from: on delete set null.
      for (const g of doc.goals) if (g.carried_from === goal.id) g.carried_from = null;
      this.weekGoals(doc, goal.household_id, goal.week).forEach((g, position) => (g.position = position));
    });
  }

  bringOverGoals(householdId: string, week: ISODate): Promise<Goal[]> {
    return this.mutate((doc) => {
      const me = this.memberOf(doc, householdId);
      const monday = requireWeek(week);
      const household = doc.goals.filter((g) => g.household_id === householdId);
      const at = this.stamp();
      return toBringOver(household, monday).map((from) => {
        const goal = this.insertGoal(doc, {
          household_id: householdId,
          week: monday,
          title: from.title,
          member_id: from.member_id,
          done: false,
          done_by: null,
          done_at: null,
          carried_from: from.id,
          created_by: me.id,
          created_at: at,
        });
        return { ...goal };
      });
    });
  }

  goalsLink(householdId: string): Promise<GoalsLink> {
    return this.mutate((doc) => {
      const me = this.memberOf(doc, householdId);
      let link = doc.goal_links.find((l) => l.household_id === householdId);
      if (!link) {
        link = { household_id: householdId, token: newGoalsToken(), created_by: me.id, created_at: this.stamp() };
        doc.goal_links.push(link);
      }
      return { token: link.token, created_by: link.created_by, created_at: link.created_at };
    });
  }

  stopGoalsLink(householdId: string): Promise<void> {
    return this.mutate((doc) => {
      this.memberOf(doc, householdId);
      doc.goal_links = doc.goal_links.filter((l) => l.household_id !== householdId);
    });
  }

  /** No sign-in needed: anyone with the token (this browser's document, in demo mode). */
  publicGoals(token: string): Promise<PublicGoals | null> {
    return this.query((doc) => {
      const link = goalsLinkFor(doc, token);
      return link ? publicGoalsFor(doc, link.household_id, this.now()) : null;
    });
  }

  /**
   * The demo's goals (GOALS_DEMO): last week's and this week's in the household's time zone,
   * every stamp in the past and within its week.
   */
  private addDemoGoals(doc: DemoDoc, household: HouseholdRow, people: Record<DemoPerson, Member>, now: Date) {
    const tz = household.timezone;
    const monday = weekStart(todayIn(tz, now));
    const made: GoalRow[] = [];
    GOALS_DEMO.forEach((seed, i) => {
      const week = shiftWeek(monday, -seed.weeksBack);
      const start = zonedInstant(week, 0, 0, tz).getTime();
      const end = zonedInstant(addDays(week, 7), 0, 0, tz).getTime() - 60_000;
      const created = Math.min(start + i * 60_000, now.getTime());
      const ticked = seed.done
        ? Math.max(created, Math.min(now.getTime() - seed.done.hoursAgo * 3_600_000, end, now.getTime()))
        : null;
      made[i] = this.insertGoal(doc, {
        household_id: household.id,
        week,
        title: seed.title,
        member_id: seed.who ? people[seed.who].id : null,
        done: !!seed.done,
        done_by: seed.done ? people[seed.done.by].id : null,
        done_at: ticked === null ? null : new Date(ticked).toISOString(),
        carried_from: seed.from !== undefined ? (made[seed.from]?.id ?? null) : null,
        created_by: people.me.id,
        created_at: new Date(created).toISOString(),
      });
    });
  }
}

/** A week: its Monday, else invalid_input: week (the goals_week check). */
function requireWeek(value: ISODate): ISODate {
  if (!isWeekStart(value)) throw invalidInput('week');
  return value;
}

/** A goal's title as stored: trimmed, 1 to TEXT_LIMITS.goalTitle characters. */
function goalTitle(value: string): string {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title) throw invalidInput('title');
  return withinLimit(title, TEXT_LIMITS.goalTitle, 'title');
}

/** The public link with this token, compared in constant time; none for one not shaped like a token. */
function goalsLinkFor(doc: DemoDoc, token: string): GoalLinkRow | null {
  if (!isGoalsToken(token)) return null;
  let found: GoalLinkRow | null = null;
  // Every link is compared, so the time taken says nothing about where a token differs.
  for (const link of doc.goal_links) if (sameToken(link.token, token) && !found) found = link;
  return found;
}

/**
 * What a household's public link shows at `now`: the goals of the current week in its time
 * zone (PublicGoals, publicGoalsOf()). The server answers its public op with this too.
 */
export function publicGoalsFor(doc: DemoDoc, householdId: string, now: Date): PublicGoals {
  const household = doc.households.find((h) => h.id === householdId);
  const monday = weekStart(todayIn(household?.timezone ?? 'Europe/London', now));
  const goals = (doc.goals ?? []).filter((g) => g.household_id === householdId);
  const members = doc.members.filter((m) => m.household_id === householdId);
  return publicGoalsOf(goals, members, monday);
}
