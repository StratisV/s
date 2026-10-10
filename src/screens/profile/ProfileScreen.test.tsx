import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { useEffect, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, type StorageLike } from '../../lib/backend/demo';
import { TEXT_LIMITS } from '../../lib/constants';
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
    expect((screen.getByLabelText('Your name') as HTMLInputElement).maxLength).toBe(TEXT_LIMITS.memberName);
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
    expect((screen.getByLabelText('Name') as HTMLInputElement).maxLength).toBe(TEXT_LIMITS.householdName);
    expect((screen.getByLabelText('Address') as HTMLInputElement).maxLength).toBe(TEXT_LIMITS.address);
    for (const field of screen.getAllByLabelText('Area name')) {
      expect((field as HTMLInputElement).maxLength).toBe(TEXT_LIMITS.areaName);
    }
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

describe('Household editor: areas', () => {
  it('keeps the last area: its delete button is off and a caption says why', async () => {
    const { home } = await setup();
    await openHousehold();
    const keep = home().data!.areas[0];
    await act(async () => {
      for (const area of home().data!.areas.slice(1)) await home().deleteArea(area.id);
    });
    await waitFor(() => expect(areaNames()).toEqual([keep.name]));

    const del = screen.getByRole('button', { name: `Delete ${keep.name}` }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    const caption = screen.getByText('Items live in an area, so keep at least one.');
    expect(del.getAttribute('aria-describedby')).toBe(caption.id);
    fireEvent.click(del);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(home().data!.areas).toHaveLength(1);

    // With a second area, both can be deleted again and the caption goes.
    fireEvent.click(screen.getByRole('button', { name: 'Add Area' }));
    await waitFor(() => expect(areaNames()).toHaveLength(2));
    expect((screen.getByRole('button', { name: `Delete ${keep.name}` }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('Items live in an area, so keep at least one.')).toBeNull();
  });

  it('does not delete the last area when the others went while the sheet was up', async () => {
    const { home } = await setup();
    await openHousehold();
    await act(async () => {
      for (const area of home().data!.areas.slice(2)) await home().deleteArea(area.id);
    });
    await waitFor(() => expect(areaNames()).toHaveLength(2));
    const [first, second] = home().data!.areas;
    fireEvent.click(screen.getByRole('button', { name: `Delete ${first.name}` }));
    const sheet = await screen.findByRole('alertdialog');
    // Another member deletes the other one meanwhile.
    await act(async () => {
      await home().deleteArea(second.id);
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete Area' }));
    await act(async () => {});
    expect(home().data!.areas.map((a) => a.id)).toEqual([first.id]);
  });
});

describe('Household editor: people', () => {
  async function openPerson(name: RegExp) {
    fireEvent.click(screen.getByRole('button', { name }));
    await screen.findByRole('heading', { level: 1, name: name });
    const back = screen.getByRole('button', { name: 'Household' });
    await waitFor(() => expect(document.activeElement).toBe(back));
    return back;
  }

  it('lists everyone, with your own row marked', async () => {
    await setup();
    await openHousehold();
    const people = screen.getByRole('region', { name: 'People' });
    const rows = within(people).getAllByRole('button');
    // Everyone in member order, then Add Person.
    expect(rows.map((r) => r.textContent)).toEqual(['🦔Stratis, You', '🦆Shea', '🦊Ela', 'Add Person']);
    // Avatars carry the member colour ring, as in the Stats legend.
    const avatar = rows[1].querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(avatar.style.boxShadow).toContain('#AF52DE');
  });

  it("edits another member's name and emoji", async () => {
    const { home } = await setup();
    await openHousehold();
    await openPerson(/^Shea/);
    const sheaId = home().data!.members.find((m) => m.name === 'Shea')!.id;
    const shea = () => home().data!.members.find((m) => m.id === sheaId)!;

    const page = screen.getByRole('heading', { level: 1, name: 'Shea' }).parentElement!;
    const name = within(page).getByLabelText('Name') as HTMLInputElement;
    expect(name.value).toBe('Shea');
    expect(name.maxLength).toBe(TEXT_LIMITS.memberName);
    expect(within(page).getByText('shea@example.com')).toBeTruthy();
    expect(within(page).getByText('Shown next to their name on items and in Stats.')).toBeTruthy();
    const grid = within(page).getByRole('radiogroup', { name: 'Emoji' });
    expect(within(grid).getByRole('radio', { name: '🦆' }).getAttribute('aria-checked')).toBe('true');

    edit(name, 'Shay');
    await waitFor(() => expect(shea().name).toBe('Shay'));
    fireEvent.click(within(grid).getByRole('radio', { name: '🐻' }));
    await waitFor(() => expect(shea().emoji).toBe('🐻'));
    // Only Shea changed.
    expect(home().me!.name).toBe('Stratis');
    expect(home().me!.emoji).toBe('🦔');
  });

  it('opens your own page too, and goes back to the row with Escape', async () => {
    const { home, onClose } = await setup();
    await openHousehold();
    await openPerson(/^Stratis/);
    const page = screen.getByRole('heading', { level: 1, name: 'Stratis' }).parentElement!;
    expect(within(page).getByRole('radiogroup', { name: 'Your emoji' })).toBeTruthy();
    expect(within(page).getByText('Shown next to your name on items and in Stats.')).toBeTruthy();
    fireEvent.click(within(page).getByRole('radio', { name: '🐳' }));
    await waitFor(() => expect(home().me!.emoji).toBe('🐳'));

    // The Household editor underneath can't be reached while the page is up.
    const editorLayer = screen.getByRole('heading', { level: 1, name: 'Household' }).closest('[data-shown]') as HTMLElement;
    expect(editorLayer.inert).toBe(true);

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: 'Stratis' })).toBeNull());
    expect(editorLayer.inert).toBe(false);
    expect(document.activeElement?.getAttribute('data-member-row')).toBe(home().me!.id);
    expect(screen.getByRole('heading', { level: 1, name: 'Household' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('goes back with the back button', async () => {
    await setup();
    await openHousehold();
    const back = await openPerson(/^Ela/);
    fireEvent.click(back);
    await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: 'Ela' })).toBeNull());
    expect(document.activeElement?.textContent).toBe('🦊Ela');
  });
});

describe('Profile focus', () => {
  /** What App does: the screen behind is inert while Profile is up, cleared in App's own effect. */
  function Stage() {
    const home = useHome();
    const [open, setOpen] = useState(false);
    const stageRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (stageRef.current) stageRef.current.inert = open;
    }, [open]);
    if (home.phase.kind !== 'ready' || !home.data) return null;
    return (
      <>
        <div ref={stageRef} data-testid="stage">
          <button type="button" onClick={() => setOpen(true)}>
            Avatar
          </button>
        </div>
        <ProfileScreen open={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  it('returns focus to the avatar once the screen behind is interactive again', async () => {
    const backend = new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 });
    render(
      <HomeProvider backend={backend}>
        <Stage />
      </HomeProvider>,
    );
    const avatar = await screen.findByRole('button', { name: 'Avatar' });
    const stage = screen.getByTestId('stage');
    const focusedWhileInert: boolean[] = [];
    const focus = avatar.focus.bind(avatar);
    avatar.focus = (options?: FocusOptions) => {
      focusedWhileInert.push(stage.inert);
      focus(options);
    };
    avatar.focus();
    fireEvent.click(avatar);
    const dialog = await screen.findByRole('dialog', { name: 'Profile' });
    await waitFor(() => expect(dialog.hasAttribute('data-shown')).toBe(true));
    expect(stage.inert).toBe(true);
    focusedWhileInert.length = 0;

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(avatar));
    expect(focusedWhileInert).toEqual([false]);
  });
});

describe('NavPage', () => {
  it('keeps keyboard focus clear of the frosted bar', () => {
    // jsdom doesn't apply CSS modules, so check the rule itself.
    const css = readFileSync(`${process.cwd()}/src/screens/profile/NavPage.module.css`, 'utf8');
    const scroll = css.match(/\.scroll \{[^}]*\}/)![0];
    expect(scroll).toContain('scroll-padding-top: calc(var(--top-inset) + var(--nav-row) + 8px);');
  });
});
