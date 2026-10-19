import { useEffect, useId, useRef, useState, type Ref } from 'react';
import { formatDay } from '../../lib/logic/dates';
import { longDay, visitOn } from '../../lib/logic/housekeeping';
import type { ISODate } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { DeleteVisitButton, DeleteVisitSheet } from './DeleteVisit';
import { VisitEditor } from './VisitEditor';
import styles from './Housekeeping.module.css';

interface DayDetailProps {
  /** The day chosen in the calendar, before today (today has the Today section). */
  date: ISODate;
  announce(text: string): void;
  /** The day's heading: brought into view when the day is chosen, focused when Needs attention's calendar opens it here. */
  headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * A day before today, chosen in the calendar, in place of the Today section: its heading, then
 * its visit (the message that day, then the same editor as today's, then Delete Visit), or
 * "No visit recorded." with Add a visit.
 */
export function DayDetail({ date, announce, headingRef }: DayDetailProps) {
  const { data, today, addHousekeepingVisit, deleteHousekeepingVisit } = useHousehold();
  const headingId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Where focus goes once the change shows: the new visit's first task, or Add a visit.
  const focusAfter = useRef<'visit' | 'add' | null>(null);
  const visit = visitOn(data.housekeeping.visits, date);
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
    <section ref={rootRef} aria-labelledby={headingId} data-day-detail={date}>
      <div className={styles.headerRow}>
        {/* Focused when Needs attention's calendar opens this day here. */}
        <h2 id={headingId} ref={headingRef} className={`${styles.header} ${styles.target}`} tabIndex={-1}>
          {heading}
        </h2>
      </div>
      {visit ? (
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
    </section>
  );
}
