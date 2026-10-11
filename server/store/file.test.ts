import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileBlobStore } from './file';
import { BlobConflictError, BlobUnavailableError } from './types';

const dirs: string[] = [];
async function store() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'homeos-file-store-'));
  dirs.push(dir);
  return new FileBlobStore(dir);
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('FileBlobStore', () => {
  it('creates only where there is nothing yet, under folders for the path', async () => {
    const s = await store();
    expect(await s.get('homeos/test/home.json')).toBeNull();
    const { etag } = await s.put('homeos/test/home.json', '{"a":1}', { create: true });
    expect(etag).toMatch(/^[0-9a-f]{64}$/);
    expect(await s.get('homeos/test/home.json')).toEqual({ body: '{"a":1}', etag });
    await expect(s.put('homeos/test/home.json', '{"a":2}', { create: true })).rejects.toBeInstanceOf(BlobConflictError);
  });

  it('writes over only the version the writer read, and says when nothing changed', async () => {
    const s = await store();
    const first = await s.put('home.json', 'v1', { create: true });
    const second = await s.put('home.json', 'v2', { ifMatch: first.etag });
    await expect(s.put('home.json', 'v3', { ifMatch: first.etag })).rejects.toBeInstanceOf(BlobConflictError);
    expect(await s.get('home.json', { ifNoneMatch: second.etag })).toBe('unchanged');
    expect(await s.get('home.json', { ifNoneMatch: first.etag })).toEqual({ body: 'v2', etag: second.etag });
  });

  it('lets exactly one of two writers of one version win', async () => {
    const s = await store();
    const { etag } = await s.put('home.json', 'v1', { create: true });
    const results = await Promise.allSettled([s.put('home.json', 'a', { ifMatch: etag }), s.put('home.json', 'b', { ifMatch: etag })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected' && r.reason instanceof BlobConflictError)).toHaveLength(1);
    // No temporary files left behind.
    expect(await readdir(s.dir)).toEqual(['home.json']);
  });

  it('never leaves the folder it was given', async () => {
    const s = await store();
    await expect(s.get('../outside.json')).rejects.toBeInstanceOf(BlobUnavailableError);
    await expect(s.put('a/../../x.json', 'x', { create: true })).rejects.toBeInstanceOf(BlobUnavailableError);
  });

  it('clears everything for a reset', async () => {
    const s = await store();
    await s.put('homeos/test/home.json', 'v1', { create: true });
    await s.clear();
    expect(await s.get('homeos/test/home.json')).toBeNull();
  });
});
