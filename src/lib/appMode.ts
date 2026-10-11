// How this page runs, for server mode's sign-in (docs/ARCHITECTURE.md "Server mode (no setup)",
// "Screens"). On an iPhone, Safari and the home.os app on the Home Screen keep separate storage
// and sign-ins, and links from Messages always open in Safari (from WhatsApp or Instagram, in
// their own browser), so a ?code= or ?setup= link often opens where the person does not use
// home.os. Every check is wrapped: a missing API is "no".

import type { AppMode } from './backend/serverApi';

function ua(): string {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
  } catch {
    return '';
  }
}

/** Running as an installed app (the Home Screen app on iOS, an installed PWA elsewhere). */
export function isStandalone(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if ((window.navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
    return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

/** An iPhone, iPod or iPad (also an iPad that says it is a Mac, which has a touch screen). */
export function isIos(): boolean {
  const agent = ua();
  if (/\b(iPhone|iPod|iPad)\b/.test(agent)) return true;
  try {
    return /\bMacintosh\b/.test(agent) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;
  } catch {
    return false;
  }
}

/** A browser inside another app (Facebook, Instagram, WhatsApp, LINE, Snapchat, an Android web view…), with its own cookies. */
export function isInAppBrowser(): boolean {
  return /\b(FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|WhatsApp|Twitter|LinkedInApp|MicroMessenger|GSA\/)|; wv\)/.test(ua());
}

/**
 * A ?code= link opened here should not be used up by itself: Safari on iOS outside the Home
 * Screen app, or a browser inside another app. The person chooses: join here, or type the
 * code in home.os where they use it (codes work once).
 */
export function linkNeedsChoice(): boolean {
  return !isStandalone() && (isIos() || isInAppBrowser());
}

/** Sent with setup and redeem, so the device list can say "Home Screen app" (SetupRequest.app). */
export function appMode(): AppMode {
  return isStandalone() ? 'standalone' : 'browser';
}
