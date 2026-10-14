import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { BackendError } from '../../lib/backend/types';
import type { PushState } from '../../lib/push';
import type { HomeContextValue } from '../../state/HomeProvider';
import { fakeBackend, fakeNotify, makeHome, MockHome, notifyActions } from '../testing/mockHome';
import { ProfileScreen } from './ProfileScreen';
import { daysLabel, reminderDetail } from './reminders';
import { IOS_INSTALL_NOTE } from './ServerNotifications';

vi.mock('../../state/HomeProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../state/HomeProvider')>();
  const { useMockHome } = await import('../testing/mockHome');
  return { ...actual, useHome: useMockHome, useHousehold: useMockHome };
});

// push.ts talks to the browser; Profile only needs its answers.
const push = vi.hoisted(() => ({
  state: 'default' as PushState,
  subscribed: false,
  enablePush: vi.fn<(backend: unknown, memberId: string, publicKey?: string) => Promise<boolean>>(),
  disablePush: vi.fn(async () => {}),
  keys: [] as (string | undefined)[],
}));
vi.mock('../../lib/push', () => ({
  PUSH_CONFIGURED: false,
  isIOS: () => true,
  isStandalone: () => false,
  pushState: (publicKey?: string) => {
    push.keys.push(publicKey);
    return publicKey ? push.state : 'unsupported';
  },
  enablePush: push.enablePush,
  disablePush: push.disablePush,
  hasPushSubscription: async () => push.subscribed,
}));

const KEY = 'BPublicKeyFromTheServer';

function Cover() {
  const [open, setOpen] = useState(true);
  return <ProfileScreen open={open} onClose={() => setOpen(false)} />;
}

/** Profile in server mode, with notifications as the server keeps them (`initial`). */
async function openProfile(initial: Parameters<typeof fakeNotify>[0] = { publicKey: KEY }, over: Partial<HomeContextValue> = {}) {
  const notify = fakeNotify(initial);
  const home = makeHome({ backend: fakeBackend({ kind: 'server' } as never), ...notifyActions(notify), ...over });
  render(
    <StrictMode>
      <MockHome initial={home}>
        <Cover />
      </MockHome>
    </StrictMode>,
  );
  const dialog = await screen.findByRole('dialog', { name: 'Profile' });
  await waitFor(() => expect(dialog.hasAttribute('data-shown')).toBe(true));
  // Loaded: the ticks can be used.
  await waitFor(() => expect((tick('Weekly status') as HTMLButtonElement).disabled).toBe(false));
  return { home, notify };
}

const deviceSwitch = () => screen.getByRole('switch', { name: 'Notifications on this device' });
const tick = (name: string) => screen.getByRole('checkbox', { name });

beforeEach(() => {
  push.state = 'default';
  push.subscribed = false;
  push.keys = [];
  push.enablePush.mockReset();
  push.disablePush.mockReset();
  push.disablePush.mockImplementation(async () => {});
});

afterEach(cleanup);

describe('Profile > Notifications in server mode: this device', () => {
  it('asks permission from the tap, with the server’s key, and shows it on once subscribed', async () => {
    const { home, notify } = await openProfile();
    expect(deviceSwitch().getAttribute('aria-checked')).toBe('false');
    expect((deviceSwitch() as HTMLButtonElement).disabled).toBe(false);
    push.enablePush.mockImplementation(async () => {
      push.subscribed = true;
      notify.state.settings.subscribed = true;
      return true;
    });
    fireEvent.click(deviceSwitch());
    // Inside the tap (Safari only prompts then), with the key the server gave.
    expect(push.enablePush).toHaveBeenCalledWith(home.backend, 'm-stratis', KEY);
    await waitFor(() => expect(deviceSwitch().getAttribute('aria-checked')).toBe('true'));
    expect(push.keys).toContain(KEY);
  });

  it('turns it off for this device', async () => {
    push.state = 'granted';
    push.subscribed = true;
    await openProfile({ publicKey: KEY, subscribed: true });
    await waitFor(() => expect(deviceSwitch().getAttribute('aria-checked')).toBe('true'));
    push.disablePush.mockImplementation(async () => {
      push.subscribed = false;
    });
    fireEvent.click(deviceSwitch());
    await waitFor(() => expect(deviceSwitch().getAttribute('aria-checked')).toBe('false'));
    expect(push.disablePush).toHaveBeenCalledTimes(1);
  });

  it('is off when the server has this device but the browser lost its subscription, or the other way round', async () => {
    push.state = 'granted';
    await openProfile({ publicKey: KEY, subscribed: true });
    await act(async () => {});
    expect(deviceSwitch().getAttribute('aria-checked')).toBe('false');
    cleanup();
    push.subscribed = true;
    await openProfile({ publicKey: KEY, subscribed: false });
    await act(async () => {});
    expect(deviceSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('says plainly what an iPhone needs in Safari: the Home Screen first', async () => {
    push.state = 'needs-install';
    await openProfile();
    expect(screen.getByText(IOS_INSTALL_NOTE).textContent).toBe(
      'On iPhone, add home.os to your Home Screen first: Share, then Add to Home Screen.',
    );
    expect((deviceSwitch() as HTMLButtonElement).disabled).toBe(true);
    // The choices are still there: they reach his other devices.
    expect((tick('Weekly status') as HTMLButtonElement).disabled).toBe(false);
  });

  it('says when notifications are blocked, or the server has no key yet', async () => {
    push.state = 'denied';
    await openProfile();
    expect(screen.getByText(/Notifications are turned off for home\.os/)).toBeTruthy();
    expect((deviceSwitch() as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    push.state = 'default';
    await openProfile({ publicKey: null });
    expect(screen.getByText('Notifications aren’t set up yet.')).toBeTruthy();
    expect((deviceSwitch() as HTMLButtonElement).disabled).toBe(true);
  });

  it('says so when permission is refused', async () => {
    const { home } = await openProfile();
    push.enablePush.mockImplementation(async () => {
      push.state = 'denied';
      return false;
    });
    fireEvent.click(deviceSwitch());
    await waitFor(() => expect(home.showToast).toHaveBeenCalledWith('Notifications are blocked for home.os.'));
    expect(deviceSwitch().getAttribute('aria-checked')).toBe('false');
  });
});

describe('Profile > Notifications in server mode: what to send', () => {
  it('ticks and unticks each choice on the server, for every device of his', async () => {
    const { notify } = await openProfile();
    for (const name of ['Weekly status', 'Housekeeping report', 'My reminders']) {
      expect(tick(name).getAttribute('aria-checked')).toBe('false');
    }
    expect(tick('Weekly status').getAttribute('aria-describedby')).toBeTruthy();
    fireEvent.click(tick('Weekly status'));
    expect(tick('Weekly status').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(tick('Housekeeping report'));
    await waitFor(() => expect(notify.state.settings.prefs).toEqual({ weeklyStatus: true, housekeeping: true, reminders: false }));
    expect(notify.setNotifyPrefs).toHaveBeenCalledWith({ weeklyStatus: true });
    expect(notify.setNotifyPrefs).toHaveBeenCalledWith({ housekeeping: true });
    fireEvent.click(tick('Weekly status'));
    await waitFor(() => expect(notify.state.settings.prefs.weeklyStatus).toBe(false));
    expect(screen.getByText('Sent to each device where you turn notifications on.')).toBeTruthy();
  });

  it('puts a tick back and says why when it could not be saved', async () => {
    const notify = fakeNotify({ publicKey: KEY });
    notify.setNotifyPrefs.mockRejectedValueOnce(new BackendError('read_only'));
    const { home } = await openProfile(undefined, notifyActions(notify));
    fireEvent.click(tick('Housekeeping report'));
    await waitFor(() => expect(home.showToast).toHaveBeenCalledWith('Couldn’t save. Saving is paused until next month.'));
    expect(tick('Housekeeping report').getAttribute('aria-checked')).toBe('false');
  });

  it('says when they could not be loaded, and tries again', async () => {
    const notify = fakeNotify({ publicKey: KEY });
    notify.notifySettings.mockRejectedValue(new BackendError('network'));
    const home = makeHome({ backend: fakeBackend({ kind: 'server' } as never), ...notifyActions(notify) });
    render(
      <MockHome initial={home}>
        <Cover />
      </MockHome>,
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Couldn’t load your notifications. Try Again');
    expect((tick('Weekly status') as HTMLButtonElement).disabled).toBe(true);
    notify.notifySettings.mockReset();
    notify.notifySettings.mockImplementation(async () => structuredClone(notify.state.settings));
    fireEvent.click(within(alert).getByRole('button', { name: 'Try Again' }));
    await waitFor(() => expect((tick('Weekly status') as HTMLButtonElement).disabled).toBe(false));
  });
});

describe('Profile > Notifications in server mode: my reminders', () => {
  it('lists them once My reminders is ticked, each with its days and the morning', async () => {
    await openProfile({
      publicKey: KEY,
      prefs: { weeklyStatus: false, housekeeping: false, reminders: false },
      reminders: [{ id: 'r-1', title: 'Take the bins out', days: [0] }],
    });
    expect(screen.queryByRole('heading', { name: 'My reminders' })).toBeNull();
    fireEvent.click(tick('My reminders'));
    // Shown at once; then stored.
    expect(screen.getByRole('heading', { name: 'My reminders' })).toBeTruthy();
    await act(async () => {});
    const section = screen.getByRole('region', { name: 'My reminders' });
    const row = within(section).getByRole('button', { name: /Take the bins out/ });
    expect(row.textContent).toBe('Take the bins outEvery Sunday · Morning');
    expect(within(section).getByRole('button', { name: 'Add Reminder' })).toBeTruthy();
    expect(screen.getByText('Reminders come in the morning, between 7 and 9.')).toBeTruthy();
  });

  it('adds one: a title, the days, Save; then it is listed and focus is back on Add Reminder', async () => {
    const { notify } = await openProfile({ publicKey: KEY, prefs: { weeklyStatus: false, housekeeping: false, reminders: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Reminder' }));
    const field = (await screen.findByRole('textbox', { name: 'Remind me to' })) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(field));
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText('Pick the days it should come on.')).toBeTruthy();
    fireEvent.change(field, { target: { value: 'Take the bins out' } });
    expect(save.disabled).toBe(true);
    const days = screen.getByRole('group', { name: 'Days' });
    expect(within(days).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    fireEvent.click(within(days).getByRole('button', { name: 'Sunday' }));
    expect(within(days).getByRole('button', { name: 'Sunday' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Morning')).toBeTruthy();
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Remind me to' })).toBeNull());
    expect(notify.saveReminder).toHaveBeenCalledWith({ title: 'Take the bins out', days: [0] });
    expect(screen.getByRole('button', { name: /Take the bins out/ }).textContent).toContain('Every Sunday · Morning');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add Reminder' })));
  });

  it('changes one: its title and days, kept as an edit of the same reminder', async () => {
    const { notify } = await openProfile({
      publicKey: KEY,
      prefs: { weeklyStatus: false, housekeeping: false, reminders: true },
      reminders: [{ id: 'r-1', title: 'Take the bins out', days: [0] }],
    });
    fireEvent.click(screen.getByRole('button', { name: /Take the bins out/ }));
    const field = (await screen.findByRole('textbox', { name: 'Remind me to' })) as HTMLInputElement;
    expect(field.value).toBe('Take the bins out');
    expect(screen.getByRole('button', { name: 'Sunday' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    fireEvent.change(field, { target: { value: 'Bins and recycling' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Remind me to' })).toBeNull());
    expect(notify.saveReminder).toHaveBeenCalledWith({ id: 'r-1', title: 'Bins and recycling', days: [0, 3] });
    const row = screen.getByRole('button', { name: /Bins and recycling/ });
    // The week starts on Monday.
    expect(row.textContent).toContain('Wed, Sun · Morning');
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it('deletes one', async () => {
    const { notify } = await openProfile({
      publicKey: KEY,
      prefs: { weeklyStatus: false, housekeeping: false, reminders: true },
      reminders: [{ id: 'r-1', title: 'Take the bins out', days: [0] }],
    });
    fireEvent.click(screen.getByRole('button', { name: /Take the bins out/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Reminder' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Take the bins out/ })).toBeNull());
    expect(notify.deleteReminder).toHaveBeenCalledWith('r-1');
  });

  it('keeps the page, and what was typed, when saving fails', async () => {
    const notify = fakeNotify({ publicKey: KEY, prefs: { weeklyStatus: false, housekeeping: false, reminders: true } });
    notify.saveReminder.mockRejectedValueOnce(new BackendError('network'));
    const { home } = await openProfile(undefined, notifyActions(notify));
    fireEvent.click(screen.getByRole('button', { name: 'Add Reminder' }));
    const field = (await screen.findByRole('textbox', { name: 'Remind me to' })) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Water the garden' } });
    fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(home.showToast).toHaveBeenCalledWith('Couldn’t save. No connection.'));
    expect((screen.getByRole('textbox', { name: 'Remind me to' }) as HTMLInputElement).value).toBe('Water the garden');
  });

  it('goes back with Escape, then Profile closes with the next one', async () => {
    await openProfile({ publicKey: KEY, prefs: { weeklyStatus: false, housekeeping: false, reminders: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Reminder' }));
    await screen.findByRole('textbox', { name: 'Remind me to' });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Remind me to' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Profile' })).toBeTruthy();
  });
});

describe('reminders’ words', () => {
  it('names the days: every day, weekdays, weekends, one day, else Monday first', () => {
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(daysLabel([5, 4, 3, 2, 1])).toBe('Weekdays');
    expect(daysLabel([6, 0])).toBe('Weekends');
    expect(daysLabel([0])).toBe('Every Sunday');
    expect(daysLabel([0, 3, 1, 3])).toBe('Mon, Wed, Sun');
    expect(reminderDetail([2])).toBe('Every Tuesday · Morning');
  });
});
