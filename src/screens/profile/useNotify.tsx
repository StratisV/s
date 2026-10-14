import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { NotifyPrefs, NotifySettings, ReminderInput } from '../../lib/types';
import { errorMessage, notSavedMessage, useHome } from '../../state/HomeProvider';

/**
 * Profile's notifications in server mode (docs/ARCHITECTURE.md "Server mode (no setup)",
 * "Notifications"): the signed-in person's settings as the server keeps them, shared by the
 * Notifications section and the reminder page. Loaded when Profile opens and again when the
 * app comes back into view (another device may have changed them).
 */
export interface NotifyStore {
  /** Null until loaded. */
  settings: NotifySettings | null;
  /** Why loading failed (the last try), or null. */
  error: string | null;
  reload(): void;
  /** Ticks or unticks one choice: shown at once, put back with a toast when it can't be saved. */
  setPref(key: keyof NotifyPrefs, value: boolean): void;
  /** Saves a reminder; false (and a toast saying why) when it could not be. */
  saveReminder(reminder: ReminderInput): Promise<boolean>;
  /** Deletes a reminder; false (and a toast) when it could not be. */
  deleteReminder(id: string): Promise<boolean>;
  /** This device's subscription was just saved (true) or forgotten (false) on the server. */
  setSubscribed(on: boolean): void;
}

const NotifyContext = createContext<NotifyStore | null>(null);

export function useNotify(): NotifyStore {
  const store = useContext(NotifyContext);
  if (!store) throw new Error('useNotify used outside <NotifyProvider>');
  return store;
}

/** Holds the settings for the pages inside it. Off (`enabled` false): nothing is asked. */
export function NotifyProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const home = useHome();
  const actions = useRef(home);
  actions.current = home;
  const [settings, setSettings] = useState<NotifySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    actions.current
      .notifySettings()
      .then((next) => {
        if (!current) return;
        setSettings(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (current) setError(errorMessage(err));
      });
    return () => {
      current = false;
    };
  }, [enabled, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, reload]);

  /** Choices being saved, newest last: a later tap wins over an earlier answer. */
  const pending = useRef(0);

  const store = useMemo<NotifyStore>(
    () => ({
      settings,
      error,
      reload,
      setPref: (key, value) => {
        const before = settings?.prefs[key];
        if (before === undefined || before === value) return;
        setSettings((s) => (s ? { ...s, prefs: { ...s.prefs, [key]: value } } : s));
        const mine = ++pending.current;
        actions.current
          .setNotifyPrefs({ [key]: value })
          .then((next) => {
            if (alive.current && mine === pending.current) setSettings(next);
          })
          .catch((err: unknown) => {
            if (!alive.current) return;
            setSettings((s) => (s ? { ...s, prefs: { ...s.prefs, [key]: before } } : s));
            actions.current.showToast(notSavedMessage(err));
          });
      },
      saveReminder: async (reminder) => {
        try {
          const next = await actions.current.saveReminder(reminder);
          if (alive.current) setSettings(next);
          return true;
        } catch (err) {
          actions.current.showToast(notSavedMessage(err));
          return false;
        }
      },
      deleteReminder: async (id) => {
        try {
          const next = await actions.current.deleteReminder(id);
          if (alive.current) setSettings(next);
          return true;
        } catch (err) {
          actions.current.showToast(notSavedMessage(err));
          return false;
        }
      },
      setSubscribed: (on) => setSettings((s) => (s ? { ...s, subscribed: on } : s)),
    }),
    [settings, error, reload],
  );

  return <NotifyContext.Provider value={store}>{children}</NotifyContext.Provider>;
}
