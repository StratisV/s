import { describe, expect, it } from 'vitest';
import { MemoryBlobStore } from './memory';
import { BlobConflictError } from './types';

// The BlobStore contract, on the in-memory store the server's unit tests run on.
describe('MemoryBlobStore', () => {
  it('creates only where there is nothing yet', async () => {
    const store = new MemoryBlobStore();
    expect(await store.get('home.json')).toBeNull();
    const { etag } = await store.put('home.json', '{"a":1}', { create: true });
    expect(await store.get('home.json')).toEqual({ body: '{"a":1}', etag });
    await expect(store.put('home.json', '{"a":2}', { create: true })).rejects.toBeInstanceOf(BlobConflictError);
  });

  it('writes over only the version the writer read', async () => {
    const store = new MemoryBlobStore();
    const first = await store.put('home.json', 'v1', { create: true });
    const second = await store.put('home.json', 'v2', { ifMatch: first.etag });
    expect(second.etag).not.toBe(first.etag);
    await expect(store.put('home.json', 'v3', { ifMatch: first.etag })).rejects.toBeInstanceOf(BlobConflictError);
    expect(store.peek('home.json')?.body).toBe('v2');
  });

  it('says when a blob is unchanged, without its body', async () => {
    const store = new MemoryBlobStore();
    const { etag } = await store.put('home.json', 'v1', { create: true });
    expect(await store.get('home.json', { ifNoneMatch: etag })).toBe('unchanged');
    expect(await store.get('home.json', { ifNoneMatch: 'old' })).toEqual({ body: 'v1', etag });
    expect(store.calls).toEqual({ get: 2, put: 1 });
  });
});
