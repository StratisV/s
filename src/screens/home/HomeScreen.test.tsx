import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, type StorageLike } from '../../lib/backend/demo';
import { formatDay } from '../../lib/logic/dates';
import { HomeProvider, useHome, type HomeContextValue } from '../../state/HomeProvider';
import { ConfettiProvider } from '../../ui/Confetti';
import { COPIED_TOAST } from '../share/useShare';
import { collapsedKey, HOME_VIEW_KEY, HomeScreen, roomStatus, splitLast, type HomeView } from './HomeScreen';

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
  expose(home: HomeContextValue, reveal: (areaId: string) => void, link: (areaId: string) => void): void;
}

/**
 * Home as App mounts it: `reveal` is what App does once an item is saved into an area,
 * `link` what it does for a shared `?area=` link.
 */
function Ready({ onOpenProfile, onAddItem, onRevealed, onLinkedAreaShown, expose }: ReadyProps) {
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

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('HomeScreen', () => {
  it('lists the areas and says each row’s status to assistive tech', async () => {
    await setup();
    // The calendar's heading, then the eleven areas'.
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.closest('[data-area-id]') !== null)).toEqual([false, ...Array(11).fill(true)]);
    expect(headings[0].textContent).toBe('Calendar');
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

  it('says "1 urgent" on a room with something late or urgent, and nothing on a calm open room', async () => {
    const { home } = await setup();
    const data = home().data!;
    const hallway = area('Hallway').region;
    expect(within(hallway).getByText('1 urgent')).toBeTruthy();
    expect(within(area('Kitchen').region).queryByText(/^\d+ (urgent|open)$/)).toBeNull();

    // Completing the late item clears it: the room has nothing open, so it reads All clear.
    const heaters = data.items.find((it) => it.title === 'Heaters not working')!;
    await act(async () => {
      await home().completeItem(heaters.id);
    });
    await waitFor(() => expect(within(hallway).queryByText('1 urgent')).toBeNull());
    expect(within(hallway).getByText('All clear')).toBeTruthy();
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

  it('every area header has a Share button, after the counts and before the +', async () => {
    const { home } = await setup();
    for (const a of home().data!.areas) {
      const { region } = area(a.name);
      const buttons = within(region).getAllByRole('button');
      const names = buttons.map((b) => b.getAttribute('aria-label'));
      const share = names.indexOf(`Share ${a.name}`);
      expect(share, a.name).toBeGreaterThan(0);
      expect(names[share + 1], a.name).toBe(`Add item to ${a.name}`);
    }
  });

  it('opens the share sheet with the area’s open items and a link to it', async () => {
    const { home } = await setup();
    const share = stubShare();
    const data = home().data!;
    const hallway = data.areas.find((a) => a.name === 'Hallway')!;
    const due = data.items.find((i) => i.title === 'Heaters not working')!.due_date!;
    fireEvent.click(screen.getByRole('button', { name: 'Share Hallway' }));
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({
      title: 'Hallway',
      text: `Hallway (1 item)\n• Heaters not working · Red · Missed · ${formatDay(due, home().today)}\n\n${window.location.origin}/?area=${hallway.id}`,
    });
    await act(async () => {});
    expect(home().toast).toBeNull();
  });

  it('works on a collapsed area, and on one with nothing to do', async () => {
    const { home } = await setup();
    const share = stubShare();
    fireEvent.click(area('Kitchen').toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Share Kitchen' }));
    expect(share.mock.lastCall![0].text).toMatch(/^Kitchen \(2 items\)\n• Kitchen paper · Green · Due .*\n• Olive oil · /);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Share Bedroom Small' }));
    const smallId = home().data!.areas.find((a) => a.name === 'Bedroom Small')!.id;
    expect(share.mock.lastCall![0].text).toBe(`Bedroom Small\nNothing to do\n\n${window.location.origin}/?area=${smallId}`);
  });

  it('without a share sheet, copies the text and says so', async () => {
    const { home } = await setup();
    const writeText = stubClipboard();
    fireEvent.click(screen.getByRole('button', { name: 'Share Garden' }));
    await waitFor(() => expect(home().toast?.message).toBe(COPIED_TOAST));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.lastCall![0]).toMatch(/^Garden \(3 items\)\n/);
  });

  it('closing the share sheet without sharing does nothing', async () => {
    const { home } = await setup();
    const writeText = stubClipboard();
    const share = stubShare(() => Promise.reject(new DOMException('Share canceled', 'AbortError')));
    fireEvent.click(screen.getByRole('button', { name: 'Share Garden' }));
    await act(async () => {});
    expect(share).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(home().toast).toBeNull();
  });

  it('a share sheet that refuses (the tap no longer counts) falls back to copying', async () => {
    const { home } = await setup();
    const writeText = stubClipboard();
    stubShare(() => Promise.reject(new DOMException('Not allowed', 'NotAllowedError')));
    fireEvent.click(screen.getByRole('button', { name: 'Share Garden' }));
    await waitFor(() => expect(home().toast?.message).toBe(COPIED_TOAST));
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('a second tap while the share sheet is up is ignored', async () => {
    await setup();
    let finish!: () => void;
    const share = stubShare(() => new Promise<void>((resolve) => (finish = resolve)));
    fireEvent.click(screen.getByRole('button', { name: 'Share Garden' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share Kitchen' }));
    expect(share).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    fireEvent.click(screen.getByRole('button', { name: 'Share Kitchen' }));
    expect(share).toHaveBeenCalledTimes(2);
  });

  it('Share works again after a while if a share sheet never reports back', async () => {
    await setup();
    const share = stubShare(() => new Promise<void>(() => {}));
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Share Garden' }));
      fireEvent.click(screen.getByRole('button', { name: 'Share Kitchen' }));
      expect(share).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(1600));
      fireEvent.click(screen.getByRole('button', { name: 'Share Kitchen' }));
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
    const filter = (name: RegExp) => within(screen.getByRole('radiogroup', { name: 'Show tasks for' })).getByRole('radio', { name });
    const hallway = home().data!.areas.find((a) => a.name === 'Hallway')!;
    // Hallway's one item is Shea's: Unassigned hides the area.
    fireEvent.click(filter(/^Unassigned,/));
    expect(screen.queryByRole('region', { name: 'Hallway' })).toBeNull();
    vi.useFakeTimers();
    act(() => linkArea()(hallway.id));
    expect(filter(/^Everyone,/).getAttribute('aria-checked')).toBe('true');
    act(() => vi.advanceTimersByTime(100));
    expect(scrolled).toEqual([area('Hallway').region]);
    expect(document.activeElement).toBe(area('Hallway').toggle);
    vi.useRealTimers();

    // Garden has items for more than one person: one person's view shows only some.
    const garden = home().data!.areas.find((a) => a.name === 'Garden')!;
    const gardenItems = home().data!.items.filter((it) => it.area_id === garden.id && it.status === 'open');
    const someone = home().data!.members.find((m) => gardenItems.some((it) => it.assignee_id === m.id))!;
    expect(gardenItems.every((it) => it.assignee_id === someone.id)).toBe(false);
    fireEvent.click(filter(new RegExp(`^${someone.name}`)));
    expect(filter(/^Everyone,/).getAttribute('aria-checked')).toBe('false');
    act(() => linkArea()(garden.id));
    expect(filter(/^Everyone,/).getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(scrolled.at(-1)).toBe(area('Garden').region));
  });

  it('keeps the filter when it already shows all of the area', async () => {
    const { home, linkArea } = await setup();
    Element.prototype.scrollIntoView = () => {};
    const filter = (name: RegExp) => within(screen.getByRole('radiogroup', { name: 'Show tasks for' })).getByRole('radio', { name });
    const hallway = home().data!.areas.find((a) => a.name === 'Hallway')!;
    const shea = home().data!.members.find((m) => m.name === 'Shea')!;
    expect(home().data!.items.filter((it) => it.area_id === hallway.id && it.status === 'open').every((it) => it.assignee_id === shea.id)).toBe(true);
    fireEvent.click(filter(/^Shea,/));
    act(() => linkArea()(hallway.id));
    await waitFor(() => expect(area('Hallway').region.hasAttribute('data-linked')).toBe(true));
    expect(filter(/^Shea,/).getAttribute('aria-checked')).toBe('true');
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

describe('roomStatus', () => {
  const TODAY = '2026-10-08';
  const it_ = (rag: 'red' | 'amber' | 'green', due: string | null, kind: 'task' | 'state' = 'task') =>
    ({ rag, due_date: due, kind, status: 'open' }) as Parameters<typeof roomStatus>[0][number];
  it('counts late or urgent To dos, else says All clear, or how many are open while collapsed', () => {
    expect(roomStatus([it_('red', '2026-10-20'), it_('green', '2026-10-01'), it_('amber', null)], TODAY, false)).toEqual({
      text: '2 urgent',
      urgent: true,
    });
    expect(roomStatus([], TODAY, false)).toEqual({ text: 'All clear', urgent: false });
    expect(roomStatus([it_('amber', '2026-10-20'), it_('red', null, 'state')], TODAY, false)).toBeNull();
    expect(roomStatus([it_('amber', '2026-10-20'), it_('red', null, 'state')], TODAY, true)).toEqual({
      text: '2 open',
      urgent: false,
    });
  });
});

describe('the calendar on Home', () => {
  const calendar = () => screen.getByRole('region', { name: 'Calendar' });
  const dayButton = (date: string) => calendar().querySelector<HTMLButtonElement>(`[data-date="${date}"]`);

  it('marks only the items the person filter shows; housekeeping visits stay', async () => {
    const { home } = await setup();
    const data = home().data!;
    const today = home().today;
    const busy = data.items.find((i) => i.title === 'Put the bins out')!.due_date!;
    const lastVisit = data.housekeeping.visits.map((v) => v.visit_date).sort().at(-1)!;
    fireEvent.click(within(calendar()).getByRole('button', { name: 'Show month' }));
    // The month of the busy day (six days on: it may be next month).
    if (busy.slice(0, 7) !== today.slice(0, 7)) fireEvent.click(within(calendar()).getByRole('button', { name: 'Next month' }));
    expect(dayButton(busy)!.getAttribute('aria-label')).toMatch(/, 4 due/);

    const filter = (name: RegExp) => within(screen.getByRole('radiogroup', { name: 'Show tasks for' })).getByRole('radio', { name });
    fireEvent.click(filter(/^Shea,/));
    // Shea's two: the shower and the garden furniture.
    expect(dayButton(busy)!.getAttribute('aria-label')).toMatch(/, 2 due/);
    fireEvent.click(dayButton(busy)!);
    const panel = calendar().querySelector<HTMLElement>('[data-calendar-day]')!;
    expect(within(panel).getAllByRole('button', { name: /^Mark / }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Mark Shower draining slowly as done',
      'Mark Cover the garden furniture as done',
    ]);
    fireEvent.click(filter(/^Stratis/));
    expect(dayButton(busy)!.getAttribute('aria-label')).toMatch(/, 1 due/);

    // The last visit is still marked, whoever is shown.
    while (!dayButton(lastVisit)) fireEvent.click(within(calendar()).getByRole('button', { name: 'Previous month' }));
    expect(dayButton(lastVisit)!.getAttribute('aria-label')).toMatch(/, housekeeping visit$/);
    fireEvent.click(filter(/^Unassigned,/));
    expect(dayButton(lastVisit)!.getAttribute('aria-label')).toMatch(/, housekeeping visit$/);
  });

  it('completes an item from the chosen day', async () => {
    const { home } = await setup();
    const today = home().today;
    const panel = () => calendar().querySelector<HTMLElement>('[data-calendar-day]')!;
    // Today is chosen at first, with a line saying what is due (its rows are in the areas).
    expect(within(calendar()).getByText('1 due today')).toBeTruthy();
    expect(calendar().querySelector('[data-calendar-day]')).toBeNull();
    // Choosing it lists them: the dehumidifier is due.
    fireEvent.click(dayButton(today)!);
    expect(panel().getAttribute('data-calendar-day')).toBe(today);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Mark Empty the dehumidifier as done' }));
    // A weekly job: due again in a week, so today has nothing left.
    await waitFor(() => expect(within(panel()).getByText('Nothing due today.')).toBeTruthy());
    const dehumidifier = home().data!.items.find((i) => i.title === 'Empty the dehumidifier')!;
    expect(dehumidifier.due_date).not.toBe(today);
  });
});
