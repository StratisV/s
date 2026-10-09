import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, type StorageLike } from '../../lib/backend/demo';
import type { PushState } from '../../lib/push';
import { HomeProvider, useHome, type HomeContextValue } from '../../state/HomeProvider';
import { NotificationsSection } from './NotificationsSection';

// push.ts talks to the browser; the section only needs its answers.
const push = vi.hoisted(() => ({
  state: 'granted' as PushState,
  subscribed: false,
  enablePush: vi.fn<(backend: unknown, memberId: string) => Promise<boolean>>(),
  disablePush: vi.fn(async () => {}),
}));
vi.mock('../../lib/push', () => ({
  PUSH_CONFIGURED: true,
  isIOS: () => true,
  isStandalone: () => false,
  pushState: () => push.state,
  enablePush: push.enablePush,
  disablePush: push.disablePush,
  hasPushSubscription: async () => push.subscribed,
}));

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

function Ready({ expose }: { expose(home: HomeContextValue): void }) {
  const home = useHome();
  expose(home);
  if (home.phase.kind !== 'ready' || !home.data || !home.me) return null;
  return <NotificationsSection />;
}

/** Signed in as Stratis, who turned push on at some point (members.push_enabled). */
async function setup({ pushEnabled = true } = {}) {
  const backend = new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 });
  let home!: HomeContextValue;
  const view = render(
    <HomeProvider backend={backend}>
      <Ready expose={(h) => (home = h)} />
    </HomeProvider>,
  );
  await waitFor(() => expect(home.me).toBeTruthy());
  await act(async () => {
    await home.updateMember(home.me!.id, { push_enabled: pushEnabled });
  });
  return { backend, view, home: () => home };
}

const pushSwitch = () => screen.getByRole('switch', { name: 'Push notifications' });

beforeEach(() => {
  push.state = 'granted';
  push.subscribed = false;
  push.enablePush.mockReset();
  push.disablePush.mockClear();
});

afterEach(cleanup);

describe('NotificationsSection: push on this device', () => {
  it('is on when push is wanted, allowed and this device is subscribed', async () => {
    push.subscribed = true;
    await setup();
    await act(async () => {});
    expect(pushSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('is off after signing back in on a device that was unsubscribed, and a tap subscribes it again', async () => {
    const { backend, home } = await setup();
    await waitFor(() => expect(pushSwitch().getAttribute('aria-checked')).toBe('false'));
    expect((pushSwitch() as HTMLButtonElement).disabled).toBe(false);

    push.enablePush.mockImplementation(async () => {
      push.subscribed = true;
      return true;
    });
    fireEvent.click(pushSwitch());
    // Inside the tap (Safari only prompts then).
    expect(push.enablePush).toHaveBeenCalledWith(backend, home().me!.id);
    await waitFor(() => expect(pushSwitch().getAttribute('aria-checked')).toBe('true'));
    expect(home().me!.push_enabled).toBe(true);
  });

  it('is off when push is wanted but this browser no longer allows it', async () => {
    push.state = 'default';
    push.subscribed = true;
    await setup();
    await act(async () => {});
    expect(pushSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('checks again when the app comes back to the foreground', async () => {
    push.subscribed = true;
    await setup();
    await waitFor(() => expect(pushSwitch().getAttribute('aria-checked')).toBe('true'));

    push.subscribed = false; // e.g. the push service dropped the subscription
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(pushSwitch().getAttribute('aria-checked')).toBe('false'));
  });

  it('turns push off for the member and this device', async () => {
    push.subscribed = true;
    push.disablePush.mockImplementation(async () => {
      push.subscribed = false;
    });
    const { home } = await setup();
    await waitFor(() => expect(pushSwitch().getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(pushSwitch());
    await waitFor(() => expect(home().me!.push_enabled).toBe(false));
    await waitFor(() => expect(pushSwitch().getAttribute('aria-checked')).toBe('false'));
    expect(push.disablePush).toHaveBeenCalledTimes(1);
  });

  it('explains Add to Home Screen for both Safari layouts', async () => {
    push.state = 'needs-install';
    await setup({ pushEnabled: false });
    expect(screen.getByText(/add home\.os to your Home Screen/).textContent).toBe(
      'To get notifications on iPhone, add home.os to your Home Screen: tap Share  (or ••• then Share), then Add to Home Screen.',
    );
    expect((pushSwitch() as HTMLButtonElement).disabled).toBe(true);
  });
});
