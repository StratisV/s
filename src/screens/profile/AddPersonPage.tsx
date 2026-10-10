import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { TEXT_LIMITS } from '../../lib/constants';
import { emailTaken, isValidEmail, normaliseEmail } from '../../lib/logic/people';
import { useHousehold } from '../../state/HomeProvider';
import { Avatar } from '../../ui/Avatar';
import { DEFAULT_EMOJI } from '../onboarding/setup';
import { EmojiGrid } from './EmojiGrid';
import { EMAIL_INVALID, EMAIL_TAKEN, GoogleEmailField, personErrorMessage } from './GoogleEmailField';
import { BackButton, NavPage } from './NavPage';
import list from './List.module.css';
import people from './People.module.css';
import styles from './ProfilePage.module.css';

interface AddPersonPageProps {
  onBack(): void;
  /** Added: the page goes and People shows them (`memberId`). */
  onAdded(memberId: string): void;
  backRef?: Ref<HTMLButtonElement>;
  /** The Name field, focused once the page has slid in. */
  nameRef?: Ref<HTMLInputElement>;
}

/**
 * Household > People > Add Person (docs/ARCHITECTURE.md "People before they join"): someone
 * who hasn't signed in yet, by name, emoji and the Google email they will sign in with. They
 * can be given items straight away; when they sign in with that email they become this person.
 * Add (in the bar) is off while the name is blank or the email isn't one. On failure the page
 * keeps everything typed and says why under the email.
 */
export function AddPersonPage({ onBack, onAdded, backRef, nameRef }: AddPersonPageProps) {
  const { data, addPerson } = useHousehold();
  const emojiHeadingId = useId();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(DEFAULT_EMOJI);
  const [email, setEmail] = useState('');
  /** The email field has been left once: from then on a problem with it shows as you type. */
  const [checked, setChecked] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const wanted = normaliseEmail(email);
  const emailOk = wanted === '' || isValidEmail(wanted);
  const ready = name.trim().length > 0 && emailOk;

  let error = failure;
  if (!error && checked && wanted) {
    if (!emailOk) error = EMAIL_INVALID;
    else if (emailTaken(data.members, wanted)) error = EMAIL_TAKEN;
  }

  const add = async () => {
    if (busy) return;
    if (!ready) {
      if (!emailOk) setChecked(true);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const member = await addPerson({ name: name.trim(), emoji, email: wanted });
      if (alive.current) onAdded(member.id);
    } catch (err) {
      if (!alive.current) return;
      setBusy(false);
      setChecked(true);
      setFailure(personErrorMessage(err, wanted));
    }
  };

  const onNameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    emailRef.current?.focus();
  };

  return (
    <NavPage
      inlineTitle="Add Person"
      pinTitle
      leading={<BackButton label="Household" onClick={onBack} buttonRef={backRef} />}
      trailing={
        <button
          type="button"
          className={people.navAction}
          onClick={() => void add()}
          disabled={!ready && !busy}
          aria-busy={busy || undefined}
        >
          Add
        </button>
      }
    >
      <h1 className="visually-hidden">Add Person</h1>
      <div className={styles.identity}>
        <Avatar
          key={emoji}
          emoji={emoji}
          size={112}
          emojiSize={62}
          background="var(--card)"
          shadow="0 2px 12px rgba(0,0,0,0.06)"
        />
        <input
          ref={nameRef}
          type="text"
          className={styles.name}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setFailure(null);
          }}
          onKeyDown={onNameKey}
          placeholder="Name"
          aria-label="Name"
          maxLength={TEXT_LIMITS.memberName}
          autoCapitalize="words"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
        />
      </div>

      <h2 id={emojiHeadingId} className={list.header}>
        Emoji
      </h2>
      <EmojiGrid value={emoji} labelledBy={emojiHeadingId} onChange={setEmoji} />
      <p className={list.caption}>Shown next to their name on items and in Stats.</p>

      <GoogleEmailField
        inputRef={emailRef}
        value={email}
        onChange={(value) => {
          setEmail(value);
          setFailure(null);
        }}
        onBlur={() => setChecked(true)}
        onEnter={() => {
          setChecked(true);
          void add();
        }}
        error={error}
        enterKeyHint="go"
      />
    </NavPage>
  );
}
