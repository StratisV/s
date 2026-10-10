import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DemoHomeSummary } from '../../lib/types';
import { errorMessage, useHome } from '../../state/HomeProvider';
import { summaryCounts } from './ImportHome';
import shared from './Onboarding.module.css';
import styles from './OneHome.module.css';
import { PEOPLE_PATH } from './setup';
import { HeroIcon, PrimaryButton, StepPage, type Enter } from './StepPage';

/** What Check Again found when nothing changed. */
export const NOT_ADDED_YET = 'Not added yet. Checked just now.';

interface PrivateHomeProps {
  enter: Enter;
  /** The account's email, lower case ('' when it has none). */
  email: string;
  /** False: the account's email is not verified, so adding it would not match. */
  emailVerified: boolean;
  /** A line above the ask (the invite link this person came with was no good). */
  notice?: string | null;
  /** The home this phone kept in demo mode, which can't come over now that a home exists. */
  phoneHome?: DemoHomeSummary | null;
  onSignOut(): void;
  signingOut: boolean;
}

/**
 * The email with line-break chances after the @ and before each dot, so a long one on a narrow
 * screen breaks as "robin.morgan.lewis@" / "gmail.com" rather than mid-word (the text stays the same).
 */
function breakable(email: string): ReactNode[] {
  const out: ReactNode[] = [];
  let part = '';
  for (const ch of email) {
    if (ch === '.' && part) {
      out.push(part, <wbr key={out.length} />);
      part = '';
    }
    part += ch;
    if (ch === '@') {
      out.push(part, <wbr key={out.length} />);
      part = '';
    }
  }
  if (part) out.push(part);
  return out;
}

/**
 * "This home is private" (phase 'private'; docs/ARCHITECTURE.md "One home"): a home exists
 * and nobody in it has this account's email. Says exactly what to do, checks again on a tap
 * (HomeProvider also does when the app comes back into view) and says when nothing changed,
 * and never offers a new home. When this phone kept a home in demo mode, it says that it
 * can't come over now.
 */
export function PrivateHome({ enter, email, emailVerified, notice, phoneHome, onSignOut, signingOut }: PrivateHomeProps) {
  const { recheckHome } = useHome();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
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
      // Added meanwhile: the phase moves on and this screen goes away.
      await recheckHome();
      if (alive.current) setStatus(NOT_ADDED_YET);
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
        {notice ? <p className={shared.subtitle}>{notice}</p> : null}
        <p className={shared.subtitle}>
          {email ? (
            <>
              Ask someone at home to add <strong className={styles.email}>{breakable(email)}</strong> in {PEOPLE_PATH}, then
              check again.
            </>
          ) : (
            `Ask someone at home to add your Google email in ${PEOPLE_PATH}, then check again.`
          )}
        </p>
        {emailVerified ? null : (
          <p className={shared.subtitle}>Your Google account&rsquo;s email isn&rsquo;t verified yet, so it can&rsquo;t be matched.</p>
        )}
        {phoneHome ? (
          <p className={`${shared.subtitle} ${styles.phoneHome}`}>
            This phone still has {phoneHome.householdName} ({summaryCounts(phoneHome)}). Someone has already set up a home
            here, so it can&rsquo;t be brought over now.
          </p>
        ) : null}
      </div>
      <div className={shared.heroAfter} />
      <div className={shared.footer}>
        <PrimaryButton onClick={() => void check()} busy={busy} disabled={signingOut}>
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
        <button type="button" className={shared.textButton} onClick={onSignOut} disabled={signingOut || busy}>
          Sign Out
        </button>
      </div>
    </StepPage>
  );
}
