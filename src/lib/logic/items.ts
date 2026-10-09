import { NEW_ITEM_DEFAULTS, REPEAT_MONTHS, SEED_ITEMS, STATE_FIELDS } from '../constants';
import type { Area, ISODate, Item, ItemDraft, ItemKind, Member, Repeat, SeedItem } from '../types';
import { addDays, addMonths, daysBetween, formatDay, todayIn } from './dates';

/** The zone the Home row "Updated" date uses when the caller does not pass the household's. */
const FALLBACK_TIME_ZONE = 'Europe/London';

/** A "To maintain" item: never done, no due date, repeat or reminder. */
export function isState(item: { kind?: ItemKind }): boolean {
  return item.kind === 'state';
}

/**
 * The kind rules every write follows (the database trigger does the same): a state has no
 * due date, repeat or reminder. Anything else comes back unchanged.
 */
export function applyKindRules<T extends { kind?: ItemKind }>(item: T): T {
  return isState(item) ? { ...item, ...STATE_FIELDS } : item;
}

/** A task that is open, has a due date, and that date is before today. States never are. */
export function isMissed(item: Pick<Item, 'status' | 'due_date'> & { kind?: ItemKind }, today: ISODate): boolean {
  return !isState(item) && item.status === 'open' && item.due_date !== null && item.due_date < today;
}

/**
 * Tasks first: earliest due date first, items without a date last, then oldest first.
 * Then states (To maintain), by title.
 */
export function compareItems(a: Item, b: Item): number {
  const aState = isState(a);
  const bState = isState(b);
  if (aState !== bState) return aState ? 1 : -1;
  if (aState) {
    const byTitle = a.title.localeCompare(b.title);
    if (byTitle) return byTitle;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
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

/** "Updated Tue 6 Oct": the day a state was last edited, in the household's time zone. */
export function updatedLabel(updatedAt: string, today: ISODate, timeZone: string = FALLBACK_TIME_ZONE): string {
  const at = new Date(updatedAt);
  if (Number.isNaN(at.getTime())) return 'Updated';
  return `Updated ${formatDay(todayIn(timeZone, at), today)}`;
}

/**
 * Pieces of the Home row meta line `🦆 Shea · Tue 20 Oct`.
 * `date` is null without a due date; when missed it reads `Missed · Tue 6 Oct`.
 * A state (To maintain) reads `🦊 Ela · Updated Tue 6 Oct`, from updated_at in `timeZone`
 * (the household's; pass data.household.timezone).
 */
export function itemMeta(
  item: Item,
  members: Member[],
  today: ISODate,
  timeZone: string = FALLBACK_TIME_ZONE,
): { who: string; date: string | null; missed: boolean } {
  const who = memberLabel(members.find((m) => m.id === item.assignee_id));
  if (isState(item)) return { who, date: updatedLabel(item.updated_at, today, timeZone), missed: false };
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

/** README "New item" defaults (a To do). */
export function newItemDraft(areaId: string, today: ISODate): ItemDraft {
  return {
    area_id: areaId,
    kind: NEW_ITEM_DEFAULTS.kind,
    title: '',
    note: '',
    good: '',
    rag: NEW_ITEM_DEFAULTS.rag,
    due_date: addDays(today, NEW_ITEM_DEFAULTS.due_in_days),
    assignee_id: null,
    repeat: NEW_ITEM_DEFAULTS.repeat,
    notify: NEW_ITEM_DEFAULTS.notify,
  };
}

export function draftOf(item: Item): ItemDraft {
  const { area_id, title, note, rag, due_date, assignee_id, repeat, notify } = item;
  // Rows stored before kinds existed read as tasks, and before "What good looks like" as ''.
  return {
    area_id,
    kind: item.kind ?? 'task',
    title,
    note,
    good: item.good ?? '',
    rag,
    due_date,
    assignee_id,
    repeat,
    notify,
  };
}

/**
 * The draft after choosing a kind in the Item sheet. Becoming a state keeps the task fields
 * in the draft (they are hidden, and dropped when saved), so switching back restores them.
 * "What good looks like" stays whatever the kind (a task just doesn't show it).
 * An item saved as a state (`savedKind`) that becomes a task gets the new-item defaults for
 * due date, repeat and notify.
 */
export function withKind(draft: ItemDraft, kind: ItemKind, today: ISODate, savedKind: ItemKind = draft.kind): ItemDraft {
  if (draft.kind === kind) return draft;
  if (kind === 'state') return { ...draft, kind };
  const bare =
    draft.due_date === STATE_FIELDS.due_date &&
    draft.repeat === STATE_FIELDS.repeat &&
    draft.notify === STATE_FIELDS.notify;
  if (savedKind !== 'state' || !bare) return { ...draft, kind };
  const fresh = newItemDraft(draft.area_id, today);
  return { ...draft, kind, due_date: fresh.due_date, repeat: fresh.repeat, notify: fresh.notify };
}

/** Seed items whose area is among `areaNames` (case-insensitive). */
export function seedItemsFor(areaNames: string[]): SeedItem[] {
  const names = new Set(areaNames.map((n) => n.trim().toLowerCase()));
  return SEED_ITEMS.filter((s) => names.has(s.area.toLowerCase()));
}
