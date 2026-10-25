import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { BackendError } from '../../lib/backend/types';
import type { IssuedCode, Member, ServerSetupSummary } from '../../lib/types';
import type { HomeContextValue, ServerWelcome } from '../../state/HomeProvider';
import { fakeBackend, makeHome, MockHome, person, sampleData, setHome, USER } from '../testing/mockHome';
import { Onboarding } from './Onboarding';

vi.mock('../../state/HomeProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../state/HomeProvider')>();
  const { useMockHome } = await import('../testing/mockHome');
  return { ...actual, useHome: useMockHome, useHousehold: useMockHome };
});

// push.ts talks to the browser; the notifications step (never shown here) only needs its answers.
vi.mock('../../lib/push', () => ({
  PUSH_CONFIGURED: true,
  isIOS: () => false,
  isStandalone: () => false,
  pushState: () => 'default',
  enablePush: vi.fn(async () => false),
  disablePush: vi.fn(async () => {}),
}));

/** The household's phone home, as serverSetupSummary() gives it. */
const SUMMARY: ServerSetupSummary = {
  householdName: 'Our home',
  address: '21 Alderbrook Road',
  areas: 6,
  items: 19,
  done: 3,
  visits: 2,
  people: [
    { name: 'Stratis', emoji: '🦆', me: true },
    { name: 'Shea', emoji: '🦔', me: false },
  ],
};

const server = () => fakeBackend({ kind: 'server' } as never);

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

/** Signed out, in server mode, with the Welcome screen showing `welcome`. */
function signedOut(welcome: ServerWelcome | null, over: Partial<HomeContextValue> = {}) {
  return makeHome({ backend: server(), user: null, data: null, serverWelcome: welcome, ...over });
}

const privateHome = (over: Partial<Extract<ServerWelcome, { kind: 'private' }>> = {}): ServerWelcome => ({
  kind: 'private',
  homeOnline: true,
  code: '',
  notice: null,
  ...over,
});

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

/** "Have a code?": behind its button on Create Account (opened here when it is not open yet). */
const codeField = () => {
  const open = screen.queryByRole('textbox', { name: 'Have a code?' });
  if (!open) fireEvent.click(screen.getByRole('button', { name: 'Have a code?' }));
  return screen.getByRole('textbox', { name: 'Have a code?' }) as HTMLInputElement;
};
const joinButton = () => screen.getByRole('button', { name: 'Join' }) as HTMLButtonElement;

afterEach(() => {
  cleanup();
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe('Welcome in server mode', () => {
  it('opens on Create Account, with Sign In, and a code behind Have a code? (no Google, no demo note)', () => {
    show(signedOut(privateHome()));
    expect(screen.getByRole('heading', { level: 1, name: 'home.os' })).toBeTruthy();
    expect(screen.getByText('Join your home')).toBeTruthy();
    expect(screen.getByText('Create your account to see everything at home.')).toBeTruthy();
    expect((screen.getByLabelText('Your name') as HTMLInputElement).autocomplete).toBe('name');
    expect((screen.getByLabelText('Email') as HTMLInputElement).type).toBe('email');
    expect((screen.getByLabelText('Password') as HTMLInputElement).autocomplete).toBe('new-password');
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeTruthy();
    // Every field keeps a label in view above it (not only a placeholder that goes as you type).
    for (const text of ['Your name', 'Email', 'Password']) {
      const label = screen.getByText(text, { selector: 'label' });
      expect(label.className).not.toMatch(/visually-hidden/);
      expect(label.textContent).toBe(text);
    }
    expect(screen.getByText('6 or more characters.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Have an account? Sign In' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Have a code?' }));
    expect(screen.getByText('This home is private.')).toBeTruthy();
    expect(screen.getByText('Ask someone at home for a code.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
    expect(screen.queryByText(/Demo mode/)).toBeNull();

    const field = codeField();
    expect(field.getAttribute('autocapitalize')).toBe('characters');
    expect(field.getAttribute('autocomplete')).toBe('one-time-code');
    expect(field.getAttribute('inputmode')).toBe('text');
    expect(field.getAttribute('spellcheck')).toBe('false');
    // Room for a setup code typed here by mistake (it then says where that goes).
    // The longest setup code, grouped (24 letters), goes in whole.
    expect(field.maxLength).toBe(29);
    expect(field.placeholder).toBe('ABCD-EFGH');
    // Off until there are 8 letters.
    expect(joinButton().disabled).toBe(true);
  });

  it('says when no home is online yet', () => {
    show(signedOut(privateHome({ homeOnline: false })));
    expect(screen.getByText('This home is private.')).toBeTruthy();
    expect(screen.getByText('home.os isn’t set up here yet.')).toBeTruthy();
    expect(screen.queryByText('Ask someone at home for a code.')).toBeNull();
  });

  it('shows a spinner while it checks, and never Google, even before the provider has said', () => {
    show(signedOut({ kind: 'checking' }));
    expect(screen.getByRole('status').textContent).toBe('Checking');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
    cleanup();

    show(signedOut(null));
    expect(screen.getByRole('status').textContent).toBe('Checking');
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
  });

  it('groups the code as it is typed, and Join sends it', async () => {
    const redeem = deferred();
    const home = show(signedOut(privateHome(), { redeemCode: vi.fn(() => redeem.promise) }));
    fireEvent.change(codeField(), { target: { value: 'abcdefg' } });
    expect(codeField().value).toBe('ABCD-EFG');
    expect(joinButton().disabled).toBe(true);
    fireEvent.change(codeField(), { target: { value: 'ABCD-EFGh' } });
    expect(codeField().value).toBe('ABCD-EFGH');
    expect(joinButton().disabled).toBe(false);

    fireEvent.click(joinButton());
    expect(home.redeemCode).toHaveBeenCalledWith('ABCD-EFGH');
    const busy = screen.getByRole('button', { name: 'Joining' });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    // A second tap while it runs does nothing.
    fireEvent.click(busy);
    expect(home.redeemCode).toHaveBeenCalledTimes(1);
    await act(async () => redeem.resolve());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('joins from the keyboard (Go)', async () => {
    const home = show(signedOut(privateHome()));
    fireEvent.change(codeField(), { target: { value: 'k7qm 3xrp' } });
    fireEvent.submit(codeField().closest('form')!);
    expect(home.redeemCode).toHaveBeenCalledWith('K7QM-3XRP');
    await act(async () => {});
  });

  it('says why a code did not work, keeps it, and forgets the error once it is changed', async () => {
    show(
      signedOut(privateHome(), {
        redeemCode: vi.fn(async () => {
          throw new BackendError('invalid_code', 'invalid_code');
        }),
      }),
    );
    fireEvent.change(codeField(), { target: { value: 'ABCDEFGH' } });
    fireEvent.click(joinButton());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That code didn’t work. Check it, or ask for a new one.');
    expect(codeField().value).toBe('ABCD-EFGH');
    expect(codeField().getAttribute('aria-invalid')).toBe('true');
    expect(codeField().getAttribute('aria-describedby')).toBe(alert.id);
    expect(joinButton().disabled).toBe(false);

    fireEvent.change(codeField(), { target: { value: 'ABCD-EFGJ' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(codeField().getAttribute('aria-invalid')).toBeNull();
  });

  it('says to wait after too many tries', async () => {
    show(
      signedOut(privateHome(), {
        redeemCode: vi.fn(async () => {
          throw new BackendError('too_many_attempts', 'too_many_attempts');
        }),
      }),
    );
    fireEvent.change(codeField(), { target: { value: 'ABCDEFGH' } });
    fireEvent.click(joinButton());
    expect((await screen.findByRole('alert')).textContent).toBe('Too many tries. Wait 15 minutes, then try again.');
  });

  it('says why a link did not work, with its code in the field, until a code is tried', async () => {
    const home = show(signedOut(privateHome({ code: 'ABCDEFGH', notice: 'codeInvalid' })));
    expect(screen.getByText('That link’s code didn’t work. Ask for a new one.')).toBeTruthy();
    expect(codeField().value).toBe('ABCD-EFGH');
    fireEvent.change(codeField(), { target: { value: 'ABCD-EFGJ' } });
    fireEvent.click(joinButton());
    await act(async () => {});
    expect(home.redeemCode).toHaveBeenCalledWith('ABCD-EFGJ');
    expect(screen.queryByText('That link’s code didn’t work. Ask for a new one.')).toBeNull();
  });

  it('says so when the setup link came after the home went online, and after too many tries', () => {
    show(signedOut(privateHome({ notice: 'setupUsed' })));
    expect(screen.getByText('This home is already online. Ask someone at home for a code.')).toBeTruthy();
    cleanup();
    show(signedOut(privateHome({ notice: 'tooManyAttempts', code: 'ABCDEFGH' })));
    expect(screen.getByText('Too many tries. Wait 15 minutes, then try again.')).toBeTruthy();
  });

  it('keeps a link’s code for a choice where home.os may not live: join in this browser, or copy it for the Home Screen app', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const home = show(signedOut(privateHome({ code: 'ABCDEFGH', notice: 'codeHere' })));
    expect(
      screen.getByText('Using home.os from your Home Screen? Open it there and type this code. Or join in this browser.'),
    ).toBeTruthy();
    expect(codeField().value).toBe('ABCD-EFGH');
    fireEvent.click(screen.getByRole('button', { name: 'Copy Code' }));
    await waitFor(() => expect(screen.getByText('Copied.')).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith('ABCD-EFGH');
    expect(home.redeemCode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Join in This Browser' }));
    await act(async () => {});
    expect(home.redeemCode).toHaveBeenCalledWith('ABCD-EFGH');
  });

  it('says where a setup code goes when it is typed as a sign-in code, without asking the server', async () => {
    const home = show(signedOut(privateHome()));
    fireEvent.change(codeField(), { target: { value: 'test-setu-pcde' } });
    expect(codeField().value).toBe('TEST-SETU-PCDE');
    fireEvent.click(joinButton());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That’s a setup code, and this home is already online. Ask someone at home for a code.',
    );
    expect(home.startSetup).not.toHaveBeenCalled();
    cleanup();
    // No home online yet: on to Bring this home online with it (HomeProvider.startSetup) ...
    const notYet = show(signedOut(privateHome({ homeOnline: false }), { startSetup: vi.fn(() => true) }));
    fireEvent.change(codeField(), { target: { value: 'kq27 jrmb nvbu 4nay 6f76' } });
    expect(codeField().value).toBe('KQ27-JRMB-NVBU-4NAY-6F76');
    fireEvent.click(joinButton());
    expect(notYet.startSetup).toHaveBeenCalledWith('KQ27-JRMB-NVBU-4NAY-6F76');
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();
    // ... and where that can't happen (no saved copy), it says where the code goes.
    const none = show(signedOut(privateHome({ homeOnline: false })));
    fireEvent.change(codeField(), { target: { value: 'test-setu-pcde' } });
    fireEvent.click(joinButton());
    expect((await screen.findByRole('alert')).textContent).toBe('That’s the setup code. Enter it in home.os where your home is.');
    expect(none.startSetup).toHaveBeenCalledWith('TEST-SETU-PCDE');
    expect(home.redeemCode).not.toHaveBeenCalled();
    expect(none.redeemCode).not.toHaveBeenCalled();
  });

  it('takes a pasted setup code whole in "Have a code?", and in the setup code field', () => {
    show(signedOut(privateHome({ homeOnline: false })));
    fireEvent.paste(codeField(), { clipboardData: { getData: () => 'KQ27-JRMB-NVBU-4NAY-6F76' } });
    expect(codeField().value).toBe('KQ27-JRMB-NVBU-4NAY-6F76');
    cleanup();
    show(signedOut({ kind: 'setup', summary: SUMMARY, setupCode: '' }));
    const field = screen.getByRole('textbox', { name: 'Setup code' }) as HTMLInputElement;
    fireEvent.paste(field, { clipboardData: { getData: () => 'https://home-os-orpin.vercel.app/?setup=KQ27-JRMB-NVBU-4NAY-6F76' } });
    expect(field.value).toBe('KQ27-JRMB-NVBU-4NAY-6F76');
    expect((screen.getByRole('button', { name: 'Bring It Online' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('points a setup link opened in Safari on an iPhone at the Home Screen app, with the code to copy', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const home = show(
      signedOut({
        kind: 'setupElsewhere',
        setupCode: 'K7QMXRPWN9D3',
        summary: { ...SUMMARY, lastChanged: '2026-09-02T09:00:00.000Z' },
        saved: { ...SUMMARY, areas: 11, items: 21, done: 0 },
        ios: true,
      }),
    );
    expect(screen.getByText('Open home.os from your Home Screen.')).toBeTruthy();
    expect(
      screen.getByText('Your home is kept in the home.os app on your Home Screen, not in Safari. Open it there and enter this setup code.'),
    ).toBeTruthy();
    expect(screen.getByText('K7QM-XRPW-N9D3')).toBeTruthy();
    expect(screen.getByText('Setup code K 7 Q M, X R P W, N 9 D 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('K7QM-XRPW-N9D3'));
    // This browser's own copy, with its age, can still come online instead.
    expect(screen.getByText(/This browser has a copy too: Our home, 6\sareas · 19\sitems · 3\sdone, last changed Wed 2 Sep( 2026)?\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use This Copy Instead' }));
    expect(home.chooseSetupHere).toHaveBeenCalled();
    // The household's saved copy can come online from here too.
    expect(screen.getByText(/^Or bring your saved copy online: Our home, 11\sareas · 21\sitems\.$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use the Saved Copy' }));
    expect(home.chooseSavedCopy).toHaveBeenCalled();
    cleanup();
    show(signedOut({ kind: 'setupElsewhere', setupCode: 'K7QMXRPWN9D3', summary: null, saved: null, ios: false }));
    expect(screen.getByText('Open home.os where your home is.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use This Copy Instead' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use the Saved Copy' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    cleanup();
    show(signedOut({ kind: 'setupElsewhere', setupCode: 'K7QMXRPWN9D3', summary: null, saved: { ...SUMMARY, done: 0 }, ios: false }));
    expect(screen.getByText(/^Or bring your saved copy online from here: Our home, 6\sareas · 19\sitems\.$/)).toBeTruthy();
  });

  it('offers Continue with Google when it is on, and says why it came back without signing in', () => {
    const home = show(signedOut(privateHome({ google: true })));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(home.continueWithGoogle).toHaveBeenCalledTimes(1);
    cleanup();
    const coded = show(signedOut(privateHome({ google: true })));
    codeField();
    expect(screen.getByText('Sign in with Google to see your home.')).toBeTruthy();
    const google = screen.getByRole('button', { name: 'Continue with Google' });
    fireEvent.click(google);
    fireEvent.click(google);
    expect(coded.continueWithGoogle).toHaveBeenCalledTimes(1);
    expect(google.getAttribute('aria-busy')).toBe('true');
    cleanup();
    show(signedOut(privateHome({ google: true, notice: 'googleNotMember' })));
    expect(screen.getByRole('status').textContent).toBe(
      'That Google account isn’t in this home. Sign in with the one your home knows, or ask someone at home to add you.',
    );
    cleanup();
    show(signedOut(privateHome()));
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
    codeField();
    expect(screen.getByText('Ask someone at home for a code.')).toBeTruthy();
  });

  it('creates an account, signs in, and says what went wrong', async () => {
    const createAccount = vi.fn(async () => {
      throw new BackendError('email_taken');
    });
    const signInWithPassword = vi.fn(async () => {
      throw new BackendError('invalid_code');
    });
    const home = show(signedOut(privateHome(), { createAccount, signInWithPassword }));
    /** The fields the error marks (red, and described by it), by label. */
    const marked = () =>
      ['Your name', 'Email', 'Password'].filter((label) => {
        const field = screen.queryByLabelText(label);
        if (field?.getAttribute('aria-invalid') !== 'true') return false;
        expect(field.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
        return true;
      });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(screen.getByRole('alert').textContent).toBe('Add your name, your email, and a password of 6 or more characters.');
    expect(marked()).toEqual(['Your name', 'Email', 'Password']);
    expect(createAccount).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: ' Shea ' } });
    expect(marked()).toEqual([]);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' shea@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    // Only what is still missing is marked.
    expect(marked()).toEqual(['Password']);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hedgehog1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(home.createAccount).toHaveBeenCalledWith('Shea', 'shea@example.com', 'hedgehog1');
    // Taken: on to Sign In, the email kept; nothing to fix, so no field is marked.
    expect((await screen.findByRole('alert')).textContent).toBe('That email already has an account. Sign in instead.');
    expect(marked()).toEqual([]);
    expect(screen.getByText('Welcome back')).toBeTruthy();
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('shea@example.com');
    expect((screen.getByLabelText('Password') as HTMLInputElement).autocomplete).toBe('current-password');
    expect(screen.queryByLabelText('Your name')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(signInWithPassword).toHaveBeenCalledWith('shea@example.com', 'hedgehog1');
    expect((await screen.findByRole('alert')).textContent).toBe('Wrong password. Check it and try again.');
    expect(marked()).toEqual(['Password']);
  });

  it('sends Sign In with an email that has no account on to Create Account, keeping what was typed', async () => {
    const signInWithPassword = vi.fn(async () => {
      throw new BackendError('not_found');
    });
    const home = show(signedOut(privateHome(), { signInWithPassword }));
    fireEvent.click(screen.getByRole('button', { name: 'Have an account? Sign In' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'stratis@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'duckduck' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect((await screen.findByRole('alert')).textContent).toBe('There’s no account for this email yet. Add your name to create it.');
    // The name is what to add: that field is marked, not the password they typed.
    expect(screen.getByLabelText('Your name').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Password').hasAttribute('aria-invalid')).toBe(false);
    expect(screen.getByText('Join your home')).toBeTruthy();
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('stratis@example.com');
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('duckduck');
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Stratis' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(home.createAccount).toHaveBeenCalledWith('Stratis', 'stratis@example.com', 'duckduck');
  });

  it('takes the code out of a pasted message', () => {
    show(signedOut(privateHome()));
    const text = 'Join our home on home.os: https://home-os-orpin.vercel.app/?code=WXYZ-2345\nCode: WXYZ-2345';
    fireEvent.paste(codeField(), { clipboardData: { getData: () => text } });
    expect(codeField().value).toBe('WXYZ-2345');
    expect(joinButton().disabled).toBe(false);
  });

  it('deleting a hyphen deletes the letter beside it, so the hyphen does not just come back', () => {
    show(signedOut(privateHome()));
    fireEvent.change(codeField(), { target: { value: 'ABCDE' } });
    expect(codeField().value).toBe('ABCD-E');

    /** What the browser does: the text without the hyphen, the caret where it was, then input. */
    const edit = (value: string, caret: number, inputType: string) => {
      const field = codeField();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
      field.setSelectionRange(caret, caret);
      act(() => {
        field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
      });
    };
    act(() => codeField().focus());
    // Backspace in "ABCD-|E".
    edit('ABCDE', 4, 'deleteContentBackward');
    expect(codeField().value).toBe('ABCE');
    expect(codeField().selectionStart).toBe(3);

    // Delete (forward) in "ABCD|-EF".
    fireEvent.change(codeField(), { target: { value: 'ABCDEF' } });
    expect(codeField().value).toBe('ABCD-EF');
    edit('ABCDEF', 4, 'deleteContentForward');
    expect(codeField().value).toBe('ABCD-F');

    // Typing in the middle keeps the caret after the new letter: "AB|CD-F" + X.
    edit('ABXCD-F', 3, 'insertText');
    expect(codeField().value).toBe('ABXC-DF');
    expect(codeField().selectionStart).toBe(3);
  });
});

describe('Bring this home online', () => {
  const setup = (code = 'k7qm3xrpwn9d', over: Partial<HomeContextValue> = {}) =>
    show(signedOut({ kind: 'setup', summary: SUMMARY, setupCode: code }, over));

  it('shows what comes along and the setup code from the link, and nothing else', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Bring this home online' })).toBeTruthy();
    expect(screen.getByText('Our home')).toBeTruthy();
    expect(screen.getByText('21 Alderbrook Road')).toBeTruthy();
    expect(screen.getByText('6 areas · 19 items · 3 done')).toBeTruthy();
    const people = within(screen.getByRole('list', { name: 'People' })).getAllByRole('listitem');
    expect(people.map((p) => p.textContent)).toEqual(['🦆Stratis (you)', '🦔Shea']);

    const field = screen.getByRole('textbox', { name: 'Setup code' }) as HTMLInputElement;
    expect(field.value).toBe('K7QM-3XRP-WN9D');
    // The longest setup code, grouped (24 letters), goes in whole.
    expect(field.maxLength).toBe(29);
    expect(field.placeholder).toBe('XXXX-XXXX-XXXX');
    expect(field.getAttribute('autocapitalize')).toBe('characters');
    expect(field.getAttribute('autocomplete')).toBe('one-time-code');
    expect(screen.getByText('Everyone else joins with a code you send them from Profile.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Bring It Online' }) as HTMLButtonElement).disabled).toBe(false);
    // No Start Fresh, no Sign Out, no Google: only the saved copy as the other choice.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Use the Saved Copy Instead', 'Bring It Online']);
  });

  it('can bring the saved copy online instead, and says when it is the saved copy', () => {
    const home = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Use the Saved Copy Instead' }));
    expect(home.chooseSavedCopy).toHaveBeenCalled();
    cleanup();
    show(signedOut({ kind: 'setup', summary: { ...SUMMARY, lastChanged: '2026-09-02T09:00:00.000Z' }, setupCode: '', elsewhere: true, saved: true }));
    expect(screen.getByText('This is your saved copy of the home.')).toBeTruthy();
    expect(screen.queryByText(/^Last changed/)).toBeNull();
    expect(screen.queryByText('Use home.os from your Home Screen? Bring it online from there.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use the Saved Copy Instead' })).toBeNull();
  });

  it('says when the copy last changed, and on an iPhone browser tab that the Home Screen app may hold the home', () => {
    show(signedOut({ kind: 'setup', summary: { ...SUMMARY, lastChanged: '2026-09-02T09:00:00.000Z' }, setupCode: '', elsewhere: true }));
    expect(screen.getByText(/^Last changed Wed 2 Sep/)).toBeTruthy();
    expect(screen.getByText('Use home.os from your Home Screen? Bring it online from there.')).toBeTruthy();
  });

  it('pastes the setup code (from the link or on its own) into the field', async () => {
    const readText = vi.fn(async () => 'https://home-os-orpin.vercel.app/?setup=K7QM-3XRP-WN9D');
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true });
    show(signedOut({ kind: 'setup', summary: SUMMARY, setupCode: '' }));
    const field = screen.getByRole('textbox', { name: 'Setup code' }) as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }));
    await waitFor(() => expect(field.value).toBe('K7QM-3XRP-WN9D'));
    readText.mockResolvedValueOnce('hello');
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }));
    expect((await screen.findByRole('alert')).textContent).toBe('There’s no setup code to paste. Copy it from the link first.');
  });

  it('counts one of each as one, and leaves out nothing done', () => {
    show(signedOut({ kind: 'setup', summary: { ...SUMMARY, areas: 1, items: 1, done: 0 }, setupCode: '' }));
    expect(screen.getByText('1 area · 1 item')).toBeTruthy();
  });

  it('takes a typed code when there was no link, and is off until it is long enough', async () => {
    const home = setup('');
    const field = screen.getByRole('textbox', { name: 'Setup code' }) as HTMLInputElement;
    const bring = screen.getByRole('button', { name: 'Bring It Online' }) as HTMLButtonElement;
    expect(field.value).toBe('');
    expect(bring.disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'k7qm 3xrp wn9' } });
    expect(field.value).toBe('K7QM-3XRP-WN9');
    expect(bring.disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'k7qm 3xrp wn9d' } });
    expect(bring.disabled).toBe(false);
    fireEvent.click(bring);
    expect(home.bringHomeOnline).toHaveBeenCalledWith('K7QM-3XRP-WN9D');
    await act(async () => {});
  });

  it('is busy while it brings the home online, and says why when it could not', async () => {
    const bring = deferred();
    const home = setup('k7qm3xrpwn9d', { bringHomeOnline: vi.fn(() => bring.promise) });
    fireEvent.click(screen.getByRole('button', { name: 'Bring It Online' }));
    expect(home.bringHomeOnline).toHaveBeenCalledTimes(1);
    const busy = screen.getByRole('button', { name: 'Bringing It Online' });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(busy);
    expect(home.bringHomeOnline).toHaveBeenCalledTimes(1);
    await act(async () => bring.reject(new BackendError('invalid_code', 'invalid_code')));
    expect(screen.getByRole('alert').textContent).toBe('That code didn’t work. Check it, or ask for a new one.');
    expect(screen.getByRole('button', { name: 'Bring It Online' }).getAttribute('aria-busy')).toBeNull();
  });

  it('goes to "This home is private" when someone else brought one online first', async () => {
    setup('k7qm3xrpwn9d', {
      bringHomeOnline: vi.fn(async () => {
        setHome({ serverWelcome: privateHome({ notice: 'setupUsed' }) });
        throw new BackendError('home_exists', 'home_exists');
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Bring It Online' }));
    expect(await screen.findByText('This home is already online. Ask someone at home for a code.')).toBeTruthy();
    expect(codeField()).toBeTruthy();
  });
});

/** The home as it is online: emails are always '' in server mode. */
function serverData(members?: Member[]) {
  const data = sampleData();
  data.members = (members ?? data.members).map((m) => ({ ...m, email: '' }));
  return data;
}

describe('after signing in with a code', () => {
  it('welcomes someone a code made join, and "Not Shea?" says to ask for a new code', async () => {
    const shea = { id: 'u-shea', email: '', name: 'Shea' };
    const data = serverData([
      person({ id: 'm-stratis', name: 'Stratis', user_id: USER.id, emoji: '🦆', role: 'owner' }),
      person({ id: 'm-shea', name: 'Shea', user_id: shea.id, emoji: '🦔' }),
    ]);
    const home = show(
      makeHome({
        backend: server(),
        user: shea,
        data,
        phase: { kind: 'ready', user: shea },
        onboardingTail: true,
        claimed: true,
      }),
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome home, Shea' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Not Shea? Sign Out' }));
    const sheet = await screen.findByRole('alertdialog', { name: 'Not Shea?' });
    expect(within(sheet).getByText(/^You’ll be signed out/).textContent).toBe(
      'You’ll be signed out and Shea goes back to waiting to join. Ask someone at home for a new code.',
    );
    // Continue: the emoji, then (no notifications in server mode) the home.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(home.confirmClaimed).toHaveBeenCalledWith('🦔');
  });

  it('never asks about notifications: the home opens', async () => {
    const home = show(
      makeHome({ backend: server(), data: serverData(), onboardingTail: true, claimed: false, invitePeople: false }),
    );
    await waitFor(() => expect(home.finishOnboarding).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: /Notifications|Add to Home Screen/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Turn On/ })).toBeNull();
  });
});

describe('inviting the people who came along', () => {
  const CODE: IssuedCode = {
    code: 'ABCD-EFGH',
    link: 'https://home-os-orpin.vercel.app/?code=ABCD-EFGH',
    memberId: 'm-shea',
    expiresAt: '2026-10-15T09:00:00.000Z',
  };

  function inviting(over: Partial<HomeContextValue> = {}) {
    return show(
      makeHome({
        backend: server(),
        data: serverData(),
        onboardingTail: true,
        invitePeople: true,
        createCode: vi.fn(async (memberId: string) => ({ ...CODE, memberId })),
        ...over,
      }),
    );
  }

  it('lists everyone who has not joined, each with Invite', () => {
    inviting();
    expect(screen.getByRole('heading', { level: 1, name: 'Shea and Pat haven’t joined yet' })).toBeTruthy();
    expect(screen.getByText('Send each of them a code. They type it in home.os, or open the link.')).toBeTruthy();
    const rows = within(screen.getByRole('list', { name: 'People' })).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['🦔SheaInvite', '🐻PatInvite']);
    expect(screen.getByRole('button', { name: 'Invite Shea' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite Pat' })).toBeTruthy();
    expect(screen.getByText(/^You can invite them later in Profile/).textContent).toBe(
      'You can invite them later in Profile > Household > People.',
    );
    // No email fields here.
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Invite makes a code and shows it, Share sends the link and the code, Done goes back', async () => {
    const home = inviting();
    const share = vi.fn(async (_data: ShareData) => {});
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    const invite = screen.getByRole('button', { name: 'Invite Shea' });
    invite.focus();
    fireEvent.click(invite);
    expect(home.createCode).toHaveBeenCalledWith('m-shea');

    const sheet = await screen.findByRole('dialog', { name: 'Code for Shea' });
    expect(within(sheet).getByText('ABCD-EFGH')).toBeTruthy();
    // Read out a letter at a time.
    expect(within(sheet).getByText('A B C D, E F G H')).toBeTruthy();
    expect(sheet.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(sheet.getAttribute('aria-describedby')!)!.textContent).toBe(
      'Works once, for 7 days. On Shea’s phone, open home.os and enter it, or open the link.',
    );
    await waitFor(() => expect(document.activeElement).toBe(sheet));

    fireEvent.click(within(sheet).getByRole('button', { name: 'Share' }));
    expect(share).toHaveBeenCalledWith({
      title: 'Join our home on home.os',
      text: 'Join our home on home.os. Type this code in home.os: ABCD-EFGH\nOr open https://home-os-orpin.vercel.app/?code=ABCD-EFGH',
    });
    await act(async () => {});

    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Back to the button that asked for it.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Invite Shea' }));
  });

  it('copies the message where there is no share sheet, and says so in the sheet', async () => {
    inviting();
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Invite Pat' }));
    const sheet = await screen.findByRole('dialog', { name: 'Code for Pat' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(within(sheet).getByRole('status').textContent).toBe('Copied to share'));
    expect(writeText).toHaveBeenCalledWith(
      'Join our home on home.os. Type this code in home.os: ABCD-EFGH\nOr open https://home-os-orpin.vercel.app/?code=ABCD-EFGH',
    );
    // Escape closes it.
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('says why when a code could not be made', async () => {
    const home = inviting({
      createCode: vi.fn(async () => {
        throw new BackendError('network', 'offline');
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Invite Shea' }));
    await waitFor(() => expect(home.showToast).toHaveBeenCalledWith('No connection. Try again in a moment.'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Continue opens the home', () => {
    const home = inviting();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(home.doneInvitingPeople).toHaveBeenCalled();
  });
});
