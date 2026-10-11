import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { addDays, addMonths, parseISODate } from '../lib/logic/dates';
import { monthGrid, monthOf, monthTitle, shiftMonth, weekdayIndex, weekOf, WEEKDAYS, type YearMonth } from '../lib/logic/months';
import type { ISODate } from '../lib/types';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import styles from './MonthCalendar.module.css';

/** Data attributes for a day's button (`data-visit` on Housekeeping's visit days). */
export type DayData = Record<`data-${string}`, string | undefined>;

export interface MonthCalendarProps {
  /** The month shown (month view). */
  month: YearMonth;
  /** Previous or Next, Page Up or Down, or a key that moved focus into another month. */
  onMonth(month: YearMonth): void;
  /** The day shown under the calendar, filled with the tint; null for none. */
  selected: ISODate | null;
  onSelect(date: ISODate): void;
  /** Today in the household's time zone: a tint number in a tint ring. */
  today: ISODate;
  /**
   * 'month' (the default): the month's title between Previous and Next, then its weeks.
   * 'week': one row of seven days, with its title (`weekTitle`) between Previous week and
   * Next week; the grid is named by `weekName`.
   */
  view?: 'month' | 'week';
  /**
   * Week view: a day of the week shown (its parent keeps it, and moves it on `onWeek`).
   * Without it, the strip shows the week of the day moved to with the keys, else the
   * selected day, else today.
   */
  week?: ISODate;
  /** Previous week or Next week, or a key that moved focus into another week: its Monday. */
  onWeek?(monday: ISODate): void;
  /** The week strip's visible title, from its seven days (Home: "5 to 11 October"). */
  weekTitle?(days: ISODate[]): string;
  /**
   * The last day that can be chosen (Housekeeping: today, as visits can't be ahead). Later
   * days are dimmed and disabled, the keys stop there and Next stops at its month.
   */
  lastDay?: ISODate;
  /** A day's accessible name: its full date and what is on it, then ", selected" when `selected`. */
  dayName(date: ISODate, selected: boolean): string;
  /** The week grid's accessible name, from its Monday. */
  weekName?(monday: ISODate): string;
  /** Under the month's title (Housekeeping: "4 visits · £180.00"). */
  summary?: ReactNode;
  /** A 5px dot under the number, inside the circle (a housekeeping visit, on both calendars). */
  dot?(date: ISODate): boolean;
  /** The number in the alert colour (Home: a day with something missed). */
  alert?(date: ISODate): boolean;
  /**
   * Marks in a row under the circle (Home: status dots and repeats). Given this, every day's
   * cell is taller, to hold them. Decorative: `dayName` says what they mean.
   */
  marks?(date: ISODate): ReactNode;
  /** More data attributes on a day's button. */
  dayData?(date: ISODate): DayData;
  /** Under the grid, inside the card (Home: what the marks mean). */
  legend?: ReactNode;
}

/**
 * The calendar card Home and Housekeeping share (docs/ARCHITECTURE.md "Housekeeping" UI 4 and
 * "Home: the calendar"): a month with its title between Previous and Next, or one week as
 * a strip with its title between Previous week and Next week. Days are a grid, Monday
 * first. Today has a tint ring, the selected day is filled; a day can carry a dot in its
 * circle and marks under it. Each day's button fills its cell, so a tap anywhere in the cell
 * chooses it; the circle is drawn inside.
 *
 * Assistive tech gets a grid labelled by the month title (or the week's name): column
 * headers name the weekdays, each day button reads `dayName()` (", selected" on the chosen
 * day, as focus is on the button rather than its cell), and one day is in the tab order; the
 * arrow keys move a day or a week, Home and End go to the start and end of the week, Page Up
 * and Page Down change month. Moving past the edge of the month (or the week) goes on into
 * the next one. Focus never lands after `lastDay`.
 */
export function MonthCalendar({
  month,
  onMonth,
  selected,
  onSelect,
  today,
  view = 'month',
  week: weekDay,
  onWeek,
  weekTitle,
  lastDay,
  dayName,
  weekName,
  summary,
  dot,
  alert,
  marks,
  dayData,
  legend,
}: MonthCalendarProps) {
  const titleId = useId();
  const tableRef = useRef<HTMLTableElement>(null);
  // The day the arrow keys last moved to (null: the default below).
  const [focused, setFocused] = useState<ISODate | null>(null);
  const moveFocus = useRef(false);
  // A new day (back from the background after midnight): where the keys were is forgotten,
  // so the default (the selected day, else today) is the one in the tab order again.
  useEffect(() => setFocused(null), [today]);

  const week = view === 'week' ? weekOf(weekDay ?? focused ?? selected ?? today) : null;
  const weeks: (ISODate | null)[][] = week ? [week] : monthGrid(month);
  const shown = (d: ISODate | null): d is ISODate => !!d && (week ? week.includes(d) : monthOf(d) === month);
  const disabled = (d: ISODate) => lastDay !== undefined && d > lastDay;
  // The one day button in the tab order: the one moved to, else the selected day, else
  // today, else the first day shown.
  const tabStop = shown(focused)
    ? focused
    : shown(selected)
      ? selected
      : shown(today)
        ? today
        : (week?.[0] ?? `${month}-01`);

  // After a key moved focus (possibly into another month or week), focus that day's button.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    tableRef.current?.querySelector<HTMLButtonElement>(`[data-date="${tabStop}"]`)?.focus();
  });

  const goTo = (date: ISODate) => {
    // Never onto a day that can't be chosen.
    const target = lastDay !== undefined && date > lastDay ? lastDay : date;
    setFocused(target);
    moveFocus.current = true;
    if (week) {
      if (!week.includes(target)) onWeek?.(weekOf(target)[0]);
    } else if (monthOf(target) !== month) onMonth(monthOf(target));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, date: ISODate) => {
    let next: ISODate;
    switch (e.key) {
      case 'ArrowLeft':
        next = addDays(date, -1);
        break;
      case 'ArrowRight':
        next = addDays(date, 1);
        break;
      case 'ArrowUp':
        next = addDays(date, -7);
        break;
      case 'ArrowDown':
        next = addDays(date, 7);
        break;
      case 'Home':
        next = addDays(date, -weekdayIndex(date));
        break;
      case 'End':
        next = addDays(date, 6 - weekdayIndex(date));
        break;
      case 'PageUp':
        next = addMonths(date, -1);
        break;
      case 'PageDown':
        next = addMonths(date, 1);
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next === date || disabled(next)) {
      // Past the last day: as far as it, if that is a move at all.
      if (lastDay !== undefined && date !== lastDay && next > lastDay) goTo(lastDay);
      return;
    }
    goTo(next);
  };

  // Previous or Next: a month, or in the strip a week.
  const change = (n: number) => {
    if (week) {
      const monday = addDays(week[0], 7 * n);
      // Without `week` from the parent, the strip follows this.
      setFocused(weekDay === undefined ? monday : null);
      onWeek?.(monday);
    } else {
      setFocused(null);
      onMonth(shiftMonth(month, n));
    }
  };

  const atLatest = lastDay !== undefined && (week ? addDays(week[0], 7) > lastDay : month >= monthOf(lastDay));
  const unit = week ? 'week' : 'month';

  return (
    <div className={styles.card} data-view={view} data-marks={marks ? '' : undefined}>
      <div className={styles.top}>
        <button type="button" className={styles.navButton} aria-label={`Previous ${unit}`} onClick={() => change(-1)}>
          <ChevronLeftIcon size={18} strokeWidth={2.6} />
        </button>
        <div className={styles.heading}>
          <div id={titleId} className={styles.title} aria-live="polite">
            {week ? (weekTitle?.(week) ?? weekName?.(week[0]) ?? week[0]) : monthTitle(month)}
          </div>
          {summary !== undefined ? <div className={styles.summary}>{summary}</div> : null}
        </div>
        <button
          type="button"
          className={styles.navButton}
          aria-label={`Next ${unit}`}
          disabled={atLatest}
          onClick={() => change(1)}
        >
          <ChevronRightIcon size={18} strokeWidth={2.6} />
        </button>
      </div>
      <table
        ref={tableRef}
        className={styles.grid}
        role="grid"
        aria-labelledby={week ? undefined : titleId}
        aria-label={week ? (weekName?.(week[0]) ?? `Week of ${week[0]}`) : undefined}
        data-marks={marks ? '' : undefined}
      >
        <thead>
          <tr>
            {WEEKDAYS.map((w) => (
              <th key={w.long} scope="col" abbr={w.long} className={styles.weekday}>
                <span aria-hidden="true">{w.short}</span>
                <span className="visually-hidden">{w.long}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((days, i) => (
            <tr key={days.find(Boolean) ?? i}>
              {days.map((date, j) =>
                date ? (
                  <td key={date} role="gridcell" aria-selected={date === selected} className={styles.cell}>
                    <button
                      type="button"
                      className={styles.day}
                      data-date={date}
                      data-today={date === today || undefined}
                      data-selected={date === selected || undefined}
                      data-dot={dot?.(date) || undefined}
                      data-alert={alert?.(date) || undefined}
                      {...dayData?.(date)}
                      aria-label={dayName(date, date === selected)}
                      tabIndex={date === tabStop ? 0 : -1}
                      disabled={disabled(date)}
                      onClick={() => {
                        setFocused(date);
                        onSelect(date);
                      }}
                      onKeyDown={(e) => onKeyDown(e, date)}
                    >
                      <span className={styles.circle}>{parseISODate(date).d}</span>
                      {marks ? (
                        <span className={styles.marks} aria-hidden="true">
                          {marks(date)}
                        </span>
                      ) : null}
                    </button>
                  </td>
                ) : (
                  <td key={`pad-${j}`} className={styles.cell} />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {legend ?? null}
    </div>
  );
}
