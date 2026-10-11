import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CODE_LENGTH } from '../../lib/backend/serverApi';
import { APP_NAME } from '../../lib/constants';
import { errorMessage, useHome, type ServerWelcome, type ServerWelcomeNotice } from '../../state/HomeProvider';
import { CodeField } from './CodeField';
import { codeLetters, groupCode } from './codeText';
import { PrimaryButton, Spinner } from './StepPage';
import styles from './Welcome.module.css';

/** Copy for the Welcome screen in server mode (docs/ARCHITECTURE.md "Server mode (no setup)", "Screens"). */
export const PRIVATE_TITLE = 'This home is private.';
export const ASK_FOR_CODE = 'Ask someone at home for a code.';
export const NOT_SET_UP = `${APP_NAME} isn’t set up here yet.`;
export const NOTICES: Record<ServerWelcomeNotice, string> = {
  codeInvalid: 'That link’s code didn’t work. Ask for a new one.',
  tooManyAttempts: 'Too many tries. Wait 15 minutes, then try again.',
  setupUsed: 'This home is already online. Ask someone at home for a code.',
};

type Shown = Extract<ServerWelcome, { kind: 'checking' | 'private' }>;

/**
 * The Welcome screen's lower half in server mode, where Continue with Google is otherwise:
 * "This home is private." and "Have a code?" with Join. While HomeProvider asks the server
 * (or tries a ?code= link) it shows a spinner instead. A wrong code says why under the field
 * and keeps it; the right one opens the home (HomeProvider moves on).
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
  return <HaveACode homeOnline={welcome.homeOnline} code={welcome.code} notice={welcome.notice} />;
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

  // A link's code that did not work arrives (HomeProvider tried it): put it in the field.
  const lastLinked = useRef(linked);
  useEffect(() => {
    if (linked === lastLinked.current) return;
    lastLinked.current = linked;
    if (linked) setCode(groupCode(linked));
    setTried(false);
  }, [linked]);

  const ready = codeLetters(code).length >= CODE_LENGTH;

  const join = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    setTried(true);
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
          maxLength={12}
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
            Join
          </PrimaryButton>
        </div>
      </form>
    </div>
  );
}
