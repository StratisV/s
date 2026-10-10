import { useEffect, useId, useRef, useState } from 'react';
import type { DemoHomeSummary } from '../../lib/types';
import { errorMessage, useHome } from '../../state/HomeProvider';
import { ActionSheet } from '../../ui/ActionSheet';
import { Avatar } from '../../ui/Avatar';
import shared from './Onboarding.module.css';
import styles from './OneHome.module.css';
import { PEOPLE_PATH } from './setup';
import { HeroIcon, PrimaryButton, StepPage, type Enter } from './StepPage';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "6 areas · 19 items" (open items: the ones that show on Home), plus "· 3 done" when history comes along. */
export function summaryCounts(summary: Pick<DemoHomeSummary, 'areas' | 'items' | 'done'>): string {
  const counts = [plural(summary.areas, 'area', 'areas'), plural(summary.items, 'item', 'items')];
  if (summary.done > 0) counts.push(`${summary.done} done`);
  return counts.join(' · ');
}

interface ImportHomeProps {
  enter: Enter;
  summary: DemoHomeSummary;
  /**
   * 'create': no home exists yet; Bring It Over makes it, Start Fresh (asked first) goes on to
   * Profile and Create home. 'replace': this person's home has nothing in it yet; Bring It Over
   * puts the phone's home into it, Keep (asked first) keeps it as it is.
   */
  mode: 'create' | 'replace';
  /** 'create' only: Sign Out in the nav bar. */
  onSignOut?(): void;
  signingOut?: boolean;
}

/**
 * "Bring over the home from this phone" (docs/ARCHITECTURE.md "Bring over the home from this
 * phone"): the home this browser kept in demo mode, with what comes along. Both ways out of
 * it are asked about first when they can't be undone.
 */
export function ImportHome({ enter, summary, mode, onSignOut, signingOut = false }: ImportHomeProps) {
  const { data, importDemoHome, declineDemoImport } = useHome();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const peopleId = useId();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const current = data?.household.name ?? 'your home';

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

  const items = plural(summary.items, 'item', 'items');
  const decline =
    mode === 'create'
      ? {
          button: 'Start Fresh',
          title: 'Start a new home?',
          message: `The home on this phone (${items}) won’t come along, and can’t be brought over later.`,
          action: 'Start Fresh',
        }
      : {
          button: `Keep ${current}`,
          title: `Keep ${current} as it is?`,
          message: `The home on this phone (${items}) won’t come along, and won’t be offered again.`,
          action: `Keep ${current}`,
        };

  return (
    <StepPage
      label="Bring over the home from this phone"
      enter={enter}
      nav={
        mode === 'create' && onSignOut ? (
          <button type="button" className={shared.navButton} onClick={onSignOut} disabled={signingOut || busy}>
            Sign Out
          </button>
        ) : null
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
        {mode === 'replace'
          ? `It takes the place of ${current}, which has nothing in it yet. Everyone already in ${current} stays.`
          : `Everyone else joins when someone adds their Google email in ${PEOPLE_PATH}.`}
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
        <button type="button" className={shared.textButton} onClick={() => setConfirm(true)} disabled={busy || signingOut}>
          {decline.button}
        </button>
      </div>
      <ActionSheet
        open={confirm}
        title={decline.title}
        message={decline.message}
        actions={[
          {
            label: decline.action,
            destructive: true,
            onSelect: () => {
              setConfirm(false);
              declineDemoImport();
            },
          },
        ]}
        onCancel={() => setConfirm(false)}
      />
    </StepPage>
  );
}

/**
 * The home this phone kept in demo mode can't come over: this person's home is already in use
 * (phase 'ready', once; OK marks it declined so it never comes back).
 */
export function ImportBlocked({ enter, summary }: { enter: Enter; summary: DemoHomeSummary }) {
  const { data, declineDemoImport } = useHome();
  const current = data?.household.name ?? 'Your home';
  return (
    <StepPage label="The home on this phone stays here" enter={enter} nav={null}>
      <div className={shared.heroBefore} />
      <div className={shared.hero}>
        <HeroIcon emoji="📱" />
        <h1 className={shared.title}>The home on this phone stays here</h1>
        <p className={shared.subtitle}>
          This phone still has {summary.householdName} ({summaryCounts(summary)}) from before. {current} already has things
          in it, so that home can&rsquo;t be brought over.
        </p>
      </div>
      <div className={shared.heroAfter} />
      <div className={shared.footer}>
        <PrimaryButton onClick={declineDemoImport}>OK</PrimaryButton>
      </div>
    </StepPage>
  );
}
