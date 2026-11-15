import { useSyncExternalStore } from 'react';
import type { IssueId, Route, TabId } from '../types';

/*
 * Where the app is lives in the address, '#/powerups?kid=abc&challenge=tantrums', so the back
 * button works and a tab can send the parent to something in another tab. The single-page
 * preview (README "Previews") runs inside a host page that owns the address, so there the
 * route is kept in memory instead.
 */

const IN_MEMORY = import.meta.env.MODE === 'single';

const TABS: TabId[] = ['meditate', 'powerups', 'family', 'weekly'];
const PARAMS = ['kid', 'challenge', 'powerup', 'issue', 'edit'] as const;

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const tab = (TABS as string[]).includes(path) ? (path as TabId) : 'meditate';
  const params = new URLSearchParams(query);
  const route: Route = { tab };
  for (const key of PARAMS) {
    const value = params.get(key);
    if (value) (route as unknown as Record<string, string>)[key] = value;
  }
  if (route.issue) route.issue = route.issue as IssueId;
  return route;
}

export function routeHash(route: Route): string {
  const params = new URLSearchParams();
  for (const key of PARAMS) {
    const value = route[key];
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return `#/${route.tab}${query ? `?${query}` : ''}`;
}

let current: Route =
  typeof window !== 'undefined' && !IN_MEMORY ? parseRoute(window.location.hash) : { tab: 'meditate' };
const listeners = new Set<() => void>();

function sync() {
  current = parseRoute(window.location.hash);
  listeners.forEach((listener) => listener());
}

if (typeof window !== 'undefined' && !IN_MEMORY) window.addEventListener('hashchange', sync);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getRoute = () => current;

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getRoute, getRoute);
}

/**
 * Goes somewhere. `replace` swaps the current history entry instead of adding one (for a filter
 * changing, where Back should not step through every tap).
 */
export function navigate(route: Route, { replace = false } = {}) {
  const hash = routeHash(route);
  if (IN_MEMORY) {
    if (hash === routeHash(current)) return;
    current = parseRoute(hash);
    listeners.forEach((listener) => listener());
    return;
  }
  if (hash === window.location.hash) return;
  if (replace) {
    window.history.replaceState(null, '', hash);
    sync();
  } else {
    window.location.hash = hash;
  }
}
