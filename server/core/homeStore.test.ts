import { describe, expect, it } from 'vitest';
import { BackendError } from '../../src/lib/backend/types';
import { emptyDoc } from '../../src/lib/backend/demo';
import { MemoryBlobStore } from '../store/memory';
import { BlobConflictError, BlobUnavailableError, type BlobStore, type StoredBlob } from '../store/types';
import { ApiError } from './errors';
import { HomeStore, WRITE_ATTEMPTS, type HomeStoreOptions } from './homeStore';
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
    const { make } = setUp({}, blobs);
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
    const store = new HomeStore(contested, { path: PATH, now: () => START });
    await store.create(seedDoc());
    await expect(store.write(bump)).rejects.toMatchObject({ code: 'busy' });
    expect(puts).toBe(WRITE_ATTEMPTS);
  });

  it("rejects 'not_found' when no home is online", async () => {
    const { a } = setUp();
    await expect(a.write(bump)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('HomeStore: the Blob budget', () => {
  it('raises freshness and the poll interval as reads near the budget', async () => {
    const { a, clock } = setUp({ budget: { writes: 1900, reads: 10 } });
    await a.create(seedDoc());
    expect(a.pressure()).toMatchObject({ freshMs: 10_000, pollMs: 3_000 });
    for (let i = 0; i < 6; i++) await a.read({ maxAgeMs: 0 });
    expect(a.pressure()).toMatchObject({ freshMs: 30_000, pollMs: 6_000 });
    for (let i = 0; i < 3; i++) await a.read({ maxAgeMs: 0 });
    expect(a.pressure()).toMatchObject({ freshMs: 120_000, pollMs: 20_000 });
    // Reads are added to the stored count with the next put.
    await a.write(bump);
    expect((await a.read())!.doc.meta.usage.reads).toBe(9);
    // A new month starts from nothing.
    clock.now = Date.parse('2026-11-01T00:00:00.000Z');
    expect(a.pressure()).toMatchObject({ freshMs: 10_000, pollMs: 3_000, readOnly: false });
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

  it('has no limits with budgets of 0 (the Pro plan)', async () => {
    const { a } = setUp({ budget: { writes: 0, reads: 0 } });
    await a.create(seedDoc());
    for (let i = 0; i < 20; i++) await a.read({ maxAgeMs: 0 });
    for (let i = 0; i < 5; i++) await a.write(bump);
    expect(a.pressure()).toEqual({ freshMs: 10_000, pollMs: 3_000, readOnly: false });
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
