import { useEffect, useId, useState } from 'react';
import { REMINDERS_MAX } from '../../lib/backend/serverApi';
import { disablePush, enablePush, hasPushSubscription, isIOS, pushState, type PushState } from '../../lib/push';
import type { NotifyPrefs } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { CheckIcon, ChevronRightIcon, PlusIcon } from '../../ui/icons';
import { Toggle } from '../../ui/Toggle';
import { MORNING_NOTE, reminderDetail } from './reminders';
import { useNotify } from './useNotify';
import list from './List.module.css';
import people from './People.module.css';
import styles from './Notify.module.css';

/** What iOS needs before it allows notifications from a web app (the owner's words). */
export const IOS_INSTALL_NOTE = 'On iPhone, add home.os to your Home Screen first: Share, then Add to Home Screen.';

/** The three choices, in order, with what each one sends. */
const CHOICES: { key: keyof NotifyPrefs; label: string; detail: string }[] = [
  { key: 'weeklyStatus', label: 'Weekly status', detail: 'Mondays: what’s due this week, what’s overdue, what was done last week' },
  { key: 'housekeeping', label: 'Housekeeping report', detail: 'The morning after a visit: what was done, comments, price, your message' },
  { key: 'reminders', label: 'My reminders', detail: 'Your own, on the days you choose' },
];

interface ServerNotificationsProps {
  /**
   * Opens the reminder page: a reminder to change, or null for a new one. Focus comes back to
   * its row (data-reminder-row) or to Add Reminder (data-add-reminder) when the page closes.
   */
  onOpenReminder(id: string | null): void;
}

/**
 * Profile > Notifications in server mode (docs/ARCHITECTURE.md "Server mode (no setup)",
 * "Notifications"): phone notifications on this device (a switch: permission is asked from the
 * tap; on an iPhone outside the Home Screen app it says to add home.os there first), then what
 * the person gets on every device where they are on (three ticks, kept on the server), and
 * their own reminders (each opens its page; Add Reminder at the end).
 */
export function ServerNotifications({ onOpenReminder }: ServerNotificationsProps) {
  const { backend, me, showToast } = useHousehold();
  const notify = useNotify();
  const { settings } = notify;
  const headingId = useId();
  const remindersId = useId();
  const publicKey = settings?.publicKey ?? '';
  const [device, setDevice] = useState<PushState>(() => pushState(publicKey));
  // Whether this browser holds a push subscription; null while checking.
  const [browserSub, setBrowserSub] = useState<boolean | null>(null);
  // While turning it on or off: the value being applied (shown at once).
  const [pending, setPending] = useState<boolean | null>(null);

  // Permission can change in Settings, and the subscription can go, while the app is in the background.
  useEffect(() => {
    let alive = true;
    const check = () => {
      setDevice(pushState(publicKey));
      void hasPushSubscription().then((has) => {
        if (alive) setBrowserSub(has);
      });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [publicKey]);

  const on = pending ?? (device === 'granted' && browserSub === true && !!settings?.subscribed);
  const canToggle = !!settings && pending === null && (device === 'default' || device === 'granted');

  const setDevicePush = (next: boolean) => {
    if (pending !== null || !settings) return;
    setPending(next);
    if (next) {
      // Nothing may be awaited before this: Safari only shows the permission prompt while it
      // still counts as part of the tap.
      void enablePush(backend, me.id, publicKey)
        .then((ok) => {
          const now = pushState(publicKey);
          setDevice(now);
          if (ok) {
            setBrowserSub(true);
            notify.setSubscribed(true);
          } else {
            showToast(now === 'denied' ? 'Notifications are blocked for home.os.' : 'Couldn’t turn on notifications. Try again.');
          }
        })
        .catch(() => {})
        .finally(() => setPending(null));
    } else {
      void disablePush(backend)
        .then(() => notify.setSubscribed(false))
        .catch(() => {})
        .finally(() => {
          setDevice(pushState(publicKey));
          void hasPushSubscription().then(setBrowserSub);
          setPending(null);
        });
    }
  };

  const reminders = settings?.reminders ?? [];
  const full = reminders.length >= REMINDERS_MAX;

  return (
    <>
      <section aria-labelledby={headingId}>
        <h2 id={headingId} className={list.header}>
          Notifications
        </h2>
        <div className={list.card}>
          <div className={list.row}>
            <span className={list.label}>On this device</span>
            <Toggle label="Notifications on this device" checked={on} disabled={!canToggle} onChange={setDevicePush} />
          </div>
        </div>
        {notify.error && !settings ? (
          <p className={list.caption} role="alert">
            Couldn’t load your notifications.{' '}
            <button type="button" className={styles.inlineAction} onClick={notify.reload}>
              Try Again
            </button>
          </p>
        ) : settings ? (
          <DeviceCaption state={device} configured={!!settings.publicKey} />
        ) : null}

        <div className={`${list.card} ${styles.choices}`} role="group" aria-label="Send me">
          {CHOICES.map((choice) => (
            <ChoiceRow
              key={choice.key}
              label={choice.label}
              detail={choice.detail}
              checked={!!settings?.prefs[choice.key]}
              disabled={!settings}
              onChange={(value) => notify.setPref(choice.key, value)}
            />
          ))}
        </div>
        <p className={list.caption}>Sent to each device where you turn notifications on.</p>
      </section>

      {settings?.prefs.reminders ? (
        <section aria-labelledby={remindersId}>
          <h2 id={remindersId} className={list.header}>
            My reminders
          </h2>
          <div className={list.card}>
            {reminders.map((r) => (
              <button
                key={r.id}
                type="button"
                className={list.row}
                data-reminder-row={r.id}
                onClick={() => onOpenReminder(r.id)}
              >
                <span className={styles.text}>
                  <span className={styles.title}>{r.title}</span>
                  <span className={styles.detail}>{reminderDetail(r.days)}</span>
                </span>
                <ChevronRightIcon className={list.chevron} />
              </button>
            ))}
            <button
              type="button"
              className={`${list.row} ${people.addRow}`}
              onClick={() => onOpenReminder(null)}
              disabled={full}
              data-add-reminder
            >
              <span className={people.addIcon} aria-hidden="true">
                <PlusIcon size={18} strokeWidth={2.6} />
              </span>
              Add Reminder
            </button>
          </div>
          <p className={list.caption}>{full ? `You have ${REMINDERS_MAX} reminders, the most there can be.` : MORNING_NOTE}</p>
        </section>
      ) : null}
    </>
  );
}

/** A tick row: the choice, what it sends under it, and a checkmark when it is on. */
function ChoiceRow({
  label,
  detail,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onChange(next: boolean): void;
}) {
  const labelId = useId();
  const detailId = useId();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={detailId}
      className={list.row}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.text}>
        <span id={labelId} className={styles.title}>
          {label}
        </span>
        <span id={detailId} className={styles.detail}>
          {detail}
        </span>
      </span>
      <span className={styles.check} data-on={checked || undefined} aria-hidden="true">
        <CheckIcon size={20} strokeWidth={2.8} />
      </span>
    </button>
  );
}

/** Why the switch is off or can't be used on this device, if it needs saying. */
function DeviceCaption({ state, configured }: { state: PushState; configured: boolean }) {
  switch (state) {
    case 'needs-install':
      return <p className={list.caption}>{IOS_INSTALL_NOTE}</p>;
    case 'unsupported':
      return (
        <p className={list.caption}>{configured ? 'This browser can’t show notifications.' : 'Notifications aren’t set up yet.'}</p>
      );
    case 'denied':
      return (
        <p className={list.caption}>
          {isIOS()
            ? 'Notifications are turned off for home.os. To allow them, open Settings, then Notifications, then home.os.'
            : 'Notifications are blocked for home.os. Allow them in this site’s settings in your browser, then come back.'}
        </p>
      );
    default:
      return null;
  }
}
