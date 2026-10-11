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

import { DEMO_STORAGE_KEY, DemoBackend, type DemoDoc, type StorageLike } from '../../src/lib/backend/demo';

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
  storage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ ...home, session: caller.userId, users: [user] }));
  const backend = new DemoBackend({ storage, user, now: opts.now, search: '', latency: 0 });
  const result = await op(backend);
  if (opts.kind === 'read') return { result, home: null };
  const raw = storage.getItem(DEMO_STORAGE_KEY);
  if (!raw) throw new Error('runAs: the home went missing');
  const after = JSON.parse(raw) as DemoDoc;
  after.session = null;
  after.users = [];
  return { result, home: after };
}
