import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, type StorageLike } from '../../lib/backend/demo';
import { addDays } from '../../lib/logic/dates';
import { HomeProvider, useHome, type HomeContextValue } from '../../state/HomeProvider';
import { ConfettiProvider } from '../../ui/Confetti';
import { NeedsAttentionScreen, notListed } from './NeedsAttentionScreen';
import { personFilterKey } from './personFilter';
import { revealRow } from './reveal';

// jsdom lays nothing out: record where the list scrolls a card just saved to instead
// (reveal.test.tsx measures it).
vi.mock('./reveal', async (importOriginal) => ({ ...(await importOriginal<typeof import('./reveal')>()), revealRow: vi.fn() }));

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
  onRevealed(): void;
  expose(home: HomeContextValue, reveal: (itemId: string) => void): void;
}

/** Needs attention as App mounts it: `reveal` is what App does once an item is saved over it. */
function Ready({ onRevealed, expose }: ReadyProps) {
  const home = useHome();
  const [revealItem, setRevealItem] = useState<string | null>(null);
  expose(home, setRevealItem);
  if (home.phase.kind !== 'ready' || !home.data) return null;
  return (
    <NeedsAttentionScreen
      onOpenItem={() => {}}
      onOpenProfile={() => {}}
      revealItem={revealItem}
      onRevealed={() => {
        onRevealed();
        setRevealItem(null);
      }}
    />
  );
}

/** Renders Needs attention for the seeded household; pass its storage back to reopen the same one. */
async function setup(storage?: StorageLike) {
  const reopen = !!storage;
  storage ??= new MemoryStorage();
  const backend = new DemoBackend({ storage, search: reopen ? '' : '?demo-seed=1', latency: 0 });
  const onRevealed = vi.fn();
  let home!: HomeContextValue;
  let reveal!: (itemId: string) => void;
  render(
    <HomeProvider backend={backend}>
      <ConfettiProvider>
        <Ready
          onRevealed={onRevealed}
          expose={(h, r) => {
            home = h;
            reveal = r;
          }}
        />
      </ConfettiProvider>
    </HomeProvider>,
  );
  await screen.findByRole('heading', { name: 'Needs attention', level: 1 });
  return { onRevealed, home: () => home, revealItem: () => reveal, storage };
}

/** Chooses whose items show, from the people menu ("Everyone", "Shea", "Unassigned"). */
function chooseWho(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: /^Show tasks for: / }));
  fireEvent.click(within(screen.getByRole('menu', { name: 'Show tasks for' })).getByRole('menuitemradio', { name }));
}

/** Whose items show, as the people menu's button says it. */
const who = () => screen.getByRole('button', { name: /^Show tasks for: / }).getAttribute('aria-label')!.replace('Show tasks for: ', '');

const summary = () => document.querySelector('[data-attention-summary]')!.textContent;

/** The list's cards, top to bottom, by title. */
const titles = () =>
  Array.from(document.querySelectorAll('[data-attention-list] [data-item-open]')).map((b) => b.textContent!.split(',')[0].trim());

const NEW_ITEM = {
  kind: 'task' as const,
  note: '',
  good: '',
  rag: 'green' as const,
  due_date: null,
  assignee_id: null,
  repeat: 'none' as const,
  notify: 'none' as const,
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Needs attention', () => {
  it('leads with one sentence on what needs doing, then whose items: no other views', async () => {
    await setup();
    expect(summary()).toBe('2 things need attention and 1 is due today. Everything else can wait.');
    expect(screen.getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed')).toBe('false');
    expect(who()).toBe('Everyone');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(document.querySelector('[data-calendar]')).toBeNull();
  });

  it('lists every area’s items in one list in priority order, with no headings and nothing folded', async () => {
    await setup();
    expect(titles()).toEqual([
      // Late, then urgent.
      'Heaters not working',
      'Clear the gutters',
      // Due today.
      'Empty the dehumidifier',
      // The next 7 days, by date ("In 2 days" before "In 4 days"), the most urgent first on a day.
      'Water the plants',
      'Water test strips running low',
      'Shower draining slowly',
      'Cover the garden furniture',
      'Put the bins out',
      'Give away the old firepit',
      // Later: urgency, then date.
      'Mirror lights not level',
      'Re-seal around the shower',
      'Garden room wall panel',
      'Change the filter',
      'Wardrobe door hinge',
      'Clean cushions before winter',
      'Trim the hedges',
      'Kitchen paper',
      'Olive oil',
    ]);
    // The firepit, looked after and Good, is in its area's sheet only.
    expect(screen.queryByRole('button', { name: /^Firepit/ })).toBeNull();
    expect(document.querySelectorAll('h2, h3')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull();
  });

  it('each card has its area’s picture, and says its urgency, when, its area and who to assistive tech', async () => {
    await setup();
    // jsdom's name computation may put a space before the comma.
    const heaters = screen.getByRole('button', { name: /^Heaters not working ?, Urgent, 2 days late, Hallway, Shea, has a note\.$/ });
    expect(heaters.hasAttribute('data-item-open')).toBe(true);
    // On screen: the urgency in words, not only as a colour, and the area by name.
    expect(within(heaters).getByText('Urgent')).toBeTruthy();
    expect(heaters.querySelector('[data-room]')!.textContent).toBe('Hallway');
    // The Hallway's own picture, on every card.
    expect(heaters.querySelector('[data-area-art]')!.getAttribute('data-area-art')).toMatch(/^hallway:/);
    expect(document.querySelectorAll('[data-attention-list] [data-area-art]')).toHaveLength(titles().length);
    // The ring keeps its name.
    expect(screen.getByRole('button', { name: 'Mark Heaters not working as done' })).toBeTruthy();
  });

  it('puts things that need work with what needs attention, and those that are Okay at the end', async () => {
    const { home } = await setup();
    const bathroom = home().data!.areas.find((a) => a.name === 'Bathroom Large')!;
    await act(async () => {
      await home().createItem({ ...NEW_ITEM, area_id: bathroom.id, kind: 'state', title: 'Grout', rag: 'red' });
      await home().createItem({ ...NEW_ITEM, area_id: bathroom.id, kind: 'state', title: 'Bath seal', rag: 'amber' });
    });
    // They come with the next load.
    await waitFor(() => expect(titles()).toContain('Bath seal'));
    expect(titles().slice(0, 3)).toEqual(['Heaters not working', 'Clear the gutters', 'Grout']);
    expect(titles().at(-1)).toBe('Bath seal');
    expect(screen.getByRole('button', { name: /^Grout ?, to maintain, Needs work, Bathroom Large, Unassigned\.$/ })).toBeTruthy();
    expect(summary()).toBe('3 things need attention and 1 is due today. Everything else can wait.');
  });

  it('a ticked card leaves the list and the sentence follows', async () => {
    const { home } = await setup();
    const heaters = home().data!.items.find((it) => it.title === 'Heaters not working')!;
    await act(async () => {
      await home().completeItem(heaters.id);
    });
    await waitFor(() => expect(titles()).not.toContain('Heaters not working'));
    expect(summary()).toBe('1 thing needs attention and 1 is due today. Everything else can wait.');
  });

  it('Mine is one tap: only your items, and the sentence says so; cards drop who they are for', async () => {
    const { home } = await setup();
    const me = home().data!.members.find((m) => m.id === home().me!.id)!;
    expect(document.querySelectorAll('[data-who]').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(screen.getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed')).toBe('true');
    expect(who()).toBe(`${me.name} (you)`);
    expect(summary()).toMatch(/^For you, /);
    const cards = Array.from(document.querySelectorAll('[data-item-open]'));
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(card.textContent).toContain(`, ${me.name}`);
    // Every card is yours: no need to say whose.
    expect(document.querySelectorAll('[data-who]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(who()).toBe('Everyone');
    expect(summary()).toMatch(/^2 things need attention/);
  });

  it('the people menu counts what the list shows for each person (not things in good shape)', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: /^Show tasks for: / }));
    const menu = screen.getByRole('menu', { name: 'Show tasks for' });
    // 18 cards; Ela's firepit, looked after and Good, is not one of them.
    expect(within(menu).getByRole('menuitemradio', { name: 'Everyone, 18 items' })).toBeTruthy();
    expect(within(menu).getByRole('menuitemradio', { name: /^Ela, 3 items/ })).toBeTruthy();
  });

  it('says plainly when the person chosen has nothing open', async () => {
    const { home } = await setup();
    await act(async () => {
      for (const item of home().data!.items.filter((it) => it.assignee_id === null)) await home().deleteItem(item.id);
    });
    chooseWho(/^Unassigned,/);
    await waitFor(() => expect(screen.getByText('Nothing unassigned right now.')).toBeTruthy());
    expect(summary()).toBe('Nothing unassigned to do. Everything open has someone on it.');
    expect(document.querySelector('[data-attention-list]')!.getAttribute('role')).toBe('status');
  });
});

describe('Needs attention after a save', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(revealRow).mockClear();
  });

  /** The cards brought into view (revealRow(), measured in reveal.test.tsx). */
  function recordScrolls() {
    vi.mocked(revealRow).mockClear();
    return vi.mocked(revealRow).mock.calls;
  }

  /** The card of an item, by its id. */
  const cardOf = (id: string) => document.querySelector<HTMLElement>(`[data-attention-list] [data-item-id="${id}"]`);

  it('a new item for someone the filter hides: everyone’s show again, and its card lights up and comes into view', async () => {
    const { home, revealItem, storage, onRevealed } = await setup();
    const scrolled = recordScrolls();
    const data = home().data!;
    const kitchen = data.areas.find((a) => a.name === 'Kitchen')!;
    const ela = data.members.find((m) => m.name === 'Ela')!;
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(who()).not.toBe('Everyone');
    let created!: { id: string };
    await act(async () => {
      created = await home().createItem({
        ...NEW_ITEM,
        area_id: kitchen.id,
        title: 'Service the boiler',
        due_date: addDays(home().today, 50),
        assignee_id: ela.id,
      });
    });
    vi.useFakeTimers();
    act(() => revealItem()(created.id));
    await act(async () => {});
    expect(onRevealed).toHaveBeenCalledTimes(1);
    expect(who()).toBe('Everyone');
    expect(cardOf(created.id)!.hasAttribute('data-lit')).toBe(true);
    act(() => vi.advanceTimersByTime(100));
    // The whole card, clear of the round + and the tab bar, smoothly.
    expect(scrolled).toEqual([[cardOf(created.id)!, true]]);
    act(() => vi.advanceTimersByTime(3000));
    expect(cardOf(created.id)!.hasAttribute('data-lit')).toBe(false);
    vi.useRealTimers();
    // Everyone's for this visit only: Mine stays the choice this phone opens on.
    const me = home().me!.id;
    expect(localStorage.getItem(personFilterKey(home().data!.household.id))).toBe(me);
    expect(screen.getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed')).toBe('false');
    cleanup();
    await setup(storage);
    expect(screen.getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('one the list doesn’t show (a thing looked after in good shape): a toast says where it went', async () => {
    const { home, revealItem, onRevealed } = await setup();
    const scrolled = recordScrolls();
    const kitchen = home().data!.areas.find((a) => a.name === 'Kitchen')!;
    let created!: { id: string };
    await act(async () => {
      created = await home().createItem({ ...NEW_ITEM, area_id: kitchen.id, kind: 'state', title: 'Oven', rag: 'green' });
    });
    act(() => home().dismissToast());
    act(() => revealItem()(created.id));
    await act(async () => {});
    expect(home().toast?.message).toBe('Saved in Kitchen.');
    expect(onRevealed).toHaveBeenCalledTimes(1);
    expect(cardOf(created.id)).toBeNull();
    expect(scrolled).toEqual([]);
    expect(notListed('')).toBe('Saved.');
  });
});
