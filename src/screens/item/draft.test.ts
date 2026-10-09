import type { ItemDraft } from '../../lib/types';
import { canSave, changedFields, clip, isDirty, normalizeDraft, singleLine } from './draft';

const base: ItemDraft = {
  area_id: 'a1',
  kind: 'task',
  title: 'Heaters not working',
  note: 'No heat since the weekend.',
  rag: 'red',
  due_date: '2026-10-06',
  assignee_id: 'm2',
  repeat: 'none',
  notify: 'day_before',
};

describe('item draft helpers', () => {
  it('trims the title and note', () => {
    expect(normalizeDraft({ ...base, title: '  Hi  ', note: '\nNote \n' })).toMatchObject({ title: 'Hi', note: 'Note' });
  });

  it('returns only the changed fields', () => {
    expect(changedFields(base, base)).toEqual({});
    expect(changedFields(base, { ...base, rag: 'green', due_date: null })).toEqual({ rag: 'green', due_date: null });
    expect(changedFields(base, { ...base, assignee_id: null, repeat: 'weekly', notify: 'none', area_id: 'a2' })).toEqual({
      assignee_id: null,
      repeat: 'weekly',
      notify: 'none',
      area_id: 'a2',
    });
  });

  it('ignores whitespace-only edits', () => {
    expect(changedFields(base, { ...base, title: `${base.title}  `, note: ` ${base.note}` })).toEqual({});
    expect(isDirty(base, { ...base, title: ` ${base.title}` })).toBe(false);
    expect(changedFields(base, { ...base, title: ' New title ' })).toEqual({ title: 'New title' });
  });

  it('is dirty when anything changes', () => {
    expect(isDirty(base, base)).toBe(false);
    expect(isDirty(base, { ...base, note: '' })).toBe(true);
    expect(isDirty(base, { ...base, due_date: '2026-10-07' })).toBe(true);
  });

  it('needs a title and an area to save', () => {
    expect(canSave(base)).toBe(true);
    expect(canSave({ ...base, title: '   ' })).toBe(false);
    expect(canSave({ ...base, area_id: '' })).toBe(false);
  });

  it('keeps titles on one line', () => {
    expect(singleLine('Heaters\nnot working')).toBe('Heaters not working');
    expect(singleLine('Heaters  \r\n\n  not working')).toBe('Heaters not working');
    expect(singleLine('No breaks')).toBe('No breaks');
  });

  it('clips text to a length without splitting an emoji', () => {
    expect(clip('Fix the gate', 20)).toBe('Fix the gate');
    expect(clip('Fix the gate', 3)).toBe('Fix');
    // '🦔' is two UTF-16 units: cutting through it drops the whole emoji.
    expect(clip('ab🦔c', 3)).toBe('ab');
    expect(clip('ab🦔c', 4)).toBe('ab🦔');
  });

  it('saves a state without its hidden due date, repeat and reminder', () => {
    const task = { ...base, repeat: 'monthly' as const };
    const state = { ...task, kind: 'state' as const };
    expect(normalizeDraft(state)).toMatchObject({ kind: 'state', due_date: null, repeat: 'none', notify: 'none' });
    expect(changedFields(task, state)).toEqual({ kind: 'state', due_date: null, repeat: 'none', notify: 'none' });
    expect(isDirty(task, state)).toBe(true);
  });

  it('a state turning into a task sends the kind and the fields it now has', () => {
    const state = { ...base, kind: 'state' as const, due_date: null, notify: 'none' as const };
    const task = { ...state, kind: 'task' as const, due_date: '2026-10-15', notify: 'day_before' as const };
    expect(changedFields(state, task)).toEqual({ kind: 'task', due_date: '2026-10-15', notify: 'day_before' });
  });

  it('editing a state ignores the hidden task fields', () => {
    const state = { ...base, kind: 'state' as const, due_date: null, notify: 'none' as const };
    // A draft that still carries task fields from before it became a state.
    const draft = { ...state, due_date: '2026-11-01', notify: 'week_before' as const, rag: 'green' as const };
    expect(changedFields(state, draft)).toEqual({ rag: 'green' });
    expect(isDirty(state, { ...draft, rag: state.rag })).toBe(false);
  });
});
