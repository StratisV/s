// One home, people who have not joined yet, and bringing the home over from a phone
// (supabase/migrations/20261010000500_one_home.sql, docs/ARCHITECTURE.md "One home").
//
// "No home exists yet" cannot happen in a shared test database, so the tests that need it run
// in one transaction that replaces home_exists() (only homes created in that transaction
// count) and is always rolled back (rolledBack below): nothing they do, the replacement
// included, is ever seen by anyone else.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  as,
  createHousehold,
  createUser,
  db,
  insertAuthUser,
  insertItem,
  joinHousehold,
  MEMBER_COLORS,
  one,
  pool,
  q,
  rejects,
  rpc,
  useCleanup,
} from './helpers.mjs';

useCleanup();

const PAYLOAD = JSON.parse(readFileSync(new URL('./fixtures/demo-import.json', import.meta.url), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));

/** A member row by id (admin). */
const memberRow = (id) => one('select * from public.members where id = $1', [id]);

/** Adds a not-yet-joined person through add_person as `by`. Returns their row. */
async function addPerson(household, by, { name = 'Shea', emoji = '🦔', email = '' } = {}) {
  const id = await rpc(by, 'add_person', [household.id, name, emoji, email]);
  return memberRow(id);
}

/**
 * Runs fn(tx) in one transaction that is always rolled back, so it can pretend no home exists
 * (tx.noHome()) and leaves nothing behind. tx.as(user, sql, params) runs one statement as
 * `user` (like helpers.as), tx.rpc(user, fn, args) calls an RPC, tx.admin(sql, params) runs as
 * the admin. A failing statement is rolled back to a savepoint, so the transaction goes on.
 */
async function rolledBack(fn) {
  const client = await pool.connect();
  let sp = 0;
  const step = async (run) => {
    const name = `s${++sp}`;
    await client.query(`savepoint ${name}`);
    try {
      const res = await run();
      await client.query(`release savepoint ${name}`);
      return res;
    } catch (err) {
      await client.query(`rollback to savepoint ${name}`);
      throw err;
    }
  };
  const tx = {
    admin: (sql, params) => step(() => client.query(sql, params)),
    async adminOne(sql, params) {
      return (await tx.admin(sql, params)).rows[0];
    },
    as: (user, sql, params) =>
      step(async () => {
        const claims = user
          ? user.id
            ? { sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', ...user.claims }
            : user.claims
          : { role: 'anon' };
        await client.query(`set local role ${user ? 'authenticated' : 'anon'}`);
        await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
        const res = await client.query(sql, params);
        await client.query('reset role');
        return res;
      }),
    async rpc(user, fn, args = []) {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
      const res = await tx.as(user, `select public.${fn}(${placeholders}) as value`, args);
      return res.rows[0].value;
    },
    /** A verified (unless verified: false) Google account that exists only in this transaction. */
    async user({ name = 'Tester', email, verified = true, google = true } = {}) {
      const id = randomUUID();
      const mail = email ?? `tx-${id.slice(0, 8)}@example.com`;
      await insertAuthUser(tx.admin, { id, email: mail, name, verified, google });
      return { id, email: mail, name };
    },
    /**
     * From here on, for this transaction only, the homes that exist are the ones it created
     * (their created_at is the transaction's now()): none until it creates one.
     */
    noHome: () =>
      tx.admin(`create or replace function public.home_exists() returns boolean language sql stable
                security definer set search_path = ''
                as $$ select exists (select 1 from public.households h where h.created_at = now()) $$`),
  };
  try {
    await client.query('begin');
    return await fn(tx);
  } finally {
    await client.query('rollback').catch(() => {});
    client.release();
  }
}

/** Imports `payload` as `user` in tx (with no home pretended). Returns the household id. */
const importAs = (tx, user, payload = PAYLOAD) => tx.rpc(user, 'import_household', [JSON.stringify(payload)]);

// ─────────────────────────────────────────────────────────────────────────────

describe('schema', () => {
  test('members.user_id is nullable and still unique; email has a length limit', async () => {
    const col = await one(
      `select is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'members' and column_name = 'user_id'`,
    );
    assert.equal(col.is_nullable, 'YES');
    const h = await createHousehold();
    await rejects(
      db(`insert into public.members (household_id, user_id, name, color) values ($1, $2, 'Twin', '#000000')`, [
        h.id,
        h.owner.id,
      ]),
      /members_user_id_key/,
    );
    await rejects(
      db(`insert into public.members (household_id, name, color, email) values ($1, 'Long', '#000000', $2)`, [
        h.id,
        `${'a'.repeat(243)}@example.com`,
      ]),
      /members_email_length/,
    );
  });

  test('emails are stored trimmed and lower-case, unique per home (blank ones aside)', async () => {
    const h = await createHousehold();
    const other = await createHousehold();
    const { rows } = await db(
      `insert into public.members (household_id, name, color, email)
       values ($1, 'A', '#000000', '  Mixed.Case@Example.COM '), ($1, 'B', '#000000', ''), ($1, 'C', '#000000', '')
       returning email`,
      [h.id],
    );
    assert.deepEqual(rows.map((r) => r.email), ['mixed.case@example.com', '', '']);
    await rejects(
      db(`insert into public.members (household_id, name, color, email) values ($1, 'D', '#000000', 'MIXED.case@example.com')`, [h.id]),
      /members_household_email_key/,
    );
    // Another home may have the same email.
    await db(`insert into public.members (household_id, name, color, email) values ($1, 'E', '#000000', 'mixed.case@example.com')`, [
      other.id,
    ]);
  });

  test('someone who has not joined never has push on', async () => {
    const h = await createHousehold();
    const person = await addPerson(h, h.owner);
    await q(h.owner, 'update public.members set push_enabled = true where id = $1', [person.id]);
    assert.equal((await memberRow(person.id)).push_enabled, false);
    // Someone who has joined can turn it on as before.
    await q(h.owner, 'update public.members set push_enabled = true where id = $1', [h.member.id]);
    assert.equal((await memberRow(h.member.id)).push_enabled, true);
  });

  test('functions: the RPCs are callable by signed-in users only, the helpers by nobody', async () => {
    const { rows } = await db(
      `select p.proname, p.prosecdef, p.proconfig,
              has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'`,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.proname, r]));
    for (const name of ['enter_home', 'add_person', 'set_person_email', 'remove_person', 'import_household', 'join_household']) {
      assert.ok(byName[name], `missing ${name}`);
      assert.equal(byName[name].prosecdef, true, `${name} is security definer`);
      assert.ok((byName[name].proconfig ?? []).some((c) => c === 'search_path=""' || c === 'search_path='), name);
      assert.equal(byName[name].auth_exec, true, `authenticated can call ${name}`);
      assert.equal(byName[name].anon_exec, false, `anon cannot call ${name}`);
    }
    const internal = [
      'members_before_write',
      'verified_email',
      'account_email',
      'home_exists',
      'is_valid_email',
      'import_text',
      'import_key',
      'import_ref',
      'import_timestamp',
      'import_date',
      'import_choice',
    ];
    for (const name of internal) {
      assert.ok(byName[name], `missing ${name}`);
      assert.equal(byName[name].auth_exec, false, `authenticated can call ${name}`);
      assert.equal(byName[name].anon_exec, false, `anon can call ${name}`);
    }
  });
});

describe('a person who has not joined grants nothing', () => {
  test('a JWT without a user, anon and strangers see nothing of the home', async () => {
    const h = await createHousehold();
    const person = await addPerson(h, h.owner, { email: 'waiting@example.com' });
    const noUser = { claims: { role: 'authenticated', aud: 'authenticated' } };
    const res = await q(
      noUser,
      `select (select count(*)::int from public.members where household_id = $1) as members,
              (select count(*)::int from public.households where id = $1) as households,
              public.is_household_member($1) as is_member,
              public.current_member_id() as me`,
      [h.id],
    );
    assert.deepEqual(res.rows[0], { members: 0, households: 0, is_member: false, me: null });
    const stranger = await createUser();
    const seen = await q(stranger, 'select count(*)::int as n from public.members where id = $1', [person.id]);
    assert.equal(seen.rows[0].n, 0);
    await rejects(q(null, 'select * from public.members'), /permission denied/);
  });

  test('members see, edit and assign them like anyone else, but not their email or account', async () => {
    const h = await createHousehold();
    const person = await addPerson(h, h.owner, { name: 'Shea', email: 'shea@example.com' });
    const seen = await q(h.owner, 'select name, user_id from public.members where id = $1', [person.id]);
    assert.deepEqual(seen.rows[0], { name: 'Shea', user_id: null });
    await q(h.owner, `update public.members set name = 'Shea B', emoji = '🦆' where id = $1`, [person.id]);
    assert.equal((await memberRow(person.id)).name, 'Shea B');
    await rejects(q(h.owner, `update public.members set email = 'x@example.com' where id = $1`, [person.id]), /permission denied/);
    await rejects(q(h.owner, 'update public.members set user_id = $2 where id = $1', [person.id, h.owner.id]), /permission denied/);

    // Assigned, completed and credited.
    const res = await q(
      h.owner,
      `insert into public.items (household_id, area_id, title, assignee_id) values ($1, $2, 'Bins', $3) returning id`,
      [h.id, h.areas[0].id, person.id],
    );
    const completion = await rpc(h.owner, 'complete_item', [res.rows[0].id]);
    const c = await one('select credited_to, completed_by from public.completions where id = $1', [completion]);
    assert.deepEqual(c, { credited_to: person.id, completed_by: h.member.id });
  });
});

describe('add_person', () => {
  test('adds someone who has not joined: member role, next colour, email in stored form', async () => {
    const h = await createHousehold();
    const joiner = await joinHousehold(h);
    const person = await addPerson(h, joiner.user, { name: '  Shea  ', emoji: '🦔', email: '  Shea@Example.com ' });
    assert.equal(person.household_id, h.id);
    assert.equal(person.user_id, null);
    assert.equal(person.name, 'Shea');
    assert.equal(person.email, 'shea@example.com');
    assert.equal(person.role, 'member');
    assert.equal(person.color, MEMBER_COLORS[2]);
    assert.equal(person.weekly_email, true);
    assert.equal(person.push_enabled, false);
    // Without an email, and a blank emoji becomes the hedgehog.
    const second = await addPerson(h, h.owner, { name: 'Ela', emoji: ' ', email: '' });
    assert.equal(second.email, '');
    assert.equal(second.emoji, '🦔');
    assert.equal(second.color, MEMBER_COLORS[3]);
    await addPerson(h, h.owner, { name: 'Third', email: '' });
  });

  test('email_taken: another person (or a member) in the home has the email, in any case', async () => {
    const owner = await createUser({ email: 'stratis@example.com' });
    const h = await createHousehold({ owner });
    await addPerson(h, owner, { email: 'shea@example.com' });
    await rejects(rpc(owner, 'add_person', [h.id, 'Shea again', '🦔', 'SHEA@example.com']), 'email_taken');
    await rejects(rpc(owner, 'add_person', [h.id, 'Me again', '🦔', 'Stratis@Example.com']), 'email_taken');
    // Another home can add the same email.
    const other = await createHousehold();
    await addPerson(other, other.owner, { email: 'shea@example.com' });
  });

  test('invalid_input, not_found and not_signed_in', async () => {
    const h = await createHousehold();
    const stranger = await createHousehold();
    await rejects(rpc(h.owner, 'add_person', [h.id, '  ', '🦔', '']), 'invalid_input');
    for (const bad of ['shea', 'shea@', 'shea@example', 'she a@example.com', 'a@b@c.com']) {
      await rejects(rpc(h.owner, 'add_person', [h.id, 'Shea', '🦔', bad]), 'invalid_input');
    }
    await rejects(rpc(h.owner, 'add_person', [h.id, 'x'.repeat(41), '🦔', '']), /members_name_length/);
    await rejects(rpc(stranger.owner, 'add_person', [h.id, 'Sneaky', '🦔', '']), 'not_found');
    await rejects(rpc(h.owner, 'add_person', [randomUUID(), 'Nowhere', '🦔', '']), 'not_found');
    await rejects(rpc({ claims: { role: 'authenticated' } }, 'add_person', [h.id, 'Nobody', '🦔', '']), 'not_signed_in');
    assert.equal((await one('select count(*)::int as n from public.members where household_id = $1', [h.id])).n, 1);
  });
});

describe('set_person_email', () => {
  test('sets, changes and clears the email of someone who has not joined', async () => {
    const h = await createHousehold();
    const person = await addPerson(h, h.owner);
    await rpc(h.owner, 'set_person_email', [person.id, ' Shea@Example.com ']);
    assert.equal((await memberRow(person.id)).email, 'shea@example.com');
    await rpc(h.owner, 'set_person_email', [person.id, 'shea@example.com']);
    await rpc(h.owner, 'set_person_email', [person.id, 'shea.b@example.com']);
    assert.equal((await memberRow(person.id)).email, 'shea.b@example.com');
    await rpc(h.owner, 'set_person_email', [person.id, '']);
    assert.equal((await memberRow(person.id)).email, '');
  });

  test('email_taken, invalid_input for someone who has joined or a non-email, not_found outside the home', async () => {
    const owner = await createUser({ email: 'owner@example.com' });
    const h = await createHousehold({ owner });
    const shea = await addPerson(h, owner, { email: 'shea@example.com' });
    const ela = await addPerson(h, owner, { name: 'Ela' });
    await rejects(rpc(owner, 'set_person_email', [ela.id, 'SHEA@example.com']), 'email_taken');
    await rejects(rpc(owner, 'set_person_email', [ela.id, 'owner@example.com']), 'email_taken');
    await rejects(rpc(owner, 'set_person_email', [ela.id, 'not an email']), 'invalid_input');
    await rejects(rpc(owner, 'set_person_email', [h.member.id, 'new@example.com']), 'invalid_input');
    const stranger = await createHousehold();
    await rejects(rpc(stranger.owner, 'set_person_email', [shea.id, 'mine@example.com']), 'not_found');
    await rejects(rpc(owner, 'set_person_email', [randomUUID(), 'x@example.com']), 'not_found');
    assert.equal((await memberRow(ela.id)).email, '');
  });
});

describe('remove_person', () => {
  test('removes someone who has not joined; their items become unassigned, their credits go', async () => {
    const h = await createHousehold();
    const person = await addPerson(h, h.owner);
    const item = await insertItem(h, { assignee_id: person.id, title: 'Leaves' });
    const done = await insertItem(h, { assignee_id: person.id, title: 'Weeds' });
    const completion = await rpc(h.owner, 'complete_item', [done.id]);
    await rpc(h.owner, 'remove_person', [person.id]);
    assert.equal(await memberRow(person.id), undefined);
    assert.equal((await one('select assignee_id from public.items where id = $1', [item.id])).assignee_id, null);
    assert.equal((await one('select credited_to from public.completions where id = $1', [completion])).credited_to, null);
  });

  test('invalid_input for someone who has joined, not_found outside the home', async () => {
    const h = await createHousehold();
    const joiner = await joinHousehold(h);
    const person = await addPerson(h, h.owner);
    await rejects(rpc(h.owner, 'remove_person', [joiner.member.id]), 'invalid_input');
    await rejects(rpc(h.owner, 'remove_person', [h.member.id]), 'invalid_input');
    const stranger = await createHousehold();
    await rejects(rpc(stranger.owner, 'remove_person', [person.id]), 'not_found');
    await rejects(rpc(h.owner, 'remove_person', [randomUUID()]), 'not_found');
    assert.ok(await memberRow(person.id));
  });
});

describe('enter_home', () => {
  test('member: already in a home', async () => {
    const h = await createHousehold();
    // Set up and not used since: the home from a phone may still replace what is in it.
    assert.deepEqual(await rpc(h.owner, 'enter_home'), {
      status: 'member',
      household_id: h.id,
      member_id: h.member.id,
      can_import: true,
    });
    await insertItem(h, { title: 'Bins' });
    assert.equal((await rpc(h.owner, 'enter_home')).can_import, false);
  });

  test('claimed: the person with this verified email (any case) becomes the account, keeping everything', async () => {
    const h = await createHousehold();
    const person = await addPerson(h, h.owner, { name: 'Shea', emoji: '🦆', email: 'shea.claims@example.com' });
    const item = await insertItem(h, { assignee_id: person.id, title: 'Rubbish fill level' });
    const shea = await createUser({ name: 'Shea Google', email: 'Shea.Claims@Example.com' });

    assert.deepEqual(await rpc(shea, 'enter_home'), {
      status: 'claimed',
      household_id: h.id,
      member_id: person.id,
      can_import: false,
    });
    const row = await memberRow(person.id);
    assert.equal(row.user_id, shea.id);
    assert.ok(row.claimed_at, 'claimed_at is set');
    assert.deepEqual([row.name, row.emoji, row.color, row.role], ['Shea', '🦆', person.color, 'member']);
    assert.equal((await one('select assignee_id from public.items where id = $1', [item.id])).assignee_id, person.id);
    // Now a member like anyone else.
    assert.deepEqual(await rpc(shea, 'enter_home'), {
      status: 'member',
      household_id: h.id,
      member_id: person.id,
      can_import: false,
    });
    const seen = await q(shea, 'select count(*)::int as n from public.items where household_id = $1', [h.id]);
    assert.equal(seen.rows[0].n, 1);
    assert.equal(await rpc(shea, 'current_member_id'), person.id);
  });

  test('private: a home exists and nobody has this email; an unverified email never claims', async () => {
    const h = await createHousehold();
    await addPerson(h, h.owner, { email: 'unverified@example.com' });
    const stranger = await createUser({ email: 'Someone.Else@Example.com' });
    assert.deepEqual(await rpc(stranger, 'enter_home'), {
      status: 'private',
      email: 'someone.else@example.com',
      email_verified: true,
    });
    const unverified = await createUser({ email: 'unverified@example.com', verified: false });
    assert.deepEqual(await rpc(unverified, 'enter_home'), {
      status: 'private',
      email: 'unverified@example.com',
      email_verified: false,
    });
    assert.equal(await one('select 1 from public.members where user_id = $1', [unverified.id]), undefined);
  });

  test('someone who has joined is never claimed by another account with the same email', async () => {
    const owner = await createUser({ email: 'taken@example.com' });
    await createHousehold({ owner });
    const twin = await createUser({ email: 'taken@example.com' });
    assert.equal((await rpc(twin, 'enter_home')).status, 'private');
  });

  test('no_home: nobody is in a home and no home exists', async () => {
    await rolledBack(async (tx) => {
      await tx.noHome();
      const first = await tx.user({ email: 'first@example.com' });
      assert.deepEqual(await tx.rpc(first, 'enter_home'), { status: 'no_home' });
    });
  });

  test('not_signed_in without a user', async () => {
    await rejects(rpc({ claims: { role: 'authenticated' } }, 'enter_home'), 'not_signed_in');
  });

  test('two accounts claiming the same person at once: one wins, the other is told the home is private', async () => {
    const h = await createHousehold();
    const person = await addPerson(h, h.owner, { email: 'race@example.com' });
    const a = await createUser({ email: 'race@example.com' });
    const b = await createUser({ email: 'race@example.com' });
    let claimed;
    const hasClaimed = new Promise((r) => (claimed = r));
    let release;
    const gate = new Promise((r) => (release = r));
    const first = as(a, async (c) => {
      const { rows } = await c.query('select public.enter_home() as v');
      claimed();
      await gate;
      return rows[0].v;
    });
    await hasClaimed;
    // Not committed yet: b's claim waits on the row, then finds it taken.
    const second = rpc(b, 'enter_home');
    const settled = second.then(
      (v) => ({ v }),
      (err) => ({ err }),
    );
    await new Promise((r) => setTimeout(r, 150));
    release();
    assert.equal((await first).status, 'claimed');
    const out = await settled;
    assert.equal(out.err, undefined);
    assert.equal(out.v.status, 'private');
    assert.equal((await memberRow(person.id)).user_id, a.id);
  });

  test('an email changed in People while someone signs in with the old one: no claim', async () => {
    const h = await createHousehold();
    const person = await addPerson(h, h.owner, { email: 'typo@example.com' });
    const user = await createUser({ email: 'typo@example.com' });
    let changed;
    const hasChanged = new Promise((r) => (changed = r));
    let release;
    const gate = new Promise((r) => (release = r));
    const fix = as(h.owner, async (c) => {
      await c.query('select public.set_person_email($1, $2)', [person.id, 'right@example.com']);
      changed();
      await gate;
    });
    await hasChanged;
    // Not committed yet: the claim reads the old email, waits on the row, then finds it changed.
    const entering = rpc(user, 'enter_home');
    const settled = entering.then(
      (v) => ({ v }),
      (err) => ({ err }),
    );
    await new Promise((r) => setTimeout(r, 150));
    release();
    await fix;
    const out = await settled;
    assert.equal(out.err, undefined);
    assert.equal(out.v.status, 'private');
    assert.deepEqual(await one('select user_id, email from public.members where id = $1', [person.id]), {
      user_id: null,
      email: 'right@example.com',
    });
  });

  test('the same account in two tabs: one claim, the other call sees it as a member', async () => {
    const h = await createHousehold();
    const person = await addPerson(h, h.owner, { email: 'tabs@example.com' });
    const user = await createUser({ email: 'tabs@example.com' });
    let claimed;
    const hasClaimed = new Promise((r) => (claimed = r));
    let release;
    const gate = new Promise((r) => (release = r));
    const first = as(user, async (c) => {
      const { rows } = await c.query('select public.enter_home() as v');
      claimed();
      await gate;
      return rows[0].v;
    });
    await hasClaimed;
    const second = rpc(user, 'enter_home');
    const settled = second.then(
      (v) => ({ v }),
      (err) => ({ err }),
    );
    await new Promise((r) => setTimeout(r, 150));
    release();
    assert.equal((await first).status, 'claimed');
    const out = await settled;
    assert.equal(out.err, undefined);
    assert.deepEqual(out.v, { status: 'member', household_id: h.id, member_id: person.id, can_import: true });
  });
});

describe('join_household with someone waiting to join', () => {
  test('a verified email claims the waiting person instead of adding a second one', async () => {
    const h = await createHousehold();
    const person = await addPerson(h, h.owner, { name: 'Shea', emoji: '🦆', email: 'invited@example.com' });
    const token = await rpc(h.owner, 'create_invite');
    const user = await createUser({ email: 'Invited@example.com' });
    assert.equal(await rpc(user, 'join_household', [token, 'Typed Name', '🦊']), h.id);
    const rows = (await db('select id, user_id, name, emoji from public.members where household_id = $1', [h.id])).rows;
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.find((r) => r.id === person.id), { id: person.id, user_id: user.id, name: 'Shea', emoji: '🦆' });
  });

  test('an unverified email joins as someone new, without the email', async () => {
    const h = await createHousehold();
    const person = await addPerson(h, h.owner, { email: 'unsure@example.com' });
    const token = await rpc(h.owner, 'create_invite');
    const user = await createUser({ email: 'unsure@example.com', verified: false });
    await rpc(user, 'join_household', [token, 'Newcomer', '🦊']);
    const joined = await one('select name, email, color from public.members where user_id = $1', [user.id]);
    assert.deepEqual(joined, { name: 'Newcomer', email: '', color: MEMBER_COLORS[2] });
    assert.equal((await memberRow(person.id)).user_id, null);
  });
});

describe('import_household', () => {
  test('creates the home from the phone, every field and the history; the caller is "me"', async () => {
    await rolledBack(async (tx) => {
      await tx.noHome();
      const stratis = await tx.user({ name: 'Stratis V', email: 'Stratis@Gmail.com' });
      const hid = await importAs(tx, stratis);

      const h = await tx.adminOne('select name, address, timezone from public.households where id = $1', [hid]);
      assert.deepEqual(h, { name: 'Our home', address: '21 Alderbrook Road', timezone: 'Europe/London' });

      const people = (
        await tx.admin(
          'select id, user_id, name, email, emoji, color, role from public.members where household_id = $1 order by created_at, id',
          [hid],
        )
      ).rows;
      assert.deepEqual(
        people.map((p) => [p.name, p.user_id, p.email, p.emoji, p.color, p.role]),
        [
          ['Stratis', stratis.id, 'stratis@gmail.com', '🦆', '#007AFF', 'owner'],
          ['Shea', null, '', '🦔', '#AF52DE', 'member'],
          ['Ela', null, '', '🦊', '#30B0C7', 'member'],
        ],
      );
      const [me, shea, ela] = people.map((p) => p.id);

      const areas = (await tx.admin('select id, name, position from public.areas where household_id = $1 order by position', [hid]))
        .rows;
      assert.deepEqual(
        areas.map((a) => [a.name, a.position]),
        [
          ['Kitchen', 0],
          ['Living Room', 1],
          ['Bathroom Small', 2],
          ['Garden', 3],
          ['Garden Lounge', 4],
          ['Jacuzzi', 5],
        ],
      );
      const areaName = new Map(areas.map((a) => [a.id, a.name]));

      const items = (
        await tx.admin(
          `select *, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as created,
                  to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as updated,
                  to_char(completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as completed
           from public.items where household_id = $1 order by created_at, title`,
          [hid],
        )
      ).rows;
      assert.equal(items.length, 20);
      assert.equal(items.filter((i) => i.status === 'open').length, 19);
      const find = (area, title) => items.find((i) => areaName.get(i.area_id) === area && i.title === title);

      const cracks = find('Living Room', 'Fix the cracks on the wall');
      assert.deepEqual(
        [cracks.kind, cracks.rag, cracks.due_date, cracks.repeat, cracks.notify, cracks.assignee_id, cracks.status],
        ['task', 'red', '2026-10-16', 'none', 'day_before', null, 'open'],
      );
      assert.deepEqual([cracks.created_by, cracks.updated_by, cracks.created, cracks.updated], [me, me, '2026-10-08T09:17:00', '2026-10-08T09:17:00']);

      const tidiness = find('Kitchen', 'Tidiness');
      assert.deepEqual(
        [tidiness.kind, tidiness.assignee_id, tidiness.note, tidiness.due_date, tidiness.repeat, tidiness.notify, tidiness.updated],
        ['state', shea, 'Restocked, 5L tin is in the pantry.', null, 'none', 'none', '2026-10-09T07:45:00'],
      );
      assert.equal(find('Garden', 'Plants healthy').good, 'Watered twice a week, no yellow leaves, pots drained.');
      const filter = find('Jacuzzi', 'Change the filter');
      assert.deepEqual([filter.repeat, filter.due_date, filter.assignee_id, filter.rag], ['monthly', '2026-10-21', shea, 'green']);
      const chemicals = find('Jacuzzi', 'Check Chemicals');
      assert.deepEqual([chemicals.note, chemicals.due_date], ['Order a new pack.', '2026-10-20']);
      const strips = find('Jacuzzi', 'Order water test strips');
      assert.deepEqual([strips.status, strips.completed], ['done', '2026-10-08T17:05:00']);
      assert.equal(items.filter((i) => i.assignee_id === me).length, 11);
      assert.equal(items.filter((i) => i.assignee_id === shea && i.status === 'open').length, 5);

      const completions = (
        await tx.admin(
          `select item_id, item_title, credited_to, completed_by, prev_due_date, prev_status,
                  to_char(completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as at
           from public.completions where household_id = $1 order by completed_at`,
          [hid],
        )
      ).rows;
      // The real history only: the demo's made-up history stayed on the phone.
      assert.deepEqual(
        completions.map((c) => c.item_title),
        ['Order water test strips', 'Fix the doorbell', 'Change the filter'],
      );
      assert.deepEqual(completions[1], {
        item_id: null,
        item_title: 'Fix the doorbell',
        credited_to: me,
        completed_by: me,
        prev_due_date: '2026-10-09',
        prev_status: 'open',
        at: '2026-10-09T07:40:00',
      });
      assert.ok(ela);
      const stripsDone = completions.find((c) => c.item_title === 'Order water test strips');
      assert.deepEqual([stripsDone.item_id, stripsDone.credited_to, stripsDone.prev_due_date], [strips.id, shea, '2026-10-08']);
      const filterDone = completions.find((c) => c.item_title === 'Change the filter');
      assert.deepEqual([filterDone.item_id, filterDone.credited_to, filterDone.completed_by], [filter.id, shea, me]);

      // Chat, invites and push subscriptions stay behind.
      for (const table of ['messages', 'invites']) {
        assert.equal((await tx.adminOne(`select count(*)::int as n from public.${table} where household_id = $1`, [hid])).n, 0);
      }

      // The caller is in the home and sees it all through RLS.
      assert.deepEqual(await tx.rpc(stratis, 'enter_home'), { status: 'member', household_id: hid, member_id: me, can_import: false });
      const seen = await tx.as(stratis, 'select count(*)::int as n from public.items where household_id = $1', [hid]);
      assert.equal(seen.rows[0].n, 20);
    });
  });

  test('a home the demo set up itself: its items and people, one real completion, none of the made-up history', async () => {
    const created = JSON.parse(readFileSync(new URL('./fixtures/demo-created-import.json', import.meta.url), 'utf8'));
    await rolledBack(async (tx) => {
      await tx.noHome();
      const hid = await importAs(tx, await tx.user(), created);
      const count = async (table, where = '') =>
        (await tx.adminOne(`select count(*)::int as n from public.${table} where household_id = $1 ${where}`, [hid])).n;
      assert.equal(await count('completions'), 1);
      assert.equal(await count('items'), created.items.length);
      assert.equal(await count('members', 'and user_id is null'), 2);
    });
  });

  test('then Shea’s email is added, and when she signs in she is Shea with her items', async () => {
    await rolledBack(async (tx) => {
      await tx.noHome();
      const stratis = await tx.user({ email: 'stratis@gmail.com' });
      const hid = await importAs(tx, stratis);
      const sheaRow = await tx.adminOne(`select id from public.members where household_id = $1 and name = 'Shea'`, [hid]);
      await tx.rpc(stratis, 'set_person_email', [sheaRow.id, 'Shea@Gmail.com']);

      const shea = await tx.user({ name: 'Shea Google', email: 'shea@gmail.com' });
      assert.deepEqual(await tx.rpc(shea, 'enter_home'), {
        status: 'claimed',
        household_id: hid,
        member_id: sheaRow.id,
        can_import: false,
      });
      const mine = await tx.as(
        shea,
        `select count(*)::int as n from public.items
         where assignee_id = public.current_member_id() and status = 'open'`,
      );
      assert.equal(mine.rows[0].n, 5);
      const me = await tx.adminOne('select name, emoji, user_id from public.members where id = $1', [sheaRow.id]);
      assert.deepEqual(me, { name: 'Shea', emoji: '🦔', user_id: shea.id });

      // Ela, without an email, is still waiting; anyone else is told the home is private.
      const someone = await tx.user({ email: 'someone@gmail.com' });
      assert.equal((await tx.rpc(someone, 'enter_home')).status, 'private');
    });
  });

  test('refused when a home exists (home_exists) or the caller is in one (already_member)', async () => {
    await createHousehold();
    const user = await createUser();
    await rejects(rpc(user, 'import_household', [JSON.stringify(PAYLOAD)]), 'home_exists');
    // In a home that is in use (an item added after it was set up).
    const member = await createHousehold();
    await insertItem(member, { title: 'Bins' });
    await rejects(rpc(member.owner, 'import_household', [JSON.stringify(PAYLOAD)]), 'already_member');
    await rejects(rpc({ claims: { role: 'authenticated' } }, 'import_household', [JSON.stringify(PAYLOAD)]), 'not_signed_in');
    await rolledBack(async (tx) => {
      await tx.noHome();
      const stratis = await tx.user();
      await importAs(tx, stratis);
      await rejects(importAs(tx, stratis), 'already_member');
    });
  });

  test('keeps to the kind rules, the limits and the clock', async () => {
    await rolledBack(async (tx) => {
      await tx.noHome();
      const payload = clone(PAYLOAD);
      payload.household.timezone = 'Not/AZone';
      payload.household.name = 'h'.repeat(60);
      const state = payload.items.find((i) => i.kind === 'state');
      Object.assign(state, { due_date: '2026-10-30', repeat: 'weekly', notify: 'same_day' });
      payload.items[3].title = 't'.repeat(200);
      payload.items[3].note = 'n'.repeat(4000);
      payload.items[3].created_at = '2099-01-01T00:00:00Z';
      payload.items[3].updated_at = null;
      payload.items[4].created_at = null;
      payload.items[4].updated_at = null;
      payload.completions[0].completed_at = '2099-01-01T00:00:00+01:00';
      const user = await tx.user();
      const hid = await importAs(tx, user, payload);
      assert.equal((await tx.adminOne('select timezone from public.households where id = $1', [hid])).timezone, 'Europe/London');
      const s = await tx.adminOne(`select due_date, repeat, notify from public.items where household_id = $1 and title = $2 limit 1`, [
        hid,
        state.title,
      ]);
      assert.deepEqual(s, { due_date: null, repeat: 'none', notify: 'none' });
      const clock = await tx.adminOne(
        `select (select created_at = now() and updated_at = now() from public.items where household_id = $1 and title = $2) as future,
                (select created_at = now() and updated_at = now() from public.items where household_id = $1 and title = $3) as missing,
                (select max(completed_at) = now() from public.completions where household_id = $1) as completion`,
        [hid, 't'.repeat(200), payload.items[4].title],
      );
      assert.deepEqual(clock, { future: true, missing: true, completion: true });
    });
  });

  test('invalid_input for a payload it refuses, and nothing is created', async () => {
    const cases = {
      'not an object': () => [],
      'version 2': (p) => ({ ...p, version: 2 }),
      'no people': (p) => ({ ...p, people: [] }),
      'no me': (p) => ({ ...p, people: p.people.map(({ me: _m, ...rest }) => rest) }),
      'two me': (p) => ({ ...p, people: p.people.map((x) => ({ ...x, me: true })) }),
      'me is not a boolean': (p) => ({ ...p, people: [{ ...p.people[0], me: 'yes' }, ...p.people.slice(1)] }),
      'duplicate person key': (p) => ({ ...p, people: [...p.people, { ...p.people[1] }] }),
      'duplicate area key': (p) => ({ ...p, areas: [...p.areas, { ...p.areas[0] }] }),
      'duplicate item key': (p) => ({ ...p, items: [...p.items, { ...p.items[0] }] }),
      'key too long': (p) => ({ ...p, areas: [{ key: 'k'.repeat(65), name: 'X' }] }),
      'unknown area': (p) => ({ ...p, items: [{ ...p.items[0], area: 'a99' }] }),
      'item without area': (p) => ({ ...p, items: [{ ...p.items[0], area: null }] }),
      'unknown assignee': (p) => ({ ...p, items: [{ ...p.items[0], assignee: 'p99' }] }),
      'unknown completion item': (p) => ({ ...p, completions: [{ ...p.completions[0], item: 'i99' }] }),
      'blank household name': (p) => ({ ...p, household: { ...p.household, name: '  ' } }),
      'household name too long': (p) => ({ ...p, household: { ...p.household, name: 'h'.repeat(61) } }),
      'address too long': (p) => ({ ...p, household: { ...p.household, address: 'a'.repeat(121) } }),
      'person name too long': (p) => ({ ...p, people: [{ ...p.people[0], name: 'x'.repeat(41) }, ...p.people.slice(1)] }),
      'blank person name': (p) => ({ ...p, people: [{ ...p.people[0], name: ' ' }, ...p.people.slice(1)] }),
      'emoji too long': (p) => ({ ...p, people: [{ ...p.people[0], emoji: 'x'.repeat(17) }, ...p.people.slice(1)] }),
      'area name too long': (p) => ({ ...p, areas: [{ ...p.areas[0], name: 'x'.repeat(61) }, ...p.areas.slice(1)] }),
      'blank title': (p) => ({ ...p, items: [{ ...p.items[0], title: ' ' }] }),
      'title too long': (p) => ({ ...p, items: [{ ...p.items[0], title: 'x'.repeat(201) }] }),
      'note too long': (p) => ({ ...p, items: [{ ...p.items[0], note: 'x'.repeat(4001) }] }),
      'good too long': (p) => ({ ...p, items: [{ ...p.items[0], good: 'x'.repeat(4001) }] }),
      'unknown kind': (p) => ({ ...p, items: [{ ...p.items[0], kind: 'chore' }] }),
      'unknown rag': (p) => ({ ...p, items: [{ ...p.items[0], rag: 'blue' }] }),
      'unknown repeat': (p) => ({ ...p, items: [{ ...p.items[0], repeat: 'daily' }] }),
      'unknown notify': (p) => ({ ...p, items: [{ ...p.items[0], notify: 'loud' }] }),
      'unknown status': (p) => ({ ...p, items: [{ ...p.items[0], status: 'gone' }] }),
      'a done state': (p) => ({ ...p, items: [{ ...p.items[0], status: 'done' }] }),
      'not a date': (p) => ({ ...p, items: [{ ...p.items[3], due_date: '16/10/2026' }] }),
      'impossible date': (p) => ({ ...p, items: [{ ...p.items[3], due_date: '2026-02-30' }] }),
      'not a timestamp': (p) => ({ ...p, items: [{ ...p.items[3], created_at: 'yesterday' }] }),
      'timestamp without a zone': (p) => ({ ...p, items: [{ ...p.items[3], created_at: '2026-10-08T09:00:00' }] }),
      'completion without a time': (p) => ({ ...p, completions: [{ ...p.completions[0], completed_at: null }] }),
      'completion without a title': (p) => ({ ...p, completions: [{ ...p.completions[0], item_title: '' }] }),
      'a number for a title': (p) => ({ ...p, items: [{ ...p.items[0], title: 42 }] }),
      'too many areas': (p) => ({ ...p, areas: Array.from({ length: 101 }, (_, i) => ({ key: `a${i}`, name: `A${i}` })), items: [], completions: [] }),
    };
    await rolledBack(async (tx) => {
      await tx.noHome();
      const user = await tx.user();
      for (const [name, change] of Object.entries(cases)) {
        await assert.rejects(importAs(tx, user, change(clone(PAYLOAD))), (err) => {
          assert.equal(err.message, 'invalid_input', name);
          return true;
        });
      }
      assert.equal((await tx.adminOne('select count(*)::int as n from public.members where user_id = $1', [user.id])).n, 0);
      // And the untouched payload still goes in.
      assert.ok(await importAs(tx, user));
    });
  });

  test('with the Housekeeping migration present, the home gets the starter task list', async () => {
    const present = await one(
      `select to_regclass('public.housekeeping_tasks') is not null
          and to_regprocedure('public.housekeeping_starter_tasks()') is not null as yes`,
    );
    await rolledBack(async (tx) => {
      await tx.noHome();
      const hid = await importAs(tx, await tx.user());
      if (!present.yes) return;
      const tasks = await tx.admin('select title from public.housekeeping_tasks where household_id = $1 order by position', [hid]);
      const starter = await tx.adminOne('select public.housekeeping_starter_tasks() as list');
      assert.deepEqual(
        tasks.rows.map((r) => r.title),
        starter.list,
      );
    });
  });
});

describe('invite_preview and join_as_person ("Are you one of these people?")', () => {
  test('the preview lists the people waiting to join without an email, and the emojis in use', async () => {
    const h = await createHousehold({ emoji: '🦆' });
    await addPerson(h, h.owner, { name: 'Shea', emoji: '🦔', email: 'shea.preview@example.com' });
    const ela = await addPerson(h, h.owner, { name: 'Ela', emoji: '🦊' });
    const robin = await addPerson(h, h.owner, { name: 'Robin', emoji: '🐝' });
    const token = await rpc(h.owner, 'create_invite');
    const preview = await rpc(await createUser(), 'invite_preview', [token]);
    assert.deepEqual(preview.people, [
      { id: ela.id, name: 'Ela', emoji: '🦊' },
      { id: robin.id, name: 'Robin', emoji: '🐝' },
    ]);
    assert.deepEqual(preview.emojis, ['🦆', '🦔', '🦊', '🐝']);
  });

  test('joining as one of them: their row becomes the account, with its email; nobody is added', async () => {
    const h = await createHousehold();
    const ela = await addPerson(h, h.owner, { name: 'Ela', emoji: '🦊' });
    const item = await insertItem(h, { assignee_id: ela.id, title: 'Weeds' });
    const token = await rpc(h.owner, 'create_invite');
    const user = await createUser({ email: 'Ela.Joins@Example.com' });
    assert.equal(await rpc(user, 'join_as_person', [token, ela.id]), h.id);
    const row = await memberRow(ela.id);
    assert.deepEqual([row.user_id, row.name, row.emoji, row.email], [user.id, 'Ela', '🦊', 'ela.joins@example.com']);
    assert.ok(row.claimed_at);
    assert.equal((await one('select assignee_id from public.items where id = $1', [item.id])).assignee_id, ela.id);
    assert.equal((await one('select count(*)::int as n from public.members where household_id = $1', [h.id])).n, 2);
    // Opening the link again is harmless.
    assert.equal(await rpc(user, 'join_as_person', [token, ela.id]), h.id);
  });

  test('not_found for someone who joined, has another email or is gone; the usual invite errors', async () => {
    const h = await createHousehold();
    const ela = await addPerson(h, h.owner, { name: 'Ela' });
    const shea = await addPerson(h, h.owner, { name: 'Shea', email: 'shea.kept@example.com' });
    const robin = await addPerson(h, h.owner, { name: 'Robin' });
    const token = await rpc(h.owner, 'create_invite');
    await rpc(await createUser(), 'join_as_person', [token, ela.id]);
    const late = await createUser();
    await rejects(rpc(late, 'join_as_person', [token, ela.id]), 'not_found');
    await rejects(rpc(late, 'join_as_person', [token, shea.id]), 'not_found');
    await rejects(rpc(late, 'join_as_person', [token, randomUUID()]), 'not_found');
    await rejects(rpc(late, 'join_as_person', [token, h.member.id]), 'not_found');
    const other = await createHousehold();
    await rejects(rpc(late, 'join_as_person', [token, other.member.id]), 'not_found');
    await rejects(rpc(late, 'join_as_person', ['0'.repeat(32), robin.id]), 'invalid_invite');
    await rejects(rpc(other.owner, 'join_as_person', [token, robin.id]), 'already_member');
    await rejects(rpc({ claims: { role: 'authenticated' } }, 'join_as_person', [token, robin.id]), 'not_signed_in');
    await db("update public.invites set expires_at = now() - interval '1 second' where token = $1", [token]);
    await rejects(rpc(late, 'join_as_person', [token, robin.id]), 'invalid_invite');
    assert.equal((await memberRow(robin.id)).user_id, null);
    // The person with the caller's own verified email can be taken this way too.
    const token2 = await rpc(h.owner, 'create_invite');
    const realShea = await createUser({ email: 'shea.kept@example.com' });
    assert.equal(await rpc(realShea, 'join_as_person', [token2, shea.id]), h.id);
  });

  test('an email someone else in the home has stays theirs: the newcomer joins as the person without it', async () => {
    const owner = await createUser({ email: 'owner.clash@example.com' });
    const h = await createHousehold({ owner });
    const robin = await addPerson(h, owner, { name: 'Robin' });
    const token = await rpc(owner, 'create_invite');
    const twin = await createUser({ email: 'owner.clash@example.com', google: false });
    await rpc(twin, 'join_as_person', [token, robin.id]);
    assert.deepEqual(await one('select user_id, email from public.members where id = $1', [robin.id]), {
      user_id: twin.id,
      email: '',
    });
  });
});

describe('release_claim ("Not Shea?")', () => {
  test('within a day of a claim: back to not joined, without the email, and the account is in no home', async () => {
    const h = await createHousehold();
    const person = await addPerson(h, h.owner, { name: 'Shea', email: 'wrong.person@example.com' });
    const wrong = await createUser({ email: 'wrong.person@example.com' });
    assert.equal((await rpc(wrong, 'enter_home')).status, 'claimed');
    await db(
      `insert into public.push_subs (member_id, user_id, endpoint, p256dh, auth)
       values ($1, $2, 'https://push.example.com/wrong', 'key', 'auth')`,
      [person.id, wrong.id],
    );
    await rpc(wrong, 'release_claim');
    assert.deepEqual(await one('select user_id, email, claimed_at from public.members where id = $1', [person.id]), {
      user_id: null,
      email: '',
      claimed_at: null,
    });
    assert.equal((await one('select count(*)::int as n from public.push_subs where member_id = $1', [person.id])).n, 0);
    assert.equal((await rpc(wrong, 'enter_home')).status, 'private');
    // Their name, emoji and items stay with the person, for the right account.
    assert.equal((await memberRow(person.id)).name, 'Shea');
  });

  test('not_found without a claim, or more than a day after it; not_signed_in without a user', async () => {
    const h = await createHousehold();
    await rejects(rpc(h.owner, 'release_claim'), 'not_found');
    const joiner = await joinHousehold(h);
    await rejects(rpc(joiner.user, 'release_claim'), 'not_found');
    const person = await addPerson(h, h.owner, { email: 'old.claim@example.com' });
    const user = await createUser({ email: 'old.claim@example.com' });
    await rpc(user, 'enter_home');
    await db("update public.members set claimed_at = now() - interval '25 hours' where id = $1", [person.id]);
    await rejects(rpc(user, 'release_claim'), 'not_found');
    assert.equal((await memberRow(person.id)).user_id, user.id);
    await rejects(rpc({ claims: { role: 'authenticated' } }, 'release_claim'), 'not_signed_in');
  });
});

describe('import_household into an untouched home', () => {
  const SEED = [{ area: 'Kitchen', title: 'Olive oil', note: '', rag: 'amber', due_in_days: 3, repeat: 'none', notify: 'day_before' }];

  test('replaces what is in it, in place; its people stay, matched by name', async () => {
    const h = await createHousehold({ name: 'Laptop home', memberName: 'Stratis V', emoji: '🐻', items: SEED });
    const shea = await joinHousehold(h, { name: ' shea ', emoji: '🦄' });
    const robin = await addPerson(h, h.owner, { name: 'Robin' });
    const token = await rpc(h.owner, 'create_invite');
    assert.equal((await rpc(h.owner, 'enter_home')).can_import, true);

    assert.equal(await rpc(h.owner, 'import_household', [JSON.stringify(PAYLOAD)]), h.id);

    assert.deepEqual(await one('select name, address, timezone from public.households where id = $1', [h.id]), {
      name: 'Our home',
      address: '21 Alderbrook Road',
      timezone: 'Europe/London',
    });
    const areas = (await db('select name from public.areas where household_id = $1 order by position', [h.id])).rows;
    assert.deepEqual(areas.map((a) => a.name), PAYLOAD.areas.map((a) => a.name));
    const items = (await db('select title, assignee_id, created_by, status from public.items where household_id = $1', [h.id])).rows;
    assert.equal(items.length, PAYLOAD.items.length);
    assert.ok(!items.some((i) => i.title === 'Olive oil'));
    // People: the caller as they are, Shea is the Shea who joined, Ela is new, Robin stays.
    const people = (
      await db('select id, user_id, name, emoji, role from public.members where household_id = $1 order by created_at, id', [h.id])
    ).rows;
    assert.deepEqual(
      people.map((p) => [p.name, p.emoji, p.role, p.user_id]),
      [
        ['Stratis V', '🐻', 'owner', h.owner.id],
        ['shea', '🦄', 'member', shea.user.id],
        ['Robin', '🦔', 'member', null],
        ['Ela', '🦊', 'member', null],
      ],
    );
    const sheaKey = PAYLOAD.people.find((p) => p.name === 'Shea').key;
    const meKey = PAYLOAD.people.find((p) => p.me).key;
    const sheaOpen = PAYLOAD.items.filter((i) => i.assignee === sheaKey && i.status === 'open').length;
    assert.equal(items.filter((i) => i.assignee_id === shea.member.id && i.status === 'open').length, sheaOpen);
    assert.equal(
      items.filter((i) => i.assignee_id === h.member.id).length,
      PAYLOAD.items.filter((i) => i.assignee === meKey).length,
    );
    assert.ok(items.every((i) => i.created_by === h.member.id));
    assert.equal(
      (await one('select count(*)::int as n from public.completions where household_id = $1', [h.id])).n,
      PAYLOAD.completions.length,
    );
    assert.equal((await memberRow(robin.id)).user_id, null);
    // The invite still works, and the home is in use now: no second replace.
    assert.equal((await rpc(await createUser(), 'invite_preview', [token])).household_name, 'Our home');
    assert.equal((await rpc(h.owner, 'enter_home')).can_import, false);
    await rejects(rpc(shea.user, 'import_household', [JSON.stringify(PAYLOAD)]), 'already_member');
  });

  test('a home in use is never replaced: already_member, and nothing changes', async () => {
    const uses = {
      'renamed': (h) => db(`update public.households set name = 'Renamed' where id = $1`, [h.id]),
      'an area added': (h) => db(`insert into public.areas (household_id, name, position) values ($1, 'Loft', 9)`, [h.id]),
      'an item added': (h) => insertItem(h, { title: 'Bins' }),
      'an item edited': (h) => db(`update public.items set note = 'Bought' where household_id = $1`, [h.id]),
      'something done': async (h) => {
        const item = (await one('select id from public.items where household_id = $1', [h.id])).id;
        await rpc(h.owner, 'complete_item', [item]);
      },
      'a chat message': (h) =>
        db(`insert into public.messages (household_id, member_id, body) values ($1, $2, 'Hi')`, [h.id, h.member.id]),
    };
    for (const [name, use] of Object.entries(uses)) {
      const h = await createHousehold({ items: SEED });
      assert.equal((await rpc(h.owner, 'enter_home')).can_import, true, name);
      await use(h);
      assert.equal((await rpc(h.owner, 'enter_home')).can_import, false, name);
      await assert.rejects(rpc(h.owner, 'import_household', [JSON.stringify(PAYLOAD)]), (err) => {
        assert.equal(err.message, 'already_member', name);
        return true;
      });
      assert.equal((await one('select count(*)::int as n from public.areas where household_id = $1', [h.id])).n >= 3, true, name);
    }
  });
});

describe('the migration', () => {
  test('re-running it over a home with people waiting to join changes nothing, and claims still work', async () => {
    const sql = readFileSync(new URL('../migrations/20261010000500_one_home.sql', import.meta.url), 'utf8');
    await rolledBack(async (tx) => {
      // It locks members for the rest of this transaction: never wait long on another test file.
      await tx.admin("set local lock_timeout = '10s'");
      await tx.noHome();
      const stratis = await tx.user({ email: 'rerun.stratis@gmail.com' });
      const hid = await importAs(tx, stratis);
      const sheaRow = await tx.adminOne(`select id from public.members where household_id = $1 and name = 'Shea'`, [hid]);
      await tx.rpc(stratis, 'set_person_email', [sheaRow.id, ' Shea.Rerun@Gmail.com ']);
      const people = async () =>
        (await tx.admin('select * from public.members where household_id = $1 order by created_at, id', [hid])).rows;
      const before = await people();
      assert.equal(before.filter((m) => m.user_id === null).length, 2);

      await tx.admin(sql);
      assert.deepEqual(await people(), before);

      const shea = await tx.user({ email: 'shea.rerun@gmail.com' });
      assert.deepEqual(await tx.rpc(shea, 'enter_home'), {
        status: 'claimed',
        household_id: hid,
        member_id: sheaRow.id,
        can_import: false,
      });
      await rejects(tx.rpc(stratis, 'add_person', [hid, 'Shea again', '🦔', 'SHEA.RERUN@gmail.com']), 'email_taken');
    });
  });
});
