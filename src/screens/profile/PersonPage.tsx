import { useEffect, useId, type Ref } from 'react';
import { TEXT_LIMITS } from '../../lib/constants';
import { useHousehold } from '../../state/HomeProvider';
import { Avatar } from '../../ui/Avatar';
import { EmojiGrid } from './EmojiGrid';
import { InlineText } from './InlineText';
import { BackButton, NavPage } from './NavPage';
import list from './List.module.css';
import styles from './ProfilePage.module.css';

interface PersonPageProps {
  memberId: string;
  onBack(): void;
  backRef?: Ref<HTMLButtonElement>;
}

/**
 * A household member's name and emoji, pushed from People in the Household
 * editor. Everyone can edit everyone's profile, so it looks like Profile's top.
 */
export function PersonPage({ memberId, onBack, backRef }: PersonPageProps) {
  const { data, me, updateMember } = useHousehold();
  const emojiHeadingId = useId();
  const member = data.members.find((m) => m.id === memberId);

  // Their account was deleted while the page was open: nothing left to edit.
  const gone = !member;
  useEffect(() => {
    if (gone) onBack();
  }, [gone, onBack]);

  const isMe = member?.id === me.id;

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
            {member.email ? <span className={styles.account}>{member.email}</span> : null}
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
        </>
      ) : null}
    </NavPage>
  );
}
