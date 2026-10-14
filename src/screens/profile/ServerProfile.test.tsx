import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { BackendError } from '../../lib/backend/types';
import type { DeviceInfo, IssuedCode, Member, NewPersonInput } from '../../lib/types';
import type { HomeContextValue } from '../../state/HomeProvider';
import { fakeBackend, makeHome, MockHome, mockHome, person, sampleData, setHome, USER } from '../testing/mockHome';
import { ProfileScreen } from './ProfileScreen';

vi.mock('../../state/HomeProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../state/HomeProvider')>();
  const { useMockHome } = await import('../testing/mockHome');
  return { ...actual, useHome: useMockHome, useHousehold: useMockHome };
});

function Cover() {
  const [open, setOpen] = useState(true);
  return <ProfileScreen open={open} onClose={() => setOpen(false)} />;
}

/** Thursdays and a Monday in October 2026 (today is Thu 8 Oct). */
const DEVICES: DeviceInfo[] = [
  { id: 'd-1', memberId: 'm-stratis', label: 'iPhone · Safari', createdAt: '2026-10-01T09:00:00.000Z', current: true },
  { id: 'd-2', memberId: 'm-stratis', label: 'Mac · Chrome', createdAt: '2026-10-05T18:00:00.000Z', current: false },
  { id: 'd-3', memberId: 'm-shea', label: 'iPhone · Safari', createdAt: '2026-10-08T07:30:00.000Z', current: false },
];

function code(memberId: string): IssuedCode {
  return {
    code: 'ABCD-EFGH',
    link: 'https://home-os-orpin.vercel.app/?code=ABCD-EFGH',
    memberId,
    expiresAt: '2026-10-15T09:00:00.000Z',
  };
}

/** The home online: Stratis (this browser), Shea (joined with a code), Pat (not joined); no emails. */
function serverHome(over: Partial<HomeContextValue> = {}): HomeContextValue {
  const data = sampleData();
  data.members = data.members.map((m: Member) => ({
    ...m,
    email: '',
    user_id: m.id === 'm-shea' ? 'u-shea' : m.user_id,
  }));
  let n = 0;
  return makeHome({
    backend: fakeBackend({ kind: 'server' } as never),
    data,
    listDevices: vi.fn(async () => DEVICES),
    createCode: vi.fn(async (memberId: string) => code(memberId)),
    addPerson: vi.fn(async (input: NewPersonInput) => {
      n += 1;
      const added = person({ id: `m-new-${n}`, name: input.name, emoji: input.emoji, email: input.email });
      setHome((h) => ({ data: { ...h.data!, members: [...h.data!.members, added] } }));
      return added;
    }),
    ...over,
  });
}

async function openProfile(home: HomeContextValue = serverHome()) {
  // StrictMode as in main.tsx: effects run twice on mount.
  render(
    <StrictMode>
      <MockHome initial={home}>
        <Cover />
      </MockHome>
    </StrictMode>,
  );
  const dialog = await screen.findByRole('dialog', { name: 'Profile' });
  await waitFor(() => expect(dialog.hasAttribute('data-shown')).toBe(true));
  return { home, dialog };
}

async function openPeople(home?: HomeContextValue) {
  const opened = await openProfile(home);
  fireEvent.click(screen.getByRole('button', { name: /^Household/ }));
  await screen.findByRole('heading', { name: 'Household', level: 1 });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Profile' })));
  return { ...opened, people: screen.getByRole('region', { name: 'People' }) };
}

async function openPersonPage(name: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
  await screen.findByRole('heading', { level: 1, name });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Household' })));
}

/** Add Person's Name field (the Household page underneath has a Name too). */
async function addPersonName(): Promise<HTMLInputElement> {
  const heading = await screen.findByRole('heading', { level: 1, name: 'Add Person' });
  return within(heading.parentElement!.parentElement!).getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
}

afterEach(() => cleanup());

describe('Profile in server mode', () => {
  it('names this device instead of Google, has phone notifications, and no weekly email or Invite someone', async () => {
    const { home } = await openProfile();
    expect(await screen.findByText('This device · iPhone · Safari')).toBeTruthy();
    expect(screen.queryByText('Signed in with Google')).toBeNull();
    expect(home.listDevices).toHaveBeenCalled();
    // Notifications are the server's phone notifications (ServerNotifications.test.tsx), not the email.
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Notifications on this device' })).toBeTruthy();
    expect(home.notifySettings).toHaveBeenCalled();
    expect(screen.queryByRole('switch', { name: /Push|Weekly/ })).toBeNull();
    expect(screen.queryByText(/Weekly email|Push notifications/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invite someone' })).toBeNull();
    expect(screen.queryByText(/Google email/)).toBeNull();
    expect(screen.getByRole('button', { name: /^Household/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeTruthy();
  });

  it('Add another device shows a code for yourself; Escape closes it and leaves Profile open', async () => {
    const { home } = await openProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Add another device' }));
    expect(home.createCode).toHaveBeenCalledWith('m-stratis');
    const sheet = await screen.findByRole('dialog', { name: 'Code for another device' });
    expect(within(sheet).getByText('ABCD-EFGH')).toBeTruthy();
    expect(
      within(sheet).getByText(
        'Works once, for 7 days. On your other phone or tablet, open home.os and enter it, or open the link.',
      ),
    ).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(sheet));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Code for another device' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Profile' })).toBeTruthy();
  });

  it('keeps Tab inside the code sheet', async () => {
    await openProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Add another device' }));
    const sheet = await screen.findByRole('dialog', { name: 'Code for another device' });
    await waitFor(() => expect(document.activeElement).toBe(sheet));
    const share = within(sheet).getByRole('button', { name: 'Share' });
    const done = within(sheet).getByRole('button', { name: 'Done' });
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(share);
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(done);
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(share);
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(done);
  });

  it('Sign Out says a new code is needed to get back in', async () => {
    const { home } = await openProfile();
    await screen.findByText('This device · iPhone · Safari');
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    const sheet = await screen.findByRole('alertdialog', { name: 'Sign out of home.os?' });
    expect(within(sheet).getByText('To sign in again, you’ll need a new code from someone at home.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Sign Out' }));
    expect(home.signOut).toHaveBeenCalled();
  });

  it('warns when this is the only device signed in to the home', async () => {
    await openProfile(serverHome({ listDevices: vi.fn(async () => [DEVICES[0]]) }));
    await screen.findByText('This device · iPhone · Safari');
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    const sheet = await screen.findByRole('alertdialog', { name: 'Sign out of home.os?' });
    expect(
      within(sheet).getByText(
        'This is the only device signed in to Our home. Add another device first, or nobody can make a code to get back in.',
      ),
    ).toBeTruthy();
  });
});

describe('People in server mode', () => {
  it('shows "Not joined yet" without any email', async () => {
    const { people } = await openPeople();
    const pat = within(people).getByRole('button', { name: /^Pat/ });
    expect(pat.textContent).toBe('🐻Pat, Not joined yet');
    expect(within(people).queryByText(/email/i)).toBeNull();
    // Shea has joined (with a code).
    expect(within(people).getByRole('button', { name: /^Shea/ }).textContent).toBe('🦔Shea');
  });

  it('someone not joined: Invite instead of a Google email, and Remove as before', async () => {
    const { home } = await openPeople();
    await openPersonPage('Pat');
    expect(screen.queryByRole('textbox', { name: 'Google Email' })).toBeNull();
    expect(screen.queryByText(/Google/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Pat' })).toBeTruthy();
    // No devices for someone who hasn't joined.
    expect(screen.queryByRole('heading', { name: 'Devices' })).toBeNull();

    const invite = screen.getByRole('button', { name: 'Invite Pat' });
    invite.focus();
    fireEvent.click(invite);
    expect(home.createCode).toHaveBeenCalledWith('m-pat');
    const sheet = await screen.findByRole('dialog', { name: 'Code for Pat' });
    expect(
      within(sheet).getByText('Works once, for 7 days. On Pat’s phone, open home.os and enter it, or open the link.'),
    ).toBeTruthy();
    // Escape closes the code sheet, not Pat's page.
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Code for Pat' })).toBeNull());
    expect(screen.getByRole('heading', { level: 1, name: 'Pat' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Invite Pat' }));
  });

  it('someone who has joined: their devices, each with Remove, and a code for a new phone once none is signed in', async () => {
    const { home } = await openPeople();
    await openPersonPage('Shea');
    const devices = screen.getByRole('region', { name: 'Devices' });
    await within(devices).findByText('Signed in Thu 8 Oct');
    expect(within(devices).getAllByText('iPhone · Safari')).toHaveLength(1);
    // Only Shea's.
    expect(within(devices).queryByText('Mac · Chrome')).toBeNull();
    // While she is signed in somewhere, only she can add a device (a code would let anyone be her).
    expect(within(devices).queryByRole('button', { name: 'Sign in on a new phone' })).toBeNull();
    expect(
      within(devices).getByText(
        'Only Shea can sign in on another device, from their Profile. If they lost their phone, remove it here, then send them a code.',
      ),
    ).toBeTruthy();

    fireEvent.click(within(devices).getByRole('button', { name: 'Remove iPhone · Safari, signed in Thu 8 Oct' }));
    const sheet = await screen.findByRole('alertdialog', { name: 'Remove this device?' });
    expect(within(sheet).getByText('It will need a new code to get back in.')).toBeTruthy();
    (home.listDevices as ReturnType<typeof vi.fn>).mockImplementation(async () => DEVICES.slice(0, 2));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(home.removeDevice).toHaveBeenCalledWith('d-3'));
    await within(devices).findByText('No devices signed in.');

    fireEvent.click(within(devices).getByRole('button', { name: 'Sign in on a new phone' }));
    expect(home.createCode).toHaveBeenCalledWith('m-shea');
    expect(await screen.findByRole('dialog', { name: 'Code for Shea' })).toBeTruthy();
  });

  it('your own page: this device marked, and a new phone is "another device"', async () => {
    const { home } = await openPeople();
    await openPersonPage('Stratis');
    const devices = screen.getByRole('region', { name: 'Devices' });
    const rows = await within(devices).findAllByText(/^Signed in|^This device/);
    expect(rows.map((r) => r.textContent)).toEqual([', This device · Signed in Thu 1 Oct', ', Signed in Mon 5 Oct']);
    expect(
      within(devices).getByRole('button', { name: 'Remove iPhone · Safari, signed in Thu 1 Oct, this device' }),
    ).toBeTruthy();
    fireEvent.click(within(devices).getByRole('button', { name: 'Sign in on a new phone' }));
    expect(home.createCode).toHaveBeenCalledWith('m-stratis');
    expect(await screen.findByRole('dialog', { name: 'Code for another device' })).toBeTruthy();
  });

  it('says so when a device was gone already, and when the list could not load (Try Again)', async () => {
    let fail = true;
    const { home } = await openPeople(
      serverHome({
        listDevices: vi.fn(async () => {
          if (fail) throw new BackendError('network', 'offline');
          return DEVICES;
        }),
        removeDevice: vi.fn(async () => {
          throw new BackendError('not_found', 'gone');
        }),
      }),
    );
    await openPersonPage('Shea');
    const devices = screen.getByRole('region', { name: 'Devices' });
    expect(await within(devices).findByText('No connection. Try again in a moment.')).toBeTruthy();
    fail = false;
    fireEvent.click(within(devices).getByRole('button', { name: 'Try Again' }));
    await within(devices).findByText('Signed in Thu 8 Oct');

    fireEvent.click(within(devices).getByRole('button', { name: /^Remove iPhone/ }));
    const sheet = await screen.findByRole('alertdialog', { name: 'Remove this device?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(home.showToast).toHaveBeenCalledWith('That was removed by someone else.'));
  });

  it('Add Person asks for a name and an emoji only, and says what comes next', async () => {
    const { home } = await openPeople();
    fireEvent.click(screen.getByRole('button', { name: 'Add Person' }));
    const name = await addPersonName();
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(screen.queryByRole('textbox', { name: 'Google Email' })).toBeNull();
    expect(screen.getByText('Then send them a code from their page.')).toBeTruthy();
    expect(name.getAttribute('enterkeyhint')).toBe('done');

    fireEvent.change(name, { target: { value: 'Robin' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    await waitFor(() => expect(home.addPerson).toHaveBeenCalledWith({ name: 'Robin', emoji: expect.any(String), email: '' }));
    await waitFor(() => expect(mockHome.value.data!.members.some((m) => m.name === 'Robin')).toBe(true));
  });

  it('Add Person says why in a toast when it could not be saved', async () => {
    const { home } = await openPeople(
      serverHome({
        addPerson: vi.fn(async () => {
          throw new BackendError('read_only', 'read_only');
        }),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add Person' }));
    const name = await addPersonName();
    fireEvent.change(name, { target: { value: 'Robin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(home.showToast).toHaveBeenCalledWith('Couldn’t save. Saving is paused until next month.'));
    // The page keeps what was typed.
    expect(name.value).toBe('Robin');
    await act(async () => {});
  });
});

describe('Profile outside server mode', () => {
  it('still offers Google, notifications and Invite someone', async () => {
    const home = makeHome();
    await openProfile(home);
    expect(screen.getByText('Signed in with Google')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite someone' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add another device' })).toBeNull();
    expect(home.listDevices).not.toHaveBeenCalled();
    expect(USER.email).toBeTruthy();
  });
});

describe('codes that could not be made', () => {
  it('says so when the person signed in meanwhile (only they can add a device now)', async () => {
    const { codeErrorMessage } = await import('./CodeSheet');
    const { BackendError } = await import('../../lib/backend/types');
    expect(codeErrorMessage(new BackendError('unknown', 'forbidden: Shea is signed in already'), 'Shea')).toBe(
      'Shea signed in meanwhile, so only they can add a device now.',
    );
    expect(codeErrorMessage(new BackendError('network'), 'Shea')).toBe('No connection. Try again in a moment.');
  });
});
