import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { DemoBackend, type StorageLike } from './lib/backend/demo';
import { HomeProvider } from './state/HomeProvider';
import { ConfettiProvider } from './ui/Confetti';

// The Housekeeping tab's calendar, price, checklist and byline functions are being built
// alongside the screen; until they land, the screen runs on stand-ins written from their
// specs (src/screens/housekeeping/testLogic.ts).
vi.mock('./lib/logic/housekeeping', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/logic/housekeeping')>()),
  ...(await import('./screens/housekeeping/testLogic')),
}));

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

async function setup(prepare?: (backend: DemoBackend) => Promise<void>) {
  const backend = new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 });
  await prepare?.(backend);
  render(
    <HomeProvider backend={backend}>
      <ConfettiProvider>
        <App />
      </ConfettiProvider>
    </HomeProvider>,
  );
  await screen.findByRole('heading', { name: 'Home', level: 1 });
  return backend;
}

/** The part of a Home row that opens the Item sheet. */
const rowButton = (title: string) => screen.getByText(title, { selector: '[data-item-open] *' }).closest('button')!;
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-item-open]'));

/** Focus `el` from the keyboard and activate it. */
async function openWith(el: HTMLElement, kind: 'Edit item' | 'New item' = 'Edit item') {
  act(() => el.focus());
  fireEvent.click(el);
  const sheet = await screen.findByRole('dialog', { name: kind });
  await waitFor(() => expect(sheet.hasAttribute('data-shown')).toBe(true));
  return sheet;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('focus after the Item sheet closes', () => {
  it('goes back to the row it was opened from', async () => {
    await setup();
    const row = rowButton('Olive oil');
    const sheet = await openWith(row);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.activeElement).toBe(row));

    await openWith(row);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it('goes back to the + button after a new item', async () => {
    await setup();
    const add = screen.getByRole('button', { name: 'New item' });
    const sheet = await openWith(add, 'New item');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.activeElement).toBe(add));
  });

  it('moves to the next row when the item was completed from the sheet', async () => {
    await setup();
    const row = rowButton('Heaters not working');
    const next = rows()[rows().indexOf(row) + 1];
    const sheet = await openWith(row);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Mark as Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit item' })).toBeNull(), { timeout: 2000 });
    expect(row.isConnected).toBe(false);
    expect(document.activeElement).toBe(next);
  });

  it('falls back to the area’s name when no rows are left', async () => {
    await setup(async (backend) => {
      const data = await backend.load((await backend.getMyHouseholdId())!);
      for (const item of data.items.filter((i) => i.title !== 'Olive oil')) await backend.deleteItem(item.id);
    });
    const sheet = await openWith(rowButton('Olive oil'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Item' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Kitchen', expanded: true })));
  });

  it('skips rows in collapsed areas', async () => {
    await setup(async (backend) => {
      const data = await backend.load((await backend.getMyHouseholdId())!);
      const kitchen = data.areas.find((a) => a.name === 'Kitchen')!.id;
      for (const area of data.areas.filter((a) => a.id !== kitchen && a.name !== 'Garden')) await backend.deleteArea(area.id);
    });
    // Garden collapsed: its rows can't take focus.
    fireEvent.click(screen.getByRole('button', { name: 'Garden', expanded: true }));
    const sheet = await openWith(rowButton('Olive oil'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Item' }));
    // Kitchen paper is left (above), not the Garden rows (below).
    await waitFor(() => expect(document.activeElement).toBe(rowButton('Kitchen paper')));
  });

  it('is left alone after a tap (no focus ring or scroll on touch)', async () => {
    await setup();
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':focus-visible' ? false : matches.call(this, selector);
    });
    const row = rowButton('Olive oil');
    const sheet = await openWith(row);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit item' })).toBeNull(), { timeout: 2000 });
    expect(document.activeElement).not.toBe(row);
  });
});

describe('adding an item from an area header', () => {
  it('opens the new-item sheet with that area chosen, and the item lands there', async () => {
    await setup();
    // The area's disclosure button is labelled with its name.
    const garden = screen.getByRole('button', { name: 'Garden' }).closest('section') as HTMLElement;
    const add = within(garden).getByRole('button', { name: 'Add item to Garden' });
    const sheet = await openWith(add, 'New item');
    const area = within(sheet).getByLabelText('Area') as HTMLSelectElement;
    expect(area.selectedOptions[0].textContent).toBe('Garden');
    fireEvent.change(within(sheet).getByLabelText('Title'), { target: { value: 'Rake the leaves' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(garden).getByText('Rake the leaves')).toBeTruthy());
    // Keyboard focus goes back to the + it came from.
    await waitFor(() => expect(document.activeElement).toBe(add));
  });
});

describe('tab bar', () => {
  const tabBar = () => screen.getByRole('navigation', { name: 'Tabs' });

  it('has Home, Chat, Housekeeping and Stats under the hero; the + is on Home and Stats only', async () => {
    await setup();
    await within(tabBar()).findByRole('button', { name: 'Chat, unread messages' });
    expect(
      within(tabBar())
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Home', 'Chat', 'Housekeeping', 'Stats']);
    // In the screen, right after the hero with the title on it.
    const home = screen.getByRole('region', { name: 'Home' });
    expect(home.contains(tabBar())).toBe(true);
    expect(within(home).getByRole('heading', { name: 'Home', level: 1 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New item' })).toBeTruthy();
    fireEvent.click(within(tabBar()).getByRole('button', { name: /^Chat/ }));
    await screen.findByRole('heading', { name: 'Chat', level: 1 });
    expect(screen.getByRole('region', { name: 'Chat' }).contains(tabBar())).toBe(true);
    expect(screen.queryByRole('button', { name: 'New item' })).toBeNull();
    fireEvent.click(within(tabBar()).getByRole('button', { name: 'Housekeeping' }));
    await screen.findByRole('heading', { name: 'Housekeeping', level: 1 });
    expect(screen.getByRole('region', { name: 'Housekeeping' }).contains(tabBar())).toBe(true);
    expect(within(tabBar()).getByRole('button', { name: 'Housekeeping' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: 'New item' })).toBeNull();
    fireEvent.click(within(tabBar()).getByRole('button', { name: 'Stats' }));
    await screen.findByRole('heading', { name: 'Stats', level: 1 });
    expect(screen.getByRole('button', { name: 'New item' })).toBeTruthy();
  });

  it('opens the task list from Housekeeping as a page sheet over the tab', async () => {
    await setup();
    fireEvent.click(within(tabBar()).getByRole('button', { name: 'Housekeeping' }));
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

  it('stays where it is while typing a message', async () => {
    await setup();
    fireEvent.click(within(tabBar()).getByRole('button', { name: /^Chat/ }));
    const field = await screen.findByRole('textbox', { name: 'Message' });
    act(() => field.focus());
    expect(tabBar().hasAttribute('aria-hidden')).toBe(false);
    expect(within(tabBar()).getByRole('button', { name: 'Home' })).toBeTruthy();
    act(() => field.blur());
  });
});
