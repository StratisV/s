// "What good looks like" (supabase/migrations/20261010000300_item_good.sql): a free-text
// column on items that the app shows for To maintain items (states). Every item has it, tasks
// too, and nothing but an edit changes it: not the kind trigger, not completing or undoing.

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import {
  asService,
  createHousehold,
  createUser,
  dateAdd,
  db,
  insertItem,
  joinHousehold,
  one,
  q,
  rejects,
  rpc,
  todayIn,
  useCleanup,
} from './helpers.mjs';

useCleanup();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const item = async (id) => one('select * from public.items where id = $1', [id]);
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
const chars = (n, c = 'x') => c.repeat(n);
const GOOD = 'Cover on when not in use, ash cleared out, logs dry and stacked under the bench.';

/** Asserts a check_violation (SQLSTATE 23514) naming items_good_length. */
async function tooLong(promise) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, CHECK_VIOLATION, `expected a check violation, got ${err.code}: ${err.message}`);
    assert.match(err.message, /"items_good_length"/);
    return true;
  });
}

/** SEED_ITEMS from src/lib/constants.ts, bundled, so the database is checked against the app's own list. */
async function loadClientSeedItems() {
  const { build } = await import('esbuild');
  const out = await build({
    entryPoints: [path.join(root, 'src/lib/constants.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'silent',
  });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
  return mod.SEED_ITEMS;
}

describe('items.good', () => {
  let h;
  let second;

  before(async () => {
    h = await createHousehold({ name: 'Good home' });
    second = await joinHousehold(h, { name: 'Shea' });
  });

  test("is text not null default '', on every item", async () => {
    const col = await one(
      `select data_type, is_nullable, column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'items' and column_name = 'good'`,
    );
    assert.deepEqual(col, { data_type: 'text', is_nullable: 'NO', column_default: "''::text" });

    const { rows } = await q(
      h.owner,
      "insert into public.items (household_id, area_id, title) values ($1, $2, 'Plain') returning good, kind",
      [h.id, h.areas[0].id],
    );
    assert.deepEqual(rows[0], { good: '', kind: 'task' });
    await assert.rejects(
      q(h.owner, "insert into public.items (household_id, area_id, title, good) values ($1, $2, 'Null', null)", [h.id, h.areas[0].id]),
      (err) => err.code === NOT_NULL_VIOLATION,
    );
  });

  test('up to 4000 characters (as Postgres counts them: an emoji is one), on insert and update', async () => {
    const insert = (user, good) =>
      q(user, "insert into public.items (household_id, area_id, title, kind, good) values ($1, $2, 'Long', 'state', $3) returning *", [
        h.id,
        h.areas[0].id,
        good,
      ]);
    const { rows } = await insert(second.user, chars(4000, '🦔'));
    assert.equal([...rows[0].good].length, 4000);
    await tooLong(insert(second.user, chars(4001)));
    await tooLong(insert(h.owner, chars(4001, '🦔')));
    await tooLong(q(h.owner, 'update public.items set good = $2 where id = $1', [rows[0].id, chars(4001)]));
    await tooLong(asService((c) => c.query('update public.items set good = $2 where id = $1', [rows[0].id, chars(4001)])));
    assert.equal([...(await item(rows[0].id)).good].length, 4000);
  });

  test('every member reads and edits it; outsiders and anon see and change nothing', async () => {
    const it = await insertItem(h, { title: 'Firepit', kind: 'state', good: 'Cover on.' });
    await q(second.user, 'update public.items set good = $2 where id = $1', [it.id, GOOD]);
    const after = await item(it.id);
    assert.equal(after.good, GOOD);
    assert.equal(after.updated_by, second.member.id);
    const { rows } = await q(h.owner, 'select good from public.items where id = $1', [it.id]);
    assert.deepEqual(rows, [{ good: GOOD }]);

    const outsider = await createHousehold({ name: 'Elsewhere' });
    assert.equal((await q(outsider.owner, 'select good from public.items where id = $1', [it.id])).rowCount, 0);
    assert.equal((await q(outsider.owner, "update public.items set good = 'Hacked' where id = $1", [it.id])).rowCount, 0);
    await rejects(q(null, 'select good from public.items'), /permission denied/);
    assert.equal((await item(it.id)).good, GOOD);
  });

  test('the kind trigger leaves it alone: kept on a task, and through switching kind both ways', async () => {
    const it = await insertItem(h, { title: 'Jacuzzi', kind: 'state', good: 'Clear water, cover on.' });
    const { rows: asTask } = await q(
      h.owner,
      "update public.items set kind = 'task', due_date = '2099-01-01', repeat = 'monthly' where id = $1 returning *",
      [it.id],
    );
    assert.deepEqual([asTask[0].kind, asTask[0].due_date, asTask[0].good], ['task', '2099-01-01', 'Clear water, cover on.']);
    const { rows: asState } = await q(h.owner, "update public.items set kind = 'state' where id = $1 returning *", [it.id]);
    assert.deepEqual([asState[0].kind, asState[0].due_date, asState[0].good], ['state', null, 'Clear water, cover on.']);

    // A task given one keeps it too (the app just doesn't show it).
    const { rows } = await q(
      second.user,
      "insert into public.items (household_id, area_id, title, good, due_date) values ($1, $2, 'Task', 'Shiny', '2099-02-02') returning *",
      [h.id, h.areas[0].id],
    );
    assert.deepEqual([rows[0].kind, rows[0].good, rows[0].due_date], ['task', 'Shiny', '2099-02-02']);
  });

  test('complete_item and undo_completion keep it (repeating and one-off tasks)', async () => {
    const today = await todayIn('Europe/London');
    const weekly = await insertItem(h, { title: 'Weekly', repeat: 'weekly', due_date: today, good: 'Weekly good' });
    const oneOff = await insertItem(h, { title: 'One-off', due_date: today, good: 'One-off good' });

    const c1 = await rpc(h.owner, 'complete_item', [weekly.id]);
    const c2 = await rpc(second.user, 'complete_item', [oneOff.id]);
    assert.deepEqual(
      [(await item(weekly.id)).due_date, (await item(weekly.id)).good],
      [await dateAdd(today, '7 days'), 'Weekly good'],
    );
    assert.deepEqual([(await item(oneOff.id)).status, (await item(oneOff.id)).good], ['done', 'One-off good']);

    await rpc(second.user, 'undo_completion', [c1]);
    await rpc(h.owner, 'undo_completion', [c2]);
    assert.deepEqual([(await item(weekly.id)).due_date, (await item(weekly.id)).good], [today, 'Weekly good']);
    assert.deepEqual([(await item(oneOff.id)).status, (await item(oneOff.id)).good], ['open', 'One-off good']);
  });

  test('a state is still never completed, and keeps it', async () => {
    const it = await insertItem(h, { title: 'Pizza oven', kind: 'state', good: 'Swept, cover on.' });
    const before = await item(it.id);
    await rejects(rpc(h.owner, 'complete_item', [it.id]), 'invalid_input');
    assert.deepEqual(await item(it.id), before);
  });

  test('a task that became a state since its completion keeps it when undone', async () => {
    const it = await insertItem(h, { title: 'Became a state', repeat: 'monthly', due_date: '2099-01-31', good: 'Kept' });
    const cid = await rpc(h.owner, 'complete_item', [it.id]);
    await q(h.owner, "update public.items set kind = 'state' where id = $1", [it.id]);
    await rpc(h.owner, 'undo_completion', [cid]);
    const after = await item(it.id);
    assert.deepEqual([after.kind, after.due_date, after.good], ['state', null, 'Kept']);
  });
});

describe('create_household seed items with "good"', () => {
  const create = (user, items) =>
    rpc(user, 'create_household', ['Seeded', '', 'Europe/London', 'Me', '🦔', ['Garden', 'Kitchen'], JSON.stringify(items)]);

  test("stores it, '' when missing or null, whatever the kind", async () => {
    const h = await createHousehold({
      areas: ['Garden', 'Kitchen'],
      items: [
        { area: 'Garden', kind: 'state', title: 'Firepit', note: 'New one.', good: GOOD, rag: 'green' },
        { area: 'Garden', kind: 'state', title: 'Lawn', good: null, rag: 'amber' },
        { area: 'Kitchen', title: 'Kitchen paper', note: 'Restocked.', due_in_days: 28, repeat: 'monthly' },
        { area: 'Kitchen', title: 'Oven', good: 'Clean racks', due_in_days: 3 },
      ],
    });
    const { rows } = await db('select title, kind, note, good, due_date from public.items where household_id = $1 order by title', [h.id]);
    const today = await todayIn('Europe/London');
    assert.deepEqual(rows, [
      { title: 'Firepit', kind: 'state', note: 'New one.', good: GOOD, due_date: null },
      { title: 'Kitchen paper', kind: 'task', note: 'Restocked.', good: '', due_date: await dateAdd(today, '28 days') },
      { title: 'Lawn', kind: 'state', note: '', good: '', due_date: null },
      { title: 'Oven', kind: 'task', note: '', good: 'Clean racks', due_date: await dateAdd(today, '3 days') },
    ]);
  });

  test('too long is a check violation and creates nothing', async () => {
    const user = await createUser();
    await tooLong(create(user, [{ area: 'Garden', kind: 'state', title: 'Firepit', good: chars(4001) }]));
    assert.equal((await one('select count(*)::int as n from public.members where user_id = $1', [user.id])).n, 0);
    // 4000 is fine.
    const hid = await create(user, [{ area: 'Garden', kind: 'state', title: 'Firepit', good: chars(4000, '🦔') }]);
    const row = await one('select good from public.items where household_id = $1', [hid]);
    assert.equal([...row.good].length, 4000);
    await db('delete from public.households where id = $1', [hid]);
  });

  test("the app's SEED_ITEMS seed the Firepit with what good looks like, and nothing else with one", async () => {
    const seeds = await loadClientSeedItems();
    const firepit = seeds.find((s) => s.title === 'Firepit');
    assert.equal(firepit.good, GOOD);

    // What SupabaseBackend.createHousehold sends (demo_assignee stays in the app).
    const items = seeds.map(({ demo_assignee: _who, ...s }) => ({ ...s, kind: s.kind ?? 'task', good: s.good ?? '' }));
    const areas = [...new Set(seeds.map((s) => s.area))];
    const h = await createHousehold({ areas, items });
    const { rows } = await db("select title, kind, note, good from public.items where household_id = $1 and good <> ''", [h.id]);
    assert.deepEqual(rows, [
      { title: 'Firepit', kind: 'state', note: "New one installed. Keep the cover on when it's not in use.", good: GOOD },
    ]);
  });
});
