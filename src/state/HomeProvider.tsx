import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackendError, type Backend, type HouseholdPatch, type ItemPatch, type MemberPatch } from '../lib/backend/types';
import { STATE_FIELDS } from '../lib/constants';
import { formatDay, todayIn } from '../lib/logic/dates';
import {
  applyTick,
  applyVisitPatch,
  canHaveVisit,
  newVisit,
  visitOn,
  withTaskAdded,
  withTaskDeleted,
  withTaskRenamed,
  withTasksReordered,
} from '../lib/logic/housekeeping';
import { disablePush } from '../lib/push';
import { forgetSharedLink } from '../lib/sharedLink';
import { applyKindRules, nextDueDate } from '../lib/logic/items';
import {
  buildImportPayload,
  demoHomeMatches,
  demoHomeSummary,
  markDemoDeclined,
  markDemoImported,
  readDemoDoc,
} from '../lib/logic/importHome';
import { normaliseEmail } from '../lib/logic/people';
import type {
  Area,
  AuthUser,
  CreateHouseholdInput,
  DemoHomeSummary,
  HomeEntry,
  HouseholdData,
  HousekeepingData,
  HousekeepingNote,
  HousekeepingTask,
  HousekeepingTickTarget,
  HousekeepingVisit,
  HousekeepingVisitPatch,
  HousekeepingVisitTask,
  ISODate,
  ISOTimestamp,
  Item,
  ItemDraft,
  JoinHouseholdInput,
  Member,
  NewPersonInput,
} from '../lib/types';

/**
 * Where the app is. After sign-in, bootstrap asks Backend.enterHome() (docs/ARCHITECTURE.md
 * "One home") and settles on:
 * - 'ready' for 'member' and 'claimed' (claimed also sets `claimed` and `onboardingTail`),
 * - 'onboarding' for 'no_home',
 * - 'private' for 'private'.
 */
export type Phase =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  /**
   * Signed in, not in a home, and no home exists yet: create one (Profile, then Create home),
   * or bring over the demo home (`demoImport`). An invite link (pendingInvite) still opens the
   * Join flow, and only here may it offer "set up a new home instead".
   */
  | { kind: 'onboarding'; user: AuthUser }
  /**
   * Signed in, a home exists and nobody there has this account's email: "This home is
   * private". Says what to do ("Ask someone at home to add <email> in Profile > Household >
   * People"), offers Check again (recheckHome) and Sign Out, never "create a home". An invite
   * link (pendingInvite) still opens the Join flow from here (without "set up a new home").
   */
  | { kind: 'private'; user: AuthUser; email: string; emailVerified: boolean }
  | { kind: 'ready'; user: AuthUser }
  /**
   * Something failed before the home could open (no connection, say). `offline`: it was the
   * connection. retry() tries again, and runs by itself when the connection comes back or the
   * app comes back into view.
   */
  | { kind: 'error'; message: string; offline: boolean };

/**
 * What the offer of the home this browser kept in demo mode does (docs/ARCHITECTURE.md "Bring
 * over the home from this phone"):
 * - 'create': no home exists yet (phase 'onboarding'): Bring It Over creates the home from it.
 * - 'replace': the person is in a home that is untouched (HomeEntry.canImport; phase 'ready'
 *   with onboardingTail): Bring It Over puts the phone's home into it, in place.
 * - 'blocked': a home exists that is in use, or the person is not in one yet (phase 'private',
 *   or 'ready' with onboardingTail): it can't come over now, and the screen says so.
 */
export type DemoImportMode = 'create' | 'replace' | 'blocked';

export interface ToastState {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

export interface HomeContextValue {
  backend: Backend;
  phase: Phase;
  user: AuthUser | null;
  /** Loaded household data; non-null whenever phase is 'ready'. */
  data: HouseholdData | null;
  /** The signed-in member; non-null whenever phase is 'ready'. */
  me: Member | null;
  /** Today in the household's time zone (device zone before joining). Updates at midnight. */
  today: ISODate;
  /** Invite token from a `?invite=` link, kept across the Google redirect. */
  pendingInvite: string | null;
  /**
   * True right after creating/joining/claiming/importing a household, or when signing in finds
   * the home this phone kept in demo mode (demoImport in phase 'ready'): Onboarding shows its
   * last step(s).
   */
  onboardingTail: boolean;
  /**
   * True right after sign-in claimed a person someone at home had added (enterHome
   * 'claimed'), together with onboardingTail (phase 'ready', data loaded, `me` is that
   * person): Onboarding shows the short welcome step ("Welcome home, Shea": their name as
   * housemates set it, the emoji grid on their emoji) and confirmClaimed() moves on to the
   * notifications step. finishOnboarding() clears both.
   */
  claimed: boolean;
  /**
   * The claim welcome step's Continue: saves `emoji` when it differs from `me.emoji`
   * (updateMember, optimistic), then `claimed` becomes false and Onboarding shows the
   * notifications step (onboardingTail stays true). A failed save keeps the step (the usual
   * "not saved" toast) and rejects.
   */
  confirmClaimed(emoji: string): Promise<void>;
  /**
   * "Not Shea?" on the welcome step after a claim: Backend.releaseClaim() (the person goes back
   * to waiting to join, without the email that matched this account), then signs out. A
   * failure keeps the step, says why in a toast, and rejects.
   */
  releaseClaim(): Promise<void>;
  finishOnboarding(): void;
  /**
   * True right after bringing a home over (either way): Onboarding then asks for the Google
   * emails of the people who came along without one, before the notifications step.
   * doneInvitingPeople() moves on.
   */
  invitePeople: boolean;
  doneInvitingPeople(): void;
  /** Forget the pending invite (declined, or signing out). */
  dismissInvite(): void;

  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /**
   * Create home. On the Supabase backend it first asks enterHome() again: unless that is still
   * 'no_home' (someone set up the home meanwhile, or added this person), it moves to the
   * phase that gives and rejects with BackendError('home_exists') instead of creating a second
   * home. The database refuses a second home too (home_exists, when someone set one up between
   * that question and the create): then it asks enterHome() again and moves to that phase.
   */
  createHousehold(input: CreateHouseholdInput): Promise<void>;
  /**
   * Phase 'error': asks where this person belongs again (bootstrap, without the loading
   * splash). HomeProvider also runs it by itself on 'online', and when the app comes back into
   * view, while in that phase.
   */
  retry(): Promise<void>;
  /**
   * Join with an invite link. When the home has a person who has not joined yet with this
   * account's verified email, the account becomes that person (the typed name and emoji are
   * not applied); in practice enterHome has already claimed them at sign-in.
   */
  joinHousehold(input: JoinHouseholdInput): Promise<void>;
  refresh(): Promise<void>;

  // ── One home ──
  /**
   * On the Supabase backend only: the home this browser kept in demo mode
   * (readDemoDoc(localStorage) then demoHomeSummary()), with what can be done with it
   * (demoImportMode): offered as "Bring over the home from this phone" in phase 'onboarding'
   * ('create') and, while the person's home is untouched, in phase 'ready' with
   * onboardingTail ('replace'); otherwise shown as something that can't come over ('blocked',
   * on the private screen, and once in phase 'ready'). Null in demo mode, when there is none,
   * when it was brought over already (marked imported) or turned down for good (marked
   * declined), and after declineDemoImport().
   */
  demoImport: DemoHomeSummary | null;
  demoImportMode: DemoImportMode | null;
  /**
   * "Bring It Over": reads the demo document again, Backend.importHousehold(
   * buildImportPayload(doc)), then markDemoImported(localStorage, {at, household_id}), then
   * opens the home like a create (phase 'ready', onboardingTail: the notifications step
   * follows; no Profile step, the demo name and emoji come along). On 'home_exists' (someone
   * set up a home meanwhile) or 'already_member', it asks enterHome again and moves to the
   * phase that gives ('private', a claim, or that home), then rejects with the BackendError so
   * the screen can say why (errorMessage). Any other failure keeps the offer and rejects.
   */
  importDemoHome(): Promise<void>;
  /**
   * Turns the offer down. 'create' ("Start Fresh", after the screen asked): demoImport becomes
   * null for this session and the Profile and Create home steps follow; creating the home then
   * marks the document declined, so the offer never comes back. 'replace' (Keep) and 'blocked'
   * (OK): marks it declined at once, and the steps go on (or the home opens).
   */
  declineDemoImport(): void;
  /**
   * After Start Fresh, before a home is created: back to the offer (Profile's Back). True in
   * canReopenDemoImport while that is possible.
   */
  reopenDemoImport(): void;
  canReopenDemoImport: boolean;
  /**
   * Asks the server again where this person belongs (enterHome) and moves to the phase it
   * gives. The "This home is private" screen's Check Again; HomeProvider also runs it by
   * itself whenever the app comes back into view in phase 'private'. Never shows the loading
   * splash; a failure leaves the phase as it is and rejects (the screen shows errorMessage).
   */
  recheckHome(): Promise<void>;

  /**
   * Edits below apply at once (optimistically). If the write fails, just that
   * change is taken back, a toast says it was not saved, and the promise rejects.
   */
  updateHousehold(patch: HouseholdPatch): Promise<void>;
  updateMember(id: string, patch: MemberPatch): Promise<void>;
  /**
   * Household > People > Add Person. Not optimistic (the row comes back from the backend and
   * is added to data.members at once, then the reload). Rejects with BackendError
   * ('email_taken', or 'unknown' + 'invalid_input…'); the form shows why and keeps its input.
   */
  addPerson(input: NewPersonInput): Promise<Member>;
  /**
   * Sets, changes or clears ('') a not-yet-joined person's email (optimistic, stored as
   * normaliseEmail() gives it). Rejects like addPerson; the field shows why and keeps its text.
   */
  setPersonEmail(id: string, email: string): Promise<void>;
  /**
   * Removes a not-yet-joined person (optimistic: gone from data.members at once, their items
   * unassigned and their completions credited to nobody, as the database does).
   */
  removePerson(id: string): Promise<void>;
  createArea(name: string): Promise<Area>;
  renameArea(id: string, name: string): Promise<void>;
  deleteArea(id: string): Promise<void>;
  reorderAreas(orderedIds: string[]): Promise<void>;
  /** A state (To maintain) is created without a due date, repeat or reminder. */
  createItem(draft: ItemDraft): Promise<Item>;
  /**
   * Shows the change at once (with a fresh "Updated" day). An item that is, or becomes, a
   * state (To maintain) drops its due date, repeat and reminder, as the database does.
   */
  updateItem(id: string, patch: ItemPatch): Promise<void>;
  deleteItem(id: string): Promise<void>;
  /** Completes a task (optimistically) and shows an Undo toast. A state is never completed: no-op. */
  completeItem(id: string): Promise<void>;
  createInvite(): Promise<string>;

  // ── Housekeeping (data.housekeeping; docs/ARCHITECTURE.md "Housekeeping") ──
  // Same contract as the edits above: shown at once, and on failure only that change is
  // taken back, a "Couldn't save" toast shows and the promise rejects. Dates are ISODate
  // days in the household's time zone (`today` is today's); a day after today is refused
  // without writing (rejects with BackendError('unknown', 'invalid_input: date'), no toast).
  // The optimistic copies come from the helpers in src/lib/logic/housekeeping.ts
  // (newVisit, applyTick, applyVisitPatch, withTask*), stamped with `me` and the time now.

  /**
   * Saves the "Message for the housekeeper" (trimmed; '' clears it). Shown at once with
   * `me` and now as who changed it. Unchanged text: no write.
   */
  setHousekeepingNote(body: string): Promise<void>;
  /**
   * Undo after Clear: shows `previous` (the message as it was before Clear, with who wrote
   * it and when) again at once, and has the backend put it back as it was
   * (Backend.undoClearHousekeepingNote), after any message write still in flight. Nothing
   * happens when the message is no longer empty.
   */
  undoClearHousekeepingNote(previous: HousekeepingNote): Promise<void>;
  /**
   * Adds a task at the end of the list (and to today's visit, if any). Like createArea it
   * is not optimistic: resolves to the stored task once written, so the sheet can focus it.
   */
  createHousekeepingTask(title: string): Promise<HousekeepingTask>;
  /** Renames a task on the list and on today's visit unless ticked there (withTaskRenamed). */
  renameHousekeepingTask(id: string, title: string): Promise<void>;
  /** Deletes a task from the list; today's visit drops it unless ticked (withTaskDeleted). */
  deleteHousekeepingTask(id: string): Promise<void>;
  /** Reorders the task list (all its ids); today's visit follows (withTasksReordered). */
  reorderHousekeepingTasks(orderedIds: string[]): Promise<void>;
  /**
   * Ticks or unticks one row of the checklist for `date` (ChecklistRow.target). With no
   * visit that day yet, a pending visit (newVisit, rows `pending:<taskId>`) shows at once
   * and the backend creates the real one; the reload swaps it in under the same row keys.
   */
  setHousekeepingTaskDone(date: ISODate, target: HousekeepingTickTarget, done: boolean): Promise<void>;
  /**
   * Saves comments and/or the price for `date` (only the keys present), creating the visit
   * if there is none yet. The UI calls it only with values that differ from what is shown.
   */
  saveHousekeepingVisit(date: ISODate, patch: HousekeepingVisitPatch): Promise<void>;
  /** "Add a visit" on a past day (or today) without one: creates it, nothing ticked. */
  addHousekeepingVisit(date: ISODate): Promise<void>;
  /**
   * Deletes a visit (the UI confirms first). Taken off the calendar at once. A pending visit
   * (`pending:<date>`, shown before the write that creates it has come back, or before a
   * reload has brought its id) is deleted once that day's writes have settled, by the id
   * they returned; if none of them stored it, there is nothing to delete.
   */
  deleteHousekeepingVisit(id: string): Promise<void>;

  toast: ToastState | null;
  showToast(message: string, action?: ToastState['action']): void;
  dismissToast(): void;
  /** While held (focus or a pointer on the toast) the toast does not hide; it gets a fresh ~4s after. */
  holdToast(held: boolean): void;
}

const HomeContext = createContext<HomeContextValue | null>(null);

const INVITE_KEY = 'homeos.invite';
export const TOAST_MS = 4000;

// Sync guarantees (docs/ARCHITECTURE.md): how a failed background reload is retried, when coming
// back counts as a resume, and the safety net for a channel that silently stopped delivering.
/** A failed background reload is tried again after these delays, then every RETRY_EVERY_MS. */
export const RETRY_STEPS_MS = [1000, 2000, 4000, 8000] as const;
export const RETRY_EVERY_MS = 15_000;
/** Hidden at least this long: coming back reconnects and reloads at once. */
export const RESUME_AFTER_MS = 10_000;
/** No realtime event and no reload for this long while visible and ready: reload anyway. */
export const SAFETY_MS = 60_000;

const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/** The browser's storage, or null where it is unavailable (private mode, locked down). */
function localStore(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** "Bring over the home from this phone": what this browser kept in demo mode (Supabase only). */
function demoImportOffer(backend: Backend): DemoHomeSummary | null {
  if (backend.kind !== 'supabase') return null;
  try {
    return demoHomeSummary(readDemoDoc(localStore()));
  } catch {
    return null;
  }
}

function readInviteFromUrl(): string | null {
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('invite');
    if (token) {
      localStorage.setItem(INVITE_KEY, token);
      url.searchParams.delete('invite');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    return localStorage.getItem(INVITE_KEY);
  } catch {
    return null;
  }
}

function clearStoredInvite() {
  try {
    localStorage.removeItem(INVITE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof BackendError) {
    switch (err.code) {
      case 'already_member':
        return 'You are already part of a household.';
      case 'invalid_invite':
        return 'This invite link has expired or is not valid.';
      case 'not_signed_in':
        return 'Please sign in again.';
      case 'network':
        return 'No connection. Try again in a moment.';
      case 'not_found':
        return 'That was removed by someone else.';
      case 'email_taken':
        return 'Someone at home already has that email.';
      case 'home_exists':
        return 'A home has already been set up. Ask someone there to add you.';
      default:
        return 'Something went wrong. Try again.';
    }
  }
  return 'Something went wrong. Try again.';
}

/** The 'error' phase for a failure: `offline` when it was the connection (or the browser says it is offline). */
export function errorPhase(err: unknown): Extract<Phase, { kind: 'error' }> {
  const offline =
    (err instanceof BackendError && err.code === 'network') || (typeof navigator !== 'undefined' && navigator.onLine === false);
  return { kind: 'error', message: errorMessage(err), offline };
}

/** The toast for a failed edit: it was not saved (the screen shows it as before), and why. */
export function notSavedMessage(err: unknown, verb: 'save' | 'undo' = 'save'): string {
  const lead = `Couldn’t ${verb}.`;
  if (err instanceof BackendError) {
    switch (err.code) {
      case 'network':
        return `${lead} No connection.`;
      case 'not_found':
        return `${lead} That was removed by someone else.`;
      case 'not_signed_in':
        return `${lead} Please sign in again.`;
      case 'email_taken':
        return `${lead} Someone at home already has that email.`;
    }
  }
  return `${lead} Try again.`;
}

// ── Optimistic changes ───────────────────────────────────

type Revert = (cur: HouseholdData) => HouseholdData;

/**
 * An optimistic change: the new state, and how to take back only what it
 * touched (so other edits made in the meantime survive a failed write).
 * Returns null when there is nothing to change locally.
 */
type Change = (cur: HouseholdData) => { next: HouseholdData; revert: Revert } | null;

/** The current values of `keys` in `row`, to put back on failure. */
function pick<T extends object>(row: T, patch: Partial<T>): Partial<T> {
  const before: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) before[key] = row[key];
  return before;
}

function patchRow<T extends { id: string }>(rows: T[], id: string, patch: Partial<T>): T[] {
  return rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
}

/** Change some fields of one row; the revert restores just those fields. */
function patchChange<K extends 'members' | 'areas' | 'items'>(
  key: K,
  id: string,
  patch: Partial<HouseholdData[K][number]>,
): Change {
  type Row = HouseholdData[K][number];
  return (cur) => {
    const rows = cur[key] as Row[];
    const row = rows.find((r) => r.id === id);
    if (!row) return null;
    const before = pick<Row>(row, patch);
    return {
      next: { ...cur, [key]: patchRow<Row>(rows, id, patch) },
      revert: (c) => ({ ...c, [key]: patchRow<Row>(c[key] as Row[], id, before) }),
    };
  };
}

const withoutItem = (cur: HouseholdData, id: string): HouseholdData => ({
  ...cur,
  items: cur.items.filter((i) => i.id !== id),
});

/** Puts back rows that are missing (a refresh may already have brought them back). */
function restoreRows<T extends { id: string }>(rows: T[], removed: T[]): T[] {
  const missing = removed.filter((r) => !rows.some((x) => x.id === r.id));
  return missing.length ? [...rows, ...missing] : rows;
}

const byPosition = (a: Area, b: Area) => a.position - b.position;
const byJoin = (a: Member, b: Member) =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Removing a person who has not joined, as the database does: gone from the people, their
 * items unassigned, their completions credited to nobody. The revert puts back only what is
 * still as this left it.
 */
function removePersonChange(id: string): Change {
  return (cur) => {
    const person = cur.members.find((m) => m.id === id);
    if (!person) return null;
    const assigned = new Set(cur.items.filter((i) => i.assignee_id === id).map((i) => i.id));
    const credited = new Set(cur.completions.filter((c) => c.credited_to === id).map((c) => c.id));
    const completedBy = new Set(cur.completions.filter((c) => c.completed_by === id).map((c) => c.id));
    return {
      next: {
        ...cur,
        members: cur.members.filter((m) => m.id !== id),
        items: cur.items.map((i) => (assigned.has(i.id) ? { ...i, assignee_id: null } : i)),
        completions: cur.completions.map((c) =>
          credited.has(c.id) || completedBy.has(c.id)
            ? {
                ...c,
                credited_to: credited.has(c.id) ? null : c.credited_to,
                completed_by: completedBy.has(c.id) ? null : c.completed_by,
              }
            : c,
        ),
      },
      revert: (c) => ({
        ...c,
        members: restoreRows(c.members, [person]).sort(byJoin),
        items: c.items.map((i) => (assigned.has(i.id) && i.assignee_id === null ? { ...i, assignee_id: id } : i)),
        completions: c.completions.map((x) => ({
          ...x,
          credited_to: credited.has(x.id) && x.credited_to === null ? id : x.credited_to,
          completed_by: completedBy.has(x.id) && x.completed_by === null ? id : x.completed_by,
        })),
      }),
    };
  };
}

// ── Housekeeping changes (docs/ARCHITECTURE.md "Housekeeping") ──
// The optimistic copies come from src/lib/logic/housekeeping.ts; each revert puts back only
// what its write set, and only where the screen still shows what it set.

const withHousekeeping = (cur: HouseholdData, housekeeping: HousekeepingData): HouseholdData => ({ ...cur, housekeeping });

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Visits newest first, as loaded. */
const byVisitDate = (a: HousekeepingVisit, b: HousekeepingVisit) => compareText(b.visit_date, a.visit_date);
/** The task list by position (a stable sort keeps the loaded order otherwise). */
const byTaskPosition = (a: HousekeepingTask, b: HousekeepingTask) => a.position - b.position;
/** A visit's tasks by position, then title, then id, as loaded. */
const byRowOrder = (a: HousekeepingVisitTask, b: HousekeepingVisitTask) =>
  a.position - b.position || compareText(a.title, b.title) || compareText(a.id, b.id);

let lastStamp = 0;
/**
 * Now, for an optimistic "who and when": always later than the one before, so a revert can
 * tell its own stamp from a later edit's, even within one millisecond.
 */
function optimisticStamp(): ISOTimestamp {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

/** The id of the pending visit shown for a day until the stored one arrives. */
const pendingVisitId = (date: ISODate) => `pending:${date}`;

const VISIT_FIELDS = ['comments', 'price_pence'] as const;

/**
 * `visits` with the write that turned `before` into `after` taken back: the comments, the
 * price and each tick it changed return to their old values where they still hold the
 * values it set, and so does the "updated" stamp (who and when, together).
 */
function revertVisit(visits: HousekeepingVisit[], before: HousekeepingVisit, after: HousekeepingVisit): HousekeepingVisit[] {
  const was = new Map(before.tasks.map((r) => [r.id, r]));
  const set = new Map(after.tasks.map((r) => [r.id, r]));
  return visits.map((visit) => {
    if (visit.id !== after.id) return visit;
    const restored: Partial<HousekeepingVisit> = {};
    for (const key of VISIT_FIELDS) {
      if (after[key] !== before[key] && visit[key] === after[key]) Object.assign(restored, { [key]: before[key] });
    }
    const stamped = after.updated_at !== before.updated_at || after.updated_by !== before.updated_by;
    if (stamped && visit.updated_at === after.updated_at && visit.updated_by === after.updated_by) {
      restored.updated_at = before.updated_at;
      restored.updated_by = before.updated_by;
    }
    let ticksBack = false;
    const tasks = visit.tasks.map((row) => {
      const old = was.get(row.id);
      const mine = set.get(row.id);
      if (!old || !mine || old === mine) return row;
      if (row.done !== mine.done || row.done_by !== mine.done_by || row.done_at !== mine.done_at) return row;
      ticksBack = true;
      return { ...row, done: old.done, done_by: old.done_by, done_at: old.done_at };
    });
    if (!ticksBack && Object.keys(restored).length === 0) return visit;
    return { ...visit, ...restored, tasks: ticksBack ? tasks : visit.tasks };
  });
}

/**
 * An optimistic write to the visit on `date`: `edit` applied to that day's visit, or to a
 * pending one (newVisit(), id `pending:<date>`, rows `pending:<taskId>`) when there is none
 * yet, as the backend creates it on the write. Nothing changes on screen when `edit` gives
 * null (no such row) or the visit as it was. The revert removes a pending visit this write
 * added, or else takes back the fields and ticks it set.
 */
function visitChange(
  date: ISODate,
  userId: string | undefined,
  edit: (visit: HousekeepingVisit, meId: string, at: ISOTimestamp) => HousekeepingVisit | null,
): Change {
  return (cur) => {
    const meId = cur.members.find((m) => m.user_id === userId)?.id;
    if (!meId) return null;
    const at = optimisticStamp();
    const hk = cur.housekeeping;
    const existing = visitOn(hk.visits, date);
    const start =
      existing ??
      newVisit(hk, {
        id: pendingVisitId(date),
        householdId: cur.household.id,
        date,
        memberId: meId,
        at,
        timeZone: cur.household.timezone,
        rowId: (taskId) => `pending:${taskId}`,
      });
    const next = edit(start, meId, at);
    if (!next || next === existing) return null;
    const visits = existing
      ? hk.visits.map((v) => (v === existing ? next : v))
      : [...hk.visits, next].sort(byVisitDate);
    return {
      next: withHousekeeping(cur, { ...hk, visits }),
      revert: (c) => {
        const shown = c.housekeeping.visits;
        if (!existing) {
          // The pending visit goes (a later write to that day may have changed it too).
          if (!shown.some((v) => v.id === next.id)) return c;
          return withHousekeeping(c, { ...c.housekeeping, visits: shown.filter((v) => v.id !== next.id) });
        }
        return withHousekeeping(c, { ...c.housekeeping, visits: revertVisit(shown, existing, next) });
      },
    };
  };
}

/**
 * Deleting a task (withTaskDeleted()): off the list, today's undone row gone, every other
 * row unlinked. The revert puts back the task, the row it removed and the links it cleared.
 */
function deleteTaskChange(id: string, today: ISODate): Change {
  return (cur) => {
    const hk = cur.housekeeping;
    const task = hk.tasks.find((t) => t.id === id);
    if (!task) return null;
    const next = withTaskDeleted(hk, id, today);
    // What it touched: rows it removed (today's undone one), rows it unlinked (task_id null).
    const kept = new Set(next.visits.flatMap((v) => v.tasks.map((r) => r.id)));
    const removed: HousekeepingVisitTask[] = [];
    const unlinked = new Set<string>();
    for (const v of hk.visits) {
      for (const r of v.tasks) {
        if (r.task_id !== id) continue;
        if (kept.has(r.id)) unlinked.add(r.id);
        else removed.push(r);
      }
    }
    return {
      next: withHousekeeping(cur, next),
      revert: (c) => {
        const h = c.housekeeping;
        const tasks = h.tasks.some((t) => t.id === id) ? h.tasks : [...h.tasks, task].sort(byTaskPosition);
        const visits = h.visits.map((v) => {
          const back = removed.filter((r) => r.visit_id === v.id && !v.tasks.some((x) => x.id === r.id));
          const relink = v.tasks.some((r) => unlinked.has(r.id) && r.task_id === null);
          if (!back.length && !relink) return v;
          const rows = v.tasks.map((r) => (unlinked.has(r.id) && r.task_id === null ? { ...r, task_id: id } : r));
          return { ...v, tasks: [...rows, ...back].sort(byRowOrder) };
        });
        return withHousekeeping(c, { ...h, tasks, visits });
      },
    };
  };
}

/**
 * Reordering the task list (withTasksReordered()), today's visit following. The revert puts
 * back each position it set that still holds, on the list and on today's visit.
 */
function reorderTasksChange(orderedIds: string[], today: ISODate): Change {
  return (cur) => {
    const hk = cur.housekeeping;
    const next = withTasksReordered(hk, orderedIds, today);
    const wasTask = new Map(hk.tasks.map((t) => [t.id, t.position]));
    const setTask = new Map(next.tasks.map((t) => [t.id, t.position]));
    const wasRow = new Map((visitOn(hk.visits, today)?.tasks ?? []).map((r) => [r.id, r.position]));
    const setRow = new Map((visitOn(next.visits, today)?.tasks ?? []).map((r) => [r.id, r.position]));
    /** The old position where this reorder moved it and it still is there. */
    const back = (id: string, position: number, was: Map<string, number>, set: Map<string, number>) =>
      was.has(id) && set.get(id) === position && was.get(id) !== position ? was.get(id)! : position;
    return {
      next: withHousekeeping(cur, next),
      revert: (c) => {
        const h = c.housekeeping;
        const tasks = h.tasks.map((t) => ({ ...t, position: back(t.id, t.position, wasTask, setTask) })).sort(byTaskPosition);
        const visits = h.visits.map((v) =>
          v.visit_date !== today
            ? v
            : { ...v, tasks: v.tasks.map((r) => ({ ...r, position: back(r.id, r.position, wasRow, setRow) })).sort(byRowOrder) },
        );
        return withHousekeeping(c, { ...h, tasks, visits });
      },
    };
  };
}

export function HomeProvider({ backend, children }: { backend: Backend; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [user, setUser] = useState<AuthUser | null>(null);
  const [data, setData] = useState<HouseholdData | null>(null);
  const [pendingInvite, setPendingInvite] = useState<string | null>(() => readInviteFromUrl());
  const [onboardingTail, setOnboardingTail] = useState(false);
  /** onboardingTail as last set (actions decide from it before React renders). */
  const tailRef = useRef(false);
  const setTail = useCallback((on: boolean) => {
    tailRef.current = on;
    setOnboardingTail(on);
  }, []);
  const [claimed, setClaimed] = useState(false);
  const [demoImport, setDemoImport] = useState<DemoHomeSummary | null>(null);
  const [demoImportMode, setDemoImportMode] = useState<DemoImportMode | null>(null);
  /** The offer was turned down: it stays away for this session (and for good once marked declined). */
  const declinedImport = useRef(false);
  /** Start Fresh this session, no home created yet: Profile's Back can bring the offer back. */
  const [canReopenImport, setCanReopenImport] = useState(false);
  /** The tail is only there for the offer (a member signing in): turning it down opens the home. */
  const tailForOffer = useRef(false);
  const [invitePeople, setInvitePeople] = useState(false);
  /** A retry() is running (phase 'error'). */
  const retrying = useRef(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [now, setNow] = useState(() => new Date());
  const householdIdRef = useRef<string | null>(null);
  /** Always the data last set, so actions build on the newest state (not a render's copy). */
  const dataRef = useRef<HouseholdData | null>(null);
  const userRef = useRef<AuthUser | null>(null);

  // Load ordering. Every load takes a number; a refresh only shows its result
  // when nothing newer has been shown since it started. Starting or finishing
  // a write, signing out and leaving a household all move `shownSeq` on, so a
  // load already in flight can never bring back an older state.
  const loadSeq = useRef(0);
  const shownSeq = useRef(0);
  const pendingWrites = useRef(0);
  /** Bumped whenever the signed-in user is (re)decided; async work from before stops there. */
  const epoch = useRef(0);
  // Housekeeping writes. Per day: the stored visit's id as the last write that day returned
  // it, and the writes still in flight (so a pending visit can be deleted by its real id).
  const visitIds = useRef(new Map<ISODate, string>());
  const visitWrites = useRef(new Map<ISODate, Promise<unknown>>());
  /** The message writes still in flight (Undo after Clear goes after them). */
  const noteWrites = useRef<Promise<unknown>>(Promise.resolve());

  // Sync guarantees 3 and 6 (docs/ARCHITECTURE.md).
  /** Whether the phase is 'ready' (the retry runs only then). */
  const readyRef = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();
  const retryAttempt = useRef(0);
  /** When the last realtime event arrived or reload started (the 60 s safety net counts from it). */
  const lastActivity = useRef(Date.now());
  /** The newest refresh(), for the retry timer. */
  const refreshRef = useRef<() => Promise<boolean>>(async () => false);

  const toastRef = useRef<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const toastHeld = useRef(false);
  const toastSeq = useRef(0);

  const timeZone = data?.household.timezone;
  const today = useMemo(
    () => todayIn(timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC', now),
    [timeZone, now],
  );

  // Keep "today" fresh (midnight rollover, app resumed from background).
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, []);

  // ── Toast ──────────────────────────────────────────────

  const armToastTimer = useCallback(() => {
    clearTimeout(toastTimer.current);
    const current = toastRef.current;
    if (!current || toastHeld.current) return;
    toastTimer.current = setTimeout(() => {
      if (toastRef.current?.id !== current.id) return;
      toastRef.current = null;
      setToast(null);
    }, TOAST_MS);
  }, []);

  const dismissToast = useCallback(() => {
    clearTimeout(toastTimer.current);
    toastRef.current = null;
    setToast(null);
  }, []);

  const showToast = useCallback(
    (message: string, action?: ToastState['action']) => {
      const next = { id: ++toastSeq.current, message, action };
      toastRef.current = next;
      setToast(next);
      armToastTimer();
    },
    [armToastTimer],
  );

  const holdToast = useCallback(
    (held: boolean) => {
      if (toastHeld.current === held) return;
      toastHeld.current = held;
      if (held) clearTimeout(toastTimer.current);
      else armToastTimer();
    },
    [armToastTimer],
  );

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // ── Loading ────────────────────────────────────────────

  const commitData = useCallback((next: HouseholdData | null) => {
    dataRef.current = next;
    setData(next);
  }, []);

  const stopRetry = useCallback(() => {
    clearTimeout(retryTimer.current);
    retryTimer.current = undefined;
    retryAttempt.current = 0;
  }, []);

  /**
   * A background reload failed: try again after 1, 2, 4 and 8 s, then every 15 s, until one is
   * shown (loadHousehold stops it). A retry that comes due while the app is hidden or not ready
   * is skipped; coming back reloads anyway, and a failure there starts the next step.
   */
  const scheduleRetry = useCallback(() => {
    if (retryTimer.current !== undefined) return;
    const delay = RETRY_STEPS_MS[retryAttempt.current] ?? RETRY_EVERY_MS;
    retryAttempt.current += 1;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = undefined;
      if (readyRef.current && isVisible()) void refreshRef.current();
    }, delay);
  }, []);

  useEffect(() => () => clearTimeout(retryTimer.current), []);

  /** Nothing loaded may land after this (signed out, or no household). */
  const clearHousehold = useCallback(() => {
    householdIdRef.current = null;
    shownSeq.current = ++loadSeq.current;
    visitIds.current.clear();
    stopRetry();
    commitData(null);
  }, [commitData, stopRetry]);

  /**
   * Loads and shows the household. `force` (sign-in, create, join) always shows
   * the result for the same session; a refresh is dropped when something newer
   * has been shown since it started, or while a write is still in flight (the
   * write starts its own refresh when it settles). Resolves to whether it was shown.
   */
  const loadHousehold = useCallback(
    async (hid: string, force: boolean): Promise<boolean> => {
      const seq = ++loadSeq.current;
      const session = epoch.current;
      lastActivity.current = Date.now();
      const loaded = await backend.load(hid);
      if (session !== epoch.current) return false;
      if (!force && (seq <= shownSeq.current || pendingWrites.current > 0 || householdIdRef.current !== hid)) {
        return false;
      }
      shownSeq.current = force ? ++loadSeq.current : seq;
      householdIdRef.current = hid;
      stopRetry();
      commitData(loaded);
      return true;
    },
    [backend, commitData, stopRetry],
  );

  /**
   * Moves to where enterHome() says this person belongs (docs/ARCHITECTURE.md "One home"):
   * member or claimed → the home ('ready'; a claim also sets `claimed` and onboardingTail for
   * the welcome step), no_home → 'onboarding' (with the import offer when this browser has a
   * demo home), private → 'private'. Throws when the home cannot be loaded. Resolves to the
   * phase it settled on, or null if overtaken.
   */
  const enter = useCallback(
    async (u: AuthUser, entry: HomeEntry, session: number): Promise<Phase['kind'] | null> => {
      if (session !== epoch.current) return null;
      // The home this browser kept in demo mode, unless it was turned down.
      let offer = declinedImport.current ? null : demoImportOffer(backend);
      switch (entry.status) {
        case 'member':
        case 'claimed': {
          if (!(await loadHousehold(entry.householdId, true))) return null;
          if (session !== epoch.current) return null;
          // This is that home, brought over by a tap whose reply was lost: mark it now.
          const loaded = dataRef.current;
          if (offer && loaded && demoHomeMatches(readDemoDoc(localStore()), loaded)) {
            markDemoImported(localStore(), { at: new Date().toISOString(), household_id: loaded.household.id });
            offer = null;
          }
          if (entry.status === 'claimed') {
            setClaimed(true);
            setTail(true);
          }
          // In a home already: the phone's home may still replace it while it is untouched;
          // otherwise the person is told, once, that it can't come over.
          setDemoImport(offer);
          setDemoImportMode(offer ? (entry.canImport ? 'replace' : 'blocked') : null);
          if (offer) {
            if (!tailRef.current) tailForOffer.current = true;
            setTail(true);
          }
          setPhase({ kind: 'ready', user: u });
          return 'ready';
        }
        case 'no_home':
          clearHousehold();
          setDemoImport(offer);
          setDemoImportMode(offer ? 'create' : null);
          setPhase({ kind: 'onboarding', user: u });
          return 'onboarding';
        case 'private':
          clearHousehold();
          // A home exists that this person is not in: the phone's home can't come over now.
          setDemoImport(offer);
          setDemoImportMode(offer ? 'blocked' : null);
          setPhase({ kind: 'private', user: u, email: entry.email, emailVerified: entry.emailVerified });
          return 'private';
      }
    },
    [backend, loadHousehold, clearHousehold, setTail],
  );

  /** Decide the phase for a (possibly null) user. Resolves to the phase it settled on, or null if overtaken. */
  const bootstrap = useCallback(
    async (u: AuthUser | null): Promise<Phase['kind'] | null> => {
      const session = ++epoch.current;
      const previous = userRef.current;
      userRef.current = u;
      setUser(u);
      if (!u || (previous && previous.id !== u.id)) {
        // A welcome or notifications step, and turning the phone's home down, belong to the
        // person they were for.
        setClaimed(false);
        setTail(false);
        setInvitePeople(false);
        tailForOffer.current = false;
        declinedImport.current = false;
        setCanReopenImport(false);
      }
      if (!u) {
        clearHousehold();
        setPhase({ kind: 'signedOut' });
        return 'signedOut';
      }
      // Someone else signed in (another tab): never show them the previous person's home.
      if (previous && previous.id !== u.id) {
        clearHousehold();
        setPhase({ kind: 'loading' });
      }
      try {
        const entry = await backend.enterHome();
        return await enter(u, entry, session);
      } catch (err) {
        if (session !== epoch.current) return null;
        setPhase(errorPhase(err));
        return 'error';
      }
    },
    [backend, enter, clearHousehold, setTail],
  );

  /**
   * Phase 'error': decide again where this person belongs (as on start-up), without the loading
   * splash. One at a time. When even the signed-in user cannot be read, the phase stays 'error'.
   */
  const retry = useCallback(async () => {
    if (retrying.current) return;
    retrying.current = true;
    try {
      let u: AuthUser | null;
      try {
        u = await backend.getUser();
      } catch (err) {
        setPhase(errorPhase(err));
        return;
      }
      await bootstrap(u);
    } finally {
      retrying.current = false;
    }
  }, [backend, bootstrap]);

  // Phase 'error' (no connection when the app opened, say): try again by itself when the
  // connection comes back, when the app comes back into view, and every 15 s while in view.
  const isError = phase.kind === 'error';
  useEffect(() => {
    if (!isError) return;
    const again = () => void retry().catch(() => {});
    const onVisibility = () => {
      if (document.visibilityState === 'visible') again();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) again();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', again);
    const timer = setInterval(() => {
      if (isVisible()) again();
    }, RETRY_EVERY_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', again);
      clearInterval(timer);
    };
  }, [isError, retry]);

  /**
   * Asks enterHome() again and moves to the phase it gives, without the loading splash. A
   * failure leaves the phase as it is and rejects.
   */
  const recheckHome = useCallback(async (): Promise<Phase['kind'] | null> => {
    const u = userRef.current;
    if (!u) throw new BackendError('not_signed_in');
    const session = epoch.current;
    const entry = await backend.enterHome();
    return enter(u, entry, session);
  }, [backend, enter]);

  // Auth bootstrap + listener.
  useEffect(() => {
    let alive = true;
    let lastUserId: string | null | undefined;
    const handle = (u: AuthUser | null) => {
      if (!alive) return;
      const id = u?.id ?? null;
      if (id === lastUserId) return;
      lastUserId = id;
      void bootstrap(u);
    };
    backend
      .getUser()
      .then(handle)
      .catch((err) => alive && setPhase(errorPhase(err)));
    const unsub = backend.onAuthChange(handle);
    return () => {
      alive = false;
      unsub();
    };
  }, [backend, bootstrap]);

  /**
   * Reloads the household in the background. Resolves to whether fresh data was shown. A
   * failure keeps showing what we have and is retried (scheduleRetry).
   */
  const refresh = useCallback(async (): Promise<boolean> => {
    const hid = householdIdRef.current;
    if (!hid) return false;
    const session = epoch.current;
    try {
      return await loadHousehold(hid, false);
    } catch {
      if (session === epoch.current && householdIdRef.current === hid) scheduleRetry();
      return false;
    }
  }, [loadHousehold, scheduleRetry]);
  refreshRef.current = refresh;

  // Live updates from other members, and a reload whenever the app comes back
  // (docs/ARCHITECTURE.md "Sync guarantees").
  const ready = phase.kind === 'ready';
  readyRef.current = ready;
  useEffect(() => {
    const hid = householdIdRef.current;
    if (!ready || !hid) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const debounced = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 250);
    };
    const unsub = backend.subscribe(hid, () => {
      lastActivity.current = Date.now();
      debounced();
    });

    // Back after a while, from the back/forward cache, or back online: the socket may be dead
    // (a phone that slept), so reconnect, and reload at once. A short hide reloads as before.
    let hiddenAt = isVisible() ? null : Date.now();
    const resume = () => {
      setNow(new Date());
      backend.reconnect();
      clearTimeout(timer);
      void refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt ??= Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away >= RESUME_AFTER_MS) {
        resume();
      } else {
        setNow(new Date());
        debounced();
      }
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', resume);

    // Safety net: a channel that joined but silently stopped delivering. 60 s without a
    // realtime event or a reload, while in view: reload.
    lastActivity.current = Date.now();
    let safety: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const wait = lastActivity.current + SAFETY_MS - Date.now();
      if (wait > 0) {
        safety = setTimeout(check, wait);
        return;
      }
      lastActivity.current = Date.now();
      if (isVisible()) void refresh();
      safety = setTimeout(check, SAFETY_MS);
    };
    safety = setTimeout(check, SAFETY_MS);

    return () => {
      clearTimeout(timer);
      clearTimeout(safety);
      unsub();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', resume);
    };
  }, [ready, backend, refresh]);

  // "This home is private": ask again whenever the app comes back into view or online (someone
  // at home may have added this person meanwhile).
  const isPrivate = phase.kind === 'private';
  useEffect(() => {
    if (!isPrivate) return;
    const check = () => void recheckHome().catch(() => {});
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) check();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', check);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', check);
    };
  }, [isPrivate, recheckHome]);

  // An invite link opened by someone who is already a member: nothing to join.
  useEffect(() => {
    if (ready && pendingInvite && !onboardingTail) {
      clearStoredInvite();
      setPendingInvite(null);
    }
  }, [ready, pendingInvite, onboardingTail]);

  /**
   * Applies an optimistic change, runs the backend call, then reloads.
   * On failure: takes back just this change, says it was not saved, reloads
   * to resync (when online), and rethrows.
   */
  const mutate = useCallback(
    async <T,>(
      change: Change | null,
      op: () => Promise<T>,
      verb: 'save' | 'undo' = 'save',
      /** The screen says why itself (a form field): no toast. */
      quiet = false,
    ): Promise<T> => {
      const session = epoch.current;
      // Loads already in flight started before this change: never show them.
      shownSeq.current = ++loadSeq.current;
      let revert: Revert | null = null;
      const cur = dataRef.current;
      const applied = change && cur ? change(cur) : null;
      if (applied) {
        revert = applied.revert;
        commitData(applied.next);
      }
      pendingWrites.current += 1;
      try {
        return await op();
      } catch (err) {
        if (session === epoch.current) {
          const now = dataRef.current;
          if (revert && now) commitData(revert(now));
          if (!quiet) showToast(notSavedMessage(err, verb));
        }
        throw err;
      } finally {
        pendingWrites.current -= 1;
        // A load that started while the write was in flight may not include it.
        shownSeq.current = ++loadSeq.current;
        void refresh();
      }
    },
    [commitData, refresh, showToast],
  );

  const requireData = useCallback((): HouseholdData => {
    const d = dataRef.current;
    if (!d) throw new BackendError('not_found', 'No household loaded');
    return d;
  }, []);

  const me = useMemo(() => (data && user ? (data.members.find((m) => m.user_id === user.id) ?? null) : null), [data, user]);

  const value = useMemo<HomeContextValue>(() => {
    const completeItem = async (id: string) => {
      const item = requireData().items.find((i) => i.id === id);
      // A state (To maintain) stays on the list for good; the backend would refuse it.
      if (!item || item.kind === 'state') return;
      const next = nextDueDate(item.repeat, item.due_date, today);
      // A repeating item moves to its next date; a one-off leaves the list.
      const done: Revert = (cur) =>
        next ? { ...cur, items: patchRow(cur.items, id, { due_date: next }) } : withoutItem(cur, id);
      const undone: Revert = (cur) =>
        next
          ? { ...cur, items: patchRow(cur.items, id, { due_date: item.due_date }) }
          : { ...cur, items: restoreRows(cur.items, [item]) };
      const completionId = await mutate(
        (cur) => ({ next: done(cur), revert: undone }),
        () => backend.completeItem(id),
      );
      showToast(next ? `Done. Next due ${next === today ? 'today' : formatDay(next, today)}` : 'Marked as done', {
        label: 'Undo',
        run: () => {
          dismissToast();
          void mutate(
            (cur) => ({ next: undone(cur), revert: done }),
            () => backend.undoCompletion(completionId),
            'undo',
          ).catch(() => {});
        },
      });
    };

    /**
     * After a create or join succeeded: show the household. The household exists
     * now, so if loading it fails the form must not come back (a second tap would
     * only say "already part of a household"): show the error screen, whose
     * Try Again (retry) opens it.
     */
    const enterHousehold = async (u: AuthUser, session: number, hid: string) => {
      try {
        if (!(await loadHousehold(hid, true))) return;
      } catch (err) {
        if (session === epoch.current) setPhase(errorPhase(err));
        return;
      }
      if (session === epoch.current) setPhase({ kind: 'ready', user: u });
    };

    const isAlreadyMember = (err: unknown) => err instanceof BackendError && err.code === 'already_member';

    /** A write to the visit on `date` (it resolves to the stored visit's id), tracked per day. */
    const visitWrite =
      (date: ISODate, op: () => Promise<string>) =>
      (): Promise<string> => {
        const run = op().then((id) => {
          visitIds.current.set(date, id);
          return id;
        });
        const settled: Promise<unknown> = Promise.all([visitWrites.current.get(date), run.catch(() => {})]);
        visitWrites.current.set(date, settled);
        void settled.then(() => {
          if (visitWrites.current.get(date) === settled) visitWrites.current.delete(date);
        });
        return run;
      };

    /**
     * A write to the message, tracked so Undo after Clear can go after it. `after`: wait for
     * the message writes already in flight first (Undo, so it never overtakes its Clear).
     */
    const noteWrite =
      (op: () => Promise<void>, after = false) =>
      (): Promise<void> => {
        const run = after ? noteWrites.current.then(op) : op();
        noteWrites.current = Promise.all([noteWrites.current, run.catch(() => {})]);
        return run;
      };

    const signOut = async () => {
      dismissToast();
      // Stop this device getting the previous person's pushes (only the owner can delete the row).
      await disablePush(backend);
      // An invite or shared link opened on this device shouldn't follow the next person who signs in.
      clearStoredInvite();
      setPendingInvite(null);
      forgetSharedLink();
      await backend.signOut();
    };

    /** The offer is over (brought over, or turned down): the steps go on, or the home opens. */
    const closeOffer = () => {
      setDemoImport(null);
      setDemoImportMode(null);
      if (tailForOffer.current) {
        tailForOffer.current = false;
        setTail(false);
      }
    };

    return {
      backend,
      phase,
      user,
      data,
      me,
      today,
      pendingInvite,
      onboardingTail,
      claimed,
      confirmClaimed: async (emoji) => {
        const current = me;
        if (current && emoji && emoji !== current.emoji) {
          // A failed save keeps the welcome step (the usual toast) and rejects.
          await mutate(patchChange('members', current.id, { emoji }), () => backend.updateMember(current.id, { emoji }));
        }
        setClaimed(false);
      },
      releaseClaim: async () => {
        try {
          await backend.releaseClaim();
        } catch (err) {
          showToast(errorMessage(err));
          throw err;
        }
        await signOut();
      },
      finishOnboarding: () => {
        setTail(false);
        setClaimed(false);
        setInvitePeople(false);
        tailForOffer.current = false;
      },
      invitePeople,
      doneInvitingPeople: () => setInvitePeople(false),
      dismissInvite: () => {
        clearStoredInvite();
        setPendingInvite(null);
      },

      signIn: () => backend.signInWithGoogle(),
      signOut,
      retry,
      createHousehold: async (input) => {
        if (!user) throw new BackendError('not_signed_in');
        const session = epoch.current;
        if (backend.kind === 'supabase') {
          // One home: ask once more just before creating. Someone may have set it up meanwhile,
          // or added this person: go there instead of making a second home.
          const entry = await backend.enterHome();
          if (session !== epoch.current) return;
          if (entry.status !== 'no_home') {
            // Already a member: most likely an earlier tap created it and its reply was lost,
            // so the steps after a create follow.
            const tail = entry.status === 'member';
            if (tail) setTail(true);
            let landed: Phase['kind'] | null = null;
            try {
              landed = await enter(user, entry, session);
            } finally {
              if (tail && landed !== 'ready') setTail(false);
            }
            throw new BackendError('home_exists');
          }
        }
        let hid: string;
        try {
          hid = await backend.createHousehold(input);
        } catch (err) {
          if (err instanceof BackendError && err.code === 'home_exists' && session === epoch.current) {
            // Someone set up the home a moment ago: go where this person belongs now.
            await recheckHome().catch(() => null);
            throw err;
          }
          if (!isAlreadyMember(err) || session !== epoch.current) throw err;
          // Most likely an earlier tap created it but its reply was lost: open that home.
          setTail(true);
          const landed = await bootstrap(user);
          if (landed !== 'ready') setTail(false);
          if (landed === 'onboarding') throw err;
          return;
        }
        if (session !== epoch.current) return;
        // Start Fresh, then a new home: the home on this phone is not offered again.
        if (declinedImport.current && backend.kind === 'supabase') {
          markDemoDeclined(localStore(), { at: new Date().toISOString() });
        }
        setCanReopenImport(false);
        setTail(true);
        await enterHousehold(user, session, hid);
      },
      joinHousehold: async (input) => {
        if (!user) throw new BackendError('not_signed_in');
        const session = epoch.current;
        let hid: string;
        try {
          hid = await backend.joinHousehold(input);
        } catch (err) {
          if (!isAlreadyMember(err) || session !== epoch.current) throw err;
          // A member of another home already (one household per person): open that one.
          const landed = await bootstrap(user);
          if (landed === 'onboarding') throw err;
          if (landed === 'ready') showToast(errorMessage(err));
          return;
        }
        if (session !== epoch.current) return;
        clearStoredInvite();
        setPendingInvite(null);
        // Joined as one of the people the home was waiting for: welcome them as that person.
        if (input.personId) setClaimed(true);
        setTail(true);
        await enterHousehold(user, session, hid);
      },
      refresh: async () => {
        await refresh();
      },

      demoImport:
        phase.kind === 'onboarding' || phase.kind === 'private' || (phase.kind === 'ready' && onboardingTail)
          ? demoImport
          : null,
      demoImportMode:
        phase.kind === 'onboarding' || phase.kind === 'private' || (phase.kind === 'ready' && onboardingTail)
          ? demoImport
            ? demoImportMode
            : null
          : null,
      importDemoHome: async () => {
        if (!user) throw new BackendError('not_signed_in');
        const session = epoch.current;
        const mode = demoImportMode;
        // Read again: the document may have changed (or been brought over) since the offer.
        const storage = localStore();
        const doc = readDemoDoc(storage);
        const payload = doc && !doc.imported && !doc.declined ? buildImportPayload(doc) : null;
        if (!payload) {
          closeOffer();
          throw new BackendError('not_found', 'No home to bring over');
        }
        let hid: string;
        try {
          hid = await backend.importHousehold(payload);
        } catch (err) {
          const code = err instanceof BackendError ? err.code : null;
          if (session === epoch.current && mode === 'replace') {
            // Someone started using the home meanwhile: it can't be replaced any more.
            if (code === 'already_member') setDemoImportMode('blocked');
          } else if (session === epoch.current && (code === 'home_exists' || code === 'already_member')) {
            // Someone set up the home meanwhile (or an earlier tap brought it over and its
            // reply was lost): go where this person belongs now, then say why.
            const tail = code === 'already_member';
            if (tail) setTail(true);
            const landed = await recheckHome().catch(() => null);
            if (tail && landed !== 'ready') setTail(false);
            if (tail && landed === 'ready') setInvitePeople(true);
          }
          throw err;
        }
        markDemoImported(storage, { at: new Date().toISOString(), household_id: hid });
        if (session !== epoch.current) return;
        setDemoImport(null);
        setDemoImportMode(null);
        tailForOffer.current = false;
        // Next: the emails of the people who came along, then notifications.
        setInvitePeople(true);
        setTail(true);
        await enterHousehold(user, session, hid);
      },
      declineDemoImport: () => {
        declinedImport.current = true;
        if (demoImportMode === 'create') {
          // Start Fresh: for this session, until a home is created (Profile's Back undoes it).
          setCanReopenImport(true);
          setDemoImport(null);
          setDemoImportMode(null);
          return;
        }
        markDemoDeclined(localStore(), { at: new Date().toISOString() });
        closeOffer();
      },
      reopenDemoImport: () => {
        if (phase.kind !== 'onboarding') return;
        declinedImport.current = false;
        setCanReopenImport(false);
        const offer = demoImportOffer(backend);
        setDemoImport(offer);
        setDemoImportMode(offer ? 'create' : null);
      },
      canReopenDemoImport: phase.kind === 'onboarding' && canReopenImport,
      recheckHome: async () => {
        await recheckHome();
      },
      addPerson: (input) => {
        const d = requireData();
        const session = epoch.current;
        return mutate(
          null,
          async () => {
            const person = await backend.addPerson(d.household.id, input);
            // On screen at once (the reload follows).
            const cur = dataRef.current;
            if (session === epoch.current && cur?.household.id === person.household_id && !cur.members.some((m) => m.id === person.id)) {
              commitData({ ...cur, members: [...cur.members, person].sort(byJoin) });
            }
            return person;
          },
          'save',
          true,
        );
      },
      setPersonEmail: (id, email) =>
        mutate(
          patchChange('members', id, { email: normaliseEmail(email) }),
          () => backend.setPersonEmail(id, email),
          'save',
          true,
        ),
      removePerson: (id) => mutate(removePersonChange(id), () => backend.removePerson(id)),

      updateHousehold: (patch) => {
        const d = requireData();
        return mutate(
          (cur) => {
            const before = pick(cur.household, patch);
            return {
              next: { ...cur, household: { ...cur.household, ...patch } },
              revert: (c) => ({ ...c, household: { ...c.household, ...before } }),
            };
          },
          () => backend.updateHousehold(d.household.id, patch),
        );
      },
      updateMember: (id, patch) => mutate(patchChange('members', id, patch), () => backend.updateMember(id, patch)),
      createArea: (name) => {
        const d = requireData();
        return mutate(null, () => backend.createArea(d.household.id, name));
      },
      renameArea: (id, name) => mutate(patchChange('areas', id, { name }), () => backend.renameArea(id, name)),
      deleteArea: (id) =>
        mutate(
          (cur) => {
            const area = cur.areas.find((a) => a.id === id);
            if (!area) return null;
            const items = cur.items.filter((i) => i.area_id === id);
            return {
              next: { ...cur, areas: cur.areas.filter((a) => a.id !== id), items: cur.items.filter((i) => i.area_id !== id) },
              revert: (c) => ({
                ...c,
                areas: restoreRows(c.areas, [area]).sort(byPosition),
                items: restoreRows(c.items, items),
              }),
            };
          },
          () => backend.deleteArea(id),
        ),
      reorderAreas: (orderedIds) => {
        const d = requireData();
        return mutate(
          (cur) => {
            const before = new Map(cur.areas.map((a) => [a.id, a.position]));
            const reposition = (areas: Area[], position: (a: Area) => number | undefined) =>
              areas.map((a) => ({ ...a, position: position(a) ?? a.position })).sort(byPosition);
            return {
              next: {
                ...cur,
                areas: reposition(cur.areas, (a) => (orderedIds.includes(a.id) ? orderedIds.indexOf(a.id) : undefined)),
              },
              revert: (c) => ({ ...c, areas: reposition(c.areas, (a) => before.get(a.id)) }),
            };
          },
          () => backend.reorderAreas(d.household.id, orderedIds),
        );
      },
      createItem: (draft) => {
        const d = requireData();
        return mutate(null, () => backend.createItem(d.household.id, applyKindRules(draft)));
      },
      updateItem: (id, patch) => {
        const item = dataRef.current?.items.find((i) => i.id === id);
        // Only what changed is sent (a kind someone else just changed is left alone); a patch
        // that makes the item a state also clears its due date, repeat and reminder.
        const write: ItemPatch = applyKindRules(patch);
        // On screen at once, "Updated" day and all, as the database will store it: whatever
        // kind it ends up with decides. The reload brings the stored values.
        const endsState = (patch.kind ?? item?.kind) === 'state';
        const shown: Partial<Item> = {
          ...(endsState ? { ...write, ...STATE_FIELDS } : write),
          updated_at: new Date().toISOString(),
        };
        return mutate(patchChange('items', id, shown), () => backend.updateItem(id, write));
      },
      deleteItem: (id) =>
        mutate(
          (cur) => {
            const item = cur.items.find((i) => i.id === id);
            if (!item) return null;
            return { next: withoutItem(cur, id), revert: (c) => ({ ...c, items: restoreRows(c.items, [item]) }) };
          },
          () => backend.deleteItem(id),
        ),
      completeItem,
      createInvite: () => backend.createInvite(),

      setHousekeepingNote: (body) => {
        const d = requireData();
        const text = (body ?? '').trim();
        // Unchanged (after trimming): nothing to send.
        if (text === d.housekeeping.note.body) return Promise.resolve();
        return mutate(
          (cur) => {
            const before = cur.housekeeping.note;
            const meId = cur.members.find((m) => m.user_id === userRef.current?.id)?.id ?? null;
            const after: HousekeepingNote = { body: text, updated_at: optimisticStamp(), updated_by: meId };
            return {
              next: withHousekeeping(cur, { ...cur.housekeeping, note: after }),
              revert: (c) => (c.housekeeping.note === after ? withHousekeeping(c, { ...c.housekeeping, note: before }) : c),
            };
          },
          noteWrite(() => backend.setHousekeepingNote(d.household.id, text)),
        );
      },
      undoClearHousekeepingNote: (previous) => {
        const d = requireData();
        return mutate(
          (cur) => {
            const cleared = cur.housekeeping.note;
            // Only while it is still empty, and only a message there was.
            if (cleared.body !== '' || !previous.body) return null;
            const restored: HousekeepingNote = { ...previous };
            return {
              next: withHousekeeping(cur, { ...cur.housekeeping, note: restored }),
              revert: (c) =>
                c.housekeeping.note === restored ? withHousekeeping(c, { ...c.housekeeping, note: cleared }) : c,
            };
          },
          noteWrite(() => backend.undoClearHousekeepingNote(d.household.id), true),
          'undo',
        );
      },
      createHousekeepingTask: async (title) => {
        const d = requireData();
        // Not optimistic (like createArea): it resolves to the stored task. It shows as soon as
        // it is stored, on today's visit too; the reload that follows confirms it.
        const task = await mutate(null, () => backend.createHousekeepingTask(d.household.id, title));
        const cur = dataRef.current;
        if (cur && cur.household.id === task.household_id) {
          commitData(withHousekeeping(cur, withTaskAdded(cur.housekeeping, task, today)));
        }
        return task;
      },
      renameHousekeepingTask: (id, title) =>
        mutate(
          (cur) => {
            const task = cur.housekeeping.tasks.find((t) => t.id === id);
            const clean = (title ?? '').trim();
            // A blank title is the backend's to refuse; the list keeps showing the old one.
            if (!task || !clean || clean === task.title) return null;
            return {
              next: withHousekeeping(cur, withTaskRenamed(cur.housekeeping, id, clean, today)),
              revert: (c) =>
                c.housekeeping.tasks.find((t) => t.id === id)?.title === clean
                  ? withHousekeeping(c, withTaskRenamed(c.housekeeping, id, task.title, today))
                  : c,
            };
          },
          () => backend.renameHousekeepingTask(id, title),
        ),
      deleteHousekeepingTask: (id) => mutate(deleteTaskChange(id, today), () => backend.deleteHousekeepingTask(id)),
      reorderHousekeepingTasks: (orderedIds) => {
        const d = requireData();
        return mutate(reorderTasksChange(orderedIds, today), () =>
          backend.reorderHousekeepingTasks(d.household.id, orderedIds),
        );
      },
      setHousekeepingTaskDone: (date, target, done) => {
        // Visits are never in the future: refused without a write (and without a toast).
        if (!canHaveVisit(date, today)) return Promise.reject(new BackendError('unknown', 'invalid_input: date'));
        const d = requireData();
        return mutate(
          visitChange(date, userRef.current?.id, (visit, meId, at) => applyTick(visit, target, done, meId, at)),
          visitWrite(date, () => backend.setHousekeepingTaskDone(d.household.id, date, target, done)),
        ).then(() => undefined);
      },
      saveHousekeepingVisit: (date, patch) => {
        if (!canHaveVisit(date, today)) return Promise.reject(new BackendError('unknown', 'invalid_input: date'));
        const d = requireData();
        return mutate(
          visitChange(date, userRef.current?.id, (visit, meId, at) => applyVisitPatch(visit, patch, meId, at)),
          visitWrite(date, () => backend.saveHousekeepingVisit(d.household.id, date, patch)),
        ).then(() => undefined);
      },
      addHousekeepingVisit: (date) => {
        if (!canHaveVisit(date, today)) return Promise.reject(new BackendError('unknown', 'invalid_input: date'));
        const d = requireData();
        // A day without a visit shows the pending one (nothing ticked); one already there stays.
        return mutate(
          visitChange(date, userRef.current?.id, (visit) => visit),
          visitWrite(date, () => backend.addHousekeepingVisit(d.household.id, date)),
        ).then(() => undefined);
      },
      deleteHousekeepingVisit: (id) => {
        const date = dataRef.current?.housekeeping.visits.find((v) => v.id === id)?.visit_date;
        return mutate(
          (cur) => {
            const visit = cur.housekeeping.visits.find((v) => v.id === id);
            if (!visit) return null;
            return {
              next: withHousekeeping(cur, { ...cur.housekeeping, visits: cur.housekeeping.visits.filter((v) => v.id !== id) }),
              // Back on the calendar, unless that day has a visit again by then.
              revert: (c) =>
                c.housekeeping.visits.some((v) => v.id === id || v.visit_date === visit.visit_date)
                  ? c
                  : withHousekeeping(c, { ...c.housekeeping, visits: [...c.housekeeping.visits, visit].sort(byVisitDate) }),
            };
          },
          async () => {
            if (!date || id !== pendingVisitId(date)) {
              await backend.deleteHousekeepingVisit(id);
            } else {
              // Shown before its id was known: wait for that day's writes, then delete what they
              // stored. None stored it (they failed, and took it back): nothing to delete.
              await visitWrites.current.get(date);
              const stored = visitIds.current.get(date);
              if (stored) await backend.deleteHousekeepingVisit(stored);
            }
            if (date) visitIds.current.delete(date);
          },
        );
      },

      toast,
      showToast,
      dismissToast,
      holdToast,
    };
  }, [
    backend,
    phase,
    user,
    data,
    me,
    today,
    pendingInvite,
    onboardingTail,
    claimed,
    demoImport,
    demoImportMode,
    canReopenImport,
    invitePeople,
    setTail,
    retry,
    refresh,
    loadHousehold,
    bootstrap,
    enter,
    recheckHome,
    commitData,
    mutate,
    requireData,
    commitData,
    toast,
    showToast,
    dismissToast,
    holdToast,
  ]);

  return <HomeContext.Provider value={value}>{children}</HomeContext.Provider>;
}

export function useHome(): HomeContextValue {
  const ctx = useContext(HomeContext);
  if (!ctx) throw new Error('useHome must be used inside <HomeProvider>');
  return ctx;
}

/** Same as useHome() but asserts the household is loaded (for screens shown when ready). */
export function useHousehold(): HomeContextValue & { data: HouseholdData; me: Member } {
  const ctx = useHome();
  if (!ctx.data || !ctx.me) throw new Error('useHousehold used before the household loaded');
  return ctx as HomeContextValue & { data: HouseholdData; me: Member };
}
