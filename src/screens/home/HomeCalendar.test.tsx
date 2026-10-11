import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HousekeepingVisit, HousekeepingVisitTask, ISODate, Item, Member } from '../../lib/types';
import { ConfettiProvider } from '../../ui/Confetti';
import { CALENDAR_VIEW_KEY, HomeCalendar } from './HomeCalendar';
import { COMPLETE_FEEDBACK_MS } from './ItemRow';
import type { PersonFilter } from './personFilter';

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
  return { ...props, rerender: (over: Options = {}) => result.rerender(view(over)), unmount: result.unmount };
}

const section = () => screen.getByRole('region', { name: 'Calendar' });
const grid = () => within(section()).getByRole('grid');
const day = (name: string | RegExp) => within(grid()).getByRole('button', { name });
const panel = () => section().querySelector<HTMLElement>('[data-calendar-day]')!;
const said = () => section().querySelector('[data-announcer]')!.textContent;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Home calendar: the week', () => {
  it('opens on this week, today chosen and ringed, its items under it', () => {
    setup();
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 5 October');
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
    const today = day('Thursday 8 October, today, 1 due, selected');
    expect(today.hasAttribute('data-today')).toBe(true);
    expect(today.closest('[role="gridcell"]')!.getAttribute('aria-selected')).toBe('true');
    expect(today.tabIndex).toBe(0);
    // Column headers name the weekdays; no month title or Previous and Next in the strip.
    expect(within(grid()).getAllByRole('columnheader').map((th) => th.getAttribute('abbr'))).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    expect(within(section()).queryByRole('button', { name: 'Previous month' })).toBeNull();
    expect(within(section()).getByRole('button', { name: 'Show month' })).toBeTruthy();

    expect(within(panel()).getByRole('heading', { level: 3, name: 'Thursday 8 October' })).toBeTruthy();
    expect(within(panel()).getByRole('button', { name: 'Mark Empty the dehumidifier as done' })).toBeTruthy();
  });

  it('marks each day: status dots, missed in red, repeats faint, the visit with a broom', () => {
    setup();
    const tuesday = day('Tuesday 6 October, 1 missed');
    expect(tuesday.hasAttribute('data-alert')).toBe(true);
    expect(tuesday.getAttribute('data-missed')).toBe('1');
    expect(Array.from(tuesday.querySelectorAll('[data-rag]')).map((d) => d.getAttribute('data-rag'))).toEqual(['red']);
    // Wednesday 7 has a visit with nothing recorded: no mark.
    expect(day('Wednesday 7 October').hasAttribute('data-visit')).toBe(false);
    const saturday = day('Saturday 10 October, 1 due');
    expect(saturday.querySelector('[data-rag="green"]:not([data-repeat])')).toBeTruthy();
    // The marks are drawn for the eye only: the name says it all.
    expect(saturday.querySelector('[aria-hidden="true"] [data-rag]')).toBeTruthy();
  });

  it('remembers Show month on this device, and the month has its marks and legend', () => {
    const first = setup();
    fireEvent.click(within(section()).getByRole('button', { name: 'Show month' }));
    expect(localStorage.getItem(CALENDAR_VIEW_KEY)).toBe('month');
    expect(document.getElementById(grid().getAttribute('aria-labelledby')!)!.textContent).toBe('October 2026');
    expect(within(section()).getByRole('button', { name: 'Show week' })).toBeTruthy();
    expect(section().querySelector('[data-legend]')!.getAttribute('aria-hidden')).toBe('true');

    // Four things due: three dots, red first, and "+1".
    const busy = day('Wednesday 14 October, 4 due');
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
    // The visit: a broom, and its name says so.
    const oct1 = day('Thursday 1 October, housekeeping visit');
    expect(oct1.querySelector('[data-broom]')).toBeTruthy();
    // To maintain items have no date: never on the calendar.
    expect(within(grid()).queryAllByRole('button', { name: /Firepit/ })).toHaveLength(0);

    first.unmount();
    setup();
    expect(within(section()).getByRole('button', { name: 'Show week' })).toBeTruthy();
    fireEvent.click(within(section()).getByRole('button', { name: 'Show week' }));
    expect(localStorage.getItem(CALENDAR_VIEW_KEY)).toBeNull();
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 5 October');
  });

  it('works without storage (private mode)', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      setup();
      fireEvent.click(within(section()).getByRole('button', { name: 'Show month' }));
      expect(within(section()).getByRole('button', { name: 'Show week' })).toBeTruthy();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

describe('Home calendar: choosing a day', () => {
  it('shows a repeat coming round: labelled, opened but not completed, and says what is there', () => {
    const { onOpenItem } = setup();
    fireEvent.click(within(section()).getByRole('button', { name: 'Show month' }));
    fireEvent.click(day('Thursday 15 October, 1 repeat'));
    expect(said()).toBe('Thursday 15 October: 1 repeat. Details below the calendar.');
    expect(within(panel()).getByRole('heading', { level: 3, name: 'Thursday 15 October' })).toBeTruthy();
    // Repeats can't be marked done: no ring, and they say what they are.
    expect(within(panel()).queryAllByRole('button', { name: /^Mark / })).toHaveLength(0);
    let rows = within(panel()).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('[data-meta]')!.textContent)).toEqual([
      '🦆 Shea · Repeats every week · Due Thu 8 Oct',
    ]);
    // The chosen day says so on its button.
    expect(day('Thursday 15 October, 1 repeat, selected')).toBeTruthy();

    fireEvent.click(day('Wednesday 21 October, 1 repeat'));
    rows = within(panel()).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('[data-meta]')!.textContent)).toEqual([
      '🦔 Stratis · Repeats every week · Due Wed 14 Oct',
    ]);
    const bins = within(panel()).getByRole('button', { name: /^Put the bins out ?, Green, repeat\./ });
    fireEvent.click(bins);
    expect(onOpenItem).toHaveBeenCalledWith('bins');
  });

  it('lists a busy day’s items as Home rows, in Home’s order', () => {
    setup();
    fireEvent.click(within(section()).getByRole('button', { name: 'Show month' }));
    fireEvent.click(day('Wednesday 14 October, 4 due'));
    expect(said()).toBe('Wednesday 14 October: 4 due. Details below the calendar.');
    const rings = within(panel()).getAllByRole('button', { name: /^Mark / });
    expect(rings.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Mark Shower draining slowly as done',
      'Mark Cover the garden furniture as done',
      'Mark Put the bins out as done',
      'Mark Clear the gutters as done',
    ]);
  });

  it('completes an item from the day with its ring, and opens it from its row', () => {
    vi.useFakeTimers();
    const { onComplete, onOpenItem } = setup();
    fireEvent.click(day(/^Tuesday 6 October/));
    expect(said()).toBe('Tuesday 6 October: 1 missed. Details below the calendar.');
    const row = within(panel()).getByRole('listitem');
    expect(row.querySelector('[data-meta]')!.textContent).toBe('🦆 Shea · Missed · Tue 6 Oct');
    fireEvent.click(within(row).getAllByRole('button')[1]);
    expect(onOpenItem).toHaveBeenCalledWith('heaters');
    fireEvent.click(within(row).getByRole('button', { name: 'Mark Heaters not working as done' }));
    act(() => {
      vi.advanceTimersByTime(COMPLETE_FEEDBACK_MS);
    });
    expect(onComplete).toHaveBeenCalledWith('heaters');
  });

  it('shows the visit, which opens that day in Housekeeping', () => {
    const { onOpenHousekeeping } = setup();
    fireEvent.click(within(section()).getByRole('button', { name: 'Show month' }));
    fireEvent.click(day(/^Thursday 1 October/));
    expect(said()).toBe('Thursday 1 October: housekeeping visit. Details below the calendar.');
    expect(within(panel()).getByText('Nothing due.')).toBeTruthy();
    const link = within(panel()).getByRole('button', {
      name: 'Housekeeping visit, 6 of 7 done, £60.00. Show in Housekeeping',
    });
    expect(link.textContent).toContain('6 of 7 done · £60.00');
    fireEvent.click(link);
    expect(onOpenHousekeeping).toHaveBeenCalledWith('2026-10-01');
    // Without a price.
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(day(/^Thursday 24 September/));
    expect(within(panel()).getByRole('button', { name: 'Housekeeping visit, 7 of 7 done. Show in Housekeeping' })).toBeTruthy();
  });

  it('says plainly when nothing is due, for whoever is shown', () => {
    const { rerender } = setup({ items: [] });
    expect(within(panel()).getByText('Nothing due today.')).toBeTruthy();
    expect(said()).toBe('');
    fireEvent.click(day(/^Friday 9 October/));
    expect(within(panel()).getByText('Nothing due.')).toBeTruthy();
    expect(said()).toBe('Friday 9 October: nothing due. Details below the calendar.');
    rerender({ items: [], who: 'm-shea' });
    expect(within(panel()).getByText('Nothing due for Shea.')).toBeTruthy();
    fireEvent.click(day(/^Thursday 8 October/));
    expect(within(panel()).getByText('Nothing due for Shea today.')).toBeTruthy();
    rerender({ items: [], who: 'none' });
    expect(within(panel()).getByText('Nothing unassigned due today.')).toBeTruthy();
  });

  it('brings the day into view when it is low on the screen, without smooth scrolling for Reduce Motion', () => {
    const scrolled: { el: Element; opts: unknown }[] = [];
    const proto = Element.prototype as { scrollIntoView?: unknown };
    const before = proto.scrollIntoView;
    proto.scrollIntoView = function (this: Element, opts: unknown) {
      scrolled.push({ el: this, opts });
    };
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query })) as typeof window.matchMedia;
    try {
      setup();
      const sat = day(/^Saturday 10 October/);
      act(() => sat.focus());
      fireEvent.click(sat);
      expect(scrolled.map((s) => s.el)).toEqual([within(panel()).getByRole('heading', { level: 3 })]);
      expect(scrolled[0].opts).toEqual({ block: 'nearest', behavior: 'auto' });
      // Focus stays on the day.
      expect(document.activeElement).toBe(day(/^Saturday 10 October, 1 due, selected/));
    } finally {
      proto.scrollIntoView = before;
      window.matchMedia = matchMedia;
    }
  });

  it('remembers the chosen day while the app runs, and starts on today again the next day', () => {
    const first = setup({ householdId: 'h-remember' });
    fireEvent.click(day(/^Saturday 10 October/));
    first.unmount();
    setup({ householdId: 'h-remember' });
    expect(within(panel()).getByRole('heading', { level: 3, name: 'Saturday 10 October' })).toBeTruthy();
    cleanup();
    setup({ householdId: 'h-remember', today: '2026-10-09' });
    expect(within(panel()).getByRole('heading', { level: 3, name: 'Friday 9 October' })).toBeTruthy();
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
    expect(within(panel()).getByRole('heading', { level: 3, name: 'Monday 19 October' })).toBeTruthy();
  });

  it('in the month, the future is open: Page Down goes on to next month', () => {
    setup();
    fireEvent.click(within(section()).getByRole('button', { name: 'Show month' }));
    const today = day(/^Thursday 8 October/);
    act(() => today.focus());
    fireEvent.keyDown(today, { key: 'PageDown' });
    expect(document.getElementById(grid().getAttribute('aria-labelledby')!)!.textContent).toBe('November 2026');
    expect(document.activeElement).toBe(day(/^Sunday 8 November/));
    expect((screen.getByRole('button', { name: 'Next month' }) as HTMLButtonElement).disabled).toBe(false);
    // The weekly jobs come round in November too.
    expect(day('Wednesday 4 November, 1 repeat')).toBeTruthy();
    // Changing month keeps the chosen day under the calendar.
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(document.getElementById(grid().getAttribute('aria-labelledby')!)!.textContent).toBe('December 2026');
    expect(within(panel()).getByRole('heading', { level: 3, name: 'Thursday 8 October' })).toBeTruthy();
  });
});
