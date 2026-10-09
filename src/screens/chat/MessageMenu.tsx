import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { QUICK_REACTIONS, REACTION_EMOJIS } from '../../lib/constants';
import { PlusIcon } from '../../ui/icons';
import { CopyIcon, RetryIcon, TrashIcon } from './icons';
import { Bubble } from './MessageRow';
import styles from './MessageMenu.module.css';

export interface MenuAction {
  label: string;
  icon: 'copy' | 'delete' | 'retry';
  destructive?: boolean;
  run(): void;
}

interface MessageMenuProps {
  body: string;
  mine: boolean;
  /** Where the bubble is on screen (the lifted copy starts there). */
  anchor: DOMRect;
  /** Reactions offered (stored messages only). */
  reactions: boolean;
  /** Emoji you already reacted with (shown selected). */
  myReactions: string[];
  onReact(emoji: string): void;
  actions: MenuAction[];
  onClose(): void;
  /** Where focus goes back when the menu closes. */
  returnFocus: HTMLElement | null;
}

interface Layout {
  cloneTop: number;
  cloneHeight: number;
  /** How far the copy moved from the bubble (it slides there). */
  shift: number;
  barTop: number;
  barLeft: number;
  menuTop: number;
  menuLeft: number;
}

const GAP = 8;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

const ICONS = { copy: CopyIcon, delete: TrashIcon, retry: RetryIcon };

/**
 * The long-press menu (iOS tapback style): a dimmed, blurred backdrop, a
 * lifted copy of the bubble, the reaction bar above it (six quick reactions
 * and + for the full grid) and a small menu below. Escape or a tap outside
 * closes it; focus stays inside while it is open.
 */
export function MessageMenu({
  body,
  mine,
  anchor,
  reactions,
  myReactions,
  onReact,
  actions,
  onClose,
  returnFocus,
}: MessageMenuProps) {
  const [grid, setGrid] = useState(false);
  const [layout, setLayout] = useState<Layout | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const downOnBackdrop = useRef(false);

  // Place the bar, the copy and the menu around the bubble, kept on screen.
  useLayoutEffect(() => {
    const frame = frameRef.current?.getBoundingClientRect();
    if (!frame) return;
    const bar = barRef.current;
    const menu = menuRef.current;
    const barH = bar ? bar.offsetHeight : 0;
    const barW = bar ? bar.offsetWidth : 0;
    const menuH = menu ? menu.offsetHeight : 0;
    const menuW = menu ? menu.offsetWidth : 0;
    const above = barH ? barH + GAP : 0;
    const below = menuH ? menuH + GAP : 0;
    const cloneHeight = Math.max(36, Math.min(anchor.height, frame.height - above - below));
    const cloneTop = clamp(anchor.top, frame.top + above, frame.bottom - below - cloneHeight);
    const alignX = (w: number) =>
      mine ? clamp(anchor.right - w, frame.left, frame.right - w) : clamp(anchor.left, frame.left, frame.right - w);
    setLayout((prev) => ({
      cloneTop,
      cloneHeight,
      shift: prev ? prev.shift : anchor.top - cloneTop,
      barTop: cloneTop - above,
      barLeft: alignX(barW),
      menuTop: cloneTop + cloneHeight + GAP,
      menuLeft: alignX(menuW),
    }));
  }, [anchor, mine, grid]);

  // Focus: the first reaction (or menu item) once placed (hidden things can't take focus),
  // the first emoji of the grid when it opens.
  const placed = layout !== null;
  useEffect(() => {
    if (!placed) return;
    const root = rootRef.current;
    const first = root?.querySelector<HTMLElement>(grid ? '[data-grid] button' : 'button');
    first?.focus({ preventScroll: true });
  }, [grid, placed]);

  // Focus goes back to the bubble when the menu goes.
  useEffect(() => {
    return () => {
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, [returnFocus]);

  // Escape closes; Tab stays inside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('button') ?? []);
      if (!list.length) return;
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i === list.length - 1 ? 0 : i + 1;
      e.preventDefault();
      list[next].focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  /** Arrow keys move along the reaction bar or around the grid. */
  const onArrows = (e: ReactKeyboardEvent<HTMLElement>, columns: number) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[e.key];
    if (!step) return;
    const list = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button'));
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const next = list[i + step];
    if (!next) return;
    e.preventDefault();
    next.focus();
  };

  const mineSet = new Set(myReactions);
  const reactionButton = (emoji: string) => (
    <button
      key={emoji}
      type="button"
      className={styles.emoji}
      aria-pressed={mineSet.has(emoji)}
      aria-label={`React with ${emoji}`}
      onClick={() => onReact(emoji)}
    >
      <span aria-hidden="true">{emoji}</span>
    </button>
  );

  return createPortal(
    <div
      ref={rootRef}
      className={styles.root}
      role="dialog"
      aria-modal="true"
      aria-label="Message actions"
      data-placed={layout ? '' : undefined}
    >
      <div
        className={styles.backdrop}
        onPointerDown={() => {
          downOnBackdrop.current = true;
        }}
        onClick={() => {
          // Only a tap that started here: the finger lifting after a long press doesn't count.
          if (downOnBackdrop.current) closeRef.current();
          downOnBackdrop.current = false;
        }}
      />
      <div ref={frameRef} className={styles.frame} aria-hidden="true" />

      <div
        className={styles.clone}
        style={{
          top: layout?.cloneTop ?? anchor.top,
          left: anchor.left,
          width: anchor.width,
          height: layout?.cloneHeight ?? anchor.height,
          ['--shift' as string]: `${layout?.shift ?? 0}px`,
        }}
        aria-hidden="true"
      >
        <Bubble mine={mine} className={styles.cloneBubble}>
          {body}
        </Bubble>
      </div>

      {reactions ? (
        <div
          ref={barRef}
          className={`${styles.glass} ${grid ? styles.grid : styles.bar}`}
          style={{ top: layout?.barTop ?? 0, left: layout?.barLeft ?? 0 }}
          data-mine={mine || undefined}
          data-grid={grid || undefined}
          role="group"
          aria-label={grid ? 'All reactions' : 'Reactions'}
          onKeyDown={(e) => onArrows(e, grid ? 8 : 99)}
        >
          {grid ? (
            REACTION_EMOJIS.map(reactionButton)
          ) : (
            <>
              {QUICK_REACTIONS.map(reactionButton)}
              <button
                type="button"
                className={styles.more}
                aria-label="More reactions"
                aria-expanded={false}
                onClick={() => setGrid(true)}
              >
                <PlusIcon size={22} strokeWidth={2.4} />
              </button>
            </>
          )}
        </div>
      ) : null}

      <div
        ref={menuRef}
        className={styles.menu}
        style={{ top: layout?.menuTop ?? 0, left: layout?.menuLeft ?? 0 }}
        data-mine={mine || undefined}
        role="group"
        aria-label="Message"
      >
        {actions.map((a) => {
          const Icon = ICONS[a.icon];
          return (
            <button
              key={a.label}
              type="button"
              className={styles.item}
              data-destructive={a.destructive || undefined}
              onClick={a.run}
            >
              <span>{a.label}</span>
              <Icon size={20} />
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
