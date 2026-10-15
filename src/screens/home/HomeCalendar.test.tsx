import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HousekeepingVisit, HousekeepingVisitTask, ISODate, Item, Member } from '../../lib/types';
import { ConfettiProvider } from '../../ui/Confetti';
import { CALENDAR_VIEW_KEY, HomeCalendar } from './HomeCalendar';
import { COMPLETE_FEEDBACK_MS, LEAVE_MS } from './ItemRow';
import type { PersonFilter } from './personFilter';
import { RevealContext } from './reveal';

/** Thu 8 Oct 2026, the e2e clock's day. */
const TODAY = '2026-10-08';

function member(id: string, name: string, emoji: string): Member {
  return {
    id,
    household_id: 'h1',
    user_id: `u-${id}`,
    name,
    email: '',
    emoji,
    color: '#007AFF',
    role: 'member',
    weekly_email: true,
    push_enabled: false,
    created_at: '2026-01-01T00:00:00Z',
  };
}

const MEMBERS = [member('m-stratis', 'Stratis', '🦔'), member('m-shea', 'Shea', '🦆'), member('m-ela', 'Ela', '🦊')];

function item(over: Partial<Item> & Pick<Item, 'id' | 'title'>): Item {
  return {
    household_id: 'h1',
    area_id: 'a1',
    kind: 'task',
    note: '',
    good: '',
    rag: 'amber',
    due_date: '2026-10-16',
    assignee_id: null,
    repeat: 'none',
    notify: 'day_before',
    status: 'open',
    created_by: null,
    updated_by: null,
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
    ...over,
  };
}

function visit(date: ISODate, done: number, price: number | null): HousekeepingVisit {
  const id = `v-${date}`;
  const tasks: HousekeepingVisitTask[] = Array.from({ length: 7 }, (_, i) => ({
    id: `${id}-${i}`,
    visit_id: id,
    household_id: 'h1',
    task_id: `t${i}`,
    title: `Task ${i}`,
    section_id: null,
    section_title: '',
    position: i,
    done: i < done,
    done_by: i < done ? 'm-ela' : null,
    done_at: i < done ? `${date}T09:05:00Z` : null,
  }));
  return {
    id,
    household_id: 'h1',
    visit_date: date,
    note: '',
    comments: '',
    price_pence: price,
    created_by: 'm-ela',
    created_at: `${date}T09:05:00Z`,
    updated_by: 'm-ela',
    updated_at: `${date}T09:05:00Z`,
    tasks,
  };
}

const HEATERS = item({ id: 'heaters', title: 'Heaters not working', rag: 'red', due_date: '2026-10-06', assignee_id: 'm-shea' });
const DEHUMIDIFIER = item({ id: 'dehum', title: 'Empty the dehumidifier', due_date: TODAY, repeat: 'weekly', assignee_id: 'm-shea' });
const PLANTS = item({ id: 'plants', title: 'Water the plants', rag: 'green', due_date: '2026-10-10', repeat: 'weekly', assignee_id: 'm-ela' });
const BUSY = [
  item({ id: 'shower', title: 'Shower draining slowly', due_date: '2026-10-14', assignee_id: 'm-shea' }),
  item({ id: 'cover', title: 'Cover the garden furniture', rag: 'red', due_date: '2026-10-14', assignee_id: 'm-shea' }),
  item({ id: 'bins', title: 'Put the bins out', rag: 'green', due_date: '2026-10-14', repeat: 'weekly', assignee_id: 'm-stratis' }),
  item({ id: 'gutters', title: 'Clear the gutters', due_date: '2026-10-14', repeat: 'biannual' }),
];
const FIREPIT = item({ id: 'firepit', title: 'Firepit', kind: 'state', due_date: null, rag: 'green' });
const ITEMS = [HEATERS, DEHUMIDIFIER, PLANTS, ...BUSY, FIREPIT];
const VISITS = [visit('2026-10-01', 6, 6000), visit('2026-09-24', 7, null), visit('2026-10-07', 0, null)];

let household = 0;

interface Options {
  items?: Item[];
  who?: PersonFilter;
  today?: ISODate;
  householdId?: string;
}

function setup({ items = ITEMS, who = 'all', today = TODAY, householdId }: Options = {}) {
  const props = {
    householdId: householdId ?? `h-${(household += 1)}`,
    visits: VISITS,
    members: MEMBERS,
    timeZone: 'Europe/London',
    roomOf: () => 'Kitchen',
    onOpenItem: vi.fn(),
    onComplete: vi.fn(() => Promise.resolve()),
    onOpenHousekeeping: vi.fn(),
  };
  const view = (over: Options = {}) => (
    <ConfettiProvider>
      <HomeCalendar
        {...props}
        items={over.items ?? items}
        who={over.who ?? who}
        today={over.today ?? today}
        householdId={over.householdId ?? props.householdId}
      />
    </ConfettiProvider>
  );
  const result = render(view());
  return {
    ...props,
    container: result.container,
    rerender: (over: Options = {}) => result.rerender(view(over)),
    unmount: result.unmount,
  };
}

const section = () => document.querySelector<HTMLElement>('[data-calendar]')!;
/** The calendar's heading over the strip or the month ("This week", "Next week", "This month"). */
const heading = () => section().querySelector('[data-calendar-heading]')!.textContent;
const grid = () => within(section()).getByRole('grid');
const day = (name: string | RegExp) => within(grid()).getByRole('button', { name });
const panel = () => section().querySelector<HTMLElement>('[data-calendar-day]');
const summary = () => section().querySelector('[data-today-summary]')?.textContent ?? null;
const said = () => section().querySelector('[data-announcer]')!.textContent;
const control = (name: string) => within(section()).getByRole('button', { name });
const title = () => section().querySelector('[aria-live="polite"]')!.textContent;

/** jsdom has no :focus-visible: from the keyboard, focus would show. */
function keyboardFocus() {
  const matches = Element.prototype.matches;
  return vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
    return selector === ':focus-visible' ? this === document.activeElement : matches.call(this, selector);
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Home calendar: the week', () => {
  it('opens on this week, today chosen and ringed, and today’s list open under it', () => {
    setup();
    // A section named by its heading, which says which week it is.
    expect(heading()).toBe('This week');
    expect(screen.getByRole('region', { name: 'This week' })).toBe(section());
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 5 October');
    expect(title()).toBe('5 to 11 October');
    const days = within(grid()).getAllByRole('button');
    expect(days.map((b) => b.getAttribute('data-date'))).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ]);
    // Its name says how urgent its dot is, in words.
    const today = day('Thursday 8 October, today, 1 due (within the month), selected');
    expect(today.hasAttribute('data-today')).toBe(true);
    expect(today.closest('[role="gridcell"]')!.getAttribute('aria-selected')).toBe('true');
    expect(today.tabIndex).toBe(0);
    // Column headers name the weekdays; Previous week and Next week, no month controls.
    expect(within(grid()).getAllByRole('columnheader').map((th) => th.getAttribute('abbr'))).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    expect(control('Previous week')).toBeTruthy();
    expect(control('Next week')).toBeTruthy();
    expect(within(section()).queryByRole('button', { name: 'Previous month' })).toBeNull();
    expect(control('Show month')).toBeTruthy();
    // Today is shown and chosen: no Today button.
    expect(within(section()).queryByRole('button', { name: 'Today' })).toBeNull();

    // The calendar is a view of its own: today's list is open at once, with no line in its place.
    expect(summary()).toBeNull();
    expect(within(panel()!).getByRole('heading', { level: 3, name: 'Thursday 8 October' })).toBeTruthy();
    // What is late comes first, saying how late, with "1 late" beside the heading (only on its
    // own day, it left today reading "Nothing due"); then today's own rows, under "Due today".
    expect(panel()!.querySelector('[data-late-count]')!.textContent).toBe('1 late');
    expect(Array.from(panel()!.querySelectorAll('p'), (p) => p.textContent)).toEqual(['Due today']);
    expect(within(panel()!).getAllByRole('button', { name: /^Mark .* as done$/ }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Mark Heaters not working as done',
      'Mark Empty the dehumidifier as done',
    ]);
    // A row due that day leaves its date out (the heading says it), and says its urgency and room.
    expect(Array.from(panel()!.querySelectorAll('[data-meta]'), (m) => m.textContent)).toEqual([
      'Urgent2 days late·Kitchen',
      'Within the month·Kitchen',
    ]);
    expect(panel()!.querySelector('[data-who]')!.textContent).toBe('🦆Shea');
    fireEvent.click(today);
    expect(within(panel()!).getByRole('heading', { level: 3, name: 'Thursday 8 October' })).toBeTruthy();
    expect(said()).toBe('Thursday 8 October, today: 1 late (urgent), 1 due (within the month). Details below the calendar.');
  });

  it('today lists what is late even with nothing of its own, and no other day does', () => {
    setup({ items: [HEATERS, PLANTS], who: 'm-shea' });
    expect(within(panel()!).getByRole('button', { name: 'Mark Heaters not working as done' })).toBeTruthy();
    // Nothing due today, said under the late job rather than in place of it.
    expect(panel()!.querySelector('[data-late-count]')!.textContent).toBe('1 late');
    expect(Array.from(panel()!.querySelectorAll('p'), (p) => p.textContent)).toEqual(['Nothing due for Shea today.']);
    // Another day lists only its own: the late job is on its own day there.
    fireEvent.click(day(/^Friday 9 October/));
    expect(within(panel()!).queryByRole('button', { name: 'Mark Heaters not working as done' })).toBeNull();
    expect(panel()!.querySelector('[data-late-count]')).toBeNull();
    fireEvent.click(day(/^Tuesday 6 October/));
    expect(within(panel()!).getByRole('button', { name: 'Mark Heaters not working as done' })).toBeTruthy();
    expect(panel()!.querySelector('[data-late-count]')).toBeNull();
  });

  it('marks each day: status dots, missed in red, repeats faint, the visit with the dot Housekeeping uses', () => {
    setup();
    const tuesday = day('Tuesday 6 October, 1 missed (urgent)');
    expect(tuesday.hasAttribute('data-alert')).toBe(true);
    expect(tuesday.getAttribute('data-missed')).toBe('1');
    expect(Array.from(tuesday.querySelectorAll('[data-rag]')).map((d) => d.getAttribute('data-rag'))).toEqual(['red']);
    // Wednesday 7 has a visit with nothing recorded: no mark.
    expect(day('Wednesday 7 October').hasAttribute('data-visit')).toBe(false);
    expect(day('Wednesday 7 October').hasAttribute('data-dot')).toBe(false);
    const saturday = day('Saturday 10 October, 1 due (not urgent)');
    expect(saturday.querySelector('[data-rag="green"]:not([data-repeat])')).toBeTruthy();
    // The marks are drawn for the eye only: the name says it all.
    expect(saturday.querySelector('[aria-hidden="true"] [data-rag]')).toBeTruthy();
    // Their colours from the theme (no inline colour), so dark mode has its own.
    expect(saturday.querySelector<HTMLElement>('[data-rag]')!.getAttribute('style')).toBeNull();
  });

  it('says what the marks mean in words, under the week strip as under the month', () => {
    setup();
    const legend = () => section().querySelector<HTMLElement>('[data-legend]')!;
    const words = 'UrgentWithin the monthNot urgentRepeatHousekeepingRed date: missed';
    expect(legend().textContent).toBe(words);
    // Each day's name says it for VoiceOver: the legend is for the eye.
    expect(legend().getAttribute('aria-hidden')).toBe('true');
    expect(Array.from(legend().querySelectorAll('[data-rag]'), (d) => d.getAttribute('data-rag'))).toEqual([
      'red',
      'amber',
      'green',
      'amber',
    ]);
    fireEvent.click(control('Show month'));
    expect(legend().textContent).toBe(words);
  });

  it('Previous week and Next week move the strip; Today comes back to this week', () => {
    setup();
    act(() => control('Next week').focus());
    fireEvent.click(control('Next week'));
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 12 October');
    expect(title()).toBe('12 to 18 October');
    expect(heading()).toBe('Next week');
    expect(within(grid()).queryAllByRole('button', { name: /today/ })).toHaveLength(0);
    // Today is chosen but not shown: its list would read as part of next week, so one quiet
    // line asks for a day instead, and Today brings it back.
    expect(panel()).toBeNull();
    expect(section().querySelector('[data-calendar-pick]')!.textContent).toBe('Pick a day to see what is due.');
    fireEvent.click(control('Previous week'));
    expect(within(panel()!).getByRole('heading', { level: 3, name: 'Thursday 8 October' })).toBeTruthy();
    fireEvent.click(control('Previous week'));
    expect(title()).toBe('28 Sep to 4 Oct');
    expect(heading()).toBe('Last week');
    fireEvent.click(control('Previous week'));
    // Further away: how many weeks.
    expect(heading()).toBe('2 weeks ago');
    const back = control('Today');
    act(() => back.focus());
    fireEvent.click(back);
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 5 October');
    expect(heading()).toBe('This week');
    expect(within(section()).queryByRole('button', { name: 'Today' })).toBeNull();
    // The button went, so focus is on today.
    expect(document.activeElement).toBe(day(/^Thursday 8 October, today/));

    // Another day chosen in this week: Today chooses today again.
    fireEvent.click(day(/^Saturday 10 October/));
    expect(within(panel()!).getByRole('heading', { level: 3, name: 'Saturday 10 October' })).toBeTruthy();
    fireEvent.click(control('Today'));
    expect(within(panel()!).getByRole('heading', { level: 3, name: 'Thursday 8 October' })).toBeTruthy();
    expect(day(/^Thursday 8 October, today, 1 due \(within the month\), selected/)).toBeTruthy();
  });

  it('a new day after midnight shows its own week, with today chosen and in the tab order, even after a tap', () => {
    const { rerender } = setup({ householdId: 'h-midnight' });
    fireEvent.click(day(/^Sunday 11 October/));
    rerender({ today: '2026-10-12' });
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 12 October');
    const monday = day('Monday 12 October, today, selected');
    expect(monday.hasAttribute('data-today')).toBe(true);
    expect(monday.tabIndex).toBe(0);
    expect(within(panel()!).getByRole('heading', { level: 3, name: 'Monday 12 October' })).toBeTruthy();
    expect(within(panel()!).getByText('Nothing due today.')).toBeTruthy();
  });

  it('a new day forgets the day tapped in the month too: today is the one in the tab order', () => {
    const { rerender } = setup({ householdId: 'h-midnight-month' });
    fireEvent.click(control('Show month'));
    fireEvent.click(day(/^Wednesday 28 October/));
    expect(day(/^Wednesday 28 October/).tabIndex).toBe(0);
    rerender({ today: '2026-10-29' });
    expect(day(/^Thursday 29 October, today/).tabIndex).toBe(0);
    expect(day(/^Wednesday 28 October/).tabIndex).toBe(-1);
  });

  it('remembers Show month on this device, and the month has its marks and legend', () => {
    const first = setup();
    fireEvent.click(control('Show month'));
    expect(localStorage.getItem(CALENDAR_VIEW_KEY)).toBe('month');
    expect(heading()).toBe('This month');
    expect(document.getElementById(grid().getAttribute('aria-labelledby')!)!.textContent).toBe('October 2026');
    expect(control('Show week')).toBeTruthy();
    expect(section().querySelector('[data-legend]')!.getAttribute('aria-hidden')).toBe('true');

    // Four things due: three dots, red first, and "+1"; how urgent each is, in words.
    const busy = day('Wednesday 14 October, 4 due (1 urgent, 2 within the month, 1 not urgent)');
    expect(Array.from(busy.querySelectorAll('[data-rag]')).map((d) => d.getAttribute('data-rag'))).toEqual([
      'red',
      'amber',
      'amber',
    ]);
    expect(busy.textContent).toContain('+1');
    // The weekly ones come round again, faint; the plants' Saturday repeats too.
    const wed21 = day('Wednesday 21 October, 1 repeat');
    expect(wed21.querySelector('[data-repeat][data-rag="green"]')).toBeTruthy();
    expect(day('Saturday 17 October, 1 repeat').getAttribute('data-repeats')).toBe('1');
    expect(day('Thursday 15 October, 1 repeat')).toBeTruthy();
    // The visit: the dot Housekeeping's calendar uses, and its name says so.
    const oct1 = day('Thursday 1 October, housekeeping visit');
    expect(oct1.hasAttribute('data-dot')).toBe(true);
    expect(oct1.getAttribute('data-visit')).toBe('true');
    // To maintain items have no date: never on the calendar.
    expect(within(grid()).queryAllByRole('button', { name: /Firepit/ })).toHaveLength(0);

    first.unmount();
    setup();
    expect(control('Show week')).toBeTruthy();
    fireEvent.click(control('Show week'));
    expect(localStorage.getItem(CALENDAR_VIEW_KEY)).toBeNull();
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 5 October');
  });

  it('Show week opens on the chosen day’s week when it is in the month shown, else on this week with today chosen', () => {
    setup();
    fireEvent.click(control('Show month'));
    fireEvent.click(control('Next month'));
    fireEvent.click(control('Next month'));
    fireEvent.click(day(/^Thursday 3 December/));
    fireEvent.click(control('Show week'));
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 30 November');
    expect(title()).toBe('30 Nov to 6 Dec');
    expect(day(/^Thursday 3 December, .*selected/)).toBeTruthy();
    // Back with taps only: Today.
    fireEvent.click(control('Today'));
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 5 October');

    // The chosen day isn't in the month shown: this week, today chosen.
    fireEvent.click(day(/^Saturday 10 October/));
    fireEvent.click(control('Show month'));
    fireEvent.click(control('Next month'));
    fireEvent.click(control('Show week'));
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 5 October');
    expect(day(/^Thursday 8 October, today, 1 due \(within the month\), selected/)).toBeTruthy();
    expect(within(panel()!).getByRole('heading', { level: 3, name: 'Thursday 8 October' })).toBeTruthy();
  });

  it('works without storage (private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    setup();
    fireEvent.click(control('Show month'));
    expect(control('Show week')).toBeTruthy();
  });
});

describe('Home calendar: choosing a day', () => {
  it('shows a repeat coming round: labelled, opened but not completed, and says what is there', () => {
    const { onOpenItem } = setup();
    fireEvent.click(control('Show month'));
    fireEvent.click(day('Thursday 15 October, 1 repeat'));
    expect(said()).toBe('Thursday 15 October: 1 repeat. Details below the calendar.');
    expect(within(panel()!).getByRole('heading', { level: 3, name: 'Thursday 15 October' })).toBeTruthy();
    // Repeats can't be marked done: no ring, and they say what they are.
    expect(within(panel()!).queryAllByRole('button', { name: /^Mark / })).toHaveLength(0);
    let rows = within(panel()!).getAllByRole('listitem');
    // How urgent in words, as on every row, then which date it repeats, how often, and its room.
    expect(rows.map((r) => r.querySelector('[data-meta]')!.textContent)).toEqual([
      'Within the month·Repeat of Thu 8 Oct·Every week·Kitchen',
    ]);
    expect(rows[0].querySelector('[data-who]')!.textContent).toBe('🦆Shea');
    // The chosen day says so on its button.
    expect(day('Thursday 15 October, 1 repeat, selected')).toBeTruthy();

    fireEvent.click(day('Wednesday 21 October, 1 repeat'));
    rows = within(panel()!).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('[data-meta]')!.textContent)).toEqual([
      'Not urgent·Repeat of Wed 14 Oct·Every week·Kitchen',
    ]);
    const bins = within(panel()!).getByRole('button', { name: /^Put the bins out ?, Not urgent, repeat, Repeat of Wed 14 Oct, Every week, Kitchen, Stratis\.$/ });
    fireEvent.click(bins);
    expect(onOpenItem).toHaveBeenCalledWith('bins');
  });

  it('lists a busy day’s items in the order of its marks: red, then amber, then green', () => {
    setup();
    fireEvent.click(control('Show month'));
    fireEvent.click(day(/^Wednesday 14 October, 4 due/));
    expect(said()).toBe(
      'Wednesday 14 October: 4 due (1 urgent, 2 within the month, 1 not urgent). Details below the calendar.',
    );
    const rings = within(panel()!).getAllByRole('button', { name: /^Mark / });
    expect(rings.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Mark Cover the garden furniture as done',
      'Mark Shower draining slowly as done',
      'Mark Clear the gutters as done',
      'Mark Put the bins out as done',
    ]);
  });

  it('completes an item from the day with its ring, and opens it from its row', () => {
    vi.useFakeTimers();
    const { onComplete, onOpenItem } = setup();
    fireEvent.click(day(/^Tuesday 6 October/));
    expect(said()).toBe('Tuesday 6 October: 1 missed (urgent). Details below the calendar.');
    const row = within(panel()!).getByRole('listitem');
    // A missed row keeps its date, in words: how late it is.
    expect(row.querySelector('[data-meta]')!.textContent).toBe('Urgent2 days late·Kitchen');
    fireEvent.click(within(row).getAllByRole('button')[1]);
    expect(onOpenItem).toHaveBeenCalledWith('heaters');
    fireEvent.click(within(row).getByRole('button', { name: 'Mark Heaters not working as done' }));
    act(() => {
      // The check and the struck-through title, then the row folds away.
      vi.advanceTimersByTime(COMPLETE_FEEDBACK_MS + LEAVE_MS);
    });
    expect(onComplete).toHaveBeenCalledWith('heaters');
  });

  it('completing a weekly item from the keyboard keeps focus in the calendar, as it leaves the day', () => {
    vi.useFakeTimers();
    keyboardFocus();
    // Nothing late, so today's own row is its only one.
    const { onComplete } = setup({ items: ITEMS.filter((it) => it !== HEATERS) });
    fireEvent.click(day(/^Thursday 8 October/));
    const ring = within(panel()!).getByRole('button', { name: 'Mark Empty the dehumidifier as done' });
    act(() => ring.focus());
    fireEvent.click(ring);
    act(() => {
      // The check and the struck-through title, then the row folds away.
      vi.advanceTimersByTime(COMPLETE_FEEDBACK_MS + LEAVE_MS);
    });
    expect(onComplete).toHaveBeenCalledWith('dehum');
    // The only row: focus goes to the chosen day's button, not lost with the row.
    expect(document.activeElement).toBe(day(/^Thursday 8 October, today, 1 due \(within the month\), selected/));
  });

  it('completing a weekly item from the keyboard moves focus to the next row of the day', () => {
    vi.useFakeTimers();
    keyboardFocus();
    setup();
    fireEvent.click(control('Show month'));
    fireEvent.click(day(/^Wednesday 14 October/));
    const ring = within(panel()!).getByRole('button', { name: 'Mark Clear the gutters as done' });
    // The gutters repeat every 6 months: once done they leave the 14th too.
    act(() => ring.focus());
    fireEvent.click(ring);
    act(() => {
      // The check and the struck-through title, then the row folds away.
      vi.advanceTimersByTime(COMPLETE_FEEDBACK_MS + LEAVE_MS);
    });
    expect(document.activeElement).toBe(within(panel()!).getByRole('button', { name: /^Put the bins out ?, Not urgent,/ }));
  });

  it('another week or month than the chosen day’s: one quiet line in place of its list, until a day is tapped', () => {
    setup();
    fireEvent.click(day(/^Tuesday 6 October/));
    fireEvent.click(control('Next week'));
    expect(panel()).toBeNull();
    expect(section().querySelector('[data-calendar-pick]')!.textContent).toBe('Pick a day to see what is due.');
    fireEvent.click(day(/^Wednesday 14 October/));
    expect(within(panel()!).getByRole('heading', { level: 3, name: 'Wednesday 14 October' })).toBeTruthy();
    expect(section().querySelector('[data-calendar-pick]')).toBeNull();
    // The month: the same, a month at a time.
    fireEvent.click(control('Show month'));
    expect(within(panel()!).getByRole('heading', { level: 3, name: 'Wednesday 14 October' })).toBeTruthy();
    fireEvent.click(control('Next month'));
    expect(panel()).toBeNull();
    fireEvent.click(control('Previous month'));
    expect(within(panel()!).getByRole('heading', { level: 3, name: 'Wednesday 14 October' })).toBeTruthy();
  });

  it('goes to the day of an item just saved, so it shows in the list', () => {
    const props = {
      householdId: 'h-reveal',
      items: ITEMS,
      visits: VISITS,
      members: MEMBERS,
      today: TODAY,
      timeZone: 'Europe/London',
      who: 'all' as PersonFilter,
      roomOf: () => 'Kitchen',
      onOpenItem: vi.fn(),
      onComplete: vi.fn(() => Promise.resolve()),
    };
    render(
      <ConfettiProvider>
        <RevealContext.Provider value="gutters">
          <HomeCalendar {...props} />
        </RevealContext.Provider>
      </ConfettiProvider>,
    );
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 12 October');
    expect(within(panel()!).getByRole('heading', { level: 3, name: 'Wednesday 14 October' })).toBeTruthy();
    expect(panel()!.querySelector('[data-item-id="gutters"]')!.hasAttribute('data-lit')).toBe(true);
  });

  it('shows the visit, which opens that day in Housekeeping', () => {
    const { onOpenHousekeeping } = setup();
    fireEvent.click(control('Show month'));
    fireEvent.click(day(/^Thursday 1 October/));
    expect(said()).toBe('Thursday 1 October: housekeeping visit. Details below the calendar.');
    expect(within(panel()!).getByText('Nothing due.')).toBeTruthy();
    const link = within(panel()!).getByRole('button', {
      name: 'Housekeeping visit, 6 of 7 done, £60.00. Show in Housekeeping',
    });
    expect(link.textContent).toContain('6 of 7 done · £60.00');
    fireEvent.click(link);
    expect(onOpenHousekeeping).toHaveBeenCalledWith('2026-10-01');
    // Without a price.
    fireEvent.click(control('Previous month'));
    fireEvent.click(day(/^Thursday 24 September/));
    expect(within(panel()!).getByRole('button', { name: 'Housekeeping visit, 7 of 7 done. Show in Housekeeping' })).toBeTruthy();
  });

  it('says plainly when nothing is due, for whoever is shown', () => {
    const { rerender } = setup({ items: [] });
    expect(within(panel()!).getByText('Nothing due today.')).toBeTruthy();
    expect(said()).toBe('');
    fireEvent.click(day(/^Friday 9 October/));
    expect(within(panel()!).getByText('Nothing due.')).toBeTruthy();
    expect(said()).toBe('Friday 9 October: nothing due. Details below the calendar.');
    rerender({ items: [], who: 'm-shea' });
    expect(within(panel()!).getByText('Nothing due for Shea.')).toBeTruthy();
    fireEvent.click(day(/^Thursday 8 October/));
    expect(within(panel()!).getByText('Nothing due for Shea today.')).toBeTruthy();
    rerender({ items: [], who: 'none' });
    expect(within(panel()!).getByText('Nothing unassigned due today.')).toBeTruthy();
    cleanup();
    setup({ items: [], who: 'm-shea' });
    expect(within(panel()!).getByText('Nothing due for Shea today.')).toBeTruthy();
  });

  it('brings the day up when it is low on the screen, above the + and under the tab switch, without smooth scrolling for Reduce Motion', () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query })) as typeof window.matchMedia;
    const { container } = setup();
    // The tab's scroll area: 700px tall, 104px kept clear at the bottom for the +.
    const scroller = container;
    scroller.style.overflowY = 'auto';
    scroller.style.paddingBottom = '104px';
    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy as typeof scroller.scrollBy;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const box = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 320, width: 320, height: bottom - top, x: 0, y: top, toJSON() {} }) as DOMRect;
      if (this === scroller) return box(0, 700);
      if (this.matches('[data-calendar-day]')) return box(560, 720);
      if (this.matches('[data-calendar-day] h3')) return box(560, 600);
      return box(0, 0);
    });
    const sat = day(/^Saturday 10 October/);
    act(() => sat.focus());
    fireEvent.click(sat);
    // Its bottom (720) comes up to 596, above the +.
    expect(scrollBy).toHaveBeenCalledWith({ top: 124, behavior: 'auto' });
    // Focus stays on the day.
    expect(document.activeElement).toBe(day(/^Saturday 10 October, 1 due \(not urgent\), selected/));
  });

  it('remembers the chosen day while the app runs, and starts on today again the next day', () => {
    const first = setup({ householdId: 'h-remember' });
    fireEvent.click(control('Next week'));
    fireEvent.click(day(/^Saturday 17 October/));
    first.unmount();
    setup({ householdId: 'h-remember' });
    expect(within(panel()!).getByRole('heading', { level: 3, name: 'Saturday 17 October' })).toBeTruthy();
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 12 October');
    expect(control('Today')).toBeTruthy();
    cleanup();
    setup({ householdId: 'h-remember', today: '2026-10-09' });
    expect(within(panel()!).getByRole('heading', { level: 3, name: 'Friday 9 October' })).toBeTruthy();
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 5 October');
    expect(day(/^Friday 9 October, today/).tabIndex).toBe(0);
  });
});

describe('Home calendar: keyboard', () => {
  it('arrow keys move a day or a week, past the strip’s edge into the next week', () => {
    setup();
    const today = day(/^Thursday 8 October/);
    act(() => today.focus());
    fireEvent.keyDown(today, { key: 'End' });
    expect(document.activeElement).toBe(day(/^Sunday 11 October/));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    // The strip follows: next week, and focus on its Monday.
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 12 October');
    expect(document.activeElement).toBe(day(/^Monday 12 October/));
    expect((document.activeElement as HTMLElement).tabIndex).toBe(0);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(day(/^Monday 19 October/));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(day(/^Monday 19 October/));
    // Enter (a click) chooses it.
    fireEvent.click(document.activeElement!);
    expect(within(panel()!).getByRole('heading', { level: 3, name: 'Monday 19 October' })).toBeTruthy();
    // Back a week with the keys too.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 12 October');
    expect(document.activeElement).toBe(day(/^Monday 12 October/));
  });

  it('in the month, the future is open: Page Down goes on to next month', () => {
    setup();
    fireEvent.click(control('Show month'));
    const today = day(/^Thursday 8 October/);
    act(() => today.focus());
    fireEvent.keyDown(today, { key: 'PageDown' });
    expect(document.getElementById(grid().getAttribute('aria-labelledby')!)!.textContent).toBe('November 2026');
    expect(document.activeElement).toBe(day(/^Sunday 8 November/));
    expect((control('Next month') as HTMLButtonElement).disabled).toBe(false);
    // The weekly jobs come round in November too.
    expect(day('Wednesday 4 November, 1 repeat')).toBeTruthy();
    expect(heading()).toBe('Next month');
    // Changing month keeps the chosen day (today), and Today comes back.
    fireEvent.click(control('Next month'));
    expect(document.getElementById(grid().getAttribute('aria-labelledby')!)!.textContent).toBe('December 2026');
    expect(heading()).toBe('In 2 months');
    fireEvent.click(control('Today'));
    expect(document.getElementById(grid().getAttribute('aria-labelledby')!)!.textContent).toBe('October 2026');
    expect(within(panel()!).getByRole('heading', { level: 3, name: 'Thursday 8 October' })).toBeTruthy();
  });
});
