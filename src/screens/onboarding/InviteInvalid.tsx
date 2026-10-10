import { useEffect, useRef, useState } from 'react';
import { errorMessage, useHome } from '../../state/HomeProvider';
import shared from './Onboarding.module.css';
import styles from './OneHome.module.css';
import { PEOPLE_PATH } from './setup';
import { HeroIcon, PrimaryButton, StepPage, type Enter } from './StepPage';

/** What Check Again found when nothing changed. */
export const NO_HOME_YET = 'No home here yet. Checked just now.';

interface InviteInvalidProps {
  enter: Enter;
  /** "Set up a new home instead": forget the link; Profile and Create home follow. */
  onDecline(): void;
}

/**
 * An invite link that is no longer valid, while no home exists (phase 'onboarding'; with a home,
 * the private screen says so instead). Most likely a link from before the home was set up here
 * (one shared from the demo, say): the person who sent it should sign in first and then add
 * this person. So the main action is Check Again, and setting up a new home is the quiet
 * alternative (Create Home then asks before making it).
 */
export function InviteInvalid({ enter, onDecline }: InviteInvalidProps) {
  const { recheckHome } = useHome();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
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
    setStatus(null);
    try {
      // A home set up meanwhile (or this person added to it): the phase moves on.
      await recheckHome();
      if (alive.current) setStatus(NO_HOME_YET);
    } catch (err) {
      if (alive.current) setError(errorMessage(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <StepPage label="Invite link not valid" enter={enter} nav={null}>
      <div className={shared.heroBefore} />
      <div className={shared.hero}>
        <HeroIcon emoji="📭" />
        <h1 className={shared.title}>Invite link not valid</h1>
        <p className={shared.subtitle}>
          It may have expired, as links last 14 days, or be from before your home was set up here. Ask whoever sent it to
          sign in to home.os first, then add you in {PEOPLE_PATH}.
        </p>
      </div>
      <div className={shared.heroAfter} />
      <div className={shared.footer}>
        <PrimaryButton onClick={() => void check()} busy={busy}>
          Check Again
        </PrimaryButton>
        <p className={styles.status} role="status">
          {status}
        </p>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <button type="button" className={shared.textButton} onClick={onDecline} disabled={busy}>
          Set up a new home instead
        </button>
      </div>
    </StepPage>
  );
}
