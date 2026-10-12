// The wire contract between ServerBackend (src/lib/backend/server.ts) and the server
// (server/, published at /api/home). Both sides import this file, so it holds only types,
// constants and small pure helpers. docs/ARCHITECTURE.md "Server mode (no setup)" explains it.
//
// One endpoint, so one Vercel Function and one in-memory cache of the home (writes made on an
// instance are seen at once by every request that instance serves):
//
//   GET  /api/home?op=status    no sign-in            → StatusResponse
//   GET  /api/home?op=session   signed in             → SessionResponse (re-sets the cookie)
//   GET  /api/home?op=version   signed in             → VersionResponse (polled every few seconds)
//   GET  /api/home?op=devices   signed in             → DevicesResponse
//   POST /api/home  {op:'setup'}         no sign-in   → SignedInResponse + Set-Cookie
//   POST /api/home  {op:'redeem'}        no sign-in   → SignedInResponse + Set-Cookie
//   POST /api/home  {op:'rpc'}           signed in    → RpcResponse
//   POST /api/home  {op:'createCode'}    signed in    → CodeResponse
//   POST /api/home  {op:'removeDevice'}  signed in    → OkResponse (+ clears the cookie when it was this one)
//   POST /api/home  {op:'signOut'}       either       → OkResponse + clears the cookie (always 200)
//   POST /api/home  {op:'release'}       signed in    → OkResponse + clears the cookie ("Not Shea?")
//
// Every request carries the header `X-HomeOS: 1` (API_HEADER), and every POST is
// `Content-Type: application/json`; anything else is 403 'forbidden' (a cross-site page can't
// send either without a CORS preflight, which the server never answers). Responses are JSON
// with `Cache-Control: no-store`. Errors are `{ "error": { "code": ApiErrorCode, "message" } }`
// with the status in API_ERROR_STATUS.
//
// Signed in = a device key the server recognises, from the `homeos_key` cookie (HttpOnly,
// Secure on https, SameSite=Lax, Path=/api, Max-Age 400 days; set by setup and redeem, renewed
// by session) or from `Authorization: Bearer <key>` (tests and tools). The cookie holds a
// device token, the key with the device's id, the rev that first held it and the server's
// signature (server/core/auth.ts), so any instance can tell a device signed in elsewhere a
// moment ago from a made-up key. The browser app only ever uses the cookie and never sees it.

import type { HomeEntry, ISOTimestamp, AuthUser, DeviceInfo } from '../types';
import { BackendError, type Backend, type BackendErrorCode } from './types';

/** Where the API lives (always at the root of the deployment). */
export const API_PATH = '/api/home';
/** Sent with every request; the server refuses requests without it (CSRF). */
export const API_HEADER = 'X-HomeOS';
export const API_HEADER_VALUE = '1';
/** The cookie that holds this browser's device key. */
export const KEY_COOKIE = 'homeos_key';

// ── Codes ────────────────────────────────────────────────

/**
 * The letters codes are made of: 2 to 9 and A to Z without I and O (no 0/O or 1/I/L
 * confusion), 32 in all, so each random byte gives one letter without bias (byte & 31).
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
/** A sign-in code: 8 letters (40 bits), shown as ABCD-EFGH. */
export const CODE_LENGTH = 8;
/** How long a sign-in code works. */
export const CODE_TTL_MS = 7 * 86_400_000;
/**
 * The setup code (env HOMEOS_SETUP_CODE) has at least this many letters of CODE_ALPHABET once
 * normalised (60 bits), e.g. "K7QM-3XRP-WN9D", so it is never mistaken for a sign-in code.
 */
export const SETUP_CODE_MIN_LENGTH = 12;
/**
 * The longest setup code the code fields take whole: 24 letters (the live one has 20, shown as
 * "ABCD-EFGH-JKLM-NPQR-STUV"). A longer HOMEOS_SETUP_CODE still works from a ?setup= link.
 */
export const SETUP_CODE_MAX_LENGTH = 24;

/**
 * A code as typed or linked, normalised: upper case, with spaces, hyphens and dots taken out.
 * Nothing else changes, so a code with a letter outside CODE_ALPHABET stays invalid.
 * Example: " abcd-efgh " → "ABCDEFGH".
 */
export function normaliseCode(input: string): string {
  return (typeof input === 'string' ? input : '').toUpperCase().replace(/[\s\-.‐-―]/g, '');
}

/** Whether `normalised` (normaliseCode()) is shaped like a sign-in code: 8 letters of CODE_ALPHABET. */
export function isSignInCode(normalised: string): boolean {
  return normalised.length === CODE_LENGTH && [...normalised].every((c) => CODE_ALPHABET.includes(c));
}

/** Whether `normalised` is shaped like a setup code: SETUP_CODE_MIN_LENGTH or more letters of CODE_ALPHABET. */
export function isSetupCode(normalised: string): boolean {
  return normalised.length >= SETUP_CODE_MIN_LENGTH && [...normalised].every((c) => CODE_ALPHABET.includes(c));
}

/** A normalised code in groups of four, as shown: "ABCDEFGH" → "ABCD-EFGH". */
export function formatCode(normalised: string): string {
  return (normalised.match(/.{1,4}/g) ?? []).join('-');
}

/** The link that signs in with `code`: `<appUrl>?code=ABCD-EFGH` (appUrl is origin + BASE_URL). */
export function codeLink(appUrl: string, code: string): string {
  const url = new URL(appUrl);
  url.searchParams.set('code', formatCode(normaliseCode(code)));
  return url.toString();
}

// ── Requests ─────────────────────────────────────────────

export type ApiGetOp = 'status' | 'session' | 'version' | 'devices';

/**
 * How the page runs, sent with setup and redeem so the device list can tell them apart (on an
 * iPhone, Safari and the Home Screen app send the same user agent but keep separate sign-ins):
 * 'standalone' when installed (display-mode: standalone, or navigator.standalone).
 */
export type AppMode = 'standalone' | 'browser';

/**
 * "Bring this home online". `phone`: the raw localStorage homeos.demo.v1 string (at most
 * SETUP_BODY_MAX). With a home online already, the right setup code still signs this browser
 * in as the owner when none of the owner's devices was ever used (the first reply was lost).
 */
export interface SetupRequest {
  op: 'setup';
  code: string;
  phone: string;
  app?: AppMode;
}
/** A sign-in code, as typed (the server normalises it). */
export interface RedeemRequest {
  op: 'redeem';
  code: string;
  app?: AppMode;
}
/**
 * One Backend method from RPC_METHODS, with its arguments as the method takes them (JSON).
 * `minRev`: the newest rev this browser has seen; a read is answered from a copy at least
 * that new (the server re-reads the store when its copy is older).
 */
export interface RpcRequest<M extends RpcMethod = RpcMethod> {
  op: 'rpc';
  method: M;
  args: RpcArgs<M>;
  minRev?: number;
}
export interface CreateCodeRequest {
  op: 'createCode';
  memberId: string;
}
export interface RemoveDeviceRequest {
  op: 'removeDevice';
  deviceId: string;
}
export interface SignOutRequest {
  op: 'signOut';
}
export interface ReleaseRequest {
  op: 'release';
}
/** Create Account. */
export interface SignUpRequest {
  op: 'signUp';
  name: string;
  email: string;
  password: string;
  app?: AppMode;
}
/** Sign In with email and password. */
export interface SignInRequest {
  op: 'signIn';
  email: string;
  password: string;
  app?: AppMode;
}
export type ApiPostRequest =
  | SetupRequest
  | RedeemRequest
  | SignUpRequest
  | SignInRequest
  | RpcRequest
  | CreateCodeRequest
  | RemoveDeviceRequest
  | SignOutRequest
  | ReleaseRequest;

/** Request body limits (bytes, UTF-8). Larger is 413 'too_large'. */
export const SETUP_BODY_MAX = 4 * 1024 * 1024;
export const RPC_BODY_MAX = 256 * 1024;
export const SMALL_BODY_MAX = 4 * 1024;

// ── Responses ────────────────────────────────────────────

export interface StatusResponse {
  /** A home is online on this server. */
  home: boolean;
  /** Continue with Google is on (HOMEOS_GOOGLE_CLIENT_ID is set). */
  google?: boolean;
}
/** Why Continue with Google sent the browser back without signing it in: /?google=<reason>. */
export type GoogleReturn = 'not_member' | 'failed' | 'no_home';
/** Who this browser is signed in as. */
export interface SessionResponse {
  /** id: the person's user id (members.user_id), email '', name: their name. */
  user: AuthUser;
  /** Always 'member' from the session op ('claimed' only comes from redeem). */
  entry: HomeEntry;
  device: DeviceInfo;
  rev: number;
}
/** What setup and redeem return (and they set the cookie). */
export type SignedInResponse = SessionResponse;
export interface VersionResponse {
  /** Goes up by one with every stored change to the home (anything at all). */
  rev: number;
  /** Goes up whenever the chat (messages, reactions) changed in a stored change. */
  chatRev: number;
  /** How long to wait before the next poll while visible (ms); the server raises it to save Blob reads. */
  pollMs: number;
  readOnly: boolean;
}
export interface DevicesResponse {
  devices: DeviceInfo[];
}
export interface RpcResponse<M extends RpcMethod = RpcMethod> {
  /** The method's result as JSON; null for a method that resolves to nothing. */
  result: RpcWireResult<M>;
  /** The home's rev after the call (a write's own rev, or the copy a read was answered from). */
  rev: number;
}
export interface CodeResponse {
  /** Formatted, "ABCD-EFGH". */
  code: string;
  memberId: string;
  expiresAt: ISOTimestamp;
}
export interface OkResponse {
  ok: true;
}

// ── Errors ───────────────────────────────────────────────

export type ApiErrorCode =
  | 'not_signed_in'
  | 'forbidden'
  | 'not_found'
  | 'invalid_input'
  | 'unknown_op'
  | 'invalid_code'
  | 'home_exists'
  | 'already_member'
  | 'email_taken'
  | 'invalid_invite'
  | 'too_many_attempts'
  | 'too_large'
  | 'busy'
  | 'read_only'
  | 'unavailable'
  | 'unknown';

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}

export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  /** No key, an unknown key, or a device that was removed. The app signs out. */
  not_signed_in: 401,
  /** Missing X-HomeOS header, or a POST that is not JSON. */
  forbidden: 403,
  not_found: 404,
  /** A request or argument the server refuses; message 'invalid_input: <what>', as DemoBackend words it. */
  invalid_input: 400,
  /** An op that does not exist, or a method outside RPC_METHODS. */
  unknown_op: 400,
  invalid_code: 400,
  home_exists: 409,
  already_member: 409,
  email_taken: 409,
  invalid_invite: 400,
  /** With a Retry-After header (seconds). */
  too_many_attempts: 429,
  too_large: 413,
  /** The write kept losing to other writes (WRITE_ATTEMPTS in a row). */
  busy: 503,
  read_only: 503,
  /** The Blob store could not be reached. */
  unavailable: 503,
  unknown: 500,
};

/**
 * The BackendError the app sees for an error response (`status`, parsed `body`, or null when
 * the body was not JSON). Codes the app already knows keep their code; 'invalid_input' becomes
 * BackendError('unknown', 'invalid_input: …') like the other backends; 'unavailable' reads as
 * 'network'; the rest are 'unknown' with the wire code as the message.
 */
export function toBackendError(status: number, body: unknown): BackendError {
  const error = (body as Partial<ApiErrorBody> | null)?.error;
  const code = typeof error?.code === 'string' ? error.code : null;
  const message = typeof error?.message === 'string' ? error.message : '';
  switch (code) {
    case 'not_signed_in':
    case 'not_found':
    case 'home_exists':
    case 'already_member':
    case 'email_taken':
    case 'invalid_invite':
    case 'invalid_code':
    case 'too_many_attempts':
    case 'read_only':
      return new BackendError(code, message || code);
    case 'invalid_input':
      return new BackendError('unknown', message.startsWith('invalid_input') ? message : `invalid_input: ${message}`);
    case 'unavailable':
      return new BackendError('network', 'unavailable');
    case null:
      if (status === 401) return new BackendError('not_signed_in');
      if (status === 502 || status === 503 || status === 504) return new BackendError('network', `http ${status}`);
      return new BackendError('unknown', `http ${status}`);
    default:
      return new BackendError('unknown', message ? `${code}: ${message}` : code);
  }
}

/** The codes toBackendError() can give besides the wire codes' own (for exhaustive UI copy). */
export type ServerBackendErrorCode = Extract<
  BackendErrorCode,
  'not_signed_in' | 'not_found' | 'home_exists' | 'invalid_code' | 'too_many_attempts' | 'read_only' | 'network' | 'unknown'
>;

// ── The RPC allow-list ───────────────────────────────────

/**
 * Every Backend method the browser may call through {op:'rpc'}, and whether it changes the home
 * ('write': queued and stored with an ifMatch put; 'read': answered from the cached copy).
 * Anything else is 400 'unknown_op'. Each method runs on the server as the DemoBackend method
 * of the same name, as the signed-in person, after the server checked the argument types
 * (server/core/rpc.ts; the table in docs/ARCHITECTURE.md "Server mode (no setup)" says how).
 */
export const RPC_METHODS = {
  getMyHouseholdId: 'read',
  load: 'read',
  updateHousehold: 'write',
  updateMember: 'write',
  addPerson: 'write',
  removePerson: 'write',
  createArea: 'write',
  renameArea: 'write',
  deleteArea: 'write',
  reorderAreas: 'write',
  createItem: 'write',
  updateItem: 'write',
  deleteItem: 'write',
  completeItem: 'write',
  undoCompletion: 'write',
  listMessages: 'read',
  getMessages: 'read',
  sendMessage: 'write',
  deleteMessage: 'write',
  setReaction: 'write',
  setHousekeepingNote: 'write',
  undoClearHousekeepingNote: 'write',
  createHousekeepingTask: 'write',
  renameHousekeepingTask: 'write',
  deleteHousekeepingTask: 'write',
  reorderHousekeepingTasks: 'write',
  setHousekeepingTaskDone: 'write',
  saveHousekeepingVisit: 'write',
  addHousekeepingVisit: 'write',
  deleteHousekeepingVisit: 'write',
} as const satisfies { [M in keyof Backend]?: 'read' | 'write' };

export type RpcMethod = keyof typeof RPC_METHODS;
type BackendMethod<M extends RpcMethod> = Backend[M] extends (...args: infer A) => infer R ? (...args: A) => R : never;
export type RpcArgs<M extends RpcMethod> = Parameters<BackendMethod<M>>;
export type RpcResult<M extends RpcMethod> = Awaited<ReturnType<BackendMethod<M>>>;
/** What travels: `void` results are null. */
export type RpcWireResult<M extends RpcMethod> = RpcResult<M> extends void ? null : RpcResult<M>;

/**
 * Backend methods that are not RPCs in server mode, and what ServerBackend does instead
 * (docs/ARCHITECTURE.md has the reasons).
 */
export const NOT_RPC: { [M in Exclude<keyof Backend, RpcMethod | 'kind'>]: string } = {
  getUser: 'GET ?op=session (401: signed out)',
  onAuthChange: 'local listeners, fired by sign-in, sign-out, a 401 and other tabs',
  signInWithGoogle: "rejects: there is no Google sign-in in server mode",
  signOut: "POST {op:'signOut'}, then local sign-out",
  takeAuthError: 'always null',
  enterHome: "the entry kept from setup or redeem (once), else GET ?op=session's entry",
  subscribe: 'polls GET ?op=version; onChange when rev changes, and on the first poll and after a failed one',
  subscribeChat: "the same poll; { type: 'resync' } when chatRev changes, and the change of its own chat writes",
  reconnect: 'polls at once',
  createHousehold: "rejects 'home_exists': a home comes online only through setup",
  joinHousehold: "rejects 'invalid_invite': codes replace invite links",
  releaseClaim: "POST {op:'release'}",
  importHousehold: "rejects: setup (ServerAccess.bringOnline) brings the home online",
  getInvitePreview: 'resolves null: codes replace invite links',
  createInvite: "rejects 'invalid_invite': codes replace invite links (ServerAccess.createCode)",
  setPersonEmail: "rejects BackendError('unknown', 'invalid_input: email'): no Google emails in server mode",
  savePushSubscription: 'rejects: no push notifications in server mode',
  deletePushSubscription: 'resolves (nothing is stored)',
};
