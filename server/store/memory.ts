// BlobStore in memory, for unit tests: ETags are "m1", "m2"… (a new one on every put). Two
// HomeStores over one MemoryBlobStore behave like two function instances over one Blob store.
// `delay` (ms, or a function of the call) lets a test interleave reads and writes.

import { BlobConflictError, type BlobStore, type StoredBlob } from './types';

export class MemoryBlobStore implements BlobStore {
  private blobs = new Map<string, StoredBlob>();
  private seq = 0;
  /** Calls made, for tests that count Blob operations. */
  readonly calls = { get: 0, put: 0 };

  constructor(private readonly delay: number | ((op: 'get' | 'put') => number) = 0) {}

  private async wait(op: 'get' | 'put') {
    const ms = typeof this.delay === 'function' ? this.delay(op) : this.delay;
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async get(path: string, opts: { ifNoneMatch?: string } = {}): Promise<StoredBlob | 'unchanged' | null> {
    this.calls.get += 1;
    await this.wait('get');
    const blob = this.blobs.get(path);
    if (!blob) return null;
    if (opts.ifNoneMatch !== undefined && opts.ifNoneMatch === blob.etag) return 'unchanged';
    return { ...blob };
  }

  async put(path: string, body: string, opts: { ifMatch: string } | { create: true }): Promise<{ etag: string }> {
    this.calls.put += 1;
    await this.wait('put');
    const current = this.blobs.get(path);
    if ('create' in opts ? current !== undefined : current?.etag !== opts.ifMatch) throw new BlobConflictError();
    const etag = `m${++this.seq}`;
    this.blobs.set(path, { body, etag });
    return { etag };
  }

  /** Test helper: what is stored at `path` now (no read counted). */
  peek(path: string): StoredBlob | null {
    const blob = this.blobs.get(path);
    return blob ? { ...blob } : null;
  }

  /** Test helper: forget everything. */
  clear(): void {
    this.blobs.clear();
  }
}
