import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { monthHeading, weekHeading, weekName, weekTitle, type CalendarView } from '../lib/logic/calendar';
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

/**
 * The week strip or the whole month, remembered on this device under `key` ('month', or
 * nothing for the week). A screen that needs to know which is shown keeps it with this and
 * hands it to its DatePicker (`view`, `onViewChange`).
 */
export function useCalendarView(key: string): [CalendarView, (view: CalendarView) => void] {
  const [view, setView] = useState<CalendarView>(() => readView(key));
  const change = useCallback(
    (next: CalendarView) => {
      writeView(key, next);
      setView(next);
    },
    [key],
  );
  return [view, change];
}

/** Whether `date` is among the days a date picker shows: in the week strip's week, or in the month. */
export function isDayShown(date: ISODate, view: CalendarView, chosen: Pick<ChosenDay, 'week' | 'month'>): boolean {
  return view === 'week' ? weekOf(chosen.week).includes(date) : monthOf(date) === chosen.month;
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
export function scrollParent(el: HTMLElement): HTMLElement | null {
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
 * starts on today again, in this week and month.
 */
export function useChosenDay(
  memory: { current: ChosenDay | null },
  householdId: string,
  today: ISODate,
): { chosen: ChosenDay; update(patch: ChosenPatch<ChosenDay>): void; reset(): void } {
  const fresh = (): ChosenDay => ({ householdId, today, selected: today, month: monthOf(today), week: mondayOf(today) });
  const valid = (c: ChosenDay | null): c is ChosenDay => !!c && c.householdId === householdId && c.today === today;
  const [state, setState] = useState<ChosenDay>(() => (valid(memory.current) ? memory.current : fresh()));
  const chosen = valid(state) ? state : fresh();
  const save = (next: ChosenDay) => {
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
  /**
   * The week strip or the month, when the screen keeps it (useCalendarView() with the same
   * `viewKey`, so the screen knows which days are shown); else the picker keeps it.
   */
  view?: CalendarView;
  onViewChange?(view: CalendarView): void;
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
  /** On the left of the bar while today is chosen and shown (Housekeeping: how today's visit is going). */
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
  /** Under the grid, in the week strip and the month alike (Home: what the marks mean, in words). */
  legend?: ReactNode;
  /**
   * Home's calendar: a visible heading on the bar, relative ("This week", "In 8 weeks",
   * "Next month"), with Today and Show month beside it on the right. The heading is an h2
   * with this id, which names the calendar's section.
   */
  headingId?: string;
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
  view: viewProp,
  onViewChange,
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
  headingId,
}: DatePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLButtonElement>(null);
  const [ownView, setOwnView] = useCalendarView(viewKey);
  const view = viewProp ?? ownView;
  const setView = onViewChange ?? setOwnView;

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
  };

  const todayShown = isDayShown(today, view, chosen);

  return (
    <div ref={rootRef}>
      <div className={styles.bar} data-calendar-bar="" data-headed={headingId ? '' : undefined}>
        {headingId ? (
          <h2 id={headingId} className={styles.heading} data-calendar-heading="">
            {view === 'week' ? weekHeading(chosen.week, today) : monthHeading(chosen.month, today)}
          </h2>
        ) : null}
        {!todayShown || chosen.selected !== today ? (
          <button ref={todayRef} type="button" className={styles.barAction} onClick={goToday}>
            Today
          </button>
        ) : line && !headingId ? (
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
        legend={legend}
      />
    </div>
  );
}
