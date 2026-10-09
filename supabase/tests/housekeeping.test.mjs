// Housekeeping (supabase/migrations/20261010000400_housekeeping.sql): the message for the
// housekeeper, the task list, visits and their ticks. Contract tests written with the
// migration; docs/ARCHITECTURE.md "Housekeeping" is the spec. Every member edits
// everything; outsiders and anon see and change nothing.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import {
  createHousehold,
  dateAdd,
  db,
  joinHousehold,
  one,
  pool,
  q,
  rejects,
  rpc,
  todayIn,
  useCleanup,
} from './helpers.mjs';

useCleanup();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = path.join(root, 'supabase/migrations/20261010000400_housekeeping.sql');
const CHECK_VIOLATION = '23514';
const TABLES = ['housekeeping_notes', 'housekeeping_tasks', 'housekeeping_visits', 'housekeeping_visit_tasks'];
const STARTER = [
  'Change the bed sheets',
  'Hoover and mop the floors',
  'Clean the bathrooms',
  'Clean the kitchen',
  'Dust the surfaces',
  'Empty the bins',
  'Ironing',
];

const tasksOf = async (hid) =>
  (await db('select * from public.housekeeping_tasks where household_id = $1 order by position, created_at, id', [hid])).rows;
const visitOn = async (hid, date) =>
  one('select * from public.housekeeping_visits where household_id = $1 and visit_date = $2', [hid, date]);
const rowsOf = async (visitId) =>
  (await db('select * from public.housekeeping_visit_tasks where visit_id = $1 order by position, title, id', [visitId])).rows;
const visitCount = async (hid) =>
  (await one('select count(*)::int as n from public.housekeeping_visits where household_id = $1', [hid])).n;

const tick = (user, hid, date, { taskId = null, visitTaskId = null }, done) =>
  rpc(user, 'tick_housekeeping_task', [hid, date, taskId, visitTaskId, done]);
const save = (user, hid, date, patch) => rpc(user, 'save_housekeeping_visit', [hid, date, JSON.stringify(patch)]);

async function checkViolation(promise, constraint) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, CHECK_VIOLATION, `expected a check violation, got ${err.code}: ${err.message}`);
    assert.match(err.message, new RegExp(`"${constraint}"`));
    return true;
  });
}

describe('structure', () => {
  test('RLS on, and authenticated has exactly the intended privileges', async () => {
    const { rows } = await db(
      `select c.relname, c.relrowsecurity, c.relreplident from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1)`,
      [TABLES],
    );
    assert.equal(rows.length, 4);
    for (const r of rows) {
      assert.equal(r.relrowsecurity, true, `RLS off on ${r.relname}`);
      assert.equal(r.relreplident, 'f', `${r.relname} replica identity`);
    }
    const priv = async (role, table, p) =>
      (await one('select has_table_privilege($1, $2, $3) as ok', [role, `public.${table}`, p])).ok;
    const col = async (table, column, p) =>
      (await one("select has_column_privilege('authenticated', $1, $2, $3) as ok", [`public.${table}`, column, p])).ok;
    const expected = {
      housekeeping_notes: ['SELECT'],
      housekeeping_tasks: ['SELECT', 'DELETE'],
      housekeeping_visits: ['SELECT', 'DELETE'],
      housekeeping_visit_tasks: ['SELECT'],
    };
    for (const [table, allowed] of Object.entries(expected)) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        assert.equal(await priv('authenticated', table, p), allowed.includes(p), `${table} ${p}`);
        assert.equal(await priv('anon', table, p), false, `anon ${table} ${p}`);
      }
    }
    for (const c of ['id', 'household_id', 'title', 'position', 'created_at']) {
      assert.equal(await col('housekeeping_tasks', c, 'INSERT'), ['household_id', 'title'].includes(c), `insert ${c}`);
      assert.equal(await col('housekeeping_tasks', c, 'UPDATE'), c === 'title', `update ${c}`);
    }
  });

  test('RPCs are callable by authenticated; helpers and triggers are not', async () => {
    const { rows } = await db(
      `select p.proname, p.prosecdef,
              has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'`,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.proname, r]));
    for (const name of ['set_housekeeping_note', 'reorder_housekeeping_tasks', 'add_housekeeping_visit', 'tick_housekeeping_task', 'save_housekeeping_visit']) {
      assert.ok(byName[name], `missing ${name}`);
      assert.equal(byName[name].prosecdef, true, `${name} security definer`);
      assert.equal(byName[name].auth_exec, true, `authenticated cannot execute ${name}`);
      assert.equal(byName[name].anon_exec, false, `anon can execute ${name}`);
    }
    for (const name of [
      'js_trim',
      'housekeeping_starter_tasks',
      'household_today',
      'housekeeping_lock',
      'housekeeping_lock_visit',
      'housekeeping_visit_for',
      'housekeeping_tasks_before_write',
      'housekeeping_tasks_after_insert',
      'housekeeping_tasks_after_update',
      'housekeeping_tasks_before_delete',
    ]) {
      assert.ok(byName[name], `missing ${name}`);
      assert.equal(byName[name].auth_exec, false, `authenticated can execute ${name}`);
      assert.equal(byName[name].anon_exec, false, `anon can execute ${name}`);
    }
  });

  test('the four tables are in the realtime publication', async () => {
    const pub = await one("select count(*)::int as n from pg_publication where pubname = 'supabase_realtime'");
    if (pub.n !== 1) return;
    const { rows } = await db("select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'");
    for (const t of TABLES) assert.ok(rows.some((r) => r.tablename === t), `${t} is not published`);
  });

  test('the starter list matches HOUSEKEEPING_STARTER_TASKS in src/lib/constants.ts', async () => {
    const constants = fs.readFileSync(path.join(root, 'src/lib/constants.ts'), 'utf8');
    const block = /HOUSEKEEPING_STARTER_TASKS = \[([\s\S]*?)\] as const/.exec(constants);
    assert.ok(block, 'HOUSEKEEPING_STARTER_TASKS in constants.ts');
    const inApp = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(inApp, STARTER);
    assert.deepEqual((await one('select public.housekeeping_starter_tasks() as t')).t, STARTER);
  });
});

describe('the task list', () => {
  let h;
  let shea;
  let outsider;

  before(async () => {
    h = await createHousehold({ name: 'Task home' });
    shea = await joinHousehold(h, { name: 'Shea' });
    outsider = await createHousehold({ name: 'Elsewhere' });
  });

  test('a new household starts with the starter list, in order', async () => {
    const tasks = await tasksOf(h.id);
    assert.deepEqual(tasks.map((t) => t.title), STARTER);
    assert.deepEqual(tasks.map((t) => t.position), [0, 1, 2, 3, 4, 5, 6]);
  });

  test('members add (trimmed, last), rename and delete; blank or too long is refused', async () => {
    const { rows } = await q(
      shea.user,
      "insert into public.housekeeping_tasks (household_id, title) values ($1, '  Windows \n') returning *",
      [h.id],
    );
    assert.equal(rows[0].title, 'Windows');
    assert.equal(rows[0].position, 7);
    await q(h.owner, "update public.housekeeping_tasks set title = ' Inside windows ' where id = $1", [rows[0].id]);
    assert.equal((await one('select title from public.housekeeping_tasks where id = $1', [rows[0].id])).title, 'Inside windows');
    await checkViolation(
      q(h.owner, "insert into public.housekeeping_tasks (household_id, title) values ($1, ' \t ')", [h.id]),
      'housekeeping_tasks_title_length',
    );
    await checkViolation(
      q(h.owner, 'insert into public.housekeeping_tasks (household_id, title) values ($1, $2)', [h.id, 'x'.repeat(201)]),
      'housekeeping_tasks_title_length',
    );
    await rejects(q(h.owner, 'update public.housekeeping_tasks set position = 0 where id = $1', [rows[0].id]), /permission denied/);
    assert.equal((await q(shea.user, 'delete from public.housekeeping_tasks where id = $1', [rows[0].id])).rowCount, 1);
  });

  test('outsiders and anon see and change nothing', async () => {
    const [task] = await tasksOf(h.id);
    assert.equal((await q(outsider.owner, 'select * from public.housekeeping_tasks where household_id = $1', [h.id])).rowCount, 0);
    assert.equal((await q(outsider.owner, "update public.housekeeping_tasks set title = 'Hacked' where id = $1", [task.id])).rowCount, 0);
    assert.equal((await q(outsider.owner, 'delete from public.housekeeping_tasks where id = $1', [task.id])).rowCount, 0);
    await rejects(
      q(outsider.owner, "insert into public.housekeeping_tasks (household_id, title) values ($1, 'Sneaky')", [h.id]),
      /row-level security/,
    );
    await rejects(q(null, 'select * from public.housekeeping_tasks'), /permission denied/);
    await rejects(rpc(outsider.owner, 'reorder_housekeeping_tasks', [h.id, [task.id]]), 'not_found');
    assert.equal((await one('select title from public.housekeeping_tasks where id = $1', [task.id])).title, task.title);
  });

  test('reorder sets positions; ids from elsewhere are ignored', async () => {
    const tasks = await tasksOf(h.id);
    const [foreign] = await tasksOf(outsider.id);
    const order = [tasks[6].id, ...tasks.slice(0, 6).map((t) => t.id), foreign.id];
    await rpc(shea.user, 'reorder_housekeeping_tasks', [h.id, order]);
    assert.deepEqual((await tasksOf(h.id)).map((t) => t.id), order.slice(0, 7));
    assert.equal((await one('select position from public.housekeeping_tasks where id = $1', [foreign.id])).position, 0);
  });
});

describe('the message for the housekeeper', () => {
  let h;
  let shea;

  before(async () => {
    h = await createHousehold({ name: 'Note home' });
    shea = await joinHousehold(h, { name: 'Shea' });
  });

  test('clearing a message never written stores nothing; writing trims and stamps', async () => {
    await rpc(h.owner, 'set_housekeeping_note', [h.id, '  ']);
    assert.equal(await one('select * from public.housekeeping_notes where household_id = $1', [h.id]), undefined);
    await rpc(shea.user, 'set_housekeeping_note', [h.id, '  Spare room first.\nThanks!\n ']);
    const note = await one('select * from public.housekeeping_notes where household_id = $1', [h.id]);
    assert.equal(note.body, 'Spare room first.\nThanks!');
    assert.equal(note.updated_by, shea.member.id);
  });

  test('the same text again keeps the stamp; clearing stamps who cleared it', async () => {
    const before = await one('select * from public.housekeeping_notes where household_id = $1', [h.id]);
    await rpc(h.owner, 'set_housekeeping_note', [h.id, 'Spare room first.\nThanks!']);
    const same = await one('select * from public.housekeeping_notes where household_id = $1', [h.id]);
    assert.equal(same.updated_by, shea.member.id);
    assert.equal(same.updated_at.getTime(), before.updated_at.getTime());
    await rpc(h.owner, 'set_housekeeping_note', [h.id, '']);
    const cleared = await one('select * from public.housekeeping_notes where household_id = $1', [h.id]);
    assert.equal(cleared.body, '');
    assert.equal(cleared.updated_by, h.member.id);
  });

  test('up to 4000 characters; outsiders, anon and the signed out are refused', async () => {
    await rpc(h.owner, 'set_housekeeping_note', [h.id, '🦔'.repeat(4000)]);
    await checkViolation(rpc(h.owner, 'set_housekeeping_note', [h.id, 'x'.repeat(4001)]), 'housekeeping_notes_body_length');
    const outsider = await createHousehold({ name: 'Elsewhere' });
    await rejects(rpc(outsider.owner, 'set_housekeeping_note', [h.id, 'Hacked']), 'not_found');
    assert.equal((await q(outsider.owner, 'select * from public.housekeeping_notes where household_id = $1', [h.id])).rowCount, 0);
    await rejects(rpc(null, 'set_housekeeping_note', [h.id, 'Hacked']), /permission denied/);
    await rejects(rpc({ claims: { role: 'authenticated' } }, 'set_housekeeping_note', [h.id, 'Hacked']), 'not_signed_in');
  });
});

describe('visits: ticks, comments and price', () => {
  let h;
  let shea;
  let today;

  before(async () => {
    h = await createHousehold({ name: 'Visit home' });
    shea = await joinHousehold(h, { name: 'Shea' });
    today = await todayIn('Europe/London');
    await rpc(h.owner, 'set_housekeeping_note', [h.id, 'Guests arrive Friday, please do the spare room first.']);
  });

  test("the first tick creates today's visit: the list and the message copied, one row ticked", async () => {
    const tasks = await tasksOf(h.id);
    const visitId = await tick(shea.user, h.id, today, { taskId: tasks[1].id }, true);
    const visit = await visitOn(h.id, today);
    assert.equal(visit.id, visitId);
    assert.equal(visit.note, 'Guests arrive Friday, please do the spare room first.');
    assert.equal(visit.created_by, shea.member.id);
    assert.equal(visit.comments, '');
    assert.equal(visit.price_pence, null);
    const rows = await rowsOf(visitId);
    assert.deepEqual(rows.map((r) => [r.task_id, r.title, r.position]), tasks.map((t) => [t.id, t.title, t.position]));
    assert.deepEqual(rows.map((r) => r.done), [false, true, false, false, false, false, false]);
    assert.equal(rows[1].done_by, shea.member.id);
    assert.ok(rows[1].done_at);
  });

  test('ticking again changes nothing; unticking clears who and when; by row id works too', async () => {
    const tasks = await tasksOf(h.id);
    const visit = await visitOn(h.id, today);
    const before = (await rowsOf(visit.id))[1];
    await tick(h.owner, h.id, today, { taskId: tasks[1].id }, true);
    assert.equal((await rowsOf(visit.id))[1].done_by, before.done_by);
    await tick(h.owner, h.id, today, { visitTaskId: before.id }, false);
    const after = (await rowsOf(visit.id))[1];
    assert.deepEqual([after.done, after.done_by, after.done_at], [false, null, null]);
    assert.equal((await visitOn(h.id, today)).updated_by, h.member.id);
    assert.equal(await visitCount(h.id), 1);
  });

  test('bad targets: both or neither is invalid_input, unknown is not_found, a future day is invalid_input', async () => {
    const tasks = await tasksOf(h.id);
    const visit = await visitOn(h.id, today);
    const [row] = await rowsOf(visit.id);
    await rejects(tick(h.owner, h.id, today, { taskId: tasks[0].id, visitTaskId: row.id }, true), 'invalid_input');
    await rejects(tick(h.owner, h.id, today, {}, true), 'invalid_input');
    await rejects(rpc(h.owner, 'tick_housekeeping_task', [h.id, today, tasks[0].id, null, null]), 'invalid_input');
    await rejects(tick(h.owner, h.id, today, { taskId: '00000000-0000-4000-8000-000000000000' }, true), 'not_found');
    const tomorrow = await dateAdd(today, '1 day');
    await rejects(tick(h.owner, h.id, tomorrow, { taskId: tasks[0].id }, true), 'invalid_input');
    await rejects(save(h.owner, h.id, tomorrow, { comments: 'x' }), 'invalid_input');
    await rejects(rpc(h.owner, 'add_housekeeping_visit', [h.id, tomorrow]), 'invalid_input');
    assert.equal(await visitOn(h.id, tomorrow), undefined);
    // A failed tick on a day without a visit creates nothing.
    const lastYear = await dateAdd(today, '-1 year');
    await rejects(tick(h.owner, h.id, lastYear, { taskId: '00000000-0000-4000-8000-000000000000' }, true), 'not_found');
    assert.equal(await visitOn(h.id, lastYear), undefined);
  });

  test('comments (trimmed) and the price save independently; null clears the price', async () => {
    await save(h.owner, h.id, today, { comments: "  We're out of bin bags.\n" });
    await save(shea.user, h.id, today, { price_pence: 6000 });
    let visit = await visitOn(h.id, today);
    assert.equal(visit.comments, "We're out of bin bags.");
    assert.equal(visit.price_pence, 6000);
    assert.equal(visit.updated_by, shea.member.id);
    await save(h.owner, h.id, today, { price_pence: null });
    visit = await visitOn(h.id, today);
    assert.equal(visit.price_pence, null);
    assert.equal(visit.comments, "We're out of bin bags.");
  });

  test('limits: price 0 to 1,000,000 pence, whole numbers only; comments up to 4000', async () => {
    await save(h.owner, h.id, today, { price_pence: 0 });
    await save(h.owner, h.id, today, { price_pence: 1000000 });
    await checkViolation(save(h.owner, h.id, today, { price_pence: 1000001 }), 'housekeeping_visits_price_range');
    await checkViolation(save(h.owner, h.id, today, { price_pence: -1 }), 'housekeeping_visits_price_range');
    await rejects(save(h.owner, h.id, today, { price_pence: 12.5 }), 'invalid_input');
    await rejects(save(h.owner, h.id, today, { price_pence: '6000' }), 'invalid_input');
    await rejects(save(h.owner, h.id, today, { price_pence: 1e12 }), 'invalid_input');
    await rejects(save(h.owner, h.id, today, { comments: 5 }), 'invalid_input');
    await rejects(rpc(h.owner, 'save_housekeeping_visit', [h.id, today, '[]']), 'invalid_input');
    await checkViolation(save(h.owner, h.id, today, { comments: 'x'.repeat(4001) }), 'housekeeping_visits_comments_length');
    assert.equal((await visitOn(h.id, today)).price_pence, 1000000);
  });

  test('saving on a past day without a visit creates it; the message is copied only if it stood then', async () => {
    const lastWeek = await dateAdd(today, '-7 days');
    await save(h.owner, h.id, lastWeek, { comments: 'Recorded late.' });
    const visit = await visitOn(h.id, lastWeek);
    // The message was written today, after that day: what it said then is not known.
    assert.equal(visit.note, '');
    assert.equal((await rowsOf(visit.id)).length, 7);

    await db("update public.housekeeping_notes set updated_at = now() - interval '30 days' where household_id = $1", [h.id]);
    const twoWeeksAgo = await dateAdd(today, '-14 days');
    await rpc(shea.user, 'add_housekeeping_visit', [h.id, twoWeeksAgo]);
    assert.equal((await visitOn(h.id, twoWeeksAgo)).note, 'Guests arrive Friday, please do the spare room first.');
    // Adding again returns the same visit.
    const again = await rpc(h.owner, 'add_housekeeping_visit', [h.id, twoWeeksAgo]);
    assert.equal(again, (await visitOn(h.id, twoWeeksAgo)).id);
  });

  test('two people ticking different tasks at once on a day without a visit: one visit, both ticks', async () => {
    const day = await dateAdd(today, '-3 days');
    const tasks = await tasksOf(h.id);
    const first = await pool.connect();
    const second = await pool.connect();
    const begin = async (client, user) => {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated' }),
      ]);
    };
    const sql = 'select public.tick_housekeeping_task($1, $2, $3, null, true) as id';
    try {
      await begin(first, h.owner);
      await begin(second, shea.user);
      const a = await first.query(sql, [h.id, day, tasks[0].id]);
      // The second waits for the first to commit, then ticks on the same visit.
      const pending = second.query(sql, [h.id, day, tasks[4].id]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await first.query('commit');
      const b = await pending;
      await second.query('commit');
      assert.equal(a.rows[0].id, b.rows[0].id);
    } finally {
      first.release();
      second.release();
    }
    const visit = await visitOn(h.id, day);
    const rows = await rowsOf(visit.id);
    assert.deepEqual(rows.filter((r) => r.done).map((r) => r.title), [tasks[0].title, tasks[4].title]);
  });

  test('outsiders see no visits and cannot tick, save, add or delete', async () => {
    const outsider = await createHousehold({ name: 'Elsewhere' });
    const visit = await visitOn(h.id, today);
    const [row] = await rowsOf(visit.id);
    assert.equal((await q(outsider.owner, 'select * from public.housekeeping_visits where household_id = $1', [h.id])).rowCount, 0);
    assert.equal((await q(outsider.owner, 'select * from public.housekeeping_visit_tasks where household_id = $1', [h.id])).rowCount, 0);
    await rejects(tick(outsider.owner, h.id, today, { visitTaskId: row.id }, true), 'not_found');
    await rejects(tick(outsider.owner, outsider.id, today, { visitTaskId: row.id }, true), 'not_found');
    await rejects(save(outsider.owner, h.id, today, { comments: 'Hacked' }), 'not_found');
    await rejects(rpc(outsider.owner, 'add_housekeeping_visit', [h.id, today]), 'not_found');
    assert.equal((await q(outsider.owner, 'delete from public.housekeeping_visits where id = $1', [visit.id])).rowCount, 0);
    await rejects(q(h.owner, "update public.housekeeping_visits set comments = 'direct' where id = $1", [visit.id]), /permission denied/);
    await rejects(q(h.owner, 'update public.housekeeping_visit_tasks set done = true where id = $1', [row.id]), /permission denied/);
  });

  test('a member deletes a visit, its rows go with it', async () => {
    const day = await dateAdd(today, '-3 days');
    const visit = await visitOn(h.id, day);
    assert.equal((await q(shea.user, 'delete from public.housekeeping_visits where id = $1', [visit.id])).rowCount, 1);
    assert.equal((await rowsOf(visit.id)).length, 0);
  });
});

describe("task list edits reach today's visit, never earlier ones", () => {
  let h;
  let today;
  let lastWeek;

  before(async () => {
    h = await createHousehold({ name: 'Sync home' });
    today = await todayIn('Europe/London');
    lastWeek = await dateAdd(today, '-7 days');
    await rpc(h.owner, 'add_housekeeping_visit', [h.id, lastWeek]);
    await rpc(h.owner, 'add_housekeeping_visit', [h.id, today]);
  });

  test('add: joins today, not last week', async () => {
    const { rows } = await q(h.owner, "insert into public.housekeeping_tasks (household_id, title) values ($1, 'Windows') returning *", [h.id]);
    const todays = await rowsOf((await visitOn(h.id, today)).id);
    assert.deepEqual(todays.at(-1).task_id, rows[0].id);
    assert.equal(todays.at(-1).done, false);
    assert.equal((await rowsOf((await visitOn(h.id, lastWeek)).id)).length, 7);
  });

  test('rename and reorder: today follows, last week keeps its own', async () => {
    const tasks = await tasksOf(h.id);
    await q(h.owner, "update public.housekeeping_tasks set title = 'Bed sheets (all rooms)' where id = $1", [tasks[0].id]);
    await rpc(h.owner, 'reorder_housekeeping_tasks', [h.id, [...tasks.slice(1).map((t) => t.id), tasks[0].id]]);
    const todays = await rowsOf((await visitOn(h.id, today)).id);
    assert.equal(todays.at(-1).title, 'Bed sheets (all rooms)');
    assert.equal(todays[0].title, 'Hoover and mop the floors');
    const old = await rowsOf((await visitOn(h.id, lastWeek)).id);
    assert.equal(old[0].title, 'Change the bed sheets');
  });

  test('delete: today drops it unless ticked; earlier visits keep it with task_id null', async () => {
    const tasks = await tasksOf(h.id);
    const ticked = tasks.find((t) => t.title === 'Ironing');
    const unticked = tasks.find((t) => t.title === 'Empty the bins');
    await tick(h.owner, h.id, today, { taskId: ticked.id }, true);
    await q(h.owner, 'delete from public.housekeeping_tasks where id = any($1)', [[ticked.id, unticked.id]]);
    const todays = await rowsOf((await visitOn(h.id, today)).id);
    assert.ok(!todays.some((r) => r.title === 'Empty the bins'));
    const kept = todays.find((r) => r.title === 'Ironing');
    assert.deepEqual([kept.done, kept.task_id], [true, null]);
    const old = await rowsOf((await visitOn(h.id, lastWeek)).id);
    assert.deepEqual(
      old.filter((r) => ['Ironing', 'Empty the bins'].includes(r.title)).map((r) => r.task_id),
      [null, null],
    );
    // A row whose task is gone is ticked by its own id.
    const bins = old.find((r) => r.title === 'Empty the bins');
    await tick(h.owner, h.id, lastWeek, { visitTaskId: bins.id }, true);
    assert.equal((await one('select done from public.housekeeping_visit_tasks where id = $1', [bins.id])).done, true);
  });
});

describe('existing households get the starter list once', () => {
  test('applying the migration again refills an empty list only when there are no visits', async () => {
    const empty = await createHousehold({ name: 'Emptied' });
    const withVisits = await createHousehold({ name: 'Emptied after a visit' });
    await rpc(withVisits.owner, 'add_housekeeping_visit', [withVisits.id, await todayIn('Europe/London')]);
    await db('delete from public.housekeeping_tasks where household_id = any($1)', [[empty.id, withVisits.id]]);
    await db(fs.readFileSync(MIGRATION, 'utf8'));
    assert.deepEqual((await tasksOf(empty.id)).map((t) => t.title), STARTER);
    assert.equal((await tasksOf(withVisits.id)).length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// More: constraints, snapshots, concurrency, time zones, cascades
// ─────────────────────────────────────────────────────────────────────────────

const UNIQUE_VIOLATION = '23505';

/** A transaction as `user` (role authenticated with their claims) on its own connection. */
async function session(user) {
  const client = await pool.connect();
  await client.query('begin');
  if (user) {
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated' }),
    ]);
  }
  let open = true;
  const end = async (how) => {
    if (!open) return;
    open = false;
    try {
      await client.query(how);
    } finally {
      client.release();
    }
  };
  return {
    query: (sql, params) => client.query(sql, params),
    commit: () => end('commit'),
    rollback: () => end('rollback'),
  };
}

/** Whether a promise is still pending after `ms` (a statement waiting on a lock). */
async function stillWaiting(promise, ms = 150) {
  const marker = Symbol('waiting');
  const settled = promise.then(
    () => 'resolved',
    () => 'rejected',
  );
  return (await Promise.race([settled, new Promise((resolve) => setTimeout(() => resolve(marker), ms))])) === marker;
}

const TICK = 'select public.tick_housekeeping_task($1, $2, $3, $4, $5) as id';
const SAVE = 'select public.save_housekeeping_visit($1, $2, $3) as id';

describe('constraints the RPCs never reach', () => {
  let h;
  let today;

  before(async () => {
    h = await createHousehold({ name: 'Constraint home' });
    today = await todayIn('Europe/London');
    await rpc(h.owner, 'add_housekeeping_visit', [h.id, today]);
  });

  test('one visit per household and day; one row per visit and task; rows of deleted tasks may repeat', async () => {
    const visit = await visitOn(h.id, today);
    const [row] = await rowsOf(visit.id);
    await assert.rejects(
      db('insert into public.housekeeping_visits (household_id, visit_date) values ($1, $2)', [h.id, today]),
      (err) => err.code === UNIQUE_VIOLATION && /housekeeping_visits_one_per_day/.test(err.message),
    );
    await assert.rejects(
      db("insert into public.housekeeping_visit_tasks (visit_id, household_id, task_id, title) values ($1, $2, $3, 'Again')", [
        visit.id,
        h.id,
        row.task_id,
      ]),
      (err) => err.code === UNIQUE_VIOLATION && /housekeeping_visit_tasks_task_once/.test(err.message),
    );
    for (let i = 0; i < 2; i++) {
      await db("insert into public.housekeeping_visit_tasks (visit_id, household_id, task_id, title) values ($1, $2, null, 'Gone')", [
        visit.id,
        h.id,
      ]);
    }
    assert.equal((await rowsOf(visit.id)).filter((r) => r.title === 'Gone').length, 2);
  });

  test('lengths of the copies: a row title 1 to 200, the message copy up to 4000', async () => {
    const visit = await visitOn(h.id, today);
    await checkViolation(
      db("insert into public.housekeeping_visit_tasks (visit_id, household_id, title) values ($1, $2, '')", [visit.id, h.id]),
      'housekeeping_visit_tasks_title_length',
    );
    await checkViolation(
      db('insert into public.housekeeping_visit_tasks (visit_id, household_id, title) values ($1, $2, $3)', [
        visit.id,
        h.id,
        'x'.repeat(201),
      ]),
      'housekeeping_visit_tasks_title_length',
    );
    await checkViolation(
      db('update public.housekeeping_visits set note = $2 where id = $1', [visit.id, 'x'.repeat(4001)]),
      'housekeeping_visits_note_length',
    );
    await db('update public.housekeeping_visits set note = $2 where id = $1', [visit.id, '🦔'.repeat(4000)]);
  });

  test('the task trigger puts a new task last and keeps it in its household, whatever is sent', async () => {
    const other = await createHousehold({ name: 'Other' });
    const { rows } = await db(
      "insert into public.housekeeping_tasks (household_id, title, position) values ($1, '\u00a0Windows\u2003', 0) returning *",
      [h.id],
    );
    assert.equal(rows[0].title, 'Windows');
    assert.equal(rows[0].position, 7);
    await db('update public.housekeeping_tasks set household_id = $2 where id = $1', [rows[0].id, other.id]);
    assert.equal((await one('select household_id from public.housekeeping_tasks where id = $1', [rows[0].id])).household_id, h.id);
    await db('delete from public.housekeeping_tasks where id = $1', [rows[0].id]);
  });
});

describe('snapshots: history stays true', () => {
  let h;
  let shea;
  let today;
  let lastWeek;

  before(async () => {
    h = await createHousehold({ name: 'History home' });
    shea = await joinHousehold(h, { name: 'Shea' });
    today = await todayIn('Europe/London');
    lastWeek = await dateAdd(today, '-7 days');
    await db("update public.housekeeping_tasks set title = title where household_id = $1", [h.id]);
  });

  test("a visit keeps the message it was given, whatever happens to the message after", async () => {
    await rpc(h.owner, 'set_housekeeping_note', [h.id, 'Spare room first.']);
    await db("update public.housekeeping_notes set updated_at = now() - interval '30 days' where household_id = $1", [h.id]);
    await rpc(shea.user, 'add_housekeeping_visit', [h.id, lastWeek]);
    await rpc(shea.user, 'set_housekeeping_note', [h.id, 'Changed since.']);
    await rpc(shea.user, 'add_housekeeping_visit', [h.id, today]);
    assert.equal((await visitOn(h.id, lastWeek)).note, 'Spare room first.');
    assert.equal((await visitOn(h.id, today)).note, 'Changed since.');
    await rpc(h.owner, 'set_housekeeping_note', [h.id, '']);
    assert.equal((await visitOn(h.id, lastWeek)).note, 'Spare room first.');
    assert.equal((await visitOn(h.id, today)).note, 'Changed since.');
  });

  test("the message's day is the household's: just before or after midnight there", async () => {
    const day = await dateAdd(today, '-21 days');
    const next = await dateAdd(day, '1 day');
    // 23:30 on that day in London: it stood then.
    await db(
      "update public.housekeeping_notes set body = 'Late evening.', updated_at = ($2::date + time '23:30') at time zone 'Europe/London' where household_id = $1",
      [h.id, day],
    );
    await rpc(h.owner, 'add_housekeeping_visit', [h.id, day]);
    assert.equal((await visitOn(h.id, day)).note, 'Late evening.');
    // 00:30 the next day in London (still the day before in UTC in summer): it did not.
    const before = await dateAdd(today, '-28 days');
    await db(
      "update public.housekeeping_notes set updated_at = ($2::date + interval '1 day' + time '00:30') at time zone 'Europe/London' where household_id = $1",
      [h.id, before],
    );
    await rpc(h.owner, 'add_housekeeping_visit', [h.id, before]);
    assert.equal((await visitOn(h.id, before)).note, '');
    assert.ok(next);
  });

  test('renaming, reordering and deleting tasks never rewrites an earlier visit', async () => {
    const old = await rowsOf((await visitOn(h.id, lastWeek)).id);
    const tasks = await tasksOf(h.id);
    await q(shea.user, "update public.housekeeping_tasks set title = 'Renamed' where id = $1", [tasks[2].id]);
    await rpc(shea.user, 'reorder_housekeeping_tasks', [h.id, tasks.map((t) => t.id).reverse()]);
    await q(shea.user, 'delete from public.housekeeping_tasks where id = $1', [tasks[3].id]);
    const after = await rowsOf((await visitOn(h.id, lastWeek)).id);
    assert.deepEqual(
      after.map((r) => [r.id, r.title, r.position, r.done]),
      old.map((r) => [r.id, r.title, r.position, r.done]),
    );
    assert.deepEqual(
      after.map((r) => r.task_id),
      old.map((r) => (r.task_id === tasks[3].id ? null : r.task_id)),
    );
  });

  test('a member who leaves: their visits, ticks and message stay, as a former member', async () => {
    const leaver = await joinHousehold(h, { name: 'Leaver' });
    const day = await dateAdd(today, '-35 days');
    const [task] = await tasksOf(h.id);
    await tick(leaver.user, h.id, day, { taskId: task.id }, true);
    await rpc(leaver.user, 'set_housekeeping_note', [h.id, 'From the leaver.']);
    await db('delete from public.members where id = $1', [leaver.member.id]);
    const visit = await visitOn(h.id, day);
    assert.deepEqual([visit.created_by, visit.updated_by], [null, null]);
    const row = (await rowsOf(visit.id)).find((r) => r.task_id === task.id);
    assert.deepEqual([row.done, row.done_by], [true, null]);
    assert.ok(row.done_at);
    const note = await one('select * from public.housekeeping_notes where household_id = $1', [h.id]);
    assert.deepEqual([note.body, note.updated_by], ['From the leaver.', null]);
  });

  test('deleting the household takes all of it', async () => {
    const gone = await createHousehold({ name: 'Short-lived' });
    const day = await todayIn('Europe/London');
    await rpc(gone.owner, 'set_housekeeping_note', [gone.id, 'Bye']);
    await rpc(gone.owner, 'add_housekeeping_visit', [gone.id, day]);
    await db('delete from public.households where id = $1', [gone.id]);
    for (const table of TABLES) {
      assert.equal((await one(`select count(*)::int as n from public.${table} where household_id = $1`, [gone.id])).n, 0, table);
    }
  });
});

describe('concurrency', () => {
  let h;
  let shea;
  let today;

  before(async () => {
    h = await createHousehold({ name: 'Busy home' });
    shea = await joinHousehold(h, { name: 'Shea' });
    today = await todayIn('Europe/London');
    await rpc(h.owner, 'add_housekeeping_visit', [h.id, today]);
  });

  test('two people ticking different rows of one visit at once: both ticks stay', async () => {
    const day = await dateAdd(today, '-2 days');
    await rpc(h.owner, 'add_housekeeping_visit', [h.id, day]);
    const tasks = await tasksOf(h.id);
    const first = await session(h.owner);
    const second = await session(shea.user);
    try {
      await first.query(TICK, [h.id, day, tasks[1].id, null, true]);
      const pending = second.query(TICK, [h.id, day, tasks[5].id, null, true]);
      await first.commit();
      await pending;
      await second.commit();
    } finally {
      await first.rollback();
      await second.rollback();
    }
    const rows = await rowsOf((await visitOn(h.id, day)).id);
    assert.deepEqual(
      rows.filter((r) => r.done).map((r) => [r.title, r.done_by]),
      [
        [tasks[1].title, h.member.id],
        [tasks[5].title, shea.member.id],
      ],
    );
  });

  test('two people ticking the same row at once: one after the other, the last one stays', async () => {
    const tasks = await tasksOf(h.id);
    const first = await session(h.owner);
    const second = await session(shea.user);
    try {
      await first.query(TICK, [h.id, today, tasks[0].id, null, true]);
      const pending = second.query(TICK, [h.id, today, tasks[0].id, null, false]);
      assert.equal(await stillWaiting(pending), true, 'the second tick waits for the first');
      await first.commit();
      await pending;
      await second.commit();
    } finally {
      await first.rollback();
      await second.rollback();
    }
    const row = (await rowsOf((await visitOn(h.id, today)).id)).find((r) => r.task_id === tasks[0].id);
    assert.deepEqual([row.done, row.done_by, row.done_at], [false, null, null]);
  });

  test('a tick waits on a visit being deleted without holding its row, then finds it gone', async () => {
    const day = await dateAdd(today, '-4 days');
    const visitId = await rpc(h.owner, 'add_housekeeping_visit', [h.id, day]);
    const [row] = await rowsOf(visitId);
    // As the delete does: the visit first (here as the admin, to hold it between the steps),
    // then its rows (the cascade).
    const deleter = await session(null);
    const ticker = await session(h.owner);
    try {
      await deleter.query('select id from public.housekeeping_visits where id = $1 for update', [visitId]);
      const ticking = ticker.query(TICK, [h.id, day, null, row.id, true]);
      assert.equal(await stillWaiting(ticking), true, 'the tick waits for the visit');
      // The tick holds no lock on the row while it waits, so the delete can take it.
      const probe = await session(null);
      try {
        await probe.query('select id from public.housekeeping_visit_tasks where id = $1 for update nowait', [row.id]);
      } finally {
        await probe.rollback();
      }
      assert.equal((await deleter.query('delete from public.housekeeping_visits where id = $1', [visitId])).rowCount, 1);
      await deleter.commit();
      await assert.rejects(ticking, (err) => err.message === 'not_found');
    } finally {
      await deleter.rollback();
      await ticker.rollback();
    }
    assert.equal(await visitOn(h.id, day), undefined);
  });

  test('a save on a visit deleted at that moment is not_found, not lost quietly', async () => {
    const day = await dateAdd(today, '-5 days');
    const visitId = await rpc(h.owner, 'add_housekeeping_visit', [h.id, day]);
    const deleter = await session(shea.user);
    const saver = await session(h.owner);
    try {
      await deleter.query('delete from public.housekeeping_visits where id = $1', [visitId]);
      const saving = saver.query(SAVE, [h.id, day, JSON.stringify({ comments: 'Too late.' })]);
      assert.equal(await stillWaiting(saving), true);
      await deleter.commit();
      await assert.rejects(saving, (err) => err.message === 'not_found');
    } finally {
      await deleter.rollback();
      await saver.rollback();
    }
    assert.equal(await visitOn(h.id, day), undefined);
  });

  test('a delete waits for a tick in progress, then takes the visit and its rows', async () => {
    const day = await dateAdd(today, '-6 days');
    const visitId = await rpc(h.owner, 'add_housekeeping_visit', [h.id, day]);
    const [row] = await rowsOf(visitId);
    const ticker = await session(h.owner);
    const deleter = await session(shea.user);
    try {
      await ticker.query(TICK, [h.id, day, null, row.id, true]);
      const deleting = deleter.query('delete from public.housekeeping_visits where id = $1', [visitId]);
      assert.equal(await stillWaiting(deleting), true);
      await ticker.commit();
      assert.equal((await deleting).rowCount, 1);
      await deleter.commit();
    } finally {
      await ticker.rollback();
      await deleter.rollback();
    }
    assert.equal((await rowsOf(visitId)).length, 0);
  });

  test("a task added while today's visit is being created is on it, either way round", async () => {
    const g = await createHousehold({ name: 'Race home' });
    const day = await todayIn('Europe/London');
    const [task] = await tasksOf(g.id);

    // The visit first: the new task waits for it, then joins it.
    const creator = await session(g.owner);
    const adder = await session(g.owner);
    try {
      await creator.query(TICK, [g.id, day, task.id, null, true]);
      const adding = adder.query("insert into public.housekeeping_tasks (household_id, title) values ($1, 'Windows')", [g.id]);
      assert.equal(await stillWaiting(adding), true, 'the insert waits for the visit');
      await creator.commit();
      await adding;
      await adder.commit();
    } finally {
      await creator.rollback();
      await adder.rollback();
    }
    let rows = await rowsOf((await visitOn(g.id, day)).id);
    assert.ok(rows.some((r) => r.title === 'Windows'));

    // The task first: the visit waits for it, then copies it.
    const yesterday = await dateAdd(day, '-1 day');
    await db('delete from public.housekeeping_visits where household_id = $1', [g.id]);
    const adder2 = await session(g.owner);
    const creator2 = await session(g.owner);
    try {
      await adder2.query("insert into public.housekeeping_tasks (household_id, title) values ($1, 'Fridge')", [g.id]);
      const creating = creator2.query(TICK, [g.id, day, task.id, null, true]);
      assert.equal(await stillWaiting(creating), true, 'the visit waits for the insert');
      await adder2.commit();
      await creating;
      await creator2.commit();
    } finally {
      await adder2.rollback();
      await creator2.rollback();
    }
    rows = await rowsOf((await visitOn(g.id, day)).id);
    assert.ok(rows.some((r) => r.title === 'Fridge'));
    assert.ok(yesterday);
  });

  test("a task renamed while today's visit is being created shows its new title there", async () => {
    const g = await createHousehold({ name: 'Rename race home' });
    const day = await todayIn('Europe/London');
    const tasks = await tasksOf(g.id);
    const renamer = await session(g.owner);
    const creator = await session(g.owner);
    try {
      await renamer.query("update public.housekeeping_tasks set title = 'Renamed' where id = $1", [tasks[2].id]);
      const creating = creator.query(TICK, [g.id, day, tasks[0].id, null, true]);
      assert.equal(await stillWaiting(creating), true);
      await renamer.commit();
      await creating;
      await creator.commit();
    } finally {
      await renamer.rollback();
      await creator.rollback();
    }
    const rows = await rowsOf((await visitOn(g.id, day)).id);
    assert.equal(rows.find((r) => r.task_id === tasks[2].id).title, 'Renamed');
  });
});

describe("the household's time zone decides today", () => {
  test('a household far ahead may record a visit for a day that is still tomorrow in London', async () => {
    // Kiritimati is UTC+14 and Pago Pago UTC-11: their days are always different.
    const ahead = await createHousehold({ name: 'Ahead', timezone: 'Pacific/Kiritimati' });
    const behind = await createHousehold({ name: 'Behind', timezone: 'Pacific/Pago_Pago' });
    const aheadToday = await todayIn('Pacific/Kiritimati');
    const behindToday = await todayIn('Pacific/Pago_Pago');
    assert.notEqual(aheadToday, behindToday);
    await rpc(ahead.owner, 'add_housekeeping_visit', [ahead.id, aheadToday]);
    await rejects(rpc(behind.owner, 'add_housekeeping_visit', [behind.id, aheadToday]), 'invalid_input');
    await rpc(behind.owner, 'add_housekeeping_visit', [behind.id, behindToday]);

    // "Today's visit" for the list triggers is the household's today too.
    await q(ahead.owner, "insert into public.housekeeping_tasks (household_id, title) values ($1, 'Windows')", [ahead.id]);
    const rows = await rowsOf((await visitOn(ahead.id, aheadToday)).id);
    assert.ok(rows.some((r) => r.title === 'Windows'));
  });
});

describe('members, the housekeeper among them, edit everything', () => {
  test('a member who joined by invite runs the whole visit and the list', async () => {
    const h = await createHousehold({ name: 'Housekeeper home' });
    const housekeeper = await joinHousehold(h, { name: 'Maria', emoji: '🧹' });
    const today = await todayIn('Europe/London');
    const [task] = await tasksOf(h.id);
    await rpc(housekeeper.user, 'set_housekeeping_note', [h.id, 'Done the spare room.']);
    const visitId = await tick(housekeeper.user, h.id, today, { taskId: task.id }, true);
    await save(housekeeper.user, h.id, today, { comments: 'All fine.', price_pence: 4500 });
    const { rows } = await q(housekeeper.user, "insert into public.housekeeping_tasks (household_id, title) values ($1, 'Oven') returning id", [h.id]);
    await q(housekeeper.user, "update public.housekeeping_tasks set title = 'Clean the oven' where id = $1", [rows[0].id]);
    const others = (await tasksOf(h.id)).filter((t) => t.id !== rows[0].id).map((t) => t.id);
    await rpc(housekeeper.user, 'reorder_housekeeping_tasks', [h.id, [rows[0].id, ...others]]);
    const visit = await visitOn(h.id, today);
    assert.equal(visit.id, visitId);
    assert.deepEqual([visit.created_by, visit.updated_by, visit.comments, visit.price_pence], [
      housekeeper.member.id,
      housekeeper.member.id,
      'All fine.',
      4500,
    ]);
    assert.equal((await rowsOf(visitId))[0].title, 'Clean the oven');
    assert.equal((await q(housekeeper.user, 'delete from public.housekeeping_visits where id = $1', [visitId])).rowCount, 1);
    // Reading: everything of the household, through RLS.
    for (const table of TABLES) {
      const { rows: seen } = await q(housekeeper.user, `select household_id from public.${table}`);
      assert.ok(seen.every((r) => r.household_id === h.id), table);
    }
  });
});

describe('applying the migration again', () => {
  test('keeps every message, task, visit and tick as it was', async () => {
    const h = await createHousehold({ name: 'Rerun home' });
    const today = await todayIn('Europe/London');
    const [task] = await tasksOf(h.id);
    await rpc(h.owner, 'set_housekeeping_note', [h.id, 'Keep me.']);
    await tick(h.owner, h.id, today, { taskId: task.id }, true);
    const snapshot = async () => ({
      note: await one('select * from public.housekeeping_notes where household_id = $1', [h.id]),
      tasks: await tasksOf(h.id),
      visit: await visitOn(h.id, today),
      rows: await rowsOf((await visitOn(h.id, today)).id),
    });
    const before = await snapshot();
    await db(fs.readFileSync(MIGRATION, 'utf8'));
    assert.deepEqual(await snapshot(), before);
  });
});
