import type { UpNext } from '../../lib/logic/upNext';
import type { ISODate, Member } from '../../lib/types';
import { SealCheckIcon } from '../../ui/icons';
import { ItemCard } from './ItemCard';
import styles from './HomeScreen.module.css';

interface UpNextViewProps {
  view: UpNext;
  /** An area, from its id: its picture and its name. */
  areaOf(areaId: string): { id: string; name: string };
  members: Member[];
  today: ISODate;
  timeZone: string;
  /** What an empty list says ("Nothing for Ela right now."), when a person is chosen. */
  nobody: string | null;
  /** Who each card is for, after its area (off while one person's items show). */
  showWho: boolean;
  onOpenItem(itemId: string): void;
  onComplete(itemId: string): Promise<void>;
}

/**
 * Needs attention's list (Things' Today, Todoist's Overdue, Reminders' Today): one list across
 * every area in priority order (upNext()), so what needs someone now is at the top of the
 * screen: what is late, urgent or needs work, then today, the next 7 days, later, no date, and
 * the things looked after that are Okay. No headings: each item is a card with its area's
 * picture (ItemCard). Nothing to show: one card that says so.
 */
export function UpNextView({ view, areaOf, members, today, timeZone, nobody, showWho, onOpenItem, onComplete }: UpNextViewProps) {
  if (!view.items.length) {
    return (
      <div className={styles.clear} role="status" data-attention-list="">
        <SealCheckIcon className={styles.clearIcon} size={30} />
        <p className={styles.clearText}>
          <strong>{nobody ? 'Nothing here' : 'All clear'}</strong>
          {nobody ?? 'Nothing needs doing. Add something with the + button.'}
        </p>
      </div>
    );
  }
  return (
    <ul className={styles.items} role="list" data-attention-list="">
      {view.items.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          area={areaOf(item.area_id)}
          members={members}
          today={today}
          timeZone={timeZone}
          showWho={showWho}
          onOpen={onOpenItem}
          onComplete={onComplete}
        />
      ))}
    </ul>
  );
}
