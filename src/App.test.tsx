import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { DemoBackend, type StorageLike } from './lib/backend/demo';
import { todayIn } from './lib/logic/dates';
import { ATTENTION_VIEW_KEY } from './screens/home/NeedsAttentionScreen';
import { HomeProvider } from './state/HomeProvider';
import { ConfettiProvider } from './ui/Confetti';

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

function renderApp(backend: DemoBackend) {
  render(
    <HomeProvider backend={backend}>
      <ConfettiProvider>
        <App />
      </ConfettiProvider>
    </HomeProvider>,
  );
}

/** The app on the seeded household, opened on `tab` (Home unless said otherwise). */
async function setup(prepare?: (backend: DemoBackend) => Promise<void>, tab?: 'attention' | 'stats') {
  if (tab) localStorage.setItem('homeos.tab', tab);
  const backend = new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 });
  await prepare?.(backend);
  renderApp(backend);
  await screen.findByRole('heading', { name: tab === 'attention' ? 'Needs attention' : tab === 'stats' ? 'Stats' : 'Home', level: 1 });
  return backend;
}

const tabBar = () => screen.getByRole('navigation', { name: 'Tabs' });
const rows = (root: ParentNode = document) => Array.from(root.querySelectorAll<HTMLElement>('[data-item-open]'));
/** The part of a row that opens the Item sheet (its name starts with the title). */
function rowButton(title: string, root: ParentNode = document) {
  const row = rows(root).find((b) => (b.textContent ?? '').startsWith(`${title},`));
  if (!row) throw new Error(`No row ${title}`);
  return row;
}

/** An area's card on Home: the one button in its cell. */
function card(name: string) {
  const cell = Array.from(document.querySelectorAll<HTMLElement>('[data-area-grid] li')).find((li) =>
    (within(li).getByRole('button').getAttribute('aria-label') ?? '').startsWith(`${name},`),
  );
  if (!cell) throw new Error(`No card ${name}`);
  return within(cell).getByRole('button');
}

/** Focus `el` from the keyboard and activate it; resolves to the dialog it opens, once in place. */
async function openWith(el: HTMLElement, name: string = 'Edit item') {
  act(() => el.focus());
  fireEvent.click(el);
  const sheet = await screen.findByRole('dialog', { name });
  await waitFor(() => expect(sheet.hasAttribute('data-shown')).toBe(true));
  return sheet;
}

/** Opens an area's sheet from its card. */
const openArea = (name: string) => openWith(card(name), name);

/** Keyboard focus counts as keyboard focus (jsdom has no :focus-visible), or not. */
function focusVisible(visible: boolean) {
  const matches = Element.prototype.matches;
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
    return selector === ':focus-visible' ? visible : matches.call(this, selector);
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // The tab last open is kept per device: each test starts on Home, Needs attention on its list.
  localStorage.clear();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe('an area’s sheet', () => {
  it('opens from its card over Home, which is pushed back and out of reach', async () => {
    await setup();
    const sheet = await openArea('Garden');
    expect(within(sheet).getByRole('heading', { level: 1, name: 'Garden' })).toBeTruthy();
    const inert = (el: HTMLElement | null): boolean => !!el && (el.inert || inert(el.parentElement));
    expect(inert(screen.getByRole('region', { name: 'Home', hidden: true }))).toBe(true);
    expect(inert(screen.getByRole('navigation', { name: 'Tabs', hidden: true }))).toBe(true);
    expect(document.documentElement.hasAttribute('data-sheet')).toBe(true);
  });

  it('a row opens its item over the sheet; Escape closes only the item, and focus goes back to the row', async () => {
    const errors = vi.spyOn(console, 'error');
    await setup();
    focusVisible(true);
    const area = await openArea('Kitchen');
    const row = rowButton('Olive oil', area);
    const item = await openWith(row);
    // The area's sheet steps back under the item's, out of reach.
    expect(area.hasAttribute('data-behind')).toBe(true);
    expect(area.inert).toBe(true);
    // Both sheets are there at once, each with its own key (both count from 1).
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit item' })).toBeNull(), { timeout: 2000 });
    expect(screen.getByRole('dialog', { name: 'Kitchen' })).toBe(area);
    expect(area.hasAttribute('data-behind')).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(row));
    expect(item.isConnected).toBe(false);

    // Close too.
    const again = await openWith(row);
    fireEvent.click(within(again).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it('closing goes back to its card, however it was opened', async () => {
    await setup();
    const sheet = await openArea('Hallway');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Hallway' })).toBeNull(), { timeout: 2000 });
    expect(document.activeElement).toBe(card('Hallway'));
    expect(document.documentElement.hasAttribute('data-sheet')).toBe(false);
  });

  it('after a row is deleted, focus goes to the row beside it in the sheet', async () => {
    await setup();
    focusVisible(true);
    const area = await openArea('Kitchen');
    const item = await openWith(rowButton('Olive oil', area));
    fireEvent.click(within(item).getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Item' }));
    await waitFor(() => expect(document.activeElement).toBe(rowButton('Kitchen paper', area)), { timeout: 2000 });
  });

  it('with no row left, focus goes to the sheet’s To do heading', async () => {
    await setup(async (backend) => {
      const data = await backend.load((await backend.getMyHouseholdId())!);
      for (const item of data.items.filter((i) => i.title !== 'Olive oil')) await backend.deleteItem(item.id);
    });
    focusVisible(true);
    const area = await openArea('Kitchen');
    const item = await openWith(rowButton('Olive oil', area));
    fireEvent.click(within(item).getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Item' }));
    await waitFor(() => expect(document.activeElement).toBe(within(area).getByRole('heading', { level: 2, name: 'To do' })), {
      timeout: 2000,
    });
  });

  it('after a tap, closing the item leaves no ring on the row, and focus stays in the sheet', async () => {
    await setup();
    focusVisible(false);
    const area = await openArea('Kitchen');
    const row = rowButton('Olive oil', area);
    const item = await openWith(row);
    fireEvent.click(within(item).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit item' })).toBeNull(), { timeout: 2000 });
    expect(document.activeElement).not.toBe(row);
    expect(area.contains(document.activeElement)).toBe(true);
  });

  it('Add Item opens a new item in that area over the sheet, and it lands there', async () => {
    await setup();
    focusVisible(true);
    const area = await openArea('Garden');
    const add = within(area).getByRole('button', { name: 'Add item to Garden' });
    const sheet = await openWith(add, 'New item');
    const select = within(sheet).getByLabelText('Area') as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe('Garden');
    fireEvent.change(within(sheet).getByLabelText('Title'), { target: { value: 'Rake the leaves' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(area).getByRole('button', { name: /^Rake the leaves ?,/ })).toBeTruthy());
    // Keyboard focus goes back to the button it came from.
    await waitFor(() => expect(document.activeElement).toBe(add));
  });
});

describe('focus after the Item sheet closes', () => {
  it('goes back to the + button after a new item', async () => {
    await setup();
    const add = screen.getByRole('button', { name: 'New item' });
    const sheet = await openWith(add, 'New item');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.activeElement).toBe(add));
  });

  it('moves to the next row on Needs attention when the item was completed from the sheet', async () => {
    await setup(undefined, 'attention');
    focusVisible(true);
    // The list: the heaters are the first row, the gutters the next.
    const row = rowButton('Heaters not working');
    const next = rows()[rows().indexOf(row) + 1];
    expect(next).toBe(rowButton('Clear the gutters'));
    const sheet = await openWith(row);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Mark as Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit item' })).toBeNull(), { timeout: 2000 });
    expect(row.isConnected).toBe(false);
    expect(document.activeElement).toBe(next);
  });

  it('goes back to the row on Needs attention it was opened from', async () => {
    await setup(undefined, 'attention');
    focusVisible(true);
    const row = rowButton('Water the plants');
    await openWith(row);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(row));
  });
});

describe('a shared area link', () => {
  it('opens the area’s sheet over Home, from whichever tab was open, with its Add Item', async () => {
    let gardenId = '';
    await setup(async (backend) => {
      const householdId = (await backend.getMyHouseholdId())!;
      gardenId = (await backend.load(householdId)).areas.find((a) => a.name === 'Garden')!.id;
      localStorage.setItem('homeos.tab', 'stats');
      localStorage.setItem('homeos.link', JSON.stringify({ kind: 'area', id: gardenId, at: Date.now() }));
    }, 'stats');
    const sheet = await screen.findByRole('dialog', { name: 'Garden' });
    expect(sheet.querySelector('[data-area-sheet]')!.getAttribute('data-area-id')).toBe(gardenId);
    expect(within(tabBar()).getByRole('button', { name: 'Home', hidden: true }).getAttribute('aria-current')).toBe('page');
    await waitFor(() => expect(sheet.hasAttribute('data-shown')).toBe(true));
    // Adding from it adds to that area; the round + stays a plain one.
    const add = await openWith(within(sheet).getByRole('button', { name: 'Add item to Garden' }), 'New item');
    expect((within(add).getByLabelText('Area') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Garden');
    fireEvent.click(within(add).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New item' })).toBeNull(), { timeout: 2000 });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Garden' })).toBeNull(), { timeout: 2000 });
    expect(screen.getByRole('button', { name: 'New item' })).toBeTruthy();
    // Back on its card.
    expect(document.activeElement).toBe(card('Garden'));
  });
});

describe('tab bar', () => {
  it('has Home, Attention, Chat, Housekeeping and Stats at the foot; the + is on Home, Needs attention and Stats', async () => {
    await setup();
    await within(tabBar()).findByRole('button', { name: 'Chat, unread messages' });
    expect(
      within(tabBar())
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Home', '2Attention', 'Chat', 'Housekeeping', 'Stats']);
    // Beside the screen, not in it: one bar for every tab.
    const home = screen.getByRole('region', { name: 'Home' });
    expect(home.contains(tabBar())).toBe(false);
    expect(within(home).getByRole('heading', { name: 'Home', level: 1 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New item' })).toBeTruthy();
    fireEvent.click(within(tabBar()).getByRole('button', { name: /^Attention/ }));
    await screen.findByRole('heading', { name: 'Needs attention', level: 1 });
    expect(within(tabBar()).getByRole('button', { name: /^Attention/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'New item' })).toBeTruthy();
    fireEvent.click(within(tabBar()).getByRole('button', { name: /^Chat/ }));
    await screen.findByRole('heading', { name: 'Chat', level: 1 });
    expect(screen.queryByRole('button', { name: 'New item' })).toBeNull();
    fireEvent.click(within(tabBar()).getByRole('button', { name: /^Housekeeping/ }));
    await screen.findByRole('heading', { name: 'Housekeeping', level: 1 });
    expect(within(tabBar()).getByRole('button', { name: 'Housekeeping' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: 'New item' })).toBeNull();
    fireEvent.click(within(tabBar()).getByRole('button', { name: 'Stats' }));
    await screen.findByRole('heading', { name: 'Stats', level: 1 });
    expect(screen.getByRole('button', { name: 'New item' })).toBeTruthy();
    // Every tab keeps Profile in reach.
    expect(screen.getByRole('button', { name: 'Profile' })).toBeTruthy();
  });

  it('counts what needs attention on Attention, and follows it', async () => {
    const backend = await setup();
    expect(within(tabBar()).getByRole('button', { name: 'Attention, 2 items' })).toBeTruthy();
    const hid = (await backend.getMyHouseholdId())!;
    const heaters = (await backend.load(hid)).items.find((it) => it.title === 'Heaters not working')!;
    fireEvent.click(await screen.findByRole('button', { name: /^Hallway,/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Hallway' });
    fireEvent.click(within(sheet).getByRole('button', { name: `Mark ${heaters.title} as done` }));
    await waitFor(() => expect(within(tabBar()).getByRole('button', { name: 'Attention, 1 item', hidden: true })).toBeTruthy(), {
      timeout: 3000,
    });
  });

  it('Home’s sentence opens Needs attention', async () => {
    await setup();
    fireEvent.click(document.querySelector<HTMLElement>('[data-home-summary]')!);
    await screen.findByRole('heading', { name: 'Needs attention', level: 1 });
    expect(within(tabBar()).getByRole('button', { name: /^Attention/ }).getAttribute('aria-current')).toBe('page');
    expect(document.querySelector('[data-attention-summary]')!.textContent).toBe(
      '2 things need attention and 1 is due today. Everything else can wait.',
    );
  });

  it('opens the task list from Housekeeping as a page sheet over the tab', async () => {
    await setup();
    fireEvent.click(within(tabBar()).getByRole('button', { name: /^Housekeeping/ }));
    const edit = await screen.findByRole('button', { name: 'Edit task list' });
    act(() => edit.focus());
    fireEvent.click(edit);
    const sheet = await screen.findByRole('dialog', { name: 'Task list' });
    await waitFor(() => expect(sheet.hasAttribute('data-shown')).toBe(true));
    // The tab behind is pushed back and out of reach.
    const inert = (el: HTMLElement | null): boolean => !!el && (el.inert || inert(el.parentElement));
    expect(inert(screen.getByRole('region', { name: 'Housekeeping', hidden: true }))).toBe(true);
    expect(document.documentElement.hasAttribute('data-sheet')).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Task list' })).toBeNull());
    expect(document.documentElement.hasAttribute('data-sheet')).toBe(false);
  });

  it('shows a dot on Chat for unread messages until the chat has been seen', async () => {
    await setup();
    expect(await within(tabBar()).findByRole('button', { name: 'Chat, unread messages' })).toBeTruthy();
    fireEvent.click(within(tabBar()).getByRole('button', { name: /^Chat/ }));
    await screen.findByRole('log', { name: 'Messages' });
    await waitFor(() => expect(within(tabBar()).getByRole('button', { name: 'Chat' }).getAttribute('aria-current')).toBe('page'));
    fireEvent.click(within(tabBar()).getByRole('button', { name: 'Home' }));
    expect(within(tabBar()).getByRole('button', { name: 'Chat' })).toBeTruthy();
  });

  it('shows a dot on Housekeeping for a message from someone else until the tab has been open', async () => {
    const backend = await setup();
    const hk = await within(tabBar()).findByRole('button', { name: 'Housekeeping, new message' });
    expect(hk.querySelector('[data-dot]')!.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(hk);
    await screen.findByRole('heading', { name: 'Housekeeping', level: 1 });
    expect(within(tabBar()).getByRole('button', { name: 'Housekeeping' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(within(tabBar()).getByRole('button', { name: 'Home' }));
    await screen.findByRole('heading', { name: 'Home', level: 1 });
    expect(within(tabBar()).getByRole('button', { name: 'Housekeeping' })).toBeTruthy();

    // Your own message never gets a dot, nor does one you have seen.
    const hid = (await backend.getMyHouseholdId())!;
    await act(async () => {
      await backend.setHousekeepingNote(hid, 'Oven too, please.');
    });
    expect(within(tabBar()).getByRole('button', { name: 'Housekeeping' })).toBeTruthy();
  });

  it('opens on the tab last open on this device', async () => {
    await setup();
    fireEvent.click(within(tabBar()).getByRole('button', { name: /^Housekeeping/ }));
    await screen.findByRole('heading', { name: 'Housekeeping', level: 1 });
    expect(localStorage.getItem('homeos.tab')).toBe('housekeeping');
    cleanup();
    renderApp(new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 }));
    await screen.findByRole('heading', { name: 'Housekeeping', level: 1 });
    expect(within(tabBar()).getByRole('button', { name: 'Housekeeping' }).getAttribute('aria-current')).toBe('page');

    // Needs attention too.
    fireEvent.click(within(tabBar()).getByRole('button', { name: /^Attention/ }));
    await screen.findByRole('heading', { name: 'Needs attention', level: 1 });
    cleanup();
    renderApp(new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 }));
    await screen.findByRole('heading', { name: 'Needs attention', level: 1 });
  });

  it('after the task list closes, focus goes back to Edit, however it was opened', async () => {
    await setup();
    fireEvent.click(within(tabBar()).getByRole('button', { name: /^Housekeeping/ }));
    const edit = await screen.findByRole('button', { name: 'Edit task list' });
    // A tap (no keyboard focus on the button), as a VoiceOver double tap is too.
    fireEvent.click(edit);
    const sheet = await screen.findByRole('dialog', { name: 'Task list' });
    await waitFor(() => expect(sheet.hasAttribute('data-shown')).toBe(true));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(document.activeElement).toBe(edit));
  });

  it('stays where it is while typing a message', async () => {
    await setup();
    fireEvent.click(within(tabBar()).getByRole('button', { name: /^Chat/ }));
    const field = await screen.findByRole('textbox', { name: 'Message' });
    act(() => field.focus());
    expect(tabBar().hasAttribute('aria-hidden')).toBe(false);
    expect(within(tabBar()).getByRole('button', { name: 'Home' })).toBeTruthy();
    act(() => field.blur());
  });

  it('tells the toast whether the round + is there, so it can float clear of it', async () => {
    await setup();
    expect(document.documentElement.hasAttribute('data-add')).toBe(true);
    fireEvent.click(within(tabBar()).getByRole('button', { name: /^Chat/ }));
    await screen.findByRole('heading', { name: 'Chat', level: 1 });
    expect(document.documentElement.hasAttribute('data-add')).toBe(false);
  });
});

describe('a housekeeping visit on Needs attention’s calendar', () => {
  it('opens that day in Housekeeping, chosen, with focus on its heading', async () => {
    localStorage.setItem(ATTENTION_VIEW_KEY, 'calendar');
    await setup(undefined, 'attention');
    const calendar = document.querySelector<HTMLElement>('[data-calendar]')!;
    fireEvent.click(within(calendar).getByRole('button', { name: 'Show month' }));
    // The latest visit: this month, or the one before early in a month.
    const visits = () => Array.from(calendar.querySelectorAll<HTMLButtonElement>('[role="grid"] [data-visit]'));
    if (!visits().length) fireEvent.click(within(calendar).getByRole('button', { name: 'Previous month' }));
    const visitDay = visits()[visits().length - 1];
    const date = visitDay.getAttribute('data-date')!;
    const name = visitDay.getAttribute('aria-label')!.split(',')[0];
    fireEvent.click(visitDay);
    fireEvent.click(within(calendar).getByRole('button', { name: /^Housekeeping visit, \d of 7 done/ }));

    await screen.findByRole('heading', { name: 'Housekeeping', level: 1 });
    expect(within(tabBar()).getByRole('button', { name: 'Housekeeping' }).getAttribute('aria-current')).toBe('page');
    // In place of the Today section, under the calendar's week strip, with the day chosen there.
    const heading = await screen.findByRole('heading', { level: 2, name });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    const grid = within(screen.getByRole('region', { name: 'Housekeeping' })).getByRole('grid');
    const chosen = grid.querySelector<HTMLElement>(`[data-date="${date}"]`)!;
    expect(chosen.getAttribute('aria-label')).toMatch(/, selected$/);
    expect(within(heading.closest('section')!).getByText('Message that day')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Today' })).toBeNull();
  });
});

describe('today’s housekeeping visit on Needs attention’s calendar', () => {
  it('opens the Today section of Housekeeping', async () => {
    // jsdom has no scrolling.
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true });
    localStorage.setItem(ATTENTION_VIEW_KEY, 'calendar');
    await setup(async (backend) => {
      const hid = (await backend.getMyHouseholdId())!;
      const data = await backend.load(hid);
      const today = todayIn(data.household.timezone);
      await backend.setHousekeepingTaskDone(hid, today, { taskId: data.housekeeping.tasks[0].id }, true);
    }, 'attention');
    const calendar = document.querySelector<HTMLElement>('[data-calendar]')!;
    // Today is chosen at first and its list is open: the visit is in it.
    expect(within(calendar).getByRole('button', { name: /, today, .*selected$/ })).toBeTruthy();
    fireEvent.click(within(calendar).getByRole('button', { name: 'Housekeeping visit, 1 of 7 done. Show in Housekeeping' }));
    await screen.findByRole('heading', { name: 'Housekeeping', level: 1 });
    const heading = screen.getByRole('heading', { level: 2, name: 'Today' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(scrollIntoView.mock.contexts).toContain(heading);
    const housekeeping = screen.getByRole('region', { name: 'Housekeeping' });
    expect(within(housekeeping).getByRole('grid').querySelector('[data-today]')!.getAttribute('aria-label')).toMatch(
      /, today, visit, 1 of 7 done, selected$/,
    );
    expect(within(heading.closest('section')!).getByRole('group', { name: 'Tasks today' })).toBeTruthy();
  });
});

describe('a saved item, shown where it went', () => {
  it('saved from Home’s +: its area’s card lights up', async () => {
    Element.prototype.scrollIntoView = () => {};
    await setup();
    const add = screen.getByRole('button', { name: 'New item' });
    const sheet = await openWith(add, 'New item');
    fireEvent.change(within(sheet).getByLabelText('Area'), {
      target: { value: (within(sheet).getByRole('option', { name: 'Jacuzzi' }) as HTMLOptionElement).value },
    });
    fireEvent.change(within(sheet).getByLabelText('Title'), { target: { value: 'Top up the chlorine' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(card('Jacuzzi').closest('li')!.hasAttribute('data-lit')).toBe(true));
    expect(document.querySelectorAll('[data-area-grid] li[data-lit]')).toHaveLength(1);
  });
});
