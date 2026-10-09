import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { RAG_ORDER, RAG_RING, RAG_TEXT, RAG_TINT } from '../../lib/constants';
import { longDay } from '../../lib/logic/dates';
import { itemMeta, itemsByArea } from '../../lib/logic/items';
import type { Area, ISODate, Item, Member, Rag } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { ChevronRightIcon, PlusIcon } from '../../ui/icons';
import { Screen } from '../../ui/Screen';
import { ItemRow } from './ItemRow';
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

/** Home: the household's areas, each with its open items (README "1. Home"). */
export function HomeScreen({ tabs, onOpenItem, onOpenProfile, onAddItem, revealArea, onRevealed }: HomeScreenProps) {
  const { data, me, today, completeItem } = useHousehold();
  const sections = useMemo(() => itemsByArea(data.areas, data.items), [data.areas, data.items]);
  const areaIds = useMemo(() => sections.map((s) => s.area.id), [sections]);
  const [collapsed, setCollapsed] = useCollapsedAreas(data.household.id, areaIds);
  const allCollapsed = areaIds.length > 0 && areaIds.every((id) => collapsed.has(id));

  // An item was saved into a collapsed area: open it so the item shows (the sheet closes over it).
  useEffect(() => {
    if (!revealArea) return;
    if (collapsed.has(revealArea)) {
      const next = new Set(collapsed);
      next.delete(revealArea);
      setCollapsed(next);
    }
    onRevealed?.();
  }, [revealArea, collapsed, setCollapsed, onRevealed]);

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
          <div className={styles.toolbar}>
            <button
              type="button"
              className={styles.toggleAll}
              onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(areaIds))}
            >
              {allCollapsed ? 'Expand All' : 'Collapse All'}
            </button>
          </div>
          {sections.map(({ area, items }) => (
            <AreaSection
              key={area.id}
              area={area}
              items={items}
              members={data.members}
              today={today}
              timeZone={data.household.timezone}
              collapsed={collapsed.has(area.id)}
              onToggle={toggle}
              onAddItem={onAddItem}
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
  onToggle(areaId: string): void;
  onAddItem(areaId: string): void;
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
  onToggle,
  onAddItem,
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
    <section aria-labelledby={headingId} data-collapsed={collapsed || undefined}>
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
