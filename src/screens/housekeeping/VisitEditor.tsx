import { useId } from 'react';
import { TEXT_LIMITS } from '../../lib/constants';
import {
  checklistFor,
  doneByline,
  matchesTarget,
  visitByline,
  visitOn,
  type ChecklistRow,
} from '../../lib/logic/housekeeping';
import type { HousekeepingVisitTask, ISODate } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { AutoGrowTextarea } from '../item/AutoGrowTextarea';
import { Checklist } from './Checklist';
import { PriceField } from './PriceField';
import { useSavedText } from './useSavedText';
import styles from './Housekeeping.module.css';

interface VisitEditorProps {
  /** The day (household time zone). Mount one per day (key it by date). */
  date: ISODate;
  /** The checklist's name: "Tasks today", "Tasks on Thursday 1 October". */
  legend: string;
  /** Level of the "Comments" heading: under Today (h2) it is 3, under a day (h3) 4. */
  level: 3 | 4;
  /** Says what was saved, politely (the screen's live region). */
  announce(text: string): void;
  /** Opens the task list sheet (offered when today has no tasks). */
  onEditTasks?(): void;
}

export const NOT_STARTED = "Not started yet. Ticking a task starts today's visit.";

/**
 * One day's visit, editable (everyone edits everything): the checklist, comments, the price
 * for the day, and who recorded it. A day with no visit yet shows the task list unticked;
 * the first tick (or comments, or a price) records the visit.
 */
export function VisitEditor({ date, legend, level, announce, onEditTasks }: VisitEditorProps) {
  const { data, today, setHousekeepingTaskDone, saveHousekeepingVisit } = useHousehold();
  const housekeeping = data.housekeeping;
  const { members } = data;
  const timeZone = data.household.timezone;
  const visit = visitOn(housekeeping.visits, date);
  const rows = checklistFor(housekeeping, date);
  const now = new Date();
  const commentsId = useId();
  const Heading = level === 3 ? 'h3' : 'h4';

  const comments = useSavedText(visit?.comments ?? '', (text) =>
    saveHousekeepingVisit(date, { comments: text }).then(() => announce('Saved')),
  );

  const tick = (row: ChecklistRow, done: boolean) => {
    void setHousekeepingTaskDone(date, row.target, done)
      .then(() => announce(`${row.title} ${done ? 'done' : 'not done'}`))
      .catch(() => {});
  };

  const bylineOf = (row: ChecklistRow): string | null => {
    if (!row.done) return null;
    const stored = visit?.tasks.find((t) => matchesTarget(t, row.target));
    const task: HousekeepingVisitTask = stored ?? {
      id: row.key,
      visit_id: visit?.id ?? '',
      household_id: data.household.id,
      task_id: 'taskId' in row.target ? row.target.taskId : null,
      title: row.title,
      position: 0,
      done: row.done,
      done_by: row.doneBy,
      done_at: row.doneAt,
    };
    return doneByline(task, date, members, timeZone, now);
  };

  const byline = visit ? visitByline(visit, members, timeZone, now) : date === today ? NOT_STARTED : null;

  return (
    <div>
      {rows.length ? (
        <Checklist legend={legend} rows={rows} bylineOf={bylineOf} onTick={tick} />
      ) : date === today ? (
        <div className={styles.card}>
          <p className={styles.emptyText}>No tasks yet.</p>
          {onEditTasks ? (
            <button type="button" className={styles.cardButton} onClick={onEditTasks}>
              Add tasks
            </button>
          ) : null}
        </div>
      ) : (
        <div className={styles.card}>
          <p className={styles.emptyText}>No tasks on this visit.</p>
        </div>
      )}

      <Heading id={commentsId} className={styles.subheader}>
        Comments
      </Heading>
      <div className={styles.card}>
        <AutoGrowTextarea
          className={styles.textField}
          value={comments.value}
          onChange={(e) => comments.onChange(e.target.value)}
          onFocus={comments.onFocus}
          onBlur={comments.onBlur}
          aria-labelledby={commentsId}
          placeholder="Anything to mention, e.g. we're out of bin bags"
          maxLength={TEXT_LIMITS.housekeepingComments}
          autoCapitalize="sentences"
        />
      </div>

      <div className={styles.gap} />
      <PriceField
        stored={visit?.price_pence ?? null}
        onSave={(price_pence) => saveHousekeepingVisit(date, { price_pence }).then(() => announce('Saved'))}
      />

      {byline ? <p className={styles.caption}>{byline}</p> : null}
    </div>
  );
}
