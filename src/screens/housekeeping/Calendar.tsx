import { useId, useMemo } from 'react';
import { calendarDayLabel, monthSummary, monthTotals, todayLine, visitDays, visitOn } from '../../lib/logic/housekeeping';
import type { HousekeepingVisit, ISODate } from '../../lib/types';
import { DatePicker, type ChosenDay, type ChosenPatch } from '../../ui/DatePicker';

/** Where this device remembers Housekeeping's week strip or month: 'month', or nothing for the week. */
export const HOUSEKEEPING_CALENDAR_VIEW_KEY = 'homeos.calendar.housekeeping';

interface CalendarProps {
  /** The chosen day and the week and month shown (useChosenDay()). */
  chosen: ChosenDay;
  onChange(patch: ChosenPatch<ChosenDay>): void;
  onReset(): void;
  onSelect(date: ISODate): void;
  today: ISODate;
  visits: HousekeepingVisit[];
}

/**
 * The visits, under the title: Needs attention's date picker (src/ui/DatePicker.tsx), the week
 * as a strip or the whole month (Show month / Show week, remembered on this device apart from
 * Needs attention's), named by a visually hidden "Calendar" heading. While today is chosen and shown, a
 * line beside it says how today's visit is going ("6 of 7 done today · £60.00"). Visit days
 * have a dot (and `data-visit`); days after today are dimmed and can't be chosen, and Next
 * is off once the week or month after would be all future, since no visit can be ahead. The
 * month has its total under its title ("4 visits · £180.00"). Each day reads its full date
 * and visit ("Thursday 1 October, visit, 6 of 7 done, £60.00", then ", selected" for the
 * chosen day).
 */
export function Calendar({ chosen, onChange, onReset, onSelect, today, visits }: CalendarProps) {
  const headingId = useId();
  const marked = useMemo(() => visitDays(visits), [visits]);
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="visually-hidden">
        Calendar
      </h2>
      <DatePicker
        viewKey={HOUSEKEEPING_CALENDAR_VIEW_KEY}
        today={today}
        chosen={chosen}
        onChange={onChange}
        onReset={onReset}
        onSelect={onSelect}
        line={todayLine(visitOn(visits, today))}
        lastDay={today}
        dayName={(date, isSelected) => calendarDayLabel(date, today, visitOn(visits, date), isSelected)}
        monthSummary={(month) => monthSummary(monthTotals(visits, month))}
        dot={(date) => marked.has(date)}
        dayData={(date) => ({ 'data-visit': marked.has(date) ? 'true' : undefined })}
      />
    </section>
  );
}
