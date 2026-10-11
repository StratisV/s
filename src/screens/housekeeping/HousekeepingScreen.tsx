import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  daySelectedAnnouncement,
  defaultSelectedDay,
  housekeepingSubtitle,
  isRecorded,
  monthOf,
  visitOn,
  type YearMonth,
} from '../../lib/logic/housekeeping';
import type { ISODate } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { Screen } from '../../ui/Screen';
import { Calendar } from './Calendar';
import { DayDetail } from './DayDetail';
import { DeleteVisitButton, DeleteVisitSheet } from './DeleteVisit';
import { NoteSection } from './NoteSection';
import { VisitEditor } from './VisitEditor';
import styles from './Housekeeping.module.css';

interface HousekeepingScreenProps {
  /** The tab switch, under the hero. */
  tabs?: ReactNode;
  onOpenProfile(): void;
  /**
   * Opens the task list sheet (App mounts it beside the stage, like the Item sheet), from
   * the button pressed: focus goes back to it when the sheet closes.
   */
  onEditTasks(opener: HTMLElement): void;
  /**
   * A day to show, from Home's calendar (a visit there): chosen in the calendar as if tapped
   * here, brought into view and focused (today: the Today section). Then `onDayShown`.
   */
  showDay?: ISODate | null;
  onDayShown?(): void;
}

/** The calendar's month and chosen day, remembered while the app runs (like Stats' period). */
let remembered: {
  householdId: string;
  month: YearMonth;
  selected: ISODate | null;
} | null = null;

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * Housekeeping (docs/ARCHITECTURE.md "Housekeeping"): the weekly visit by the housekeeper,
 * who is a household member like everyone else. Top to bottom: the message for the
 * housekeeper, today's visit (checklist, comments, price, and Delete Visit once something
 * is recorded), and the calendar of every visit with the chosen day's visit under it.
 * Everything saves itself; a polite live region says what was saved.
 */
export function HousekeepingScreen({ tabs, onOpenProfile, onEditTasks, showDay, onDayShown }: HousekeepingScreenProps) {
  const { data, me, today, deleteHousekeepingVisit } = useHousehold();
  const { visits } = data.housekeeping;
  const householdId = data.household.id;
  const todayHeadingId = useId();
  const calendarHeadingId = useId();
  const todayRef = useRef<HTMLHeadingElement>(null);
  const calendarRef = useRef<HTMLElement>(null);
  const todaysVisit = visitOn(visits, today);
  const [confirmToday, setConfirmToday] = useState(false);

  const [view, setView] = useState(() =>
    remembered?.householdId === householdId
      ? remembered
      : {
          householdId,
          month: monthOf(today),
          selected: defaultSelectedDay(visits, today),
        },
  );
  const update = (patch: Partial<Pick<NonNullable<typeof remembered>, 'month' | 'selected'>>) => {
    setView((v) => {
      const next = { ...v, ...patch };
      remembered = next;
      return next;
    });
  };

  // What was saved, read out politely. A new key re-announces the same words.
  const [said, setSaid] = useState({ text: '', key: 0 });
  const announce = useCallback((text: string) => setSaid((s) => ({ text, key: s.key + 1 })), []);

  // A day was chosen: once it shows, bring its details up if they are low on the screen
  // (focus stays in the calendar).
  const [reveal, setReveal] = useState(0);
  useEffect(() => {
    if (!reveal) return;
    const heading = calendarRef.current?.querySelector<HTMLElement>('[data-day-detail] h3');
    heading?.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [reveal]);

  const select = (date: ISODate) => {
    update({ selected: date });
    announce(daySelectedAnnouncement(date, today, visitOn(visits, date)));
    setReveal((n) => n + 1);
  };

  // Another month: show its latest visit, or nothing (the hint), never a day from elsewhere.
  const changeMonth = (month: YearMonth) => {
    update({
      month,
      selected: view.selected && monthOf(view.selected) === month ? view.selected : defaultSelectedDay(visits, today, month),
    });
  };

  const showToday = () => {
    const heading = todayRef.current;
    if (!heading) return;
    heading.scrollIntoView({
      block: 'start',
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
    heading.focus({ preventScroll: true });
  };

  // A day from Home's calendar: choose it (in its month), then once it shows, bring its
  // details into view and put focus on its heading, so VoiceOver carries on from there.
  const [shownDay, setShownDay] = useState<ISODate | null>(null);
  const shownDayRef = useRef({ onDayShown, showToday });
  shownDayRef.current = { onDayShown, showToday };
  useEffect(() => {
    if (!showDay) return;
    update({ month: monthOf(showDay), selected: showDay });
    setShownDay(showDay);
    // `update` only sets state.
  }, [showDay]);
  useEffect(() => {
    if (!shownDay || view.selected !== shownDay) return;
    setShownDay(null);
    if (shownDay === today) {
      shownDayRef.current.showToday();
    } else {
      const heading = calendarRef.current?.querySelector<HTMLElement>('[data-day-detail] h3');
      if (heading) {
        heading.scrollIntoView?.({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
        heading.focus({ preventScroll: true });
      }
    }
    shownDayRef.current.onDayShown?.();
  }, [shownDay, view.selected, today]);

  const deleteToday = () => {
    setConfirmToday(false);
    if (!todaysVisit) return;
    // Today's section stays, unticked: carry on from its heading.
    todayRef.current?.focus({ preventScroll: true });
    void deleteHousekeepingVisit(todaysVisit.id)
      .then(() => announce('Visit deleted'))
      .catch(() => {});
  };

  return (
    <Screen
      label="Housekeeping"
      title="Housekeeping"
      subtitle={housekeepingSubtitle(visits, today)}
      avatarEmoji={me.emoji}
      onAvatar={onOpenProfile}
      tabs={tabs}
      withAdd={false}
    >
      <NoteSection announce={announce} />

      <section aria-labelledby={todayHeadingId}>
        <div className={styles.headerRow}>
          <h2 id={todayHeadingId} ref={todayRef} className={`${styles.header} ${styles.target}`} tabIndex={-1}>
            Today
          </h2>
          <button
            type="button"
            className={styles.headerAction}
            aria-label="Edit task list"
            onClick={(e) => onEditTasks(e.currentTarget)}
          >
            Edit
          </button>
        </div>
        <VisitEditor
          key={today}
          date={today}
          legend="Tasks today"
          level={3}
          announce={announce}
          onEditTasks={onEditTasks}
        />
        {todaysVisit && isRecorded(todaysVisit) ? (
          <>
            <div className={styles.gap} />
            <DeleteVisitButton onPress={() => setConfirmToday(true)} />
          </>
        ) : null}
        <DeleteVisitSheet
          open={confirmToday && !!todaysVisit}
          title="Delete today's visit?"
          onConfirm={deleteToday}
          onCancel={() => setConfirmToday(false)}
        />
      </section>

      <section ref={calendarRef} aria-labelledby={calendarHeadingId}>
        <div className={styles.headerRow}>
          <h2 id={calendarHeadingId} className={styles.header}>
            Calendar
          </h2>
        </div>
        <Calendar
          month={view.month}
          onMonth={changeMonth}
          selected={view.selected}
          onSelect={select}
          today={today}
          visits={visits}
        />
        <DayDetail date={view.selected} announce={announce} onShowToday={showToday} />
      </section>

      <div className="visually-hidden" aria-live="polite" data-announcer="">
        <span key={said.key}>{said.text}</span>
      </div>
    </Screen>
  );
}
