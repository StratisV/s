import type {
  Area,
  AuthUser,
  ChatChange,
  ChatMessage,
  ChatPage,
  CreateHouseholdInput,
  Household,
  HouseholdData,
  InvitePreview,
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
 * (household details, areas, items, completions, other members' profiles).
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
  /** Household, members, areas, open items and completions. */
  load(householdId: string): Promise<HouseholdData>;
  /** Calls onChange (debounce on your side) when anything in the household changes elsewhere. */
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
}
