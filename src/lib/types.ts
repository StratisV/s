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
  /**
   * The person's account (Supabase auth user id), or null while they have not joined yet
   * ("Not joined yet"): someone at home added them (Household > People > Add Person, or the
   * import from a phone) and they become this person the first time they sign in with
   * `email`. Until then they can be assigned items and show in the person filter, Stats and
   * the Item sheet like anyone else; they get no pushes or weekly email. Use hasJoined() from
   * lib/logic/people.ts rather than comparing with null.
   */
  user_id: string | null;
  name: string;
  /**
   * Lower-case, trimmed Google email ('' when unknown). For someone who has joined, their
   * account's email. For someone who has not, the email they will sign in with ('' until
   * someone adds it). Unique within the home (case-insensitive; blank ones aside).
   */
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
  /** How it is now, e.g. "Restocked." */
  note: string;
  /**
   * "What good looks like": how a To maintain item should be kept, e.g. "Cover on when not
   * in use, logs dry and stacked". Every item has it (default ''), but only a state shows it,
   * so it survives switching kind back and forth.
   */
  good: string;
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
  /** "What good looks like" (shown for a state only). */
  good: string;
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
  /** The Housekeeping tab: the message, the task list and every visit (see HousekeepingData). */
  housekeeping: HousekeepingData;
}

export interface InvitePreview {
  household_name: string;
  address: string;
  /**
   * The people in the home who have not joined yet and have no email, in join order: the Join
   * screen asks "Are you one of these people?", so nobody ends up there twice
   * (JoinHouseholdInput.personId).
   */
  people: InvitePerson[];
  /** Every emoji in use in the home, so a newcomer starts on one nobody has. */
  emojis: string[];
}

/** Someone the home is waiting for, as an invite shows them. */
export interface InvitePerson {
  id: string;
  name: string;
  emoji: string;
}

/** An item from the client's notes list, seeded on household creation when asked. */
export interface SeedItem {
  area: string;
  /** Default 'task'. A 'state' is seeded without a due date, repeat or reminder. */
  kind?: ItemKind;
  title: string;
  note: string;
  /** "What good looks like", default ''. */
  good?: string;
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

/**
 * Where the signed-in person belongs (Backend.enterHome, RPC enter_home), asked right after
 * sign-in. `canImport` (member, claimed): the home is untouched (set up and not used since), so
 * the home this phone kept in demo mode may still replace what is in it (importHousehold).
 * The statuses:
 * - member: already in a home. Open it.
 * - claimed: someone at home had added a person with this account's verified email who had
 *   not joined yet. The account is now that person (their name, emoji, colour, items and Stats
 *   are kept). Open the home after a short welcome step (confirm or change the emoji).
 * - no_home: not in a home, and no home exists yet. Create one, or bring over the home this
 *   phone kept in demo mode.
 * - private: a home exists and nobody there has this account's email ("This home is
 *   private"). `email` is the account's email, lower case ('' if it has none), for someone at
 *   home to add in Profile > Household > People. `emailVerified` false means adding it would
 *   not help (never the case for a Google account). Nothing about the home is revealed.
 */
export type HomeEntry =
  | { status: 'member'; householdId: string; memberId: string; canImport: boolean }
  | { status: 'claimed'; householdId: string; memberId: string; canImport: boolean }
  | { status: 'no_home' }
  | { status: 'private'; email: string; emailVerified: boolean };

/** Household > People > Add Person: someone who has not joined yet. */
export interface NewPersonInput {
  /** Required; trimmed; at most TEXT_LIMITS.memberName characters. */
  name: string;
  /** From the emoji grid; blank becomes 🦔. */
  emoji: string;
  /**
   * The Google email they will sign in with, or '' to add it later. Trimmed and lower-cased
   * (normaliseEmail); must pass isValidEmail() (lib/logic/people.ts); unique in the home,
   * else BackendError('email_taken').
   */
  email: string;
}

/**
 * import_household's payload, version 1: the home this phone kept in demo mode
 * (localStorage homeos.demo.v1), built by buildImportPayload() in lib/logic/importHome.ts and
 * checked again by the database (docs/ARCHITECTURE.md "Bring over the home from this phone").
 * Keys name people, areas and items inside the payload only (1 to 64 characters, unique per
 * list); the database gives every row a fresh id.
 */
export interface ImportPayload {
  version: 1;
  /** Name 1 to 60 characters, address up to 120 (both trimmed); an unknown zone becomes Europe/London. */
  household: { name: string; address: string; timezone: string };
  /** 1 to 50, in join order. Exactly one has `me: true`: the person signing in with Google now. */
  people: ImportPerson[];
  /** Up to 100, in the home's order. */
  areas: ImportArea[];
  /** Up to 2000, open and done. */
  items: ImportItem[];
  /** Up to 20000: the Stats history. */
  completions: ImportCompletion[];
}

/**
 * A person in the imported home. `me` becomes the signed-in account (role owner, the account's
 * email); everyone else is added as not joined yet, with no email (the demo's emails are made
 * up), for someone to add theirs in People.
 */
export interface ImportPerson {
  key: string;
  /** 1 to 40 characters. */
  name: string;
  /** Up to 16 characters; blank becomes 🦔. */
  emoji: string;
  /** `#RRGGBB`; missing or not a colour: MEMBER_COLORS by position. */
  color?: string;
  me?: boolean;
}

export interface ImportArea {
  key: string;
  /** 1 to 60 characters. */
  name: string;
}

export interface ImportItem {
  key: string;
  /** An area key. */
  area: string;
  kind: ItemKind;
  /** 1 to 200 characters (trimmed). */
  title: string;
  /** Up to 4000 characters, kept as it is. */
  note: string;
  /** Up to 4000 characters, kept as it is. */
  good: string;
  rag: Rag;
  /** Null for a state (the kind rules apply). */
  due_date: ISODate | null;
  repeat: Repeat;
  notify: Notify;
  /** A state is never 'done'. */
  status: ItemStatus;
  /** Person keys or null. created_by and updated_by default to `me`. */
  assignee: string | null;
  created_by: string | null;
  updated_by: string | null;
  /** ISO 8601 with a zone. Missing: now; later than now: now. */
  created_at: ISOTimestamp | null;
  updated_at: ISOTimestamp | null;
  /** Done items only (missing: now); ignored for open ones. */
  completed_at: ISOTimestamp | null;
}

export interface ImportCompletion {
  /** An item key, or null when the item is gone. */
  item: string | null;
  /** 1 to 200 characters (trimmed). */
  item_title: string;
  /** Person keys or null. */
  credited_to: string | null;
  completed_by: string | null;
  completed_at: ISOTimestamp;
  prev_due_date: ISODate | null;
  prev_status: ItemStatus;
}

/** What "Bring over the home from this phone" shows about the demo home this browser holds. */
export interface DemoHomeSummary {
  householdName: string;
  address: string;
  /** Areas that come along. */
  areas: number;
  /** Open items that come along (To do and To maintain). */
  items: number;
  /** Things done that come along (Stats history; the demo's made-up history stays behind). */
  done: number;
  /** In join order; `me` is the person who becomes the signed-in account. */
  people: { name: string; emoji: string; me: boolean }[];
}

export interface JoinHouseholdInput {
  token: string;
  memberName: string;
  memberEmoji: string;
  /**
   * "Are you one of these people?": join as this person the home is waiting for
   * (InvitePreview.people), keeping their name, emoji and items; memberName and memberEmoji
   * are then not applied. Omitted or null: join as someone new.
   */
  personId?: string | null;
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

// ── Housekeeping (the weekly visit; docs/ARCHITECTURE.md "Housekeeping") ──
// Tables in supabase/migrations/20261010000400_housekeeping.sql. Every member (the
// housekeeper is one) reads and edits all of it.

/**
 * The household's "Message for the housekeeper" (table housekeeping_notes, one row per
 * household). It stays until someone changes or clears it. A household that never wrote
 * one reads as `{ body: '', updated_at: null, updated_by: null }`.
 */
export interface HousekeepingNote {
  /** Multi-line, trimmed, up to TEXT_LIMITS.housekeepingNote characters. '' = no message. */
  body: string;
  /** When it was last changed (cleared included); null if never written. */
  updated_at: ISOTimestamp | null;
  /** Member who last changed it; null if never written or that member is gone. */
  updated_by: string | null;
}

/** One task on the household's housekeeping task list (the template every visit copies). */
export interface HousekeepingTask {
  id: string;
  household_id: string;
  /** Trimmed, 1 to TEXT_LIMITS.housekeepingTask characters. */
  title: string;
  /** Order on the list (0 first). New tasks go last. */
  position: number;
}

/**
 * One task as it stood on one visit (table housekeeping_visit_tasks): a copy of the task
 * list made when the visit was created, so renaming or deleting a task never rewrites an
 * earlier visit. One row per visit and task, ticked and unticked atomically.
 */
export interface HousekeepingVisitTask {
  id: string;
  visit_id: string;
  household_id: string;
  /** The task on the list it was copied from; null once that task is deleted. */
  task_id: string | null;
  /** The task's title as it was on that visit. */
  title: string;
  position: number;
  done: boolean;
  /** Who ticked it (null while not done, or if that member is gone). */
  done_by: string | null;
  /** When it was ticked (null while not done). */
  done_at: ISOTimestamp | null;
}

/**
 * One housekeeping visit: at most one per household and day (household time zone), never
 * in the future. Created by the first write for that day (a tick, comments, the price) or
 * by "Add a visit".
 */
export interface HousekeepingVisit {
  id: string;
  household_id: string;
  /** The day of the visit in the household's time zone. */
  visit_date: ISODate;
  /**
   * The message for the housekeeper as it stood that day: copied from HousekeepingNote when
   * the visit was created, if the note was last changed on or before visit_date (household
   * time), else ''. Never changed afterwards (read-only in the app).
   */
  note: string;
  /** Free text, trimmed, up to TEXT_LIMITS.housekeepingComments characters. */
  comments: string;
  /** Price for the day in whole pence (0 to HOUSEKEEPING_PRICE_MAX_PENCE); null = not entered. */
  price_pence: number | null;
  /** Who recorded the visit (the first write); null if that member is gone. */
  created_by: string | null;
  created_at: ISOTimestamp;
  /** Who changed it last (a tick, comments or price); null if that member is gone. */
  updated_by: string | null;
  updated_at: ISOTimestamp;
  /** Its tasks by position, then title, then id. */
  tasks: HousekeepingVisitTask[];
}

/** The housekeeping part of HouseholdData, loaded with the rest of the household. */
export interface HousekeepingData {
  note: HousekeepingNote;
  /** The task list, by position (then created_at, then id). */
  tasks: HousekeepingTask[];
  /** Every visit (kept forever), newest first (visit_date descending). */
  visits: HousekeepingVisit[];
}

/**
 * Which checklist row a tick is for. A row whose task is still on the list is named by
 * that task (`taskId`): this also works for a day with no visit yet, which the tick then
 * creates. A row whose task has since been deleted (task_id null) is named by its own id
 * (`visitTaskId`). checklistFor() in src/lib/logic/housekeeping.ts picks the right one.
 */
export type HousekeepingTickTarget = { taskId: string } | { visitTaskId: string };

/** Fields of a visit the app saves (only the keys present are written). */
export interface HousekeepingVisitPatch {
  /** Trimmed by the backend; up to TEXT_LIMITS.housekeepingComments characters. */
  comments?: string;
  /** Whole pence, 0 to HOUSEKEEPING_PRICE_MAX_PENCE, or null to clear the price. */
  price_pence?: number | null;
}
