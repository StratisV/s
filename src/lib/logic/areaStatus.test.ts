import { describe, expect, it } from 'vitest';
import type { Item, Member, Rag } from '../types';
import { areaOverview, peopleText, statusLines, statusWords } from './areaStatus';

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
  it('counts urgent To dos and things that need work as urgent, whatever their date', () => {
    const view = areaOverview([item('red', '2026-12-20'), item('red', null), state('red'), item('red', '2026-10-01')], MEMBERS);
    expect(view).toMatchObject({ urgent: 4, nonUrgent: 0 });
  });

  it('counts every other open To do as non-urgent, late or not', () => {
    // Within the month and Not urgent; one of them days late.
    const view = areaOverview([item('amber', '2026-10-30'), item('green', '2026-10-01'), item('green', null)], MEMBERS);
    expect(view).toMatchObject({ urgent: 0, nonUrgent: 3 });
  });

  it('leaves out things looked after that are Good or Okay, and anything done', () => {
    const view = areaOverview(
      [state('green'), state('amber'), item('red', '2026-10-01', { status: 'done' }), item('green', null, { status: 'done' })],
      MEMBERS,
    );
    expect(view).toEqual({ urgent: 0, nonUrgent: 0, people: [] });
    expect(areaOverview([], MEMBERS)).toEqual({ urgent: 0, nonUrgent: 0, people: [] });
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
    expect(areaOverview(items, MEMBERS).people.map((m) => m.name)).toEqual(['Shea', 'Ela', 'Stratis']);
    // Someone who has left is left out.
    expect(areaOverview([item('green', null, { assignee_id: 'gone' })], MEMBERS).people).toEqual([]);
  });
});

describe('statusLines', () => {
  it('says how many urgent tasks in red and non-urgent ones in orange, red first', () => {
    expect(statusLines({ urgent: 1, nonUrgent: 0 })).toEqual([{ tone: 'urgent', text: '1 urgent task' }]);
    expect(statusLines({ urgent: 0, nonUrgent: 3 })).toEqual([{ tone: 'non-urgent', text: '3 non-urgent tasks' }]);
    expect(statusLines({ urgent: 2, nonUrgent: 1 })).toEqual([
      { tone: 'urgent', text: '2 urgent tasks' },
      { tone: 'non-urgent', text: '1 non-urgent task' },
    ]);
  });

  it('says All good in green when there are neither', () => {
    expect(statusLines({ urgent: 0, nonUrgent: 0 })).toEqual([{ tone: 'good', text: 'All good' }]);
  });

  it('reads them as one phrase', () => {
    expect(statusWords({ urgent: 2, nonUrgent: 1 })).toBe('2 urgent tasks, 1 non-urgent task');
    expect(statusWords({ urgent: 0, nonUrgent: 12 })).toBe('12 non-urgent tasks');
    expect(statusWords({ urgent: 0, nonUrgent: 0 })).toBe('All good');
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
