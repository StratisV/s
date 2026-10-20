import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, type StorageLike } from '../lib/backend/demo';
import { BackendError, type Backend } from '../lib/backend/types';
import { areaChecklists } from '../lib/logic/housekeeping';
import type { HousekeepingSection } from '../lib/types';
import { HomeProvider, useHome, type HomeContextValue } from './HomeProvider';

// An area's housekeeping tasks are the section named after it (docs/ARCHITECTURE.md
// "Housekeeping", "Areas"): renaming the area renames that section too, so the link holds.

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

function mount(backend: Backend) {
  let home!: HomeContextValue;
  render(
    <HomeProvider backend={backend}>
      <Expose onHome={(h) => (home = h)} />
    </HomeProvider>,
  );
  return () => home;
}

/** Signed in as Stratis in the seeded household, with a "  kitchen " section holding one task. */
async function withKitchenSection() {
  const backend = new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 });
  const home = mount(backend);
  await waitFor(() => expect(home().phase.kind).toBe('ready'));
  let section!: HousekeepingSection;
  await act(async () => {
    section = await home().createHousekeepingSection('  kitchen ');
    await home().createHousekeepingTask('Wipe the worktops', section.id);
  });
  await flush();
  const kitchen = home().data!.areas.find((a) => a.name === 'Kitchen')!;
  return { backend, home, section, kitchen };
}

const flush = () => act(() => new Promise((r) => setTimeout(r, 10)));
const offline = () => new BackendError('network');
const sectionTitle = (home: () => HomeContextValue, id: string) => home().data!.housekeeping.sections.find((s) => s.id === id)?.title;
/** The tasks on an area's card today. */
const cardOf = (home: () => HomeContextValue, name: string) => {
  const d = home().data!;
  return areaChecklists(d.housekeeping, d.areas, home().today)
    .find((c) => c.title === name)
    ?.rows.map((r) => r.title);
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('renaming an area', () => {
  it('renames the section named after it, whatever its case and spaces, so the area keeps its tasks', async () => {
    const { backend, home, section, kitchen } = await withKitchenSection();
    expect(cardOf(home, 'Kitchen')).toEqual(['Wipe the worktops']);
    const renameSection = vi.spyOn(backend, 'renameHousekeepingSection');

    let saved: Promise<void> | undefined;
    act(() => {
      saved = home().renameArea(kitchen.id, '  Kitchen   and utility ');
    });
    // At once, before either write is back.
    expect(sectionTitle(home, section.id)).toBe('Kitchen and utility');
    await act(() => saved!);
    await flush();
    expect(renameSection).toHaveBeenCalledWith(section.id, 'Kitchen and utility');
    // Stored, and the area's card still has its task.
    expect((await backend.load(home().data!.household.id)).housekeeping.sections.find((s) => s.id === section.id)?.title).toBe(
      'Kitchen and utility',
    );
    expect(cardOf(home, 'Kitchen   and utility')).toEqual(['Wipe the worktops']);
  });

  it('leaves the sections alone when none is named after it', async () => {
    const { backend, home, section } = await withKitchenSection();
    const renameSection = vi.spyOn(backend, 'renameHousekeepingSection');
    const garden = home().data!.areas.find((a) => a.name === 'Garden')!;
    await act(() => home().renameArea(garden.id, 'Back garden'));
    await flush();
    expect(renameSection).not.toHaveBeenCalled();
    expect(sectionTitle(home, section.id)).toBe('kitchen');
  });

  it('the section is renamed only once the area is stored: when the area fails, both are taken back', async () => {
    const { backend, home, section, kitchen } = await withKitchenSection();
    vi.spyOn(backend, 'load').mockRejectedValue(offline());
    vi.spyOn(backend, 'renameArea').mockRejectedValue(offline());
    const renameSection = vi.spyOn(backend, 'renameHousekeepingSection');
    await act(async () => {
      await home()
        .renameArea(kitchen.id, 'Pantry')
        .catch(() => {});
    });
    await flush();
    expect(renameSection).not.toHaveBeenCalled();
    expect(home().data!.areas.find((a) => a.id === kitchen.id)?.name).toBe('Kitchen');
    expect(sectionTitle(home, section.id)).toBe('kitchen');
    expect(home().toast?.message).toBe('Couldn’t save. No connection.');
  });

  it('a long name: the section takes its first 40 characters, and still matches', async () => {
    const { home, section, kitchen } = await withKitchenSection();
    const long = 'Kitchen, pantry and the little utility room behind it';
    await act(() => home().renameArea(kitchen.id, long));
    await flush();
    expect(sectionTitle(home, section.id)).toBe('Kitchen, pantry and the little utility r');
    expect(cardOf(home, long)).toEqual(['Wipe the worktops']);
  });
});
