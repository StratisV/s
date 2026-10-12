// Test support (never bundled): the server's handler over a MemoryBlobStore with a clock the
// test controls, and "browsers" that talk to it through a fetch with their own cookie jar, the
// way a phone talks to /api/home. Used by server/**/*.test.ts, server/client.test.ts and the
// HomeProvider server-mode tests.

import { randomBytes, randomUUID } from 'node:crypto';
import { API_HEADER, API_HEADER_VALUE, API_PATH, KEY_COOKIE } from '../../src/lib/backend/serverApi';
import { configFromEnv } from '../core/config';
import { handleApi, type ApiRequest, type ApiResponse, type ServerContext } from '../core/handler';
import { HomeStore } from '../core/homeStore';
import { AttemptLimiter, DEFAULT_KEY_MISS_LIMITS, type AttemptLimits } from '../core/limits';
import { homeBlobPath } from '../core/serverDoc';
import { MemoryBlobStore } from '../store/memory';
import type { BlobStore } from '../store/types';

/** The setup code the tests use (as HOMEOS_SETUP_CODE). */
export const TEST_SETUP_CODE = 'TEST-SETU-PCDE';
/** Fri 9 Oct 2026, midday in London: the user's home fixture's "today". */
export const TEST_START = Date.parse('2026-10-09T11:00:00.000Z');

export const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

export interface HarnessOptions {
  /** Default: a test clock starting at TEST_START (see Harness.clock). */
  now?: () => number;
  env?: Record<string, string | undefined>;
  attempts?: AttemptLimits;
  blobs?: BlobStore;
  secureCookies?: boolean;
  /** HomeStore's wait between write attempts (default: real time). */
  sleep?: (ms: number) => Promise<void>;
  /** Google's signing keys, for Continue with Google (default: none, so it answers 'failed'). */
  googleKeys?: import('../core/google').GoogleKeys;
}

export interface TestClock {
  now: number;
  advance(ms: number): void;
}

export interface Browser {
  /** A fetch for ServerBackend: same origin, cookies kept like a browser keeps them. */
  fetch: typeof fetch;
  /** The device key the cookie holds now (tests only; the app never sees it). */
  key(): string | null;
  /** Every response body this browser got (to check that no secret ever leaks). */
  bodies: string[];
  /** While true, requests fail like a phone without a connection. */
  offline: boolean;
  ip: string;
}

export interface Harness {
  ctx: ServerContext;
  blobs: BlobStore;
  clock: TestClock;
  /** Another function instance over the same Blob store (its own cache, queue and limiter). */
  instance(): ServerContext;
  browser(opts?: { ip?: string; userAgent?: string; ctx?: ServerContext }): Browser;
  /** One raw request (header names lower case), with X-HomeOS unless `headers` says otherwise. */
  request(req: Partial<ApiRequest> & { method: string; url?: string; json?: unknown }, ctx?: ServerContext): Promise<ApiResponse>;
}

export function createHarness(opts: HarnessOptions = {}): Harness {
  const clock: TestClock = {
    now: TEST_START,
    advance(ms) {
      this.now += ms;
    },
  };
  const now = opts.now ?? (() => clock.now);
  const env = { HOMEOS_SETUP_CODE: TEST_SETUP_CODE, VERCEL_ENV: 'test', ...opts.env };
  const blobs = opts.blobs ?? new MemoryBlobStore();
  const makeContext = (): ServerContext => {
    const config = { ...configFromEnv(env), secureCookies: opts.secureCookies ?? true };
    if (opts.attempts) config.attempts = { ...opts.attempts };
    return {
      config,
      store: new HomeStore(blobs, { path: homeBlobPath(env), budget: config.budget, now, sleep: opts.sleep }),
      limiter: new AttemptLimiter(config.attempts, now),
      keyMisses: new AttemptLimiter(DEFAULT_KEY_MISS_LIMITS, now),
      deps: { now: () => new Date(now()), randomBytes: (n) => new Uint8Array(randomBytes(n)), newId: () => randomUUID() },
      googleKeys: opts.googleKeys,
    };
  };
  const ctx = makeContext();

  const request: Harness['request'] = (req, target = ctx) => {
    const headers: Record<string, string | undefined> = { [API_HEADER.toLowerCase()]: API_HEADER_VALUE, ...req.headers };
    let body = req.body ?? '';
    if (req.json !== undefined) {
      body = JSON.stringify(req.json);
      headers['content-type'] ??= 'application/json';
    }
    return handleApi({ method: req.method, url: req.url ?? API_PATH, headers, body, ip: req.ip ?? '10.0.0.1' }, target);
  };

  let ips = 0;
  const browser: Harness['browser'] = (b = {}) => {
    const jar = new Map<string, string>();
    const target = b.ctx ?? ctx;
    const me: Browser = {
      bodies: [],
      offline: false,
      ip: b.ip ?? `10.0.1.${++ips}`,
      key: () => jar.get(KEY_COOKIE) ?? null,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (me.offline) throw new TypeError('Failed to fetch');
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
        const headers: Record<string, string | undefined> = {};
        new Headers(init?.headers).forEach((value, name) => {
          headers[name.toLowerCase()] = value;
        });
        headers['user-agent'] = b.userAgent ?? IPHONE_SAFARI;
        // Path=/api: the cookie goes with API requests only.
        if (url.pathname.startsWith('/api') && jar.size) {
          headers.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
        }
        const response = await handleApi(
          {
            method: init?.method ?? 'GET',
            url: url.pathname + url.search,
            headers,
            body: typeof init?.body === 'string' ? init.body : '',
            ip: me.ip,
          },
          target,
        );
        me.bodies.push(response.body);
        const out = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          for (const v of Array.isArray(value) ? value : [value]) {
            if (name.toLowerCase() === 'set-cookie') {
              const [pair, ...attrs] = v.split(';');
              const eq = pair.indexOf('=');
              const cookieName = pair.slice(0, eq).trim();
              const cookieValue = pair.slice(eq + 1).trim();
              const gone = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
              if (gone || !cookieValue) jar.delete(cookieName);
              else jar.set(cookieName, cookieValue);
            } else {
              out.append(name, v);
            }
          }
        }
        return new Response(response.body, { status: response.status, headers: out });
      }) as typeof fetch,
    };
    return me;
  };

  return { ctx, blobs, clock, instance: makeContext, browser, request };
}
