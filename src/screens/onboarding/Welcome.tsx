import { useEffect, useState } from 'react';
import { APP_NAME } from '../../lib/constants';
import { errorMessage, useHome, type ServerWelcome } from '../../state/HomeProvider';
import { Hero } from '../../ui/Hero';
import { useHeroAtTop } from '../../ui/StatusSky';
import { GoogleGIcon } from '../../ui/icons';
import shared from './Onboarding.module.css';
import { ServerSignIn } from './ServerSignIn';
import { StepPage, type Enter } from './StepPage';
import styles from './Welcome.module.css';

/**
 * Step 1 (signed out): the hero from the top of the screen, the wordmark and "Continue with
 * Google". In server mode there is no Google: "This home is private." and "Have a code?"
 * instead (ServerSignIn), and no demo note.
 */
export function Welcome({ enter }: { enter: Enter }) {
  const { backend, signIn, showToast, pendingInvite, serverWelcome } = useHome();
  const [busy, setBusy] = useState(false);
  // Server mode never offers Google, even before HomeProvider has worked out what to show.
  const server: ServerWelcome | null = serverWelcome ?? (backend.kind === 'server' ? { kind: 'checking' } : null);
  useHeroAtTop(true);

  // Back from Google with an error (cancelled, or the provider failed): say so once.
  useEffect(() => {
    if (backend.kind !== 'server' && backend.takeAuthError()) showToast("Couldn't sign in with Google. Try again.");
  }, [backend, showToast]);

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
    <StepPage label={`Welcome to ${APP_NAME}`} enter={enter} fullBleed>
      <div className={styles.hero}>
        <Hero />
      </div>
      <div className={styles.before} />
      <div className={styles.top}>
        <h1 className={styles.wordmark}>{APP_NAME}</h1>
        <p className={styles.tagline}>Everything your home needs, in one place.</p>
      </div>
      <div className={styles.after} />
      {server && server.kind !== 'setup' ? (
        <ServerSignIn welcome={server} />
      ) : (
        <GoogleFooter
          invited={!!pendingInvite}
          busy={busy}
          onContinue={() => void onContinue()}
          demo={backend.kind === 'demo'}
        />
      )}
    </StepPage>
  );
}

function GoogleFooter({
  invited,
  busy,
  onContinue,
  demo,
}: {
  invited: boolean;
  busy: boolean;
  onContinue(): void;
  demo: boolean;
}) {
  return (
    <div className={shared.footer}>
      {invited ? (
        <p className={styles.invite} role="status">
          <span className={styles.inviteIcon} aria-hidden="true">
            💌
          </span>
          <span>You&rsquo;ve been invited to join a home on {APP_NAME}.</span>
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
      {demo ? <p className={styles.note}>Demo mode: your data stays on this device.</p> : null}
    </div>
  );
}
