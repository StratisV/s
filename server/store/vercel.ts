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
//
// SKELETON: not implemented yet.

import type { BlobStore, StoredBlob } from './types';

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
  BlobPreconditionFailedError: abstract new (...args: never[]) => Error;
}

export class VercelBlobStore implements BlobStore {
  constructor(readonly sdk: VercelBlobSdk) {}

  get(_path: string, _opts?: { ifNoneMatch?: string }): Promise<StoredBlob | 'unchanged' | null> {
    throw new Error('VercelBlobStore.get: not implemented yet');
  }

  put(_path: string, _body: string, _opts: { ifMatch: string } | { create: true }): Promise<{ etag: string }> {
    throw new Error('VercelBlobStore.put: not implemented yet');
  }
}
