import type {
  Area,
  AuthUser,
  ChatChange,
  ChatMessage,
  ChatPage,
  CreateHouseholdInput,
  HomeEntry,
  Household,
  HouseholdData,
  HousekeepingTask,
  HousekeepingTickTarget,
  HousekeepingVisitPatch,
  ImportPayload,
  InvitePreview,
  ISODate,
  ISOTimestamp,
  Item,
  ItemDraft,
  JoinHouseholdInput,
  Member,
  NewPersonInput,
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
  /** Another person in the home already has that email (addPerson, setPersonEmail). */
  | 'email_taken'
  /** importHousehold: a home exists already, so this one cannot be brought over. */
  | 'home_exists'
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
  /**
   * Where the signed-in person belongs, asked right after every sign-in (and again from
   * the "This home is private" screen). See HomeEntry. May claim: when a person who has not
   * joined yet has this account's verified email, the account becomes that person, atomically
   * (two sessions never both win). Supabase: RPC enter_home. Demo: the same rules, with the
   * demo account's email counting as verified, except that it never answers 'private' (a
   * demo sign-in always gets a home: theirs, a claimed one, or 'no_home' to create one).
   * Throws 'not_signed_in'.
   */
  enterHome(): Promise<HomeEntry>;
  /** The household the signed-in user belongs to, or null if none yet (no claim; enterHome() is the way in). */
  getMyHouseholdId(): Promise<string | null>;
  /**
   * Household, members, areas, open items, completions and housekeeping (the message, the
   * task list and every visit with its tasks; see HousekeepingData for the order).
   */
  load(householdId: string): Promise<HouseholdData>;
  /**
   * Calls onChange (debounce on your side) when anything in the household changes, here or
   * elsewhere: households, members (people added, claimed, edited or removed), areas, items,
   * completions and housekeeping (the message, the task list, visits and their ticks). Also
   * calls it whenever the live connection (re)joins, the first time included, because changes
   * made while it was down are never replayed: the caller reloads. See docs/ARCHITECTURE.md
   * "Sync guarantees".
   */
  subscribe(householdId: string, onChange: () => void): Unsubscribe;
  /**
   * The live connection may be dead: HomeProvider calls this (and only HomeProvider) when the
   * app comes back into view after 10 s or more hidden, on `pageshow` from the back/forward
   * cache, and on `online`. A phone that slept can hold a socket that reports open but died
   * without a close event, and the 25 s heartbeat takes up to a minute to notice, so the
   * Supabase backend does not trust it: it drops the socket and opens a fresh one (await
   * realtime.disconnect(), then realtime.connect()), at most once per 5 s. Every channel
   * rejoins when the socket opens, and each join asks for a reload (subscribe: onChange;
   * subscribeChat: resync). Returns at once; never throws. Demo: nothing to do (tabs share
   * one storage). docs/ARCHITECTURE.md "Sync guarantees".
   */
  reconnect(): void;

  /** Creates the household with the caller as owner; returns its id. Throws 'already_member'. */
  createHousehold(input: CreateHouseholdInput): Promise<string>;
  /**
   * Joins via invite token; returns household id. Throws 'invalid_invite' or 'already_member'.
   * When the household has a person who has not joined yet with the caller's verified email,
   * the caller becomes that person (their name, emoji and colour are kept; memberName and
   * memberEmoji are not applied) instead of being added a second time.
   * With `personId` ("Are you one of these people?", one of InvitePreview.people), the caller
   * becomes that person instead (Supabase: RPC join_as_person); 'not_found' when they cannot
   * be taken (joined meanwhile, removed, or given someone else's email).
   */
  joinHousehold(input: JoinHouseholdInput): Promise<string>;
  /**
   * "Not Shea?" on the welcome step after a claim: within a day of it, the signed-in account
   * stops being that person, who goes back to "Not joined yet" without the email (it matched
   * the wrong account). The account is then in no home. Supabase: RPC release_claim. Throws
   * 'not_found' when there is no claim from the last day.
   */
  releaseClaim(): Promise<void>;
  /**
   * Creates the home from the data this phone kept in demo mode (buildImportPayload() in
   * lib/logic/importHome.ts), all or nothing; returns the household id. The person marked
   * `me` becomes the caller (owner); everyone else is added as not joined yet, without an
   * email. When the caller is in a home that is untouched (HomeEntry.canImport), the phone's
   * home replaces what is in it instead, in place: its people stay (the caller as they are,
   * the phone's people matched by name, the rest added as not joined yet).
   * Supabase: RPC import_household. Throws 'already_member' (the caller is in a home that is
   * in use), 'home_exists' (a home exists and the caller is not in it), or
   * BackendError('unknown', 'invalid_input…') for a payload it refuses. The demo backend does
   * not import (it is where the data comes from): it throws BackendError('unknown', 'not
   * supported in demo mode').
   */
  importHousehold(payload: ImportPayload): Promise<string>;
  /**
   * Household name and address, the people waiting to join without an email, and the emojis
   * in use, for a valid, unexpired invite token; null otherwise.
   */
  getInvitePreview(token: string): Promise<InvitePreview | null>;
  /** Creates a reusable invite token (valid 14 days) for the caller's household. */
  createInvite(): Promise<string>;

  // ── Edits (any member may edit anything) ──────────────
  updateHousehold(id: string, patch: HouseholdPatch): Promise<void>;
  /** Name, emoji, weekly email and push of anyone in the home, joined or not (push stays off until they join). */
  updateMember(id: string, patch: MemberPatch): Promise<void>;

  // ── People who have not joined yet ────────────────────
  /**
   * Adds a person who has not joined yet (user_id null) and returns their row: role member,
   * the next colour in MEMBER_COLORS (like a join), push off, weekly email on (it starts once
   * they join). The email is optional; when they first sign in with it, they become this
   * person (enterHome). Supabase: RPC add_person, then the row. Throws
   * BackendError('unknown', 'invalid_input…') for a blank name or an email that fails
   * isValidEmail(), 'email_taken' when someone in the home has the email (any case), and
   * 'not_found' when the caller is not in `householdId`.
   */
  addPerson(householdId: string, input: NewPersonInput): Promise<Member>;
  /**
   * Sets, changes or clears ('') the email of a person who has not joined yet (trimmed and
   * lower-cased; the same value again is a no-op). Supabase: RPC set_person_email. Throws
   * 'email_taken', 'not_found' (no such person in the caller's home), or
   * BackendError('unknown', 'invalid_input…') when they have joined (their email is their
   * account's) or the value is not an email.
   */
  setPersonEmail(memberId: string, email: string): Promise<void>;
  /**
   * Removes a person who has not joined yet. Their items become unassigned and their
   * completions are credited to nobody (Stats leaves them out), as when any member row is
   * deleted.
   * Supabase: RPC remove_person. Throws 'not_found', or BackendError('unknown',
   * 'invalid_input…') when they have joined.
   */
  removePerson(memberId: string): Promise<void>;

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
   * characters. Visits already recorded keep their own copy. Clearing keeps the message it
   * took away for undoClearHousekeepingNote(); writing a new one forgets it.
   */
  setHousekeepingNote(householdId: string, body: string): Promise<void>;
  /**
   * Undo after Clear: puts back the message the last Clear took away, as it was (its text,
   * and who changed it and when; not a new edit by the caller). Changes nothing when the
   * message is no longer empty (someone wrote one since) or there is nothing to put back.
   */
  undoClearHousekeepingNote(householdId: string): Promise<void>;

  /**
   * Adds a task, trimmed, at the end of the list, and to today's visit (household time
   * zone) if there is one, not done. Returns the new task.
   */
  createHousekeepingTask(householdId: string, title: string): Promise<HousekeepingTask>;
  /**
   * Renames a task (trimmed, not blank). Today's visit, if there is one, shows the new
   * title too unless the task is already ticked there (a ticked row keeps the title it was
   * ticked under); earlier visits keep the title they had.
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
