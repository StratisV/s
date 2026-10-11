// Server mode's links: `?setup=<setup code>` ("Bring this home online", sent once to whoever has
// the home in their browser) and `?code=<sign-in code>` (an IssuedCode.link). Like shared links
// (lib/sharedLink.ts): taken out of the address bar as the app starts (main.tsx, server mode
// only; other parameters left exactly as they were) and kept in localStorage until used.
// docs/ARCHITECTURE.md "Server mode (no setup)", "Screens". Every storage access in try/catch.

import { formatCode, normaliseCode } from './backend/serverApi';

/** The setup code from a ?setup= link: { code, at }. Forgotten after SETUP_LINK_KEEP_MS, once a home is online, or on sign-in. */
export const SETUP_LINK_KEY = 'homeos.setup';
/** The sign-in code from a ?code= link: { code, at }. Forgotten after CODE_LINK_KEEP_MS, when taken, and on sign-out. */
export const CODE_LINK_KEY = 'homeos.code';
export const SETUP_LINK_KEEP_MS = 24 * 60 * 60 * 1000;
export const CODE_LINK_KEEP_MS = 60 * 60 * 1000;

/** Longest code a link may carry (normalised); anything longer is not a code. */
const LINK_CODE_MAX = 40;

const PARAMS = { setup: SETUP_LINK_KEY, code: CODE_LINK_KEY } as const;
type Param = keyof typeof PARAMS;

function paramName(part: string): string {
  const key = part.split('=')[0].replace(/\+/g, ' ');
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

/** `search` without `setup` and `code`; the other parameters are left exactly as they were. */
export function withoutServerLinkParams(search: string): string {
  let removed = false;
  const kept = search
    .replace(/^\?/, '')
    .split('&')
    .filter((part) => {
      const link = paramName(part) in PARAMS;
      if (link) removed = true;
      return part && !link;
    });
  if (!removed) return search;
  return kept.length ? `?${kept.join('&')}` : '';
}

function keep(param: Param, value: string | null, now: number) {
  const code = normaliseCode(value ?? '');
  if (!code || code.length > LINK_CODE_MAX) return;
  localStorage.setItem(PARAMS[param], JSON.stringify({ code, at: now }));
}

/** At start-up (server mode): keeps `?setup=` and `?code=` (normalised) and takes them out of the address bar. */
export function captureServerLinks(now: number = Date.now()): void {
  try {
    const { pathname, search, hash } = window.location;
    const rest = withoutServerLinkParams(search);
    if (rest === search) return;
    window.history.replaceState(window.history.state, '', pathname + rest + hash);
    const params = new URLSearchParams(search);
    if (params.has('setup')) keep('setup', params.get('setup'), now);
    if (params.has('code')) keep('code', params.get('code'), now);
  } catch {
    /* storage blocked: the link is lost, and the code can still be typed */
  }
}

/** The stored code under `key`, formatted in groups, or null (none, unreadable, too old). */
function read(key: string, keepMs: number, now: number): string | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return null;
    const { code, at } = saved as Record<string, unknown>;
    if (typeof code !== 'string' || !code || typeof at !== 'number' || now - at > keepMs || at > now + 60_000) {
      localStorage.removeItem(key);
      return null;
    }
    return formatCode(normaliseCode(code));
  } catch {
    return null;
  }
}

/** The waiting setup code, or null. Read, not taken: it stays until forgetServerLinks('setup'). */
export function pendingSetupCode(now: number = Date.now()): string | null {
  return read(SETUP_LINK_KEY, SETUP_LINK_KEEP_MS, now);
}

/** The waiting sign-in code, or null; forgotten as it is taken (it is tried once). */
export function takeSignInCode(now: number = Date.now()): string | null {
  const code = read(CODE_LINK_KEY, CODE_LINK_KEEP_MS, now);
  forgetServerLinks('code');
  return code;
}

/** Forgets the waiting setup code, sign-in code, or both. */
export function forgetServerLinks(which: 'setup' | 'code' | 'both' = 'both'): void {
  try {
    if (which !== 'code') localStorage.removeItem(SETUP_LINK_KEY);
    if (which !== 'setup') localStorage.removeItem(CODE_LINK_KEY);
  } catch {
    /* storage unavailable */
  }
}
