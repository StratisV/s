// What Home's card for an area says about it (HomeScreen.tsx, AreaCard.tsx) and what its sheet
// repeats (AreaSheet.tsx): how many urgent and non-urgent tasks are open there, in red and
// orange, or "All good" in green, and who is looking after them. Pure: callers pass the area's
// items.

import type { Item, Member } from '../types';
import { isState } from './items';

export interface AreaOverview {
  /** Open To dos marked Urgent, and things looked after that need work. */
  urgent: number;
  /** The other open To dos: Within the month and Not urgent, late or not. */
  nonUrgent: number;
  /** Who its open items are for, most items first, then in the household's order. */
  people: Member[];
}

/** The colour of a status line: red for urgent, orange for non-urgent, green for all good. */
export type StatusTone = 'urgent' | 'non-urgent' | 'good';

/** One line of an area's status, in words and the colour that goes with them. */
export interface StatusLine {
  tone: StatusTone;
  text: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * An area at a glance, from its items (only open ones count; things looked after that are Good
 * or Okay count as neither):
 *
 * - **urgent**: To dos marked Urgent, and things looked after marked Needs work;
 * - **nonUrgent**: the other To dos (Within the month and Not urgent, late or not);
 * - **people**: who its open items are for, most items first, then in the household's order.
 */
export function areaOverview(items: Item[], members: Member[]): AreaOverview {
  const open = items.filter((it) => it.status === 'open');
  const urgent = open.filter((it) => it.rag === 'red').length;
  const nonUrgent = open.filter((it) => !isState(it) && it.rag !== 'red').length;

  const counts = new Map<string, number>();
  for (const it of open) if (it.assignee_id) counts.set(it.assignee_id, (counts.get(it.assignee_id) ?? 0) + 1);
  const order = new Map(members.map((m, i) => [m.id, i]));
  const people = members
    .filter((m) => counts.has(m.id))
    .sort((a, b) => counts.get(b.id)! - counts.get(a.id)! || order.get(a.id)! - order.get(b.id)!);

  return { urgent, nonUrgent, people };
}

/**
 * The lines an area's card and sheet show: "2 urgent tasks" (red), then "1 non-urgent task"
 * (orange), either alone or both, red first; "All good" (green) when there are neither.
 */
export function statusLines({ urgent, nonUrgent }: Pick<AreaOverview, 'urgent' | 'nonUrgent'>): StatusLine[] {
  const lines: StatusLine[] = [];
  if (urgent) lines.push({ tone: 'urgent', text: `${urgent} urgent ${plural(urgent, 'task', 'tasks')}` });
  if (nonUrgent) lines.push({ tone: 'non-urgent', text: `${nonUrgent} non-urgent ${plural(nonUrgent, 'task', 'tasks')}` });
  return lines.length ? lines : [{ tone: 'good', text: 'All good' }];
}

/** The status lines as one phrase, for assistive tech: "2 urgent tasks, 1 non-urgent task", "All good". */
export function statusWords(overview: Pick<AreaOverview, 'urgent' | 'nonUrgent'>): string {
  return statusLines(overview)
    .map((line) => line.text)
    .join(', ');
}

/**
 * Who is looking after an area, in words: "Shea", "Shea and Ela", "Shea, Ela and Stratis";
 * "No one yet" when nothing open is assigned.
 */
export function peopleText(people: Pick<Member, 'name'>[]): string {
  const names = people.map((p) => p.name);
  if (!names.length) return 'No one yet';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
