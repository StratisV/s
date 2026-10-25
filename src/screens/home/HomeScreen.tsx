import { useEffect, useMemo, useRef, useState } from 'react';
import { areaOverview } from '../../lib/logic/areaStatus';
import { longDay } from '../../lib/logic/dates';
import { itemsByArea } from '../../lib/logic/items';
import { homeSummary, upNext } from '../../lib/logic/upNext';
import { useHousehold } from '../../state/HomeProvider';
import { Screen } from '../../ui/Screen';
import { AreaCard } from './AreaCard';
import styles from './HomeScreen.module.css';

interface HomeScreenProps {
  onOpenProfile(): void;
  /** A card: opens its area in a sheet (App's AreaSheet). */
  onOpenArea(areaId: string): void;
  /**
   * An item just saved from Home (the round +), so the person sees where it went: once it is
   * in the list, its area's card comes into view and lights up for a moment. Then
   * `onRevealed` is called.
   */
  revealItem?: string | null;
  onRevealed?(): void;
}

/** How long a card stays lit up after an item was saved into its area (`.cell[data-lit]`). */
const CARD_FLASH_MS = 2400;

/**
 * Home (docs/ARCHITECTURE.md "Home"): the hero, then one plain sentence on what needs doing
 * across the house ("2 things need attention and 1 is due today. Everything else can wait."),
 * then a card for each area in the household's order, two to a row: its illustration, its
 * name, how many urgent tasks (red) and non-urgent ones (orange) it has, or All good (green),
 * and who is looking after them. A card opens its area in a sheet.
 */
export function HomeScreen({ onOpenProfile, onOpenArea, revealItem, onRevealed }: HomeScreenProps) {
  const { data, me, today, readOnly } = useHousehold();
  const sections = useMemo(() => itemsByArea(data.areas, data.items), [data.areas, data.items]);
  // The whole house, whoever is looking.
  const summary = useMemo(() => homeSummary(upNext(data.items, today), today), [data.items, today]);
  const cards = useMemo(
    () => sections.map(({ area, items }) => ({ area, ...areaOverview(items, data.members) })),
    [sections, data.members],
  );

  // An item was just saved from Home: once it has loaded, its area's card comes into view and
  // lights up for a moment.
  const [lit, setLit] = useState<string | null>(null);
  const saved = revealItem ? (data.items.find((it) => it.id === revealItem && it.status === 'open') ?? null) : null;
  const revealedRef = useRef(onRevealed);
  revealedRef.current = onRevealed;
  useEffect(() => {
    if (!saved) return;
    setLit(saved.area_id);
    revealedRef.current?.();
  }, [saved]);
  useEffect(() => {
    if (!lit) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const cell = Array.from(document.querySelectorAll<HTMLElement>('li[data-area-id]')).find((el) => el.dataset.areaId === lit);
    cell?.scrollIntoView?.({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
    const done = setTimeout(() => setLit(null), CARD_FLASH_MS);
    return () => clearTimeout(done);
  }, [lit]);

  return (
    <Screen
      hero
      label="Home"
      title="Home"
      subtitle={data.household.address.trim() || undefined}
      eyebrow={<time dateTime={today}>{longDay(today)}</time>}
      avatarEmoji={me.emoji}
      onAvatar={onOpenProfile}
    >
      {sections.length ? (
        <>
          <p className={styles.summary} data-home-summary="">
            <span className={styles.summaryLead}>{summary.lead}</span>
            {summary.rest ? <span className={styles.summaryRest}> {summary.rest}</span> : null}
          </p>
          {readOnly ? <ReadOnlyLine /> : null}
          <ul className={styles.grid} role="list" aria-label="Areas" data-area-grid="">
            {cards.map(({ area, urgent, nonUrgent, people }) => (
              <li key={area.id} className={styles.cell} data-area-id={area.id} data-lit={lit === area.id || undefined}>
                <AreaCard
                  area={{ id: area.id, name: area.name }}
                  urgent={urgent}
                  nonUrgent={nonUrgent}
                  people={people.map((m) => ({ id: m.id, name: m.name, emoji: m.emoji }))}
                  onOpen={() => onOpenArea(area.id)}
                />
              </li>
            ))}
          </ul>
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

/** Server mode, when the month's free storage writes are used up (docs/ARCHITECTURE.md "Budget"). */
export const READ_ONLY_LINE = 'Saving is paused until next month: the free storage limit is used up.';

export function ReadOnlyLine() {
  return (
    <p className={styles.readOnly} role="status">
      {READ_ONLY_LINE}
    </p>
  );
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
