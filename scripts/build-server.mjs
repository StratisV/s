#!/usr/bin/env node
// Bundles the server (server/) with esbuild. docs/ARCHITECTURE.md "Server mode (no setup)",
// "Deploying" and "Local server and tests".
//
//   node scripts/build-server.mjs --vercel   (Vercel's build command, after `npm run build`)
//     Only in server mode (scripts/backend-mode.mjs: no forced demo, no Supabase, and
//     BLOB_READ_WRITE_TOKEN set); otherwise it does nothing and Vercel deploys dist/ as before.
//     Writes .vercel/output (Build Output API v3), which Vercel then deploys instead of dist/:
//       static/                         a copy of dist/
//       functions/api/home.func/        server/entry/vercel.ts bundled (index.mjs) + .vc-config.json
//       config.json                     vercel.json's headers as routes, then the filesystem
//     HOMEOS_FUNCTION_REGION (optional) pins the function to the Blob store's region.
//   node scripts/build-server.mjs --local    (npm run build:server)
//     server/entry/local.ts bundled into dist-server/local.mjs.
//
// The bundles hold everything they import (the app's own src/lib code and @vercel/blob), so
// nothing is resolved at run time. No secret is read or printed here.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendMode } from './backend-mode.mjs';
import { buildOutputConfig, ESM_REQUIRE_BANNER, functionConfig } from './build-output.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));

async function bundle(entry, outfile) {
  const { build } = await import('esbuild');
  await build({
    entryPoints: [path.join(root, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    banner: { js: ESM_REQUIRE_BANNER },
    legalComments: 'none',
    logLevel: 'warning',
  });
}

async function buildVercel() {
  const mode = backendMode(process.env);
  if (mode !== 'server') {
    console.log(`build-server: ${mode} mode, no server to publish.`);
    return;
  }
  const dist = path.join(root, 'dist');
  if (!existsSync(path.join(dist, 'index.html'))) throw new Error('build-server: dist/ is missing; run `npm run build` first.');
  const out = path.join(root, '.vercel', 'output');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(dist, path.join(out, 'static'), { recursive: true });
  const func = path.join(out, 'functions', 'api', 'home.func');
  mkdirSync(func, { recursive: true });
  await bundle('server/entry/vercel.ts', path.join(func, 'index.mjs'));
  writeFileSync(
    path.join(func, '.vc-config.json'),
    JSON.stringify(functionConfig({ region: process.env.HOMEOS_FUNCTION_REGION || undefined }), null, 2),
  );
  const vercelJson = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  writeFileSync(path.join(out, 'config.json'), JSON.stringify(buildOutputConfig(vercelJson), null, 2));
  console.log('build-server: published dist/ and /api/home in .vercel/output.');
}

async function buildLocal() {
  const outDir = path.join(root, 'dist-server');
  mkdirSync(outDir, { recursive: true });
  await bundle('server/entry/local.ts', path.join(outDir, 'local.mjs'));
  console.log('build-server: dist-server/local.mjs');
}

if (args.has('--vercel')) await buildVercel();
else if (args.has('--local')) await buildLocal();
else {
  console.error('usage: node scripts/build-server.mjs --vercel | --local');
  process.exit(2);
}
