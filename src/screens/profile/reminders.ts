// How Profile words reminders and their days (server mode; docs/ARCHITECTURE.md "Server mode
// (no setup)", "Notifications"). The morning run sends once a day, so a reminder's time is
// always the morning.

/** 0 = Sunday … 6 = Saturday, as Reminder.days. */
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
/** The day buttons' letters. */
export const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
/** The week as shown: Monday first. */
export const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

/** What a reminder's time reads (the run comes once, in the morning). */
export const MORNING = 'Morning';
/** When the morning is: the run at 07:00 UTC is 7 to 8 in winter and 8 to 9 in summer, in London. */
export const MORNING_NOTE = 'Reminders come in the morning, between 7 and 9.';

/**
 * The days in words: "Every day", "Weekdays", "Weekends", "Every Sunday", else the short names
 * Monday first ("Mon, Wed, Fri").
 * Tests: each of those; duplicates and order do not matter.
 */
export function daysLabel(days: readonly number[]): string {
  const set = new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  if (set.size === 7) return 'Every day';
  const has = (list: number[]) => list.length === set.size && list.every((d) => set.has(d));
  if (has([1, 2, 3, 4, 5])) return 'Weekdays';
  if (has([0, 6])) return 'Weekends';
  if (set.size === 1) return `Every ${DAY_NAMES[[...set][0]]}`;
  return WEEK.filter((d) => set.has(d))
    .map((d) => DAY_SHORT[d])
    .join(', ');
}

/** Under a reminder's title in Profile: "Every Sunday · Morning". */
export function reminderDetail(days: readonly number[]): string {
  return `${daysLabel(days)} · ${MORNING}`;
}
