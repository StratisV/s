// The local server: the built app and the API on one port, for `npm run dev:server` (API only,
// behind Vite's dev server) and the e2e-server suite (both). Bundled by
// `node scripts/build-server.mjs --local` into dist-server/local.mjs, then run with node.
// docs/ARCHITECTURE.md "Server mode (no setup)", "Local server and tests".
//
// node dist-server/local.mjs [options]
//   --port <n>            default 4300
//   --static <dir>        serve this built app (GET of a file; anything else that accepts HTML
//                         gets index.html); without it, the API only
//   --data <dir>          FileBlobStore directory (default .homeos-local); --memory: MemoryBlobStore
//   --allow-reset         POST /__homeos/reset (header X-HomeOS: 1) wipes the store, the cache
//                         and the attempt limits; never in the Vercel bundle
//   --attempts <perIp>,<global>,<windowMs>[,<trustedPerIp>]   attempt limits (tests use small
//                         windows; trustedPerIp defaults to twice perIp)
// Environment: HOMEOS_SETUP_CODE (as on Vercel), HOMEOS_BLOB_WRITES_PER_MONTH,
// HOMEOS_BLOB_READS_PER_MONTH. Cookies are not Secure (http://localhost); the IP is the socket's.
// Logs one line when listening: "home.os local server on http://localhost:<port>".

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { API_HEADER, API_HEADER_VALUE, SETUP_BODY_MAX } from '../../src/lib/backend/serverApi';
import { createServerContext } from '../core/context';
import { errorResponse, handleApi, type ApiResponse } from '../core/handler';
import type { AttemptLimits } from '../core/limits';
import { FileBlobStore } from '../store/file';
import { MemoryBlobStore } from '../store/memory';
import { readRequest, writeResponse } from './node';

interface Options {
  port: number;
  staticDir: string | null;
  dataDir: string;
  memory: boolean;
  allowReset: boolean;
  attempts: AttemptLimits | undefined;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { port: 4300, staticDir: null, dataDir: '.homeos-local', memory: false, allowReset: false, attempts: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    switch (arg) {
      case '--port':
        opts.port = Number(next());
        break;
      case '--static':
        opts.staticDir = path.resolve(next());
        break;
      case '--data':
        opts.dataDir = next();
        break;
      case '--memory':
        opts.memory = true;
        break;
      case '--allow-reset':
        opts.allowReset = true;
        break;
      case '--attempts': {
        const [perIp, global, windowMs, trusted] = next().split(',').map(Number);
        const given = [perIp, global, windowMs, ...(trusted === undefined ? [] : [trusted])];
        if (!given.every((n) => Number.isInteger(n) && n > 0)) throw new Error('--attempts <perIp>,<global>,<windowMs>[,<trustedPerIp>]');
        opts.attempts = { perIp, global, windowMs, ...(trusted === undefined ? {} : { trustedPerIp: trusted }) };
        break;
      }
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }
  if (!Number.isInteger(opts.port) || opts.port <= 0) throw new Error('--port must be a port number');
  return opts;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** A file of the built app, or index.html for a page; 404 otherwise. */
async function serveStatic(dir: string, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = '/';
  }
  const file = path.join(dir, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  const inside = file === dir || file.startsWith(dir + path.sep);
  let target: string | null = null;
  if (inside) {
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) target = file;
  }
  if (!target && (req.headers.accept ?? '').includes('text/html')) target = path.join(dir, 'index.html');
  const info = target ? await stat(target).catch(() => null) : null;
  if (!target || !info?.isFile()) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not found');
    return;
  }
  const ext = path.extname(target).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
  res.setHeader('Content-Length', info.size);
  // The app shell and the service worker are always fetched fresh; hashed assets may be kept.
  res.setHeader('Cache-Control', target.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(target).pipe(res);
}

/**
 * An answer as Vercel's proxy hands it to the browser: it keeps `stale-while-revalidate` and
 * `stale-if-error` for its own cache and takes them out of Cache-Control, so a browser never
 * serves itself a stale copy (the goals link's page would show the answer before last).
 */
function asVercelProxyWould(response: ApiResponse): ApiResponse {
  const cacheControl = response.headers['Cache-Control'];
  if (typeof cacheControl !== 'string' || !/stale-/i.test(cacheControl)) return response;
  const kept = cacheControl
    .split(',')
    .map((d) => d.trim())
    .filter((d) => !/^stale-(while-revalidate|if-error)=/i.test(d))
    .join(', ');
  return { ...response, headers: { ...response.headers, 'Cache-Control': kept } };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const memory = opts.memory ? new MemoryBlobStore() : null;
  const files = opts.memory ? null : new FileBlobStore(opts.dataDir);
  const ctx = createServerContext({
    blobs: (memory ?? files)!,
    env: process.env,
    secureCookies: false,
    attempts: opts.attempts,
  });

  const server = createServer((req, res) => {
    void (async () => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/__homeos/reset' && req.method === 'POST') {
        if (!opts.allowReset || req.headers[API_HEADER.toLowerCase()] !== API_HEADER_VALUE) {
          res.statusCode = 404;
          res.end();
          return;
        }
        req.resume();
        memory?.clear();
        await files?.clear();
        ctx.store.reset();
        ctx.limiter.reset();
        ctx.keyMisses.reset();
        writeResponse(res, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: '{"ok":true}' });
        return;
      }
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        let response: ApiResponse;
        try {
          response = await handleApi(await readRequest(req, { maxBytes: SETUP_BODY_MAX, trustProxy: false }), ctx);
        } catch (err) {
          response = errorResponse(err);
        }
        writeResponse(res, asVercelProxyWould(response));
        return;
      }
      if (opts.staticDir && (req.method === 'GET' || req.method === 'HEAD')) {
        await serveStatic(opts.staticDir, req, res);
        return;
      }
      res.statusCode = 404;
      res.end();
    })().catch((err) => {
      console.error('home.os local server:', err);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
  });
  server.listen(opts.port, () => {
    console.log(`home.os local server on http://localhost:${opts.port}`);
  });
}

main();
