import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { areaOverview, peopleText, statusLines } from '../../lib/logic/areaStatus';
import { isState } from '../../lib/logic/items';
import { areaShareMessage } from '../../lib/logic/share';
import { roomOrder } from '../../lib/logic/upNext';
import { appBaseUrl } from '../../lib/sharedLink';
import type { Area, Item } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { AreaArt } from '../../ui/area-art/AreaArt';
import { EmojiText } from '../../ui/EmojiText';
import { PlusIcon, ShareIcon, XMarkIcon } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import { useShare } from '../share/useShare';
import { ItemRow } from './ItemRow';
import { RevealContext, revealRow } from './reveal';
import { ShowMore, useFold } from './ShowMore';
import { StatusLines } from './StatusLines';
import styles from './AreaSheet.module.css';

/** An area shows this many To dos, then "Show 2 more" (when two or more are left). */
export const ROOM_PREVIEW = 3;

/** How long a row just saved stays lit up (ItemRow.module.css `.row[data-lit]`). */
const ITEM_FLASH_MS = 2400;
/** Time for the rows behind a fold to be drawn before scrolling to one. */
const REDRAW_MS = 50;

interface AreaSheetProps {
  /** The area shown (kept while the sheet slides away). */
  areaId: string | null;
  open: boolean;
  onClose(): void;
  /** After it has slid away. */
  onExited?(): void;
  onOpenItem(itemId: string): void;
  /** Add Item: the new-item sheet with this area chosen. */
  onAddItem(areaId: string): void;
  /**
   * An item just saved over this sheet (new, or moved to another area). In this area: a "Show
   * N more" over it opens, and its row comes into view, lit up for a moment. Saved somewhere
   * else: a toast says where. Then `onRevealed` is called.
   */
  revealItem?: string | null;
  onRevealed?(): void;
  /** The Item sheet is open over it. */
  behind?: boolean;
}

/**
 * An area, opened from its card on Home (or a shared `?area=` link) in a page sheet: its
 * illustration across the top, its name, how many urgent and non-urgent tasks it has (or All
 * good), in the card's words and colours, and who is looking after it,
 * Add Item and Share Room, then its To dos, most urgent first (three, then "Show 2 more"),
 * and the things it looks after, as rows: a ring to tick a To do off (with Undo), a gauge and
 * a condition word for a thing looked after. A row opens the item, in the Item sheet over this
 * one.
 */
export function AreaSheet({ areaId, open, onClose, onExited, onOpenItem, onAddItem, revealItem, onRevealed, behind }: AreaSheetProps) {
  const { data } = useHousehold();
  const area = areaId ? (data.areas.find((a) => a.id === areaId) ?? null) : null;
  // Deleted while open (someone else, or Profile): nothing left to show.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (open && areaId && !area) closeRef.current();
  }, [open, areaId, area]);
  return (
    <Sheet open={open && !!area} onRequestClose={onClose} onExited={onExited} label={area?.name ?? 'Area'} behind={behind}>
      {area ? (
        <AreaBody
          key={area.id}
          area={area}
          onClose={onClose}
          onOpenItem={onOpenItem}
          onAddItem={onAddItem}
          revealItem={revealItem}
          onRevealed={onRevealed}
        />
      ) : null}
    </Sheet>
  );
}

interface AreaBodyProps {
  area: Area;
  onClose(): void;
  onOpenItem(itemId: string): void;
  onAddItem(areaId: string): void;
  revealItem?: string | null;
  onRevealed?(): void;
}

function AreaBody({ area, onClose, onOpenItem, onAddItem, revealItem, onRevealed }: AreaBodyProps) {
  const { data, today, completeItem, showToast } = useHousehold();
  const share = useShare();
  const timeZone = data.household.timezone;
  const items = useMemo(() => data.items.filter((it) => it.area_id === area.id && it.status === 'open'), [data.items, area.id]);
  const overview = areaOverview(items, data.members);
  // Late and urgent first (and in the same order as Share Room lists them).
  const ordered = roomOrder(items, today);
  const tasks = ordered.filter((it) => !isState(it));
  const states = ordered.filter(isState);
  const titleId = useId();
  const todoId = useId();
  const lookingId = useId();
  const statusId = useId();
  const peopleId = useId();

  // An item just saved over the sheet: once it has loaded, lit up here (a fold over it opens),
  // or, saved into another area, a toast says where it went.
  const [lit, setLit] = useState<string | null>(null);
  const saved = revealItem ? (data.items.find((it) => it.id === revealItem && it.status === 'open') ?? null) : null;
  const revealRef = useRef({ onRevealed, showToast, areas: data.areas });
  revealRef.current = { onRevealed, showToast, areas: data.areas };
  useEffect(() => {
    if (!saved) return;
    const now = revealRef.current;
    if (saved.area_id === area.id) setLit(saved.id);
    else {
      const room = now.areas.find((a) => a.id === saved.area_id)?.name;
      now.showToast(room ? `Saved in ${room}.` : 'Saved.');
    }
    now.onRevealed?.();
  }, [saved, area.id]);
  useEffect(() => {
    if (!lit) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const show = setTimeout(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>('[data-area-sheet] [data-item-id]')).find(
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

  const shareArea = () =>
    share(areaShareMessage(area, data.items, { members: data.members, today, timeZone, baseUrl: appBaseUrl() }));

  return (
    <div className={styles.root} data-area-sheet="" data-area-id={area.id}>
      <div className={styles.scroll} data-sheet-scroll="">
        {/* The drawing doubles as the sheet's handle: drag it down to close. */}
        <div className={styles.banner} data-sheet-handle="">
          <AreaArt name={area.name} seed={area.id} className={styles.art} />
          <span className={styles.grabber} aria-hidden="true" />
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            <XMarkIcon size={17} strokeWidth={2.6} />
          </button>
        </div>
        <div className={styles.head}>
          <h1 id={titleId} className={styles.title} tabIndex={-1} aria-describedby={`${statusId} ${peopleId}`}>
            {area.name}
          </h1>
          <p id={statusId} className={styles.status} data-area-status="">
            <StatusLines lines={statusLines(overview)} size="sheet" />
          </p>
          <p className={styles.people}>
            {overview.people.length ? (
              <span className={styles.faces} aria-hidden="true">
                {overview.people.slice(0, 4).map((m) => (
                  <span key={m.id} className={styles.face}>
                    <EmojiText text={m.emoji} />
                  </span>
                ))}
              </span>
            ) : null}
            <span id={peopleId} data-area-people="">
              {lookingAfter(overview.people)}
            </span>
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.action} aria-label={`Add item to ${area.name}`} onClick={() => onAddItem(area.id)}>
            <PlusIcon size={19} strokeWidth={2.4} />
            Add Item
          </button>
          <button type="button" className={styles.action} onClick={shareArea}>
            <ShareIcon size={19} strokeWidth={1.9} />
            Share Room
          </button>
        </div>
        <RevealContext.Provider value={lit}>
          <Tasks
            headingId={todoId}
            tasks={tasks}
            rowProps={{ members: data.members, today, timeZone, showWho: true, onOpen: onOpenItem, onComplete: completeItem }}
          />
          {states.length ? (
            <section aria-labelledby={lookingId} className={styles.section} data-area-looking="">
              <h2 id={lookingId} className={styles.sectionTitle} tabIndex={-1}>
                Looking after
              </h2>
              <div className={styles.card}>
                <ul className={styles.list} role="list">
                  {states.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      members={data.members}
                      today={today}
                      timeZone={timeZone}
                      onOpen={onOpenItem}
                      onComplete={completeItem}
                    />
                  ))}
                </ul>
              </div>
            </section>
          ) : null}
        </RevealContext.Provider>
      </div>
    </div>
  );
}

/** "Shea is on it", "Shea and Ela are on it", "No one is on it yet". */
function lookingAfter(people: { name: string }[]): string {
  if (!people.length) return 'No one is on it yet';
  return `${peopleText(people)} ${people.length === 1 ? 'is' : 'are'} on it`;
}

interface TasksProps {
  headingId: string;
  tasks: Item[];
  rowProps: Omit<Parameters<typeof ItemRow>[0], 'item'>;
}

/**
 * The area's To dos, most urgent first: three, then "Show 2 more". Its heading takes focus
 * when the last row is ticked off from the keyboard.
 */
function Tasks({ headingId, tasks, rowProps }: TasksProps) {
  const listId = useId();
  const fold = useFold(tasks, ROOM_PREVIEW);
  return (
    <section aria-labelledby={headingId} className={styles.section} data-area-tasks="">
      <h2 id={headingId} className={styles.sectionTitle} tabIndex={-1}>
        To do
      </h2>
      <div className={styles.card}>
        {tasks.length ? (
          <ul id={listId} className={styles.list} role="list">
            {fold.rows.map((item) => (
              <ItemRow key={item.id} item={item} {...rowProps} />
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>Nothing to do here.</p>
        )}
        {fold.folds ? <ShowMore open={fold.open} hidden={fold.hidden} controls={listId} onToggle={fold.toggle} /> : null}
      </div>
    </section>
  );
}
