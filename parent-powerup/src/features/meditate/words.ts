import { fromKey } from '../../lib/dates';

/* The Meditate tab's small bits of wording, kept here so they are easy to test and to change. */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "Sunday 15 November", from a 'YYYY-MM-DD' key. */
export function longDate(key: string): string {
  const date = fromKey(key);
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "Good morning, Sam" (first name only), or just "Good evening" without a name. */
export function greeting(hour: number, name = ''): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  const hello = hour < 5 ? 'Hello' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return first ? `${hello}, ${first}` : hello;
}

/** "3 days in a row"; a first day is just that. */
export function streakWords(days: number): string {
  return days === 1 ? '1 day so far' : `${days} days in a row`;
}

/** "Mia’s", "James’s". */
export const possessive = (name: string) => `${name}’s`;

export type Feeling = 1 | 2 | 3;

/** The check-in after a meditation, gentlest first. */
export const FEELINGS: { value: Feeling; emoji: string; label: string; reply: string }[] = [
  {
    value: 1,
    emoji: '🌧️',
    label: 'Still wobbly',
    reply: 'That’s okay. Some feelings take longer to settle. A drink of water, a cuddle or some fresh air can help too.',
  },
  { value: 2, emoji: '⛅', label: 'A bit calmer', reply: 'Every little bit counts. Thank you for taking the time.' },
  { value: 3, emoji: '☀️', label: 'Calm', reply: 'Lovely. Hold on to that feeling for as long as it lasts.' },
];
