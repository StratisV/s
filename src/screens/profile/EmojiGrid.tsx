import { EmojiText } from '../../ui/EmojiText';
import { useRef, type KeyboardEvent } from 'react';
import { EMOJIS } from '../../lib/constants';
import styles from './EmojiGrid.module.css';

const COLUMNS = 6;

interface EmojiGridProps {
  value: string;
  onChange(emoji: string): void;
  /** Accessible name of the group, e.g. "Your emoji". */
  label?: string;
  labelledBy?: string;
}

/**
 * The 6-column emoji picker (README "Your emoji"). A radio group: arrow
 * keys move through the grid (up/down by a row), Home/End jump to the ends.
 */
export function EmojiGrid({ value, onChange, label, labelledBy }: EmojiGridProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = EMOJIS.indexOf(value as (typeof EMOJIS)[number]);
  const focusable = selected >= 0 ? selected : 0;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = refs.current.findIndex((el) => el === document.activeElement);
    if (current < 0) return;
    const n = EMOJIS.length;
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
        next = (current + 1) % n;
        break;
      case 'ArrowLeft':
        next = (current - 1 + n) % n;
        break;
      case 'ArrowDown':
        next = (current + COLUMNS) % n;
        break;
      case 'ArrowUp':
        next = (current - COLUMNS + n) % n;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = n - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(EMOJIS[next]);
  };

  return (
    <div role="radiogroup" aria-label={label} aria-labelledby={labelledBy} className={styles.grid} onKeyDown={onKeyDown}>
      {EMOJIS.map((emoji, i) => (
        <button
          key={emoji}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === selected}
          tabIndex={i === focusable ? 0 : -1}
          className={styles.cell}
          onClick={() => {
            if (i !== selected) onChange(emoji);
          }}
        >
          <EmojiText text={emoji} />
        </button>
      ))}
    </div>
  );
}
