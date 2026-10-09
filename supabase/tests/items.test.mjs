// Items: complete_item (credit, repeat maths), undo_completion, reorder_areas, the items
// trigger, and what happens to the log when things are deleted.

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import {
  as,
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
const completion = async (id) => one('select * from public.completions where id = $1', [id]);

/** The client's nextDueDate(), bundled from src/lib/logic/items.ts. */
async function loadClientNextDueDate() {
  const { build } = await import('esbuild');
  const out = await build({
    entryPoints: [path.join(root, 'src/lib/logic/items.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'silent',
  });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
  return mod.nextDueDate;
}

describe('next_due_date (the repeat maths used by complete_item)', () => {
  const next = async (repeat, due, today) =>
    (await one('select public.next_due_date($1, $2::date, $3::date)::text as d', [repeat, due, today])).d;

  test('calendar months clamp to the month end; weekly is 7 days', async () => {
    const today = '2026-10-08';
    const cases = [
      ['weekly', '2099-12-28', '2100-01-04'],
      ['monthly', '2099-01-31', '2099-02-28'],
      ['monthly', '2096-01-31', '2096-02-29'],
      ['monthly', '2099-03-31', '2099-04-30'],
      ['monthly', '2099-12-15', '2100-01-15'],
      ['quarterly', '2099-01-31', '2099-04-30'],
      ['quarterly', '2099-11-30', '2100-02-28'],
      ['biannual', '2099-08-31', '2100-02-28'],
      ['biannual', '2095-08-31', '2096-02-29'],
      ['yearly', '2096-02-29', '2097-02-28'],
      ['yearly', '2099-06-01', '2100-06-01'],
      ['none', '2099-06-01', null],
    ];
    for (const [repeat, due, expected] of cases) {
      assert.equal(await next(repeat, due, today), expected, `${repeat} from ${due}`);
    }
  });

  test('past due steps from today; a null due date steps from today', async () => {
    const today = '2026-10-08';
    assert.equal(await next('monthly', '2020-01-15', today), '2026-11-08');
    assert.equal(await next('weekly', '2026-10-01', today), '2026-10-08', 'exactly one week late lands on today');
    assert.equal(await next('weekly', '2026-09-30', today), '2026-10-15');
    assert.equal(await next('monthly', '2026-09-08', today), '2026-10-08');
    assert.equal(await next('monthly', null, today), '2026-11-08');
    assert.equal(await next('weekly', null, today), '2026-10-15');
    assert.equal(await next('yearly', null, '2028-02-29'), '2029-02-28');
    assert.equal(await next('none', null, today), null);
  });

  test('matches the client nextDueDate() on thousands of random cases', async () => {
    const nextDueDate = await loadClientNextDueDate();
    const repeats = ['none', 'weekly', 'monthly', 'quarterly', 'biannual', 'yearly'];
    const pad = (n) => String(n).padStart(2, '0');
    const randomDate = () => {
      const y = 1999 + Math.floor(Math.random() * 103);
      const m = 1 + Math.floor(Math.random() * 12);
      // Bias towards month ends, where clamping matters.
      const d = Math.random() < 0.5 ? 28 + Math.floor(Math.random() * 4) : 1 + Math.floor(Math.random() * 28);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return `${y}-${pad(m)}-${pad(Math.min(d, last))}`;
    };
    const addDays = (iso, n) => {
      const dt = new Date(`${iso}T00:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + n);
      return dt.toISOString().slice(0, 10);
    };
    const r = [];
    const due = [];
    const today = [];
    for (let i = 0; i < 5000; i++) {
      const t = randomDate();
      r.push(repeats[i % repeats.length]);
      today.push(t);
      // Near today (either side), far away, or none.
      const roll = Math.random();
      due.push(roll < 0.15 ? null : roll < 0.8 ? addDays(t, Math.floor(Math.random() * 800) - 400) : randomDate());
    }
    const { rows } = await db(
      `select x.ord, public.next_due_date(x.r, x.d, x.t)::text as next
       from unnest($1::text[], $2::date[], $3::date[]) with ordinality as x(r, d, t, ord)
       order by x.ord`,
      [r, due, today],
    );
    assert.equal(rows.length, r.length);
    for (let i = 0; i < r.length; i++) {
      assert.equal(rows[i].next, nextDueDate(r[i], due[i], today[i]), `${r[i]} due ${due[i]} today ${today[i]}`);
    }
  });
});

describe('complete_item', () => {
  let h;
  let second;
  let today;

  before(async () => {
    h = await createHousehold({ name: 'Complete home' });
    second = await joinHousehold(h, { name: 'Shea' });
    today = await todayIn('Europe/London');
  });

  test('credits the assignee, records who completed it and what to restore', async () => {
    const it = await insertItem(h, { title: 'Assigned', assignee_id: second.member.id, due_date: '2099-03-01' });
    const id = await rpc(h.owner, 'complete_item', [it.id]);
    const c = await completion(id);
    assert.equal(c.household_id, h.id);
    assert.equal(c.item_id, it.id);
    assert.equal(c.item_title, 'Assigned');
    assert.equal(c.credited_to, second.member.id);
    assert.equal(c.completed_by, h.member.id);
    assert.equal(c.prev_due_date, '2099-03-01');
    assert.equal(c.prev_status, 'open');
    assert.ok(Math.abs(Date.now() - c.completed_at.getTime()) < 60_000);
  });

  test('credits the caller when unassigned', async () => {
    const it = await insertItem(h, { title: 'Unassigned', due_date: null });
    const c = await completion(await rpc(second.user, 'complete_item', [it.id]));
    assert.equal(c.credited_to, second.member.id);
    assert.equal(c.completed_by, second.member.id);
    assert.equal(c.prev_due_date, null);
  });

  test('a one-off item becomes done; completing it again is not_found', async () => {
    const it = await insertItem(h, { title: 'One-off', due_date: '2099-03-01' });
    await rpc(h.owner, 'complete_item', [it.id]);
    const done = await item(it.id);
    assert.equal(done.status, 'done');
    assert.ok(done.completed_at instanceof Date);
    assert.equal(done.due_date, '2099-03-01');
    assert.equal(done.updated_by, h.member.id);
    await rejects(rpc(second.user, 'complete_item', [it.id]), 'not_found');
    assert.equal((await one('select count(*)::int as n from public.completions where item_id = $1', [it.id])).n, 1);
  });

  test('two people completing a one-off item at once: the second gets not_found', async () => {
    const it = await insertItem(h, { title: 'Race' });
    let locked;
    const hasLock = new Promise((r) => (locked = r));
    let release;
    const gate = new Promise((r) => (release = r));
    const first = as(h.owner, async (c) => {
      await c.query('select public.complete_item($1)', [it.id]);
      locked();
      await gate;
    });
    await hasLock;
    const secondAttempt = rpc(second.user, 'complete_item', [it.id]);
    await new Promise((r) => setTimeout(r, 150));
    release();
    await first;
    await rejects(secondAttempt, 'not_found');
    assert.equal((await one('select count(*)::int as n from public.completions where item_id = $1', [it.id])).n, 1);
  });

  test('each repeat interval moves the due date on and keeps the item open', async () => {
    const cases = [
      ['weekly', '2099-12-28', '2100-01-04'],
      ['monthly', '2099-01-31', '2099-02-28'],
      ['monthly', '2096-01-31', '2096-02-29'],
      ['quarterly', '2099-01-31', '2099-04-30'],
      ['biannual', '2099-08-31', '2100-02-28'],
      ['yearly', '2096-02-29', '2097-02-28'],
    ];
    for (const [repeat, due, expected] of cases) {
      const it = await insertItem(h, { title: `Repeat ${repeat}`, repeat, due_date: due });
      const c = await completion(await rpc(h.owner, 'complete_item', [it.id]));
      const after = await item(it.id);
      assert.equal(after.status, 'open', repeat);
      assert.equal(after.completed_at, null, repeat);
      assert.equal(after.due_date, expected, `${repeat} from ${due}`);
      assert.equal(c.prev_due_date, due);
    }
  });

  test('completing a repeating item twice steps twice', async () => {
    const it = await insertItem(h, { title: 'Twice', repeat: 'monthly', due_date: '2099-01-31' });
    await rpc(h.owner, 'complete_item', [it.id]);
    await rpc(second.user, 'complete_item', [it.id]);
    assert.equal((await item(it.id)).due_date, '2099-03-28');
  });

  test('past due: steps from today when one interval is not enough', async () => {
    const it = await insertItem(h, { title: 'Late monthly', repeat: 'monthly', due_date: '2020-01-15' });
    await rpc(h.owner, 'complete_item', [it.id]);
    assert.equal((await item(it.id)).due_date, await dateAdd(today, '1 month'));

    const weekLate = await dateAdd(today, '-7 days');
    const it2 = await insertItem(h, { title: 'Week late', repeat: 'weekly', due_date: weekLate });
    await rpc(h.owner, 'complete_item', [it2.id]);
    assert.equal((await item(it2.id)).due_date, today, 'one week late lands on today, which is not in the past');

    const it3 = await insertItem(h, { title: 'Eight days late', repeat: 'weekly', due_date: await dateAdd(today, '-8 days') });
    await rpc(h.owner, 'complete_item', [it3.id]);
    assert.equal((await item(it3.id)).due_date, await dateAdd(today, '7 days'));

    const it4 = await insertItem(h, { title: 'Slightly late', repeat: 'monthly', due_date: await dateAdd(today, '-3 days') });
    await rpc(h.owner, 'complete_item', [it4.id]);
    assert.equal((await item(it4.id)).due_date, await dateAdd(await dateAdd(today, '-3 days'), '1 month'));
  });

  test('no due date: one interval from today', async () => {
    for (const [repeat, step] of [['weekly', '7 days'], ['monthly', '1 month'], ['yearly', '1 year']]) {
      const it = await insertItem(h, { title: `Undated ${repeat}`, repeat, due_date: null });
      await rpc(h.owner, 'complete_item', [it.id]);
      assert.equal((await item(it.id)).due_date, await dateAdd(today, step), repeat);
    }
  });

  test("today is the household's today", async () => {
    const results = [];
    for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      const other = await createHousehold({ timezone: tz });
      const it = await insertItem(other, { title: 'Zoned', repeat: 'weekly', due_date: null });
      await rpc(other.owner, 'complete_item', [it.id]);
      const due = (await item(it.id)).due_date;
      assert.equal(due, await dateAdd(await todayIn(tz), '7 days'), tz);
      results.push(due);
    }
    assert.notEqual(results[0], results[1]);
  });

  test('not_signed_in / not_found', async () => {
    const it = await insertItem(h, { title: 'Guarded' });
    await rejects(rpc({ claims: { role: 'authenticated' } }, 'complete_item', [it.id]), 'not_signed_in');
    await rejects(rpc(h.owner, 'complete_item', ['00000000-0000-4000-8000-000000000001']), 'not_found');
    await rejects(rpc(h.owner, 'complete_item', [null]), 'not_found');
  });
});

describe('undo_completion', () => {
  let h;
  let second;

  before(async () => {
    h = await createHousehold({ name: 'Undo home' });
    second = await joinHousehold(h, { name: 'Ela' });
  });

  test('restores a one-off item exactly and deletes the completion', async () => {
    const it = await insertItem(h, { title: 'Oops', due_date: '2099-04-04', assignee_id: second.member.id });
    const cid = await rpc(h.owner, 'complete_item', [it.id]);
    assert.equal((await item(it.id)).status, 'done');
    // Anyone in the household may undo, not only the person who completed it.
    await rpc(second.user, 'undo_completion', [cid]);
    const restored = await item(it.id);
    assert.equal(restored.status, 'open');
    assert.equal(restored.due_date, '2099-04-04');
    assert.equal(restored.completed_at, null);
    assert.equal(restored.assignee_id, second.member.id);
    assert.equal(await completion(cid), undefined);
    await rejects(rpc(h.owner, 'undo_completion', [cid]), 'not_found');
  });

  test('restores the previous due date of a repeating item, including none', async () => {
    for (const due of ['2099-01-31', null, '2020-02-02']) {
      const it = await insertItem(h, { title: 'Repeat undo', repeat: 'monthly', due_date: due });
      const cid = await rpc(h.owner, 'complete_item', [it.id]);
      assert.notEqual((await item(it.id)).due_date, due);
      await rpc(h.owner, 'undo_completion', [cid]);
      const restored = await item(it.id);
      assert.equal(restored.due_date, due);
      assert.equal(restored.status, 'open');
    }
  });

  test('after the item was deleted it only removes the log row', async () => {
    const it = await insertItem(h, { title: 'Gone' });
    const cid = await rpc(h.owner, 'complete_item', [it.id]);
    await q(h.owner, 'delete from public.items where id = $1', [it.id]);
    const orphan = await completion(cid);
    assert.equal(orphan.item_id, null, 'the completion outlives its item');
    assert.equal(orphan.item_title, 'Gone');
    await rpc(h.owner, 'undo_completion', [cid]);
    assert.equal(await completion(cid), undefined);
  });

  test('not_signed_in / not_found for outsiders, and nothing changes', async () => {
    const it = await insertItem(h, { title: 'Mine' });
    const cid = await rpc(h.owner, 'complete_item', [it.id]);
    const outsider = await createHousehold();
    await rejects(rpc(outsider.owner, 'undo_completion', [cid]), 'not_found');
    await rejects(rpc(await createUser(), 'undo_completion', [cid]), 'not_found');
    await rejects(rpc({ claims: { role: 'authenticated' } }, 'undo_completion', [cid]), 'not_signed_in');
    assert.ok(await completion(cid));
    assert.equal((await item(it.id)).status, 'done');
  });
});

describe('reorder_areas', () => {
  test('sets positions from the array order and ignores foreign or unknown ids', async () => {
    const h = await createHousehold({ areas: ['A', 'B', 'C', 'D'] });
    const other = await createHousehold({ areas: ['X', 'Y'] });
    const [a, b, c, d] = h.areas.map((r) => r.id);
    const [x, y] = other.areas.map((r) => r.id);
    await rpc(h.owner, 'reorder_areas', [h.id, [d, x, '00000000-0000-4000-8000-000000000002', b, a, c, y]]);
    const { rows } = await db('select name, position from public.areas where household_id = $1 order by position', [h.id]);
    // Positions are indexes in the given array.
    assert.deepEqual(rows, [
      { name: 'D', position: 0 },
      { name: 'B', position: 3 },
      { name: 'A', position: 4 },
      { name: 'C', position: 5 },
    ]);
    const { rows: foreign } = await db('select name, position from public.areas where household_id = $1 order by position', [other.id]);
    assert.deepEqual(foreign, [
      { name: 'X', position: 0 },
      { name: 'Y', position: 1 },
    ]);
    await rpc(h.owner, 'reorder_areas', [h.id, [a, b, c, d]]);
    const { rows: back } = await db('select name from public.areas where household_id = $1 order by position', [h.id]);
    assert.deepEqual(back.map((r) => r.name), ['A', 'B', 'C', 'D']);
  });

  test('any member may reorder; outsiders get not_found', async () => {
    const h = await createHousehold({ areas: ['A', 'B'] });
    const second = await joinHousehold(h);
    const ids = h.areas.map((r) => r.id);
    await rpc(second.user, 'reorder_areas', [h.id, [...ids].reverse()]);
    const outsider = await createHousehold();
    await rejects(rpc(outsider.owner, 'reorder_areas', [h.id, ids]), 'not_found');
    await rejects(rpc({ claims: { role: 'authenticated' } }, 'reorder_areas', [h.id, ids]), 'not_signed_in');
    const { rows } = await db('select name from public.areas where household_id = $1 order by position', [h.id]);
    assert.deepEqual(rows.map((r) => r.name), ['B', 'A']);
  });
});

describe('items trigger', () => {
  let h;
  let second;
  let other;

  before(async () => {
    h = await createHousehold({ name: 'Trigger home' });
    second = await joinHousehold(h, { name: 'Second' });
    other = await createHousehold({ name: 'Other home' });
  });

  test('household_id comes from the area, whatever the client sends', async () => {
    const { rows } = await q(
      h.owner,
      "insert into public.items (household_id, area_id, title) values ($1, $2, 'Mislabelled') returning *",
      [other.id, h.areas[0].id],
    );
    assert.equal(rows[0].household_id, h.id);
    // Updating household_id alone is put back too.
    const upd = await q(h.owner, 'update public.items set household_id = $2 where id = $1 returning household_id', [rows[0].id, other.id]);
    assert.equal(upd.rows[0].household_id, h.id);
  });

  test('an area that does not exist is not_found', async () => {
    await rejects(
      q(h.owner, "insert into public.items (household_id, area_id, title) values ($1, gen_random_uuid(), 'Lost')", [h.id]),
      'not_found',
    );
  });

  test('an assignee from another household is rejected', async () => {
    await rejects(
      q(h.owner, "insert into public.items (household_id, area_id, title, assignee_id) values ($1, $2, 'x', $3)", [
        h.id,
        h.areas[0].id,
        other.member.id,
      ]),
      'invalid_input',
    );
    const it = await insertItem(h, { title: 'Reassign me' });
    await rejects(q(h.owner, 'update public.items set assignee_id = $2 where id = $1', [it.id, other.member.id]), 'invalid_input');
    const ok = await q(h.owner, 'update public.items set assignee_id = $2 where id = $1 returning assignee_id', [it.id, second.member.id]);
    assert.equal(ok.rows[0].assignee_id, second.member.id);
  });

  test('stamps created_by, updated_by and updated_at', async () => {
    const { rows } = await q(
      second.user,
      "insert into public.items (household_id, area_id, title, created_by, updated_by) values ($1, $2, 'Stamped', $3, $3) returning *",
      [h.id, h.areas[0].id, h.member.id],
    );
    const created = rows[0];
    assert.equal(created.created_by, second.member.id, 'the signed-in creator wins');
    assert.equal(created.updated_by, second.member.id);

    const { rows: upd } = await q(h.owner, "update public.items set note = 'edited', updated_by = $2 where id = $1 returning *", [
      created.id,
      second.member.id,
    ]);
    assert.equal(upd[0].updated_by, h.member.id);
    assert.equal(upd[0].created_by, second.member.id);
    assert.ok(upd[0].updated_at > created.updated_at);
  });

  test('blank titles are rejected', async () => {
    await rejects(
      q(h.owner, "insert into public.items (household_id, area_id, title) values ($1, $2, '   ')", [h.id, h.areas[0].id]),
      /check constraint/,
    );
  });
});

describe('deleting things', () => {
  test('deleting a member user keeps their items and completions, with references cleared', async () => {
    const h = await createHousehold({ name: 'Leaving home' });
    const leaver = await joinHousehold(h, { name: 'Leaver' });
    const { rows } = await q(
      leaver.user,
      "insert into public.items (household_id, area_id, title, assignee_id, repeat, due_date) values ($1, $2, 'Theirs', $3, 'weekly', '2099-01-01') returning *",
      [h.id, h.areas[0].id, leaver.member.id],
    );
    const it = rows[0];
    const cid = await rpc(leaver.user, 'complete_item', [it.id]);
    await q(leaver.user, "insert into public.push_subs (member_id, endpoint, p256dh, auth) values ($1, $2, 'k', 'a')", [
      leaver.member.id,
      `https://push.example.com/leaver-${h.id}`,
    ]);

    await db('delete from auth.users where id = $1', [leaver.user.id]);

    const after = await item(it.id);
    assert.equal(after.assignee_id, null);
    assert.equal(after.created_by, null);
    assert.equal(after.updated_by, null);
    assert.equal(after.household_id, h.id);
    const c = await completion(cid);
    assert.equal(c.credited_to, null);
    assert.equal(c.completed_by, null);
    assert.equal((await one('select count(*)::int as n from public.push_subs where user_id = $1', [leaver.user.id])).n, 0);
    assert.equal((await one('select count(*)::int as n from public.members where household_id = $1', [h.id])).n, 1);
  });

  test('deleting an area deletes its items but keeps their completions', async () => {
    const h = await createHousehold({ areas: ['Shed', 'Kitchen'] });
    const it = await insertItem(h, { title: 'Shed roof' });
    const cid = await rpc(h.owner, 'complete_item', [it.id]);
    await q(h.owner, 'delete from public.areas where id = $1', [h.areas[0].id]);
    assert.equal(await item(it.id), undefined);
    const c = await completion(cid);
    assert.equal(c.item_id, null);
    assert.equal(c.item_title, 'Shed roof');
  });

  test('deleting a household removes everything in it', async () => {
    const h = await createHousehold({ name: 'Doomed' });
    const second = await joinHousehold(h);
    const it = await insertItem(h, { assignee_id: second.member.id });
    await rpc(h.owner, 'complete_item', [it.id]);
    await rpc(h.owner, 'create_invite');
    await q(h.owner, "insert into public.push_subs (member_id, endpoint, p256dh, auth) values ($1, $2, 'k', 'a')", [
      h.member.id,
      `https://push.example.com/doomed-${h.id}`,
    ]);
    await db("insert into public.notifications_log (household_id, item_id, member_id, kind, ref_date) values ($1, $2, $3, 'missed', current_date)", [
      h.id,
      it.id,
      second.member.id,
    ]);
    await db('delete from public.households where id = $1', [h.id]);
    for (const t of ['members', 'areas', 'items', 'completions', 'invites', 'notifications_log']) {
      assert.equal((await one(`select count(*)::int as n from public.${t} where household_id = $1`, [h.id])).n, 0, t);
    }
    assert.equal((await one('select count(*)::int as n from public.push_subs where member_id = $1', [h.member.id])).n, 0);
  });
});
