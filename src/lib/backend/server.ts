// Server mode's backend: this deployment's own server (server/, published at /api/home; Vercel
// Functions over a private Blob store) instead of Supabase. Sign-in is with codes, not Google.
// The wire contract is ./serverApi.ts; docs/ARCHITECTURE.md "Server mode (no setup)" is the spec.
//
import type {
  Area,
  AuthUser,
  ChatChange,
  ChatMessage,
  ChatPage,
  CreateHouseholdInput,
  DeviceInfo,
  HomeEntry,
  HouseholdData,
  HousekeepingSection,
  HousekeepingTask,
  HousekeepingTickTarget,
  HousekeepingVisitPatch,
  ImportPayload,
  InvitePreview,
  ISODate,
  ISOTimestamp,
  IssuedCode,
  Item,
  ItemDraft,
  JoinHouseholdInput,
  Member,
  NewPersonInput,
  NotifyPrefs,
  NotifySettings,
  PushSubscriptionInput,
  ReminderInput,
} from '../types';
import { appMode } from '../appMode';
import {
  API_HEADER,
  API_HEADER_VALUE,
  API_PATH,
  codeLink,
  isSignInCode,
  normaliseCode,
  toBackendError,
  type ApiGetOp,
  type ApiPostRequest,
  type CodeResponse,
  type DevicesResponse,
  type NotifyResponse,
  type RpcMethod,
  type RpcResponse,
  type SessionResponse,
  type SignedInResponse,
  type StatusResponse,
  type VersionResponse,
} from './serverApi';
import {
  BackendError,
  type Backend,
  type HouseholdPatch,
  type ItemPatch,
  type MemberPatch,
  type ServerAccess,
  type ServerStatus,
  type Unsubscribe,
} from './types';

/** How often to poll GET ?op=version while visible, until the server says otherwise (VersionResponse.pollMs). */
export const DEFAULT_POLL_MS = 3000;
/** A request that has not answered after this long fails as BackendError('network'). */
export const REQUEST_TIMEOUT_MS = 15_000;
/**
 * localStorage key other tabs watch: written on every sign-in and sign-out in this browser
 * (`${Date.now()} ${userId | '-'}`), so each tab re-asks GET ?op=session and fires onAuthChange.
 * It holds no secret (the key lives in the HttpOnly cookie).
 */
export const AUTH_SIGNAL_KEY = 'homeos.server.auth';
/** getUser() and enterHome() right after each other share one GET ?op=session within this long. */
export const SESSION_KEEP_MS = 2000;
/** No input (a tap, a key, scrolling) for this long: poll at most every IDLE_POLL_MS. */
export const IDLE_SLOW_MS = 3 * 60_000;
/** No input for this long: no polls until input, focus, the page coming back into view, back online or reconnect(). */
export const IDLE_STOP_MS = 15 * 60_000;
/** The poll interval while idle (IDLE_SLOW_MS). */
export const IDLE_POLL_MS = 60_000;
/** A 401 this soon after this browser signed in is asked once more, a second later, before signing out. */
export const FRESH_SIGN_IN_MS = 30_000;
/**
 * localStorage flag: Sign Out could not reach the server (offline), so the key (an HttpOnly
 * cookie only the server can clear) and its device are still there. Until a POST signOut
 * succeeds this browser counts as signed out, and it tries again at start-up and when back online.
 */
export const PENDING_SIGN_OUT_KEY = 'homeos.server.signout';
/** Input that counts as someone using the app (see IDLE_SLOW_MS). */
const INPUT_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;

export interface ServerBackendOptions {
  /** The API endpoint. Default API_PATH ('/api/home'). */
  endpoint?: string;
  /** Default globalThis.fetch (tests pass a fake that calls server/core/handler.ts directly). */
  fetch?: typeof fetch;
  /** Clock for polling and timeouts. Default Date.now. */
  now?: () => number;
  /** The poll interval before the server's first answer. Default DEFAULT_POLL_MS. */
  pollMs?: number;
  /**
   * The app's address, for IssuedCode.link. Default `${location.origin}/` (server mode is
   * always served from the root). This file and what it imports never read import.meta.env, so
   * server/client.test.ts can drive ServerBackend against the real handler under
   * tsconfig.node.json.
   */
  appUrl?: string;
  /** Waits before a retry (a 401 just after signing in, 'busy'). Default setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const notSupported = () => new BackendError('unknown', 'not supported in server mode');

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Whether the page is in view (always, where there is no document: tests, workers). */
const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/** The browser's storage, or null (no window, private mode, locked down). */
function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

interface ChatListener {
  householdId: string;
  onChange: (change: ChatChange) => void;
  /** Gets a resync on the next successful poll (just subscribed, or a poll failed since). */
  due: boolean;
}

interface ChangeListener {
  onChange: () => void;
  due: boolean;
}

interface KeptSession {
  user: AuthUser;
  entry: HomeEntry;
  device: DeviceInfo;
  at: number;
}

/**
 * Backend over /api/home. What it keeps in memory: the newest rev seen (sent as `minRev` with
 * every read, so a browser never reads older than it has seen), the session from GET ?op=session
 * for 2 s (getUser and enterHome right after each other share it), the one-off entry from
 * bringOnline/redeemCode (the next enterHome() returns it once, so a claim gets its welcome
 * step), and the listeners. One poller serves subscribe, subscribeChat and onStatus: it polls
 * GET ?op=version every `pollMs` while the page is visible (document.visibilityState), at once
 * on 'visibilitychange' to visible, 'focus', 'online' and reconnect(), never while hidden, and
 * stops when nothing listens.
 *
 * Requests: every one sends `X-HomeOS: 1` and `credentials: 'same-origin'`; POSTs send JSON.
 * A fetch that throws or times out is BackendError('network'); an error response is
 * toBackendError(status, body). Any 401 means this browser is signed out: the session is
 * forgotten and onAuthChange(null) fires (once) before the call rejects with 'not_signed_in'.
 */
export class ServerBackend implements Backend, ServerAccess {
  readonly kind = 'server' as const;
  /** Where requests go (ServerBackendOptions.endpoint, default API_PATH). */
  readonly endpoint: string;

  private readonly doFetch: typeof fetch;
  private readonly clock: () => number;
  /** The newest rev this browser has seen, from any answer (0: none yet). */
  private newestRev = 0;
  private session: KeptSession | null = null;
  private sessionLoad: Promise<KeptSession | null> | null = null;
  /** The entry setup or redeem gave, for the next enterHome() (once). */
  private pendingEntry: HomeEntry | null = null;
  /** Continue with Google is on (GET ?op=status). */
  private google = false;
  /** This browser's device, as the last session, setup or redeem said. */
  private deviceId: string | null = null;
  /** Who onAuthChange last reported (undefined: nothing yet). */
  private reported: string | null | undefined = undefined;
  /** When setup or redeem last signed this browser in (null: not since it started). */
  private signedInAt: number | null = null;
  /** A POST signOut that finishes a pending sign-out (PENDING_SIGN_OUT_KEY), while one runs. */
  private finishing: Promise<boolean> | null = null;
  private authListeners = new Set<(user: AuthUser | null) => void>();
  private unwatchSignal: (() => void) | null = null;

  // ── The poller ──
  private changeListeners = new Set<ChangeListener>();
  private chatListeners = new Set<ChatListener>();
  private statusListeners = new Set<(status: ServerStatus) => void>();
  private status: ServerStatus = { readOnly: false };
  private pollMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private polling = false;
  private pollAgain = false;
  private pollFailed = false;
  /** When someone last used the page (input, focus, back in view, back online). */
  private lastInput: number;
  /** Idle for IDLE_STOP_MS: no poll is scheduled until input. */
  private parked = false;
  /** The poll scheduled now is an idle one (IDLE_POLL_MS). */
  private slow = false;
  /** The highest rev and chatRev polls have shown (null: no poll yet). */
  private polledRev: number | null = null;
  private polledChatRev: number | null = null;
  private unwatchPage: (() => void) | null = null;

  constructor(readonly options: ServerBackendOptions = {}) {
    this.endpoint = options.endpoint ?? API_PATH;
    this.doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.clock = options.now ?? Date.now;
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.lastInput = this.clock();
  }

  private sleep(ms: number): Promise<void> {
    return (this.options.sleep ?? defaultSleep)(ms);
  }

  // ── Requests ───────────────────────────────────────────

  private see(rev: unknown) {
    if (typeof rev === 'number' && Number.isFinite(rev) && rev > this.newestRev) this.newestRev = rev;
  }

  /**
   * One request to the API: its JSON, or BackendError (see the class comment). Asked once
   * more before failing: a 401 within FRESH_SIGN_IN_MS of signing in here (another instance
   * of the server may not have seen the new device yet), and an RPC the server found 'busy'
   * (nothing was stored), after a short random wait.
   */
  private async call<T>(request: { get: ApiGetOp } | { post: ApiPostRequest }, again = false): Promise<T> {
    const isGet = 'get' in request;
    const url = isGet ? `${this.endpoint}?op=${encodeURIComponent(request.get)}` : this.endpoint;
    const headers: Record<string, string> = { [API_HEADER]: API_HEADER_VALUE };
    if (!isGet) headers['Content-Type'] = 'application/json';
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller?.abort();
    }, REQUEST_TIMEOUT_MS);
    let status: number;
    let body: unknown = null;
    try {
      const res = await this.doFetch(url, {
        method: isGet ? 'GET' : 'POST',
        headers,
        body: isGet ? undefined : JSON.stringify(request.post),
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller?.signal,
      });
      status = res.status;
      const text = await res.text();
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
    } catch (err) {
      throw new BackendError('network', timedOut ? 'timeout' : err instanceof Error ? err.message : 'network');
    } finally {
      clearTimeout(timer);
    }
    if (status < 200 || status >= 300) {
      const error = toBackendError(status, body);
      const op = isGet ? request.get : request.post.op;
      if (!again && error.code === 'not_signed_in' && op !== 'signOut' && this.signedInAt !== null && this.clock() - this.signedInAt < FRESH_SIGN_IN_MS) {
        await this.sleep(1000);
        return this.call<T>(request, true);
      }
      if (!again && op === 'rpc' && error.code === 'unknown' && error.message.startsWith('busy')) {
        await this.sleep(300 + Math.floor(Math.random() * 500));
        return this.call<T>(request, true);
      }
      if (error.code === 'not_signed_in') this.signedOutHere(false);
      throw error;
    }
    this.see((body as { rev?: unknown } | null)?.rev);
    return body as T;
  }

  /** One RPC: its result (null for a method that resolves to nothing). */
  private async rpc<M extends RpcMethod>(method: M, args: unknown[]): Promise<RpcResponse<M>['result']> {
    const sent = [...args];
    // JSON has no undefined: optional arguments left out are left off the end.
    while (sent.length && sent[sent.length - 1] === undefined) sent.pop();
    const response = await this.call<RpcResponse<M>>({
      post: {
        op: 'rpc',
        method,
        args: sent as never,
        ...(this.newestRev > 0 ? { minRev: this.newestRev } : {}),
      },
    });
    return response.result;
  }

  // ── Signed in and out ──────────────────────────────────

  private emitAuth(user: AuthUser | null) {
    this.reported = user?.id ?? null;
    for (const cb of [...this.authListeners]) {
      try {
        cb(user);
      } catch (err) {
        console.error(err);
      }
    }
  }

  /** Tells this browser's other tabs to ask who is signed in (no secret in it). */
  private signal(userId: string | null) {
    try {
      storage()?.setItem(AUTH_SIGNAL_KEY, `${this.clock()} ${userId ?? '-'}`);
    } catch {
      /* storage unavailable: other tabs find out on their next request */
    }
  }

  /** Forgets who is signed in. `told`: this tab signed out (tell the other tabs); a 401 tells them by itself. */
  private signedOutHere(told: boolean) {
    this.session = null;
    this.sessionLoad = null;
    this.pendingEntry = null;
    this.deviceId = null;
    this.signedInAt = null;
    if (told) this.signal(null);
    // Said once: only when someone was signed in here.
    if (typeof this.reported === 'string') this.emitAuth(null);
    else this.reported = null;
  }

  /** Setup or redeem signed this browser in (the cookie is set): keep the session and say so. */
  private signedInHere(response: SignedInResponse): HomeEntry {
    const entry = response.entry;
    this.see(response.rev);
    this.deviceId = response.device.id;
    this.signedInAt = this.clock();
    // A sign-out still waiting to reach the server was for the key this sign-in replaced.
    this.setPendingSignOut(false);
    this.session = {
      user: response.user,
      // Later sessions are plain members; the claim's welcome comes once, from pendingEntry.
      entry: entry.status === 'claimed' ? { ...entry, status: 'member' } : entry,
      device: response.device,
      at: this.clock(),
    };
    this.sessionLoad = null;
    this.pendingEntry = entry;
    this.signal(response.user.id);
    this.emitAuth(response.user);
    return entry;
  }

  /** Whether a sign-out is still waiting to reach the server (PENDING_SIGN_OUT_KEY). */
  private pendingSignOut(): boolean {
    try {
      return storage()?.getItem(PENDING_SIGN_OUT_KEY) === '1';
    } catch {
      return false;
    }
  }

  private setPendingSignOut(on: boolean) {
    try {
      if (on) storage()?.setItem(PENDING_SIGN_OUT_KEY, '1');
      else storage()?.removeItem(PENDING_SIGN_OUT_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  /** Sends the sign-out that could not reach the server before. True when it went through (or none was waiting). */
  private finishSignOut(): Promise<boolean> {
    if (!this.pendingSignOut()) return Promise.resolve(true);
    if (this.finishing) return this.finishing;
    const run = (async () => {
      try {
        await this.call({ post: { op: 'signOut' } });
        this.setPendingSignOut(false);
        return true;
      } catch {
        return false;
      } finally {
        this.finishing = null;
      }
    })();
    this.finishing = run;
    return run;
  }

  /**
   * GET ?op=session (kept SESSION_KEEP_MS; `fresh` asks again): null when signed out. While a
   * sign-out is waiting to reach the server, it goes first and this browser is signed out.
   */
  private loadSession(fresh = false): Promise<KeptSession | null> {
    const kept = this.session;
    if (!fresh && kept && this.clock() - kept.at < SESSION_KEEP_MS) return Promise.resolve(kept);
    if (!fresh && this.sessionLoad) return this.sessionLoad;
    let load!: Promise<KeptSession | null>;
    load = (async (): Promise<KeptSession | null> => {
      try {
        if (this.pendingSignOut()) {
          await this.finishSignOut();
          return null;
        }
        const s = await this.call<SessionResponse>({ get: 'session' });
        const next: KeptSession = { user: s.user, entry: s.entry, device: s.device, at: this.clock() };
        if (this.sessionLoad === load) this.session = next;
        this.deviceId = s.device.id;
        return next;
      } catch (err) {
        if (err instanceof BackendError && err.code === 'not_signed_in') return null;
        throw err;
      } finally {
        if (this.sessionLoad === load) this.sessionLoad = null;
      }
    })();
    this.sessionLoad = load;
    return load;
  }

  /** Another tab signed in or out: ask again, and say so when it changed. */
  private async recheckAuth() {
    let s: KeptSession | null;
    try {
      s = await this.loadSession(true);
    } catch {
      return;
    }
    const id = s?.user.id ?? null;
    if (id === this.reported) return;
    if (id === null) this.signedOutHere(false);
    else this.emitAuth(s!.user);
  }

  // ── Auth (Backend) ─────────────────────────────────────

  /** GET ?op=session: the user, or null on 401. A network failure rejects ('network'). */
  async getUser(): Promise<AuthUser | null> {
    const s = await this.loadSession();
    if (this.reported === undefined) this.reported = s?.user.id ?? null;
    return s?.user ?? null;
  }

  /**
   * Local listeners; fired by bringOnline, redeemCode, signOut, releaseClaim, any 401, and
   * AUTH_SIGNAL_KEY from other tabs. While someone listens, back online also sends a sign-out
   * that is still waiting (PENDING_SIGN_OUT_KEY).
   */
  onAuthChange(cb: (user: AuthUser | null) => void): Unsubscribe {
    this.authListeners.add(cb);
    if (!this.unwatchSignal && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const onStorage = (e: StorageEvent) => {
        if (e.key === AUTH_SIGNAL_KEY || e.key === null) void this.recheckAuth();
      };
      const onOnline = () => void this.finishSignOut();
      window.addEventListener('storage', onStorage);
      window.addEventListener('online', onOnline);
      this.unwatchSignal = () => {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener('online', onOnline);
      };
    }
    return () => {
      this.authListeners.delete(cb);
      if (!this.authListeners.size && this.unwatchSignal) {
        this.unwatchSignal();
        this.unwatchSignal = null;
      }
    };
  }

  /** Rejects with BackendError('unknown', 'not supported in server mode'): there is no Google sign-in. */
  signInWithGoogle(): Promise<void> {
    return Promise.reject(notSupported());
  }

  /**
   * POST {op:'signOut'}, then forgets the session and fires onAuthChange(null). Never rejects.
   * When the server can't be reached (offline), the key is still in its cookie: the sign-out
   * is kept waiting (PENDING_SIGN_OUT_KEY) and sent at start-up and when back online, and
   * until then this browser counts as signed out.
   */
  async signOut(): Promise<void> {
    try {
      await this.call({ post: { op: 'signOut' } });
      this.setPendingSignOut(false);
    } catch (err) {
      if (err instanceof BackendError && err.code === 'network') this.setPendingSignOut(true);
    }
    this.signedOutHere(true);
  }

  /** Always null. */
  takeAuthError(): string | null {
    return null;
  }

  // ── Household membership (Backend) ─────────────────────

  /** The entry kept from bringOnline/redeemCode (once), else GET ?op=session's entry ('member'). 401: 'not_signed_in'. */
  async enterHome(): Promise<HomeEntry> {
    const pending = this.pendingEntry;
    if (pending) {
      this.pendingEntry = null;
      return pending;
    }
    const s = await this.loadSession();
    if (!s) throw new BackendError('not_signed_in');
    return s.entry;
  }
  async getMyHouseholdId(): Promise<string | null> {
    return (await this.rpc('getMyHouseholdId', [])) as string | null;
  }
  async load(householdId: string): Promise<HouseholdData> {
    return (await this.rpc('load', [householdId])) as HouseholdData;
  }
  /** The poller: onChange on the first successful poll, when rev goes up, and on the first success after a failed poll. */
  subscribe(_householdId: string, onChange: () => void): Unsubscribe {
    const listener: ChangeListener = { onChange, due: true };
    this.changeListeners.add(listener);
    this.startPolling();
    return () => {
      this.changeListeners.delete(listener);
      this.stopPollingIfIdle();
    };
  }
  /** Polls at once (and counts as someone using the app: see IDLE_SLOW_MS). Never throws. */
  reconnect(): void {
    try {
      this.used();
      if (this.hasListeners()) void this.poll();
    } catch {
      /* never throws */
    }
  }
  /** Rejects with BackendError('home_exists'): a home comes online only through setup. */
  createHousehold(_input: CreateHouseholdInput): Promise<string> {
    return Promise.reject(new BackendError('home_exists'));
  }
  /** Rejects with BackendError('invalid_invite'): codes replace invite links. */
  joinHousehold(_input: JoinHouseholdInput): Promise<string> {
    return Promise.reject(new BackendError('invalid_invite'));
  }
  /** "Not Shea?": POST {op:'release'}, then (like signOut) forgets the session and fires onAuthChange(null). */
  async releaseClaim(): Promise<void> {
    await this.call({ post: { op: 'release' } });
    this.signedOutHere(true);
  }
  /** Rejects with BackendError('unknown', 'not supported in server mode'): setup brings the home online. */
  importHousehold(_payload: ImportPayload): Promise<string> {
    return Promise.reject(notSupported());
  }
  /** Resolves null: codes replace invite links. */
  getInvitePreview(_token: string): Promise<InvitePreview | null> {
    return Promise.resolve(null);
  }
  /** Rejects with BackendError('invalid_invite'): createCode() replaces it. */
  createInvite(): Promise<string> {
    return Promise.reject(new BackendError('invalid_invite'));
  }

  // ── Edits (Backend, each one RPC) ──────────────────────

  async updateHousehold(id: string, patch: HouseholdPatch): Promise<void> {
    await this.rpc('updateHousehold', [id, patch]);
  }
  /** Only `name` and `emoji` (the server refuses weekly_email and push_enabled in server mode). */
  async updateMember(id: string, patch: MemberPatch): Promise<void> {
    await this.rpc('updateMember', [id, patch]);
  }
  /** `input.email` must be '' (no Google emails in server mode). */
  async addPerson(householdId: string, input: NewPersonInput): Promise<Member> {
    return (await this.rpc('addPerson', [householdId, input])) as Member;
  }
  /** Rejects with BackendError('unknown', 'invalid_input: email'): no Google emails in server mode. */
  setPersonEmail(_memberId: string, _email: string): Promise<void> {
    return Promise.reject(new BackendError('unknown', 'invalid_input: email'));
  }
  async removePerson(memberId: string): Promise<void> {
    await this.rpc('removePerson', [memberId]);
  }
  async createArea(householdId: string, name: string): Promise<Area> {
    return (await this.rpc('createArea', [householdId, name])) as Area;
  }
  async renameArea(id: string, name: string): Promise<void> {
    await this.rpc('renameArea', [id, name]);
  }
  async deleteArea(id: string): Promise<void> {
    await this.rpc('deleteArea', [id]);
  }
  async reorderAreas(householdId: string, orderedIds: string[]): Promise<void> {
    await this.rpc('reorderAreas', [householdId, orderedIds]);
  }
  async createItem(householdId: string, draft: ItemDraft): Promise<Item> {
    return (await this.rpc('createItem', [householdId, draft])) as Item;
  }
  async updateItem(id: string, patch: ItemPatch): Promise<void> {
    await this.rpc('updateItem', [id, patch]);
  }
  async deleteItem(id: string): Promise<void> {
    await this.rpc('deleteItem', [id]);
  }
  async completeItem(id: string): Promise<string> {
    return (await this.rpc('completeItem', [id])) as string;
  }
  async undoCompletion(completionId: string): Promise<void> {
    await this.rpc('undoCompletion', [completionId]);
  }

  // ── Push (Backend): this device's subscription ─────────

  /** POST {op:'pushSubscribe'}: kept with this browser's device (the member is whoever is signed in). */
  async savePushSubscription(_memberId: string, sub: PushSubscriptionInput): Promise<void> {
    await this.call({ post: { op: 'pushSubscribe', subscription: { endpoint: sub.endpoint, keys: sub.keys } } });
  }
  /** POST {op:'pushUnsubscribe'}: this browser's device has no subscription any more. */
  async deletePushSubscription(_endpoint: string): Promise<void> {
    await this.call({ post: { op: 'pushUnsubscribe' } });
  }

  // ── Chat (Backend, RPC) ────────────────────────────────

  async listMessages(householdId: string, opts?: { before?: ISOTimestamp; limit?: number }): Promise<ChatPage> {
    return (await this.rpc('listMessages', [householdId, opts])) as ChatPage;
  }
  async getMessages(ids: string[]): Promise<ChatMessage[]> {
    return (await this.rpc('getMessages', [ids])) as ChatMessage[];
  }

  /** Tells this backend's chat listeners about its own chat write (as the demo backend does). */
  private emitChat(change: ChatChange, householdId?: string) {
    for (const l of [...this.chatListeners]) {
      if (householdId !== undefined && l.householdId !== householdId) continue;
      try {
        l.onChange(change);
      } catch (err) {
        // The write is stored; a failing listener must not make it look failed.
        console.error(err);
      }
    }
  }

  /** RPC; then emits { type: 'message', messageId, deleted: false } to this backend's chat listeners before resolving. */
  async sendMessage(householdId: string, body: string): Promise<ChatMessage> {
    const message = (await this.rpc('sendMessage', [householdId, body])) as ChatMessage;
    this.emitChat({ type: 'message', messageId: message.id, deleted: false }, householdId);
    return message;
  }
  /** RPC; then emits { type: 'message', messageId: id, deleted: true }. */
  async deleteMessage(id: string): Promise<void> {
    await this.rpc('deleteMessage', [id]);
    this.emitChat({ type: 'message', messageId: id, deleted: true });
  }
  /** RPC; then emits { type: 'reaction', messageId }. */
  async setReaction(messageId: string, emoji: string, on: boolean): Promise<void> {
    await this.rpc('setReaction', [messageId, emoji, on]);
    this.emitChat({ type: 'reaction', messageId });
  }
  /** The poller: { type: 'resync' } on the first successful poll, when chatRev goes up, and after a failed poll. */
  subscribeChat(householdId: string, onChange: (change: ChatChange) => void): Unsubscribe {
    const listener: ChatListener = { householdId, onChange, due: true };
    this.chatListeners.add(listener);
    this.startPolling();
    return () => {
      this.chatListeners.delete(listener);
      this.stopPollingIfIdle();
    };
  }

  // ── Housekeeping (Backend, RPC) ────────────────────────

  async setHousekeepingNote(householdId: string, body: string): Promise<void> {
    await this.rpc('setHousekeepingNote', [householdId, body]);
  }
  async undoClearHousekeepingNote(householdId: string): Promise<void> {
    await this.rpc('undoClearHousekeepingNote', [householdId]);
  }
  async createHousekeepingTask(householdId: string, title: string, sectionId?: string | null): Promise<HousekeepingTask> {
    // No section: left out, so the call reads as it did before sections.
    const args: [string, string, (string | null)?] = sectionId ? [householdId, title, sectionId] : [householdId, title];
    return (await this.rpc('createHousekeepingTask', args)) as HousekeepingTask;
  }
  async renameHousekeepingTask(id: string, title: string): Promise<void> {
    await this.rpc('renameHousekeepingTask', [id, title]);
  }
  async deleteHousekeepingTask(id: string): Promise<void> {
    await this.rpc('deleteHousekeepingTask', [id]);
  }
  async moveHousekeepingTask(id: string, sectionId: string | null, index: number): Promise<void> {
    await this.rpc('moveHousekeepingTask', [id, sectionId, index]);
  }
  async reorderHousekeepingTasks(householdId: string, orderedIds: string[]): Promise<void> {
    await this.rpc('reorderHousekeepingTasks', [householdId, orderedIds]);
  }
  async createHousekeepingSection(householdId: string, title: string): Promise<HousekeepingSection> {
    return (await this.rpc('createHousekeepingSection', [householdId, title])) as HousekeepingSection;
  }
  async renameHousekeepingSection(id: string, title: string): Promise<void> {
    await this.rpc('renameHousekeepingSection', [id, title]);
  }
  async deleteHousekeepingSection(id: string): Promise<void> {
    await this.rpc('deleteHousekeepingSection', [id]);
  }
  async moveHousekeepingSection(id: string, index: number): Promise<void> {
    await this.rpc('moveHousekeepingSection', [id, index]);
  }
  async setHousekeepingTaskDone(
    householdId: string,
    date: ISODate,
    target: HousekeepingTickTarget,
    done: boolean,
  ): Promise<string> {
    return (await this.rpc('setHousekeepingTaskDone', [householdId, date, target, done])) as string;
  }
  async saveHousekeepingVisit(householdId: string, date: ISODate, patch: HousekeepingVisitPatch): Promise<string> {
    return (await this.rpc('saveHousekeepingVisit', [householdId, date, patch])) as string;
  }
  async addHousekeepingVisit(householdId: string, date: ISODate): Promise<string> {
    return (await this.rpc('addHousekeepingVisit', [householdId, date])) as string;
  }
  async deleteHousekeepingVisit(id: string): Promise<void> {
    await this.rpc('deleteHousekeepingVisit', [id]);
  }

  // ── ServerAccess ───────────────────────────────────────

  /** GET ?op=status. */
  async homeOnline(): Promise<boolean> {
    const status = await this.call<StatusResponse>({ get: 'status' });
    this.google = status.google === true;
    return status.home === true;
  }
  /** Create Account: POST {op:'signUp', name, email, password, app}, then as bringOnline. */
  async createAccount(name: string, email: string, password: string): Promise<HomeEntry> {
    const response = await this.call<SignedInResponse>({ post: { op: 'signUp', name, email, password, app: appMode() } });
    return this.signedInHere(response);
  }
  /** Sign In: POST {op:'signIn', email, password, app}, then as bringOnline. Wrong email or password: 'invalid_code'. */
  async signInWithPassword(email: string, password: string): Promise<HomeEntry> {
    const response = await this.call<SignedInResponse>({ post: { op: 'signIn', email, password, app: appMode() } });
    return this.signedInHere(response);
  }
  /** Continue with Google is on (as the last GET ?op=status said). */
  googleOn(): boolean {
    return this.google;
  }
  /** Continue with Google: off to Google (a navigation; the server signs this browser in on the way back). */
  continueWithGoogle(): void {
    window.location.assign(`${API_PATH}?op=googleStart`);
  }
  /**
   * POST {op:'setup', code, phone, app}; keeps the entry for the next enterHome(), writes
   * AUTH_SIGNAL_KEY, fires onAuthChange(user). 'home_exists' may mean an earlier tap got
   * through and only its reply was lost after the cookie arrived: when GET ?op=session says
   * this browser is signed in, that is a success too.
   */
  async bringOnline(setupCode: string, phoneDoc: string): Promise<HomeEntry> {
    try {
      const response = await this.call<SignedInResponse>({ post: { op: 'setup', code: setupCode, phone: phoneDoc, app: appMode() } });
      return this.signedInHere(response);
    } catch (err) {
      if (!(err instanceof BackendError && err.code === 'home_exists')) throw err;
      const s = await this.loadSession(true).catch(() => null);
      if (!s) throw err;
      return this.signedInHere({ user: s.user, entry: s.entry, device: s.device, rev: 0 });
    }
  }
  /** Not isSignInCode(normaliseCode(code)): rejects 'invalid_code' without a request. Else POST {op:'redeem', code, app}, then as bringOnline. */
  async redeemCode(code: string): Promise<HomeEntry> {
    const normalised = normaliseCode(code);
    if (!isSignInCode(normalised)) throw new BackendError('invalid_code');
    const response = await this.call<SignedInResponse>({ post: { op: 'redeem', code: normalised, app: appMode() } });
    return this.signedInHere(response);
  }
  /** POST {op:'createCode'}; adds the link (codeLink(appUrl, code)). */
  async createCode(memberId: string): Promise<IssuedCode> {
    const issued = await this.call<CodeResponse>({ post: { op: 'createCode', memberId } });
    const appUrl = this.options.appUrl ?? (typeof location !== 'undefined' ? `${location.origin}/` : 'http://localhost/');
    return { code: issued.code, link: codeLink(appUrl, issued.code), memberId: issued.memberId, expiresAt: issued.expiresAt };
  }
  /** GET ?op=devices. */
  async listDevices(): Promise<DeviceInfo[]> {
    const { devices } = await this.call<DevicesResponse>({ get: 'devices' });
    const mine = devices.find((d) => d.current);
    if (mine) this.deviceId = mine.id;
    return devices;
  }
  /** POST {op:'removeDevice'}; this browser's own device: then as signOut (without asking the server again). */
  async removeDevice(deviceId: string): Promise<void> {
    const mine = deviceId === this.deviceId;
    await this.call({ post: { op: 'removeDevice', deviceId } });
    if (mine) this.signedOutHere(true);
  }
  /** GET ?op=notify. */
  notifySettings(): Promise<NotifySettings> {
    return this.call<NotifyResponse>({ get: 'notify' });
  }
  /** POST {op:'setNotify'}. */
  setNotifyPrefs(prefs: Partial<NotifyPrefs>): Promise<NotifySettings> {
    return this.call<NotifyResponse>({ post: { op: 'setNotify', prefs } });
  }
  /** POST {op:'saveReminder'}. */
  saveReminder(reminder: ReminderInput): Promise<NotifySettings> {
    return this.call<NotifyResponse>({ post: { op: 'saveReminder', reminder } });
  }
  /** POST {op:'deleteReminder'}. */
  deleteReminder(id: string): Promise<NotifySettings> {
    return this.call<NotifyResponse>({ post: { op: 'deleteReminder', id } });
  }
  /** The poller's VersionResponse.readOnly, as a ServerStatus (once at once with the last known one). */
  onStatus(cb: (status: ServerStatus) => void): Unsubscribe {
    this.statusListeners.add(cb);
    try {
      cb({ ...this.status });
    } catch (err) {
      console.error(err);
    }
    this.startPolling();
    return () => {
      this.statusListeners.delete(cb);
      this.stopPollingIfIdle();
    };
  }

  // ── Polling ────────────────────────────────────────────

  private hasListeners(): boolean {
    return this.changeListeners.size + this.chatListeners.size + this.statusListeners.size > 0;
  }

  /** Someone is using the app now (input, focus, back in view or online): polling goes back to its pace. */
  private used(): boolean {
    const idle = this.parked || this.slow;
    this.lastInput = this.clock();
    this.parked = false;
    this.slow = false;
    return idle;
  }

  /**
   * The first listener starts the poller (a poll at once, and the page's events). Input on the
   * page (INPUT_EVENTS) after a quiet spell polls at once and goes back to `pollMs`.
   */
  private startPolling() {
    if (!this.unwatchPage) {
      const now = () => {
        this.used();
        void this.poll();
      };
      const onVisibility = () => {
        if (isVisible()) now();
        else this.clearTimer();
      };
      const onInput = () => {
        if (this.used()) void this.poll();
      };
      const doc = typeof document !== 'undefined' ? document : null;
      const win = typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null;
      const listen = { capture: true, passive: true } as const;
      doc?.addEventListener('visibilitychange', onVisibility);
      win?.addEventListener('focus', now);
      win?.addEventListener('online', now);
      for (const name of INPUT_EVENTS) win?.addEventListener(name, onInput, listen);
      this.unwatchPage = () => {
        doc?.removeEventListener('visibilitychange', onVisibility);
        win?.removeEventListener('focus', now);
        win?.removeEventListener('online', now);
        for (const name of INPUT_EVENTS) win?.removeEventListener(name, onInput, listen);
      };
      this.used();
      void this.poll();
    } else if (!this.polling && this.timer === undefined) {
      void this.poll();
    }
  }

  private stopPollingIfIdle() {
    if (this.hasListeners()) return;
    this.clearTimer();
    this.unwatchPage?.();
    this.unwatchPage = null;
    this.pollAgain = false;
    this.parked = false;
    this.slow = false;
    // A later subscription starts again as from a fresh connection.
    this.polledRev = null;
    this.polledChatRev = null;
    this.pollFailed = false;
  }

  private clearTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * The next poll in `pollMs`, while visible and someone listens; with no input for
   * IDLE_SLOW_MS in IDLE_POLL_MS (or `pollMs` when longer), and none at all after IDLE_STOP_MS
   * until input, focus, the page coming back into view, back online or reconnect().
   */
  private schedule() {
    this.clearTimer();
    if (!this.hasListeners() || !isVisible()) return;
    const idle = this.clock() - this.lastInput;
    if (idle >= IDLE_STOP_MS) {
      this.parked = true;
      return;
    }
    this.slow = idle >= IDLE_SLOW_MS;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.poll();
      },
      this.slow ? Math.max(this.pollMs, IDLE_POLL_MS) : this.pollMs,
    );
  }

  private async poll(): Promise<void> {
    if (!this.hasListeners() || !isVisible()) {
      this.clearTimer();
      return;
    }
    if (this.polling) {
      this.pollAgain = true;
      return;
    }
    this.polling = true;
    this.clearTimer();
    try {
      const v = await this.call<VersionResponse>({ get: 'version' });
      this.polled(v);
    } catch {
      // Offline, or the server could not answer: the next success counts as a fresh join.
      this.pollFailed = true;
    } finally {
      this.polling = false;
      if (this.pollAgain) {
        this.pollAgain = false;
        void this.poll();
      } else {
        this.schedule();
      }
    }
  }

  private polled(v: VersionResponse) {
    if (typeof v.pollMs === 'number' && v.pollMs >= 1000) this.pollMs = v.pollMs;
    const recovered = this.pollFailed;
    this.pollFailed = false;
    const revUp = this.polledRev !== null && v.rev > this.polledRev;
    const chatUp = this.polledChatRev !== null && v.chatRev > this.polledChatRev;
    this.polledRev = Math.max(this.polledRev ?? v.rev, v.rev);
    this.polledChatRev = Math.max(this.polledChatRev ?? v.chatRev, v.chatRev);
    for (const l of [...this.changeListeners]) {
      if (!(recovered || revUp || l.due)) continue;
      l.due = false;
      try {
        l.onChange();
      } catch (err) {
        console.error(err);
      }
    }
    for (const l of [...this.chatListeners]) {
      if (!(recovered || chatUp || l.due)) continue;
      l.due = false;
      try {
        l.onChange({ type: 'resync' });
      } catch (err) {
        console.error(err);
      }
    }
    const readOnly = v.readOnly === true;
    if (readOnly !== this.status.readOnly) {
      this.status = { readOnly };
      for (const cb of [...this.statusListeners]) {
        try {
          cb({ ...this.status });
        } catch (err) {
          console.error(err);
        }
      }
    }
  }
}
