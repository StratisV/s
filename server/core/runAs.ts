// Runs one DemoBackend method on the server's copy of the home, as the signed-in person. This
// is how the server reuses the demo backend's data rules (validation, limits, one-home people,
// housekeeping, chat) instead of keeping a second copy of them. docs/ARCHITECTURE.md "Server
// mode (no setup)", "Reusing DemoBackend".
//
// For each call: a fresh in-memory StorageLike holding JSON.stringify({ ...home, session:
// caller.userId, users: [{ id: caller.userId, email: '', name: caller.name }] }) under
// DEMO_STORAGE_KEY; new DemoBackend({ storage, user: that user, now, search: '', latency: 0 });
// await op(backend). For a write, the document is read back from the storage afterwards and
// `session` set to null and `users` to [] again before it is returned: the per-call session
// never reaches the stored home. When the op throws, nothing is read back (DemoBackend only
// stores a document when its change succeeded) and the error is rethrown as it was
// (BackendError for the rules, which the handler maps to the wire).
//
// Server-only limits on top, for a write: the home may not grow past HOME_MAX_BYTES (as JSON)
// or past HOME_ROW_LIMITS rows in a list (ApiError 'too_large', "The home is full"), so one
// signed-in browser can't make every read, poll and write of the home slow. A write that
// keeps the home within them, or makes it smaller, is never refused.

import { DEMO_STORAGE_KEY, DemoBackend, type DemoDoc, type StorageLike } from '../../src/lib/backend/demo';
import { ApiError } from './errors';

/** The largest the home may grow to (JSON characters). About 16,000 chat messages fit. */
export const HOME_MAX_BYTES = 4 * 1024 * 1024;

/** The most rows a list may grow to. */
export const HOME_ROW_LIMITS = {
  members: 50,
  areas: 200,
  items: 2000,
  messages: 20_000,
  message_reactions: 50_000,
  housekeeping_tasks: 200,
  housekeeping_visits: 3000,
  /** HOUSEKEEPING_SECTIONS_MAX: DemoBackend refuses a 31st section itself; this is the server's cap. */
  housekeeping_sections: 30,
} as const satisfies Partial<Record<keyof DemoDoc, number>>;

/** Refuses `after` when it grew past a limit (see the top); `beforeSize` is the home's JSON size before. */
function checkLimits(before: DemoDoc, after: DemoDoc, beforeSize: number, afterSize: number) {
  if (afterSize > HOME_MAX_BYTES && afterSize > beforeSize) throw new ApiError('too_large', 'The home is full');
  for (const [key, limit] of Object.entries(HOME_ROW_LIMITS) as [keyof typeof HOME_ROW_LIMITS, number][]) {
    const now = (after[key] as unknown[] | undefined)?.length ?? 0;
    const was = (before[key] as unknown[] | undefined)?.length ?? 0;
    if (now > limit && now > was) throw new ApiError('too_large', 'The home is full');
  }
}

export interface Caller {
  /** members[].user_id */
  userId: string;
  memberId: string;
  /** For AuthUser.name. */
  name: string;
}

export interface RunOptions {
  now: () => Date;
  /** 'write': return the home as the call left it (or the same object when it threw). 'read': never read it back. */
  kind: 'read' | 'write';
}

/** One call's storage: the home as JSON under DEMO_STORAGE_KEY, nothing else. */
class CallStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

/** `home` after a write (session null, users []), or null after a read. */
export async function runAs<T>(
  home: DemoDoc,
  caller: Caller,
  op: (backend: DemoBackend) => Promise<T>,
  opts: RunOptions,
): Promise<{ result: T; home: DemoDoc | null }> {
  const user = { id: caller.userId, email: '', name: caller.name };
  const storage = new CallStorage();
  const start = JSON.stringify({ ...home, session: caller.userId, users: [user] });
  storage.setItem(DEMO_STORAGE_KEY, start);
  const backend = new DemoBackend({ storage, user, now: opts.now, search: '', latency: 0 });
  const result = await op(backend);
  if (opts.kind === 'read') return { result, home: null };
  const raw = storage.getItem(DEMO_STORAGE_KEY);
  if (!raw) throw new Error('runAs: the home went missing');
  const after = JSON.parse(raw) as DemoDoc;
  checkLimits(home, after, start.length, raw.length);
  after.session = null;
  after.users = [];
  return { result, home: after };
}
