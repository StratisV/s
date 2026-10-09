// Hardening (supabase/migrations/20261009000100_hardening.sql): text limits, push endpoint
// rules, who may replace a push subscription, fixed item authorship, and the scheduler's
// trimmed item view.

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import {
  asService,
  createHousehold,
  createUser,
  db,
  insertItem,
  joinHousehold,
  one,
  q,
  rejects,
  rpc,
  useCleanup,
} from './helpers.mjs';

useCleanup();

const CHECK_VIOLATION = '23514';

/** Asserts a check_violation (SQLSTATE 23514) naming `constraint`. */
async function violates(promise, constraint) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, CHECK_VIOLATION, `expected a check violation, got ${err.code}: ${err.message}`);
    assert.match(err.message, new RegExp(`"${constraint}"`));
    return true;
  });
}

const chars = (n, c = 'x') => c.repeat(n);

describe('text limits (TEXT_LIMITS in src/lib/constants.ts)', () => {
  let h;
  let second;

  before(async () => {
    h = await createHousehold({ name: 'Limits home' });
    second = await joinHousehold(h, { name: 'Second' });
  });

  const newItem = (user, fields) =>
    q(user, 'insert into public.items (household_id, area_id, title, note) values ($1, $2, $3, $4) returning *', [
      h.id,
      h.areas[0].id,
      fields.title ?? 'Item',
      fields.note ?? '',
    ]);

  test('items: title up to 200 characters, note up to 4000', async () => {
    const { rows } = await newItem(second.user, { title: chars(200), note: chars(4000) });
    assert.equal(rows[0].title.length, 200);
    await violates(newItem(second.user, { title: chars(201) }), 'items_title_length');
    await violates(newItem(second.user, { note: chars(4001) }), 'items_note_length');
    await violates(q(h.owner, 'update public.items set title = $2 where id = $1', [rows[0].id, chars(201)]), 'items_title_length');
    await violates(q(h.owner, 'update public.items set note = $2 where id = $1', [rows[0].id, chars(4001)]), 'items_note_length');
  });

  test('limits count characters, not bytes', async () => {
    const { rows } = await newItem(h.owner, { title: chars(200, '🦔'), note: chars(4000, 'é') });
    assert.equal([...rows[0].title].length, 200);
    await violates(newItem(h.owner, { title: chars(201, '🦔') }), 'items_title_length');
  });

  test('members: name up to 40, emoji up to 16, colour #RRGGBB', async () => {
    const set = (sql, value) => q(second.user, `update public.members set ${sql} where id = $1 returning *`, [h.member.id, value]);
    assert.equal((await set('name = $2', chars(40))).rows[0].name.length, 40);
    await violates(set('name = $2', chars(41)), 'members_name_length');
    assert.equal((await set('emoji = $2', '👨‍👩‍👧‍👦')).rows[0].emoji, '👨‍👩‍👧‍👦');
    await violates(set('emoji = $2', chars(17, '🦔')), 'members_emoji_length');
    assert.equal((await set('color = $2', '#a1B2c3')).rows[0].color, '#a1B2c3');
    for (const bad of ['url(https://evil.example/x.png)', 'red', '#12345', '#1234567', '#12345G', 'red;background:url(x)']) {
      await violates(set('color = $2', bad), 'members_color_hex');
    }
  });

  test('households: name up to 60, address up to 120', async () => {
    const set = (sql, value) => q(second.user, `update public.households set ${sql} where id = $1`, [h.id, value]);
    assert.equal((await set('name = $2', chars(60))).rowCount, 1);
    await violates(set('name = $2', chars(61)), 'households_name_length');
    assert.equal((await set('address = $2', chars(120))).rowCount, 1);
    await violates(set('address = $2', chars(121)), 'households_address_length');
  });

  test('areas: name up to 60', async () => {
    const add = (name) => q(h.owner, 'insert into public.areas (household_id, name) values ($1, $2) returning id', [h.id, name]);
    const { rows } = await add(chars(60));
    await violates(add(chars(61)), 'areas_name_length');
    await violates(q(h.owner, 'update public.areas set name = $2 where id = $1', [rows[0].id, chars(61)]), 'areas_name_length');
  });

  test('the RPCs hit the same limits and leave nothing behind', async () => {
    const user = await createUser();
    const create = (over) =>
      rpc(user, 'create_household', [
        over.name ?? 'Home',
        over.address ?? '',
        'Europe/London',
        over.memberName ?? 'Me',
        over.emoji ?? '🦔',
        over.areas ?? ['Kitchen'],
        JSON.stringify(over.items ?? []),
      ]);
    await violates(create({ name: chars(61) }), 'households_name_length');
    await violates(create({ address: chars(121) }), 'households_address_length');
    await violates(create({ memberName: chars(41) }), 'members_name_length');
    await violates(create({ emoji: chars(17, '🦔') }), 'members_emoji_length');
    await violates(create({ areas: [chars(61)] }), 'areas_name_length');
    await violates(
      create({ items: [{ area: 'Kitchen', title: chars(201), rag: 'green', due_in_days: 1, repeat: 'none', notify: 'none' }] }),
      'items_title_length',
    );
    await violates(
      create({ items: [{ area: 'Kitchen', title: 'Ok', note: chars(4001), rag: 'green', due_in_days: 1, repeat: 'none', notify: 'none' }] }),
      'items_note_length',
    );
    assert.equal((await one('select count(*)::int as n from public.members where user_id = $1', [user.id])).n, 0);

    const token = await rpc(h.owner, 'create_invite');
    await violates(rpc(user, 'join_household', [token, chars(41), '🦆']), 'members_name_length');
    await violates(rpc(user, 'join_household', [token, 'Joiner', chars(17, '🦆')]), 'members_emoji_length');
    assert.equal((await one('select count(*)::int as n from public.members where user_id = $1', [user.id])).n, 0);
    // Within the limits it works.
    assert.equal(await rpc(user, 'join_household', [token, chars(40), '🦆']), h.id);
  });
});

describe('push subscriptions: endpoint and key rules', () => {
  let h;

  before(async () => {
    h = await createHousehold({ name: 'Endpoint home' });
  });

  const insertSub = (endpoint, { p256dh = 'key', auth = 'secret', userAgent = 'test' } = {}) =>
    q(
      h.owner,
      'insert into public.push_subs (member_id, endpoint, p256dh, auth, user_agent) values ($1, $2, $3, $4, $5) returning *',
      [h.member.id, endpoint, p256dh, auth, userAgent],
    );

  test('only https URLs of at most 2048 characters', async () => {
    const bad = [
      'http://127.0.0.1:54321/rest/v1/',
      'http://169.254.169.254/latest/meta-data/',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'HTTPS//fcm.googleapis.com/x',
      'https://',
      'https://fcm.googleapis.com/fcm send/x',
      `https://fcm.googleapis.com/fcm/send/${chars(2048)}`,
    ];
    for (const endpoint of bad) await violates(insertSub(endpoint), 'push_subs_endpoint_https');

    const ok = `https://fcm.googleapis.com/fcm/send/${h.id}-`;
    const longest = ok + chars(2048 - ok.length);
    const { rows } = await insertSub(longest);
    assert.equal(rows[0].endpoint.length, 2048);
    await violates(
      q(h.owner, 'update public.push_subs set endpoint = $2 where id = $1', [rows[0].id, 'http://kong:8000/functions/v1/scheduler']),
      'push_subs_endpoint_https',
    );
  });

  test('keys are at most 256 characters; a long user agent is cut to 512', async () => {
    const endpoint = `https://updates.push.services.mozilla.com/wpush/v2/${h.id}`;
    await violates(insertSub(endpoint, { p256dh: chars(257) }), 'push_subs_keys_length');
    await violates(insertSub(endpoint, { auth: chars(257) }), 'push_subs_keys_length');
    const { rows } = await insertSub(endpoint, { userAgent: chars(600) });
    assert.equal(rows[0].user_agent.length, 512);
    await violates(
      q(h.owner, 'update public.push_subs set user_agent = $2 where id = $1', [rows[0].id, chars(513)]),
      'push_subs_user_agent_length',
    );
  });
});

describe('push subscriptions: replacing a stored endpoint', () => {
  let alice;
  let bob;

  before(async () => {
    alice = await createHousehold({ name: 'Alice home', memberName: 'Alice' });
    bob = await createHousehold({ name: 'Bob home', memberName: 'Bob' });
  });

  const insertSub = (h, endpoint, keys, { upsert = false, userId } = {}) =>
    q(
      h.owner,
      `insert into public.push_subs (member_id, endpoint, p256dh, auth${userId ? ', user_id' : ''})
       values ($1, $2, $3, $4${userId ? ', $5' : ''})
       ${upsert ? 'on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth' : ''}
       returning *`,
      [h.member.id, endpoint, keys.p256dh, keys.auth, ...(userId ? [userId] : [])],
    );
  const rowsFor = async (endpoint) =>
    (await db('select user_id, p256dh, auth from public.push_subs where endpoint = $1', [endpoint])).rows;

  test("knowing another user's endpoint is not enough to take it over", async () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/alice-${alice.id}`;
    const aliceKeys = { p256dh: 'alice-p256dh', auth: 'alice-auth' };
    await insertSub(alice, endpoint, aliceKeys);
    const original = [{ user_id: alice.owner.id, ...aliceKeys }];

    // Plain insert with other keys: the unique constraint refuses it.
    await rejects(insertSub(bob, endpoint, { p256dh: 'bob-p256dh', auth: 'bob-auth' }), /duplicate key value/);
    assert.deepEqual(await rowsFor(endpoint), original);
    // supabase-js upsert(onConflict: 'endpoint'): Alice's row fails Bob's update policy.
    await rejects(insertSub(bob, endpoint, { p256dh: 'bob-p256dh', auth: 'bob-auth' }, { upsert: true }), /row-level security/);
    assert.deepEqual(await rowsFor(endpoint), original);
    // Claiming to be Alice gets past the trigger's "same user" rule but not RLS, and the
    // trigger's delete is rolled back with the insert.
    await rejects(insertSub(bob, endpoint, { p256dh: 'bob-p256dh', auth: 'bob-auth' }, { userId: alice.owner.id }), /row-level security/);
    assert.deepEqual(await rowsFor(endpoint), original);
  });

  test('the same browser subscription (same keys) moves to whoever subscribes last', async () => {
    const endpoint = `https://web.push.apple.com/shared-${alice.id}`;
    const keys = { p256dh: 'device-p256dh', auth: 'device-auth' };
    await insertSub(alice, endpoint, keys);
    const { rows } = await insertSub(bob, endpoint, keys);
    assert.equal(rows[0].user_id, bob.owner.id);
    assert.deepEqual(await rowsFor(endpoint), [{ user_id: bob.owner.id, ...keys }]);
  });

  test('an own row is replaced whatever its keys', async () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/own-${alice.id}`;
    await insertSub(alice, endpoint, { p256dh: 'old', auth: 'old' });
    await insertSub(alice, endpoint, { p256dh: 'new', auth: 'new' });
    assert.deepEqual(await rowsFor(endpoint), [{ user_id: alice.owner.id, p256dh: 'new', auth: 'new' }]);
  });
});

describe('items: created_by and created_at are fixed', () => {
  let h;
  let second;
  let other;

  before(async () => {
    h = await createHousehold({ name: 'Authorship home' });
    second = await joinHousehold(h, { name: 'Second' });
    other = await createHousehold({ name: 'Other authorship home' });
  });

  test('an update cannot change or clear them, from inside or outside the household', async () => {
    const { rows } = await q(
      second.user,
      "insert into public.items (household_id, area_id, title) values ($1, $2, 'Mine') returning *",
      [h.id, h.areas[0].id],
    );
    const created = rows[0];
    assert.equal(created.created_by, second.member.id);

    for (const value of [h.member.id, other.member.id, null]) {
      const res = await q(h.owner, 'update public.items set created_by = $2 where id = $1 returning created_by', [created.id, value]);
      assert.equal(res.rows[0].created_by, second.member.id, `created_by = ${value}`);
    }
    const res = await q(
      h.owner,
      "update public.items set created_at = '2000-01-01', title = 'Renamed' where id = $1 returning created_at, title",
      [created.id],
    );
    assert.equal(res.rows[0].title, 'Renamed');
    assert.equal(res.rows[0].created_at.getTime(), created.created_at.getTime());
    // The service role cannot rewrite them either.
    await asService((c) => c.query('update public.items set created_by = $2 where id = $1', [created.id, other.member.id]));
    assert.equal((await one('select created_by from public.items where id = $1', [created.id])).created_by, second.member.id);
  });

  test("deleting the creator's account still clears created_by", async () => {
    const leaver = await joinHousehold(h, { name: 'Leaver' });
    const { rows } = await q(
      leaver.user,
      "insert into public.items (household_id, area_id, title) values ($1, $2, 'Left behind') returning id",
      [h.id, h.areas[0].id],
    );
    await db('delete from auth.users where id = $1', [leaver.user.id]);
    const after = await one('select created_by, updated_by from public.items where id = $1', [rows[0].id]);
    assert.deepEqual(after, { created_by: null, updated_by: null });
  });
});

describe('scheduler_open_items (what the scheduler reads)', () => {
  test('open items only, with the note squashed to 200 characters; service role only', async () => {
    const h = await createHousehold({ name: 'View home' });
    const open = await insertItem(h, { title: 'Open', note: `  first\n\n line ${chars(300, 'y')}` });
    const done = await insertItem(h, { title: 'Done' });
    await db("update public.items set status = 'done' where id = $1", [done.id]);

    const rows = await asService(async (c) => (await c.query('select * from public.scheduler_open_items where household_id = $1', [h.id])).rows);
    assert.deepEqual(rows.map((r) => r.id), [open.id]);
    assert.equal(rows[0].note, `first line ${chars(300, 'y')}`.slice(0, 200));
    assert.deepEqual(Object.keys(rows[0]).sort(), [
      'area_id',
      'assignee_id',
      'created_at',
      'due_date',
      'household_id',
      'id',
      'note',
      'notify',
      'rag',
      'status',
      'title',
    ]);

    await rejects(q(h.owner, 'select * from public.scheduler_open_items'), /permission denied/);
    await rejects(q(null, 'select * from public.scheduler_open_items'), /permission denied/);
  });
});
