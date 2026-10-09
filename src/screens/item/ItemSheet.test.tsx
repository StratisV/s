import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, type StorageLike } from '../../lib/backend/demo';
import { BackendError } from '../../lib/backend/types';
import { TEXT_LIMITS } from '../../lib/constants';
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
function Harness({
  pick,
  onClose,
  onSaved,
  expose,
}: {
  pick: PickTarget;
  onClose(): void;
  onSaved(areaId: string): void;
  expose(home: HomeContextValue): void;
}) {
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
      onSaved={onSaved}
    />
  );
}

async function setup(pick: PickTarget, prepare?: (backend: DemoBackend) => Promise<void>) {
  const backend = new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 });
  await prepare?.(backend);
  const onClose = vi.fn();
  const onSaved = vi.fn();
  let home!: HomeContextValue;
  render(
    <HomeProvider backend={backend}>
      <ConfettiProvider>
        <Harness pick={pick} onClose={onClose} onSaved={onSaved} expose={(h) => (home = h)} />
      </ConfettiProvider>
    </HomeProvider>,
  );
  const dialog = await screen.findByRole('dialog');
  // Escape and swipe only work once the sheet has finished opening.
  await waitFor(() => expect(dialog.hasAttribute('data-shown')).toBe(true));
  return { backend, onClose, onSaved, dialog, home: () => home };
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
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe(
      'No heat since the weekend. Engineer needs booking.',
    );
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
    expect(update).toHaveBeenCalledWith(expect.any(String), {
      title: 'Heaters fixed',
      rag: 'green',
      due_date: null,
      repeat: 'monthly',
    });
    // It closes once the change is saved.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps the sheet and the draft when the change is not saved', async () => {
    const { backend, onClose, home } = await setup(editing('Heaters not working'));
    const update = vi.spyOn(backend, 'updateItem').mockRejectedValue(new BackendError('network'));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Heaters fixed' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Green' }));
    fireEvent.click(save());
    expect(save().getAttribute('aria-busy')).toBe('true');
    await waitFor(() => expect(save().getAttribute('aria-busy')).toBeNull());
    expect(update).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Title') as HTMLTextAreaElement).value).toBe('Heaters fixed');
    expect((screen.getByRole('radio', { name: 'Green' }) as HTMLInputElement).checked).toBe(true);
    expect((save() as HTMLButtonElement).disabled).toBe(false);
    // Home shows the item as it was, and a toast says why.
    expect(home().data!.items.find((i) => i.id === update.mock.calls[0][0])).toMatchObject({
      title: 'Heaters not working',
      rag: 'red',
    });
    expect(home().toast?.message).toBe('Couldn’t save. No connection.');

    // Back online: the same Save goes through.
    update.mockRestore();
    fireEvent.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(home().data!.items.some((i) => i.title === 'Heaters fixed')).toBe(true);
  });

  it('limits the title and note length', async () => {
    await setup(editing('Olive oil'));
    const title = screen.getByLabelText('Title') as HTMLTextAreaElement;
    const note = screen.getByLabelText('Note') as HTMLTextAreaElement;
    expect(title.maxLength).toBe(TEXT_LIMITS.itemTitle);
    expect(note.maxLength).toBe(TEXT_LIMITS.itemNote);
    fireEvent.change(title, { target: { value: 'x'.repeat(TEXT_LIMITS.itemTitle + 50) } });
    fireEvent.change(note, { target: { value: 'y'.repeat(TEXT_LIMITS.itemNote + 50) } });
    expect(title.value).toHaveLength(TEXT_LIMITS.itemTitle);
    expect(note.value).toHaveLength(TEXT_LIMITS.itemNote);
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

  it('stays open with the edits when Mark as Done cannot save them', async () => {
    const { backend, onClose, home } = await setup(editing('Kitchen paper'));
    vi.spyOn(backend, 'updateItem').mockRejectedValue(new BackendError('network'));
    const complete = vi.spyOn(backend, 'completeItem');
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Two packs.' } });
    const done = screen.getByRole('button', { name: 'Mark as Done' });
    fireEvent.click(done);
    await waitFor(() => expect(done.getAttribute('aria-disabled')).toBeNull());
    await new Promise((r) => setTimeout(r, 800));
    expect(onClose).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('Two packs.');
    expect(home().toast?.message).toBe('Couldn’t save. No connection.');
  });

  it('stays open and keeps the item when completing fails', async () => {
    const { backend, onClose, home } = await setup(editing('Olive oil'));
    vi.spyOn(backend, 'completeItem').mockRejectedValue(new BackendError('network'));
    const done = screen.getByRole('button', { name: 'Mark as Done' });
    fireEvent.click(done);
    await waitFor(() => expect(done.getAttribute('aria-disabled')).toBeNull());
    await new Promise((r) => setTimeout(r, 800));
    expect(onClose).not.toHaveBeenCalled();
    expect(home().data!.items.some((i) => i.title === 'Olive oil')).toBe(true);
    expect(home().toast?.message).toBe('Couldn’t save. No connection.');
  });

  it('saves edits made before a failed completion only once', async () => {
    const { backend, onClose } = await setup(editing('Olive oil'));
    vi.spyOn(backend, 'completeItem').mockRejectedValue(new BackendError('network'));
    const update = vi.spyOn(backend, 'updateItem');
    fireEvent.click(screen.getByRole('radio', { name: 'Red' }));
    const done = screen.getByRole('button', { name: 'Mark as Done' });
    fireEvent.click(done);
    await waitFor(() => expect(done.getAttribute('aria-disabled')).toBeNull());
    expect(update).toHaveBeenCalledTimes(1);
    // The edit is saved now, so closing does not ask to discard it.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
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

  it('explains why Save stays disabled when there is no area', async () => {
    await setup(
      () => ({ kind: 'new' }),
      async (backend) => {
        const data = await backend.load((await backend.getMyHouseholdId())!);
        for (const a of data.areas) await backend.deleteArea(a.id);
      },
    );
    expect(value('Area')).toBe('None');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Buy bulbs' } });
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    const caption = screen.getByText('Items live in an area. Add one in Profile, under Household.');
    expect(save().getAttribute('aria-describedby')).toBe(caption.id);
  });

  it('has no area caption when there are areas', async () => {
    await setup(() => ({ kind: 'new' }));
    expect(screen.queryByText(/Items live in an area/)).toBeNull();
    expect(save().hasAttribute('aria-describedby')).toBe(false);
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
      kind: 'task',
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

describe('ItemSheet: To do and To maintain', () => {
  const kind = (name: 'To do' | 'To maintain') => screen.getByRole('radio', { name });
  const label = (text: string) => screen.queryByText(text, { selector: 'label' });

  it('offers the two kinds under the title and note, above the RAG picker; To do by default', async () => {
    const { dialog } = await setup(() => ({ kind: 'new' }));
    const group = screen.getByRole('radiogroup', { name: 'Type' });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['To do', 'To maintain']);
    expect(kind('To do').getAttribute('aria-checked')).toBe('true');
    expect(kind('To maintain').getAttribute('aria-checked')).toBe('false');
    // Order in the sheet: note, kind, RAG picker, details.
    const order = [screen.getByLabelText('Note'), group, screen.getByRole('radiogroup', { name: 'Status' }), screen.getByLabelText('Area')];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(dialog.getAttribute('aria-label')).toBe('New item');
  });

  it('edits a state: no Due, Repeat, Notify or Mark as Done, and "Looked after by"', async () => {
    await setup(editing('Firepit'));
    expect(kind('To maintain').getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('radio', { name: 'Green' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByRole('radio', { name: /^(Red|Amber|Green)$/ }).map((r) => (r as HTMLInputElement).value)).toEqual([
      'red',
      'amber',
      'green',
    ]);
    expect(value('Area')).toBe('Garden');
    expect(value('Looked after by')).toBe('🦊 Ela');
    for (const gone of ['Due', 'Assigned to', 'Repeat', 'Notify']) expect(label(gone), gone).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark as Done' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('saves edits to a state without any due date, repeat or reminder', async () => {
    const { backend, onClose } = await setup(editing('Firepit'));
    const update = vi.spyOn(backend, 'updateItem');
    fireEvent.click(screen.getByRole('radio', { name: 'Amber' }));
    fireEvent.change(screen.getByLabelText('Looked after by'), { target: { value: '' } });
    fireEvent.click(save());
    expect(update).toHaveBeenCalledWith(expect.any(String), { rag: 'amber', assignee_id: null });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('creates a To maintain item without a due date, repeat or reminder', async () => {
    const { backend, onClose, home } = await setup(() => ({ kind: 'new' }));
    const create = vi.spyOn(backend, 'createItem');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Jacuzzi' } });
    fireEvent.click(kind('To maintain'));
    expect(kind('To maintain').getAttribute('aria-checked')).toBe('true');
    for (const gone of ['Due', 'Repeat', 'Notify']) expect(label(gone), gone).toBeNull();
    expect(value('Looked after by')).toBe('Unassigned');
    fireEvent.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const d = home().data!;
    expect(create).toHaveBeenCalledWith(d.household.id, {
      area_id: d.areas[0].id,
      kind: 'state',
      title: 'Jacuzzi',
      note: '',
      rag: 'amber',
      due_date: null,
      assignee_id: null,
      repeat: 'none',
      notify: 'none',
    });
    expect(home().data!.items.find((i) => i.title === 'Jacuzzi')).toMatchObject({ kind: 'state', due_date: null });
  });

  it('switching back to To do brings the rows back as they were, and is not a change', async () => {
    const { onClose } = await setup(editing('Mirror lights not level'));
    const dueBefore = value('Due');
    fireEvent.click(kind('To maintain'));
    expect(label('Due')).toBeNull();
    expect(value('Looked after by')).toBe('Unassigned');
    fireEvent.click(kind('To do'));
    expect(value('Due')).toBe(dueBefore);
    expect(value('Assigned to')).toBe('Unassigned');
    expect(value('Notify')).toBe('1 day before');
    expect(screen.getByRole('button', { name: 'Mark as Done' })).toBeTruthy();
    // Nothing changed, so Close does not ask.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('turns a To do into a To maintain, dropping its due date and reminder', async () => {
    const { backend, onClose, home } = await setup(editing('Kitchen paper'));
    const update = vi.spyOn(backend, 'updateItem');
    fireEvent.click(kind('To maintain'));
    fireEvent.click(save());
    expect(update).toHaveBeenCalledWith(expect.any(String), {
      kind: 'state',
      due_date: null,
      repeat: 'none',
      notify: 'none',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(home().data!.items.find((i) => i.title === 'Kitchen paper')).toMatchObject({
      kind: 'state',
      due_date: null,
      repeat: 'none',
      notify: 'none',
    });
  });

  it('turns a state into a To do with the new-item due date and reminder, and can then mark it done', async () => {
    const { backend, home } = await setup(editing('Firepit'));
    const update = vi.spyOn(backend, 'updateItem');
    const complete = vi.spyOn(backend, 'completeItem');
    fireEvent.click(kind('To do'));
    expect((screen.getByLabelText('Due') as HTMLInputElement).value).toBe(addDays(home().today, 7));
    expect(value('Assigned to')).toBe('🦊 Ela');
    expect(value('Repeat')).toBe('Never');
    expect(value('Notify')).toBe('1 day before');
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Done' }));
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(expect.any(String), {
      kind: 'task',
      due_date: addDays(home().today, 7),
      notify: 'day_before',
    });
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(complete.mock.invocationCallOrder[0]);
    await waitFor(() => expect(home().data!.items.some((i) => i.title === 'Firepit')).toBe(false));
  });
});

describe('ItemSheet: where it was saved', () => {
  it('reports the area of a new item, and of an item moved to another area', async () => {
    const created = await setup((home) => ({ kind: 'new', areaId: home.data!.areas.find((a) => a.name === 'Garden')!.id }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Fix the gate' } });
    fireEvent.click(save());
    await waitFor(() => expect(created.onClose).toHaveBeenCalledTimes(1));
    const garden = created.home().data!.areas.find((a) => a.name === 'Garden')!.id;
    expect(created.onSaved).toHaveBeenCalledWith(garden);
    cleanup();

    const moved = await setup(editing('Heaters not working'));
    const kitchen = moved.home().data!.areas.find((a) => a.name === 'Kitchen')!.id;
    fireEvent.change(screen.getByLabelText('Area'), { target: { value: kitchen } });
    fireEvent.click(save());
    await waitFor(() => expect(moved.onClose).toHaveBeenCalledTimes(1));
    expect(moved.onSaved).toHaveBeenCalledWith(kitchen);
  });

  it('says nothing for an edit that stays in its area', async () => {
    const { onClose, onSaved } = await setup(editing('Heaters not working'));
    fireEvent.click(screen.getByRole('radio', { name: 'Green' }));
    fireEvent.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('ItemSheet: kind changed by someone else while open', () => {
  const kind = (name: 'To do' | 'To maintain') => screen.getByRole('radio', { name });

  it('follows a change to To maintain: no Mark as Done, and nothing to save here', async () => {
    const { home, backend, onClose } = await setup(editing('Trim the hedges'));
    const complete = vi.spyOn(backend, 'completeItem');
    expect(screen.getByRole('button', { name: 'Mark as Done' })).toBeTruthy();
    const id = home().data!.items.find((i) => i.title === 'Trim the hedges')!.id;
    await act(() => home().updateItem(id, { kind: 'state' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark as Done' })).toBeNull());
    expect(kind('To maintain').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByLabelText('Due')).toBeNull();
    expect(screen.getByText('Looked after by', { selector: 'label' })).toBeTruthy();
    // Nothing was changed here: it closes without asking, and nothing is completed.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
  });

  it('follows a change to To do, with the due date it was given', async () => {
    const { home, onClose } = await setup(editing('Firepit'));
    expect(screen.queryByRole('button', { name: 'Mark as Done' })).toBeNull();
    const id = home().data!.items.find((i) => i.title === 'Firepit')!.id;
    const due = addDays(home().today, 3);
    await act(() => home().updateItem(id, { kind: 'task', due_date: due, repeat: 'weekly', notify: 'same_day' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark as Done' })).toBeTruthy());
    expect(kind('To do').getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText('Due') as HTMLInputElement).value).toBe(due);
    expect(value('Repeat')).toBe('Weekly');
    expect(value('Notify')).toBe('On the day');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps a type chosen here', async () => {
    const { home } = await setup(editing('Trim the hedges'));
    fireEvent.click(kind('To maintain'));
    fireEvent.click(kind('To do'));
    fireEvent.click(kind('To maintain'));
    const id = home().data!.items.find((i) => i.title === 'Trim the hedges')!.id;
    // Someone else made it a state too: the sheet stays as chosen.
    await act(() => home().updateItem(id, { kind: 'state' }));
    expect(kind('To maintain').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Mark as Done' })).toBeNull();
  });
});
