import { useState } from 'react';
import { APP_NAME } from '../../lib/constants';
import { enablePush, pushState, type PushState } from '../../lib/push';
import { useHome } from '../../state/HomeProvider';
import { Avatar } from '../../ui/Avatar';
import { ShareIcon } from '../../ui/icons';
import styles from './NotificationsStep.module.css';
import shared from './Onboarding.module.css';
import { PrimaryButton, StepPage, type Enter } from './StepPage';

/**
 * Step 4, right after creating or joining: ask for notifications, but only
 * after a tap. iPhone Safari first needs the app on the Home Screen.
 */
export function NotificationsStep({ enter }: { enter: Enter }) {
  const { backend, me, updateMember, finishOnboarding, showToast } = useHome();
  const [state, setState] = useState<PushState>(() => pushState());
  const [busy, setBusy] = useState(false);

  // 'granted' only means this browser allowed it before; this member still has to opt in.
  const offer = state === 'default' || (state === 'granted' && !me?.push_enabled);

  const turnOn = () => {
    if (busy || !me) return;
    // Nothing may be awaited before this: Safari only prompts while it still counts as the tap.
    const pending = enablePush(backend, me.id);
    setBusy(true);
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
        if (now !== 'denied') showToast('Notifications are still off. You can turn them on in your profile.');
      }
      setBusy(false);
    });
  };

  if (state === 'needs-install') {
    return (
      <StepPage label="Add to Home Screen" enter={enter} nav={null}>
        <div className={shared.hero}>
          <Icon emoji="📲" />
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
            </span>
          </li>
          <li className={styles.step}>
            <span className={styles.number} aria-hidden="true">
              2
            </span>
            <span className={styles.stepText}>
              Choose <strong>Add to Home Screen</strong>
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
        <div className={shared.spacer} />
        <div className={shared.footer}>
          <PrimaryButton onClick={finishOnboarding}>Continue</PrimaryButton>
        </div>
      </StepPage>
    );
  }

  if (offer) {
    return (
      <StepPage label="Notifications" enter={enter} nav={null}>
        <div className={shared.hero}>
          <Icon emoji="🔔" />
          <h1 className={shared.title}>Turn On Notifications</h1>
          <p className={shared.subtitle}>
            Get a reminder before something is due, and a nudge the morning after a deadline is missed.
          </p>
        </div>
        <div className={shared.spacer} />
        <div className={shared.footer}>
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
  if (state === 'granted') detail = 'Notifications are on. You will get a reminder before things are due.';
  else if (state === 'denied')
    detail = `Notifications are blocked for ${APP_NAME} in this browser. You will still get the weekly email.`;
  else detail = 'You will get a weekly email with everything your home needs.';

  return (
    <StepPage label="You're all set" enter={enter} nav={null}>
      <div className={shared.hero}>
        <Icon emoji={me?.emoji ?? '🎉'} />
        <h1 className={shared.title}>You&rsquo;re all set</h1>
        <p className={shared.subtitle}>{detail}</p>
      </div>
      <div className={shared.spacer} />
      <div className={shared.footer}>
        <PrimaryButton onClick={finishOnboarding}>Continue</PrimaryButton>
      </div>
    </StepPage>
  );
}

function Icon({ emoji }: { emoji: string }) {
  return <Avatar emoji={emoji} size={112} emojiSize={62} background="var(--card)" shadow="0 2px 12px rgba(0,0,0,0.06)" />;
}
