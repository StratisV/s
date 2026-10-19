// What Home's card for an area says about it (HomeScreen.tsx, AreaCard.tsx) and what its sheet
// repeats (AreaSheet.tsx): one status in three steps, a few words for it, how many To dos are
// open and who is looking after them. Pure: callers pass the area's open items and today.

import type { ISODate, Item, Member } from '../types';
import { isState } from './items';
import { needsAttention } from './upNext';

/**
 * An area's state, most pressing first: something late, urgent or needing work ('attention');
 * else something within the month or Okay ('soon'); else nothing pressing ('good').
 */
export type AreaStatus = 'attention' | 'soon' | 'good';

export interface AreaOverview {
  status: AreaStatus;
  /** The status in a few words: "2 need attention", "1 coming up", "All good", "All clear". */
  statusText: string;
  /** Open To dos (things looked after are never done, so they don't count). */
  openCount: number;
  /** Who its open items are for, most items first, then in the household's order. */
  people: Member[];
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * An area at a glance, from its items (only open ones count):
 *
 * - **attention**: a To do that is urgent or late, or a thing looked after that needs work.
 *   "1 needs attention", "2 need attention".
 * - **soon**: a To do within the month, or a thing looked after that is Okay. "1 coming up"
 *   (the To dos), or "1 to keep an eye on" when only things looked after are Okay.
 * - **good**: nothing pressing. "All good", or "All clear" when nothing is open at all.
 */
export function areaOverview(items: Item[], members: Member[], today: ISODate): AreaOverview {
  const open = items.filter((it) => it.status === 'open');
  const attention = open.filter((it) => needsAttention(it, today)).length;
  const amber = open.filter((it) => it.rag === 'amber' && !needsAttention(it, today));
  const comingUp = amber.filter((it) => !isState(it)).length;
  const okay = amber.length - comingUp;

  let status: AreaStatus;
  let statusText: string;
  if (attention) {
    status = 'attention';
    statusText = `${attention} ${plural(attention, 'needs', 'need')} attention`;
  } else if (amber.length) {
    status = 'soon';
    statusText = comingUp ? `${comingUp} coming up` : `${okay} to keep an eye on`;
  } else {
    status = 'good';
    statusText = open.length ? 'All good' : 'All clear';
  }

  const counts = new Map<string, number>();
  for (const it of open) if (it.assignee_id) counts.set(it.assignee_id, (counts.get(it.assignee_id) ?? 0) + 1);
  const order = new Map(members.map((m, i) => [m.id, i]));
  const people = members
    .filter((m) => counts.has(m.id))
    .sort((a, b) => counts.get(b.id)! - counts.get(a.id)! || order.get(a.id)! - order.get(b.id)!);

  return { status, statusText, openCount: open.filter((it) => !isState(it)).length, people };
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
