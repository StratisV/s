// Test support (not part of the app): a stand-in for HomeProvider, so a screen can be tested
// on exactly the state and actions it is given. A test file mocks the module with
//
//   vi.mock('../../state/HomeProvider', async (importOriginal) => {
//     const actual = await importOriginal<typeof import('../../state/HomeProvider')>();
//     const { useMockHome } = await import('../testing/mockHome');
//     return { ...actual, useHome: useMockHome, useHousehold: useMockHome };
//   });
//
// and renders the screen inside <MockHome initial={makeHome(...)}>.

import { act } from '@testing-library/react';
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Backend } from '../../lib/backend/types';
import { emptyHousekeeping } from '../../lib/logic/housekeeping';
import type { AuthUser, HouseholdData, Item, Member, NotifyPrefs, NotifySettings, ReminderInput } from '../../lib/types';
import type { HomeContextValue } from '../../state/HomeProvider';

const MockContext = createContext<HomeContextValue | null>(null);

/** The mocked useHome() and useHousehold(): what MockHome holds now. */
export function useMockHome(): HomeContextValue {
  const home = useContext(MockContext);
  if (!home) throw new Error('useMockHome used outside <MockHome>');
  return home;
}

/** What the screen sees right now (for assertions). */
export const mockHome: { value: HomeContextValue } = { value: null as unknown as HomeContextValue };

type Patch = Partial<HomeContextValue> | ((home: HomeContextValue) => Partial<HomeContextValue>);
let apply: ((patch: Patch) => void) | null = null;

/** Changes what the screen sees, as the provider would (a new phase, data from a reload…). */
export function updateHome(patch: Patch): void {
  act(() => apply?.(patch));
}

/** Like updateHome, from inside an action that is already running (no act of its own). */
export function setHome(patch: Patch): void {
  apply?.(patch);
}

export function MockHome({ initial, children }: { initial: HomeContextValue; children: ReactNode }) {
  const [home, setState] = useState(initial);
  apply = (patch) =>
    setState((h) => {
      const next = { ...h, ...(typeof patch === 'function' ? patch(h) : patch) };
      // `me` always follows the data, as in HomeProvider.
      const me = next.data && next.user ? (next.data.members.find((m) => m.user_id === next.user!.id) ?? null) : null;
      return { ...next, me };
    });
  mockHome.value = home;
  return <MockContext.Provider value={home}>{children}</MockContext.Provider>;
}

export const USER: AuthUser = { id: 'user-stratis', email: 'stratis@gmail.com', name: 'Stratis Vlachos' };

const H = 'h-1';
const T = '2026-10-01T09:00:00.000Z';

export function person(over: Partial<Member> & Pick<Member, 'id' | 'name'>): Member {
  return {
    household_id: H,
    user_id: null,
    email: '',
    emoji: '🦔',
    color: '#AF52DE',
    role: 'member',
    weekly_email: true,
    push_enabled: false,
    created_at: T,
    ...over,
  };
}

export function item(over: Partial<Item> & Pick<Item, 'id' | 'title'>): Item {
  return {
    household_id: H,
    area_id: 'a-kitchen',
    kind: 'task',
    note: '',
    good: '',
    rag: 'amber',
    due_date: '2026-10-16',
    assignee_id: null,
    repeat: 'none',
    notify: 'day_before',
    status: 'open',
    created_by: 'm-stratis',
    updated_by: 'm-stratis',
    created_at: T,
    updated_at: T,
    ...over,
  };
}

/** The household's home: Stratis (signed in), Shea (added, email set) and Pat (added, no email yet). */
export function sampleData(): HouseholdData {
  return {
    household: {
      id: H,
      name: 'Our home',
      address: '21 Alderbrook Road',
      timezone: 'Europe/London',
      weekly_email_day: 1,
      weekly_email_time: '08:00',
    },
    members: [
      person({
        id: 'm-stratis',
        name: 'Stratis',
        user_id: USER.id,
        email: USER.email,
        emoji: '🦆',
        color: '#007AFF',
        role: 'owner',
      }),
      person({ id: 'm-shea', name: 'Shea', email: 'shea@gmail.com', emoji: '🦔' }),
      person({ id: 'm-pat', name: 'Pat', emoji: '🐻', color: '#30B0C7' }),
    ],
    areas: [
      { id: 'a-kitchen', household_id: H, name: 'Kitchen', position: 0 },
      { id: 'a-jacuzzi', household_id: H, name: 'Jacuzzi', position: 1 },
    ],
    items: [
      item({
        id: 'i-rubbish',
        title: 'Rubbish fill level',
        kind: 'state',
        rag: 'green',
        due_date: null,
        repeat: 'none',
        notify: 'none',
        assignee_id: 'm-shea',
      }),
      item({
        id: 'i-chemicals',
        title: 'Check Chemicals',
        area_id: 'a-jacuzzi',
        rag: 'green',
        due_date: '2026-10-20',
        assignee_id: 'm-shea',
      }),
      item({ id: 'i-cracks', title: 'Fix the cracks on the wall', rag: 'red' }),
    ],
    completions: [],
    housekeeping: emptyHousekeeping(),
  };
}

/** A fake backend: only what the screens under test touch. */
export function fakeBackend(over: Partial<Backend> = {}): Backend {
  return {
    kind: 'supabase',
    takeAuthError: () => null,
    getInvitePreview: vi.fn(async () => null),
    releaseClaim: vi.fn(async () => {}),
    ...over,
  } as unknown as Backend;
}

/**
 * Notifications as the server keeps them (server mode), in memory: the four actions of
 * HomeContextValue as vi.fns over one NotifySettings, which `state` holds (tests read and set it).
 */
export function fakeNotify(initial: Partial<NotifySettings> = {}) {
  const state: { settings: NotifySettings } = {
    settings: {
      prefs: { weeklyStatus: false, housekeeping: false, reminders: false },
      reminders: [],
      publicKey: null,
      subscribed: false,
      ...initial,
    },
  };
  let n = 0;
  const copy = () => structuredClone(state.settings);
  return {
    state,
    notifySettings: vi.fn(async () => copy()),
    setNotifyPrefs: vi.fn(async (prefs: Partial<NotifyPrefs>) => {
      state.settings = { ...state.settings, prefs: { ...state.settings.prefs, ...prefs } };
      return copy();
    }),
    saveReminder: vi.fn(async (input: ReminderInput) => {
      const days = [...new Set(input.days)].sort((a, b) => a - b);
      const title = input.title.trim();
      const reminders = input.id
        ? state.settings.reminders.map((r) => (r.id === input.id ? { ...r, title, days } : r))
        : [...state.settings.reminders, { id: `r-${++n}`, title, days }];
      state.settings = { ...state.settings, reminders };
      return copy();
    }),
    deleteReminder: vi.fn(async (id: string) => {
      state.settings = { ...state.settings, reminders: state.settings.reminders.filter((r) => r.id !== id) };
      return copy();
    }),
  };
}

/** fakeNotify()'s actions without its state, to spread into a HomeContextValue. */
export function notifyActions(fake: ReturnType<typeof fakeNotify>) {
  const { notifySettings, setNotifyPrefs, saveReminder, deleteReminder } = fake;
  return { notifySettings, setNotifyPrefs, saveReminder, deleteReminder };
}

/** A full HomeContextValue: signed in and in the home unless `over` says otherwise. Every action is a vi.fn. */
export function makeHome(over: Partial<HomeContextValue> = {}): HomeContextValue {
  const data = over.data === undefined ? sampleData() : over.data;
  const user = over.user === undefined ? USER : over.user;
  const me = data && user ? (data.members.find((m) => m.user_id === user.id) ?? null) : null;
  return {
    backend: fakeBackend(),
    phase: user ? { kind: 'ready', user } : { kind: 'signedOut' },
    user,
    data,
    me,
    today: '2026-10-08',
    pendingInvite: null,
    onboardingTail: false,
    claimed: false,
    confirmClaimed: vi.fn(async () => {}),
    releaseClaim: vi.fn(async () => {}),
    finishOnboarding: vi.fn(),
    invitePeople: false,
    doneInvitingPeople: vi.fn(),
    retry: vi.fn(async () => {}),
    dismissInvite: vi.fn(),
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    createHousehold: vi.fn(async () => {}),
    joinHousehold: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    demoImport: null,
    demoImportMode: null,
    importDemoHome: vi.fn(async () => {}),
    declineDemoImport: vi.fn(),
    reopenDemoImport: vi.fn(),
    canReopenDemoImport: false,
    recheckHome: vi.fn(async () => {}),
    updateHousehold: vi.fn(async () => {}),
    updateMember: vi.fn(async () => {}),
    addPerson: vi.fn(async () => {
      throw new Error('addPerson not set up in this test');
    }),
    setPersonEmail: vi.fn(async () => {}),
    removePerson: vi.fn(async () => {}),
    createArea: vi.fn(async () => {
      throw new Error('createArea not set up in this test');
    }),
    renameArea: vi.fn(async () => {}),
    deleteArea: vi.fn(async () => {}),
    reorderAreas: vi.fn(async () => {}),
    createItem: vi.fn(async () => {
      throw new Error('createItem not set up in this test');
    }),
    updateItem: vi.fn(async () => {}),
    deleteItem: vi.fn(async () => {}),
    completeItem: vi.fn(async () => {}),
    createInvite: vi.fn(async () => 'token'),
    setHousekeepingNote: vi.fn(async () => {}),
    undoClearHousekeepingNote: vi.fn(async () => {}),
    createHousekeepingTask: vi.fn(async () => {
      throw new Error('createHousekeepingTask not set up in this test');
    }),
    renameHousekeepingTask: vi.fn(async () => {}),
    deleteHousekeepingTask: vi.fn(async () => {}),
    arrangeHousekeepingTasks: vi.fn(async () => {}),
    createHousekeepingSection: vi.fn(async () => {
      throw new Error('createHousekeepingSection not set up in this test');
    }),
    renameHousekeepingSection: vi.fn(async () => {}),
    deleteHousekeepingSection: vi.fn(async () => {}),
    reorderHousekeepingSections: vi.fn(async () => {}),
    setHousekeepingTaskDone: vi.fn(async () => {}),
    saveHousekeepingVisit: vi.fn(async () => {}),
    addHousekeepingVisit: vi.fn(async () => {}),
    deleteHousekeepingVisit: vi.fn(async () => {}),
    serverWelcome: null,
    bringHomeOnline: vi.fn(async () => {}),
    redeemCode: vi.fn(async () => {}),
    createCode: vi.fn(async () => {
      throw new Error('createCode not set up in this test');
    }),
    listDevices: vi.fn(async () => []),
    removeDevice: vi.fn(async () => {}),
    chooseSetupHere: vi.fn(),
    chooseSavedCopy: vi.fn(),
    startSetup: vi.fn(() => false),
    continueWithGoogle: vi.fn(),
    createAccount: vi.fn(async () => {}),
    signInWithPassword: vi.fn(async () => {}),
    readOnly: false,
    ...notifyActions(fakeNotify()),
    toast: null,
    showToast: vi.fn(),
    dismissToast: vi.fn(),
    holdToast: vi.fn(),
    ...over,
    // After `over`, so a test that passes data or user gets the matching `me`.
    ...(over.me === undefined ? { me } : {}),
  };
}
