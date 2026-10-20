import { describe, expect, it } from 'vitest';
import type { Item, Rag } from '../types';
import {
  compareByDate,
  compareByUrgency,
  doneMessage,
  homeSummary,
  needsAttention,
  relativeDue,
  relativeUpdated,
  roomOrder,
  upNext,
} from './upNext';

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
  it('is a late or urgent To do, or a To maintain item that needs work', () => {
    expect(needsAttention(item('late green', 'green', '2026-10-12'), TODAY)).toBe(true);
    expect(needsAttention(item('urgent later', 'red', '2026-12-01'), TODAY)).toBe(true);
    expect(needsAttention(item('urgent, no date', 'red', null), TODAY)).toBe(true);
    expect(needsAttention(item('amber today', 'amber', TODAY), TODAY)).toBe(false);
    expect(needsAttention(state('good', 'green'), TODAY)).toBe(false);
    // Okay is fine for now: it waits at the foot of the list.
    expect(needsAttention(state('okay', 'amber'), TODAY)).toBe(false);
    expect(needsAttention(state('needs work', 'red'), TODAY)).toBe(true);
  });
});

describe('upNext', () => {
  it('lists everything in one order: what needs attention, today, the next 7 days, later, no date, then Okay', () => {
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
        item('No date, not urgent', 'green', null),
        state('Firepit', 'green'),
        state('Shower seal', 'amber'),
        state('Grout', 'red'),
        item('Done', 'red', TODAY, { status: 'done' }),
      ],
      TODAY,
    );
    expect(titles(view.items)).toEqual([
      // Late, then urgent, then what needs work.
      'Heaters',
      'Gutters',
      'Grout',
      // Due today.
      'Dehumidifier',
      // The next 7 days by date ("In 2 days" before "In 4 days").
      'Plants',
      'Strips',
      'Day 7',
      // Later: urgency first, then the date.
      'Day 8',
      'Kitchen paper',
      // No date: urgency first.
      'No date',
      'No date, not urgent',
      // Okay. Good (the firepit) is left out, and so is anything done.
      'Shower seal',
    ]);
    expect(view.counts).toEqual({ attention: 3, today: 1, rest: 7 });
  });

  it('puts the most late first, then the other urgent ones by date, then what needs work', () => {
    const view = upNext(
      [
        state('Boiler', 'red'),
        item('Urgent, no date', 'red', null),
        item('Urgent tomorrow', 'red', '2026-10-14'),
        item('1 day late, urgent', 'red', '2026-10-12'),
        item('5 days late', 'green', '2026-10-08'),
        state('Aerial', 'red'),
        item('Urgent today', 'red', TODAY),
        item('1 day late', 'amber', '2026-10-12'),
      ],
      TODAY,
    );
    expect(titles(view.items)).toEqual([
      '5 days late',
      // Equally late: the most urgent first.
      '1 day late, urgent',
      '1 day late',
      'Urgent today',
      'Urgent tomorrow',
      'Urgent, no date',
      'Aerial',
      'Boiler',
    ]);
    expect(view.counts).toEqual({ attention: 8, today: 0, rest: 0 });
  });

  it('puts the most urgent first among what is due today, and the oldest first when all else ties', () => {
    const view = upNext([item('Green', 'green', TODAY), item('Amber', 'amber', TODAY), item('Green too', 'green', TODAY)], TODAY);
    expect(titles(view.items)).toEqual(['Amber', 'Green', 'Green too']);
    expect(view.counts).toEqual({ attention: 0, today: 3, rest: 0 });
  });

  it('is empty with nothing open, or only things in good shape', () => {
    expect(upNext([], TODAY)).toEqual({ items: [], counts: { attention: 0, today: 0, rest: 0 } });
    expect(upNext([state('Firepit', 'green')], TODAY).items).toEqual([]);
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

  it('lists a room as Rooms and Share Room do: open To dos most urgent first, then what it looks after, by name', () => {
    const done = item('Done', 'red', '2026-10-14', { status: 'done' });
    const room = roomOrder(
      [state('Seal', 'green'), item('Amber soon', 'amber', '2026-10-14'), done, state('Boiler', 'red'), item('Late green', 'green', '2026-10-10')],
      TODAY,
    );
    expect(titles(room)).toEqual(['Late green', 'Amber soon', 'Boiler', 'Seal']);
  });

  it('can sort the date first instead, then urgency (the next 7 days)', () => {
    const sorted = [
      state('Seal', 'red'),
      item('Green in 2', 'green', '2026-10-15'),
      item('Red in 6', 'red', '2026-10-19'),
      item('Amber in 2', 'amber', '2026-10-15'),
      item('Late', 'green', '2026-10-11'),
    ].sort(compareByDate(TODAY));
    expect(titles(sorted)).toEqual(['Late', 'Amber in 2', 'Green in 2', 'Red in 6', 'Seal']);
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

  it('says when a repeating job comes round again, once ticked off, in the same words', () => {
    expect(doneMessage(null, TODAY)).toBe('Marked as done');
    expect(doneMessage('2026-10-14', TODAY)).toBe('Done. Next one tomorrow');
    expect(doneMessage('2026-10-20', TODAY)).toBe('Done. Next one in 7 days');
    expect(doneMessage('2026-12-08', TODAY)).toBe('Done. Next one in 8 weeks');
    expect(doneMessage('2027-01-13', TODAY)).toBe('Done. Next one in 3 months');
    expect(doneMessage('2027-10-13', TODAY)).toBe('Done. Next one on Wed 13 Oct 2027');
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
    expect(summary([item('Find a plumber', 'amber', null)])).toEqual({
      lead: 'Nothing urgent today.',
      rest: 'Next up: Find a plumber.',
    });
    expect(summary([state('Firepit', 'green')])).toEqual({ lead: 'All clear.', rest: 'Nothing to do right now.' });
    // Something looked after that is Okay is listed, but is nothing to do.
    expect(summary([state('Shower seal', 'amber')])).toEqual({ lead: 'All clear.', rest: 'Nothing to do right now.' });
  });

  it('names the soonest thing next, even when the list puts a more urgent one first', () => {
    // Both later than a week: the list puts amber before green; the green one comes round first.
    expect(summary([item('Paint the shed', 'amber', '2026-12-12'), item('Oil the hinges', 'green', '2026-10-22')])).toEqual({
      lead: 'Nothing urgent today.',
      rest: 'Next up: Oil the hinges, in 9 days.',
    });
  });

  it('says whose items they are while the person filter narrows Home', () => {
    const view = upNext([item('a', 'red', TODAY), item('c', 'green', TODAY)], TODAY);
    expect(homeSummary(view, TODAY, { kind: 'me' }).lead).toBe('For you, 1 thing needs attention and 1 is due today.');
    expect(homeSummary(view, TODAY, { kind: 'person', name: 'Shea' }).lead).toBe(
      'For Shea, 1 thing needs attention and 1 is due today.',
    );
    expect(homeSummary(view, TODAY, { kind: 'none' }).lead).toBe('Unassigned: 1 thing needs attention and 1 is due today.');
    const calm = upNext([item('Water the plants', 'green', '2026-10-15')], TODAY);
    expect(homeSummary(calm, TODAY, { kind: 'person', name: 'Ela' })).toEqual({
      lead: 'For Ela, nothing urgent today.',
      rest: 'Next up: Water the plants, in 2 days.',
    });
    const empty = upNext([], TODAY);
    expect(homeSummary(empty, TODAY, { kind: 'me' }).lead).toBe('All clear for you.');
    expect(homeSummary(empty, TODAY, { kind: 'person', name: 'Shea' }).lead).toBe('All clear for Shea.');
    expect(homeSummary(empty, TODAY, { kind: 'none' }).lead).toBe('Nothing unassigned to do.');
  });
});
