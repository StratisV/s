import { useId, useState, type Ref } from 'react';
import { APP_NAME, TEXT_LIMITS } from '../../lib/constants';
import { errorMessage, useHousehold } from '../../state/HomeProvider';
import { ActionSheet } from '../../ui/ActionSheet';
import { Avatar } from '../../ui/Avatar';
import { ChevronRightIcon } from '../../ui/icons';
import { EmojiGrid } from './EmojiGrid';
import { InlineText } from './InlineText';
import { cachedInvite, INVITE_TITLE, inviteUrl, rememberInvite, shareLink } from './invite';
import { NavPage } from './NavPage';
import { NotificationsSection } from './NotificationsSection';
import list from './List.module.css';
import styles from './ProfilePage.module.css';

interface ProfilePageProps {
  onDone(): void;
  onOpenHousehold(): void;
  householdRowRef?: Ref<HTMLButtonElement>;
}

/** Profile (README "4. Profile"): avatar, name, emoji, notifications, household, sign out. */
export function ProfilePage({ onDone, onOpenHousehold, householdRowRef }: ProfilePageProps) {
  const { backend, data, me, updateMember, createInvite, showToast, dismissToast, signOut } = useHousehold();
  const emojiHeadingId = useId();
  const householdHeadingId = useId();
  const [inviting, setInviting] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const householdId = data.household.id;

  const share = async (url: string) => {
    const outcome = await shareLink(url, INVITE_TITLE);
    if (outcome === 'copied') showToast('Invite link copied');
    else if (outcome === 'failed') {
      // The tap no longer counts (slow network): one more tap shares it.
      showToast('Invite link ready', {
        label: typeof navigator.share === 'function' ? 'Share' : 'Copy',
        run: () => {
          dismissToast();
          void share(url);
        },
      });
    }
  };

  const invite = async () => {
    if (inviting) return;
    setInviting(true);
    try {
      let token = cachedInvite(householdId);
      if (!token) {
        token = await createInvite();
        rememberInvite(householdId, token);
      }
      await share(inviteUrl(token));
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setInviting(false);
    }
  };

  return (
    <NavPage
      trailing={
        <button type="button" className={styles.done} onClick={onDone}>
          Done
        </button>
      }
    >
      <div className={styles.identity}>
        <Avatar emoji={me.emoji} size={112} emojiSize={62} background="var(--card)" shadow="0 2px 12px rgba(0,0,0,0.06)" />
        <InlineText
          className={styles.name}
          value={me.name}
          onCommit={(name) => void updateMember(me.id, { name }).catch(() => {})}
          aria-label="Your name"
          autoCapitalize="words"
          maxLength={TEXT_LIMITS.memberName}
        />
        <span className={styles.account}>{backend.kind === 'demo' ? 'Demo account' : 'Signed in with Google'}</span>
      </div>

      <h2 id={emojiHeadingId} className={list.header}>
        Your emoji
      </h2>
      <EmojiGrid
        value={me.emoji}
        labelledBy={emojiHeadingId}
        onChange={(emoji) => void updateMember(me.id, { emoji }).catch(() => {})}
      />
      <p className={list.caption}>Shown next to your name on items and in Stats.</p>

      <NotificationsSection />

      <section aria-labelledby={householdHeadingId}>
        <h2 id={householdHeadingId} className={list.header}>
          Household
        </h2>
        <div className={list.card}>
          <button
            type="button"
            className={`${list.row} ${list.action}`}
            onClick={() => void invite()}
            aria-busy={inviting || undefined}
          >
            Invite someone
          </button>
          <button ref={householdRowRef} type="button" className={list.row} onClick={onOpenHousehold}>
            <span className={list.label}>Household</span>
            <span className={list.value}>{data.household.name}</span>
            <ChevronRightIcon className={list.chevron} />
          </button>
        </div>
      </section>

      <div className={`${list.card} ${list.lone}`}>
        <button type="button" className={`${list.row} ${list.destructive}`} onClick={() => setConfirmSignOut(true)}>
          Sign Out
        </button>
      </div>

      <ActionSheet
        open={confirmSignOut}
        title={`Sign out of ${APP_NAME}?`}
        actions={[
          {
            label: 'Sign Out',
            destructive: true,
            onSelect: () => {
              setConfirmSignOut(false);
              signOut().catch((err) => showToast(errorMessage(err)));
            },
          },
        ]}
        onCancel={() => setConfirmSignOut(false)}
      />
    </NavPage>
  );
}
