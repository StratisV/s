// Demo backend: the whole database lives in one JSON document in localStorage,
// so the app runs with no Supabase project (local dev, previews, e2e tests).
// Semantics mirror the SQL RPCs, triggers and RLS in docs/ARCHITECTURE.md.
//
// URL switches (read once at start-up, the URL is left alone):
//   ?demo-seed=1   wipe, sign in as Stratis, and recreate the prototype household
//   ?demo-reset=1  wipe everything (signed out, no household)

import { DEFAULT_ADDRESS, DEFAULT_AREAS, MEMBER_COLORS, SEED_ITEMS } from '../constants';
import { addDays, addMonths, daysBetween, deviceTimeZone, parseISODate, todayIn, zonedParts } from '../logic/dates';
import { nextDueDate } from '../logic/items';
import type {
  Area,
  AuthUser,
  Completion,
  CreateHouseholdInput,
  Household,
  HouseholdData,
  InvitePreview,
  ISODate,
  ISOTimestamp,
  Item,
  ItemDraft,
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

type DemoPerson = 'me' | 'shea' | 'ela';

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

function invalidInput(what: string): BackendError {
  return new BackendError('unknown', `invalid_input: ${what}`);
}

function requireText(value: string | undefined, what: string): string {
  const v = (value ?? '').trim();
  if (!v) throw invalidInput(what);
  return v;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
      return { ...emptyDoc(), ...parsed };
    } catch {
      return emptyDoc();
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
      return { household: toHousehold(household), members, areas, items, completions };
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
      name: requireText(input.name, 'name'),
      address: (input.address ?? '').trim(),
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
      name: (input.memberName ?? '').trim() || user.name.trim() || user.email.split('@')[0] || 'Me',
      email: user.email,
      emoji: input.memberEmoji || '🦔',
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
      doc.items.push({
        id: uuid(),
        household_id: household.id,
        area_id: area.id,
        title: seed.title.trim(),
        note: seed.note ?? '',
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
      });
    });

    this.addHistory(doc, household, people, now);
    return household.id;
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
        name: (input.memberName ?? '').trim() || user.name.trim() || user.email.split('@')[0] || 'Me',
        email: user.email,
        emoji: input.memberEmoji || '🦔',
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
      if (patch.name !== undefined) h.name = requireText(patch.name, 'name');
      if (patch.address !== undefined) h.address = patch.address.trim();
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
      if (patch.name !== undefined) member.name = requireText(patch.name, 'name');
      if (patch.emoji !== undefined) member.emoji = requireText(patch.emoji, 'emoji');
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
        name: requireText(name, 'name'),
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
      area.name = requireText(name, 'name');
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
      const item: ItemRow = {
        id: uuid(),
        household_id: area.household_id,
        area_id: area.id,
        title: requireText(draft.title, 'title'),
        note: draft.note ?? '',
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
      };
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
      if (patch.title !== undefined) next.title = requireText(patch.title, 'title');
      if (patch.note !== undefined) next.note = patch.note;
      if (patch.rag !== undefined) next.rag = patch.rag;
      if (patch.due_date !== undefined) next.due_date = patch.due_date;
      if (patch.assignee_id !== undefined) next.assignee_id = patch.assignee_id;
      if (patch.repeat !== undefined) next.repeat = patch.repeat;
      if (patch.notify !== undefined) next.notify = patch.notify;
      this.checkAssignee(doc, item.household_id, next.assignee_id);
      next.updated_at = this.stamp();
      next.updated_by = me.id;
      Object.assign(item, next);
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
      const row: PushSubRow = {
        id: uuid(),
        member_id: me.id,
        user_id: user.id,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        created_at: this.stamp(),
      };
      doc.push_subs = [...doc.push_subs.filter((s) => s.endpoint !== sub.endpoint), row];
    });
  }

  deletePushSubscription(endpoint: string): Promise<void> {
    return this.mutate((doc) => {
      const user = this.userIn(doc);
      doc.push_subs = doc.push_subs.filter((s) => !(s.endpoint === endpoint && s.user_id === user.id));
    });
  }
}
