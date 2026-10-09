import { useId } from 'react';
import type { ChecklistRow } from '../../lib/logic/housekeeping';
import { CheckIcon } from '../../ui/icons';
import styles from './Checklist.module.css';

interface ChecklistProps {
  /** Read out as the group's name: "Tasks today", "Tasks on Thursday 1 October". */
  legend: string;
  rows: ChecklistRow[];
  /** "🦊 Ela · 10:42" under a ticked row (who ticked it, when); null when not done. */
  bylineOf(row: ChecklistRow): string | null;
  onTick(row: ChecklistRow, done: boolean): void;
}

/**
 * A day's tasks as iOS-style round checkboxes, one per row. The whole row toggles; a
 * ticked row says who ticked it and when, which is also the checkbox's description.
 */
export function Checklist({ legend, rows, bylineOf, onTick }: ChecklistProps) {
  return (
    <fieldset className={styles.card}>
      <legend className="visually-hidden">{legend}</legend>
      <ul className={styles.list} role="list">
        {rows.map((row) => (
          <Row key={row.key} row={row} byline={bylineOf(row)} onTick={onTick} />
        ))}
      </ul>
    </fieldset>
  );
}

function Row({ row, byline, onTick }: { row: ChecklistRow; byline: string | null; onTick: ChecklistProps['onTick'] }) {
  const titleId = useId();
  const bylineId = useId();
  return (
    <li className={styles.item}>
      <label className={styles.row} data-done={row.done || undefined}>
        <input
          type="checkbox"
          className={styles.box}
          checked={row.done}
          aria-labelledby={titleId}
          aria-describedby={byline ? bylineId : undefined}
          onChange={(e) => onTick(row, e.currentTarget.checked)}
        />
        <span className={styles.circle} aria-hidden="true">
          <CheckIcon size={15} strokeWidth={3} />
        </span>
        <span className={styles.text}>
          <span id={titleId} className={styles.title}>
            {row.title}
          </span>
          {byline ? (
            <span id={bylineId} className={styles.byline}>
              {byline}
            </span>
          ) : null}
        </span>
      </label>
    </li>
  );
}
