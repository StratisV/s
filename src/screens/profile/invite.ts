import { APP_NAME } from '../../lib/constants';
import { shareOrCopy, type ShareOutcome } from '../../lib/shareSheet';

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

/** The system share sheet where there is one, otherwise the clipboard. */
export function shareLink(url: string, title: string): Promise<ShareOutcome> {
  return shareOrCopy({ title, url }, url);
}
