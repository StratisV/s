// The Housekeeping tab with the real HomeProvider and the demo backend (?demo-seed=1), for
// what only shows when the two work together: a failed save that the provider takes back,
// and a visit deleted while the provider still shows it as pending.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, type StorageLike } from '../../lib/backend/demo';
import { BackendError } from '../../lib/backend/types';
import { HomeProvider, useHome } from '../../state/HomeProvider';
import { HousekeepingScreen } from './HousekeepingScreen';

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

/** Thu 8 Oct 2026, 10:00 in London (as in e2e): the seed's last visit is Thu 1 Oct. */
const NOW = new Date('2026-10-08T10:00:00+01:00');

let toast: string | null = null;

function Gate() {
  const home = useHome();
  toast = home.toast?.message ?? null;
  if (home.phase.kind !== 'ready' || !home.data) return null;
  return <HousekeepingScreen onOpenProfile={() => {}} onEditTasks={() => {}} />;
}

async function open() {
  const backend = new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 });
  render(
    <HomeProvider backend={backend}>
      <Gate />
    </HomeProvider>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Housekeeping' });
  const hid = (await backend.getMyHouseholdId())!;
  return { backend, hid };
}

const today = () => screen.getByRole('region', { name: 'Today' });
const day = (name: RegExp) => within(screen.getByRole('grid')).getByRole('button', { name });
const offline = () => new BackendError('network');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  toast = null;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Housekeeping with the provider', () => {
  it('keeps comments, the message and the price typed while offline, and saves them once back', async () => {
    const { backend, hid } = await open();
    const realLoad = backend.load.bind(backend);
    const load = vi.spyOn(backend, 'load').mockRejectedValue(offline());
    const save = vi.spyOn(backend, 'saveHousekeepingVisit').mockRejectedValue(offline());
    const setNote = vi.spyOn(backend, 'setHousekeepingNote').mockRejectedValue(offline());

    const comments = within(today()).getByRole('textbox', { name: 'Comments' }) as HTMLTextAreaElement;
    const words = 'Out of bin bags, the hoover bag is full and the boiler is making a noise again.';
    act(() => comments.focus());
    fireEvent.change(comments, { target: { value: words } });
    await act(async () => comments.blur());
    await waitFor(() => expect(toast).toBe('Couldn’t save. No connection.'));
    expect(comments.value).toBe(words);

    const message = screen.getByRole('textbox', { name: 'Message for the housekeeper' }) as HTMLTextAreaElement;
    const direction = 'Guests arrive Friday. Please do the spare room first, then change all the beds.';
    act(() => message.focus());
    fireEvent.change(message, { target: { value: direction } });
    await act(async () => message.blur());
    expect(message.value).toBe(direction);

    const price = within(today()).getByRole('textbox', { name: 'Price for the day' }) as HTMLInputElement;
    act(() => price.focus());
    fireEvent.change(price, { target: { value: '62.50' } });
    await act(async () => price.blur());
    expect(price.value).toBe('62.50');
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.getAllByText('Not saved.')).toHaveLength(3);
    expect([comments.value, message.value, price.value]).toEqual([words, direction, '62.50']);

    // Back online: Try again sends each of them.
    load.mockImplementation(realLoad);
    save.mockRestore();
    setNote.mockRestore();
    for (const what of ['the comments', 'the price', 'the message']) {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: `Try again to save ${what}` }));
      });
    }
    await waitFor(() => expect(screen.queryAllByText('Not saved.')).toHaveLength(0));
    const stored = (await realLoad(hid)).housekeeping;
    expect(stored.note.body).toBe(direction);
    expect(stored.visits.find((v) => v.visit_date === '2026-10-08')).toMatchObject({
      comments: words,
      price_pence: 6250,
    });
    expect([comments.value, message.value, price.value]).toEqual([words, direction, '62.50']);
  });

  it('Delete straight after "Add a visit" deletes the visit once it is stored', async () => {
    const { backend, hid } = await open();
    const realAdd = backend.addHousekeepingVisit.bind(backend);
    let landed!: () => void;
    const slow = new Promise<void>((resolve) => (landed = resolve));
    vi.spyOn(backend, 'addHousekeepingVisit').mockImplementation(async (...args) => {
      await slow;
      return realAdd(...args);
    });
    const del = vi.spyOn(backend, 'deleteHousekeepingVisit');

    fireEvent.click(day(/^Tuesday 6 October/));
    fireEvent.click(screen.getByRole('button', { name: 'Add a visit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Visit' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete the visit on Tue 6 Oct?' });
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Delete Visit' }));
    });
    expect(screen.getByText('No visit recorded.')).toBeTruthy();
    expect(del).not.toHaveBeenCalled();

    await act(async () => {
      landed();
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(del.mock.calls[0][0]).not.toMatch(/^pending:/);
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect((await backend.load(hid)).housekeeping.visits.some((v) => v.visit_date === '2026-10-06')).toBe(false);
    expect(toast).toBeNull();
    expect(screen.getByText('No visit recorded.')).toBeTruthy();
  });

  it('a tick taken back leaves no visit counted, and today can be deleted', async () => {
    const { backend, hid } = await open();
    const calendar = screen.getByRole('region', { name: 'Calendar' });
    expect(within(calendar).getByText('1 visit · £60.00')).toBeTruthy();
    const box = () => within(today()).getByRole('checkbox', { name: 'Change the bed sheets' });
    await act(async () => {
      fireEvent.click(box());
    });
    await waitFor(() => expect(within(calendar).getByText('2 visits · £60.00')).toBeTruthy());
    expect(screen.getByText("Today's visit")).toBeTruthy();
    await act(async () => {
      fireEvent.click(box());
    });
    await waitFor(() => expect(within(calendar).getByText('1 visit · £60.00')).toBeTruthy());
    expect(screen.getByText('Last visit Thu 1 Oct')).toBeTruthy();
    expect(day(/^Thursday 8 October/).getAttribute('aria-label')).toBe('Thursday 8 October, today');
    expect(day(/^Thursday 8 October/).hasAttribute('data-visit')).toBe(false);

    // Something recorded again: today's visit can be deleted for good.
    await act(async () => {
      fireEvent.click(box());
    });
    fireEvent.click(await within(today()).findByRole('button', { name: 'Delete Visit' }));
    const confirm = await screen.findByRole('alertdialog', { name: "Delete today's visit?" });
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Delete Visit' }));
    });
    await waitFor(async () =>
      expect((await backend.load(hid)).housekeeping.visits.some((v) => v.visit_date === '2026-10-08')).toBe(false),
    );
    expect((box() as HTMLInputElement).checked).toBe(false);
    expect(toast).toBeNull();
  });
});
