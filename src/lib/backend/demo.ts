// Demo backend: the whole database lives in one JSON document in localStorage,
// so the app runs with no Supabase project (local dev, previews, e2e tests).
// Semantics mirror the SQL RPCs, triggers and RLS in docs/ARCHITECTURE.md.
//
// URL switches (read once at start-up, the URL is left alone):
//   ?demo-seed=1   wipe, sign in as Stratis, and recreate the prototype household
//   ?demo-reset=1  wipe everything (signed out, no household)

import {
  CHAT_PAGE_SIZE,
  DEFAULT_ADDRESS,
  DEFAULT_AREAS,
  HOUSEKEEPING_DEMO_NOTE,
  HOUSEKEEPING_DEMO_VISITS,
  HOUSEKEEPING_PRICE_MAX_PENCE,
  HOUSEKEEPING_STARTER_TASKS,
  MEMBER_COLORS,
  REACTION_EMOJIS,
  SEED_ITEMS,
  TEXT_LIMITS,
  type DemoPersonKey,
} from '../constants';
import { addDays, addMonths, daysBetween, deviceTimeZone, parseISODate, todayIn, zonedParts } from '../logic/dates';
import { emptyHousekeeping } from '../logic/housekeeping';
import { applyKindRules, nextDueDate } from '../logic/items';
import type {
  Area,
  AuthUser,
  ChatChange,
  ChatMessage,
  ChatPage,
  ChatReaction,
  Completion,
  CreateHouseholdInput,
  Household,
  HouseholdData,
  HousekeepingData,
  HousekeepingTask,
  HousekeepingTickTarget,
  HousekeepingVisit,
  HousekeepingVisitPatch,
  HousekeepingVisitTask,
  InvitePreview,
  ISODate,
  ISOTimestamp,
  Item,
  ItemDraft,
  ItemKind,
  ItemStatus,
  JoinHouseholdInput,
  Member,
  PushSubscriptionInput,
} from '../types';
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

/**
 * The group chat every demo household starts with: yesterday evening and this
 * morning in household time (a day earlier while this morning is still ahead).
 * Reactions follow their message a minute apart, in this order.
 */
const SEED_CHAT: {
  who: DemoPerson;
  daysBack: number;
  hour: number;
  minute: number;
  body: string;
  reactions?: { who: DemoPerson; emoji: string }[];
}[] = [
  { who: 'shea', daysBack: 1, hour: 18, minute: 42, body: 'The heating engineer can come on Saturday between 10 and 12. Is anyone in?' },
  { who: 'me', daysBack: 1, hour: 18, minute: 51, body: "I'm in all morning, I'll let him in.", reactions: [{ who: 'shea', emoji: '🙏' }] },
  { who: 'ela', daysBack: 1, hour: 19, minute: 7, body: 'Thank you! The hallway is freezing at night.' },
  { who: 'ela', daysBack: 1, hour: 21, minute: 15, body: 'Also, is the old firepit still up for grabs? I could pick it up on Sunday.' },
  {
    who: 'shea',
    daysBack: 1,
    hour: 21,
    minute: 22,
    body: "It's all yours 🔥 I'll leave it by the side gate.",
    reactions: [
      { who: 'ela', emoji: '❤️' },
      { who: 'me', emoji: '👍' },
    ],
  },
  {
    who: 'me',
    daysBack: 0,
    hour: 8,
    minute: 5,
    body: 'Restocked the olive oil, the 5L tin is in the pantry.',
    reactions: [
      { who: 'shea', emoji: '👍' },
      { who: 'ela', emoji: '❤️' },
    ],
  },
  { who: 'shea', daysBack: 0, hour: 8, minute: 19, body: "Legend. We're nearly out of the jacuzzi test strips too." },
  {
    who: 'ela',
    daysBack: 0,
    hour: 8,
    minute: 31,
    body: "I'll order a new pack today.",
    reactions: [
      { who: 'me', emoji: '👍' },
      { who: 'shea', emoji: '🙏' },
    ],
  },
];

// ── Stored rows (SQL columns, including the ones the UI types leave out) ──

interface HouseholdRow extends Household {
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;
  updated_by: string | null;
}
interface AreaRow extends Area {
  created_at: ISOTimestamp;
}
interface ItemRow extends Item {
  completed_at: ISOTimestamp | null;
}
interface CompletionRow extends Completion {
  prev_due_date: ISODate | null;
  prev_status: ItemStatus;
}
interface InviteRow {
  id: string;
  household_id: string;
  token: string;
  created_by: string | null;
  created_at: ISOTimestamp;
  expires_at: ISOTimestamp;
}
interface PushSubRow {
  id: string;
  member_id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: ISOTimestamp;
}
interface MessageRow {
  id: string;
  household_id: string;
  /** Null once the sender's member row is gone (on delete set null). */
  member_id: string | null;
  body: string;
  created_at: ISOTimestamp;
}
/** Primary key (message_id, member_id, emoji); household_id is copied from the message. */
interface ReactionRow extends ChatReaction {
  household_id: string;
}
/** housekeeping_notes: one row per household (primary key household_id); none = never written. */
interface HousekeepingNoteRow {
  household_id: string;
  body: string;
  updated_at: ISOTimestamp;
  updated_by: string | null;
}
interface HousekeepingTaskRow extends HousekeepingTask {
  created_at: ISOTimestamp;
}
/** housekeeping_visits (unique household_id + visit_date); its tasks are separate rows. */
type HousekeepingVisitRow = Omit<HousekeepingVisit, 'tasks'>;
/** housekeeping_visit_tasks (unique visit_id + task_id); household_id is copied from the visit. */
type HousekeepingVisitTaskRow = HousekeepingVisitTask;

interface DemoDoc {
  version: 1;
  /** Signed-in user id, or null. */
  session: string | null;
  users: AuthUser[];
  households: HouseholdRow[];
  members: Member[];
  areas: AreaRow[];
  items: ItemRow[];
  completions: CompletionRow[];
  invites: InviteRow[];
  push_subs: PushSubRow[];
  /** Chat came later: read() fills these in for documents stored before it. */
  messages: MessageRow[];
  message_reactions: ReactionRow[];
  /**
   * Housekeeping came later still: read() fills these in for documents stored before it,
   * and gives each household the starter task list once (like the migration's backfill).
   */
  housekeeping_notes: HousekeepingNoteRow[];
  housekeeping_tasks: HousekeepingTaskRow[];
  housekeeping_visits: HousekeepingVisitRow[];
  housekeeping_visit_tasks: HousekeepingVisitTaskRow[];
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
/** message_reactions.emoji: 1 to 16 characters. */
const REACTION_EMOJI_MAX = 16;

function emptyDoc(): DemoDoc {
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
    messages: [],
    message_reactions: [],
    housekeeping_notes: [],
    housekeeping_tasks: [],
    housekeeping_visits: [],
    housekeeping_visit_tasks: [],
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

/** The task list in its order: position, then created_at, then id. */
function byTaskOrder(a: HousekeepingTaskRow, b: HousekeepingTaskRow): number {
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
const toItem = ({ completed_at: _c, ...item }: ItemRow): Item => item;
const toCompletion = ({ prev_due_date: _d, prev_status: _s, ...c }: CompletionRow): Completion => c;
const toReaction = ({ household_id: _h, ...r }: ReactionRow): ChatReaction => r;
const toHousekeepingTask = (t: HousekeepingTaskRow): HousekeepingTask => ({
  id: t.id,
  household_id: t.household_id,
  title: t.title,
  position: t.position,
});
const toVisitTask = (r: HousekeepingVisitTaskRow): HousekeepingVisitTask => ({
  id: r.id,
  visit_id: r.visit_id,
  household_id: r.household_id,
  task_id: r.task_id,
  title: r.title,
  position: r.position,
  done: r.done,
  done_by: r.done_by,
  done_at: r.done_at,
});

const timeOf = (ts: ISOTimestamp) => new Date(ts).getTime();

/** Chat order: created_at, then id (created_at is unique per household, so the id never decides). */
function byCreated(a: MessageRow, b: MessageRow): number {
  return timeOf(a.created_at) - timeOf(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** listMessages' page size: a positive whole number, CHAT_PAGE_SIZE when missing or not a number. */
function pageSize(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return CHAT_PAGE_SIZE;
  return Math.max(1, Math.floor(limit));
}

interface ChatListener {
  householdId: string;
  onChange: (change: ChatChange) => void;
  /** The household's chat as last reported, so storage events that leave it alone stay quiet. */
  seen: string;
}

export class DemoBackend implements Backend {
  readonly kind = 'demo' as const;

  private storage: StorageLike;
  private readonly now: () => Date;
  private readonly account: AuthUser;
  private readonly latency: number;
  private authListeners = new Set<(user: AuthUser | null) => void>();
  private chatListeners = new Set<ChatListener>();

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
      if (!Array.isArray(doc.messages)) doc.messages = [];
      if (!Array.isArray(doc.message_reactions)) doc.message_reactions = [];
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
      if (!Array.isArray(parsed.housekeeping_tasks)) {
        doc.housekeeping_tasks = [];
        this.backfillStarterTasks(doc);
      }
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
        .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
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
      return { household: toHousehold(household), members, areas, items, completions, housekeeping };
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
      email: user.email,
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
    this.addChat(doc, household, people, now);
    this.addStarterTasks(doc, household.id, now);
    this.addHousekeepingHistory(doc, household, people, now);
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
      for (const task of tasks) {
        const done = seed.done.includes(task.title);
        const at = created + ticks * 60_000;
        if (done) ticks += 1;
        doc.housekeeping_visit_tasks.push({
          id: uuid(),
          visit_id: visit.id,
          household_id: household.id,
          task_id: task.id,
          title: task.title,
          position: task.position,
          done,
          done_by: done ? by : null,
          done_at: done ? new Date(at).toISOString() : null,
        });
      }
      if (ticks > 0) visit.updated_at = new Date(created + ticks * 60_000).toISOString();
      doc.housekeeping_visits.push(visit);
    }
  }

  /** SEED_CHAT with its reactions, every timestamp in the past. */
  private addChat(doc: DemoDoc, household: HouseholdRow, people: Record<DemoPerson, Member>, now: Date) {
    const tz = household.timezone;
    const today = todayIn(tz, now);
    const at = (daysBack: number, hour: number, minute: number) => zonedInstant(addDays(today, -daysBack), hour, minute, tz);
    // The last message and its reactions must already have happened: before 08:36 or so,
    // "this morning" is still ahead, so the whole conversation moves a day earlier.
    const last = SEED_CHAT[SEED_CHAT.length - 1];
    const shift = at(last.daysBack, last.hour, last.minute + 5).getTime() > now.getTime() ? 1 : 0;
    for (const seed of SEED_CHAT) {
      const sent = at(seed.daysBack + shift, seed.hour, seed.minute).getTime();
      const message: MessageRow = {
        id: uuid(),
        household_id: household.id,
        member_id: people[seed.who].id,
        body: seed.body,
        created_at: new Date(sent).toISOString(),
      };
      doc.messages.push(message);
      (seed.reactions ?? []).forEach((r, i) => {
        doc.message_reactions.push({
          message_id: message.id,
          member_id: people[r.who].id,
          household_id: household.id,
          emoji: r.emoji,
          created_at: new Date(sent + (i + 1) * 60_000).toISOString(),
        });
      });
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
      items: SEED_ITEMS,
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
      const housemates = doc.members.filter((m) => m.household_id === invite.household_id);
      const count = housemates.length;
      // Join order is created_at order, so never stamp before the latest member (fixed test clocks).
      const latest = Math.max(...housemates.map((m) => new Date(m.created_at).getTime()));
      const joinedAt = new Date(Math.max(this.now().getTime(), latest + 1)).toISOString();
      doc.members.push({
        id: uuid(),
        household_id: invite.household_id,
        user_id: user.id,
        name: withinLimit(
          (input.memberName ?? '').trim() || user.name.trim() || user.email.split('@')[0] || 'Me',
          TEXT_LIMITS.memberName,
          'name',
        ),
        email: user.email,
        emoji: withinLimit(input.memberEmoji || '🦔', TEXT_LIMITS.memberEmoji, 'emoji'),
        color: MEMBER_COLORS[count % MEMBER_COLORS.length],
        role: 'member',
        weekly_email: true,
        push_enabled: false,
        created_at: joinedAt,
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
      return { household_name: h.name, address: h.address };
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

  // ── Chat (one group chat per household, kept forever) ──
  // RLS: members read and post; only your own messages and reactions can be deleted.

  /** Messages as the API returns them, each with its reactions oldest first. */
  private toMessages(doc: DemoDoc, rows: MessageRow[]): ChatMessage[] {
    const ids = new Set(rows.map((m) => m.id));
    const reactions = new Map<string, ChatReaction[]>();
    doc.message_reactions
      .filter((r) => ids.has(r.message_id))
      .sort((a, b) => timeOf(a.created_at) - timeOf(b.created_at))
      .forEach((r) => {
        const list = reactions.get(r.message_id) ?? [];
        list.push(toReaction(r));
        reactions.set(r.message_id, list);
      });
    return rows.map((m) => ({
      id: m.id,
      household_id: m.household_id,
      member_id: m.member_id,
      body: m.body,
      created_at: m.created_at,
      reactions: reactions.get(m.id) ?? [],
    }));
  }

  listMessages(householdId: string, opts: { before?: ISOTimestamp; limit?: number } = {}): Promise<ChatPage> {
    return this.query((doc) => {
      this.memberOf(doc, householdId);
      const before = opts.before == null ? Infinity : timeOf(opts.before);
      if (Number.isNaN(before)) throw invalidInput('before');
      const older = doc.messages
        .filter((m) => m.household_id === householdId && timeOf(m.created_at) < before)
        .sort(byCreated);
      const page = older.slice(Math.max(0, older.length - pageSize(opts.limit)));
      return { messages: this.toMessages(doc, page), hasMore: page.length < older.length };
    });
  }

  getMessages(ids: string[]): Promise<ChatMessage[]> {
    return this.query((doc) => {
      const user = this.userIn(doc);
      // RLS filters rather than refuses: anything outside your household is simply missing.
      const me = doc.members.find((m) => m.user_id === user.id);
      if (!me) return [];
      const wanted = new Set(ids);
      const rows = doc.messages.filter((m) => wanted.has(m.id) && m.household_id === me.household_id).sort(byCreated);
      return this.toMessages(doc, rows);
    });
  }

  sendMessage(householdId: string, body: string): Promise<ChatMessage> {
    return this.chatWrite((doc) => {
      const me = this.memberOf(doc, householdId);
      const text = (body ?? '').trim();
      if (!text || charCount(text) > TEXT_LIMITS.chatMessage) throw invalidInput('body');
      // Strictly after the newest message, even within one millisecond, so paging by
      // created_at never skips or repeats a message.
      const newest = doc.messages.reduce(
        (t, m) => (m.household_id === householdId ? Math.max(t, timeOf(m.created_at)) : t),
        -Infinity,
      );
      const row: MessageRow = {
        id: uuid(),
        household_id: householdId,
        member_id: me.id,
        body: text,
        created_at: new Date(Math.max(this.now().getTime(), newest + 1)).toISOString(),
      };
      doc.messages.push(row);
      const change: ChatChange = { type: 'message', messageId: row.id, deleted: false };
      return { result: this.toMessages(doc, [row])[0], householdId, change };
    });
  }

  deleteMessage(id: string): Promise<void> {
    return this.chatWrite((doc) => {
      const me = this.meIn(doc);
      const row = doc.messages.find((m) => m.id === id && m.household_id === me.household_id && m.member_id === me.id);
      if (!row) throw new BackendError('not_found', 'Message not found');
      doc.messages = doc.messages.filter((m) => m.id !== row.id);
      // on delete cascade
      doc.message_reactions = doc.message_reactions.filter((r) => r.message_id !== row.id);
      const change: ChatChange = { type: 'message', messageId: row.id, deleted: true };
      return { result: undefined, householdId: row.household_id, change };
    });
  }

  setReaction(messageId: string, emoji: string, on: boolean): Promise<void> {
    return this.chatWrite((doc) => {
      const user = this.userIn(doc);
      const value = emoji ?? '';
      const changed: ChatChange = { type: 'reaction', messageId };
      if (!on) {
        // A delete that matches nothing is fine (already off, the message is gone, or no household).
        const me = doc.members.find((m) => m.user_id === user.id);
        const count = doc.message_reactions.length;
        if (me) {
          doc.message_reactions = doc.message_reactions.filter(
            (r) => !(r.message_id === messageId && r.member_id === me.id && r.emoji === value),
          );
        }
        const didChange = doc.message_reactions.length < count;
        return { result: undefined, householdId: me?.household_id ?? '', change: didChange ? changed : null };
      }
      const me = this.meIn(doc);
      const mine = (r: ReactionRow) => r.message_id === messageId && r.member_id === me.id && r.emoji === value;
      const done = (didChange: boolean) => ({ result: undefined, householdId: me.household_id, change: didChange ? changed : null });
      // Only the app's reaction emoji, like the migration's message_reactions_emoji_allowed.
      if (!value || charCount(value) > REACTION_EMOJI_MAX || !(REACTION_EMOJIS as readonly string[]).includes(value)) {
        throw invalidInput('emoji');
      }
      const message = doc.messages.find((m) => m.id === messageId && m.household_id === me.household_id);
      if (!message) throw new BackendError('not_found', 'Message not found');
      if (doc.message_reactions.some(mine)) return done(false);
      doc.message_reactions.push({
        message_id: message.id,
        member_id: me.id,
        household_id: message.household_id,
        emoji: value,
        created_at: this.stamp(),
      });
      return done(true);
    });
  }

  subscribeChat(householdId: string, onChange: (change: ChatChange) => void): Unsubscribe {
    const listener: ChatListener = { householdId, onChange, seen: this.chatSnapshot(householdId) };
    this.chatListeners.add(listener);
    // Another tab wrote to the document: resync when this household's chat is not as last seen.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== DEMO_STORAGE_KEY && e.key !== null) return;
      const seen = this.chatSnapshot(householdId);
      if (seen === listener.seen) return;
      listener.seen = seen;
      onChange({ type: 'resync' });
    };
    const hasWindow = typeof window !== 'undefined';
    if (hasWindow) window.addEventListener('storage', onStorage);
    return () => {
      this.chatListeners.delete(listener);
      if (hasWindow) window.removeEventListener('storage', onStorage);
    };
  }

  /** The household's messages and reactions as stored, to tell whether they changed. */
  private chatSnapshot(householdId: string, doc: DemoDoc = this.read()): string {
    return JSON.stringify([
      doc.messages.filter((m) => m.household_id === householdId),
      doc.message_reactions.filter((r) => r.household_id === householdId),
    ]);
  }

  /**
   * Runs a chat write, then reports its change (null: nothing changed, like a
   * realtime feed) to this instance's listeners for that household, just
   * before the returned promise settles. Other tabs hear of it through storage events.
   */
  private async chatWrite<T>(
    fn: (doc: DemoDoc) => { result: T; householdId: string; change: ChatChange | null },
  ): Promise<T> {
    let seen = '';
    const { result, householdId, change } = await this.mutate((doc) => {
      const out = fn(doc);
      // Snapshot the document as written, not after the delay, so another tab's write
      // in between still reads as a change.
      if (out.change) seen = this.chatSnapshot(out.householdId, doc);
      return out;
    });
    if (!change) return result;
    for (const l of [...this.chatListeners]) {
      if (l.householdId !== householdId) continue;
      l.seen = seen;
      try {
        l.onChange(change);
      } catch (err) {
        // The write is stored; a failing listener must not make it look failed.
        console.error(err);
      }
    }
    return result;
  }

  // ── Housekeeping (docs/ARCHITECTURE.md "Housekeeping") ──
  // Mirrors supabase/migrations/20261010000400_housekeeping.sql: the RPCs, the triggers that
  // keep today's visit in step with the task list, and RLS (every member edits everything;
  // anything in another household is not_found). A failed call stores nothing (run() only
  // writes the document when fn succeeds), so a visit created by a failed write goes too.

  /** The household's task list in order (position, created_at, id). */
  private tasksOf(doc: DemoDoc, householdId: string): HousekeepingTaskRow[] {
    return doc.housekeeping_tasks.filter((t) => t.household_id === householdId).sort(byTaskOrder);
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

  /** housekeeping_tasks insert (and its triggers): last on the list, and on today's visit. */
  private insertTask(doc: DemoDoc, householdId: string, title: string, createdAt: ISOTimestamp): HousekeepingTaskRow {
    const siblings = doc.housekeeping_tasks.filter((t) => t.household_id === householdId);
    const task: HousekeepingTaskRow = {
      id: uuid(),
      household_id: householdId,
      title,
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
        position: task.position,
        done: false,
        done_by: null,
        done_at: null,
      });
    }
    return task;
  }

  /** The caller's task with this id; not_found when it is gone or in another household. */
  private taskIn(doc: DemoDoc, me: Member, id: string): HousekeepingTaskRow {
    const task = doc.housekeeping_tasks.find((t) => t.id === id && t.household_id === me.household_id);
    if (!task) throw new BackendError('not_found', 'Task not found');
    return task;
  }

  /** Today's visit's row for a task (the triggers' target), if any. */
  private todaysRowFor(doc: DemoDoc, task: HousekeepingTaskRow): HousekeepingVisitTaskRow | undefined {
    const today = this.todaysVisit(doc, task.household_id);
    return today ? doc.housekeeping_visit_tasks.find((r) => r.visit_id === today.id && r.task_id === task.id) : undefined;
  }

  /**
   * housekeeping_visit_for(): the household's visit on `date`, created with its copies if
   * there is none (recorded by `me`). A day after today (household time zone) is
   * invalid_input: date. A new visit copies the task list (none done) and the message as it
   * stood that day: its text if it was last changed on or before `date`, else ''.
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
    for (const task of this.tasksOf(doc, householdId)) {
      doc.housekeeping_visit_tasks.push({
        id: uuid(),
        visit_id: visit.id,
        household_id: householdId,
        task_id: task.id,
        title: task.title,
        position: task.position,
        done: false,
        done_by: null,
        done_at: null,
      });
    }
    return visit;
  }

  /** HouseholdData.housekeeping: the message, the task list and every visit with its rows. */
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
      const row: HousekeepingNoteRow = { household_id: householdId, body: text, updated_at: this.stamp(), updated_by: me.id };
      if (note) Object.assign(note, row);
      else doc.housekeeping_notes.push(row);
    });
  }

  createHousekeepingTask(householdId: string, title: string): Promise<HousekeepingTask> {
    return this.mutate((doc) => {
      const clean = taskTitle(title);
      this.memberOf(doc, householdId);
      return toHousekeepingTask(this.insertTask(doc, householdId, clean, this.stamp()));
    });
  }

  renameHousekeepingTask(id: string, title: string): Promise<void> {
    return this.mutate((doc) => {
      const clean = taskTitle(title);
      const task = this.taskIn(doc, this.meIn(doc), id);
      if (task.title === clean) return;
      task.title = clean;
      // Today's visit follows, ticked or not; earlier visits keep the title they had.
      const row = this.todaysRowFor(doc, task);
      if (row) row.title = clean;
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
    });
  }

  reorderHousekeepingTasks(householdId: string, orderedIds: string[]): Promise<void> {
    return this.mutate((doc) => {
      this.memberOf(doc, householdId);
      (orderedIds ?? []).forEach((id, index) => {
        const task = doc.housekeeping_tasks.find((t) => t.id === id && t.household_id === householdId);
        if (!task || task.position === index) return;
        task.position = index;
        const row = this.todaysRowFor(doc, task);
        if (row) row.position = index;
      });
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
}
