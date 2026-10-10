import { useId, type FormEvent } from 'react';
import { Avatar } from '../../ui/Avatar';
import { ChevronLeftIcon } from '../../ui/icons';
import { EmojiGrid } from './EmojiGrid';
import shared from './Onboarding.module.css';
import styles from './ProfileStep.module.css';
import { MAX_NAME } from './setup';
import { PrimaryButton, StepPage, type Enter } from './StepPage';

export interface ProfileDraft {
  name: string;
  emoji: string;
}

interface ProfileStepProps {
  enter: Enter;
  email: string;
  value: ProfileDraft;
  onChange(next: ProfileDraft): void;
  onContinue(): void;
  /** Back to the previous step (the offer of the phone's home, after Start Fresh); none when this is the first. */
  onBack?(): void;
  onSignOut(): void;
  signingOut: boolean;
}

/** Step 2: name (prefilled from Google) and emoji, from the same grid as Profile. */
export function ProfileStep({ enter, email, value, onChange, onContinue, onBack, onSignOut, signingOut }: ProfileStepProps) {
  const nameId = useId();
  const emojiHeadingId = useId();
  const ready = value.name.trim().length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) onContinue();
  };

  return (
    <StepPage
      label="Your profile"
      enter={enter}
      nav={
        <>
          {onBack ? (
            <button type="button" className={shared.navButton} onClick={onBack} disabled={signingOut}>
              <ChevronLeftIcon size={20} />
              Back
            </button>
          ) : null}
          <button
            type="button"
            className={`${shared.navButton} ${onBack ? shared.navEnd : ''}`}
            onClick={onSignOut}
            disabled={signingOut}
          >
            Sign Out
          </button>
        </>
      }
    >
      <form className={shared.form} onSubmit={submit} noValidate>
        <div className={shared.titleBlock}>
          <h1 className={shared.title}>Your profile</h1>
          {email ? <p className={shared.subtitle}>Signed in as {email}</p> : null}
        </div>

        <div className={styles.avatar}>
          <Avatar
            key={value.emoji}
            className={styles.pop}
            emoji={value.emoji}
            size={112}
            emojiSize={62}
            background="var(--card)"
            shadow="0 2px 12px rgba(0,0,0,0.06)"
          />
        </div>

        <div className={`${shared.card} ${styles.nameCard}`}>
          <div className={shared.row}>
            <label className={shared.rowLabel} htmlFor={nameId}>
              Name
            </label>
            <input
              id={nameId}
              className={shared.input}
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              placeholder="Your name"
              maxLength={MAX_NAME}
              autoComplete="given-name"
              autoCapitalize="words"
              enterKeyHint="next"
              spellCheck={false}
            />
          </div>
        </div>

        <h2 id={emojiHeadingId} className={shared.sectionHeader}>
          Your emoji
        </h2>
        <EmojiGrid value={value.emoji} onChange={(emoji) => onChange({ ...value, emoji })} labelledBy={emojiHeadingId} />
        <p className={shared.caption}>Shown next to your name on items and in Stats.</p>

        <div className={shared.spacer} />
        <div className={shared.footer}>
          <PrimaryButton type="submit" disabled={!ready}>
            Continue
          </PrimaryButton>
        </div>
      </form>
    </StepPage>
  );
}
