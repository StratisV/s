// The home as this function instance knows it: a cached copy of the stored ServerDoc, one queue
// of writes, and the Blob budget. docs/ARCHITECTURE.md "Server mode (no setup)", "Storage",
// "Writes" and "Budget".
//
// Reads: from the cached copy when it was checked against the store within `maxAgeMs`
// (default pressure().freshMs) and is at least `minRev`, else get(path, { ifNoneMatch: cached
// etag }) first ('unchanged' just renews the check). Many concurrent reads share one store call.
// Writes made on this instance update the cache at once, so with one warm instance (the usual
// case for a household) every change is seen on the next poll; another instance's change is
// seen within `freshMs`.
//
// Reads for any other reason than freshness are rechecks, and the budget gates them: a caller
// who has seen a newer rev (minRev), a write that failed on a copy that may be behind ('member':
// at most one per pressure().recheckMs), and a sign-in code or key this copy does not know
// ('stranger': at most one per STRANGER_RECHECK_MS and strangerRechecksPerDay() a day, since
// anyone can send those). A recheck that is not allowed answers from the copy (or shares a
// read already under way). Only a device token signed by this home ({ trusted: true }) or a
// write conflict reads past the gates.
//
// The budget (docs: "Budget"): reads this month (stored in meta.usage, plus this instance's
// not stored yet) against the read budget give the level: under 60 %, 60 to 85 %, 85 to 90 %,
// and from READ_CEILING (90 %) on, the ceiling, where the copy is never refreshed except for a
// trusted read or a write conflict, and browsers poll every 60 s. Reads not stored yet are
// stored with the next put, and once READ_FLUSH_AT of them have built up, by a put of their own
// (a 'meta' write: no new rev), so an instance that goes away loses few of them.
//
// Writes: one queue per instance. When a put is not in flight, up to MAX_BATCH writes waiting
// are applied in order, each to the result of the one before, on one copy of the latest
// document (a write that throws is rolled back: a `pure` write, one that replaces doc.home
// rather than editing it in place, as all of the handler's do, by putting back the home object
// it replaced and copies of auth and notify, which cost next to nothing; any other by a copy of the whole
// document taken before it), and stored with ONE put { ifMatch: the copy's etag } (group commit). Nothing changed (the JSON is the same):
// no put. Before the put: rev + 1 when a 'data' write changed something (a 'meta' write, such as
// marking a device used or storing the read count, keeps the rev, so browsers do not reload
// for it), meta.writes gets a fresh id, usage
// counted, pruneAuth(). A body over MAX_DOC_BYTES is refused ('too_large'). On
// BlobConflictError: re-read the store and, unless its meta.writes holds this put's id (it
// landed after all), wait a little (jittered, longer each time) and apply the batch again on
// what is there; WRITE_ATTEMPTS in all, then every write in the batch rejects 'busy'. So two
// people writing at once never lose a change: each write is applied to the latest document.
// A write that throws is rolled back out of the batch's document; its error stands when the
// batch is stored (or changes nothing), and it is tried again with the rest after a conflict or
// one recheck, since it may have failed only because this instance's copy was behind. A put
// that fails with BlobUnavailableError is checked the same way (re-read: did any of this
// batch's ids land?) and otherwise rejects the batch with that error.

import { randomUUID } from 'node:crypto';
import { BackendError } from '../../src/lib/backend/types';
import { BlobConflictError, BlobUnavailableError, type BlobStore } from '../store/types';
import { pruneAuth } from './auth';
import { DEFAULT_BUDGET } from './config';
import { ApiError } from './errors';
import { parseServerDoc, RECENT_WRITES, serialiseServerDoc, usageMonth, type ServerDoc } from './serverDoc';

/** Tries per batch before 'busy'. */
export const WRITE_ATTEMPTS = 7;
/** At most this many writes go into one put; the rest wait for the next. */
export const MAX_BATCH = 25;
/** The largest body stored (the home's own cap, HOME_MAX_BYTES in runAs.ts, plus room for auth and meta). */
export const MAX_DOC_BYTES = 5 * 1024 * 1024;
/** This instance's reads not stored yet: at this many, a put of their own stores them. */
export const READ_FLUSH_AT = 50;
/** The share of the read budget from which the instance reads only for trusted callers and its own writes. */
export const READ_CEILING = 0.9;
/** A recheck for a stranger (a code or key this copy does not know): at most one this often. */
export const STRANGER_RECHECK_MS = 60_000;

/**
 * What the Blob budget allows now (docs: "Budget"). Levels by this month's reads against the
 * read budget: under 60 %, 60 to 85 %, 85 % to READ_CEILING, and the ceiling.
 */
export interface Pressure {
  /** How long a cached copy counts as fresh for reads, auth and version polls: 10 s, 30 s, 120 s; at the ceiling, for good. */
  freshMs: number;
  /** What VersionResponse.pollMs tells browsers: 3 s, 6 s, 20 s, 60 s. */
  pollMs: number;
  /** The least time between rechecks for members (minRev, a failed write): 1 s, 5 s, 20 s; none at the ceiling. */
  recheckMs: number;
  /** READ_CEILING of the read budget is used: the store is read only for trusted callers and write conflicts. */
  ceiling: boolean;
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
  /** The wait between write attempts after a conflict. Default setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** 0 to 1, for the jitter. Default Math.random. */
  random?: () => number;
}

export interface HomeSnapshot {
  doc: ServerDoc;
  etag: string;
  /** When this copy was last checked against the store (ms). */
  checkedAt: number;
}

/** What a write is: 'data' changes the home or who is signed in (a new rev); 'meta' is bookkeeping (the same rev). */
export type WriteKind = 'data' | 'meta';

/** The pressure levels: [read share below which it applies, freshMs, pollMs, recheckMs]. */
const LEVELS = [
  { below: 0.6, freshMs: 10_000, pollMs: 3_000, recheckMs: 1_000 },
  { below: 0.85, freshMs: 30_000, pollMs: 6_000, recheckMs: 5_000 },
  { below: READ_CEILING, freshMs: 120_000, pollMs: 20_000, recheckMs: 20_000 },
  { below: Infinity, freshMs: Infinity, pollMs: 60_000, recheckMs: Infinity },
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
  kind: WriteKind;
  /** Replaces doc.home rather than editing it in place (see the top): rolled back without a copy of the home. */
  pure: boolean;
  /** The read-count put (stores even when nothing else changed). */
  flush?: boolean;
}

type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };

/** One try at a batch: what each write gave, and the document it made. */
interface Applied {
  outcomes: Outcome[];
  doc: ServerDoc;
  changed: boolean;
  /** A 'data' write succeeded (the rev goes up when something changed). */
  data: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class HomeStore {
  private cache: Cached | null = null;
  private refreshing: Promise<Cached> | null = null;
  /** Bumped by reset(): a refresh from before it never lands. */
  private generation = 0;
  private queue: Waiting[] = [];
  private pumping = false;
  /** Blob operations this instance made that the stored usage does not count yet (this month). */
  private uncounted = { month: '', reads: 0, puts: 0 };
  /** A home has been seen by this instance (it never goes away again: status answers from memory). */
  private seenHome = false;
  /** When each kind of recheck last read the store. */
  private lastRecheck = { member: -Infinity, stranger: -Infinity };
  /** Stranger rechecks today (UTC). */
  private strangerDay = { day: '', count: 0 };
  /** A read-count put is waiting or under way. */
  private flushQueued = false;

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

  private setCache(next: Cached) {
    this.cache = next;
    if (next.doc) this.seenHome = true;
  }

  /** Whether this instance has seen a home online (status needs no read then: a home never goes away). */
  knowsHome(): boolean {
    return this.seenHome;
  }

  /** When this instance's copy (of the home, or of there being none) was last checked against the store; null before any. */
  checkedAt(): number | null {
    return this.cache ? this.cache.checkedAt : null;
  }

  /**
   * The home, or null when none is online. `maxAgeMs` (default pressure().freshMs): how old
   * the last check may be. `minRev`: the caller has seen this rev; a copy behind it is
   * rechecked (gated, see the top). `trusted`: a device token signed by this home says the
   * store holds `minRev`: read until the copy is there, even at the ceiling.
   * Throws BlobUnavailableError. The document returned is shared: never change it.
   */
  async read(opts: { maxAgeMs?: number; minRev?: number; trusted?: boolean } = {}): Promise<HomeSnapshot | null> {
    return HomeStore.snapshot(await this.readCached(opts));
  }

  private async readCached(opts: { maxAgeMs?: number; minRev?: number; trusted?: boolean } = {}): Promise<Cached> {
    const p = this.pressure();
    const c = this.cache;
    // At the ceiling, only a trusted read (or a write conflict) goes to the store.
    if (c && p.ceiling && !opts.trusted) return c;
    const maxAge = opts.maxAgeMs ?? p.freshMs;
    const enough = (x: Cached) => opts.minRev === undefined || (x.doc?.rev ?? 0) >= opts.minRev;
    let fresh: Cached;
    if (c && this.clock() - c.checkedAt < maxAge) {
      if (enough(c)) return c;
      fresh = c;
    } else {
      fresh = await this.refresh();
    }
    if (enough(fresh)) return fresh;
    // Behind what the caller has seen.
    if (opts.trusted) {
      if (fresh === c) fresh = await this.refresh();
      // A refresh that was already under way may have started before that rev was stored: one more.
      if (!enough(fresh)) fresh = await this.refresh(true);
      return fresh;
    }
    return (await this.recheckCached('member')) ?? fresh;
  }

  /** Stranger rechecks allowed a day: a three-hundredth of the read budget, at least 10 (no limit without a budget). */
  private strangerRechecksPerDay(): number {
    const reads = this.budget().reads;
    return reads > 0 ? Math.max(10, Math.floor(reads / 300)) : Infinity;
  }

  /** One read now for a reason other than freshness, when the gate allows (see the top); else a read under way, or null. */
  private async recheckCached(kind: 'member' | 'stranger'): Promise<Cached | null> {
    const p = this.pressure();
    const now = this.clock();
    const gap = kind === 'member' ? p.recheckMs : Math.max(p.recheckMs, STRANGER_RECHECK_MS);
    let allowed = !p.ceiling && now - this.lastRecheck[kind] >= gap;
    if (allowed && kind === 'stranger') {
      const day = new Date(now).toISOString().slice(0, 10);
      if (this.strangerDay.day !== day) this.strangerDay = { day, count: 0 };
      allowed = this.strangerDay.count < this.strangerRechecksPerDay();
      if (allowed) this.strangerDay.count += 1;
    }
    if (!allowed) return this.refreshing ? this.refreshing : null;
    this.lastRecheck[kind] = now;
    return this.refresh(true);
  }

  /**
   * A copy read for this caller just now (or by a read under way), when the budget allows a
   * recheck of this kind (see the top); 'skipped' when it does not, so the caller can't tell
   * more than its copy says.
   */
  async recheck(kind: 'member' | 'stranger'): Promise<HomeSnapshot | null | 'skipped'> {
    const c = await this.recheckCached(kind);
    return c === null ? 'skipped' : HomeStore.snapshot(c);
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
      this.counts().reads += this.blobs.readCost ?? 1;
      const got = await this.blobs.get(this.options.path, prev?.etag ? { ifNoneMatch: prev.etag } : {});
      const at = this.clock();
      let next: Cached;
      if (got === 'unchanged') next = { ...(prev as Cached), checkedAt: at };
      else if (got === null) next = { doc: null, body: '', etag: null, checkedAt: at };
      else next = { doc: parseServerDoc(got.body), body: got.body, etag: got.etag, checkedAt: at };
      if (generation !== this.generation) return next;
      // A write on this instance landed meanwhile: it is at least as new as what this read saw.
      if (this.cache !== prev && this.cache) return this.cache;
      this.setCache(next);
      this.maybeFlush();
      return next;
    })();
    this.refreshing = run;
    const clear = () => {
      if (this.refreshing === run) this.refreshing = null;
    };
    run.then(clear, clear);
    return run;
  }

  /** READ_FLUSH_AT reads built up: a 'meta' put stores the count (see the top). */
  private maybeFlush() {
    if (this.flushQueued || !this.cache?.doc || this.counts().reads < READ_FLUSH_AT || this.pressure().readOnly) return;
    this.flushQueued = true;
    const done = () => {
      this.flushQueued = false;
    };
    this.queue.push({ change: () => undefined, resolve: done, reject: done, kind: 'meta', pure: true, flush: true });
    void this.pump();
  }

  /** After a put of ours: the cache is that document, unless a newer one is known already. */
  private stored(next: Cached) {
    const current = this.cache?.doc;
    if (current && next.doc && current.rev > next.doc.rev) return;
    this.setCache(next);
  }

  /**
   * Queues `change` (see the top of this file): it gets a mutable copy of the latest document,
   * may be run more than once (after a conflict) and must depend on nothing but the document,
   * and resolves to its result once stored, with the rev it was stored as (the current rev
   * when nothing changed). `kind` (default 'data'): see WriteKind. `pure` (default false): it
   * replaces doc.home and never edits it (or anything in it) in place, so rolling it back needs
   * no copy of the home. Rejects with what `change` threw, BackendError('not_found') when no
   * home is online, ApiError 'busy', 'read_only' or 'too_large', or BlobUnavailableError.
   */
  write<T>(
    change: (doc: ServerDoc) => T | Promise<T>,
    opts: { kind?: WriteKind; pure?: boolean } = {},
  ): Promise<{ result: T; rev: number }> {
    return new Promise<{ result: T; rev: number }>((resolve, reject) => {
      this.queue.push({ change, resolve: resolve as Waiting['resolve'], reject, kind: opts.kind ?? 'data', pure: opts.pure ?? false });
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
        const batch = this.queue.splice(0, MAX_BATCH);
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

  /**
   * Runs every write of `batch` in order on a copy of `base`. A write that throws is rolled
   * back (see the top): a pure one by putting back the home object it replaced and copies of
   * auth and notify taken before it (no copy of the whole home per write); any other from a copy of the
   * whole document taken before it (none needed for the first: that is `base`).
   */
  private async apply(batch: Waiting[], base: Cached & { doc: ServerDoc }): Promise<Applied> {
    const baseJson = base.body || serialiseServerDoc(base.doc);
    let doc = JSON.parse(baseJson) as ServerDoc;
    const outcomes: Outcome[] = [];
    let data = false;
    for (const [i, w] of batch.entries()) {
      const home = doc.home;
      const auth = w.pure ? JSON.stringify(doc.auth) : '';
      const notify = w.pure ? JSON.stringify(doc.notify ?? null) : '';
      const whole = !w.pure && i > 0 ? serialiseServerDoc(doc) : null;
      try {
        outcomes.push({ ok: true, value: await w.change(doc) });
        if (w.kind === 'data') data = true;
      } catch (error) {
        outcomes.push({ ok: false, error });
        if (w.pure) {
          doc.home = home;
          doc.auth = JSON.parse(auth) as ServerDoc['auth'];
          const before = JSON.parse(notify) as ServerDoc['notify'] | null;
          if (before) doc.notify = before;
          else delete doc.notify;
        } else {
          doc = JSON.parse(whole ?? baseJson) as ServerDoc;
        }
      }
    }
    return { outcomes, doc, changed: serialiseServerDoc(doc) !== baseJson, data };
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
  private prepare(doc: ServerDoc, base: ServerDoc, writeId: string, bump: boolean): { reads: number; puts: number } {
    const now = new Date(this.clock());
    const month = usageMonth(now);
    doc.rev = bump ? base.rev + 1 : base.rev;
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

  /** The wait before attempt `attempt` + 1 after a conflict: 50 to 300 ms times `attempt`. */
  private pause(attempt: number): Promise<void> {
    const ms = Math.round((50 + (this.options.random ?? Math.random)() * 250) * attempt);
    return (this.options.sleep ?? defaultSleep)(ms);
  }

  private async commit(batch: Waiting[]) {
    /** Every put this batch sent: its id → what that try gave and the document it stored. */
    const tries = new Map<string, Applied>();
    const landed = (doc: ServerDoc | null) => doc?.meta.writes.find((id) => tries.has(id));
    // The first try goes on this instance's copy when it is fresh enough; a conflict corrects it.
    let base: Cached = await this.readCached();
    /** One recheck of a failed write was made (or is not needed: `base` came from the store during this batch). */
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
      if (!verified && applied.outcomes.some((o) => !o.ok)) {
        verified = true;
        const fresh = await this.recheckCached('member').catch(() => null);
        if (fresh && fresh.etag !== current.etag) {
          base = fresh;
          continue;
        }
      }
      attempts += 1;
      const flush = batch.some((w) => w.flush) && this.counts().reads > 0;
      if (!applied.changed && !flush) {
        HomeStore.settle(batch, applied.outcomes, current.doc.rev);
        return;
      }
      if (this.pressure().readOnly) {
        HomeStore.settle(batch, applied.outcomes, current.doc.rev, new ApiError('read_only', 'Saving is paused until next month'));
        return;
      }
      const writeId = this.newId();
      const counted = this.prepare(applied.doc, current.doc, writeId, applied.data && applied.changed);
      const body = serialiseServerDoc(applied.doc);
      if (body.length > MAX_DOC_BYTES) {
        HomeStore.settle(batch, applied.outcomes, current.doc.rev, new ApiError('too_large', 'The home is full'));
        return;
      }
      tries.set(writeId, applied);
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
        // Several instances writing at once: let them go first for a moment.
        if (attempts < WRITE_ATTEMPTS) await this.pause(attempts);
      }
    }
    for (const w of batch) w.reject(new ApiError('busy', 'The home is busy; try again'));
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
      this.setCache(next);
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
    const at = LEVELS.findIndex((l) => share < l.below);
    const level = LEVELS[at < 0 ? LEVELS.length - 1 : at];
    return {
      freshMs: level.freshMs,
      pollMs: level.pollMs,
      recheckMs: level.recheckMs,
      ceiling: level.below === Infinity,
      readOnly: budget.writes > 0 && puts >= budget.writes,
    };
  }

  /** Dev and tests (POST /__homeos/reset): forget the cached copy and the counters. */
  reset(): void {
    this.generation += 1;
    this.cache = null;
    this.refreshing = null;
    this.seenHome = false;
    this.uncounted = { month: '', reads: 0, puts: 0 };
    this.lastRecheck = { member: -Infinity, stranger: -Infinity };
    this.strangerDay = { day: '', count: 0 };
    this.flushQueued = false;
  }
}
