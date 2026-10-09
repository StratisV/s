import { memo, useCallback, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { ChatRow, ReactionChip } from '../../lib/logic/chat';
import { Avatar } from '../../ui/Avatar';
import { NotDeliveredIcon } from './icons';
import { useLongPress } from './useLongPress';
import styles from './Message.module.css';

type MessageRowData = Extract<ChatRow, { kind: 'message' }>;

export interface ChipView extends ReactionChip {
  label: string;
}

interface MessageRowProps {
  row: MessageRowData;
  sender: { name: string; emoji: string };
  /** "Shea, Today 18:42": the bubble's accessible name. */
  label: string;
  chips: ChipView[];
  /** The menu is open on this message (the overlay shows its copy instead). */
  lifted: boolean;
  onMenu(key: string, bubble: HTMLElement): void;
  onToggleReaction(messageId: string, emoji: string): void;
  onRetry(key: string): void;
}

/** A bubble in the chat's colours: yours in the tint on the right, others' white on the left. */
export function Bubble({
  mine,
  tail,
  className,
  children,
}: {
  mine: boolean;
  tail?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`${styles.bubble} ${className ?? ''}`} data-mine={mine || undefined} data-tail={tail || undefined}>
      {children}
    </div>
  );
}

/**
 * One message: the sender's name over the first of a run (others only), the
 * bubble (with the sender's avatar beside the last of a run), and its
 * reactions as chips. Long-press, right-click, Enter or the ContextMenu key
 * opens the message menu.
 */
export const MessageRow = memo(function MessageRow({
  row,
  sender,
  label,
  chips,
  lifted,
  onMenu,
  onToggleReaction,
  onRetry,
}: MessageRowProps) {
  const { entry, mine, first, last } = row;
  const bubbleRef = useRef<HTMLDivElement>(null);
  const open = useCallback(() => {
    if (bubbleRef.current) onMenu(entry.key, bubbleRef.current);
  }, [entry.key, onMenu]);
  const press = useLongPress(open);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      open();
    }
  };

  const failed = entry.state === 'failed';
  return (
    <div
      className={styles.row}
      data-mine={mine || undefined}
      data-first={first || undefined}
      data-last={last || undefined}
      data-state={entry.state}
    >
      {!mine && first ? <div className={styles.sender}>{sender.name}</div> : null}
      <div className={styles.line}>
        {!mine ? (
          <span className={styles.avatarSlot}>
            {last ? <Avatar emoji={sender.emoji} size={28} emojiSize={16} /> : null}
          </span>
        ) : null}
        <div
          ref={bubbleRef}
          className={`${styles.bubble} ${styles.inList}`}
          data-mine={mine || undefined}
          data-tail={last || undefined}
          data-lifted={lifted || undefined}
          role="article"
          aria-label={label}
          aria-keyshortcuts="Enter ContextMenu"
          tabIndex={0}
          onKeyDown={onKeyDown}
          {...press}
        >
          {entry.message.body}
        </div>
        {failed ? (
          <button
            type="button"
            className={styles.retry}
            aria-label="Not delivered. Try again"
            onClick={() => onRetry(entry.key)}
          >
            <NotDeliveredIcon size={24} />
          </button>
        ) : null}
      </div>
      {failed ? <div className={styles.failedNote}>Not Delivered</div> : null}
      {chips.length ? (
        <div className={styles.chips}>
          {chips.map((chip) => (
            <button
              key={chip.emoji}
              type="button"
              className={styles.chip}
              aria-pressed={chip.mine}
              aria-label={chip.label}
              onClick={() => onToggleReaction(entry.message.id, chip.emoji)}
            >
              <span className={styles.chipEmoji} aria-hidden="true">
                {chip.emoji}
              </span>
              <span className={styles.chipCount} aria-hidden="true">
                {chip.count}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
});
