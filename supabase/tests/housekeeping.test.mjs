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
