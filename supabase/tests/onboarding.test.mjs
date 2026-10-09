// Onboarding RPCs: create_household, create_invite, invite_preview, join_household.

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import {
  MEMBER_COLORS,
  as,
  createHousehold,
  createUser,
  dateAdd,
  db,
  joinHousehold,
  one,
  q,
  rejects,
  rpc,
  todayIn,
  trackHousehold,
  useCleanup,
} from './helpers.mjs';

useCleanup();

const createArgs = (overrides = {}) => {
  const a = {
    name: 'Home',
    address: '21 Alderbrook Road',
    timezone: 'Europe/London',
    memberName: 'Stratis',
    emoji: '🦔',
    areas: ['Kitchen'],
    items: [],
    ...overrides,
  };
  return [a.name, a.address, a.timezone, a.memberName, a.emoji, a.areas, a.items === null ? null : JSON.stringify(a.items)];
};

async function create(user, overrides) {
  const id = await rpc(user, 'create_household', createArgs(overrides));
  trackHousehold(id);
  return id;
}

const memberCount = async (userId) => (await one('select count(*)::int as n from public.members where user_id = $1', [userId])).n;

describe('create_household', () => {
  test('creates the household, the owner member and the areas in order', async () => {
    const user = await createUser({ email: 'stored@example.com' });
    user.claims = { email: 'jwt@example.com' };
    const id = await create(user, {
      name: '  Alderbrook  ',
      address: ' 21 Alderbrook Road ',
      memberName: ' Stratis ',
      emoji: '🦊',
      areas: ['Kitchen', '  ', 'Living Room', '', null, ' Garden '],
    });

    const h = await one('select * from public.households where id = $1', [id]);
    assert.equal(h.name, 'Alderbrook');
    assert.equal(h.address, '21 Alderbrook Road');
    assert.equal(h.timezone, 'Europe/London');
    assert.equal(h.weekly_email_day, 1);
    assert.equal(h.weekly_email_time, '08:00:00');

    const m = await one('select * from public.members where user_id = $1', [user.id]);
    assert.equal(m.household_id, id);
    assert.equal(m.name, 'Stratis');
    assert.equal(m.emoji, '🦊');
    assert.equal(m.role, 'owner');
    assert.equal(m.color, '#007AFF');
    assert.equal(m.email, 'jwt@example.com', 'email comes from the JWT');
    assert.equal(m.weekly_email, true);
    assert.equal(m.push_enabled, false);

    const { rows: areas } = await db('select name, position from public.areas where household_id = $1 order by position', [id]);
    assert.deepEqual(areas, [
      { name: 'Kitchen', position: 0 },
      { name: 'Living Room', position: 1 },
      { name: 'Garden', position: 2 },
    ]);

    // The new owner can see it all straight away.
    const seen = await q(user, 'select id from public.households');
    assert.deepEqual(seen.rows.map((r) => r.id), [id]);
  });

  test('email falls back to auth.users when the JWT has none; blank emoji defaults to 🦔', async () => {
    const user = await createUser({ email: 'fallback@example.com' });
    user.claims = { email: undefined };
    await create(user, { emoji: '  ' });
    const m = await one('select email, emoji from public.members where user_id = $1', [user.id]);
    assert.equal(m.email, 'fallback@example.com');
    assert.equal(m.emoji, '🦔');
  });

  test('no areas and null items are fine', async () => {
    const user = await createUser();
    const id = await create(user, { areas: [], items: null });
    assert.equal((await one('select count(*)::int as n from public.areas where household_id = $1', [id])).n, 0);
  });

  test('seeds items: matched to areas case-insensitively, due relative to today, unassigned', async () => {
    const user = await createUser();
    const tz = 'Europe/London';
    const id = await create(user, {
      timezone: tz,
      areas: ['Kitchen', 'Hallway', 'Front garden'],
      items: [
        { area: 'kitchen', title: 'Kitchen paper', note: 'Restocked.', rag: 'green', due_in_days: 28, repeat: 'monthly', notify: 'day_before' },
        { area: 'HALLWAY', title: 'Heaters not working', note: 'No heat.', rag: 'red', due_in_days: -2, repeat: 'none', notify: 'week_before' },
        { area: ' Front Garden ', title: 'Trim the hedges', note: '', rag: 'green', due_in_days: null, repeat: 'quarterly', notify: 'none' },
        { area: 'Jacuzzi', title: 'Change the filter', note: '', rag: 'green', due_in_days: 12, repeat: 'monthly', notify: 'day_before' },
        { area: 'Kitchen', title: 'Defaults only', due_in_days: 0, demo_assignee: 'me' },
      ],
    });
    const member = await one('select id from public.members where user_id = $1', [user.id]);
    const { rows } = await db('select i.*, a.name as area_name from public.items i join public.areas a on a.id = i.area_id where i.household_id = $1 order by i.title', [id]);
    assert.deepEqual(
      rows.map((r) => r.title),
      ['Defaults only', 'Heaters not working', 'Kitchen paper', 'Trim the hedges'],
      'the item for the unknown area is skipped',
    );
    const today = await todayIn(tz);
    const byTitle = Object.fromEntries(rows.map((r) => [r.title, r]));

    assert.equal(byTitle['Kitchen paper'].area_name, 'Kitchen');
    assert.equal(byTitle['Kitchen paper'].due_date, await dateAdd(today, '28 days'));
    assert.equal(byTitle['Kitchen paper'].note, 'Restocked.');
    assert.equal(byTitle['Kitchen paper'].rag, 'green');
    assert.equal(byTitle['Kitchen paper'].repeat, 'monthly');
    assert.equal(byTitle['Kitchen paper'].notify, 'day_before');

    assert.equal(byTitle['Heaters not working'].area_name, 'Hallway');
    assert.equal(byTitle['Heaters not working'].due_date, await dateAdd(today, '-2 days'));
    assert.equal(byTitle['Heaters not working'].notify, 'week_before');

    assert.equal(byTitle['Trim the hedges'].area_name, 'Front garden');
    assert.equal(byTitle['Trim the hedges'].due_date, null);

    const d = byTitle['Defaults only'];
    assert.equal(d.due_date, today);
    assert.deepEqual([d.rag, d.repeat, d.notify, d.note], ['amber', 'none', 'day_before', '']);

    for (const r of rows) {
      assert.equal(r.status, 'open');
      assert.equal(r.assignee_id, null);
      assert.equal(r.created_by, member.id);
      assert.equal(r.updated_by, member.id);
      assert.equal(r.completed_at, null);
    }
  });

  test("due dates use today in the household's time zone", async () => {
    // UTC+14 and UTC-11 are always on different calendar days.
    const zones = ['Pacific/Kiritimati', 'Pacific/Pago_Pago'];
    const dues = [];
    for (const tz of zones) {
      const user = await createUser();
      const id = await create(user, { timezone: tz, items: [{ area: 'Kitchen', title: 'Today', due_in_days: 0 }, { area: 'Kitchen', title: 'Week', due_in_days: 7 }] });
      const { rows } = await db('select title, due_date from public.items where household_id = $1 order by title', [id]);
      const today = await todayIn(tz);
      assert.deepEqual(rows, [
        { title: 'Today', due_date: today },
        { title: 'Week', due_date: await dateAdd(today, '7 days') },
      ]);
      assert.equal((await one('select timezone from public.households where id = $1', [id])).timezone, tz);
      dues.push(rows[0].due_date);
    }
    assert.notEqual(dues[0], dues[1]);
  });

  test("an unknown or empty time zone falls back to 'Europe/London'", async () => {
    for (const tz of ['Mars/Olympus_Mons', '', null, 'not a zone; drop table x']) {
      const user = await createUser();
      const id = await create(user, { timezone: tz, items: [{ area: 'Kitchen', title: 'Today', due_in_days: 0 }] });
      const h = await one('select timezone from public.households where id = $1', [id]);
      assert.equal(h.timezone, 'Europe/London');
      const item = await one('select due_date from public.items where household_id = $1', [id]);
      assert.equal(item.due_date, await todayIn('Europe/London'));
    }
  });

  test('invalid input is rejected and creates nothing', async () => {
    const bad = [
      { name: '   ' },
      { memberName: '' },
      { items: { not: 'an array' } },
      { items: ['just a string'] },
      { items: [{ area: 'Kitchen', title: '  ' }] },
      { items: [{ area: 'Kitchen', title: 'x', rag: 'blue' }] },
      { items: [{ area: 'Kitchen', title: 'x', repeat: 'daily' }] },
      { items: [{ area: 'Kitchen', title: 'x', notify: 'hourly' }] },
      { items: [{ area: 'Kitchen', title: 'x', due_in_days: '3' }] },
      { items: [{ area: 'Kitchen', title: 'x', due_in_days: 1.5 }] },
      { items: [{ area: 'Kitchen', title: 'x', due_in_days: 1e9 }] },
      // Validation does not depend on the area existing.
      { items: [{ area: 'Nowhere', title: 'x', rag: 'purple' }] },
    ];
    for (const overrides of bad) {
      const user = await createUser();
      await rejects(rpc(user, 'create_household', createArgs(overrides)), 'invalid_input');
      assert.equal(await memberCount(user.id), 0, JSON.stringify(overrides));
    }
  });

  test('already_member when the caller has a household (own or joined)', async () => {
    const h = await createHousehold();
    await rejects(rpc(h.owner, 'create_household', createArgs()), 'already_member');
    const joined = await joinHousehold(h);
    await rejects(rpc(joined.user, 'create_household', createArgs()), 'already_member');
    assert.equal(await memberCount(h.owner.id), 1);
    assert.equal(await memberCount(joined.user.id), 1);
  });

  test('not_signed_in without a user id in the JWT', async () => {
    await rejects(rpc({ claims: { role: 'authenticated' } }, 'create_household', createArgs()), 'not_signed_in');
  });

  test('two concurrent calls by the same user: one household, the other already_member', async () => {
    const user = await createUser();
    let created;
    const hasCreated = new Promise((r) => (created = r));
    let release;
    const gate = new Promise((r) => (release = r));
    const first = as(user, async (c) => {
      const { rows } = await c.query('select public.create_household($1, $2, $3, $4, $5, $6, $7) as id', createArgs());
      trackHousehold(rows[0].id);
      created();
      await gate;
    });
    await hasCreated;
    // Not committed yet, so this call passes the membership check and then waits on the
    // unique index until the first transaction commits.
    const racer = rpc(user, 'create_household', createArgs({ name: 'Racer' }));
    await new Promise((r) => setTimeout(r, 150));
    release();
    await first;
    await rejects(racer, 'already_member');
    assert.equal(await memberCount(user.id), 1);
    assert.equal((await one("select count(*)::int as n from public.households where name = 'Racer'")).n, 0);
  });
});

describe('create_invite', () => {
  test('returns a fresh 32-hex token valid for 14 days, for any member', async () => {
    const h = await createHousehold();
    const second = await joinHousehold(h);
    const t1 = await rpc(h.owner, 'create_invite');
    const t2 = await rpc(second.user, 'create_invite');
    for (const t of [t1, t2]) assert.match(t, /^[0-9a-f]{32}$/);
    assert.notEqual(t1, t2);
    const row = await one(
      `select *, extract(epoch from (expires_at - now() - interval '14 days')) as drift
       from public.invites where token = $1`,
      [t2],
    );
    assert.equal(row.household_id, h.id);
    assert.equal(row.created_by, second.member.id);
    assert.ok(Math.abs(Number(row.drift)) < 120, `expires_at drift ${row.drift}s`);
  });

  test('not_signed_in / not_found', async () => {
    await rejects(rpc({ claims: { role: 'authenticated' } }, 'create_invite'), 'not_signed_in');
    await rejects(rpc(await createUser(), 'create_invite'), 'not_found');
  });
});

describe('invite_preview', () => {
  let h;
  let token;
  before(async () => {
    h = await createHousehold({ name: 'Preview home', address: '7 Preview Lane' });
    token = await rpc(h.owner, 'create_invite');
  });

  test('valid token: household name and address, for any signed-in user', async () => {
    const stranger = await createUser();
    assert.deepEqual(await rpc(stranger, 'invite_preview', [token]), { household_name: 'Preview home', address: '7 Preview Lane' });
    assert.deepEqual(await rpc(stranger, 'invite_preview', [` ${token}\n`]), { household_name: 'Preview home', address: '7 Preview Lane' });
    const other = await createHousehold();
    assert.deepEqual(await rpc(other.owner, 'invite_preview', [token]), { household_name: 'Preview home', address: '7 Preview Lane' });
  });

  test('unknown, empty or expired tokens: null', async () => {
    const stranger = await createUser();
    assert.equal(await rpc(stranger, 'invite_preview', ['0'.repeat(32)]), null);
    assert.equal(await rpc(stranger, 'invite_preview', ['']), null);
    assert.equal(await rpc(stranger, 'invite_preview', [null]), null);
    const expired = await rpc(h.owner, 'create_invite');
    await db("update public.invites set expires_at = now() - interval '1 second' where token = $1", [expired]);
    assert.equal(await rpc(stranger, 'invite_preview', [expired]), null);
  });
});

describe('join_household', () => {
  test('joins with role member, the next colour and the JWT email', async () => {
    const h = await createHousehold({ name: 'Join home' });
    const token = await rpc(h.owner, 'create_invite');
    const user = await createUser({ email: 'shea@example.com' });
    const id = await rpc(user, 'join_household', [token, ' Shea ', '🦆']);
    assert.equal(id, h.id);
    const m = await one('select * from public.members where user_id = $1', [user.id]);
    assert.equal(m.household_id, h.id);
    assert.equal(m.name, 'Shea');
    assert.equal(m.emoji, '🦆');
    assert.equal(m.role, 'member');
    assert.equal(m.color, MEMBER_COLORS[1]);
    assert.equal(m.email, 'shea@example.com');
    // Now a member, they see the household and can edit it.
    const seen = await q(user, 'select id from public.households');
    assert.deepEqual(seen.rows.map((r) => r.id), [h.id]);
  });

  test('an invite can be reused by several people until it expires', async () => {
    const h = await createHousehold();
    const token = await rpc(h.owner, 'create_invite');
    const u1 = await createUser();
    const u2 = await createUser();
    assert.equal(await rpc(u1, 'join_household', [token, 'One', '🦊']), h.id);
    assert.equal(await rpc(u2, 'join_household', [token, 'Two', '🐻']), h.id);
    assert.equal((await one('select count(*)::int as n from public.members where household_id = $1', [h.id])).n, 3);
  });

  test('rejoining is idempotent: same id, no duplicate, profile untouched', async () => {
    const h = await createHousehold();
    const token = await rpc(h.owner, 'create_invite');
    const user = await createUser();
    await rpc(user, 'join_household', [token, 'First', '🦊']);
    assert.equal(await rpc(user, 'join_household', [token, 'Second', '🐼']), h.id);
    // Even once the link has expired, opening it again is harmless.
    await db("update public.invites set expires_at = now() - interval '1 day' where token = $1", [token]);
    assert.equal(await rpc(user, 'join_household', [token, 'Third', '🐨']), h.id);
    assert.equal(await memberCount(user.id), 1);
    const m = await one('select name, emoji from public.members where user_id = $1', [user.id]);
    assert.deepEqual(m, { name: 'First', emoji: '🦊' });
    // The owner opening their own household's link gets the same answer.
    const ownerToken = await rpc(h.owner, 'create_invite');
    assert.equal(await rpc(h.owner, 'join_household', [ownerToken, 'x', 'x']), h.id);
  });

  test('already_member when the caller belongs to another household', async () => {
    const a = await createHousehold({ name: 'A' });
    const b = await createHousehold({ name: 'B' });
    const token = await rpc(a.owner, 'create_invite');
    await rejects(rpc(b.owner, 'join_household', [token, 'x', '🦔']), 'already_member');
    const m = await one('select household_id from public.members where user_id = $1', [b.owner.id]);
    assert.equal(m.household_id, b.id);
    assert.equal((await one('select count(*)::int as n from public.members where household_id = $1', [a.id])).n, 1);
  });

  test('invalid_invite for unknown, empty or expired tokens', async () => {
    const h = await createHousehold();
    const expired = await rpc(h.owner, 'create_invite');
    await db("update public.invites set expires_at = now() - interval '1 second' where token = $1", [expired]);
    const user = await createUser();
    for (const token of ['f'.repeat(32), '', null, expired]) {
      await rejects(rpc(user, 'join_household', [token, 'x', '🦔']), 'invalid_invite');
    }
    assert.equal(await memberCount(user.id), 0);
  });

  test('blank name is invalid_input; blank emoji defaults to 🦔', async () => {
    const h = await createHousehold();
    const token = await rpc(h.owner, 'create_invite');
    const user = await createUser();
    await rejects(rpc(user, 'join_household', [token, '  ', '🦔']), 'invalid_input');
    await rpc(user, 'join_household', [token, 'Ela', '']);
    assert.equal((await one('select emoji from public.members where user_id = $1', [user.id])).emoji, '🦔');
  });

  test('not_signed_in without a user id', async () => {
    const h = await createHousehold();
    const token = await rpc(h.owner, 'create_invite');
    await rejects(rpc({ claims: { role: 'authenticated' } }, 'join_household', [token, 'x', '🦔']), 'not_signed_in');
  });

  test('colours follow join order and cycle after six', async () => {
    const h = await createHousehold();
    for (let i = 0; i < 7; i++) await joinHousehold(h, { name: `Member ${i + 1}` });
    const { rows } = await db('select color, role from public.members where household_id = $1 order by created_at, id', [h.id]);
    assert.equal(rows.length, 8);
    assert.equal(rows[0].role, 'owner');
    assert.deepEqual(
      rows.map((r) => r.color),
      [0, 1, 2, 3, 4, 5, 0, 1].map((i) => MEMBER_COLORS[i]),
    );
  });
});
