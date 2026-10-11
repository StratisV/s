import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CODE_LENGTH, SETUP_CODE_MIN_LENGTH } from '../../lib/backend/serverApi';
import { copyText } from '../../lib/clipboard';
import { APP_NAME } from '../../lib/constants';
import { errorMessage, useHome, type ServerWelcome, type ServerWelcomeNotice } from '../../state/HomeProvider';
import { CodeField } from './CodeField';
import { codeLetters, groupCode } from './codeText';
import { summaryCounts } from './ImportHome';
import { lastChangedLine } from './BringOnline';
import { PrimaryButton, Spinner } from './StepPage';
import shared from './Onboarding.module.css';
import styles from './Welcome.module.css';

/** Copy for the Welcome screen in server mode (docs/ARCHITECTURE.md "Server mode (no setup)", "Screens"). */
export const PRIVATE_TITLE = 'This home is private.';
export const ASK_FOR_CODE = 'Ask someone at home for a code.';
export const NOT_SET_UP = `${APP_NAME} isn’t set up here yet.`;
export const NOTICES: Record<ServerWelcomeNotice, string> = {
  codeInvalid: 'That link’s code didn’t work. Ask for a new one.',
  tooManyAttempts: 'Too many tries. Wait 15 minutes, then try again.',
  setupUsed: 'This home is already online. Ask someone at home for a code.',
  codeHere: `Using ${APP_NAME} from your Home Screen? Open it there and type this code. Or join in this browser.`,
};
/** A setup code typed in "Have a code?". */
export const SETUP_CODE_HERE = {
  online: 'That’s a setup code, and this home is already online. Ask someone at home for a code.',
  notOnline: `That’s the setup code. Enter it in ${APP_NAME} where your home is.`,
};
export const COPIED = 'Copied.';
export const COPY_FAILED = 'Couldn’t copy. Select the code instead.';

type Shown = Extract<ServerWelcome, { kind: 'checking' | 'private' | 'setupElsewhere' }>;

/**
 * The Welcome screen's lower half in server mode, where Continue with Google is otherwise:
 * "This home is private." and "Have a code?" with Join. While HomeProvider asks the server
 * (or tries a ?code= link) it shows a spinner instead. A wrong code says why under the field
 * and keeps it; the right one opens the home (HomeProvider moves on). A setup link opened where
 * the home is not kept says where to use it instead (SetupElsewhere).
 */
export function ServerSignIn({ welcome }: { welcome: Shown }) {
  if (welcome.kind === 'checking') {
    return (
      <div className={styles.access}>
        <div className={styles.checking} role="status">
          <Spinner size="large" />
          <span className="visually-hidden">Checking</span>
        </div>
      </div>
    );
  }
  if (welcome.kind === 'setupElsewhere') return <SetupElsewhere welcome={welcome} />;
  return <HaveACode homeOnline={welcome.homeOnline} code={welcome.code} notice={welcome.notice} />;
}

/** A Copy button for a code, saying how it went under it. */
function CopyCode({ code, label = 'Copy Code' }: { code: string; label?: string }) {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={`${shared.textButton} ${styles.copy}`}
        onClick={() => {
          setStatus(null);
          void copyText(code).then((ok) => setStatus(ok ? COPIED : COPY_FAILED));
        }}
      >
        {label}
      </button>
      <p className={styles.copyStatus} role="status">
        {status}
      </p>
    </>
  );
}

function HaveACode({
  homeOnline,
  code: linked,
  notice,
}: {
  homeOnline: boolean;
  code: string;
  notice: ServerWelcomeNotice | null;
}) {
  const { redeemCode } = useHome();
  const fieldId = useId();
  const errorId = useId();
  const [code, setCode] = useState(() => groupCode(linked));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The notice is about the link; once they try a code of their own, the field says how that went. */
  const [tried, setTried] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A link's code arrives (HomeProvider tried it, or keeps it for a choice): put it in the field.
  const lastLinked = useRef(linked);
  useEffect(() => {
    if (linked === lastLinked.current) return;
    lastLinked.current = linked;
    if (linked) setCode(groupCode(linked));
    setTried(false);
  }, [linked]);

  const ready = codeLetters(code).length >= CODE_LENGTH;
  /** A link opened where home.os may not live: its code waits here, to join here or type there. */
  const choice = notice === 'codeHere' && !tried && codeLetters(code) === codeLetters(linked);

  const join = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !ready) return;
    setTried(true);
    // The setup code, typed where a sign-in code goes: say where it belongs, without asking.
    if (codeLetters(code).length >= SETUP_CODE_MIN_LENGTH) {
      setError(homeOnline ? SETUP_CODE_HERE.online : SETUP_CODE_HERE.notOnline);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The home opens by itself.
      await redeemCode(code);
    } catch (err) {
      if (alive.current) setError(errorMessage(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div className={styles.access}>
      <p className={styles.privateTitle}>{PRIVATE_TITLE}</p>
      <p className={styles.privateLine}>{homeOnline ? ASK_FOR_CODE : NOT_SET_UP}</p>
      {notice && !tried ? (
        <p className={styles.notice} role="status">
          {NOTICES[notice]}
        </p>
      ) : null}
      <form className={styles.codeForm} onSubmit={(e) => void join(e)} noValidate>
        <label htmlFor={fieldId} className={styles.codeLabel}>
          Have a code?
        </label>
        <CodeField
          id={fieldId}
          className={styles.codeInput}
          value={code}
          onChange={(next) => {
            setCode(next);
            setError(null);
          }}
          maxLength={20}
          placeholder="ABCD-EFGH"
          invalid={!!error}
          describedBy={error ? errorId : undefined}
          takeCodeFromPaste
        />
        {error ? (
          <p id={errorId} className={styles.codeError} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.join}>
          <PrimaryButton type="submit" disabled={!ready} busy={busy} busyLabel="Joining">
            {choice ? 'Join in This Browser' : 'Join'}
          </PrimaryButton>
        </div>
        {choice ? <CopyCode code={groupCode(linked)} /> : null}
      </form>
    </div>
  );
}

/** "ABCD-EFGH" read out a letter at a time ("A B C D, E F G H"), for VoiceOver. */
function spelled(code: string): string {
  return code
    .split('-')
    .map((group) => group.split('').join(' '))
    .join(', ');
}

/** Copy for a setup link opened where the home is not kept (docs/ARCHITECTURE.md "Screens"). */
export const SETUP_ELSEWHERE = {
  iosTitle: `Open ${APP_NAME} from your Home Screen.`,
  iosLine: `Your home is kept in the ${APP_NAME} app on your Home Screen, not in Safari. Open it there and enter this setup code.`,
  title: `Open ${APP_NAME} where your home is.`,
  line: `This browser doesn’t have your home. Open ${APP_NAME} where you use it, and enter this setup code.`,
};

/**
 * A ?setup= link opened where the home is not (no demo home in this browser, or Safari on an
 * iPhone, whose Home Screen app keeps its own storage): where to use the setup code instead,
 * the code large with Copy, and, when this browser has a copy of a home too, "Use This Copy
 * Instead" with when it last changed, so an old copy is not brought online by mistake.
 */
function SetupElsewhere({ welcome }: { welcome: Extract<ServerWelcome, { kind: 'setupElsewhere' }> }) {
  const { chooseSetupHere } = useHome();
  const code = groupCode(welcome.setupCode);
  const changed = welcome.summary ? lastChangedLine(welcome.summary.lastChanged) : null;
  return (
    <div className={styles.access}>
      <p className={styles.privateTitle}>{welcome.ios ? SETUP_ELSEWHERE.iosTitle : SETUP_ELSEWHERE.title}</p>
      <p className={styles.privateLine}>{welcome.ios ? SETUP_ELSEWHERE.iosLine : SETUP_ELSEWHERE.line}</p>
      <p className={styles.setupCode}>
        <span aria-hidden="true">{code}</span>
        <span className="visually-hidden">Setup code {spelled(code)}</span>
      </p>
      <CopyCode code={code} />
      {welcome.summary ? (
        <div className={styles.thisCopy}>
          <p className={styles.thisCopyText}>
            {/* Each count stays whole ("19 items") when the line wraps. */}
            This browser has a copy too: {welcome.summary.householdName},{' '}
            {summaryCounts(welcome.summary).replace(/(\d) /g, '$1\u00a0')}
            {changed ? `, ${changed.charAt(0).toLowerCase()}${changed.slice(1)}` : ''}.
          </p>
          <button type="button" className={shared.textButton} onClick={chooseSetupHere}>
            Use This Copy Instead
          </button>
        </div>
      ) : null}
    </div>
  );
}
