import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, type StorageLike } from '../../lib/backend/demo';
import { HomeProvider, useHome, type HomeContextValue } from '../../state/HomeProvider';
import { ConfettiProvider } from '../../ui/Confetti';
import { collapsedKey, HomeScreen, splitLast, statusCounts } from './HomeScreen';

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

interface ReadyProps {
  onOpenProfile(): void;
  onAddItem(areaId: string): void;
  onRevealed(): void;
  expose(home: HomeContextValue, reveal: (areaId: string) => void): void;
}

/** Home as App mounts it: `reveal` is what App does once an item is saved into an area. */
function Ready({ onOpenProfile, onAddItem, onRevealed, expose }: ReadyProps) {
  const home = useHome();
  const [revealArea, setRevealArea] = useState<string | null>(null);
  expose(home, setRevealArea);
  if (home.phase.kind !== 'ready' || !home.data) return null;
  return (
    <HomeScreen
      onOpenItem={() => {}}
      onOpenProfile={onOpenProfile}
      onAddItem={onAddItem}
      revealArea={revealArea}
      onRevealed={() => {
        onRevealed();
        setRevealArea(null);
      }}
    />
  );
}

/** Renders Home for the seeded household; pass its storage back to reopen the same one. */
async function setup(storage?: StorageLike) {
  const reopen = !!storage;
  storage ??= new MemoryStorage();
  const backend = new DemoBackend({ storage, search: reopen ? '' : '?demo-seed=1', latency: 0 });
  const onOpenProfile = vi.fn();
  const onAddItem = vi.fn();
  const onRevealed = vi.fn();
  let home!: HomeContextValue;
  let revealArea!: (areaId: string) => void;
  render(
    <HomeProvider backend={backend}>
      <ConfettiProvider>
        <Ready
          onOpenProfile={onOpenProfile}
          onAddItem={onAddItem}
          onRevealed={onRevealed}
          expose={(h, reveal) => {
            home = h;
            revealArea = reveal;
          }}
        />
      </ConfettiProvider>
    </HomeProvider>,
  );
  await screen.findByRole('heading', { name: 'Home', level: 1 });
  return { onOpenProfile, onAddItem, onRevealed, revealArea: () => revealArea, home: () => home, storage };
}

/**
 * An area's section, its disclosure button and its collapsible panel. Found by the heading's
 * text: jsdom has no layout, so its accessible names put a space between the name's two
 * parts (`Kitche n`); browsers don't (e2e/areas.spec.ts checks the real names).
 */
function area(name: string) {
  const region = screen
    .getAllByRole('region')
    .find((r) => document.getElementById(r.getAttribute('aria-labelledby') ?? '')?.textContent === name);
  if (!region) throw new Error(`No area ${name}`);
  const toggle = within(region).getByRole('button', { name });
  const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
  return { region, toggle, panel };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('HomeScreen', () => {
  it('lists the areas and says each row’s status to assistive tech', async () => {
    await setup();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(11);
    expect(screen.queryByText('No areas yet')).toBeNull();
    // jsdom's name computation may put a space before the comma.
    const heaters = screen.getByRole('button', {
      name: /^Heaters not working ?, Red\. 🦆 Shea · Missed · .* · No heat since the weekend\./,
    });
    expect(heaters.hasAttribute('data-item-open')).toBe(true);
    expect(screen.getByRole('button', { name: /^Olive oil ?, Green\./ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Shower draining slowly ?, Amber\./ })).toBeTruthy();
    // The ring keeps its name.
    expect(screen.getByRole('button', { name: 'Mark Heaters not working as done' })).toBeTruthy();
  });

  it('shows a way to add an area when there are none left', async () => {
    const { home, onOpenProfile } = await setup();
    await act(async () => {
      for (const area of home().data!.areas) await home().deleteArea(area.id);
    });
    await waitFor(() => expect(home().data!.areas).toHaveLength(0));

    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
    expect(screen.getByText('No areas yet')).toBeTruthy();
    expect(screen.getByText(/Add one in Profile, under Household\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Profile' }));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);

    // Adding one back replaces the card with the area.
    await act(async () => {
      await home().createArea('Kitchen');
    });
    await screen.findByRole('button', { name: 'Kitchen', expanded: true });
    expect(screen.queryByText('No areas yet')).toBeNull();
    expect(screen.getByText('Nothing to do')).toBeTruthy();
  });
});

describe('HomeScreen areas', () => {
  it('collapses and expands an area from its name, with disclosure semantics', async () => {
    await setup();
    const kitchen = area('Kitchen');
    expect(kitchen.toggle.getAttribute('aria-expanded')).toBe('true');
    expect(kitchen.panel).toBeTruthy();
    expect(kitchen.panel.contains(screen.getByRole('button', { name: 'Mark Kitchen paper as done' }))).toBe(true);
    // The heading (and so the region) is still just the area name.
    expect(kitchen.region.querySelector('h2')!.textContent).toBe('Kitchen');
    expect(kitchen.region.getAttribute('aria-labelledby')).toBe(kitchen.region.querySelector('h2')!.id);

    fireEvent.click(kitchen.toggle);
    expect(kitchen.toggle.getAttribute('aria-expanded')).toBe('false');
    expect(kitchen.panel.hasAttribute('data-collapsed')).toBe(true);
    // Only that area.
    expect(area('Living Room').toggle.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(kitchen.toggle);
    expect(kitchen.toggle.getAttribute('aria-expanded')).toBe('true');
    expect(kitchen.panel.hasAttribute('data-collapsed')).toBe(false);
  });

  it('Collapse All and Expand All', async () => {
    const { home } = await setup();
    const names = home().data!.areas.map((a) => a.name);
    fireEvent.click(area('Garden').toggle);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse All' }));
    for (const name of names) expect(area(name).toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Collapse All' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Expand All' }));
    for (const name of names) expect(area(name).toggle.getAttribute('aria-expanded')).toBe('true');

    // Collapsing every area one by one also offers Expand All.
    for (const name of names) fireEvent.click(area(name).toggle);
    expect(screen.getByRole('button', { name: 'Expand All' })).toBeTruthy();
  });

  it('remembers collapsed areas on this device, per household', async () => {
    const first = await setup();
    const hid = first.home().data!.household.id;
    const kitchenId = first.home().data!.areas.find((a) => a.name === 'Kitchen')!.id;
    const gardenId = first.home().data!.areas.find((a) => a.name === 'Garden')!.id;
    fireEvent.click(area('Kitchen').toggle);
    fireEvent.click(area('Garden').toggle);
    expect(JSON.parse(localStorage.getItem(collapsedKey(hid))!).sort()).toEqual([kitchenId, gardenId].sort());
    expect(collapsedKey(hid)).toBe(`homeos.collapsed.${hid}`);

    // Reopened: still collapsed.
    cleanup();
    const second = await setup(first.storage);
    expect(second.home().data!.household.id).toBe(hid);
    expect(area('Kitchen').toggle.getAttribute('aria-expanded')).toBe('false');
    expect(area('Garden').toggle.getAttribute('aria-expanded')).toBe('false');
    expect(area('Living Room').toggle.getAttribute('aria-expanded')).toBe('true');

    // Nothing collapsed: nothing stored.
    fireEvent.click(area('Kitchen').toggle);
    fireEvent.click(area('Garden').toggle);
    expect(localStorage.getItem(collapsedKey(hid))).toBeNull();
  });

  it('copes with storage that is broken or unreadable', async () => {
    const first = await setup();
    const hid = first.home().data!.household.id;
    cleanup();
    localStorage.setItem(collapsedKey(hid), '{not json');
    const second = await setup(first.storage);
    expect(second.home().data!.household.id).toBe(hid);
    expect(area('Kitchen').toggle.getAttribute('aria-expanded')).toBe('true');

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      fireEvent.click(area('Kitchen').toggle);
      expect(area('Kitchen').toggle.getAttribute('aria-expanded')).toBe('false');
    } finally {
      setItem.mockRestore();
    }
  });

  it('shows red, amber and green counts per area, with one label, open or collapsed', async () => {
    const { home } = await setup();
    const data = home().data!;
    for (const a of data.areas) {
      const open = data.items.filter((it) => it.area_id === a.id && it.status === 'open');
      const { region } = area(a.name);
      const { label } = statusCounts(open);
      if (!open.length) {
        expect(within(region).queryByRole('img')).toBeNull();
        continue;
      }
      const counts = within(region).getByRole('img', { name: label });
      // Red first, then amber, then green; only the non-zero ones.
      const chips = Array.from(counts.querySelectorAll('[data-rag]'));
      expect(chips.map((c) => c.getAttribute('data-rag'))).toEqual(
        (['red', 'amber', 'green'] as const).filter((rag) => open.some((it) => it.rag === rag)),
      );
      expect(chips.map((c) => Number(c.textContent))).toEqual(
        chips.map((c) => open.filter((it) => it.rag === c.getAttribute('data-rag')).length),
      );
    }
    // Hallway has the one urgent item.
    expect(within(area('Hallway').region).getByRole('img').getAttribute('aria-label')).toBe('1 urgent');

    // Still there when collapsed.
    fireEvent.click(screen.getByRole('button', { name: 'Collapse All' }));
    expect(within(area('Hallway').region).getByRole('img', { name: '1 urgent' })).toBeTruthy();

    // Completing an item updates the counts.
    const heaters = data.items.find((it) => it.title === 'Heaters not working')!;
    await act(async () => {
      await home().completeItem(heaters.id);
    });
    await waitFor(() => expect(within(area('Hallway').region).queryByRole('img')).toBeNull());
  });

  it('the + on an area header adds an item to that area', async () => {
    const { home, onAddItem } = await setup();
    const garden = home().data!.areas.find((a) => a.name === 'Garden')!;
    const add = within(area('Garden').region).getByRole('button', { name: 'Add item to Garden' });
    fireEvent.click(add);
    expect(onAddItem).toHaveBeenCalledWith(garden.id);
    // Also on a collapsed area.
    fireEvent.click(area('Kitchen').toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Add item to Kitchen' }));
    expect(onAddItem).toHaveBeenLastCalledWith(home().data!.areas.find((a) => a.name === 'Kitchen')!.id);
  });
});

describe('HomeScreen after a save', () => {
  it('expands the area an item was saved into, if it was collapsed', async () => {
    const { home, revealArea: reveal, onRevealed } = await setup();
    const revealArea = (id: string) => reveal()(id);
    const kitchenId = home().data!.areas.find((a) => a.name === 'Kitchen')!.id;
    const gardenId = home().data!.areas.find((a) => a.name === 'Garden')!.id;
    fireEvent.click(area('Kitchen').toggle);
    fireEvent.click(area('Garden').toggle);

    act(() => revealArea(kitchenId));
    expect(area('Kitchen').toggle.getAttribute('aria-expanded')).toBe('true');
    expect(area('Kitchen').panel.hasAttribute('data-collapsed')).toBe(false);
    // Only that one; and it is remembered as open.
    expect(area('Garden').toggle.getAttribute('aria-expanded')).toBe('false');
    const hid = home().data!.household.id;
    expect(JSON.parse(localStorage.getItem(collapsedKey(hid))!)).toEqual([gardenId]);
    expect(onRevealed).toHaveBeenCalledTimes(1);

    // An area that is already open stays open.
    act(() => revealArea(kitchenId));
    expect(area('Kitchen').toggle.getAttribute('aria-expanded')).toBe('true');
    expect(onRevealed).toHaveBeenCalledTimes(2);
  });
});

describe('HomeScreen area names', () => {
  it('keep the chevron with the last letter, and the name whole for assistive tech', async () => {
    await setup();
    const { toggle } = area('Bathroom Large');
    const tail = toggle.querySelector('svg')!.parentElement!;
    expect(tail).not.toBe(toggle);
    expect(tail.textContent).toBe('e');
    expect(toggle.getAttribute('aria-label')).toBe('Bathroom Large');
    expect(area('Bathroom Large').region.querySelector('h2')!.textContent).toBe('Bathroom Large');
  });

  it('splitLast splits off the last character, keeping emoji whole', () => {
    expect(splitLast('Bathroom Large')).toEqual(['Bathroom Larg', 'e']);
    expect(splitLast('K')).toEqual(['', 'K']);
    expect(splitLast('')).toEqual(['', '']);
    expect(splitLast('Shed 🛖')).toEqual(['Shed ', '🛖']);
    expect(splitLast('Loft 👨‍👩‍👧')).toEqual(['Loft ', '👨‍👩‍👧']);
  });
});

describe('HomeScreen To maintain rows', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('read "Updated <day>" in the household’s time zone', async () => {
    // 22:30 on Thu 8 Oct in New York is already Fri 9 Oct in London.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T02:30:00Z'));
    const { home } = await setup();
    await act(async () => {
      await home().updateHousehold({ timezone: 'America/New_York' });
    });
    await waitFor(() => expect(home().today).toBe('2026-10-08'));
    const firepit = home().data!.items.find((i) => i.title === 'Firepit')!;
    expect(firepit.kind).toBe('state');
    expect(firepit.updated_at.slice(0, 16)).toBe('2026-10-09T02:30');
    const row = screen.getByRole('button', { name: /^Firepit ?, Green, to maintain\./ });
    expect(within(row).getByText('Updated Thu 8 Oct')).toBeTruthy();
  });
});

describe('statusCounts', () => {
  it('counts red, then amber, then green, leaving out zeros', () => {
    const items = (rags: string) => rags.split('').map((c) => ({ rag: ({ r: 'red', a: 'amber', g: 'green' } as const)[c as 'r'] }));
    expect(statusCounts(items('gagrg'))).toEqual({
      counts: [
        { rag: 'red', count: 1 },
        { rag: 'amber', count: 1 },
        { rag: 'green', count: 3 },
      ],
      label: '1 urgent, 1 at risk, 3 on track',
    });
    expect(statusCounts(items('aa')).label).toBe('2 at risk');
    expect(statusCounts([])).toEqual({ counts: [], label: '' });
  });
});
