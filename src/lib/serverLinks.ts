// Server mode's links: `?setup=<setup code>` ("Bring this home online", sent once to whoever has
// the home in their browser) and `?code=<sign-in code>` (an IssuedCode.link). Like shared links
// (lib/sharedLink.ts): taken out of the address bar as the app starts (main.tsx, server mode
// only; other parameters left exactly as they were) and kept in localStorage until used.
// docs/ARCHITECTURE.md "Server mode (no setup)", "Screens". Every storage access in try/catch.
//
// SKELETON: not implemented yet (and not called from main.tsx yet).

/** The setup code from a ?setup= link: { code, at }. Forgotten after SETUP_LINK_KEEP_MS, once a home is online, or on sign-in. */
export const SETUP_LINK_KEY = 'homeos.setup';
/** The sign-in code from a ?code= link: { code, at }. Forgotten after CODE_LINK_KEEP_MS, when taken, and on sign-out. */
export const CODE_LINK_KEY = 'homeos.code';
export const SETUP_LINK_KEEP_MS = 24 * 60 * 60 * 1000;
export const CODE_LINK_KEEP_MS = 60 * 60 * 1000;

/** At start-up (server mode): keeps `?setup=` and `?code=` (normalised) and takes them out of the address bar. */
export function captureServerLinks(_now: number = Date.now()): void {
  throw new Error('captureServerLinks: not implemented yet');
}

/** The waiting setup code, or null. Read, not taken: it stays until forgetServerLinks('setup'). */
export function pendingSetupCode(_now: number = Date.now()): string | null {
  throw new Error('pendingSetupCode: not implemented yet');
}

/** The waiting sign-in code, or null; forgotten as it is taken (it is tried once). */
export function takeSignInCode(_now: number = Date.now()): string | null {
  throw new Error('takeSignInCode: not implemented yet');
}

/** Forgets the waiting setup code, sign-in code, or both. */
export function forgetServerLinks(_which: 'setup' | 'code' | 'both' = 'both'): void {
  throw new Error('forgetServerLinks: not implemented yet');
}
