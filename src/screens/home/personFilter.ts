import type { Item, Member } from '../../lib/types';

/** Whose tasks Home shows: everyone's, one person's (their member id), or the unassigned ones. */
export type PersonFilter = 'all' | 'none' | string;

/** Where this device remembers the choice, per household. */
export function personFilterKey(householdId: string): string {
  return `homeos.who.${householdId}`;
}

/** True when `item` is for `who`. */
export function isFor(item: Pick<Item, 'assignee_id'>, who: PersonFilter): boolean {
  if (who === 'all') return true;
  if (who === 'none') return item.assignee_id === null;
  return item.assignee_id === who;
}

/** A remembered choice that still makes sense: someone who left (or a stale value) reads as everyone. */
export function validFilter(who: string | null | undefined, members: Pick<Member, 'id'>[]): PersonFilter {
  if (who === 'none' || who === 'all') return who;
  return who && members.some((m) => m.id === who) ? who : 'all';
}

/** Open items per choice, for the counts on the chips. */
export function countsFor(items: Pick<Item, 'assignee_id'>[], members: Pick<Member, 'id'>[]): Record<string, number> {
  const counts: Record<string, number> = { all: items.length, none: 0 };
  for (const m of members) counts[m.id] = 0;
  for (const it of items) {
    if (it.assignee_id === null) counts.none += 1;
    else if (it.assignee_id in counts) counts[it.assignee_id] += 1;
  }
  return counts;
}
