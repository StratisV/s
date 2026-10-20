import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { longDay } from '../../lib/logic/dates';
import { itemsByArea } from '../../lib/logic/items';
import { homeSummary, upNext, type SummaryScope } from '../../lib/logic/upNext';
import type { Member } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { Screen } from '../../ui/Screen';
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
   * once it is in the list, everyone's items show if the person filter hides it, and its card
   * comes into view, lit up for a moment. One the list doesn't show (a thing looked after in
   * good shape) gets a toast saying where it went. Then `onRevealed` is called.
   */
  revealItem?: string | null;
  onRevealed?(): void;
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

/** Time for the list to be drawn afresh (everyone's items) before scrolling to a card. */
const REDRAW_MS = 50;
/** How long a card just saved stays lit up (ItemCard.module.css `.item[data-lit]`). */
const ITEM_FLASH_MS = 2400;

/**
 * Needs attention (docs/ARCHITECTURE.md "Needs attention"), the second tab: one plain sentence
 * on what needs doing ("2 things need attention and 1 is due today. Everything else can
 * wait."), whose items show (Mine, the people menu), then one list of every open item that
 * wants something from someone, in priority order, each a card with its area's picture
 * (UpNextView, upNext()).
 */
export function NeedsAttentionScreen({ onOpenItem, onOpenProfile, revealItem, onRevealed }: NeedsAttentionScreenProps) {
  const { data, me, today, completeItem, readOnly, showToast } = useHousehold();
  const timeZone = data.household.timezone;
  const sections = useMemo(() => itemsByArea(data.areas, data.items), [data.areas, data.items]);
  const [who, setWho, showAllForNow] = usePersonFilter(data.household.id, data.members);
  const allItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  // The people menu counts what the list would show for each of them.
  const counts = useMemo(() => countsFor(upNext(allItems, today).items, data.members), [allItems, today, data.members]);
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
  // Who each card is for, after its area: only while everyone's items show.
  const showWho = who === 'all';
  const areas = useMemo(() => new Map(data.areas.map((a) => [a.id, { id: a.id, name: a.name }])), [data.areas]);
  const areaOf = useCallback((id: string) => areas.get(id) ?? { id, name: '' }, [areas]);
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
  // `lit` holds it for a moment: its card lights up and comes into view. One the list doesn't
  // show (a thing looked after in good shape) gets a toast saying where it went.
  const [lit, setLit] = useState<string | null>(null);
  const saved = revealItem ? (data.items.find((it) => it.id === revealItem && it.status === 'open') ?? null) : null;
  const revealRef = useRef({ who, showAllForNow, onRevealed, areaOf, showToast, today });
  revealRef.current = { who, showAllForNow, onRevealed, areaOf, showToast, today };
  useEffect(() => {
    if (!saved) return;
    const now = revealRef.current;
    if (upNext([saved], now.today).items.length) {
      if (now.who !== 'all' && !isFor(saved, now.who)) now.showAllForNow();
      setLit(saved.id);
    } else now.showToast(notListed(now.areaOf(saved.area_id).name));
    now.onRevealed?.();
  }, [saved]);
  useEffect(() => {
    if (!lit) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    // Once the list is drawn afresh: into view, clear of the round + and the tab bar
    // (revealRow(), measured).
    const show = setTimeout(() => {
      const card = Array.from(document.querySelectorAll<HTMLElement>('[data-attention-list] [data-item-id]')).find(
        (el) => el.dataset.itemId === lit,
      );
      if (card) revealRow(card, !still);
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
        {/* Where keyboard focus goes once the last card is ticked off (rowFallback()). */}
        <p className={styles.summary} data-attention-summary="" data-row-fallback="" tabIndex={-1}>
          <span className={styles.summaryLead}>{summary.lead}</span>
          {summary.rest ? <span className={styles.summaryRest}> {summary.rest}</span> : null}
        </p>
        {readOnly ? <ReadOnlyLine /> : null}
        <div className={styles.controls}>
          <PersonFilter members={data.members} meId={me.id} value={who} counts={counts} onChange={setWho} />
        </div>
        <UpNextView
          view={next}
          areaOf={areaOf}
          members={data.members}
          today={today}
          timeZone={timeZone}
          nobody={nobody}
          showWho={showWho}
          onOpenItem={onOpenItem}
          onComplete={completeItem}
        />
      </RevealContext.Provider>
    </Screen>
  );
}

/**
 * The toast when an item saved over Needs attention isn't one the list shows (a thing looked
 * after in good shape: its area's sheet has it), so the person knows it was saved, and where:
 * "Saved in Garden."
 */
export function notListed(room: string): string {
  return room ? `Saved in ${room}.` : 'Saved.';
}
