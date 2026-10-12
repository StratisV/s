// Continue with Google (server mode). docs/ARCHITECTURE.md "Server mode (no setup)", "Google".
//
// OpenID Connect, implicit flow with form_post: nothing but the Client ID is needed (no client
// secret), and no script from Google runs on the page.
// 1. GET /api/home?op=googleStart (a navigation): a fresh state and nonce go in a short-lived
//    cookie (SameSite=None, so it comes back with Google's cross-site POST), then 302 to Google.
// 2. Google POSTs id_token and state (form) to /api/home?op=google. The state must match the
//    cookie, and the token must be signed by Google (RS256, its published keys), for this
//    Client ID, unexpired, with the nonce from the cookie and a verified email.
// 3. The email must be someone's in the home (their member email, or HOMEOS_GOOGLE_PEOPLE's
//    "email=Name" for the household); then this browser gets a device like any sign-in (the
//    same 400-day cookie), and 303 back to the app. Anyone else: 303 to /?google=not_member.

import { createPublicKey, verify } from 'node:crypto';

/** What a verified Google ID token says about the person. */
export interface GoogleIdentity {
  email: string;
  name: string | null;
}

/** One of Google's signing keys (https://www.googleapis.com/oauth2/v3/certs). */
export interface GoogleJwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

/** Google's keys, by kid (cached; fetched again when a kid is new). */
export type GoogleKeys = (kid: string) => Promise<GoogleJwk | null>;

export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
/** Clock skew allowed on exp and iat. */
const SKEW_MS = 5 * 60_000;

/** A Client ID as Google shows it ("1234-abc.apps.googleusercontent.com"), else null. */
export function googleClientIdOf(value: string | undefined): string | null {
  const v = (value ?? '').trim();
  return /^[0-9A-Za-z_-]{6,200}\.apps\.googleusercontent\.com$/.test(v) ? v : null;
}

/**
 * HOMEOS_GOOGLE_PEOPLE: "stratis@gmail.com=Stratis; shea@gmail.com=Shea" (commas also work)
 * → email (lower case) → name. Entries that are not email=name are left out.
 */
export function googlePeopleOf(value: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (value ?? '').split(/[;,\n]/)) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const email = part.slice(0, at).trim().toLowerCase();
    const name = part.slice(at + 1).trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && name) out[email] = name;
  }
  return out;
}

/** Google's keys from GOOGLE_CERTS_URL, kept as long as its Cache-Control says (at least a minute, at most a day). */
export function fetchGoogleKeys(fetchFn: typeof fetch = fetch, now: () => number = Date.now): GoogleKeys {
  let cached: { keys: GoogleJwk[]; until: number } | null = null;
  const load = async (): Promise<GoogleJwk[]> => {
    const res = await fetchFn(GOOGLE_CERTS_URL);
    if (!res.ok) throw new Error(`google certs: ${res.status}`);
    const body = (await res.json()) as { keys?: GoogleJwk[] };
    const age = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '');
    const seconds = Math.min(Math.max(age ? Number(age[1]) : 3600, 60), 86_400);
    cached = { keys: Array.isArray(body.keys) ? body.keys : [], until: now() + seconds * 1000 };
    return cached.keys;
  };
  return async (kid) => {
    let keys = cached && cached.until > now() ? cached.keys : await load();
    let key = keys.find((k) => k.kid === kid) ?? null;
    if (!key && cached && cached.keys === keys) {
      // A key Google started using since the last fetch.
      keys = await load();
      key = keys.find((k) => k.kid === kid) ?? null;
    }
    return key;
  };
}

function part(segment: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The person `token` (a Google ID token) is about, when it is genuine and meant for this app:
 * RS256 by one of Google's keys, issuer Google, audience `clientId`, not expired, issued no
 * later than now, `nonce` as given, and a verified email. Null otherwise (never throws for a
 * bad token; a key fetch that fails rejects).
 */
export async function verifyGoogleIdToken(
  token: string,
  opts: { clientId: string; nonce: string; now: Date; keys: GoogleKeys },
): Promise<GoogleIdentity | null> {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  const [h, p, s] = segments;
  const header = part(h);
  const claims = part(p);
  if (!header || !claims || header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
  const jwk = await opts.keys(header.kid);
  if (!jwk || jwk.kty !== 'RSA') return null;
  let ok = false;
  try {
    const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
    ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`, 'utf8'), key, Buffer.from(s, 'base64url'));
  } catch {
    return null;
  }
  if (!ok) return null;
  const now = opts.now.getTime();
  const aud = claims.aud;
  const audOk = aud === opts.clientId || (Array.isArray(aud) && aud.includes(opts.clientId));
  if (!audOk || typeof claims.iss !== 'string' || !ISSUERS.has(claims.iss)) return null;
  if (typeof claims.exp !== 'number' || claims.exp * 1000 + SKEW_MS < now) return null;
  if (typeof claims.iat === 'number' && claims.iat * 1000 - SKEW_MS > now) return null;
  if (typeof opts.nonce !== 'string' || opts.nonce === '' || claims.nonce !== opts.nonce) return null;
  if (!(claims.email_verified === true || claims.email_verified === 'true')) return null;
  if (typeof claims.email !== 'string' || !claims.email.includes('@')) return null;
  return { email: claims.email.toLowerCase(), name: typeof claims.name === 'string' ? claims.name : null };
}

/** Google's sign-in page for this app (step 1). */
export function googleAuthUrl(opts: { clientId: string; redirectUri: string; state: string; nonce: string }): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('response_type', 'id_token');
  url.searchParams.set('response_mode', 'form_post');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', opts.state);
  url.searchParams.set('nonce', opts.nonce);
  return url.toString();
}
