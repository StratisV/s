import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { BackendError } from '../../lib/backend/types';
import type { DemoHomeSummary, InvitePreview } from '../../lib/types';
import type { HomeContextValue } from '../../state/HomeProvider';
import { fakeBackend, makeHome, MockHome, sampleData, setHome, updateHome, USER } from '../testing/mockHome';
import { Onboarding } from './Onboarding';

vi.mock('../../state/HomeProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../state/HomeProvider')>();
  const { useMockHome } = await import('../testing/mockHome');
  return { ...actual, useHome: useMockHome, useHousehold: useMockHome };
});

// push.ts talks to the browser; the notifications step only needs its answers.
vi.mock('../../lib/push', () => ({
  PUSH_CONFIGURED: true,
  isIOS: () => false,
  isStandalone: () => false,
  pushState: () => 'unsupported',
  enablePush: vi.fn(async () => false),
  disablePush: vi.fn(async () => {}),
}));

/** The home this phone kept in demo mode, as demoHomeSummary() gives it. */
const SUMMARY: DemoHomeSummary = {
  householdName: 'Our home',
  address: '21 Alderbrook Road',
  areas: 6,
  items: 19,
  done: 3,
  people: [
    { name: 'Stratis', emoji: '🦆', me: true },
    { name: 'Shea', emoji: '🦔', me: false },
    { name: 'Ela', emoji: '🦊', me: false },
  ],
};

function show(home: HomeContextValue) {
  // StrictMode as in main.tsx: effects run twice on mount.
  render(
    <StrictMode>
      <MockHome initial={home}>
        <Onboarding />
      </MockHome>
    </StrictMode>,
  );
  return home;
}

/** Signed in, not in the home: a home exists and nobody there has this email. */
function privateHome(over: Partial<HomeContextValue> = {}, email = 'ela@gmail.com', emailVerified = true) {
  return makeHome({ data: null, phase: { kind: 'private', user: USER, email, emailVerified }, ...over });
}

/** Signed in, no home exists. */
function noHome(over: Partial<HomeContextValue> = {}) {
  return makeHome({ data: null, phase: { kind: 'onboarding', user: USER }, ...over });
}

/** No home exists, and this phone kept one in demo mode: the offer. */
function offering(over: Partial<HomeContextValue> = {}) {
  return noHome({ demoImport: SUMMARY, demoImportMode: 'create', ...over });
}

/** The real backend, as the provider says it is (only the kind matters to these screens). */
const supabase = () => fakeBackend({ kind: 'supabase' } as never);

/** A promise the test settles by hand. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => cleanup());

describe('This home is private', () => {
  it('says exactly what to do, with the email to add, and never offers a new home', () => {
    show(privateHome());
    expect(screen.getByRole('heading', { level: 1, name: 'This home is private' })).toBeTruthy();
    const body = screen.getByText(/^Ask someone at home to add/);
    // The path to People stays on one line (non-breaking spaces).
    expect(body.textContent).toContain('Profile\u00a0>\u00a0Household\u00a0>\u00a0People');
    expect(body.textContent!.replace(/\s+/g, ' ')).toBe(
      'Ask someone at home to add ela@gmail.com in Profile > Household > People, then check again.',
    );
    // The email stands out.
    expect(within(body).getByText('ela@gmail.com').tagName).toBe('STRONG');
    expect(screen.queryByText(/verified/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Check Again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeTruthy();
    // Nothing anywhere offers a second home.
    expect(screen.queryByRole('button', { name: /home|create|set up/i })).toBeNull();
    expect(screen.queryByText(/new home|create/i)).toBeNull();
  });

  it('without an email asks for their Google email, and says when it is not verified', () => {
    show(privateHome({}, '', false));
    expect(
      screen.getByText(
        'Ask someone at home to add your Google email in Profile > Household > People, then check again.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Your Google account’s email isn’t verified yet, so it can’t be matched.')).toBeTruthy();
  });

  it('checks again on a tap (busy meanwhile) and moves on when the person has been added', async () => {
    const check = deferred();
    const home = show(
      privateHome({
        recheckHome: vi.fn(async () => {
          await check.promise;
          // Someone at home added them: the claim opens the home.
          setHome({ phase: { kind: 'ready', user: USER }, data: sampleData(), onboardingTail: true, claimed: true });
        }),
      }),
    );
    const button = screen.getByRole('button', { name: 'Check Again' });
    fireEvent.click(button);
    expect(home.recheckHome).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-busy')).toBe('true');
    // A second tap while checking does nothing.
    fireEvent.click(button);
    expect(home.recheckHome).toHaveBeenCalledTimes(1);
    await act(async () => check.resolve());
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome home, Stratis' })).toBeTruthy();
  });

  it('shows why a check failed under the button, and stays', async () => {
    const home = show(privateHome({ recheckHome: vi.fn(async () => Promise.reject(new BackendError('network'))) }));
    fireEvent.click(screen.getByRole('button', { name: 'Check Again' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('No connection. Try again in a moment.');
    expect(screen.getByRole('button', { name: 'Check Again' }).getAttribute('aria-busy')).toBeNull();
    // The message sits between Check Again and Sign Out (after the empty status line).
    const footer = alert.parentElement!;
    expect(Array.from(footer.children).map((el) => el.textContent)).toEqual([
      'Check Again',
      '',
      'No connection. Try again in a moment.',
      'Sign Out',
    ]);
    // Trying again clears it; nothing changed, and it says so.
    (home.recheckHome as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Check Again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    const status = await screen.findByText('Not added yet. Checked just now.');
    expect(status.getAttribute('role')).toBe('status');
  });

  it('says when this phone kept a home that can’t come over now', () => {
    show(privateHome({ demoImport: SUMMARY, demoImportMode: 'blocked' }));
    expect(
      screen.getByText(
        'This phone still has Our home (6 areas · 19 items · 3 done). Someone has already set up a home here, so it can’t be brought over now.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bring It Over' })).toBeNull();
  });

  it('signs out', async () => {
    const home = show(privateHome());
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    await waitFor(() => expect(home.signOut).toHaveBeenCalledTimes(1));
  });

  it('with an invite link goes Profile then Join, without "Set up a new home instead"', async () => {
    const preview: InvitePreview = { household_name: 'Our home', address: '21 Alderbrook Road', people: [], emojis: ['🦆', '🦔'] };
    const backend = fakeBackend({ getInvitePreview: vi.fn(async () => preview) });
    const home = show(privateHome({ backend, pendingInvite: 'tok-1' }));
    expect(await screen.findByRole('heading', { name: 'Your profile' })).toBeTruthy();
    // Starts on the first emoji nobody in that home has (the duck and hedgehog are taken).
    await waitFor(() => expect(screen.getByRole('radio', { name: '🦊' }).getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(screen.getByRole('radio', { name: '🐻' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Join Our home' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set up a new home instead' })).toBeNull();
    // Nobody is waiting to join: no question to answer.
    expect(screen.queryByRole('radiogroup', { name: 'Are you one of these people?' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() =>
      expect(home.joinHousehold).toHaveBeenCalledWith({ token: 'tok-1', memberName: 'Stratis', memberEmoji: '🐻', personId: null }),
    );
  });

  it('with an invite link that is no longer valid: straight to the private screen, which says so', async () => {
    const home = show(
      privateHome({
        pendingInvite: 'old',
        dismissInvite: vi.fn(() => setHome({ pendingInvite: null })),
      }),
    );
    expect(await screen.findByText('That invite link has expired.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'This home is private' })).toBeTruthy();
    // No profile to fill in first, and the link is forgotten (a reload won't bring it back).
    expect(screen.queryByRole('heading', { name: 'Your profile' })).toBeNull();
    await waitFor(() => expect(home.dismissInvite).toHaveBeenCalled());
    expect(screen.getByText('That invite link has expired.')).toBeTruthy();
    expect(screen.queryByText(/new home/)).toBeNull();
  });
});

describe('Join: "Are you one of these people?"', () => {
  const preview: InvitePreview = {
    household_name: 'Our home',
    address: '21 Alderbrook Road',
    people: [
      { id: 'm-ela', name: 'Ela', emoji: '🦊' },
      { id: 'm-robin', name: 'Robin', emoji: '🐝' },
    ],
    emojis: ['🦆', '🦔', '🦊', '🐝'],
  };

  async function toJoin(over: Partial<HomeContextValue> = {}, name?: string) {
    const backend = fakeBackend({ getInvitePreview: vi.fn(async () => preview) });
    const home = show(privateHome({ backend, pendingInvite: 'tok-1', ...over }));
    await screen.findByRole('heading', { name: 'Your profile' });
    if (name !== undefined) fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: name } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Join Our home' });
    return home;
  }

  it('lists the people the home is waiting for; Join waits for an answer', async () => {
    await toJoin();
    const group = screen.getByRole('radiogroup', { name: 'Are you one of these people?' });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      '🦊Ela',
      '🐝Robin',
      '🐻Someone new (Stratis)',
    ]);
    expect(within(group).getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);
    expect((screen.getByRole('button', { name: 'Join' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('picking one joins as them', async () => {
    const home = await toJoin();
    fireEvent.click(screen.getByRole('radio', { name: /Ela/ }));
    expect(screen.getByRole('radio', { name: /Ela/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Join as Ela' }));
    await waitFor(() =>
      expect(home.joinHousehold).toHaveBeenCalledWith({ token: 'tok-1', memberName: 'Stratis', memberEmoji: '🐻', personId: 'm-ela' }),
    );
  });

  it('the name typed on Your profile picks them already; "Someone new" joins as the profile', async () => {
    const home = await toJoin({}, 'ela');
    expect(screen.getByRole('radio', { name: /Ela/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: /Someone new/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() =>
      expect(home.joinHousehold).toHaveBeenCalledWith({ token: 'tok-1', memberName: 'ela', memberEmoji: '🐻', personId: null }),
    );
  });

  it('someone who joined meanwhile: says so and looks again', async () => {
    const home = await toJoin({ joinHousehold: vi.fn(async () => Promise.reject(new BackendError('not_found'))) });
    fireEvent.click(screen.getByRole('radio', { name: /Robin/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Join as Robin' }));
    await waitFor(() => expect(home.showToast).toHaveBeenCalledWith('Robin has joined already or was removed.'));
  });
});

describe('Bring over the home from this phone', () => {
  it('summarises the home this phone kept: name, address, counts and people', () => {
    show(offering());
    expect(screen.getByRole('heading', { level: 1, name: 'Bring over the home from this phone' })).toBeTruthy();
    expect(screen.getByText('Our home')).toBeTruthy();
    expect(screen.getByText('21 Alderbrook Road')).toBeTruthy();
    // What was done comes along too, and says so.
    expect(screen.getByText('6 areas · 19 items · 3 done')).toBeTruthy();
    const people = screen.getByRole('list', { name: 'People' });
    expect(within(people).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '🦆Stratis (you)',
      '🦔Shea',
      '🦊Ela',
    ]);
    expect(
      screen.getByText('Everyone else joins when someone adds their Google email in Profile > Household > People.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bring It Over' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start Fresh' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeTruthy();
    // Shown before Profile.
    expect(screen.queryByRole('heading', { name: 'Your profile' })).toBeNull();
  });

  it('says 1 area and 1 item, and leaves out a blank address', () => {
    show(offering({ demoImport: { ...SUMMARY, address: '', areas: 1, items: 1, done: 0 } }));
    expect(screen.getByText('1 area · 1 item')).toBeTruthy();
    expect(screen.queryByText('21 Alderbrook Road')).toBeNull();
  });

  it('brings it over (busy meanwhile) and opens the home without a Profile step', async () => {
    const done = deferred();
    const home = show(
      offering({
        importDemoHome: vi.fn(async () => {
          await done.promise;
          setHome({ phase: { kind: 'ready', user: USER }, data: sampleData(), onboardingTail: true, demoImport: null });
        }),
      }),
    );
    const bring = screen.getByRole('button', { name: 'Bring It Over' });
    fireEvent.click(bring);
    expect(home.importDemoHome).toHaveBeenCalledTimes(1);
    expect(bring.getAttribute('aria-busy')).toBe('true');
    expect(bring.textContent).toBe('Bringing It Over');
    expect((screen.getByRole('button', { name: 'Start Fresh' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Sign Out' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(bring);
    expect(home.importDemoHome).toHaveBeenCalledTimes(1);
    await act(async () => done.resolve());
    // Straight on to the notifications step (here: "You're all set", push is unsupported).
    expect(await screen.findByRole('heading', { name: 'You’re all set' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Your profile' })).toBeNull();
  });

  it('keeps the offer and says why when bringing it over fails', async () => {
    show(offering({ importDemoHome: vi.fn(async () => Promise.reject(new BackendError('network'))) }));
    fireEvent.click(screen.getByRole('button', { name: 'Bring It Over' }));
    expect((await screen.findByRole('alert')).textContent).toBe('No connection. Try again in a moment.');
    expect(screen.getByRole('button', { name: 'Bring It Over' }).getAttribute('aria-busy')).toBeNull();
    expect((screen.getByRole('button', { name: 'Start Fresh' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('when a home was set up meanwhile, moves to where the provider says (here: private)', async () => {
    show(
      offering({
        importDemoHome: vi.fn(async () => {
          setHome({
            phase: { kind: 'private', user: USER, email: USER.email, emailVerified: true },
            demoImportMode: 'blocked',
          });
          throw new BackendError('home_exists');
        }),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bring It Over' }));
    expect(await screen.findByRole('heading', { name: 'This home is private' })).toBeTruthy();
    expect(screen.getByText('stratis@gmail.com')).toBeTruthy();
    // And why the phone's home did not come over.
    expect(screen.getByText(/This phone still has Our home .* so it can’t be brought over now\./)).toBeTruthy();
  });

  it('Start Fresh asks first; then Profile (with Back to the offer), then Create home', async () => {
    const home = show(
      offering({
        declineDemoImport: vi.fn(() => setHome({ demoImport: null, demoImportMode: null, canReopenDemoImport: true })),
        reopenDemoImport: vi.fn(() => setHome({ demoImport: SUMMARY, demoImportMode: 'create', canReopenDemoImport: false })),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start Fresh' }));
    const sheet = await screen.findByRole('alertdialog', { name: 'Start a new home?' });
    expect(sheet.textContent).toContain('The home on this phone (19 items) won’t come along, and can’t be brought over later.');
    // Cancel: nothing happens.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(home.declineDemoImport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Start Fresh' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Start Fresh' }));
    expect(home.declineDemoImport).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('heading', { name: 'Your profile' })).toBeTruthy();
    // Back: the offer again.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(home.reopenDemoImport).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('heading', { name: 'Bring over the home from this phone' })).toBeTruthy();
    // Start Fresh again, on to Create home: it was turned down here, so it doesn't ask again.
    fireEvent.click(screen.getByRole('button', { name: 'Start Fresh' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Start Fresh' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Your home' })).toBeTruthy();
  });

  it('is not shown when there is nothing to bring over', () => {
    show(noHome());
    expect(screen.getByRole('heading', { name: 'Your profile' })).toBeTruthy();
    expect(screen.queryByText('Bring over the home from this phone')).toBeNull();
  });

  it('signs out', async () => {
    const home = show(offering());
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    await waitFor(() => expect(home.signOut).toHaveBeenCalledTimes(1));
  });
});

describe('Welcome home (after a claim)', () => {
  /** Shea signed in: someone had added her email, so she is Shea now. */
  function claimedAsShea(over: Partial<HomeContextValue> = {}) {
    const data = sampleData();
    const shea = { id: 'user-shea', email: 'shea@gmail.com', name: 'Shea Byrne' };
    data.members = data.members.map((m) => (m.id === 'm-shea' ? { ...m, user_id: shea.id } : m));
    return makeHome({ user: shea, data, phase: { kind: 'ready', user: shea }, onboardingTail: true, claimed: true, ...over });
  }

  it('welcomes them by the name set at home, on their emoji', () => {
    show(claimedAsShea());
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome home, Shea' })).toBeTruthy();
    expect(screen.getByText('Our home is all set up for you. Pick your emoji.')).toBeTruthy();
    const grid = screen.getByRole('radiogroup', { name: 'Your emoji' });
    expect(within(grid).getByRole('radio', { name: '🦔' }).getAttribute('aria-checked')).toBe('true');
    // No Profile step and no way to set up a home.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/create|new home/i)).toBeNull();
  });

  it('Continue saves the emoji they picked; then the notifications step follows', async () => {
    const home = show(
      claimedAsShea({ confirmClaimed: vi.fn(async () => setHome({ claimed: false })) }),
    );
    fireEvent.click(screen.getByRole('radio', { name: '🐻' }));
    expect(screen.getByRole('radio', { name: '🐻' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(home.confirmClaimed).toHaveBeenCalledWith('🐻');
    expect(await screen.findByRole('heading', { name: 'You’re all set' })).toBeTruthy();
  });

  it('Continue without a change confirms their emoji as it is', () => {
    const home = show(claimedAsShea());
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(home.confirmClaimed).toHaveBeenCalledWith('🦔');
  });

  it('stays on the step when saving fails (the provider says so), and can try again', async () => {
    const home = show(claimedAsShea({ confirmClaimed: vi.fn(async () => Promise.reject(new BackendError('network'))) }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' }).getAttribute('aria-busy')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Welcome home, Shea' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(home.confirmClaimed).toHaveBeenCalledTimes(2);
  });
});

describe('Onboarding routing', () => {
  it('after a create, join or import (not a claim) goes straight to the notifications step', () => {
    show(makeHome({ onboardingTail: true }));
    expect(screen.getByRole('heading', { name: 'You’re all set' })).toBeTruthy();
  });

  it('follows the phase as it changes: private, then claimed by someone adding the email', async () => {
    show(privateHome());
    expect(screen.getByRole('heading', { name: 'This home is private' })).toBeTruthy();
    updateHome({ phase: { kind: 'ready', user: USER }, data: sampleData(), onboardingTail: true, claimed: true });
    expect(await screen.findByRole('heading', { name: 'Welcome home, Stratis' })).toBeTruthy();
  });
});

describe('the phone’s home, once in a home', () => {
  /** In a home (made on another device) with the tail up for the phone's home. */
  function inHome(mode: 'replace' | 'blocked', over: Partial<HomeContextValue> = {}) {
    const data = sampleData();
    data.household.name = 'Laptop home';
    return makeHome({ data, onboardingTail: true, demoImport: SUMMARY, demoImportMode: mode, ...over });
  }

  it('while the home has nothing in it: offered to take its place; Keep asks first', async () => {
    const home = show(inHome('replace'));
    expect(screen.getByRole('heading', { name: 'Bring over the home from this phone' })).toBeTruthy();
    expect(
      screen.getByText('It takes the place of Laptop home, which has nothing in it yet. Everyone already in Laptop home stays.'),
    ).toBeTruthy();
    // In a home already: no Sign Out here.
    expect(screen.queryByRole('button', { name: 'Sign Out' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keep Laptop home' }));
    const sheet = await screen.findByRole('alertdialog', { name: 'Keep Laptop home as it is?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Keep Laptop home' }));
    expect(home.declineDemoImport).toHaveBeenCalledTimes(1);
  });

  it('Bring It Over brings it in', async () => {
    const home = show(inHome('replace'));
    fireEvent.click(screen.getByRole('button', { name: 'Bring It Over' }));
    await waitFor(() => expect(home.importDemoHome).toHaveBeenCalledTimes(1));
  });

  it('when the home is in use: says the phone’s home stays there, once', () => {
    const home = show(inHome('blocked'));
    expect(screen.getByRole('heading', { name: 'The home on this phone stays here' })).toBeTruthy();
    expect(
      screen.getByText(
        'This phone still has Our home (6 areas · 19 items · 3 done) from before. Laptop home already has things in it, so that home can’t be brought over.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(home.declineDemoImport).toHaveBeenCalledTimes(1);
  });
});

describe('after bringing a home over: the people who came along', () => {
  function afterImport(over: Partial<HomeContextValue> = {}) {
    const data = sampleData();
    // Pat came along without an email; Shea has one already.
    return makeHome({ data, onboardingTail: true, invitePeople: true, ...over });
  }

  it('asks for the emails of the people waiting without one, then moves on', async () => {
    const home = show(
      afterImport({
        setPersonEmail: vi.fn(async (id: string, email: string) =>
          updateHome((h) => ({ data: { ...h.data!, members: h.data!.members.map((m) => (m.id === id ? { ...m, email } : m)) } })),
        ),
        doneInvitingPeople: vi.fn(() => setHome({ invitePeople: false })),
      }),
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Pat hasn’t joined yet' })).toBeTruthy();
    const field = screen.getByRole('textbox', { name: 'Pat’s Google email' }) as HTMLInputElement;
    expect(field.type).toBe('email');
    // Not an email: says so, and nothing is saved.
    fireEvent.change(field, { target: { value: 'pat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Enter the full email address, like name@gmail.com.')).toBeTruthy();
    expect(home.setPersonEmail).not.toHaveBeenCalled();
    // Someone has it already: says so.
    fireEvent.change(field, { target: { value: 'Shea@Gmail.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Someone at home already has that email.')).toBeTruthy();
    fireEvent.change(field, { target: { value: ' Pat@Gmail.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(home.setPersonEmail).toHaveBeenCalledWith('m-pat', 'pat@gmail.com'));
    expect(home.doneInvitingPeople).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('heading', { name: 'You’re all set' })).toBeTruthy();
  });

  it('names everyone waiting, and can be left for later', async () => {
    const data = sampleData();
    data.members.push({ ...data.members[2], id: 'm-ela', name: 'Ela', emoji: '🦊' });
    const home = show(afterImport({ data }));
    expect(screen.getByRole('heading', { level: 1, name: 'Pat and Ela haven’t joined yet' })).toBeTruthy();
    expect(screen.getByText('You can add or change them later in Profile > Household > People.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(home.doneInvitingPeople).toHaveBeenCalledTimes(1));
    expect(home.setPersonEmail).not.toHaveBeenCalled();
  });

  it('with nobody waiting without an email: straight to notifications', () => {
    const data = sampleData();
    data.members = data.members.filter((m) => m.id !== 'm-pat');
    show(afterImport({ data }));
    expect(screen.getByRole('heading', { name: 'You’re all set' })).toBeTruthy();
  });
});

describe('Welcome home: "Not Shea?"', () => {
  it('asks first, then gives the person back and signs out', async () => {
    const data = sampleData();
    const shea = { id: 'user-shea', email: 'shea@gmail.com', name: 'Shea Byrne' };
    data.members = data.members.map((m) => (m.id === 'm-shea' ? { ...m, user_id: shea.id } : m));
    const home = show(makeHome({ user: shea, data, phase: { kind: 'ready', user: shea }, onboardingTail: true, claimed: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Not Shea? Sign Out' }));
    const sheet = await screen.findByRole('alertdialog', { name: 'Not Shea?' });
    expect(sheet.textContent).toContain('You’ll be signed out and Shea goes back to waiting to join.');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(home.releaseClaim).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Not Shea? Sign Out' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sign Out' }));
    await waitFor(() => expect(home.releaseClaim).toHaveBeenCalledTimes(1));
  });
});

describe('Create home while no home exists', () => {
  async function toCreate(over: Partial<HomeContextValue> = {}) {
    const home = show(noHome(over));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Your home' });
    return home;
  }

  it('on the real backend: says to bring a home over from the phone first, and asks before creating', async () => {
    const home = await toCreate({ backend: supabase() });
    expect(
      screen.getByText('Used home.os on your phone before? Sign in on that phone first to bring your home over.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create Home' }));
    const sheet = await screen.findByRole('alertdialog', { name: 'Create a new home?' });
    expect(sheet.textContent).toContain('If your home is already on another phone, sign in on that phone first to bring it over.');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(home.createHousehold).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Create Home' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Create Home' }));
    await waitFor(() => expect(home.createHousehold).toHaveBeenCalledTimes(1));
  });

  it('after Start Fresh on this phone, or in demo mode: creates straight away', async () => {
    const fresh = await toCreate({ backend: supabase(), canReopenDemoImport: true });
    expect(screen.queryByText(/Used home.os on your phone before/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create Home' }));
    await waitFor(() => expect(fresh.createHousehold).toHaveBeenCalledTimes(1));
    cleanup();
    const demo = await toCreate({ backend: fakeBackend({ kind: 'demo' } as never) });
    fireEvent.click(screen.getByRole('button', { name: 'Create Home' }));
    await waitFor(() => expect(demo.createHousehold).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
