import type { MouseEvent } from 'react';
import type { Rag } from '../../lib/types';
import { CheckIcon } from '../../ui/icons';
import styles from './StatusRing.module.css';

interface StatusRingProps {
  /** Filled with the tint and a white check while the item is being completed. */
  done: boolean;
  label: string;
  onClick(event: MouseEvent<HTMLButtonElement>): void;
}

/**
 * The ring at the start of a To do's row; tapping it marks the item done. Always a neutral
 * grey ring (its urgency is said in words on the row, never by the ring), so a page of jobs
 * stays calm and the words carry the colour.
 */
export function StatusRing({ done, label, onClick }: StatusRingProps) {
  return (
    <button type="button" className={styles.ring} data-done={done || undefined} aria-label={label} onClick={onClick}>
      <CheckIcon className={styles.check} size={14} strokeWidth={3.2} />
    </button>
  );
}

/** How many of the gauge's three bars a condition fills: Good all three, Fair two, Poor one. */
const FILLED: Record<Rag, number> = { green: 3, amber: 2, red: 1 };

/**
 * A To maintain item's condition as a gauge of three bars, filled in its colour: Good fills
 * all three, Fair two, Poor one. A thing that is looked after is never "done", so it never
 * gets a ring. `row`: rising bars in the ring's place on a row; `tile`: a flat bar of three
 * segments. Decorative: the row or tile says the condition in words.
 */
export function ConditionGauge({ rag, variant = 'row' }: { rag: Rag; variant?: 'row' | 'tile' }) {
  const filled = FILLED[rag];
  return (
    <span className={styles.gauge} data-variant={variant} data-rag={rag} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className={styles.bar} data-on={i < filled || undefined} />
      ))}
    </span>
  );
}
