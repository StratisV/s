import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import type { Area } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { ActionSheet } from '../../ui/ActionSheet';
import { GripIcon, MinusCircleIcon, PlusCircleIcon } from '../../ui/icons';
import { InlineText } from './InlineText';
import list from './List.module.css';
import styles from './AreaList.module.css';

interface Drag {
  id: string;
  /** Index the row started at, and the slot it would drop into now. */
  from: number;
  to: number;
  /** Offset of the dragged row from where it started. */
  dy: number;
  /** How far the other rows step aside. */
  step: number;
  /** Released: gliding into its slot before the new order is saved. */
  dropping: boolean;
}

const NEW_AREA = 'New area';
const DROP_MS = 200;
const EDGE = 56; // auto-scroll zone near the top and bottom, px

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function moved(ids: string[], id: string, to: number): string[] {
  const next = ids.filter((x) => x !== id);
  next.splice(clamp(to, 0, next.length), 0, id);
  return next;
}

/**
 * The household's areas, edited in place: rename inline, delete with the
 * red minus (confirmed), reorder by dragging the grip (or arrow keys on it),
 * and "Add Area" at the end.
 */
export function AreaList({ scrollRef }: { scrollRef: RefObject<HTMLDivElement> }) {
  const { data, renameArea, deleteArea, reorderAreas, createArea } = useHousehold();
  const areas = data.areas;
  const hintId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const proxyRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const areasRef = useRef(areas);
  areasRef.current = areas;

  const [drag, setDrag] = useState<Drag | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<{ area: Area; items: number } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Stops a drag in progress (listeners, auto-scroll) if the page goes away mid-drag.
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);

  // Focus to restore after the list re-renders: a moved grip, or a new area's name.
  const focusGrip = useRef<string | null>(null);
  const focusNew = useRef<string | null>(null);

  const focusNewArea = useCallback(() => {
    const id = focusNew.current;
    const input = id ? listRef.current?.querySelector<HTMLInputElement>(`[data-area-input="${id}"]`) : null;
    if (!input) return;
    focusNew.current = null;
    input.focus();
    input.select();
  }, []);

  useLayoutEffect(() => {
    const id = focusGrip.current;
    if (!id) return;
    focusGrip.current = null;
    const grip = listRef.current?.querySelector<HTMLElement>(`[data-grip="${id}"]`);
    if (grip && document.activeElement !== grip) grip.focus({ preventScroll: true });
    grip?.scrollIntoView?.({ block: 'nearest' });
  }, [areas]);

  useEffect(focusNewArea, [areas, focusNewArea]);

  const announceMove = (name: string, to: number, count: number) =>
    setAnnouncement(`${name} moved to position ${to + 1} of ${count}.`);

  // ── Drag to reorder ──────────────────────────────────────

  const startDrag = (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (drag || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const listEl = listRef.current;
    const scroller = scrollRef.current;
    if (!listEl || !scroller) return;
    const rows = Array.from(listEl.children) as HTMLElement[];
    const from = rows.findIndex((r) => r.dataset.areaId === id);
    if (from < 0) return;
    e.preventDefault();
    const pointerId = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(pointerId);
    } catch {
      /* the window listeners below still work */
    }

    const rects = rows.map((r) => r.getBoundingClientRect());
    const centers = rects.map((r) => r.top + r.height / 2);
    const step = rects[from].height;
    const minDy = rects[0].top - rects[from].top;
    const maxDy = rects[rects.length - 1].bottom - rects[from].bottom;
    const startY = e.clientY;
    const startScroll = scroller.scrollTop;
    const topEdge = scroller.getBoundingClientRect().top + parseFloat(getComputedStyle(scroller).paddingTop);
    let pointerY = startY;
    let to = from;
    let raf = 0;

    const update = () => {
      const dy = clamp(pointerY - startY + (scroller.scrollTop - startScroll), minDy, maxDy);
      const center = centers[from] + dy;
      // Rows whose centre the dragged row has passed end up above it. `<=` below
      // the start, so pulling all the way down (clamped onto the last centre) reaches the end.
      to = centers.reduce((n, c, i) => ((i < from && c < center) || (i > from && c <= center) ? n + 1 : n), 0);
      setDrag({ id, from, to, dy, step, dropping: false });
    };

    // Scroll the page while the finger rests near its top or bottom edge.
    const autoScroll = () => {
      const bottomEdge = scroller.getBoundingClientRect().bottom;
      let v = 0;
      if (pointerY < topEdge + EDGE) v = -(topEdge + EDGE - pointerY) / 4;
      else if (pointerY > bottomEdge - EDGE) v = (pointerY - (bottomEdge - EDGE)) / 4;
      if (v) {
        const before = scroller.scrollTop;
        scroller.scrollTop += clamp(v, -16, 16);
        if (scroller.scrollTop !== before) update();
      }
      raf = requestAnimationFrame(autoScroll);
    };
    raf = requestAnimationFrame(autoScroll);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      pointerY = ev.clientY;
      update();
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      endDrag.current = null;
    };
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      stop();
      // Glide into the slot, then save the new order (the optimistic update and
      // clearing the drag land in the same render, so nothing jumps).
      const slot = to > from ? rects[to].bottom - rects[from].bottom : to < from ? rects[to].top - rects[from].top : 0;
      setDrag({ id, from, to, dy: slot, step, dropping: true });
      window.setTimeout(
        () => {
          if (to !== from) {
            const current = areasRef.current;
            const name = current.find((a) => a.id === id)?.name ?? '';
            void reorderAreas(moved(current.map((a) => a.id), id, to)).catch(() => {});
            announceMove(name, to, current.length);
          }
          setDrag(null);
        },
        reducedMotion() ? 0 : DROP_MS,
      );
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    endDrag.current = stop;
    setDrag({ id, from, to: from, dy: 0, step, dropping: false });
  };

  /** Where a row currently shows (0-based), given the drag. */
  const slotOf = (index: number, id: string): number => {
    if (!drag || id === drag.id) return index;
    const { from, to } = drag;
    if (from < to && index > from && index <= to) return index - 1;
    if (from > to && index >= to && index < from) return index + 1;
    return index;
  };

  const rowStyle = (index: number, id: string): CSSProperties | undefined => {
    if (!drag) return undefined;
    if (id === drag.id) return { transform: `translateY(${drag.dy}px)` };
    const shift = slotOf(index, id) - index;
    return shift ? { transform: `translateY(${shift * drag.step}px)` } : undefined;
  };

  // ── Keyboard reorder ─────────────────────────────────────

  const onGripKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!delta || drag) return;
    e.preventDefault();
    const to = index + delta;
    if (to < 0 || to >= areas.length) return;
    const area = areas[index];
    focusGrip.current = area.id;
    void reorderAreas(moved(areas.map((a) => a.id), area.id, to)).catch(() => {});
    announceMove(area.name, to, areas.length);
  };

  // ── Add and delete ───────────────────────────────────────

  const addArea = () => {
    if (adding) return;
    // Focus a stand-in field inside the tap so iOS raises the keyboard; the
    // new area's name takes over the focus once it appears.
    proxyRef.current?.focus({ preventScroll: true });
    setAdding(true);
    createArea(NEW_AREA)
      .then((area) => {
        focusNew.current = area.id;
        focusNewArea();
      })
      .catch(() => {
        if (document.activeElement === proxyRef.current) addRef.current?.focus();
      })
      .finally(() => setAdding(false));
  };

  const askDelete = (area: Area) => {
    setConfirm({ area, items: data.items.filter((i) => i.area_id === area.id).length });
    setConfirmOpen(true);
  };

  const confirmDelete = () => {
    setConfirmOpen(false);
    if (!confirm) return;
    const index = areas.findIndex((a) => a.id === confirm.area.id);
    void deleteArea(confirm.area.id).catch(() => {});
    // Keep keyboard focus nearby: the next row's delete button, or Add Area.
    const nextId = areas[index + 1]?.id ?? areas[index - 1]?.id;
    requestAnimationFrame(() => {
      const next = nextId ? listRef.current?.querySelector<HTMLElement>(`[data-delete="${nextId}"]`) : null;
      (next ?? addRef.current)?.focus({ preventScroll: true });
    });
  };

  return (
    <>
      <div className={list.card}>
        <ul ref={listRef} className={styles.list} data-dragging={drag ? true : undefined}>
          {areas.map((area, index) => (
            <li
              key={area.id}
              data-area-id={area.id}
              className={styles.row}
              data-lifted={drag?.id === area.id || undefined}
              data-separator={(slotOf(index, area.id) > 0 && drag?.id !== area.id) || undefined}
              data-dropping={(drag?.id === area.id && drag.dropping) || undefined}
              style={rowStyle(index, area.id)}
            >
              <button
                type="button"
                className={styles.delete}
                data-delete={area.id}
                aria-label={`Delete ${area.name}`}
                onClick={() => askDelete(area)}
              >
                <MinusCircleIcon size={22} />
              </button>
              <div className={styles.main}>
                <InlineText
                  className={styles.name}
                  data-area-input={area.id}
                  value={area.name}
                  aria-label="Area name"
                  autoCapitalize="words"
                  maxLength={60}
                  onCommit={(name) => void renameArea(area.id, name).catch(() => {})}
                />
                <button
                  type="button"
                  className={styles.grip}
                  data-grip={area.id}
                  aria-label={`Reorder ${area.name}`}
                  aria-describedby={hintId}
                  onPointerDown={(e) => startDrag(e, area.id)}
                  onKeyDown={(e) => onGripKey(e, index)}
                >
                  <GripIcon size={22} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <button
          ref={addRef}
          type="button"
          className={styles.add}
          data-first={areas.length === 0 || undefined}
          onClick={addArea}
          aria-busy={adding || undefined}
        >
          <PlusCircleIcon size={22} />
          <span className={styles.addLabel}>Add Area</span>
        </button>
        {/* Not read-only: iOS only raises the keyboard for an editable field. */}
        <input ref={proxyRef} className="visually-hidden" tabIndex={-1} aria-hidden="true" autoComplete="off" />
      </div>
      <span id={hintId} className="visually-hidden">
        Drag, or use the up and down arrow keys, to move this area.
      </span>
      <div className="visually-hidden" aria-live="polite">
        {announcement}
      </div>

      <ActionSheet
        open={confirmOpen}
        title={confirm ? `Delete ${confirm.area.name}?` : undefined}
        message={
          confirm && confirm.items > 0
            ? `Its ${confirm.items} ${confirm.items === 1 ? 'item' : 'items'} will be deleted too.`
            : undefined
        }
        actions={[{ label: 'Delete Area', destructive: true, onSelect: confirmDelete }]}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
