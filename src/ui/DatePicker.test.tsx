import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ISODate } from '../lib/types';
import { DatePicker, isDayShown, mondayOf, useCalendarView, useChosenDay, type ChosenDay } from './DatePicker';

/** Thu 8 Oct 2026, the e2e clock's day. */
const TODAY = '2026-10-08';
const VIEW_KEY = 'homeos.test.calendar';

interface HarnessProps {
  memory: { current: ChosenDay | null };
  householdId?: string;
  today?: ISODate;
  lastDay?: ISODate;
}

/** A screen with the picker, as Home and Housekeeping use it: choosing a day shows its week. */
function Harness({ memory, householdId = 'h1', today = TODAY, lastDay }: HarnessProps) {
  const { chosen, update, reset } = useChosenDay(memory, householdId, today);
  return (
    <>
      <DatePicker
        viewKey={VIEW_KEY}
        today={today}
        chosen={chosen}
        onChange={update}
        onReset={reset}
        onSelect={(date) => update({ selected: date, week: mondayOf(date) })}
        line="All quiet today"
        lastDay={lastDay}
        dayName={(date, selected) => (selected ? `${date}, selected` : date)}
        monthSummary={(month) => `Totals for ${month}`}
        legend={<p>What the marks mean</p>}
      />
      <output data-chosen="">{chosen.selected}</output>
    </>
  );
}

const grid = () => screen.getByRole('grid');
const day = (date: ISODate) => grid().querySelector<HTMLButtonElement>(`[data-date="${date}"]`)!;
const button = (name: string) => screen.getByRole('button', { name });
const line = () => document.querySelector('[data-today-summary]')?.textContent ?? null;
const chosen = () => document.querySelector('[data-chosen]')!.textContent;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('DatePicker', () => {
  it('opens on this week with today chosen and the line beside it; Today comes back, with focus on today', () => {
    render(<Harness memory={{ current: null }} />);
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 5 October');
    expect(screen.getByText('5 to 11 October')).toBeTruthy();
    expect(day(TODAY).hasAttribute('data-today')).toBe(true);
    expect(day(TODAY).getAttribute('aria-label')).toBe(`${TODAY}, selected`);
    expect(line()).toBe('All quiet today');
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();

    // Another day: Today in place of the line.
    fireEvent.click(day('2026-10-06'));
    expect(chosen()).toBe('2026-10-06');
    expect(line()).toBeNull();
    fireEvent.click(button('Next week'));
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 12 October');
    // The chosen day stays chosen when the week changes.
    expect(chosen()).toBe('2026-10-06');

    const today = button('Today');
    act(() => today.focus());
    fireEvent.click(today);
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 5 October');
    expect(chosen()).toBe(TODAY);
    expect(line()).toBe('All quiet today');
    expect(document.activeElement).toBe(day(TODAY));
  });

  it('Show month and Show week: kept on this device under its key; the summary is the month’s, the legend under both', () => {
    render(<Harness memory={{ current: null }} />);
    expect(screen.queryByText('Totals for 2026-10')).toBeNull();
    expect(screen.getByText('What the marks mean')).toBeTruthy();
    fireEvent.click(button('Show month'));
    expect(localStorage.getItem(VIEW_KEY)).toBe('month');
    expect(document.getElementById(grid().getAttribute('aria-labelledby')!)!.textContent).toBe('October 2026');
    expect(screen.getByText('Totals for 2026-10')).toBeTruthy();
    expect(screen.getByText('What the marks mean')).toBeTruthy();

    // A day in the month, then Show week: that day's week.
    fireEvent.click(day('2026-10-27'));
    fireEvent.click(button('Show week'));
    expect(localStorage.getItem(VIEW_KEY)).toBeNull();
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 26 October');
    expect(screen.getByText('What the marks mean')).toBeTruthy();

    // Kept: opened again in the month.
    fireEvent.click(button('Show month'));
    cleanup();
    render(<Harness memory={{ current: null }} />);
    expect(button('Show week')).toBeTruthy();
  });

  it('a screen can keep the view itself (useCalendarView), and tell which days are shown', () => {
    function Kept() {
      const memory = useRef<ChosenDay | null>(null);
      const { chosen, update, reset } = useChosenDay(memory, 'h1', TODAY);
      const [view, setView] = useCalendarView(VIEW_KEY);
      return (
        <>
          <DatePicker
            viewKey={VIEW_KEY}
            view={view}
            onViewChange={setView}
            today={TODAY}
            chosen={chosen}
            onChange={update}
            onReset={reset}
            onSelect={(date) => update({ selected: date, week: mondayOf(date) })}
            dayName={(date) => date}
          />
          <output data-shown="">{String(isDayShown(chosen.selected, view, chosen))}</output>
        </>
      );
    }
    render(<Kept />);
    const shown = () => document.querySelector('[data-shown]')!.textContent;
    expect(shown()).toBe('true');
    fireEvent.click(button('Next week'));
    expect(shown()).toBe('false');
    fireEvent.click(button('Show month'));
    expect(localStorage.getItem(VIEW_KEY)).toBe('month');
    // The month of the week's Monday (12 October): today is in it.
    expect(shown()).toBe('true');
    fireEvent.click(button('Next month'));
    expect(shown()).toBe('false');
  });

  it('lastDay: the days after it can’t be chosen, and Next stops at its week', () => {
    render(<Harness memory={{ current: null }} lastDay={TODAY} />);
    expect(day('2026-10-09').disabled).toBe(true);
    expect(day(TODAY).disabled).toBe(false);
    expect(button('Next week').hasAttribute('disabled')).toBe(true);
    fireEvent.click(button('Previous week'));
    expect(within(grid()).getAllByRole('button').every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    expect(button('Next week').hasAttribute('disabled')).toBe(false);
  });
});

describe('useChosenDay', () => {
  it('keeps the chosen day while the app runs, per household; a new day starts on today', () => {
    const memory: { current: ChosenDay | null } = { current: null };
    const first = render(<Harness memory={memory} />);
    fireEvent.click(button('Previous week'));
    fireEvent.click(day('2026-09-30'));
    first.unmount();

    // Back to the tab: as it was left.
    render(<Harness memory={memory} />);
    expect(chosen()).toBe('2026-09-30');
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 28 September');
    cleanup();

    // Another household: today.
    render(<Harness memory={memory} householdId="h2" />);
    expect(chosen()).toBe(TODAY);
    cleanup();

    // The next morning: the new today, in its week.
    render(<Harness memory={memory} today="2026-10-12" />);
    expect(chosen()).toBe('2026-10-12');
    expect(grid().getAttribute('aria-label')).toBe('Week of Monday 12 October');
  });
});
