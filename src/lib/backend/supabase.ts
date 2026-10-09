// Production backend: Supabase Auth (Google), PostgREST tables and RPCs, Realtime.
// Table, column and RPC names follow docs/ARCHITECTURE.md ("Database"). Row level security
// lets every member edit everything in their household and hides everything else, so a
// write that touches zero rows means "not found, or not yours" and becomes 'not_found'.

import {
  createClient,
  isAuthRetryableFetchError,
  type Session,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { CHAT_PAGE_SIZE, REACTION_EMOJIS, TEXT_LIMITS } from '../constants';
import { instantOf } from '../logic/chat';
import { emptyHousekeeping } from '../logic/housekeeping';
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
  HousekeepingNote,
  HousekeepingTask,
  HousekeepingTickTarget,
  HousekeepingVisit,
  HousekeepingVisitPatch,
  HousekeepingVisitTask,
  InvitePreview,
  Item,
  ISODate,
  ISOTimestamp,
  ItemDraft,
  JoinHouseholdInput,
  Member,
  PushSubscriptionInput,
} from '../types';
import {
  BackendError,
  type Backend,
  type BackendErrorCode,
  type HouseholdPatch,
  type ItemPatch,
  type MemberPatch,
  type Unsubscribe,
} from './types';

// ── Columns (only what the UI types carry) ─────────────────

const HOUSEHOLD_COLS = 'id, name, address, timezone, weekly_email_day, weekly_email_time';
const MEMBER_COLS =
  'id, household_id, user_id, name, email, emoji, color, role, weekly_email, push_enabled, created_at';
const AREA_COLS = 'id, household_id, name, position';
const ITEM_COLS =
  'id, household_id, area_id, kind, title, note, good, rag, due_date, assignee_id, repeat, notify, status, created_by, updated_by, created_at, updated_at';
const COMPLETION_COLS = 'id, household_id, item_id, item_title, credited_to, completed_by, completed_at';
const MESSAGE_COLS = 'id, household_id, member_id, body, created_at';
/** A message with every reaction on it, in one request (PostgREST resource embedding). */
const MESSAGE_WITH_REACTIONS = `${MESSAGE_COLS}, reactions:message_reactions(message_id, member_id, emoji, created_at)`;
const HOUSEKEEPING_NOTE_COLS = 'body, updated_at, updated_by';
const HOUSEKEEPING_TASK_COLS = 'id, household_id, title, position';
const HOUSEKEEPING_VISIT_TASK_COLS = 'id, visit_id, household_id, task_id, title, position, done, done_by, done_at';
/** A visit with its tasks, in one request (PostgREST resource embedding). */
const HOUSEKEEPING_VISIT_WITH_TASKS =
  'id, household_id, visit_date, note, comments, price_pence, created_by, created_at, updated_by, updated_at, ' +
  `tasks:housekeeping_visit_tasks(${HOUSEKEEPING_VISIT_TASK_COLS})`;

/** Columns each patch may write (the DB grants UPDATE on exactly these). */
const HOUSEHOLD_PATCH_KEYS = ['name', 'address', 'timezone'] as const;
const MEMBER_PATCH_KEYS = ['name', 'emoji', 'weekly_email', 'push_enabled'] as const;
const ITEM_PATCH_KEYS = [
  'area_id',
  'kind',
  'title',
  'note',
  'good',
  'rag',
  'due_date',
  'assignee_id',
  'repeat',
  'notify',
] as const;

/** Rows per request when reading lists. Must not exceed the API's max_rows (1000 by default). */
const PAGE = 1000;

/** message_reactions.emoji: 1 to 16 characters (constraint message_reactions_emoji_length). */
const REACTION_EMOJI_MAX = 16;
/** Message ids per getMessages request, so the URL stays short. */
const IDS_PER_REQUEST = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Stands in for an id that is not a uuid in reorderHousekeepingTasks: it matches no row. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Messages the RPCs and triggers raise that map straight onto a BackendErrorCode. */
const RPC_CODES: ReadonlySet<string> = new Set<BackendErrorCode>([
  'not_signed_in',
  'already_member',
  'invalid_invite',
  'not_found',
]);

// ── Errors ─────────────────────────────────────────────────

interface ErrorLike {
  name?: string;
  message?: string;
  code?: string;
  status?: number;
}

const NETWORK_MESSAGE = /failed to fetch|fetch failed|load failed|networkerror|network request failed|^aborterror/i;

/**
 * Maps anything supabase-js returns or throws to a BackendError:
 * - an RPC/trigger message (not_signed_in, already_member, invalid_invite, not_found) keeps its code;
 * - invalid_input has no code of its own, so it becomes 'unknown' with that message;
 * - a check violation (23514, the size and format limits) is 'unknown' with
 *   "invalid_input: <constraint name>";
 * - an RLS rejection on insert/update (42501 "row-level security") is 'not_found', like any
 *   other row the caller cannot see;
 * - a rejected or expired JWT (HTTP 401) is 'not_signed_in';
 * - fetch failures (HTTP status 0, TypeError, AuthRetryableFetchError) are 'network';
 * - anything else is 'unknown' with the original message.
 */
export function toBackendError(err: unknown, httpStatus?: number): BackendError {
  if (err instanceof BackendError) return err;
  const e: ErrorLike = typeof err === 'object' && err !== null ? (err as ErrorLike) : { message: String(err) };
  const message = typeof e.message === 'string' ? e.message.trim() : '';

  if (RPC_CODES.has(message)) return new BackendError(message as BackendErrorCode);
  if (message === 'invalid_input') return new BackendError('unknown', 'invalid_input');
  // A size or format limit (check constraint, supabase/migrations/20261009000100_hardening.sql).
  if (e.code === '23514') {
    const constraint = /constraint "([^"]+)"/.exec(message)?.[1];
    return new BackendError('unknown', `invalid_input: ${constraint ?? message}`);
  }
  if (e.code === '42501' && /row-level security/i.test(message)) return new BackendError('not_found', message);
  if (httpStatus === 401 || e.status === 401 || /^PGRST30[1-3]$/.test(e.code ?? '')) {
    return new BackendError('not_signed_in', message || undefined);
  }
  const isNetwork =
    httpStatus === 0 ||
    isAuthRetryableFetchError(err) ||
    e.name === 'TypeError' ||
    e.name === 'AbortError' ||
    NETWORK_MESSAGE.test(message);
  if (isNetwork) return new BackendError('network', message || undefined);
  return new BackendError('unknown', message || undefined);
}

interface QueryResult {
  data: unknown;
  error: unknown;
  status: number;
}

/** Awaits a PostgREST query (or RPC) and returns its data, throwing a BackendError on failure. */
async function run<T>(query: PromiseLike<QueryResult>): Promise<T> {
  let res: QueryResult;
  try {
    res = await query;
  } catch (err) {
    throw toBackendError(err);
  }
  if (res.error) throw toBackendError(res.error, res.status);
  return res.data as T;
}

/** For writes that select `id` back: zero rows means the row is gone or belongs to another household. */
async function runAffecting(query: PromiseLike<QueryResult>): Promise<void> {
  const rows = await run<{ id: string }[] | null>(query);
  if (!rows || rows.length === 0) throw new BackendError('not_found');
}

/** Reads every page of a list query (the API caps each response at max_rows). */
async function runAll<T>(page: (from: number, to: number) => PromiseLike<QueryResult>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = (await run<T[] | null>(page(from, from + PAGE - 1))) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

function invalidInput(what: string): BackendError {
  return new BackendError('unknown', `invalid_input: ${what}`);
}

function requireText(value: string, what: string): string {
  const v = (value ?? '').trim();
  if (!v) throw invalidInput(what);
  return v;
}

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** A real calendar day written YYYY-MM-DD (what a SQL date parameter accepts); else invalid_input: date. */
function requireDate(value: ISODate): ISODate {
  const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  const [y, month, d] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  const days = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (!m || y < 1 || !days || d < 1 || d > days) throw invalidInput('date');
  return value;
}

/** Ids PostgREST would refuse to cast never name a row: not_found without a request. */
function requireUuid(id: string): string {
  if (typeof id !== 'string' || !UUID.test(id)) throw new BackendError('not_found');
  return id;
}

/** Copies the allowed keys that are present (undefined means "leave as is"). */
function pick<T extends object, K extends keyof T>(patch: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (patch[k] !== undefined) out[k] = patch[k];
  return out;
}

// ── Row mapping ────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Google puts the name in full_name (or name) and the photo in avatar_url (or picture). */
export function toAuthUser(user: User): AuthUser {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const email = user.email ?? '';
  const name = str(meta.full_name) || str(meta.name) || email.split('@')[0] || '';
  const avatarUrl = str(meta.avatar_url) || str(meta.picture);
  return avatarUrl ? { id: user.id, email, name, avatarUrl } : { id: user.id, email, name };
}

/** Postgres `time` comes back as HH:MM:SS; the app uses HH:MM. */
export function toHHMM(time: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? '');
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '08:00';
}

function toHousehold(row: Household): Household {
  return {
    id: row.id,
    name: row.name,
    address: row.address ?? '',
    timezone: row.timezone,
    weekly_email_day: Number(row.weekly_email_day),
    weekly_email_time: toHHMM(row.weekly_email_time),
  };
}

// ── Chat rows ──────────────────────────────────────────────

interface MessageRow {
  id: string;
  household_id: string;
  member_id: string | null;
  body: string;
  created_at: ISOTimestamp;
  reactions?: ChatReaction[] | null;
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Chat order: created_at (to the microsecond), then id. */
function byCreated(a: MessageRow, b: MessageRow): number {
  return instantOf(a.created_at) - instantOf(b.created_at) || compareText(a.id, b.id);
}

/** Exactly the contract's shape, reactions oldest first. */
function toChatMessage(row: MessageRow): ChatMessage {
  const reactions = (row.reactions ?? [])
    .map((r) => ({ message_id: r.message_id, member_id: r.member_id, emoji: r.emoji, created_at: r.created_at }))
    .sort(
      (a, b) =>
        instantOf(a.created_at) - instantOf(b.created_at) ||
        compareText(a.member_id, b.member_id) ||
        compareText(a.emoji, b.emoji),
    );
  return {
    id: row.id,
    household_id: row.household_id,
    member_id: row.member_id,
    body: row.body,
    created_at: row.created_at,
    reactions,
  };
}

/**
 * listMessages' page size: a positive whole number, CHAT_PAGE_SIZE when missing or not a
 * number, and below the API's max_rows so the extra row that tells "there is more" fits.
 */
function chatPageSize(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return CHAT_PAGE_SIZE;
  return Math.min(PAGE - 1, Math.max(1, Math.floor(limit)));
}

/** Characters as Postgres length() counts them (code points): an emoji is one. */
const charCount = (value: string) => Array.from(value).length;

const isReactionEmoji = (value: string) => (REACTION_EMOJIS as readonly string[]).includes(value);

// ── Housekeeping rows ──────────────────────────────────────

interface HousekeepingVisitRow extends Omit<HousekeepingVisit, 'tasks'> {
  tasks?: HousekeepingVisitTask[] | null;
}

/** A visit's tasks in their order: position, then title, then id. */
function byVisitTaskOrder(a: HousekeepingVisitTask, b: HousekeepingVisitTask): number {
  return a.position - b.position || compareText(a.title, b.title) || compareText(a.id, b.id);
}

/** Exactly the contract's shape, tasks sorted. */
function toHousekeepingVisit(row: HousekeepingVisitRow): HousekeepingVisit {
  const tasks = (row.tasks ?? [])
    .map((t) => ({
      id: t.id,
      visit_id: t.visit_id,
      household_id: t.household_id,
      task_id: t.task_id,
      title: t.title,
      position: t.position,
      done: t.done,
      done_by: t.done_by,
      done_at: t.done_at,
    }))
    .sort(byVisitTaskOrder);
  return {
    id: row.id,
    household_id: row.household_id,
    visit_date: row.visit_date,
    note: row.note,
    comments: row.comments,
    price_pence: row.price_pence,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_by: row.updated_by,
    updated_at: row.updated_at,
    tasks,
  };
}

type ChangePayload = RealtimePostgresChangesPayload<Record<string, unknown>>;

/** The row a realtime change is about: the new row, or for a DELETE the old one (its primary key). */
function changedRow(payload: ChangePayload): Record<string, unknown> {
  return (payload.eventType === 'DELETE' ? payload.old : payload.new) ?? {};
}

let channelSeq = 0;

export interface SupabaseBackendOptions {
  /** Use this client instead of creating one (tests sign in with their own clients). */
  client?: SupabaseClient;
}

/**
 * A failed or cancelled OAuth redirect comes back as ?error=…&error_description=… (or in the
 * hash). Read it and strip it from the URL before supabase-js starts.
 */
function takeAuthErrorFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const keys = ['error', 'error_code', 'error_description'];
    const message =
      url.searchParams.get('error_description') ??
      hash.get('error_description') ??
      url.searchParams.get('error') ??
      hash.get('error');
    if (!message) return null;
    for (const k of keys) {
      url.searchParams.delete(k);
      hash.delete(k);
    }
    const rest = hash.toString();
    window.history.replaceState(null, '', url.pathname + url.search + (rest ? `#${rest}` : ''));
    return message;
  } catch {
    return null;
  }
}

export class SupabaseBackend implements Backend {
  readonly kind = 'supabase' as const;
  readonly client: SupabaseClient;
  private authError: string | null;

  constructor(url: string, anonKey: string, options: SupabaseBackendOptions = {}) {
    this.authError = options.client ? null : takeAuthErrorFromUrl();
    this.client =
      options.client ??
      createClient(url, anonKey, {
        auth: {
          flowType: 'pkce',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
  }

  // ── Auth ───────────────────────────────────────────────

  takeAuthError(): string | null {
    const message = this.authError;
    this.authError = null;
    return message;
  }

  private async session(): Promise<Session | null> {
    const { data, error } = await this.client.auth.getSession();
    if (error) {
      if (isAuthRetryableFetchError(error)) throw toBackendError(error);
      // A revoked or broken session counts as signed out (supabase-js has already dropped it).
      return null;
    }
    return data.session;
  }

  private async userId(): Promise<string> {
    const id = (await this.session())?.user.id;
    if (!id) throw new BackendError('not_signed_in');
    return id;
  }

  async getUser(): Promise<AuthUser | null> {
    const session = await this.session();
    return session ? toAuthUser(session.user) : null;
  }

  onAuthChange(cb: (user: AuthUser | null) => void): Unsubscribe {
    let active = true;
    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      if (event !== 'INITIAL_SESSION' && event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;
      const user = session?.user ? toAuthUser(session.user) : null;
      // Leave supabase's auth lock before the app reacts (it calls back into the client).
      setTimeout(() => {
        if (active) cb(user);
      }, 0);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }

  async signInWithGoogle(): Promise<void> {
    const { error } = await this.client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + import.meta.env.BASE_URL,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) throw toBackendError(error);
  }

  async signOut(): Promise<void> {
    // 'local' signs out this device only; the user's other devices stay signed in.
    const { error } = await this.client.auth.signOut({ scope: 'local' });
    // supabase-js drops the local session even when revoking it on the server fails.
    if (error && (await this.session())) throw toBackendError(error);
  }

  // ── Household membership ───────────────────────────────

  async getMyHouseholdId(): Promise<string | null> {
    const userId = await this.userId();
    const rows = await run<{ household_id: string }[]>(
      this.client.from('members').select('household_id').eq('user_id', userId).limit(1),
    );
    return rows[0]?.household_id ?? null;
  }

  async load(householdId: string): Promise<HouseholdData> {
    const db = this.client;
    const [households, members, areas, items, completions, notes, housekeepingTasks, visits] = await Promise.all([
      run<Household[]>(db.from('households').select(HOUSEHOLD_COLS).eq('id', householdId).limit(1)),
      runAll<Member>((from, to) =>
        db
          .from('members')
          .select(MEMBER_COLS)
          .eq('household_id', householdId)
          .order('created_at')
          .order('id')
          .range(from, to),
      ),
      runAll<Area>((from, to) =>
        db
          .from('areas')
          .select(AREA_COLS)
          .eq('household_id', householdId)
          .order('position')
          .order('created_at')
          .order('id')
          .range(from, to),
      ),
      runAll<Item>((from, to) =>
        db
          .from('items')
          .select(ITEM_COLS)
          .eq('household_id', householdId)
          .eq('status', 'open')
          .order('created_at')
          .order('id')
          .range(from, to),
      ),
      runAll<Completion>((from, to) =>
        db
          .from('completions')
          .select(COMPLETION_COLS)
          .eq('household_id', householdId)
          .order('completed_at', { ascending: false })
          .order('id')
          .range(from, to),
      ),
      // Housekeeping: the message (no row = never written), the task list and every visit
      // with its tasks embedded.
      runAll<HousekeepingNote>((from, to) =>
        db.from('housekeeping_notes').select(HOUSEKEEPING_NOTE_COLS).eq('household_id', householdId).range(from, to),
      ),
      runAll<HousekeepingTask>((from, to) =>
        db
          .from('housekeeping_tasks')
          .select(HOUSEKEEPING_TASK_COLS)
          .eq('household_id', householdId)
          .order('position')
          .order('created_at')
          .order('id')
          .range(from, to),
      ),
      runAll<HousekeepingVisitRow>((from, to) =>
        db
          .from('housekeeping_visits')
          .select(HOUSEKEEPING_VISIT_WITH_TASKS)
          .eq('household_id', householdId)
          .order('visit_date', { ascending: false })
          .order('id')
          .range(from, to),
      ),
    ]);
    // RLS hides other households, so "not a member" also lands here.
    if (!households[0]) throw new BackendError('not_found');
    const note = notes[0];
    const housekeeping: HousekeepingData = {
      note: note
        ? { body: note.body ?? '', updated_at: note.updated_at ?? null, updated_by: note.updated_by ?? null }
        : emptyHousekeeping().note,
      tasks: housekeepingTasks.map((t) => ({ id: t.id, household_id: t.household_id, title: t.title, position: t.position })),
      visits: visits.map(toHousekeepingVisit),
    };
    return { household: toHousehold(households[0]), members, areas, items, completions, housekeeping };
  }

  subscribe(householdId: string, onChange: () => void): Unsubscribe {
    // A unique topic, so a quick unsubscribe/subscribe (React StrictMode) never reuses a
    // channel that is still being torn down.
    const channel = this.client.channel(`household:${householdId}:${++channelSeq}`);
    const tables: [table: string, filter: string][] = [
      ['households', `id=eq.${householdId}`],
      ['members', `household_id=eq.${householdId}`],
      ['areas', `household_id=eq.${householdId}`],
      ['items', `household_id=eq.${householdId}`],
      ['completions', `household_id=eq.${householdId}`],
      ['housekeeping_notes', `household_id=eq.${householdId}`],
      ['housekeeping_tasks', `household_id=eq.${householdId}`],
      ['housekeeping_visits', `household_id=eq.${householdId}`],
      ['housekeeping_visit_tasks', `household_id=eq.${householdId}`],
    ];
    let closed = false;
    const notify = () => {
      if (!closed) onChange();
    };
    for (const [table, filter] of tables) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, notify);
    }
    channel.subscribe((status) => {
      // Every join, the first included: changes made before it (since the caller's last load,
      // or while a dropped connection was down) are never replayed, so reload.
      if (status === 'SUBSCRIBED') notify();
    });
    return () => {
      if (closed) return;
      closed = true;
      void this.client.removeChannel(channel);
    };
  }

  async createHousehold(input: CreateHouseholdInput): Promise<string> {
    const items = input.items.map((i) => ({
      area: i.area,
      kind: i.kind ?? 'task',
      title: i.title,
      note: i.note ?? '',
      good: i.good ?? '',
      rag: i.rag,
      due_in_days: i.due_in_days,
      repeat: i.repeat,
      notify: i.notify,
    }));
    return run<string>(
      this.client.rpc('create_household', {
        p_name: input.name,
        p_address: input.address,
        p_timezone: input.timezone,
        p_member_name: input.memberName,
        p_member_emoji: input.memberEmoji,
        p_areas: input.areas,
        p_items: items,
      }),
    );
  }

  async joinHousehold(input: JoinHouseholdInput): Promise<string> {
    return run<string>(
      this.client.rpc('join_household', {
        p_token: input.token,
        p_member_name: input.memberName,
        p_member_emoji: input.memberEmoji,
      }),
    );
  }

  async getInvitePreview(token: string): Promise<InvitePreview | null> {
    const data = await run<Partial<InvitePreview> | null>(this.client.rpc('invite_preview', { p_token: token }));
    if (!data || typeof data.household_name !== 'string') return null;
    return { household_name: data.household_name, address: data.address ?? '' };
  }

  async createInvite(): Promise<string> {
    return run<string>(this.client.rpc('create_invite'));
  }

  // ── Edits (any member may edit anything) ──────────────

  async updateHousehold(id: string, patch: HouseholdPatch): Promise<void> {
    const values = pick(patch, HOUSEHOLD_PATCH_KEYS);
    if (values.name !== undefined) values.name = requireText(values.name, 'name');
    if (values.address !== undefined) values.address = values.address.trim();
    if (values.timezone !== undefined) values.timezone = requireText(values.timezone, 'timezone');
    await this.updateRow('households', id, values);
  }

  async updateMember(id: string, patch: MemberPatch): Promise<void> {
    const values = pick(patch, MEMBER_PATCH_KEYS);
    if (values.name !== undefined) values.name = requireText(values.name, 'name');
    if (values.emoji !== undefined) values.emoji = requireText(values.emoji, 'emoji');
    await this.updateRow('members', id, values);
  }

  async createArea(householdId: string, name: string): Promise<Area> {
    const clean = requireText(name, 'name');
    // New areas go last.
    const last = await run<{ position: number }[]>(
      this.client
        .from('areas')
        .select('position')
        .eq('household_id', householdId)
        .order('position', { ascending: false })
        .limit(1),
    );
    const position = last[0] ? last[0].position + 1 : 0;
    const rows = await run<Area[]>(
      this.client.from('areas').insert({ household_id: householdId, name: clean, position }).select(AREA_COLS),
    );
    if (!rows[0]) throw new BackendError('not_found');
    return rows[0];
  }

  async renameArea(id: string, name: string): Promise<void> {
    await this.updateRow('areas', id, { name: requireText(name, 'name') });
  }

  async deleteArea(id: string): Promise<void> {
    // Items go with it (on delete cascade); their completions stay, with item_id null.
    await runAffecting(this.client.from('areas').delete().eq('id', id).select('id'));
  }

  async reorderAreas(householdId: string, orderedIds: string[]): Promise<void> {
    await run<null>(this.client.rpc('reorder_areas', { p_household_id: householdId, p_area_ids: orderedIds }));
  }

  async createItem(householdId: string, draft: ItemDraft): Promise<Item> {
    // household_id is rewritten from the area by a trigger; sending it keeps the intent clear.
    const rows = await run<Item[]>(
      this.client
        .from('items')
        .insert({
          household_id: householdId,
          area_id: draft.area_id,
          // A state's due date, repeat and notify are cleared by the items trigger.
          kind: draft.kind ?? 'task',
          title: requireText(draft.title, 'title'),
          note: draft.note ?? '',
          good: draft.good ?? '',
          rag: draft.rag,
          due_date: draft.due_date,
          assignee_id: draft.assignee_id,
          repeat: draft.repeat,
          notify: draft.notify,
        })
        .select(ITEM_COLS),
    );
    if (!rows[0]) throw new BackendError('not_found');
    return rows[0];
  }

  async updateItem(id: string, patch: ItemPatch): Promise<void> {
    const values = pick(patch, ITEM_PATCH_KEYS);
    if (values.title !== undefined) values.title = requireText(values.title, 'title');
    await this.updateRow('items', id, values);
  }

  async deleteItem(id: string): Promise<void> {
    await runAffecting(this.client.from('items').delete().eq('id', id).select('id'));
  }

  async completeItem(id: string): Promise<string> {
    return run<string>(this.client.rpc('complete_item', { p_item_id: id }));
  }

  async undoCompletion(completionId: string): Promise<void> {
    await run<null>(this.client.rpc('undo_completion', { p_completion_id: completionId }));
  }

  // ── Push ──────────────────────────────────────────────

  async savePushSubscription(memberId: string, sub: PushSubscriptionInput): Promise<void> {
    const userId = await this.userId();
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw invalidInput('push subscription');
    await runAffecting(
      this.client
        .from('push_subs')
        .upsert(
          {
            member_id: memberId,
            user_id: userId,
            endpoint: sub.endpoint,
            p256dh: sub.keys.p256dh,
            auth: sub.keys.auth,
            user_agent: typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : null,
          },
          { onConflict: 'endpoint' },
        )
        .select('id'),
    );
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    // Idempotent: the scheduler may already have removed an expired subscription.
    await run<unknown>(this.client.from('push_subs').delete().eq('endpoint', endpoint));
  }

  // ── Helpers ───────────────────────────────────────────

  /** Updates one row by id and checks that it was really there (and visible to the caller). */
  private async updateRow(table: string, id: string, values: Record<string, unknown>): Promise<void> {
    if (Object.keys(values).length === 0) {
      // Nothing to change: still report a row the caller cannot see.
      return runAffecting(this.client.from(table).select('id').eq('id', id).limit(1));
    }
    await runAffecting(this.client.from(table).update(values).eq('id', id).select('id'));
  }

  // ── Chat (one group chat per household, kept forever) ──
  // supabase/migrations/20261010000100_chat.sql: members read and post, and delete only
  // their own messages and reactions. The database sets the sender (and a reaction's
  // household) and trims the body, so a client sends only household_id and body.

  async listMessages(householdId: string, opts: { before?: ISOTimestamp; limit?: number } = {}): Promise<ChatPage> {
    const limit = chatPageSize(opts.limit);
    const { before } = opts;
    if (before != null && Number.isNaN(Date.parse(before))) throw invalidInput('before');
    if (!UUID.test(householdId)) throw new BackendError('not_found');
    // One row more than the page tells whether older messages exist.
    const rows = await this.newestMessages(householdId, before, limit + 1);
    let hasMore = rows.length > limit;
    let page = rows.slice(0, limit);
    if (hasMore) {
      // The next page starts strictly before this page's oldest message, so a page must not
      // end inside a group of messages sharing one created_at (rows written in a single
      // transaction): the rest of the group would never be listed.
      const boundary = rows[limit].created_at;
      const whole = page.filter((m) => m.created_at !== boundary);
      if (whole.length > 0) {
        page = whole;
      } else {
        // The whole page shares that created_at: return the whole group instead.
        page = await this.messagesAt(householdId, boundary);
        hasMore = (await this.newestMessages(householdId, boundary, 1)).length > 0;
      }
    }
    // RLS shows an outsider an empty chat. Like load(), report a household the caller cannot see.
    if (page.length === 0) await runAffecting(this.client.from('households').select('id').eq('id', householdId).limit(1));
    return { messages: page.reverse().map(toChatMessage), hasMore };
  }

  async getMessages(ids: string[]): Promise<ChatMessage[]> {
    // RLS filters rather than refuses: a message in another household is simply missing,
    // like a deleted one. Anything that is not a uuid cannot be a message id.
    const wanted = [...new Set(ids)].filter((id) => UUID.test(id));
    const requests: Promise<MessageRow[] | null>[] = [];
    for (let i = 0; i < wanted.length; i += IDS_PER_REQUEST) {
      const chunk = wanted.slice(i, i + IDS_PER_REQUEST);
      requests.push(run<MessageRow[] | null>(this.client.from('messages').select(MESSAGE_WITH_REACTIONS).in('id', chunk)));
    }
    const rows = (await Promise.all(requests)).flatMap((r) => r ?? []);
    return rows.sort(byCreated).map(toChatMessage);
  }

  async sendMessage(householdId: string, body: string): Promise<ChatMessage> {
    const text = (body ?? '').trim();
    if (!text || charCount(text) > TEXT_LIMITS.chatMessage) throw invalidInput('body');
    if (!UUID.test(householdId)) throw new BackendError('not_found');
    // Not a member: RLS rejects the insert (not_found).
    const rows = await run<MessageRow[] | null>(
      this.client.from('messages').insert({ household_id: householdId, body: text }).select(MESSAGE_COLS),
    );
    if (!rows?.[0]) throw new BackendError('not_found');
    return toChatMessage({ ...rows[0], reactions: [] });
  }

  async deleteMessage(id: string): Promise<void> {
    if (!UUID.test(id)) throw new BackendError('not_found');
    // RLS deletes only the caller's own messages: someone else's touches zero rows. Its
    // reactions go with it (on delete cascade).
    await runAffecting(this.client.from('messages').delete().eq('id', id).select('id'));
  }

  async setReaction(messageId: string, emoji: string, on: boolean): Promise<void> {
    const value = emoji ?? '';
    if (!on) {
      // RLS deletes only the caller's own reactions, so another member's same emoji stays.
      // Removing one that is not there (or from a message that is gone) is fine.
      if (!UUID.test(messageId) || !value) return;
      await run<null>(this.client.from('message_reactions').delete().eq('message_id', messageId).eq('emoji', value));
      return;
    }
    // Only the app's reaction emoji (the migration's message_reactions_emoji_allowed).
    if (!value || charCount(value) > REACTION_EMOJI_MAX || !isReactionEmoji(value)) throw invalidInput('emoji');
    if (!UUID.test(messageId)) throw new BackendError('not_found');
    // Only message_id and emoji are insertable: the database adds the caller and the message's
    // household. A reaction that is already there is left alone. A missing message raises
    // not_found, and one in another household fails RLS (not_found too).
    await run<null>(
      this.client
        .from('message_reactions')
        .upsert({ message_id: messageId, emoji: value }, { onConflict: 'message_id,member_id,emoji', ignoreDuplicates: true }),
    );
  }

  subscribeChat(householdId: string, onChange: (change: ChatChange) => void): Unsubscribe {
    // A unique topic, like subscribe().
    const channel = this.client.channel(`chat:${householdId}:${++channelSeq}`);
    let closed = false;
    const emit = (change: ChatChange) => {
      if (closed) return;
      try {
        onChange(change);
      } catch (err) {
        // Keep realtime delivering the other events.
        console.error(err);
      }
    };
    // Both tables carry household_id, and with replica identity full Realtime applies the
    // filter to deletes too. An INSERT carries the whole row (Realtime checks RLS first);
    // a DELETE carries only the primary key, which names the message either way. A change
    // that names no message asks for a reload.
    const filter = `household_id=eq.${householdId}`;
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter }, (payload: ChangePayload) => {
      const id = changedRow(payload).id;
      emit(
        typeof id === 'string'
          ? { type: 'message', messageId: id, deleted: payload.eventType === 'DELETE' }
          : { type: 'resync' },
      );
    });
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'message_reactions', filter },
      (payload: ChangePayload) => {
        const id = changedRow(payload).message_id;
        emit(typeof id === 'string' ? { type: 'reaction', messageId: id } : { type: 'resync' });
      },
    );
    channel.subscribe((status) => {
      // Every join, the first included: a message posted between the caller's first page and
      // the join (a slow mobile connection, a join that had to retry), or while a dropped
      // connection was down, is never replayed. Resync picks it up.
      if (status === 'SUBSCRIBED') emit({ type: 'resync' });
    });
    return () => {
      if (closed) return;
      closed = true;
      void this.client.removeChannel(channel);
    };
  }

  /** Up to `count` of the household's newest messages created strictly before `before`. */
  private async newestMessages(householdId: string, before: string | undefined, count: number): Promise<MessageRow[]> {
    let query = this.client.from('messages').select(MESSAGE_WITH_REACTIONS).eq('household_id', householdId);
    // Passed on exactly as given: PostgREST prints microseconds, and going through a JS Date
    // would cut them to milliseconds and skip a message posted within the same millisecond.
    if (before != null) query = query.lt('created_at', before);
    const rows = await run<MessageRow[] | null>(
      query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(count),
    );
    return rows ?? [];
  }

  /** Every message of the household created at exactly `createdAt`, newest-first order. */
  private messagesAt(householdId: string, createdAt: string): Promise<MessageRow[]> {
    return runAll<MessageRow>((from, to) =>
      this.client
        .from('messages')
        .select(MESSAGE_WITH_REACTIONS)
        .eq('household_id', householdId)
        .eq('created_at', createdAt)
        .order('id', { ascending: false })
        .range(from, to),
    );
  }

  // ── Housekeeping (docs/ARCHITECTURE.md "Housekeeping") ──
  // supabase/migrations/20261010000400_housekeeping.sql. Visits and their ticks are written
  // only through the RPCs (which create a day's visit on its first write and check the day
  // against the household's time zone); the task list is written directly, and its triggers
  // keep today's visit in step. RLS hides other households: a write that touches no row is
  // not_found, like an RPC called for a household the caller is not in.

  async setHousekeepingNote(householdId: string, body: string): Promise<void> {
    requireUuid(householdId);
    await run<null>(this.client.rpc('set_housekeeping_note', { p_household_id: householdId, p_body: body ?? '' }));
  }

  async createHousekeepingTask(householdId: string, title: string): Promise<HousekeepingTask> {
    const clean = requireText(title, 'title');
    requireUuid(householdId);
    // Only household_id and title are insertable: the trigger trims and puts it last (and on
    // today's visit). Not a member: RLS rejects the insert (not_found).
    const rows = await run<HousekeepingTask[] | null>(
      this.client.from('housekeeping_tasks').insert({ household_id: householdId, title: clean }).select(HOUSEKEEPING_TASK_COLS),
    );
    const row = rows?.[0];
    if (!row) throw new BackendError('not_found');
    return { id: row.id, household_id: row.household_id, title: row.title, position: row.position };
  }

  async renameHousekeepingTask(id: string, title: string): Promise<void> {
    const clean = requireText(title, 'title');
    await this.updateRow('housekeeping_tasks', requireUuid(id), { title: clean });
  }

  async deleteHousekeepingTask(id: string): Promise<void> {
    // Today's visit drops it unless ticked; every other visit keeps its copy (task_id null).
    await runAffecting(this.client.from('housekeeping_tasks').delete().eq('id', requireUuid(id)).select('id'));
  }

  async reorderHousekeepingTasks(householdId: string, orderedIds: string[]): Promise<void> {
    requireUuid(householdId);
    // An id that is not a uuid names no task, but still takes its place in the order.
    const ids = (orderedIds ?? []).map((id) => (typeof id === 'string' && UUID.test(id) ? id : NIL_UUID));
    await run<null>(this.client.rpc('reorder_housekeeping_tasks', { p_household_id: householdId, p_task_ids: ids }));
  }

  async setHousekeepingTaskDone(
    householdId: string,
    date: ISODate,
    target: HousekeepingTickTarget,
    done: boolean,
  ): Promise<string> {
    requireDate(date);
    const t = (target ?? {}) as { taskId?: unknown; visitTaskId?: unknown };
    const byTask = typeof t.taskId === 'string';
    if (byTask === (typeof t.visitTaskId === 'string')) throw invalidInput('target');
    if (typeof done !== 'boolean') throw invalidInput('done');
    requireUuid(householdId);
    const taskId = byTask ? requireUuid(t.taskId as string) : null;
    const visitTaskId = byTask ? null : requireUuid(t.visitTaskId as string);
    return run<string>(
      this.client.rpc('tick_housekeeping_task', {
        p_household_id: householdId,
        p_visit_date: date,
        p_task_id: taskId,
        p_visit_task_id: visitTaskId,
        p_done: done,
      }),
    );
  }

  async saveHousekeepingVisit(householdId: string, date: ISODate, patch: HousekeepingVisitPatch): Promise<string> {
    requireDate(date);
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw invalidInput('patch');
    // Only the keys present. JSON would turn NaN or Infinity into null (clearing the price),
    // so a price must be a whole number or null here; the range is the database's check.
    const values: HousekeepingVisitPatch = {};
    if (patch.comments !== undefined) {
      if (typeof patch.comments !== 'string') throw invalidInput('comments');
      values.comments = patch.comments;
    }
    if (patch.price_pence !== undefined) {
      const price = patch.price_pence;
      if (price !== null && !Number.isSafeInteger(price)) throw invalidInput('price');
      values.price_pence = price;
    }
    requireUuid(householdId);
    return run<string>(
      this.client.rpc('save_housekeeping_visit', { p_household_id: householdId, p_visit_date: date, p_patch: values }),
    );
  }

  async addHousekeepingVisit(householdId: string, date: ISODate): Promise<string> {
    requireDate(date);
    requireUuid(householdId);
    return run<string>(this.client.rpc('add_housekeeping_visit', { p_household_id: householdId, p_visit_date: date }));
  }

  async deleteHousekeepingVisit(id: string): Promise<void> {
    // Its tasks go with it (on delete cascade).
    await runAffecting(this.client.from('housekeeping_visits').delete().eq('id', requireUuid(id)).select('id'));
  }
}
