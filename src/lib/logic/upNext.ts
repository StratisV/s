// Needs attention's list: every open item in the house that wants something from someone, in
// one list in priority order rather than by where it is, so what needs someone now is always
// at the top of the screen. Pure: callers pass today (the household's day) and the items
// already narrowed to whoever the person filter shows.

import { RAG_ORDER } from '../constants';
import type { ISODate, Item, Rag } from '../types';
import { addDays, daysBetween, formatDay } from './dates';
import { isState } from './items';

export interface UpNext {
  /** Every item the list shows, in priority order (upNext()). */
  items: Item[];
  /**
   * How many need attention (needsAttention()), are due today, and the other open To dos
   * (things looked after that are Okay are not counted).
   */
  counts: { attention: number; today: number; rest: number };
}

const rank = (rag: Rag) => RAG_ORDER.indexOf(rag);

/** Late or urgent To do, or a To maintain item that needs work. */
export function needsAttention(item: Item, today: ISODate): boolean {
  if (isState(item)) return item.rag === 'red';
  return item.rag === 'red' || (item.due_date !== null && item.due_date < today);
}

/** Late To dos (due before today); never a To maintain item, which has no date. */
const isLate = (item: Item, today: ISODate) => !isState(item) && item.due_date !== null && item.due_date < today;

/** The earlier date first; an item without one goes after every dated one. */
function byDate(a: Item, b: Item): number {
  if (a.due_date === b.due_date) return 0;
  if (a.due_date === null) return 1;
  if (b.due_date === null) return -1;
  return a.due_date < b.due_date ? -1 : 1;
}

/** The oldest first, then by title: a steady order for items that tie on everything else. */
function byAge(a: Item, b: Item): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.title.localeCompare(b.title);
}

/** By name, then the oldest: things looked after, which have no date. */
const byTitle = (a: Item, b: Item) => a.title.localeCompare(b.title) || byAge(a, b);

/**
 * Urgency first (red, amber, green), then the earliest date (none last), then the oldest.
 * Late items come before everything else and To maintain items last. An area's sheet sorts
 * its To dos this way (roomOrder()), so the most urgent row is always at the top.
 */
export function compareByUrgency(today: ISODate) {
  return (a: Item, b: Item): number => {
    const aState = isState(a);
    const bState = isState(b);
    if (aState !== bState) return aState ? 1 : -1;
    const aLate = isLate(a, today);
    if (aLate !== isLate(b, today)) return aLate ? -1 : 1;
    return rank(a.rag) - rank(b.rag) || byDate(a, b) || byAge(a, b);
  };
}

/**
 * An area's open items as its sheet shows them (and Share Room lists them): its To dos most urgent
 * first (compareByUrgency()), then the things it looks after, by name.
 */
export function roomOrder(items: Item[], today: ISODate): Item[] {
  const open = items.filter((it) => it.status === 'open');
  const tasks = open.filter((it) => !isState(it)).sort(compareByUrgency(today));
  const states = open.filter(isState).sort(byTitle);
  return [...tasks, ...states];
}

/**
 * The earliest date first, then urgency, then the oldest: the next 7 days, so the days read in
 * order ("In 2 days" never sits under "In 6 days") and, on one day, the most urgent comes
 * first.
 */
export function compareByDate(today: ISODate) {
  return (a: Item, b: Item): number => {
    const aState = isState(a);
    const bState = isState(b);
    if (aState !== bState) return aState ? 1 : -1;
    const aLate = isLate(a, today);
    if (aLate !== isLate(b, today)) return aLate ? -1 : 1;
    return byDate(a, b) || rank(a.rag) - rank(b.rag) || byAge(a, b);
  };
}

/**
 * What needs attention, in order: late To dos, the most late first (then the most urgent);
 * then the other Urgent To dos, the soonest first (none last); then things looked after that
 * need work, by name.
 */
function compareAttention(today: ISODate) {
  const step = (item: Item) => (isState(item) ? 2 : isLate(item, today) ? 0 : 1);
  return (a: Item, b: Item): number => {
    const s = step(a);
    if (s !== step(b)) return s - step(b);
    if (s === 2) return byTitle(a, b);
    return byDate(a, b) || rank(a.rag) - rank(b.rag) || byAge(a, b);
  };
}

/** The steps of the list, top to bottom (upNext()). */
type Step = 'attention' | 'today' | 'week' | 'later' | 'undated' | 'okay';

/**
 * The open items as Needs attention lists them, one list in priority order:
 *
 * 1. what needs attention (needsAttention(), in compareAttention()'s order): late To dos, the
 *    most late first; Urgent To dos; things looked after that need work;
 * 2. due today, the most urgent first;
 * 3. the next 7 days (tomorrow to a week today), by date (compareByDate());
 * 4. later than that, by urgency, then date (compareByUrgency());
 * 5. no date, by urgency;
 * 6. things looked after that are Okay, by name.
 *
 * Things looked after that are Good are left out (their area's sheet has them), and so is
 * anything done.
 */
export function upNext(items: Item[], today: ISODate): UpNext {
  const steps: Record<Step, Item[]> = { attention: [], today: [], week: [], later: [], undated: [], okay: [] };
  const weekEnd = addDays(today, 7);
  for (const item of items) {
    if (item.status !== 'open') continue;
    if (needsAttention(item, today)) steps.attention.push(item);
    else if (isState(item)) {
      if (item.rag === 'amber') steps.okay.push(item);
    } else if (item.due_date === today) steps.today.push(item);
    else if (item.due_date === null) steps.undated.push(item);
    else if (item.due_date <= weekEnd) steps.week.push(item);
    else steps.later.push(item);
  }
  const urgency = compareByUrgency(today);
  steps.attention.sort(compareAttention(today));
  steps.today.sort(urgency);
  steps.week.sort(compareByDate(today));
  steps.later.sort(urgency);
  steps.undated.sort(urgency);
  steps.okay.sort(byTitle);
  const order: Step[] = ['attention', 'today', 'week', 'later', 'undated', 'okay'];
  return {
    items: order.flatMap((step) => steps[step]),
    counts: {
      attention: steps.attention.length,
      today: steps.today.length,
      rest: steps.week.length + steps.later.length + steps.undated.length,
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

/**
 * The toast once a To do is ticked off: `'Marked as done'`; for a repeating one, when it comes
 * round again, in the words its row will use: `'Done. Next one in 8 weeks'`, `'Done. Next one
 * tomorrow'`, or a year or more away, `'Done. Next one on Fri 8 Oct 2027'`.
 */
export function doneMessage(next: ISODate | null, today: ISODate): string {
  const when = relativeDue(next, today);
  if (!next || !when) return 'Marked as done';
  return `Done. Next one ${daysBetween(today, next) < 365 ? when.text.toLowerCase() : `on ${when.text}`}`;
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
 * Whose items the summary is about, when the person filter narrows Home: "you", a person's
 * name, or the unassigned ones. Everyone's when left out.
 */
export type SummaryScope = { kind: 'me' } | { kind: 'person'; name: string } | { kind: 'none' };

/** "For you, " and "For Shea, ", or "Unassigned: ", before a sentence that then starts in lower case. */
function scoped(sentence: string, scope: SummaryScope | undefined): string {
  if (!scope) return sentence;
  const lower = sentence.charAt(0).toLowerCase() + sentence.slice(1);
  if (scope.kind === 'none') return `Unassigned: ${lower}`;
  return `For ${scope.kind === 'me' ? 'you' : scope.name}, ${/^\d/.test(sentence) ? sentence : lower}`;
}

/**
 * The plain-language summary at the top of Home: a lead sentence and a quieter one after it.
 * "2 things need attention and 1 is due today." "Everything else can wait." With the person
 * filter on, it says whose they are: "For Shea, 1 thing needs attention."
 */
export function homeSummary(view: UpNext, today: ISODate, scope?: SummaryScope): { lead: string; rest: string } {
  const { attention, today: dueToday, rest } = view.counts;
  if (attention && dueToday) {
    return {
      lead: scoped(
        `${attention} ${plural(attention, 'thing needs', 'things need')} attention and ${dueToday} ${plural(dueToday, 'is', 'are')} due today.`,
        scope,
      ),
      rest: rest ? 'Everything else can wait.' : '',
    };
  }
  if (attention) {
    return {
      lead: scoped(`${attention} ${plural(attention, 'thing needs', 'things need')} attention.`, scope),
      rest: rest ? 'Everything else can wait.' : '',
    };
  }
  if (dueToday) {
    return {
      lead: scoped(`${dueToday} ${plural(dueToday, 'thing is', 'things are')} due today.`, scope),
      rest: 'Nothing urgent or late.',
    };
  }
  // Nothing needs attention or is due today: the soonest of the other To dos (the list puts
  // later ones urgency first, so the first of them may be months away).
  const next = view.items.filter((it) => !isState(it)).sort(compareByDate(today))[0];
  if (next) {
    const when = relativeDue(next.due_date, today);
    return {
      lead: scoped('Nothing urgent today.', scope),
      rest: `Next up: ${next.title.trim()}${when ? `, ${when.text.toLowerCase()}` : ''}.`,
    };
  }
  if (!scope) return { lead: 'All clear.', rest: 'Nothing to do right now.' };
  if (scope.kind === 'none') return { lead: 'Nothing unassigned to do.', rest: 'Everything open has someone on it.' };
  return { lead: `All clear for ${scope.kind === 'me' ? 'you' : scope.name}.`, rest: 'Nothing to do right now.' };
}
