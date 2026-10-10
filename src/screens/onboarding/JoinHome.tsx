import { useId, useState } from 'react';
import { BackendError } from '../../lib/backend/types';
import type { InvitePerson, InvitePreview } from '../../lib/types';
import { errorMessage, useHome } from '../../state/HomeProvider';
import { Avatar } from '../../ui/Avatar';
import { HomeScene } from '../../ui/HomeScene';
import { CheckIcon, ChevronLeftIcon } from '../../ui/icons';
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
  /**
   * The invite turned out to be invalid or expired while joining. Onboarding then shows why
   * (InviteInvalid while no home exists, else "This home is private" with a line about it).
   */
  onInvalid(): void;
  /** Forget the invite: "Set up a new home instead" (only with `canCreate`; the create form follows). */
  onDecline(): void;
  /** No home exists yet (phase 'onboarding'): the only time a new home may be offered. */
  canCreate: boolean;
}

/** "Someone new" in the list of people the home is waiting for. */
const NEW = 'new';

/** The waiting person whose name is the one typed on Your profile (any case), if exactly one. */
function sameName(people: InvitePerson[], name: string): string | null {
  const wanted = name.trim().toLowerCase();
  const found = people.filter((p) => p.name.trim().toLowerCase() === wanted);
  return found.length === 1 ? found[0].id : null;
}

/**
 * Step 3 with an invite link: preview the home and join it, or explain what went wrong. When
 * the home is waiting for people who have no email yet, it asks "Are you one of these
 * people?" first: picking one joins as them (their name, emoji and items), so nobody ends up
 * in the home twice; "Someone new" joins as the profile just typed.
 */
export function JoinHome({ enter, token, check, profile, onBack, onRetry, onInvalid, onDecline, canCreate }: JoinHomeProps) {
  const { joinHousehold, showToast } = useHome();
  const [busy, setBusy] = useState(false);
  const people = check.status === 'valid' ? check.preview.people : [];
  // Nothing chosen until they say (unless one has the name they typed): "Someone new" by
  // mistake would make a second copy of them.
  const [picked, setPicked] = useState<string | null>(null);
  const choice = people.length === 0 ? NEW : (picked ?? sameName(people, profile.name));
  const chosen = people.find((p) => p.id === choice) ?? null;
  const headingId = useId();

  const join = async () => {
    if (busy || !choice) return;
    setBusy(true);
    try {
      await joinHousehold({
        token,
        memberName: profile.name.trim(),
        memberEmoji: profile.emoji,
        personId: chosen ? chosen.id : null,
      });
      // Onboarding moves on (the welcome step as that person, or notifications) by itself.
    } catch (err) {
      setBusy(false);
      if (err instanceof BackendError && err.code === 'invalid_invite') onInvalid();
      else if (err instanceof BackendError && err.code === 'not_found' && chosen) {
        // Joined meanwhile, or removed: show the list as it is now.
        showToast(`${chosen.name} has joined already or was removed.`);
        setPicked(null);
        onRetry();
      } else showToast(errorMessage(err));
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
        {people.length > 0 ? (
          <>
            <h2 id={headingId} className={shared.sectionHeader}>
              Are you one of these people?
            </h2>
            <div className={`${shared.card} ${styles.people}`} role="radiogroup" aria-labelledby={headingId}>
              {[...people, null].map((p) => {
                const id = p ? p.id : NEW;
                const on = choice === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={styles.person}
                    onClick={() => setPicked(id)}
                    disabled={busy}
                  >
                    <Avatar emoji={p ? p.emoji : profile.emoji} size={32} emojiSize={19} background="var(--bg)" />
                    <span className={styles.personName}>{p ? p.name : `Someone new (${profile.name.trim() || 'you'})`}</span>
                    {on ? <CheckIcon className={styles.check} size={20} /> : null}
                  </button>
                );
              })}
            </div>
            <p className={shared.caption}>Someone at home added them already. Pick yourself to join with your items.</p>
          </>
        ) : null}
        <div className={shared.spacer} />
        <div className={shared.footer}>
          <PrimaryButton onClick={join} busy={busy} busyLabel="Joining" disabled={!choice}>
            {chosen ? `Join as ${chosen.name}` : 'Join'}
          </PrimaryButton>
          {canCreate ? (
            <button type="button" className={shared.textButton} onClick={onDecline} disabled={busy}>
              Set up a new home instead
            </button>
          ) : null}
        </div>
      </StepPage>
    );
  }

  // An invalid link never gets here (Onboarding shows why instead): only a failed check.
  const message = check.status === 'error' ? check.message : 'This invite link has expired or is not valid.';
  return (
    <StepPage label="Couldn’t check your invite" enter={enter} nav={nav}>
      <div className={shared.heroBefore} />
      <div className={shared.hero}>
        <HeroIcon emoji="📡" />
        <h1 className={shared.title}>Couldn’t check your invite</h1>
        <p className={shared.subtitle}>{message}</p>
      </div>
      <div className={shared.heroAfter} />
      <div className={shared.footer}>
        <PrimaryButton onClick={onRetry}>Try Again</PrimaryButton>
        {canCreate ? (
          <button type="button" className={shared.textButton} onClick={onDecline}>
            Set up a new home instead
          </button>
        ) : null}
      </div>
    </StepPage>
  );
}
