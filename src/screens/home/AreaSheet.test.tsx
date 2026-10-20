import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, type StorageLike } from '../../lib/backend/demo';
import { addDays, formatDay } from '../../lib/logic/dates';
import { HomeProvider, useHome, type HomeContextValue } from '../../state/HomeProvider';
import { ConfettiProvider } from '../../ui/Confetti';
import { COPIED_TOAST } from '../share/useShare';
import { AreaSheet, ROOM_PREVIEW } from './AreaSheet';
import { revealRow } from './reveal';

// jsdom lays nothing out: record where the sheet scrolls a row just saved to instead
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
  area: string;
  onClose(): void;
  onAddItem(areaId: string): void;
  onOpenItem(itemId: string): void;
  onRevealed(): void;
  expose(home: HomeContextValue, reveal: (itemId: string) => void, show: (areaId: string) => void): void;
}

/** An area's sheet as App opens it from its card; `reveal` is what App does once an item is saved over it. */
function Ready({ area, onClose, onAddItem, onOpenItem, onRevealed, expose }: ReadyProps) {
  const home = useHome();
  const [revealItem, setRevealItem] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  // The area chosen when the sheet opened (App keeps it while the sheet is up, deleted or not).
  const first = useRef<string | null>(null);
  expose(home, setRevealItem, setShown);
  if (home.phase.kind !== 'ready' || !home.data) return null;
  first.current ??= home.data.areas.find((a) => a.name === area)?.id ?? null;
  const areaId = shown ?? first.current;
  return (
    <AreaSheet
      areaId={areaId}
      open
      onClose={onClose}
      onOpenItem={onOpenItem}
      onAddItem={onAddItem}
      revealItem={revealItem}
      onRevealed={() => {
        onRevealed();
        setRevealItem(null);
      }}
    />
  );
}

/** Opens the seeded household's `area` in its sheet. */
async function setup(area: string) {
  const backend = new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 });
  const onClose = vi.fn();
  const onAddItem = vi.fn();
  const onOpenItem = vi.fn();
  const onRevealed = vi.fn();
  let home!: HomeContextValue;
  let reveal!: (itemId: string) => void;
  let show!: (areaId: string) => void;
  render(
    <HomeProvider backend={backend}>
      <ConfettiProvider>
        <Ready
          area={area}
          onClose={onClose}
          onAddItem={onAddItem}
          onOpenItem={onOpenItem}
          onRevealed={onRevealed}
          expose={(h, r, s) => {
            home = h;
            reveal = r;
            show = s;
          }}
        />
      </ConfettiProvider>
    </HomeProvider>,
  );
  await screen.findByRole('dialog', { name: area });
  return {
    onClose,
    onAddItem,
    onOpenItem,
    onRevealed,
    home: () => home,
    revealItem: () => reveal,
    show: (name: string) => act(() => show(home.data!.areas.find((a) => a.name === name)!.id)),
  };
}

const sheet = () => screen.getByRole('dialog');
/** Titles of the To dos, top to bottom. */
const todos = () =>
  within(sheet().querySelector<HTMLElement>('[data-area-tasks]')!)
    .queryAllByRole('button', { name: /^Mark / })
    .map((b) => b.getAttribute('aria-label')!.replace(/^Mark /, '').replace(/ as done$/, ''));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('AreaSheet', () => {
  it('names the area over its drawing, says how many tasks it has and who is looking after it', async () => {
    await setup('Garden');
    const dialog = sheet();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = within(dialog).getByRole('heading', { level: 1 });
    expect(title.textContent).toBe('Garden');
    // The drawing is decorative.
    expect(dialog.querySelector('[data-area-art]')!.getAttribute('aria-hidden')).toBe('true');
    // The wall panel (Within the month) and the firepit to give away (Not urgent), in orange.
    expect(dialog.querySelector('[data-area-status]')!.textContent).toBe('2 non-urgent tasks');
    expect(Array.from(dialog.querySelectorAll<HTMLElement>('[data-area-status] [data-tone]')).map((el) => el.dataset.tone)).toEqual([
      'non-urgent',
    ]);
    expect(dialog.querySelector('[data-area-people]')!.textContent).toBe('Ela and Stratis are on it');
    // The heading carries both lines for assistive tech.
    const described = title.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)!.textContent);
    expect(described).toEqual(['2 non-urgent tasks', 'Ela and Stratis are on it']);
  });

  it('lists its To dos most urgent first, then what it looks after, and says each row to assistive tech', async () => {
    const { show } = await setup('Garden');
    // The wall panel (Within the month) before the firepit (Not urgent).
    expect(todos()).toEqual(['Garden room wall panel', 'Give away the old firepit']);
    const looking = sheet().querySelector<HTMLElement>('[data-area-looking]')!;
    expect(within(looking).getByRole('heading', { level: 2 }).textContent).toBe('Looking after');
    // A gauge in the ring's place, and its condition in words.
    expect(within(looking).getByRole('button', { name: /^Firepit ?, to maintain, Good, Ela, updated / })).toBeTruthy();
    expect(looking.querySelector('[data-variant="row"]')).toBeTruthy();

    show('Hallway');
    await screen.findByRole('dialog', { name: 'Hallway' });
    // jsdom's name computation may put a space before the comma; the room is the sheet's own, so unsaid.
    const heaters = screen.getByRole('button', { name: /^Heaters not working ?, Urgent, 2 days late, Shea, has a note\.$/ });
    expect(within(heaters).getByText('Urgent')).toBeTruthy();
    expect(sheet().querySelector('[data-area-status]')!.textContent).toBe('1 urgent task');
    expect(sheet().querySelector('[data-area-people]')!.textContent).toBe('Shea is on it');
    expect(sheet().querySelector('[data-area-looking]')).toBeNull();
  });

  it('says the urgent tasks in red over the non-urgent ones in orange, read as one phrase', async () => {
    await setup('Front garden');
    const status = sheet().querySelector<HTMLElement>('[data-area-status]')!;
    expect(Array.from(status.querySelectorAll<HTMLElement>('[data-tone]')).map((el) => [el.dataset.tone, el.textContent])).toEqual([
      ['urgent', '1 urgent task, '],
      ['non-urgent', '2 non-urgent tasks'],
    ]);
    const title = within(sheet()).getByRole('heading', { level: 1 });
    expect(document.getElementById(title.getAttribute('aria-describedby')!.split(' ')[0])!.textContent).toBe(
      '1 urgent task, 2 non-urgent tasks',
    );
  });

  it('an area with nothing open says so, and nobody is on it', async () => {
    await setup('Bedroom Small');
    expect(sheet().querySelector('[data-area-status]')!.textContent).toBe('All good');
    expect(sheet().querySelector('[data-area-people]')!.textContent).toBe('No one is on it yet');
    expect(within(sheet()).getByText('Nothing to do here.')).toBeTruthy();
    expect(todos()).toEqual([]);
  });

  it('shows three jobs in a busy area, then "Show 2 more"', async () => {
    const { home, show } = await setup('Kitchen');
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
    const more = await within(sheet()).findByRole('button', { name: 'Show 2 more' });
    expect(todos()).toHaveLength(ROOM_PREVIEW);
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(todos()).toHaveLength(5);
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Show fewer' }));
    expect(todos()).toHaveLength(ROOM_PREVIEW);
    // An area with four shows all four: "Show 1 more" would only cost a tap.
    show('Garden Lounge');
    await screen.findByRole('dialog', { name: 'Garden Lounge' });
    expect(todos()).toHaveLength(4);
    expect(within(sheet()).queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull();
  });

  it('follows the items: ticking off the late job calms the area', async () => {
    const { home } = await setup('Hallway');
    fireEvent.click(screen.getByRole('button', { name: 'Mark Heaters not working as done' }));
    await waitFor(() => expect(sheet().querySelector('[data-area-status]')!.textContent).toBe('All good'), { timeout: 3000 });
    expect(home().data!.items.some((it) => it.title === 'Heaters not working')).toBe(false);
    expect(home().toast?.message).toBe('Marked as done');
    expect(within(sheet()).getByText('Nothing to do here.')).toBeTruthy();
  });

  it('Add Item adds to the area, also when it has nothing open; Close closes', async () => {
    const { home, onAddItem, onClose, show } = await setup('Garden');
    const garden = home().data!.areas.find((a) => a.name === 'Garden')!;
    // Named by its words and its area (Voice Control: "Tap Add Item").
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Add item to Garden' }));
    expect(onAddItem).toHaveBeenCalledWith(garden.id);
    show('Bedroom Small');
    await screen.findByRole('dialog', { name: 'Bedroom Small' });
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Add item to Bedroom Small' }));
    expect(onAddItem).toHaveBeenLastCalledWith(home().data!.areas.find((a) => a.name === 'Bedroom Small')!.id);
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a row opens its item', async () => {
    const { home, onOpenItem } = await setup('Kitchen');
    fireEvent.click(screen.getByRole('button', { name: /^Olive oil ?, Not urgent, / }));
    expect(onOpenItem).toHaveBeenCalledWith(home().data!.items.find((it) => it.title === 'Olive oil')!.id);
  });

  it('closes itself when its area is deleted', async () => {
    const { home, onClose } = await setup('Jacuzzi');
    await act(async () => {
      await home().deleteArea(home().data!.areas.find((a) => a.name === 'Jacuzzi')!.id);
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('AreaSheet after a save', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(revealRow).mockClear();
  });

  const rowOf = (id: string) => document.querySelector<HTMLElement>(`[data-item-id="${id}"]`);

  it('a new item behind "Show 2 more": the sheet shows it, scrolls to it and lights it up', async () => {
    const { home, revealItem, onRevealed } = await setup('Garden Lounge');
    vi.mocked(revealRow).mockClear();
    const scrolled = vi.mocked(revealRow).mock.calls;
    const lounge = home().data!.areas.find((a) => a.name === 'Garden Lounge')!;
    // A fifth job, not urgent and due in ten days: it folds after three, and it is fourth.
    let created!: { id: string };
    await act(async () => {
      created = await home().createItem({
        area_id: lounge.id,
        kind: 'task',
        title: 'Oil the decking',
        note: '',
        good: '',
        rag: 'green',
        due_date: addDays(home().today, 10),
        assignee_id: null,
        repeat: 'none',
        notify: 'none',
      });
    });
    vi.useFakeTimers();
    act(() => revealItem()(created.id));
    await act(async () => {});
    expect(within(sheet()).getByRole('button', { name: 'Show fewer' }).getAttribute('aria-expanded')).toBe('true');
    expect(rowOf(created.id)!.hasAttribute('data-lit')).toBe(true);
    expect(onRevealed).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(100));
    expect(scrolled).toEqual([[rowOf(created.id)!, true]]);
    // The light fades; the list stays open until folded again.
    act(() => vi.advanceTimersByTime(3000));
    expect(rowOf(created.id)!.hasAttribute('data-lit')).toBe(false);
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Show fewer' }));
    expect(rowOf(created.id)).toBeNull();
  });

  it('an item saved into another area: a toast says where it went', async () => {
    const { home, revealItem, onRevealed } = await setup('Garden');
    const heaters = home().data!.items.find((it) => it.title === 'Heaters not working')!;
    const kitchen = home().data!.areas.find((a) => a.name === 'Kitchen')!;
    await act(async () => {
      await home().updateItem(heaters.id, { area_id: kitchen.id });
    });
    act(() => revealItem()(heaters.id));
    await act(async () => {});
    expect(home().toast?.message).toBe('Saved in Kitchen.');
    expect(onRevealed).toHaveBeenCalledTimes(1);
    expect(rowOf(heaters.id)).toBeNull();
  });
});

describe('AreaSheet sharing the area', () => {
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

  const shareRoom = () => fireEvent.click(within(sheet()).getByRole('button', { name: 'Share Room' }));

  it('opens the share sheet with the area’s open items and a link to it', async () => {
    const { home } = await setup('Hallway');
    const share = stubShare();
    const data = home().data!;
    const hallway = data.areas.find((a) => a.name === 'Hallway')!;
    const due = data.items.find((i) => i.title === 'Heaters not working')!.due_date!;
    shareRoom();
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({
      title: 'Hallway',
      text: `Hallway (1 item)\n• Heaters not working · Urgent · Missed · ${formatDay(due, home().today)}\n\n${window.location.origin}/?area=${hallway.id}`,
    });
    await act(async () => {});
    expect(home().toast).toBeNull();
  });

  it('works on an area with nothing to do', async () => {
    const { home } = await setup('Bedroom Small');
    const share = stubShare();
    shareRoom();
    const smallId = home().data!.areas.find((a) => a.name === 'Bedroom Small')!.id;
    expect(share.mock.lastCall![0].text).toBe(`Bedroom Small\nNothing to do\n\n${window.location.origin}/?area=${smallId}`);
  });

  it('without a share sheet, copies the text and says so', async () => {
    const { home } = await setup('Garden');
    const writeText = stubClipboard();
    shareRoom();
    await waitFor(() => expect(home().toast?.message).toBe(COPIED_TOAST));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.lastCall![0]).toMatch(/^Garden \(3 items\)\n/);
  });

  it('closing the share sheet without sharing does nothing', async () => {
    const { home } = await setup('Garden');
    const writeText = stubClipboard();
    const share = stubShare(() => Promise.reject(new DOMException('Share canceled', 'AbortError')));
    shareRoom();
    await act(async () => {});
    expect(share).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(home().toast).toBeNull();
  });

  it('a share sheet that refuses (the tap no longer counts) falls back to copying', async () => {
    const { home } = await setup('Garden');
    const writeText = stubClipboard();
    stubShare(() => Promise.reject(new DOMException('Not allowed', 'NotAllowedError')));
    shareRoom();
    await waitFor(() => expect(home().toast?.message).toBe(COPIED_TOAST));
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('a second tap while the share sheet is up is ignored', async () => {
    await setup('Garden');
    let finish!: () => void;
    const share = stubShare(() => new Promise<void>((resolve) => (finish = resolve)));
    shareRoom();
    shareRoom();
    expect(share).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    shareRoom();
    expect(share).toHaveBeenCalledTimes(2);
  });

  it('Share works again after a while if a share sheet never reports back', async () => {
    await setup('Garden');
    const share = stubShare(() => new Promise<void>(() => {}));
    vi.useFakeTimers();
    try {
      shareRoom();
      shareRoom();
      expect(share).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(1600));
      shareRoom();
      expect(share).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AreaSheet To maintain rows', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('read when they were last updated, in the household’s time zone, with a gauge and their condition in words', async () => {
    // 22:30 on Thu 8 Oct in New York is already Fri 9 Oct in London.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T02:30:00Z'));
    const { home } = await setup('Garden');
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
    // Under "Looking after", after the area's To dos.
    expect(row.closest('[data-area-looking]')).toBeTruthy();
  });
});
