import { Fragment, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { REPEAT_OPTIONS, ragWord } from '../../lib/constants';
import { todayIn } from '../../lib/logic/dates';
import { isState } from '../../lib/logic/items';
import { relativeDue, relativeUpdated } from '../../lib/logic/upNext';
import type { ISODate, Item, Member, Rag } from '../../lib/types';
import { useConfetti } from '../../ui/Confetti';
import { EmojiText } from '../../ui/EmojiText';
import { RepeatIcon } from '../../ui/icons';
import { inCollapsedArea, rowFallback, rowsBeside } from './areaPanel';
import { RevealContext } from './reveal';
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
 * An item's colour in words, at three volumes: "Urgent" is a red pill (the strongest thing on
 * a row), "Within the month" a dot and amber words, "Not urgent" a dot and grey words. For To
 * maintain, its condition the same way: "Needs work" a pill, "Okay" amber words, "Good" grey
 * (no dot: the row's gauge shows it). Decorative: the row says it to assistive tech.
 */
export function RagBadge({ kind, rag, dot = true }: { kind: Item['kind']; rag: Rag; dot?: boolean }) {
  return (
    <span className={styles.badge} data-rag={rag} aria-hidden="true">
      {dot ? <span className={styles.badgeDot} /> : null}
      {ragWord(kind, rag)}
    </span>
  );
}

/** Who an item is for, at the end of a row's first line or on a tile: their emoji and first name. Decorative. */
export function Who({ member }: { member: Member }) {
  return (
    <span className={styles.who} aria-hidden="true" data-who="">
      <span className={styles.whoEmoji}>
        <EmojiText text={member.emoji} />
      </span>
      <span className={styles.whoName}>{firstName(member.name)}</span>
    </span>
  );
}

interface RowMetaProps {
  kind: Item['kind'];
  rag: Rag;
  /** The label's dot; a To maintain row leaves it out (its gauge shows the condition). */
  dot?: boolean;
  /** What follows the label on its line, in order: when it is due, when it was updated... */
  parts?: ReactNode[];
  /** Its room, where a list mixes rooms. */
  room?: string;
}

/**
 * The quiet line under a row's title: its urgency (or condition) in words, then `parts`, then
 * its room. After a pill the next words follow straight on; after quiet words, and before the
 * room, a dot separates them. The room is always whole: on this line while it fits, else at
 * the start of the next (cut short only when its name is wider than the whole line).
 * Decorative: the row says all of it to assistive tech.
 */
export function RowMeta({ kind, rag, dot = true, parts = [], room }: RowMetaProps) {
  // A pill (Urgent, Needs work) separates itself; quiet words need a dot after them.
  const pill = rag === 'red';
  return (
    <span className={styles.meta} data-meta="" aria-hidden="true">
      <span className={styles.metaLead}>
        <RagBadge kind={kind} rag={rag} dot={dot} />
        {parts.filter(Boolean).map((part, i) => (
          <Fragment key={i}>
            {i || !pill ? <span className={styles.sep}>·</span> : null}
            {part}
          </Fragment>
        ))}
      </span>
      {room ? (
        <span className={styles.roomPart}>
          <span className={styles.roomSep}>·</span>
          <span className={styles.room} data-room="">
            <RoomIcon name={room} size={13} className={styles.roomIcon} />
            <span className={styles.roomName}>{room}</span>
          </span>
        </span>
      ) : null}
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
 * To maintain item, never done); the title (two lines at most); then one quiet line: the
 * urgency (or condition) in words, when it is due ("In 4 days", "2 days late" in red) with a
 * repeat glyph, and its room where the list mixes rooms. Who it is for (their emoji and first
 * name) sits at the end of the title's line. Anywhere but the ring opens the item. Assistive
 * tech hears one sentence: "Heaters not working, Urgent, 2 days late, Hallway, Shea, has a
 * note." Just saved (RevealContext), it lights up for a moment.
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
  const lit = useContext(RevealContext) === item.id;
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
  const repeat = !maintained && item.repeat !== 'none' ? REPEAT_OPTIONS.find((o) => o.value === item.repeat)?.label : null;

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
      data-item-id={item.id}
      data-lit={lit || undefined}
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
              {item.title}
              <span className="visually-hidden">{`, ${spoken}.`}</span>
            </span>
            <RowMeta
              kind={item.kind}
              rag={item.rag}
              dot={!maintained}
              room={room}
              parts={[
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
              ]}
            />
          </span>
          {member && showWho ? <Who member={member} /> : null}
        </button>
      </div>
    </li>
  );
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
