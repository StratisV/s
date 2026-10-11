// The home as this function instance knows it: a cached copy of the stored ServerDoc, one queue
// of writes, and the Blob budget. docs/ARCHITECTURE.md "Server mode (no setup)", "Storage",
// "Writes" and "Budget".
//
// Reads: from the cached copy when it was checked against the store within `maxAgeMs` (and is
// at least `minRev`), else get(path, { ifNoneMatch: cached etag }) first ('unchanged' just
// renews the check). Many concurrent reads share one store call. Writes made on this instance
// update the cache at once, so with one warm instance (the usual case for a household) every
// change is seen on the next poll; another instance's change is seen within `freshMs`.
//
// Writes: one queue per instance. When a put is not in flight, every write waiting is applied
// in order, each to the result of the one before, on one deep copy of the latest document (a
// write that throws is taken out again and rejects alone), and stored with ONE put
// { ifMatch: the copy's etag } (group commit). Nothing changed (the JSON is the same): no put.
// Before the put: rev + 1, chatRev + 1 when chatFingerprint() changed, meta.writes gets a fresh
// id, usage counted, pruneAuth(). On BlobConflictError: re-read the store and, unless its
// meta.writes holds this put's id (it landed after all), apply the batch again on what is
// there; WRITE_ATTEMPTS in all, then every write in the batch rejects 'busy'. So two people
// writing at once never lose a change: each write is applied to the latest document.
//
// SKELETON: not implemented yet.

import type { BlobStore } from '../store/types';
import type { ServerDoc } from './serverDoc';

/** Tries per batch before 'busy'. */
export const WRITE_ATTEMPTS = 5;

/**
 * What the Blob budget allows now (docs: "Budget"). Levels by this month's reads against the
 * read budget: under 60 %, 60 to 85 %, over 85 %.
 */
export interface Pressure {
  /** How long a cached copy counts as fresh for reads, auth and version polls: 10 s, 30 s, 120 s. */
  freshMs: number;
  /** What VersionResponse.pollMs tells browsers: 3 s, 6 s, 20 s. */
  pollMs: number;
  /** This month's puts reached the write budget: writes reject 'read_only' without a put. */
  readOnly: boolean;
}

export interface HomeStoreOptions {
  /** The blob's path (homeBlobPath(env)). */
  path: string;
  /** Clock (ms). Default Date.now. */
  now?: () => number;
  /**
   * Blob operations allowed per UTC month (HOMEOS_BLOB_WRITES_PER_MONTH, default 1900;
   * HOMEOS_BLOB_READS_PER_MONTH, default 9000; 0 = no limit, as on the Pro plan).
   */
  budget?: { writes: number; reads: number };
  /** Fresh random ids for meta.writes. Default crypto.randomUUID(). */
  newId?: () => string;
}

export interface HomeSnapshot {
  doc: ServerDoc;
  etag: string;
  /** When this copy was last checked against the store (ms). */
  checkedAt: number;
}

export class HomeStore {
  constructor(
    readonly blobs: BlobStore,
    readonly options: HomeStoreOptions,
  ) {}

  /**
   * The home, or null when none is online. `maxAgeMs` (default pressure().freshMs): how old
   * the last check may be. `minRev`: re-check the store when the cached rev is lower.
   * Throws BlobUnavailableError.
   */
  read(_opts?: { maxAgeMs?: number; minRev?: number }): Promise<HomeSnapshot | null> {
    throw new Error('HomeStore.read: not implemented yet');
  }

  /**
   * Queues `change` (see the top of this file): it gets a mutable copy of the latest document,
   * may be run more than once (after a conflict) and must depend on nothing but the document,
   * and resolves to its result once stored, with the rev it was stored as (the current rev
   * when nothing changed). Rejects with what `change` threw, BackendError('not_found') when no
   * home is online, ApiError 'busy' or 'read_only', or BlobUnavailableError.
   */
  write<T>(_change: (doc: ServerDoc) => T | Promise<T>): Promise<{ result: T; rev: number }> {
    throw new Error('HomeStore.write: not implemented yet');
  }

  /**
   * Stores a new home (setup) with put { create: true }. Rejects with
   * BackendError('home_exists') when there is one already (BlobConflictError).
   */
  create(_doc: ServerDoc): Promise<HomeSnapshot> {
    throw new Error('HomeStore.create: not implemented yet');
  }

  /** The budget's effect now (from the cached copy's meta.usage plus this instance's uncounted reads). */
  pressure(): Pressure {
    throw new Error('HomeStore.pressure: not implemented yet');
  }

  /** Dev and tests (POST /__homeos/reset): forget the cached copy and the counters. */
  reset(): void {
    throw new Error('HomeStore.reset: not implemented yet');
  }
}
