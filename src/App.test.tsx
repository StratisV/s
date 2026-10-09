import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { DemoBackend, type StorageLike } from './lib/backend/demo';
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
