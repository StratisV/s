import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, DEMO_USER, type StorageLike } from '../lib/backend/demo';
import { BackendError } from '../lib/backend/types';
import type { CreateHouseholdInput, HouseholdData } from '../lib/types';
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
