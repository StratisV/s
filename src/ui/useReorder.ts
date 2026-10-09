import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

/**
 * Drag-and-drop and keyboard reordering for an edit-mode list (the Household editor's
 * areas, the housekeeping task list). Each row is a direct child of the list element with
 * `data-reorder-id` set to its id; each row's grip button has `data-grip` set to its id.
 * Drag the grip (the other rows step aside, the page scrolls near its edges, the row glides
 * into its slot on release), or press the up and down arrow keys on it; either way the new
 * order is saved and announced ("Kitchen moved to position 2 of 11.").
 */

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

interface ReorderOptions<T extends { id: string }> {
  /** The rows, in their saved order. */
  rows: T[];
  /** What the announcement calls a row. */
  nameOf(row: T): string;
  /** The list element whose children are the rows. */
  listRef: RefObject<HTMLElement>;
  /** The scroll area the list is in (it scrolls while a row is held near its edges). */
  scrollRef: RefObject<HTMLElement>;
  /** Saves a new order (every id). Failures are the caller's to report. */
  onReorder(orderedIds: string[]): Promise<void>;
}

export interface Reorder {
  /** True while a row is being dragged (or gliding into its slot). */
  dragging: boolean;
  /** The polite announcement of the last move. */
  announcement: string;
  /** Props for row `index`: the drag transform and the attributes its styles key off. */
  rowProps(
    index: number,
    id: string,
  ): {
    'data-reorder-id': string;
    'data-lifted'?: true;
    'data-separator'?: true;
    'data-dropping'?: true;
    style?: CSSProperties;
  };
  /** Props for row `index`'s grip button. */
  gripProps(
    index: number,
    id: string,
  ): {
    'data-grip': string;
    onPointerDown(e: ReactPointerEvent<HTMLButtonElement>): void;
    onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void;
  };
}

const DROP_MS = 200;
const EDGE = 56; // auto-scroll zone near the top and bottom, px

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** `ids` with `id` moved to index `to`. */
export function moved(ids: string[], id: string, to: number): string[] {
  const next = ids.filter((x) => x !== id);
  next.splice(clamp(to, 0, next.length), 0, id);
  return next;
}

export function useReorder<T extends { id: string }>({
  rows,
  nameOf,
  listRef,
  scrollRef,
  onReorder,
}: ReorderOptions<T>): Reorder {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const latest = useRef({ rows, nameOf, onReorder });
  latest.current = { rows, nameOf, onReorder };

  // Stops a drag in progress (listeners, auto-scroll) if the list goes away mid-drag.
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);

  // The grip to focus again once a keyboard move has re-rendered the list.
  const focusGrip = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = focusGrip.current;
    if (!id) return;
    focusGrip.current = null;
    const grip = listRef.current?.querySelector<HTMLElement>(`[data-grip="${id}"]`);
    if (grip && document.activeElement !== grip) grip.focus({ preventScroll: true });
    grip?.scrollIntoView?.({ block: 'nearest' });
  }, [rows, listRef]);

  const save = (id: string, to: number) => {
    const current = latest.current.rows;
    const row = current.find((r) => r.id === id);
    if (!row) return;
    void latest.current
      .onReorder(
        moved(
          current.map((r) => r.id),
          id,
          to,
        ),
      )
      .catch(() => {});
    setAnnouncement(`${latest.current.nameOf(row)} moved to position ${to + 1} of ${current.length}.`);
  };

  // ── Drag ─────────────────────────────────────────────────

  const startDrag = (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (drag || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const listEl = listRef.current;
    const scroller = scrollRef.current;
    if (!listEl || !scroller) return;
    const els = Array.from(listEl.children) as HTMLElement[];
    const from = els.findIndex((r) => r.dataset.reorderId === id);
    if (from < 0) return;
    e.preventDefault();
    const pointerId = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(pointerId);
    } catch {
      /* the window listeners below still work */
    }

    const rects = els.map((r) => r.getBoundingClientRect());
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
          if (to !== from) save(id, to);
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

  // ── Keyboard ─────────────────────────────────────────────

  const onGripKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!delta || drag) return;
    e.preventDefault();
    const to = index + delta;
    if (to < 0 || to >= rows.length) return;
    const row = rows[index];
    focusGrip.current = row.id;
    save(row.id, to);
  };

  return {
    dragging: !!drag,
    announcement,
    rowProps: (index, id) => ({
      'data-reorder-id': id,
      'data-lifted': drag?.id === id || undefined,
      'data-separator': (slotOf(index, id) > 0 && drag?.id !== id) || undefined,
      'data-dropping': (drag?.id === id && drag.dropping) || undefined,
      style: rowStyle(index, id),
    }),
    gripProps: (index, id) => ({
      'data-grip': id,
      onPointerDown: (e) => startDrag(e, id),
      onKeyDown: (e) => onGripKey(e, index),
    }),
  };
}
