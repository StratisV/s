import {
  calendarDayLabel,
  monthSummary,
  monthTotals,
  visitDays,
  visitOn,
  type YearMonth,
} from '../../lib/logic/housekeeping';
import type { HousekeepingVisit, ISODate } from '../../lib/types';
import { MonthCalendar } from '../../ui/MonthCalendar';

interface CalendarProps {
  month: YearMonth;
  onMonth(month: YearMonth): void;
  selected: ISODate | null;
  onSelect(date: ISODate): void;
  today: ISODate;
  visits: HousekeepingVisit[];
}

/**
 * The month of visits: the shared calendar card (src/ui/MonthCalendar.tsx, as on Home) with
 * the month's total under its title ("4 visits · £180.00"). Visit days have a dot (and
 * `data-visit`); days after today are dimmed and can't be chosen, and next month is off once
 * it would be all future, since no visit can be ahead. Each day reads its full date and visit
 * ("Thursday 1 October, visit, 6 of 7 done, £60.00", then ", selected" for the chosen day).
 */
export function Calendar({ month, onMonth, selected, onSelect, today, visits }: CalendarProps) {
  const marked = visitDays(visits, month);
  return (
    <MonthCalendar
      month={month}
      onMonth={onMonth}
      selected={selected}
      onSelect={onSelect}
      today={today}
      lastDay={today}
      summary={monthSummary(monthTotals(visits, month))}
      dayName={(date, isSelected) => calendarDayLabel(date, today, visitOn(visits, date), isSelected)}
      dot={(date) => marked.has(date)}
      dayData={(date) => ({ 'data-visit': marked.has(date) ? 'true' : undefined })}
    />
  );
}
