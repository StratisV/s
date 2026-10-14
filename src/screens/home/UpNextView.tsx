import { useId, useState } from 'react';
import { ragWord } from '../../lib/constants';
import type { UpNext, UpNextGroup } from '../../lib/logic/upNext';
import type { ISODate, Item, Member } from '../../lib/types';
import { EmojiText } from '../../ui/EmojiText';
import { ChevronDownIcon, SealCheckIcon } from '../../ui/icons';
import { firstName, ItemRow } from './ItemRow';
import { ConditionGauge } from './StatusRing';
import styles from './HomeScreen.module.css';

/** Later shows this many rows, then "Show 10 more". */
export const LATER_PREVIEW = 3;

interface UpNextViewProps {
  view: UpNext;
  /** A room's name, from its id. */
  roomOf(areaId: string): string;
  members: Member[];
  today: ISODate;
  timeZone: string;
  /** What an empty list says ("Nothing for Ela right now."), when a person is chosen. */
  nobody: string | null;
  /** Who each row is for, at the end of its title (off while one person's items show). */
  showWho: boolean;
  onOpenItem(itemId: string): void;
  onComplete(itemId: string): Promise<void>;
}

/**
 * Home's first view (Things' Today, Todoist's Overdue, Reminders' Today): one list across
 * every room, grouped by when it needs doing, so what needs someone now is at the top of the
 * screen. Needs attention (late or urgent, and anything looked after that needs work), Today,
 * Next 7 days, then Later, folded after three rows. Needs attention and Later are sorted
 * urgency first, then date; Today and Next 7 days date first. Things looked after that are
 * Good or Okay close the view as small tiles: nothing to do, so they stay out of the way.
 */
export function UpNextView({
  view,
  roomOf,
  members,
  today,
  timeZone,
  nobody,
  showWho,
  onOpenItem,
  onComplete,
}: UpNextViewProps) {
  if (!view.groups.length && !view.looking.length) {
    return (
      <div className={styles.clear} role="status">
        <SealCheckIcon className={styles.clearIcon} size={30} />
        <p className={styles.clearText}>
          <strong>{nobody ? 'Nothing here' : 'All clear'}</strong>
          {nobody ?? 'Nothing open in the house. Add something with the + button.'}
        </p>
      </div>
    );
  }
  return (
    <div className={styles.view} data-view="next">
      {view.groups.map((group) => (
        <Group
          key={group.id}
          group={group}
          roomOf={roomOf}
          members={members}
          today={today}
          timeZone={timeZone}
          showWho={showWho}
          onOpenItem={onOpenItem}
          onComplete={onComplete}
        />
      ))}
      {view.looking.length ? (
        <LookingAfter
          items={view.looking}
          roomOf={roomOf}
          members={members}
          today={today}
          timeZone={timeZone}
          showWho={showWho}
          onOpenItem={onOpenItem}
          onComplete={onComplete}
        />
      ) : null}
    </div>
  );
}

interface GroupProps {
  group: UpNextGroup;
  roomOf(areaId: string): string;
  members: Member[];
  today: ISODate;
  timeZone: string;
  showWho: boolean;
  onOpenItem(itemId: string): void;
  onComplete(itemId: string): Promise<void>;
}

function Group({ group, roomOf, members, today, timeZone, showWho, onOpenItem, onComplete }: GroupProps) {
  const headingId = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const folds = group.id === 'later' && group.items.length > LATER_PREVIEW + 1;
  const rows = folds && !open ? group.items.slice(0, LATER_PREVIEW) : group.items;
  const hidden = group.items.length - LATER_PREVIEW;
  return (
    <section aria-labelledby={headingId} className={styles.group} data-group={group.id}>
      <h2 id={headingId} className={styles.groupTitle} tabIndex={-1}>
        {group.title}
      </h2>
      <div className={styles.card}>
        <ul id={listId} className={styles.list} role="list">
          {rows.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              members={members}
              today={today}
              timeZone={timeZone}
              room={roomOf(item.area_id)}
              hideWhen={group.id === 'today'}
              showWho={showWho}
              leavesOnComplete
              onOpen={onOpenItem}
              onComplete={onComplete}
            />
          ))}
        </ul>
        {folds ? (
          <button
            type="button"
            className={styles.more}
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Show fewer' : `Show ${hidden} more`}
            <ChevronDownIcon className={styles.moreChevron} size={11} strokeWidth={2.6} />
          </button>
        ) : null}
      </div>
    </section>
  );
}

interface LookingAfterProps {
  items: Item[];
  roomOf(areaId: string): string;
  members: Member[];
  today: ISODate;
  timeZone: string;
  showWho: boolean;
  onOpenItem(itemId: string): void;
  /** Never called (a thing looked after is never done); a lone one is drawn as a row. */
  onComplete(itemId: string): Promise<void>;
}

/**
 * Things looked after (To maintain) that are Good or Okay (Okay first): a grid of small
 * tiles, each with its room, its name and its condition as a gauge and a word (Apple Home's
 * accessory tiles, Tody's condition bars). They open the item. A lone one is a row in a card, as the
 * groups above draw theirs, rather than half a row of tiles.
 */
function LookingAfter({ items, roomOf, members, today, timeZone, showWho, onOpenItem, onComplete }: LookingAfterProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={styles.group} data-group="looking">
      <h2 id={headingId} className={styles.groupTitle} tabIndex={-1}>
        Looking after
      </h2>
      <p className={styles.groupNote}>Nothing to do right now.</p>
      {items.length === 1 ? (
        <div className={styles.card}>
          <ul className={styles.list} role="list">
            <ItemRow
              item={items[0]}
              members={members}
              today={today}
              timeZone={timeZone}
              room={roomOf(items[0].area_id)}
              showWho={showWho}
              onOpen={onOpenItem}
              onComplete={onComplete}
            />
          </ul>
        </div>
      ) : (
        <ul className={styles.tiles} role="list">
          {items.map((item) => {
            const member = members.find((m) => m.id === item.assignee_id);
            const word = ragWord(item.kind, item.rag);
            const room = roomOf(item.area_id);
            return (
              <li key={item.id} className={styles.tileCell}>
                <button type="button" className={styles.tile} data-item-open="" onClick={() => onOpenItem(item.id)}>
                  <span className={styles.tileTop} aria-hidden="true">
                    <span className={styles.tileRoom}>{room}</span>
                    {member && showWho ? (
                      <span className={styles.tileWho}>
                        <span className={styles.tileWhoEmoji}>
                          <EmojiText text={member.emoji} />
                        </span>
                        <span className={styles.tileWhoName}>{firstName(member.name)}</span>
                      </span>
                    ) : null}
                  </span>
                  <span className={styles.tileTitle}>
                    {item.title}
                    <span className="visually-hidden">{`, to maintain, ${word}, ${room}, ${member ? member.name : 'Unassigned'}.`}</span>
                  </span>
                  <span className={styles.tileState} aria-hidden="true">
                    <ConditionGauge rag={item.rag} variant="tile" />
                    {word}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
