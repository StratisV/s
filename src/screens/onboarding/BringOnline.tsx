import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { SETUP_CODE_MIN_LENGTH } from '../../lib/backend/serverApi';
import { APP_NAME } from '../../lib/constants';
import { deviceTimeZone, formatDay, todayIn } from '../../lib/logic/dates';
import type { ISOTimestamp, ServerSetupSummary } from '../../lib/types';
import { errorMessage, useHome } from '../../state/HomeProvider';
import { CodeField } from './CodeField';
import { CODE_FIELD_LENGTH, codeLetters, groupCode, setupCodeFromText } from './codeText';
import { HomeSummaryCard } from './ImportHome';
import shared from './Onboarding.module.css';
import styles from './OneHome.module.css';
import { PrimaryButton, StepPage, type Enter } from './StepPage';

export const BRING_ONLINE_TITLE = 'Bring this home online';
export const BRING_ONLINE_NOTE = 'Everyone else joins with a code you send them from Profile.';
/** On an iPhone or iPad in a browser tab: the home is usually kept in the Home Screen app. */
export const USE_HOME_SCREEN = `Use ${APP_NAME} from your Home Screen? Bring it online from there.`;
export const NOTHING_TO_PASTE = 'There’s no setup code to paste. Copy it from the link first.';
/** What comes along is the household's saved copy (lib/logic/savedHome.ts). */
export const SAVED_COPY_NOTE = 'This is your saved copy of the home.';

/** "Last changed Sat 10 Oct" for the copy's newest change (this browser's day), or null. */
export function lastChangedLine(at: ISOTimestamp | null | undefined, now: Date = new Date()): string | null {
  const when = at ? new Date(at) : null;
  if (!when || Number.isNaN(when.getTime())) return null;
  const zone = deviceTimeZone();
  return `Last changed ${formatDay(todayIn(zone, when), todayIn(zone, now))}`;
}

/** Whether this browser can read the clipboard when asked (a Paste button is worth showing). */
function canPaste(): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';
  } catch {
    return false;
  }
}

interface BringOnlineProps {
  enter: Enter;
  summary: ServerSetupSummary;
  /** From a ?setup= link, else ''. */
  setupCode: string;
  /** A browser tab on an iPhone or iPad: say the home may be kept in the Home Screen app. */
  elsewhere?: boolean;
  /** What comes along is the household's saved copy ("Use the Saved Copy"), not this browser's. */
  saved?: boolean;
}

/**
 * "Bring this home online" (server mode, signed out; docs/ARCHITECTURE.md "Server mode (no
 * setup)", "Screens"): no home is online yet and this browser kept one in demo mode. What
 * comes along (the card of "Bring over the home from this phone", plus the messages), the
 * setup code (filled in from a ?setup= link, or typed: a Home Screen app keeps its own
 * storage, so the link may have opened in Safari), and Bring It Online. Once it is online this
 * browser is signed in as the owner and HomeProvider moves on. Nothing else: no Start Fresh.
 */
export function BringOnline({ enter, summary, setupCode, elsewhere = false, saved = false }: BringOnlineProps) {
  const { bringHomeOnline, chooseSavedCopy } = useHome();
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
  const changed = lastChangedLine(summary.lastChanged);

  const paste = async () => {
    setError(null);
    try {
      const found = setupCodeFromText(await navigator.clipboard.readText());
      if (!alive.current) return;
      if (found) setCode(found);
      else setError(NOTHING_TO_PASTE);
    } catch {
      if (alive.current) setError(NOTHING_TO_PASTE);
    }
  };

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
        {saved ? <p className={shared.caption}>{SAVED_COPY_NOTE}</p> : changed ? <p className={shared.caption}>{changed}.</p> : null}
        {elsewhere && !saved ? <p className={`${shared.caption} ${styles.elsewhere}`}>{USE_HOME_SCREEN}</p> : null}
        {saved ? null : (
          <div className={styles.useSaved}>
            <button type="button" className={shared.textButton} onClick={chooseSavedCopy} disabled={busy}>
              Use the Saved Copy Instead
            </button>
          </div>
        )}

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
              maxLength={CODE_FIELD_LENGTH}
              placeholder="XXXX-XXXX-XXXX"
              disabled={busy}
              describedBy={error ? errorId : undefined}
              fromPaste={setupCodeFromText}
            />
            {canPaste() ? (
              <button type="button" className={styles.paste} onClick={() => void paste()} disabled={busy}>
                Paste
              </button>
            ) : null}
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
