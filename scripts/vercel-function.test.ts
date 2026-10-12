import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest, createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher, type Dispatcher } from 'undici';
import type { MockInterceptor } from 'undici/types/mock-interceptor';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USER_DEMO_DOC } from '../src/lib/logic/importHome.fixture';
import { ESM_REQUIRE_BANNER, functionConfig } from './build-output.mjs';

// The Vercel Function as Vercel runs it (docs/ARCHITECTURE.md "Server mode (no setup)",
// "Deploying"): server/entry/vercel.ts bundled by esbuild exactly as scripts/build-server.mjs
// does (one ESM file, everything inside it, the createRequire banner), loaded by Node from
// outside the repository (nothing resolved at run time), its default export called with Node's
// own request and response (the Nodejs launcher with helpers off), and the real @vercel/blob
// 2.8.1 talking to a fake Vercel Blob service (undici's MockAgent, which the SDK's fetch uses;
// the network is shut off, so nothing reaches Vercel).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE_ID = 'teststore0123';
const TOKEN = `vercel_blob_rw_${STORE_ID}_FakeSecretForTestsOnly0123456789`;
const SETUP = 'K7QM-3XRP-WN9D';
const BLOB_PATH = 'homeos/production/home.json';

type MockRequest = MockInterceptor.MockResponseCallbackOptions;
type FakeReply = { statusCode: number; data?: object | string; responseOptions?: MockInterceptor.MockResponseOptions };

interface BlobRequestLog {
  method: string;
  path: string;
  headers: Record<string, string>;
}

/** The private Blob store, as Vercel's API and storage answer the SDK (as far as the SDK's own code expects). */
class FakeBlobService {
  blobs = new Map<string, { body: string; etag: string }>();
  log: BlobRequestLog[] = [];
  private seq = 0;

  private headersOf(opts: MockRequest): Record<string, string> {
    const out: Record<string, string> = {};
    const raw: unknown = opts.headers;
    if (Array.isArray(raw)) {
      for (let i = 0; i < raw.length; i += 2) out[String(raw[i]).toLowerCase()] = String(raw[i + 1]);
    } else if (raw && typeof (raw as Headers).forEach === 'function' && !(raw instanceof Object && Object.getPrototypeOf(raw) === Object.prototype)) {
      (raw as Headers).forEach((v, k) => (out[k.toLowerCase()] = v));
    } else if (raw) {
      for (const [k, v] of Object.entries(raw as Record<string, string | string[] | undefined>)) {
        if (v !== undefined) out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
      }
    }
    return out;
  }

  /** PUT https://vercel.com/api/blob/?pathname=… */
  put(opts: MockRequest): FakeReply {
    const headers = this.headersOf(opts);
    this.log.push({ method: 'PUT', path: opts.path, headers });
    if (headers.authorization !== `Bearer ${TOKEN}`) return { statusCode: 403, data: { error: { code: 'forbidden', message: 'Forbidden' } } };
    const pathname = new URL(opts.path, 'https://vercel.com').searchParams.get('pathname')!;
    const current = this.blobs.get(pathname);
    if (headers['x-if-match'] !== undefined && current?.etag !== headers['x-if-match']) {
      return { statusCode: 412, data: { error: { code: 'precondition_failed', message: 'Precondition failed' } } };
    }
    if (current && headers['x-allow-overwrite'] !== '1') {
      return { statusCode: 400, data: { error: { code: 'bad_request', message: 'This blob already exists' } } };
    }
    const etag = `"etag-${++this.seq}"`;
    this.blobs.set(pathname, { body: String(opts.body), etag });
    const url = `https://${STORE_ID}.private.blob.vercel-storage.com/${pathname}`;
    return {
      statusCode: 200,
      data: { url, downloadUrl: `${url}?download=1`, pathname, contentType: headers['x-content-type'], contentDisposition: 'inline', etag },
    };
  }

  /** GET https://<store>.private.blob.vercel-storage.com/<pathname> */
  get(opts: MockRequest): FakeReply {
    const headers = this.headersOf(opts);
    this.log.push({ method: 'GET', path: opts.path, headers });
    if (headers.authorization !== `Bearer ${TOKEN}`) return { statusCode: 403, data: '' };
    const pathname = decodeURIComponent(new URL(opts.path, 'https://x').pathname.slice(1));
    const blob = this.blobs.get(pathname);
    if (!blob) return { statusCode: 404, data: '' };
    if (headers['if-none-match'] === blob.etag) return { statusCode: 304, data: '', responseOptions: { headers: { etag: blob.etag } } };
    return { statusCode: 200, data: blob.body, responseOptions: { headers: { etag: blob.etag, 'content-type': 'application/json' } } };
  }

  /** Another instance stores a change: the blob moves on under this one. */
  changeBehind(edit: (doc: Record<string, unknown>) => void) {
    const blob = this.blobs.get(BLOB_PATH)!;
    const doc = JSON.parse(blob.body) as Record<string, unknown>;
    edit(doc);
    this.blobs.set(BLOB_PATH, { body: JSON.stringify(doc), etag: `"etag-${++this.seq}"` });
  }
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  json: Record<string, unknown>;
}

let dir: string;
let server: Server;
let base: string;
let service: FakeBlobService;
let previousDispatcher: Dispatcher;
let cookie = '';
const savedEnv = { ...process.env };

/** A request to the function, as a browser on the app's origin sends it (node:http: not through the mock). */
function call(method: 'GET' | 'POST', query: string, body?: unknown, extra: Record<string, string> = {}): Promise<Reply> {
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      `${base}/api/home${query}`,
      {
        method,
        headers: {
          'X-HomeOS': '1',
          'x-forwarded-for': '203.0.113.7',
          'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(data)) } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...extra,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(text) as Record<string, unknown>;
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'homeos-function-'));
  const outfile = path.join(dir, 'index.mjs');
  // The same esbuild call as scripts/build-server.mjs (bundle()).
  await build({
    entryPoints: [path.join(root, 'server/entry/vercel.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    banner: { js: ESM_REQUIRE_BANNER },
    legalComments: 'none',
    logLevel: 'silent',
  });

  service = new FakeBlobService();
  previousDispatcher = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  agent
    .get('https://vercel.com')
    .intercept({ path: (p) => p.startsWith('/api/blob/?'), method: 'PUT' })
    .reply<object>((opts) => service.put(opts))
    .persist();
  agent
    .get(`https://${STORE_ID}.private.blob.vercel-storage.com`)
    .intercept({ path: () => true, method: 'GET' })
    .reply<object>((opts) => service.get(opts))
    .persist();
  setGlobalDispatcher(agent);

  // Vercel's environment for the function (production; the main session sets the setup code).
  Object.assign(process.env, { BLOB_READ_WRITE_TOKEN: TOKEN, HOMEOS_SETUP_CODE: SETUP, VERCEL_ENV: 'production', VERCEL: '1' });
  delete process.env.HOMEOS_BLOB_PATH;
  // Node's own loader, as on Vercel (not Vitest's), from a folder outside the repository:
  // nothing the bundle needs can be resolved from anywhere else. (Node 22 requires ES modules.)
  const mod = createRequire(pathToFileURL(path.join(dir, 'loader.cjs')).href)(outfile) as {
    default: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  };
  expect(typeof mod.default).toBe('function');
  server = createServer((req, res) => void mod.default(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  setGlobalDispatcher(previousDispatcher);
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  rmSync(dir, { recursive: true, force: true });
});

describe('the Vercel Function bundle with @vercel/blob', () => {
  it('has a .vc-config.json for the Node launcher with the ESM handler', () => {
    expect(functionConfig()).toEqual({
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      maxDuration: 15,
    });
  });

  it('answers status before any home exists, reading the private blob without a cache', async () => {
    const res = await call('GET', '?op=status');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ home: false, google: false });
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['cache-control']).toBe('no-store');
    const get = service.log.find((r) => r.method === 'GET')!;
    expect(get.path).toBe(`/${BLOB_PATH}?cache=0`);
    expect(get.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('refuses a request without the X-HomeOS header, and a stranger', async () => {
    expect((await call('GET', '?op=status', undefined, { 'X-HomeOS': '' })).status).toBe(403);
    const res = await call('GET', '?op=version');
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: { code: 'not_signed_in', message: expect.any(String) } });
  });

  it('brings the home online with the setup code: one private put that must not overwrite, and a Secure HttpOnly cookie', async () => {
    const wrong = await call('POST', '', { op: 'setup', code: 'AAAA-AAAA-AAAA', phone: JSON.stringify(USER_DEMO_DOC) });
    expect(wrong.status).toBe(400);
    expect(service.log.filter((r) => r.method === 'PUT')).toHaveLength(0);

    const res = await call('POST', '', { op: 'setup', code: SETUP.toLowerCase(), phone: JSON.stringify(USER_DEMO_DOC) });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ user: { name: 'Stratis', email: '' }, entry: { status: 'member' }, device: { label: 'iPhone · Safari' } });
    const setCookie = String(res.headers['set-cookie']);
    // The device token: the key, the device, the rev that first holds it, the home's signature.
    expect(setCookie).toMatch(
      /^homeos_key=[A-Za-z0-9_-]{43}\.[0-9a-f-]{36}\.1\.[A-Za-z0-9_-]{22}; Path=\/api; HttpOnly; SameSite=Lax; Max-Age=34560000; Secure$/,
    );
    cookie = setCookie.split(';')[0];

    const puts = service.log.filter((r) => r.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].path).toBe(`/api/blob/?pathname=${encodeURIComponent(BLOB_PATH)}`);
    expect(puts[0].headers).toMatchObject({
      authorization: `Bearer ${TOKEN}`,
      'x-vercel-blob-access': 'private',
      'x-content-type': 'application/json',
      'x-add-random-suffix': '0',
      'x-allow-overwrite': '0',
      'x-cache-control-max-age': '60',
    });
    expect(puts[0].headers['x-if-match']).toBeUndefined();
    // What is stored: the home and the server-only part, with hashes, never the key or the code.
    const stored = service.blobs.get(BLOB_PATH)!.body;
    expect(stored).not.toContain(cookie.split('=')[1]);
    expect(stored).not.toContain(cookie.split('=')[1].split('.')[0]);
    expect(stored).not.toContain(SETUP.replace(/-/g, ''));
    expect(JSON.parse(stored)).toMatchObject({ format: 'homeos.server/1', rev: 1 });

    // The phone uses its key (its first use is stored once: a put that keeps the rev) ...
    expect((await call('GET', '?op=session')).status).toBe(200);
    const seen = service.log.filter((r) => r.method === 'PUT');
    expect(seen).toHaveLength(2);
    expect(seen[1].headers['x-if-match']).toBe('"etag-1"');
    expect(JSON.parse(service.blobs.get(BLOB_PATH)!.body)).toMatchObject({ rev: 1 });
    // ... and from then on the setup code is used up: a second setup finds the home.
    const again = await call('POST', '', { op: 'setup', code: SETUP, phone: JSON.stringify(USER_DEMO_DOC) });
    expect(again.status).toBe(409);
    expect((await call('GET', '?op=status')).json).toEqual({ home: true, google: false });
  });

  it('runs the app’s calls as the signed-in person, with conditional writes', async () => {
    const session = await call('GET', '?op=session');
    expect(session.status).toBe(200);
    const id = (await call('POST', '', { op: 'rpc', method: 'getMyHouseholdId', args: [] })).json.result as string;
    const load = await call('POST', '', { op: 'rpc', method: 'load', args: [id] });
    expect(load.status).toBe(200);
    const data = load.json.result as { areas: { name: string }[]; items: unknown[]; members: { name: string; user_id: string | null }[] };
    expect(data.areas).toHaveLength(6);
    expect(data.items).toHaveLength(19);
    expect(data.members.map((m) => [m.name, m.user_id === null])).toEqual([
      ['Stratis', false],
      ['Shea', true],
    ]);

    const before = service.log.filter((r) => r.method === 'PUT').length;
    const shed = await call('POST', '', { op: 'rpc', method: 'createArea', args: [id, 'Shed'] });
    expect(shed.status).toBe(200);
    expect(shed.json.rev).toBe(2);
    const put = service.log.filter((r) => r.method === 'PUT')[before];
    expect(put.headers['x-if-match']).toBe('"etag-2"');
    expect(put.headers['x-allow-overwrite']).toBe('1');
    expect((await call('GET', '?op=version')).json).toMatchObject({ rev: 2, readOnly: false });
  });

  it('a write that loses the race to another instance is applied again to what is there; no change is lost', async () => {
    const id = (await call('POST', '', { op: 'rpc', method: 'getMyHouseholdId', args: [] })).json.result as string;
    // Another instance stores a household name change (rev 3) behind this one's cached copy.
    service.changeBehind((doc) => {
      const home = doc.home as { households: { name: string }[] };
      home.households[0].name = 'The Burrow';
      doc.rev = (doc.rev as number) + 1;
    });
    const res = await call('POST', '', { op: 'rpc', method: 'createArea', args: [id, 'Loft'] });
    expect(res.status).toBe(200);
    // The put with the old ETag was refused (412), the blob read again, the area added to it.
    const puts = service.log.filter((r) => r.method === 'PUT');
    expect(puts.at(-2)!.headers['x-if-match']).toBe('"etag-3"');
    expect(puts.at(-1)!.headers['x-if-match']).toBe('"etag-4"');
    const load = await call('POST', '', { op: 'rpc', method: 'load', args: [id], minRev: res.json.rev });
    const data = load.json.result as { household: { name: string }; areas: { name: string }[] };
    expect(data.household.name).toBe('The Burrow');
    expect(data.areas.map((a) => a.name)).toEqual(expect.arrayContaining(['Shed', 'Loft']));
  });

  it('a poll is answered from the instance’s copy: no Blob call', async () => {
    const before = service.log.length;
    for (let i = 0; i < 5; i++) expect((await call('GET', '?op=version')).status).toBe(200);
    expect(service.log.length).toBe(before);
  });

  it('never sends the token, the setup code or a key hash to the browser', async () => {
    const replies = [
      await call('GET', '?op=session'),
      await call('GET', '?op=devices'),
      await call('GET', '?op=version'),
      await call('POST', '', { op: 'createCode', memberId: 'nobody' }),
    ];
    const stored = JSON.parse(service.blobs.get(BLOB_PATH)!.body) as { auth: { devices: { keyHash: string }[] } };
    for (const r of replies) {
      expect(r.text).not.toContain(TOKEN);
      expect(r.text).not.toContain(STORE_ID);
      expect(r.text).not.toContain(SETUP.replace(/-/g, ''));
      for (const d of stored.auth.devices) expect(r.text).not.toContain(d.keyHash);
    }
  });
});
