import { useState } from 'react';
import { BackendError } from '../../lib/backend/types';
import type { InvitePreview } from '../../lib/types';
import { errorMessage, useHome } from '../../state/HomeProvider';
import { HomeScene } from '../../ui/HomeScene';
import { ChevronLeftIcon } from '../../ui/icons';
import styles from './JoinHome.module.css';
import shared from './Onboarding.module.css';
import type { ProfileDraft } from './ProfileStep';
import { HeroIcon, PrimaryButton, Spinner, StepPage, type Enter } from './StepPage';

/** What we know about the invite in the link. */
export type InviteCheck =
  | { status: 'loading' }
  | { status: 'valid'; preview: InvitePreview }
  | { status: 'invalid' }
  | { status: 'error'; message: string };

interface JoinHomeProps {
  enter: Enter;
  token: string;
  check: InviteCheck;
  profile: ProfileDraft;
  onBack(): void;
  onRetry(): void;
  /** The invite turned out to be invalid or expired while joining. */
  onInvalid(): void;
  /** "Set up a new home instead": forget the invite and continue to the create form. */
  onCreateInstead(): void;
}

/** Step 3 with an invite link: preview the home and join it, or explain what went wrong. */
export function JoinHome({ enter, token, check, profile, onBack, onRetry, onInvalid, onCreateInstead }: JoinHomeProps) {
  const { joinHousehold, showToast } = useHome();
  const [busy, setBusy] = useState(false);

  const join = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await joinHousehold({ token, memberName: profile.name.trim(), memberEmoji: profile.emoji });
      // Onboarding moves on to the notifications step by itself.
    } catch (err) {
      setBusy(false);
      if (err instanceof BackendError && err.code === 'invalid_invite') onInvalid();
      else showToast(errorMessage(err));
    }
  };

  const nav = (
    <button type="button" className={shared.navButton} onClick={onBack} disabled={busy}>
      <ChevronLeftIcon size={20} />
      Back
    </button>
  );

  if (check.status === 'loading') {
    return (
      <StepPage label="Checking your invite" enter={enter} nav={nav}>
        <div className={styles.loading} role="status">
          <Spinner size="large" />
          <span>Checking your invite</span>
        </div>
      </StepPage>
    );
  }

  if (check.status === 'valid') {
    const { household_name: name, address } = check.preview;
    return (
      <StepPage label={`Join ${name}`} enter={enter} nav={nav}>
        <div className={shared.titleBlock}>
          <h1 className={shared.title}>Join {name}</h1>
          {address ? <p className={shared.subtitle}>{address}</p> : null}
        </div>
        <div className={styles.scene}>
          <HomeScene />
        </div>
        <p className={styles.body}>
          You&rsquo;ve been invited to look after this home together. Everyone in it can see and change everything.
        </p>
        <div className={shared.spacer} />
        <div className={shared.footer}>
          <PrimaryButton onClick={join} busy={busy} busyLabel="Joining">
            Join
          </PrimaryButton>
          <button type="button" className={shared.textButton} onClick={onCreateInstead} disabled={busy}>
            Set up a new home instead
          </button>
        </div>
      </StepPage>
    );
  }

  const invalid = check.status === 'invalid';
  return (
    <StepPage label={invalid ? 'Invite link not valid' : 'Couldn’t check your invite'} enter={enter} nav={nav}>
      <div className={shared.heroBefore} />
      <div className={shared.hero}>
        <HeroIcon emoji={invalid ? '📭' : '📡'} />
        <h1 className={shared.title}>{invalid ? 'Invite link not valid' : 'Couldn’t check your invite'}</h1>
        <p className={shared.subtitle}>
          {invalid
            ? 'It may have expired, as links last 14 days. Ask someone at home to send you a new one, or set up a new home instead.'
            : check.message}
        </p>
      </div>
      <div className={shared.heroAfter} />
      <div className={shared.footer}>
        {invalid ? (
          <PrimaryButton onClick={onCreateInstead}>Set up a new home instead</PrimaryButton>
        ) : (
          <>
            <PrimaryButton onClick={onRetry}>Try Again</PrimaryButton>
            <button type="button" className={shared.textButton} onClick={onCreateInstead}>
              Set up a new home instead
            </button>
          </>
        )}
      </div>
    </StepPage>
  );
}
