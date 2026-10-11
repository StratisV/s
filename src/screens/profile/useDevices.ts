import { useCallback, useEffect, useRef, useState } from 'react';
import { todayIn, formatDay } from '../../lib/logic/dates';
import type { DeviceInfo, ISODate } from '../../lib/types';
import { errorMessage, useHome } from '../../state/HomeProvider';

export interface Devices {
  /** Every signed-in browser in the home, in sign-in order; null until loaded. */
  devices: DeviceInfo[] | null;
  /** Why loading them failed (the last try), or null. */
  error: string | null;
  reload(): void;
}

/**
 * The home's signed-in browsers (server mode), loaded when the page opens and again on
 * reload(). Off (`enabled` false): nothing is asked.
 */
export function useDevices(enabled: boolean): Devices {
  const { listDevices } = useHome();
  const list = useRef(listDevices);
  list.current = listDevices;
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    list
      .current()
      .then((next) => {
        if (!alive) return;
        setDevices(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (alive) setError(errorMessage(err));
      });
    return () => {
      alive = false;
    };
  }, [enabled, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { devices, error, reload };
}

/** "Signed in Sat 10 Oct" (the day in the household's time zone; the year when not this one's). */
export function signedInLabel(device: Pick<DeviceInfo, 'createdAt'>, today: ISODate, timeZone: string): string {
  const at = new Date(device.createdAt);
  if (Number.isNaN(at.getTime())) return 'Signed in';
  return `Signed in ${formatDay(todayIn(timeZone, at), today)}`;
}

/** This browser is the only one signed in to the home: signing it out would leave nobody to make a code. */
export function isLastDevice(devices: DeviceInfo[] | null, deviceId: string): boolean {
  return !!devices && devices.length === 1 && devices[0].id === deviceId;
}
