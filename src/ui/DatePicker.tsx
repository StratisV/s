import { useEffect, useRef, useState, type ReactNode } from 'react';
import { weekName, weekTitle, type CalendarView } from '../lib/logic/calendar';
import { monthOf, weekOf, type YearMonth } from '../lib/logic/months';
import type { ISODate } from '../lib/types';
import { MonthCalendar, type DayData } from './MonthCalendar';
import styles from './DatePicker.module.css';

function readView(key: string): CalendarView {
  try {
    return localStorage.getItem(key) === 'month' ? 'month' : 'week';
  } catch {
    return 'week';
  }
}

function writeView(key: string, view: CalendarView): void {
  try {
    if (view === 'month') localStorage.setItem(key, 'month');
    else localStorage.removeItem(key);
  } catch {
    /* private mode or storage full: it just isn't remembered */
  }
}

/** The Monday of the week a day is in. */
export const mondayOf = (date: ISODate): ISODate => weekOf(date)[0];

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** The nearest ancestor that scrolls (the tab's scroll area). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === 'auto' || overflowY === 'scroll') return p;
  }
  return null;
}

/**
 * Brings a chosen day's details (`panel`, under its `heading`) up when they are low on the
 * screen: as much of them as fits above the bottom of the scroll area (its bottom padding
 * keeps the floating + clear), or only `room` px under the heading when that is less (a
 * long day, so the calendar stays in sight), without taking the heading up under the docked
 * tab switch (the scroll area's scroll-padding-top). Measured, as `scrollIntoView` with
 * `block: 'nearest'` ignores the room wanted under the heading.
 */
export function revealDay(panel: HTMLElement, heading: HTMLElement, room = Infinity): void {
  const scroller = scrollParent(panel);
  if (!scroller) return;
  const style = getComputedStyle(scroller);
  const box = scroller.getBoundingClientRect();
  const top = box.top + (parseFloat(style.scrollPaddingTop) || 0);
  const bottom = box.bottom - (parseFloat(style.paddingBottom) || 0);
  const head = heading.getBoundingClientRect();
  const below = Math.min(panel.getBoundingClientRect().bottom, head.bottom + room) - bottom;
  const above = head.top - top;
  const delta = Math.min(below, above);
  if (delta > 1) scroller.scrollBy?.({ top: delta, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/** The chosen day, and the week and month shown. */
export interface ChosenDay {
  householdId: string;
  /** The day it was chosen on: once midnight passes, today is chosen again. */
  today: ISODate;
  selected: ISODate;
  /** The month shown (month view). */
  month: YearMonth;
  /** The Monday of the week the strip shows (week view). */
  week: ISODate;
}

/** What a screen may change of its chosen day (the household and the day are its own). */
export type ChosenPatch<C extends ChosenDay> = Partial<Omit<C, 'householdId' | 'today'>>;

/**
 * The chosen day and the week and month shown, kept in `memory` as well, so a screen that
 * comes and goes with its tab finds them as it left them while the app runs. Another
 * household, or a new day since (midnight, or back from the background the next morning),
 * starts on today again, in this week and month. `start` adds a screen's own fields to that
 * fresh start (Home: today not opened yet).
 */
export function useChosenDay<C extends ChosenDay = ChosenDay>(
  memory: { current: C | null },
  householdId: string,
  today: ISODate,
  start?: (fresh: ChosenDay) => C,
): { chosen: C; update(patch: ChosenPatch<C>): void; reset(): void } {
  const fresh = (): C => {
    const day: ChosenDay = { householdId, today, selected: today, month: monthOf(today), week: mondayOf(today) };
    return start ? start(day) : (day as C);
  };
  const valid = (c: C | null): c is C => !!c && c.householdId === householdId && c.today === today;
  const [state, setState] = useState<C>(() => (valid(memory.current) ? memory.current : fresh()));
  const chosen = valid(state) ? state : fresh();
  const save = (next: C) => {
    memory.current = next;
    setState(next);
  };
  return {
    chosen,
    update: (patch) => save({ ...chosen, ...patch }),
    reset: () => save(fresh()),
  };
}

interface DatePickerProps {
  /** Where this device remembers the week strip or the month: 'month', or nothing for the week. */
  viewKey: string;
  /** Today in the household's time zone. */
  today: ISODate;
  /** The chosen day and the week and month shown (useChosenDay()). */
  chosen: ChosenDay;
  /** Previous or Next, a key that moved into another week or month, or Show month / Show week. */
  onChange(patch: ChosenPatch<ChosenDay>): void;
  /** Back to today in this week and month, as at first (Today, or Show week away from the chosen day). */
  onReset(): void;
  /** A day was chosen (tapped, or Enter or Space on it). */
  onSelect(date: ISODate): void;
  /** On the left of the bar while today is chosen and shown (Home: what is due today). */
  line?: ReactNode;
  /** The last day that can be chosen (Housekeeping: today, as visits can't be ahead). */
  lastDay?: ISODate;
  /** A day's accessible name: its full date and what is on it, then ", selected" when `selected`. */
  dayName(date: ISODate, selected: boolean): string;
  /** Under the month's title, in the month (Housekeeping: "4 visits · £180.00"). */
  monthSummary?(month: YearMonth): ReactNode;
  /** A dot in the day's circle (a housekeeping visit, on both tabs). */
  dot?(date: ISODate): boolean;
  /** The number in the alert colour (Home: something missed). */
  alert?(date: ISODate): boolean;
  /** Marks under the day's circle (Home: status dots and repeats). */
  marks?(date: ISODate): ReactNode;
  /** More data attributes on a day's button. */
  dayData?(date: ISODate): DayData;
  /** Under the month's grid, in the month (Home: what the marks mean). */
  legend?: ReactNode;
}

/**
 * The date picker Home and Housekeeping share (docs/ARCHITECTURE.md "Home: the calendar"):
 * a 44px bar, then the calendar card (src/ui/MonthCalendar.tsx) as a week strip or the whole
 * month. On the bar's left, Today whenever today isn't the chosen day or isn't shown, else
 * `line`; on its right, Show month / Show week, remembered on this device under `viewKey`.
 * Show month opens on the month of the chosen day if the strip shows it, else of today if it
 * shows that, else of the week's Monday; Show week opens on the chosen day's week when that
 * day is in the month shown, otherwise on this week with today chosen. Today chosen from the
 * keyboard (or by VoiceOver) puts focus on today's button, as Today itself goes.
 */
export function DatePicker({
  viewKey,
  today,
  chosen,
  onChange,
  onReset,
  onSelect,
  line,
  lastDay,
  dayName,
  monthSummary,
  dot,
  alert,
  marks,
  dayData,
  legend,
}: DatePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<CalendarView>(() => readView(viewKey));

  // Today was pressed from the keyboard (or by VoiceOver): the button goes, so focus goes to today.
  const focusToday = useRef(false);
  useEffect(() => {
    if (!focusToday.current) return;
    focusToday.current = false;
    rootRef.current?.querySelector<HTMLElement>(`[role="grid"] [data-date="${today}"]`)?.focus();
  });

  const goToday = () => {
    focusToday.current = document.activeElement === todayRef.current;
    onReset();
  };

  const toggleView = () => {
    const next: CalendarView = view === 'week' ? 'month' : 'week';
    if (next === 'month') {
      // The month of the chosen day if the strip shows it, else of today, else of the week's Monday.
      const days = weekOf(chosen.week);
      const anchor = days.includes(chosen.selected) ? chosen.selected : days.includes(today) ? today : days[0];
      onChange({ month: monthOf(anchor) });
    } else if (monthOf(chosen.selected) === chosen.month) {
      // The week of the chosen day, when it is in the month shown.
      onChange({ week: mondayOf(chosen.selected) });
    } else {
      // Otherwise this week, today chosen.
      onReset();
    }
    setView(next);
    writeView(viewKey, next);
  };

  const shownDays = view === 'week' ? weekOf(chosen.week) : null;
  const todayShown = shownDays ? shownDays.includes(today) : monthOf(today) === chosen.month;

  return (
    <div ref={rootRef}>
      <div className={styles.bar} data-calendar-bar="">
        {!todayShown || chosen.selected !== today ? (
          <button ref={todayRef} type="button" className={styles.barAction} onClick={goToday}>
            Today
          </button>
        ) : line ? (
          <p className={styles.line} data-today-summary="">
            {line}
          </p>
        ) : null}
        <button
          type="button"
          className={`${styles.barAction} ${styles.toggle}`}
          data-calendar-toggle=""
          onClick={toggleView}
        >
          {view === 'week' ? 'Show month' : 'Show week'}
        </button>
      </div>
      <MonthCalendar
        // A fresh grid for each view: where the keys were in the other one is forgotten.
        key={view}
        month={chosen.month}
        onMonth={(month) => onChange({ month })}
        week={chosen.week}
        onWeek={(week) => onChange({ week })}
        weekTitle={(days) => weekTitle(days, today)}
        selected={chosen.selected}
        onSelect={onSelect}
        today={today}
        view={view}
        lastDay={lastDay}
        dayName={dayName}
        weekName={(monday) => weekName(monday, today)}
        summary={view === 'month' && monthSummary ? monthSummary(chosen.month) : undefined}
        alert={alert}
        dot={dot}
        marks={marks}
        dayData={dayData}
        legend={view === 'month' ? legend : undefined}
      />
    </div>
  );
}
