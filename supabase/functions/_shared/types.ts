// Row shapes the scheduler reads (a subset of the columns in supabase/migrations, same
// names). Kept separate from src/lib/types.ts because Edge Functions cannot import app code.

import type { ISODate } from './dates.ts';

export type Rag = 'red' | 'amber' | 'green';
export type Notify = 'none' | 'same_day' | 'day_before' | 'week_before';
/** 'task' (To do) or 'state' (To maintain: never due, missed or reminded about). */
export type ItemKind = 'task' | 'state';

export interface HouseholdRow {
  id: string;
  name: string;
  address: string;
  /** IANA zone. */
  timezone: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekly_email_day: number;
  /** Postgres `time`: "08:00:00". */
  weekly_email_time: string;
}

export interface MemberRow {
  id: string;
  household_id: string;
  name: string;
  email: string;
  emoji: string;
  role: 'owner' | 'member';
  weekly_email: boolean;
  push_enabled: boolean;
  /** Join order. */
  created_at?: string;
}

export interface AreaRow {
  id: string;
  household_id: string;
  name: string;
  position: number;
}

export interface ItemRow {
  id: string;
  household_id: string;
  area_id: string;
  /** Missing reads as 'task'. The Edge Function marks states (see withItemKinds). */
  kind?: ItemKind;
  title: string;
  note: string;
  rag: Rag;
  due_date: ISODate | null;
  assignee_id: string | null;
  notify: Notify;
  status: 'open' | 'done';
  created_at?: string;
}

export interface CompletionRow {
  id: string;
  household_id: string;
  item_id: string | null;
  item_title: string;
  credited_to: string | null;
  completed_at: string;
}

export interface PushSubRow {
  id: string;
  member_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}
