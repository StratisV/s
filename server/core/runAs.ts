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
// SKELETON: not implemented yet.

import type { DemoBackend, DemoDoc } from '../../src/lib/backend/demo';

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

/** `home` after a write (session null, users []), or null after a read. */
export function runAs<T>(
  _home: DemoDoc,
  _caller: Caller,
  _op: (backend: DemoBackend) => Promise<T>,
  _opts: RunOptions,
): Promise<{ result: T; home: DemoDoc | null }> {
  throw new Error('runAs: not implemented yet');
}
