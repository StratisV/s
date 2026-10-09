#!/usr/bin/env node
// Applies supabase/migrations/*.sql to the production database during the Vercel build,
// so a deploy brings the database up to date by itself.
//
// - The connection comes from the Vercel and Supabase integration (POSTGRES_URL_NON_POOLING,
//   a direct connection), or SUPABASE_DB_URL / MIGRATE_DATABASE_URL. Without one it does
//   nothing (demo mode, local builds).
// - On Vercel it only runs for production builds (VERCEL_ENV=production); elsewhere always.
// - Each migration runs in its own transaction and is recorded in
//   supabase_migrations.schema_migrations, the table the Supabase CLI uses, so the CLI and
//   this script agree on what has been applied. Migrations are written to be re-runnable.
// - An advisory lock stops two builds from migrating at the same time.
//
// Flags: --dry-run applies the pending migrations in one transaction and rolls back (to
// check them); --all treats every migration as pending (with --dry-run, to check them all).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'supabase', 'migrations');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const all = args.has('--all');

const url = process.env.MIGRATE_DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL_NON_POOLING;
if (!url) {
  console.log('migrate: no database configured, skipping.');
  process.exit(0);
}
if (process.env.VERCEL && process.env.VERCEL_ENV !== 'production') {
  console.log(`migrate: ${process.env.VERCEL_ENV} build, skipping (only production builds migrate).`);
  process.exit(0);
}

/** The connection, with TLS for hosted databases (Supabase's certificate chain is not in Node's store). */
function config(connectionString) {
  const u = new URL(connectionString);
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  u.searchParams.delete('sslmode');
  u.searchParams.delete('supa');
  return { connectionString: u.toString(), ssl: local ? false : { rejectUnauthorized: false } };
}

const files = fs
  .readdirSync(dir)
  .filter((f) => /^\d+_.+\.sql$/.test(f))
  .sort();

const client = new pg.Client(config(url));
await client.connect();
const LOCK = 74_210_031; // any constant shared by every build of this app
try {
  await client.query('select pg_advisory_lock($1)', [LOCK]);
  await client.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    );`);
  const applied = new Set(
    (await client.query('select version from supabase_migrations.schema_migrations')).rows.map((r) => r.version),
  );
  const pending = files.filter((f) => all || !applied.has(f.split('_')[0]));
  if (pending.length === 0) {
    console.log(`migrate: up to date (${files.length} migrations).`);
  } else if (dryRun) {
    await client.query('begin');
    try {
      for (const f of pending) {
        await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
        console.log(`migrate: ok ${f}`);
      }
    } finally {
      await client.query('rollback');
    }
    console.log(`migrate: dry run, ${pending.length} migrations applied cleanly and rolled back.`);
  } else {
    for (const f of pending) {
      const [version, ...rest] = f.replace(/\.sql$/, '').split('_');
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query(
          `insert into supabase_migrations.schema_migrations (version, name, statements)
           values ($1, $2, array[$3]) on conflict (version) do nothing`,
          [version, rest.join('_'), sql],
        );
        await client.query('commit');
        console.log(`migrate: applied ${f}`);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`migrate: ${f} failed: ${err.message}`);
      }
    }
  }
} finally {
  await client.query('select pg_advisory_unlock($1)', [LOCK]).catch(() => {});
  await client.end();
}
