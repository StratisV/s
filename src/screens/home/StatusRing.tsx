import type { MouseEvent } from 'react';
import type { Rag } from '../../lib/types';
import { CheckIcon } from '../../ui/icons';
import styles from './StatusRing.module.css';

interface StatusRingProps {
  /** Filled with the tint and a white check while the item is being completed. */
  done: boolean;
  label: string;
  onClick(event: MouseEvent<HTMLButtonElement>): void;
  /** Where it sits: a row puts it level with the title's first line, a card centres it. */
  className?: string;
}

/**
 * The ring that marks a To do done (at the start of a row, at the end of a card). Always a
 * neutral grey ring (its urgency is said in words, never by the ring), so a page of jobs stays
 * calm and the words carry the colour.
 */
export function StatusRing({ done, label, onClick, className }: StatusRingProps) {
  return (
    <button
      type="button"
      className={className ? `${styles.ring} ${className}` : styles.ring}
      data-done={done || undefined}
      aria-label={label}
      onClick={onClick}
    >
      <CheckIcon className={styles.check} size={14} strokeWidth={3.2} />
    </button>
  );
}

/** How many of the gauge's three bars a condition fills: Good all three, Okay two, Needs work one. */
const FILLED: Record<Rag, number> = { green: 3, amber: 2, red: 1 };

/**
 * A To maintain item's condition as a gauge of three rising bars in the ring's place, filled in
 * its colour: Good fills all three, Okay two, Needs work one. A thing that is looked after is
 * never "done", so it never gets a ring. Decorative: the row or card says the condition in words.
 */
export function ConditionGauge({ rag, className }: { rag: Rag; className?: string }) {
  const filled = FILLED[rag];
  return (
    <span className={className ? `${styles.gauge} ${className}` : styles.gauge} data-variant="row" data-rag={rag} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className={styles.bar} data-on={i < filled || undefined} />
      ))}
    </span>
  );
}
