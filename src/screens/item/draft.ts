import type { ItemPatch } from '../../lib/backend/types';
import { applyKindRules } from '../../lib/logic/items';
import type { ItemDraft } from '../../lib/types';

const FIELDS: (keyof ItemDraft)[] = [
  'area_id',
  'kind',
  'title',
  'note',
  'rag',
  'due_date',
  'assignee_id',
  'repeat',
  'notify',
];

/**
 * The draft as it is saved: title and note trimmed, and a state (To maintain) without the
 * due date, repeat and reminder it may still carry from being a task.
 */
export function normalizeDraft(draft: ItemDraft): ItemDraft {
  return applyKindRules({ ...draft, title: draft.title.trim(), note: draft.note.trim() });
}

/** Only the fields that differ from `base` (both normalised), ready for updateItem(). */
export function changedFields(base: ItemDraft, draft: ItemDraft): ItemPatch {
  const before = normalizeDraft(base);
  const after = normalizeDraft(draft);
  const patch: Record<string, unknown> = {};
  for (const key of FIELDS) {
    if (before[key] !== after[key]) patch[key] = after[key];
  }
  return patch as ItemPatch;
}

/** True when saving would change something. */
export function isDirty(base: ItemDraft, draft: ItemDraft): boolean {
  return Object.keys(changedFields(base, draft)).length > 0;
}

/** A title is required (and an area to put the item in). */
export function canSave(draft: ItemDraft): boolean {
  return draft.title.trim().length > 0 && draft.area_id !== '';
}

/** Titles are a single line: pasted line breaks become spaces. */
export function singleLine(text: string): string {
  return text.replace(/[ \t]*[\r\n]+[ \t]*/g, ' ');
}

/** At most `max` UTF-16 units (what maxLength counts), without splitting an emoji in two. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}
