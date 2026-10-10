import { useEffect, useId, useRef, useState, type Ref } from 'react';
import { TEXT_LIMITS } from '../../lib/constants';
import { hasJoined, isValidEmail, normaliseEmail } from '../../lib/logic/people';
import type { Member } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { ActionSheet } from '../../ui/ActionSheet';
import { Avatar } from '../../ui/Avatar';
import { EmojiGrid } from './EmojiGrid';
import { EMAIL_INVALID, GoogleEmailField, NOT_JOINED, personErrorMessage } from './GoogleEmailField';
import { InlineText } from './InlineText';
import { BackButton, NavPage } from './NavPage';
import list from './List.module.css';
import people from './People.module.css';
import styles from './ProfilePage.module.css';

interface PersonPageProps {
  memberId: string;
  onBack(): void;
  backRef?: Ref<HTMLButtonElement>;
}

/**
 * A household member's name and emoji, pushed from People in the Household
 * editor. Everyone can edit everyone's profile, so it looks like Profile's top.
 * For someone who has not joined yet it also holds the Google email they will
 * sign in with, and Remove (docs/ARCHITECTURE.md "People before they join").
 */
export function PersonPage({ memberId, onBack, backRef }: PersonPageProps) {
  const { data, me, updateMember } = useHousehold();
  const emojiHeadingId = useId();
  const member = data.members.find((m) => m.id === memberId);

  // Their account was deleted (or they were removed) while the page was open: nothing left to edit.
  const gone = !member;
  useEffect(() => {
    if (gone) onBack();
  }, [gone, onBack]);

  const isMe = member?.id === me.id;
  const joined = member ? hasJoined(member) : true;

  return (
    <NavPage leading={<BackButton label="Household" onClick={onBack} buttonRef={backRef} />}>
      {member ? (
        <>
          <h1 className="visually-hidden">{member.name}</h1>
          <div className={styles.identity}>
            <Avatar
              emoji={member.emoji}
              size={112}
              emojiSize={62}
              background="var(--card)"
              shadow="0 2px 12px rgba(0,0,0,0.06)"
            />
            <InlineText
              className={styles.name}
              value={member.name}
              onCommit={(name) => void updateMember(member.id, { name }).catch(() => {})}
              aria-label="Name"
              autoCapitalize="words"
              maxLength={TEXT_LIMITS.memberName}
            />
            {!joined ? (
              <span className={people.account}>{NOT_JOINED}</span>
            ) : member.email ? (
              <span className={styles.account}>{member.email}</span>
            ) : null}
          </div>

          <h2 id={emojiHeadingId} className={list.header}>
            {isMe ? 'Your emoji' : 'Emoji'}
          </h2>
          <EmojiGrid
            value={member.emoji}
            labelledBy={emojiHeadingId}
            onChange={(emoji) => void updateMember(member.id, { emoji }).catch(() => {})}
          />
          <p className={list.caption}>
            {isMe ? 'Shown next to your name on items and in Stats.' : 'Shown next to their name on items and in Stats.'}
          </p>

          {joined ? null : (
            <>
              <PersonEmail member={member} />
              <RemovePerson member={member} onRemoved={onBack} />
            </>
          )}
        </>
      ) : null}
    </NavPage>
  );
}

/**
 * The email someone who has not joined yet will sign in with. Saved on blur or Return
 * (setPersonEmail; '' clears it); Escape puts the saved one back. A value that isn't an
 * email, or that someone else has, stays in the field with the reason under it.
 */
function PersonEmail({ member }: { member: Member }) {
  const { setPersonEmail } = useHousehold();
  const [draft, setDraft] = useState(member.email);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Escape blurs the field without saving. */
  const cancelled = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // While not being edited (and not showing a problem), follow the saved email: a change made
  // on another phone shows up here.
  useEffect(() => {
    if (!editing && !error) setDraft(member.email);
  }, [member.email, editing, error]);

  const commit = async () => {
    setEditing(false);
    const next = normaliseEmail(draft);
    if (next && !isValidEmail(next)) {
      setError(EMAIL_INVALID);
      return;
    }
    setError(null);
    setDraft(next);
    if (next === normaliseEmail(member.email)) return;
    try {
      await setPersonEmail(member.id, next);
    } catch (err) {
      if (!alive.current) return;
      // Keep what they typed, and say why it wasn't saved.
      setDraft(next);
      setError(personErrorMessage(err, next));
    }
  };

  return (
    <GoogleEmailField
      inputRef={inputRef}
      value={draft}
      onChange={(value) => {
        setEditing(true);
        setDraft(value);
      }}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        if (editing || error) void commit();
      }}
      onEnter={() => inputRef.current?.blur()}
      onEscape={() => {
        cancelled.current = true;
        setEditing(false);
        setError(null);
        setDraft(member.email);
        inputRef.current?.blur();
        cancelled.current = false;
      }}
      error={error}
    />
  );
}

/** "Remove Shea", confirmed: their items become unassigned. Then back to Household. */
function RemovePerson({ member, onRemoved }: { member: Member; onRemoved(): void }) {
  const { removePerson } = useHousehold();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <div className={`${list.card} ${people.remove}`}>
        <button type="button" className={`${list.row} ${list.destructive}`} onClick={() => setConfirm(true)}>
          Remove {member.name}
        </button>
      </div>
      <ActionSheet
        open={confirm}
        title={`Remove ${member.name}?`}
        message="Their items become unassigned."
        actions={[
          {
            label: 'Remove',
            destructive: true,
            onSelect: () => {
              setConfirm(false);
              // Gone from People at once; if it fails they come back, with a toast saying so.
              void removePerson(member.id).catch(() => {});
              onRemoved();
            },
          },
        ]}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
