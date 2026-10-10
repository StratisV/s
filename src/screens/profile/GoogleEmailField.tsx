import { useId, type KeyboardEvent, type Ref } from 'react';
import { BackendError } from '../../lib/backend/types';
import { TEXT_LIMITS } from '../../lib/constants';
import { errorMessage } from '../../state/HomeProvider';
import list from './List.module.css';
import styles from './People.module.css';

/** Copy for Household > People (docs/ARCHITECTURE.md "People before they join"). */
export const EMAIL_TAKEN = 'Someone at home already has that email.';
export const EMAIL_INVALID = 'Enter the full email address, like name@gmail.com.';
export const EMAIL_FOOTNOTE = 'When they sign in with Google using this email, they join as this person, with their items.';
export const NOT_JOINED = 'Not joined yet';

/** Why adding a person or saving their email failed, for under the email field. */
export function personErrorMessage(err: unknown, email: string): string {
  if (err instanceof BackendError) {
    if (err.code === 'email_taken') return EMAIL_TAKEN;
    if (err.code === 'unknown' && err.message.includes('invalid_input') && email) return EMAIL_INVALID;
  }
  return errorMessage(err);
}

interface GoogleEmailFieldProps {
  value: string;
  onChange(value: string): void;
  /** Leaving the field (tap elsewhere, Tab). */
  onBlur?(): void;
  /** Return on the keyboard. */
  onEnter?(): void;
  /** Escape: put the saved value back. Escape then stays here (it doesn't close the page). */
  onEscape?(): void;
  /** Shown under the field, and read out when it appears. */
  error: string | null;
  inputRef?: Ref<HTMLInputElement>;
  enterKeyHint?: 'done' | 'go';
}

/**
 * "Google Email" for someone who has not joined yet (Add Person, and their page): the email
 * they will sign in with, an error under it, and what the email is for.
 */
export function GoogleEmailField({
  value,
  onChange,
  onBlur,
  onEnter,
  onEscape,
  error,
  inputRef,
  enterKeyHint = 'done',
}: GoogleEmailFieldProps) {
  const id = useId();
  const errorId = useId();
  const noteId = useId();

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter?.();
    } else if (e.key === 'Escape' && onEscape) {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
    }
  };

  return (
    <>
      <h2 className={list.header}>
        <label htmlFor={id}>Google Email</label>
      </h2>
      <div className={list.card}>
        <div className={list.row}>
          <input
            ref={inputRef}
            id={id}
            className={styles.email}
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            maxLength={TEXT_LIMITS.email}
            placeholder="name@gmail.com"
            enterKeyHint={enterKeyHint}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${errorId} ${noteId}` : noteId}
          />
        </div>
      </div>
      {error ? (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <p id={noteId} className={list.caption}>
        {EMAIL_FOOTNOTE}
      </p>
    </>
  );
}
