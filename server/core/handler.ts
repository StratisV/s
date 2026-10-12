// The API: one handler for every op of /api/home (src/lib/backend/serverApi.ts), the same for
// the Vercel Function (server/entry/vercel.ts), the local server (server/entry/local.ts) and the
// unit tests (which call handleApi directly). docs/ARCHITECTURE.md "Server mode (no setup)".
//
// For every request, in order:
// 1. Path must be API_PATH (else 404 'unknown_op'); method GET or POST (else 405 'unknown_op').
// 2. Header X-HomeOS: 1, and for POST Content-Type application/json → else 403 'forbidden'.
// 3. Body within its limit (SETUP_BODY_MAX for setup, RPC_BODY_MAX for rpc, SMALL_BODY_MAX
//    otherwise; the entry already refused anything over SETUP_BODY_MAX) → else 413 'too_large';
//    JSON with a known `op` (GET: ?op=) → else 400 'invalid_input' / 'unknown_op'.
// 4. The device: `Authorization: Bearer <token or key>` if present, else the KEY_COOKIE cookie
//    (a device token, ./auth.ts); see signedIn() below. Ops that need sign-in answer 401
//    'not_signed_in' (clearing the cookie) only when a copy of the home that is new enough
//    says the device is not there; when this instance can't tell yet, 503 'unavailable'
//    (the browser tries again; its cookie stays).
// 5. The op:
//    status   { home }: true for good once this instance has seen a home (no read); else
//             read() with "no home" kept NO_HOME_FRESH_MS
//    session  { user, entry: member, device, rev } and Set-Cookie renewing the token
//    version  { rev, chatRev, pollMs: pressure().pollMs, readOnly: pressure().readOnly }
//    devices  { devices: deviceInfos(doc, device.id) }
//    setup    setupHome() (./setup.ts)
//    redeem   limiter.begin(ip) (429 while blocked; the attempt counts as failed until it
//             works); not isSignInCode → 'invalid_code'; codeWorks() on this instance's copy,
//             else one 'stranger' recheck when the budget allows → 'invalid_code' without a
//             write; store.write(doc => redeemCode(…)) → { user, entry, device, rev } + the cookie
//    rpc      isRpcMethod (else 'unknown_op'); validateArgs; RPC_METHODS[method] 'read':
//             read({ minRev }) then runAs(kind 'read'); 'write': store.write(doc => runAs
//             (doc.home, caller, …) and doc.home = home); { result: result ?? null, rev }
//    createCode store.write(doc => issueCode(doc, memberId, caller.memberId, deps)) → CodeResponse
//             (403 'forbidden' for someone joined and signed in elsewhere: only they add devices)
//    removeDevice store.write(doc => removeDevice(doc, id) || throw not_found); clears the
//             cookie when it was this device
//    signOut  removes this device when the key is valid (a write), always 200, clears the cookie
//    release  store.write(doc => runAs(doc.home, caller, b => b.releaseClaim(), 'write')),
//             pruneAuth then drops their devices; clears the cookie
//    Every signed-in request marks its device as used (DeviceRow.seenAt) once: inside the
//    write for a write, else with a 'meta' write of its own (one put per device, ever).
// 6. Errors: toApiError(err) → { error: { code, message } } with API_ERROR_STATUS[code]
//    (Retry-After for too_many_attempts). A 5xx logs the error (never a key, code or body).
// Every response: Content-Type application/json; charset=utf-8, Cache-Control no-store.

import {
  API_ERROR_STATUS,
  API_HEADER,
  API_HEADER_VALUE,
  API_PATH,
  KEY_COOKIE,
  RPC_BODY_MAX,
  RPC_METHODS,
  SETUP_BODY_MAX,
  SMALL_BODY_MAX,
  isSignInCode,
  normaliseCode,
  type ApiErrorBody,
  type CodeResponse,
  type DevicesResponse,
  type OkResponse,
  type RpcResponse,
  type SessionResponse,
  type SetupRequest,
  type GoogleReturn,
  type StatusResponse,
  type VersionResponse,
} from '../../src/lib/backend/serverApi';
import { BackendError } from '../../src/lib/backend/types';
import type { DeviceInfo } from '../../src/lib/types';
import {
  codeWorks,
  deviceInfos,
  deviceToken,
  findDevice,
  issueCode,
  markSeen,
  parseDeviceToken,
  redeemCode,
  removeDevice,
  signInByEmail,
  tokenVerifies,
  type AuthDeps,
  type PresentedToken,
} from './auth';
import type { ServerConfig } from './config';
import { deviceLabel } from './deviceLabel';
import { ApiError, toApiError } from './errors';
import type { HomeSnapshot, HomeStore } from './homeStore';
import type { AttemptLimiter } from './limits';
import { isRpcMethod, runRpc, validateArgs } from './rpc';
import { runAs, type Caller } from './runAs';
import type { DeviceRow, ServerDoc } from './serverDoc';
import { setupHome } from './setup';
import { googleAuthUrl, verifyGoogleIdToken, type GoogleKeys } from './google';

/** A copy checked within this long counts as up to date for a bare key it does not hold. */
export const RECHECK_MS = 2000;
/** How long status keeps "no home online" before asking the store again. */
export const NO_HOME_FRESH_MS = 30_000;

/** A request as both entries hand it over. Header names lower case. */
export interface ApiRequest {
  method: string;
  /** Path and query, e.g. '/api/home?op=version'. */
  url: string;
  headers: Record<string, string | undefined>;
  /** The raw body (UTF-8), '' for GET. */
  body: string;
  /** The client's IP address (Vercel: x-real-ip, else the first of x-forwarded-for; local: the socket's). */
  ip: string;
}

export interface ApiResponse {
  status: number;
  /** Set-Cookie may be several. */
  headers: Record<string, string | string[]>;
  body: string;
}

/** What an op needs to know about the request besides its body. */
export interface RequestInfo {
  ip: string;
  userAgent: string | undefined;
}

export interface ServerContext {
  store: HomeStore;
  config: ServerConfig;
  /** Wrong sign-in and setup codes. */
  limiter: AttemptLimiter;
  /** Device keys this instance did not know (counted apart: they never hold up anyone's code). */
  keyMisses: AttemptLimiter;
  deps: AuthDeps;
  /** Google's signing keys (Continue with Google); none: Google sign-in answers 'failed'. */
  googleKeys?: GoogleKeys;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } as const;

function json(status: number, body: unknown, extra: Record<string, string | string[]> = {}): ApiResponse {
  return { status, headers: { ...JSON_HEADERS, ...extra }, body: JSON.stringify(body) };
}

function errorBody(code: ApiError['code'], message: string): ApiErrorBody {
  return { error: { code, message } };
}

/**
 * The error response for `err` (toApiError, API_ERROR_STATUS, Retry-After, the JSON headers).
 * The entries use it when reading the request already failed (readRequest rejects with
 * ApiError 'too_large'), so handleApi is not called.
 */
export function errorResponse(err: unknown): ApiResponse {
  const api = toApiError(err);
  const status = API_ERROR_STATUS[api.code];
  // "Try again in a moment" (an instance that can't tell yet) is expected, not a failure.
  if (status >= 500 && !(err instanceof ApiError && api.code === 'unavailable')) {
    // The error itself, never the request (no key, code or body is in it).
    const what = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`home.os api: ${api.code}: ${what}`);
  }
  const message = api.code === 'unknown' ? 'Something went wrong' : api.message;
  const extra: Record<string, string> = {};
  if (api.code === 'too_many_attempts') extra['Retry-After'] = String(Math.max(1, Math.ceil(api.retryAfter ?? 900)));
  return json(status, errorBody(api.code, message), extra);
}

/**
 * The key cookie: `homeos_key=<token>; Path=/api; HttpOnly; SameSite=Lax; Max-Age=34560000`
 * (+ `; Secure` when config.secureCookies), or, with null, the same with an empty value and
 * Max-Age=0 (signed out).
 */
export function keyCookie(token: string | null, secure: boolean): string {
  const value = token === null ? '' : token;
  const maxAge = token === null ? 0 : 34_560_000;
  return `${KEY_COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

interface Presented {
  /** As sent. */
  value: string;
  token: PresentedToken;
  fromCookie: boolean;
}

/** The device token or key the request carries: Authorization: Bearer first, else the cookie. Null: none, or not one. */
function presentedKey(headers: ApiRequest['headers']): Presented | null {
  const auth = headers.authorization;
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(auth);
    if (m) {
      const token = parseDeviceToken(m[1]);
      return token ? { value: m[1], token, fromCookie: false } : null;
    }
  }
  const cookie = headers.cookie;
  if (typeof cookie === 'string') {
    for (const part of cookie.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      if (part.slice(0, eq).trim() !== KEY_COOKIE) continue;
      const value = part.slice(eq + 1).trim();
      if (!value) continue;
      const token = parseDeviceToken(value);
      return token ? { value, token, fromCookie: true } : null;
    }
  }
  return null;
}

interface SignedIn {
  snapshot: HomeSnapshot;
  device: DeviceRow;
  caller: Caller;
  presented: Presented;
}

type Verdict =
  | { kind: 'in'; device: DeviceRow; caller: Caller }
  /** A copy new enough to know says no: a made-up, foreign or removed device. */
  | { kind: 'out' }
  /** A token this home signed for a rev newer than the copy: a device signed in elsewhere a moment ago. */
  | { kind: 'behind'; rev: number }
  /** A bare key (or no copy of the home here): only a fresh read can tell. */
  | { kind: 'unknown' };

function judge(snapshot: HomeSnapshot | null, token: PresentedToken): Verdict {
  if (!snapshot) return { kind: 'unknown' };
  const found = findDevice(snapshot.doc, token.key);
  if (found) return { kind: 'in', ...found };
  if (token.mac === undefined || !snapshot.doc.auth.secret) return { kind: 'unknown' };
  if (!tokenVerifies(snapshot.doc, token)) return { kind: 'out' };
  return token.rev! > snapshot.doc.rev ? { kind: 'behind', rev: token.rev! } : { kind: 'out' };
}

const unsure = () => new ApiError('unavailable', 'Try again in a moment');

/** Devices a 'meta' write is marking as used now (per instance), so one request at a time asks. */
const marking = new WeakMap<HomeStore, Set<string>>();

/**
 * Marks the device as used (once, ever) with a 'meta' write of its own. The device's first
 * request waits for it (work left running after a reply may be frozen on Vercel); requests
 * that arrive meanwhile do not. A failure (read-only, the store down) is left for a later request.
 */
async function noteSeen(ctx: ServerContext, device: DeviceRow): Promise<void> {
  if (device.seenAt) return;
  let set = marking.get(ctx.store);
  if (!set) {
    set = new Set();
    marking.set(ctx.store, set);
  }
  if (set.has(device.id)) return;
  const pending = set;
  pending.add(device.id);
  const now = ctx.deps.now();
  try {
    await ctx.store.write((doc) => void markSeen(doc, device.id, now), { kind: 'meta', pure: true });
  } catch {
    /* a later request marks it */
  } finally {
    pending.delete(device.id);
  }
}

/**
 * Who the request is signed in as, or null when it is definitely not signed in (401, and the
 * cookie goes). Throws ApiError 'unavailable' when this instance can't tell yet (503; the
 * browser keeps its cookie and asks again):
 * - the key is in the copy: signed in;
 * - a token this home signed, for a rev newer than the copy (a device another instance signed
 *   in a moment ago): the copy is read until it holds that rev, past every budget gate (only
 *   real devices can ask for it, once each), then judged again;
 * - a token signed by this home whose rev the copy holds, without the device: removed (or its
 *   person released); a token not signed by this home: made up. Both definitely out;
 * - a bare key, or no copy of the home here: out when the copy was checked within RECHECK_MS;
 *   else one 'stranger' recheck when the budget and keyMisses allow (else unsure), and a key
 *   still unknown counts in keyMisses.
 * `minRev` (an RPC read's): the copy is at least that new when the budget allows (a member
 * recheck); a newer copy without the device means it was removed. `markUsed` (default true):
 * note the device as used (writes do it inside their own write instead).
 */
async function signedIn(
  ctx: ServerContext,
  request: ApiRequest,
  opts: { minRev?: number; markUsed?: boolean } = {},
): Promise<SignedIn | null> {
  const presented = presentedKey(request.headers);
  if (!presented) return null;
  const { token } = presented;
  let snapshot = await ctx.store.read();
  let verdict = judge(snapshot, token);

  if (verdict.kind === 'unknown') {
    const checked = ctx.store.checkedAt();
    const age = checked === null ? Infinity : ctx.deps.now().getTime() - checked;
    if (age <= RECHECK_MS) {
      // A copy checked a moment ago does not hold this key. Unless there is no home here at
      // all and the token says there is one (brought online elsewhere this very moment).
      if (!snapshot && token.rev !== undefined) throw unsure();
      return null;
    }
    if (ctx.keyMisses.blockedFor(request.ip) > 0) throw unsure();
    const again = await ctx.store.recheck('stranger');
    if (again === 'skipped') throw unsure();
    snapshot = again;
    verdict = judge(snapshot, token);
    if (verdict.kind === 'unknown' || verdict.kind === 'out') {
      ctx.keyMisses.fail(request.ip);
      return null;
    }
  }
  if (verdict.kind === 'behind') {
    snapshot = await ctx.store.read({ minRev: verdict.rev, trusted: true });
    verdict = judge(snapshot, token);
    if (verdict.kind === 'behind' || verdict.kind === 'unknown') throw unsure();
  }
  if (verdict.kind === 'out') return null;
  let { device, caller } = verdict;
  let current = snapshot!;

  if (opts.minRev !== undefined && current.doc.rev < opts.minRev) {
    const newer = await ctx.store.read({ minRev: opts.minRev });
    if (newer && newer.doc.rev > current.doc.rev) {
      const found = findDevice(newer.doc, token.key);
      // Removed in the newer copy.
      if (!found) return null;
      current = newer;
      ({ device, caller } = found);
    }
  }
  if (opts.markUsed !== false) await noteSeen(ctx, device);
  return { snapshot: current, device, caller, presented };
}

/** The caller as the document being written knows them (signed out meanwhile: not_signed_in); marks the device used. */
function callerIn(doc: ServerDoc, deviceId: string, now: Date): Caller {
  const device = doc.auth.devices.find((d) => d.id === deviceId);
  const member = device ? doc.home.members.find((m) => m.user_id !== null && m.user_id === device.userId) : undefined;
  if (!device || !member) throw new ApiError('not_signed_in');
  markSeen(doc, deviceId, now);
  return { userId: device.userId, memberId: member.id, name: member.name };
}

function deviceInfo(device: DeviceRow, memberId: string, current: boolean): DeviceInfo {
  return { id: device.id, memberId, label: device.label, createdAt: device.createdAt, current };
}

const isId = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 100;

const POST_OPS = ['setup', 'redeem', 'rpc', 'createCode', 'removeDevice', 'signOut', 'release'] as const;
type PostOp = (typeof POST_OPS)[number];
const GET_OPS = ['status', 'session', 'version', 'devices'] as const;
type GetOp = (typeof GET_OPS)[number];

function bodyLimit(op: PostOp): number {
  return op === 'setup' ? SETUP_BODY_MAX : op === 'rpc' ? RPC_BODY_MAX : SMALL_BODY_MAX;
}

/** One API request, start to finish. Never throws: every failure is an error response. */
export async function handleApi(request: ApiRequest, ctx: ServerContext): Promise<ApiResponse> {
  const secure = ctx.config.secureCookies;
  try {
    return await route(request, ctx);
  } catch (err) {
    const response = errorResponse(err);
    // Signed out (no key, an unknown one, a removed device): the cookie goes too.
    if (toApiError(err).code === 'not_signed_in') response.headers['Set-Cookie'] = keyCookie(null, secure);
    return response;
  }
}

async function route(request: ApiRequest, ctx: ServerContext): Promise<ApiResponse> {
  let url: URL;
  try {
    url = new URL(request.url, 'http://localhost');
  } catch {
    return json(404, errorBody('unknown_op', 'Not found'));
  }
  if (url.pathname !== API_PATH) return json(404, errorBody('unknown_op', 'Not found'));
  const method = (request.method || '').toUpperCase();
  if (method !== 'GET' && method !== 'POST') return json(405, errorBody('unknown_op', 'Method not allowed'), { Allow: 'GET, POST' });
  const headers = request.headers;
  // Continue with Google: a navigation to Google and Google's form post back (google.ts), so
  // neither carries the X-HomeOS header; the state cookie and Google's signature guard them.
  const navOp = url.searchParams.get('op');
  if (method === 'GET' && navOp === 'googleStart') return googleStart(request, ctx);
  if (method === 'POST' && navOp === 'google') return googleReturn(request, ctx);
  if (headers[API_HEADER.toLowerCase()] !== API_HEADER_VALUE) throw new ApiError('forbidden', 'Missing the X-HomeOS header');
  const info: RequestInfo = { ip: request.ip || 'unknown', userAgent: headers['user-agent'] };

  if (method === 'GET') {
    const op = url.searchParams.get('op');
    if (!op || !(GET_OPS as readonly string[]).includes(op)) throw new ApiError('unknown_op', 'Unknown op');
    return get(op as GetOp, request, ctx);
  }

  const type = (headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new ApiError('forbidden', 'Not JSON');
  const size = Buffer.byteLength(request.body ?? '', 'utf8');
  if (size > SETUP_BODY_MAX) throw new ApiError('too_large', 'Too large');
  let body: unknown;
  try {
    body = JSON.parse(request.body);
  } catch {
    throw new ApiError('invalid_input', 'invalid_input: body');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ApiError('invalid_input', 'invalid_input: body');
  const op = (body as { op?: unknown }).op;
  if (typeof op !== 'string' || !(POST_OPS as readonly string[]).includes(op)) throw new ApiError('unknown_op', 'Unknown op');
  if (size > bodyLimit(op as PostOp)) throw new ApiError('too_large', 'Too large');
  return post(op as PostOp, body as Record<string, unknown>, request, info, ctx);
}

async function get(op: GetOp, request: ApiRequest, ctx: ServerContext): Promise<ApiResponse> {
  const secure = ctx.config.secureCookies;
  if (op === 'status') {
    // A home never goes away: once seen, no read is needed to say so.
    const google = ctx.config.googleClientId !== null;
    if (ctx.store.knowsHome()) return json(200, { home: true, google } satisfies StatusResponse);
    const snapshot = await ctx.store.read({ maxAgeMs: NO_HOME_FRESH_MS });
    return json(200, { home: snapshot !== null, google } satisfies StatusResponse);
  }
  const me = await signedIn(ctx, request);
  if (!me) throw new ApiError('not_signed_in');
  const { doc } = me.snapshot;
  switch (op) {
    case 'session': {
      const member = doc.home.members.find((m) => m.id === me.caller.memberId)!;
      const response: SessionResponse = {
        user: { id: me.caller.userId, email: '', name: me.caller.name },
        entry: { status: 'member', householdId: member.household_id, memberId: member.id, canImport: false },
        device: deviceInfo(me.device, member.id, true),
        rev: doc.rev,
      };
      if (!me.presented.fromCookie) return json(200, response);
      // The same token again, or (a bare key from before tokens) one for the copy that holds it.
      const { token } = me.presented;
      const renewed = token.mac !== undefined ? me.presented.value : deviceToken(doc, me.device, token.key, doc.rev);
      return json(200, response, { 'Set-Cookie': keyCookie(renewed, secure) });
    }
    case 'version': {
      const pressure = ctx.store.pressure();
      const response: VersionResponse = { rev: doc.rev, chatRev: doc.chatRev, pollMs: pressure.pollMs, readOnly: pressure.readOnly };
      return json(200, response);
    }
    case 'devices':
      return json(200, { devices: deviceInfos(doc, me.device.id) } satisfies DevicesResponse);
  }
}

async function post(
  op: PostOp,
  body: Record<string, unknown>,
  request: ApiRequest,
  info: RequestInfo,
  ctx: ServerContext,
): Promise<ApiResponse> {
  const secure = ctx.config.secureCookies;
  const now = () => ctx.deps.now();

  switch (op) {
    case 'setup': {
      if (typeof body.code !== 'string' || typeof body.phone !== 'string') throw new ApiError('invalid_input', 'invalid_input: body');
      const { response, token } = await setupHome(ctx, body as unknown as SetupRequest, info);
      return json(200, response, { 'Set-Cookie': keyCookie(token, secure) });
    }

    case 'redeem': {
      // Counted as a failed attempt from here until it works, with no await before: a burst of
      // codes sent at once is limited exactly like the same codes one after another.
      const attempt = ctx.limiter.begin(info.ip);
      if (!attempt.ticket) throw new ApiError('too_many_attempts', 'Too many tries', attempt.wait);
      const code = typeof body.code === 'string' ? normaliseCode(body.code) : '';
      if (!isSignInCode(code)) throw new ApiError('invalid_code', 'That code did not work');
      // Checked on this instance's copy first, so a wrong code never queues a write; a code
      // made on another instance a moment ago is found by one recheck when the budget allows.
      let snapshot = await ctx.store.read();
      if (!snapshot || !codeWorks(snapshot.doc, code, now())) {
        const again = await ctx.store.recheck('stranger');
        snapshot = again === 'skipped' ? null : again;
        if (!snapshot || !codeWorks(snapshot.doc, code, now())) throw new ApiError('invalid_code', 'That code did not work');
      }
      const label = deviceLabel(info.userAgent, body.app);
      let done;
      try {
        done = await ctx.store.write(
          (doc) => {
            const redeemed = redeemCode(doc, code, label, ctx.deps);
            if (!redeemed) throw new ApiError('invalid_code', 'That code did not work');
            return redeemed;
          },
          { pure: true },
        );
      } catch (err) {
        // No home online: the same answer as any code that does not work.
        if (err instanceof BackendError && err.code === 'not_found') throw new ApiError('invalid_code', 'That code did not work');
        throw err;
      }
      attempt.ticket.succeeded();
      const { token, device, caller, entry } = done.result;
      const response: SessionResponse = {
        user: { id: caller.userId, email: '', name: caller.name },
        entry,
        device: deviceInfo(device, caller.memberId, true),
        rev: done.rev,
      };
      return json(200, response, { 'Set-Cookie': keyCookie(token, secure) });
    }

    case 'signOut': {
      const me = await signedIn(ctx, request, { markUsed: false }).catch(() => null);
      if (me) {
        await ctx.store
          .write(
            (doc) => {
              removeDevice(doc, me.device.id);
            },
            { pure: true },
          )
          .catch((err) => {
            // Signing out always works here; the device may stay listed until removed.
            console.error(`home.os api: signOut could not revoke the device: ${toApiError(err).code}`);
          });
      }
      return json(200, { ok: true } satisfies OkResponse, { 'Set-Cookie': keyCookie(null, secure) });
    }

    case 'rpc': {
      const method = body.method;
      const minRev =
        typeof body.minRev === 'number' && Number.isSafeInteger(body.minRev) && body.minRev >= 0 ? body.minRev : undefined;
      const write = isRpcMethod(method) && RPC_METHODS[method] === 'write';
      const me = await signedIn(ctx, request, { minRev: write ? undefined : minRev, markUsed: !write });
      if (!me) throw new ApiError('not_signed_in');
      if (!isRpcMethod(method)) throw new ApiError('unknown_op', 'Unknown method');
      const args = validateArgs(method, body.args);
      if (RPC_METHODS[method] === 'read') {
        const { result } = await runAs(me.snapshot.doc.home, me.caller, (b) => runRpc(b, method, args), { now, kind: 'read' });
        return json(200, { result: result ?? null, rev: me.snapshot.doc.rev } as RpcResponse);
      }
      const done = await ctx.store.write(
        async (doc) => {
          const caller = callerIn(doc, me.device.id, now());
          const ran = await runAs(doc.home, caller, (b) => runRpc(b, method, args), { now, kind: 'write' });
          doc.home = ran.home!;
          return ran.result;
        },
        { pure: true },
      );
      return json(200, { result: done.result ?? null, rev: done.rev } as RpcResponse);
    }

    case 'createCode': {
      const me = await signedIn(ctx, request, { markUsed: false });
      if (!me) throw new ApiError('not_signed_in');
      if (!isId(body.memberId)) throw new ApiError('invalid_input', 'invalid_input: memberId');
      const memberId = body.memberId;
      const done = await ctx.store.write(
        (doc) => {
          const caller = callerIn(doc, me.device.id, now());
          const { code, row } = issueCode(doc, memberId, caller.memberId, ctx.deps);
          return { code, memberId: row.memberId, expiresAt: row.expiresAt } satisfies CodeResponse;
        },
        { pure: true },
      );
      return json(200, done.result);
    }

    case 'removeDevice': {
      const me = await signedIn(ctx, request, { markUsed: false });
      if (!me) throw new ApiError('not_signed_in');
      if (!isId(body.deviceId)) throw new ApiError('invalid_input', 'invalid_input: deviceId');
      const deviceId = body.deviceId;
      await ctx.store.write(
        (doc) => {
          callerIn(doc, me.device.id, now());
          if (!removeDevice(doc, deviceId)) throw new BackendError('not_found', 'No such device');
        },
        { pure: true },
      );
      const mine = deviceId === me.device.id;
      return json(200, { ok: true } satisfies OkResponse, mine ? { 'Set-Cookie': keyCookie(null, secure) } : {});
    }

    case 'release': {
      const me = await signedIn(ctx, request, { markUsed: false });
      if (!me) throw new ApiError('not_signed_in');
      await ctx.store.write(
        async (doc) => {
          const caller = callerIn(doc, me.device.id, now());
          const ran = await runAs(doc.home, caller, (b) => b.releaseClaim(), { now, kind: 'write' });
          // The person is not joined any more: pruneAuth() signs them out everywhere before the put.
          doc.home = ran.home!;
        },
        { pure: true },
      );
      return json(200, { ok: true } satisfies OkResponse, { 'Set-Cookie': keyCookie(null, secure) });
    }
  }
}

// ── Continue with Google (google.ts) ────────────────────

/** The short-lived cookie with the state and nonce of a Google sign-in under way. */
const GOOGLE_COOKIE = 'homeos_google';

function googleCookie(value: string | null, secure: boolean): string {
  // SameSite=None (Secure): it has to come back with Google's cross-site form post.
  const same = secure ? 'SameSite=None; Secure' : 'SameSite=Lax';
  return `${GOOGLE_COOKIE}=${value ?? ''}; Path=/api; HttpOnly; ${same}; Max-Age=${value === null ? 0 : 600}`;
}

function cookieValue(headers: ApiRequest['headers'], name: string): string | null {
  const cookie = headers.cookie;
  if (typeof cookie !== 'string') return null;
  for (const part of cookie.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

/** This app's origin as the browser sees it (Google's redirect_uri must match what is registered). */
function appOrigin(request: ApiRequest, secure: boolean): string {
  const host = (request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost').split(',')[0].trim();
  return `${secure ? 'https' : 'http'}://${host}`;
}

function redirect(location: string, cookies: string[] = [], status = 303): ApiResponse {
  return { status, headers: { Location: location, 'Cache-Control': 'no-store', ...(cookies.length ? { 'Set-Cookie': cookies } : {}) }, body: '' };
}

/** Step 1: a fresh state and nonce in GOOGLE_COOKIE, then off to Google. */
function googleStart(request: ApiRequest, ctx: ServerContext): ApiResponse {
  const secure = ctx.config.secureCookies;
  const clientId = ctx.config.googleClientId;
  if (!clientId) return redirect('/?google=failed');
  const state = Buffer.from(ctx.deps.randomBytes(18)).toString('base64url');
  const nonce = Buffer.from(ctx.deps.randomBytes(18)).toString('base64url');
  const origin = appOrigin(request, secure);
  const url = googleAuthUrl({ clientId, redirectUri: `${origin}${API_PATH}?op=google`, state, nonce });
  return redirect(url, [googleCookie(`${state}.${nonce}`, secure)], 302);
}

/** Step 2 and 3: Google's form post, checked, then this browser signed in (or why not). */
async function googleReturn(request: ApiRequest, ctx: ServerContext): Promise<ApiResponse> {
  const secure = ctx.config.secureCookies;
  const clear = googleCookie(null, secure);
  const back = (reason: GoogleReturn) => redirect(`/?google=${reason}`, [clear]);
  const clientId = ctx.config.googleClientId;
  if (!clientId || !ctx.googleKeys || (request.body ?? '').length > 16_384) return back('failed');
  const form = new URLSearchParams(request.body ?? '');
  const [state, nonce] = (cookieValue(request.headers, GOOGLE_COOKIE) ?? '').split('.');
  const token = form.get('id_token');
  if (!state || !nonce || form.get('state') !== state || !token) return back('failed');
  let identity;
  try {
    identity = await verifyGoogleIdToken(token, { clientId, nonce, now: ctx.deps.now(), keys: ctx.googleKeys });
  } catch (err) {
    console.error(`home.os api: Google sign-in could not check the token: ${(err as Error).message}`);
    return back('failed');
  }
  if (!identity) return back('failed');
  const label = deviceLabel(request.headers['user-agent'], undefined);
  let done;
  try {
    done = await ctx.store.write(
      (doc) => {
        const signed = signInByEmail(doc, identity.email, ctx.config.googlePeople, label, ctx.deps);
        if (!signed) throw new ApiError('forbidden', 'not_member');
        return signed;
      },
      { pure: true },
    );
  } catch (err) {
    if (err instanceof ApiError && err.message === 'not_member') return back('not_member');
    if (err instanceof BackendError && err.code === 'not_found') return back('no_home');
    console.error(`home.os api: Google sign-in could not sign in: ${toApiError(err).code}`);
    return back('failed');
  }
  return redirect('/', [clear, keyCookie(done.result.token, secure)]);
}
