import { Avatar } from '../../ui/Avatar';
import { AreaArt } from '../../ui/area-art/AreaArt';
import s from './AreaCard.module.css';

/** 'attention': something urgent or late, or that needs work; 'soon': within the month or Okay; 'good': nothing pressing. */
export type AreaStatus = 'attention' | 'soon' | 'good';

export interface AreaCardProps {
  area: { id: string; name: string };
  status: AreaStatus;
  /** The status in words, worked out by the caller ("2 need attention", "1 coming up", "All good"). */
  statusText: string;
  /** Open To dos. */
  openCount: number;
  /** Who is looking after its open items, most items first. */
  people: { id: string; name: string; emoji: string }[];
  onOpen(): void;
}

/** How many faces show in the stack. */
const FACES = 3;

/** "3 to do", or "Nothing to do". */
export function countWords(openCount: number): string {
  return openCount > 0 ? `${openCount} to do` : 'Nothing to do';
}

/** The names under the faces: "Shea", "Shea and Ela", "Shea, Ela +2", or "No one yet". */
export function peopleWords(names: readonly string[]): string {
  if (names.length === 0) return 'No one yet';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

/** "Shea", "Shea and Ela", "Stratis, Shea and Ela": every name, for screen readers. */
function allNames(names: readonly string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * One area on Home: its picture, then its name, how it is in words (red, amber or green),
 * how many To dos are open, and who is looking after it. The whole card is one button
 * (it opens the area), named for all of that: "Kitchen, 2 need attention, 3 to do, Shea
 * and Ela looking after it". It fills its grid cell, so cards in a row line up.
 */
export function AreaCard({ area, status, statusText, openCount, people, onOpen }: AreaCardProps) {
  const names = people.map((person) => person.name);
  const count = countWords(openCount);
  const who = names.length ? `${allNames(names)} looking after it` : 'no one looking after it yet';
  return (
    <button
      type="button"
      className={s.card}
      data-status={status}
      data-area-card={area.id}
      aria-label={`${area.name}, ${statusText}, ${count}, ${who}`}
      onClick={() => onOpen()}
    >
      <span className={s.frame}>
        <AreaArt name={area.name} seed={area.id} className={s.art} />
      </span>
      <span className={s.body}>
        <span className={s.name}>{area.name}</span>
        <span className={s.status}>
          <span className={s.dot} aria-hidden="true" />
          <span className={s.statusText}>{statusText}</span>
        </span>
        <span className={s.count} data-empty={openCount === 0 || undefined}>
          {count}
        </span>
        <span className={s.people} data-empty={people.length === 0 || undefined}>
          {people.length ? (
            <span className={s.faces} aria-hidden="true">
              {people.slice(0, FACES).map((person, i) => (
                <Avatar
                  key={person.id}
                  emoji={person.emoji}
                  size={22}
                  emojiSize={13}
                  className={s.face}
                  style={{ zIndex: FACES - i }}
                />
              ))}
            </span>
          ) : null}
          <span className={s.names}>{peopleWords(names)}</span>
        </span>
      </span>
    </button>
  );
}
