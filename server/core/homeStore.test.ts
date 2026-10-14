import { describe, expect, it } from 'vitest';
import { BackendError } from '../../src/lib/backend/types';
import { emptyDoc } from '../../src/lib/backend/demo';
import { MemoryBlobStore } from '../store/memory';
import { BlobConflictError, BlobUnavailableError, type BlobStore, type StoredBlob } from '../store/types';
import { ApiError } from './errors';
import { HomeStore, MAX_BATCH, MAX_DOC_BYTES, READ_FLUSH_AT, WRITE_ATTEMPTS, type HomeStoreOptions } from './homeStore';
import { newServerDoc, parseServerDoc, type ServerDoc } from './serverDoc';

const PATH = 'homeos/test/home.json';
const START = Date.parse('2026-10-09T11:00:00.000Z');

/** A home with a counter in its household name, so tests can count writes that landed. */
function seedDoc(): ServerDoc {
  const home = emptyDoc();
  home.households.push({
    id: 'h1',
    name: '0',
    address: '',
    timezone: 'Europe/London',
    weekly_email_day: 1,
    weekly_email_time: '08:00',
    created_at: new Date(START).toISOString(),
    updated_at: new Date(START).toISOString(),
    updated_by: null,
  });
  return newServerDoc(home, new Date(START));
}

function setUp(opts: Partial<HomeStoreOptions> = {}, blobs: MemoryBlobStore = new MemoryBlobStore()) {
  const clock = { now: START };
  const make = () => new HomeStore(blobs, { path: PATH, now: () => clock.now, ...opts });
  return { blobs, clock, a: make(), b: make(), make };
}

const bump = (doc: ServerDoc) => {
  const h = doc.home.households[0];
  h.name = String(Number(h.name) + 1);
  return h.name;
};
const stored = (blobs: MemoryBlobStore) => parseServerDoc(blobs.peek(PATH)!.body);

describe('HomeStore: reading', () => {
  it('has no home until one is created, and only one can be', async () => {
    const { a, b } = setUp();
    expect(await a.read()).toBeNull();
    const snap = await a.create(seedDoc());
    expect(snap.doc.rev).toBe(1);
    expect(snap.doc.meta.writes).toHaveLength(1);
    await expect(b.create(seedDoc())).rejects.toMatchObject({ code: 'home_exists' });
    expect((await b.read())!.doc.rev).toBe(1);
  });

  it('answers from its copy while it is fresh, then checks with an ETag', async () => {
    const { a, blobs, clock } = setUp();
    await a.create(seedDoc());
    const gets = blobs.calls.get;
    await a.read();
    await a.read();
    expect(blobs.calls.get).toBe(gets);
    clock.now += 10_001;
    await a.read();
    expect(blobs.calls.get).toBe(gets + 1);
    await a.read({ maxAgeMs: 0 });
    expect(blobs.calls.get).toBe(gets + 2);
  });

  it('shares one store call between reads that arrive together', async () => {
    const blobs = new MemoryBlobStore(5);
    const { a, b } = setUp({}, blobs);
    await b.create(seedDoc());
    const gets = blobs.calls.get;
    await Promise.all([a.read(), a.read(), a.read()]);
    expect(blobs.calls.get).toBe(gets + 1);
  });

  it('reads the store again for a caller who has seen a newer rev (minRev)', async () => {
    const { a, b, blobs } = setUp();
    await a.create(seedDoc());
    await b.read();
    await a.write(bump);
    expect((await b.read())!.doc.rev).toBe(1);
    const gets = blobs.calls.get;
    expect((await b.read({ minRev: 2 }))!.doc.rev).toBe(2);
    expect(blobs.calls.get).toBe(gets + 1);
    // A rev nobody stored (a store that was reset): what there is, without looping.
    expect((await b.read({ minRev: 99 }))!.doc.rev).toBe(2);
  });
});

describe('HomeStore: writing', () => {
  it('stores a change with the next rev, its id and its count, and is seen at once on this instance', async () => {
    const { a, blobs } = setUp();
    await a.create(seedDoc());
    const { result, rev } = await a.write(bump);
    expect(result).toBe('1');
    expect(rev).toBe(2);
    const doc = stored(blobs);
    expect(doc.rev).toBe(2);
    expect(doc.chatRev).toBe(1);
    expect(doc.meta.writes).toHaveLength(2);
    expect(doc.meta.usage).toMatchObject({ month: '2026-10', puts: 2 });
    expect((await a.read())!.doc.home.households[0].name).toBe('1');
  });

  it('counts a chat change in chatRev', async () => {
    const { a } = setUp();
    await a.create(seedDoc());
    await a.write((doc) => {
      doc.home.messages.push({ id: 'm1', household_id: 'h1', member_id: null, body: 'hi', created_at: new Date(START).toISOString() });
    });
    const doc = (await a.read())!.doc;
    expect(doc.rev).toBe(2);
    expect(doc.chatRev).toBe(2);
  });

  it('stores nothing when nothing changed', async () => {
    const { a, blobs } = setUp();
    await a.create(seedDoc());
    const puts = blobs.calls.put;
    const { result, rev } = await a.write((doc) => doc.home.households[0].name);
    expect(result).toBe('0');
    expect(rev).toBe(1);
    expect(blobs.calls.put).toBe(puts);
  });

  it('puts the writes that wait together in one put, each on the result of the one before', async () => {
    const { a, blobs } = setUp();
    await a.create(seedDoc());
    const puts = blobs.calls.put;
    const results = await Promise.all([a.write(bump), a.write(bump), a.write(bump)]);
    expect(results.map((r) => r.result)).toEqual(['1', '2', '3']);
    expect(new Set(results.map((r) => r.rev))).toEqual(new Set([2]));
    expect(blobs.calls.put).toBe(puts + 1);
    expect(stored(blobs).home.households[0].name).toBe('3');
  });

  it('takes a write that throws out of its batch: it fails alone', async () => {
    const { a, blobs } = setUp();
    await a.create(seedDoc());
    const [one, bad, two] = await Promise.allSettled([
      a.write(bump),
      a.write((doc) => {
        doc.home.households[0].name = 'broken';
        throw new BackendError('not_found');
      }),
      a.write(bump),
    ]);
    expect(one).toMatchObject({ status: 'fulfilled', value: { result: '1' } });
    expect(bad).toMatchObject({ status: 'rejected', reason: { code: 'not_found' } });
    expect(two).toMatchObject({ status: 'fulfilled', value: { result: '2' } });
    expect(stored(blobs).home.households[0].name).toBe('2');
  });

  it('never loses a change when two instances write at the same moment', async () => {
    // Each get and put takes a little while, so the two instances read the same version.
    const blobs = new MemoryBlobStore(3);
    const { a, b } = setUp({}, blobs);
    await a.create(seedDoc());
    await b.read();
    const results = await Promise.all([
      a.write((doc) => {
        doc.home.households[0].address = 'by A';
      }),
      b.write((doc) => {
        doc.home.households[0].timezone = 'Europe/Paris';
      }),
    ]);
    const doc = stored(blobs);
    expect(doc.home.households[0]).toMatchObject({ address: 'by A', timezone: 'Europe/Paris' });
    expect(doc.rev).toBe(3);
    expect(results.map((r) => r.rev).sort()).toEqual([2, 3]);
  });

  it('never loses a change with many writers on many instances', async () => {
    const blobs = new MemoryBlobStore(() => Math.floor(Math.random() * 3));
    const { make } = setUp({ sleep: async () => {} }, blobs);
    const instances = [make(), make(), make()];
    await instances[0].create(seedDoc());
    await Promise.all(instances.map((s) => s.read()));
    const writes = Array.from({ length: 24 }, (_, i) => instances[i % 3].write(bump));
    const settled = await Promise.allSettled(writes);
    const landed = settled.filter((s) => s.status === 'fulfilled').length;
    const busy = settled.filter((s) => s.status === 'rejected' && (s.reason as ApiError).code === 'busy').length;
    expect(landed + busy).toBe(24);
    expect(Number(stored(blobs).home.households[0].name)).toBe(landed);
    expect(landed).toBeGreaterThan(0);
  });

  it('tries a write that failed on a copy that was behind once more on the latest', async () => {
    const { a, b, clock } = setUp();
    await a.create(seedDoc());
    await b.read();
    // A adds an area; B's copy does not have it yet.
    await a.write((doc) => {
      doc.home.areas.push({ id: 'a1', household_id: 'h1', name: 'Garage', position: 0, created_at: new Date(START).toISOString() });
    });
    clock.now += 2000;
    const { result } = await b.write((doc) => {
      const area = doc.home.areas.find((x) => x.id === 'a1');
      if (!area) throw new BackendError('not_found');
      area.name = 'Shed';
      return area.name;
    });
    expect(result).toBe('Shed');
  });

  it('does not apply a batch twice when the store kept a put whose reply was lost', async () => {
    const blobs = new MemoryBlobStore();
    let lose = false;
    // The SDK retries a put whose reply never came: the retry finds the ETag moved on.
    const lossy: BlobStore = {
      get: (p, o) => blobs.get(p, o),
      async put(p, body, opts) {
        const r = await blobs.put(p, body, opts);
        if (lose) {
          lose = false;
          throw new BlobConflictError();
        }
        return r;
      },
    };
    const store = new HomeStore(lossy, { path: PATH, now: () => START });
    await store.create(seedDoc());
    lose = true;
    const { result, rev } = await store.write(bump);
    expect(result).toBe('1');
    expect(rev).toBe(2);
    expect(stored(blobs).home.households[0].name).toBe('1');
    expect(stored(blobs).rev).toBe(2);
  });

  it('when the store does not answer a put: done if it landed, else unavailable', async () => {
    const blobs = new MemoryBlobStore();
    let mode: 'ok' | 'landed' | 'lost' = 'ok';
    const flaky: BlobStore = {
      get: (p, o) => blobs.get(p, o),
      async put(p, body, opts) {
        if (mode === 'lost') throw new BlobUnavailableError();
        const r = await blobs.put(p, body, opts);
        if (mode === 'landed') throw new BlobUnavailableError();
        return r;
      },
    };
    const store = new HomeStore(flaky, { path: PATH, now: () => START });
    await store.create(seedDoc());
    mode = 'landed';
    expect((await store.write(bump)).result).toBe('1');
    mode = 'lost';
    await expect(store.write(bump)).rejects.toBeInstanceOf(BlobUnavailableError);
    mode = 'ok';
    expect((await store.write(bump)).result).toBe('2');
  });

  it(`gives up as 'busy' after ${WRITE_ATTEMPTS} conflicts in a row`, async () => {
    const blobs = new MemoryBlobStore();
    let puts = 0;
    const contested: BlobStore = {
      get: (p, o) => blobs.get(p, o),
      async put(p, body, opts) {
        if ('ifMatch' in opts) {
          puts += 1;
          // Someone else stores first, every time.
          const there = (await blobs.get(p)) as StoredBlob;
          const doc = parseServerDoc(there.body);
          doc.rev += 1;
          await blobs.put(p, JSON.stringify(doc), { ifMatch: there.etag });
          throw new BlobConflictError();
        }
        return blobs.put(p, body, opts);
      },
    };
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    const store = new HomeStore(contested, { path: PATH, now: () => START, sleep, random: () => 0.5 });
    await store.create(seedDoc());
    await expect(store.write(bump)).rejects.toMatchObject({ code: 'busy' });
    expect(puts).toBe(WRITE_ATTEMPTS);
    // Between attempts it waits a jittered while, longer each time (50 to 300 ms times the attempt).
    expect(waits).toEqual([175, 350, 525, 700, 875, 1050]);
  });

  it('waits a random while before trying again, so instances writing at once spread out', async () => {
    const waits: number[] = [];
    const { a, b, blobs } = setUp({ sleep: async (ms) => void waits.push(ms) }, new MemoryBlobStore(2));
    await a.create(seedDoc());
    await b.read();
    await Promise.all([a.write(bump), b.write(bump)]);
    expect(stored(blobs).home.households[0].name).toBe('2');
    expect(waits.length).toBeGreaterThan(0);
    for (const ms of waits) expect(ms).toBeGreaterThanOrEqual(50);
  });

  it('puts at most MAX_BATCH writes in one put', async () => {
    const { a, blobs } = setUp();
    await a.create(seedDoc());
    const puts = blobs.calls.put;
    const results = await Promise.all(Array.from({ length: MAX_BATCH * 2 + 1 }, () => a.write(bump)));
    expect(results.at(-1)!.result).toBe(String(MAX_BATCH * 2 + 1));
    expect(blobs.calls.put - puts).toBe(3);
  });

  it("keeps the rev for a 'meta' write (browsers do not reload for it); a 'data' write moves it on", async () => {
    const { a, blobs } = setUp();
    await a.create(seedDoc());
    const meta = await a.write(
      (doc) => {
        doc.meta.createdAt = doc.meta.createdAt;
        doc.auth.codes = [...doc.auth.codes];
        doc.auth.devices = [{ id: 'd1', keyHash: 'x', userId: 'u', label: 'x', createdAt: new Date(START).toISOString() }];
      },
      { kind: 'meta' },
    );
    expect(meta.rev).toBe(1);
    expect(stored(blobs).rev).toBe(1);
    expect((await a.write(bump)).rev).toBe(2);
  });

  it('rolls a pure write back without copying the home, and any other write from a copy', async () => {
    const { a, blobs } = setUp();
    await a.create(seedDoc());
    const [one, pureBad, inPlaceBad, two] = await Promise.allSettled([
      a.write(bump),
      a.write(
        (doc) => {
          doc.home = { ...doc.home, areas: [] };
          doc.auth.codes = [{ id: 'c', codeHash: 'h', memberId: 'm', createdBy: null, createdAt: '', expiresAt: '' }];
          throw new BackendError('not_found');
        },
        { pure: true },
      ),
      a.write((doc) => {
        doc.home.households[0].name = 'broken';
        throw new BackendError('not_found');
      }),
      a.write(bump),
    ]);
    expect([one.status, pureBad.status, inPlaceBad.status, two.status]).toEqual(['fulfilled', 'rejected', 'rejected', 'fulfilled']);
    expect(stored(blobs).home.households[0].name).toBe('2');
    expect(stored(blobs).auth.codes).toEqual([]);
  });

  it('rolls the notifications back with a pure write that fails, as it was (or missing)', async () => {
    const { a, blobs } = setUp();
    await a.create(seedDoc());
    const row = { memberId: 'm', weeklyStatus: true, housekeeping: false, reminders: false, list: [], sent: {} };
    const fail = (doc: ServerDoc) => {
      doc.notify = { people: [] };
      throw new BackendError('not_found');
    };
    const joined = {
      id: 'm',
      household_id: 'h1',
      user_id: 'u-m',
      name: 'M',
      email: '',
      emoji: '🦔',
      color: '#007AFF',
      role: 'owner' as const,
      weekly_email: false,
      push_enabled: false,
      created_at: new Date(START).toISOString(),
    };
    const [none, set, changed] = await Promise.allSettled([
      a.write(fail, { pure: true }),
      a.write(
        (doc) => {
          // (Choices are kept only for someone who has joined.)
          doc.home = { ...doc.home, members: [joined] };
          doc.notify = { people: [row] };
        },
        { pure: true },
      ),
      a.write(fail, { pure: true }),
    ]);
    expect([none.status, set.status, changed.status]).toEqual(['rejected', 'fulfilled', 'rejected']);
    expect(stored(blobs).notify).toEqual({ people: [row] });
  });

  it("refuses a body over MAX_DOC_BYTES ('too_large'), storing nothing", async () => {
    const { a, blobs } = setUp();
    await a.create(seedDoc());
    const puts = blobs.calls.put;
    await expect(
      a.write((doc) => {
        doc.home.households[0].address = 'x'.repeat(MAX_DOC_BYTES);
      }),
    ).rejects.toMatchObject({ code: 'too_large' });
    expect(blobs.calls.put).toBe(puts);
  });

  it("rejects 'not_found' when no home is online", async () => {
    const { a } = setUp();
    await expect(a.write(bump)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('HomeStore: the Blob budget', () => {
  it('raises freshness and the poll interval as reads near the budget, up to a ceiling', async () => {
    const { a, clock, blobs } = setUp({ budget: { writes: 1900, reads: 20 } });
    await a.create(seedDoc());
    expect(a.pressure()).toMatchObject({ freshMs: 10_000, pollMs: 3_000, recheckMs: 1_000, ceiling: false });
    for (let i = 0; i < 12; i++) await a.read({ maxAgeMs: 0 });
    expect(a.pressure()).toMatchObject({ freshMs: 30_000, pollMs: 6_000, recheckMs: 5_000, ceiling: false });
    for (let i = 0; i < 5; i++) await a.read({ maxAgeMs: 0 });
    expect(a.pressure()).toMatchObject({ freshMs: 120_000, pollMs: 20_000, recheckMs: 20_000, ceiling: false });
    // Reads are added to the stored count with the next put.
    await a.write(bump);
    expect(stored(blobs).meta.usage.reads).toBe(17);
    await a.read({ maxAgeMs: 0 });
    // 90 % of the budget: the ceiling. Browsers poll every minute, and nothing reads the store
    // any more (not even a caller who asks for a fresh copy or a newer rev) but a trusted
    // caller and a write that meets a conflict.
    expect(a.pressure()).toMatchObject({ pollMs: 60_000, ceiling: true });
    const gets = blobs.calls.get;
    clock.now += 3_600_000;
    await a.read({ maxAgeMs: 0 });
    await a.read({ minRev: 99 });
    expect(await a.recheck('member')).toBe('skipped');
    expect(await a.recheck('stranger')).toBe('skipped');
    expect(blobs.calls.get).toBe(gets);
    await a.read({ minRev: 99, trusted: true });
    expect(blobs.calls.get).toBeGreaterThan(gets);
    // A new month starts from nothing.
    clock.now = Date.parse('2026-11-01T00:00:00.000Z');
    expect(a.pressure()).toMatchObject({ freshMs: 10_000, pollMs: 3_000, readOnly: false, ceiling: false });
  });

  it('pauses saving at the write budget, without a put, and reading goes on', async () => {
    const { a, blobs, clock } = setUp({ budget: { writes: 3, reads: 0 } });
    await a.create(seedDoc());
    await a.write(bump);
    expect(a.pressure().readOnly).toBe(false);
    await a.write(bump);
    expect(a.pressure().readOnly).toBe(true);
    const puts = blobs.calls.put;
    await expect(a.write(bump)).rejects.toMatchObject({ code: 'read_only' });
    expect(blobs.calls.put).toBe(puts);
    // A write that changes nothing still answers.
    expect((await a.write((doc) => doc.rev)).result).toBe(3);
    expect((await a.read())!.doc.home.households[0].name).toBe('2');
    // Next month, saving works again.
    clock.now = Date.parse('2026-11-01T00:00:00.000Z');
    expect((await a.write(bump)).result).toBe('3');
  });

  it(`stores its own read count with a put of its own once ${READ_FLUSH_AT} reads have built up`, async () => {
    const { a, b, blobs } = setUp();
    await a.create(seedDoc());
    for (let i = 0; i < READ_FLUSH_AT; i++) await b.read({ maxAgeMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await b.read();
    const doc = stored(blobs);
    expect(doc.meta.usage.reads).toBe(READ_FLUSH_AT);
    expect(doc.rev).toBe(1);
  });

  it('has no limits with budgets of 0 (the Pro plan)', async () => {
    const { a } = setUp({ budget: { writes: 0, reads: 0 } });
    await a.create(seedDoc());
    for (let i = 0; i < 20; i++) await a.read({ maxAgeMs: 0 });
    for (let i = 0; i < 5; i++) await a.write(bump);
    expect(a.pressure()).toEqual({ freshMs: 10_000, pollMs: 3_000, recheckMs: 1_000, ceiling: false, readOnly: false });
  });

  it('forgets its copy and counters on reset', async () => {
    const { a, blobs } = setUp();
    await a.create(seedDoc());
    blobs.clear();
    expect((await a.read())!.doc.rev).toBe(1);
    a.reset();
    expect(await a.read()).toBeNull();
  });
});
