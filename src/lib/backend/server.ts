// Server mode's backend: this deployment's own server (server/, published at /api/home; Vercel
// Functions over a private Blob store) instead of Supabase. Sign-in is with codes, not Google.
// The wire contract is ./serverApi.ts; docs/ARCHITECTURE.md "Server mode (no setup)" is the spec.
//
// SKELETON: every method throws until the server-mode builders fill it in. The doc comments
// say what each one does; Backend and ServerAccess (./types.ts) hold the full contracts.

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
  PushSubscriptionInput,
} from '../types';
import { API_PATH } from './serverApi';
import type {
  Backend,
  HouseholdPatch,
  ItemPatch,
  MemberPatch,
  ServerAccess,
  ServerStatus,
  Unsubscribe,
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
}

function notImplemented(what: string): never {
  throw new Error(`ServerBackend.${what}: not implemented yet (docs/ARCHITECTURE.md "Server mode (no setup)")`);
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

  constructor(readonly options: ServerBackendOptions = {}) {
    this.endpoint = options.endpoint ?? API_PATH;
  }

  // ── Auth (Backend) ─────────────────────────────────────

  /** GET ?op=session: the user, or null on 401. A network failure rejects ('network'). */
  getUser(): Promise<AuthUser | null> {
    notImplemented('getUser');
  }
  /** Local listeners; fired by bringOnline, redeemCode, signOut, releaseClaim, any 401, and AUTH_SIGNAL_KEY from other tabs. */
  onAuthChange(_cb: (user: AuthUser | null) => void): Unsubscribe {
    notImplemented('onAuthChange');
  }
  /** Rejects with BackendError('unknown', 'not supported in server mode'): there is no Google sign-in. */
  signInWithGoogle(): Promise<void> {
    notImplemented('signInWithGoogle');
  }
  /** POST {op:'signOut'} (a 401 or a network failure is fine), then forgets the session and fires onAuthChange(null). Never rejects. */
  signOut(): Promise<void> {
    notImplemented('signOut');
  }
  /** Always null. */
  takeAuthError(): string | null {
    notImplemented('takeAuthError');
  }

  // ── Household membership (Backend) ─────────────────────

  /** The entry kept from bringOnline/redeemCode (once), else GET ?op=session's entry ('member'). 401: 'not_signed_in'. */
  enterHome(): Promise<HomeEntry> {
    notImplemented('enterHome');
  }
  getMyHouseholdId(): Promise<string | null> {
    notImplemented('getMyHouseholdId');
  }
  load(_householdId: string): Promise<HouseholdData> {
    notImplemented('load');
  }
  /** The poller: onChange on the first successful poll, when rev goes up, and on the first success after a failed poll. */
  subscribe(_householdId: string, _onChange: () => void): Unsubscribe {
    notImplemented('subscribe');
  }
  /** Polls at once. Never throws. */
  reconnect(): void {
    notImplemented('reconnect');
  }
  /** Rejects with BackendError('home_exists'): a home comes online only through setup. */
  createHousehold(_input: CreateHouseholdInput): Promise<string> {
    notImplemented('createHousehold');
  }
  /** Rejects with BackendError('invalid_invite'): codes replace invite links. */
  joinHousehold(_input: JoinHouseholdInput): Promise<string> {
    notImplemented('joinHousehold');
  }
  /** "Not Shea?": POST {op:'release'}, then (like signOut) forgets the session and fires onAuthChange(null). */
  releaseClaim(): Promise<void> {
    notImplemented('releaseClaim');
  }
  /** Rejects with BackendError('unknown', 'not supported in server mode'): setup brings the home online. */
  importHousehold(_payload: ImportPayload): Promise<string> {
    notImplemented('importHousehold');
  }
  /** Resolves null: codes replace invite links. */
  getInvitePreview(_token: string): Promise<InvitePreview | null> {
    notImplemented('getInvitePreview');
  }
  /** Rejects with BackendError('invalid_invite'): createCode() replaces it. */
  createInvite(): Promise<string> {
    notImplemented('createInvite');
  }

  // ── Edits (Backend, each one RPC) ──────────────────────

  updateHousehold(_id: string, _patch: HouseholdPatch): Promise<void> {
    notImplemented('updateHousehold');
  }
  /** Only `name` and `emoji` (the server refuses weekly_email and push_enabled in server mode). */
  updateMember(_id: string, _patch: MemberPatch): Promise<void> {
    notImplemented('updateMember');
  }
  /** `input.email` must be '' (no Google emails in server mode). */
  addPerson(_householdId: string, _input: NewPersonInput): Promise<Member> {
    notImplemented('addPerson');
  }
  /** Rejects with BackendError('unknown', 'invalid_input: email'): no Google emails in server mode. */
  setPersonEmail(_memberId: string, _email: string): Promise<void> {
    notImplemented('setPersonEmail');
  }
  removePerson(_memberId: string): Promise<void> {
    notImplemented('removePerson');
  }
  createArea(_householdId: string, _name: string): Promise<Area> {
    notImplemented('createArea');
  }
  renameArea(_id: string, _name: string): Promise<void> {
    notImplemented('renameArea');
  }
  deleteArea(_id: string): Promise<void> {
    notImplemented('deleteArea');
  }
  reorderAreas(_householdId: string, _orderedIds: string[]): Promise<void> {
    notImplemented('reorderAreas');
  }
  createItem(_householdId: string, _draft: ItemDraft): Promise<Item> {
    notImplemented('createItem');
  }
  updateItem(_id: string, _patch: ItemPatch): Promise<void> {
    notImplemented('updateItem');
  }
  deleteItem(_id: string): Promise<void> {
    notImplemented('deleteItem');
  }
  completeItem(_id: string): Promise<string> {
    notImplemented('completeItem');
  }
  undoCompletion(_completionId: string): Promise<void> {
    notImplemented('undoCompletion');
  }

  // ── Push (Backend): not in server mode ─────────────────

  /** Rejects with BackendError('unknown', 'not supported in server mode'). */
  savePushSubscription(_memberId: string, _sub: PushSubscriptionInput): Promise<void> {
    notImplemented('savePushSubscription');
  }
  /** Resolves (nothing is stored), so sign-out's disablePush() never fails. */
  deletePushSubscription(_endpoint: string): Promise<void> {
    notImplemented('deletePushSubscription');
  }

  // ── Chat (Backend, RPC) ────────────────────────────────

  listMessages(_householdId: string, _opts?: { before?: ISOTimestamp; limit?: number }): Promise<ChatPage> {
    notImplemented('listMessages');
  }
  getMessages(_ids: string[]): Promise<ChatMessage[]> {
    notImplemented('getMessages');
  }
  /** RPC; then emits { type: 'message', messageId, deleted: false } to this backend's chat listeners before resolving. */
  sendMessage(_householdId: string, _body: string): Promise<ChatMessage> {
    notImplemented('sendMessage');
  }
  /** RPC; then emits { type: 'message', messageId: id, deleted: true }. */
  deleteMessage(_id: string): Promise<void> {
    notImplemented('deleteMessage');
  }
  /** RPC; then emits { type: 'reaction', messageId }. */
  setReaction(_messageId: string, _emoji: string, _on: boolean): Promise<void> {
    notImplemented('setReaction');
  }
  /** The poller: { type: 'resync' } on the first successful poll, when chatRev goes up, and after a failed poll. */
  subscribeChat(_householdId: string, _onChange: (change: ChatChange) => void): Unsubscribe {
    notImplemented('subscribeChat');
  }

  // ── Housekeeping (Backend, RPC) ────────────────────────

  setHousekeepingNote(_householdId: string, _body: string): Promise<void> {
    notImplemented('setHousekeepingNote');
  }
  undoClearHousekeepingNote(_householdId: string): Promise<void> {
    notImplemented('undoClearHousekeepingNote');
  }
  createHousekeepingTask(_householdId: string, _title: string): Promise<HousekeepingTask> {
    notImplemented('createHousekeepingTask');
  }
  renameHousekeepingTask(_id: string, _title: string): Promise<void> {
    notImplemented('renameHousekeepingTask');
  }
  deleteHousekeepingTask(_id: string): Promise<void> {
    notImplemented('deleteHousekeepingTask');
  }
  reorderHousekeepingTasks(_householdId: string, _orderedIds: string[]): Promise<void> {
    notImplemented('reorderHousekeepingTasks');
  }
  setHousekeepingTaskDone(
    _householdId: string,
    _date: ISODate,
    _target: HousekeepingTickTarget,
    _done: boolean,
  ): Promise<string> {
    notImplemented('setHousekeepingTaskDone');
  }
  saveHousekeepingVisit(_householdId: string, _date: ISODate, _patch: HousekeepingVisitPatch): Promise<string> {
    notImplemented('saveHousekeepingVisit');
  }
  addHousekeepingVisit(_householdId: string, _date: ISODate): Promise<string> {
    notImplemented('addHousekeepingVisit');
  }
  deleteHousekeepingVisit(_id: string): Promise<void> {
    notImplemented('deleteHousekeepingVisit');
  }

  // ── ServerAccess ───────────────────────────────────────

  /** GET ?op=status. */
  homeOnline(): Promise<boolean> {
    notImplemented('homeOnline');
  }
  /** POST {op:'setup', code, phone}; keeps the entry for the next enterHome(), writes AUTH_SIGNAL_KEY, fires onAuthChange(user). */
  bringOnline(_setupCode: string, _phoneDoc: string): Promise<HomeEntry> {
    notImplemented('bringOnline');
  }
  /** Not isSignInCode(normaliseCode(code)): rejects 'invalid_code' without a request. Else POST {op:'redeem'}, then as bringOnline. */
  redeemCode(_code: string): Promise<HomeEntry> {
    notImplemented('redeemCode');
  }
  /** POST {op:'createCode'}; adds the link (codeLink(appUrl, code)). */
  createCode(_memberId: string): Promise<IssuedCode> {
    notImplemented('createCode');
  }
  /** GET ?op=devices. */
  listDevices(): Promise<DeviceInfo[]> {
    notImplemented('listDevices');
  }
  /** POST {op:'removeDevice'}; this browser's own device: then as signOut (without asking the server again). */
  removeDevice(_deviceId: string): Promise<void> {
    notImplemented('removeDevice');
  }
  /** The poller's VersionResponse.readOnly, as a ServerStatus (once at once with the last known one). */
  onStatus(_cb: (status: ServerStatus) => void): Unsubscribe {
    notImplemented('onStatus');
  }
}
