import { EmojiText } from '../../ui/EmojiText';
import { useRef, type KeyboardEvent } from 'react';
import { EMOJIS } from '../../lib/constants';
import styles from './EmojiGrid.module.css';

const COLUMNS = 6;

interface EmojiGridProps {
  value: string;
  onChange(emoji: string): void;
  /** Id of the heading that names the group. */
  labelledBy: string;
  disabled?: boolean;
}

/**
 * The Profile screen's emoji picker (white card, 6 columns, 52px cells) as a
 * radio group: one tab stop, arrow keys move and select, Home/End jump.
 */
export function EmojiGrid({ value, onChange, labelledBy, disabled }: EmojiGridProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(0, EMOJIS.indexOf(value as (typeof EMOJIS)[number]));

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    switch (e.key) {
      case 'ArrowRight':
        next = index + 1;
        break;
      case 'ArrowLeft':
        next = index - 1;
        break;
      case 'ArrowDown':
        next = index + COLUMNS;
        break;
      case 'ArrowUp':
        next = index - COLUMNS;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = EMOJIS.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    next = (next + EMOJIS.length) % EMOJIS.length;
    onChange(EMOJIS[next]);
    refs.current[next]?.focus();
  };

  return (
    <div className={styles.grid} role="radiogroup" aria-labelledby={labelledBy}>
      {EMOJIS.map((emoji, i) => {
        const on = i === selected;
        return (
          <button
            key={emoji}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={emoji}
            tabIndex={on ? 0 : -1}
            disabled={disabled}
            className={styles.cell}
            data-on={on || undefined}
            onClick={() => onChange(emoji)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <EmojiText text={emoji} />
          </button>
        );
      })}
    </div>
  );
}
