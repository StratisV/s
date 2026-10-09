import { useEffect, useId, useState } from 'react';
import {
  disablePush,
  enablePush,
  hasPushSubscription,
  isIOS,
  PUSH_CONFIGURED,
  pushState,
  type PushState,
} from '../../lib/push';
import { useHousehold } from '../../state/HomeProvider';
import { ShareIcon } from '../../ui/icons';
import { Toggle } from '../../ui/Toggle';
import list from './List.module.css';

/**
 * Weekly email and push notifications for the signed-in member. The push
 * switch describes this device: it is on only when the member wants pushes,
 * this browser allows them and holds a subscription (signing out unsubscribes
 * the device but keeps push_enabled, so after signing back in it shows off
 * until a tap subscribes again).
 */
export function NotificationsSection() {
  const { backend, me, updateMember, showToast } = useHousehold();
  const headingId = useId();
  const [device, setDevice] = useState<PushState>(() => pushState());
  // Whether this device holds a push subscription; null while checking.
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  // While turning push on or off: the value being applied (shown optimistically).
  const [pending, setPending] = useState<boolean | null>(null);

  // Permission can change in Settings, and the subscription can go, while the app is in the background.
  useEffect(() => {
    let alive = true;
    const check = () => {
      setDevice(pushState());
      void hasPushSubscription().then((has) => {
        if (alive) setSubscribed(has);
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
  }, []);

  // Until the check answers, trust the saved setting (no flicker in the usual case).
  const pushOn = pending ?? (me.push_enabled && device === 'granted' && subscribed !== false);
  const canToggle = device === 'default' || device === 'granted';

  const setPush = (next: boolean) => {
    if (pending !== null) return;
    setPending(next);
    if (next) {
      // Nothing may be awaited before this: Safari only shows the permission
      // prompt while it still counts as part of the tap.
      void enablePush(backend, me.id)
        .then(async (ok) => {
          const now = pushState();
          setDevice(now);
          if (ok) {
            setSubscribed(true);
            await updateMember(me.id, { push_enabled: true });
          } else {
            showToast(
              now === 'denied' ? 'Notifications are blocked for home.os.' : "Couldn't turn on notifications. Try again.",
            );
          }
        })
        .catch(() => {})
        .finally(() => setPending(null));
    } else {
      void disablePush(backend)
        .then(() => updateMember(me.id, { push_enabled: false }))
        .catch(() => {})
        .finally(() => {
          setDevice(pushState());
          void hasPushSubscription().then(setSubscribed);
          setPending(null);
        });
    }
  };

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className={list.header}>
        Notifications
      </h2>
      <div className={list.card}>
        <div className={list.row}>
          <span className={list.label}>Weekly email</span>
          <Toggle
            label="Weekly email"
            checked={me.weekly_email}
            onChange={(weekly_email) => void updateMember(me.id, { weekly_email }).catch(() => {})}
          />
        </div>
        <div className={list.row}>
          <span className={list.label}>Push notifications</span>
          <Toggle label="Push notifications" checked={pushOn} disabled={!canToggle} onChange={setPush} />
        </div>
      </div>
      <PushCaption state={device} />
    </section>
  );
}

function PushCaption({ state }: { state: PushState }) {
  switch (state) {
    case 'needs-install':
      return (
        <p className={list.caption}>
          To get notifications on iPhone, add home.os to your Home Screen: tap Share{' '}
          <ShareIcon size={15} /> (or ••• then Share), then Add to Home Screen.
        </p>
      );
    case 'unsupported':
      return (
        <p className={list.caption}>
          {PUSH_CONFIGURED ? "This browser can't show notifications." : "Push notifications aren't set up yet."}
        </p>
      );
    case 'denied':
      return (
        <p className={list.caption}>
          {isIOS()
            ? 'Notifications are turned off for home.os. To allow them, open Settings, then Notifications, then home.os.'
            : "Notifications are blocked for home.os. Allow them in this site's settings in your browser, then come back."}
        </p>
      );
    default:
      return null;
  }
}
