// Item kinds (supabase/migrations/20261010000200_item_kind.sql): "To do" (task) and
// "To maintain" (state). A state has no due date, repeat or reminder, is never completed, and
// can turn into a task (and back).

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

describe('items.kind', () => {
  let h;

  before(async () => {
    h = await createHousehold({ name: 'Kinds home' });
  });

  test("defaults to 'task', and only 'task' and 'state' are allowed", async () => {
    const { rows } = await q(
      h.owner,
      "insert into public.items (household_id, area_id, title, due_date) values ($1, $2, 'Plain', '2099-01-01') returning *",
      [h.id, h.areas[0].id],
    );
    assert.equal(rows[0].kind, 'task');
    assert.equal(rows[0].due_date, '2099-01-01');
    assert.equal(rows[0].notify, 'day_before');

    for (const bad of ['done', 'State', '']) {
      await assert.rejects(
        q(h.owner, "insert into public.items (household_id, area_id, title, kind) values ($1, $2, 'Bad', $3)", [
          h.id,
          h.areas[0].id,
          bad,
        ]),
        (err) => err.code === CHECK_VIOLATION && /"items_kind_check"/.test(err.message),
        bad,
      );
    }
    await assert.rejects(
      q(h.owner, 'update public.items set kind = null where id = $1', [rows[0].id]),
      (err) => err.code === '23502',
      'kind is not null',
    );
    await assert.rejects(
      q(h.owner, "update public.items set kind = 'archived' where id = $1", [rows[0].id]),
      (err) => err.code === CHECK_VIOLATION,
    );
    assert.equal((await item(rows[0].id)).kind, 'task');
  });

  test('a state is stored without a due date, repeat or reminder, whatever is sent', async () => {
    const { rows } = await q(
      h.owner,
      `insert into public.items (household_id, area_id, title, kind, due_date, repeat, notify, rag)
       values ($1, $2, 'Firepit', 'state', '2099-05-05', 'weekly', 'week_before', 'green') returning *`,
      [h.id, h.areas[1].id],
    );
    assert.equal(rows[0].kind, 'state');
    assert.equal(rows[0].due_date, null);
    assert.equal(rows[0].repeat, 'none');
    assert.equal(rows[0].notify, 'none');
    assert.equal(rows[0].rag, 'green');
    assert.equal(rows[0].status, 'open');

    // Setting them later changes nothing either.
    const { rows: upd } = await q(
      h.owner,
      "update public.items set due_date = '2099-06-06', repeat = 'monthly', notify = 'same_day', rag = 'red' where id = $1 returning *",
      [rows[0].id],
    );
    assert.equal(upd[0].due_date, null);
    assert.equal(upd[0].repeat, 'none');
    assert.equal(upd[0].notify, 'none');
    assert.equal(upd[0].rag, 'red', 'the RAG status is still edited');
  });

  test('a task that becomes a state loses its due date, repeat and reminder', async () => {
    const it = await insertItem(h, { title: 'Jacuzzi', due_date: '2099-02-02', repeat: 'monthly', notify: 'week_before' });
    const { rows } = await q(h.owner, "update public.items set kind = 'state' where id = $1 returning *", [it.id]);
    assert.deepEqual(
      { kind: rows[0].kind, due_date: rows[0].due_date, repeat: rows[0].repeat, notify: rows[0].notify },
      { kind: 'state', due_date: null, repeat: 'none', notify: 'none' },
    );
  });

  test('a state can become a task again, and then takes a due date, repeat and reminder', async () => {
    const it = await insertItem(h, { title: 'Hot tub cover', kind: 'state' });
    const { rows } = await q(
      h.owner,
      "update public.items set kind = 'task', due_date = '2099-03-03', repeat = 'yearly', notify = 'day_before' where id = $1 returning *",
      [it.id],
    );
    assert.deepEqual(
      { kind: rows[0].kind, due_date: rows[0].due_date, repeat: rows[0].repeat, notify: rows[0].notify },
      { kind: 'task', due_date: '2099-03-03', repeat: 'yearly', notify: 'day_before' },
    );
  });

  test('every member can switch kinds; outsiders change nothing', async () => {
    const second = await joinHousehold(h, { name: 'Shea' });
    const it = await insertItem(h, { title: 'Shared', due_date: '2099-04-04' });
    await q(second.user, "update public.items set kind = 'state' where id = $1", [it.id]);
    assert.equal((await item(it.id)).kind, 'state');
    assert.equal((await item(it.id)).updated_by, second.member.id);

    const outsider = await createHousehold({ name: 'Elsewhere' });
    const res = await q(outsider.owner, "update public.items set kind = 'task' where id = $1", [it.id]);
    assert.equal(res.rowCount, 0);
    assert.equal((await item(it.id)).kind, 'state');
  });

  test('the service role follows the same rule', async () => {
    const it = await insertItem(h, { title: 'Service', due_date: '2099-01-01', notify: 'same_day' });
    await asService((c) => c.query("update public.items set kind = 'state' where id = $1", [it.id]));
    const after = await item(it.id);
    assert.equal(after.due_date, null);
    assert.equal(after.notify, 'none');
  });
});

describe('complete_item and states', () => {
  let h;
  let second;

  before(async () => {
    h = await createHousehold({ name: 'Never done home' });
    second = await joinHousehold(h, { name: 'Ela' });
  });

  test('a state cannot be completed: invalid_input, nothing logged, nothing changed', async () => {
    const it = await insertItem(h, { title: 'Firepit', kind: 'state', assignee_id: second.member.id });
    const before = await item(it.id);
    await rejects(rpc(h.owner, 'complete_item', [it.id]), 'invalid_input');
    await rejects(rpc(second.user, 'complete_item', [it.id]), 'invalid_input');
    assert.equal((await one('select count(*)::int as n from public.completions where item_id = $1', [it.id])).n, 0);
    assert.deepEqual(await item(it.id), before);
  });

  test('outsiders still get not_found (a state reveals nothing either)', async () => {
    const it = await insertItem(h, { title: 'Private state', kind: 'state' });
    const outsider = await createHousehold({ name: 'Outside' });
    await rejects(rpc(outsider.owner, 'complete_item', [it.id]), 'not_found');
    await rejects(rpc(await createUser(), 'complete_item', [it.id]), 'not_found');
  });

  test('a state that became a task can be completed like any task', async () => {
    const today = await todayIn('Europe/London');
    const it = await insertItem(h, { title: 'Was a state', kind: 'state' });
    await q(h.owner, "update public.items set kind = 'task', repeat = 'weekly', due_date = $2 where id = $1", [it.id, today]);
    await rpc(h.owner, 'complete_item', [it.id]);
    const after = await item(it.id);
    assert.equal(after.status, 'open');
    assert.equal(after.due_date, await dateAdd(today, '7 days'));
  });

  test('undoing a completion of an item that has since become a state keeps it without a due date', async () => {
    const it = await insertItem(h, { title: 'Became a state', repeat: 'monthly', due_date: '2099-01-31' });
    const cid = await rpc(h.owner, 'complete_item', [it.id]);
    assert.equal((await item(it.id)).due_date, '2099-02-28');
    await q(h.owner, "update public.items set kind = 'state' where id = $1", [it.id]);
    await rpc(h.owner, 'undo_completion', [cid]);
    const after = await item(it.id);
    assert.equal(after.kind, 'state');
    assert.equal(after.status, 'open');
    assert.equal(after.due_date, null);
    assert.equal(await one('select id from public.completions where id = $1', [cid]), undefined);
  });
});

describe('create_household seed items with a kind', () => {
  test("seeds states without a due date, repeat or reminder; kind defaults to 'task'", async () => {
    const h = await createHousehold({
      areas: ['Garden', 'Jacuzzi'],
      items: [
        { area: 'Garden', kind: 'state', title: 'Firepit', note: 'Cover on.', rag: 'green', due_in_days: 7, repeat: 'weekly', notify: 'same_day' },
        { area: 'Garden', title: 'Mow the lawn', rag: 'amber', due_in_days: 3, repeat: 'weekly', notify: 'day_before' },
        { area: 'Jacuzzi', kind: 'task', title: 'Change the filter', due_in_days: 12, repeat: 'monthly' },
      ],
    });
    const { rows } = await db(
      'select kind, title, note, rag, due_date, repeat, notify, status, assignee_id from public.items where household_id = $1 order by title',
      [h.id],
    );
    const today = await todayIn('Europe/London');
    assert.deepEqual(rows, [
      { kind: 'task', title: 'Change the filter', note: '', rag: 'amber', due_date: await dateAdd(today, '12 days'), repeat: 'monthly', notify: 'day_before', status: 'open', assignee_id: null },
      { kind: 'state', title: 'Firepit', note: 'Cover on.', rag: 'green', due_date: null, repeat: 'none', notify: 'none', status: 'open', assignee_id: null },
      { kind: 'task', title: 'Mow the lawn', note: '', rag: 'amber', due_date: await dateAdd(today, '3 days'), repeat: 'weekly', notify: 'day_before', status: 'open', assignee_id: null },
    ]);
  });

  test('an unknown kind is invalid_input and creates nothing', async () => {
    for (const kind of ['done', 'State', '', 42, true]) {
      const user = await createUser();
      const items = [{ area: 'Kitchen', title: 'x', kind }];
      await rejects(
        rpc(user, 'create_household', ['Bad kind', '', 'Europe/London', 'Me', '🦔', ['Kitchen'], JSON.stringify(items)]),
        'invalid_input',
      );
      assert.equal((await one('select count(*)::int as n from public.members where user_id = $1', [user.id])).n, 0, String(kind));
    }
  });

  test('a null kind reads as missing: a task', async () => {
    const h = await createHousehold({ areas: ['Kitchen'], items: [{ area: 'Kitchen', title: 'Null kind', kind: null, due_in_days: 1 }] });
    const row = await one('select kind, due_date from public.items where household_id = $1', [h.id]);
    assert.equal(row.kind, 'task');
    assert.notEqual(row.due_date, null);
  });

  test("the app's SEED_ITEMS seed the Firepit as a state in the Garden", async () => {
    const seeds = await loadClientSeedItems();
    const firepit = seeds.find((s) => s.title === 'Firepit');
    assert.ok(firepit, 'SEED_ITEMS has the Firepit');
    assert.equal(firepit.kind, 'state');

    // What SupabaseBackend.createHousehold sends (demo_assignee stays in the app).
    const items = seeds.map(({ demo_assignee: _who, ...s }) => ({ ...s, kind: s.kind ?? 'task' }));
    const areas = [...new Set(seeds.map((s) => s.area))];
    const h = await createHousehold({ areas, items });
    const { rows } = await db('select kind, title, rag, note, due_date, repeat, notify from public.items where household_id = $1', [h.id]);
    assert.equal(rows.length, seeds.length);
    assert.deepEqual(
      rows.find((r) => r.title === 'Firepit'),
      {
        kind: 'state',
        title: 'Firepit',
        rag: 'green',
        note: "New one installed. Keep the cover on when it's not in use.",
        due_date: null,
        repeat: 'none',
        notify: 'none',
      },
    );
    assert.equal(rows.filter((r) => r.kind === 'state').length, seeds.filter((s) => s.kind === 'state').length);
    for (const r of rows.filter((x) => x.kind === 'task')) {
      const seed = seeds.find((s) => s.title === r.title);
      assert.equal(r.repeat, seed.repeat, r.title);
    }
  });
});

describe('what the scheduler reads', () => {
  test('a state is open but never has a due date or a reminder', async () => {
    const h = await createHousehold({ name: 'Scheduler kinds' });
    const state = await insertItem(h, { title: 'Firepit', kind: 'state', due_date: '2026-01-01', notify: 'same_day' });
    const task = await insertItem(h, { title: 'Task', due_date: '2026-01-01', notify: 'same_day' });
    const rows = await asService(
      async (c) =>
        (await c.query('select id, due_date, notify from public.scheduler_open_items where household_id = $1 order by title', [h.id]))
          .rows,
    );
    assert.deepEqual(rows, [
      { id: state.id, due_date: null, notify: 'none' },
      { id: task.id, due_date: '2026-01-01', notify: 'same_day' },
    ]);
    // The scheduler marks states from items itself (service role).
    const states = await asService(
      async (c) =>
        (await c.query("select id from public.items where status = 'open' and kind = 'state' and household_id = $1", [h.id]))
          .rows,
    );
    assert.deepEqual(states, [{ id: state.id }]);
  });
});
