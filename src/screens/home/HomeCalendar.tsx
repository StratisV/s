import { useCallback, useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import { RAG_LABEL, RAG_RING } from '../../lib/constants';
import {
  calendarDayAnnouncement,
  calendarDayName,
  calendarLookup,
  dayDots,
  repeatMeta,
  visitSummary,
  weekName,
  type CalendarDay,
  type CalendarView,
} from '../../lib/logic/calendar';
import { doneCount, formatPrice } from '../../lib/logic/housekeeping';
import { itemMeta, memberLabel } from '../../lib/logic/items';
import { fullDay, monthOf, type YearMonth } from '../../lib/logic/months';
import type { HousekeepingVisit, ISODate, Item, Member } from '../../lib/types';
import { EmojiText } from '../../ui/EmojiText';
import { BroomIcon, ChevronRightIcon } from '../../ui/icons';
import { MonthCalendar } from '../../ui/MonthCalendar';
import { ItemRow } from './ItemRow';
import type { PersonFilter } from './personFilter';
import rowStyles from './ItemRow.module.css';
import styles from './HomeCalendar.module.css';

/** Where this device remembers the week strip or the month: 'month', or nothing for the week. */
export const CALENDAR_VIEW_KEY = 'homeos.calendar';

function readView(): CalendarView {
  try {
    return localStorage.getItem(CALENDAR_VIEW_KEY) === 'month' ? 'month' : 'week';
  } catch {
    return 'week';
  }
}

function writeView(view: CalendarView): void {
  try {
    if (view === 'month') localStorage.setItem(CALENDAR_VIEW_KEY, 'month');
    else localStorage.removeItem(CALENDAR_VIEW_KEY);
  } catch {
    /* private mode or storage full: it just isn't remembered */
  }
}

interface Chosen {
  householdId: string;
  /** The day it was chosen on: once midnight passes, today is chosen again. */
  today: ISODate;
  selected: ISODate;
  month: YearMonth;
}

/** The chosen day and month, remembered while the app runs (Home comes and goes with its tab). */
let remembered: Chosen | null = null;

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

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
 * on the calendar card Housekeeping uses too. Each day shows the To do items due (status
 * dots, up to three and "+2"; the number in red when something was missed), the later
 * repeats of repeating items (faint hollow dots) and the housekeeping visit (a broom).
 * Today is chosen at first; the chosen day's items show under the calendar, as Home's rows.
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
  const [view, setView] = useState<CalendarView>(readView);
  const fresh = (): Chosen => ({ householdId, today, selected: today, month: monthOf(today) });
  const valid = (c: Chosen | null): c is Chosen => !!c && c.householdId === householdId && c.today === today;
  const [state, setState] = useState<Chosen>(() => (valid(remembered) ? remembered : fresh()));
  // Another household, or a new day since: start on today.
  const chosen = valid(state) ? state : fresh();
  const update = (patch: Partial<Pick<Chosen, 'selected' | 'month'>>) => {
    const next = { ...chosen, ...patch };
    remembered = next;
    setState(next);
  };

  const lookup = useMemo(() => calendarLookup(items, visits, today), [items, visits, today]);

  // What a chosen day holds, read out politely. A new key re-announces the same words.
  const [said, setSaid] = useState({ text: '', key: 0 });
  const announce = useCallback((text: string) => setSaid((s) => ({ text, key: s.key + 1 })), []);

  // A day was chosen: once it shows, bring its details up if they are low on the screen
  // (focus stays in the calendar).
  const [reveal, setReveal] = useState(0);
  useEffect(() => {
    if (!reveal) return;
    const heading = document.getElementById(headingId)?.closest('section')?.querySelector<HTMLElement>('[data-calendar-day] h3');
    heading?.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [reveal, headingId]);

  const select = (date: ISODate) => {
    update({ selected: date });
    announce(calendarDayAnnouncement(date, today, lookup(date)));
    setReveal((n) => n + 1);
  };

  const toggleView = () => {
    const next: CalendarView = view === 'week' ? 'month' : 'week';
    // The month opens on the chosen day's.
    if (next === 'month') update({ month: monthOf(chosen.selected) });
    setView(next);
    writeView(next);
  };

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
            style={{ '--dot': RAG_RING[dot.rag] } as CSSProperties}
          />
        ))}
        {more ? <span className={styles.more}>+{more}</span> : null}
      </>
    );
  };

  const badge = (date: ISODate) =>
    lookup(date).visit ? (
      <span className={styles.broom} data-broom="">
        <BroomIcon size={11} />
      </span>
    ) : null;

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
  const nothingDue = (isToday: boolean) => {
    const when = isToday ? ' today' : '';
    if (who === 'none') return `Nothing unassigned due${when}.`;
    if (whoName) return `Nothing due for ${whoName}${when}.`;
    return `Nothing due${when}.`;
  };

  return (
    <section aria-labelledby={headingId} className={styles.section} data-calendar="">
      <div className={styles.headerRow}>
        <h2 id={headingId} className={styles.header}>
          Calendar
        </h2>
        <button type="button" className={styles.headerAction} data-calendar-toggle="" onClick={toggleView}>
          {view === 'week' ? 'Show month' : 'Show week'}
        </button>
      </div>
      <MonthCalendar
        // A fresh grid for each view: the strip follows the chosen day, not where the keys were.
        key={view}
        month={chosen.month}
        onMonth={(month) => update({ month })}
        selected={chosen.selected}
        onSelect={select}
        today={today}
        view={view}
        dayName={(date, isSelected) => calendarDayName(date, today, lookup(date), isSelected)}
        weekName={(monday) => weekName(monday, today)}
        alert={(date) => lookup(date).missed.length > 0}
        marks={marks}
        badge={badge}
        dayData={dayData}
        legend={view === 'month' ? <Legend /> : undefined}
      />
      <DayPanel
        key={chosen.selected}
        date={chosen.selected}
        day={lookup(chosen.selected)}
        today={today}
        timeZone={timeZone}
        members={members}
        empty={nothingDue(chosen.selected === today)}
        onOpenItem={onOpenItem}
        onComplete={onComplete}
        onOpenHousekeeping={onOpenHousekeeping}
      />
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
        <span className={styles.dot} data-repeat="" style={{ '--dot': RAG_RING.amber } as CSSProperties} />
        Repeats
      </span>
      <span className={styles.legendItem}>
        <BroomIcon size={11} className={styles.legendBroom} />
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
 * the row opens the Item sheet), missed ones first, then the repeats coming round that day
 * (opened, not completed), then its housekeeping visit, which opens that day in Housekeeping.
 */
function DayPanel({ date, day, today, timeZone, members, empty, onOpenItem, onComplete, onOpenHousekeeping }: DayPanelProps) {
  const rows = [...day.missed, ...day.due];
  const visit = day.visit;
  let visitName = '';
  if (visit) {
    const { done, total } = doneCount(visit);
    const price = visit.price_pence === null ? '' : `, ${formatPrice(visit.price_pence)}`;
    visitName = `Housekeeping visit, ${done} of ${total} done${price}. Show in Housekeeping`;
  }
  return (
    <div className={styles.day} data-calendar-day={date}>
      <h3 className={styles.dayHeader}>{fullDay(date, today)}</h3>
      <div className={styles.card}>
        {rows.length || day.repeats.length ? (
          <ul className={styles.list} role="list">
            {rows.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                meta={itemMeta(item, members, today, timeZone)}
                onOpen={onOpenItem}
                onComplete={onComplete}
              />
            ))}
            {day.repeats.map((item) => (
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
 * that is not a button (it isn't due yet, so it can't be marked done), and "Repeats every
 * week · Due Tue 13 Oct" after who it is for. The row opens the item.
 */
function RepeatRow({ item, members, today, onOpen }: RepeatRowProps) {
  const who = memberLabel(members.find((m) => m.id === item.assignee_id));
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
            <span className={styles.repeatMeta}>{repeatMeta(item, today)}</span>
          </span>
        </span>
      </button>
    </li>
  );
}
