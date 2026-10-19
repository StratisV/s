import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, type StorageLike } from '../../lib/backend/demo';
import { addDays } from '../../lib/logic/dates';
import { HomeProvider, useHome, type HomeContextValue } from '../../state/HomeProvider';
import { ConfettiProvider } from '../../ui/Confetti';
import { ATTENTION_VIEW_KEY, NeedsAttentionScreen, notOnCalendar, type AttentionView } from './NeedsAttentionScreen';
import { personFilterKey } from './personFilter';
import { revealRow } from './reveal';
import { lookingAfterNote } from './UpNextView';

// jsdom lays nothing out: record where the list scrolls a row just saved to instead
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

/** Renders Needs attention for the seeded household (on `view`); pass its storage back to reopen the same one. */
async function setup(storage?: StorageLike, view: AttentionView = 'list') {
  if (view === 'list') localStorage.removeItem(ATTENTION_VIEW_KEY);
  else localStorage.setItem(ATTENTION_VIEW_KEY, view);
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

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Needs attention', () => {
  it('leads with one sentence on what needs doing, then the view switch and whose items', async () => {
    await setup();
    expect(summary()).toBe('2 things need attention and 1 is due today. Everything else can wait.');
    const views = screen.getByRole('radiogroup', { name: 'View' });
    expect(within(views).getAllByRole('radio').map((r) => [r.textContent, r.getAttribute('aria-checked')])).toEqual([
      ['List', 'true'],
      ['Calendar', 'false'],
    ]);
    expect(screen.getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed')).toBe('false');
    expect(who()).toBe('Everyone');
  });

  it('the list: what needs attention first, then today, the next 7 days and later, across every room', async () => {
    await setup();
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
    // The late and urgent jobs are the first rows, each with its room.
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
    expect(groups[4].querySelector('p')!.textContent).toBe('All in good shape.');
  });

  it('says each row’s urgency, when, its room and who to assistive tech', async () => {
    await setup();
    // jsdom's name computation may put a space before the comma.
    const heaters = screen.getByRole('button', { name: /^Heaters not working ?, Urgent, 2 days late, Hallway, Shea, has a note\.$/ });
    expect(heaters.hasAttribute('data-item-open')).toBe(true);
    // On screen: the urgency in words, not only as a colour.
    expect(within(heaters).getByText('Urgent')).toBeTruthy();
    // The ring keeps its name.
    expect(screen.getByRole('button', { name: 'Mark Heaters not working as done' })).toBeTruthy();
  });

  it('Looking after never says all is well while something looked after needs work', async () => {
    const { home } = await setup();
    const bathroom = home().data!.areas.find((a) => a.name === 'Bathroom Large')!;
    await act(async () => {
      await home().createItem({
        area_id: bathroom.id,
        kind: 'state',
        title: 'Grout',
        note: '',
        good: '',
        rag: 'red',
        due_date: null,
        assignee_id: null,
        repeat: 'none',
        notify: 'none',
      });
    });
    const group = (id: string) => document.querySelector<HTMLElement>(`section[data-group="${id}"]`)!;
    // It comes with the next load.
    await waitFor(() => expect(within(group('attention')).getByRole('button', { name: /^Grout ?, to maintain, Needs work/ })).toBeTruthy());
    expect(group('looking').querySelector('p')!.textContent).toBe('1 needs work, under Needs attention.');
    expect(lookingAfterNote(0, false)).toBe('All in good shape.');
    expect(lookingAfterNote(0, true)).toBe('Keep an eye on anything marked Okay.');
    expect(lookingAfterNote(2, true)).toBe('2 need work, under Needs attention. Keep an eye on anything marked Okay.');
  });

  it('says where an item saved from the Calendar view went when the calendar can’t show it', () => {
    const task = { kind: 'task', due_date: null } as Parameters<typeof notOnCalendar>[0];
    expect(notOnCalendar(task, 'Hallway')).toBe('Saved in Hallway. It has no date, so it isn’t on the calendar.');
    expect(notOnCalendar({ ...task, kind: 'state' }, 'Garden')).toBe('Saved in Garden. Things looked after aren’t on the calendar.');
    expect(notOnCalendar(task, '')).toBe('Saved. It has no date, so it isn’t on the calendar.');
  });

  it('remembers the view on this device, and moves between views with the arrow keys', async () => {
    await setup();
    const views = screen.getByRole('radiogroup', { name: 'View' });
    const radio = (name: string) => within(views).getByRole('radio', { name });
    fireEvent.click(radio('Calendar'));
    expect(localStorage.getItem(ATTENTION_VIEW_KEY)).toBe('calendar');
    expect(document.querySelector('[data-view="calendar"]')).toBeTruthy();
    radio('Calendar').focus();
    fireEvent.keyDown(views, { key: 'ArrowRight' });
    expect(radio('List').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radio('List'));
    // The list is the default: nothing stored.
    expect(localStorage.getItem(ATTENTION_VIEW_KEY)).toBeNull();
    fireEvent.keyDown(views, { key: 'End' });
    expect(radio('Calendar').getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(views, { key: 'Home' });
    expect(radio('List').getAttribute('aria-checked')).toBe('true');
    // Only the chosen one is in the tab order.
    expect(within(views).getAllByRole('radio').map((r) => r.tabIndex)).toEqual([0, -1]);
  });

  it('copes with storage that is broken or unreadable', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    try {
      await setup();
      expect(within(screen.getByRole('radiogroup', { name: 'View' })).getByRole('radio', { name: 'List' }).getAttribute('aria-checked')).toBe('true');
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      fireEvent.click(screen.getByRole('radio', { name: 'Calendar' }));
      expect(screen.getByRole('radio', { name: 'Calendar' }).getAttribute('aria-checked')).toBe('true');
      setItem.mockRestore();
    } finally {
      getItem.mockRestore();
    }
  });

  it('Mine is one tap: only your items, and the sentence says so; rows drop who they are for', async () => {
    const { home } = await setup();
    const me = home().data!.members.find((m) => m.id === home().me!.id)!;
    expect(document.querySelectorAll('[data-who]').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(screen.getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed')).toBe('true');
    expect(who()).toBe(`${me.name} (you)`);
    expect(summary()).toMatch(/^For you, /);
    const rows = Array.from(document.querySelectorAll('[data-item-open]'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.textContent).toContain(`, ${me.name}`);
    // Every row is yours: no need to say whose.
    expect(document.querySelectorAll('[data-who]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(who()).toBe('Everyone');
    expect(summary()).toMatch(/^2 things need attention/);
  });

  it('says plainly when the person chosen has nothing open', async () => {
    const { home } = await setup();
    await act(async () => {
      for (const item of home().data!.items.filter((it) => it.assignee_id === null)) await home().deleteItem(item.id);
    });
    chooseWho(/^Unassigned,/);
    await waitFor(() => expect(screen.getByText('Nothing unassigned right now.')).toBeTruthy());
    expect(summary()).toBe('Nothing unassigned to do. Everything open has someone on it.');
  });
});

describe('Needs attention after a save', () => {
  const NEW_TASK = {
    kind: 'task' as const,
    note: '',
    good: '',
    rag: 'green' as const,
    assignee_id: null,
    repeat: 'none' as const,
    notify: 'none' as const,
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(revealRow).mockClear();
  });

  /** The rows brought into view (revealRow(), measured in reveal.test.tsx). */
  function recordScrolls() {
    vi.mocked(revealRow).mockClear();
    return vi.mocked(revealRow).mock.calls;
  }

  /** The row of an item, by its id. */
  const rowOf = (id: string) => document.querySelector<HTMLElement>(`[data-item-id="${id}"]`);

  it('a new item deep in Later opens it; one for someone the filter hides shows everyone’s again', async () => {
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
        ...NEW_TASK,
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
    const later = document.querySelector<HTMLElement>('section[data-group="later"]')!;
    expect(within(later).getByRole('button', { name: 'Show fewer' })).toBeTruthy();
    expect(later.contains(rowOf(created.id))).toBe(true);
    expect(rowOf(created.id)!.hasAttribute('data-lit')).toBe(true);
    act(() => vi.advanceTimersByTime(100));
    // The whole row, clear of the round + and the tab bar, smoothly.
    expect(scrolled).toEqual([[rowOf(created.id)!, true]]);
    act(() => vi.advanceTimersByTime(3000));
    expect(rowOf(created.id)!.hasAttribute('data-lit')).toBe(false);
    vi.useRealTimers();
    // Everyone's for this visit only: Mine stays the choice this phone opens on.
    const me = home().me!.id;
    expect(localStorage.getItem(personFilterKey(home().data!.household.id))).toBe(me);
    expect(screen.getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed')).toBe('false');
    cleanup();
    await setup(storage);
    expect(screen.getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('Calendar: a saved item the calendar can’t show (no date, or looked after) says where it went', async () => {
    const { home, revealItem } = await setup(undefined, 'calendar');
    recordScrolls();
    const kitchen = home().data!.areas.find((a) => a.name === 'Kitchen')!;
    const save = async (over: Record<string, unknown>) => {
      let created!: { id: string };
      await act(async () => {
        created = await home().createItem({ ...NEW_TASK, area_id: kitchen.id, title: 'Find a plumber', due_date: null, ...over });
      });
      act(() => home().dismissToast());
      act(() => revealItem()(created.id));
      await act(async () => {});
      return home().toast?.message ?? null;
    };
    expect(await save({ rag: 'red' })).toBe('Saved in Kitchen. It has no date, so it isn’t on the calendar.');
    expect(await save({ kind: 'state', title: 'Grout', notify: 'none' })).toBe('Saved in Kitchen. Things looked after aren’t on the calendar.');
    // One with a date: the calendar goes to its day instead, and nothing needs saying.
    expect(await save({ due_date: '2026-10-20' })).toBeNull();
  });
});

describe('the calendar on Needs attention', () => {
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
