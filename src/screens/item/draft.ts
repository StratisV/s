import type { ItemPatch } from '../../lib/backend/types';
import type { ItemDraft } from '../../lib/types';

const FIELDS: (keyof ItemDraft)[] = ['area_id', 'title', 'note', 'rag', 'due_date', 'assignee_id', 'repeat', 'notify'];

/** The draft as it is saved: title and note trimmed. */
export function normalizeDraft(draft: ItemDraft): ItemDraft {
  return { ...draft, title: draft.title.trim(), note: draft.note.trim() };
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
