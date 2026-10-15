import { useId } from 'react';
import { sectionHeadingLabel, sectionProgress, type ChecklistRow, type ChecklistSection } from '../../lib/logic/housekeeping';
import { EmojiText } from '../../ui/EmojiText';
import { CheckIcon } from '../../ui/icons';
import { SectionIcon } from './SectionIcon';
import styles from './Checklist.module.css';

interface ChecklistProps {
  /** Read out as the group's name: "Tasks today", "Tasks on Thursday 1 October". */
  legend: string;
  /** The day's tasks, section by section (checklistSections()): the tasks in no section first. */
  sections: ChecklistSection[];
  /** "🦊 Ela · 10:42" under a ticked row (who ticked it, when); null when not done. */
  bylineOf(row: ChecklistRow): string | null;
  onTick(row: ChecklistRow, done: boolean): void;
}

/**
 * A day's tasks as iOS-style round checkboxes, one per row, section by section: the tasks in
 * no section first, in a card of their own with no heading, then a card per section. A
 * section's card opens with its drawing, its name (an h3, under the day's h2, whose spoken
 * name has the progress too: "Kitchen, 2 of 5 done") and a small ring that fills as its
 * tasks are ticked ("2 of 5"), and becomes a green tick when all are. The whole row toggles;
 * a ticked row says who ticked it and when, which is also the checkbox's description.
 */
export function Checklist({ legend, sections, bylineOf, onTick }: ChecklistProps) {
  return (
    <fieldset className={styles.checklist}>
      <legend className="visually-hidden">{legend}</legend>
      {sections.map((section) =>
        section.title === null ? (
          <div key={section.key} className={styles.card} data-checklist-section="">
            <Rows rows={section.rows} bylineOf={bylineOf} onTick={onTick} />
          </div>
        ) : (
          <SectionCard key={section.key} section={section} title={section.title} bylineOf={bylineOf} onTick={onTick} />
        ),
      )}
    </fieldset>
  );
}

function SectionCard({
  section,
  title,
  bylineOf,
  onTick,
}: {
  section: ChecklistSection;
  title: string;
  bylineOf: ChecklistProps['bylineOf'];
  onTick: ChecklistProps['onTick'];
}) {
  const headingId = useId();
  const total = section.rows.length;
  const allDone = section.done === total;
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className={`${styles.card} ${styles.section}`}
      data-checklist-section={title}
      data-all-done={allDone || undefined}
    >
      <div className={styles.head}>
        <span className={styles.glyph} aria-hidden="true">
          <SectionIcon name={title} size={19} />
        </span>
        {/* Named with its progress, as one phrase: "Kitchen, 2 of 5 done". */}
        <h3 id={headingId} className={styles.name} aria-label={sectionHeadingLabel(title, section.done, total)}>
          {title}
        </h3>
        <span className={styles.progress} aria-hidden="true">
          <span className={styles.count}>{allDone ? 'All done' : sectionProgress(section.done, total)}</span>
          <ProgressRing done={section.done} total={total} />
        </span>
      </div>
      <Rows rows={section.rows} bylineOf={bylineOf} onTick={onTick} />
    </div>
  );
}

/** The ring's circumference (r = 9.25). */
const RING = 2 * Math.PI * 9.25;

/** Fills with the tint as tasks are ticked; all ticked, a green disc with a white tick springs in. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const share = total > 0 ? done / total : 0;
  return (
    <svg
      className={styles.ring}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-empty={done === 0 || undefined}
    >
      <circle className={styles.ringTrack} cx="12" cy="12" r="9.25" />
      <circle
        className={styles.ringFill}
        cx="12"
        cy="12"
        r="9.25"
        strokeDasharray={RING}
        strokeDashoffset={RING * (1 - share)}
      />
      <circle className={styles.ringDone} cx="12" cy="12" r="11" />
      <path className={styles.ringTick} d="M7.6 12.3l3 3 5.8-6" pathLength={1} />
    </svg>
  );
}

function Rows({ rows, bylineOf, onTick }: { rows: ChecklistRow[]; bylineOf: ChecklistProps['bylineOf']; onTick: ChecklistProps['onTick'] }) {
  return (
    <ul className={styles.list} role="list">
      {rows.map((row) => (
        <Row key={row.key} row={row} byline={bylineOf(row)} onTick={onTick} />
      ))}
    </ul>
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
              <EmojiText text={byline} />
            </span>
          ) : null}
        </span>
      </label>
    </li>
  );
}
