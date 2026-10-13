// BlobStore over the deployment's private Vercel Blob store (@vercel/blob 2.8.1, installed by
// the integrator). This file never imports the package: server/entry/vercel.ts passes it in
// (`import * as blob from '@vercel/blob'; new VercelBlobStore(blob)`), so the store is tested
// with a fake SDK and the rest of the server typechecks without the package.
//
// The calls (the token comes from BLOB_READ_WRITE_TOKEN, which the SDK reads itself):
// - get:  sdk.get(path, { access: 'private', useCache: false, ifNoneMatch })
//         null → null; statusCode 304 → 'unchanged'; 200 → read the stream to a string
//         (UTF-8), etag = result.blob.etag.
// - put:  sdk.put(path, body, { access: 'private', contentType: 'application/json',
//         addRandomSuffix: false, cacheControlMaxAge: 60, allowOverwrite: true, ifMatch })
//         or, for create, { …, allowOverwrite: false } (an existing blob fails the put: then
//         get() and, if there is one, BlobConflictError). Resolves to { etag: result.etag }.
// - errors: sdk.BlobPreconditionFailedError → BlobConflictError; anything else (network,
//         BlobServiceNotAvailable, BlobUnknownError, rate limits) → BlobUnavailableError with
//         the original as `cause`.
// Set process.env.VERCEL_BLOB_RETRIES = '2' at start-up (the SDK retries 10 times by default,
// which can outlast the function); a put whose reply was lost is recognised by
// ServerDoc.meta.writes (server/core/homeStore.ts).

import { BlobConflictError, BlobUnavailableError, type BlobStore, type StoredBlob } from './types';

/** The part of @vercel/blob this store uses (the real module satisfies it). */
export interface VercelBlobSdk {
  get(
    pathname: string,
    options: { access: 'private'; useCache?: boolean; ifNoneMatch?: string },
  ): Promise<
    | { statusCode: 200; stream: ReadableStream<Uint8Array>; blob: { etag: string } }
    | { statusCode: 304; stream: null; blob: { etag: string } }
    | null
  >;
  put(
    pathname: string,
    body: string,
    options: {
      access: 'private';
      contentType?: string;
      addRandomSuffix?: boolean;
      cacheControlMaxAge?: number;
      allowOverwrite?: boolean;
      ifMatch?: string;
    },
  ): Promise<{ etag: string }>;
  /** The blob's metadata from the Blob API: its etag is the one put's ifMatch is checked against. */
  head(pathname: string): Promise<{ etag: string }>;
  BlobPreconditionFailedError: abstract new (...args: never[]) => Error;
  BlobNotFoundError: abstract new (...args: never[]) => Error;
}

/** A stream's bytes as UTF-8 text. */
async function readText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export class VercelBlobStore implements BlobStore {
  /** A read is a head and (unless unchanged) a get: two operations toward the Blob budget. */
  readonly readCost = 2;

  constructor(readonly sdk: VercelBlobSdk) {}

  /** The SDK's error as the store's. */
  private failure(err: unknown): Error {
    if (err instanceof BlobConflictError || err instanceof BlobUnavailableError) return err;
    if (err instanceof this.sdk.BlobPreconditionFailedError) return new BlobConflictError();
    return new BlobUnavailableError('blob store unavailable', { cause: err });
  }

  /**
   * The etag comes from the Blob API (head), never from the content's ETag header: the CDN in
   * front of the content can answer with an ETag of its own (weak, W/"…", when it compresses),
   * which a put's ifMatch never matches, so every write would conflict until 'busy'. Head
   * first, then the body: the body is at least as new as the etag, so a put on it can fail
   * (and is tried again on what is there) but can never write over a change it did not see.
   */
  async get(path: string, opts: { ifNoneMatch?: string } = {}): Promise<StoredBlob | 'unchanged' | null> {
    try {
      let etag: string;
      try {
        etag = (await this.sdk.head(path)).etag;
      } catch (err) {
        if (err instanceof this.sdk.BlobNotFoundError) return null;
        throw err;
      }
      if (opts.ifNoneMatch && opts.ifNoneMatch === etag) return 'unchanged';
      const got = await this.sdk.get(path, { access: 'private', useCache: false });
      if (got === null || got.statusCode !== 200) return null;
      return { body: await readText(got.stream), etag };
    } catch (err) {
      throw this.failure(err);
    }
  }

  async put(path: string, body: string, opts: { ifMatch: string } | { create: true }): Promise<{ etag: string }> {
    const common = {
      access: 'private' as const,
      contentType: 'application/json',
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
    };
    if ('create' in opts) {
      try {
        const { etag } = await this.sdk.put(path, body, { ...common, allowOverwrite: false });
        return { etag };
      } catch (err) {
        // The SDK refuses an existing blob without a code of its own: look.
        const there = await this.get(path).catch(() => undefined);
        if (there) throw new BlobConflictError('blob exists');
        throw this.failure(err);
      }
    }
    try {
      const { etag } = await this.sdk.put(path, body, { ...common, allowOverwrite: true, ifMatch: opts.ifMatch });
      return { etag };
    } catch (err) {
      throw this.failure(err);
    }
  }
}
