// BlobStore on the local disk, for `npm run dev:server` and the e2e-server suite (one process).
// Each path is one file under `dir` (path segments become directories); the ETag is the
// SHA-256 of the body, hex. A put checks the ETag and writes under an in-process lock, writing
// to a temporary file first and renaming it over the old one, so a crash never leaves half a
// home. A missing file is no blob.
//
// SKELETON: not implemented yet.

import type { BlobStore, StoredBlob } from './types';

export class FileBlobStore implements BlobStore {
  constructor(readonly dir: string) {}

  get(_path: string, _opts?: { ifNoneMatch?: string }): Promise<StoredBlob | 'unchanged' | null> {
    throw new Error('FileBlobStore.get: not implemented yet');
  }

  put(_path: string, _body: string, _opts: { ifMatch: string } | { create: true }): Promise<{ etag: string }> {
    throw new Error('FileBlobStore.put: not implemented yet');
  }

  /** Dev and tests (POST /__homeos/reset): removes every blob under `dir`. */
  clear(): Promise<void> {
    throw new Error('FileBlobStore.clear: not implemented yet');
  }
}
