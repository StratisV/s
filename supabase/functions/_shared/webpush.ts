// Web Push with VAPID, using only WebCrypto (Deno and Node 22 both have it as
// globalThis.crypto), so the Edge Function needs no npm web-push package.
//
// - VAPID (RFC 8292): an ES256 JWT signed with the application server's key pair, sent as
//   `Authorization: vapid t=<jwt>, k=<public key>`.
// - Payload encryption (RFC 8291 + RFC 8188, "aes128gcm"): ECDH between a fresh key pair and
//   the browser's p256dh key, HKDF with the browser's auth secret, one AES-128-GCM record.
//
// Keys use the standard web-push format (what `npx web-push generate-vapid-keys` prints):
// base64url, public = 65-byte uncompressed P-256 point, private = 32-byte scalar.
//
// Endpoints are stored by users, so sendWebPush only contacts the browser push services in
// DEFAULT_PUSH_HOSTS, over https, without following redirects, and with a time limit.

import { REQUEST_TIMEOUT_MS, requestSignal } from './http.ts';

type Bytes = Uint8Array<ArrayBuffer>;

export interface VapidKeys {
  /** base64url, 65-byte uncompressed P-256 point. */
  publicKey: string;
  /** base64url, 32-byte private scalar. */
  privateKey: string;
  /** "mailto:you@example.com" or an https URL. */
  subject: string;
}

export interface PushSubscriptionKeys {
  endpoint: string;
  /** The browser's public key (base64url, 65 bytes). */
  p256dh: string;
  /** The browser's auth secret (base64url, 16 bytes). */
  auth: string;
}

export interface WebPushResult {
  status: number;
  ok: boolean;
  /**
   * 404 or 410: the subscription no longer exists and should be deleted. Also true (with
   * status 0) for an endpoint that is not a known push service, which is never contacted.
   */
  gone: boolean;
  /** The push service's response text when it refused (for logs). */
  detail?: string;
}

export interface SendOptions {
  /** Seconds the push service keeps the message for an offline device. Default one day. */
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  /** For tests. */
  now?: Date;
  /** Push service hosts that may be contacted. Default DEFAULT_PUSH_HOSTS. */
  allowedHosts?: readonly string[];
  /** Time limit for the request in ms. Default REQUEST_TIMEOUT_MS (10 s). */
  timeoutMs?: number;
  /** Aborts the request early (the scheduler passes its run deadline). */
  signal?: AbortSignal;
}

/**
 * The browser push services: the hosts of the endpoints that PushManager.subscribe() hands
 * out. "*.example.com" matches any subdomain of example.com.
 */
export const DEFAULT_PUSH_HOSTS: readonly string[] = [
  // Chrome and other Chromium browsers (Android, Opera, Samsung Internet, Brave, Vivaldi).
  'fcm.googleapis.com',
  // Firefox (autopush).
  'updates.push.services.mozilla.com',
  // Safari on macOS, iOS and iPadOS (Apple asks servers to allow *.push.apple.com).
  'web.push.apple.com',
  '*.push.apple.com',
  // Edge on Windows (Windows Push Notification Services).
  '*.notify.windows.com',
];

/**
 * True for an https URL on the default port, without credentials, whose host is one of
 * `hosts`. Anything else is never contacted.
 */
export function isAllowedPushEndpoint(endpoint: string, hosts: readonly string[] = DEFAULT_PUSH_HOSTS): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return false;
  const host = url.hostname.toLowerCase();
  return hosts.some((entry) => {
    const pattern = entry.trim().toLowerCase();
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      return host.length > suffix.length && host.endsWith(suffix);
    }
    return host === pattern;
  });
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Record size written into the aes128gcm header (one record holds the whole payload). */
const RECORD_SIZE = 4096;
/** Push services accept at least 4096 bytes of encrypted body (RFC 8030). */
const MAX_BODY = 4096;
const HEADER_LENGTH = 16 + 4 + 1 + 65;
const TAG_LENGTH = 16;
/** Largest plaintext that fits: body limit minus header, padding delimiter and GCM tag. */
export const MAX_PAYLOAD_BYTES = MAX_BODY - HEADER_LENGTH - 1 - TAG_LENGTH;
const JWT_LIFETIME_SECONDS = 12 * 60 * 60;

const encoder = new TextEncoder();

// ── base64url ───────────────────────────────────────────────────────────────

export function base64UrlEncode(bytes: Uint8Array): string {
  let raw = '';
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Accepts base64url or standard base64, with or without padding. */
export function base64UrlDecode(value: string): Bytes {
  const base64 = value.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const raw = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// ── VAPID ───────────────────────────────────────────────────────────────────

/** A fresh VAPID key pair in the web-push format. */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: base64UrlEncode(publicKey), privateKey: jwk.d as string };
}

function uncompressedPoint(publicKey: string, what: string): Bytes {
  const point = base64UrlDecode(publicKey);
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new Error(`${what} must be a 65-byte uncompressed P-256 point (base64url)`);
  }
  return point;
}

async function importVapidPrivateKey(keys: Pick<VapidKeys, 'publicKey' | 'privateKey'>): Promise<CryptoKey> {
  const point = uncompressedPoint(keys.publicKey, 'VAPID_PUBLIC_KEY');
  let d = base64UrlDecode(keys.privateKey);
  if (d.length < 32) d = concat(new Uint8Array(32 - d.length), d); // leading zeros dropped
  if (d.length !== 32) throw new Error('VAPID_PRIVATE_KEY must be a 32-byte P-256 scalar (base64url)');
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: base64UrlEncode(point.slice(1, 33)),
    y: base64UrlEncode(point.slice(33, 65)),
    d: base64UrlEncode(d),
    ext: false,
  };
  return await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** The VAPID JWT for one push service (aud = the endpoint's origin), valid for 12 hours. */
export async function vapidJwt(endpoint: string, vapid: VapidKeys, now: Date = new Date()): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const claims = {
    aud: new URL(endpoint).origin,
    exp: Math.floor(now.getTime() / 1000) + JWT_LIFETIME_SECONDS,
    sub: vapid.subject,
  };
  const unsigned = `${base64UrlEncode(encoder.encode(JSON.stringify(header)))}.${base64UrlEncode(
    encoder.encode(JSON.stringify(claims)),
  )}`;
  const key = await importVapidPrivateKey(vapid);
  // WebCrypto returns the raw r || s signature (64 bytes), which is exactly what JWS ES256 uses.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned)),
  );
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

/** The Authorization header value: `vapid t=<jwt>, k=<public key>`. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, now?: Date): Promise<string> {
  const jwt = await vapidJwt(endpoint, vapid, now);
  return `vapid t=${jwt}, k=${base64UrlEncode(uncompressedPoint(vapid.publicKey, 'VAPID_PUBLIC_KEY'))}`;
}

// ── Payload encryption (RFC 8291) ───────────────────────────────────────────

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

export interface EncryptOptions {
  /** For tests: a fixed 16-byte salt instead of a random one. */
  salt?: Uint8Array;
}

/**
 * Encrypts `payload` for one browser subscription. Returns the full aes128gcm body:
 * salt (16) | record size (4) | key id length (1) | sender public key (65) | ciphertext.
 */
export async function encryptPayload(
  payload: string | Uint8Array,
  subscription: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>,
  options: EncryptOptions = {},
): Promise<Bytes> {
  const plaintext = typeof payload === 'string' ? encoder.encode(payload) : concat(payload);
  if (plaintext.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`push payload is ${plaintext.length} bytes; the limit is ${MAX_PAYLOAD_BYTES}`);
  }
  const uaPublic = uncompressedPoint(subscription.p256dh, 'p256dh');
  const authSecret = base64UrlDecode(subscription.auth);
  if (authSecret.length !== 16) throw new Error('auth must be a 16-byte secret (base64url)');

  // A fresh ECDH key pair for every message.
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256),
  );

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = options.salt ? concat(options.salt) : crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new Error('salt must be 16 bytes');
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  // A single (last) record: plaintext followed by the 0x02 padding delimiter.
  const record = concat(plaintext, new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: TAG_LENGTH * 8 }, aesKey, record),
  );

  const header = new Uint8Array(HEADER_LENGTH);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE, false);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

// ── Sending ─────────────────────────────────────────────────────────────────

/**
 * Encrypts and sends one push message. Never throws for HTTP errors (the result says what
 * happened); throws for bad keys, a network failure, the time limit or an abort.
 *
 * An endpoint that is not on the allowlist (see isAllowedPushEndpoint) is not contacted and
 * comes back as gone, so the caller deletes the subscription. Redirects are not followed.
 */
export async function sendWebPush(
  subscription: PushSubscriptionKeys,
  payload: string,
  vapid: VapidKeys,
  fetchImpl: FetchLike = fetch,
  options: SendOptions = {},
): Promise<WebPushResult> {
  if (!isAllowedPushEndpoint(subscription.endpoint, options.allowedHosts)) {
    return { status: 0, ok: false, gone: true, detail: 'endpoint is not a known push service' };
  }
  const body = await encryptPayload(payload, subscription);
  const authorization = await vapidAuthorization(subscription.endpoint, vapid, options.now);
  const res = await fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: {
      TTL: String(options.ttl ?? 86_400),
      Urgency: options.urgency ?? 'normal',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: authorization,
    },
    body,
    redirect: 'manual',
    signal: requestSignal(options.timeoutMs ?? REQUEST_TIMEOUT_MS, options.signal),
  });
  let detail: string | undefined;
  try {
    const text = await res.text();
    if (!res.ok && text) detail = text.slice(0, 300);
  } catch {
    /* body already consumed or unreadable */
  }
  return { status: res.status, ok: res.ok, gone: res.status === 404 || res.status === 410, detail };
}
