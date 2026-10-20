import type { StatusLine } from '../../lib/logic/areaStatus';
import styles from './StatusLines.module.css';

interface StatusLinesProps {
  /** From statusLines(): "2 urgent tasks" and "1 non-urgent task", or "All good". */
  lines: StatusLine[];
  /** 13px on a card on Home, 15px under the name in an area's sheet. */
  size?: 'card' | 'sheet';
}

/**
 * How an area is, one line each (statusLines()): a dot and words in red for urgent tasks, in
 * orange for non-urgent ones, in green for All good. Read as one phrase ("2 urgent tasks, 1
 * non-urgent task"): a visually hidden comma joins the lines.
 */
export function StatusLines({ lines, size = 'card' }: StatusLinesProps) {
  return (
    <span className={styles.lines} data-size={size}>
      {lines.map((line, i) => (
        <span key={line.tone} className={styles.line} data-tone={line.tone}>
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.text}>{line.text}</span>
          {i < lines.length - 1 ? <span className="visually-hidden">, </span> : null}
        </span>
      ))}
    </span>
  );
}
