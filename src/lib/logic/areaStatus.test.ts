import { describe, expect, it } from 'vitest';
import type { Item, Member, Rag } from '../types';
import { areaOverview, peopleText } from './areaStatus';

const TODAY = '2026-10-13';

let n = 0;
function item(rag: Rag, due: string | null, over: Partial<Item> = {}): Item {
  n += 1;
  return {
    id: `i${n}`,
    household_id: 'h',
    area_id: 'a',
    kind: 'task',
    title: `Item ${n}`,
    note: '',
    good: '',
    rag,
    due_date: due,
    assignee_id: null,
    repeat: 'none',
    notify: 'none',
    status: 'open',
    created_by: null,
    updated_by: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...over,
  };
}

const state = (rag: Rag, over: Partial<Item> = {}) => item(rag, null, { kind: 'state', ...over });

function member(id: string, name: string): Member {
  return {
    id,
    household_id: 'h',
    user_id: null,
    name,
    email: '',
    emoji: '🦔',
    color: '#007AFF',
    role: 'member',
    weekly_email: false,
    push_enabled: false,
    created_at: '2026-10-01T00:00:00Z',
  };
}

const STRATIS = member('m1', 'Stratis');
const SHEA = member('m2', 'Shea');
const ELA = member('m3', 'Ela');
const MEMBERS = [STRATIS, SHEA, ELA];

describe('areaOverview', () => {
  it('needs attention for anything urgent, late, or looked after that needs work', () => {
    expect(areaOverview([item('red', '2026-10-20')], MEMBERS, TODAY)).toMatchObject({
      status: 'attention',
      statusText: '1 needs attention',
    });
    // Late, even when not urgent; and a thing that needs work.
    const late = item('green', '2026-10-01');
    const work = state('red');
    expect(areaOverview([late, work, item('amber', '2026-10-20')], MEMBERS, TODAY)).toMatchObject({
      status: 'attention',
      statusText: '2 need attention',
      openCount: 2,
    });
  });

  it('is coming up for a To do within the month, or to keep an eye on for something Okay', () => {
    expect(areaOverview([item('amber', '2026-10-30'), item('green', null)], MEMBERS, TODAY)).toMatchObject({
      status: 'soon',
      statusText: '1 coming up',
      openCount: 2,
    });
    expect(areaOverview([state('amber'), item('green', null)], MEMBERS, TODAY)).toMatchObject({
      status: 'soon',
      statusText: '1 to keep an eye on',
      openCount: 1,
    });
    // The To dos are what the words count when both are there.
    expect(areaOverview([state('amber'), item('amber', null), item('amber', null)], MEMBERS, TODAY).statusText).toBe(
      '2 coming up',
    );
  });

  it('is all good with nothing pressing, and all clear with nothing open', () => {
    expect(areaOverview([item('green', '2026-10-20'), state('green')], MEMBERS, TODAY)).toMatchObject({
      status: 'good',
      statusText: 'All good',
      openCount: 1,
    });
    expect(areaOverview([], MEMBERS, TODAY)).toEqual({ status: 'good', statusText: 'All clear', openCount: 0, people: [] });
    // Done items are not open.
    expect(areaOverview([item('red', '2026-10-01', { status: 'done' })], MEMBERS, TODAY).status).toBe('good');
  });

  it('lists who is looking after it, most items first, then in the household’s order', () => {
    const items = [
      item('green', null, { assignee_id: ELA.id }),
      item('green', null, { assignee_id: SHEA.id }),
      state('green', { assignee_id: ELA.id }),
      item('green', null, { assignee_id: STRATIS.id }),
      item('green', null, { assignee_id: SHEA.id }),
      item('green', null),
    ];
    expect(areaOverview(items, MEMBERS, TODAY).people.map((m) => m.name)).toEqual(['Shea', 'Ela', 'Stratis']);
    // Someone who has left is left out.
    expect(areaOverview([item('green', null, { assignee_id: 'gone' })], MEMBERS, TODAY).people).toEqual([]);
  });
});

describe('peopleText', () => {
  it('says who in words', () => {
    expect(peopleText([])).toBe('No one yet');
    expect(peopleText([SHEA])).toBe('Shea');
    expect(peopleText([SHEA, ELA])).toBe('Shea and Ela');
    expect(peopleText([SHEA, ELA, STRATIS])).toBe('Shea, Ela and Stratis');
  });
});
