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

// ─────────────────────────────────────────────────────────────────────────────
// Grouped: items in several lists at once (the housekeeping tasks, section by section), or
// whole cards (the sections themselves)
// ─────────────────────────────────────────────────────────────────────────────

/** One list of a grouped reorder: the tasks in one section, or in none. */
export interface ReorderGroup {
  /** What onReorder gives it back as, and what endProps() takes. */
  id: string;
  /** What a move into it is announced with ("moved to Kitchen, position 2 of 3"); null: by position only. */
  name: string | null;
  /** Its items, in order. */
  ids: string[];
}

/** An arrangement as onReorder gets it: every group, with its items in order. */
export type ReorderArrangement = { id: string; ids: string[] }[];

/** A place in the groups: group `group`, before its item `index` (counted without the moving one). */
export interface ReorderSlot {
  group: number;
  index: number;
}

interface GroupedReorderOptions {
  /**
   * Names this reorder's attributes, so two can share a page (the sections, and the tasks in
   * them): items carry data-reorder-scope and data-reorder-id, the row after each group's
   * last item (Add Task) data-reorder-end, and grips data-grip and data-grip-scope.
   */
  scope: string;
  groups: ReorderGroup[];
  /** What the announcement calls an item. */
  nameOf(id: string): string;
  /** The element the items and the groups' ends are in. */
  rootRef: RefObject<HTMLElement>;
  /** The scroll area it is in (it scrolls while an item is held near its edges). */
  scrollRef: RefObject<HTMLElement>;
  /** Saves a new arrangement. Failures are the caller's to report. */
  onReorder(arrangement: ReorderArrangement): Promise<void>;
  /**
   * The part of an item that is picked up and carried (a section's header, found inside the
   * item); the whole item when absent. The rest folds away while it is carried, and unfolds
   * again where it lands.
   */
  liftSelector?: string;
  /** The carried part's corner radius, px. */
  liftRadius?: number;
}

export interface GroupedReorder {
  /** True while an item is carried (or gliding into its slot). */
  dragging: boolean;
  /** The polite announcement of the last move. */
  announcement: string;
  /** Props for an item: what finds it, and while dragging how it folds away or makes room. */
  itemProps(id: string): ItemProps;
  /** Props for the row after a group's last item: it makes room for a drop at the group's end. */
  endProps(groupId: string): EndProps;
  /** Props for an item's grip: drag it, or press the up and down arrow keys on it. */
  gripProps(id: string): {
    'data-grip': string;
    'data-grip-scope': string;
    onPointerDown(e: ReactPointerEvent<HTMLButtonElement>): void;
    onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void;
  };
  /** Moves an item without a drag (a menu): into `groupId` at `index` (its end when absent), saved and announced. */
  move(id: string, groupId: string, index?: number): void;
}

type Room = {
  /** The slot opens here, above this element: a soft placeholder in the room (styled by the page). */
  'data-drop'?: true;
  style?: CSSProperties;
};

type ItemProps = Room & {
  'data-reorder-scope': string;
  'data-reorder-id': string;
  /** The item being carried, folded away where it was. */
  'data-carried'?: true;
};

type EndProps = Room & {
  'data-reorder-scope': string;
  'data-reorder-end': string;
};

interface Carry {
  id: string;
  from: ReorderSlot;
  to: ReorderSlot;
  /** The room a slot opens, px: the carried part's height, with the space above it in its item. */
  gap: number;
  /** How far the carried part sits below its item's top, px. */
  lift: number;
  /** The item's height before it folded away, px. */
  height: number;
  /** Folded away (from the frame after it was picked up): the room opens as it closes, in step. */
  folded: boolean;
}

interface Landing {
  id: string;
  /** From the carried part's room to the item's whole height, px. */
  from: number;
  to: number;
  open: boolean;
}

interface Ghost {
  /** Follows the finger: `dy` px from where it was picked up. */
  move(dy: number): void;
  /** Glides `dy` px from where it was picked up, and settles there, over `ms`. */
  land(dy: number, ms: number): void;
  remove(): void;
}

const MOVE_MS = 220;
const UNFOLD_MS = 320;
const EASE = 'var(--sheet-ease)';

/** Where `id` is in `groups`. */
function slotOf(groups: { ids: string[] }[], id: string): ReorderSlot | null {
  for (let group = 0; group < groups.length; group += 1) {
    const index = groups[group].ids.indexOf(id);
    if (index >= 0) return { group, index };
  }
  return null;
}

/** `groups` with `id` taken out and put into group `to.group` at `to.index` (counted without it). */
export function movedAcross(groups: { id: string; ids: string[] }[], id: string, to: ReorderSlot): ReorderArrangement {
  const next = groups.map((g) => ({ id: g.id, ids: g.ids.filter((x) => x !== id) }));
  const target = next[to.group];
  if (target) target.ids.splice(clamp(to.index, 0, target.ids.length), 0, id);
  return next;
}

/** A picture of the part being carried, over everything, that follows the finger. */
function makeGhost(part: HTMLElement, rect: DOMRect, radius: number): Ghost {
  const ghost = document.createElement('div');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.dataset.reorderGhost = '';
  // Nothing in the picture can be focused or found: fields become their text.
  const copy = part.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  copy.removeAttribute('style');
  copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  const fields = part.querySelectorAll<HTMLInputElement>('input, textarea');
  copy.querySelectorAll('input, textarea').forEach((el, i) => {
    const text = document.createElement('span');
    text.className = el.className;
    text.textContent = fields[i]?.value ?? '';
    Object.assign(text.style, { display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden' });
    el.replaceWith(text);
  });
  copy.querySelectorAll('button, a, [tabindex]').forEach((el) => el.setAttribute('tabindex', '-1'));
  ghost.appendChild(copy);
  const still = reducedMotion();
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    zIndex: '60',
    pointerEvents: 'none',
    borderRadius: `${radius}px`,
    overflow: 'hidden',
    background: 'var(--card)',
    boxShadow: 'var(--shadow-lift)',
    translate: '0 0',
    scale: '1',
    transition: still ? 'none' : `scale 0.18s ${EASE}`,
    willChange: 'translate',
  });
  document.body.appendChild(ghost);
  // Lifted: a touch bigger, as iOS lifts a row.
  if (!still) requestAnimationFrame(() => (ghost.style.scale = '1.03'));
  return {
    move: (dy) => {
      ghost.style.translate = `0 ${dy}px`;
    },
    land: (dy, ms) => {
      ghost.style.transition = ms
        ? `translate ${ms}ms ${EASE}, scale ${ms}ms ${EASE}, box-shadow ${ms}ms ease`
        : 'none';
      ghost.style.translate = `0 ${dy}px`;
      ghost.style.scale = '1';
      ghost.style.boxShadow = 'none';
    },
    remove: () => ghost.remove(),
  };
}

/**
 * Drag-and-drop and keyboard reordering across several lists at once: the housekeeping tasks,
 * section by section (an item moves within its list or into another), or the sections
 * themselves (one list of cards, each carried by its header). Hold the grip: a picture of the
 * item (or of its header) lifts and follows the finger, the item folds away where it was, and
 * the others step aside to open a slot where it would land, a soft placeholder in it; the
 * page scrolls near its edges; on release it glides into the slot, and the new order is saved
 * and announced ("Clean the oven moved to Kitchen, position 2 of 3."). Escape puts it back.
 * The up and down arrow keys on the grip move it one place, into the list before or after at
 * either end. move() does the same for a menu (Move to Section).
 */
export function useGroupedReorder({
  scope,
  groups,
  nameOf,
  rootRef,
  scrollRef,
  onReorder,
  liftSelector,
  liftRadius = 14,
}: GroupedReorderOptions): GroupedReorder {
  const [carry, setCarry] = useState<Carry | null>(null);
  const [landing, setLanding] = useState<Landing | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const latest = useRef({ groups, nameOf, onReorder });
  latest.current = { groups, nameOf, onReorder };
  /** A drag (or its drop) is under way: no second one, and no key moves. */
  const busy = useRef(false);
  const ghostRef = useRef<Ghost | null>(null);

  // Stops a drag in progress (listeners, auto-scroll, its picture) if the lists go away
  // mid-drag, or while the picture glides into its slot.
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      endDrag.current?.();
      ghostRef.current?.remove();
      ghostRef.current = null;
    },
    [],
  );

  // The picture goes in the same frame as the drop shows in the lists.
  useLayoutEffect(() => {
    if (carry || !ghostRef.current) return;
    ghostRef.current.remove();
    ghostRef.current = null;
  }, [carry]);

  // The grip to focus again once a keyboard move has re-rendered the lists.
  const focusGrip = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = focusGrip.current;
    if (!id) return;
    focusGrip.current = null;
    const grip = rootRef.current?.querySelector<HTMLElement>(`[data-grip-scope="${scope}"][data-grip="${id}"]`);
    if (grip && document.activeElement !== grip) grip.focus({ preventScroll: true });
    grip?.scrollIntoView?.({ block: 'nearest' });
  }, [groups, rootRef, scope]);

  // Picked up: it folds away from the next frame, as its slot opens, the two in step.
  useEffect(() => {
    if (!carry || carry.folded) return;
    const raf = requestAnimationFrame(() => setCarry((c) => (c && c.id === carry.id ? { ...c, folded: true } : c)));
    return () => cancelAnimationFrame(raf);
  }, [carry]);

  // Landed, carried by its header: it unfolds from the header's room to its whole height.
  useEffect(() => {
    if (!landing) return;
    if (!landing.open) {
      const raf = requestAnimationFrame(() => setLanding((l) => (l && l.id === landing.id ? { ...l, open: true } : l)));
      return () => cancelAnimationFrame(raf);
    }
    const timer = window.setTimeout(() => setLanding((l) => (l && l.id === landing.id ? null : l)), UNFOLD_MS);
    return () => clearTimeout(timer);
  }, [landing]);

  /** Saves `id` moved to `to`, and says where it went. */
  const save = (id: string, to: ReorderSlot) => {
    const { groups: current, nameOf: name } = latest.current;
    const from = slotOf(current, id);
    const target = current[to.group];
    if (!from || !target) return;
    const next = movedAcross(current, id, to);
    const ids = next[to.group].ids;
    const place = `position ${ids.indexOf(id) + 1} of ${ids.length}`;
    void latest.current.onReorder(next).catch(() => {});
    setAnnouncement(
      from.group === to.group || !target.name
        ? `${name(id)} moved to ${place}.`
        : `${name(id)} moved to ${target.name}, ${place}.`,
    );
  };

  // ── Drag ─────────────────────────────────────────────────

  const startDrag = (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (busy.current || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const root = rootRef.current;
    const scroller = scrollRef.current;
    const from = slotOf(latest.current.groups, id);
    if (!root || !scroller || !from) return;
    const find = (attr: string, value: string) =>
      root.querySelector<HTMLElement>(`[data-reorder-scope="${scope}"][${attr}="${value}"]`);
    const item = find('data-reorder-id', id);
    if (!item) return;
    const part = (liftSelector ? item.querySelector<HTMLElement>(liftSelector) : null) ?? item;
    e.preventDefault();
    const pointerId = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(pointerId);
    } catch {
      /* the window listeners below still work */
    }

    // The lists as they stand without the item (it folds away), in the scroll area's content
    // coordinates: where each slot would open.
    const box = scroller.getBoundingClientRect();
    const startScroll = scroller.scrollTop;
    const content = (y: number) => y - box.top + startScroll;
    const itemRect = item.getBoundingClientRect();
    const partRect = part.getBoundingClientRect();
    const itemTop = content(itemRect.top);
    const height = itemRect.height;
    const lift = partRect.top - itemRect.top;
    const gap = lift + partRect.height;
    const without = (top: number) => (top > itemTop + 0.5 ? top - height : top);
    const topOf = (el: HTMLElement | null) => (el ? without(content(el.getBoundingClientRect().top)) : NaN);
    const slots = latest.current.groups.map((group) => [
      ...group.ids.filter((x) => x !== id).map((x) => topOf(find('data-reorder-id', x))),
      topOf(find('data-reorder-end', group.id)),
    ]);
    // The carried part's centre over each slot, and where it starts.
    const half = partRect.height / 2;
    const centres = slots.map((tops) => tops.map((top) => top + lift + half));
    const start = itemTop + lift + half;
    const reachable = centres.flat().filter((c) => !Number.isNaN(c));
    const lowest = Math.min(start, ...reachable) - start;
    const highest = Math.max(start, ...reachable) - start;

    const ghost = makeGhost(part, partRect, liftRadius);
    ghostRef.current?.remove();
    ghostRef.current = ghost;
    const startY = e.clientY;
    let pointerY = startY;
    let to = from;
    let raf = 0;
    let dropped = false;

    const update = () => {
      const scrolled = scroller.scrollTop - startScroll;
      const dy = clamp(pointerY - startY + scrolled, lowest, highest);
      const centre = start + dy;
      let best = to;
      let nearest = Infinity;
      centres.forEach((row, group) =>
        row.forEach((c, index) => {
          const d = Math.abs(c - centre);
          if (d < nearest) {
            nearest = d;
            best = { group, index };
          }
        }),
      );
      // Drawn under the finger (kept to the lists), whatever the scroll.
      ghost.move(dy - scrolled);
      if (best.group !== to.group || best.index !== to.index) {
        to = best;
        setCarry((c) => (c && c.id === id ? { ...c, to: best } : c));
      }
    };

    // Scroll the page while the finger rests near its top or bottom edge.
    const topEdge = box.top + parseFloat(getComputedStyle(scroller).paddingTop || '0');
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
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey, true);
      endDrag.current = null;
    };
    const drop = (slot: ReorderSlot) => {
      if (dropped) return;
      dropped = true;
      stop();
      const still = reducedMotion();
      // Glide into the slot, as the lists stand once it has opened; then save, and the item
      // shows there in the same frame as the picture goes.
      const top = (slots[slot.group]?.[slot.index] ?? NaN) + lift;
      const landAt = Number.isNaN(top) ? 0 : top - scroller.scrollTop + box.top - partRect.top;
      ghost.land(landAt, still ? 0 : DROP_MS);
      setCarry((c) => (c && c.id === id ? { ...c, to: slot } : c));
      window.setTimeout(
        () => {
          if (slot.group !== from.group || slot.index !== from.index) save(id, slot);
          // Carried by its header: it unfolds again where it landed.
          if (gap < height - 0.5 && !still) setLanding({ id, from: gap, to: height, open: false });
          busy.current = false;
          setCarry(null);
        },
        still ? 0 : DROP_MS,
      );
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) drop(to);
    };
    // Escape puts it back where it was.
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      drop(from);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey, true);
    endDrag.current = () => {
      stop();
      ghost.remove();
    };
    busy.current = true;
    setLanding(null);
    setCarry({ id, from, to: from, gap, lift, height, folded: false });
  };

  // ── Keys and menus ───────────────────────────────────────

  const onGripKey = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!delta || busy.current) return;
    e.preventDefault();
    const current = latest.current.groups;
    const at = slotOf(current, id);
    if (!at) return;
    const last = current[at.group].ids.length - 1;
    // One place up or down; at either end of a list, into the list before or after it.
    const to: ReorderSlot | null =
      delta < 0
        ? at.index > 0
          ? { group: at.group, index: at.index - 1 }
          : at.group > 0
            ? { group: at.group - 1, index: current[at.group - 1].ids.length }
            : null
        : at.index < last
          ? { group: at.group, index: at.index + 1 }
          : at.group < current.length - 1
            ? { group: at.group + 1, index: 0 }
            : null;
    if (!to) return;
    focusGrip.current = id;
    save(id, to);
  };

  const move = (id: string, groupId: string, index?: number) => {
    const current = latest.current.groups;
    const group = current.findIndex((g) => g.id === groupId);
    const at = slotOf(current, id);
    if (group < 0 || !at || busy.current) return;
    const size = current[group].ids.filter((x) => x !== id).length;
    const to = { group, index: index === undefined ? size : clamp(index, 0, size) };
    if (to.group === at.group && to.index === at.index) return;
    save(id, to);
  };

  // ── What the lists render ────────────────────────────────

  // Where the slot opens: above the item now at the slot (the moving one left out), or above
  // the group's end row for a drop at its end.
  const opens = (() => {
    if (!carry || !carry.folded) return null;
    const group = groups[carry.to.group];
    if (!group) return null;
    const ids = group.ids.filter((x) => x !== carry.id);
    return carry.to.index < ids.length ? { item: ids[carry.to.index] } : { end: group.id };
  })();
  const still = carry ? reducedMotion() : false;
  const room = (here: boolean): Room => {
    if (!carry) return {};
    const transition = still ? undefined : `margin-top ${MOVE_MS}ms ${EASE}`;
    if (!here) return { style: { transition } };
    return {
      'data-drop': true,
      style: {
        marginTop: carry.gap,
        transition,
        ['--reorder-gap' as string]: `${carry.gap}px`,
        ['--reorder-lift' as string]: `${carry.lift}px`,
      },
    };
  };

  return {
    dragging: !!carry,
    announcement,
    itemProps: (id) => {
      const base = { 'data-reorder-scope': scope, 'data-reorder-id': id };
      if (landing?.id === id) {
        return {
          ...base,
          style: {
            height: landing.open ? landing.to : landing.from,
            minHeight: 0,
            overflow: 'hidden',
            transition: landing.open ? `height ${UNFOLD_MS}ms ${EASE}` : undefined,
          },
        };
      }
      if (carry?.id === id) {
        return {
          ...base,
          'data-carried': true,
          style: {
            height: carry.folded ? 0 : carry.height,
            minHeight: 0,
            opacity: carry.folded ? 0 : 1,
            overflow: 'hidden',
            pointerEvents: 'none',
            transition: still ? undefined : `height ${MOVE_MS}ms ${EASE}, opacity 0.16s ease`,
          },
        };
      }
      return { ...base, ...room(opens?.item === id) };
    },
    endProps: (groupId) => ({
      'data-reorder-scope': scope,
      'data-reorder-end': groupId,
      ...room(opens?.end === groupId),
    }),
    gripProps: (id) => ({
      'data-grip': id,
      'data-grip-scope': scope,
      onPointerDown: (e) => startDrag(e, id),
      onKeyDown: (e) => onGripKey(e, id),
    }),
    move,
  };
}
