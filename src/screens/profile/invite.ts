import { APP_NAME } from '../../lib/constants';

export const INVITE_TITLE = `Join our home on ${APP_NAME}`;

// Invites are reusable for 14 days, so one link is kept for the session and
// shared again on the next tap (which also lets the share sheet open straight
// from the tap, as Safari wants).
const REUSE_MS = 12 * 24 * 60 * 60 * 1000;
let cached: { householdId: string; token: string; at: number } | null = null;

export function cachedInvite(householdId: string): string | null {
  if (cached && cached.householdId === householdId && Date.now() - cached.at < REUSE_MS) return cached.token;
  return null;
}

export function rememberInvite(householdId: string, token: string): void {
  cached = { householdId, token, at: Date.now() };
}

export function inviteUrl(token: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}?invite=${encodeURIComponent(token)}`;
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/** The system share sheet where there is one, otherwise the clipboard. */
export async function shareLink(url: string, title: string): Promise<ShareOutcome> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // NotAllowedError (the tap no longer counts) and others: try the clipboard.
    }
  }
  return (await copyText(url)) ? 'copied' : 'failed';
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  // Plain-http origins (a phone on the dev server) have no Clipboard API.
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    Object.assign(area.style, { position: 'fixed', top: '0', left: '0', opacity: '0', fontSize: '16px' });
    const previous = document.activeElement as HTMLElement | null;
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    area.remove();
    previous?.focus?.({ preventScroll: true });
    return ok;
  } catch {
    return false;
  }
}
