import { useEffect } from 'react';

/**
 * Keeps the screen on while `active` (the Screen Wake Lock API), where the browser offers it.
 * The lock lapses when the page is hidden, so it is asked for again on coming back.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || typeof document === 'undefined') return;
    const lock = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
    if (!lock?.request) return;
    let sentinel: WakeLockSentinel | null = null;
    let stopped = false;

    const request = async () => {
      if (stopped || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      try {
        const next = await lock.request('screen');
        if (stopped) {
          next.release().catch(() => undefined);
          return;
        }
        sentinel = next;
      } catch {
        // Refused (low battery, a setting): the screen may dim, and that is fine.
      }
    };

    void request();
    const onVisible = () => void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
  }, [active]);
}
