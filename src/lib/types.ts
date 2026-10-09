// Domain types shared by the UI, both backends (Supabase and demo) and the
// Supabase schema (supabase/migrations). Field names match the SQL columns.

/** Calendar date without time, `YYYY-MM-DD`. */
export type ISODate = string;
/** Timestamp with time zone as returned by Postgres, ISO 8601. */
export type ISOTimestamp = string;

export type Rag = 'red' | 'amber' | 'green';
export type Repeat = 'none' | 'weekly' | 'monthly' | 'quarterly' | 'biannual' | 'yearly';
export type Notify = 'none' | 'same_day' | 'day_before' | 'week_before';
export type ItemStatus = 'open' | 'done';
/**
 * 'task' (shown as "To do"): something to get done; Mark as Done completes it.
 * 'state' (shown as "To maintain"): a thing whose condition is kept track of (the firepit,
 * the jacuzzi). It is never done and stays on the list, and has no due date, repeat or
 * reminder (the database forces due_date null, repeat 'none', notify 'none').
 */
export type ItemKind = 'task' | 'state';
export type Role = 'owner' | 'member';
export type StatsPeriod = 'month' | 'lifetime';

export interface Household {
  id: string;
  name: string;
  /** Shown under the Home title, e.g. "21 Alderbrook Road". */
  address: string;
  /** IANA zone, e.g. "Europe/London". "Today", "missed" and "this month" use it. */
  timezone: string;
  /** 0 = Sunday … 6 = Saturday. Default 1 (Monday). */
  weekly_email_day: number;
  /** `HH:MM` (Postgres `time` may come back as `HH:MM:SS`). Default 08:00. */
  weekly_email_time: string;
}

export interface Member {
  id: string;
  household_id: string;
  user_id: string;
  name: string;
  email: string;
  emoji: string;
  /** Hex colour, assigned in join order from MEMBER_COLORS. */
  color: string;
  role: Role;
  weekly_email: boolean;
  push_enabled: boolean;
  created_at: ISOTimestamp;
}

export interface Area {
  id: string;
  household_id: string;
  name: string;
  position: number;
}

export interface Item {
  id: string;
  household_id: string;
  area_id: string;
  /** 'task' (To do) or 'state' (To maintain). */
  kind: ItemKind;
  title: string;
  note: string;
  rag: Rag;
  /** Always null for a state. */
  due_date: ISODate | null;
  assignee_id: string | null;
  /** Always 'none' for a state. */
  repeat: Repeat;
  /** Always 'none' for a state. */
  notify: Notify;
  status: ItemStatus;
  created_by: string | null;
  updated_by: string | null;
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;
}

/** Fields the UI can set when creating or editing an item. */
export interface ItemDraft {
  area_id: string;
  kind: ItemKind;
  title: string;
  note: string;
  rag: Rag;
  due_date: ISODate | null;
  assignee_id: string | null;
  repeat: Repeat;
  notify: Notify;
}

export interface Completion {
  id: string;
  household_id: string;
  item_id: string | null;
  item_title: string;
  /** Assignee at completion time, or the completer if the item was unassigned. */
  credited_to: string | null;
  completed_by: string | null;
  completed_at: ISOTimestamp;
}

export interface AuthUser {
  id: string;
  email: string;
  /** Full name from Google (may be empty). */
  name: string;
  avatarUrl?: string;
}

/** Everything the signed-in member's screens need, loaded in one go. */
export interface HouseholdData {
  household: Household;
  /** Join order (created_at ascending). */
  members: Member[];
  /** By `position` ascending. */
  areas: Area[];
  /** Open items only (status = 'open'). Order is not guaranteed; sort with sortItems(). */
  items: Item[];
  /** All completions for the household (used by Stats). */
  completions: Completion[];
}

export interface InvitePreview {
  household_name: string;
  address: string;
}

/** An item from the client's notes list, seeded on household creation when asked. */
export interface SeedItem {
  area: string;
  /** Default 'task'. A 'state' is seeded without a due date, repeat or reminder. */
  kind?: ItemKind;
  title: string;
  note: string;
  rag: Rag;
  /** Due date relative to the creation day in the household's time zone. */
  due_in_days: number | null;
  repeat: Repeat;
  notify: Notify;
  /** Demo mode only: who it is assigned to among the demo people ('me' = the signed-in user). */
  demo_assignee?: 'me' | 'shea' | 'ela';
}

export interface CreateHouseholdInput {
  name: string;
  address: string;
  timezone: string;
  memberName: string;
  memberEmoji: string;
  areas: string[];
  /** Items to seed (subset of SEED_ITEMS whose area exists), or [] for none. */
  items: SeedItem[];
}

export interface JoinHouseholdInput {
  token: string;
  memberName: string;
  memberEmoji: string;
}

/** Web Push subscription as produced by PushSubscription.toJSON(). */
export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** One emoji reaction by one member on a chat message. */
export interface ChatReaction {
  message_id: string;
  member_id: string;
  emoji: string;
  created_at: ISOTimestamp;
}

/** A message in the household's group chat. Messages are kept forever. */
export interface ChatMessage {
  id: string;
  household_id: string;
  /** The sender; null if their member row no longer exists. */
  member_id: string | null;
  body: string;
  created_at: ISOTimestamp;
  /** Every reaction on the message, oldest first. */
  reactions: ChatReaction[];
}

/** A page of chat history, oldest message first. */
export interface ChatPage {
  messages: ChatMessage[];
  /** True when older messages exist before the first one in this page. */
  hasMore: boolean;
}

/**
 * What changed in the chat, as reported by Backend.subscribeChat. 'resync'
 * means "something may have changed; reload the latest page".
 */
export type ChatChange =
  | { type: 'message'; messageId: string; deleted: boolean }
  | { type: 'reaction'; messageId: string }
  | { type: 'resync' };
