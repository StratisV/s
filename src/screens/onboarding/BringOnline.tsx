import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { SETUP_CODE_MIN_LENGTH } from '../../lib/backend/serverApi';
import type { ServerSetupSummary } from '../../lib/types';
import { errorMessage, useHome } from '../../state/HomeProvider';
import { CodeField } from './CodeField';
import { codeLetters, groupCode } from './codeText';
import { HomeSummaryCard } from './ImportHome';
import shared from './Onboarding.module.css';
import styles from './OneHome.module.css';
import { PrimaryButton, StepPage, type Enter } from './StepPage';

export const BRING_ONLINE_TITLE = 'Bring this home online';
export const BRING_ONLINE_NOTE = 'Everyone else joins with a code you send them from Profile.';

interface BringOnlineProps {
  enter: Enter;
  summary: ServerSetupSummary;
  /** From a ?setup= link, else ''. */
  setupCode: string;
}

/**
 * "Bring this home online" (server mode, signed out; docs/ARCHITECTURE.md "Server mode (no
 * setup)", "Screens"): no home is online yet and this browser kept one in demo mode. What
 * comes along (the card of "Bring over the home from this phone", plus the messages), the
 * setup code (filled in from a ?setup= link, or typed: a Home Screen app keeps its own
 * storage, so the link may have opened in Safari), and Bring It Online. Once it is online this
 * browser is signed in as the owner and HomeProvider moves on. Nothing else: no Start Fresh.
 */
export function BringOnline({ enter, summary, setupCode }: BringOnlineProps) {
  const { bringHomeOnline } = useHome();
  const fieldId = useId();
  const errorId = useId();
  const [code, setCode] = useState(() => groupCode(setupCode));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A setup link that arrives while the step is up (another tab) fills the field if it is empty.
  useEffect(() => {
    if (setupCode) setCode((c) => c || groupCode(setupCode));
  }, [setupCode]);

  const ready = codeLetters(code).length >= SETUP_CODE_MIN_LENGTH;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      // Online: the home opens by itself (or, if someone was first, the Welcome screen says so).
      await bringHomeOnline(code);
    } catch (err) {
      if (alive.current) setError(errorMessage(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <StepPage label={BRING_ONLINE_TITLE} enter={enter} nav={null}>
      <form className={shared.form} onSubmit={(e) => void submit(e)} noValidate>
        <div className={shared.titleBlock}>
          <h1 className={shared.title}>{BRING_ONLINE_TITLE}</h1>
        </div>

        <HomeSummaryCard summary={summary} busy={busy} />

        <h2 className={shared.sectionHeader}>
          <label htmlFor={fieldId}>Setup code</label>
        </h2>
        <div className={`${shared.card} ${styles.codeCard}`}>
          <div className={shared.row}>
            <CodeField
              id={fieldId}
              className={`${shared.input} ${styles.setupCode}`}
              value={code}
              onChange={(next) => {
                setCode(next);
                setError(null);
              }}
              maxLength={20}
              placeholder="XXXX-XXXX-XXXX"
              disabled={busy}
              describedBy={error ? errorId : undefined}
            />
          </div>
        </div>
        <p className={shared.caption}>{BRING_ONLINE_NOTE}</p>

        <div className={shared.spacer} />
        <div className={shared.footer}>
          <PrimaryButton type="submit" disabled={!ready} busy={busy} busyLabel="Bringing It Online">
            Bring It Online
          </PrimaryButton>
          {error ? (
            <p id={errorId} className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </form>
    </StepPage>
  );
}
