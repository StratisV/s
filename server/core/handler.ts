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
// 4. The device: `Authorization: Bearer <key>` if present, else the KEY_COOKIE cookie; looked
//    up with findDevice() on store.read() (fresh within pressure().freshMs). Ops that need
//    sign-in answer 401 'not_signed_in' without one (and clear the cookie).
// 5. The op:
//    status   read() → { home: snapshot !== null }
//    session  { user, entry: member, device, rev } and Set-Cookie renewing the same key
//    version  { rev, chatRev, pollMs: pressure().pollMs, readOnly: pressure().readOnly }
//    devices  { devices: deviceInfos(doc, device.id) }
//    setup    setupHome()
//    redeem   limiter.blockedFor(ip) → 429; not isSignInCode → fail(ip), 'invalid_code';
//             store.write(doc => redeemCode(doc, …)): null → fail(ip), 'invalid_code' (the
//             write stores nothing then); else { user, entry, device, rev } + Set-Cookie
//    rpc      isRpcMethod (else 'unknown_op'); validateArgs; RPC_METHODS[method] 'read':
//             read({ minRev }) then runAs(kind 'read'); 'write': store.write(doc => runAs
//             (doc.home, caller, …) and doc.home = home); { result: result ?? null, rev }
//    createCode store.write(doc => issueCode(doc, memberId, caller.memberId, deps)) → CodeResponse
//    removeDevice store.write(doc => removeDevice(doc, id) || throw not_found); clears the
//             cookie when it was this device
//    signOut  removes this device when the key is valid (a write), always 200, clears the cookie
//    release  store.write(doc => runAs(doc.home, caller, b => b.releaseClaim(), 'write')),
//             pruneAuth then drops their devices; clears the cookie
// 6. Errors: toApiError(err) → { error: { code, message } } with API_ERROR_STATUS[code]
//    (Retry-After for too_many_attempts). A 5xx logs the error (never a key, code or body).
// Every response: Content-Type application/json; charset=utf-8, Cache-Control no-store.
//
// A key this instance's copy does not know may be one another instance signed in moments ago
// (one function, but sometimes more than one instance): the store is read once more before
// answering 401, unless that address is being limited, the copy was checked within the last
// RECHECK_MS, or reads are under budget pressure. A key that is still unknown counts as a
// failed attempt (AttemptLimiter), so made-up keys can't run up the Blob read budget.

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
  type StatusResponse,
  type VersionResponse,
} from '../../src/lib/backend/serverApi';
import { BackendError } from '../../src/lib/backend/types';
import type { DeviceInfo } from '../../src/lib/types';
import {
  deviceInfos,
  findDevice,
  issueCode,
  redeemCode,
  removeDevice,
  type AuthDeps,
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

/** An unknown key is checked against the store again only when the copy is older than this. */
export const RECHECK_MS = 2000;

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
  limiter: AttemptLimiter;
  deps: AuthDeps;
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
  if (status >= 500) {
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
 * The key cookie: `homeos_key=<key>; Path=/api; HttpOnly; SameSite=Lax; Max-Age=34560000`
 * (+ `; Secure` when config.secureCookies), or, with key null, the same with an empty value and
 * Max-Age=0 (signed out).
 */
export function keyCookie(key: string | null, secure: boolean): string {
  const value = key === null ? '' : key;
  const maxAge = key === null ? 0 : 34_560_000;
  return `${KEY_COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

/** The device key the request carries: Authorization: Bearer first, else the cookie. */
function presentedKey(headers: ApiRequest['headers']): { key: string; fromCookie: boolean } | null {
  const auth = headers.authorization;
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(auth);
    if (m) return { key: m[1], fromCookie: false };
  }
  const cookie = headers.cookie;
  if (typeof cookie === 'string') {
    for (const part of cookie.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      if (part.slice(0, eq).trim() !== KEY_COOKIE) continue;
      const value = part.slice(eq + 1).trim();
      if (value) return { key: value, fromCookie: true };
    }
  }
  return null;
}

interface SignedIn {
  snapshot: HomeSnapshot;
  device: DeviceRow;
  caller: Caller;
  key: string;
  fromCookie: boolean;
}

/**
 * Who the request is signed in as, or null. `minRev`: the copy is at least that new (only once
 * the key is known, so nobody signed out can make the server read the store).
 */
async function signedIn(ctx: ServerContext, request: ApiRequest, minRev?: number): Promise<SignedIn | null> {
  const presented = presentedKey(request.headers);
  if (!presented) return null;
  let snapshot = await ctx.store.read();
  let found = snapshot ? findDevice(snapshot.doc, presented.key) : null;
  if (!found) {
    const stale = !snapshot || ctx.deps.now().getTime() - snapshot.checkedAt > RECHECK_MS;
    if (!stale || ctx.limiter.blockedFor(request.ip) > 0 || ctx.store.pressure().freshMs > 10_000) return null;
    snapshot = await ctx.store.read({ maxAgeMs: RECHECK_MS });
    found = snapshot ? findDevice(snapshot.doc, presented.key) : null;
    if (!found) {
      ctx.limiter.fail(request.ip);
      return null;
    }
  }
  if (minRev !== undefined && snapshot!.doc.rev < minRev) {
    snapshot = await ctx.store.read({ minRev });
    found = snapshot ? findDevice(snapshot.doc, presented.key) : null;
    if (!found) return null;
  }
  return { snapshot: snapshot!, device: found.device, caller: found.caller, key: presented.key, fromCookie: presented.fromCookie };
}

/** The caller as the document being written knows them (signed out meanwhile: not_signed_in). */
function callerIn(doc: ServerDoc, deviceId: string): Caller {
  const device = doc.auth.devices.find((d) => d.id === deviceId);
  const member = device ? doc.home.members.find((m) => m.user_id !== null && m.user_id === device.userId) : undefined;
  if (!device || !member) throw new ApiError('not_signed_in');
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
    const snapshot = await ctx.store.read();
    return json(200, { home: snapshot !== null } satisfies StatusResponse);
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
      return json(200, response, me.fromCookie ? { 'Set-Cookie': keyCookie(me.key, secure) } : {});
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
      const { response, key } = await setupHome(ctx, body as unknown as SetupRequest, info);
      return json(200, response, { 'Set-Cookie': keyCookie(key, secure) });
    }

    case 'redeem': {
      const wait = ctx.limiter.blockedFor(info.ip);
      if (wait > 0) throw new ApiError('too_many_attempts', 'Too many tries', wait);
      const code = typeof body.code === 'string' ? normaliseCode(body.code) : '';
      if (!isSignInCode(code)) {
        ctx.limiter.fail(info.ip);
        throw new ApiError('invalid_code', 'That code did not work');
      }
      const label = deviceLabel(info.userAgent);
      let done;
      try {
        done = await ctx.store.write((doc) => {
          const redeemed = redeemCode(doc, code, label, ctx.deps);
          // Nothing changed: no put. The error counts as a failed attempt below.
          if (!redeemed) throw new ApiError('invalid_code', 'That code did not work');
          return redeemed;
        });
      } catch (err) {
        if (err instanceof ApiError && err.code === 'invalid_code') ctx.limiter.fail(info.ip);
        // No home online: the same answer as any code that does not work.
        if (err instanceof BackendError && err.code === 'not_found') {
          ctx.limiter.fail(info.ip);
          throw new ApiError('invalid_code', 'That code did not work');
        }
        throw err;
      }
      const { key, device, caller, entry } = done.result;
      const response: SessionResponse = {
        user: { id: caller.userId, email: '', name: caller.name },
        entry,
        device: deviceInfo(device, caller.memberId, true),
        rev: done.rev,
      };
      return json(200, response, { 'Set-Cookie': keyCookie(key, secure) });
    }

    case 'signOut': {
      const me = await signedIn(ctx, request).catch(() => null);
      if (me) {
        await ctx.store
          .write((doc) => {
            removeDevice(doc, me.device.id);
          })
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
      const me = await signedIn(ctx, request, minRev);
      if (!me) throw new ApiError('not_signed_in');
      if (!isRpcMethod(method)) throw new ApiError('unknown_op', 'Unknown method');
      const args = validateArgs(method, body.args);
      if (RPC_METHODS[method] === 'read') {
        const { result } = await runAs(me.snapshot.doc.home, me.caller, (b) => runRpc(b, method, args), { now, kind: 'read' });
        return json(200, { result: result ?? null, rev: me.snapshot.doc.rev } as RpcResponse);
      }
      const done = await ctx.store.write(async (doc) => {
        const caller = callerIn(doc, me.device.id);
        const ran = await runAs(doc.home, caller, (b) => runRpc(b, method, args), { now, kind: 'write' });
        doc.home = ran.home!;
        return ran.result;
      });
      return json(200, { result: done.result ?? null, rev: done.rev } as RpcResponse);
    }

    case 'createCode': {
      const me = await signedIn(ctx, request);
      if (!me) throw new ApiError('not_signed_in');
      if (!isId(body.memberId)) throw new ApiError('invalid_input', 'invalid_input: memberId');
      const memberId = body.memberId;
      const done = await ctx.store.write((doc) => {
        const caller = callerIn(doc, me.device.id);
        const { code, row } = issueCode(doc, memberId, caller.memberId, ctx.deps);
        return { code, memberId: row.memberId, expiresAt: row.expiresAt } satisfies CodeResponse;
      });
      return json(200, done.result);
    }

    case 'removeDevice': {
      const me = await signedIn(ctx, request);
      if (!me) throw new ApiError('not_signed_in');
      if (!isId(body.deviceId)) throw new ApiError('invalid_input', 'invalid_input: deviceId');
      const deviceId = body.deviceId;
      await ctx.store.write((doc) => {
        callerIn(doc, me.device.id);
        if (!removeDevice(doc, deviceId)) throw new BackendError('not_found', 'No such device');
      });
      const mine = deviceId === me.device.id;
      return json(200, { ok: true } satisfies OkResponse, mine ? { 'Set-Cookie': keyCookie(null, secure) } : {});
    }

    case 'release': {
      const me = await signedIn(ctx, request);
      if (!me) throw new ApiError('not_signed_in');
      await ctx.store.write(async (doc) => {
        const caller = callerIn(doc, me.device.id);
        const ran = await runAs(doc.home, caller, (b) => b.releaseClaim(), { now, kind: 'write' });
        // The person is not joined any more: pruneAuth() signs them out everywhere before the put.
        doc.home = ran.home!;
      });
      return json(200, { ok: true } satisfies OkResponse, { 'Set-Cookie': keyCookie(null, secure) });
    }
  }
}
