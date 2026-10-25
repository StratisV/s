// Goals for the week and their public link (supabase/migrations/20261025000100_goals.sql).
// Contract tests written with the migration; docs/ARCHITECTURE.md "Goals for the week" is the
// spec. Every member edits every week's goals; outsiders and anon see and change nothing, but
// anyone with a link's token reads the current week through public_goals, and only that.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import { createHousehold, dateAdd, db, joinHousehold, one, q, rejects, rpc, useCleanup } from './helpers.mjs';

useCleanup();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = path.join(root, 'supabase/migrations/20261025000100_goals.sql');
const CHECK_VIOLATION = '23514';
const TABLES = ['goals', 'goal_links'];

/** This week's Monday in London, as the database sees it. */
const thisWeek = async () => (await one("select public.goals_week_of((now() at time zone 'Europe/London')::date) as d")).d;

const add = async (user, hid, week, title, memberId = null) =>
  (await q(user, 'select * from public.add_goal($1, $2, $3, $4)', [hid, week, title, memberId])).rows[0];
const goalsOf = async (hid, week) =>
  (await db('select * from public.goals where household_id = $1 and week = $2 order by position, created_at, id', [hid, week])).rows;
const titles = async (hid, week) => (await goalsOf(hid, week)).map((g) => g.title);
const bringOver = async (user, hid, week) => (await q(user, 'select * from public.bring_over_goals($1, $2)', [hid, week])).rows;
const linkOf = async (user, hid) => (await q(user, 'select * from public.goals_link($1)', [hid])).rows[0];

async function checkViolation(promise, constraint) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, CHECK_VIOLATION, `expected a check violation, got ${err.code}: ${err.message}`);
    assert.match(err.message, new RegExp(`"${constraint}"`));
    return true;
  });
}

describe('structure', () => {
  test('RLS on, whole old rows logged, and clients may only read', async () => {
    const { rows } = await db(
      `select c.relname, c.relrowsecurity, c.relreplident from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1)`,
      [TABLES],
    );
    assert.equal(rows.length, TABLES.length);
    for (const r of rows) {
      assert.equal(r.relrowsecurity, true, `RLS off on ${r.relname}`);
      assert.equal(r.relreplident, 'f', `${r.relname} replica identity`);
    }
    const priv = async (role, table, p) => (await one('select has_table_privilege($1, $2, $3) as ok', [role, `public.${table}`, p])).ok;
    for (const table of TABLES) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        assert.equal(await priv('authenticated', table, p), p === 'SELECT', `${table} ${p}`);
        assert.equal(await priv('anon', table, p), false, `anon ${table} ${p}`);
      }
    }
  });

  test('the RPCs are for signed-in members, public_goals for anyone, the helpers for nobody', async () => {
    const { rows } = await db(
      `select p.proname, p.prosecdef,
              has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'`,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.proname, r]));
    for (const name of [
      'add_goal',
      'rename_goal',
      'set_goal_person',
      'set_goal_done',
      'move_goal',
      'delete_goal',
      'bring_over_goals',
      'goals_link',
      'stop_goals_link',
    ]) {
      assert.ok(byName[name], `missing ${name}`);
      assert.equal(byName[name].prosecdef, true, `${name} security definer`);
      assert.equal(byName[name].auth_exec, true, `authenticated cannot execute ${name}`);
      assert.equal(byName[name].anon_exec, false, `anon can execute ${name}`);
    }
    assert.equal(byName.public_goals.prosecdef, true);
    assert.equal(byName.public_goals.anon_exec, true, 'anon cannot read a public link');
    assert.equal(byName.public_goals.auth_exec, true);
    for (const name of [
      'goals_lock',
      'goals_week_of',
      'goals_new_token',
      'goals_member',
      'goals_household_of',
      'goals_check_person',
      'goals_settle',
      'goals_before_write',
    ]) {
      assert.ok(byName[name], `missing ${name}`);
      assert.equal(byName[name].auth_exec, false, `authenticated can execute ${name}`);
      assert.equal(byName[name].anon_exec, false, `anon can execute ${name}`);
    }
  });

  test('each table’s primary key is its own id, so a realtime delete notice names no household', async () => {
    const { rows } = await db(
      `select c.relname, a.attname from pg_index i
         join pg_class c on c.oid = i.indrelid
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
       where i.indisprimary and n.nspname = 'public' and c.relname = any($1) order by c.relname`,
      [TABLES],
    );
    assert.deepEqual(
      rows.map((r) => [r.relname, r.attname]),
      [
        ['goal_links', 'id'],
        ['goals', 'id'],
      ],
    );
  });

  test('both tables are in the realtime publication (when there is one)', async () => {
    const pub = await one("select count(*)::int as n from pg_publication where pubname = 'supabase_realtime'");
    if (pub.n !== 1) return;
    const { rows } = await db("select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'");
    for (const t of TABLES) assert.ok(rows.some((r) => r.tablename === t), `${t} is not published`);
  });

  test('tokens are 22 characters of base64url, and fresh each time', async () => {
    const { rows } = await db('select public.goals_new_token() as t from generate_series(1, 200)');
    const tokens = rows.map((r) => r.t);
    for (const t of tokens) assert.match(t, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(new Set(tokens).size, tokens.length);
  });

  test('applying the migration again changes no data', async () => {
    const h = await createHousehold();
    const week = await thisWeek();
    await add(h.owner, h.id, week, 'Keep me');
    const link = await linkOf(h.owner, h.id);
    await db(fs.readFileSync(MIGRATION, 'utf8'));
    assert.deepEqual(await titles(h.id, week), ['Keep me']);
    assert.equal((await linkOf(h.owner, h.id)).token, link.token);
  });
});

describe('a week of goals', () => {
  let h;
  let shea;
  let outsider;
  let week;
  before(async () => {
    h = await createHousehold({ memberName: 'Stratis Vlachos' });
    shea = await joinHousehold(h, { name: 'Shea' });
    outsider = await createHousehold({ name: 'Elsewhere' });
    week = await thisWeek();
  });

  test('anyone at home adds a goal: trimmed, last in its week, not done, who added it', async () => {
    const a = await add(h.owner, h.id, week, '  Book the boiler service  ');
    const b = await add(shea.user, h.id, week, 'Fix the bike lights', shea.member.id);
    assert.equal(a.title, 'Book the boiler service');
    assert.equal(a.position, 0);
    assert.equal(b.position, 1);
    assert.equal(a.done, false);
    assert.equal(a.created_by, h.member.id);
    assert.equal(b.created_by, shea.member.id);
    assert.equal(b.member_id, shea.member.id);
    assert.equal(a.member_id, null);
    // Shea sees Stratis's goal and Stratis sees Shea's.
    const seen = (await q(shea.user, 'select title from public.goals where household_id = $1 order by position', [h.id])).rows;
    assert.deepEqual(seen.map((r) => r.title).slice(0, 2), ['Book the boiler service', 'Fix the bike lights']);
  });

  test('a week is a Monday; titles are 1 to 120 characters; a person must be from the home', async () => {
    await rejects(add(h.owner, h.id, await dateAdd(week, '1 day'), 'Tuesday'), 'invalid_input');
    await checkViolation(add(h.owner, h.id, week, '   '), 'goals_title_length');
    await checkViolation(add(h.owner, h.id, week, 'x'.repeat(121)), 'goals_title_length');
    await add(h.owner, h.id, week, 'x'.repeat(120)).then((g) => rpc(h.owner, 'delete_goal', [g.id]));
    await rejects(add(h.owner, h.id, week, 'Theirs', outsider.member.id), 'not_found');
  });

  test('outsiders, anon and the signed out are refused, and see nothing', async () => {
    const goal = (await goalsOf(h.id, week))[0];
    await rejects(add(outsider.owner, h.id, week, 'Sneaky'), 'not_found');
    await rejects(rpc(outsider.owner, 'rename_goal', [goal.id, 'Hacked']), 'not_found');
    await rejects(rpc(outsider.owner, 'set_goal_done', [goal.id, true]), 'not_found');
    await rejects(rpc(outsider.owner, 'move_goal', [goal.id, 3]), 'not_found');
    await rejects(rpc(outsider.owner, 'delete_goal', [goal.id]), 'not_found');
    await rejects(bringOver(outsider.owner, h.id, week), 'not_found');
    await rejects(linkOf(outsider.owner, h.id), 'not_found');
    await rejects(rpc(outsider.owner, 'stop_goals_link', [h.id]), 'not_found');
    assert.equal((await q(outsider.owner, 'select * from public.goals where household_id = $1', [h.id])).rowCount, 0);
    assert.equal((await q(outsider.owner, 'select * from public.goal_links where household_id = $1', [h.id])).rowCount, 0);
    await rejects(q(outsider.owner, "update public.goals set title = 'Hacked' where id = $1", [goal.id]), /permission denied/);
    await rejects(q(outsider.owner, 'delete from public.goals where id = $1', [goal.id]), /permission denied/);
    await rejects(q(null, 'select * from public.goals'), /permission denied/);
    await rejects(rpc(null, 'rename_goal', [goal.id, 'Hacked']), /permission denied/);
    await rejects(rpc({ claims: { role: 'authenticated' } }, 'rename_goal', [goal.id, 'Hacked']), 'not_signed_in');
    assert.equal((await one('select title from public.goals where id = $1', [goal.id])).title, goal.title);
  });

  test('rename, who is on it, tick and untick (with who and when)', async () => {
    const goal = (await goalsOf(h.id, week))[0];
    await rpc(shea.user, 'rename_goal', [goal.id, '  Book the boiler service for Friday ']);
    assert.equal((await one('select title from public.goals where id = $1', [goal.id])).title, 'Book the boiler service for Friday');
    await rpc(shea.user, 'set_goal_person', [goal.id, h.member.id]);
    assert.equal((await one('select member_id from public.goals where id = $1', [goal.id])).member_id, h.member.id);
    await rejects(rpc(shea.user, 'set_goal_person', [goal.id, outsider.member.id]), 'not_found');
    await rpc(shea.user, 'set_goal_person', [goal.id, null]);
    assert.equal((await one('select member_id from public.goals where id = $1', [goal.id])).member_id, null);

    await rpc(shea.user, 'set_goal_done', [goal.id, true]);
    const done = await one('select * from public.goals where id = $1', [goal.id]);
    assert.equal(done.done, true);
    assert.equal(done.done_by, shea.member.id);
    assert.ok(done.done_at);
    // Ticking again keeps the stamp, whoever ticks.
    await rpc(h.owner, 'set_goal_done', [goal.id, true]);
    const again = await one('select * from public.goals where id = $1', [goal.id]);
    assert.equal(again.done_by, shea.member.id);
    assert.equal(again.done_at.getTime(), done.done_at.getTime());
    await rejects(rpc(h.owner, 'set_goal_done', [goal.id, null]), 'invalid_input');
    await rpc(h.owner, 'set_goal_done', [goal.id, false]);
    const undone = await one('select * from public.goals where id = $1', [goal.id]);
    assert.equal(undone.done, false);
    assert.equal(undone.done_by, null);
    assert.equal(undone.done_at, null);
  });

  test('moving: one goal to a place, the week closing up; two moves at once both stand', async () => {
    const w = await dateAdd(week, '7 days');
    for (const t of ['A', 'B', 'C', 'D']) await add(h.owner, h.id, w, t);
    const ids = Object.fromEntries((await goalsOf(h.id, w)).map((g) => [g.title, g.id]));
    await rpc(h.owner, 'move_goal', [ids.A, 2]);
    assert.deepEqual(await titles(h.id, w), ['B', 'C', 'A', 'D']);
    await rpc(shea.user, 'move_goal', [ids.D, 0]);
    assert.deepEqual(await titles(h.id, w), ['D', 'B', 'C', 'A']);
    await rpc(h.owner, 'move_goal', [ids.B, 99]);
    assert.deepEqual(await titles(h.id, w), ['D', 'C', 'A', 'B']);
    assert.deepEqual((await goalsOf(h.id, w)).map((g) => g.position), [0, 1, 2, 3]);
    await rejects(rpc(h.owner, 'move_goal', [ids.A, -1]), 'invalid_input');
    // Two people at the same moment: each names one goal and where it goes.
    await Promise.all([rpc(h.owner, 'move_goal', [ids.D, 3]), rpc(shea.user, 'move_goal', [ids.C, 0])]);
    const after = await titles(h.id, w);
    assert.equal(after[0], 'C');
    assert.equal(after.length, 4);
    assert.deepEqual((await goalsOf(h.id, w)).map((g) => g.position), [0, 1, 2, 3]);
    // Other weeks never move.
    assert.equal((await goalsOf(h.id, week))[0].position, 0);
  });

  test('deleting: the rest close up', async () => {
    const w = await dateAdd(week, '14 days');
    for (const t of ['A', 'B', 'C']) await add(h.owner, h.id, w, t);
    const [a] = await goalsOf(h.id, w);
    await rpc(shea.user, 'delete_goal', [a.id]);
    assert.deepEqual(await titles(h.id, w), ['B', 'C']);
    assert.deepEqual((await goalsOf(h.id, w)).map((g) => g.position), [0, 1]);
    await rejects(rpc(shea.user, 'delete_goal', [a.id]), 'not_found');
  });

  test('a week holds 50 goals at most', async () => {
    const w = await dateAdd(week, '21 days');
    for (let i = 0; i < 50; i++) await add(h.owner, h.id, w, `Goal ${i}`);
    await checkViolation(add(h.owner, h.id, w, 'One more'), 'goals_week_limit');
    assert.equal((await goalsOf(h.id, w)).length, 50);
  });

  test('removing a person takes them off goals, keeping the goals and their ticks', async () => {
    const pat = await rpc(h.owner, 'add_person', [h.id, 'Pat', '🦊', '']);
    const goal = await add(h.owner, h.id, week, "Pat's goal", pat);
    await rpc(h.owner, 'set_goal_done', [goal.id, true]);
    await rpc(h.owner, 'remove_person', [pat]);
    const left = await one('select * from public.goals where id = $1', [goal.id]);
    assert.equal(left.member_id, null);
    assert.equal(left.done, true);
  });
});

describe('Bring over', () => {
  test('last week’s unfinished goals come over in order, each once, as many as fit', async () => {
    const h = await createHousehold();
    const shea = await joinHousehold(h, { name: 'Shea' });
    const week = await dateAdd(await thisWeek(), '35 days');
    const last = await dateAdd(week, '-7 days');
    const a = await add(h.owner, h.id, last, 'Unfinished A', shea.member.id);
    const b = await add(h.owner, h.id, last, 'Done B');
    await add(h.owner, h.id, last, 'Unfinished C');
    await rpc(h.owner, 'set_goal_done', [b.id, true]);
    // Two weeks back is not last week.
    await add(h.owner, h.id, await dateAdd(week, '-14 days'), 'Too old');

    // Two phones tapping at the same moment: one brings them, the other finds nothing to bring.
    const both = await Promise.all([bringOver(shea.user, h.id, week), bringOver(h.owner, h.id, week)]);
    const brought = both.find((rows) => rows.length) ?? [];
    assert.deepEqual(both.map((rows) => rows.length).sort(), [0, 2]);
    assert.deepEqual(brought.map((g) => g.title), ['Unfinished A', 'Unfinished C']);
    assert.equal(brought[0].carried_from, a.id);
    assert.equal(brought[0].member_id, shea.member.id);
    assert.equal(brought[0].done, false);
    assert.ok([shea.member.id, h.member.id].includes(brought[0].created_by));
    assert.deepEqual(brought.map((g) => g.position), [0, 1]);
    // Again (a second tap): nothing more comes.
    assert.deepEqual(await bringOver(h.owner, h.id, week), []);
    assert.deepEqual(await titles(h.id, week), ['Unfinished A', 'Unfinished C']);
    // Deleting the one it came from leaves it, without its origin.
    await rpc(h.owner, 'delete_goal', [a.id]);
    assert.equal((await one('select carried_from from public.goals where id = $1', [brought[0].id])).carried_from, null);
    await rejects(bringOver(h.owner, h.id, await dateAdd(week, '2 days')), 'invalid_input');
  });

  test('a nearly full week brings what fits', async () => {
    const h = await createHousehold();
    const week = await dateAdd(await thisWeek(), '42 days');
    for (let i = 0; i < 49; i++) await add(h.owner, h.id, week, `Here ${i}`);
    for (const t of ['A', 'B']) await add(h.owner, h.id, await dateAdd(week, '-7 days'), t);
    assert.deepEqual((await bringOver(h.owner, h.id, week)).map((g) => g.title), ['A']);
    assert.equal((await goalsOf(h.id, week)).length, 50);
  });
});

describe('the public link', () => {
  test('one per home: made once, the same again, off for good, then a new token', async () => {
    const h = await createHousehold();
    const shea = await joinHousehold(h, { name: 'Shea' });
    const first = await linkOf(h.owner, h.id);
    assert.match(first.token, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(first.created_by, h.member.id);
    assert.equal((await linkOf(shea.user, h.id)).token, first.token);
    // Members can read it (to share it again).
    assert.equal((await q(shea.user, 'select token from public.goal_links where household_id = $1', [h.id])).rows[0].token, first.token);
    await rpc(shea.user, 'stop_goals_link', [h.id]);
    assert.equal(await rpc(null, 'public_goals', [first.token]), null);
    await rpc(shea.user, 'stop_goals_link', [h.id]);
    const next = await linkOf(h.owner, h.id);
    assert.notEqual(next.token, first.token);
  });

  test('anyone with the token reads this week’s goals: titles, ticks and first names, nothing else', async () => {
    const h = await createHousehold({ memberName: 'Stratis Vlachos', emoji: '🦔', address: '21 Alderbrook Road' });
    const shea = await joinHousehold(h, { name: 'Shea Byrne', emoji: '🦆' });
    const week = await thisWeek();
    const second = await add(h.owner, h.id, week, 'Deep clean the fridge', shea.member.id);
    await add(h.owner, h.id, week, 'Plan Saturday dinner');
    await add(h.owner, h.id, await dateAdd(week, '-7 days'), 'Last week secret');
    await add(h.owner, h.id, await dateAdd(week, '7 days'), 'Next week secret');
    await rpc(shea.user, 'set_goal_done', [second.id, true]);
    await rpc(h.owner, 'move_goal', [second.id, 1]);
    const { token } = await linkOf(h.owner, h.id);

    const view = await rpc(null, 'public_goals', [token]);
    assert.deepEqual(view, {
      week,
      goals: [
        { title: 'Plan Saturday dinner', done: false, person: null },
        { title: 'Deep clean the fridge', done: true, person: { name: 'Shea', emoji: '🦆' } },
      ],
    });
    const json = JSON.stringify(view);
    for (const leak of ['Byrne', 'Vlachos', 'Alderbrook', 'example.com', h.id, shea.member.id, second.id, 'secret']) {
      assert.ok(!json.includes(leak), `the public view gives away ${leak}`);
    }
    // Signed in elsewhere: the same, and still nothing else.
    const outsider = await createHousehold({ name: 'Elsewhere' });
    assert.deepEqual(await rpc(outsider.owner, 'public_goals', [token]), view);
  });

  test('a first name is the first word whatever the spaces (no-break, full-width), as in the app', async () => {
    const h = await createHousehold({ memberName: '\u00a0Shea\u00a0Byrne' });
    const yuki = await joinHousehold(h, { name: '山田\u3000太郎' });
    const ela = await joinHousehold(h, { name: 'Ela\u202fMorgan' });
    const week = await thisWeek();
    await add(h.owner, h.id, week, 'One', h.member.id);
    await add(h.owner, h.id, week, 'Two', yuki.member.id);
    await add(h.owner, h.id, week, 'Three', ela.member.id);
    const { token } = await linkOf(h.owner, h.id);
    const view = await rpc(null, 'public_goals', [token]);
    assert.deepEqual(view.goals.map((g) => g.person.name), ['Shea', '山田', 'Ela']);
  });

  test('unknown, malformed and turned-off tokens read nothing', async () => {
    const h = await createHousehold();
    await add(h.owner, h.id, await thisWeek(), 'Hidden');
    const { token } = await linkOf(h.owner, h.id);
    const other = token.startsWith('A') ? `B${token.slice(1)}` : `A${token.slice(1)}`;
    for (const t of [other, '', 'short', `${token}x`, "' or 1=1 --", null]) {
      assert.equal(await rpc(null, 'public_goals', [t]), null, `token ${t}`);
    }
    await rpc(h.owner, 'stop_goals_link', [h.id]);
    assert.equal(await rpc(null, 'public_goals', [token]), null);
  });
});
