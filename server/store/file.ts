// BlobStore on the local disk, for `npm run dev:server` and the e2e-server suite (one process).
// Each path is one file under `dir` (path segments become directories); the ETag is the
// SHA-256 of the body, hex. A put checks the ETag and writes under an in-process lock, writing
// to a temporary file first and renaming it over the old one, so a crash never leaves half a
// home. A missing file is no blob.

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BlobConflictError, BlobUnavailableError, type BlobStore, type StoredBlob } from './types';

const etagOf = (body: string) => createHash('sha256').update(body, 'utf8').digest('hex');

export class FileBlobStore implements BlobStore {
  /** Puts one at a time (this process is the only writer). */
  private lock: Promise<unknown> = Promise.resolve();

  constructor(readonly dir: string) {}

  /** The file for a blob path; segments become directories, and nothing may leave `dir`. */
  private fileOf(blobPath: string): string {
    const segments = blobPath.split('/').filter((s) => s !== '');
    if (!segments.length || segments.some((s) => s === '.' || s === '..' || s.includes('\\'))) {
      throw new BlobUnavailableError(`bad blob path`);
    }
    return path.join(path.resolve(this.dir), ...segments);
  }

  private async readNow(file: string): Promise<StoredBlob | null> {
    try {
      const body = await readFile(file, 'utf8');
      return { body, etag: etagOf(body) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new BlobUnavailableError('file store unavailable', { cause: err });
    }
  }

  async get(blobPath: string, opts: { ifNoneMatch?: string } = {}): Promise<StoredBlob | 'unchanged' | null> {
    const blob = await this.readNow(this.fileOf(blobPath));
    if (!blob) return null;
    if (opts.ifNoneMatch !== undefined && opts.ifNoneMatch === blob.etag) return 'unchanged';
    return blob;
  }

  put(blobPath: string, body: string, opts: { ifMatch: string } | { create: true }): Promise<{ etag: string }> {
    const run = this.lock.then(async () => {
      const file = this.fileOf(blobPath);
      const current = await this.readNow(file);
      if ('create' in opts ? current !== null : current?.etag !== opts.ifMatch) throw new BlobConflictError();
      try {
        await mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${randomUUID()}.tmp`;
        await writeFile(tmp, body, 'utf8');
        await rename(tmp, file);
      } catch (err) {
        throw new BlobUnavailableError('file store unavailable', { cause: err });
      }
      return { etag: etagOf(body) };
    });
    this.lock = run.catch(() => {});
    return run;
  }

  /** Dev and tests (POST /__homeos/reset): removes every blob under `dir`. */
  async clear(): Promise<void> {
    const dir = path.resolve(this.dir);
    const run = this.lock.then(async () => {
      let names: string[] = [];
      try {
        names = await readdir(dir);
      } catch {
        return;
      }
      await Promise.all(names.map((name) => rm(path.join(dir, name), { recursive: true, force: true })));
    });
    this.lock = run.catch(() => {});
    await run;
  }
}
