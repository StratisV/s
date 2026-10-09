import type {
  Area,
  AuthUser,
  ChatChange,
  ChatMessage,
  ChatPage,
  CreateHouseholdInput,
  Household,
  HouseholdData,
  HousekeepingTask,
  HousekeepingTickTarget,
  HousekeepingVisitPatch,
  InvitePreview,
  ISODate,
  ISOTimestamp,
  Item,
  ItemDraft,
  JoinHouseholdInput,
  Member,
  PushSubscriptionInput,
} from '../types';

export type Unsubscribe = () => void;

export type HouseholdPatch = Partial<Pick<Household, 'name' | 'address' | 'timezone'>>;
export type MemberPatch = Partial<Pick<Member, 'name' | 'emoji' | 'weekly_email' | 'push_enabled'>>;
export type ItemPatch = Partial<ItemDraft>;

/**
 * Error codes a backend may throw (as BackendError.code) so the UI can show
 * a friendly message. Anything else is shown as a generic failure.
 */
export type BackendErrorCode =
  | 'not_signed_in'
  | 'already_member'
  | 'invalid_invite'
  | 'not_found'
  | 'network'
  | 'unknown';

export class BackendError extends Error {
  constructor(
    public code: BackendErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'BackendError';
  }
}

/**
 * Everything the app needs from a backend. Two implementations:
 * - SupabaseBackend (src/lib/backend/supabase.ts): production.
 * - DemoBackend (src/lib/backend/demo.ts): localStorage, used when no
 *   Supabase env vars are configured, and by the e2e tests.
 *
 * Permissions: every member of a household may edit everything in it
 * (household details, areas, items, completions, other members' profiles,
 * and all of housekeeping).
 */
export interface Backend {
  readonly kind: 'supabase' | 'demo';

  // ── Auth ──────────────────────────────────────────────
  /** Current user, or null when signed out. */
  getUser(): Promise<AuthUser | null>;
  /** Fires on sign-in/sign-out (not on token refresh). */
  onAuthChange(cb: (user: AuthUser | null) => void): Unsubscribe;
  /** Starts Google sign-in. Supabase redirects away; demo resolves immediately. */
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  /**
   * The error from a failed or cancelled Google sign-in redirect, once (then null).
   * Supabase reads it from the URL on start-up and removes it; demo always returns null.
   */
  takeAuthError(): string | null;

  // ── Household membership ──────────────────────────────
  /** The household the signed-in user belongs to, or null if none yet. */
  getMyHouseholdId(): Promise<string | null>;
  /**
   * Household, members, areas, open items, completions and housekeeping (the message, the
   * task list and every visit with its tasks; see HousekeepingData for the order).
   */
  load(householdId: string): Promise<HouseholdData>;
  /**
   * Calls onChange (debounce on your side) when anything in the household changes elsewhere,
   * housekeeping included (the message, the task list, visits and their ticks).
   */
  subscribe(householdId: string, onChange: () => void): Unsubscribe;

  /** Creates the household with the caller as owner; returns its id. Throws 'already_member'. */
  createHousehold(input: CreateHouseholdInput): Promise<string>;
  /** Joins via invite token; returns household id. Throws 'invalid_invite' or 'already_member'. */
  joinHousehold(input: JoinHouseholdInput): Promise<string>;
  /** Household name/address for a valid, unexpired invite token; null otherwise. */
  getInvitePreview(token: string): Promise<InvitePreview | null>;
  /** Creates a reusable invite token (valid 14 days) for the caller's household. */
  createInvite(): Promise<string>;

  // ── Edits (any member may edit anything) ──────────────
  updateHousehold(id: string, patch: HouseholdPatch): Promise<void>;
  updateMember(id: string, patch: MemberPatch): Promise<void>;

  createArea(householdId: string, name: string): Promise<Area>;
  renameArea(id: string, name: string): Promise<void>;
  /** Deletes the area and its items. */
  deleteArea(id: string): Promise<void>;
  /** Sets positions to match the given order (all area ids of the household). */
  reorderAreas(householdId: string, orderedIds: string[]): Promise<void>;

  createItem(householdId: string, draft: ItemDraft): Promise<Item>;
  updateItem(id: string, patch: ItemPatch): Promise<void>;
  deleteItem(id: string): Promise<void>;

  /**
   * Logs a completion credited to the assignee (or the caller if unassigned).
   * Repeating items stay open with the next due date; others become done.
   * Returns the completion id (for undo).
   */
  completeItem(id: string): Promise<string>;
  /** Reverts a completion: deletes it and restores the item's status and due date. */
  undoCompletion(completionId: string): Promise<void>;

  // ── Push ──────────────────────────────────────────────
  savePushSubscription(memberId: string, sub: PushSubscriptionInput): Promise<void>;
  deletePushSubscription(endpoint: string): Promise<void>;

  // ── Chat: one group chat per household, kept forever ──
  /**
   * Up to `limit` (default CHAT_PAGE_SIZE) of the newest messages created
   * strictly before `before` (or the newest overall), returned oldest first,
   * each with all its reactions.
   */
  listMessages(householdId: string, opts?: { before?: ISOTimestamp; limit?: number }): Promise<ChatPage>;
  /** These messages (with reactions) if they still exist; deleted ids are simply missing. */
  getMessages(ids: string[]): Promise<ChatMessage[]>;
  /**
   * Posts as the signed-in member. The body is trimmed; blank or longer than
   * TEXT_LIMITS.chatMessage throws BackendError('unknown', 'invalid_input: body').
   */
  sendMessage(householdId: string, body: string): Promise<ChatMessage>;
  /** Deletes one of your own messages (and its reactions). Someone else's: 'not_found'. */
  deleteMessage(id: string): Promise<void>;
  /** Adds (on = true) or removes your `emoji` reaction on a message. Idempotent. */
  setReaction(messageId: string, emoji: string, on: boolean): Promise<void>;
  /** Reports chat changes made by anyone (including this device) while subscribed. */
  subscribeChat(householdId: string, onChange: (change: ChatChange) => void): Unsubscribe;

  // ── Housekeeping (docs/ARCHITECTURE.md "Housekeeping") ──
  // Read through load(); live through subscribe(). Every member edits everything here.
  // Shared rules for the methods that take a visit `date` (an ISODate in the household's
  // time zone):
  //   - a date after today (household time zone) throws BackendError('unknown',
  //     'invalid_input…'): visits are never in the future;
  //   - when the household has no visit on that date yet, the write first creates it,
  //     copying the task list (title and position of every task, none done) and the
  //     message (HousekeepingVisit.note), recorded by the caller (created_by), and the
  //     write and the creation happen together or not at all;
  //   - every write to a visit sets its updated_at and updated_by (the caller).
  // A household the caller is not in, or an id from another household, is 'not_found'.
  // Too long a text, a blank task title or a price out of range is
  // BackendError('unknown', 'invalid_input…'), and nothing changes.

  /**
   * Replaces the "Message for the housekeeper" with `body`, trimmed ('' clears it), and
   * stamps who and when (HousekeepingNote.updated_by/updated_at). Writing the text it
   * already has changes nothing (the stamp stays). Up to TEXT_LIMITS.housekeepingNote
   * characters. Visits already recorded keep their own copy.
   */
  setHousekeepingNote(householdId: string, body: string): Promise<void>;

  /**
   * Adds a task, trimmed, at the end of the list, and to today's visit (household time
   * zone) if there is one, not done. Returns the new task.
   */
  createHousekeepingTask(householdId: string, title: string): Promise<HousekeepingTask>;
  /**
   * Renames a task (trimmed, not blank). Today's visit, if there is one, shows the new
   * title too; earlier visits keep the title they had.
   */
  renameHousekeepingTask(id: string, title: string): Promise<void>;
  /**
   * Deletes a task from the list. Today's visit loses it unless it is already ticked there;
   * earlier visits keep it (their copy's task_id becomes null).
   */
  deleteHousekeepingTask(id: string): Promise<void>;
  /**
   * Sets positions to match the given order (all task ids of the household; ids from
   * elsewhere are ignored). Today's visit, if there is one, follows the new order.
   */
  reorderHousekeepingTasks(householdId: string, orderedIds: string[]): Promise<void>;

  /**
   * Ticks (done = true) or unticks one task on the visit on `date`, creating the visit if
   * needed (see the rules above). Ticking stamps done_by (the caller) and done_at; unticking
   * clears both. Setting the state it already has changes nothing. Only that one row
   * changes, atomically, so two people ticking different tasks at once never undo each
   * other. A `{ taskId }` that is not on that visit, or a `{ visitTaskId }` that does not
   * exist, is 'not_found' (and no visit is created). Returns the visit's id.
   */
  setHousekeepingTaskDone(
    householdId: string,
    date: ISODate,
    target: HousekeepingTickTarget,
    done: boolean,
  ): Promise<string>;
  /**
   * Saves the comments and/or the price of the visit on `date` (only the keys present),
   * creating the visit if needed. Comments are trimmed. Returns the visit's id.
   */
  saveHousekeepingVisit(householdId: string, date: ISODate, patch: HousekeepingVisitPatch): Promise<string>;
  /**
   * "Add a visit": creates the visit on `date` (a past day, or today) with nothing ticked,
   * or returns the one already there. Returns the visit's id.
   */
  addHousekeepingVisit(householdId: string, date: ISODate): Promise<string>;
  /** Deletes a visit and its tasks, for everyone. Already gone or elsewhere: 'not_found'. */
  deleteHousekeepingVisit(id: string): Promise<void>;
}
