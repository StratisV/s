import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackendError, type Backend, type HouseholdPatch, type ItemPatch, type MemberPatch } from '../lib/backend/types';
import { formatDay, todayIn } from '../lib/logic/dates';
import { disablePush } from '../lib/push';
import { nextDueDate } from '../lib/logic/items';
import type {
  Area,
  AuthUser,
  CreateHouseholdInput,
  HouseholdData,
  ISODate,
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

  signIn(): Promise<void>;
  signOut(): Promise<void>;
  createHousehold(input: CreateHouseholdInput): Promise<void>;
  joinHousehold(input: JoinHouseholdInput): Promise<void>;
  refresh(): Promise<void>;

  updateHousehold(patch: HouseholdPatch): Promise<void>;
  updateMember(id: string, patch: MemberPatch): Promise<void>;
  createArea(name: string): Promise<Area>;
  renameArea(id: string, name: string): Promise<void>;
  deleteArea(id: string): Promise<void>;
  reorderAreas(orderedIds: string[]): Promise<void>;
  createItem(draft: ItemDraft): Promise<Item>;
  updateItem(id: string, patch: ItemPatch): Promise<void>;
  deleteItem(id: string): Promise<void>;
  /** Completes the item (optimistically) and shows an Undo toast. */
  completeItem(id: string): Promise<void>;
  createInvite(): Promise<string>;

  toast: ToastState | null;
  showToast(message: string, action?: ToastState['action']): void;
  dismissToast(): void;
}

const HomeContext = createContext<HomeContextValue | null>(null);

const INVITE_KEY = 'homeos.invite';
const TOAST_MS = 4000;

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

export function HomeProvider({ backend, children }: { backend: Backend; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [user, setUser] = useState<AuthUser | null>(null);
  const [data, setData] = useState<HouseholdData | null>(null);
  const [pendingInvite, setPendingInvite] = useState<string | null>(() => readInviteFromUrl());
  const [onboardingTail, setOnboardingTail] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [now, setNow] = useState(() => new Date());
  const householdIdRef = useRef<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
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

  const dismissToast = useCallback(() => {
    clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  const showToast = useCallback((message: string, action?: ToastState['action']) => {
    clearTimeout(toastTimer.current);
    const id = ++toastSeq.current;
    setToast({ id, message, action });
    toastTimer.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), TOAST_MS);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const loadHousehold = useCallback(
    async (hid: string) => {
      const loaded = await backend.load(hid);
      householdIdRef.current = hid;
      setData(loaded);
      return loaded;
    },
    [backend],
  );

  /** Decide the phase for a (possibly null) user. */
  const bootstrap = useCallback(
    async (u: AuthUser | null) => {
      setUser(u);
      if (!u) {
        householdIdRef.current = null;
        setData(null);
        setPhase({ kind: 'signedOut' });
        return;
      }
      try {
        const hid = await backend.getMyHouseholdId();
        if (!hid) {
          householdIdRef.current = null;
          setData(null);
          setPhase({ kind: 'onboarding', user: u });
          return;
        }
        await loadHousehold(hid);
        setPhase({ kind: 'ready', user: u });
      } catch (err) {
        setPhase({ kind: 'error', message: errorMessage(err) });
      }
    },
    [backend, loadHousehold],
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

  const refresh = useCallback(async () => {
    const hid = householdIdRef.current;
    if (!hid) return;
    try {
      await loadHousehold(hid);
    } catch {
      /* keep showing what we have; the next refresh will retry */
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
   * On failure: reload to resync and show an error toast, then rethrow.
   */
  const mutate = useCallback(
    async <T,>(optimistic: ((d: HouseholdData) => HouseholdData) | null, op: () => Promise<T>): Promise<T> => {
      if (optimistic) setData((d) => (d ? optimistic(d) : d));
      try {
        const result = await op();
        void refresh();
        return result;
      } catch (err) {
        void refresh();
        showToast(errorMessage(err));
        throw err;
      }
    },
    [refresh, showToast],
  );

  const requireData = useCallback((): HouseholdData => {
    if (!data) throw new BackendError('not_found', 'No household loaded');
    return data;
  }, [data]);

  const me = useMemo(() => (data && user ? (data.members.find((m) => m.user_id === user.id) ?? null) : null), [data, user]);

  const value = useMemo<HomeContextValue>(() => {
    const completeItem = async (id: string) => {
      const d = requireData();
      const item = d.items.find((i) => i.id === id);
      if (!item) return;
      const next = nextDueDate(item.repeat, item.due_date, today);
      const completionId = await mutate(
        (cur) => ({
          ...cur,
          items: next
            ? cur.items.map((i) => (i.id === id ? { ...i, due_date: next } : i))
            : cur.items.filter((i) => i.id !== id),
        }),
        () => backend.completeItem(id),
      );
      showToast(next ? `Done. Next due ${next === today ? 'today' : formatDay(next, today)}` : 'Marked as done', {
        label: 'Undo',
        run: () => {
          dismissToast();
          void mutate(null, () => backend.undoCompletion(completionId)).catch(() => {});
        },
      });
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
      finishOnboarding: () => setOnboardingTail(false),

      signIn: () => backend.signInWithGoogle(),
      signOut: async () => {
        dismissToast();
        // Stop this device getting the previous person's pushes (only the owner can delete the row).
        await disablePush(backend);
        await backend.signOut();
      },
      createHousehold: async (input) => {
        if (!user) throw new BackendError('not_signed_in');
        const hid = await backend.createHousehold(input);
        setOnboardingTail(true);
        await loadHousehold(hid);
        setPhase({ kind: 'ready', user });
      },
      joinHousehold: async (input) => {
        if (!user) throw new BackendError('not_signed_in');
        const hid = await backend.joinHousehold(input);
        clearStoredInvite();
        setPendingInvite(null);
        setOnboardingTail(true);
        await loadHousehold(hid);
        setPhase({ kind: 'ready', user });
      },
      refresh,

      updateHousehold: (patch) => {
        const d = requireData();
        return mutate(
          (cur) => ({ ...cur, household: { ...cur.household, ...patch } }),
          () => backend.updateHousehold(d.household.id, patch),
        );
      },
      updateMember: (id, patch) =>
        mutate(
          (cur) => ({ ...cur, members: cur.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) }),
          () => backend.updateMember(id, patch),
        ),
      createArea: (name) => {
        const d = requireData();
        return mutate(null, () => backend.createArea(d.household.id, name));
      },
      renameArea: (id, name) =>
        mutate(
          (cur) => ({ ...cur, areas: cur.areas.map((a) => (a.id === id ? { ...a, name } : a)) }),
          () => backend.renameArea(id, name),
        ),
      deleteArea: (id) =>
        mutate(
          (cur) => ({
            ...cur,
            areas: cur.areas.filter((a) => a.id !== id),
            items: cur.items.filter((i) => i.area_id !== id),
          }),
          () => backend.deleteArea(id),
        ),
      reorderAreas: (orderedIds) => {
        const d = requireData();
        return mutate(
          (cur) => ({
            ...cur,
            areas: orderedIds
              .map((aid, position) => {
                const a = cur.areas.find((x) => x.id === aid);
                return a ? { ...a, position } : null;
              })
              .filter((a): a is Area => a !== null),
          }),
          () => backend.reorderAreas(d.household.id, orderedIds),
        );
      },
      createItem: (draft) => {
        const d = requireData();
        return mutate(null, () => backend.createItem(d.household.id, draft));
      },
      updateItem: (id, patch) =>
        mutate(
          (cur) => ({ ...cur, items: cur.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }),
          () => backend.updateItem(id, patch),
        ),
      deleteItem: (id) =>
        mutate(
          (cur) => ({ ...cur, items: cur.items.filter((i) => i.id !== id) }),
          () => backend.deleteItem(id),
        ),
      completeItem,
      createInvite: () => backend.createInvite(),

      toast,
      showToast,
      dismissToast,
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
    mutate,
    requireData,
    toast,
    showToast,
    dismissToast,
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
