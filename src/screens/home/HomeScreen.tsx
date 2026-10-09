import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { RAG_ORDER, RAG_RING, RAG_TEXT, RAG_TINT } from '../../lib/constants';
import { longDay } from '../../lib/logic/dates';
import { itemMeta, itemsByArea } from '../../lib/logic/items';
import { areaShareMessage } from '../../lib/logic/share';
import { appBaseUrl } from '../../lib/sharedLink';
import type { Area, ISODate, Item, Member, Rag } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { ChevronRightIcon, PlusIcon, ShareIcon } from '../../ui/icons';
import { Screen } from '../../ui/Screen';
import { useShare } from '../share/useShare';
import { ItemRow } from './ItemRow';
import { PersonFilter } from './PersonFilter';
import { countsFor, isFor, personFilterKey, validFilter, type PersonFilter as Who } from './personFilter';
import styles from './HomeScreen.module.css';

interface HomeScreenProps {
  /** The tab switch, under the hero. */
  tabs?: ReactNode;
  onOpenItem(itemId: string): void;
  onOpenProfile(): void;
  /** The + on an area header: opens the new-item sheet with that area chosen. */
  onAddItem(areaId: string): void;
  /**
   * An area an item was just saved into (new, or moved there): it is expanded if it was
   * collapsed, so what was saved can be seen. Then `onRevealed` is called.
   */
  revealArea?: string | null;
  onRevealed?(): void;
  /**
   * An area opened from a shared link (`?area=`): it is expanded and scrolled to the top,
   * under the tab switch. Then `onLinkedAreaShown` is called.
   */
  linkedArea?: string | null;
  onLinkedAreaShown?(): void;
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

/** Home: the household's areas, each with its open items (README "1. Home"). */
export function HomeScreen({
  tabs,
  onOpenItem,
  onOpenProfile,
  onAddItem,
  revealArea,
  onRevealed,
  linkedArea,
  onLinkedAreaShown,
}: HomeScreenProps) {
  const { data, me, today, completeItem } = useHousehold();
  const share = useShare();
  const sections = useMemo(() => itemsByArea(data.areas, data.items), [data.areas, data.items]);
  const areaIds = useMemo(() => sections.map((s) => s.area.id), [sections]);
  const [collapsed, setCollapsed] = useCollapsedAreas(data.household.id, areaIds);
  const [who, setWho] = usePersonFilter(data.household.id, data.members);
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
  const allCollapsed = shownIds.length > 0 && shownIds.every((id) => collapsed.has(id));

  // An item was saved into a collapsed area: open it so the item shows (the sheet closes over it).
  // If the filter hides that area, show everyone's again.
  useEffect(() => {
    if (!revealArea) return;
    if (who !== 'all' && !shownIds.includes(revealArea)) setWho('all');
    if (collapsed.has(revealArea)) {
      const next = new Set(collapsed);
      next.delete(revealArea);
      setCollapsed(next);
    }
    onRevealed?.();
    // `who` and `shownIds` are only read when an area is revealed.
  }, [revealArea, collapsed, setCollapsed, onRevealed]);

  // An area from a shared link: open it, then bring it to the top once it has opened, and
  // light its card up for a moment (near the bottom of the page it can't reach the top).
  const [flashArea, setFlashArea] = useState<string | null>(null);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const linkedRef = useRef({ setCollapsed, onLinkedAreaShown });
  linkedRef.current = { setCollapsed, onLinkedAreaShown };
  useEffect(() => {
    if (!linkedArea) return;
    const wasCollapsed = collapsedRef.current.has(linkedArea);
    if (wasCollapsed) {
      const next = new Set(collapsedRef.current);
      next.delete(linkedArea);
      linkedRef.current.setCollapsed(next);
    }
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    // A collapsed card takes its slide (HomeScreen.module.css .panel) to reach full height,
    // and near the bottom of the page it can't come to the top before then.
    const timer = setTimeout(
      () => {
        const section = Array.from(document.querySelectorAll<HTMLElement>('section[data-area-id]')).find(
          (el) => el.dataset.areaId === linkedArea,
        );
        section?.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
        setFlashArea(linkedArea);
        linkedRef.current.onLinkedAreaShown?.();
      },
      wasCollapsed && !still ? AREA_SLIDE_MS : 0,
    );
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
        timeZone: data.household.timezone,
        baseUrl: appBaseUrl(),
      }),
    );

  const toggle = (areaId: string) => {
    const next = new Set(collapsed);
    if (next.has(areaId)) next.delete(areaId);
    else next.add(areaId);
    setCollapsed(next);
  };

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
          <PersonFilter members={data.members} meId={me.id} value={who} counts={counts} onChange={setWho} />
          {shown.length ? (
            <div className={styles.toolbar}>
              <button
                type="button"
                className={styles.toggleAll}
                onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(shownIds))}
              >
                {allCollapsed ? 'Expand All' : 'Collapse All'}
              </button>
            </div>
          ) : (
            <p className={styles.nobody}>
              {who === 'none'
                ? 'Nothing unassigned right now.'
                : `Nothing for ${data.members.find((m) => m.id === who)?.name ?? 'them'} right now.`}
            </p>
          )}
          {shown.map(({ area, items }) => (
            <AreaSection
              key={area.id}
              area={area}
              items={items}
              members={data.members}
              today={today}
              timeZone={data.household.timezone}
              collapsed={collapsed.has(area.id)}
              linked={flashArea === area.id}
              onToggle={toggle}
              onAddItem={onAddItem}
              onShare={shareArea}
              onOpenItem={onOpenItem}
              onComplete={completeItem}
            />
          ))}
        </>
      ) : (
        <NoAreas onOpenProfile={onOpenProfile} />
      )}
    </Screen>
  );
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
/** How long an area opened from a shared link stays lit up (`.section[data-linked]`). */
const AREA_FLASH_MS = 2400;

const COUNT_LABEL: Record<Rag, string> = { red: 'urgent', amber: 'at risk', green: 'on track' };

/** Open items per status, red first and zeros left out, and how they are read out. */
export function statusCounts(items: Pick<Item, 'rag'>[]): { counts: { rag: Rag; count: number }[]; label: string } {
  const counts = RAG_ORDER.map((rag) => ({ rag, count: items.filter((it) => it.rag === rag).length })).filter(
    (c) => c.count > 0,
  );
  return { counts, label: counts.map((c) => `${c.count} ${COUNT_LABEL[c.rag]}`).join(', ') };
}

/** Red, amber and green chips with their counts: "1 urgent, 2 at risk, 3 on track". */
function StatusCounts({ items }: { items: Item[] }) {
  const { counts, label } = statusCounts(items);
  if (!counts.length) return null;
  return (
    <span className={styles.counts} role="img" aria-label={label}>
      {counts.map(({ rag, count }) => (
        <span
          key={rag}
          className={styles.count}
          data-rag={rag}
          style={{ '--dot': RAG_RING[rag], '--text': RAG_TEXT[rag], '--chip': RAG_TINT[rag] } as CSSProperties}
        >
          <span className={styles.dot} />
          {count}
        </span>
      ))}
    </span>
  );
}

const graphemes =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** A name split before its last character (grapheme): "Bathroom Larg" and "e". */
export function splitLast(name: string): [string, string] {
  const parts = graphemes ? Array.from(graphemes.segment(name), (s) => s.segment) : Array.from(name);
  const tail = parts.pop() ?? '';
  return [parts.join(''), tail];
}

interface AreaSectionProps {
  area: Area;
  items: Item[];
  members: Member[];
  today: ISODate;
  /** The household's, for a To maintain row's "Updated <day>". */
  timeZone: string;
  collapsed: boolean;
  /** Just opened from a shared link: lit up for a moment. */
  linked: boolean;
  onToggle(areaId: string): void;
  onAddItem(areaId: string): void;
  /** Shares the area's open items (the share sheet, or the clipboard). */
  onShare(area: Area): void;
  onOpenItem(itemId: string): void;
  onComplete(itemId: string): Promise<void>;
}

function AreaSection({
  area,
  items,
  members,
  today,
  timeZone,
  collapsed,
  linked,
  onToggle,
  onAddItem,
  onShare,
  onOpenItem,
  onComplete,
}: AreaSectionProps) {
  const headingId = useId();
  const panelId = useId();
  const [head, tail] = splitLast(area.name);
  // Out of reach as soon as it starts closing (visibility only switches once it has).
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (panelRef.current) panelRef.current.inert = collapsed;
  }, [collapsed]);
  return (
    <section
      aria-labelledby={headingId}
      className={styles.section}
      data-area-id={area.id}
      data-collapsed={collapsed || undefined}
      data-linked={linked || undefined}
    >
      <div className={styles.headerRow}>
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
              <ChevronRightIcon className={styles.chevron} size={13} strokeWidth={2.6} />
            </span>
          </button>
        </h2>
        <StatusCounts items={items} />
        <button type="button" className={styles.share} aria-label={`Share ${area.name}`} onClick={() => onShare(area)}>
          <ShareIcon size={20} strokeWidth={2} />
        </button>
        <button
          type="button"
          className={styles.add}
          aria-label={`Add item to ${area.name}`}
          onClick={() => onAddItem(area.id)}
        >
          <PlusIcon size={16} strokeWidth={2.6} />
        </button>
      </div>
      {/* Collapsed, the card shrinks to nothing and is out of reach (visibility: hidden). */}
      <div id={panelId} ref={panelRef} className={styles.panel} data-area-panel="" data-collapsed={collapsed || undefined}>
        <div className={styles.panelInner}>
          <div className={styles.card}>
            {items.length ? (
              <ul className={styles.list} role="list">
                {items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    meta={itemMeta(item, members, today, timeZone)}
                    onOpen={onOpenItem}
                    onComplete={onComplete}
                  />
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>Nothing to do</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
