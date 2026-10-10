#!/usr/bin/env node
// Database tests (npm run test:db).
//
// Default: starts a throwaway Postgres 16 in a temp dir (unix socket only, port 54329,
// trust auth), applies supabase/tests/supabase_stub.sql and every migration (twice, to
// prove they can be re-applied), runs supabase/tests/*.test.mjs with node:test, then stops
// the server and deletes the temp dir.
//
// DATABASE_URL=postgresql://... runs the same tests against an existing database that
// already has the migrations, e.g. the local Supabase stack after `npx supabase db reset`:
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db
// The tests make a home per case, so the test database allows many homes
// (app_settings.many_homes, which the throwaway database gets and DATABASE_URL must have).
// one_home_deployment.test.mjs makes a fresh database of its own, as a deployment has it.
//
// Optional: PG_BIN (directory with initdb/pg_ctl), TEST_DB_PORT, and file name filters as
// arguments (`npm run test:db -- items` runs only the matching test files).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(root, 'supabase', 'tests');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const port = Number(process.env.TEST_DB_PORT || 54329);

const filters = process.argv.slice(2);
const testFiles = fs
  .readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => filters.length === 0 || filters.some((p) => f.includes(p)))
  .sort()
  .map((f) => path.join(testsDir, f));

if (testFiles.length === 0) {
  console.error(`No test files match ${filters.join(', ')}`);
  process.exit(1);
}

function findPgBin() {
  const candidates = [process.env.PG_BIN, '/usr/lib/postgresql/16/bin'].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'initdb'))) return dir;
  }
  const which = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' });
  if (which.status === 0 && fs.existsSync(path.join(which.stdout.trim(), 'initdb'))) {
    return which.stdout.trim();
  }
  throw new Error('Postgres binaries not found. Install Postgres 16 or set PG_BIN.');
}

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

/** Runs a Postgres binary, as the postgres user when we are root (Postgres refuses root). */
function pgRun(bin, args, { allowFail = false } = {}) {
  const [cmd, cmdArgs] = isRoot ? ['runuser', ['-u', 'postgres', '--', bin, ...args]] : [bin, args];
  const res = spawnSync(cmd, cmdArgs, { encoding: 'utf8' });
  if (res.status !== 0 && !allowFail) {
    throw new Error(`${path.basename(bin)} failed (${res.status}):\n${res.stdout}\n${res.stderr}`);
  }
  return res;
}

function lineOf(sql, position) {
  return sql.slice(0, Number(position)).split('\n').length;
}

async function applySql(client, file) {
  const sql = fs.readFileSync(file, 'utf8');
  try {
    await client.query(sql);
  } catch (err) {
    const where = err.position ? ` (line ${lineOf(sql, err.position)})` : '';
    throw new Error(`${path.relative(root, file)}${where}: ${err.message}`);
  }
}

/** Lets a test database hold many homes (app_settings.many_homes, 20261010000500_one_home.sql). */
const MANY_HOMES_SQL = `insert into public.app_settings (id, many_homes) values (true, true)
  on conflict (id) do update set many_homes = true`;

/** DATABASE_URL: the tests make many homes, so that database must allow them. */
async function checkManyHomes(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select to_regclass('public.app_settings') is not null and coalesce((select many_homes from public.app_settings), false) as ok`,
    );
    if (!rows[0].ok) {
      throw new Error(
        'The database tests make many homes, and this database allows one (a deployment holds one home). ' +
          `For a local development database only, run:\n  ${MANY_HOMES_SQL.replace(/\s+/g, ' ')};`,
      );
    }
  } finally {
    await client.end();
  }
}

function runTests(env) {
  const res = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...testFiles], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  return res.status ?? 1;
}

async function withThrowawayPostgres() {
  const bin = findPgBin();
  // Keep the path short: unix socket paths are limited to about 100 bytes.
  const tmp = fs.mkdtempSync(path.join(isRoot ? '/tmp' : os.tmpdir(), 'homeos-db-'));
  const data = path.join(tmp, 'data');
  const log = path.join(tmp, 'postgres.log');
  let started = false;

  const cleanup = () => {
    if (started) {
      pgRun(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { allowFail: true });
      started = false;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  const onSignal = (signal) => {
    cleanup();
    process.kill(process.pid, signal);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    if (isRoot) {
      const uid = spawnSync('id', ['-u', 'postgres'], { encoding: 'utf8' });
      const gid = spawnSync('id', ['-g', 'postgres'], { encoding: 'utf8' });
      fs.chownSync(tmp, Number(uid.stdout), Number(gid.stdout));
    }
    pgRun(path.join(bin, 'initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '--no-locale', '-E', 'UTF8', '--no-sync']);
    const opts = [
      `-p ${port}`,
      `-k ${tmp}`,
      "-c listen_addresses=''",
      '-c fsync=off',
      '-c synchronous_commit=off',
      '-c full_page_writes=off',
    ].join(' ');
    pgRun(path.join(bin, 'pg_ctl'), ['-D', data, '-l', log, '-o', opts, '-w', '-t', '60', 'start']);
    started = true;

    const env = { PGHOST: tmp, PGPORT: String(port), PGUSER: 'postgres', PGDATABASE: 'postgres' };
    const client = new pg.Client({ host: tmp, port, user: 'postgres', database: 'postgres' });
    await client.connect();
    try {
      const { rows } = await client.query('show server_version');
      console.log(`Postgres ${rows[0].server_version} in ${tmp}`);
      await applySql(client, path.join(testsDir, 'supabase_stub.sql'));
      const migrations = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
      // Twice: the migrations must be safe to re-apply.
      for (const pass of [1, 2]) {
        for (const f of migrations) await applySql(client, path.join(migrationsDir, f));
        console.log(`Applied ${migrations.length} migrations (pass ${pass})`);
      }
      // The tests make a home per case: a test database allows many homes (a deployment holds
      // one). The tests of the one-home rule itself run in a fresh database of their own.
      await client.query(MANY_HOMES_SQL);
    } finally {
      await client.end();
    }
    return runTests(env);
  } catch (err) {
    if (fs.existsSync(log)) console.error(fs.readFileSync(log, 'utf8').split('\n').slice(-30).join('\n'));
    throw err;
  } finally {
    cleanup();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

let code;
try {
  if (process.env.DATABASE_URL) {
    console.log('Running against DATABASE_URL (migrations must already be applied)');
    await checkManyHomes(process.env.DATABASE_URL);
    code = runTests({ DATABASE_URL: process.env.DATABASE_URL });
  } else {
    code = await withThrowawayPostgres();
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  code = 1;
}
process.exit(code);
