// One home per deployment, as the database keeps it (20261010000500_one_home.sql:
// households_one_home, reachable_home, verified_email, import_household).
//
// The shared test database allows many homes (the other files make one per case), so these
// tests make a fresh database of their own, as a real deployment has it: the stub and every
// migration applied, app_settings.many_homes off, and no home until a test makes one. Each
// test starts from an empty database (every household and account is removed in between).

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { insertAuthUser, rejects } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const NAME = `homeos_deployment_${randomUUID().slice(0, 8)}`;
const PAYLOAD = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'demo-import.json'), 'utf8'));

/** Connection settings for database `name`: DATABASE_URL with another path, or the PG* env. */
function settings(name) {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = `/${name}`;
    return { connectionString: url.toString() };
  }
  return { database: name };
}

let pool;
/** Why these tests cannot run here (no right to create a database), or null. */
let unavailable = null;

before(async () => {
  const admin = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  await admin.connect();
  try {
    await admin.query(`create database ${NAME}`);
  } catch (err) {
    unavailable = `cannot create a database here (${err.message})`;
    return;
  } finally {
    await admin.end();
  }
  pool = new pg.Pool({ ...settings(NAME), max: 6 });
  const setup = await pool.connect();
  try {
    await setup.query(fs.readFileSync(path.join(here, 'supabase_stub.sql'), 'utf8'));
    for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
      await setup.query(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
    }
  } finally {
    setup.release();
  }
});

after(async () => {
  if (pool) await pool.end();
  if (unavailable) return;
  const admin = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${NAME} with (force)`);
  } finally {
    await admin.end();
  }
});

// Every test starts with no home and no accounts.
beforeEach(async () => {
  if (unavailable) return;
  await pool.query('delete from public.households');
  await pool.query('delete from auth.users');
  await pool.query('delete from public.app_settings');
});

/** The test, or a skip that says why it cannot run here. */
const it = (name, fn) =>
  test(name, async (t) => {
    if (unavailable) {
      t.skip(unavailable);
      return;
    }
    await fn();
  });

const admin = (sql, params) => pool.query(sql, params);
const adminOne = async (sql, params) => (await admin(sql, params)).rows[0];
const homes = async () => (await admin('select id from public.households order by created_at, id')).rows.map((r) => r.id);

/** A Google account (or `google: false`: email and password), verified unless `verified` is false. */
async function user({ name = 'Tester', email, verified = true, google = true } = {}) {
  const id = randomUUID();
  const mail = email ?? `deploy-${id.slice(0, 8)}@example.com`;
  await insertAuthUser(admin, { id, email: mail, name, verified, google });
  return { id, email: mail, name };
}

/** Runs fn(client) in a transaction as `who` (a user, or 'service' for the service role). */
async function as(who, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (who === 'service') {
      await client.query('set local role service_role');
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'service_role' })]);
    } else {
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: who.id, email: who.email, role: 'authenticated', aud: 'authenticated' }),
      ]);
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

async function rpc(who, fn, args = []) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  return as(who, async (c) => (await c.query(`select public.${fn}(${placeholders}) as value`, args)).rows[0].value);
}

const createHome = (who, name = 'Our home') =>
  rpc(who, 'create_household', [name, '21 Alderbrook Road', 'Europe/London', who.name, '🦆', ['Kitchen', 'Garden'], '[]']);

/** Calls `first` and holds its transaction open until `second` has started and waited 150 ms. */
async function race(firstWho, firstSql, firstArgs, second) {
  let started;
  const hasStarted = new Promise((r) => (started = r));
  let release;
  const gate = new Promise((r) => (release = r));
  const first = as(firstWho, async (c) => {
    const { rows } = await c.query(firstSql, firstArgs);
    started();
    await gate;
    return rows[0].value;
  }).then(
    (v) => ({ v }),
    (err) => ({ err }),
  );
  await hasStarted;
  const other = second().then(
    (v) => ({ v }),
    (err) => ({ err }),
  );
  await new Promise((r) => setTimeout(r, 150));
  release();
  return [await first, await other];
}

describe('one home per deployment', () => {
  it('the first person creates the home; nobody signed in can create a second one', async () => {
    const stratis = await user({ name: 'Stratis' });
    const home = await createHome(stratis);
    assert.deepEqual(await homes(), [home]);

    const stranger = await user({ name: 'Stranger' });
    assert.equal((await rpc(stranger, 'enter_home')).status, 'private');
    await rejects(createHome(stranger, 'Second home'), 'home_exists');
    // Nothing of it was kept.
    assert.deepEqual(await homes(), [home]);
    assert.equal(await adminOne('select 1 from public.members where user_id = $1', [stranger.id]), undefined);
    // Bringing a home over is refused the same way.
    await rejects(rpc(stranger, 'import_household', [JSON.stringify(PAYLOAD)]), 'home_exists');
  });

  it('the service role and the database owner are not limited (an admin can add a household)', async () => {
    const stratis = await user();
    await createHome(stratis);
    await as('service', (c) => c.query(`insert into public.households (name) values ('Made by an admin')`));
    await admin(`insert into public.households (name) values ('Made in the SQL editor')`);
    assert.equal((await homes()).length, 3);
  });

  it('many_homes (development and test databases only) lets signed-in people create more homes', async () => {
    await createHome(await user());
    await admin('insert into public.app_settings (id, many_homes) values (true, true)');
    await createHome(await user(), 'Second home');
    assert.equal((await homes()).length, 2);
    await admin('update public.app_settings set many_homes = false');
    await rejects(createHome(await user(), 'Third home'), 'home_exists');
    // Clients can neither read nor change the setting.
    const someone = await user();
    await rejects(rpc(someone, 'many_homes'), /permission denied/);
    await rejects(
      as(someone, (c) => c.query('update public.app_settings set many_homes = true')),
      /permission denied/,
    );
  });

  it('two people creating at once: one home', async () => {
    const a = await user({ name: 'Ada' });
    const b = await user({ name: 'Bea' });
    const [first, second] = await race(
      a,
      `select public.create_household('A home', '', 'Europe/London', 'Ada', '🦆', array['Kitchen'], '[]') as value`,
      [],
      () => createHome(b, 'B home'),
    );
    assert.equal(first.err, undefined);
    assert.equal(second.err?.message, 'home_exists');
    assert.deepEqual(await homes(), [first.v]);
  });

  it('creating while someone brings their home over, at once: one home', async () => {
    const stratis = await user({ name: 'Stratis' });
    const shea = await user({ name: 'Shea' });
    const [imported, created] = await race(
      stratis,
      'select public.import_household($1) as value',
      [JSON.stringify(PAYLOAD)],
      () => createHome(shea, 'Shea home'),
    );
    assert.equal(imported.err, undefined);
    assert.equal(created.err?.message, 'home_exists');
    assert.deepEqual(await homes(), [imported.v]);

    // And the other way round.
    await admin('delete from public.households');
    const ela = await user({ name: 'Ela' });
    const robin = await user({ name: 'Robin' });
    const [made, brought] = await race(
      ela,
      `select public.create_household('Ela home', '', 'Europe/London', 'Ela', '🦊', array['Kitchen'], '[]') as value`,
      [],
      () => rpc(robin, 'import_household', [JSON.stringify(PAYLOAD)]),
    );
    assert.equal(made.err, undefined);
    assert.equal(brought.err?.message, 'home_exists');
    assert.deepEqual(await homes(), [made.v]);
  });
});

describe('claims and joins only reach the deployment’s home', () => {
  /** The real home with Shea waiting, and a household an admin added later with a Shea of its own. */
  async function twoHouseholds() {
    const owner = await user({ name: 'Stratis' });
    const home = await createHome(owner);
    const realShea = await rpc(owner, 'add_person', [home, 'Shea', '🦔', 'shea@gmail.com']);
    const stray = await as('service', async (c) => (await c.query(`insert into public.households (name) values ('Stray') returning id`)).rows[0].id);
    // Older than the real Shea, so "oldest person first" alone would pick it.
    const strayShea = (
      await admin(
        `insert into public.members (household_id, name, email, color, created_at)
         values ($1, 'Shea', 'shea@gmail.com', '#AF52DE', now() - interval '1 day') returning id`,
        [stray],
      )
    ).rows[0].id;
    const ghost = (
      await admin(
        `insert into public.members (household_id, name, email, color) values ($1, 'Ghost', 'ghost@gmail.com', '#AF52DE') returning id`,
        [stray],
      )
    ).rows[0].id;
    return { owner, home, realShea, stray, strayShea, ghost };
  }

  it('a person with the same email in another household is never claimed', async () => {
    const { home, realShea, strayShea, ghost } = await twoHouseholds();
    const shea = await user({ name: 'Shea', email: 'Shea@Gmail.com' });
    assert.deepEqual(await rpc(shea, 'enter_home'), {
      status: 'claimed',
      household_id: home,
      member_id: realShea,
      can_import: true,
    });
    assert.equal((await adminOne('select user_id from public.members where id = $1', [strayShea])).user_id, null);
    // Someone only the other household has: told the home is private, and nobody is claimed.
    const g = await user({ email: 'ghost@gmail.com' });
    assert.equal((await rpc(g, 'enter_home')).status, 'private');
    assert.equal((await adminOne('select user_id from public.members where id = $1', [ghost])).user_id, null);
  });

  it('an invite to another household is not valid: no preview, no join, no joining as someone', async () => {
    const { stray, ghost } = await twoHouseholds();
    const token = 'f'.repeat(32);
    await admin('insert into public.invites (household_id, token) values ($1, $2)', [stray, token]);
    const someone = await user({ email: 'ghost@gmail.com' });
    assert.equal(await rpc(someone, 'invite_preview', [token]), null);
    await rejects(rpc(someone, 'join_household', [token, 'Ghost', '🦔']), 'invalid_invite');
    await rejects(rpc(someone, 'join_as_person', [token, ghost]), 'invalid_invite');
    assert.equal(await adminOne('select 1 from public.members where user_id = $1', [someone.id]), undefined);
  });

  it('the review’s hijack, step by step, now goes nowhere', async () => {
    // (1) The real home exists; a stranger is told it is private.
    const owner = await user({ name: 'Stratis' });
    const home = await createHome(owner);
    const stranger = await user({ name: 'Stranger' });
    assert.equal((await rpc(stranger, 'enter_home')).status, 'private');
    // (2) The stranger cannot make a second home, so (3) there is nowhere to add Shea.
    await rejects(createHome(stranger, 'Evil home'), 'home_exists');
    // (4) The owner adds Shea; (5) Shea signs in and is Shea, in the real home.
    const realShea = await rpc(owner, 'add_person', [home, 'Shea', '🦔', 'shea@gmail.com']);
    const shea = await user({ email: 'shea@gmail.com' });
    const entry = await rpc(shea, 'enter_home');
    assert.deepEqual([entry.status, entry.household_id, entry.member_id], ['claimed', home, realShea]);
  });
});

describe('only a Google-verified email claims', () => {
  it('an email and password account with a waiting person’s email, even confirmed, gets "private"', async () => {
    const owner = await user();
    const home = await createHome(owner);
    const person = await rpc(owner, 'add_person', [home, 'Shea', '🦔', 'shea@gmail.com']);
    const password = await user({ email: 'shea@gmail.com', google: false });
    assert.deepEqual(await rpc(password, 'enter_home'), { status: 'private', email: 'shea@gmail.com', email_verified: false });
    const token = await rpc(owner, 'create_invite');
    // Through an invite they join as someone new, without the email; Shea keeps waiting.
    await rpc(password, 'join_household', [token, 'Not Shea', '🦊']);
    assert.deepEqual(await adminOne('select name, email from public.members where user_id = $1', [password.id]), {
      name: 'Not Shea',
      email: '',
    });
    assert.equal((await adminOne('select user_id from public.members where id = $1', [person])).user_id, null);
    // A person with that email can't be taken through the invite either.
    const other = await user({ email: 'shea@gmail.com', google: false });
    await rejects(rpc(other, 'join_as_person', [token, person]), 'not_found');
  });

  it('a Google identity for another email, or one Google has not verified, does not count', async () => {
    const owner = await user();
    const home = await createHome(owner);
    await rpc(owner, 'add_person', [home, 'Shea', '🦔', 'shea@gmail.com']);
    // The account's email is Shea's, but its Google identity is someone else's.
    const linked = await user({ email: 'shea@gmail.com', google: false });
    await admin(
      `insert into auth.identities (provider_id, user_id, identity_data, provider)
       values ('g-other', $1, '{"email": "attacker@gmail.com", "email_verified": true}', 'google')`,
      [linked.id],
    );
    assert.equal((await rpc(linked, 'enter_home')).status, 'private');
    const unverified = await user({ email: 'shea@gmail.com', verified: false });
    assert.equal((await rpc(unverified, 'enter_home')).status, 'private');
    // The real Google account still claims her.
    const shea = await user({ email: 'shea@gmail.com' });
    assert.equal((await rpc(shea, 'enter_home')).status, 'claimed');
  });
});
