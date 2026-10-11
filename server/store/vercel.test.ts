import { describe, expect, it } from 'vitest';
import { BlobConflictError, BlobUnavailableError } from './types';
import { VercelBlobStore, type VercelBlobSdk } from './vercel';

class BlobPreconditionFailedError extends Error {}

/** @vercel/blob as far as the store uses it, over a map, recording every call. */
function fakeSdk(fail?: { put?: unknown; get?: unknown }) {
  const blobs = new Map<string, { body: string; etag: string }>();
  const calls: { op: string; path: string; options: Record<string, unknown> }[] = [];
  let seq = 0;
  const sdk: VercelBlobSdk = {
    BlobPreconditionFailedError,
    async get(pathname, options) {
      calls.push({ op: 'get', path: pathname, options });
      if (fail?.get) throw fail.get;
      const blob = blobs.get(pathname);
      if (!blob) return null;
      if (options.ifNoneMatch === blob.etag) return { statusCode: 304, stream: null, blob: { etag: blob.etag } };
      const bytes = new TextEncoder().encode(blob.body);
      // Two chunks, split inside a multi-byte character.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, 3));
          controller.enqueue(bytes.slice(3));
          controller.close();
        },
      });
      return { statusCode: 200, stream, blob: { etag: blob.etag } };
    },
    async put(pathname, body, options) {
      calls.push({ op: 'put', path: pathname, options });
      if (fail?.put) throw fail.put;
      const current = blobs.get(pathname);
      if (current && options.allowOverwrite === false) throw new Error('This blob already exists');
      if (options.ifMatch !== undefined && current?.etag !== options.ifMatch) throw new BlobPreconditionFailedError();
      const etag = `"e${++seq}"`;
      blobs.set(pathname, { body, etag });
      return { etag };
    },
  };
  return { sdk, blobs, calls };
}

describe('VercelBlobStore', () => {
  it('reads and writes a private blob, never from a cache', async () => {
    const { sdk, calls } = fakeSdk();
    const store = new VercelBlobStore(sdk);
    expect(await store.get('homeos/production/home.json')).toBeNull();
    const { etag } = await store.put('homeos/production/home.json', '{"name":"Café"}', { create: true });
    expect(await store.get('homeos/production/home.json')).toEqual({ body: '{"name":"Café"}', etag });
    expect(await store.get('homeos/production/home.json', { ifNoneMatch: etag })).toBe('unchanged');
    const next = await store.put('homeos/production/home.json', '{}', { ifMatch: etag });
    expect(next.etag).not.toBe(etag);
    expect(calls.filter((c) => c.op === 'get').every((c) => c.options.access === 'private' && c.options.useCache === false)).toBe(true);
    const puts = calls.filter((c) => c.op === 'put').map((c) => c.options);
    expect(puts[0]).toEqual({ access: 'private', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60, allowOverwrite: false });
    expect(puts[1]).toEqual({ access: 'private', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60, allowOverwrite: true, ifMatch: etag });
  });

  it('turns a failed precondition, or a blob already there, into a conflict', async () => {
    const { sdk } = fakeSdk();
    const store = new VercelBlobStore(sdk);
    const { etag } = await store.put('h.json', 'v1', { create: true });
    await store.put('h.json', 'v2', { ifMatch: etag });
    await expect(store.put('h.json', 'v3', { ifMatch: etag })).rejects.toBeInstanceOf(BlobConflictError);
    await expect(store.put('h.json', 'v3', { create: true })).rejects.toBeInstanceOf(BlobConflictError);
  });

  it('turns anything else into unavailable, keeping the cause', async () => {
    const cause = new Error('BlobServiceNotAvailable');
    const store = new VercelBlobStore(fakeSdk({ put: cause, get: cause }).sdk);
    await expect(store.get('h.json')).rejects.toBeInstanceOf(BlobUnavailableError);
    const err = await store.put('h.json', 'x', { ifMatch: '"e1"' }).catch((e) => e);
    expect(err).toBeInstanceOf(BlobUnavailableError);
    expect(err.cause).toBe(cause);
    await expect(store.put('h.json', 'x', { create: true })).rejects.toBeInstanceOf(BlobUnavailableError);
  });
});
