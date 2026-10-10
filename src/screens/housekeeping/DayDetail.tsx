import { useEffect, useRef, useState } from 'react';
import { formatDay } from '../../lib/logic/dates';
import { longDay, visitOn } from '../../lib/logic/housekeeping';
import type { ISODate } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { DeleteVisitButton, DeleteVisitSheet } from './DeleteVisit';
import { VisitEditor } from './VisitEditor';
import styles from './Housekeeping.module.css';

interface DayDetailProps {
  /** The day chosen in the calendar; null: nothing chosen yet. */
  date: ISODate | null;
  announce(text: string): void;
  /** Brings the Today section into view and focuses its heading. */
  onShowToday(): void;
}

/**
 * The day chosen in the calendar, under it: its visit (the message that day, then the same
 * editor as today's, then Delete Visit), or "No visit recorded." with Add a visit, or, for
 * today, a pointer back up to Today.
 */
export function DayDetail({ date, announce, onShowToday }: DayDetailProps) {
  const { data, today, addHousekeepingVisit, deleteHousekeepingVisit } = useHousehold();
  const rootRef = useRef<HTMLDivElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Where focus goes once the change shows: the new visit's first task, or Add a visit.
  const focusAfter = useRef<'visit' | 'add' | null>(null);
  const visit = date ? visitOn(data.housekeeping.visits, date) : undefined;
  const hasVisit = !!visit;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !focusAfter.current) return;
    if (focusAfter.current === 'visit' && hasVisit) {
      focusAfter.current = null;
      root.querySelector<HTMLElement>('input[type="checkbox"], textarea')?.focus();
    } else if (focusAfter.current === 'add' && !hasVisit) {
      focusAfter.current = null;
      root.querySelector<HTMLElement>('[data-add-visit]')?.focus();
    }
  }, [hasVisit, date]);

  // Another day: nothing pending from the last one.
  useEffect(() => {
    focusAfter.current = null;
    setConfirmOpen(false);
  }, [date]);

  if (!date) {
    return (
      <p className={styles.hint} data-day-detail="">
        Tap a day to see its visit.
      </p>
    );
  }

  const add = () => {
    focusAfter.current = 'visit';
    void addHousekeepingVisit(date)
      .then(() => announce('Visit added'))
      .catch(() => {
        focusAfter.current = null;
      });
  };

  const confirmDelete = () => {
    setConfirmOpen(false);
    if (!visit) return;
    focusAfter.current = 'add';
    void deleteHousekeepingVisit(visit.id)
      .then(() => announce('Visit deleted'))
      .catch(() => {
        focusAfter.current = null;
      });
  };

  const heading = longDay(date, today);

  return (
    <div ref={rootRef} data-day-detail={date}>
      <h3 className={styles.dayHeader}>{heading}</h3>
      {date === today ? (
        <div className={styles.card}>
          <div className={styles.cardRow}>
            <span className={styles.cardRowText}>Today's visit is above.</span>
            <button type="button" className={styles.inlineAction} aria-label="Show today's visit" onClick={onShowToday}>
              Show
            </button>
          </div>
        </div>
      ) : visit ? (
        <>
          <div className={styles.card}>
            <div className={styles.message}>
              <span className={styles.messageLabel}>Message that day</span>
              {visit.note ? (
                <span className={styles.messageText}>{visit.note}</span>
              ) : (
                <span className={styles.messageEmpty}>No message that day.</span>
              )}
            </div>
          </div>
          <div className={styles.gap} />
          <VisitEditor
            key={date}
            date={date}
            legend={`Tasks on ${heading}`}
            dayName={heading}
            level={4}
            announce={announce}
          />
          <div className={styles.gap} />
          <DeleteVisitButton onPress={() => setConfirmOpen(true)} />
        </>
      ) : (
        <div className={styles.card}>
          <p className={styles.emptyText}>No visit recorded.</p>
          <button type="button" className={styles.cardButton} data-add-visit="" onClick={add}>
            Add a visit
          </button>
        </div>
      )}
      <DeleteVisitSheet
        open={confirmOpen && !!visit}
        title={`Delete the visit on ${formatDay(date, today)}?`}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
