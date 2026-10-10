// A shared link (`?item=<id>` or `?area=<id>`) opened in the app. It is taken out of the
// address bar as the app starts and kept on this device until the household has loaded,
// through sign-in (and the Google redirect) if need be, like an invite link.
import { parseSharedLink, type SharedLink } from './logic/share';

const KEY = 'homeos.link';
/** A link left waiting longer than this (never signed in) is forgotten. */
export const LINK_KEEP_MS = 60 * 60 * 1000;

/** The app's address, ending in `/`, that shared links start with. */
export function appBaseUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}

/** `search` without its `item` and `area` parameters; the others are left exactly as they were. */
export function withoutLinkParams(search: string): string {
  let removed = false;
  const kept = search
    .replace(/^\?/, '')
    .split('&')
    .filter((part) => {
      const key = part.split('=')[0].replace(/\+/g, ' ');
      let name = key;
      try {
        name = decodeURIComponent(key);
      } catch {
        /* not encoded properly: compare it as it is */
      }
      const link = name === 'item' || name === 'area';
      if (link) removed = true;
      return part && !link;
    });
  if (!removed) return search;
  return kept.length ? `?${kept.join('&')}` : '';
}

/** At startup: keeps a `?item=` or `?area=` from the address, and takes it out of the address bar. */
export function captureSharedLink(now: number = Date.now()): void {
  try {
    const { pathname, search, hash } = window.location;
    const rest = withoutLinkParams(search);
    if (rest === search) return;
    window.history.replaceState(window.history.state, '', pathname + rest + hash);
    const link = parseSharedLink(search);
    if (link) localStorage.setItem(KEY, JSON.stringify({ ...link, at: now }));
  } catch {
    /* storage blocked: the link is lost and the app opens as usual */
  }
}

/** The waiting link, if any; it is forgotten as it is taken. */
export function takeSharedLink(now: number = Date.now()): SharedLink | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return null;
    const { kind, id, at } = saved as Record<string, unknown>;
    if ((kind !== 'item' && kind !== 'area') || typeof id !== 'string' || !id) return null;
    if (typeof at !== 'number' || now - at > LINK_KEEP_MS || at > now + 60_000) return null;
    return { kind, id };
  } catch {
    return null;
  }
}

/** Signing out: a link opened on this device shouldn't follow the next person who signs in. */
export function forgetSharedLink(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
