import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { RAG_LABEL, RAG_RING, RAG_TEXT } from '../../lib/constants';
import {
  calendarDayAnnouncement,
  calendarDayName,
  calendarLookup,
  dayDots,
  dayRows,
  repeatMeta,
  todaySummary,
  visitSummary,
  type CalendarDay,
} from '../../lib/logic/calendar';
import { doneCount, formatPrice } from '../../lib/logic/housekeeping';
import { itemMeta, memberLabel } from '../../lib/logic/items';
import { fullDay } from '../../lib/logic/months';
import type { HousekeepingVisit, ISODate, Item, Member } from '../../lib/types';
import { DatePicker, mondayOf, revealDay, useChosenDay, type ChosenDay } from '../../ui/DatePicker';
import { EmojiText } from '../../ui/EmojiText';
import { BroomIcon, ChevronRightIcon } from '../../ui/icons';
import { ItemRow } from './ItemRow';
import type { PersonFilter } from './personFilter';
import rowStyles from './ItemRow.module.css';
import styles from './HomeCalendar.module.css';

/** Where this device remembers the week strip or the month: 'month', or nothing for the week. */
export const CALENDAR_VIEW_KEY = 'homeos.calendar';

interface Chosen extends ChosenDay {
  /**
   * The chosen day's list shows under the calendar. False for today at first: a line says
   * what is due (its rows are in the areas just below) until today is chosen.
   */
  opened: boolean;
}

/** The chosen day and the month and week shown, remembered while the app runs (Home comes and goes with its tab). */
const remembered: { current: Chosen | null } = { current: null };

/** Today, at first, is not opened. */
const notOpened = (fresh: ChosenDay): Chosen => ({ ...fresh, opened: false });

interface HomeCalendarProps {
  householdId: string;
  /** The open items Home shows (the person filter applied), in Home's order. */
  items: Item[];
  visits: HousekeepingVisit[];
  members: Member[];
  /** Today in the household's time zone. */
  today: ISODate;
  /** The household's, for the rows' dates. */
  timeZone: string;
  /** Whose items they are, for an empty day ("Nothing due for Shea."). */
  who: PersonFilter;
  onOpenItem(itemId: string): void;
  onComplete(itemId: string): Promise<void>;
  /** Shows that day in the Housekeeping tab. */
  onOpenHousekeeping?(date: ISODate): void;
}

/**
 * Home's calendar (docs/ARCHITECTURE.md "Home: the calendar"), under the person filter: the
 * week as a strip, or the whole month (Show month / Show week, remembered on this device),
 * with Previous and Next for the week or the month and Today to come back: the date picker
 * Housekeeping uses too (src/ui/DatePicker.tsx). Each day shows the To do items due (status
 * dots, up to three and "+2"; the number in red when something was missed), the later
 * repeats of repeating items (faint hollow dots) and the housekeeping visit (a dot in the
 * circle, as in Housekeeping). Today is chosen at first, with a line saying what is due; a
 * chosen day's items show under the calendar, as Home's rows.
 */
export function HomeCalendar({
  householdId,
  items,
  visits,
  members,
  today,
  timeZone,
  who,
  onOpenItem,
  onComplete,
  onOpenHousekeeping,
}: HomeCalendarProps) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  // Another household, or a new day since: start on today, in this week and month.
  const { chosen, update, reset } = useChosenDay(remembered, householdId, today, notOpened);

  const lookup = useMemo(() => calendarLookup(items, visits, today), [items, visits, today]);

  // What a chosen day holds, read out politely. A new key re-announces the same words.
  const [said, setSaid] = useState({ text: '', key: 0 });
  const announce = useCallback((text: string) => setSaid((s) => ({ text, key: s.key + 1 })), []);

  // A day was chosen: once it shows, bring its details up if they are low on the screen
  // (focus stays in the calendar).
  const [reveal, setReveal] = useState(0);
  useEffect(() => {
    if (!reveal) return;
    const panel = sectionRef.current?.querySelector<HTMLElement>('[data-calendar-day]');
    const heading = panel?.querySelector('h3');
    if (panel && heading) revealDay(panel, heading);
  }, [reveal]);

  const select = (date: ISODate) => {
    update({ selected: date, opened: true, week: mondayOf(date) });
    announce(calendarDayAnnouncement(date, today, lookup(date)));
    setReveal((n) => n + 1);
  };

  const opened = chosen.opened || chosen.selected !== today;

  const marks = (date: ISODate) => {
    const { dots, more } = dayDots(lookup(date));
    return (
      <>
        {dots.map((dot, i) => (
          <span
            key={i}
            className={styles.dot}
            data-rag={dot.rag}
            data-repeat={dot.repeat || undefined}
            style={{ '--dot': dot.repeat ? RAG_TEXT[dot.rag] : RAG_RING[dot.rag] } as CSSProperties}
          />
        ))}
        {more ? <span className={styles.more}>+{more}</span> : null}
      </>
    );
  };

  const dayData = (date: ISODate) => {
    const day = lookup(date);
    const count = (n: number) => (n ? String(n) : undefined);
    return {
      'data-due': count(day.due.length),
      'data-missed': count(day.missed.length),
      'data-repeats': count(day.repeats.length),
      'data-visit': day.visit ? 'true' : undefined,
    };
  };

  const whoName = who === 'all' || who === 'none' ? null : (members.find((m) => m.id === who)?.name ?? null);
  /** "Nothing due today", "Nothing due for Shea", "Nothing unassigned due today" (no full stop). */
  const nothingDue = (isToday: boolean) => {
    const when = isToday ? ' today' : '';
    if (who === 'none') return `Nothing unassigned due${when}`;
    if (whoName) return `Nothing due for ${whoName}${when}`;
    return `Nothing due${when}`;
  };

  return (
    <section ref={sectionRef} aria-labelledby={headingId} className={styles.section} data-calendar="">
      <h2 id={headingId} className="visually-hidden">
        Calendar
      </h2>
      <DatePicker
        viewKey={CALENDAR_VIEW_KEY}
        today={today}
        chosen={chosen}
        onChange={update}
        onReset={reset}
        onSelect={select}
        line={opened ? null : todaySummary(lookup(today), nothingDue(true))}
        dayName={(date, isSelected) => calendarDayName(date, today, lookup(date), isSelected)}
        alert={(date) => lookup(date).missed.length > 0}
        dot={(date) => lookup(date).visit !== null}
        marks={marks}
        dayData={dayData}
        legend={<Legend />}
      />
      {opened ? (
        <DayPanel
          key={chosen.selected}
          date={chosen.selected}
          day={lookup(chosen.selected)}
          today={today}
          timeZone={timeZone}
          members={members}
          empty={`${nothingDue(chosen.selected === today)}.`}
          onOpenItem={onOpenItem}
          onComplete={onComplete}
          onOpenHousekeeping={onOpenHousekeeping}
        />
      ) : null}
      <div className="visually-hidden" aria-live="polite" data-announcer="">
        <span key={said.key}>{said.text}</span>
      </div>
    </section>
  );
}

/** What the marks mean, under the month (not read out: each day's name says it in words). */
function Legend() {
  return (
    <div className={styles.legend} aria-hidden="true" data-legend="">
      <span className={styles.legendItem}>
        <span className={styles.legendDots}>
          {(['red', 'amber', 'green'] as const).map((rag) => (
            <span key={rag} className={styles.dot} style={{ '--dot': RAG_RING[rag] } as CSSProperties} />
          ))}
        </span>
        Due
      </span>
      <span className={styles.legendItem}>
        <span className={styles.legendMissed}>6</span>
        Missed
      </span>
      <span className={styles.legendItem}>
        <span className={styles.dot} data-repeat="" style={{ '--dot': RAG_TEXT.amber } as CSSProperties} />
        Repeats
      </span>
      <span className={styles.legendItem}>
        <span className={styles.legendVisit} />
        Housekeeping
      </span>
    </div>
  );
}

interface DayPanelProps {
  date: ISODate;
  day: CalendarDay;
  today: ISODate;
  timeZone: string;
  members: Member[];
  /** What an empty day says. */
  empty: string;
  onOpenItem(itemId: string): void;
  onComplete(itemId: string): Promise<void>;
  onOpenHousekeeping?(date: ISODate): void;
}

/**
 * The chosen day, under the calendar: its To do items as Home's rows (the ring completes,
 * the row opens the Item sheet) in the order of its marks (missed first, then red, amber,
 * green), then the repeats coming round that day (opened, not completed), then its
 * housekeeping visit, which opens that day in Housekeeping. A row due that day leaves its
 * date out (the heading says it); a missed one keeps "Missed · Tue 6 Oct". Every row leaves
 * the list once completed, a repeating one too (it moves on to a later day).
 */
function DayPanel({ date, day, today, timeZone, members, empty, onOpenItem, onComplete, onOpenHousekeeping }: DayPanelProps) {
  const { rows, repeats } = dayRows(day);
  const visit = day.visit;
  let visitName = '';
  if (visit) {
    const { done, total } = doneCount(visit);
    const price = visit.price_pence === null ? '' : `, ${formatPrice(visit.price_pence)}`;
    visitName = `Housekeeping visit, ${done} of ${total} done${price}. Show in Housekeeping`;
  }
  return (
    <div className={styles.day} data-calendar-day={date}>
      {/* Focus comes here when the last row is completed and the day isn't on the grid. */}
      <h3 className={styles.dayHeader} tabIndex={-1}>
        {fullDay(date, today)}
      </h3>
      <div className={styles.card}>
        {rows.length || repeats.length ? (
          <ul className={styles.list} role="list">
            {rows.map((item) => {
              const meta = itemMeta(item, members, today, timeZone);
              return (
                <ItemRow
                  key={item.id}
                  item={item}
                  meta={meta.missed ? meta : { ...meta, date: null }}
                  leavesOnComplete
                  onOpen={onOpenItem}
                  onComplete={onComplete}
                />
              );
            })}
            {repeats.map((item) => (
              <RepeatRow key={`repeat:${item.id}`} item={item} members={members} today={today} onOpen={onOpenItem} />
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>{empty}</p>
        )}
      </div>
      {visit ? (
        <div className={styles.card} data-visit-card="">
          <button
            type="button"
            className={styles.visitRow}
            aria-label={visitName}
            onClick={() => onOpenHousekeeping?.(date)}
          >
            <span className={styles.visitIcon} aria-hidden="true">
              <BroomIcon size={17} />
            </span>
            <span className={styles.visitText}>
              <span className={styles.visitTitle}>Housekeeping visit</span>
              <span className={styles.visitMeta}>{visitSummary(visit)}</span>
            </span>
            <ChevronRightIcon className={styles.visitChevron} size={13} strokeWidth={2.4} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface RepeatRowProps {
  item: Item;
  members: Member[];
  today: ISODate;
  onOpen(itemId: string): void;
}

/**
 * A repeat coming round on the chosen day: drawn like Home's row, with a faint dashed ring
 * that is not a button (it isn't due yet, so it can't be marked done), and "Repeat of Tue 13
 * Oct · Every week" after who it is for (how often gives way first). The row opens the item.
 */
function RepeatRow({ item, members, today, onOpen }: RepeatRowProps) {
  const who = memberLabel(members.find((m) => m.id === item.assignee_id));
  const { when, every } = repeatMeta(item, today);
  return (
    <li className={rowStyles.row} data-repeat="">
      <span className={styles.repeatSlot} aria-hidden="true">
        <span className={styles.repeatRing} style={{ '--ring': RAG_RING[item.rag] } as CSSProperties} />
      </span>
      <button
        type="button"
        className={rowStyles.open}
        data-item-open=""
        onClick={() => onOpen(item.id)}
      >
        <span className={`${rowStyles.title} ${styles.repeatTitle}`}>
          {item.title}
          <span className="visually-hidden">{`, ${RAG_LABEL[item.rag]}, repeat.`}</span>
        </span>
        <span className={rowStyles.meta}>
          <span data-meta="" className={rowStyles.lead}>
            <span className={rowStyles.who}>
              <EmojiText text={who} />
            </span>
            {' · '}
            <span className={styles.repeatMeta}>{when}</span>
          </span>
          <span className={rowStyles.note}>
            {' · '}
            {every}
          </span>
        </span>
      </button>
    </li>
  );
}
