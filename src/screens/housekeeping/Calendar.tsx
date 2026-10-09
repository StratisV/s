import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { addDays, addMonths, parseISODate } from '../../lib/logic/dates';
import {
  calendarDayLabel,
  canHaveVisit,
  monthGrid,
  monthOf,
  monthSummary,
  monthTitle,
  monthTotals,
  shiftMonth,
  visitDays,
  visitOn,
  WEEKDAYS,
  type YearMonth,
} from '../../lib/logic/housekeeping';
import type { HousekeepingVisit, ISODate } from '../../lib/types';
import { ChevronLeftIcon, ChevronRightIcon } from '../../ui/icons';
import styles from './Calendar.module.css';

interface CalendarProps {
  month: YearMonth;
  onMonth(month: YearMonth): void;
  selected: ISODate | null;
  onSelect(date: ISODate): void;
  today: ISODate;
  visits: HousekeepingVisit[];
}

/** 0 = Monday … 6 = Sunday. */
function weekdayIndex(date: ISODate): number {
  const { y, m, d } = parseISODate(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * The month of visits: a card with the month's title between previous and next, the
 * month's total ("4 visits · £180.00"), then the days as a grid, Monday first. Visit days
 * have a dot, today a ring, the selected day is filled; days after today are dimmed and
 * can't be chosen (and next month is off once it would be all future).
 *
 * Assistive tech gets a grid labelled by the month: column headers name the weekdays, each
 * day button reads its full date and visit ("Thursday 1 October, visit, 6 of 7 done,
 * £60.00"), and one day is in the tab order; the arrow keys move a day or a week, Home and
 * End go to the start and end of the week, Page Up and Page Down change month.
 */
export function Calendar({ month, onMonth, selected, onSelect, today, visits }: CalendarProps) {
  const titleId = useId();
  const tableRef = useRef<HTMLTableElement>(null);
  // The day the arrow keys last moved to (null: the default below).
  const [focused, setFocused] = useState<ISODate | null>(null);
  const moveFocus = useRef(false);

  const thisMonth = monthOf(today);
  const weeks = monthGrid(month);
  const marked = visitDays(visits, month);
  const inMonth = (d: ISODate | null): d is ISODate => !!d && monthOf(d) === month;
  // The one day button in the tab order: the one moved to, else the selected day, else today, else the 1st.
  const tabStop = inMonth(focused)
    ? focused
    : inMonth(selected)
      ? selected
      : month === thisMonth
        ? today
        : `${month}-01`;

  // After a key moved focus (possibly into another month), focus that day's button.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    tableRef.current?.querySelector<HTMLButtonElement>(`[data-date="${tabStop}"]`)?.focus();
  });

  const goTo = (date: ISODate) => {
    // Never onto a day that can't have a visit.
    const target = canHaveVisit(date, today) ? date : today;
    setFocused(target);
    moveFocus.current = true;
    if (monthOf(target) !== month) onMonth(monthOf(target));
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
    if (next === date || !canHaveVisit(next, today)) {
      // Into the future: as far as today, if that is a move at all.
      if (date !== today && next > today) goTo(today);
      return;
    }
    goTo(next);
  };

  const changeMonth = (n: number) => {
    setFocused(null);
    onMonth(shiftMonth(month, n));
  };

  const atLatest = month >= thisMonth;

  return (
    <div className={styles.card}>
      <div className={styles.top}>
        <button type="button" className={styles.navButton} aria-label="Previous month" onClick={() => changeMonth(-1)}>
          <ChevronLeftIcon size={18} strokeWidth={2.6} />
        </button>
        <div className={styles.heading}>
          <div id={titleId} className={styles.title} aria-live="polite">
            {monthTitle(month)}
          </div>
          <div className={styles.summary}>{monthSummary(monthTotals(visits, month))}</div>
        </div>
        <button
          type="button"
          className={styles.navButton}
          aria-label="Next month"
          disabled={atLatest}
          onClick={() => changeMonth(1)}
        >
          <ChevronRightIcon size={18} strokeWidth={2.6} />
        </button>
      </div>
      <table ref={tableRef} className={styles.grid} role="grid" aria-labelledby={titleId}>
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
          {weeks.map((week, i) => (
            <tr key={week.find(Boolean) ?? i}>
              {week.map((date, j) =>
                date ? (
                  <td key={date} role="gridcell" aria-selected={date === selected} className={styles.cell}>
                    <button
                      type="button"
                      className={styles.day}
                      data-date={date}
                      data-today={date === today || undefined}
                      data-selected={date === selected || undefined}
                      data-visit={marked.has(date) || undefined}
                      aria-label={calendarDayLabel(date, today, visitOn(visits, date))}
                      tabIndex={date === tabStop ? 0 : -1}
                      disabled={!canHaveVisit(date, today)}
                      onClick={() => {
                        setFocused(date);
                        onSelect(date);
                      }}
                      onKeyDown={(e) => onKeyDown(e, date)}
                    >
                      {parseISODate(date).d}
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
    </div>
  );
}
