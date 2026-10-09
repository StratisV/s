import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from './backend/types';

// A VAPID public key has the shape of an uncompressed P-256 point: 0x04 + 64 bytes, base64url.
const KEY_BYTES = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : (i * 37) % 256));
const VAPID_KEY = Buffer.from(KEY_BYTES).toString('base64url');
const OTHER_KEY_BYTES = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : (i * 11) % 256));

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const MAC_UA = IPAD_DESKTOP_UA;
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

type PushModule = typeof import('./push');

interface FakeSub {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON: () => PushSubscriptionJSON;
  getKey: (name: string) => ArrayBuffer | null;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function fakeSub(endpoint: string, key: Uint8Array | null = KEY_BYTES, json = true): FakeSub {
  return {
    endpoint,
    options: { applicationServerKey: key ? key.slice().buffer : null },
    toJSON: () => (json ? { endpoint, keys: { p256dh: `p256dh-${endpoint}`, auth: `auth-${endpoint}` } } : { endpoint }),
    getKey: (name: string) => new TextEncoder().encode(`${name}?`).buffer as ArrayBuffer,
    unsubscribe: vi.fn(async () => true),
  };
}

interface Env {
  ua?: string;
  platform?: string;
  maxTouchPoints?: number;
  /** (display-mode: standalone) matches. */
  standaloneMQ?: boolean;
  /** navigator.standalone (iOS Home Screen apps). */
  navStandalone?: boolean;
  /** Provide serviceWorker, PushManager and Notification. */
  pushApis?: boolean;
  permission?: NotificationPermission;
  /** What the permission prompt answers. */
  prompt?: NotificationPermission;
  /** Old Safari: requestPermission only takes a callback and returns undefined. */
  callbackOnly?: boolean;
  registered?: boolean;
  existingSub?: FakeSub | null;
}

function setup(env: Env = {}) {
  const calls: string[] = [];
  let registered = env.registered ?? false;
  let current: FakeSub | null = env.existingSub ?? null;

  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async (opts: PushSubscriptionOptionsInit) => {
      calls.push('subscribe');
      const key = new Uint8Array(opts.applicationServerKey as ArrayBuffer);
      current = fakeSub('https://push.example/new', key);
      return current;
    }),
  };
  const registration = { pushManager };
  const serviceWorker = {
    getRegistration: vi.fn(async () => {
      calls.push('getRegistration');
      return registered ? registration : undefined;
    }),
    register: vi.fn(async () => {
      calls.push('register');
      registered = true;
      return registration;
    }),
    get ready() {
      return Promise.resolve(registration);
    },
  };

  const requestPermission = vi.fn((cb?: (p: NotificationPermission) => void) => {
    calls.push('requestPermission');
    const answer = env.prompt ?? 'granted';
    notification.permission = answer;
    if (env.callbackOnly) {
      queueMicrotask(() => cb?.(answer));
      return undefined;
    }
    return Promise.resolve(answer);
  });
  const notification = { permission: env.permission ?? 'default', requestPermission };

  const navigator: Record<string, unknown> = {
    userAgent: env.ua ?? ANDROID_UA,
    platform: env.platform ?? 'Linux armv8l',
    maxTouchPoints: env.maxTouchPoints ?? 5,
  };
  if (env.navStandalone !== undefined) navigator.standalone = env.navStandalone;
  if (env.pushApis ?? true) navigator.serviceWorker = serviceWorker;

  vi.stubGlobal('navigator', navigator);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' && !!env.standaloneMQ }));
  if (env.pushApis ?? true) {
    vi.stubGlobal('PushManager', function PushManager() {});
    vi.stubGlobal('Notification', notification);
  }

  const backend = {
    savePushSubscription: vi.fn(async () => {
      calls.push('save');
    }),
    deletePushSubscription: vi.fn(async () => {
      calls.push('delete');
    }),
  };
  return {
    calls,
    pushManager,
    serviceWorker,
    requestPermission,
    backend,
    asBackend: backend as unknown as Backend,
    current: () => current,
  };
}

async function load(key = VAPID_KEY): Promise<PushModule> {
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', key);
  vi.resetModules();
  return import('./push');
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('configuration', () => {
  it('is configured only with a VAPID public key', async () => {
    setup({ permission: 'granted' });
    expect((await load('')).PUSH_CONFIGURED).toBe(false);
    expect((await load('   ')).PUSH_CONFIGURED).toBe(false);
    expect((await load()).PUSH_CONFIGURED).toBe(true);
  });

  it('reports unsupported without a key, even where the browser could push', async () => {
    setup({ permission: 'granted' });
    const push = await load('');
    expect(push.pushState()).toBe('unsupported');
    expect(await push.enablePush(setup().asBackend, 'm1')).toBe(false);
  });
});

describe('isIOS', () => {
  it('detects iPhone and iPad, including iPadOS asking for the desktop site', async () => {
    const push = await load();
    setup({ ua: IPHONE_UA, platform: 'iPhone' });
    expect(push.isIOS()).toBe(true);
    setup({ ua: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 5 });
    expect(push.isIOS()).toBe(true);
  });

  it('does not mistake a Mac or Android for iOS', async () => {
    const push = await load();
    setup({ ua: MAC_UA, platform: 'MacIntel', maxTouchPoints: 0 });
    expect(push.isIOS()).toBe(false);
    setup({ ua: ANDROID_UA });
    expect(push.isIOS()).toBe(false);
  });
});

describe('isStandalone', () => {
  it('uses the display-mode media query or navigator.standalone', async () => {
    const push = await load();
    setup({ standaloneMQ: true });
    expect(push.isStandalone()).toBe(true);
    setup({ navStandalone: true });
    expect(push.isStandalone()).toBe(true);
    setup({ navStandalone: false });
    expect(push.isStandalone()).toBe(false);
  });
});

describe('pushState', () => {
  it('asks iPhone Safari users to add the app to the Home Screen first', async () => {
    const push = await load();
    // Safari tabs on iOS have no PushManager or Notification at all.
    setup({ ua: IPHONE_UA, platform: 'iPhone', pushApis: false });
    expect(push.pushState()).toBe('needs-install');
    setup({ ua: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 5, pushApis: false });
    expect(push.pushState()).toBe('needs-install');
  });

  it('reports the permission inside the installed iOS app', async () => {
    const push = await load();
    setup({ ua: IPHONE_UA, platform: 'iPhone', navStandalone: true, permission: 'default' });
    expect(push.pushState()).toBe('default');
    setup({ ua: IPHONE_UA, platform: 'iPhone', standaloneMQ: true, permission: 'granted' });
    expect(push.pushState()).toBe('granted');
  });

  it('mirrors Notification.permission elsewhere', async () => {
    const push = await load();
    setup({ permission: 'granted' });
    expect(push.pushState()).toBe('granted');
    setup({ permission: 'denied' });
    expect(push.pushState()).toBe('denied');
    setup({ permission: 'default' });
    expect(push.pushState()).toBe('default');
  });

  it('is unsupported without the Push APIs', async () => {
    const push = await load();
    setup({ pushApis: false });
    expect(push.pushState()).toBe('unsupported');
  });

  it('never throws', async () => {
    const push = await load();
    setup();
    vi.stubGlobal('Notification', {
      get permission(): string {
        throw new Error('boom');
      },
    });
    expect(push.pushState()).toBe('unsupported');
    vi.stubGlobal('navigator', undefined);
    expect(push.pushState()).toBe('unsupported');
  });
});

describe('enablePush', () => {
  it('asks for permission before awaiting anything (Safari needs the tap)', async () => {
    const push = await load();
    const env = setup({ permission: 'default' });
    const pending = push.enablePush(env.asBackend, 'm1');
    // Synchronously, inside the "tap": the prompt and nothing else.
    expect(env.calls).toEqual(['requestPermission']);
    expect(await pending).toBe(true);
    expect(env.calls).toEqual(['requestPermission', 'getRegistration', 'register', 'subscribe', 'save']);
  });

  it('registers the service worker, subscribes with the VAPID key and saves the subscription', async () => {
    const push = await load();
    const env = setup({ permission: 'default' });
    expect(await push.enablePush(env.asBackend, 'member-1')).toBe(true);

    expect(env.serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(env.pushManager.subscribe).toHaveBeenCalledTimes(1);
    const opts = env.pushManager.subscribe.mock.calls[0][0];
    expect(opts.userVisibleOnly).toBe(true);
    expect(Array.from(new Uint8Array(opts.applicationServerKey as ArrayBuffer))).toEqual(Array.from(KEY_BYTES));
    expect(env.backend.savePushSubscription).toHaveBeenCalledWith('member-1', {
      endpoint: 'https://push.example/new',
      keys: { p256dh: 'p256dh-https://push.example/new', auth: 'auth-https://push.example/new' },
    });
  });

  it('works with the old callback-only requestPermission', async () => {
    const push = await load();
    const env = setup({ permission: 'default', callbackOnly: true });
    expect(await push.enablePush(env.asBackend, 'm1')).toBe(true);
    expect(env.backend.savePushSubscription).toHaveBeenCalledTimes(1);
  });

  it('skips the prompt when permission is already granted', async () => {
    const push = await load();
    const env = setup({ permission: 'granted' });
    expect(await push.enablePush(env.asBackend, 'm1')).toBe(true);
    expect(env.requestPermission).not.toHaveBeenCalled();
  });

  it('stops when the user says no', async () => {
    const push = await load();
    const env = setup({ permission: 'default', prompt: 'denied' });
    expect(await push.enablePush(env.asBackend, 'm1')).toBe(false);
    expect(env.serviceWorker.register).not.toHaveBeenCalled();
    expect(env.backend.savePushSubscription).not.toHaveBeenCalled();
  });

  it('does not prompt again once denied, nor outside the Home Screen app on iOS', async () => {
    const push = await load();
    let env = setup({ permission: 'denied' });
    expect(await push.enablePush(env.asBackend, 'm1')).toBe(false);
    expect(env.requestPermission).not.toHaveBeenCalled();

    env = setup({ ua: IPHONE_UA, platform: 'iPhone', permission: 'default' });
    expect(await push.enablePush(env.asBackend, 'm1')).toBe(false);
    expect(env.requestPermission).not.toHaveBeenCalled();
  });

  it('reuses an existing registration and subscription', async () => {
    const push = await load();
    const existing = fakeSub('https://push.example/old');
    const env = setup({ permission: 'granted', registered: true, existingSub: existing });
    expect(await push.enablePush(env.asBackend, 'm1')).toBe(true);
    expect(env.serviceWorker.register).not.toHaveBeenCalled();
    expect(env.pushManager.subscribe).not.toHaveBeenCalled();
    expect(env.backend.savePushSubscription).toHaveBeenCalledWith('m1', {
      endpoint: 'https://push.example/old',
      keys: { p256dh: 'p256dh-https://push.example/old', auth: 'auth-https://push.example/old' },
    });
  });

  it('replaces a subscription made with a different VAPID key', async () => {
    const push = await load();
    const stale = fakeSub('https://push.example/stale', OTHER_KEY_BYTES);
    const env = setup({ permission: 'granted', registered: true, existingSub: stale });
    expect(await push.enablePush(env.asBackend, 'm1')).toBe(true);
    expect(stale.unsubscribe).toHaveBeenCalled();
    expect(env.pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(env.backend.savePushSubscription).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ endpoint: 'https://push.example/new' }),
    );
  });

  it('reads the keys with getKey() when toJSON() leaves them out', async () => {
    const push = await load();
    const existing = fakeSub('https://push.example/bare', KEY_BYTES, false);
    const env = setup({ permission: 'granted', registered: true, existingSub: existing });
    expect(await push.enablePush(env.asBackend, 'm1')).toBe(true);
    expect(env.backend.savePushSubscription).toHaveBeenCalledWith('m1', {
      endpoint: 'https://push.example/bare',
      keys: {
        p256dh: Buffer.from('p256dh?').toString('base64url'),
        auth: Buffer.from('auth?').toString('base64url'),
      },
    });
  });

  it('resolves false instead of throwing when saving fails', async () => {
    const push = await load();
    const env = setup({ permission: 'granted' });
    env.backend.savePushSubscription.mockRejectedValueOnce(new Error('offline'));
    await expect(push.enablePush(env.asBackend, 'm1')).resolves.toBe(false);
  });
});

describe('disablePush', () => {
  it('removes the stored subscription and unsubscribes this device', async () => {
    const push = await load();
    const existing = fakeSub('https://push.example/mine');
    const env = setup({ permission: 'granted', registered: true, existingSub: existing });
    await push.disablePush(env.asBackend);
    expect(env.backend.deletePushSubscription).toHaveBeenCalledWith('https://push.example/mine');
    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(env.serviceWorker.getRegistration).toHaveBeenCalledWith('/');
  });

  it('does nothing when this device has no subscription', async () => {
    const push = await load();
    let env = setup({ permission: 'granted', registered: true, existingSub: null });
    await push.disablePush(env.asBackend);
    expect(env.backend.deletePushSubscription).not.toHaveBeenCalled();

    env = setup({ permission: 'granted', registered: false });
    await push.disablePush(env.asBackend);
    expect(env.backend.deletePushSubscription).not.toHaveBeenCalled();
    expect(env.serviceWorker.register).not.toHaveBeenCalled();
  });

  it('still unsubscribes the device when the backend call fails, and never throws', async () => {
    const push = await load();
    const existing = fakeSub('https://push.example/mine');
    const env = setup({ permission: 'granted', registered: true, existingSub: existing });
    env.backend.deletePushSubscription.mockRejectedValueOnce(new Error('offline'));
    await expect(push.disablePush(env.asBackend)).resolves.toBeUndefined();
    expect(existing.unsubscribe).toHaveBeenCalled();
  });

  it('copes with browsers without service workers', async () => {
    const push = await load();
    const env = setup({ pushApis: false });
    await expect(push.disablePush(env.asBackend)).resolves.toBeUndefined();
  });
});

describe('base64UrlToBytes', () => {
  it('decodes unpadded base64url', async () => {
    const push = await load();
    expect(Array.from(push.base64UrlToBytes(VAPID_KEY))).toEqual(Array.from(KEY_BYTES));
    expect(Array.from(push.base64UrlToBytes('-_8'))).toEqual([0xfb, 0xff]);
  });
});
