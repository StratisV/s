#!/usr/bin/env node
// `npm run test:build`: the production builds, as Vercel makes them (docs/ARCHITECTURE.md
// "Server mode (no setup)", "Choosing the backend" and "Deploying").
//
// 1. Without a Blob store (no BLOB_READ_WRITE_TOKEN): the app is a demo-mode build, as
//    before, and build-server.mjs --vercel publishes nothing (Vercel deploys dist/).
// 2. With one: vercel.json's own buildCommand, run with a made-up token and setup code (and
//    VAPID private key and cron secret). The app is a server-mode build, .vercel/output holds
//    the app, /api/home and the morning cron as described, and no secret (nor any part of the
//    token) is anywhere in what would be deployed: not in the browser's files, not in the function.
//
// Writes dist/, .vercel/output and a scratch build in node_modules/.tmp (all ignored by git).
// The made-up secrets are random and never printed.

import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const notes = [];
const check = (ok, what) => {
  (ok ? notes : failures).push(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

/** Every name scripts/backend-mode.mjs reads, so the shell (or a .env file) can't pick the mode. */
const MODE_NAMES = [
  'VITE_FORCE_DEMO',
  'VITE_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'BLOB_READ_WRITE_TOKEN',
  'HOMEOS_LOCAL_SERVER',
  'HOMEOS_SETUP_CODE',
  'HOMEOS_API_PROXY',
  // And no database for migrate.mjs to touch.
  'MIGRATE_DATABASE_URL',
  'SUPABASE_DB_URL',
  'POSTGRES_URL_NON_POOLING',
];
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  // Empty rather than unset: Vite's loadEnv lets the process environment win over .env files.
  for (const name of MODE_NAMES) env[name] = '';
  return { ...env, ...extra };
}

function filesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

/** The mode the built app runs in, from its entry chunk (pickBackendMode folded to a constant). */
function builtMode(dir) {
  for (const file of filesUnder(path.join(dir, 'assets')).filter((f) => f.endsWith('.js'))) {
    const js = readFileSync(file, 'utf8');
    const m = /\{return"(demo|supabase|server)"\}const ([\w$]+)=[\w$]+\(\);async function [\w$]+\(\)\{switch\(\2\)\{case"demo"/.exec(js);
    if (m) return m[1];
  }
  return null;
}

const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const output = path.join(root, '.vercel', 'output');

// ── 1. No Blob store: demo mode, nothing to publish ──────────────────────────
{
  const outDir = path.join(root, 'node_modules', '.tmp', 'check-build-demo');
  const env = cleanEnv();
  execFileSync(process.execPath, [vite, 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], { cwd: root, env, stdio: 'inherit' });
  check(builtMode(outDir) === 'demo', 'without BLOB_READ_WRITE_TOKEN the app is built in demo mode');
  rmSync(output, { recursive: true, force: true });
  const published = spawnSync(process.execPath, ['scripts/build-server.mjs', '--vercel'], { cwd: root, env, encoding: 'utf8' });
  check(published.status === 0 && /demo mode, no server to publish/.test(published.stdout), 'build-server.mjs --vercel publishes nothing in demo mode');
  check(!existsSync(output), 'no .vercel/output, so Vercel deploys dist/ as before');
  rmSync(outDir, { recursive: true, force: true });
}

// ── 2. With a Blob store: Vercel's build command, made-up secrets ────────────
const storeId = randomBytes(8).toString('hex');
// Hex parts: the token's own separator (_) must not appear inside them.
const secretPart = randomBytes(18).toString('hex');
const token = `vercel_blob_rw_${storeId}_${secretPart}`;
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const setup = Array.from(randomBytes(16), (b) => ALPHABET[b & 31]).join('');
const setupFormatted = setup.match(/.{4}/g).join('-');
// The notifications' secrets too (the run-time settings; a build must never pick them up).
const vapidPrivate = randomBytes(32).toString('base64url');
const cronSecret = randomBytes(24).toString('hex');
{
  const vercelJson = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const env = cleanEnv({
    BLOB_READ_WRITE_TOKEN: token,
    HOMEOS_SETUP_CODE: setupFormatted,
    HOMEOS_VAPID_PRIVATE_KEY: vapidPrivate,
    CRON_SECRET: cronSecret,
    VERCEL: '1',
    VERCEL_ENV: 'production',
  });
  // Exactly what Vercel runs (migrate.mjs skips without a database).
  const built = spawnSync(vercelJson.buildCommand, { cwd: root, env, shell: true, encoding: 'utf8' });
  const log = `${built.stdout}\n${built.stderr}`;
  check(built.status === 0, `vercel.json buildCommand succeeds (${vercelJson.buildCommand})`);
  if (built.status !== 0) {
    console.error(
      log
        .replaceAll(token, '<token>')
        .replaceAll(setupFormatted, '<setup>')
        .replaceAll(vapidPrivate, '<vapid>')
        .replaceAll(cronSecret, '<cron>'),
    );
    for (const line of [...notes, ...failures]) console.log(line);
    process.exit(1);
  }
  check(
    [token, setup, setupFormatted, vapidPrivate, cronSecret].every((secret) => !log.includes(secret)),
    'the build log holds no secret',
  );
  check(builtMode(path.join(root, 'dist')) === 'server', 'with BLOB_READ_WRITE_TOKEN the app is built in server mode');

  const func = path.join(output, 'functions', 'api', 'home.func');
  check(existsSync(path.join(output, 'static', 'index.html')), '.vercel/output/static holds the app');
  check(
    existsSync(path.join(output, 'static', 'index.html')) &&
      readFileSync(path.join(output, 'static', 'index.html'), 'utf8') === readFileSync(path.join(root, 'dist', 'index.html'), 'utf8'),
    'static/ is the built dist/',
  );
  const config = JSON.parse(readFileSync(path.join(output, 'config.json'), 'utf8'));
  check(config.version === 3 && config.routes.at(-1)?.handle === 'filesystem', 'config.json: Build Output v3, headers then the filesystem');
  check(
    JSON.stringify(config.crons) === JSON.stringify(vercelJson.crons) && config.crons?.[0]?.path === '/api/home?op=tick',
    `config.json: the morning notifications cron (${config.crons?.map((c) => `${c.schedule} ${c.path}`).join(', ')})`,
  );
  const vc = JSON.parse(readFileSync(path.join(func, '.vc-config.json'), 'utf8'));
  check(vc.runtime === 'nodejs22.x' && vc.handler === 'index.mjs' && vc.launcherType === 'Nodejs', 'api/home.func/.vc-config.json: Node 22, index.mjs, the Node launcher');
  check(readdirSync(func).sort().join(',') === '.vc-config.json,index.mjs', 'the function is one file (everything bundled) and its config');
  const fn = readFileSync(path.join(func, 'index.mjs'), 'utf8');
  check(/export\s*\{[^}]*as default/.test(fn) || /export default/.test(fn), 'index.mjs has a default export (the handler)');
  check(!/from\s*["'](\.{1,2}\/|@vercel\/blob|undici)/.test(fn), 'index.mjs imports nothing from the repository or node_modules');

  // No secret anywhere that would be deployed (or left in dist/).
  const secrets = [token, `${storeId}_${secretPart}`, secretPart, setup, setupFormatted, setup.toLowerCase(), vapidPrivate, cronSecret];
  if (secrets.some((x) => x.length < 12)) throw new Error('check-build: a made-up secret is too short to search for');
  const leaks = [];
  for (const file of [...filesUnder(path.join(root, 'dist')), ...filesUnder(output)]) {
    const text = readFileSync(file).toString('latin1');
    for (const s of secrets) if (text.includes(s)) leaks.push(path.relative(root, file));
  }
  check(leaks.length === 0, `no secret in dist/ or .vercel/output (${filesUnder(output).length} files)${leaks.length ? `: ${[...new Set(leaks)].join(', ')}` : ''}`);
  // The browser's files don't even name them.
  const browserFiles = filesUnder(path.join(output, 'static')).filter((f) => /\.(js|html|css|json|webmanifest)$/.test(f));
  const named = browserFiles.filter((f) =>
    /BLOB_READ_WRITE_TOKEN|HOMEOS_SETUP_CODE|HOMEOS_VAPID_PRIVATE_KEY|CRON_SECRET/.test(readFileSync(f, 'utf8')),
  );
  check(
    named.length === 0,
    `the browser's files do not name BLOB_READ_WRITE_TOKEN, HOMEOS_SETUP_CODE, HOMEOS_VAPID_PRIVATE_KEY or CRON_SECRET${named.length ? `: ${named.join(', ')}` : ''}`,
  );
  check(statSync(path.join(func, 'index.mjs')).size < 4 * 1024 * 1024, `the function bundle is small (${Math.round(statSync(path.join(func, 'index.mjs')).size / 1024)} KiB)`);
}

// .vercel/output is only for a deployment: a later plain build must not leave it behind.
rmSync(output, { recursive: true, force: true });

for (const line of notes) console.log(line);
for (const line of failures) console.log(line);
if (failures.length) {
  console.error(`check-build: ${failures.length} failed`);
  process.exit(1);
}
console.log('check-build: all passed');
