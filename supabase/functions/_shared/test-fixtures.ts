// Builders for scheduler tests (not a test file itself).
import type { AreaRow, CompletionRow, HouseholdRow, ItemRow, MemberRow } from './types.ts';

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

export function household(over: Partial<HouseholdRow> = {}): HouseholdRow {
  return {
    id: nextId('h'),
    name: 'Home',
    address: '21 Alderbrook Road',
    timezone: 'Europe/London',
    weekly_email_day: 1,
    weekly_email_time: '08:00:00',
    ...over,
  };
}

export function member(h: HouseholdRow, over: Partial<MemberRow> = {}): MemberRow {
  const id = over.id ?? nextId('m');
  return {
    id,
    household_id: h.id,
    name: id,
    email: `${id}@example.com`,
    emoji: '🦔',
    role: 'member',
    weekly_email: true,
    push_enabled: true,
    created_at: `2026-01-01T00:00:${String(seq % 60).padStart(2, '0')}Z`,
    ...over,
  };
}

export function area(h: HouseholdRow, name: string, position = 0, over: Partial<AreaRow> = {}): AreaRow {
  return { id: nextId('a'), household_id: h.id, name, position, ...over };
}

export function item(a: AreaRow, over: Partial<ItemRow> = {}): ItemRow {
  return {
    id: nextId('i'),
    household_id: a.household_id,
    area_id: a.id,
    title: 'Something',
    note: '',
    rag: 'amber',
    due_date: null,
    assignee_id: null,
    notify: 'day_before',
    status: 'open',
    created_at: `2026-02-01T00:00:${String(seq % 60).padStart(2, '0')}Z`,
    ...over,
  };
}

export function completion(h: HouseholdRow, over: Partial<CompletionRow> = {}): CompletionRow {
  return {
    id: nextId('c'),
    household_id: h.id,
    item_id: null,
    item_title: 'Done thing',
    credited_to: null,
    completed_at: '2026-10-07T10:00:00Z',
    ...over,
  };
}
