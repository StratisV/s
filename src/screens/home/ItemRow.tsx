import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { REPEAT_OPTIONS, ragWord } from '../../lib/constants';
import { todayIn } from '../../lib/logic/dates';
import { isState } from '../../lib/logic/items';
import { relativeDue, relativeUpdated } from '../../lib/logic/upNext';
import type { ISODate, Item, Member, Rag } from '../../lib/types';
import { useConfetti } from '../../ui/Confetti';
import { EmojiText } from '../../ui/EmojiText';
import { NoteIcon, RepeatIcon } from '../../ui/icons';
import { inCollapsedArea, rowFallback, rowsBeside } from './areaPanel';
import { RoomIcon } from './RoomIcon';
import { ConditionGauge, StatusRing } from './StatusRing';
import styles from './ItemRow.module.css';

/**
 * How long the filled ring, the check and the struck-through title show before the row
 * completes (or folds away), so the person sees what they ticked.
 */
export const COMPLETE_FEEDBACK_MS = 420;
/** How long a row that leaves its list takes to fold away (ItemRow.module.css `.row[data-leaving]`). */
export const LEAVE_MS = 260;
/** A repeating item stays in the list: ignore taps a little longer so a slow double tap counts once. */
const REPEAT_COOLDOWN_MS = 450;

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false; // engines without :focus-visible
  }
}

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * An item's colour in words, as a small label: "Urgent" (red, strongest), "Within the
 * month" (amber, softer), "Not urgent" (green, just a dot and grey text); for To maintain,
 * its condition: "Needs work", "Okay", "Good". Decorative: the row says it to assistive tech.
 */
export function RagBadge({ kind, rag, dot = true }: { kind: Item['kind']; rag: Rag; dot?: boolean }) {
  return (
    <span className={styles.badge} data-rag={rag} aria-hidden="true">
      {dot ? <span className={styles.badgeDot} /> : null}
      {ragWord(kind, rag)}
    </span>
  );
}

interface ItemRowProps {
  item: Item;
  members: Member[];
  /** Today in the household's time zone. */
  today: ISODate;
  /** The household's, for a To maintain item's "Updated" day. */
  timeZone: string;
  /** Its room, where a list mixes rooms (Up next, a day under the calendar). */
  room?: string;
  /** Leaves out when it is due, where the list already says it (Today, a day under the calendar). Late stays. */
  hideWhen?: boolean;
  /**
   * Shows who it is for (their emoji and first name) at the end of the title's line. Off
   * while the person filter shows one person's items: they would all say the same.
   */
  showWho?: boolean;
  onOpen(itemId: string): void;
  onComplete(itemId: string): Promise<void> | void;
  /**
   * The row leaves its list once completed, even when the item repeats: in Up next and under
   * the calendar a repeating item moves on to a later date. (In a room a one-off leaves and a
   * repeating item stays.)
   */
  leavesOnComplete?: boolean;
}

/**
 * A Home row: a neutral ring (a To do: tap it to mark the item done) or a condition gauge (a
 * To maintain item, never done); the title (two lines at most, a note glyph after it); then
 * one quiet line: the urgency (or condition) in words, when it is due ("In 4 days", "2 days
 * late" in red) with a repeat glyph, and its room where the list mixes rooms. Who it is for
 * (their emoji and first name) sits at the end of the title's line. Anywhere but the ring
 * opens the item. Assistive tech hears one sentence:
 * "Heaters not working, Urgent, 2 days late, Hallway, Shea, has a note."
 *
 * Ticking it off: the ring fills, the check springs in and the title is struck through for a
 * moment, then a row that leaves its list folds away (none of the motion with Reduce Motion).
 */
export function ItemRow({
  item,
  members,
  today,
  timeZone,
  room,
  hideWhen = false,
  showWho = true,
  onOpen,
  onComplete,
  leavesOnComplete = false,
}: ItemRowProps) {
  const fire = useConfetti();
  const [completing, setCompleting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const openRef = useRef<HTMLButtonElement>(null);
  // The timer outlives a quick tab switch, so it always calls the latest callback.
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const leaves = leavesOnComplete || item.repeat === 'none';

  const complete = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy.current) return;
    busy.current = true;
    const ring = event.currentTarget;
    fire(ring);
    navigator.vibrate?.(10);
    setCompleting(true);

    // Only keyboard focus is worth keeping: a tap must not scroll the list to the next row.
    const keyboard = isFocusVisible(ring);

    const finish = () => {
      // A row that leaves its list: move keyboard focus to the nearest remaining row in the same
      // list (rows in a collapsed room can't take it), else to the group's or room's heading.
      const own = openRef.current;
      if (leaves && keyboard && document.activeElement === ring && own) {
        const rows = rowsBeside(own).filter((el) => el === own || !inCollapsedArea(el));
        const i = rows.indexOf(own);
        const next = rows[i + 1] ?? rows[i - 1] ?? rowFallback(own.closest('section'));
        next?.focus();
      }
      const pending = completeRef.current(item.id);
      if (mounted.current) {
        setCompleting(false);
        setLeaving(false);
      }
      Promise.resolve(pending)
        .catch(() => {
          /* the provider already shows an error toast */
        })
        .finally(() => {
          setTimeout(() => {
            busy.current = false;
          }, REPEAT_COOLDOWN_MS);
        });
    };

    setTimeout(() => {
      // The check has been seen: a row that leaves folds away, then the item completes.
      if (!leaves || reducedMotion()) {
        finish();
        return;
      }
      if (mounted.current) setLeaving(true);
      setTimeout(finish, LEAVE_MS);
    }, COMPLETE_FEEDBACK_MS);
  };

  const maintained = isState(item);
  const member = members.find((m) => m.id === item.assignee_id) ?? null;
  const when = maintained ? null : relativeDue(item.due_date, today);
  const showWhen = when && (!hideWhen || when.late);
  // Where the list mixes rooms, the room says more than when it was last updated.
  const updated = maintained && !room ? relativeUpdatedAt(item.updated_at, today, timeZone) : null;
  const note = item.note.trim();
  const [titleHead, titleTail] = splitLastWord(item.title);
  const repeat = !maintained && item.repeat !== 'none' ? REPEAT_OPTIONS.find((o) => o.value === item.repeat)?.label : null;

  // The room, where the list mixes rooms; a dot before it when something is said before it in words.
  const roomPart = room ? (
    <span key="room" className={styles.room} data-room="">
      <RoomIcon name={room} size={13} className={styles.roomIcon} />
      <span className={styles.roomName}>{room}</span>
    </span>
  ) : null;
  const roomSep = Boolean(showWhen || updated || item.rag === 'green');

  // One sentence for assistive tech; the visible line is hidden from it.
  const spoken = [
    maintained ? `to maintain, ${ragWord(item.kind, item.rag)}` : ragWord(item.kind, item.rag),
    showWhen ? when.text : null,
    room ?? null,
    member ? member.name : 'Unassigned',
    repeat ? `repeats ${repeat.toLowerCase()}` : null,
    updated ? updated.toLowerCase() : null,
    note ? 'has a note' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <li
      className={styles.row}
      data-kind={item.kind}
      data-completing={completing || undefined}
      data-leaving={leaving || undefined}
    >
      <div className={styles.inner}>
        {maintained ? (
          <ConditionGauge rag={item.rag} />
        ) : (
          <StatusRing done={completing} label={`Mark ${item.title} as done`} onClick={complete} />
        )}
        <button
          ref={openRef}
          type="button"
          className={styles.open}
          data-item-open=""
          onClick={() => {
            if (!busy.current) onOpen(item.id);
          }}
        >
          <span className={styles.text}>
            <span className={styles.title}>
              {note ? (
                <>
                  {titleHead}
                  {/* The note glyph never wraps onto a line of its own: it stays with the last word. */}
                  <span className={styles.titleTail}>
                    {titleTail}
                    <NoteIcon className={styles.noteGlyph} size={13} />
                  </span>
                </>
              ) : (
                item.title
              )}
              <span className="visually-hidden">{`, ${spoken}.`}</span>
            </span>
            <span className={styles.meta} data-meta="" aria-hidden="true">
              <span className={styles.metaLead}>
                <RagBadge kind={item.kind} rag={item.rag} dot={!maintained} />
                {[
                  showWhen ? (
                    <span key="when" className={styles.when} data-late={when.late || undefined}>
                      {when.text}
                      {repeat ? <RepeatIcon className={styles.glyph} size={11} /> : null}
                    </span>
                  ) : null,
                  updated ? (
                    <span key="updated" className={styles.part}>
                      {updated}
                    </span>
                  ) : null,
                  // Straight after a coloured label the room stays on its line.
                  room && !roomSep ? roomPart : null,
                ]
                  .filter(Boolean)
                  // A quiet label (Not urgent, Good) is plain text: a dot separates it from what follows.
                  .map((part, i) =>
                    i || item.rag === 'green' ? [<span key={`sep${i}`} className={styles.sep}>·</span>, part] : part,
                  )}
              </span>
              {/* Where the line is short, the room takes the next line whole rather than shrinking to a letter. */}
              {room && roomSep ? (
                <span className={styles.roomPart}>
                  <span className={styles.roomSep}>·</span>
                  {roomPart}
                </span>
              ) : null}
            </span>
          </span>
          {member && showWho ? (
            <span className={styles.who} aria-hidden="true" data-who="">
              <span className={styles.whoEmoji}>
                <EmojiText text={member.emoji} />
              </span>
              <span className={styles.whoName}>{firstName(member.name)}</span>
            </span>
          ) : null}
        </button>
      </div>
    </li>
  );
}

/**
 * A title split before its last word, "Clear the " and "gutters", so a glyph after it can stay
 * on its line. A last word too long to keep whole (a pasted link) is not split off.
 */
export function splitLastWord(title: string): [string, string] {
  const trimmed = title.trimEnd();
  const at = trimmed.search(/\S+$/);
  if (at < 0 || trimmed.length - at > 16) return [trimmed, ''];
  return [trimmed.slice(0, at), trimmed.slice(at)];
}

/** "Shea" of "Shea Byrne": rows have room for a first name. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** "Updated today", "Updated 3 days ago": when a To maintain item was last changed, in the household's day. */
function relativeUpdatedAt(updatedAt: string, today: ISODate, timeZone: string): string | null {
  const at = new Date(updatedAt);
  if (Number.isNaN(at.getTime())) return null;
  return relativeUpdated(todayIn(timeZone, at), today);
}
