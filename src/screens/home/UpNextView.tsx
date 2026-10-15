import { useContext, useId } from 'react';
import { ragWord } from '../../lib/constants';
import { isState } from '../../lib/logic/items';
import type { UpNext, UpNextGroup } from '../../lib/logic/upNext';
import type { ISODate, Item, Member } from '../../lib/types';
import { SealCheckIcon } from '../../ui/icons';
import { ItemRow, Who } from './ItemRow';
import { RevealContext } from './reveal';
import { ShowMore, useFold } from './ShowMore';
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
      <div className={`${styles.card} ${styles.clear}`} role="status">
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
          needsWork={view.groups.find((g) => g.id === 'attention')?.items.filter(isState).length ?? 0}
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
  // Only Later folds: what is late, urgent or due this week always shows in full.
  const fold = useFold(group.items, group.id === 'later' ? LATER_PREVIEW : Infinity);
  return (
    <section aria-labelledby={headingId} className={styles.group} data-group={group.id}>
      <h2 id={headingId} className={styles.groupTitle} tabIndex={-1}>
        {group.title}
      </h2>
      <div className={styles.card}>
        <ul id={listId} className={styles.list} role="list">
          {fold.rows.map((item) => (
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
        {fold.folds ? <ShowMore open={fold.open} hidden={fold.hidden} controls={listId} onToggle={fold.toggle} /> : null}
      </div>
    </section>
  );
}

/**
 * The line under Looking after, which never says all is well while something looked after
 * needs work (that one is listed under Needs attention): "All in good shape.", "Keep an eye
 * on anything marked Okay.", "1 needs work, under Needs attention." (and the Okay line after it).
 */
export function lookingAfterNote(needsWork: number, okay: boolean): string {
  const keepAnEye = 'Keep an eye on anything marked Okay.';
  if (!needsWork) return okay ? keepAnEye : 'All in good shape.';
  const work = `${needsWork} ${needsWork === 1 ? 'needs' : 'need'} work, under Needs attention.`;
  return okay ? `${work} ${keepAnEye}` : work;
}

interface LookingAfterProps {
  items: Item[];
  /** How many things looked after need work (listed under Needs attention, not here). */
  needsWork: number;
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
 * accessory tiles, Tody's condition bars). They open the item. A lone one is a row in a card,
 * as the groups above draw theirs, rather than half a row of tiles. One line under the
 * heading says how they are (lookingAfterNote()).
 */
function LookingAfter({ items, needsWork, roomOf, members, today, timeZone, showWho, onOpenItem, onComplete }: LookingAfterProps) {
  const headingId = useId();
  const lit = useContext(RevealContext);
  const okay = items.some((it) => it.rag === 'amber');
  return (
    <section aria-labelledby={headingId} className={styles.group} data-group="looking">
      <h2 id={headingId} className={styles.groupTitle} tabIndex={-1}>
        Looking after
      </h2>
      <p className={styles.groupNote}>{lookingAfterNote(needsWork, okay)}</p>
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
              <li key={item.id} className={styles.tileCell} data-item-id={item.id} data-lit={lit === item.id || undefined}>
                <button type="button" className={styles.tile} data-item-open="" onClick={() => onOpenItem(item.id)}>
                  <span className={styles.tileTop} aria-hidden="true">
                    <span className={styles.tileRoom}>{room}</span>
                    {member && showWho ? (
                      <span className={styles.tileWho}>
                        <Who member={member} />
                      </span>
                    ) : null}
                  </span>
                  <span className={styles.tileTitle}>
                    {item.title}
                    <span className="visually-hidden">{`, to maintain, ${word}, ${room}, ${member ? member.name : 'Unassigned'}.`}</span>
                  </span>
                  <span className={styles.tileState} data-rag={item.rag} aria-hidden="true">
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
