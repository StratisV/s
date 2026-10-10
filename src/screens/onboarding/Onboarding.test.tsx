import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DemoBackend, DEMO_STORAGE_KEY, DEMO_USER, type StorageLike } from '../../lib/backend/demo';
import { BackendError } from '../../lib/backend/types';
import { DEFAULT_ADDRESS, DEFAULT_AREAS, TEXT_LIMITS } from '../../lib/constants';
import type { PushState } from '../../lib/push';
import { HomeProvider, useHome } from '../../state/HomeProvider';
import { Toast } from '../../ui/Toast';
import { Onboarding } from './Onboarding';

// push.ts talks to the browser; the steps only need its answers.
const push = vi.hoisted(() => ({
  state: 'unsupported' as PushState,
  enablePush: vi.fn<(backend: unknown, memberId: string) => Promise<boolean>>(),
  disablePush: vi.fn(async () => {}),
}));
vi.mock('../../lib/push', () => ({
  PUSH_CONFIGURED: true,
  isIOS: () => false,
  isStandalone: () => false,
  pushState: () => push.state,
  enablePush: push.enablePush,
  disablePush: push.disablePush,
}));

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

/** What App does: Onboarding until the household is ready and the last step is done. */
function Gate() {
  const { phase, onboardingTail } = useHome();
  if (phase.kind === 'loading') return null;
  if (phase.kind === 'ready' && !onboardingTail) return <p>Main app</p>;
  return <Onboarding />;
}

function renderApp(backend: DemoBackend) {
  return render(
    <HomeProvider backend={backend}>
      <Gate />
      <Toast />
    </HomeProvider>,
  );
}

let storage: MemoryStorage;
const demo = (user = DEMO_USER) => new DemoBackend({ storage, latency: 0, search: '', user });

beforeEach(() => {
  storage = new MemoryStorage();
  push.state = 'unsupported';
  push.enablePush.mockReset();
  push.disablePush.mockClear();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => cleanup());

async function signInToProfile() {
  fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
  await screen.findByRole('heading', { name: 'Your profile' });
}

describe('Onboarding', () => {
  it('signs in, creates a profile and a home with the current list, then finishes', async () => {
    const backend = demo();
    renderApp(backend);

    expect(await screen.findByRole('heading', { name: 'home.os' })).toBeTruthy();
    expect(screen.getByText('Demo mode: your data stays on this device.')).toBeTruthy();
    await signInToProfile();

    const name = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(name.value).toBe('Stratis');
    expect(name.maxLength).toBe(TEXT_LIMITS.memberName);
    const cont = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    fireEvent.change(name, { target: { value: '   ' } });
    expect(cont.disabled).toBe(true);
    fireEvent.change(name, { target: { value: ' Stratis ' } });
    expect(cont.disabled).toBe(false);
    fireEvent.click(screen.getByRole('radio', { name: '🦊' }));
    expect(screen.getByRole('radio', { name: '🦊' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(cont);

    await screen.findByRole('heading', { name: 'Your home' });
    expect(screen.getAllByRole('textbox', { name: 'Area name' }).map((i) => (i as HTMLInputElement).value)).toEqual(
      DEFAULT_AREAS,
    );
    expect((screen.getByRole('textbox', { name: 'Address' }) as HTMLInputElement).placeholder).toBe(DEFAULT_ADDRESS);
    // The same limits as the Household editor (and the database).
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).maxLength).toBe(TEXT_LIMITS.householdName);
    expect((screen.getByRole('textbox', { name: 'Address' }) as HTMLInputElement).maxLength).toBe(TEXT_LIMITS.address);
    for (const field of screen.getAllByRole('textbox', { name: 'Area name' })) {
      expect((field as HTMLInputElement).maxLength).toBe(TEXT_LIMITS.areaName);
    }
    fireEvent.change(screen.getByRole('textbox', { name: 'Address' }), { target: { value: '1 Test Street' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Jacuzzi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Area' }));
    const fields = screen.getAllByRole('textbox', { name: 'Area name' });
    fireEvent.change(fields[fields.length - 1], { target: { value: 'Garage' } });
    expect(screen.getByRole('switch', { name: 'Start with our current list' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Create Home' }));

    await screen.findByRole('heading', { name: 'You’re all set' });
    const hid = await backend.getMyHouseholdId();
    const data = await backend.load(hid!);
    expect(data.household.name).toBe('Our home');
    expect(data.household.address).toBe('1 Test Street');
    expect(data.areas.map((a) => a.name)).toEqual([...DEFAULT_AREAS.filter((a) => a !== 'Jacuzzi'), 'Garage']);
    // 14 items on the list (13 to-dos and the Firepit), 2 of them in the Jacuzzi.
    expect(data.items).toHaveLength(12);
    expect(data.members[0]).toMatchObject({ name: 'Stratis', emoji: '🦊', role: 'owner' });

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Main app')).toBeTruthy();
    expect(push.enablePush).not.toHaveBeenCalled();
  });

  it('says so once when coming back from a failed Google sign-in', async () => {
    const backend = demo();
    const take = vi.spyOn(backend, 'takeAuthError').mockReturnValueOnce('The user denied access');
    renderApp(backend);
    expect(await screen.findByText("Couldn't sign in with Google. Try again.")).toBeTruthy();
    expect(take).toHaveBeenCalled();
    // Taken once: it isn't shown again when Welcome comes back.
    await signInToProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    await screen.findByRole('button', { name: 'Continue with Google' });
    expect(take).toHaveLastReturnedWith(null);
  });

  it('shows no toast on Welcome after a normal visit', async () => {
    renderApp(demo());
    await screen.findByRole('button', { name: 'Continue with Google' });
    expect(screen.queryByText("Couldn't sign in with Google. Try again.")).toBeNull();
  });

  it('starts empty when the current list is switched off, and needs at least one area', async () => {
    const backend = demo();
    renderApp(backend);
    await signInToProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Your home' });

    for (const area of DEFAULT_AREAS) fireEvent.click(screen.getByRole('button', { name: `Remove ${area}` }));
    expect((screen.getByRole('button', { name: 'Create Home' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe('Add at least one area.');

    fireEvent.click(screen.getByRole('button', { name: 'Add Area' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Area name' }), { target: { value: 'Kitchen' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Start with our current list' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'The flat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Home' }));

    await screen.findByRole('heading', { name: 'You’re all set' });
    const data = await backend.load((await backend.getMyHouseholdId())!);
    expect(data.household.name).toBe('The flat');
    expect(data.areas.map((a) => a.name)).toEqual(['Kitchen']);
    expect(data.items).toEqual([]);
  });

  it('keeps the profile when going back from the household step, and signs out from the profile', async () => {
    renderApp(demo());
    await signInToProfile();
    fireEvent.click(screen.getByRole('radio', { name: '🐻' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Your home' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { name: 'Your profile' });
    expect(screen.getByRole('radio', { name: '🐻' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    await screen.findByRole('button', { name: 'Continue with Google' });
    expect(push.disablePush).toHaveBeenCalled();
    // Signing in again starts over.
    await signInToProfile();
    expect(screen.getByRole('radio', { name: '🦔' }).getAttribute('aria-checked')).toBe('true');
  });

  it('asks for notifications on tap, calling enablePush before anything is awaited', async () => {
    push.state = 'default';
    let resolve!: (ok: boolean) => void;
    push.enablePush.mockImplementation(() => new Promise<boolean>((r) => (resolve = r)));
    const backend = demo();
    renderApp(backend);
    await signInToProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create Home' }));
    await screen.findByRole('heading', { name: 'Get Reminders' });

    fireEvent.click(screen.getByRole('button', { name: 'Turn On Notifications' }));
    // Synchronously inside the tap (Safari only prompts then).
    expect(push.enablePush).toHaveBeenCalledTimes(1);
    const hid = (await backend.getMyHouseholdId())!;
    const me = (await backend.load(hid)).members[0];
    expect(push.enablePush.mock.calls[0][1]).toBe(me.id);
    expect(screen.getByRole('button', { name: 'Turn On Notifications' }).getAttribute('aria-busy')).toBe('true');

    await act(async () => resolve(true));
    expect(await screen.findByText('Main app')).toBeTruthy();
    expect((await backend.load(hid)).members[0].push_enabled).toBe(true);
  });

  it('stays on the step with a note when notifications are not turned on, and Not Now finishes', async () => {
    push.state = 'default';
    push.enablePush.mockResolvedValue(false);
    const backend = demo();
    renderApp(backend);
    await signInToProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create Home' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Turn On Notifications' }));

    // The toast's live region is always in the page too: look for the note itself.
    const notice = await screen.findByText(/still off/);
    expect(notice.getAttribute('role')).toBe('status');
    const hid = (await backend.getMyHouseholdId())!;
    expect((await backend.load(hid)).members[0].push_enabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Not Now' }));
    expect(await screen.findByText('Main app')).toBeTruthy();
  });

  it('explains Add to Home Screen on iPhone Safari', async () => {
    push.state = 'needs-install';
    renderApp(demo());
    await signInToProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create Home' }));
    await screen.findByRole('heading', { name: 'Add to Home Screen' });
    const steps = within(screen.getByRole('list')).getAllByRole('listitem');
    // iOS 26 Safari can keep Share behind the ••• button.
    expect(steps.map((s) => s.textContent)).toEqual([
      '1Tap Share  in SafariIf you don’t see it, tap ••• first.',
      '2Scroll down and choose Add to Home Screen',
      '3Open home.os from your Home Screen',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Main app')).toBeTruthy();
    expect(push.enablePush).not.toHaveBeenCalled();
  });

  it('joins a home from an invite link', async () => {
    // Shea sets up a home and makes an invite.
    const shea = demo({ id: 'user-shea', email: 'shea@example.com', name: 'Shea' });
    await shea.signInWithGoogle();
    await shea.createHousehold({
      name: 'Alderbrook',
      address: DEFAULT_ADDRESS,
      timezone: 'Europe/London',
      memberName: 'Shea',
      memberEmoji: '🦆',
      areas: ['Kitchen'],
      items: [],
    });
    const token = await shea.createInvite();
    await shea.signOut();

    window.history.replaceState(null, '', `/?invite=${token}`);
    const backend = demo();
    renderApp(backend);
    expect(await screen.findByText(/invited to join a home on home\.os/)).toBeTruthy();
    await signInToProfile();
    fireEvent.click(screen.getByRole('radio', { name: '🐻' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { name: 'Join Alderbrook' })).toBeTruthy();
    expect(screen.getByText(DEFAULT_ADDRESS)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    await screen.findByRole('heading', { name: 'You’re all set' });
    const data = await backend.load((await backend.getMyHouseholdId())!);
    expect(data.household.name).toBe('Alderbrook');
    expect(data.members.map((m) => [m.name, m.emoji, m.role])).toContainEqual(['Stratis', '🐻', 'member']);
    expect(localStorage.getItem('homeos.invite')).toBeNull();
  });

  it('lets you set up a new home instead of joining, and forgets the invite', async () => {
    const shea = demo({ id: 'user-shea', email: 'shea@example.com', name: 'Shea' });
    await shea.signInWithGoogle();
    await shea.createHousehold({
      name: 'Alderbrook',
      address: DEFAULT_ADDRESS,
      timezone: 'Europe/London',
      memberName: 'Shea',
      memberEmoji: '🦆',
      areas: ['Kitchen'],
      items: [],
    });
    const token = await shea.createInvite();
    await shea.signOut();

    window.history.replaceState(null, '', `/?invite=${token}`);
    const backend = demo();
    const first = renderApp(backend);
    await signInToProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Join Alderbrook' })).toBeTruthy();
    expect(localStorage.getItem('homeos.invite')).toBe(token);

    fireEvent.click(screen.getByRole('button', { name: 'Set up a new home instead' }));
    expect(await screen.findByRole('heading', { name: 'Your home' })).toBeTruthy();
    expect(localStorage.getItem('homeos.invite')).toBeNull();

    // A reload goes back to the create form, not to Join.
    first.unmount();
    renderApp(backend);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Your home' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Join Alderbrook' })).toBeNull();
  });

  it('lets you retry when the invite could not be checked', async () => {
    const owner = demo({ id: 'user-shea', email: 'shea@example.com', name: 'Shea' });
    await owner.signInWithGoogle();
    await owner.createHousehold({
      name: 'Alderbrook',
      address: '',
      timezone: 'Europe/London',
      memberName: 'Shea',
      memberEmoji: '🦆',
      areas: ['Kitchen'],
      items: [],
    });
    const token = await owner.createInvite();
    await owner.signOut();

    window.history.replaceState(null, '', `/?invite=${token}`);
    const backend = demo();
    const preview = vi.spyOn(backend, 'getInvitePreview').mockRejectedValueOnce(new BackendError('network'));
    renderApp(backend);
    await signInToProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Couldn’t check your invite' });
    expect(screen.getByText('No connection. Try again in a moment.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByRole('heading', { name: 'Join Alderbrook' })).toBeTruthy();
    expect(preview).toHaveBeenCalledTimes(2);
  });

  it('explains an invalid invite first, offers Check Again, and setting up a new home only as the quiet way out', async () => {
    window.history.replaceState(null, '', '/?invite=bogus');
    renderApp(demo());
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    // Before the profile: nothing typed would be thrown away.
    await screen.findByRole('heading', { name: 'Invite link not valid' });
    expect(screen.queryByRole('heading', { name: 'Your profile' })).toBeNull();
    expect(screen.getByText(/Ask whoever sent it to sign in to home.os first/)).toBeTruthy();
    // The main action checks again; nothing changed, and it says so.
    fireEvent.click(screen.getByRole('button', { name: 'Check Again' }));
    // Read out: it is a status line.
    expect((await screen.findByText('No home here yet. Checked just now.')).getAttribute('role')).toBe('status');
    fireEvent.click(screen.getByRole('button', { name: 'Set up a new home instead' }));
    expect(await screen.findByRole('heading', { name: 'Your profile' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Your home' })).toBeTruthy();
    // Going back and forward again stays on the create form.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Your home' })).toBeTruthy();
  });

  it('shows a toast when creating fails', async () => {
    const backend = demo();
    renderApp(backend);
    await signInToProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Your home' });
    // Another tab signs the user out: the RPC fails with not_signed_in.
    const doc = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    doc.session = null;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(doc));
    fireEvent.click(screen.getByRole('button', { name: 'Create Home' }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Create Home' }) as HTMLButtonElement).getAttribute('aria-busy')).toBe(
        null,
      ),
    );
    expect(screen.getByRole('heading', { name: 'Your home' })).toBeTruthy();
    expect(screen.getByText('Please sign in again.')).toBeTruthy();
  });
});
