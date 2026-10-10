import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, DEMO_USER, type StorageLike } from '../lib/backend/demo';
import { BackendError } from '../lib/backend/types';
import { addDays } from '../lib/logic/dates';
import { checklistFor, visitOn } from '../lib/logic/housekeeping';
import type { CreateHouseholdInput, HouseholdData, HousekeepingVisit } from '../lib/types';
import { HomeProvider, notSavedMessage, useHome, type HomeContextValue } from './HomeProvider';

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

function Expose({ onHome }: { onHome(home: HomeContextValue): void }) {
  onHome(useHome());
  return null;
}

function mount(backend: DemoBackend) {
  let home!: HomeContextValue;
  render(
    <HomeProvider backend={backend}>
      <Expose onHome={(h) => (home = h)} />
    </HomeProvider>,
  );
  return () => home;
}

/** Signed in as Stratis in the seeded prototype household. */
async function seeded() {
  const backend = new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 });
  const home = mount(backend);
  await waitFor(() => expect(home().phase.kind).toBe('ready'));
  return { backend, home, hid: home().data!.household.id };
}

/** A promise you settle by hand. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const offline = () => new BackendError('network');
const itemNamed = (home: () => HomeContextValue, title: string) => home().data!.items.find((i) => i.title === title);
const flush = () => act(() => new Promise((r) => setTimeout(r, 10)));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('failed writes', () => {
  it('bring a completed item back and say it was not saved', async () => {
    const { backend, home } = await seeded();
    vi.spyOn(backend, 'load').mockRejectedValue(offline());
    vi.spyOn(backend, 'completeItem').mockRejectedValue(offline());
    const item = itemNamed(home, 'Heaters not working')!;
    expect(item.repeat).toBe('none');

    let result: Promise<void> | undefined;
    act(() => {
      result = home().completeItem(item.id);
    });
    // Optimistic: gone at once.
    expect(itemNamed(home, 'Heaters not working')).toBeUndefined();
    await act(async () => {
      await expect(result).rejects.toThrow();
    });
    expect(itemNamed(home, 'Heaters not working')).toEqual(item);
    expect(home().toast?.message).toBe('Couldn’t save. No connection.');
    expect(home().toast?.action).toBeUndefined();
  });

  it('put back a repeating item’s due date', async () => {
    const { backend, home } = await seeded();
    vi.spyOn(backend, 'load').mockRejectedValue(offline());
    vi.spyOn(backend, 'completeItem').mockRejectedValue(offline());
    const item = itemNamed(home, 'Kitchen paper')!;
    expect(item.repeat).not.toBe('none');
    await act(async () => {
      await home()
        .completeItem(item.id)
        .catch(() => {});
    });
    expect(itemNamed(home, 'Kitchen paper')!.due_date).toBe(item.due_date);
  });

  it('take back only that change, not edits made meanwhile', async () => {
    const { backend, home } = await seeded();
    const item = itemNamed(home, 'Olive oil')!;
    const me = home().me!;
    const write = deferred();
    vi.spyOn(backend, 'updateItem').mockImplementationOnce(() => write.promise);
    // Reloads fail throughout (a flaky connection), so only the revert can fix the screen.
    vi.spyOn(backend, 'load').mockRejectedValue(offline());

    let failed: Promise<void> | undefined;
    act(() => {
      failed = home().updateItem(item.id, { title: 'Olive oil (big tin)', rag: 'red' });
    });
    expect(itemNamed(home, 'Olive oil (big tin)')?.rag).toBe('red');
    // Other edits go through while the first is still in flight.
    await act(() => home().updateMember(me.id, { emoji: '🦊' }));
    await act(() => home().updateItem(item.id, { note: 'Get two.' }));

    // Then the first write fails.
    await act(async () => {
      write.reject(offline());
      await expect(failed).rejects.toThrow();
    });
    const after = home().data!.items.find((i) => i.id === item.id)!;
    expect(after).toMatchObject({ title: 'Olive oil', rag: item.rag, note: 'Get two.' });
    expect(home().me!.emoji).toBe('🦊');
  });

  it('bring a deleted area back with its items', async () => {
    const { backend, home } = await seeded();
    vi.spyOn(backend, 'load').mockRejectedValue(offline());
    vi.spyOn(backend, 'deleteArea').mockRejectedValue(offline());
    const before = home().data!;
    const kitchen = before.areas.find((a) => a.name === 'Kitchen')!;
    await act(async () => {
      await home()
        .deleteArea(kitchen.id)
        .catch(() => {});
    });
    const after = home().data!;
    expect(after.areas.map((a) => a.id)).toEqual(before.areas.map((a) => a.id));
    expect(after.items.filter((i) => i.area_id === kitchen.id)).toHaveLength(
      before.items.filter((i) => i.area_id === kitchen.id).length,
    );
  });

  it('put back the area order, member and household fields', async () => {
    const { backend, home } = await seeded();
    vi.spyOn(backend, 'load').mockRejectedValue(offline());
    vi.spyOn(backend, 'reorderAreas').mockRejectedValue(offline());
    vi.spyOn(backend, 'updateHousehold').mockRejectedValue(offline());
    vi.spyOn(backend, 'updateMember').mockRejectedValue(offline());
    vi.spyOn(backend, 'renameArea').mockRejectedValue(offline());
    const before = home().data!;
    const reversed = [...before.areas].reverse().map((a) => a.id);
    await act(async () => {
      await home()
        .reorderAreas(reversed)
        .catch(() => {});
      await home()
        .updateHousehold({ name: 'Elsewhere' })
        .catch(() => {});
      await home()
        .updateMember(home().me!.id, { name: 'Someone' })
        .catch(() => {});
      await home()
        .renameArea(before.areas[0].id, 'Pantry')
        .catch(() => {});
    });
    expect(home().data).toEqual(before);
  });

  it('say what failed', () => {
    expect(notSavedMessage(new BackendError('network'))).toBe('Couldn’t save. No connection.');
    expect(notSavedMessage(new BackendError('not_found'))).toBe('Couldn’t save. That was removed by someone else.');
    expect(notSavedMessage(new BackendError('not_signed_in'))).toBe('Couldn’t save. Please sign in again.');
    expect(notSavedMessage(new Error('boom'), 'undo')).toBe('Couldn’t undo. Try again.');
  });

  it('undo is shown at once and taken back if it fails', async () => {
    const { backend, home } = await seeded();
    const item = itemNamed(home, 'Heaters not working')!;
    await act(() => home().completeItem(item.id));
    expect(home().toast?.message).toBe('Marked as done');
    vi.spyOn(backend, 'load').mockRejectedValue(offline());
    const undo = deferred();
    vi.spyOn(backend, 'undoCompletion').mockImplementation(() => undo.promise);
    act(() => home().toast!.action!.run());
    expect(itemNamed(home, 'Heaters not working')).toEqual(item);
    await act(async () => {
      undo.reject(offline());
      await undo.promise.catch(() => {});
    });
    await flush();
    expect(itemNamed(home, 'Heaters not working')).toBeUndefined();
    expect(home().toast?.message).toBe('Couldn’t undo. No connection.');
  });
});

describe('load ordering', () => {
  it('never shows a load that started before a later write', async () => {
    const { backend, home, hid } = await seeded();
    const stale = await backend.load(hid);
    const gate = deferred();
    vi.spyOn(backend, 'load').mockImplementationOnce(async () => {
      await gate.promise;
      return stale;
    });
    let refreshing: Promise<void> | undefined;
    act(() => {
      refreshing = home().refresh();
    });
    const item = itemNamed(home, 'Mirror lights not level')!;
    await act(() => home().completeItem(item.id));
    await flush();
    expect(itemNamed(home, 'Mirror lights not level')).toBeUndefined();

    // The old load lands last.
    await act(async () => {
      gate.resolve();
      await refreshing;
    });
    expect(itemNamed(home, 'Mirror lights not level')).toBeUndefined();
  });

  it('drops a load that started while a write was in flight', async () => {
    const { backend, home, hid } = await seeded();
    const item = itemNamed(home, 'Olive oil')!;
    const realUpdate = backend.updateItem.bind(backend);
    const write = deferred();
    vi.spyOn(backend, 'updateItem').mockImplementationOnce(async (id, patch) => {
      await write.promise;
      return realUpdate(id, patch);
    });
    let saving: Promise<void> | undefined;
    act(() => {
      saving = home().updateItem(item.id, { title: 'Olive oil (big tin)' });
    });
    // A realtime refresh reads the server before the write reaches it, and lands late.
    const stale = await backend.load(hid);
    const gate = deferred();
    vi.spyOn(backend, 'load').mockImplementationOnce(async () => {
      await gate.promise;
      return stale;
    });
    let refreshing: Promise<void> | undefined;
    act(() => {
      refreshing = home().refresh();
    });
    await act(async () => {
      write.resolve();
      await saving;
    });
    // The write's own refresh lands first; the older one arrives after it.
    await flush();
    expect(itemNamed(home, 'Olive oil (big tin)')).toBeTruthy();
    await act(async () => {
      gate.resolve();
      await refreshing;
    });
    await flush();
    expect(itemNamed(home, 'Olive oil (big tin)')).toBeTruthy();
    expect(itemNamed(home, 'Olive oil')).toBeUndefined();
  });

  it('ends on the last value after quick successive edits', async () => {
    const { backend, home, hid } = await seeded();
    const me = home().me!;
    // Each reload resolves in reverse order of starting.
    const realLoad = backend.load.bind(backend);
    const gates: Array<() => void> = [];
    vi.spyOn(backend, 'load').mockImplementation(async (id) => {
      const snapshot = await realLoad(id);
      const gate = deferred();
      gates.unshift(gate.resolve);
      await gate.promise;
      return snapshot;
    });
    await act(async () => {
      await home().updateMember(me.id, { emoji: '🦊' });
      await home().updateMember(me.id, { emoji: '🐻' });
    });
    await flush();
    await act(async () => {
      for (const release of gates) {
        release();
        await new Promise((r) => setTimeout(r, 0));
      }
    });
    await flush();
    expect(home().me!.emoji).toBe('🐻');
    expect((await realLoad(hid)).members.find((m) => m.id === me.id)!.emoji).toBe('🐻');
  });

  it('a refresh in flight cannot bring the household back after signing out', async () => {
    const { backend, home, hid } = await seeded();
    const stale = await backend.load(hid);
    const gate = deferred();
    vi.spyOn(backend, 'load').mockImplementationOnce(async () => {
      await gate.promise;
      return stale;
    });
    let refreshing: Promise<void> | undefined;
    act(() => {
      refreshing = home().refresh();
    });
    await act(() => home().signOut());
    await waitFor(() => expect(home().phase.kind).toBe('signedOut'));
    await act(async () => {
      gate.resolve();
      await refreshing;
    });
    expect(home().data).toBeNull();
    expect(home().phase.kind).toBe('signedOut');
  });

  it('a sign-in still loading cannot land after signing out', async () => {
    const storage = new MemoryStorage();
    const backend = new DemoBackend({ storage, search: '?demo-seed=1', latency: 0 });
    const hid = (await backend.getMyHouseholdId())!;
    const snapshot = await backend.load(hid);
    const gate = deferred();
    vi.spyOn(backend, 'load').mockImplementationOnce(async () => {
      await gate.promise;
      return snapshot;
    });
    const home = mount(backend);
    await waitFor(() => expect(backend.load).toHaveBeenCalled());
    await act(() => backend.signOut());
    await waitFor(() => expect(home().phase.kind).toBe('signedOut'));
    await act(async () => {
      gate.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(home().phase.kind).toBe('signedOut');
    expect(home().data).toBeNull();
  });
});

describe('setup', () => {
  const input: CreateHouseholdInput = {
    name: 'Alderbrook',
    address: '',
    timezone: 'Europe/London',
    memberName: 'Stratis',
    memberEmoji: '🦔',
    areas: ['Kitchen'],
    items: [],
  };

  /** Signed in with no household yet. */
  async function newcomer(storage = new MemoryStorage()) {
    const backend = new DemoBackend({ storage, search: '', latency: 0 });
    await backend.signInWithGoogle();
    const home = mount(backend);
    await waitFor(() => expect(home().phase.kind).toBe('onboarding'));
    return { backend, home, storage };
  }

  it('goes to the error screen if the new home cannot be loaded, and Try again opens it', async () => {
    const { backend, home, storage } = await newcomer();
    vi.spyOn(backend, 'load').mockRejectedValueOnce(offline());
    await act(() => home().createHousehold(input));
    expect(home().phase).toEqual({ kind: 'error', message: 'No connection. Try again in a moment.' });

    // Try again reloads the app: it opens the home that was created.
    cleanup();
    const again = mount(new DemoBackend({ storage, search: '', latency: 0 }));
    await waitFor(() => expect(again().phase.kind).toBe('ready'));
    expect(again().data!.household.name).toBe('Alderbrook');
  });

  it('opens the home when creating says it already exists (an earlier reply was lost)', async () => {
    const { backend, home } = await newcomer();
    await backend.createHousehold(input);
    await act(() => home().createHousehold({ ...input, name: 'Second try' }));
    expect(home().phase.kind).toBe('ready');
    expect(home().data!.household.name).toBe('Alderbrook');
    expect(home().onboardingTail).toBe(true);
  });

  it('opens your home when joining another one says you are already a member', async () => {
    const storage = new MemoryStorage();
    const shea = new DemoBackend({ storage, search: '', latency: 0, user: { id: 'u-shea', email: 's@x', name: 'Shea' } });
    await shea.signInWithGoogle();
    await shea.createHousehold({ ...input, name: 'Shea’s', memberName: 'Shea' });
    const token = await shea.createInvite();
    await shea.signOut();

    const { backend, home } = await newcomer(storage);
    await backend.createHousehold(input);
    await act(() => home().joinHousehold({ token, memberName: 'Stratis', memberEmoji: '🦔' }));
    expect(home().phase.kind).toBe('ready');
    expect(home().data!.household.name).toBe('Alderbrook');
    expect(home().onboardingTail).toBe(false);
    expect(home().toast?.message).toBe('You are already part of a household.');
  });

  it('still reports other errors from creating', async () => {
    const { backend, home } = await newcomer();
    vi.spyOn(backend, 'createHousehold').mockRejectedValueOnce(offline());
    await act(async () => {
      await expect(home().createHousehold(input)).rejects.toThrow();
    });
    expect(home().phase.kind).toBe('onboarding');
  });

  it('shows the new home after creating it', async () => {
    const { home } = await newcomer();
    await act(() => home().createHousehold(input));
    expect(home().phase).toEqual({ kind: 'ready', user: DEMO_USER });
    expect((home().data as HouseholdData).areas.map((a) => a.name)).toEqual(['Kitchen']);
  });
});

describe('kinds: To do and To maintain', () => {
  it('never completes a state (no request, no toast, it stays)', async () => {
    const { backend, home } = await seeded();
    const complete = vi.spyOn(backend, 'completeItem');
    const firepit = itemNamed(home, 'Firepit')!;
    expect(firepit.kind).toBe('state');
    await act(() => home().completeItem(firepit.id));
    expect(complete).not.toHaveBeenCalled();
    expect(home().toast).toBeNull();
    expect(itemNamed(home, 'Firepit')).toEqual(firepit);
  });

  it('shows a task becoming a state at once, without its due date and with a fresh Updated time', async () => {
    const { backend, home } = await seeded();
    const gate = deferred();
    const update = vi.spyOn(backend, 'updateItem').mockImplementation(() => gate.promise);
    const before = itemNamed(home, 'Kitchen paper')!;
    expect(before).toMatchObject({ kind: 'task', repeat: 'monthly' });
    let result: Promise<void> | undefined;
    act(() => {
      result = home().updateItem(before.id, { kind: 'state' });
    });
    const shown = itemNamed(home, 'Kitchen paper')!;
    expect(shown).toMatchObject({ kind: 'state', due_date: null, repeat: 'none', notify: 'none' });
    expect(shown.updated_at > before.updated_at).toBe(true);
    // What is sent: the kind and what it clears.
    expect(update).toHaveBeenCalledWith(before.id, { kind: 'state', due_date: null, repeat: 'none', notify: 'none' });
    gate.resolve();
    await act(async () => {
      await result;
    });
  });

  it('sends only what changed when a state is edited, and takes it all back if that fails', async () => {
    const { backend, home } = await seeded();
    vi.spyOn(backend, 'load').mockRejectedValue(offline());
    const update = vi.spyOn(backend, 'updateItem').mockRejectedValue(offline());
    const firepit = itemNamed(home, 'Firepit')!;
    let result: Promise<void> | undefined;
    act(() => {
      result = home().updateItem(firepit.id, { rag: 'amber' });
    });
    expect(update).toHaveBeenCalledWith(firepit.id, { rag: 'amber' });
    expect(itemNamed(home, 'Firepit')!.rag).toBe('amber');
    await act(async () => {
      await expect(result).rejects.toThrow();
    });
    expect(itemNamed(home, 'Firepit')).toEqual(firepit);
  });

  it('creates a state without a due date, repeat or reminder', async () => {
    const { backend, home } = await seeded();
    const create = vi.spyOn(backend, 'createItem');
    const garden = home().data!.areas.find((a) => a.name === 'Garden')!;
    await act(async () => {
      await home().createItem({
        area_id: garden.id,
        kind: 'state',
        title: 'Pizza oven',
        note: '',
        good: 'Cover on, no ash left inside.',
        rag: 'green',
        due_date: '2026-10-20',
        assignee_id: null,
        repeat: 'weekly',
        notify: 'day_before',
      });
    });
    expect(create.mock.calls[0][1]).toMatchObject({ kind: 'state', due_date: null, repeat: 'none', notify: 'none' });
    await waitFor(() => expect(itemNamed(home, 'Pizza oven')).toMatchObject({ kind: 'state', due_date: null }));
  });
});

describe('housekeeping', () => {
  const hk = (home: () => HomeContextValue) => home().data!.housekeeping;
  const dayVisit = (home: () => HomeContextValue, date: string) => visitOn(hk(home).visits, date);
  /** The seed's latest visit (a Thursday before today). */
  const lastVisit = (home: () => HomeContextValue): HousekeepingVisit => hk(home).visits[0];
  /** A day this week before today without a visit (the seed's visits are on Thursdays). */
  const dayWithoutVisit = (home: () => HomeContextValue) =>
    [1, 2, 3, 4, 5, 6].map((n) => addDays(home().today, -n)).find((d) => !dayVisit(home, d))!;

  async function rejected(p: Promise<unknown>): Promise<unknown> {
    return p.then(
      () => null,
      (e: unknown) => e,
    );
  }

  it("a tick on a day without a visit shows a pending visit at once, then the stored one under the same keys", async () => {
    const { backend, home } = await seeded();
    const today = home().today;
    expect(dayVisit(home, today)).toBeUndefined();
    const keys = checklistFor(hk(home), today).map((r) => r.key);
    const [first, second] = hk(home).tasks;
    const write = deferred();
    const real = backend.setHousekeepingTaskDone.bind(backend);
    const tick = vi.spyOn(backend, 'setHousekeepingTaskDone').mockImplementation(async (...args) => {
      await write.promise;
      return real(...args);
    });

    let result: Promise<void> | undefined;
    act(() => {
      result = home().setHousekeepingTaskDone(today, { taskId: first.id }, true);
    });
    const pending = dayVisit(home, today)!;
    expect(pending.id).toBe(`pending:${today}`);
    expect(pending).toMatchObject({ created_by: home().me!.id, comments: '', price_pence: null, note: hk(home).note.body });
    expect(pending.tasks.map((r) => r.id)).toEqual(hk(home).tasks.map((t) => `pending:${t.id}`));
    expect(pending.tasks[0]).toMatchObject({ task_id: first.id, done: true, done_by: home().me!.id });
    expect(hk(home).visits[0]).toBe(pending);

    // A second tick that day goes on the pending visit, and is sent by task too.
    act(() => {
      void home().setHousekeepingTaskDone(today, { taskId: second.id }, true);
    });
    expect(dayVisit(home, today)!.tasks.filter((r) => r.done).map((r) => r.task_id)).toEqual([first.id, second.id]);
    expect(tick.mock.calls.map((c) => c[2])).toEqual([{ taskId: first.id }, { taskId: second.id }]);

    await act(async () => {
      write.resolve();
      await result;
    });
    await flush();
    await waitFor(() => expect(dayVisit(home, today)!.id).not.toMatch(/^pending:/));
    const stored = dayVisit(home, today)!;
    expect(stored.tasks.filter((r) => r.done).map((r) => r.task_id)).toEqual([first.id, second.id]);
    expect(checklistFor(hk(home), today).map((r) => r.key)).toEqual(keys);
    expect(home().toast).toBeNull();
  });

  it('a failed first write takes the pending visit away and says it was not saved', async () => {
    const { backend, home } = await seeded();
    const today = home().today;
    vi.spyOn(backend, 'load').mockRejectedValue(offline());
    vi.spyOn(backend, 'saveHousekeepingVisit').mockRejectedValue(offline());
    const before = home().data;
    let result: Promise<void> | undefined;
    act(() => {
      result = home().saveHousekeepingVisit(today, { comments: 'Out of bin bags.' });
    });
    expect(dayVisit(home, today)).toMatchObject({ id: `pending:${today}`, comments: 'Out of bin bags.' });
    await act(async () => {
      await expect(result).rejects.toThrow();
    });
    expect(dayVisit(home, today)).toBeUndefined();
    expect(home().data).toEqual(before);
    expect(home().toast?.message).toBe('Couldn’t save. No connection.');
  });

  it('a failed tick takes back only its change, not ticks, comments or a price saved meanwhile', async () => {
    const { backend, home } = await seeded();
    const visit = lastVisit(home);
    const undone = visit.tasks.find((r) => !r.done)!;
    const done = visit.tasks.find((r) => r.done)!;
    const write = deferred<string>();
    vi.spyOn(backend, 'setHousekeepingTaskDone').mockImplementationOnce(() => write.promise);
    // Reloads fail throughout (a flaky connection), so only the revert can fix the screen.
    vi.spyOn(backend, 'load').mockRejectedValue(offline());

    let failed: Promise<void> | undefined;
    act(() => {
      failed = home().setHousekeepingTaskDone(visit.visit_date, { taskId: undone.task_id! }, true);
    });
    const shown = dayVisit(home, visit.visit_date)!;
    expect(shown.tasks.find((r) => r.id === undone.id)).toMatchObject({ done: true, done_by: home().me!.id });
    expect(shown.updated_by).toBe(home().me!.id);

    await act(() => home().setHousekeepingTaskDone(visit.visit_date, { taskId: done.task_id! }, false));
    await act(() => home().saveHousekeepingVisit(visit.visit_date, { comments: 'Thanks!', price_pence: 6500 }));

    await act(async () => {
      write.reject(offline());
      await expect(failed).rejects.toThrow();
    });
    const after = dayVisit(home, visit.visit_date)!;
    expect(after.tasks.find((r) => r.id === undone.id)).toEqual(undone);
    expect(after.tasks.find((r) => r.id === done.id)).toMatchObject({ done: false, done_by: null, done_at: null });
    expect(after).toMatchObject({ comments: 'Thanks!', price_pence: 6500, updated_by: home().me!.id });
    expect(home().toast?.message).toBe('Couldn’t save. No connection.');
  });

  it('a failed save puts back the comments and the price, and the stamp', async () => {
    const { backend, home } = await seeded();
    const visit = lastVisit(home);
    vi.spyOn(backend, 'load').mockRejectedValue(offline());
    vi.spyOn(backend, 'saveHousekeepingVisit').mockRejectedValue(offline());
    await act(async () => {
      await home()
        .saveHousekeepingVisit(visit.visit_date, { comments: '  New  ', price_pence: null })
        .catch(() => {});
    });
    expect(dayVisit(home, visit.visit_date)).toEqual(visit);
  });

  it('saves comments and the price on a past visit, shown at once and kept', async () => {
    const { backend, home } = await seeded();
    const visit = lastVisit(home);
    const save = vi.spyOn(backend, 'saveHousekeepingVisit');
    let result: Promise<void> | undefined;
    act(() => {
      result = home().saveHousekeepingVisit(visit.visit_date, { comments: '  Oven too. ', price_pence: 7000 });
    });
    expect(dayVisit(home, visit.visit_date)).toMatchObject({ id: visit.id, comments: 'Oven too.', price_pence: 7000 });
    await act(() => result!);
    expect(save).toHaveBeenCalledWith(home().data!.household.id, visit.visit_date, { comments: '  Oven too. ', price_pence: 7000 });
    await waitFor(() => expect(dayVisit(home, visit.visit_date)).toMatchObject({ comments: 'Oven too.', price_pence: 7000 }));
    expect(dayVisit(home, visit.visit_date)!.updated_by).toBe(home().me!.id);
  });

  it('refuses a day after today without a write or a toast', async () => {
    const { backend, home } = await seeded();
    const tomorrow = addDays(home().today, 1);
    const spies = [
      vi.spyOn(backend, 'setHousekeepingTaskDone'),
      vi.spyOn(backend, 'saveHousekeepingVisit'),
      vi.spyOn(backend, 'addHousekeepingVisit'),
    ];
    const before = home().data;
    const task = hk(home).tasks[0];
    for (const call of [
      () => home().setHousekeepingTaskDone(tomorrow, { taskId: task.id }, true),
      () => home().saveHousekeepingVisit(tomorrow, { comments: 'x' }),
      () => home().addHousekeepingVisit(tomorrow),
    ]) {
      const err = await rejected(call());
      expect(err).toBeInstanceOf(BackendError);
      expect((err as BackendError).code).toBe('unknown');
      expect((err as BackendError).message).toBe('invalid_input: date');
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(home().toast).toBeNull();
    expect(home().data).toBe(before);
  });

  it('"Add a visit" shows the day at once, nothing ticked; a day that has one keeps it', async () => {
    const { home } = await seeded();
    const day = dayWithoutVisit(home);
    let result: Promise<void> | undefined;
    act(() => {
      result = home().addHousekeepingVisit(day);
    });
    expect(dayVisit(home, day)).toMatchObject({ id: `pending:${day}`, comments: '' });
    expect(dayVisit(home, day)!.tasks.some((r) => r.done)).toBe(false);
    await act(() => result!);
    await waitFor(() => expect(dayVisit(home, day)!.id).not.toMatch(/^pending:/));

    const visit = lastVisit(home);
    const before = home().data;
    let again: Promise<void> | undefined;
    act(() => {
      again = home().addHousekeepingVisit(visit.visit_date);
    });
    expect(home().data).toBe(before);
    await act(() => again!);
  });

  it('deletes a visit at once; a failure brings it back', async () => {
    const { backend, home } = await seeded();
    const visit = lastVisit(home);
    const failing = vi.spyOn(backend, 'deleteHousekeepingVisit').mockRejectedValueOnce(offline());
    vi.spyOn(backend, 'load').mockRejectedValueOnce(offline());
    let result: Promise<void> | undefined;
    act(() => {
      result = home().deleteHousekeepingVisit(visit.id);
    });
    expect(dayVisit(home, visit.visit_date)).toBeUndefined();
    await act(async () => {
      await expect(result).rejects.toThrow();
    });
    expect(lastVisit(home)).toEqual(visit);

    failing.mockRestore();
    await act(() => home().deleteHousekeepingVisit(visit.id));
    await flush();
    await waitFor(() => expect(dayVisit(home, visit.visit_date)).toBeUndefined());
  });

  describe('deleting a visit still shown as pending', () => {
    it('straight after "Add a visit": waits for the add, then deletes the stored visit', async () => {
      const { backend, home, hid } = await seeded();
      const day = dayWithoutVisit(home);
      const write = deferred();
      const realAdd = backend.addHousekeepingVisit.bind(backend);
      vi.spyOn(backend, 'addHousekeepingVisit').mockImplementation(async (...args) => {
        await write.promise;
        return realAdd(...args);
      });
      const del = vi.spyOn(backend, 'deleteHousekeepingVisit');
      let added: Promise<void> | undefined;
      let deleted: Promise<void> | undefined;
      act(() => {
        added = home().addHousekeepingVisit(day);
      });
      expect(dayVisit(home, day)!.id).toBe(`pending:${day}`);
      act(() => {
        deleted = home().deleteHousekeepingVisit(`pending:${day}`);
      });
      expect(dayVisit(home, day)).toBeUndefined();
      expect(del).not.toHaveBeenCalled();

      await act(async () => {
        write.resolve();
        await added;
        await deleted;
      });
      expect(del).toHaveBeenCalledTimes(1);
      expect(del.mock.calls[0][0]).toMatch(/^[0-9a-f-]{36}$/);
      await flush();
      expect(dayVisit(home, day)).toBeUndefined();
      expect((await backend.load(hid)).housekeeping.visits.some((v) => v.visit_date === day)).toBe(false);
      expect(home().toast).toBeNull();
    });

    it('left on screen by a reload that failed: deleted by the id the write returned', async () => {
      const { backend, home, hid } = await seeded();
      const day = dayWithoutVisit(home);
      const realLoad = backend.load.bind(backend);
      const load = vi.spyOn(backend, 'load').mockRejectedValue(offline());
      await act(() => home().saveHousekeepingVisit(day, { price_pence: 6000 }));
      await flush();
      expect(dayVisit(home, day)).toMatchObject({ id: `pending:${day}`, price_pence: 6000 });

      const del = vi.spyOn(backend, 'deleteHousekeepingVisit');
      await act(() => home().deleteHousekeepingVisit(`pending:${day}`));
      expect(del).toHaveBeenCalledTimes(1);
      expect(del.mock.calls[0][0]).not.toMatch(/^pending:/);
      load.mockImplementation(realLoad);
      expect((await backend.load(hid)).housekeeping.visits.some((v) => v.visit_date === day)).toBe(false);
      expect(home().toast).toBeNull();
    });

    it('whose write failed: nothing was stored, so nothing is sent', async () => {
      const { backend, home } = await seeded();
      const day = dayWithoutVisit(home);
      vi.spyOn(backend, 'load').mockRejectedValue(offline());
      const write = deferred<string>();
      vi.spyOn(backend, 'addHousekeepingVisit').mockImplementation(() => write.promise);
      const del = vi.spyOn(backend, 'deleteHousekeepingVisit');
      let added: Promise<void> | undefined;
      let deleted: Promise<void> | undefined;
      act(() => {
        added = home().addHousekeepingVisit(day);
      });
      act(() => {
        deleted = home().deleteHousekeepingVisit(`pending:${day}`);
      });
      await act(async () => {
        write.reject(offline());
        await expect(added).rejects.toThrow();
        await deleted;
      });
      expect(del).not.toHaveBeenCalled();
      expect(dayVisit(home, day)).toBeUndefined();
    });
  });

  describe('the message', () => {
    it('shows at once with me and now; unchanged text sends nothing', async () => {
      const { backend, home } = await seeded();
      const set = vi.spyOn(backend, 'setHousekeepingNote');
      const before = hk(home).note;
      await act(() => home().setHousekeepingNote(`  ${before.body}\n`));
      expect(set).not.toHaveBeenCalled();

      const start = Date.now();
      let result: Promise<void> | undefined;
      act(() => {
        result = home().setHousekeepingNote('  Spare room first, please.\n');
      });
      const shown = hk(home).note;
      expect(shown).toMatchObject({ body: 'Spare room first, please.', updated_by: home().me!.id });
      expect(new Date(shown.updated_at!).getTime()).toBeGreaterThanOrEqual(start);
      await act(() => result!);
      expect(set).toHaveBeenCalledWith(home().data!.household.id, 'Spare room first, please.');
      await waitFor(() => expect(hk(home).note.body).toBe('Spare room first, please.'));

      // Clearing it.
      await act(() => home().setHousekeepingNote(''));
      await waitFor(() => expect(hk(home).note).toMatchObject({ body: '', updated_by: home().me!.id }));
    });

    it('Undo after Clear shows the message as it was at once, and the backend keeps who wrote it', async () => {
      const { backend, home } = await seeded();
      const before = hk(home).note;
      expect(before.body).not.toBe('');
      expect(before.updated_by).not.toBe(home().me!.id);
      // The Clear is still on its way when Undo is tapped: Undo goes after it.
      const clearing = deferred();
      const realSet = backend.setHousekeepingNote.bind(backend);
      vi.spyOn(backend, 'setHousekeepingNote').mockImplementationOnce(async (...args) => {
        await clearing.promise;
        return realSet(...args);
      });
      const undo = vi.spyOn(backend, 'undoClearHousekeepingNote');
      let cleared: Promise<void> | undefined;
      let undone: Promise<void> | undefined;
      act(() => {
        cleared = home().setHousekeepingNote('');
      });
      expect(hk(home).note.body).toBe('');
      act(() => {
        undone = home().undoClearHousekeepingNote(before);
      });
      expect(hk(home).note).toEqual(before);
      await flush();
      expect(undo).not.toHaveBeenCalled();
      await act(async () => {
        clearing.resolve();
        await cleared;
        await undone;
      });
      expect(undo).toHaveBeenCalledTimes(1);
      await flush();
      await waitFor(() => expect(hk(home).note).toEqual(before));
      expect(home().toast).toBeNull();

      // With a message there again, Undo shows no change (the backend leaves it alone too).
      await act(() => home().undoClearHousekeepingNote({ ...before, body: 'Older' }));
      expect(hk(home).note).toEqual(before);
    });

    it('a failed Undo after Clear takes the message away again and says so', async () => {
      const { backend, home } = await seeded();
      const before = hk(home).note;
      await act(() => home().setHousekeepingNote(''));
      await waitFor(() => expect(hk(home).note.body).toBe(''));
      vi.spyOn(backend, 'load').mockRejectedValue(offline());
      vi.spyOn(backend, 'undoClearHousekeepingNote').mockRejectedValueOnce(offline());
      await act(async () => {
        await expect(home().undoClearHousekeepingNote(before)).rejects.toThrow();
      });
      expect(hk(home).note.body).toBe('');
      expect(home().toast?.message).toBe('Couldn’t undo. No connection.');
    });

    it('a failure puts the old message back, unless it was changed again meanwhile', async () => {
      const { backend, home } = await seeded();
      const before = hk(home).note;
      vi.spyOn(backend, 'load').mockRejectedValue(offline());
      vi.spyOn(backend, 'setHousekeepingNote').mockRejectedValueOnce(offline());
      await act(async () => {
        await home()
          .setHousekeepingNote('Lost')
          .catch(() => {});
      });
      expect(hk(home).note).toEqual(before);
      expect(home().toast?.message).toBe('Couldn’t save. No connection.');

      const first = deferred();
      vi.spyOn(backend, 'setHousekeepingNote').mockImplementationOnce(() => first.promise);
      let failed: Promise<void> | undefined;
      act(() => {
        failed = home().setHousekeepingNote('First');
      });
      await act(() => home().setHousekeepingNote('Second'));
      await act(async () => {
        first.reject(offline());
        await expect(failed).rejects.toThrow();
      });
      expect(hk(home).note.body).toBe('Second');
    });
  });

  describe('the task list', () => {
    it('createHousekeepingTask is not optimistic: it resolves to the stored task, then shows it, today too', async () => {
      const { backend, home } = await seeded();
      const today = home().today;
      await act(() => home().addHousekeepingVisit(today));
      await waitFor(() => expect(dayVisit(home, today)!.id).not.toMatch(/^pending:/));
      const write = deferred();
      const real = backend.createHousekeepingTask.bind(backend);
      vi.spyOn(backend, 'createHousekeepingTask').mockImplementationOnce(async (hid, title) => {
        await write.promise;
        return real(hid, title);
      });
      // Slow reloads, so what shows first is the stored task itself.
      const realLoad = backend.load.bind(backend);
      const reload = deferred();
      vi.spyOn(backend, 'load').mockImplementation(async (id) => {
        const data = await realLoad(id);
        await reload.promise;
        return data;
      });
      const count = hk(home).tasks.length;
      let created: Promise<unknown> | undefined;
      act(() => {
        created = home().createHousekeepingTask('  Windows ');
      });
      expect(hk(home).tasks).toHaveLength(count);
      let task: unknown;
      await act(async () => {
        write.resolve();
        task = await created;
      });
      expect(task).toMatchObject({ title: 'Windows', position: count });
      expect(hk(home).tasks.at(-1)).toEqual(task);
      expect(dayVisit(home, today)!.tasks.at(-1)).toMatchObject({ task_id: (task as { id: string }).id, done: false });
      await act(async () => {
        reload.resolve();
      });
      await flush();
      expect(hk(home).tasks.filter((t) => t.title === 'Windows')).toHaveLength(1);
    });

    it('a failed create shows nothing new and says so', async () => {
      const { backend, home } = await seeded();
      vi.spyOn(backend, 'createHousekeepingTask').mockRejectedValueOnce(offline());
      const before = hk(home).tasks;
      await act(async () => {
        await expect(home().createHousekeepingTask('Windows')).rejects.toThrow();
      });
      expect(hk(home).tasks).toEqual(before);
      expect(home().toast?.message).toBe('Couldn’t save. No connection.');
    });

    it("rename, delete and reorder show at once on the list and today's visit, and fail back", async () => {
      const { backend, home } = await seeded();
      const today = home().today;
      const [first, second, third] = hk(home).tasks;
      // Today's visit, with the third task ticked.
      await act(() => home().setHousekeepingTaskDone(today, { taskId: third.id }, true));
      await waitFor(() => expect(dayVisit(home, today)!.id).not.toMatch(/^pending:/));
      const before = home().data!;
      const last = lastVisit(home).visit_date === today ? hk(home).visits[1] : lastVisit(home);

      vi.spyOn(backend, 'load').mockRejectedValue(offline());
      const gates = { rename: deferred(), remove: deferred(), removeTicked: deferred(), reorder: deferred() };
      vi.spyOn(backend, 'renameHousekeepingTask').mockImplementationOnce(() => gates.rename.promise);
      vi.spyOn(backend, 'deleteHousekeepingTask')
        .mockImplementationOnce(() => gates.remove.promise)
        .mockImplementationOnce(() => gates.removeTicked.promise);
      vi.spyOn(backend, 'reorderHousekeepingTasks').mockImplementationOnce(() => gates.reorder.promise);

      const pending: Promise<void>[] = [];
      act(() => {
        pending.push(home().renameHousekeepingTask(first.id, ' Bed sheets (all rooms) '));
        pending.push(home().deleteHousekeepingTask(second.id));
        pending.push(home().deleteHousekeepingTask(third.id));
        pending.push(home().reorderHousekeepingTasks([...hk(home).tasks.map((t) => t.id)].reverse()));
      });
      const list = hk(home).tasks;
      expect(list.at(-1)).toMatchObject({ id: first.id, title: 'Bed sheets (all rooms)' });
      expect(list.some((t) => t.id === second.id || t.id === third.id)).toBe(false);
      const todays = dayVisit(home, today)!.tasks;
      expect(todays.find((r) => r.task_id === first.id)!.title).toBe('Bed sheets (all rooms)');
      expect(todays.some((r) => r.task_id === second.id)).toBe(false);
      // The ticked row stays, unlinked; it keeps its place.
      expect(todays.find((r) => r.title === third.title)).toMatchObject({ task_id: null, done: true });
      expect(todays.filter((r) => r.task_id !== null).map((r) => r.task_id)).toEqual(list.map((t) => t.id));
      // Earlier visits keep their titles; their rows are unlinked.
      const old = dayVisit(home, last.visit_date)!.tasks;
      expect(old.find((r) => r.id === last.tasks[0].id)!.title).toBe(first.title);
      expect(old.find((r) => r.id === last.tasks[1].id)!.task_id).toBeNull();

      await act(async () => {
        for (const g of Object.values(gates)) g.reject(offline());
        await Promise.allSettled(pending);
      });
      expect(home().data).toEqual(before);
    });

    it('a failed rename leaves a later rename alone', async () => {
      const { backend, home } = await seeded();
      const [first] = hk(home).tasks;
      vi.spyOn(backend, 'load').mockRejectedValue(offline());
      const gate = deferred();
      vi.spyOn(backend, 'renameHousekeepingTask').mockImplementationOnce(() => gate.promise);
      let failed: Promise<void> | undefined;
      act(() => {
        failed = home().renameHousekeepingTask(first.id, 'One');
      });
      await act(() => home().renameHousekeepingTask(first.id, 'Two'));
      await act(async () => {
        gate.reject(offline());
        await expect(failed).rejects.toThrow();
      });
      expect(hk(home).tasks[0].title).toBe('Two');
    });
  });

  it('changes by another member arrive with the reload', async () => {
    const storage = new MemoryStorage();
    const backend = new DemoBackend({ storage, search: '?demo-seed=1', latency: 0 });
    const home = mount(backend);
    await waitFor(() => expect(home().phase.kind).toBe('ready'));
    const hid = home().data!.household.id;
    const token = await backend.createInvite();
    const ela = new DemoBackend({ storage, search: '', latency: 0, user: { id: 'u-ela', email: 'e@x', name: 'Ela' } });
    await ela.signInWithGoogle();
    await ela.joinHousehold({ token, memberName: 'Ela', memberEmoji: '🦊' });
    const today = home().today;
    const [task] = (await ela.load(hid)).housekeeping.tasks;
    await ela.setHousekeepingTaskDone(hid, today, { taskId: task.id }, true);
    await ela.setHousekeepingNote(hid, 'From Ela');
    await backend.signInWithGoogle();

    await act(() => home().refresh());
    expect(hk(home).note.body).toBe('From Ela');
    const visit = dayVisit(home, today)!;
    const elaId = home().data!.members.find((m) => m.user_id === 'u-ela')!.id;
    expect(visit.tasks[0]).toMatchObject({ task_id: task.id, done: true, done_by: elaId });
  });
});
