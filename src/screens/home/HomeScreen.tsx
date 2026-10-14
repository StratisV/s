import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { longDay } from '../../lib/logic/dates';
import { isState, itemsByArea } from '../../lib/logic/items';
import { areaShareMessage } from '../../lib/logic/share';
import { compareByUrgency, homeSummary, needsAttention, upNext } from '../../lib/logic/upNext';
import { appBaseUrl } from '../../lib/sharedLink';
import type { Area, ISODate, Item, Member } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { ChevronRightIcon, EllipsisIcon, FoldIcon, PlusIcon, ShareIcon } from '../../ui/icons';
import { Menu } from '../../ui/Menu';
import { Screen } from '../../ui/Screen';
import { useShare } from '../share/useShare';
import { HomeCalendar } from './HomeCalendar';
import { ItemRow } from './ItemRow';
import { PersonFilter } from './PersonFilter';
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
   * An area an item was just saved into (new, or moved there): it is expanded if it was
   * collapsed, so what was saved can be seen. Then `onRevealed` is called.
   */
  revealArea?: string | null;
  onRevealed?(): void;
  /**
   * An area opened from a shared link (`?area=`): Rooms is shown, the area expanded and
   * scrolled to the top, under the tab switch. Then `onLinkedAreaShown` is called.
   */
  linkedArea?: string | null;
  onLinkedAreaShown?(): void;
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

/** Where this device remembers the view: 'rooms' or 'calendar', nothing for Up next. */
export const HOME_VIEW_KEY = 'homeos.homeView';

function readView(): HomeView {
  try {
    const stored = localStorage.getItem(HOME_VIEW_KEY);
    return stored === 'rooms' || stored === 'calendar' ? stored : 'next';
  } catch {
    return 'next';
  }
}

function useHomeView() {
  const [view, setState] = useState<HomeView>(readView);
  const setView = useCallback((next: HomeView) => {
    try {
      if (next === 'next') localStorage.removeItem(HOME_VIEW_KEY);
      else localStorage.setItem(HOME_VIEW_KEY, next);
    } catch {
      /* private mode or storage full: it just isn't remembered */
    }
    setState(next);
  }, []);
  return [view, setView] as const;
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

/** Whose items Home shows, remembered per household on this device. */
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
  // Another household on this device: its own choice.
  const stored = state.key === key ? state.who : read();
  const who = validFilter(stored, members);
  const setWho = useCallback(
    (next: Who) => {
      try {
        if (next === 'all') localStorage.removeItem(key);
        else localStorage.setItem(key, next);
      } catch {
        /* private mode or storage full: it just isn't remembered */
      }
      setState({ key, who: next });
    },
    [key],
  );
  return [who, setWho] as const;
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
  revealArea,
  onRevealed,
  linkedArea,
  onLinkedAreaShown,
  onOpenHousekeeping,
}: HomeScreenProps) {
  const { data, me, today, completeItem, readOnly } = useHousehold();
  const share = useShare();
  const timeZone = data.household.timezone;
  const sections = useMemo(() => itemsByArea(data.areas, data.items), [data.areas, data.items]);
  const areaIds = useMemo(() => sections.map((s) => s.area.id), [sections]);
  const [collapsed, setCollapsed] = useCollapsedAreas(data.household.id, areaIds);
  const [who, setWho] = usePersonFilter(data.household.id, data.members);
  const [view, setView] = useHomeView();
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
  const shownIds = shown.map((s) => s.area.id);
  // The items shown, in Home's order (for the calendar's marks and Up next).
  const shownItems = useMemo(() => shown.flatMap((s) => s.items), [shown]);
  const allCollapsed = shownIds.length > 0 && shownIds.every((id) => collapsed.has(id));
  const next = useMemo(() => upNext(shownItems, today), [shownItems, today]);
  const summary = homeSummary(next, today);
  const roomNames = useMemo(() => new Map(data.areas.map((a) => [a.id, a.name])), [data.areas]);
  const roomOf = useCallback((id: string) => roomNames.get(id) ?? '', [roomNames]);
  const whoName = who === 'all' || who === 'none' ? null : (data.members.find((m) => m.id === who)?.name ?? 'them');
  const nobody = who === 'all' ? null : who === 'none' ? 'Nothing unassigned right now.' : `Nothing for ${whoName} right now.`;

  // An item was saved into a collapsed area: open it so the item shows (the sheet closes over it).
  // If the filter hides that area, show everyone's again.
  useEffect(() => {
    if (!revealArea) return;
    if (who !== 'all' && !shownIds.includes(revealArea)) setWho('all');
    if (collapsed.has(revealArea)) {
      const nextIds = new Set(collapsed);
      nextIds.delete(revealArea);
      setCollapsed(nextIds);
    }
    onRevealed?.();
    // `who` and `shownIds` are only read when an area is revealed.
  }, [revealArea, collapsed, setCollapsed, onRevealed]);

  // An area from a shared link: show Rooms, open the area, then bring it to the top once it has
  // opened, and light its card up for a moment (near the bottom of the page it can't reach the
  // top). Focus goes to its name, so VoiceOver reads it ("Garden, expanded") and carries on.
  const [flashArea, setFlashArea] = useState<string | null>(null);
  const linkedRef = useRef({ collapsed, setCollapsed, onLinkedAreaShown, who, setWho, sections, shown, view, setView });
  linkedRef.current = { collapsed, setCollapsed, onLinkedAreaShown, who, setWho, sections, shown, view, setView };
  useEffect(() => {
    if (!linkedArea) return;
    const now = linkedRef.current;
    const switching = now.view !== 'rooms';
    if (switching) now.setView('rooms');
    // The person filter hides the area, or some of its items: show everyone's, as shared.
    const all = now.sections.find((s) => s.area.id === linkedArea)?.items.length ?? 0;
    const visible = now.shown.find((s) => s.area.id === linkedArea)?.items.length;
    const unfiltered = now.who !== 'all' && (visible === undefined || visible < all);
    if (unfiltered) now.setWho('all');
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
      linkedRef.current.onLinkedAreaShown?.();
    }, delay);
    return () => clearTimeout(timer);
  }, [linkedArea]);
  useEffect(() => {
    if (!flashArea) return;
    const timer = setTimeout(() => setFlashArea(null), AREA_FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashArea]);

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
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(shownIds));

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
        <>
          <p className={styles.summary} data-home-summary="">
            <span className={styles.summaryLead}>{summary.lead}</span>
            {summary.rest ? <span className={styles.summaryRest}> {summary.rest}</span> : null}
          </p>
          {readOnly ? <ReadOnlyLine /> : null}
          <div className={styles.controls}>
            <ViewSwitch value={view} onChange={setView} />
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
              onOpenItem={onOpenItem}
              onComplete={completeItem}
            />
          ) : view === 'rooms' ? (
            <div className={styles.view} data-view="rooms">
              {shown.length ? null : <p className={styles.nobody}>{nobody}</p>}
              {shown.map(({ area, items }) => (
                <AreaSection
                  key={area.id}
                  area={area}
                  items={items}
                  members={data.members}
                  today={today}
                  timeZone={timeZone}
                  collapsed={collapsed.has(area.id)}
                  allCollapsed={allCollapsed}
                  linked={flashArea === area.id}
                  onToggle={toggle}
                  onToggleAll={toggleAll}
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
        </>
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
          {v.label}
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
    <div className={styles.noAreas}>
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

const graphemes =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** A name split before its last character (grapheme): "Bathroom Larg" and "e". */
export function splitLast(name: string): [string, string] {
  const parts = graphemes ? Array.from(graphemes.segment(name), (s) => s.segment) : Array.from(name);
  const tail = parts.pop() ?? '';
  return [parts.join(''), tail];
}

/** "1 urgent" (late or urgent To dos), else nothing; collapsed, how many are open too. */
export function roomStatus(items: Item[], today: ISODate, collapsed: boolean): { text: string; urgent: boolean } | null {
  const urgent = items.filter((it) => !isState(it) && needsAttention(it, today)).length;
  if (urgent) return { text: `${urgent} urgent`, urgent: true };
  if (!items.length) return { text: 'All clear', urgent: false };
  if (collapsed) return { text: `${items.length} open`, urgent: false };
  return null;
}

interface AreaSectionProps {
  area: Area;
  items: Item[];
  members: Member[];
  today: ISODate;
  /** The household's, for a To maintain row's "Updated" day. */
  timeZone: string;
  collapsed: boolean;
  /** Every room shown is collapsed: the menu offers Expand All. */
  allCollapsed: boolean;
  /** Just opened from a shared link: lit up for a moment. */
  linked: boolean;
  onToggle(areaId: string): void;
  onToggleAll(): void;
  onAddItem(areaId: string): void;
  /** Shares the area's open items (the share sheet, or the clipboard). */
  onShare(area: Area): void;
  onOpenItem(itemId: string): void;
  onComplete(itemId: string): Promise<void>;
}

/**
 * A room in the Rooms view: its name (a disclosure that folds the card away, remembered on
 * this device), one quiet word on its state ("1 urgent" in red, "All clear"), and one "..."
 * button whose menu holds Add Item, Share Room and Collapse All. Its To dos, then the things it
 * looks after (gauges, never rings) under a hairline. A room with nothing open is just its
 * name and "All clear", with no card.
 */
function AreaSection({
  area,
  items,
  members,
  today,
  timeZone,
  collapsed,
  allCollapsed,
  linked,
  onToggle,
  onToggleAll,
  onAddItem,
  onShare,
  onOpenItem,
  onComplete,
}: AreaSectionProps) {
  const headingId = useId();
  const panelId = useId();
  const [head, tail] = splitLast(area.name);
  const empty = items.length === 0;
  // Late and urgent first, as in Up next.
  const tasks = items.filter((it) => !isState(it)).sort(compareByUrgency(today));
  const states = items.filter(isState);
  const status = roomStatus(items, today, collapsed);
  // Out of reach as soon as it starts closing (visibility only switches once it has).
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (panelRef.current) panelRef.current.inert = collapsed;
  }, [collapsed]);
  const rowProps = { members, today, timeZone, onOpen: onOpenItem, onComplete };
  return (
    <section
      aria-labelledby={headingId}
      className={styles.section}
      data-area-id={area.id}
      data-collapsed={collapsed || undefined}
      data-linked={linked || undefined}
      data-empty={empty || undefined}
    >
      <div className={styles.headerRow}>
        {empty ? (
          <h2 id={headingId} className={styles.header} tabIndex={-1}>
            <span className={styles.headerText}>{area.name}</span>
          </h2>
        ) : (
          <h2 id={headingId} className={styles.header}>
            <button
              type="button"
              className={styles.disclosure}
              // The name is split in two below; this keeps it one word in every engine.
              aria-label={area.name}
              aria-expanded={!collapsed}
              aria-controls={panelId}
              onClick={() => onToggle(area.id)}
            >
              {head}
              {/* The chevron never wraps onto a line of its own: it stays with the last letter. */}
              <span className={styles.nameTail}>
                {tail}
                <ChevronRightIcon className={styles.chevron} size={12} strokeWidth={2.6} />
              </span>
            </button>
          </h2>
        )}
        {status ? (
          <span className={styles.roomStatus} data-urgent={status.urgent || undefined}>
            {status.text}
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
              key: 'share',
              label: 'Share Room',
              ariaLabel: `Share ${area.name}`,
              icon: <ShareIcon size={20} strokeWidth={1.9} />,
              onSelect: () => onShare(area),
            },
            {
              key: 'fold',
              label: allCollapsed ? 'Expand All Rooms' : 'Collapse All Rooms',
              icon: <FoldIcon size={20} open={allCollapsed} />,
              groupStart: true,
              onSelect: onToggleAll,
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
        /* Collapsed, the card shrinks to nothing and is out of reach (visibility: hidden). */
        <div id={panelId} ref={panelRef} className={styles.panel} data-area-panel="" data-collapsed={collapsed || undefined}>
          <div className={styles.panelInner}>
            <div className={styles.card}>
              {tasks.length ? (
                <ul className={styles.list} role="list">
                  {tasks.map((item) => (
                    <ItemRow key={item.id} item={item} {...rowProps} />
                  ))}
                </ul>
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
    </section>
  );
}
