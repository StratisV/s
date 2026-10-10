import { useEffect, useId, useRef, useState } from 'react';
import { TEXT_LIMITS } from '../../lib/constants';
import { emailTaken, hasJoined, isValidEmail, normaliseEmail } from '../../lib/logic/people';
import type { Member } from '../../lib/types';
import { useHome } from '../../state/HomeProvider';
import { Avatar } from '../../ui/Avatar';
import { EMAIL_INVALID, EMAIL_TAKEN, personErrorMessage } from '../profile/GoogleEmailField';
import shared from './Onboarding.module.css';
import styles from './OneHome.module.css';
import { PEOPLE_PATH } from './setup';
import { PrimaryButton, StepPage, type Enter } from './StepPage';

/** "Shea", "Shea and Ela", "Shea, Ela and Robin". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "Shea hasn’t joined yet", "Shea and Ela haven’t joined yet". */
export function waitingTitle(names: string[]): string {
  return `${listNames(names)} ${names.length === 1 ? 'hasn’t' : 'haven’t'} joined yet`;
}

/**
 * Right after bringing a home over (phase 'ready', onboardingTail, invitePeople): the people
 * who came along have no email yet, so nobody can sign in as them. This asks for each one's
 * Google email, right here (the same rules and messages as Household > People), then the
 * notifications step follows. Anything left blank can be added later in People.
 */
export function PeopleStep({ enter }: { enter: Enter }) {
  const { data, setPersonEmail, doneInvitingPeople } = useHome();
  // The people as the step opened: someone stays listed once their email is saved.
  const [ids] = useState(() => (data?.members ?? []).filter((m) => !hasJoined(m) && !m.email).map((m) => m.id));
  const people = ids
    .map((id) => data?.members.find((m) => m.id === id))
    .filter((m): m is Member => !!m && !hasJoined(m));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** What is wrong with `id`'s email as typed, or null. */
  const problem = (person: Member, value: string): string | null => {
    const email = normaliseEmail(value);
    if (!email) return null;
    if (!isValidEmail(email)) return EMAIL_INVALID;
    const others = (data?.members ?? []).map((m) => (m.id === person.id ? m : { ...m, email: normaliseEmail(drafts[m.id] ?? m.email) }));
    return emailTaken(others, email, person.id) ? EMAIL_TAKEN : null;
  };

  const save = async () => {
    if (busy) return;
    const found: Record<string, string | null> = {};
    for (const person of people) found[person.id] = problem(person, drafts[person.id] ?? person.email);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    setBusy(true);
    let failed = false;
    for (const person of people) {
      const email = normaliseEmail(drafts[person.id] ?? '');
      if (!email || email === normaliseEmail(person.email)) continue;
      try {
        await setPersonEmail(person.id, email);
      } catch (err) {
        failed = true;
        if (alive.current) setErrors((e) => ({ ...e, [person.id]: personErrorMessage(err, email) }));
      }
    }
    // All saved: on to the next step (the step may have gone already, once nobody is left
    // without an email; the provider still has to hear it).
    if (!failed) {
      doneInvitingPeople();
      return;
    }
    if (alive.current) setBusy(false);
  };

  const names = people.map((p) => p.name);
  return (
    <StepPage label={waitingTitle(names)} enter={enter} nav={null}>
      <div className={shared.titleBlock}>
        <h1 className={shared.title}>{waitingTitle(names)}</h1>
        <p className={`${shared.subtitle} ${styles.lead}`}>
          Add the Google email each of them signs in with. When they sign in, they join as themselves, with their items.
        </p>
      </div>

      {people.map((person) => (
        <PersonEmailCard
          key={person.id}
          person={person}
          value={drafts[person.id] ?? person.email}
          error={errors[person.id] ?? null}
          disabled={busy}
          onChange={(value) => {
            setDrafts((d) => ({ ...d, [person.id]: value }));
            setErrors((e) => ({ ...e, [person.id]: null }));
          }}
          onBlur={() => setErrors((e) => ({ ...e, [person.id]: problem(person, drafts[person.id] ?? person.email) }))}
        />
      ))}
      <p className={shared.caption}>You can add or change them later in {PEOPLE_PATH}.</p>

      <div className={shared.spacer} />
      <div className={shared.footer}>
        <PrimaryButton onClick={() => void save()} busy={busy} busyLabel="Saving">
          Continue
        </PrimaryButton>
      </div>
    </StepPage>
  );
}

function PersonEmailCard({
  person,
  value,
  error,
  disabled,
  onChange,
  onBlur,
}: {
  person: Member;
  value: string;
  error: string | null;
  disabled: boolean;
  onChange(value: string): void;
  onBlur(): void;
}) {
  const id = useId();
  const errorId = useId();
  return (
    <>
      <div className={`${shared.card} ${styles.emailCard}`}>
        <div className={shared.row}>
          <Avatar emoji={person.emoji} size={32} emojiSize={19} background="var(--bg)" />
          <span className={shared.rowLabel} data-wide="">
            {person.name}
          </span>
        </div>
        <div className={shared.row}>
          <input
            id={id}
            className={`${shared.input} ${styles.emailInput}`}
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            maxLength={TEXT_LIMITS.email}
            placeholder="name@gmail.com"
            enterKeyHint="next"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            aria-label={`${person.name}’s Google email`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
        </div>
      </div>
      {error ? (
        <p id={errorId} className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
