import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, type StorageLike } from '../../lib/backend/demo';
import { addDays } from '../../lib/logic/dates';
import { HomeProvider, useHome, type HomeContextValue } from '../../state/HomeProvider';
import { ConfettiProvider } from '../../ui/Confetti';
import type { ItemSheetTarget } from '../types';
import { ItemSheet } from './ItemSheet';

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

type PickTarget = (home: HomeContextValue) => ItemSheetTarget;

/** Mounts the sheet once the seeded demo household has loaded, like App does. */
function Harness({ pick, onClose, expose }: { pick: PickTarget; onClose(): void; expose(home: HomeContextValue): void }) {
  const home = useHome();
  const [open, setOpen] = useState(true);
  const [target, setTarget] = useState<ItemSheetTarget | null>(null);
  expose(home);
  const ready = home.phase.kind === 'ready' && !!home.data;
  useEffect(() => {
    if (ready && !target) setTarget(pick(home));
  }, [ready, target, home, pick]);
  if (!target) return null;
  return (
    <ItemSheet
      target={target}
      open={open}
      onClose={() => {
        setOpen(false);
        onClose();
      }}
      onExited={() => {}}
    />
  );
}

async function setup(pick: PickTarget) {
  const backend = new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 });
  const onClose = vi.fn();
  let home!: HomeContextValue;
  render(
    <HomeProvider backend={backend}>
      <ConfettiProvider>
        <Harness pick={pick} onClose={onClose} expose={(h) => (home = h)} />
      </ConfettiProvider>
    </HomeProvider>,
  );
  const dialog = await screen.findByRole('dialog');
  // Escape and swipe only work once the sheet has finished opening.
  await waitFor(() => expect(dialog.hasAttribute('data-shown')).toBe(true));
  return { backend, onClose, dialog, home: () => home };
}

const editing =
  (title: string): PickTarget =>
  (home) => ({ kind: 'edit', itemId: home.data!.items.find((i) => i.title === title)!.id });

const value = (label: string) => screen.getByText(label, { selector: 'label' }).parentElement!.querySelector('span')!.textContent;
const save = () => screen.getByRole('button', { name: 'Save' });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ItemSheet (edit)', () => {
  it('shows the item', async () => {
    const { dialog } = await setup(editing('Heaters not working'));
    expect(dialog.getAttribute('aria-label')).toBe('Edit item');
    expect((screen.getByLabelText('Title') as HTMLTextAreaElement).value).toBe('Heaters not working');
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('No heat since the weekend. Engineer needs booking.');
    expect((screen.getByRole('radio', { name: 'Red' }) as HTMLInputElement).checked).toBe(true);
    expect(value('Area')).toBe('Hallway');
    expect(value('Due')).toMatch(/ · 2 days late$/);
    expect(value('Assigned to')).toBe('🦆 Shea');
    expect(value('Repeat')).toBe('Never');
    expect(value('Notify')).toBe('1 day before');
    expect(screen.getByRole('button', { name: 'Mark as Done' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('saves only the changed fields', async () => {
    const { backend, onClose } = await setup(editing('Heaters not working'));
    const update = vi.spyOn(backend, 'updateItem');
    fireEvent.click(screen.getByRole('radio', { name: 'Green' }));
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'monthly' } });
    fireEvent.change(screen.getByLabelText('Due'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Heaters fixed  ' } });
    expect(value('Due')).toBe('None');
    expect(value('Repeat')).toBe('Monthly');
    fireEvent.click(save());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.any(String), {
      title: 'Heaters fixed',
      rag: 'green',
      due_date: null,
      repeat: 'monthly',
    });
  });

  it('closes straight away without changes', async () => {
    const { onClose } = await setup(editing('Olive oil'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks before discarding changes', async () => {
    const { onClose, backend } = await setup(editing('Olive oil'));
    const update = vi.spyOn(backend, 'updateItem');
    fireEvent.click(screen.getByRole('radio', { name: 'Red' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    const confirm = await screen.findByRole('alertdialog', { name: 'Discard your changes?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep Editing' }));
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole('radio', { name: 'Red' }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard Changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('deletes after confirming', async () => {
    const { backend, onClose } = await setup(editing('Olive oil'));
    const del = vi.spyOn(backend, 'deleteItem');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Item' }));
    expect(del).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('marks as done once, saving edits first, and closes after the burst', async () => {
    const { backend, onClose } = await setup(editing('Kitchen paper'));
    const update = vi.spyOn(backend, 'updateItem');
    const complete = vi.spyOn(backend, 'completeItem');
    fireEvent.click(screen.getByRole('radio', { name: 'Amber' }));
    const done = screen.getByRole('button', { name: 'Mark as Done' });
    fireEvent.click(done);
    fireEvent.click(done);
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(expect.any(String), { rag: 'amber' });
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(complete.mock.invocationCallOrder[0]);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), { timeout: 1500 });
  });

  it('closes when the item is removed elsewhere', async () => {
    const { onClose, home } = await setup(editing('Trim the hedges'));
    const id = home().data!.items.find((i) => i.title === 'Trim the hedges')!.id;
    await act(() => home().deleteItem(id));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('ItemSheet (new)', () => {
  it('starts from the defaults with Save disabled and no done/delete', async () => {
    const { dialog, home } = await setup(() => ({ kind: 'new' }));
    expect(dialog.getAttribute('aria-label')).toBe('New item');
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: 'Amber' }) as HTMLInputElement).checked).toBe(true);
    expect(value('Area')).toBe('Kitchen');
    expect((screen.getByLabelText('Due') as HTMLInputElement).value).toBe(addDays(home().today, 7));
    expect(value('Assigned to')).toBe('Unassigned');
    expect(value('Repeat')).toBe('Never');
    expect(value('Notify')).toBe('1 day before');
    expect(screen.queryByRole('button', { name: 'Mark as Done' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('preselects the area it was opened from', async () => {
    await setup((home) => ({ kind: 'new', areaId: home.data!.areas.find((a) => a.name === 'Garden')!.id }));
    expect(value('Area')).toBe('Garden');
  });

  it('needs a title, moves to the note on Enter and creates the item', async () => {
    const { backend, onClose, home } = await setup(() => ({ kind: 'new' }));
    const create = vi.spyOn(backend, 'createItem');
    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: '   ' } });
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(title, { target: { value: 'Fix the gate' } });
    expect((save() as HTMLButtonElement).disabled).toBe(false);

    title.focus();
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(document.activeElement).toBe(screen.getByLabelText('Note'));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Latch is loose. ' } });

    fireEvent.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const d = home().data!;
    expect(create).toHaveBeenCalledWith(d.household.id, {
      area_id: d.areas[0].id,
      title: 'Fix the gate',
      note: 'Latch is loose.',
      rag: 'amber',
      due_date: addDays(home().today, 7),
      assignee_id: null,
      repeat: 'none',
      notify: 'day_before',
    });
  });

  it('asks before discarding a started item, and not for an untouched one', async () => {
    const { onClose } = await setup(() => ({ kind: 'new' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Fix the gate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Discard this item?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard Changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();

    const second = await setup(() => ({ kind: 'new' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(second.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
