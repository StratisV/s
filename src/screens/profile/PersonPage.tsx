import { useEffect, useId, useRef, useState, type Ref } from 'react';
import { TEXT_LIMITS } from '../../lib/constants';
import { hasJoined, isValidEmail, normaliseEmail } from '../../lib/logic/people';
import type { DeviceInfo, Member } from '../../lib/types';
import { errorMessage, useHousehold } from '../../state/HomeProvider';
import { ActionSheet } from '../../ui/ActionSheet';
import { Avatar } from '../../ui/Avatar';
import { useIssueCode } from './CodeSheet';
import { EmojiGrid } from './EmojiGrid';
import { EMAIL_INVALID, GoogleEmailField, NOT_JOINED, personErrorMessage } from './GoogleEmailField';
import { InlineText } from './InlineText';
import { BackButton, NavPage } from './NavPage';
import list from './List.module.css';
import people from './People.module.css';
import styles from './ProfilePage.module.css';
import { isLastDevice, signedInLabel, useDevices } from './useDevices';

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
 *
 * Server mode (docs/ARCHITECTURE.md "Server mode (no setup)", "Screens"): no email. Someone
 * who has not joined gets Invite (a code); someone who has, their signed-in devices (each can
 * be removed) and Sign in on a new phone (a code): on your own page always, on someone else's
 * only once none of their devices is signed in (a lost phone, removed here), since a code for
 * someone signed in elsewhere would let whoever has it be them.
 */
export function PersonPage({ memberId, onBack, backRef }: PersonPageProps) {
  const { backend, data, me, updateMember } = useHousehold();
  const server = backend.kind === 'server';
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

          {joined ? (
            server ? (
              <PersonDevices member={member} isMe={isMe} />
            ) : null
          ) : (
            <>
              {server ? <InvitePerson member={member} /> : <PersonEmail member={member} />}
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

/**
 * What removing someone does, for the confirmation: their items become unassigned, and what
 * they did leaves Stats (completions credited to them are credited to nobody).
 */
export function removeMessage(member: Pick<Member, 'id'>, completions: { credited_to: string | null }[]): string {
  const done = completions.filter((c) => c.credited_to === member.id).length;
  if (done === 0) return 'Their items become unassigned.';
  return `Their items become unassigned and their ${done} done ${done === 1 ? 'task leaves' : 'tasks leave'} Stats.`;
}

/** "Remove Shea", confirmed: their items become unassigned. Then back to Household. */
function RemovePerson({ member, onRemoved }: { member: Member; onRemoved(): void }) {
  const { data, removePerson } = useHousehold();
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
        message={removeMessage(member, data.completions)}
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

/** Server mode: "Invite Shea" for someone who has not joined, which makes a code for them. */
function InvitePerson({ member }: { member: Member }) {
  const codes = useIssueCode();
  return (
    <>
      <div className={`${list.card} ${list.lone}`}>
        <button
          type="button"
          className={`${list.row} ${list.action}`}
          onClick={() => void codes.issue(member.id, member.name)}
          aria-busy={codes.busy ? true : undefined}
        >
          Invite {member.name}
        </button>
      </div>
      {codes.sheet}
    </>
  );
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Copy for removing a device (docs/ARCHITECTURE.md "Server mode (no setup)", "Screens"). */
export const REMOVE_DEVICE_TITLE = 'Remove this device?';
export const REMOVE_DEVICE_MESSAGE = 'It will need a new code to get back in.';

/** What removing `device` means, for the confirmation. */
export function removeDeviceMessage(lastDevice: boolean, home: string): string {
  return lastDevice
    ? `${REMOVE_DEVICE_MESSAGE} It’s the only device signed in to ${home}, so nobody could make one.`
    : REMOVE_DEVICE_MESSAGE;
}

/** Under someone else's devices while they are signed in somewhere (only they can add one). */
export function onlyTheyCanAdd(name: string): string {
  return `Only ${name} can sign in on another device, from their Profile. If they lost their phone, remove it here, then send them a code.`;
}

/**
 * Server mode: the browsers someone who has joined is signed in on, each with Remove (asked
 * first; removing this one signs out here), then Sign in on a new phone (a code for them): for
 * yourself always, for someone else once none of their devices is signed in.
 */
function PersonDevices({ member, isMe }: { member: Member; isMe: boolean }) {
  const { data, today, removeDevice, showToast } = useHousehold();
  const { devices, error, reload } = useDevices(true);
  const codes = useIssueCode();
  const headingId = useId();
  const [confirm, setConfirm] = useState<DeviceInfo | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  /** Removed just now: gone from the list before the reload answers. */
  const [gone, setGone] = useState<string[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const theirs = devices?.filter((d) => d.memberId === member.id && !gone.includes(d.id)) ?? null;
  const timeZone = data.household.timezone;

  const remove = async (device: DeviceInfo) => {
    setConfirmOpen(false);
    setRemoving(device.id);
    try {
      // This browser's own: it is signed out, and Profile goes with the home.
      await removeDevice(device.id);
      if (alive.current) setGone((ids) => [...ids, device.id]);
    } catch (err) {
      showToast(errorMessage(err));
    }
    if (!alive.current) return;
    setRemoving(null);
    reload();
  };

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className={list.header}>
        Devices
      </h2>
      <div className={list.card}>
        {theirs === null ? (
          <div className={`${list.row} ${people.deviceNote}`} role="status">
            {error ? (
              <>
                <span>{error}</span>
                <button type="button" className={people.deviceRetry} onClick={reload}>
                  Try Again
                </button>
              </>
            ) : (
              <span>Loading…</span>
            )}
          </div>
        ) : theirs.length === 0 ? (
          <div className={`${list.row} ${people.deviceNote}`}>No devices signed in.</div>
        ) : (
          theirs.map((device) => {
            const when = signedInLabel(device, today, timeZone);
            return (
              <div key={device.id} className={list.row} aria-busy={removing === device.id || undefined}>
                <span className={people.personText}>
                  <span className={people.personName}>{device.label}</span>
                  <span className={people.deviceDetail}>
                    <span className="visually-hidden">, </span>
                    {device.current ? 'This device · ' : ''}
                    {when}
                  </span>
                </span>
                <button
                  type="button"
                  className={people.deviceRemove}
                  aria-label={`Remove ${device.label}, ${lowerFirst(when)}${device.current ? ', this device' : ''}`}
                  disabled={removing === device.id}
                  onClick={() => {
                    setConfirm(device);
                    setConfirmOpen(true);
                  }}
                >
                  Remove
                </button>
              </div>
            );
          })
        )}
        {isMe || theirs?.length === 0 ? (
          <button
            type="button"
            className={`${list.row} ${list.action}`}
            onClick={() => void codes.issue(member.id, isMe ? null : member.name)}
            aria-busy={codes.busy ? true : undefined}
          >
            Sign in on a new phone
          </button>
        ) : null}
      </div>
      {!isMe && theirs && theirs.length > 0 ? <p className={list.caption}>{onlyTheyCanAdd(member.name)}</p> : null}
      <ActionSheet
        open={confirmOpen}
        title={REMOVE_DEVICE_TITLE}
        message={confirm ? removeDeviceMessage(isLastDevice(devices, confirm.id), data.household.name) : undefined}
        actions={[{ label: 'Remove', destructive: true, onSelect: () => confirm && void remove(confirm) }]}
        onCancel={() => setConfirmOpen(false)}
      />
      {codes.sheet}
    </section>
  );
}
