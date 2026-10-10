// Shared helpers for the database tests (run by scripts/test-db.mjs).
//
// Connects with PG* env vars (throwaway Postgres) or DATABASE_URL (e.g. local Supabase).
// The connection user is an admin (postgres) used for setup and for checking results;
// `as(user, fn)` runs fn inside a transaction as the `authenticated` role with that user's
// JWT claims, exactly like PostgREST does for a signed-in request.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after } from 'node:test';
import pg from 'pg';

// Dates come back as 'YYYY-MM-DD' strings, like PostgREST returns them.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool(
  process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL, max: 6 } : { max: 6 },
);

export const MEMBER_COLORS = ['#007AFF', '#AF52DE', '#30B0C7', '#FF9500', '#34C759', '#FF2D55'];

const createdUsers = new Set();
const createdHouseholds = new Set();

/** Query as the admin connection (bypasses RLS). */
export const db = (sql, params) => pool.query(sql, params);

/** First row of an admin query. */
export async function one(sql, params) {
  const { rows } = await db(sql, params);
  return rows[0];
}

/**
 * The SQL that makes an account as Supabase Auth leaves it after a sign-in: an auth.users row
 * and, unless `google` is false, a Google identity with the same email. The email counts as
 * verified (email_confirmed_at set, and Google's email_verified true, as for every Google
 * account) unless `verified` is false. `google: false` is an email and password account
 * (confirmed or not), which never claims anyone. Run `run(sql, params)` for each statement.
 */
export async function insertAuthUser(run, { id, email, name, verified = true, google = true }) {
  await run(
    `insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
     values ($1, $2, $3, case when $4 then now() end)`,
    [id, email, JSON.stringify({ full_name: name }), verified],
  );
  if (google) {
    const sub = `google-${id}`;
    await run(
      `insert into auth.identities (provider_id, user_id, identity_data, provider)
       values ($1, $2, $3, 'google')`,
      [sub, id, JSON.stringify({ sub, email, email_verified: verified, full_name: name })],
    );
  }
}

/**
 * Creates an account (insertAuthUser). Returns { id, email, name }. A Google account whose
 * email counts as verified unless `verified` is false; `google: false` for an email and
 * password account.
 */
export async function createUser({ name = 'Tester', email, verified = true, google = true } = {}) {
  const id = randomUUID();
  const mail = email ?? `test-${id.slice(0, 8)}@example.com`;
  await insertAuthUser(db, { id, email: mail, name, verified, google });
  createdUsers.add(id);
  return { id, email: mail, name };
}

/**
 * Runs fn(client) in a transaction as `user`:
 * - a user object: role authenticated with claims { sub, email, role } (+ user.claims),
 * - { claims } without id: role authenticated with exactly those claims,
 * - null: role anon without claims.
 * Commits on success, rolls back on error.
 */
export async function as(user, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (user) {
      const claims = user.id
        ? { sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', ...user.claims }
        : user.claims;
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    } else {
      await client.query('set local role anon');
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'anon' })]);
    }
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Runs fn(client) in a transaction as service_role (what the scheduler Edge Function uses). */
export async function asService(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role service_role');
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'service_role' })]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** One statement as `user`; returns the pg result. */
export const q = (user, sql, params) => as(user, (c) => c.query(sql, params));

/** Calls public.<fn>(args...) as `user` and returns its value. */
export async function rpc(user, fn, args = []) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await q(user, `select public.${fn}(${placeholders}) as value`, args);
  return rows[0].value;
}

/** Asserts that the promise rejects with exactly this Postgres error message (or pattern). */
export async function rejects(promise, expected) {
  await assert.rejects(promise, (err) => {
    if (expected instanceof RegExp) assert.match(err.message, expected);
    else assert.equal(err.message, expected);
    return true;
  });
}

/** Today's date in a time zone, according to the database. */
export async function todayIn(tz) {
  return (await one('select (now() at time zone $1)::date as d', [tz])).d;
}

/** date + n days / months, computed by the database (independent of the code under test). */
export async function dateAdd(date, amount) {
  return (await one('select ($1::date + $2::interval)::date as d', [date, amount])).d;
}

export const DEFAULT_AREAS = ['Kitchen', 'Garden', 'Hallway'];

/**
 * Creates a user and their household through create_household.
 * Returns { id, owner, member, areas } with areas as rows ordered by position.
 */
export async function createHousehold({
  name = 'Test Home',
  address = '1 Test Street',
  timezone = 'Europe/London',
  memberName = 'Owner',
  emoji = '🦔',
  areas = DEFAULT_AREAS,
  items = [],
  owner,
} = {}) {
  const user = owner ?? (await createUser({ name: memberName }));
  const id = await rpc(user, 'create_household', [
    name,
    address,
    timezone,
    memberName,
    emoji,
    areas,
    JSON.stringify(items),
  ]);
  createdHouseholds.add(id);
  const member = await one('select * from public.members where user_id = $1', [user.id]);
  const { rows: areaRows } = await db('select * from public.areas where household_id = $1 order by position', [id]);
  return { id, owner: user, member, areas: areaRows };
}

/** Adds a new user to the household through an invite. Returns { user, member }. */
export async function joinHousehold(household, { name = 'Joiner', emoji = '🦆' } = {}) {
  const token = await rpc(household.owner, 'create_invite');
  const user = await createUser({ name });
  await rpc(user, 'join_household', [token, name, emoji]);
  const member = await one('select * from public.members where user_id = $1', [user.id]);
  return { user, member };
}

/** Inserts an item directly (admin). Returns the row. */
export async function insertItem(household, fields = {}) {
  const row = {
    area_id: household.areas[0].id,
    title: 'Test item',
    due_date: null,
    repeat: 'none',
    assignee_id: null,
    ...fields,
  };
  const cols = Object.keys(row);
  const { rows } = await db(
    `insert into public.items (household_id, ${cols.join(', ')})
     values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) returning *`,
    [household.id, ...cols.map((c) => row[c])],
  );
  return rows[0];
}

/** Deletes everything the tests created. Registered automatically by useCleanup(). */
export async function cleanup() {
  const users = [...createdUsers];
  const households = [...createdHouseholds];
  await db(
    `delete from public.households
     where id = any($1::uuid[])
        or id in (select household_id from public.members where user_id = any($2::uuid[]))`,
    [households, users],
  );
  await db('delete from auth.users where id = any($1::uuid[])', [users]);
  createdUsers.clear();
  createdHouseholds.clear();
}

/** Call once at the top of each test file. */
export function useCleanup() {
  after(async () => {
    try {
      await cleanup();
    } finally {
      await pool.end();
    }
  });
}

/** Marks a household id for cleanup (for households created without createHousehold). */
export function trackHousehold(id) {
  createdHouseholds.add(id);
}
