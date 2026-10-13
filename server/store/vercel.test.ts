import { describe, expect, it } from 'vitest';
import { BlobConflictError, BlobUnavailableError } from './types';
import { VercelBlobStore, type VercelBlobSdk } from './vercel';

class BlobPreconditionFailedError extends Error {}
class BlobNotFoundError extends Error {}

/** @vercel/blob as far as the store uses it, over a map, recording every call. */
function fakeSdk(fail?: { put?: unknown; get?: unknown; head?: unknown }) {
  const blobs = new Map<string, { body: string; etag: string }>();
  const calls: { op: string; path: string; options: Record<string, unknown> }[] = [];
  let seq = 0;
  const sdk: VercelBlobSdk = {
    BlobPreconditionFailedError,
    BlobNotFoundError,
    async head(pathname) {
      calls.push({ op: 'head', path: pathname, options: {} });
      if (fail?.head) throw fail.head;
      const blob = blobs.get(pathname);
      if (!blob) throw new BlobNotFoundError();
      return { etag: blob.etag };
    },
    async get(pathname, options) {
      calls.push({ op: 'get', path: pathname, options });
      if (fail?.get) throw fail.get;
      const blob = blobs.get(pathname);
      if (!blob) return null;
      // As the CDN in front of the content answers: its own, weak ETag (it compresses), which
      // put's ifMatch never matches. Only head has the etag put checks.
      const cdnEtag = `W/${blob.etag}`;
      if (options.ifNoneMatch === cdnEtag) return { statusCode: 304, stream: null, blob: { etag: cdnEtag } };
      const bytes = new TextEncoder().encode(blob.body);
      // Two chunks, split inside a multi-byte character.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, 3));
          controller.enqueue(bytes.slice(3));
          controller.close();
        },
      });
      return { statusCode: 200, stream, blob: { etag: cdnEtag } };
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
    // Unchanged is told by head alone: no body is fetched.
    expect(calls.map((c) => c.op)).toEqual(['head', 'put', 'head', 'get', 'head', 'put']);
    const puts = calls.filter((c) => c.op === 'put').map((c) => c.options);
    expect(puts[0]).toEqual({ access: 'private', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60, allowOverwrite: false });
    expect(puts[1]).toEqual({ access: 'private', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60, allowOverwrite: true, ifMatch: etag });
  });

  it('writes after a read with the etag the Blob API checks, not the CDN’s own', async () => {
    const { sdk } = fakeSdk();
    const store = new VercelBlobStore(sdk);
    await store.put('h.json', 'v1', { create: true });
    // A fresh instance: it knows the home only from a read.
    const read = await store.get('h.json');
    expect(read).toMatchObject({ body: 'v1' });
    expect((read as { etag: string }).etag.startsWith('W/')).toBe(false);
    await expect(store.put('h.json', 'v2', { ifMatch: (read as { etag: string }).etag })).resolves.toMatchObject({ etag: expect.any(String) });
    expect(await store.get('h.json')).toMatchObject({ body: 'v2' });
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
    const store = new VercelBlobStore(fakeSdk({ put: cause, get: cause, head: cause }).sdk);
    await expect(store.get('h.json')).rejects.toBeInstanceOf(BlobUnavailableError);
    const err = await store.put('h.json', 'x', { ifMatch: '"e1"' }).catch((e) => e);
    expect(err).toBeInstanceOf(BlobUnavailableError);
    expect(err.cause).toBe(cause);
    await expect(store.put('h.json', 'x', { create: true })).rejects.toBeInstanceOf(BlobUnavailableError);
  });
});
