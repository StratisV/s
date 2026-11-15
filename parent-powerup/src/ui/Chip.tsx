import type { ReactNode } from 'react';
import styles from './Chip.module.css';

interface ChipProps {
  selected?: boolean;
  onClick?: () => void;
  emoji?: string;
  children: ReactNode;
  /** Plain words for a screen reader when the chip's text is not enough. */
  label?: string;
  size?: 'sm' | 'md';
}

/** A rounded toggle: an issue filter, an interest, a temperament. */
export function Chip({ selected = false, onClick, emoji, children, label, size = 'md' }: ChipProps) {
  return (
    <button
      type="button"
      className={styles.chip}
      data-size={size}
      aria-pressed={selected}
      aria-label={label}
      onClick={onClick}
    >
      {emoji && (
        <span className={styles.emoji} aria-hidden="true">
          {emoji}
        </span>
      )}
      <span>{children}</span>
    </button>
  );
}

/** A row of chips that scrolls sideways (filters) or wraps (pickers in a form). */
export function ChipRow({ children, wrap = false, label }: { children: ReactNode; wrap?: boolean; label?: string }) {
  return (
    <div className={styles.row} data-wrap={wrap || undefined} role="group" aria-label={label}>
      {children}
    </div>
  );
}
