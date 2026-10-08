import { NEW_ITEM_DEFAULTS, REPEAT_MONTHS, SEED_ITEMS } from '../constants';
import type { Area, ISODate, Item, ItemDraft, Member, Repeat, SeedItem } from '../types';
import { addDays, addMonths, daysBetween, formatDay } from './dates';

/** Open, has a due date, and that date is before today. */
export function isMissed(item: Pick<Item, 'status' | 'due_date'>, today: ISODate): boolean {
  return item.status === 'open' && item.due_date !== null && item.due_date < today;
}

/** Earliest due date first; items without a date last; then oldest first. */
export function compareItems(a: Item, b: Item): number {
  if (a.due_date !== b.due_date) {
    if (a.due_date === null) return 1;
    if (b.due_date === null) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  }
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.title.localeCompare(b.title);
}

export function sortItems(items: Item[]): Item[] {
  return [...items].sort(compareItems);
}

function step(repeat: Exclude<Repeat, 'none'>, from: ISODate): ISODate {
  return repeat === 'weekly' ? addDays(from, 7) : addMonths(from, REPEAT_MONTHS[repeat]);
}

/**
 * Next due date after completing a repeating item: one interval after the
 * old due date, or one interval after today if that is still in the past.
 * Returns null for non-repeating items.
 */
export function nextDueDate(repeat: Repeat, due: ISODate | null, today: ISODate): ISODate | null {
  if (repeat === 'none') return null;
  const next = step(repeat, due ?? today);
  return next < today ? step(repeat, today) : next;
}

/** Areas in order, each with its open items sorted. */
export function itemsByArea(areas: Area[], items: Item[]): { area: Area; items: Item[] }[] {
  const sortedAreas = [...areas].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  return sortedAreas.map((area) => ({
    area,
    items: sortItems(items.filter((it) => it.area_id === area.id && it.status === 'open')),
  }));
}

/** "🦆 Shea" or "Unassigned". */
export function memberLabel(member: Member | null | undefined): string {
  return member ? `${member.emoji} ${member.name}` : 'Unassigned';
}

/**
 * Pieces of the Home row meta line `🦆 Shea · Tue 20 Oct`.
 * `date` is null without a due date; when missed it reads `Missed · Tue 6 Oct`.
 */
export function itemMeta(
  item: Item,
  members: Member[],
  today: ISODate,
): { who: string; date: string | null; missed: boolean } {
  const who = memberLabel(members.find((m) => m.id === item.assignee_id));
  if (!item.due_date) return { who, date: null, missed: false };
  const missed = isMissed(item, today);
  const day = formatDay(item.due_date, today);
  return { who, date: missed ? `Missed · ${day}` : day, missed };
}

/** Due row value in the Item sheet: `Tue 6 Oct · 2 days late`, `Tue 20 Oct` or `None`. */
export function dueDetail(due: ISODate | null, today: ISODate): { text: string; missed: boolean } {
  if (!due) return { text: 'None', missed: false };
  const day = formatDay(due, today);
  if (due >= today) return { text: day, missed: false };
  const late = daysBetween(due, today);
  return { text: `${day} · ${late} ${late === 1 ? 'day' : 'days'} late`, missed: true };
}

/** README "New item" defaults. */
export function newItemDraft(areaId: string, today: ISODate): ItemDraft {
  return {
    area_id: areaId,
    title: '',
    note: '',
    rag: NEW_ITEM_DEFAULTS.rag,
    due_date: addDays(today, NEW_ITEM_DEFAULTS.due_in_days),
    assignee_id: null,
    repeat: NEW_ITEM_DEFAULTS.repeat,
    notify: NEW_ITEM_DEFAULTS.notify,
  };
}

export function draftOf(item: Item): ItemDraft {
  const { area_id, title, note, rag, due_date, assignee_id, repeat, notify } = item;
  return { area_id, title, note, rag, due_date, assignee_id, repeat, notify };
}

/** Seed items whose area is among `areaNames` (case-insensitive). */
export function seedItemsFor(areaNames: string[]): SeedItem[] {
  const names = new Set(areaNames.map((n) => n.trim().toLowerCase()));
  return SEED_ITEMS.filter((s) => names.has(s.area.toLowerCase()));
}
