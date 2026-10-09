// Web Push on this device: permission, service worker subscription, and the stored copy
// the scheduler Edge Function sends to. iPhone and iPad only allow Web Push from an app
// added to the Home Screen (iOS 16.4+), so Safari tabs report 'needs-install'.
//
// This only manages the device. Whether a member wants pushes at all is members.push_enabled,
// which the UI sets with updateMember().
import type { Backend } from './backend/types';
import type { PushSubscriptionInput } from './types';

/**
 * - 'unsupported': this browser can't do Web Push (or no VAPID key configured).
 * - 'needs-install': iPhone/iPad Safari outside the Home Screen app (iOS only allows
 *   Web Push after "Add to Home Screen").
 * - 'denied' | 'default' | 'granted': Notification.permission.
 */
export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'default' | 'granted';

const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '').trim();

/** True when VITE_VAPID_PUBLIC_KEY is set. */
export const PUSH_CONFIGURED = VAPID_PUBLIC_KEY.length > 0;

/** How long to wait for the service worker to become active before giving up. */
const SW_READY_TIMEOUT_MS = 15_000;

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ asks for desktop sites and reports itself as a Mac; only the touch screen gives it away.
  const touch = (navigator.maxTouchPoints ?? 0) > 1;
  return touch && (navigator.platform === 'MacIntel' || /Macintosh/.test(ua));
}

/** Running as an installed app (Home Screen / standalone display mode). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  } catch {
    /* matchMedia unavailable */
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function hasPushApis(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Never throws. */
export function pushState(): PushState {
  try {
    if (!PUSH_CONFIGURED || typeof window === 'undefined' || typeof navigator === 'undefined') {
      return 'unsupported';
    }
    // Checked before the APIs: Safari tabs on iOS don't expose PushManager at all.
    if (isIOS() && !isStandalone()) return 'needs-install';
    if (!hasPushApis()) return 'unsupported';
    const permission = Notification.permission;
    return permission === 'granted' || permission === 'denied' ? permission : 'default';
  } catch {
    return 'unsupported';
  }
}

/**
 * Must be called from a tap. Registers the service worker, asks for
 * permission, subscribes and saves the subscription for this member.
 * Resolves true when this device will receive pushes. Never throws: anything
 * that goes wrong resolves false (and is logged).
 *
 * Safari only shows the permission prompt while it still counts as part of the
 * tap, so call this before awaiting anything else in the handler.
 */
export async function enablePush(backend: Backend, memberId: string): Promise<boolean> {
  try {
    const state = pushState();
    if (state === 'unsupported' || state === 'needs-install' || state === 'denied') return false;
    // The first await: nothing may come before the prompt.
    const permission = state === 'granted' ? 'granted' : await requestPermission();
    if (permission !== 'granted') return false;

    const registration = await readyRegistration();
    const key = base64UrlToBytes(VAPID_PUBLIC_KEY);
    let sub = await registration.pushManager.getSubscription();
    if (sub && !sameKey(sub.options?.applicationServerKey ?? null, key)) {
      // Subscribed with an old VAPID key: the server can't send to it any more.
      await sub.unsubscribe().catch(() => false);
      sub = null;
    }
    if (!sub) {
      sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    await backend.savePushSubscription(memberId, toInput(sub));
    return true;
  } catch (err) {
    console.warn('home.os: could not turn on push notifications', err);
    return false;
  }
}

/** Whether this device currently holds a push subscription for the app. Never throws. */
export async function hasPushSubscription(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    return !!(await registration?.pushManager?.getSubscription());
  } catch {
    return false;
  }
}

/** Unsubscribes this device and removes its stored subscription. Never throws. */
export async function disablePush(backend: Backend): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    const sub = await registration?.pushManager?.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    // Forget it on the server first, so nothing is sent even if the browser step fails.
    try {
      await backend.deletePushSubscription(endpoint);
    } catch (err) {
      // Once the browser unsubscribes, the push service rejects sends and the scheduler
      // deletes the stale row itself.
      console.warn('home.os: could not remove the stored push subscription', err);
    }
    await sub.unsubscribe();
  } catch (err) {
    console.warn('home.os: could not turn off push notifications', err);
  }
}

// ── Helpers ────────────────────────────────────────────────

/** Notification.requestPermission(), including old Safari's callback-only form. */
function requestPermission(): Promise<NotificationPermission> {
  return new Promise((resolve, reject) => {
    const result = Notification.requestPermission(resolve);
    if (result && typeof result.then === 'function') result.then(resolve, reject);
  });
}

/** The app's service worker registration once it is active (registering it if needed). */
async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  const base = import.meta.env.BASE_URL;
  const existing = await navigator.serviceWorker.getRegistration(base);
  if (!existing) await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('service worker did not become ready')), SW_READY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** VAPID public keys are base64url without padding. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sameKey(current: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (!current) return true; // The browser doesn't say: keep the subscription.
  const a = new Uint8Array(current);
  return a.length === wanted.length && a.every((b, i) => b === wanted[i]);
}

function toInput(sub: PushSubscription): PushSubscriptionInput {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh ?? keyFrom(sub, 'p256dh');
  const auth = json.keys?.auth ?? keyFrom(sub, 'auth');
  const endpoint = json.endpoint ?? sub.endpoint;
  if (!endpoint || !p256dh || !auth) throw new Error('push subscription has no keys');
  return { endpoint, keys: { p256dh, auth } };
}

function keyFrom(sub: PushSubscription, name: PushEncryptionKeyName): string | undefined {
  const key = sub.getKey?.(name);
  return key ? bytesToBase64Url(key) : undefined;
}
