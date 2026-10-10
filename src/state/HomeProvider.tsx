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
import type {
  Area,
  AuthUser,
  CreateHouseholdInput,
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
} from '../lib/types';

export type Phase =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'onboarding'; user: AuthUser }
  | { kind: 'ready'; user: AuthUser }
  | { kind: 'error'; message: string };

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
  /** True right after creating/joining a household: Onboarding shows its last step. */
  onboardingTail: boolean;
  finishOnboarding(): void;
  /** Forget the pending invite (declined, or signing out). */
  dismissInvite(): void;

  signIn(): Promise<void>;
  signOut(): Promise<void>;
  createHousehold(input: CreateHouseholdInput): Promise<void>;
  joinHousehold(input: JoinHouseholdInput): Promise<void>;
  refresh(): Promise<void>;

  /**
   * Edits below apply at once (optimistically). If the write fails, just that
   * change is taken back, a toast says it was not saved, and the promise rejects.
   */
  updateHousehold(patch: HouseholdPatch): Promise<void>;
  updateMember(id: string, patch: MemberPatch): Promise<void>;
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
   * Adds a task at the end of the list (and to today's visit, if any). Like createArea it
   * is not optimistic: resolves to the stored task once written, so the sheet can focus it.
   */
  createHousekeepingTask(title: string): Promise<HousekeepingTask>;
  /** Renames a task on the list and on today's visit (withTaskRenamed). */
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
  /** Deletes a visit (the UI confirms first). Taken off the calendar at once. */
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
      default:
        return 'Something went wrong. Try again.';
    }
  }
  return 'Something went wrong. Try again.';
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

  /** Nothing loaded may land after this (signed out, or no household). */
  const clearHousehold = useCallback(() => {
    householdIdRef.current = null;
    shownSeq.current = ++loadSeq.current;
    commitData(null);
  }, [commitData]);

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
      const loaded = await backend.load(hid);
      if (session !== epoch.current) return false;
      if (!force && (seq <= shownSeq.current || pendingWrites.current > 0 || householdIdRef.current !== hid)) {
        return false;
      }
      shownSeq.current = force ? ++loadSeq.current : seq;
      householdIdRef.current = hid;
      commitData(loaded);
      return true;
    },
    [backend, commitData],
  );

  /** Decide the phase for a (possibly null) user. Resolves to the phase it settled on, or null if overtaken. */
  const bootstrap = useCallback(
    async (u: AuthUser | null): Promise<Phase['kind'] | null> => {
      const session = ++epoch.current;
      const previous = userRef.current;
      userRef.current = u;
      setUser(u);
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
        const hid = await backend.getMyHouseholdId();
        if (session !== epoch.current) return null;
        if (!hid) {
          clearHousehold();
          setPhase({ kind: 'onboarding', user: u });
          return 'onboarding';
        }
        if (!(await loadHousehold(hid, true))) return null;
        setPhase({ kind: 'ready', user: u });
        return 'ready';
      } catch (err) {
        if (session !== epoch.current) return null;
        setPhase({ kind: 'error', message: errorMessage(err) });
        return 'error';
      }
    },
    [backend, loadHousehold, clearHousehold],
  );

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
      .catch((err) => alive && setPhase({ kind: 'error', message: errorMessage(err) }));
    const unsub = backend.onAuthChange(handle);
    return () => {
      alive = false;
      unsub();
    };
  }, [backend, bootstrap]);

  /** Reloads the household in the background. Resolves to whether fresh data was shown. */
  const refresh = useCallback(async (): Promise<boolean> => {
    const hid = householdIdRef.current;
    if (!hid) return false;
    try {
      return await loadHousehold(hid, false);
    } catch {
      return false; // keep showing what we have; the next refresh will retry
    }
  }, [loadHousehold]);

  // Live updates from other members, and a refresh whenever the app comes back.
  const ready = phase.kind === 'ready';
  useEffect(() => {
    const hid = householdIdRef.current;
    if (!ready || !hid) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const debounced = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 250);
    };
    const unsub = backend.subscribe(hid, debounced);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setNow(new Date());
        debounced();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      unsub();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ready, backend, refresh]);

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
    async <T,>(change: Change | null, op: () => Promise<T>, verb: 'save' | 'undo' = 'save'): Promise<T> => {
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
          showToast(notSavedMessage(err, verb));
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
     * Try again reloads straight into it.
     */
    const enterHousehold = async (u: AuthUser, session: number, hid: string) => {
      try {
        if (!(await loadHousehold(hid, true))) return;
      } catch (err) {
        if (session === epoch.current) setPhase({ kind: 'error', message: errorMessage(err) });
        return;
      }
      if (session === epoch.current) setPhase({ kind: 'ready', user: u });
    };

    const isAlreadyMember = (err: unknown) => err instanceof BackendError && err.code === 'already_member';

    return {
      backend,
      phase,
      user,
      data,
      me,
      today,
      pendingInvite,
      onboardingTail,
      finishOnboarding: () => setOnboardingTail(false),
      dismissInvite: () => {
        clearStoredInvite();
        setPendingInvite(null);
      },

      signIn: () => backend.signInWithGoogle(),
      signOut: async () => {
        dismissToast();
        // Stop this device getting the previous person's pushes (only the owner can delete the row).
        await disablePush(backend);
        // An invite or shared link opened on this device shouldn't follow the next person who signs in.
        clearStoredInvite();
        setPendingInvite(null);
        forgetSharedLink();
        await backend.signOut();
      },
      createHousehold: async (input) => {
        if (!user) throw new BackendError('not_signed_in');
        const session = epoch.current;
        let hid: string;
        try {
          hid = await backend.createHousehold(input);
        } catch (err) {
          if (!isAlreadyMember(err) || session !== epoch.current) throw err;
          // Most likely an earlier tap created it but its reply was lost: open that home.
          setOnboardingTail(true);
          const landed = await bootstrap(user);
          if (landed !== 'ready') setOnboardingTail(false);
          if (landed === 'onboarding') throw err;
          return;
        }
        if (session !== epoch.current) return;
        setOnboardingTail(true);
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
        setOnboardingTail(true);
        await enterHousehold(user, session, hid);
      },
      refresh: async () => {
        await refresh();
      },

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
          () => backend.setHousekeepingNote(d.household.id, text),
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
          () => backend.setHousekeepingTaskDone(d.household.id, date, target, done),
        ).then(() => undefined);
      },
      saveHousekeepingVisit: (date, patch) => {
        if (!canHaveVisit(date, today)) return Promise.reject(new BackendError('unknown', 'invalid_input: date'));
        const d = requireData();
        return mutate(
          visitChange(date, userRef.current?.id, (visit, meId, at) => applyVisitPatch(visit, patch, meId, at)),
          () => backend.saveHousekeepingVisit(d.household.id, date, patch),
        ).then(() => undefined);
      },
      addHousekeepingVisit: (date) => {
        if (!canHaveVisit(date, today)) return Promise.reject(new BackendError('unknown', 'invalid_input: date'));
        const d = requireData();
        // A day without a visit shows the pending one (nothing ticked); one already there stays.
        return mutate(
          visitChange(date, userRef.current?.id, (visit) => visit),
          () => backend.addHousekeepingVisit(d.household.id, date),
        ).then(() => undefined);
      },
      deleteHousekeepingVisit: (id) =>
        mutate(
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
          () => backend.deleteHousekeepingVisit(id),
        ),

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
    refresh,
    loadHousehold,
    bootstrap,
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
