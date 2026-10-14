import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, type StorageLike } from '../../lib/backend/demo';
import { formatDay } from '../../lib/logic/dates';
import { HomeProvider, useHome, type HomeContextValue } from '../../state/HomeProvider';
import { ConfettiProvider } from '../../ui/Confetti';
import { COPIED_TOAST } from '../share/useShare';
import { collapsedKey, HOME_VIEW_KEY, HomeScreen, ROOM_PREVIEW, roomStatus, splitLast, type HomeView } from './HomeScreen';

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
  onLinkedAreaShown(): void;
  onRoomContext(areaId: string | null): void;
  expose(home: HomeContextValue, reveal: (areaId: string) => void, link: (areaId: string) => void): void;
}

/**
 * Home as App mounts it: `reveal` is what App does once an item is saved into an area,
 * `link` what it does for a shared `?area=` link.
 */
function Ready({ onOpenProfile, onAddItem, onRevealed, onLinkedAreaShown, onRoomContext, expose }: ReadyProps) {
  const home = useHome();
  const [revealArea, setRevealArea] = useState<string | null>(null);
  const [linkedArea, setLinkedArea] = useState<string | null>(null);
  expose(home, setRevealArea, setLinkedArea);
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
      linkedArea={linkedArea}
      onLinkedAreaShown={() => {
        onLinkedAreaShown();
        setLinkedArea(null);
      }}
      onRoomContext={onRoomContext}
    />
  );
}

/**
 * Renders Home for the seeded household; pass its storage back to reopen the same one. Most of
 * these tests are about the areas, so Home opens on its Rooms view unless `view` says otherwise.
 */
async function setup(storage?: StorageLike, view: HomeView = 'rooms') {
  if (view === 'next') localStorage.removeItem(HOME_VIEW_KEY);
  else localStorage.setItem(HOME_VIEW_KEY, view);
  const reopen = !!storage;
  storage ??= new MemoryStorage();
  const backend = new DemoBackend({ storage, search: reopen ? '' : '?demo-seed=1', latency: 0 });
  const onOpenProfile = vi.fn();
  const onAddItem = vi.fn();
  const onRevealed = vi.fn();
  const onLinkedAreaShown = vi.fn();
  const onRoomContext = vi.fn();
  let home!: HomeContextValue;
  let revealArea!: (areaId: string) => void;
  let linkArea!: (areaId: string) => void;
  render(
    <HomeProvider backend={backend}>
      <ConfettiProvider>
        <Ready
          onOpenProfile={onOpenProfile}
          onAddItem={onAddItem}
          onRevealed={onRevealed}
          onLinkedAreaShown={onLinkedAreaShown}
          onRoomContext={onRoomContext}
          expose={(h, reveal, link) => {
            home = h;
            revealArea = reveal;
            linkArea = link;
          }}
        />
      </ConfettiProvider>
    </HomeProvider>,
  );
  await screen.findByRole('heading', { name: 'Home', level: 1 });
  return {
    onOpenProfile,
    onAddItem,
    onRevealed,
    onLinkedAreaShown,
    onRoomContext,
    revealArea: () => revealArea,
    linkArea: () => linkArea,
    home: () => home,
    storage,
  };
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

/** An empty room: no disclosure, just its name (a heading that can take focus) and its menu. */
function emptyRoom(name: string) {
  const region = screen
    .getAllByRole('region')
    .find((r) => document.getElementById(r.getAttribute('aria-labelledby') ?? '')?.textContent === name);
  if (!region) throw new Error(`No area ${name}`);
  return region;
}

/** Opens a room's "..." menu and chooses `item` ("Share Garden", "Add item to Garden", "Collapse All Rooms"). */
function roomMenu(room: string, item: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name: `${room} options` }));
  fireEvent.click(within(screen.getByRole('menu', { name: room })).getByRole('menuitem', { name: item }));
}

/** Chooses whose items Home shows, from the people menu ("Everyone", "Shea", "Unassigned"). */
function chooseWho(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: /^Show tasks for: / }));
  fireEvent.click(within(screen.getByRole('menu', { name: 'Show tasks for' })).getByRole('menuitemradio', { name }));
}

/** Whose items Home shows, as the people menu's button says it. */
const who = () => screen.getByRole('button', { name: /^Show tasks for: / }).getAttribute('aria-label')!.replace('Show tasks for: ', '');

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('HomeScreen', () => {
  it('lists the rooms and says each row’s urgency, when, and who to assistive tech', async () => {
    await setup();
    // The eleven rooms, in the household's order.
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings).toHaveLength(11);
    expect(headings.every((h) => h.closest('[data-area-id]') !== null)).toBe(true);
    expect(headings[0].textContent).toBe('Kitchen');
    expect(screen.queryByText('No areas yet')).toBeNull();
    // jsdom's name computation may put a space before the comma.
    const heaters = screen.getByRole('button', { name: /^Heaters not working ?, Urgent, 2 days late, Shea, has a note\.$/ });
    expect(heaters.hasAttribute('data-item-open')).toBe(true);
    expect(screen.getByRole('button', { name: /^Olive oil ?, Not urgent, In 5 weeks, Stratis, repeats monthly/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Shower draining slowly ?, Within the month, / })).toBeTruthy();
    // On screen: the urgency in words, not only as a colour.
    expect(within(heaters).getByText('Urgent')).toBeTruthy();
    // The ring keeps its name.
    expect(screen.getByRole('button', { name: 'Mark Heaters not working as done' })).toBeTruthy();
  });

  it('leads with one sentence on what needs doing, then the view switch and whose items', async () => {
    await setup(undefined, 'next');
    const summary = document.querySelector('[data-home-summary]')!;
    expect(summary.textContent).toBe('2 things need attention and 1 is due today. Everything else can wait.');
    const views = screen.getByRole('radiogroup', { name: 'View' });
    expect(within(views).getAllByRole('radio').map((r) => [r.textContent, r.getAttribute('aria-checked')])).toEqual([
      ['Up next', 'true'],
      ['Rooms', 'false'],
      ['Calendar', 'false'],
    ]);
    expect(screen.getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed')).toBe('false');
    expect(who()).toBe('Everyone');
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

    // Adding one back replaces the card with the area: nothing in it yet, so "All clear".
    await act(async () => {
      await home().createArea('Kitchen');
    });
    const kitchen = await screen.findByRole('heading', { name: 'Kitchen', level: 2 });
    expect(screen.queryByText('No areas yet')).toBeNull();
    expect(within(kitchen.closest('section')!).getByText('All clear')).toBeTruthy();
  });
});

describe('HomeScreen views', () => {
  it('Up next: what needs attention first, then today, the next 7 days and later, across every room', async () => {
    await setup(undefined, 'next');
    const groups = Array.from(document.querySelectorAll<HTMLElement>('section[data-group]'));
    expect(groups.map((g) => g.dataset.group)).toEqual(['attention', 'today', 'week', 'later', 'looking']);
    expect(groups.map((g) => g.querySelector('h2')!.textContent)).toEqual([
      'Needs attention',
      'Today',
      'Next 7 days',
      'Later',
      'Looking after',
    ]);
    const titles = (g: HTMLElement) =>
      Array.from(g.querySelectorAll('[data-item-open]')).map((b) => b.textContent!.split(',')[0].trim());
    // The late and urgent jobs are the first rows on the page, each with its room.
    expect(titles(groups[0])).toEqual(['Heaters not working', 'Clear the gutters']);
    expect(groups[0].querySelector('[data-room]')!.textContent).toBe('Hallway');
    expect(titles(groups[1])).toEqual(['Empty the dehumidifier']);
    // Next 7 days reads in date order: "In 2 days" before "In 4 days".
    expect(titles(groups[2])).toEqual([
      'Water the plants',
      'Water test strips running low',
      'Shower draining slowly',
      'Cover the garden furniture',
      'Put the bins out',
      'Give away the old firepit',
    ]);
    // Later shows three, then "Show 6 more".
    expect(titles(groups[3])).toHaveLength(3);
    const more = within(groups[3]).getByRole('button', { name: 'Show 6 more' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(titles(groups[3])).toHaveLength(9);
    expect(within(groups[3]).getByRole('button', { name: 'Show fewer' }).getAttribute('aria-expanded')).toBe('true');
    // The firepit is looked after and in good shape: a row of its own at the foot.
    expect(within(groups[4]).getByRole('button', { name: /^Firepit ?, to maintain, Good, Garden, Ela/ })).toBeTruthy();
  });

  it('remembers the view on this device, and moves between views with the arrow keys', async () => {
    await setup(undefined, 'next');
    const views = screen.getByRole('radiogroup', { name: 'View' });
    const radio = (name: string) => within(views).getByRole('radio', { name });
    fireEvent.click(radio('Rooms'));
    expect(localStorage.getItem(HOME_VIEW_KEY)).toBe('rooms');
    expect(document.querySelector('[data-view="rooms"]')).toBeTruthy();
    radio('Rooms').focus();
    fireEvent.keyDown(views, { key: 'ArrowRight' });
    expect(radio('Calendar').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radio('Calendar'));
    expect(localStorage.getItem(HOME_VIEW_KEY)).toBe('calendar');
    fireEvent.keyDown(views, { key: 'Home' });
    expect(radio('Up next').getAttribute('aria-checked')).toBe('true');
    // Up next is the default: nothing stored.
    expect(localStorage.getItem(HOME_VIEW_KEY)).toBeNull();
    // Only the chosen one is in the tab order.
    expect(within(views).getAllByRole('radio').map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it('Mine is one tap: only your items, and the sentence says so; rows drop who they are for', async () => {
    const { home } = await setup(undefined, 'next');
    const me = home().data!.members.find((m) => m.id === home().me!.id)!;
    expect(document.querySelectorAll('[data-who]').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(screen.getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed')).toBe('true');
    expect(who()).toBe(`${me.name} (you)`);
    expect(document.querySelector('[data-home-summary]')!.textContent).toMatch(/^For you, /);
    const rows = Array.from(document.querySelectorAll('[data-item-open]'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.textContent).toContain(`, ${me.name}`);
    // Every row is yours: no need to say whose.
    expect(document.querySelectorAll('[data-who]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(who()).toBe('Everyone');
    expect(document.querySelector('[data-home-summary]')!.textContent).toMatch(/^2 things need attention/);
  });

  it('says plainly when the person chosen has nothing open', async () => {
    const { home } = await setup(undefined, 'next');
    await act(async () => {
      for (const item of home().data!.items.filter((it) => it.assignee_id === null)) await home().deleteItem(item.id);
    });
    chooseWho(/^Unassigned,/);
    await waitFor(() => expect(screen.getByText('Nothing unassigned right now.')).toBeTruthy());
    expect(document.querySelector('[data-home-summary]')!.textContent).toBe(
      'Nothing unassigned to do. Everything open has someone on it.',
    );
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

  it('Collapse All Rooms and Expand All Rooms, from any room’s menu: one line per room, with how many are open', async () => {
    const { home } = await setup();
    // The rooms with something open (an empty one has nothing to fold).
    const names = home()
      .data!.areas.filter((a) => home().data!.items.some((it) => it.area_id === a.id && it.status === 'open'))
      .map((a) => a.name);
    fireEvent.click(area('Garden').toggle);

    roomMenu('Kitchen', 'Collapse All Rooms');
    for (const name of names) expect(area(name).toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(area('Kitchen').region).getByText('2 open')).toBeTruthy();
    // Folded, a room's status is still part of what its name says (aria-describedby).
    const kitchen = area('Kitchen').toggle;
    expect(document.getElementById(kitchen.getAttribute('aria-describedby')!)!.textContent).toBe('2 open');

    await act(async () => {});
    roomMenu('Garden', 'Expand All Rooms');
    for (const name of names) expect(area(name).toggle.getAttribute('aria-expanded')).toBe('true');

    // Collapsing every room one by one also offers Expand All Rooms.
    for (const name of names) fireEvent.click(area(name).toggle);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Kitchen options' }));
    expect(within(screen.getByRole('menu', { name: 'Kitchen' })).getByRole('menuitem', { name: 'Expand All Rooms' })).toBeTruthy();
  });

  it('shows three jobs in a busy room, then "Show 2 more"', async () => {
    const { home } = await setup();
    const kitchen = home().data!.areas.find((a) => a.name === 'Kitchen')!;
    await act(async () => {
      for (const n of [1, 2, 3]) {
        await home().createItem({
          area_id: kitchen.id,
          kind: 'task',
          title: `Kitchen job ${n}`,
          note: '',
          good: '',
          rag: 'green',
          due_date: null,
          assignee_id: null,
          repeat: 'none',
          notify: 'none',
        });
      }
    });
    const { region } = area('Kitchen');
    const more = await within(region).findByRole('button', { name: 'Show 2 more' });
    expect(within(region).getAllByRole('button', { name: /^Mark / })).toHaveLength(ROOM_PREVIEW);
    fireEvent.click(more);
    expect(within(region).getAllByRole('button', { name: /^Mark / })).toHaveLength(5);
    fireEvent.click(within(region).getByRole('button', { name: 'Show fewer' }));
    expect(within(region).getAllByRole('button', { name: /^Mark / })).toHaveLength(ROOM_PREVIEW);
    // A room with four shows all four: "Show 1 more" would only cost a tap.
    expect(within(area('Garden Lounge').region).queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull();
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

  it('says "1 late" or "1 urgent" in red on a room with something late or urgent, and nothing on a calm open room', async () => {
    const { home } = await setup();
    const data = home().data!;
    const hallway = area('Hallway');
    expect(within(hallway.region).getByText('1 late').closest('[data-toggles]')!.hasAttribute('data-alert')).toBe(true);
    expect(within(area('Front garden').region).getByText('1 urgent')).toBeTruthy();
    // Its drawing turns red too, and its name is described by the word.
    expect(hallway.region.querySelector('[data-alert]')).toBeTruthy();
    expect(document.getElementById(hallway.toggle.getAttribute('aria-describedby')!)!.textContent).toBe('1 late');
    expect(within(area('Kitchen').region).queryByText(/^\d+ (late|urgent|open)$/)).toBeNull();

    // Completing the late item clears it: the room has nothing open, so it reads All clear.
    const heaters = data.items.find((it) => it.title === 'Heaters not working')!;
    await act(async () => {
      await home().completeItem(heaters.id);
    });
    await waitFor(() => expect(within(emptyRoom('Hallway')).getByText('All clear')).toBeTruthy());
    expect(within(emptyRoom('Hallway')).queryByRole('button', { name: 'Hallway' })).toBeNull();
  });

  it('a tap on a room’s word folds or opens it, like its name; the word wraps only between its parts', async () => {
    const { home } = await setup();
    const NEW_ITEM = {
      kind: 'task' as const,
      note: '',
      good: '',
      assignee_id: null,
      repeat: 'none' as const,
      notify: 'none' as const,
    };
    const hallway = area('Hallway');
    const word = within(hallway.region).getByText('1 late').closest<HTMLElement>('[data-toggles]')!;
    // No button of its own: the name's button carries it for the keyboard and VoiceOver.
    expect(word.closest('button')).toBeNull();
    fireEvent.click(word);
    expect(hallway.toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(word);
    expect(hallway.toggle.getAttribute('aria-expanded')).toBe('true');
    // Several parts: each one whole ("1 late," and "1 needs work"), the sentence unchanged.
    const garden = home().data!.areas.find((a) => a.name === 'Garden')!;
    await act(async () => {
      await home().createItem({ ...NEW_ITEM, area_id: garden.id, title: 'Broken gate', rag: 'red', due_date: '2026-10-01' });
      await home().createItem({ ...NEW_ITEM, area_id: garden.id, kind: 'state', title: 'Fence', rag: 'red', due_date: null });
    });
    const status = () => area('Garden').region.querySelector('[data-toggles]');
    await waitFor(() => expect(status()?.textContent).toBe('1 late, 1 needs work'));
    expect(Array.from(status()!.firstElementChild!.children).map((part) => part.textContent)).toEqual(['1 late,', '1 needs work']);
  });

  it('Add Item in a room’s menu adds an item to that room', async () => {
    const { home, onAddItem } = await setup();
    const garden = home().data!.areas.find((a) => a.name === 'Garden')!;
    roomMenu('Garden', 'Add item to Garden');
    expect(onAddItem).toHaveBeenCalledWith(garden.id);
    // Also on a collapsed room, and on one with nothing open.
    fireEvent.click(area('Kitchen').toggle);
    await act(async () => {});
    roomMenu('Kitchen', 'Add item to Kitchen');
    expect(onAddItem).toHaveBeenLastCalledWith(home().data!.areas.find((a) => a.name === 'Kitchen')!.id);
    await act(async () => {});
    roomMenu('Bedroom Small', 'Add item to Bedroom Small');
    expect(onAddItem).toHaveBeenLastCalledWith(home().data!.areas.find((a) => a.name === 'Bedroom Small')!.id);
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

describe('HomeScreen sharing an area', () => {
  afterEach(() => {
    // Back to jsdom's own navigator (no share, no clipboard).
    delete (navigator as { share?: unknown }).share;
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  function stubShare(impl: (data: ShareData) => Promise<void> = async () => {}) {
    const share = vi.fn(impl);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    return share;
  }

  function stubClipboard() {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    return writeText;
  }

  it('every room has one "..." menu: Add Item, Share Room, then Collapse All Rooms', async () => {
    const { home } = await setup();
    for (const a of home().data!.areas) {
      const button = screen.getByRole('button', { name: `${a.name} options` });
      expect(button.getAttribute('aria-haspopup'), a.name).toBe('menu');
      fireEvent.click(button);
      const menu = screen.getByRole('menu', { name: a.name });
      expect(within(menu).getAllByRole('menuitem').map((m) => m.getAttribute('aria-label') ?? m.textContent)).toEqual([
        `Add item to ${a.name}`,
        `Share ${a.name}`,
        'Collapse All Rooms',
      ]);
      fireEvent.keyDown(menu, { key: 'Escape' });
      expect(document.activeElement).toBe(button);
      await act(async () => {});
    }
  });

  it('opens the share sheet with the area’s open items and a link to it', async () => {
    const { home } = await setup();
    const share = stubShare();
    const data = home().data!;
    const hallway = data.areas.find((a) => a.name === 'Hallway')!;
    const due = data.items.find((i) => i.title === 'Heaters not working')!.due_date!;
    roomMenu('Hallway', 'Share Hallway');
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({
      title: 'Hallway',
      text: `Hallway (1 item)\n• Heaters not working · Urgent · Missed · ${formatDay(due, home().today)}\n\n${window.location.origin}/?area=${hallway.id}`,
    });
    await act(async () => {});
    expect(home().toast).toBeNull();
  });

  it('works on a collapsed area, and on one with nothing to do', async () => {
    const { home } = await setup();
    const share = stubShare();
    fireEvent.click(area('Kitchen').toggle);
    roomMenu('Kitchen', 'Share Kitchen');
    expect(share.mock.lastCall![0].text).toMatch(/^Kitchen \(2 items\)\n• Kitchen paper · Not urgent · Due .*\n• Olive oil · /);
    await act(async () => {});
    roomMenu('Bedroom Small', 'Share Bedroom Small');
    const smallId = home().data!.areas.find((a) => a.name === 'Bedroom Small')!.id;
    expect(share.mock.lastCall![0].text).toBe(`Bedroom Small\nNothing to do\n\n${window.location.origin}/?area=${smallId}`);
  });

  it('without a share sheet, copies the text and says so', async () => {
    const { home } = await setup();
    const writeText = stubClipboard();
    roomMenu('Garden', 'Share Garden');
    await waitFor(() => expect(home().toast?.message).toBe(COPIED_TOAST));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.lastCall![0]).toMatch(/^Garden \(3 items\)\n/);
  });

  it('closing the share sheet without sharing does nothing', async () => {
    const { home } = await setup();
    const writeText = stubClipboard();
    const share = stubShare(() => Promise.reject(new DOMException('Share canceled', 'AbortError')));
    roomMenu('Garden', 'Share Garden');
    await act(async () => {});
    expect(share).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(home().toast).toBeNull();
  });

  it('a share sheet that refuses (the tap no longer counts) falls back to copying', async () => {
    const { home } = await setup();
    const writeText = stubClipboard();
    stubShare(() => Promise.reject(new DOMException('Not allowed', 'NotAllowedError')));
    roomMenu('Garden', 'Share Garden');
    await waitFor(() => expect(home().toast?.message).toBe(COPIED_TOAST));
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('a second tap while the share sheet is up is ignored', async () => {
    await setup();
    let finish!: () => void;
    const share = stubShare(() => new Promise<void>((resolve) => (finish = resolve)));
    roomMenu('Garden', 'Share Garden');
    roomMenu('Kitchen', 'Share Kitchen');
    expect(share).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    roomMenu('Kitchen', 'Share Kitchen');
    expect(share).toHaveBeenCalledTimes(2);
  });

  it('Share works again after a while if a share sheet never reports back', async () => {
    await setup();
    const share = stubShare(() => new Promise<void>(() => {}));
    vi.useFakeTimers();
    try {
      roomMenu('Garden', 'Share Garden');
      roomMenu('Kitchen', 'Share Kitchen');
      expect(share).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(1600));
      roomMenu('Kitchen', 'Share Kitchen');
      expect(share).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('HomeScreen from a shared area link', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('expands the area, scrolls it into view and lights it up for a moment', async () => {
    const { home, linkArea, onLinkedAreaShown } = await setup();
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    const hallway = home().data!.areas.find((a) => a.name === 'Hallway')!;
    const gardenId = home().data!.areas.find((a) => a.name === 'Garden')!.id;
    fireEvent.click(area('Hallway').toggle);
    fireEvent.click(area('Garden').toggle);

    vi.useFakeTimers();
    act(() => linkArea()(hallway.id));
    expect(area('Hallway').toggle.getAttribute('aria-expanded')).toBe('true');
    // Only that one, remembered as open.
    expect(area('Garden').toggle.getAttribute('aria-expanded')).toBe('false');
    expect(JSON.parse(localStorage.getItem(collapsedKey(home().data!.household.id))!)).toEqual([gardenId]);
    // Scrolled once its card has opened.
    expect(scrolled).toEqual([]);
    expect(document.activeElement).toBe(document.body);
    act(() => vi.advanceTimersByTime(400));
    expect(scrolled).toEqual([area('Hallway').region]);
    expect(onLinkedAreaShown).toHaveBeenCalledTimes(1);
    expect(area('Hallway').region.hasAttribute('data-linked')).toBe(true);
    // Focus is on its name, so VoiceOver reads "Hallway, expanded" and carries on into it.
    // No focus ring until a key is pressed (a link brought them here, not the keyboard).
    expect(document.activeElement).toBe(area('Hallway').toggle);
    expect(area('Hallway').toggle.hasAttribute('data-quiet-focus')).toBe(true);
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(area('Hallway').toggle.hasAttribute('data-quiet-focus')).toBe(false);
    act(() => vi.advanceTimersByTime(2500));
    expect(area('Hallway').region.hasAttribute('data-linked')).toBe(false);
  });

  it('shows everyone’s items when the person filter hides the area or some of its items', async () => {
    const { home, linkArea } = await setup();
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    const hallway = home().data!.areas.find((a) => a.name === 'Hallway')!;
    // Hallway's one item is Shea's: Unassigned hides the area.
    chooseWho(/^Unassigned,/);
    expect(screen.queryByRole('region', { name: 'Hallway' })).toBeNull();
    vi.useFakeTimers();
    act(() => linkArea()(hallway.id));
    expect(who()).toBe('Everyone');
    act(() => vi.advanceTimersByTime(100));
    expect(scrolled).toEqual([area('Hallway').region]);
    expect(document.activeElement).toBe(area('Hallway').toggle);
    vi.useRealTimers();

    // Garden has items for more than one person: one person's view shows only some.
    const garden = home().data!.areas.find((a) => a.name === 'Garden')!;
    const gardenItems = home().data!.items.filter((it) => it.area_id === garden.id && it.status === 'open');
    const someone = home().data!.members.find((m) => gardenItems.some((it) => it.assignee_id === m.id))!;
    expect(gardenItems.every((it) => it.assignee_id === someone.id)).toBe(false);
    await act(async () => {});
    chooseWho(new RegExp(`^${someone.name}`));
    expect(who()).not.toBe('Everyone');
    act(() => linkArea()(garden.id));
    expect(who()).toBe('Everyone');
    await waitFor(() => expect(scrolled.at(-1)).toBe(area('Garden').region));
  });

  it('keeps the filter when it already shows all of the area', async () => {
    const { home, linkArea } = await setup();
    Element.prototype.scrollIntoView = () => {};
    const hallway = home().data!.areas.find((a) => a.name === 'Hallway')!;
    const shea = home().data!.members.find((m) => m.name === 'Shea')!;
    expect(home().data!.items.filter((it) => it.area_id === hallway.id && it.status === 'open').every((it) => it.assignee_id === shea.id)).toBe(true);
    chooseWho(/^Shea,/);
    act(() => linkArea()(hallway.id));
    await waitFor(() => expect(area('Hallway').region.hasAttribute('data-linked')).toBe(true));
    expect(who()).toBe('Shea');
  });

  it('switches to Rooms from another view, and has the round + add to that room until the view changes', async () => {
    const { home, linkArea, onRoomContext } = await setup(undefined, 'next');
    Element.prototype.scrollIntoView = () => {};
    const garden = home().data!.areas.find((a) => a.name === 'Garden')!;
    act(() => linkArea()(garden.id));
    await waitFor(() => expect(onRoomContext).toHaveBeenLastCalledWith(garden.id));
    const views = screen.getByRole('radiogroup', { name: 'View' });
    expect(within(views).getByRole('radio', { name: 'Rooms' }).getAttribute('aria-checked')).toBe('true');
    expect(area('Garden').region.hasAttribute('data-linked')).toBe(true);
    fireEvent.click(within(views).getByRole('radio', { name: 'Up next' }));
    expect(onRoomContext).toHaveBeenLastCalledWith(null);
  });

  it('an open area scrolls straight away', async () => {
    const { home, linkArea, onLinkedAreaShown } = await setup();
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    const kitchen = home().data!.areas.find((a) => a.name === 'Kitchen')!;
    vi.useFakeTimers();
    act(() => linkArea()(kitchen.id));
    act(() => vi.advanceTimersByTime(0));
    expect(scrolled).toEqual([area('Kitchen').region]);
    expect(onLinkedAreaShown).toHaveBeenCalledTimes(1);
    expect(area('Kitchen').toggle.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('HomeScreen area names', () => {
  it('keep the chevron with the last letter, and the name whole for assistive tech', async () => {
    await setup();
    const { toggle } = area('Bathroom Large');
    // The room's drawing comes first; the chevron is the last glyph.
    const tail = Array.from(toggle.querySelectorAll('svg')).at(-1)!.parentElement!;
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

  it('read when they were last updated, in the household’s time zone, with a gauge and their condition in words', async () => {
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
    const row = screen.getByRole('button', { name: /^Firepit ?, to maintain, Good, Ela, updated today, has a note\.$/ });
    expect(within(row).getByText('Updated today')).toBeTruthy();
    expect(within(row).getByText('Good')).toBeTruthy();
    // Under "Looking after", after the room's To dos; a gauge in the ring's place.
    const looking = row.closest('li')!.parentElement!.parentElement!;
    expect(looking.querySelector('p')!.textContent).toBe('Looking after');
    expect(row.closest('li')!.querySelector('[data-variant="row"]')).toBeTruthy();
  });
});

describe('roomStatus', () => {
  const TODAY = '2026-10-08';
  const it_ = (rag: 'red' | 'amber' | 'green', due: string | null, kind: 'task' | 'state' = 'task') =>
    ({ rag, due_date: due, kind, status: 'open' }) as Parameters<typeof roomStatus>[0][number];
  it('counts late and urgent To dos and things that need work, else says All clear, or how many are open while collapsed', () => {
    expect(roomStatus([it_('red', '2026-10-20'), it_('green', '2026-10-01'), it_('amber', null)], TODAY, false)).toEqual({
      text: '1 late, 1 urgent',
      alert: true,
    });
    expect(roomStatus([it_('red', '2026-10-01')], TODAY, false)).toEqual({ text: '1 late', alert: true });
    expect(roomStatus([it_('red', null), it_('red', '2026-10-30')], TODAY, true)).toEqual({ text: '2 urgent', alert: true });
    expect(roomStatus([it_('red', null, 'state'), it_('red', null, 'state')], TODAY, false)).toEqual({
      text: '2 need work',
      alert: true,
    });
    expect(roomStatus([], TODAY, false)).toEqual({ text: 'All clear', alert: false });
    expect(roomStatus([it_('amber', '2026-10-20'), it_('amber', null, 'state')], TODAY, false)).toBeNull();
    expect(roomStatus([it_('amber', '2026-10-20'), it_('green', null, 'state')], TODAY, true)).toEqual({
      text: '2 open',
      alert: false,
    });
  });
});

describe('the calendar on Home', () => {
  const calendar = () => document.querySelector<HTMLElement>('[data-calendar]')!;
  const dayButton = (date: string) => calendar().querySelector<HTMLButtonElement>(`[data-date="${date}"]`);

  it('marks only the items the person filter shows; housekeeping visits stay', async () => {
    const { home } = await setup(undefined, 'calendar');
    const data = home().data!;
    const today = home().today;
    const busy = data.items.find((i) => i.title === 'Put the bins out')!.due_date!;
    const lastVisit = data.housekeeping.visits.map((v) => v.visit_date).sort().at(-1)!;
    fireEvent.click(within(calendar()).getByRole('button', { name: 'Show month' }));
    // The month of the busy day (six days on: it may be next month).
    if (busy.slice(0, 7) !== today.slice(0, 7)) fireEvent.click(within(calendar()).getByRole('button', { name: 'Next month' }));
    expect(dayButton(busy)!.getAttribute('aria-label')).toMatch(/, 4 due/);

    chooseWho(/^Shea,/);
    // Shea's two: the shower and the garden furniture.
    expect(dayButton(busy)!.getAttribute('aria-label')).toMatch(/, 2 due/);
    fireEvent.click(dayButton(busy)!);
    const panel = calendar().querySelector<HTMLElement>('[data-calendar-day]')!;
    expect(within(panel).getAllByRole('button', { name: /^Mark / }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Mark Shower draining slowly as done',
      'Mark Cover the garden furniture as done',
    ]);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(dayButton(busy)!.getAttribute('aria-label')).toMatch(/, 1 due/);

    // The last visit is still marked, whoever is shown.
    while (!dayButton(lastVisit)) fireEvent.click(within(calendar()).getByRole('button', { name: 'Previous month' }));
    expect(dayButton(lastVisit)!.getAttribute('aria-label')).toMatch(/, housekeeping visit$/);
    chooseWho(/^Unassigned,/);
    expect(dayButton(lastVisit)!.getAttribute('aria-label')).toMatch(/, housekeeping visit$/);
  });

  it('completes an item from the chosen day', async () => {
    const { home } = await setup(undefined, 'calendar');
    const today = home().today;
    const panel = () => calendar().querySelector<HTMLElement>('[data-calendar-day]')!;
    // Its own view: "This week" over the strip, and today's list open at once.
    expect(screen.getByRole('region', { name: 'This week' })).toBe(calendar());
    expect(panel().getAttribute('data-calendar-day')).toBe(today);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Mark Empty the dehumidifier as done' }));
    // A weekly job: due again in a week, so today has nothing left.
    await waitFor(() => expect(within(panel()).getByText('Nothing due today.')).toBeTruthy());
    const dehumidifier = home().data!.items.find((i) => i.title === 'Empty the dehumidifier')!;
    expect(dehumidifier.due_date).not.toBe(today);
  });
});
