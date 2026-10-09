import { useState } from 'react';
import { APP_NAME } from '../../lib/constants';
import { enablePush, pushState, type PushState } from '../../lib/push';
import { useHome } from '../../state/HomeProvider';
import { ShareIcon } from '../../ui/icons';
import styles from './NotificationsStep.module.css';
import shared from './Onboarding.module.css';
import { HeroIcon, PrimaryButton, StepPage, type Enter } from './StepPage';

/**
 * Step 4, right after creating or joining: ask for notifications, but only
 * after a tap. iPhone Safari first needs the app on the Home Screen.
 */
export function NotificationsStep({ enter }: { enter: Enter }) {
  const { backend, me, updateMember, finishOnboarding } = useHome();
  const [state, setState] = useState<PushState>(() => pushState());
  const [busy, setBusy] = useState(false);
  // Shown above the buttons when a tap didn't turn them on (a toast would cover the buttons here).
  const [notice, setNotice] = useState<string | null>(null);

  // 'granted' only means this browser allowed it before; this member still has to opt in.
  const offer = state === 'default' || (state === 'granted' && !me?.push_enabled);

  const turnOn = () => {
    if (busy || !me) return;
    // Nothing may be awaited before this: Safari only prompts while it still counts as the tap.
    const pending = enablePush(backend, me.id);
    setBusy(true);
    setNotice(null);
    void pending.then(async (ok) => {
      if (ok) {
        try {
          await updateMember(me.id, { push_enabled: true });
          finishOnboarding();
          return;
        } catch {
          // updateMember already showed what went wrong; stay so they can try again.
        }
      } else {
        const now = pushState();
        setState(now);
        setNotice(
          now === 'granted'
            ? 'Couldn’t turn on notifications right now. You can try again from your profile.'
            : 'Notifications are still off. You can turn them on later in your profile.',
        );
      }
      setBusy(false);
    });
  };

  if (state === 'needs-install') {
    return (
      <StepPage label="Add to Home Screen" enter={enter} nav={null}>
        <div className={shared.heroBefore} />
        <div className={shared.hero}>
          <HeroIcon emoji="📲" />
          <h1 className={shared.title}>Add to Home Screen</h1>
          <p className={shared.subtitle}>iPhone only sends notifications to apps on the Home Screen.</p>
        </div>
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.number} aria-hidden="true">
              1
            </span>
            <span className={styles.stepText}>
              Tap Share{' '}
              <span className={styles.share}>
                <ShareIcon size={19} />
              </span>{' '}
              in Safari
              {/* iOS 26's compact Safari keeps Share in the ••• menu. */}
              <span className={styles.hint}>If you don’t see it, tap ••• first.</span>
            </span>
          </li>
          <li className={styles.step}>
            <span className={styles.number} aria-hidden="true">
              2
            </span>
            <span className={styles.stepText}>
              Scroll down and choose <strong>Add to Home Screen</strong>
            </span>
          </li>
          <li className={styles.step}>
            <span className={styles.number} aria-hidden="true">
              3
            </span>
            <span className={styles.stepText}>Open {APP_NAME} from your Home Screen</span>
          </li>
        </ol>
        <p className={shared.caption}>Then turn on notifications in your profile.</p>
        <div className={shared.heroAfter} />
        <div className={shared.footer}>
          <PrimaryButton onClick={finishOnboarding}>Continue</PrimaryButton>
        </div>
      </StepPage>
    );
  }

  if (offer) {
    return (
      <StepPage label="Notifications" enter={enter} nav={null}>
        <div className={shared.heroBefore} />
        <div className={shared.hero}>
          <HeroIcon emoji="🔔" />
          <h1 className={shared.title}>Get Reminders</h1>
          <p className={shared.subtitle}>
            Get a reminder before something is due, and a nudge the morning after a deadline is missed.
          </p>
        </div>
        <div className={shared.heroAfter} />
        <div className={shared.footer}>
          {notice ? (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          ) : null}
          <PrimaryButton onClick={turnOn} busy={busy}>
            Turn On Notifications
          </PrimaryButton>
          <button type="button" className={shared.textButton} onClick={finishOnboarding} disabled={busy}>
            Not Now
          </button>
        </div>
      </StepPage>
    );
  }

  let detail: string;
  if (state === 'granted') detail = 'Notifications are on. You’ll get a reminder before things are due.';
  else if (state === 'denied')
    detail = `Notifications are blocked for ${APP_NAME} in this browser. You’ll still get the weekly email.`;
  else detail = 'You’ll get a weekly email with everything your home needs.';

  return (
    <StepPage label="You're all set" enter={enter} nav={null}>
      <div className={shared.heroBefore} />
      <div className={shared.hero}>
        <HeroIcon emoji={me?.emoji ?? '🎉'} />
        <h1 className={shared.title}>You&rsquo;re all set</h1>
        <p className={shared.subtitle}>{detail}</p>
      </div>
      <div className={shared.heroAfter} />
      <div className={shared.footer}>
        <PrimaryButton onClick={finishOnboarding}>Continue</PrimaryButton>
      </div>
    </StepPage>
  );
}
