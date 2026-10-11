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
// A write that throws is rolled back out of the batch's document; its error stands when the
// batch is stored (or changes nothing), and it is tried again with the rest after a conflict,
// since it may have failed only because this instance's copy was behind. A put that fails
// with BlobUnavailableError is checked the same way (re-read: did any of this batch's ids
// land?) and otherwise rejects the batch with that error.

import { randomUUID } from 'node:crypto';
import { BackendError } from '../../src/lib/backend/types';
import { BlobConflictError, BlobUnavailableError, type BlobStore } from '../store/types';
import { pruneAuth } from './auth';
import { DEFAULT_BUDGET } from './config';
import { ApiError } from './errors';
import { chatFingerprint, parseServerDoc, RECENT_WRITES, serialiseServerDoc, usageMonth, type ServerDoc } from './serverDoc';

/** Tries per batch before 'busy'. */
export const WRITE_ATTEMPTS = 5;
/** A write that fails on a copy checked longer ago than this is tried again on a fresh one. */
export const RECHECK_MS = 1000;

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

/** The pressure levels: [read share below which it applies, freshMs, pollMs]. */
const LEVELS = [
  { below: 0.6, freshMs: 10_000, pollMs: 3_000 },
  { below: 0.85, freshMs: 30_000, pollMs: 6_000 },
  { below: Infinity, freshMs: 120_000, pollMs: 20_000 },
] as const;

/** What this instance knows of the store: the document (null: no home online) as of `checkedAt`. */
interface Cached {
  doc: ServerDoc | null;
  /** The body as stored ('' when there is none). */
  body: string;
  etag: string | null;
  checkedAt: number;
}

interface Waiting {
  change: (doc: ServerDoc) => unknown;
  resolve: (value: { result: unknown; rev: number }) => void;
  reject: (err: unknown) => void;
}

type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };

/** One try at a batch: what each write gave, and the document it made. */
interface Applied {
  outcomes: Outcome[];
  doc: ServerDoc;
  changed: boolean;
}

export class HomeStore {
  private cache: Cached | null = null;
  private refreshing: Promise<Cached> | null = null;
  /** Bumped by reset(): a refresh from before it never lands. */
  private generation = 0;
  private queue: Waiting[] = [];
  private pumping = false;
  /** Blob operations this instance made that the stored usage does not count yet (this month). */
  private uncounted = { month: '', reads: 0, puts: 0 };

  constructor(
    readonly blobs: BlobStore,
    readonly options: HomeStoreOptions,
  ) {}

  private clock(): number {
    return (this.options.now ?? Date.now)();
  }

  private newId(): string {
    return (this.options.newId ?? randomUUID)();
  }

  private budget(): { writes: number; reads: number } {
    return this.options.budget ?? DEFAULT_BUDGET;
  }

  /** This month's uncounted operations (a new month starts from nothing). */
  private counts(): { month: string; reads: number; puts: number } {
    const month = usageMonth(new Date(this.clock()));
    if (this.uncounted.month !== month) this.uncounted = { month, reads: 0, puts: 0 };
    return this.uncounted;
  }

  private static snapshot(c: Cached): HomeSnapshot | null {
    return c.doc ? { doc: c.doc, etag: c.etag ?? '', checkedAt: c.checkedAt } : null;
  }

  /**
   * The home, or null when none is online. `maxAgeMs` (default pressure().freshMs): how old
   * the last check may be. `minRev`: re-check the store when the cached rev is lower.
   * Throws BlobUnavailableError. The document returned is shared: never change it.
   */
  async read(opts: { maxAgeMs?: number; minRev?: number } = {}): Promise<HomeSnapshot | null> {
    return HomeStore.snapshot(await this.readCached(opts));
  }

  private async readCached(opts: { maxAgeMs?: number; minRev?: number } = {}): Promise<Cached> {
    const maxAge = opts.maxAgeMs ?? this.pressure().freshMs;
    const enough = (c: Cached) => opts.minRev === undefined || (c.doc?.rev ?? 0) >= opts.minRev;
    const c = this.cache;
    if (c && this.clock() - c.checkedAt < maxAge && enough(c)) return c;
    let fresh = await this.refresh();
    // A refresh that was already under way may have started before the caller's rev was
    // stored: one more, started now. Still lower after that (a store that was reset): as it is.
    if (!enough(fresh)) fresh = await this.refresh(true);
    return fresh;
  }

  /** One get (shared by everyone asking meanwhile); `force`: one that starts after any under way. */
  private async refresh(force = false): Promise<Cached> {
    if (this.refreshing) {
      if (!force) return this.refreshing;
      await this.refreshing.catch(() => {});
      if (this.refreshing) return this.refreshing;
    }
    const generation = this.generation;
    const prev = this.cache;
    const run = (async (): Promise<Cached> => {
      this.counts().reads += 1;
      const got = await this.blobs.get(this.options.path, prev?.etag ? { ifNoneMatch: prev.etag } : {});
      const at = this.clock();
      let next: Cached;
      if (got === 'unchanged') next = { ...(prev as Cached), checkedAt: at };
      else if (got === null) next = { doc: null, body: '', etag: null, checkedAt: at };
      else next = { doc: parseServerDoc(got.body), body: got.body, etag: got.etag, checkedAt: at };
      if (generation !== this.generation) return next;
      // A write on this instance landed meanwhile: it is at least as new as what this read saw.
      if (this.cache !== prev && this.cache) return this.cache;
      this.cache = next;
      return next;
    })();
    this.refreshing = run;
    const clear = () => {
      if (this.refreshing === run) this.refreshing = null;
    };
    run.then(clear, clear);
    return run;
  }

  /** After a put of ours: the cache is that document, unless a newer one is known already. */
  private stored(next: Cached) {
    const current = this.cache?.doc;
    if (current && next.doc && current.rev > next.doc.rev) return;
    this.cache = next;
  }

  /**
   * Queues `change` (see the top of this file): it gets a mutable copy of the latest document,
   * may be run more than once (after a conflict) and must depend on nothing but the document,
   * and resolves to its result once stored, with the rev it was stored as (the current rev
   * when nothing changed). Rejects with what `change` threw, BackendError('not_found') when no
   * home is online, ApiError 'busy' or 'read_only', or BlobUnavailableError.
   */
  write<T>(change: (doc: ServerDoc) => T | Promise<T>): Promise<{ result: T; rev: number }> {
    return new Promise<{ result: T; rev: number }>((resolve, reject) => {
      this.queue.push({ change, resolve: resolve as Waiting['resolve'], reject });
      void this.pump();
    });
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      // Writes queued in the same tick share the first put too.
      await Promise.resolve();
      while (this.queue.length) {
        const batch = this.queue.splice(0);
        try {
          await this.commit(batch);
        } catch (err) {
          for (const w of batch) w.reject(err);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Runs every write of `batch` in order on a copy of `base`; a write that throws is rolled back. */
  private async apply(batch: Waiting[], base: Cached & { doc: ServerDoc }): Promise<Applied> {
    const baseJson = serialiseServerDoc(base.doc);
    let doc = JSON.parse(baseJson) as ServerDoc;
    const outcomes: Outcome[] = [];
    for (const w of batch) {
      const before = batch.length > 1 ? serialiseServerDoc(doc) : null;
      try {
        outcomes.push({ ok: true, value: await w.change(doc) });
      } catch (error) {
        outcomes.push({ ok: false, error });
        doc = before === null ? (JSON.parse(baseJson) as ServerDoc) : (JSON.parse(before) as ServerDoc);
      }
    }
    return { outcomes, doc, changed: serialiseServerDoc(doc) !== baseJson };
  }

  private static settle(batch: Waiting[], outcomes: Outcome[], rev: number, failAll?: unknown) {
    batch.forEach((w, i) => {
      const o = outcomes[i];
      if (!o.ok) w.reject(o.error);
      else if (failAll !== undefined) w.reject(failAll);
      else w.resolve({ result: o.value, rev });
    });
  }

  /** The put's bookkeeping (see the top of this file). Returns the operations it counts. */
  private prepare(doc: ServerDoc, base: ServerDoc, writeId: string): { reads: number; puts: number } {
    const now = new Date(this.clock());
    const month = usageMonth(now);
    doc.rev = base.rev + 1;
    if (chatFingerprint(doc.home) !== chatFingerprint(base.home)) doc.chatRev = base.chatRev + 1;
    pruneAuth(doc, now);
    doc.meta.writes = [...doc.meta.writes, writeId].slice(-RECENT_WRITES);
    const pending = this.counts();
    const counted = { reads: pending.reads, puts: pending.puts + 1 };
    const usage = doc.meta.usage.month === month ? doc.meta.usage : { month, puts: 0, reads: 0 };
    doc.meta.usage = { month, puts: usage.puts + counted.puts, reads: usage.reads + counted.reads };
    return counted;
  }

  /** A put of ours landed: what it counted is in the stored usage now. */
  private counted(counted: { reads: number; puts: number }) {
    const pending = this.counts();
    pending.reads = Math.max(0, pending.reads - counted.reads);
    pending.puts = Math.max(0, pending.puts - counted.puts);
  }

  private async commit(batch: Waiting[]) {
    /** Every put this batch sent: its id → what that try gave and the document it stored. */
    const tries = new Map<string, Applied>();
    const landed = (doc: ServerDoc | null) => doc?.meta.writes.find((id) => tries.has(id));
    // The first try goes on this instance's copy when it is fresh enough; a conflict corrects it.
    let base: Cached = await this.readCached();
    /** `base` came from the store during this batch (not only from the cache). */
    let verified = false;
    let attempts = 0;
    while (attempts < WRITE_ATTEMPTS) {
      if (!base.doc) {
        for (const w of batch) w.reject(new BackendError('not_found', 'No home is online'));
        return;
      }
      const current = base as Cached & { doc: ServerDoc };
      const applied = await this.apply(batch, current);
      // A write that failed on a copy that may be behind (a code, a person or an item made on
      // another instance a moment ago) is tried once more on what the store holds now.
      if (!verified && applied.outcomes.some((o) => !o.ok) && this.mayRecheck(current)) {
        verified = true;
        const fresh = await this.refresh(true).catch(() => null);
        if (fresh && fresh.etag !== current.etag) {
          base = fresh;
          continue;
        }
      }
      attempts += 1;
      if (!applied.changed) {
        HomeStore.settle(batch, applied.outcomes, current.doc.rev);
        return;
      }
      if (this.pressure().readOnly) {
        HomeStore.settle(batch, applied.outcomes, current.doc.rev, new ApiError('read_only', 'Saving is paused until next month'));
        return;
      }
      const writeId = this.newId();
      const counted = this.prepare(applied.doc, current.doc, writeId);
      tries.set(writeId, applied);
      const body = serialiseServerDoc(applied.doc);
      this.counts().puts += 1;
      try {
        const { etag } = await this.blobs.put(this.options.path, body, { ifMatch: current.etag ?? '' });
        this.counted(counted);
        this.stored({ doc: applied.doc, body, etag, checkedAt: this.clock() });
        HomeStore.settle(batch, applied.outcomes, applied.doc.rev);
        return;
      } catch (err) {
        if (!(err instanceof BlobConflictError) && !(err instanceof BlobUnavailableError)) throw err;
        // Someone else stored first, or the store did not answer: what is there now? A put of
        // this batch whose reply was lost (the SDK retried it) counts as stored.
        let fresh: Cached;
        try {
          fresh = await this.refresh(true);
        } catch (readErr) {
          throw err instanceof BlobUnavailableError ? err : readErr;
        }
        const id = landed(fresh.doc);
        if (id) {
          const won = tries.get(id)!;
          HomeStore.settle(batch, won.outcomes, won.doc.rev);
          return;
        }
        if (err instanceof BlobUnavailableError) throw err;
        base = fresh;
        verified = true;
      }
    }
    for (const w of batch) w.reject(new ApiError('busy', 'The home is busy; try again'));
  }

  /**
   * Whether a failed write is worth a fresh read: the copy was checked more than RECHECK_MS
   * ago and reads are not under budget pressure (a wrong code never costs more than that).
   */
  private mayRecheck(copy: Cached): boolean {
    return this.clock() - copy.checkedAt > RECHECK_MS && this.pressure().freshMs <= LEVELS[0].freshMs;
  }

  /**
   * Stores a new home (setup) with put { create: true }. Rejects with
   * BackendError('home_exists') when there is one already (BlobConflictError).
   */
  async create(doc: ServerDoc): Promise<HomeSnapshot> {
    const writeId = this.newId();
    const fresh = JSON.parse(serialiseServerDoc(doc)) as ServerDoc;
    fresh.meta.writes = [...fresh.meta.writes, writeId].slice(-RECENT_WRITES);
    const month = usageMonth(new Date(this.clock()));
    const pending = this.counts();
    const counted = { reads: pending.reads, puts: pending.puts + 1 };
    fresh.meta.usage = { month, puts: counted.puts, reads: counted.reads };
    const body = serialiseServerDoc(fresh);
    pending.puts += 1;
    try {
      const { etag } = await this.blobs.put(this.options.path, body, { create: true });
      this.counted(counted);
      const next: Cached = { doc: fresh, body, etag, checkedAt: this.clock() };
      this.cache = next;
      return HomeStore.snapshot(next)!;
    } catch (err) {
      if (!(err instanceof BlobConflictError) && !(err instanceof BlobUnavailableError)) throw err;
      // Ours after all (a lost reply the SDK retried)? Else someone else's home is there.
      let there: Cached | null = null;
      try {
        there = await this.refresh(true);
      } catch {
        if (err instanceof BlobUnavailableError) throw err;
      }
      if (there?.doc?.meta.writes.includes(writeId)) return HomeStore.snapshot(there)!;
      if (err instanceof BlobUnavailableError && !there?.doc) throw err;
      throw new BackendError('home_exists');
    }
  }

  /** The budget's effect now (from the cached copy's meta.usage plus this instance's uncounted reads). */
  pressure(): Pressure {
    const pending = this.counts();
    const usage = this.cache?.doc?.meta.usage;
    const stored = usage && usage.month === pending.month ? usage : { reads: 0, puts: 0 };
    const reads = stored.reads + pending.reads;
    const puts = stored.puts + pending.puts;
    const budget = this.budget();
    const share = budget.reads > 0 ? reads / budget.reads : 0;
    const level = LEVELS.find((l) => share < l.below) ?? LEVELS[LEVELS.length - 1];
    return { freshMs: level.freshMs, pollMs: level.pollMs, readOnly: budget.writes > 0 && puts >= budget.writes };
  }

  /** Dev and tests (POST /__homeos/reset): forget the cached copy and the counters. */
  reset(): void {
    this.generation += 1;
    this.cache = null;
    this.refreshing = null;
    this.uncounted = { month: '', reads: 0, puts: 0 };
  }
}
