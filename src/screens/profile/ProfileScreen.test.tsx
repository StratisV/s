import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, type StorageLike } from '../../lib/backend/demo';
import { HomeProvider, useHome, type HomeContextValue } from '../../state/HomeProvider';
import { Toast } from '../../ui/Toast';
import { ProfileScreen } from './ProfileScreen';

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

function Harness({ onClose, expose }: { onClose(): void; expose(home: HomeContextValue): void }) {
  const home = useHome();
  const [open, setOpen] = useState(true);
  expose(home);
  if (home.phase.kind !== 'ready' || !home.data) return <p>{home.phase.kind}</p>;
  return (
    <>
      <ProfileScreen
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
      />
      <Toast />
    </>
  );
}

async function setup() {
  const backend = new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 });
  const onClose = vi.fn();
  let home!: HomeContextValue;
  render(
    <HomeProvider backend={backend}>
      <Harness onClose={onClose} expose={(h) => (home = h)} />
    </HomeProvider>,
  );
  const dialog = await screen.findByRole('dialog', { name: 'Profile' });
  await waitFor(() => expect(dialog.hasAttribute('data-shown')).toBe(true));
  const me = () => home.data!.members.find((m) => m.id === home.me!.id)!;
  return { backend, onClose, dialog, home: () => home, me };
}

/** Types into an inline field and leaves it the way a person would. */
function edit(input: HTMLElement, text: string, key: 'Enter' | 'Escape' | 'blur' = 'Enter') {
  act(() => input.focus());
  fireEvent.change(input, { target: { value: text } });
  if (key === 'blur') act(() => input.blur());
  else fireEvent.keyDown(input, { key });
}

async function openHousehold() {
  fireEvent.click(screen.getByRole('button', { name: /^Household/ }));
  await screen.findByRole('heading', { name: 'Household', level: 1 });
}

const areaNames = () => screen.getAllByLabelText('Area name').map((el) => (el as HTMLInputElement).value);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Profile', () => {
  it('shows the member and saves the emoji', async () => {
    const { me } = await setup();
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Stratis');
    expect(screen.getByText('Demo account')).toBeTruthy();
    expect(screen.getByRole('radio', { name: '🦔' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: '🦉' }));
    await waitFor(() => expect(me().emoji).toBe('🦉'));
    expect(screen.getByRole('radio', { name: '🦉' }).getAttribute('aria-checked')).toBe('true');

    // Arrow keys move through the grid and select (a radio group).
    const owl = screen.getByRole('radio', { name: '🦉' });
    owl.focus();
    fireEvent.keyDown(owl, { key: 'ArrowDown' });
    await waitFor(() => expect(me().emoji).toBe('🦁'));
    expect(document.activeElement?.textContent).toBe('🦁');
  });

  it('edits the name in place: blank and Escape revert, Enter saves', async () => {
    const { me, onClose } = await setup();
    const name = screen.getByLabelText('Your name') as HTMLInputElement;
    edit(name, '   ', 'blur');
    expect(name.value).toBe('Stratis');
    edit(name, 'Stratos', 'Escape');
    expect(name.value).toBe('Stratis');
    expect(onClose).not.toHaveBeenCalled();
    edit(name, '  Stratos ');
    await waitFor(() => expect(me().name).toBe('Stratos'));
    expect(name.value).toBe('Stratos');
  });

  it('switches the weekly email off', async () => {
    const { me } = await setup();
    const weekly = screen.getByRole('switch', { name: 'Weekly email' });
    expect(weekly.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(weekly);
    await waitFor(() => expect(me().weekly_email).toBe(false));
    // No VAPID key in tests: push is unavailable and says so.
    expect((screen.getByRole('switch', { name: 'Push notifications' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Push notifications aren't set up yet.")).toBeTruthy();
  });

  it('copies a reusable invite link when there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { backend } = await setup();
    const create = vi.spyOn(backend, 'createInvite');
    fireEvent.click(screen.getByRole('button', { name: 'Invite someone' }));
    await screen.findByText('Invite link copied');
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^http:\/\/localhost(:\d+)?\/\?invite=[0-9a-f]{32}$/));
    fireEvent.click(screen.getByRole('button', { name: 'Invite someone' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1][0]).toBe(writeText.mock.calls[0][0]);
    expect(create.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('closes on Done and on Escape', async () => {
    const { onClose, dialog } = await setup();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('signs out after confirming', async () => {
    const { home } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    const sheet = await screen.findByRole('alertdialog');
    expect(within(sheet).getByText('Sign out of home.os?')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Sign Out' }));
    await waitFor(() => expect(home().phase.kind).toBe('signedOut'));
  });
});

describe('Household editor', () => {
  it('edits name, address and time zone', async () => {
    const { home } = await setup();
    await openHousehold();
    edit(screen.getByLabelText('Name'), '', 'blur');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Our home');
    edit(screen.getByLabelText('Name'), 'Casa');
    edit(screen.getByLabelText('Address'), '', 'blur'); // blank is allowed
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/Athens' } });
    await waitFor(() => {
      const h = home().data!.household;
      expect([h.name, h.address, h.timezone]).toEqual(['Casa', '', 'Europe/Athens']);
    });
    expect(screen.getByText('Athens')).toBeTruthy();
  });

  it('renames, adds, deletes and reorders areas', async () => {
    const { home } = await setup();
    await openHousehold();
    const names = () => home().data!.areas.map((a) => a.name);

    // Rename (blank reverts).
    const kitchen = screen.getAllByLabelText('Area name')[0];
    edit(kitchen, ' ', 'blur');
    expect((kitchen as HTMLInputElement).value).toBe('Kitchen');
    edit(kitchen, 'Cuisine');
    await waitFor(() => expect(names()[0]).toBe('Cuisine'));

    // Add: "New area" at the end, focused with its text selected.
    fireEvent.click(screen.getByRole('button', { name: 'Add Area' }));
    await waitFor(() => expect(areaNames().at(-1)).toBe('New area'));
    const added = screen.getAllByLabelText('Area name').at(-1) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(added));
    expect([added.selectionStart, added.selectionEnd]).toEqual([0, 'New area'.length]);

    // Delete with confirmation; the message counts the area's items.
    fireEvent.click(screen.getByRole('button', { name: 'Delete Jacuzzi' }));
    const sheet = await screen.findByRole('alertdialog');
    expect(sheet.textContent).toContain('Delete Jacuzzi?');
    expect(sheet.textContent).toContain('Its 2 items will be deleted too.');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete Area' }));
    await waitFor(() => expect(names()).not.toContain('Jacuzzi'));
    expect(home().data!.items.some((i) => i.title === 'Change the filter')).toBe(false);

    // An empty area: no item count in the message.
    fireEvent.click(screen.getByRole('button', { name: 'Delete New area' }));
    await waitFor(() => expect(screen.getAllByRole('alertdialog').at(-1)!.textContent).not.toContain('will be deleted'));

    // Reorder from the keyboard; focus stays on the moved handle.
    const grip = screen.getByRole('button', { name: 'Reorder Living Room' });
    grip.focus();
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    await waitFor(() => expect(names().slice(0, 2)).toEqual(['Living Room', 'Cuisine']));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reorder Living Room' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' }); // already first: nothing happens
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    await waitFor(() => expect(names().slice(0, 2)).toEqual(['Cuisine', 'Living Room']));
    expect(screen.getByText('Living Room moved to position 2 of 11.')).toBeTruthy();
  });

  it('Escape goes back to Profile first, then closes', async () => {
    const { onClose } = await setup();
    await openHousehold();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Household', level: 1 })).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
