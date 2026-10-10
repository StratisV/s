import { useEffect, useId, useRef, useState } from 'react';
import type { DemoHomeSummary } from '../../lib/types';
import { errorMessage, useHome } from '../../state/HomeProvider';
import { Avatar } from '../../ui/Avatar';
import shared from './Onboarding.module.css';
import styles from './OneHome.module.css';
import { PEOPLE_PATH } from './setup';
import { PrimaryButton, StepPage, type Enter } from './StepPage';

interface ImportHomeProps {
  enter: Enter;
  summary: DemoHomeSummary;
  onSignOut(): void;
  signingOut: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "6 areas · 19 items" (open items: the ones that show on Home). */
function summaryCounts(summary: Pick<DemoHomeSummary, 'areas' | 'items'>): string {
  return `${plural(summary.areas, 'area', 'areas')} · ${plural(summary.items, 'item', 'items')}`;
}

/**
 * "Bring over the home from this phone" (phase 'onboarding' with demoImport; docs/ARCHITECTURE.md
 * "Bring over the home from this phone"): the home this browser kept in demo mode, offered to
 * the first person to sign in while no home exists. Bring It Over imports it and opens it (no
 * Profile step: the demo name and emoji come along); Start Fresh goes on to Profile and Create
 * home.
 */
export function ImportHome({ enter, summary, onSignOut, signingOut }: ImportHomeProps) {
  const { importDemoHome, declineDemoImport } = useHome();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const peopleId = useId();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const bring = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // The home opens by itself (or, if someone set one up meanwhile, the phase that gives).
      await importDemoHome();
    } catch (err) {
      if (alive.current) setError(errorMessage(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <StepPage
      label="Bring over the home from this phone"
      enter={enter}
      nav={
        <button type="button" className={shared.navButton} onClick={onSignOut} disabled={signingOut || busy}>
          Sign Out
        </button>
      }
    >
      <div className={shared.titleBlock}>
        <h1 className={shared.title}>Bring over the home from this phone</h1>
      </div>

      <div className={`${shared.card} ${styles.summary}`} aria-busy={busy || undefined}>
        <div className={styles.home}>
          <p className={styles.homeName}>{summary.householdName}</p>
          {summary.address ? <p className={styles.detail}>{summary.address}</p> : null}
          <p className={styles.detail}>{summaryCounts(summary)}</p>
        </div>
        <span id={peopleId} className="visually-hidden">
          People
        </span>
        <ul className={styles.people} aria-labelledby={peopleId}>
          {summary.people.map((p, i) => (
            <li key={`${i}-${p.name}`} className={styles.person}>
              <Avatar emoji={p.emoji} size={32} emojiSize={19} background="var(--bg)" />
              <span className={styles.personName}>
                {p.name}
                {p.me ? <span className={styles.you}> (you)</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className={shared.caption}>
        Everyone else joins when someone adds their Google email in {PEOPLE_PATH}.
      </p>

      <div className={shared.spacer} />
      <div className={shared.footer}>
        <PrimaryButton onClick={() => void bring()} busy={busy} busyLabel="Bringing It Over" disabled={signingOut}>
          Bring It Over
        </PrimaryButton>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <button type="button" className={shared.textButton} onClick={declineDemoImport} disabled={busy || signingOut}>
          Start Fresh
        </button>
      </div>
    </StepPage>
  );
}
