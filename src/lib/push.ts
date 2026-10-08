// STUB: replaced by the Supabase/push agent. The exported API below is the contract.
import type { Backend } from './backend/types';

/**
 * - 'unsupported': this browser can't do Web Push (or no VAPID key configured).
 * - 'needs-install': iPhone/iPad Safari outside the Home Screen app (iOS only allows
 *   Web Push after "Add to Home Screen").
 * - 'denied' | 'default' | 'granted': Notification.permission.
 */
export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'default' | 'granted';

/** True when VITE_VAPID_PUBLIC_KEY is set. */
export const PUSH_CONFIGURED = false;

export function isIOS(): boolean {
  return false;
}

/** Running as an installed app (Home Screen / standalone display mode). */
export function isStandalone(): boolean {
  return false;
}

export function pushState(): PushState {
  return 'unsupported';
}

/**
 * Must be called from a tap. Registers the service worker, asks for
 * permission, subscribes and saves the subscription for this member.
 * Resolves true when this device will receive pushes.
 */
export async function enablePush(_backend: Backend, _memberId: string): Promise<boolean> {
  return false;
}

/** Unsubscribes this device and removes its stored subscription. */
export async function disablePush(_backend: Backend): Promise<void> {}
