import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { isDated } from '../../lib/logic/calendar';
import { longDay } from '../../lib/logic/dates';
import { isState, itemsByArea } from '../../lib/logic/items';
import { homeSummary, upNext, type SummaryScope } from '../../lib/logic/upNext';
import type { ISODate, Item, Member } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { Screen } from '../../ui/Screen';
import { HomeCalendar } from './HomeCalendar';
import { ReadOnlyLine } from './HomeScreen';
import { PersonFilter } from './PersonFilter';
import { RevealContext, revealRow } from './reveal';
import { countsFor, isFor, personFilterKey, validFilter, type PersonFilter as Who } from './personFilter';
import { UpNextView } from './UpNextView';
import styles from './HomeScreen.module.css';

interface NeedsAttentionScreenProps {
  onOpenItem(itemId: string): void;
  onOpenProfile(): void;
  /**
   * An item just saved (new, or moved to another area), so the person sees where it went:
   * once it is in the list, everyone's items show if the person filter hides it, a "Show N
   * more" over it opens (or the calendar goes to its day), and its row comes into view, lit up
   * for a moment. Then `onRevealed` is called.
   */
  revealItem?: string | null;
  onRevealed?(): void;
  /** A housekeeping visit under the calendar: shows that day in the Housekeeping tab. */
  onOpenHousekeeping?(date: ISODate): void;
}

/** The two ways of seeing the same items: by when (the list, the default), or by date. */
export type AttentionView = 'list' | 'calendar';

const VIEWS: { value: AttentionView; label: string }[] = [
  { value: 'list', label: 'List' },
  { value: 'calendar', label: 'Calendar' },
];

/** Where this device remembers the view the person picked: 'calendar', or nothing for the list. */
export const ATTENTION_VIEW_KEY = 'homeos.attentionView';

function readView(): AttentionView {
  try {
    return localStorage.getItem(ATTENTION_VIEW_KEY) === 'calendar' ? 'calendar' : 'list';
  } catch {
    return 'list';
  }
}

/** The view shown, remembered on this device. */
function useAttentionView() {
  const [view, setView] = useState<AttentionView>(readView);
  const pick = useCallback((next: AttentionView) => {
    try {
      if (next === 'list') localStorage.removeItem(ATTENTION_VIEW_KEY);
      else localStorage.setItem(ATTENTION_VIEW_KEY, next);
    } catch {
      /* private mode or storage full: it just isn't remembered */
    }
    setView(next);
  }, []);
  return [view, pick] as const;
}

/**
 * Whose items show. `setWho`, the person's choice (Mine, the people menu), is remembered per
 * household on this device. Everyone's items can also show for this visit only
 * (`showAllForNow`: an item just saved for someone else): that is not remembered, and gives
 * way as soon as the person picks, leaves the tab or reopens the app, so Mine stays their own
 * choice.
 */
function usePersonFilter(householdId: string, members: Member[]) {
  const key = personFilterKey(householdId);
  const read = () => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const [state, setState] = useState(() => ({ key, who: read() }));
  const [allFor, setAllFor] = useState<string | null>(null);
  // Another household on this device: its own choice.
  const stored = state.key === key ? state.who : read();
  const who = allFor === key ? 'all' : validFilter(stored, members);
  const setWho = useCallback(
    (next: Who) => {
      try {
        if (next === 'all') localStorage.removeItem(key);
        else localStorage.setItem(key, next);
      } catch {
        /* private mode or storage full: it just isn't remembered */
      }
      setAllFor(null);
      setState({ key, who: next });
    },
    [key],
  );
  const showAllForNow = useCallback(() => setAllFor(key), [key]);
  return [who, setWho, showAllForNow] as const;
}

/** Time for the list to be drawn afresh (everyone's items, another fold) before scrolling to a row. */
const REDRAW_MS = 50;
/** How long a row just saved stays lit up (ItemRow.module.css `.row[data-lit]`). */
const ITEM_FLASH_MS = 2400;

/**
 * Needs attention (docs/ARCHITECTURE.md "Needs attention"), the second tab: one plain sentence
 * on what needs doing ("2 things need attention and 1 is due today. Everything else can
 * wait."), then a switch between two views of every open item in the house (the list, by when:
 * Needs attention, Today, Next 7 days, Later and Looking after; the calendar, by date) and
 * whose items they are (Mine, the people menu).
 */
export function NeedsAttentionScreen({ onOpenItem, onOpenProfile, revealItem, onRevealed, onOpenHousekeeping }: NeedsAttentionScreenProps) {
  const { data, me, today, completeItem, readOnly, showToast } = useHousehold();
  const timeZone = data.household.timezone;
  const sections = useMemo(() => itemsByArea(data.areas, data.items), [data.areas, data.items]);
  const [who, setWho, showAllForNow] = usePersonFilter(data.household.id, data.members);
  const [view, pickView] = useAttentionView();
  const allItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const counts = useMemo(() => countsFor(allItems, data.members), [allItems, data.members]);
  // The items shown, in the household's order of areas (for the calendar's marks and the list).
  const shownItems = useMemo(() => (who === 'all' ? allItems : allItems.filter((it) => isFor(it, who))), [allItems, who]);
  const next = useMemo(() => upNext(shownItems, today), [shownItems, today]);
  const scope: SummaryScope | undefined =
    who === 'all'
      ? undefined
      : who === 'none'
        ? { kind: 'none' }
        : who === me.id
          ? { kind: 'me' }
          : { kind: 'person', name: data.members.find((m) => m.id === who)?.name ?? 'them' };
  const summary = homeSummary(next, today, scope);
  // Who each row is for, at the end of its title: only while everyone's items show.
  const showWho = who === 'all';
  const roomNames = useMemo(() => new Map(data.areas.map((a) => [a.id, a.name])), [data.areas]);
  const roomOf = useCallback((id: string) => roomNames.get(id) ?? '', [roomNames]);
  const whoName = who === 'all' || who === 'none' ? null : (data.members.find((m) => m.id === who)?.name ?? 'them');
  const nobody =
    who === 'all'
      ? null
      : who === 'none'
        ? 'Nothing unassigned right now.'
        : who === me.id
          ? 'Nothing for you right now.'
          : `Nothing for ${whoName} right now.`;

  // An item was just saved (the sheet is closing over the list). A new one is in the list after
  // the next load, so this waits for it. Everyone's items for now if the filter hides it; then
  // `lit` holds it for a moment: a "Show N more" over it opens (ShowMore.tsx), the calendar goes
  // to its day, and its row lights up and comes into view. The calendar shows only To dos with
  // a date: for anything else a toast says where it went.
  const [lit, setLit] = useState<string | null>(null);
  const saved = revealItem ? (data.items.find((it) => it.id === revealItem && it.status === 'open') ?? null) : null;
  const revealRef = useRef({ who, showAllForNow, onRevealed, view, roomOf, showToast });
  revealRef.current = { who, showAllForNow, onRevealed, view, roomOf, showToast };
  useEffect(() => {
    if (!saved) return;
    const now = revealRef.current;
    if (now.who !== 'all' && !isFor(saved, now.who)) now.showAllForNow();
    if (now.view === 'calendar' && !isDated(saved)) now.showToast(notOnCalendar(saved, now.roomOf(saved.area_id)));
    setLit(saved.id);
    now.onRevealed?.();
  }, [saved]);
  useEffect(() => {
    if (!lit) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    // Once the rows behind a fold are drawn: into view, clear of the round + and the tab bar
    // (revealRow(), measured).
    const show = setTimeout(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>('[data-view] [data-item-id]')).find(
        (el) => el.dataset.itemId === lit,
      );
      if (row) revealRow(row, !still);
    }, REDRAW_MS);
    const done = setTimeout(() => setLit(null), REDRAW_MS + ITEM_FLASH_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(done);
    };
  }, [lit]);

  return (
    <Screen
      label="Needs attention"
      title="Needs attention"
      eyebrow={<time dateTime={today}>{longDay(today)}</time>}
      avatarEmoji={me.emoji}
      onAvatar={onOpenProfile}
    >
      <RevealContext.Provider value={lit}>
        <p className={styles.summary} data-attention-summary="">
          <span className={styles.summaryLead}>{summary.lead}</span>
          {summary.rest ? <span className={styles.summaryRest}> {summary.rest}</span> : null}
        </p>
        {readOnly ? <ReadOnlyLine /> : null}
        <div className={styles.controls}>
          <ViewSwitch value={view} onChange={pickView} />
          <PersonFilter members={data.members} meId={me.id} value={who} counts={counts} onChange={setWho} />
        </div>
        {view === 'list' ? (
          <UpNextView
            view={next}
            roomOf={roomOf}
            members={data.members}
            today={today}
            timeZone={timeZone}
            nobody={nobody}
            showWho={showWho}
            onOpenItem={onOpenItem}
            onComplete={completeItem}
          />
        ) : (
          <div className={styles.view} data-view="calendar">
            <HomeCalendar
              householdId={data.household.id}
              items={shownItems}
              visits={data.housekeeping.visits}
              members={data.members}
              today={today}
              timeZone={timeZone}
              who={who}
              roomOf={roomOf}
              onOpenItem={onOpenItem}
              onComplete={completeItem}
              onOpenHousekeeping={onOpenHousekeeping}
            />
          </div>
        )}
      </RevealContext.Provider>
    </Screen>
  );
}

/**
 * List or Calendar: a small segmented control (a radio group: the arrow keys move the
 * choice). Each segment is a 44px tall target.
 */
function ViewSwitch({ value, onChange }: { value: AttentionView; onChange(view: AttentionView): void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, VIEWS.findIndex((v) => v.value === value));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = VIEWS.length;
    let to: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (index + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (index - 1 + n) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    else return;
    e.preventDefault();
    onChange(VIEWS[to].value);
    refs.current[to]?.focus();
  };
  return (
    <div
      className={styles.views}
      role="radiogroup"
      aria-label="View"
      style={{ '--count': VIEWS.length, '--index': index } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      <span className={styles.viewThumb} aria-hidden="true" />
      {VIEWS.map((v, i) => (
        <button
          key={v.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === index}
          tabIndex={i === index ? 0 : -1}
          className={styles.viewOption}
          data-view-option={v.value}
          onClick={() => onChange(v.value)}
        >
          {/* Cut short here, inside, so the button's own 44px tap area is never clipped. */}
          <span className={styles.viewLabel}>{v.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The toast when an item is saved from the Calendar view but the calendar can't show it (it
 * shows only To dos with a date), so the person knows it was saved, and where:
 * "Saved in Kitchen. It has no date, so it isn’t on the calendar." For a thing looked after:
 * "Saved in Garden. Things looked after aren’t on the calendar."
 */
export function notOnCalendar(item: Item, room: string): string {
  const where = room ? `Saved in ${room}.` : 'Saved.';
  return isState(item)
    ? `${where} Things looked after aren’t on the calendar.`
    : `${where} It has no date, so it isn’t on the calendar.`;
}
