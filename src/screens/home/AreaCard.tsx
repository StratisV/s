// STUB, until the illustrated card is merged (it replaces this file and AreaCard.module.css).
// It keeps to the agreed contract, so Home and the tests work the same with either.
import { AreaArt } from '../../ui/area-art/AreaArt';
import { EmojiText } from '../../ui/EmojiText';
import styles from './AreaCard.module.css';

export type AreaStatus = 'attention' | 'soon' | 'good';

export interface AreaCardProps {
  area: { id: string; name: string };
  status: AreaStatus;
  /** The status in a few words, from the caller: "2 need attention", "1 coming up", "All good". */
  statusText: string;
  /** Open To dos. */
  openCount: number;
  /** Who is looking after it: the people its open items are for, most items first. */
  people: { id: string; name: string; emoji: string }[];
  onOpen(): void;
}

function who(people: AreaCardProps['people']): string {
  const names = people.map((p) => p.name);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * One area on Home: its illustration, its name, its status and who is looking after it. One
 * button (it opens the area), named "Garden, 1 coming up, 2 to do, Ela and Stratis". It sizes
 * to its grid cell.
 */
export function AreaCard({ area, status, statusText, openCount, people, onOpen }: AreaCardProps) {
  const count = openCount ? `${openCount} to do` : 'Nothing to do';
  const label = [area.name, statusText, count, who(people)].filter(Boolean).join(', ');
  return (
    <button type="button" className={styles.card} data-status={status} aria-label={label} onClick={onOpen}>
      <AreaArt name={area.name} seed={area.id} className={styles.art} />
      <span className={styles.body} aria-hidden="true">
        <span className={styles.name}>{area.name}</span>
        <span className={styles.status}>{statusText}</span>
        <span className={styles.meta}>
          <span className={styles.count}>{count}</span>
          {people.length ? (
            <span className={styles.people}>
              {people.slice(0, 3).map((p) => (
                <span key={p.id} className={styles.person}>
                  <EmojiText text={p.emoji} />
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
