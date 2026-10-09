import { useEffect, useState } from 'react';
import { APP_NAME } from '../../lib/constants';
import { errorMessage, useHome } from '../../state/HomeProvider';
import { HomeScene } from '../../ui/HomeScene';
import { GoogleGIcon } from '../../ui/icons';
import shared from './Onboarding.module.css';
import { StepPage, type Enter } from './StepPage';
import styles from './Welcome.module.css';

/** Step 1 (signed out): the home scene, the wordmark and "Continue with Google". */
export function Welcome({ enter }: { enter: Enter }) {
  const { backend, signIn, showToast, pendingInvite } = useHome();
  const [busy, setBusy] = useState(false);

  // Coming back from Google with the browser's Back button restores this page as it was.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const onContinue = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Supabase leaves for Google here; the demo signs in and this screen goes away.
      await signIn();
    } catch (err) {
      setBusy(false);
      showToast(errorMessage(err));
    }
  };

  return (
    <StepPage label={`Welcome to ${APP_NAME}`} enter={enter}>
      <div className={styles.top}>
        <div className={styles.scene}>
          <HomeScene height={196} />
        </div>
        <h1 className={styles.wordmark}>{APP_NAME}</h1>
        <p className={styles.tagline}>Everything your home needs, in one place.</p>
      </div>
      <div className={shared.spacer} />
      <div className={shared.footer}>
        {pendingInvite ? (
          <p className={styles.invite} role="status">
            You&rsquo;ve been invited to join a home on {APP_NAME}.
          </p>
        ) : null}
        <button
          type="button"
          className={styles.google}
          onClick={onContinue}
          aria-busy={busy || undefined}
          aria-disabled={busy || undefined}
        >
          <GoogleGIcon size={20} />
          <span>Continue with Google</span>
        </button>
        {backend.kind === 'demo' ? <p className={styles.note}>Demo mode: your data stays on this device.</p> : null}
      </div>
    </StepPage>
  );
}
