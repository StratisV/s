// Where the server keeps the home: one JSON blob, read whole and written whole with an ETag
// check (docs/ARCHITECTURE.md "Server mode (no setup)", "Storage"). Three implementations:
// VercelBlobStore (./vercel.ts, the private Vercel Blob store in production), FileBlobStore
// (./file.ts, local dev and the e2e-server suite) and MemoryBlobStore (./memory.ts, unit tests).

/** A stored blob: its whole body and the ETag it has now. */
export interface StoredBlob {
  body: string;
  etag: string;
}

export interface BlobStore {
  /**
   * The blob at `path`, always as stored now (never a cached copy), or null when there is
   * none. With `ifNoneMatch` equal to its current ETag: 'unchanged' (no body is sent).
   * Counts as one read toward the Blob budget either way. Throws BlobUnavailableError when the
   * store can't be reached.
   */
  get(path: string, opts?: { ifNoneMatch?: string }): Promise<StoredBlob | 'unchanged' | null>;
  /**
   * Stores `body` at `path` and resolves to its new ETag. `{ ifMatch }`: only while the blob's
   * ETag is still that, else BlobConflictError (nothing written). `{ create: true }`: only while
   * there is no blob at `path`, else BlobConflictError. Throws BlobUnavailableError when the
   * store can't be reached (the write may or may not have happened: the caller re-reads).
   */
  put(path: string, body: string, opts: { ifMatch: string } | { create: true }): Promise<{ etag: string }>;
}

/** The blob changed (ifMatch) or exists (create) since the caller read it. */
export class BlobConflictError extends Error {
  constructor(message = 'blob changed') {
    super(message);
    this.name = 'BlobConflictError';
  }
}

/** The store could not be reached or failed (the API answers 503 'unavailable'). */
export class BlobUnavailableError extends Error {
  constructor(message = 'blob store unavailable', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BlobUnavailableError';
  }
}
