import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { RAG_ORDER, URGENCY_LABEL } from '../../lib/constants';
import {
  calendarDayAnnouncement,
  calendarDayName,
  calendarLookup,
  dayDots,
  dayRows,
  lateItems,
  repeatMeta,
  visitSummary,
  type CalendarDay,
} from '../../lib/logic/calendar';
import { doneCount, formatPrice } from '../../lib/logic/housekeeping';
import { fullDay, monthOf } from '../../lib/logic/months';
import type { HousekeepingVisit, ISODate, Item, Member } from '../../lib/types';
import {
  DatePicker,
  isDayShown,
  mondayOf,
  revealDay,
  useCalendarView,
  useChosenDay,
  type ChosenDay,
} from '../../ui/DatePicker';
import { BroomIcon, ChevronRightIcon } from '../../ui/icons';
import { ItemRow, RowMeta, Who } from './ItemRow';
import type { PersonFilter } from './personFilter';
import { RevealContext } from './reveal';
import rowStyles from './ItemRow.module.css';
import styles from './HomeCalendar.module.css';

/** Where this device remembers the week strip or the month: 'month', or nothing for the week. */
export const CALENDAR_VIEW_KEY = 'homeos.calendar';

/** The chosen day and the month and week shown, remembered while the app runs (Home comes and goes with its tab). */
const remembered: { current: ChosenDay | null } = { current: null };

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
  /** A room's name, from its id (a day's rows mix rooms). */
  roomOf(areaId: string): string;
  onOpenItem(itemId: string): void;
  onComplete(itemId: string): Promise<void>;
  /** Shows that day in the Housekeeping tab. */
  onOpenHousekeeping?(date: ISODate): void;
}

/**
 * Needs attention's calendar (docs/ARCHITECTURE.md "Needs attention: the calendar"), Home's third view: the week
 * as a strip, or the whole month (Show month / Show week, remembered on this device), with
 * Previous and Next for the week or the month and Today to come back: the date picker
 * Housekeeping uses too (src/ui/DatePicker.tsx). Each day shows the To do items due (dots in
 * their urgency's colour, up to three and "+2"; the number in red when something was missed),
 * the later repeats of repeating items (faint hollow dots) and the housekeeping visit (a dot
 * in the circle, as in Housekeeping); a legend under the days says what each means in words.
 * Today is chosen at first and its items show under the calendar, as Home's rows; another
 * day shows when it is tapped. With the chosen day out of sight (another week or month), one
 * quiet line asks for a day instead. An item just saved brings its day up (RevealContext).
 */
export function HomeCalendar({
  householdId,
  items,
  visits,
  members,
  today,
  timeZone,
  who,
  roomOf,
  onOpenItem,
  onComplete,
  onOpenHousekeeping,
}: HomeCalendarProps) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  // Another household, or a new day since: start on today, in this week and month.
  const { chosen, update, reset } = useChosenDay(remembered, householdId, today);
  const [view, setView] = useCalendarView(CALENDAR_VIEW_KEY);

  const lookup = useMemo(() => calendarLookup(items, visits, today), [items, visits, today]);
  // What is still open from before today: listed first under today, which it is now up to.
  const late = useMemo(() => lateItems(items, today), [items, today]);

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
    update({ selected: date, week: mondayOf(date) });
    announce(calendarDayAnnouncement(date, today, lookup(date), date === today ? late : []));
    setReveal((n) => n + 1);
  };

  // An item just saved: its day is chosen and shown, so it can be seen in the list.
  const lit = useContext(RevealContext);
  const litDue = lit ? (items.find((it) => it.id === lit)?.due_date ?? null) : null;
  useEffect(() => {
    if (litDue) update({ selected: litDue, week: mondayOf(litDue), month: monthOf(litDue) });
    // `update` is new on every render; only a new day matters.
  }, [litDue]);

  const marks = (date: ISODate) => {
    const { dots, more } = dayDots(lookup(date));
    return (
      <>
        {dots.map((dot, i) => (
          <span key={i} className={styles.dot} data-rag={dot.rag} data-repeat={dot.repeat || undefined} />
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
      <DatePicker
        headingId={headingId}
        viewKey={CALENDAR_VIEW_KEY}
        view={view}
        onViewChange={setView}
        today={today}
        chosen={chosen}
        onChange={update}
        onReset={reset}
        onSelect={select}
        dayName={(date, isSelected) => calendarDayName(date, today, lookup(date), isSelected)}
        alert={(date) => lookup(date).missed.length > 0}
        dot={(date) => lookup(date).visit !== null}
        marks={marks}
        dayData={dayData}
        legend={<Legend />}
      />
      {isDayShown(chosen.selected, view, chosen) ? (
        <DayPanel
          key={chosen.selected}
          date={chosen.selected}
          day={lookup(chosen.selected)}
          late={chosen.selected === today ? late : []}
          today={today}
          timeZone={timeZone}
          members={members}
          roomOf={roomOf}
          empty={`${nothingDue(chosen.selected === today)}.`}
          showWho={who === 'all'}
          onOpenItem={onOpenItem}
          onComplete={onComplete}
          onOpenHousekeeping={onOpenHousekeeping}
        />
      ) : (
        // Another week or month: the chosen day's list would read as part of it.
        <p className={styles.pick} data-calendar-pick="">
          Pick a day to see what is due.
        </p>
      )}
      <div className="visually-hidden" aria-live="polite" data-announcer="">
        <span key={said.key}>{said.text}</span>
      </div>
    </section>
  );
}

/**
 * What the marks mean, in words, under the days in the week strip and the month alike: the
 * dots' colours (Urgent, Within the month, Not urgent), a faint hollow dot for a repeat, the
 * housekeeping visit's dot, and a red date for a day with something missed. Not read out:
 * each day's name says it in words.
 */
function Legend() {
  return (
    <div className={styles.legend} aria-hidden="true" data-legend="">
      <span className={styles.legendRow}>
        {RAG_ORDER.map((rag) => (
          <span key={rag} className={styles.legendItem}>
            <span className={styles.dot} data-rag={rag} />
            {URGENCY_LABEL[rag]}
          </span>
        ))}
      </span>
      <span className={styles.legendRow}>
        <span className={styles.legendItem}>
          <span className={styles.dot} data-rag="amber" data-repeat="" />
          Repeat
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendVisit} />
          Housekeeping
        </span>
        <span className={styles.legendItem}>
          <span>
            <span className={styles.legendMissed}>Red date</span>: missed
          </span>
        </span>
      </span>
    </div>
  );
}

interface DayPanelProps {
  date: ISODate;
  day: CalendarDay;
  /** For today: what is still open from before it (lateItems()), listed first ("1 late" beside the heading). */
  late: Item[];
  today: ISODate;
  timeZone: string;
  members: Member[];
  roomOf(areaId: string): string;
  /** What an empty day says. */
  empty: string;
  /** Who each row is for, at the end of its title (off while one person's items show). */
  showWho: boolean;
  onOpenItem(itemId: string): void;
  onComplete(itemId: string): Promise<void>;
  onOpenHousekeeping?(date: ISODate): void;
}

/**
 * The chosen day, under the calendar: its To do items as Home's rows (the ring completes,
 * the row opens the Item sheet) in the order of its marks (missed first, then red, amber,
 * green), then the repeats coming round that day (opened, not completed), then its
 * housekeeping visit, which opens that day in Housekeeping. A row due that day leaves its
 * date out (the heading says it); a late one keeps "2 days late". Every row leaves the list
 * once completed, a repeating one too (it moves on to a later day). Today lists what is late
 * first ("1 late" beside its heading), then its own rows under "Due today" (or the line
 * saying there are none).
 */
function DayPanel({
  date,
  day,
  late,
  today,
  timeZone,
  members,
  roomOf,
  empty,
  showWho,
  onOpenItem,
  onComplete,
  onOpenHousekeeping,
}: DayPanelProps) {
  const { rows, repeats } = dayRows(day);
  const visit = day.visit;
  let visitName = '';
  if (visit) {
    const { done, total } = doneCount(visit);
    const price = visit.price_pence === null ? '' : `, ${formatPrice(visit.price_pence)}`;
    visitName = `Housekeeping visit, ${done} of ${total} done${price}. Show in Housekeeping`;
  }
  const rowProps = { members, today, timeZone, showWho, leavesOnComplete: true, onOpen: onOpenItem, onComplete };
  const own = rows.length > 0 || repeats.length > 0;
  return (
    <div className={styles.day} data-calendar-day={date}>
      <div className={styles.dayHeadRow}>
        {/* Focus comes here when the last row is completed and the day isn't on the grid. */}
        <h3 className={styles.dayHeader} tabIndex={-1}>
          {fullDay(date, today)}
        </h3>
        {/* As a room says it beside its name: the late jobs at the top of the list below. */}
        {late.length ? (
          <span className={styles.lateWord} data-late-count="">
            {late.length} late
          </span>
        ) : null}
      </div>
      <div className={styles.card}>
        {late.length ? (
          <ul className={styles.list} role="list" data-late="">
            {late.map((item) => (
              <ItemRow key={item.id} item={item} room={roomOf(item.area_id)} {...rowProps} />
            ))}
          </ul>
        ) : null}
        {late.length && own ? <p className={`${styles.listLabel} ${styles.afterLate}`}>Due today</p> : null}
        {own ? (
          <ul className={styles.list} role="list">
            {rows.map((item) => (
              <ItemRow key={item.id} item={item} room={roomOf(item.area_id)} hideWhen {...rowProps} />
            ))}
            {repeats.map((item) => (
              <RepeatRow
                key={`repeat:${item.id}`}
                item={item}
                members={members}
                today={today}
                room={roomOf(item.area_id)}
                showWho={showWho}
                onOpen={onOpenItem}
              />
            ))}
          </ul>
        ) : (
          <p className={late.length ? `${styles.empty} ${styles.afterLate}` : styles.empty}>{empty}</p>
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
  room: string;
  /** Who it is for, at the end of the title's line (off while one person's items show). */
  showWho: boolean;
  onOpen(itemId: string): void;
}

/**
 * A repeat coming round on the chosen day: drawn like Home's row, with a faint dashed ring
 * that is not a button (it isn't due yet, so it can't be marked done), and its urgency in
 * words, then "Repeat of Tue 13 Oct · Every week" (how often gives way first) and its room.
 * The row opens the item.
 */
function RepeatRow({ item, members, today, room, showWho, onOpen }: RepeatRowProps) {
  const member = members.find((m) => m.id === item.assignee_id);
  const { when, every } = repeatMeta(item, today);
  return (
    <li className={rowStyles.row} data-repeat="">
      <div className={rowStyles.inner}>
        <span className={styles.repeatSlot} aria-hidden="true">
          <span className={styles.repeatRing} />
        </span>
        <button type="button" className={rowStyles.open} data-item-open="" onClick={() => onOpen(item.id)}>
          <span className={rowStyles.text}>
            <span className={`${rowStyles.title} ${styles.repeatTitle}`}>
              {item.title}
              <span className="visually-hidden">{`, ${URGENCY_LABEL[item.rag]}, repeat, ${when}, ${every}, ${room}, ${member ? member.name : 'Unassigned'}.`}</span>
            </span>
            <RowMeta
              kind={item.kind}
              rag={item.rag}
              room={room}
              parts={[
                <span key="when" className={styles.repeatWhen}>
                  {when}
                </span>,
                <span key="every" className={rowStyles.part}>
                  {every}
                </span>,
              ]}
            />
          </span>
          {member && showWho ? <Who member={member} /> : null}
        </button>
      </div>
    </li>
  );
}
