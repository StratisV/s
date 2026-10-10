import { useEffect, useRef, useState } from 'react';
import { errorMessage, useHome } from '../../state/HomeProvider';
import shared from './Onboarding.module.css';
import styles from './OneHome.module.css';
import { PEOPLE_PATH } from './setup';
import { HeroIcon, PrimaryButton, StepPage, type Enter } from './StepPage';

interface PrivateHomeProps {
  enter: Enter;
  /** The account's email, lower case ('' when it has none). */
  email: string;
  /** False: the account's email is not verified, so adding it would not match. */
  emailVerified: boolean;
  onSignOut(): void;
  signingOut: boolean;
}

/**
 * "This home is private" (phase 'private'; docs/ARCHITECTURE.md "One home"): a home exists
 * and nobody in it has this account's email. Says exactly what to do, checks again on a tap
 * (HomeProvider also does when the app comes back into view), and never offers a new home.
 */
export function PrivateHome({ enter, email, emailVerified, onSignOut, signingOut }: PrivateHomeProps) {
  const { recheckHome } = useHome();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const check = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Added meanwhile: the phase moves on and this screen goes away.
      await recheckHome();
    } catch (err) {
      if (alive.current) setError(errorMessage(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <StepPage label="This home is private" enter={enter} nav={null}>
      <div className={shared.heroBefore} />
      <div className={shared.hero}>
        <HeroIcon emoji="🔒" />
        <h1 className={shared.title}>This home is private</h1>
        <p className={shared.subtitle}>
          {email ? (
            <>
              Ask someone at home to add <strong className={styles.email}>{email}</strong> in {PEOPLE_PATH}, then
              check again.
            </>
          ) : (
            `Ask someone at home to add your Google email in ${PEOPLE_PATH}, then check again.`
          )}
        </p>
        {emailVerified ? null : (
          <p className={shared.subtitle}>Your Google account&rsquo;s email isn&rsquo;t verified yet, so it can&rsquo;t be matched.</p>
        )}
      </div>
      <div className={shared.heroAfter} />
      <div className={shared.footer}>
        <PrimaryButton onClick={() => void check()} busy={busy} disabled={signingOut}>
          Check Again
        </PrimaryButton>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <button type="button" className={shared.textButton} onClick={onSignOut} disabled={signingOut || busy}>
          Sign Out
        </button>
      </div>
    </StepPage>
  );
}
