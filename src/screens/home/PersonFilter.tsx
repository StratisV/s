import { useRef, type KeyboardEvent } from 'react';
import type { Member } from '../../lib/types';
import { EmojiText } from '../../ui/EmojiText';
import type { PersonFilter as Filter } from './personFilter';
import styles from './PersonFilter.module.css';

interface PersonFilterProps {
  members: Member[];
  /** The signed-in member, listed first after Everyone. */
  meId: string;
  value: Filter;
  counts: Record<string, number>;
  onChange(value: Filter): void;
}

/**
 * The row of people at the top of Home: Everyone, then each person (you first) and
 * Unassigned, each with how many open items they have. A radio group: arrow keys
 * move the choice. Scrolls sideways when the household is big.
 */
export function PersonFilter({ members, meId, value, counts, onChange }: PersonFilterProps) {
  const people = [...members].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0));
  const options: { value: Filter; emoji?: string; label: string }[] = [
    { value: 'all', label: 'Everyone' },
    ...people.map((m) => ({ value: m.id, emoji: m.emoji, label: m.id === meId ? `${m.name} (you)` : m.name })),
    { value: 'none', label: 'Unassigned' },
  ];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = options.length;
    let next: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
    refs.current[next]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  return (
    <div className={styles.row} role="radiogroup" aria-label="Show tasks for" onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const on = i === index;
        const count = counts[o.value] ?? 0;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${o.label}, ${count} ${count === 1 ? 'item' : 'items'}`}
            tabIndex={on ? 0 : -1}
            className={styles.chip}
            onClick={() => onChange(o.value)}
          >
            {o.emoji ? (
              <span className={styles.emoji} aria-hidden="true">
                <EmojiText text={o.emoji} />
              </span>
            ) : null}
            <span className={styles.name}>{o.label.replace(' (you)', '')}</span>
            <span className={styles.count} aria-hidden="true">
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
