import { useSyncExternalStore } from 'react';
import type { IssueId, Kid, Parent, SavedState, SessionLog } from '../types';
import { newId } from './id';

/*
 * Everything the parent enters lives on this device only, in localStorage. Storage can be
 * missing or full (a private window, a locked-down browser): the app then keeps working from
 * memory for the visit.
 */

export const STORAGE_KEY = 'parent-powerup:v1';

/** How many finished sessions are kept (a year and more of daily practice). */
const MAX_SESSIONS = 800;

export function emptyState(): SavedState {
  return { version: 1, parent: { name: '', focus: [] }, kids: [], sessions: [], saved: [], welcomed: false };
}

const isString = (v: unknown): v is string => typeof v === 'string';
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isString) : []);

/** Reads saved data defensively: anything malformed falls back to its empty value. */
export function sanitize(raw: unknown): SavedState {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const parent = (r.parent && typeof r.parent === 'object' ? r.parent : {}) as Record<string, unknown>;
  const kids = Array.isArray(r.kids) ? r.kids : [];
  const sessions = Array.isArray(r.sessions) ? r.sessions : [];
  return {
    version: 1,
    parent: { name: isString(parent.name) ? parent.name : '', focus: strings(parent.focus) as IssueId[] },
    kids: kids
      .filter((k): k is Record<string, unknown> => !!k && typeof k === 'object')
      .filter((k) => isString(k.id) && isString(k.name) && isString(k.birth) && /^\d{4}-\d{2}$/.test(k.birth))
      .map((k) => ({
        id: k.id as string,
        name: k.name as string,
        birth: k.birth as string,
        avatar: isString(k.avatar) ? k.avatar : '🌟',
        colour: (isString(k.colour) ? k.colour : 'sun') as Kid['colour'],
        temperament: strings(k.temperament) as Kid['temperament'],
        interests: strings(k.interests) as Kid['interests'],
        focus: strings(k.focus) as Kid['focus'],
        notes: isString(k.notes) ? k.notes : '',
      })),
    sessions: sessions
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .filter((s) => isString(s.date) && isString(s.meditationId) && (s.mode === 'together' || s.mode === 'solo'))
      .map((s) => ({
        date: s.date as string,
        meditationId: s.meditationId as string,
        mode: s.mode as SessionLog['mode'],
        kidIds: strings(s.kidIds),
        ...(s.feeling === 1 || s.feeling === 2 || s.feeling === 3 ? { feeling: s.feeling } : {}),
      })),
    saved: strings(r.saved),
    welcomed: r.welcomed === true,
  };
}

function read(): SavedState {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : emptyState();
  } catch {
    return emptyState();
  }
}

function write(next: SavedState) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable or full: keep going from memory.
  }
}

let state: SavedState = read();
const listeners = new Set<() => void>();

function commit(next: SavedState) {
  state = next;
  write(state);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Another tab saved: pick it up.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    state = read();
    listeners.forEach((listener) => listener());
  });
}

export function getState(): SavedState {
  return state;
}

/** The saved state, kept current. */
export function useAppState(): SavedState {
  return useSyncExternalStore(subscribe, getState, getState);
}

export const actions = {
  setParent(patch: Partial<Parent>) {
    commit({ ...state, parent: { ...state.parent, ...patch } });
  },
  addKid(kid: Omit<Kid, 'id'>): Kid {
    const added = { ...kid, id: newId() };
    commit({ ...state, kids: [...state.kids, added] });
    return added;
  },
  updateKid(id: string, patch: Partial<Omit<Kid, 'id'>>) {
    commit({ ...state, kids: state.kids.map((kid) => (kid.id === id ? { ...kid, ...patch } : kid)) });
  },
  removeKid(id: string) {
    commit({
      ...state,
      kids: state.kids.filter((kid) => kid.id !== id),
      sessions: state.sessions.map((s) => ({ ...s, kidIds: s.kidIds.filter((k) => k !== id) })),
    });
  },
  logSession(log: SessionLog) {
    commit({ ...state, sessions: [...state.sessions, log].slice(-MAX_SESSIONS) });
  },
  /** Sets how the last session felt (the check-in after a meditation). */
  rateLastSession(feeling: 1 | 2 | 3) {
    if (!state.sessions.length) return;
    const sessions = state.sessions.slice();
    sessions[sessions.length - 1] = { ...sessions[sessions.length - 1], feeling };
    commit({ ...state, sessions });
  },
  toggleSaved(powerupId: string) {
    const saved = state.saved.includes(powerupId)
      ? state.saved.filter((id) => id !== powerupId)
      : [...state.saved, powerupId];
    commit({ ...state, saved });
  },
  setWelcomed() {
    commit({ ...state, welcomed: true });
  },
  /** Deletes everything saved on this device. */
  clearAll() {
    commit(emptyState());
  },
};

/** Tests: start from a given state. */
export function resetStore(next: SavedState = emptyState()) {
  commit(next);
}
