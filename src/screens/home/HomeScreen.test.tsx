import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, type StorageLike } from '../../lib/backend/demo';
import { DEFAULT_AREAS } from '../../lib/constants';
import { HomeProvider, useHome, type HomeContextValue } from '../../state/HomeProvider';
import { ConfettiProvider } from '../../ui/Confetti';
import type { AreaCardProps } from './AreaCard';
import { HomeScreen } from './HomeScreen';

// The cards as Home gives them (the agreed contract), whichever card draws them.
const cards = vi.hoisted(() => ({ props: [] as AreaCardProps[] }));
vi.mock('./AreaCard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./AreaCard')>();
  return {
    ...actual,
    AreaCard: (props: AreaCardProps) => {
      cards.props.push(props);
      return <actual.AreaCard {...props} />;
    },
  };
});

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
  onOpenArea(areaId: string): void;
  onOpenAttention(): void;
  onRevealed(): void;
  expose(home: HomeContextValue, reveal: (itemId: string) => void): void;
}

/** Home as App mounts it: `reveal` is what App does once an item is saved from Home's +. */
function Ready({ onOpenProfile, onOpenArea, onOpenAttention, onRevealed, expose }: ReadyProps) {
  const home = useHome();
  const [revealItem, setRevealItem] = useState<string | null>(null);
  expose(home, setRevealItem);
  if (home.phase.kind !== 'ready' || !home.data) return null;
  return (
    <HomeScreen
      onOpenProfile={onOpenProfile}
      onOpenArea={onOpenArea}
      onOpenAttention={onOpenAttention}
      revealItem={revealItem}
      onRevealed={() => {
        onRevealed();
        setRevealItem(null);
      }}
    />
  );
}

async function setup() {
  const backend = new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 });
  const onOpenProfile = vi.fn();
  const onOpenArea = vi.fn();
  const onOpenAttention = vi.fn();
  const onRevealed = vi.fn();
  let home!: HomeContextValue;
  let reveal!: (itemId: string) => void;
  render(
    <HomeProvider backend={backend}>
      <ConfettiProvider>
        <Ready
          onOpenProfile={onOpenProfile}
          onOpenArea={onOpenArea}
          onOpenAttention={onOpenAttention}
          onRevealed={onRevealed}
          expose={(h, r) => {
            home = h;
            reveal = r;
          }}
        />
      </ConfettiProvider>
    </HomeProvider>,
  );
  await screen.findByRole('heading', { name: 'Home', level: 1 });
  return { onOpenProfile, onOpenArea, onOpenAttention, onRevealed, home: () => home, reveal: () => reveal };
}

/** The props of each area's card as last drawn, by area name. */
function cardProps(): Map<string, AreaCardProps> {
  const byName = new Map<string, AreaCardProps>();
  for (const p of cards.props) byName.set(p.area.name, p);
  return byName;
}

/** An area's card: the one button in its cell of the grid. */
function card(areaId: string): HTMLElement {
  const cell = document.querySelector(`[data-area-grid] li[data-area-id="${areaId}"]`);
  if (!cell) throw new Error(`No card for ${areaId}`);
  return within(cell as HTMLElement).getByRole('button');
}

beforeEach(() => {
  cards.props = [];
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe('HomeScreen', () => {
  it('leads with one sentence on what needs doing across the house; a tap opens Needs attention', async () => {
    const { onOpenAttention } = await setup();
    const summary = document.querySelector<HTMLElement>('[data-home-summary]')!;
    expect(summary.textContent).toBe('2 things need attention and 1 is due today. Everything else can wait.');
    // One button, named by the sentence.
    expect(screen.getByRole('button', { name: /^2 things need attention and 1 is due today\./ })).toBe(summary);
    fireEvent.click(summary);
    expect(onOpenAttention).toHaveBeenCalledTimes(1);
  });

  it('shows a card for each area, in the household’s order, two to a row; each opens its area', async () => {
    const { home, onOpenArea } = await setup();
    const grid = screen.getByRole('list', { name: 'Areas' });
    const cells = within(grid).getAllByRole('listitem');
    const areas = home().data!.areas;
    expect(cells.map((c) => c.getAttribute('data-area-id'))).toEqual(areas.map((a) => a.id));
    expect(areas.map((a) => a.name)).toEqual(DEFAULT_AREAS);
    // One button a card, named first by its area.
    for (const [i, cell] of cells.entries()) {
      const buttons = within(cell).getAllByRole('button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0].getAttribute('aria-label') ?? buttons[0].textContent).toMatch(new RegExp(`^${areas[i].name}\\b`));
    }
    const garden = areas.find((a) => a.name === 'Garden')!;
    fireEvent.click(card(garden.id));
    expect(onOpenArea).toHaveBeenCalledWith(garden.id);
  });

  it('gives each card its state, how many To dos are open and who is looking after it', async () => {
    const { home } = await setup();
    const members = home().data!.members;
    const name = (id: string) => members.find((m) => m.id === id)!.name;
    const props = cardProps();
    const summary = (area: string) => {
      const p = props.get(area)!;
      return [p.status, p.statusText, p.openCount, p.people.map((m) => name(m.id))];
    };
    // Late (and urgent): needs attention.
    expect(summary('Hallway')).toEqual(['attention', '1 needs attention', 1, ['Shea']]);
    // Urgent, due in 6 days.
    expect(summary('Front garden')).toEqual(['attention', '1 needs attention', 3, ['Stratis']]);
    // Within the month: coming up. Nobody on it yet.
    expect(summary('Living Room')).toEqual(['soon', '1 coming up', 1, []]);
    // The wall panel within the month; most items first (Ela has two, Stratis one).
    expect(summary('Garden')).toEqual(['soon', '1 coming up', 2, ['Ela', 'Stratis']]);
    expect(summary('Kitchen')).toEqual(['good', 'All good', 2, ['Stratis']]);
    // Nothing open at all.
    expect(summary('Bedroom Small')).toEqual(['good', 'All clear', 0, []]);
    // Each person as the card shows them: their name and emoji.
    expect(props.get('Kitchen')!.people[0]).toEqual({
      id: members.find((m) => m.name === 'Stratis')!.id,
      name: 'Stratis',
      emoji: members.find((m) => m.name === 'Stratis')!.emoji,
    });
  });

  it('follows the items: completing the late job calms its card', async () => {
    const { home } = await setup();
    const heaters = home().data!.items.find((it) => it.title === 'Heaters not working')!;
    await act(async () => {
      await home().completeItem(heaters.id);
    });
    await waitFor(() => expect(cardProps().get('Hallway')).toMatchObject({ status: 'good', statusText: 'All clear', openCount: 0 }));
    expect(document.querySelector('[data-home-summary]')!.textContent).toMatch(/^1 thing needs attention/);
  });

  it('after a save from the +, the card of the area it went into comes into view and lights up', async () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    const { home, reveal, onRevealed } = await setup();
    const jacuzzi = home().data!.areas.find((a) => a.name === 'Jacuzzi')!;
    let created!: { id: string };
    await act(async () => {
      created = await home().createItem({
        area_id: jacuzzi.id,
        kind: 'task',
        title: 'Top up the chlorine',
        note: '',
        good: '',
        rag: 'green',
        due_date: null,
        assignee_id: null,
        repeat: 'none',
        notify: 'none',
      });
    });
    vi.useFakeTimers();
    try {
      act(() => reveal()(created.id));
      // Waits for it to load if need be; here it is in the list already.
      await act(async () => {});
      const cell = card(jacuzzi.id).closest('li')!;
      expect(cell.hasAttribute('data-lit')).toBe(true);
      expect(scrolled).toEqual([cell]);
      expect(onRevealed).toHaveBeenCalledTimes(1);
      // Only that card, and only for a moment.
      expect(document.querySelectorAll('[data-area-grid] li[data-lit]')).toHaveLength(1);
      act(() => vi.advanceTimersByTime(2500));
      expect(cell.hasAttribute('data-lit')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a way to add an area when there are none left', async () => {
    const { home, onOpenProfile } = await setup();
    await act(async () => {
      for (const area of home().data!.areas) await home().deleteArea(area.id);
    });
    await waitFor(() => expect(home().data!.areas).toHaveLength(0));

    expect(screen.queryByRole('list', { name: 'Areas' })).toBeNull();
    expect(screen.getByText('No areas yet')).toBeTruthy();
    expect(screen.getByText(/Add one in Profile, under Household\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Profile' }));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);

    // Adding one back replaces the card with the area: nothing in it yet, so all clear.
    await act(async () => {
      await home().createArea('Kitchen');
    });
    await waitFor(() => expect(screen.getByRole('list', { name: 'Areas' })).toBeTruthy());
    expect(screen.queryByText('No areas yet')).toBeNull();
    expect(cardProps().get('Kitchen')).toMatchObject({ status: 'good', statusText: 'All clear', openCount: 0 });
  });
});
