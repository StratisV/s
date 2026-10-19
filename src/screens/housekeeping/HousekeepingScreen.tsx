import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { longDay } from '../../lib/logic/dates';
import { daySelectedAnnouncement, housekeepingSubtitle, isRecorded, monthOf, visitOn } from '../../lib/logic/housekeeping';
import type { ISODate } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { mondayOf, revealDay, useChosenDay, type ChosenDay } from '../../ui/DatePicker';
import { Screen } from '../../ui/Screen';
import { Calendar } from './Calendar';
import { DayDetail } from './DayDetail';
import { DeleteVisitButton, DeleteVisitSheet } from './DeleteVisit';
import { NoteSection } from './NoteSection';
import { VisitEditor } from './VisitEditor';
import styles from './Housekeeping.module.css';

interface HousekeepingScreenProps {
  onOpenProfile(): void;
  /**
   * Opens the task list sheet (App mounts it beside the stage, like the Item sheet), from
   * the button pressed: focus goes back to it when the sheet closes.
   */
  onEditTasks(opener: HTMLElement): void;
  /**
   * A day to show, from Needs attention's calendar (a visit there): chosen in the calendar as if tapped
   * here, brought into view and focused (today: the Today section). Then `onDayShown`.
   */
  showDay?: ISODate | null;
  onDayShown?(): void;
}

/** The chosen day and the week and month shown, remembered while the app runs (the tab comes and goes). */
const remembered: { current: ChosenDay | null } = { current: null };

/**
 * How much of the screen choosing a day leaves under its heading, at most, for the day's
 * details: a visit is long, and this keeps the calendar in sight above it.
 */
const DAY_ROOM = 0.45;

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * Housekeeping (docs/ARCHITECTURE.md "Housekeeping"): the weekly visit by the housekeeper,
 * who is a household member like everyone else. Today's date over the title, as on Home.
 * Top to bottom: the calendar of every visit (Home's date picker: this week, today chosen at
 * first), the message for the housekeeper, then the chosen day: today's visit (checklist,
 * comments, price, and Delete Visit once something is recorded), or another day's visit.
 * Everything saves itself; a polite live region says what was saved.
 */
export function HousekeepingScreen({ onOpenProfile, onEditTasks, showDay, onDayShown }: HousekeepingScreenProps) {
  const { data, me, today, deleteHousekeepingVisit } = useHousehold();
  const { visits } = data.housekeeping;
  const todayHeadingId = useId();
  // The chosen day's heading: Today, or the day's date.
  const dayHeadingRef = useRef<HTMLHeadingElement>(null);
  const todaysVisit = visitOn(visits, today);
  const [confirmToday, setConfirmToday] = useState(false);
  // Another household, or a new day since: start on today, in this week and month.
  const { chosen, update, reset } = useChosenDay(remembered, data.household.id, today);
  const date = chosen.selected;

  // What was saved, read out politely. A new key re-announces the same words.
  const [said, setSaid] = useState({ text: '', key: 0 });
  const announce = useCallback((text: string) => setSaid((s) => ({ text, key: s.key + 1 })), []);

  // A day was chosen: once it shows, bring it up if it is low on the screen, as far as
  // DAY_ROOM of the screen under its heading (focus stays in the calendar).
  const [reveal, setReveal] = useState(0);
  useEffect(() => {
    if (!reveal) return;
    const heading = dayHeadingRef.current;
    const section = heading?.closest('section');
    if (heading && section) revealDay(section, heading, window.innerHeight * DAY_ROOM);
  }, [reveal]);

  const select = (day: ISODate) => {
    update({ selected: day, week: mondayOf(day) });
    announce(daySelectedAnnouncement(day, today, visitOn(visits, day)));
    setReveal((n) => n + 1);
  };

  // A day from Needs attention's calendar: choose it (in its week and month), then once it shows, bring
  // its heading to the top and put focus on it, so VoiceOver carries on from there.
  const [shownDay, setShownDay] = useState<ISODate | null>(null);
  const onDayShownRef = useRef(onDayShown);
  onDayShownRef.current = onDayShown;
  useEffect(() => {
    if (!showDay) return;
    update({ selected: showDay, month: monthOf(showDay), week: mondayOf(showDay) });
    setShownDay(showDay);
    // `update` only sets state.
  }, [showDay]);
  useEffect(() => {
    if (!shownDay || date !== shownDay) return;
    setShownDay(null);
    const heading = dayHeadingRef.current;
    if (heading) {
      heading.scrollIntoView?.({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
      heading.focus({ preventScroll: true });
    }
    onDayShownRef.current?.();
  }, [shownDay, date]);

  const deleteToday = () => {
    setConfirmToday(false);
    if (!todaysVisit) return;
    // Today's section stays, unticked: carry on from its heading.
    dayHeadingRef.current?.focus({ preventScroll: true });
    void deleteHousekeepingVisit(todaysVisit.id)
      .then(() => announce('Visit deleted'))
      .catch(() => {});
  };

  return (
    <Screen
      label="Housekeeping"
      title="Housekeeping"
      subtitle={housekeepingSubtitle(visits, today)}
      eyebrow={<time dateTime={today}>{longDay(today)}</time>}
      avatarEmoji={me.emoji}
      onAvatar={onOpenProfile}
      withAdd={false}
    >
      <Calendar chosen={chosen} onChange={update} onReset={reset} onSelect={select} today={today} visits={visits} />

      <NoteSection announce={announce} />

      {date === today ? (
        <section aria-labelledby={todayHeadingId}>
          <div className={styles.headerRow}>
            <h2 id={todayHeadingId} ref={dayHeadingRef} className={`${styles.header} ${styles.target}`} tabIndex={-1}>
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
            announce={announce}
            onEditTasks={onEditTasks}
          />
          {todaysVisit && isRecorded(todaysVisit) ? (
            <>
              <div className={styles.gap} />
              <DeleteVisitButton onPress={() => setConfirmToday(true)} />
            </>
          ) : null}
        </section>
      ) : (
        <DayDetail date={date} announce={announce} headingRef={dayHeadingRef} />
      )}
      {/* Beside the section, not in it: it can slide away whichever day shows. */}
      <DeleteVisitSheet
        open={confirmToday && !!todaysVisit}
        title="Delete today's visit?"
        onConfirm={deleteToday}
        onCancel={() => setConfirmToday(false)}
      />

      <div className="visually-hidden" aria-live="polite" data-announcer="">
        <span key={said.key}>{said.text}</span>
      </div>
    </Screen>
  );
}
