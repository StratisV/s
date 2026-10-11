#!/usr/bin/env node
// `npm run dev:server`: server mode on this computer (docs/ARCHITECTURE.md "Server mode (no
// setup)", "Local server and tests"). Bundles and starts the local API server
// (server/entry/local.ts, the home kept under .homeos-local/) and Vite's dev server in server
// mode, which passes /api on to it. Open the address Vite prints; bring a demo home online with
// the setup code printed below (HOMEOS_SETUP_CODE, else the test code), then invite others
// with codes from Profile.
//
//   npm run dev:server [-- --api-port 4300] [-- any Vite option]
//
// Ctrl+C stops both. Nothing here reads or prints a secret.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let apiPort = 4300;
const viteArgs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--api-port') apiPort = Number(args[++i]);
  else viteArgs.push(args[i]);
}
if (!Number.isInteger(apiPort) || apiPort <= 0) {
  console.error('dev-server: --api-port needs a port number');
  process.exit(2);
}

/** The local server's setup code: the shell's, else the one the e2e tests use (local only). */
const setupCode = process.env.HOMEOS_SETUP_CODE || 'TEST-SETU-PCDE';

function run(command, commandArgs, env) {
  return spawn(command, commandArgs, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
}

function exitCode(child) {
  return new Promise((resolve) => child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0))));
}

// 1. The local server's bundle.
const built = await exitCode(run(process.execPath, ['scripts/build-server.mjs', '--local']));
if (built !== 0) process.exit(built);

// 2. The API on its own port, then Vite in server mode in front of it.
const api = run(process.execPath, ['dist-server/local.mjs', '--port', String(apiPort), '--allow-reset'], {
  HOMEOS_SETUP_CODE: setupCode,
});
console.log(`dev-server: setup code ${process.env.HOMEOS_SETUP_CODE ? '(from HOMEOS_SETUP_CODE)' : setupCode}`);
// Vite's own script, run directly, so stopping it stops the dev server (an npx wrapper may not pass the signal on).
const vite = run(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), ...viteArgs], {
  HOMEOS_LOCAL_SERVER: '1',
  HOMEOS_API_PROXY: `http://localhost:${apiPort}`,
  VITE_FORCE_DEMO: '',
});

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of [api, vite]) if (child.exitCode === null) child.kill('SIGTERM');
  process.exitCode = code;
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
const first = await Promise.race([exitCode(api), exitCode(vite)]);
stop(first);
