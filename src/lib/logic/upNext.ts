// Home's "Up next" view: every open item in the house, grouped by when it needs doing rather
// than where it is, so what needs someone now is always at the top of the screen. Pure:
// callers pass today (the household's day) and the items already narrowed to whoever the
// person filter shows.

import { RAG_ORDER } from '../constants';
import type { ISODate, Item, Rag } from '../types';
import { addDays, daysBetween, formatDay } from './dates';
import { isState } from './items';

/** The groups of the Up next view, top to bottom. */
export type UpNextGroupId = 'attention' | 'today' | 'week' | 'later';

export const UP_NEXT_TITLE: Record<UpNextGroupId, string> = {
  attention: 'Needs attention',
  today: 'Today',
  week: 'Next 7 days',
  later: 'Later',
};

export interface UpNextGroup {
  id: UpNextGroupId;
  title: string;
  items: Item[];
}

export interface UpNext {
  /** Only the groups with something in them, in order. */
  groups: UpNextGroup[];
  /** To maintain items in good condition (green), for "Looking after" at the foot. */
  looking: Item[];
  /** How many need attention, are due today, and everything else open (not counting `looking`). */
  counts: { attention: number; today: number; rest: number };
}

const rank = (rag: Rag) => RAG_ORDER.indexOf(rag);

/** Late or urgent To do, or a To maintain item in fair or poor condition. */
export function needsAttention(item: Item, today: ISODate): boolean {
  if (isState(item)) return item.rag !== 'green';
  return item.rag === 'red' || (item.due_date !== null && item.due_date < today);
}

/**
 * Urgency first (red, amber, green), then the earliest date (none last), then the oldest.
 * Late items come before everything else and To maintain items last. Up next sorts each
 * group this way, and Rooms each room, so the most urgent row is always at the top.
 */
export function compareByUrgency(today: ISODate) {
  return (a: Item, b: Item): number => {
    const aState = isState(a);
    const bState = isState(b);
    if (aState !== bState) return aState ? 1 : -1;
    const aLate = !aState && a.due_date !== null && a.due_date < today;
    const bLate = !bState && b.due_date !== null && b.due_date < today;
    if (aLate !== bLate) return aLate ? -1 : 1;
    const byRag = rank(a.rag) - rank(b.rag);
    if (byRag) return byRag;
    if (a.due_date !== b.due_date) {
      if (a.due_date === null) return 1;
      if (b.due_date === null) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    }
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.title.localeCompare(b.title);
  };
}

/**
 * The open items as Up next shows them: Needs attention (late or urgent To dos, and To
 * maintain items in fair or poor condition), Today, Next 7 days, Later (later than that, or
 * no date), each sorted urgency first, then date. To maintain items in good condition go to
 * `looking`. Empty groups are left out.
 */
export function upNext(items: Item[], today: ISODate): UpNext {
  const buckets: Record<UpNextGroupId, Item[]> = { attention: [], today: [], week: [], later: [] };
  const looking: Item[] = [];
  const weekEnd = addDays(today, 7);
  for (const item of items) {
    if (item.status !== 'open') continue;
    if (needsAttention(item, today)) buckets.attention.push(item);
    else if (isState(item)) looking.push(item);
    else if (item.due_date === today) buckets.today.push(item);
    else if (item.due_date !== null && item.due_date <= weekEnd) buckets.week.push(item);
    else buckets.later.push(item);
  }
  const order = compareByUrgency(today);
  const ids: UpNextGroupId[] = ['attention', 'today', 'week', 'later'];
  const groups = ids
    .map((id) => ({ id, title: UP_NEXT_TITLE[id], items: buckets[id].sort(order) }))
    .filter((g) => g.items.length > 0);
  looking.sort((a, b) => a.title.localeCompare(b.title));
  return {
    groups,
    looking,
    counts: {
      attention: buckets.attention.length,
      today: buckets.today.length,
      rest: buckets.week.length + buckets.later.length,
    },
  };
}

/**
 * When a To do is due, relative to today: "Today", "Tomorrow", "In 4 days", "In 3 weeks",
 * "In 2 months", or the date when it is a year or more away; "2 days late" (`late`) once
 * past. Null without a date.
 */
export function relativeDue(due: ISODate | null, today: ISODate): { text: string; late: boolean } | null {
  if (!due) return null;
  const days = daysBetween(today, due);
  if (days < 0) return { text: `${-days} ${days === -1 ? 'day' : 'days'} late`, late: true };
  if (days === 0) return { text: 'Today', late: false };
  if (days === 1) return { text: 'Tomorrow', late: false };
  if (days < 14) return { text: `In ${days} days`, late: false };
  if (days < 60) return { text: `In ${Math.round(days / 7)} weeks`, late: false };
  if (days < 365) {
    const months = Math.round(days / 30.4);
    return { text: `In ${months} ${months === 1 ? 'month' : 'months'}`, late: false };
  }
  return { text: formatDay(due, today), late: false };
}

/** "Updated today", "Updated yesterday", "Updated 3 days ago", then the date. */
export function relativeUpdated(day: ISODate, today: ISODate): string {
  const days = daysBetween(day, today);
  if (days <= 0) return 'Updated today';
  if (days === 1) return 'Updated yesterday';
  if (days < 14) return `Updated ${days} days ago`;
  return `Updated ${formatDay(day, today)}`;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The plain-language summary at the top of Home: a lead sentence and a quieter one after it.
 * "2 things need attention and 1 is due today." "Everything else can wait."
 */
export function homeSummary(view: UpNext, today: ISODate): { lead: string; rest: string } {
  const { attention, today: dueToday, rest } = view.counts;
  if (attention && dueToday) {
    return {
      lead: `${attention} ${plural(attention, 'thing needs', 'things need')} attention and ${dueToday} ${plural(dueToday, 'is', 'are')} due today.`,
      rest: rest ? 'Everything else can wait.' : '',
    };
  }
  if (attention) {
    return {
      lead: `${attention} ${plural(attention, 'thing needs', 'things need')} attention.`,
      rest: rest ? 'Everything else can wait.' : '',
    };
  }
  if (dueToday) {
    return {
      lead: `${dueToday} ${plural(dueToday, 'thing is', 'things are')} due today.`,
      rest: 'Nothing urgent or late.',
    };
  }
  const next = view.groups.find((g) => g.id === 'week' || g.id === 'later')?.items[0];
  if (next) {
    const when = relativeDue(next.due_date, today);
    return {
      lead: 'Nothing urgent today.',
      rest: `Next up: ${next.title.trim()}${when ? `, ${when.text.toLowerCase()}` : ''}.`,
    };
  }
  return { lead: 'All clear.', rest: 'Nothing to do right now.' };
}
