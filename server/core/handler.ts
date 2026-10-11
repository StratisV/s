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
// SKELETON: not implemented yet.

import type { AttemptLimiter } from './limits';
import type { AuthDeps } from './auth';
import type { ServerConfig } from './config';
import type { HomeStore } from './homeStore';

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

/**
 * The error response for `err` (toApiError, API_ERROR_STATUS, Retry-After, the JSON headers).
 * The entries use it when reading the request already failed (readRequest rejects with
 * ApiError 'too_large'), so handleApi is not called.
 */
export function errorResponse(_err: unknown): ApiResponse {
  throw new Error('errorResponse: not implemented yet');
}

/** One API request, start to finish. Never throws: every failure is an error response. */
export function handleApi(_request: ApiRequest, _ctx: ServerContext): Promise<ApiResponse> {
  throw new Error('handleApi: not implemented yet');
}

/**
 * The key cookie: `homeos_key=<key>; Path=/api; HttpOnly; SameSite=Lax; Max-Age=34560000`
 * (+ `; Secure` when config.secureCookies), or, with key null, the same with an empty value and
 * Max-Age=0 (signed out).
 */
export function keyCookie(_key: string | null, _secure: boolean): string {
  throw new Error('keyCookie: not implemented yet');
}
