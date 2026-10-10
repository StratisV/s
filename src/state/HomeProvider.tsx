import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackendError, type Backend, type HouseholdPatch, type ItemPatch, type MemberPatch } from '../lib/backend/types';
import { STATE_FIELDS } from '../lib/constants';
import { formatDay, todayIn } from '../lib/logic/dates';
import { disablePush } from '../lib/push';
import { applyKindRules, nextDueDate } from '../lib/logic/items';
import type {
  Area,
  AuthUser,
  CreateHouseholdInput,
  DemoHomeSummary,
  HouseholdData,
  ISODate,
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
  /** True right after creating/joining/claiming/importing a household: Onboarding shows its last step(s). */
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
  finishOnboarding(): void;
  /** Forget the pending invite (declined, or signing out). */
  dismissInvite(): void;

  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /**
   * Create home. On the Supabase backend it first asks enterHome() again: unless that is still
   * 'no_home' (someone set up the home meanwhile, or added this person), it moves to the
   * phase that gives and rejects with BackendError('home_exists') instead of creating a second
   * home (TODO(one-home data builder)). The database does not stop create_household itself.
   */
  createHousehold(input: CreateHouseholdInput): Promise<void>;
  /**
   * Join with an invite link. When the home has a person who has not joined yet with this
   * account's verified email, the account becomes that person (the typed name and emoji are
   * not applied); in practice enterHome has already claimed them at sign-in.
   */
  joinHousehold(input: JoinHouseholdInput): Promise<void>;
  refresh(): Promise<void>;

  // ── One home ──
  /**
   * In phase 'onboarding' on the Supabase backend only: the home this browser kept in demo
   * mode (readDemoDoc(localStorage) then demoHomeSummary()), offered as "Bring over the home
   * from this phone" with "Start fresh" as the alternative. Null in demo mode, when there is
   * none, when it was brought over already (marked imported), and after declineDemoImport().
   */
  demoImport: DemoHomeSummary | null;
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
  /** "Start Fresh": demoImport becomes null for this session; the Profile and Create home steps follow. */
  declineDemoImport(): void;
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

/** The one-home API's stubs until the builder implements it (docs/ARCHITECTURE.md "One home"). */
function notImplemented(name: string): Promise<never> {
  return Promise.reject(new Error(`not implemented: ${name}`));
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
      // TODO(one-home data builder): set from bootstrap (enterHome 'claimed'); confirmClaimed and finishOnboarding clear it.
      claimed: false,
      confirmClaimed: () => notImplemented('confirmClaimed'),
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
        // An invite opened on this device shouldn't follow the next person who signs in.
        clearStoredInvite();
        setPendingInvite(null);
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

      // TODO(one-home data builder): implement (docs/ARCHITECTURE.md "One home").
      demoImport: null,
      importDemoHome: () => notImplemented('importDemoHome'),
      declineDemoImport: () => {},
      recheckHome: () => notImplemented('recheckHome'),
      addPerson: () => notImplemented('addPerson'),
      setPersonEmail: () => notImplemented('setPersonEmail'),
      removePerson: () => notImplemented('removePerson'),

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
