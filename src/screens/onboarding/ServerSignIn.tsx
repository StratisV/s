import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CODE_LENGTH, SETUP_CODE_MIN_LENGTH } from '../../lib/backend/serverApi';
import { BackendError } from '../../lib/backend/types';
import { copyText } from '../../lib/clipboard';
import { APP_NAME } from '../../lib/constants';
import { errorMessage, useHome, type ServerWelcome, type ServerWelcomeNotice } from '../../state/HomeProvider';
import { CodeField } from './CodeField';
import { CODE_FIELD_LENGTH, codeFromPaste, codeLetters, groupCode } from './codeText';
import { summaryCounts } from './ImportHome';
import { lastChangedLine } from './BringOnline';
import { PrimaryButton, Spinner } from './StepPage';
import { GoogleGIcon } from '../../ui/icons';
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
  googleNotMember: 'That Google account isn’t in this home. Sign in with the one your home knows, or ask someone at home to add you.',
  googleFailed: 'Couldn’t sign in with Google. Try again.',
};
/** With Continue with Google on: what the private screen says instead of asking for a code. */
export const SIGN_IN_WITH_GOOGLE = 'Sign in with Google to see your home.';
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
  // A home is online: Create Account and Sign In, unless a code link brought them here.
  const codeFirst = !welcome.homeOnline || welcome.code !== '' || (welcome.notice !== null && welcome.notice !== 'googleNotMember' && welcome.notice !== 'googleFailed');
  return <SignInOrCode welcome={welcome} codeFirst={codeFirst} />;
}

function SignInOrCode({ welcome, codeFirst }: { welcome: Extract<ServerWelcome, { kind: 'private' }>; codeFirst: boolean }) {
  const [withCode, setWithCode] = useState(codeFirst);
  if (withCode) {
    return (
      <HaveACode
        homeOnline={welcome.homeOnline}
        code={welcome.code}
        notice={welcome.notice}
        google={welcome.google === true}
        onAccount={welcome.homeOnline ? () => setWithCode(false) : undefined}
      />
    );
  }
  return <Account google={welcome.google === true} notice={welcome.notice} onCode={() => setWithCode(true)} />;
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
  google,
  onAccount,
}: {
  homeOnline: boolean;
  code: string;
  notice: ServerWelcomeNotice | null;
  google: boolean;
  /** Back to Create Account and Sign In (when a home is online). */
  onAccount?: () => void;
}) {
  const { redeemCode, startSetup, continueWithGoogle } = useHome();
  const [leaving, setLeaving] = useState(false);
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
    // The setup code, typed where a sign-in code goes. No home online yet: on to "Bring this
    // home online" with it (the saved copy, as this browser has none). Else say where it belongs.
    if (codeLetters(code).length >= SETUP_CODE_MIN_LENGTH) {
      if (!homeOnline && startSetup(code)) return;
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
      <p className={styles.privateLine}>{!homeOnline ? NOT_SET_UP : google ? SIGN_IN_WITH_GOOGLE : ASK_FOR_CODE}</p>
      {notice && !tried ? (
        <p className={styles.notice} role="status">
          {NOTICES[notice]}
        </p>
      ) : null}
      {google && homeOnline ? (
        <button
          type="button"
          className={`${styles.google} ${styles.googleHere}`}
          onClick={() => {
            if (leaving) return;
            setLeaving(true);
            continueWithGoogle();
          }}
          aria-busy={leaving || undefined}
          aria-disabled={leaving || undefined}
        >
          <GoogleGIcon size={20} />
          <span>Continue with Google</span>
        </button>
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
          maxLength={CODE_FIELD_LENGTH}
          placeholder="ABCD-EFGH"
          invalid={!!error}
          describedBy={error ? errorId : undefined}
          fromPaste={codeFromPaste}
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
        {onAccount ? (
          <button type="button" className={shared.textButton} onClick={onAccount} disabled={busy}>
            Create Account or Sign In
          </button>
        ) : null}
      </form>
    </div>
  );
}

/** Copy for Create Account and Sign In (server mode). */
export const ACCOUNT = {
  createTitle: 'Join your home',
  createLine: 'Create your account to see everything at home.',
  signInTitle: 'Welcome back',
  signInLine: 'Sign in to see your home.',
  emailTaken: 'That email already has an account. Sign in instead.',
  wrong: 'Wrong password. Check it and try again.',
  noAccount: 'There’s no account for this email yet. Add your name to create it.',
  missingCreate: 'Add your name, your email, and a password of 6 or more characters.',
  missingSignIn: 'Enter your email and your password (6 or more characters).',
  tooMany: 'Too many tries. Wait 15 minutes, then try again.',
};

/**
 * Create Account and Sign In (server mode, a home online): name, email and password once,
 * then email and password on any other phone. The browser stays signed in. "Have a code?"
 * is still there for a code someone sent.
 */
function Account({ google, notice, onCode }: { google: boolean; notice: ServerWelcomeNotice | null; onCode(): void }) {
  const { createAccount, signInWithPassword, continueWithGoogle } = useHome();
  const [mode, setMode] = useState<'create' | 'signIn'>('create');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const creating = mode === 'create';
  const ready = (!creating || name.trim() !== '') && /\S+@\S+\.\S+/.test(email.trim()) && password.length >= 6;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!ready) {
      setError(creating ? ACCOUNT.missingCreate : ACCOUNT.missingSignIn);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The home opens by itself (after joining, the welcome step: their emoji).
      if (creating) await createAccount(name.trim(), email.trim(), password);
      else await signInWithPassword(email.trim(), password);
    } catch (err) {
      if (!alive.current) return;
      const code = err instanceof BackendError ? err.code : null;
      if (!creating && code === 'not_found') {
        // No account yet: on to Create Account, with what they typed kept.
        setMode('create');
        setError(ACCOUNT.noAccount);
        return;
      }
      setError(
        code === 'email_taken'
          ? ACCOUNT.emailTaken
          : code === 'invalid_code'
            ? ACCOUNT.wrong
            : err instanceof BackendError && err.message.startsWith('invalid_input')
              ? creating
                ? ACCOUNT.missingCreate
                : ACCOUNT.missingSignIn
              : code === 'too_many_attempts'
                ? ACCOUNT.tooMany
                : errorMessage(err),
      );
      if (code === 'email_taken') setMode('signIn');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  // Each field's label stays in view above it (a placeholder alone goes away as you type).
  const field = (id: string, label: string, input: JSX.Element, hint?: string) => (
    <div className={styles.fieldGroup}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      {input}
      {hint ? <p className={styles.fieldHint}>{hint}</p> : null}
    </div>
  );

  return (
    <div className={styles.access}>
      <p className={styles.privateTitle}>{creating ? ACCOUNT.createTitle : ACCOUNT.signInTitle}</p>
      <p className={styles.privateLine}>{creating ? ACCOUNT.createLine : ACCOUNT.signInLine}</p>
      {notice === 'googleNotMember' || notice === 'googleFailed' ? (
        <p className={styles.notice} role="status">
          {NOTICES[notice]}
        </p>
      ) : null}
      <form className={styles.account} onSubmit={(e) => void submit(e)} noValidate>
        {creating
          ? field(
              'account-name',
              'Your name',
              <input
                id="account-name"
                className={styles.field}
                type="text"
                autoComplete="name"
                autoCapitalize="words"
                placeholder="e.g. Alex"
                value={name}
                maxLength={60}
                disabled={busy}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
              />,
            )
          : null}
        {field(
          'account-email',
          'Email',
          <input
            id="account-email"
            className={styles.field}
            type="email"
            inputMode="email"
            autoComplete={creating ? 'email' : 'username'}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="name@example.com"
            value={email}
            maxLength={254}
            disabled={busy}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
          />,
        )}
        {field(
          'account-password',
          'Password',
          <input
            id="account-password"
            className={styles.field}
            type="password"
            autoComplete={creating ? 'new-password' : 'current-password'}
            placeholder={creating ? 'Choose a password' : 'Your password'}
            value={password}
            maxLength={200}
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
          />,
          creating ? '6 or more characters.' : undefined,
        )}
        {error ? (
          <p id={errorId} className={styles.codeError} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.join}>
          <PrimaryButton type="submit" busy={busy} busyLabel={creating ? 'Creating Account' : 'Signing In'}>
            {creating ? 'Create Account' : 'Sign In'}
          </PrimaryButton>
        </div>
      </form>
      <div className={styles.switch}>
        <button
          type="button"
          className={shared.textButton}
          onClick={() => {
            setMode(creating ? 'signIn' : 'create');
            setError(null);
          }}
          disabled={busy}
        >
          {creating ? 'Have an account? Sign In' : 'New here? Create Account'}
        </button>
        {google ? (
          <button type="button" className={shared.textButton} onClick={continueWithGoogle} disabled={busy}>
            Continue with Google
          </button>
        ) : null}
        <button type="button" className={shared.textButton} onClick={onCode} disabled={busy}>
          Have a code?
        </button>
      </div>
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

/** The household's saved copy (lib/logic/savedHome.ts), offered where the home is not. */
export const SAVED_COPY = {
  line: 'Or bring your saved copy online from here:',
  orLine: 'Or bring your saved copy online:',
};

/**
 * A ?setup= link opened where the home is not (no demo home in this browser, or Safari on an
 * iPhone, whose Home Screen app keeps its own storage): where to use the setup code instead,
 * the code large with Copy, and, when this browser has a copy of a home too, "Use This Copy
 * Instead" with when it last changed, so an old copy is not brought online by mistake. Last,
 * "Use the Saved Copy": the household's saved copy can come online from here.
 */
function SetupElsewhere({ welcome }: { welcome: Extract<ServerWelcome, { kind: 'setupElsewhere' }> }) {
  const { chooseSetupHere, chooseSavedCopy } = useHome();
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
      {welcome.saved ? (
        <div className={styles.thisCopy}>
          <p className={styles.thisCopyText}>
            {welcome.summary ? SAVED_COPY.orLine : SAVED_COPY.line} {welcome.saved.householdName},{' '}
            {summaryCounts(welcome.saved).replace(/(\d) /g, '$1\u00a0')}.
          </p>
          <button type="button" className={shared.textButton} onClick={chooseSavedCopy}>
            Use the Saved Copy
          </button>
        </div>
      ) : null}
    </div>
  );
}
