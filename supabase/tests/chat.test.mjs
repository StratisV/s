// Chat (supabase/migrations/20261010000100_chat.sql): one group chat per household. Members
// read and post, react with several emoji, and delete only their own messages and
// reactions; nothing can be edited; outsiders and anon see and change nothing; messages are
// kept forever (a former member's messages stay, with member_id null).

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import {
  asService,
  createHousehold,
  createUser,
  db,
  joinHousehold,
  one,
  pool,
  q,
  rejects,
  useCleanup,
} from './helpers.mjs';

useCleanup();

const PERMISSION_DENIED = /permission denied/;
const RLS_VIOLATION = /violates row-level security policy/;
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const NOT_NULL_VIOLATION = '23502';
const TABLES = ['messages', 'message_reactions'];

const chars = (n, c = 'x') => c.repeat(n);

/** Asserts a Postgres error with this SQLSTATE (and, for a check, naming `constraint`). */
async function failsWith(promise, code, constraint) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    if (constraint) assert.match(err.message, new RegExp(`"${constraint}"`));
    return true;
  });
}

/** Posts a message as `user`; returns the stored row. */
async function post(user, householdId, body) {
  const { rows } = await q(user, 'insert into public.messages (household_id, body) values ($1, $2) returning *', [
    householdId,
    body,
  ]);
  return rows[0];
}

/** Reacts as `user`; returns the stored row. */
async function react(user, messageId, emoji) {
  const { rows } = await q(user, 'insert into public.message_reactions (message_id, emoji) values ($1, $2) returning *', [
    messageId,
    emoji,
  ]);
  return rows[0];
}

/** Removes a reaction as `user` (RLS decides whose); returns the number of rows deleted. */
async function unreact(user, messageId, emoji, memberId) {
  const res = await q(
    user,
    `delete from public.message_reactions
     where message_id = $1 and emoji = $2 ${memberId ? 'and member_id = $3' : ''}`,
    memberId ? [messageId, emoji, memberId] : [messageId, emoji],
  );
  return res.rowCount;
}

/** Inserts a message directly (admin), optionally at a given time. Returns the row. */
async function adminPost(householdId, memberId, body, createdAt) {
  const { rows } = await db(
    `insert into public.messages (household_id, member_id, body, created_at)
     values ($1, $2, $3, coalesce($4::timestamptz, now())) returning *`,
    [householdId, memberId, body, createdAt ?? null],
  );
  return rows[0];
}

/** Reactions on a message, as stored (admin), oldest first. */
async function reactionsOf(messageId) {
  const { rows } = await db(
    'select member_id, household_id, emoji from public.message_reactions where message_id = $1 order by created_at, emoji',
    [messageId],
  );
  return rows;
}

/** Everything stored in a household's chat, for before/after comparisons. */
async function chatSnapshot(householdId) {
  return {
    messages: (await db('select * from public.messages where household_id = $1 order by id', [householdId])).rows,
    reactions: (
      await db('select * from public.message_reactions where household_id = $1 order by message_id, member_id, emoji', [householdId])
    ).rows,
  };
}

/**
 * Runs fn(client) as `user` in a transaction that first runs `grantSql` as the admin and is
 * always rolled back. Used to show that the triggers, not only the column grants, decide
 * who a message or reaction is from.
 */
async function asWithExtraGrant(grantSql, user, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(grantSql);
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated' }),
    ]);
    return await fn(client);
  } finally {
    await client.query('rollback').catch(() => {});
    client.release();
  }
}

describe('structure', () => {
  test('RLS is on; authenticated has exactly the intended table and column privileges', async () => {
    const { rows } = await db(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1)`,
      [TABLES],
    );
    assert.equal(rows.length, 2);
    for (const r of rows) assert.equal(r.relrowsecurity, true, `RLS off on ${r.relname}`);

    const priv = async (role, table, p) =>
      (await one('select has_table_privilege($1, $2, $3) as ok', [role, `public.${table}`, p])).ok;
    const col = async (role, table, column, p) =>
      (await one('select has_column_privilege($1, $2, $3, $4) as ok', [role, `public.${table}`, column, p])).ok;

    for (const table of TABLES) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        assert.equal(await priv('authenticated', table, p), ['SELECT', 'DELETE'].includes(p), `${table} ${p}`);
        assert.equal(await priv('anon', table, p), false, `anon ${table} ${p}`);
        assert.equal(await priv('service_role', table, p), true, `service_role ${table} ${p}`);
      }
    }
    const insertable = {
      messages: ['household_id', 'body'],
      message_reactions: ['message_id', 'emoji'],
    };
    const columns = {
      messages: ['id', 'household_id', 'member_id', 'body', 'created_at'],
      message_reactions: ['message_id', 'member_id', 'household_id', 'emoji', 'created_at'],
    };
    for (const table of TABLES) {
      for (const c of columns[table]) {
        assert.equal(await col('authenticated', table, c, 'INSERT'), insertable[table].includes(c), `${table}.${c} insert`);
        assert.equal(await col('authenticated', table, c, 'UPDATE'), false, `${table}.${c} update`);
        assert.equal(await col('anon', table, c, 'SELECT'), false, `anon ${table}.${c} select`);
        assert.equal(await col('anon', table, c, 'INSERT'), false, `anon ${table}.${c} insert`);
      }
    }
  });

  test('trigger functions are security definer with an empty search_path and not callable by clients', async () => {
    const { rows } = await db(
      `select p.proname, p.prosecdef, p.proconfig,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec,
              has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any($1)`,
      [['messages_before_insert', 'message_reactions_before_insert']],
    );
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.prosecdef, true, `${r.proname} security definer`);
      assert.ok((r.proconfig ?? []).some((c) => c === 'search_path=""' || c === 'search_path='), `${r.proname} search_path`);
      assert.equal(r.anon_exec, false, `anon can execute ${r.proname}`);
      assert.equal(r.auth_exec, false, `authenticated can execute ${r.proname}`);
    }
  });

  test('paging index, primary key and realtime publication', async () => {
    const idx = await one("select indexdef from pg_indexes where schemaname = 'public' and indexname = 'messages_household_created_idx'");
    assert.match(idx.indexdef, /\(household_id, created_at DESC\)/);
    const pk = await one(
      `select pg_get_constraintdef(c.oid) as def from pg_constraint c
       where c.conrelid = 'public.message_reactions'::regclass and c.contype = 'p'`,
    );
    assert.equal(pk.def, 'PRIMARY KEY (message_id, member_id, emoji)');

    const pub = await one("select count(*)::int as n from pg_publication where pubname = 'supabase_realtime'");
    if (pub.n === 1) {
      const { rows } = await db(
        "select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'",
      );
      const published = rows.map((r) => r.tablename);
      for (const t of TABLES) assert.ok(published.includes(t), `${t} is not in supabase_realtime`);
    }
    const { rows } = await db(
      `select c.relname, c.relreplident from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1)`,
      [TABLES],
    );
    assert.equal(rows.length, 2);
    for (const r of rows) assert.equal(r.relreplident, 'f', `${r.relname} replica identity`);
  });
});

describe('members: post, read, react, delete their own', () => {
  let h;
  let second;

  before(async () => {
    h = await createHousehold({ name: 'Chat home', memberName: 'Owner' });
    second = await joinHousehold(h, { name: 'Second' });
  });

  test('every member reads what any member posts; the sender is the caller and the body is trimmed', async () => {
    const msg = await post(second.user, h.id, '  Bins go out tonight  \n');
    assert.equal(msg.household_id, h.id);
    assert.equal(msg.member_id, second.member.id);
    assert.equal(msg.body, 'Bins go out tonight');
    assert.ok(msg.created_at instanceof Date);

    const reply = await post(h.owner, h.id, 'On it');
    assert.equal(reply.member_id, h.member.id);

    for (const user of [h.owner, second.user]) {
      const { rows } = await q(user, 'select id, member_id, body from public.messages where household_id = $1 order by created_at', [h.id]);
      assert.deepEqual(
        rows.filter((r) => r.id === msg.id || r.id === reply.id),
        [
          { id: msg.id, member_id: second.member.id, body: 'Bins go out tonight' },
          { id: reply.id, member_id: h.member.id, body: 'On it' },
        ],
      );
    }
  });

  test('trimming matches JavaScript trim(); inner whitespace and line breaks stay', async () => {
    const cases = [
      ['\t\r\n hi \n\n', 'hi'],
      ['  hi　﻿', 'hi'],
      [' line one\n\nline two ', 'line one\n\nline two'],
      ['  🦔  ', '🦔'],
    ];
    for (const [sent, stored] of cases) {
      assert.equal(sent.trim(), stored, `test case ${JSON.stringify(sent)}`);
      assert.equal((await post(h.owner, h.id, sent)).body, stored, JSON.stringify(sent));
    }
  });

  test('body: 1 to 4000 characters after trimming, counted in characters', async () => {
    assert.equal((await post(h.owner, h.id, chars(4000))).body.length, 4000);
    assert.equal([...(await post(h.owner, h.id, chars(4000, '🦔'))).body].length, 4000);
    assert.equal((await post(h.owner, h.id, `   ${chars(4000)}   `)).body.length, 4000);
    assert.equal((await post(h.owner, h.id, 'k')).body, 'k');
    await failsWith(post(h.owner, h.id, chars(4001)), CHECK_VIOLATION, 'messages_body_length');
    await failsWith(post(h.owner, h.id, chars(4001, '🦔')), CHECK_VIOLATION, 'messages_body_length');
    for (const blank of ['', ' ', '\n\n', ' \t\r\n 　 ']) {
      await failsWith(post(h.owner, h.id, blank), CHECK_VIOLATION, 'messages_body_length');
    }
    await failsWith(post(h.owner, h.id, null), NOT_NULL_VIOLATION);
  });

  test('react with several emoji, once each; household and member are set by the database', async () => {
    const msg = await post(second.user, h.id, 'Boiler serviced');
    const heart = await react(h.owner, msg.id, '❤️');
    assert.deepEqual(
      { message_id: heart.message_id, member_id: heart.member_id, household_id: heart.household_id, emoji: heart.emoji },
      { message_id: msg.id, member_id: h.member.id, household_id: h.id, emoji: '❤️' },
    );
    await react(h.owner, msg.id, '👍');
    await react(second.user, msg.id, '❤️');
    await react(second.user, msg.id, '👨‍👩‍👧‍👦');
    assert.deepEqual(await reactionsOf(msg.id), [
      { member_id: h.member.id, household_id: h.id, emoji: '❤️' },
      { member_id: h.member.id, household_id: h.id, emoji: '👍' },
      { member_id: second.member.id, household_id: h.id, emoji: '❤️' },
      { member_id: second.member.id, household_id: h.id, emoji: '👨‍👩‍👧‍👦' },
    ]);

    // The same emoji twice is refused; an upsert that ignores duplicates is a no-op.
    await failsWith(react(h.owner, msg.id, '❤️'), UNIQUE_VIOLATION);
    const upsert = await q(
      h.owner,
      `insert into public.message_reactions (message_id, emoji) values ($1, $2)
       on conflict (message_id, member_id, emoji) do nothing returning *`,
      [msg.id, '❤️'],
    );
    assert.equal(upsert.rowCount, 0);
    assert.equal((await reactionsOf(msg.id)).length, 4);

    // Both members see every reaction.
    for (const user of [h.owner, second.user]) {
      const { rows } = await q(user, 'select emoji from public.message_reactions where message_id = $1', [msg.id]);
      assert.equal(rows.length, 4);
    }
  });

  test('a member can react to their own message', async () => {
    const msg = await post(h.owner, h.id, 'Self high five');
    assert.equal((await react(h.owner, msg.id, '🙌')).member_id, h.member.id);
  });

  test('emoji: 1 to 16 characters', async () => {
    const msg = await post(h.owner, h.id, 'Limits');
    assert.equal((await react(second.user, msg.id, chars(16, '🦔'))).emoji, chars(16, '🦔'));
    await failsWith(react(second.user, msg.id, chars(17, '🦔')), CHECK_VIOLATION, 'message_reactions_emoji_length');
    await failsWith(react(second.user, msg.id, ''), CHECK_VIOLATION, 'message_reactions_emoji_length');
    await failsWith(react(second.user, msg.id, null), NOT_NULL_VIOLATION);
  });

  test('reacting to a message that does not exist is not_found', async () => {
    await rejects(react(h.owner, '00000000-0000-4000-8000-000000000000', '👍'), 'not_found');
  });

  test('remove only their own reaction', async () => {
    const msg = await post(h.owner, h.id, 'Who fed the cat?');
    await react(h.owner, msg.id, '😂');
    await react(second.user, msg.id, '😂');
    await react(second.user, msg.id, '👀');

    // Without naming the member, RLS still limits the delete to the caller's own reaction.
    assert.equal(await unreact(second.user, msg.id, '😂'), 1);
    assert.deepEqual(await reactionsOf(msg.id), [
      { member_id: h.member.id, household_id: h.id, emoji: '😂' },
      { member_id: second.member.id, household_id: h.id, emoji: '👀' },
    ]);
    // Someone else's reaction cannot be removed, by name or in bulk.
    assert.equal(await unreact(second.user, msg.id, '😂', h.member.id), 0);
    assert.equal((await q(h.owner, 'delete from public.message_reactions where message_id = $1 and member_id = $2', [msg.id, second.member.id])).rowCount, 0);
    assert.equal((await q(h.owner, 'delete from public.message_reactions where message_id = $1', [msg.id])).rowCount, 1);
    assert.deepEqual(await reactionsOf(msg.id), [{ member_id: second.member.id, household_id: h.id, emoji: '👀' }]);
  });

  test('delete their own message, and its reactions go with it', async () => {
    const msg = await post(second.user, h.id, 'Typo');
    await react(h.owner, msg.id, '👍');
    await react(second.user, msg.id, '🤔');
    const res = await q(second.user, 'delete from public.messages where id = $1', [msg.id]);
    assert.equal(res.rowCount, 1);
    assert.equal((await one('select count(*)::int as n from public.messages where id = $1', [msg.id])).n, 0);
    assert.deepEqual(await reactionsOf(msg.id), []);
  });

  test("cannot delete someone else's message", async () => {
    const msg = await post(h.owner, h.id, 'Keep me');
    await react(second.user, msg.id, '❤️');
    assert.equal((await q(second.user, 'delete from public.messages where id = $1', [msg.id])).rowCount, 0);
    assert.equal((await q(second.user, 'delete from public.messages where member_id = $1', [h.member.id])).rowCount, 0);
    const own = await post(second.user, h.id, 'Mine');
    // A bulk delete only removes the caller's own messages.
    const bulk = await q(second.user, 'delete from public.messages where household_id = $1 returning id', [h.id]);
    assert.ok(bulk.rows.some((r) => r.id === own.id));
    assert.equal((await one('select count(*)::int as n from public.messages where household_id = $1 and member_id = $2', [h.id, second.member.id])).n, 0);
    assert.equal((await one('select body from public.messages where id = $1', [msg.id])).body, 'Keep me');
    assert.equal((await reactionsOf(msg.id)).length, 1);
  });

  test('cannot post or react as someone else (column grants)', async () => {
    const msg = await post(h.owner, h.id, 'Hello');
    await rejects(
      q(second.user, 'insert into public.messages (household_id, member_id, body) values ($1, $2, $3)', [h.id, h.member.id, 'Not me']),
      PERMISSION_DENIED,
    );
    await rejects(
      q(second.user, 'insert into public.messages (id, household_id, body) values (gen_random_uuid(), $1, $2)', [h.id, 'Own id']),
      PERMISSION_DENIED,
    );
    await rejects(
      q(second.user, "insert into public.messages (household_id, body, created_at) values ($1, $2, '2000-01-01')", [h.id, 'Backdated']),
      PERMISSION_DENIED,
    );
    await rejects(
      q(second.user, 'insert into public.message_reactions (message_id, member_id, emoji) values ($1, $2, $3)', [msg.id, h.member.id, '👍']),
      PERMISSION_DENIED,
    );
    await rejects(
      q(second.user, 'insert into public.message_reactions (message_id, household_id, emoji) values ($1, $2, $3)', [msg.id, h.id, '👍']),
      PERMISSION_DENIED,
    );
    assert.deepEqual(await reactionsOf(msg.id), []);
  });

  test('member_id is forced by the triggers even if the columns were insertable', async () => {
    const other = await createHousehold({ name: 'Elsewhere chat' });
    const msg = await post(h.owner, h.id, 'Forced');
    const forged = await asWithExtraGrant('grant insert (member_id) on public.messages to authenticated', second.user, (c) =>
      c.query('insert into public.messages (household_id, member_id, body) values ($1, $2, $3) returning member_id', [h.id, h.member.id, 'As owner']),
    );
    assert.equal(forged.rows[0].member_id, second.member.id);

    const reaction = await asWithExtraGrant(
      'grant insert (member_id, household_id) on public.message_reactions to authenticated',
      second.user,
      (c) =>
        c.query(
          'insert into public.message_reactions (message_id, member_id, household_id, emoji) values ($1, $2, $3, $4) returning member_id, household_id',
          [msg.id, h.member.id, other.id, '🔥'],
        ),
    );
    assert.deepEqual(reaction.rows[0], { member_id: second.member.id, household_id: h.id });
    // Both were rolled back, and so were the extra grants.
    assert.equal((await one("select count(*)::int as n from public.messages where body = 'As owner'")).n, 0);
    assert.deepEqual(await reactionsOf(msg.id), []);
    assert.equal(
      (await one("select has_column_privilege('authenticated', 'public.messages', 'member_id', 'INSERT') as ok")).ok,
      false,
    );
  });

  test('nothing can be edited', async () => {
    const msg = await post(second.user, h.id, 'Original');
    await react(second.user, msg.id, '👍');
    const attempts = [
      ["update public.messages set body = 'Edited' where id = $1", [msg.id]],
      ['update public.messages set member_id = $2 where id = $1', [msg.id, h.member.id]],
      ["update public.messages set created_at = '2000-01-01' where id = $1", [msg.id]],
      ['update public.messages set household_id = household_id where id = $1', [msg.id]],
      ["update public.message_reactions set emoji = '👎' where message_id = $1", [msg.id]],
      ['update public.message_reactions set member_id = $2 where message_id = $1', [msg.id, h.member.id]],
    ];
    for (const user of [second.user, h.owner]) {
      for (const [sql, params] of attempts) await rejects(q(user, sql, params), PERMISSION_DENIED);
    }
    // supabase-js upsert(onConflict) without ignoreDuplicates is an update too.
    await rejects(
      q(
        second.user,
        `insert into public.message_reactions (message_id, emoji) values ($1, '👍')
         on conflict (message_id, member_id, emoji) do update set emoji = excluded.emoji`,
        [msg.id],
      ),
      PERMISSION_DENIED,
    );
    await rejects(q(second.user, 'truncate public.messages'), PERMISSION_DENIED);
    const row = await one('select body, member_id from public.messages where id = $1', [msg.id]);
    assert.deepEqual(row, { body: 'Original', member_id: second.member.id });
    assert.deepEqual(await reactionsOf(msg.id), [{ member_id: second.member.id, household_id: h.id, emoji: '👍' }]);
  });
});

describe('outsiders and anon', () => {
  let a;
  let aSecond;
  let b;
  let loner;
  let aMsg;
  let aOwnerMsg;
  let bMsg;
  let snapshot;

  before(async () => {
    a = await createHousehold({ name: 'A chat home', memberName: 'A owner' });
    aSecond = await joinHousehold(a, { name: 'A second' });
    b = await createHousehold({ name: 'B chat home', memberName: 'B owner' });
    loner = await createUser({ name: 'Chat loner' });
    aMsg = await post(aSecond.user, a.id, 'Private to A');
    aOwnerMsg = await post(a.owner, a.id, 'Also private to A');
    await react(a.owner, aMsg.id, '❤️');
    await react(aSecond.user, aOwnerMsg.id, '👍');
    bMsg = await post(b.owner, b.id, 'Hello from B');
    await react(b.owner, bMsg.id, '🎉');
    snapshot = await chatSnapshot(a.id);
  });

  const outsiders = () => [
    ['a member of another household', b.owner],
    ['a user without a household', loner],
  ];

  test("see nothing of another household's chat", async () => {
    for (const [label, user] of outsiders()) {
      for (const t of TABLES) {
        const { rows } = await q(user, `select * from public.${t} where household_id = $1`, [a.id]);
        assert.equal(rows.length, 0, `${label} sees ${t}`);
      }
      const byId = await q(user, 'select * from public.messages where id = any($1)', [[aMsg.id, aOwnerMsg.id]]);
      assert.equal(byId.rows.length, 0, `${label} sees messages by id`);
      const reactions = await q(user, 'select * from public.message_reactions where message_id = any($1)', [[aMsg.id, aOwnerMsg.id]]);
      assert.equal(reactions.rows.length, 0, `${label} sees reactions by message id`);
    }
    // B only ever sees its own chat; the loner sees nothing at all.
    for (const t of TABLES) {
      const own = await q(b.owner, `select household_id from public.${t}`);
      assert.ok(own.rows.length > 0, `B sees its own ${t}`);
      assert.ok(own.rows.every((r) => r.household_id === b.id), `B sees foreign ${t}`);
      assert.equal((await q(loner, `select * from public.${t}`)).rows.length, 0, `loner sees ${t}`);
    }
  });

  test('cannot post to or react in another household', async () => {
    for (const [label, user] of outsiders()) {
      await rejects(post(user, a.id, `Hi from ${label}`), RLS_VIOLATION);
      // household_id comes from the message, so a reaction cannot claim another one.
      await rejects(react(user, aMsg.id, '👀'), RLS_VIOLATION);
    }
    assert.deepEqual(await chatSnapshot(a.id), snapshot);
  });

  test("cannot delete or un-react anything of another household's chat", async () => {
    for (const [label, user] of outsiders()) {
      const attempts = [
        ['delete from public.messages where household_id = $1', [a.id]],
        ['delete from public.messages where id = $1', [aMsg.id]],
        ['delete from public.message_reactions where household_id = $1', [a.id]],
        ['delete from public.message_reactions where message_id = $1', [aMsg.id]],
      ];
      for (const [sql, params] of attempts) {
        assert.equal((await q(user, sql, params)).rowCount, 0, `${label}: ${sql}`);
      }
      await rejects(q(user, "update public.messages set body = 'hacked' where household_id = $1", [a.id]), PERMISSION_DENIED);
    }
    assert.deepEqual(await chatSnapshot(a.id), snapshot);
  });

  test('anon can do nothing at all', async () => {
    for (const t of TABLES) {
      await rejects(q(null, `select * from public.${t}`), PERMISSION_DENIED);
      await rejects(q(null, `delete from public.${t}`), PERMISSION_DENIED);
    }
    await rejects(post(null, a.id, 'Anonymous'), PERMISSION_DENIED);
    await rejects(react(null, aMsg.id, '👀'), PERMISSION_DENIED);
    await rejects(q(null, "update public.messages set body = 'hacked'"), PERMISSION_DENIED);
    assert.deepEqual(await chatSnapshot(a.id), snapshot);
  });

  test('the service role reads and writes every chat', async () => {
    await asService(async (c) => {
      const { rows } = await c.query('select id from public.messages where household_id = $1 order by created_at', [a.id]);
      assert.deepEqual(rows.map((r) => r.id), [aMsg.id, aOwnerMsg.id]);
      // A service role insert keeps the sender it was given.
      const { rows: sent } = await c.query(
        'insert into public.messages (household_id, member_id, body) values ($1, $2, $3) returning member_id, body',
        [a.id, aSecond.member.id, '  From the server  '],
      );
      assert.deepEqual(sent[0], { member_id: aSecond.member.id, body: 'From the server' });
      await c.query("delete from public.messages where body = 'From the server' and household_id = $1", [a.id]);
    });
    assert.deepEqual(await chatSnapshot(a.id), snapshot);
  });
});

describe('lifetime', () => {
  test('deleting a household deletes its chat', async () => {
    const h = await createHousehold({ name: 'Doomed chat home' });
    const second = await joinHousehold(h, { name: 'Second' });
    const msg = await post(second.user, h.id, 'Soon gone');
    await react(h.owner, msg.id, '😢');
    await db('delete from public.households where id = $1', [h.id]);
    assert.equal((await one('select count(*)::int as n from public.messages where household_id = $1', [h.id])).n, 0);
    assert.equal((await one('select count(*)::int as n from public.message_reactions where household_id = $1', [h.id])).n, 0);
  });

  test("a former member's messages stay (member_id null); their reactions go", async () => {
    const h = await createHousehold({ name: 'Leaving chat home' });
    const leaver = await joinHousehold(h, { name: 'Leaver' });
    const msg = await post(leaver.user, h.id, 'Moving out, bye!');
    const ownerMsg = await post(h.owner, h.id, 'We will miss you');
    await react(h.owner, msg.id, '😢');
    await react(leaver.user, msg.id, '👋');
    await react(leaver.user, ownerMsg.id, '❤️');

    await db('delete from auth.users where id = $1', [leaver.user.id]);
    assert.equal((await one('select count(*)::int as n from public.members where id = $1', [leaver.member.id])).n, 0);

    const { rows } = await q(h.owner, 'select id, member_id, body from public.messages where household_id = $1 order by created_at', [h.id]);
    assert.deepEqual(rows, [
      { id: msg.id, member_id: null, body: 'Moving out, bye!' },
      { id: ownerMsg.id, member_id: h.member.id, body: 'We will miss you' },
    ]);
    assert.deepEqual(await reactionsOf(msg.id), [{ member_id: h.member.id, household_id: h.id, emoji: '😢' }]);
    assert.deepEqual(await reactionsOf(ownerMsg.id), []);

    // Still part of the chat: others react to it, nobody can delete it.
    await react(h.owner, msg.id, '❤️');
    assert.equal((await q(h.owner, 'delete from public.messages where id = $1', [msg.id])).rowCount, 0);
    assert.equal((await one('select count(*)::int as n from public.messages where id = $1', [msg.id])).n, 1);
  });

  test('pages backwards by created_at, oldest first within a page, however old', async () => {
    const h = await createHousehold({ name: 'Paging chat home' });
    const second = await joinHousehold(h, { name: 'Second' });
    // Inserted out of order; spans years, since nothing is ever deleted by age.
    // Two of them a microsecond apart, so a cursor rounded to milliseconds would lose one.
    const times = [
      '2001-01-01T09:00:00.000000Z',
      '2026-10-01T09:00:00.000000Z',
      '2019-06-15T12:00:00.000000Z',
      '2026-10-01T09:00:00.000001Z',
      '2026-10-02T18:30:00.000000Z',
      '2010-03-03T03:03:03.000000Z',
      '2026-10-03T07:00:00.000000Z',
    ];
    for (const [i, t] of times.entries()) {
      await adminPost(h.id, i % 2 ? second.member.id : h.member.id, `m${i}`, t);
    }
    // Same-format UTC timestamps sort as strings.
    const expected = times
      .map((t, i) => ({ t, body: `m${i}` }))
      .sort((x, y) => (x.t < y.t ? -1 : 1))
      .map((x) => x.body);
    assert.deepEqual(expected, ['m0', 'm5', 'm2', 'm1', 'm3', 'm4', 'm6']);

    // listMessages: newest `limit + 1` before the cursor, newest first, then reversed.
    const page = async (before, limit) => {
      const { rows } = await q(
        second.user,
        `select body, created_at::text as cursor from public.messages
         where household_id = $1 and ($2::timestamptz is null or created_at < $2::timestamptz)
         order by created_at desc limit $3`,
        [h.id, before, limit + 1],
      );
      const hasMore = rows.length > limit;
      const messages = rows.slice(0, limit).reverse();
      return { bodies: messages.map((r) => r.body), cursor: messages[0]?.cursor ?? null, hasMore };
    };

    const seen = [];
    let cursor = null;
    let pages = 0;
    for (;;) {
      const p = await page(cursor, 3);
      pages += 1;
      seen.unshift(...p.bodies);
      if (!p.hasMore) break;
      cursor = p.cursor;
    }
    assert.equal(pages, 3);
    assert.deepEqual(seen, expected);

    const first = await page(null, 3);
    assert.deepEqual(first.bodies, expected.slice(-3));
    assert.equal(first.hasMore, true);
  });

  test('the paging query can use the (household_id, created_at desc) index', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local enable_seqscan = off');
      const { rows } = await client.query(
        `explain select * from public.messages
         where household_id = '00000000-0000-4000-8000-000000000000' and created_at < now() order by created_at desc limit 51`,
      );
      assert.match(rows.map((r) => r['QUERY PLAN']).join('\n'), /messages_household_created_idx/);
    } finally {
      await client.query('rollback').catch(() => {});
      client.release();
    }
  });
});
