import { describe, expect, it } from 'vitest';
import { DEFAULT_AREAS, SEED_ITEMS } from '../constants';
import type { Area, Item, ItemDraft, Member, Repeat } from '../types';
import {
  applyKindRules,
  compareItems,
  draftOf,
  dueDetail,
  isMissed,
  isState,
  itemMeta,
  itemsByArea,
  memberLabel,
  newItemDraft,
  nextDueDate,
  seedItemsFor,
  sortItems,
  updatedLabel,
  withKind,
} from './items';

const TODAY = '2026-10-08'; // Thursday

function item(over: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    household_id: 'h1',
    area_id: 'a1',
    kind: 'task',
    title: 'Item',
    note: '',
    good: '',
    rag: 'amber',
    due_date: '2026-10-20',
    assignee_id: null,
    repeat: 'none',
    notify: 'day_before',
    status: 'open',
    created_by: null,
    updated_by: null,
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-01T10:00:00.000Z',
    ...over,
  };
}

function member(over: Partial<Member> = {}): Member {
  return {
    id: 'm-shea',
    household_id: 'h1',
    user_id: 'u-shea',
    name: 'Shea',
    email: 'shea@example.com',
    emoji: '🦆',
    color: '#AF52DE',
    role: 'member',
    weekly_email: true,
    push_enabled: false,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const area = (id: string, name: string, position: number): Area => ({ id, household_id: 'h1', name, position });

describe('isMissed', () => {
  it('is true only for open items due before today', () => {
    expect(isMissed({ status: 'open', due_date: '2026-10-07' }, TODAY)).toBe(true);
    expect(isMissed({ status: 'open', due_date: '2025-12-31' }, TODAY)).toBe(true);
    expect(isMissed({ status: 'open', due_date: TODAY }, TODAY)).toBe(false);
    expect(isMissed({ status: 'open', due_date: '2026-10-09' }, TODAY)).toBe(false);
    expect(isMissed({ status: 'done', due_date: '2026-10-01' }, TODAY)).toBe(false);
    expect(isMissed({ status: 'open', due_date: null }, TODAY)).toBe(false);
  });
});

describe('compareItems / sortItems', () => {
  it('sorts by due date, undated last, then oldest first, then title', () => {
    const a = item({ id: 'a', title: 'A', due_date: '2026-10-20' });
    const b = item({ id: 'b', title: 'B', due_date: null });
    const c = item({ id: 'c', title: 'C', due_date: '2026-10-06' });
    const d = item({ id: 'd', title: 'D', due_date: '2026-10-20', created_at: '2026-09-01T00:00:00.000Z' });
    const e = item({ id: 'e', title: 'E', due_date: null, created_at: '2026-09-01T00:00:00.000Z' });
    const f = item({ id: 'f', title: 'Apple', due_date: '2027-01-05' });
    const g = item({ id: 'g', title: 'Aardvark', due_date: '2027-01-05' });
    const input = [a, b, c, d, e, f, g];
    expect(sortItems(input).map((i) => i.id)).toEqual(['c', 'd', 'a', 'g', 'f', 'e', 'b']);
    // Does not mutate its input.
    expect(input.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('is a consistent comparator', () => {
    const a = item({ id: 'a', due_date: null });
    const b = item({ id: 'b', due_date: '2026-10-10' });
    expect(compareItems(a, b)).toBe(1);
    expect(compareItems(b, a)).toBe(-1);
    expect(compareItems(a, a)).toBe(0);
  });
});

describe('nextDueDate', () => {
  it('returns null for non-repeating items', () => {
    expect(nextDueDate('none', '2026-10-20', TODAY)).toBeNull();
    expect(nextDueDate('none', null, TODAY)).toBeNull();
  });

  it('steps one interval from the old due date', () => {
    const cases: [Repeat, string][] = [
      ['weekly', '2026-10-27'],
      ['monthly', '2026-11-20'],
      ['quarterly', '2027-01-20'],
      ['biannual', '2027-04-20'],
      ['yearly', '2027-10-20'],
    ];
    for (const [repeat, expected] of cases) expect(nextDueDate(repeat, '2026-10-20', TODAY)).toBe(expected);
  });

  it('keeps stepping from the old date when that lands today or later', () => {
    expect(nextDueDate('weekly', '2026-10-06', TODAY)).toBe('2026-10-13');
    expect(nextDueDate('monthly', '2026-10-06', TODAY)).toBe('2026-11-06');
    // Exactly today is not "before today".
    expect(nextDueDate('weekly', '2026-10-01', TODAY)).toBe(TODAY);
    expect(nextDueDate('monthly', '2026-09-08', TODAY)).toBe(TODAY);
  });

  it('steps from today when the next date would still be in the past', () => {
    expect(nextDueDate('weekly', '2026-09-01', TODAY)).toBe('2026-10-15');
    expect(nextDueDate('monthly', '2026-08-15', TODAY)).toBe('2026-11-08');
    expect(nextDueDate('quarterly', '2026-01-10', TODAY)).toBe('2027-01-08');
    expect(nextDueDate('biannual', '2025-10-01', TODAY)).toBe('2027-04-08');
    expect(nextDueDate('yearly', '2024-05-01', TODAY)).toBe('2027-10-08');
  });

  it('steps from today without a due date', () => {
    const cases: [Repeat, string][] = [
      ['weekly', '2026-10-15'],
      ['monthly', '2026-11-08'],
      ['quarterly', '2027-01-08'],
      ['biannual', '2027-04-08'],
      ['yearly', '2027-10-08'],
    ];
    for (const [repeat, expected] of cases) expect(nextDueDate(repeat, null, TODAY)).toBe(expected);
  });

  it('clamps monthly intervals to the end of the month', () => {
    expect(nextDueDate('monthly', '2027-01-31', '2027-01-30')).toBe('2027-02-28');
    expect(nextDueDate('monthly', '2028-01-31', '2028-01-30')).toBe('2028-02-29');
    expect(nextDueDate('quarterly', '2026-11-30', TODAY)).toBe('2027-02-28');
    expect(nextDueDate('biannual', '2026-08-31', '2026-08-01')).toBe('2027-02-28');
    expect(nextDueDate('yearly', '2028-02-29', '2028-02-01')).toBe('2029-02-28');
    // From today on the 31st.
    expect(nextDueDate('monthly', null, '2026-10-31')).toBe('2026-11-30');
  });
});

describe('memberLabel', () => {
  it('shows the emoji and name, or Unassigned', () => {
    expect(memberLabel(member())).toBe('🦆 Shea');
    expect(memberLabel(null)).toBe('Unassigned');
    expect(memberLabel(undefined)).toBe('Unassigned');
  });
});

describe('itemMeta', () => {
  const members = [member({ id: 'm-me', name: 'Stratis', emoji: '🦔' }), member()];
  const line = (m: { who: string; date: string | null }) => (m.date ? `${m.who} · ${m.date}` : m.who);

  it('reads "🦆 Shea · Tue 20 Oct"', () => {
    const meta = itemMeta(item({ assignee_id: 'm-shea', due_date: '2026-10-20' }), members, TODAY);
    expect(meta).toEqual({ who: '🦆 Shea', date: 'Tue 20 Oct', missed: false });
    expect(line(meta)).toBe('🦆 Shea · Tue 20 Oct');
  });

  it('reads "Unassigned · …" without an assignee (or with one who left)', () => {
    expect(line(itemMeta(item({ due_date: '2026-10-12' }), members, TODAY))).toBe('Unassigned · Mon 12 Oct');
    expect(itemMeta(item({ assignee_id: 'gone' }), members, TODAY).who).toBe('Unassigned');
  });

  it('marks missed items "Missed · Tue 6 Oct"', () => {
    const meta = itemMeta(item({ assignee_id: 'm-shea', due_date: '2026-10-06' }), members, TODAY);
    expect(meta).toEqual({ who: '🦆 Shea', date: 'Missed · Tue 6 Oct', missed: true });
    expect(line(meta)).toBe('🦆 Shea · Missed · Tue 6 Oct');
  });

  it('is not missed on the due day, and shows the year when needed', () => {
    expect(itemMeta(item({ due_date: TODAY }), members, TODAY)).toMatchObject({ date: 'Thu 8 Oct', missed: false });
    expect(itemMeta(item({ due_date: '2027-01-05' }), members, TODAY).date).toBe('Tue 5 Jan 2027');
  });

  it('has a null date without a due date', () => {
    expect(itemMeta(item({ due_date: null, assignee_id: 'm-me' }), members, TODAY)).toEqual({
      who: '🦔 Stratis',
      date: null,
      missed: false,
    });
  });
});

describe('dueDetail', () => {
  it('formats the Item sheet Due row', () => {
    expect(dueDetail('2026-10-06', TODAY)).toEqual({ text: 'Tue 6 Oct · 2 days late', missed: true });
    expect(dueDetail('2026-10-07', TODAY)).toEqual({ text: 'Wed 7 Oct · 1 day late', missed: true });
    expect(dueDetail(TODAY, TODAY)).toEqual({ text: 'Thu 8 Oct', missed: false });
    expect(dueDetail('2026-10-20', TODAY)).toEqual({ text: 'Tue 20 Oct', missed: false });
    expect(dueDetail(null, TODAY)).toEqual({ text: 'None', missed: false });
    expect(dueDetail('2025-12-31', '2026-01-02')).toEqual({ text: 'Wed 31 Dec 2025 · 2 days late', missed: true });
  });
});

describe('itemsByArea', () => {
  it('orders areas by position (then name) and sorts each area’s open items', () => {
    const areas = [area('a3', 'Garden', 2), area('a1', 'Kitchen', 0), area('a2b', 'Bathroom', 1), area('a2', 'Attic', 1)];
    const items = [
      item({ id: 'k2', area_id: 'a1', due_date: null }),
      item({ id: 'k1', area_id: 'a1', due_date: '2026-10-10' }),
      item({ id: 'kd', area_id: 'a1', due_date: '2026-10-01', status: 'done' }),
      item({ id: 'g1', area_id: 'a3', due_date: '2026-10-06' }),
      item({ id: 'x', area_id: 'unknown' }),
    ];
    const groups = itemsByArea(areas, items);
    expect(groups.map((g) => g.area.name)).toEqual(['Kitchen', 'Attic', 'Bathroom', 'Garden']);
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([['k1', 'k2'], [], [], ['g1']]);
    // Does not reorder the caller's array.
    expect(areas[0].id).toBe('a3');
  });
});

describe('newItemDraft', () => {
  it('uses the README defaults', () => {
    expect(newItemDraft('a1', TODAY)).toEqual({
      area_id: 'a1',
      kind: 'task',
      title: '',
      note: '',
      good: '',
      rag: 'amber',
      due_date: '2026-10-15',
      assignee_id: null,
      repeat: 'none',
      notify: 'day_before',
    });
    expect(newItemDraft('a1', '2026-12-28').due_date).toBe('2027-01-04');
  });
});

describe('draftOf', () => {
  it('keeps only the editable fields', () => {
    const it1 = item({ assignee_id: 'm-shea', repeat: 'monthly', note: 'n', good: 'g' });
    expect(draftOf(it1)).toEqual({
      area_id: 'a1',
      kind: 'task',
      title: 'Item',
      note: 'n',
      good: 'g',
      rag: 'amber',
      due_date: '2026-10-20',
      assignee_id: 'm-shea',
      repeat: 'monthly',
      notify: 'day_before',
    });
  });
});

describe('seedItemsFor', () => {
  it('keeps seed items whose area exists, case-insensitively', () => {
    expect(seedItemsFor(DEFAULT_AREAS)).toEqual(SEED_ITEMS);
    expect(seedItemsFor([])).toEqual([]);
    expect(seedItemsFor(['Attic'])).toEqual([]);
    const picked = seedItemsFor([' kitchen ', 'JACUZZI']);
    expect(picked.map((s) => s.title)).toEqual(['Kitchen paper', 'Olive oil', 'Water test strips running low', 'Change the filter']);
  });

  it('matches the prototype due dates when created on 8 Oct', () => {
    const due = (title: string) => {
      const s = SEED_ITEMS.find((x) => x.title === title)!;
      return s.due_in_days;
    };
    expect(due('Heaters not working')).toBe(-2); // Missed · Tue 6 Oct
    expect(due('Mirror lights not level')).toBe(12); // Tue 20 Oct
    expect(due('Trim the hedges')).toBe(25); // Mon 2 Nov
  });
});

describe('kinds: To do (task) and To maintain (state)', () => {
  const state = (over: Partial<Item> = {}) =>
    item({ kind: 'state', due_date: null, repeat: 'none', notify: 'none', ...over });

  it('tells states apart; anything else is a task', () => {
    expect(isState(state())).toBe(true);
    expect(isState(item())).toBe(false);
    expect(isState({})).toBe(false);
  });

  it('a state keeps no due date, repeat or reminder; a task is left alone', () => {
    const task = item({ due_date: '2026-10-20', repeat: 'monthly', notify: 'week_before' });
    expect(applyKindRules(task)).toBe(task);
    expect(applyKindRules({ ...task, kind: 'state' as const })).toMatchObject({
      kind: 'state',
      due_date: null,
      repeat: 'none',
      notify: 'none',
      rag: 'amber',
      title: 'Item',
    });
    // Patches too: only when they make the item a state.
    const titleOnly: Partial<ItemDraft> = { title: 'x' };
    expect(applyKindRules(titleOnly)).toBe(titleOnly);
    expect(applyKindRules({ kind: 'state' as const, title: 'x' })).toEqual({
      kind: 'state',
      title: 'x',
      due_date: null,
      repeat: 'none',
      notify: 'none',
    });
  });

  it('a state is never missed', () => {
    expect(isMissed({ kind: 'state', status: 'open', due_date: '2026-10-01' }, TODAY)).toBe(false);
    expect(isMissed({ kind: 'task', status: 'open', due_date: '2026-10-01' }, TODAY)).toBe(true);
  });

  it('sorts tasks first (by due date as before), then states by title', () => {
    const t1 = item({ id: 't1', title: 'Late', due_date: '2026-10-06' });
    const t2 = item({ id: 't2', title: 'Undated', due_date: null });
    const s1 = state({ id: 's1', title: 'jacuzzi' });
    const s2 = state({ id: 's2', title: 'Firepit' });
    const s3 = state({ id: 's3', title: 'Firepit', created_at: '2026-09-01T00:00:00.000Z' });
    expect(sortItems([s1, t2, s2, t1, s3]).map((i) => i.id)).toEqual(['t1', 't2', 's3', 's2', 's1']);
    expect(compareItems(s2, t2)).toBe(1);
    expect(compareItems(t2, s2)).toBe(-1);
    expect(compareItems(s2, s2)).toBe(0);
  });

  it('itemsByArea puts each area’s states after its tasks', () => {
    const areas = [area('a1', 'Garden', 0)];
    const groups = itemsByArea(areas, [
      state({ id: 'fire', title: 'Firepit' }),
      item({ id: 'panel', title: 'Garden room wall panel', due_date: '2026-10-30' }),
      item({ id: 'give', title: 'Give away the old firepit', due_date: '2026-10-15' }),
    ]);
    expect(groups[0].items.map((i) => i.id)).toEqual(['give', 'panel', 'fire']);
  });

  it('a state’s meta line reads "🦊 Ela · Updated Tue 6 Oct", in the household’s zone', () => {
    const ela = member({ id: 'm-ela', name: 'Ela', emoji: '🦊' });
    const firepit = state({ assignee_id: 'm-ela', updated_at: '2026-10-06T09:00:00.000Z' });
    expect(itemMeta(firepit, [ela], TODAY, 'Europe/London')).toEqual({
      who: '🦊 Ela',
      date: 'Updated Tue 6 Oct',
      missed: false,
    });
    expect(itemMeta(state({ updated_at: '2026-10-06T09:00:00.000Z' }), [ela], TODAY, 'Europe/London').who).toBe('Unassigned');
    // 23:30 UTC on 6 Oct is already 7 Oct in London (BST), still 6 Oct in UTC.
    const late = state({ updated_at: '2026-10-06T23:30:00.000Z' });
    expect(itemMeta(late, [], TODAY, 'Europe/London').date).toBe('Updated Wed 7 Oct');
    expect(itemMeta(late, [], TODAY, 'UTC').date).toBe('Updated Tue 6 Oct');
    // Without a zone it uses London's.
    expect(itemMeta(late, [], TODAY).date).toBe('Updated Wed 7 Oct');
    // Even if a stale row still had a past due date, a state is never "Missed".
    expect(itemMeta(state({ due_date: '2026-10-01', updated_at: '2026-10-08T08:00:00Z' }), [], TODAY)).toEqual({
      who: 'Unassigned',
      date: 'Updated Thu 8 Oct',
      missed: false,
    });
  });

  it('updatedLabel adds the year when it is not this year, and survives a bad timestamp', () => {
    expect(updatedLabel('2025-12-30T12:00:00Z', TODAY, 'Europe/London')).toBe('Updated Tue 30 Dec 2025');
    expect(updatedLabel('not a time', TODAY)).toBe('Updated');
  });

  it('draftOf keeps the kind (a row without one is a task)', () => {
    expect(draftOf(state()).kind).toBe('state');
    const { kind: _kind, ...legacy } = item();
    expect(draftOf(legacy as Item).kind).toBe('task');
  });

  it('draftOf keeps "What good looks like" (a row from before it existed has none)', () => {
    expect(draftOf(state({ good: 'Cover on, logs dry.' })).good).toBe('Cover on, logs dry.');
    expect(draftOf(item({ good: 'Kept for a task too.' })).good).toBe('Kept for a task too.');
    const { good: _good, ...legacy } = state();
    expect(draftOf(legacy as Item).good).toBe('');
  });

  it('withKind keeps "What good looks like" both ways, and applyKindRules leaves it alone', () => {
    const saved = draftOf(state({ good: 'Cover on, logs dry.' }));
    const task = withKind(saved, 'task', TODAY, 'state');
    expect(task.good).toBe('Cover on, logs dry.');
    expect(withKind(task, 'state', TODAY, 'state').good).toBe('Cover on, logs dry.');
    expect(applyKindRules(saved).good).toBe('Cover on, logs dry.');
    expect(applyKindRules({ ...saved, kind: 'task' as const }).good).toBe('Cover on, logs dry.');
  });

  it('withKind: a To do becoming To maintain keeps its hidden task fields, so switching back restores them', () => {
    const task = newItemDraft('a1', TODAY);
    const maintained = withKind(task, 'state', TODAY);
    expect(maintained).toEqual({ ...task, kind: 'state' });
    expect(withKind(maintained, 'task', TODAY, 'task')).toEqual(task);
    expect(withKind(task, 'task', TODAY)).toBe(task);
  });

  it('withKind: a saved state becoming To do gets the new-item due date, repeat and notify', () => {
    const saved = draftOf(state({ title: 'Firepit', rag: 'green', assignee_id: 'm-ela', note: 'Cover on.' }));
    expect(withKind(saved, 'task', TODAY, 'state')).toEqual({
      ...saved,
      kind: 'task',
      due_date: '2026-10-15',
      repeat: 'none',
      notify: 'day_before',
    });
    // A saved task without a date or reminder keeps them when switched back and forth.
    const bare = draftOf(item({ due_date: null, notify: 'none' }));
    expect(withKind(withKind(bare, 'state', TODAY, 'task'), 'task', TODAY, 'task')).toEqual(bare);
  });

  it('seeds the Firepit as a green state in the Garden, looked after by Ela', () => {
    const firepit = SEED_ITEMS.find((s) => s.title === 'Firepit');
    expect(firepit).toEqual({
      area: 'Garden',
      kind: 'state',
      title: 'Firepit',
      note: "New one installed. Keep the cover on when it's not in use.",
      good: 'Cover on when not in use, ash cleared out, logs dry and stacked under the bench.',
      rag: 'green',
      due_in_days: null,
      repeat: 'none',
      notify: 'none',
      demo_assignee: 'ela',
    });
    // Everything else is a to-do, without a "What good looks like".
    expect(SEED_ITEMS.filter((s) => s.kind === 'state').map((s) => s.title)).toEqual(['Firepit']);
    expect(SEED_ITEMS.filter((s) => s.good).map((s) => s.title)).toEqual(['Firepit']);
  });
});
