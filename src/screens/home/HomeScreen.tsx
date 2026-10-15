import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { isDated } from '../../lib/logic/calendar';
import { longDay } from '../../lib/logic/dates';
import { isState, itemsByArea } from '../../lib/logic/items';
import { areaShareMessage } from '../../lib/logic/share';
import { homeSummary, roomOrder, upNext, type SummaryScope } from '../../lib/logic/upNext';
import { appBaseUrl } from '../../lib/sharedLink';
import type { Area, ISODate, Item, Member } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { ChevronRightIcon, EllipsisIcon, PlusIcon, ShareIcon } from '../../ui/icons';
import { Menu } from '../../ui/Menu';
import { Screen } from '../../ui/Screen';
import { useShare } from '../share/useShare';
import { HomeCalendar } from './HomeCalendar';
import { ItemRow } from './ItemRow';
import { PersonFilter } from './PersonFilter';
import { RevealContext, revealRow } from './reveal';
import { RoomIcon } from './RoomIcon';
import { ShowMore, useFold } from './ShowMore';
import { countsFor, isFor, personFilterKey, validFilter, type PersonFilter as Who } from './personFilter';
import { UpNextView } from './UpNextView';
import styles from './HomeScreen.module.css';

interface HomeScreenProps {
  /** The tab switch, under the hero. */
  tabs?: ReactNode;
  onOpenItem(itemId: string): void;
  onOpenProfile(): void;
  /** Add Item in a room's menu: opens the new-item sheet with that room chosen. */
  onAddItem(areaId: string): void;
  /**
   * An item just saved (new, or moved to another area), so the person sees where it went:
   * once it is in the list, everyone's items show if the person filter hides it, its room
   * opens if folded, a "Show N more" over it opens (or the calendar goes to its day), and its
   * row comes into view, lit up for a moment. Then `onRevealed` is called.
   */
  revealItem?: string | null;
  onRevealed?(): void;
  /**
   * An area opened from a shared link (`?area=`): Rooms is shown for this visit (the view this
   * phone remembers stays as it was), the area expanded and scrolled to the top, under the tab
   * switch. Then `onLinkedAreaShown` is called.
   */
  linkedArea?: string | null;
  onLinkedAreaShown?(): void;
  /**
   * The room the round + adds to, or null: the room a shared link opened, while Rooms is
   * shown (the + then reads "New item in Garden"). Cleared on another view or another tab.
   */
  onRoomContext?(areaId: string | null): void;
  /** A housekeeping visit under the calendar: shows that day in the Housekeeping tab. */
  onOpenHousekeeping?(date: ISODate): void;
}

/** Home's three ways of seeing the same items: by when (the default), by room, by date. */
export type HomeView = 'next' | 'rooms' | 'calendar';

const VIEWS: { value: HomeView; label: string }[] = [
  { value: 'next', label: 'Up next' },
  { value: 'rooms', label: 'Rooms' },
  { value: 'calendar', label: 'Calendar' },
];

/** Where this device remembers the view the person picked: 'rooms' or 'calendar', nothing for Up next. */
export const HOME_VIEW_KEY = 'homeos.homeView';

function readView(): HomeView {
  try {
    const stored = localStorage.getItem(HOME_VIEW_KEY);
    return stored === 'rooms' || stored === 'calendar' ? stored : 'next';
  } catch {
    return 'next';
  }
}

/**
 * The view shown. `pick`, the person's choice on the switch, is remembered on this device. A
 * shared room link shows Rooms for this visit only (`showForLink`): it is not remembered, and
 * it gives way as soon as the person picks a view, leaves Home or reopens the app, so a link
 * from the chat never changes what Home opens on.
 */
function useHomeView() {
  const [picked, setPicked] = useState<HomeView>(readView);
  const [forLink, setForLink] = useState<HomeView | null>(null);
  const pick = useCallback((next: HomeView) => {
    try {
      if (next === 'next') localStorage.removeItem(HOME_VIEW_KEY);
      else localStorage.setItem(HOME_VIEW_KEY, next);
    } catch {
      /* private mode or storage full: it just isn't remembered */
    }
    setForLink(null);
    setPicked(next);
  }, []);
  return { view: forLink ?? picked, pick, showForLink: setForLink };
}

/** Where this device remembers which areas are collapsed: a JSON list of area ids. */
export function collapsedKey(householdId: string): string {
  return `homeos.collapsed.${householdId}`;
}

function readCollapsed(key: string): Set<string> {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeCollapsed(key: string, ids: Set<string>): void {
  try {
    if (ids.size) localStorage.setItem(key, JSON.stringify([...ids]));
    else localStorage.removeItem(key);
  } catch {
    /* private mode or storage full: it just isn't remembered */
  }
}

/** The collapsed areas, remembered per household on this device. */
function useCollapsedAreas(householdId: string, areaIds: string[]) {
  const key = collapsedKey(householdId);
  const [state, setState] = useState(() => ({ key, ids: readCollapsed(key) }));
  // Another household on this device: its own list.
  const ids = state.key === key ? state.ids : readCollapsed(key);
  useEffect(() => {
    if (state.key !== key) setState({ key, ids: readCollapsed(key) });
  }, [key, state.key]);

  const update = useCallback(
    (next: Set<string>) => {
      // Areas deleted since are forgotten.
      const kept = new Set([...next].filter((id) => areaIds.includes(id)));
      writeCollapsed(key, kept);
      setState({ key, ids: kept });
    },
    [key, areaIds],
  );
  return [ids, update] as const;
}

/**
 * Whose items Home shows. `setWho`, the person's choice (Mine, the people menu), is remembered
 * per household on this device. Everyone's items can also show for this visit only
 * (`showAllForNow`: an item just saved for someone else, a shared room): that is not
 * remembered, and gives way as soon as the person picks, leaves Home or reopens the app, so
 * Mine stays their own choice.
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

/**
 * Home (docs/ARCHITECTURE.md "Home"): under the hero and the tab switch, one plain sentence
 * on what needs doing ("2 things need attention and 1 is due today. Everything else can
 * wait."), then a switch between three views of the same items (Up next, by when; Rooms, by
 * area; Calendar, by date) and whose items they are. Up next is the default and puts what is
 * late or urgent at the top of the screen.
 */
export function HomeScreen({
  tabs,
  onOpenItem,
  onOpenProfile,
  onAddItem,
  revealItem,
  onRevealed,
  linkedArea,
  onLinkedAreaShown,
  onRoomContext,
  onOpenHousekeeping,
}: HomeScreenProps) {
  const { data, me, today, completeItem, readOnly, showToast } = useHousehold();
  const share = useShare();
  const timeZone = data.household.timezone;
  const sections = useMemo(() => itemsByArea(data.areas, data.items), [data.areas, data.items]);
  const areaIds = useMemo(() => sections.map((s) => s.area.id), [sections]);
  const [collapsed, setCollapsed] = useCollapsedAreas(data.household.id, areaIds);
  const [who, setWho, showAllForNow] = usePersonFilter(data.household.id, data.members);
  const { view, pick: pickView, showForLink } = useHomeView();
  const counts = useMemo(
    () => countsFor(sections.flatMap((s) => s.items), data.members),
    [sections, data.members],
  );
  // One person (or Unassigned): only their items, and only the areas where they have some.
  const shown = useMemo(
    () =>
      who === 'all'
        ? sections
        : sections.map((s) => ({ ...s, items: s.items.filter((it) => isFor(it, who)) })).filter((s) => s.items.length > 0),
    [sections, who],
  );
  // Rooms that can fold (a room with nothing open is one line already).
  const foldableIds = shown.filter((s) => s.items.length > 0).map((s) => s.area.id);
  // The items shown, in Home's order (for the calendar's marks and Up next).
  const shownItems = useMemo(() => shown.flatMap((s) => s.items), [shown]);
  const allCollapsed = foldableIds.length > 0 && foldableIds.every((id) => collapsed.has(id));
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

  // An item was just saved (the sheet is closing over Home). A new one is in the list after the
  // next load, so this waits for it. Everyone's items for now if the filter hides it, its room
  // opened if folded; then `lit` holds it for a moment: a "Show N more" over it opens
  // (ShowMore.tsx), the calendar goes to its day, and its row lights up and comes into view.
  // The calendar shows only To dos with a date: for anything else a toast says where it went.
  const [lit, setLit] = useState<{ id: string; delay: number } | null>(null);
  const saved = revealItem ? (data.items.find((it) => it.id === revealItem && it.status === 'open') ?? null) : null;
  const revealRef = useRef({ who, showAllForNow, collapsed, setCollapsed, onRevealed, view, roomOf, showToast });
  revealRef.current = { who, showAllForNow, collapsed, setCollapsed, onRevealed, view, roomOf, showToast };
  useEffect(() => {
    if (!saved) return;
    const now = revealRef.current;
    if (now.who !== 'all' && !isFor(saved, now.who)) now.showAllForNow();
    const folded = now.collapsed.has(saved.area_id);
    if (folded) {
      const nextIds = new Set(now.collapsed);
      nextIds.delete(saved.area_id);
      now.setCollapsed(nextIds);
    }
    if (now.view === 'calendar' && !isDated(saved)) now.showToast(notOnCalendar(saved, now.roomOf(saved.area_id)));
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    setLit({ id: saved.id, delay: folded && !still ? AREA_SLIDE_MS : AREA_REDRAW_MS });
    now.onRevealed?.();
  }, [saved]);
  useEffect(() => {
    if (!lit) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    // Once its room has opened and the rows behind a fold are drawn: into view, clear of the
    // docked tab switch and the round + (revealRow(), measured).
    const show = setTimeout(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>('[data-view] [data-item-id]')).find(
        (el) => el.dataset.itemId === lit.id,
      );
      if (row) revealRow(row, !still);
    }, lit.delay);
    const done = setTimeout(() => setLit(null), lit.delay + ITEM_FLASH_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(done);
    };
  }, [lit]);

  // An area from a shared link: show Rooms, open the area, then bring it to the top once it has
  // opened, and light its card up for a moment (near the bottom of the page it can't reach the
  // top). Focus goes to its name, so VoiceOver reads it ("Garden, expanded") and carries on.
  const [flashArea, setFlashArea] = useState<string | null>(null);
  const linkedRef = useRef({
    collapsed,
    setCollapsed,
    onLinkedAreaShown,
    onRoomContext,
    who,
    showAllForNow,
    sections,
    shown,
    view,
    showForLink,
  });
  linkedRef.current = { collapsed, setCollapsed, onLinkedAreaShown, onRoomContext, who, showAllForNow, sections, shown, view, showForLink };
  useEffect(() => {
    if (!linkedArea) return;
    const now = linkedRef.current;
    const switching = now.view !== 'rooms';
    // Rooms for this visit; what Home opens on next time stays the person's own choice.
    if (switching) now.showForLink('rooms');
    // The person filter hides the area, or some of its items: show everyone's for this visit, as
    // shared (Mine or the person picked stays the choice Home opens on).
    const all = now.sections.find((s) => s.area.id === linkedArea)?.items.length ?? 0;
    const visible = now.shown.find((s) => s.area.id === linkedArea)?.items.length;
    const unfiltered = now.who !== 'all' && (visible === undefined || visible < all);
    if (unfiltered) now.showAllForNow();
    const wasCollapsed = now.collapsed.has(linkedArea);
    if (wasCollapsed) {
      const nextIds = new Set(now.collapsed);
      nextIds.delete(linkedArea);
      now.setCollapsed(nextIds);
    }
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    // A collapsed card takes its slide (HomeScreen.module.css .panel) to reach full height, and
    // near the bottom of the page it can't come to the top before then. Rooms drawn afresh
    // (from another view, or areas the filter hid) are already open.
    const delay = switching || unfiltered ? AREA_REDRAW_MS : wasCollapsed && !still ? AREA_SLIDE_MS : 0;
    const timer = setTimeout(() => {
      const section = Array.from(document.querySelectorAll<HTMLElement>('section[data-area-id]')).find(
        (el) => el.dataset.areaId === linkedArea,
      );
      section?.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
      const name = section?.querySelector<HTMLElement>('button[aria-expanded], h2[tabindex]');
      if (name) quietFocus(name);
      setFlashArea(linkedArea);
      linkedRef.current.onRoomContext?.(linkedArea);
      linkedRef.current.onLinkedAreaShown?.();
    }, delay);
    return () => clearTimeout(timer);
  }, [linkedArea]);
  useEffect(() => {
    if (!flashArea) return;
    const timer = setTimeout(() => setFlashArea(null), AREA_FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashArea]);

  // The + adds to a room only while Rooms shows it: another view, or leaving Home, drops it.
  useEffect(() => {
    if (view !== 'rooms') onRoomContext?.(null);
  }, [view, onRoomContext]);
  useEffect(() => () => onRoomContext?.(null), [onRoomContext]);

  const shareArea = (area: Area) =>
    share(
      areaShareMessage(area, data.items, {
        members: data.members,
        today,
        timeZone,
        baseUrl: appBaseUrl(),
      }),
    );

  const toggle = (areaId: string) => {
    const nextIds = new Set(collapsed);
    if (nextIds.has(areaId)) nextIds.delete(areaId);
    else nextIds.add(areaId);
    setCollapsed(nextIds);
  };
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(foldableIds));

  return (
    <Screen
      label="Home"
      title="Home"
      subtitle={data.household.address.trim() || undefined}
      eyebrow={<time dateTime={today}>{longDay(today)}</time>}
      avatarEmoji={me.emoji}
      onAvatar={onOpenProfile}
      tabs={tabs}
    >
      {sections.length ? (
        <RevealContext.Provider value={lit?.id ?? null}>
          <p className={styles.summary} data-home-summary="">
            <span className={styles.summaryLead}>{summary.lead}</span>
            {summary.rest ? <span className={styles.summaryRest}> {summary.rest}</span> : null}
          </p>
          {readOnly ? <ReadOnlyLine /> : null}
          <div className={styles.controls}>
            <ViewSwitch value={view} onChange={pickView} />
            <PersonFilter members={data.members} meId={me.id} value={who} counts={counts} onChange={setWho} />
          </div>
          {view === 'next' ? (
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
          ) : view === 'rooms' ? (
            <div className={styles.view} data-view="rooms">
              {shown.length ? null : <p className={`${styles.card} ${styles.nobody}`}>{nobody}</p>}
              {foldableIds.length ? (
                // Every room down to one line, an overview of the house, and back.
                <div className={styles.roomsBar}>
                  <button type="button" className={styles.foldAll} data-fold-all="" onClick={toggleAll}>
                    {allCollapsed ? 'Expand all' : 'Collapse all'}
                  </button>
                </div>
              ) : null}
              {shown.map(({ area, items }) => (
                <AreaSection
                  key={area.id}
                  area={area}
                  items={items}
                  members={data.members}
                  today={today}
                  timeZone={timeZone}
                  collapsed={collapsed.has(area.id)}
                  linked={flashArea === area.id}
                  showWho={showWho}
                  onToggle={toggle}
                  onAddItem={onAddItem}
                  onShare={shareArea}
                  onOpenItem={onOpenItem}
                  onComplete={completeItem}
                />
              ))}
            </div>
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
      ) : (
        <>
          {readOnly ? <ReadOnlyLine /> : null}
          <NoAreas onOpenProfile={onOpenProfile} />
        </>
      )}
    </Screen>
  );
}

/**
 * Up next, Rooms or Calendar: a small segmented control (a radio group: the arrow keys move
 * the choice), quieter than the tab switch above it. Each segment is a 44px tall target.
 */
function ViewSwitch({ value, onChange }: { value: HomeView; onChange(view: HomeView): void }) {
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

/** Server mode, when the month's free storage writes are used up (docs/ARCHITECTURE.md "Budget"). */
export const READ_ONLY_LINE = 'Saving is paused until next month: the free storage limit is used up.';

function ReadOnlyLine() {
  return (
    <p className={styles.readOnly} role="status">
      {READ_ONLY_LINE}
    </p>
  );
}

/**
 * Focuses `el` without scrolling, for assistive tech (VoiceOver reads it and carries on from
 * there), but without a focus ring until a key is pressed: a link brought the person here,
 * not the keyboard (`[data-quiet-focus]`).
 */
function quietFocus(el: HTMLElement): void {
  el.dataset.quietFocus = '';
  const done = () => {
    delete el.dataset.quietFocus;
    el.removeEventListener('blur', done);
    window.removeEventListener('keydown', done, true);
  };
  el.addEventListener('blur', done);
  window.addEventListener('keydown', done, true);
  el.focus({ preventScroll: true });
}

/**
 * Every area was deleted (the Household editor keeps one, but two people can
 * each delete one at the same time): say where to add one, since items need an area.
 */
function NoAreas({ onOpenProfile }: { onOpenProfile(): void }) {
  return (
    <div className={`${styles.card} ${styles.noAreas}`}>
      <p className={styles.noAreasText}>
        <strong>No areas yet</strong>
        Items live in an area, like Kitchen or Garden. Add one in Profile, under Household.
      </p>
      <button type="button" className={styles.noAreasButton} onClick={onOpenProfile}>
        Open Profile
      </button>
    </div>
  );
}

/** How long a collapsed area's card takes to open (`.panel` in HomeScreen.module.css), and a little more. */
const AREA_SLIDE_MS = 360;
/** Time for rooms to be drawn (another view, or areas the person filter hid), before scrolling to one. */
const AREA_REDRAW_MS = 50;
/** How long an area opened from a shared link stays lit up (`.section[data-linked]`). */
const AREA_FLASH_MS = 2400;
/** How long a row just saved stays lit up (ItemRow.module.css `.row[data-lit]`). */
const ITEM_FLASH_MS = 2400;

const graphemes =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** A name split before its last character (grapheme): "Bathroom Larg" and "e". */
export function splitLast(name: string): [string, string] {
  const parts = graphemes ? Array.from(graphemes.segment(name), (s) => s.segment) : Array.from(name);
  const tail = parts.pop() ?? '';
  return [parts.join(''), tail];
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

/**
 * A room's one quiet word, after its name: "1 late", "1 urgent", "1 needs work" (a thing it
 * looks after), or more than one of them ("1 late, 1 urgent"), in red; else "All clear" when
 * nothing is open, or, folded, how many are ("3 open"); else nothing. `alert`: the red ones.
 */
export function roomStatus(items: Item[], today: ISODate, collapsed: boolean): { text: string; alert: boolean } | null {
  const tasks = items.filter((it) => !isState(it));
  const isLate = (it: Item) => it.due_date !== null && it.due_date < today;
  const late = tasks.filter(isLate).length;
  const urgent = tasks.filter((it) => it.rag === 'red' && !isLate(it)).length;
  const work = items.filter((it) => isState(it) && it.rag === 'red').length;
  if (late || urgent || work) {
    const words = [late ? `${late} late` : '', urgent ? `${urgent} urgent` : '', work ? `${work} ${work === 1 ? 'needs' : 'need'} work` : ''];
    return { text: words.filter(Boolean).join(', '), alert: true };
  }
  if (!items.length) return { text: 'All clear', alert: false };
  if (collapsed) return { text: `${items.length} open`, alert: false };
  return null;
}

/** A room shows this many To dos, then "Show 2 more" (when two or more are left). */
export const ROOM_PREVIEW = 3;

interface AreaSectionProps {
  area: Area;
  items: Item[];
  members: Member[];
  today: ISODate;
  /** The household's, for a To maintain row's "Updated" day. */
  timeZone: string;
  collapsed: boolean;
  /** Just opened from a shared link: lit up for a moment. */
  linked: boolean;
  /** Who each row is for, at the end of its title (off while one person's items show). */
  showWho: boolean;
  onToggle(areaId: string): void;
  onAddItem(areaId: string): void;
  /** Shares the area's open items (the share sheet, or the clipboard). */
  onShare(area: Area): void;
  onOpenItem(itemId: string): void;
  onComplete(itemId: string): Promise<void>;
}

/**
 * A room in the Rooms view, as one card (Apple Home's rooms): its drawing, its name (a
 * disclosure that folds the card to one line, remembered on this device), one quiet word on
 * its state ("1 urgent" in red, "3 open" while folded, "All clear"), and one "..." whose menu
 * holds Add Item and Share Room. Then its To dos, most urgent first, three of them and "Show
 * 2 more" when there are more; then the things it looks after (gauges, never rings). A room
 * with nothing open is one quiet line, in its place in the household's order.
 */
function AreaSection({
  area,
  items,
  members,
  today,
  timeZone,
  collapsed,
  linked,
  showWho,
  onToggle,
  onAddItem,
  onShare,
  onOpenItem,
  onComplete,
}: AreaSectionProps) {
  const headingId = useId();
  const panelId = useId();
  const statusId = useId();
  const listId = useId();
  const [head, tail] = splitLast(area.name);
  const empty = items.length === 0;
  // Late and urgent first, as in Up next (and in the same order as Share Room lists them).
  const ordered = roomOrder(items, today);
  const tasks = ordered.filter((it) => !isState(it));
  const states = ordered.filter(isState);
  const status = roomStatus(items, today, collapsed);
  const fold = useFold(tasks, ROOM_PREVIEW);
  // Out of reach as soon as it starts closing (visibility only switches once it has).
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (panelRef.current) panelRef.current.inert = collapsed;
  }, [collapsed]);
  const rowProps = { members, today, timeZone, showWho, onOpen: onOpenItem, onComplete };
  // The last row ticked off from the keyboard moved focus to the room's name; once the room is
  // empty that button goes (the name is a plain heading then), so focus moves to the heading
  // rather than being lost.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameFocused = useRef(false);
  useLayoutEffect(() => {
    if (!empty || !nameFocused.current) return;
    nameFocused.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) headingRef.current?.focus({ preventScroll: true });
  }, [empty]);
  const icon = (
    <span className={styles.roomIcon} data-alert={status?.alert || undefined} aria-hidden="true">
      <RoomIcon name={area.name} size={19} />
    </span>
  );
  return (
    <section
      aria-labelledby={headingId}
      className={styles.section}
      data-area-id={area.id}
      data-collapsed={collapsed || undefined}
      data-linked={linked || undefined}
      data-empty={empty || undefined}
    >
      <div className={styles.card} data-room-card="">
        <div className={styles.headerRow}>
          {empty ? (
            <h2 ref={headingRef} id={headingId} className={styles.header} tabIndex={-1}>
              {icon}
              <span className={styles.headerText}>{area.name}</span>
            </h2>
          ) : (
            <h2 ref={headingRef} id={headingId} className={styles.header}>
              <button
                type="button"
                className={styles.disclosure}
                onFocus={() => (nameFocused.current = true)}
                // Only when focus moved on: a button taken out of the page loses focus to nothing.
                onBlur={(e) => {
                  if (e.relatedTarget) nameFocused.current = false;
                }}
                // The name is split in two below; this keeps it one word in every engine.
                aria-label={area.name}
                aria-expanded={!collapsed}
                aria-controls={panelId}
                aria-describedby={status ? statusId : undefined}
                onClick={() => onToggle(area.id)}
              >
                {icon}
                <span className={styles.headerText}>
                  {head}
                  {/* The chevron never wraps onto a line of its own: it stays with the last letter. */}
                  <span className={styles.nameTail}>
                    {tail}
                    <ChevronRightIcon className={styles.chevron} size={12} strokeWidth={2.6} />
                  </span>
                </span>
              </button>
            </h2>
          )}
          {status ? (
            // A tap on the word opens or folds the room, as on its name (the name's button
            // carries it for the keyboard and VoiceOver, so it is no button of its own).
            <span
              id={statusId}
              className={styles.roomStatus}
              data-alert={status.alert || undefined}
              data-toggles={empty ? undefined : ''}
              onClick={empty ? undefined : () => onToggle(area.id)}
            >
              {/* Where room is short, it wraps between its parts ("1 late," then "1 needs work"), never inside one. */}
              <span className={styles.statusText}>
                {status.text.split(', ').map((part, i, parts) => (
                  <Fragment key={part}>
                    {i ? ' ' : null}
                    <span className={styles.statusPart}>{i < parts.length - 1 ? `${part},` : part}</span>
                  </Fragment>
                ))}
              </span>
            </span>
          ) : null}
          <Menu
            label={area.name}
            items={[
              {
                key: 'add',
                label: 'Add Item',
                ariaLabel: `Add item to ${area.name}`,
                icon: <PlusIcon size={20} strokeWidth={2.2} />,
                onSelect: () => onAddItem(area.id),
              },
              {
                // Named by its words, as seen and as Voice Control hears them; the menu is named after the room.
                key: 'share',
                label: 'Share Room',
                icon: <ShareIcon size={20} strokeWidth={1.9} />,
                onSelect: () => onShare(area),
              },
            ]}
          >
            {({ ref, ...trigger }) => (
              <button ref={ref} type="button" className={styles.roomMenu} aria-label={`${area.name} options`} {...trigger}>
                <EllipsisIcon size={20} />
              </button>
            )}
          </Menu>
        </div>
        {empty ? null : (
          /* Collapsed, the rows shrink to nothing and are out of reach (visibility: hidden). */
          <div id={panelId} ref={panelRef} className={styles.panel} data-area-panel="" data-collapsed={collapsed || undefined}>
            <div className={styles.panelInner}>
              <div className={styles.roomBody}>
                {tasks.length ? (
                  <ul id={listId} className={styles.list} role="list">
                    {fold.rows.map((item) => (
                      <ItemRow key={item.id} item={item} {...rowProps} />
                    ))}
                  </ul>
                ) : null}
                {fold.folds ? (
                  <ShowMore open={fold.open} hidden={fold.hidden} controls={listId} onToggle={fold.toggle} />
                ) : null}
                {states.length ? (
                  <div className={styles.looking} data-has-tasks={tasks.length > 0 || undefined}>
                    <p className={styles.lookingLabel}>Looking after</p>
                    <ul className={styles.list} role="list">
                      {states.map((item) => (
                        <ItemRow key={item.id} item={item} {...rowProps} />
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
