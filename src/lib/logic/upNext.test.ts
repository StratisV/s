import { describe, expect, it } from 'vitest';
import type { Item, Rag } from '../types';
import { compareByUrgency, homeSummary, needsAttention, relativeDue, relativeUpdated, upNext } from './upNext';

const TODAY = '2026-10-13';

let n = 0;
function item(title: string, rag: Rag, due: string | null, over: Partial<Item> = {}): Item {
  n += 1;
  return {
    id: `i${n}`,
    household_id: 'h',
    area_id: 'a',
    kind: 'task',
    title,
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
    created_at: `2026-10-01T00:00:${String(n).padStart(2, '0')}Z`,
    updated_at: '2026-10-01T00:00:00Z',
    ...over,
  };
}
const state = (title: string, rag: Rag) => item(title, rag, null, { kind: 'state' });
const titles = (items: Item[]) => items.map((i) => i.title);

describe('needsAttention', () => {
  it('is a late or urgent To do, or a To maintain item in fair or poor condition', () => {
    expect(needsAttention(item('late green', 'green', '2026-10-12'), TODAY)).toBe(true);
    expect(needsAttention(item('urgent later', 'red', '2026-12-01'), TODAY)).toBe(true);
    expect(needsAttention(item('urgent, no date', 'red', null), TODAY)).toBe(true);
    expect(needsAttention(item('amber today', 'amber', TODAY), TODAY)).toBe(false);
    expect(needsAttention(state('good', 'green'), TODAY)).toBe(false);
    expect(needsAttention(state('fair', 'amber'), TODAY)).toBe(true);
    expect(needsAttention(state('poor', 'red'), TODAY)).toBe(true);
  });
});

describe('upNext', () => {
  it('groups by when: Needs attention, Today, Next 7 days, Later; good To maintain items apart', () => {
    const view = upNext(
      [
        item('Kitchen paper', 'green', '2026-11-10'),
        item('Heaters', 'green', '2026-10-11'),
        item('Gutters', 'red', '2026-10-19'),
        item('Dehumidifier', 'green', TODAY),
        item('Plants', 'green', '2026-10-15'),
        item('Strips', 'amber', '2026-10-17'),
        item('Day 7', 'green', '2026-10-20'),
        item('Day 8', 'green', '2026-10-21'),
        item('No date', 'amber', null),
        state('Firepit', 'green'),
        state('Shower seal', 'amber'),
        item('Done', 'red', TODAY, { status: 'done' }),
      ],
      TODAY,
    );
    expect(view.groups.map((g) => [g.id, titles(g.items)])).toEqual([
      ['attention', ['Heaters', 'Gutters', 'Shower seal']],
      ['today', ['Dehumidifier']],
      // Urgency first, then the date.
      ['week', ['Strips', 'Plants', 'Day 7']],
      ['later', ['No date', 'Day 8', 'Kitchen paper']],
    ]);
    expect(titles(view.looking)).toEqual(['Firepit']);
    expect(view.counts).toEqual({ attention: 3, today: 1, rest: 6 });
  });

  it('leaves empty groups out', () => {
    expect(upNext([item('Plants', 'green', '2026-10-15')], TODAY).groups.map((g) => g.id)).toEqual(['week']);
    expect(upNext([], TODAY).groups).toEqual([]);
  });

  it('puts late before urgent, then urgency, then date, and To maintain last (as Rooms sorts too)', () => {
    const sorted = [
      state('Seal', 'red'),
      item('Urgent later', 'red', '2026-10-30'),
      item('Amber soon', 'amber', '2026-10-14'),
      item('Late green', 'green', '2026-10-10'),
      item('Urgent soon', 'red', '2026-10-14'),
    ].sort(compareByUrgency(TODAY));
    expect(titles(sorted)).toEqual(['Late green', 'Urgent soon', 'Urgent later', 'Amber soon', 'Seal']);
  });
});

describe('relativeDue', () => {
  it('says when, relative to today, with no arithmetic left to do', () => {
    expect(relativeDue(null, TODAY)).toBeNull();
    expect(relativeDue('2026-10-12', TODAY)).toEqual({ text: '1 day late', late: true });
    expect(relativeDue('2026-10-11', TODAY)).toEqual({ text: '2 days late', late: true });
    expect(relativeDue(TODAY, TODAY)).toEqual({ text: 'Today', late: false });
    expect(relativeDue('2026-10-14', TODAY)!.text).toBe('Tomorrow');
    expect(relativeDue('2026-10-17', TODAY)!.text).toBe('In 4 days');
    expect(relativeDue('2026-10-26', TODAY)!.text).toBe('In 13 days');
    expect(relativeDue('2026-11-04', TODAY)!.text).toBe('In 3 weeks');
    expect(relativeDue('2026-12-13', TODAY)!.text).toBe('In 2 months');
    expect(relativeDue('2027-11-01', TODAY)!.text).toBe('Mon 1 Nov 2027');
  });

  it('says when a To maintain item was last updated', () => {
    expect(relativeUpdated(TODAY, TODAY)).toBe('Updated today');
    expect(relativeUpdated('2026-10-12', TODAY)).toBe('Updated yesterday');
    expect(relativeUpdated('2026-10-10', TODAY)).toBe('Updated 3 days ago');
    expect(relativeUpdated('2026-09-01', TODAY)).toBe('Updated Tue 1 Sep');
  });
});

describe('homeSummary', () => {
  const summary = (items: Item[]) => homeSummary(upNext(items, TODAY), TODAY);
  it('leads with what needs attention and what is due today, then says the rest can wait', () => {
    expect(
      summary([item('a', 'red', TODAY), item('b', 'green', '2026-10-11'), item('c', 'green', TODAY), item('d', 'green', '2026-11-01')]),
    ).toEqual({ lead: '2 things need attention and 1 is due today.', rest: 'Everything else can wait.' });
    expect(summary([item('a', 'red', TODAY)])).toEqual({ lead: '1 thing needs attention.', rest: '' });
    expect(summary([item('c', 'green', TODAY), item('d', 'amber', TODAY)])).toEqual({
      lead: '2 things are due today.',
      rest: 'Nothing urgent or late.',
    });
  });

  it('names what is next when nothing is due today, and says all clear when nothing is open', () => {
    expect(summary([item('Water the plants', 'green', '2026-10-15')])).toEqual({
      lead: 'Nothing urgent today.',
      rest: 'Next up: Water the plants, in 2 days.',
    });
    expect(summary([state('Firepit', 'green')])).toEqual({ lead: 'All clear.', rest: 'Nothing to do right now.' });
  });
});
