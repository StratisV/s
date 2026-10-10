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
    // The message sits between Check Again and Sign Out.
    const footer = alert.parentElement!;
    expect(Array.from(footer.children).map((el) => el.textContent)).toEqual([
      'Check Again',
      'No connection. Try again in a moment.',
      'Sign Out',
    ]);
    // Trying again clears it.
    (home.recheckHome as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Check Again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('signs out', async () => {
    const home = show(privateHome());
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    await waitFor(() => expect(home.signOut).toHaveBeenCalledTimes(1));
  });

  it('with an invite link goes Profile then Join, without "Set up a new home instead"', async () => {
    const preview: InvitePreview = { household_name: 'Our home', address: '21 Alderbrook Road' };
    const backend = fakeBackend({ getInvitePreview: vi.fn(async () => preview) });
    const home = show(privateHome({ backend, pendingInvite: 'tok-1' }));
    expect(await screen.findByRole('heading', { name: 'Your profile' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '🐻' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Join Our home' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set up a new home instead' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() =>
      expect(home.joinHousehold).toHaveBeenCalledWith({ token: 'tok-1', memberName: 'Stratis', memberEmoji: '🐻' }),
    );
  });

  it('with an invite link that is no longer valid, Continue forgets it and shows the private screen', async () => {
    const home = show(
      privateHome({
        pendingInvite: 'old',
        dismissInvite: vi.fn(() => setHome({ pendingInvite: null })),
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Invite link not valid' })).toBeTruthy();
    expect(screen.getByText('It may have expired, as links last 14 days.')).toBeTruthy();
    expect(screen.queryByText(/new home/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(home.dismissInvite).toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'This home is private' })).toBeTruthy();
  });
});

describe('Bring over the home from this phone', () => {
  it('summarises the home this phone kept: name, address, counts and people', () => {
    show(noHome({ demoImport: SUMMARY }));
    expect(screen.getByRole('heading', { level: 1, name: 'Bring over the home from this phone' })).toBeTruthy();
    expect(screen.getByText('Our home')).toBeTruthy();
    expect(screen.getByText('21 Alderbrook Road')).toBeTruthy();
    expect(screen.getByText('6 areas · 19 items')).toBeTruthy();
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
    show(noHome({ demoImport: { ...SUMMARY, address: '', areas: 1, items: 1 } }));
    expect(screen.getByText('1 area · 1 item')).toBeTruthy();
    expect(screen.queryByText('21 Alderbrook Road')).toBeNull();
  });

  it('brings it over (busy meanwhile) and opens the home without a Profile step', async () => {
    const done = deferred();
    const home = show(
      noHome({
        demoImport: SUMMARY,
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
    show(
      noHome({
        demoImport: SUMMARY,
        importDemoHome: vi.fn(async () => Promise.reject(new BackendError('network'))),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bring It Over' }));
    expect((await screen.findByRole('alert')).textContent).toBe('No connection. Try again in a moment.');
    expect(screen.getByRole('button', { name: 'Bring It Over' }).getAttribute('aria-busy')).toBeNull();
    expect((screen.getByRole('button', { name: 'Start Fresh' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('when a home was set up meanwhile, moves to where the provider says (here: private)', async () => {
    show(
      noHome({
        demoImport: SUMMARY,
        importDemoHome: vi.fn(async () => {
          setHome({
            phase: { kind: 'private', user: USER, email: USER.email, emailVerified: true },
            demoImport: null,
          });
          throw new BackendError('home_exists');
        }),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bring It Over' }));
    expect(await screen.findByRole('heading', { name: 'This home is private' })).toBeTruthy();
    expect(screen.getByText('stratis@gmail.com')).toBeTruthy();
  });

  it('Start Fresh goes on to Profile, then Create home', async () => {
    const home = show(noHome({ demoImport: SUMMARY, declineDemoImport: vi.fn(() => setHome({ demoImport: null })) }));
    fireEvent.click(screen.getByRole('button', { name: 'Start Fresh' }));
    expect(home.declineDemoImport).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('heading', { name: 'Your profile' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Your home' })).toBeTruthy();
  });

  it('is not shown when there is nothing to bring over', () => {
    show(noHome());
    expect(screen.getByRole('heading', { name: 'Your profile' })).toBeTruthy();
    expect(screen.queryByText('Bring over the home from this phone')).toBeNull();
  });

  it('signs out', async () => {
    const home = show(noHome({ demoImport: SUMMARY }));
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
