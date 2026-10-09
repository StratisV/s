// Privileges and row level security: anon gets nothing, outsiders see and change nothing,
// members can edit everything in their household (within the column grants).

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import {
  as,
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

const TABLES = [
  'households',
  'members',
  'areas',
  'items',
  'completions',
  'invites',
  'push_subs',
  'notifications_log',
];

const RPCS = [
  ['create_household', "'x', 'y', 'Europe/London', 'n', '🦔', array['Kitchen']"],
  ['invite_preview', "'token'"],
  ['join_household', "'token', 'n', '🦔'"],
  ['create_invite', ''],
  ['complete_item', 'gen_random_uuid()'],
  ['undo_completion', 'gen_random_uuid()'],
  ['reorder_areas', "gen_random_uuid(), array[]::uuid[]"],
];

const PERMISSION_DENIED = /permission denied/;
const RLS_VIOLATION = /violates row-level security policy/;

/** A household with two members, an item, a completion, an invite, push subs and a log row. */
async function fullHousehold(label) {
  const h = await createHousehold({ name: `${label} home`, memberName: `${label} owner` });
  const second = await joinHousehold(h, { name: `${label} second` });
  const item = await insertItem(h, { title: `${label} item`, assignee_id: second.member.id, due_date: '2099-01-01' });
  const repeating = await insertItem(h, { title: `${label} repeating`, repeat: 'weekly', due_date: '2099-01-01' });
  const completionId = await rpc(h.owner, 'complete_item', [repeating.id]);
  const token = await rpc(h.owner, 'create_invite');
  await q(h.owner, 'insert into public.push_subs (member_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)', [
    h.member.id,
    `https://push.example.com/${label}-${h.id}`,
    'p256dh',
    'auth',
  ]);
  await db("insert into public.notifications_log (household_id, item_id, member_id, kind, ref_date) values ($1, $2, $3, 'reminder', '2099-01-01')", [
    h.id,
    item.id,
    h.member.id,
  ]);
  return { ...h, second, item, repeating, completionId, token };
}

/** Everything stored for a household, for before/after comparisons. */
async function snapshot(householdId) {
  const out = {};
  out.households = (await db('select * from public.households where id = $1', [householdId])).rows;
  for (const t of ['members', 'areas', 'items', 'completions', 'invites', 'notifications_log']) {
    out[t] = (await db(`select * from public.${t} where household_id = $1 order by id`, [householdId])).rows;
  }
  out.push_subs = (
    await db(
      'select s.* from public.push_subs s join public.members m on m.id = s.member_id where m.household_id = $1 order by s.id',
      [householdId],
    )
  ).rows;
  return out;
}

describe('structure', () => {
  test('every public table has RLS enabled', async () => {
    const { rows } = await db(
      `select c.relname, c.relrowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    for (const t of TABLES) assert.ok(rows.some((r) => r.relname === t), `missing table ${t}`);
    for (const r of rows) assert.equal(r.relrowsecurity, true, `RLS off on ${r.relname}`);
  });

  test('anon has no privilege on any table or function in public', async () => {
    const { rows: tables } = await db(
      `select c.relname,
              has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger') as any_priv,
              has_any_column_privilege('anon', c.oid, 'select,insert,update,references') as any_col
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')`,
    );
    for (const r of tables) {
      assert.equal(r.any_priv, false, `anon has a privilege on ${r.relname}`);
      assert.equal(r.any_col, false, `anon has a column privilege on ${r.relname}`);
    }
    const { rows: fns } = await db(
      `select p.proname, has_function_privilege('anon', p.oid, 'execute') as exec
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'`,
    );
    assert.ok(fns.length >= RPCS.length);
    for (const f of fns) assert.equal(f.exec, false, `anon can execute ${f.proname}`);
  });

  test('authenticated has exactly the intended table and column privileges', async () => {
    const priv = async (table, p) =>
      (await one(`select has_table_privilege('authenticated', $1, $2) as ok`, [`public.${table}`, p])).ok;
    const col = async (table, column, p) =>
      (await one(`select has_column_privilege('authenticated', $1, $2, $3) as ok`, [`public.${table}`, column, p])).ok;

    const expected = {
      households: ['SELECT'],
      members: ['SELECT'],
      areas: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
      items: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
      completions: ['SELECT', 'DELETE'],
      invites: ['SELECT'],
      push_subs: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
      notifications_log: [],
    };
    for (const [table, allowed] of Object.entries(expected)) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        assert.equal(await priv(table, p), allowed.includes(p), `${table} ${p}`);
      }
    }

    const householdCols = ['name', 'address', 'timezone', 'weekly_email_day', 'weekly_email_time'];
    for (const c of ['id', 'created_at', 'updated_at', 'updated_by', ...householdCols]) {
      assert.equal(await col('households', c, 'UPDATE'), householdCols.includes(c), `households.${c}`);
    }
    const memberCols = ['name', 'emoji', 'color', 'weekly_email', 'push_enabled'];
    for (const c of ['id', 'household_id', 'user_id', 'email', 'role', 'created_at', ...memberCols]) {
      assert.equal(await col('members', c, 'UPDATE'), memberCols.includes(c), `members.${c}`);
    }
    for (const c of ['id', 'name']) assert.equal(await col('households', c, 'INSERT'), false, `households.${c} insert`);
    for (const c of ['id', 'household_id', 'user_id', 'name']) assert.equal(await col('members', c, 'INSERT'), false, `members.${c} insert`);
  });

  test('functions: security definer ones pin search_path, grants match the contract', async () => {
    const { rows } = await db(
      `select p.proname, p.prosecdef, p.proconfig,
              has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'`,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.proname, r]));
    for (const r of rows) {
      if (r.prosecdef) {
        assert.ok(
          (r.proconfig ?? []).some((c) => c === 'search_path=""' || c === 'search_path='),
          `${r.proname} is security definer without search_path=''`,
        );
      }
    }
    const callable = [...RPCS.map(([n]) => n), 'current_member_id', 'is_household_member'];
    for (const name of callable) {
      assert.ok(byName[name], `missing function ${name}`);
      assert.equal(byName[name].prosecdef, true, `${name} should be security definer`);
      assert.equal(byName[name].auth_exec, true, `authenticated cannot execute ${name}`);
    }
    const internal = ['next_due_date', 'is_valid_timezone', 'households_before_write', 'items_before_write', 'push_subs_before_insert'];
    for (const name of internal) {
      assert.ok(byName[name], `missing function ${name}`);
      assert.equal(byName[name].auth_exec, false, `authenticated can execute ${name}`);
    }
  });

  test('realtime publication and replica identity', async () => {
    const pub = await one("select count(*)::int as n from pg_publication where pubname = 'supabase_realtime'");
    if (pub.n === 1) {
      const { rows } = await db(
        "select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'",
      );
      const published = rows.map((r) => r.tablename);
      for (const t of ['households', 'members', 'areas', 'items', 'completions']) {
        assert.ok(published.includes(t), `${t} is not in supabase_realtime`);
      }
      for (const t of ['invites', 'push_subs', 'notifications_log']) {
        assert.ok(!published.includes(t), `${t} should not be published`);
      }
    }
    const { rows } = await db(
      `select c.relname, c.relreplident from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1)`,
      [['members', 'areas', 'items', 'completions']],
    );
    assert.equal(rows.length, 4);
    for (const r of rows) assert.equal(r.relreplident, 'f', `${r.relname} replica identity`);
  });
});

describe('anon', () => {
  let h;
  before(async () => {
    h = await fullHousehold('anon');
  });

  for (const table of TABLES) {
    test(`cannot read ${table}`, async () => {
      await rejects(q(null, `select * from public.${table}`), PERMISSION_DENIED);
    });
  }

  test('cannot write any table', async () => {
    await rejects(q(null, 'insert into public.areas (household_id, name) values ($1, $2)', [h.id, 'x']), PERMISSION_DENIED);
    await rejects(q(null, 'update public.households set name = $1', ['x']), PERMISSION_DENIED);
    await rejects(q(null, 'delete from public.items'), PERMISSION_DENIED);
    await rejects(q(null, 'delete from public.completions'), PERMISSION_DENIED);
  });

  for (const [fn, args] of RPCS) {
    test(`cannot call ${fn}`, async () => {
      await rejects(q(null, `select public.${fn}(${args})`), /permission denied for function/);
    });
  }

  test('cannot call the helpers', async () => {
    await rejects(q(null, 'select public.current_member_id()'), /permission denied for function/);
    await rejects(q(null, 'select public.is_household_member($1)', [h.id]), /permission denied for function/);
  });
});

describe('outsiders', () => {
  let a;
  let b;
  let loner;
  let before_;

  before(async () => {
    a = await fullHousehold('A');
    b = await fullHousehold('B');
    loner = await createUser({ name: 'Loner' });
    before_ = await snapshot(a.id);
  });

  const outsiders = () => [
    ['a member of another household', b.owner],
    ['a user without a household', loner],
  ];

  test('see nothing of another household, in any table', async () => {
    for (const [label, user] of outsiders()) {
      for (const t of ['members', 'areas', 'items', 'completions', 'invites']) {
        const { rows } = await q(user, `select * from public.${t} where household_id = $1`, [a.id]);
        assert.equal(rows.length, 0, `${label} sees ${t}`);
      }
      const hh = await q(user, 'select * from public.households where id = $1', [a.id]);
      assert.equal(hh.rows.length, 0, `${label} sees the household`);
      const subs = await q(user, 'select * from public.push_subs where member_id = any($1)', [[a.member.id, a.second.member.id]]);
      assert.equal(subs.rows.length, 0, `${label} sees push subs`);
      await rejects(q(user, 'select * from public.notifications_log'), PERMISSION_DENIED);
    }
  });

  test('only ever see their own household', async () => {
    for (const t of ['members', 'areas', 'items', 'completions', 'invites']) {
      const { rows } = await q(b.owner, `select household_id from public.${t}`);
      assert.ok(rows.length > 0, `B sees its own ${t}`);
      assert.ok(rows.every((r) => r.household_id === b.id), `B sees foreign ${t}`);
      const lonely = await q(loner, `select * from public.${t}`);
      assert.equal(lonely.rows.length, 0, `loner sees ${t}`);
    }
    const { rows } = await q(b.owner, 'select id from public.households');
    assert.deepEqual(rows.map((r) => r.id), [b.id]);
  });

  test('cannot update or delete anything of another household', async () => {
    for (const [label, user] of outsiders()) {
      const attempts = [
        ['update public.households set name = $2 where id = $1', [a.id, 'hacked']],
        ['update public.members set name = $2 where household_id = $1', [a.id, 'hacked']],
        ['update public.areas set name = $2 where household_id = $1', [a.id, 'hacked']],
        ['update public.items set title = $2 where household_id = $1', [a.id, 'hacked']],
        ['delete from public.items where household_id = $1', [a.id]],
        ['delete from public.areas where household_id = $1', [a.id]],
        ['delete from public.completions where household_id = $1', [a.id]],
        ['update public.push_subs set p256dh = $2 where member_id = $1', [a.member.id, 'hacked']],
        ['delete from public.push_subs where member_id = $1', [a.member.id]],
      ];
      for (const [sql, params] of attempts) {
        const res = await q(user, sql, params);
        assert.equal(res.rowCount, 0, `${label}: ${sql}`);
      }
    }
    assert.deepEqual(await snapshot(a.id), before_);
  });

  test('cannot insert into another household', async () => {
    for (const [, user] of outsiders()) {
      await rejects(q(user, 'insert into public.areas (household_id, name) values ($1, $2)', [a.id, 'x']), RLS_VIOLATION);
      // The trigger takes household_id from the area, so claiming another one does not help.
      const claimed = user === b.owner ? b.id : a.id;
      await rejects(
        q(user, 'insert into public.items (household_id, area_id, title) values ($1, $2, $3)', [claimed, a.areas[0].id, 'x']),
        RLS_VIOLATION,
      );
    }
    // Moving an own item into a foreign area is the same thing (an assigned one is already
    // stopped by the assignee check, since the assignee is not in that household).
    await rejects(q(b.owner, 'update public.items set area_id = $1 where id = $2', [a.areas[0].id, b.repeating.id]), RLS_VIOLATION);
    await rejects(q(b.owner, 'update public.items set area_id = $1 where id = $2', [a.areas[0].id, b.item.id]), 'invalid_input');
    // Pointing an own push subscription at a foreign member is refused.
    await rejects(
      q(b.owner, 'insert into public.push_subs (member_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)', [
        a.member.id,
        'https://push.example.com/foreign',
        'k',
        'a',
      ]),
      RLS_VIOLATION,
    );
    assert.deepEqual(await snapshot(a.id), before_);
  });

  test('cannot use the RPCs on another household', async () => {
    for (const [, user] of outsiders()) {
      await rejects(rpc(user, 'complete_item', [a.item.id]), 'not_found');
      await rejects(rpc(user, 'undo_completion', [a.completionId]), 'not_found');
      await rejects(rpc(user, 'reorder_areas', [a.id, a.areas.map((x) => x.id).reverse()]), 'not_found');
    }
    await rejects(rpc(loner, 'create_invite'), 'not_found');
    // A member of B creates an invite for B, never for A.
    const token = await rpc(b.owner, 'create_invite');
    assert.equal((await one('select household_id from public.invites where token = $1', [token])).household_id, b.id);
    assert.deepEqual(await snapshot(a.id), before_);
  });

  test('ids that do not exist look the same as foreign ones', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    await rejects(rpc(a.owner, 'complete_item', [missing]), 'not_found');
    await rejects(rpc(a.owner, 'undo_completion', [missing]), 'not_found');
    await rejects(rpc(a.owner, 'reorder_areas', [missing, []]), 'not_found');
  });
});

describe('members can edit everything in their household', () => {
  let h;
  let second;

  before(async () => {
    h = await createHousehold({ name: 'Edit home' });
    second = await joinHousehold(h, { name: 'Second' });
  });

  test('household fields, stamped with updated_by / updated_at', async () => {
    const was = await one('select * from public.households where id = $1', [h.id]);
    const res = await q(
      second.user,
      `update public.households
       set name = 'Renamed', address = '2 New Road', timezone = 'America/New_York',
           weekly_email_day = 5, weekly_email_time = '18:30'
       where id = $1 returning *`,
      [h.id],
    );
    assert.equal(res.rowCount, 1);
    const row = res.rows[0];
    assert.equal(row.name, 'Renamed');
    assert.equal(row.address, '2 New Road');
    assert.equal(row.timezone, 'America/New_York');
    assert.equal(row.weekly_email_day, 5);
    assert.equal(row.weekly_email_time, '18:30:00');
    assert.equal(row.updated_by, second.member.id);
    assert.ok(row.updated_at > was.updated_at);
  });

  test('household: unknown time zone and out-of-range day are rejected', async () => {
    await rejects(q(h.owner, "update public.households set timezone = 'Mars/Olympus' where id = $1", [h.id]), 'invalid_input');
    await rejects(q(h.owner, 'update public.households set weekly_email_day = 7 where id = $1', [h.id]), /check constraint/);
  });

  test('household: other columns, insert and delete are not allowed', async () => {
    await rejects(q(h.owner, 'update public.households set updated_by = null where id = $1', [h.id]), PERMISSION_DENIED);
    await rejects(q(h.owner, 'update public.households set created_at = now() where id = $1', [h.id]), PERMISSION_DENIED);
    await rejects(q(h.owner, 'update public.households set id = gen_random_uuid() where id = $1', [h.id]), PERMISSION_DENIED);
    await rejects(q(h.owner, "insert into public.households (name) values ('x')"), PERMISSION_DENIED);
    await rejects(q(h.owner, 'delete from public.households where id = $1', [h.id]), PERMISSION_DENIED);
  });

  test("anyone's profile fields, including the owner's", async () => {
    const res = await q(
      second.user,
      `update public.members
       set name = 'Boss', emoji = '🦊', color = '#123456', weekly_email = false, push_enabled = true
       where id = $1 returning *`,
      [h.member.id],
    );
    assert.equal(res.rowCount, 1);
    assert.equal(res.rows[0].name, 'Boss');
    assert.equal(res.rows[0].emoji, '🦊');
    assert.equal(res.rows[0].color, '#123456');
    assert.equal(res.rows[0].weekly_email, false);
    assert.equal(res.rows[0].push_enabled, true);
    const own = await q(h.owner, "update public.members set name = 'Me again' where id = $1", [h.member.id]);
    assert.equal(own.rowCount, 1);
  });

  test('members: not household_id, user_id, role, email or id; no insert or delete', async () => {
    const other = await createHousehold({ name: 'Elsewhere' });
    const attempts = [
      ['update public.members set household_id = $2 where id = $1', [second.member.id, other.id]],
      ['update public.members set user_id = $2 where id = $1', [second.member.id, h.owner.id]],
      ["update public.members set role = 'owner' where id = $1", [second.member.id]],
      ["update public.members set email = 'x@example.com' where id = $1", [second.member.id]],
      ['update public.members set id = gen_random_uuid() where id = $1', [second.member.id]],
      ['delete from public.members where id = $1', [second.member.id]],
    ];
    for (const [sql, params] of attempts) {
      await rejects(q(second.user, sql, params), PERMISSION_DENIED);
    }
    const stranger = await createUser();
    await rejects(
      q(stranger, "insert into public.members (household_id, user_id, name, color) values ($1, $2, 'x', '#000000')", [h.id, stranger.id]),
      PERMISSION_DENIED,
    );
    await rejects(
      q(second.user, "insert into public.members (household_id, user_id, name, color) values ($1, $2, 'x', '#000000')", [h.id, stranger.id]),
      PERMISSION_DENIED,
    );
    const m = await one('select * from public.members where id = $1', [second.member.id]);
    assert.equal(m.household_id, h.id);
    assert.equal(m.role, 'member');
  });

  test('areas: create, rename, delete (with their items)', async () => {
    const created = await q(second.user, "insert into public.areas (household_id, name, position) values ($1, 'Attic', 9) returning *", [h.id]);
    const area = created.rows[0];
    assert.equal(area.household_id, h.id);
    const renamed = await q(h.owner, "update public.areas set name = 'Loft' where id = $1", [area.id]);
    assert.equal(renamed.rowCount, 1);
    const item = await q(h.owner, "insert into public.items (household_id, area_id, title) values ($1, $2, 'Insulation') returning id", [h.id, area.id]);
    const deleted = await q(second.user, 'delete from public.areas where id = $1', [area.id]);
    assert.equal(deleted.rowCount, 1);
    assert.equal((await one('select count(*)::int as n from public.items where id = $1', [item.rows[0].id])).n, 0);
  });

  test('items: create, edit any field, delete', async () => {
    const created = await q(
      second.user,
      `insert into public.items (household_id, area_id, title, note, rag, due_date, assignee_id, repeat, notify)
       values ($1, $2, 'Fix tap', 'Drips', 'red', '2099-05-01', $3, 'monthly', 'week_before') returning *`,
      [h.id, h.areas[0].id, h.member.id],
    );
    const item = created.rows[0];
    assert.equal(item.assignee_id, h.member.id);
    const edited = await q(
      h.owner,
      `update public.items
       set title = 'Fix kitchen tap', note = '', rag = 'green', due_date = null, assignee_id = $2,
           repeat = 'none', notify = 'none', area_id = $3
       where id = $1 returning *`,
      [item.id, second.member.id, h.areas[1].id],
    );
    assert.equal(edited.rowCount, 1);
    assert.equal(edited.rows[0].area_id, h.areas[1].id);
    assert.equal(edited.rows[0].assignee_id, second.member.id);
    const deleted = await q(second.user, 'delete from public.items where id = $1', [item.id]);
    assert.equal(deleted.rowCount, 1);
  });

  test('completions: read and delete, but only complete_item writes them', async () => {
    const item = await insertItem(h, { title: 'Done soon' });
    const completionId = await rpc(h.owner, 'complete_item', [item.id]);
    const seen = await q(second.user, 'select * from public.completions where id = $1', [completionId]);
    assert.equal(seen.rows.length, 1);
    await rejects(
      q(second.user, "insert into public.completions (household_id, item_title, prev_status) values ($1, 'x', 'open')", [h.id]),
      PERMISSION_DENIED,
    );
    await rejects(q(second.user, "update public.completions set item_title = 'x' where id = $1", [completionId]), PERMISSION_DENIED);
    const deleted = await q(second.user, 'delete from public.completions where id = $1', [completionId]);
    assert.equal(deleted.rowCount, 1);
  });

  test('invites: visible to members, created only through create_invite', async () => {
    const token = await rpc(second.user, 'create_invite');
    const { rows } = await q(h.owner, 'select token from public.invites where household_id = $1', [h.id]);
    assert.ok(rows.some((r) => r.token === token));
    await rejects(q(h.owner, "insert into public.invites (household_id, token) values ($1, 'mine')", [h.id]), PERMISSION_DENIED);
    await rejects(q(h.owner, 'delete from public.invites where token = $1', [token]), PERMISSION_DENIED);
  });

  test('notifications_log is invisible to members', async () => {
    await rejects(q(h.owner, 'select * from public.notifications_log'), PERMISSION_DENIED);
    await rejects(
      q(h.owner, "insert into public.notifications_log (household_id, member_id, kind, ref_date) values ($1, $2, 'weekly', current_date)", [
        h.id,
        h.member.id,
      ]),
      PERMISSION_DENIED,
    );
  });
});

describe('push subscriptions are private to their user', () => {
  let h;
  let second;

  before(async () => {
    h = await createHousehold({ name: 'Push home' });
    second = await joinHousehold(h, { name: 'Second' });
  });

  const insertSub = (user, memberId, endpoint, extra = {}) =>
    q(
      user,
      `insert into public.push_subs (member_id, endpoint, p256dh, auth, user_agent${extra.user_id ? ', user_id' : ''})
       values ($1, $2, 'key', 'secret', 'test'${extra.user_id ? ', $3' : ''}) returning *`,
      extra.user_id ? [memberId, endpoint, extra.user_id] : [memberId, endpoint],
    );

  test('own subscriptions: insert (user_id defaults to the caller), read, update, delete', async () => {
    const endpoint = `https://push.example.com/own-${h.id}`;
    const { rows } = await insertSub(h.owner, h.member.id, endpoint);
    assert.equal(rows[0].user_id, h.owner.id);
    const read = await q(h.owner, 'select * from public.push_subs where endpoint = $1', [endpoint]);
    assert.equal(read.rows.length, 1);
    const updated = await q(h.owner, "update public.push_subs set p256dh = 'new' where endpoint = $1", [endpoint]);
    assert.equal(updated.rowCount, 1);
    const deleted = await q(h.owner, 'delete from public.push_subs where endpoint = $1', [endpoint]);
    assert.equal(deleted.rowCount, 1);
  });

  test("other members' subscriptions are invisible and untouchable", async () => {
    const endpoint = `https://push.example.com/private-${h.id}`;
    await insertSub(h.owner, h.member.id, endpoint);
    const read = await q(second.user, 'select * from public.push_subs');
    assert.equal(read.rows.length, 0);
    assert.equal((await q(second.user, "update public.push_subs set auth = 'x' where endpoint = $1", [endpoint])).rowCount, 0);
    assert.equal((await q(second.user, 'delete from public.push_subs where endpoint = $1', [endpoint])).rowCount, 0);
    assert.equal((await one('select auth from public.push_subs where endpoint = $1', [endpoint])).auth, 'secret');
  });

  test("cannot subscribe on behalf of another member or user", async () => {
    await rejects(insertSub(second.user, h.member.id, `https://push.example.com/x1-${h.id}`), RLS_VIOLATION);
    await rejects(insertSub(second.user, second.member.id, `https://push.example.com/x2-${h.id}`, { user_id: h.owner.id }), RLS_VIOLATION);
    const loner = await createUser();
    await rejects(insertSub(loner, h.member.id, `https://push.example.com/x3-${h.id}`), RLS_VIOLATION);
    const endpoint = `https://push.example.com/x4-${h.id}`;
    await insertSub(second.user, second.member.id, endpoint);
    await rejects(q(second.user, 'update public.push_subs set member_id = $2 where endpoint = $1', [endpoint, h.member.id]), RLS_VIOLATION);
    await rejects(q(second.user, 'update public.push_subs set user_id = $2 where endpoint = $1', [endpoint, h.owner.id]), RLS_VIOLATION);
  });

  test('the same browser endpoint moves to whoever subscribes last; upserts work', async () => {
    const endpoint = `https://push.example.com/shared-${h.id}`;
    await insertSub(h.owner, h.member.id, endpoint);
    const { rows } = await insertSub(second.user, second.member.id, endpoint);
    assert.equal(rows[0].user_id, second.user.id);
    const all = await db('select user_id from public.push_subs where endpoint = $1', [endpoint]);
    assert.deepEqual(all.rows.map((r) => r.user_id), [second.user.id]);
    // supabase-js upsert({ onConflict: 'endpoint' }) on an own row.
    const upsert = await q(
      second.user,
      `insert into public.push_subs (member_id, endpoint, p256dh, auth) values ($1, $2, 'k2', 'a2')
       on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth returning *`,
      [second.member.id, endpoint],
    );
    assert.equal(upsert.rows[0].p256dh, 'k2');
    assert.equal((await one('select count(*)::int as n from public.push_subs where endpoint = $1', [endpoint])).n, 1);
    // A refused takeover leaves the existing row alone.
    const loner = await createUser();
    await rejects(insertSub(loner, second.member.id, endpoint), RLS_VIOLATION);
    assert.equal((await one('select user_id from public.push_subs where endpoint = $1', [endpoint])).user_id, second.user.id);
  });
});

describe('service role (scheduler Edge Function)', () => {
  test('reads every table and writes the notifications log', async () => {
    const h = await createHousehold({ name: 'Service home' });
    const item = await insertItem(h, { title: 'Due', due_date: '2099-01-01' });
    await asService(async (c) => {
      for (const t of TABLES) await c.query(`select * from public.${t} limit 1`);
      const { rows } = await c.query('select id from public.items where household_id = $1', [h.id]);
      assert.equal(rows.length, 1);
      const claim = `insert into public.notifications_log (household_id, item_id, member_id, kind, ref_date)
                     values ($1, $2, $3, 'reminder', '2099-01-01') on conflict do nothing returning id`;
      assert.equal((await c.query(claim, [h.id, item.id, h.member.id])).rowCount, 1);
      assert.equal((await c.query(claim, [h.id, item.id, h.member.id])).rowCount, 0);
      const weekly = `insert into public.notifications_log (household_id, item_id, member_id, kind, ref_date)
                      values ($1, null, $2, 'weekly', '2099-01-04') on conflict do nothing returning id`;
      assert.equal((await c.query(weekly, [h.id, h.member.id])).rowCount, 1);
      // nulls not distinct: the weekly email (item_id null) is also claimed only once,
      // including with an explicit conflict target (supabase-js upsert with ignoreDuplicates).
      assert.equal((await c.query(weekly, [h.id, h.member.id])).rowCount, 0);
      const targeted = weekly.replace('on conflict do nothing', 'on conflict (kind, member_id, item_id, ref_date) do nothing');
      assert.equal((await c.query(targeted, [h.id, h.member.id])).rowCount, 0);
      const claimId = (await c.query(targeted.replace("'2099-01-04'", "'2099-01-11'"), [h.id, h.member.id])).rows[0].id;
      // A failed send releases the claim so the next run retries.
      assert.equal((await c.query('delete from public.notifications_log where id = $1', [claimId])).rowCount, 1);
      await c.query('delete from public.push_subs where member_id = $1', [h.member.id]);
    });
  });
});

describe('signed in without a household', () => {
  test('sees an empty world and helpers return null/false', async () => {
    const loner = await createUser();
    const res = await as(loner, (c) => c.query('select public.current_member_id() as m, public.is_household_member(gen_random_uuid()) as is_member'));
    assert.equal(res.rows[0].m, null);
    assert.equal(res.rows[0].is_member, false);
  });
});
