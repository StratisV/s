import { useEffect, useRef, useState } from 'react';
import { useHome } from '../../state/HomeProvider';
import shared from './Onboarding.module.css';
import { HeroIcon, PrimaryButton, StepPage } from './StepPage';

interface ErrorScreenProps {
  message: string;
  /** It was the connection: "You're offline". */
  offline: boolean;
}

/**
 * Phase 'error': the home could not be opened (most often no connection when the app opened).
 * A hero step like the others, with Try Again; HomeProvider also tries again by itself when the
 * connection comes back or the app comes back into view, and every 15 s.
 */
export function ErrorScreen({ message, offline }: ErrorScreenProps) {
  const { retry } = useHome();
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const again = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await retry();
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const title = offline ? 'You’re offline' : 'Couldn’t open your home';
  return (
    <StepPage label={title} enter={null} nav={null}>
      <div className={shared.heroBefore} />
      <div className={shared.hero} role="alert">
        <HeroIcon emoji={offline ? '📡' : '🏚️'} />
        <h1 className={shared.title}>{title}</h1>
        <p className={shared.subtitle}>
          {offline ? 'Your home opens by itself as soon as you’re back online.' : message}
        </p>
      </div>
      <div className={shared.heroAfter} />
      <div className={shared.footer}>
        <PrimaryButton onClick={() => void again()} busy={busy}>
          Try Again
        </PrimaryButton>
      </div>
    </StepPage>
  );
}
