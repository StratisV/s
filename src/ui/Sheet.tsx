import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import styles from './Sheet.module.css';

interface SheetProps {
  open: boolean;
  /** X button, swipe down or Escape. The parent decides whether to close (it may confirm first). */
  onRequestClose(): void;
  /** Called after the closing animation finishes. */
  onExited?(): void;
  /** Accessible name of the dialog. */
  label: string;
  children: ReactNode;
}

type Stage = 'closed' | 'entering' | 'open' | 'closing';

const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 0.6; // px per ms

/**
 * iOS page sheet: slides up to --sheet-top with a 38px top radius on
 * #F2F2F7. Swipe down (from the nav, or anywhere while the content is
 * scrolled to the top) to dismiss. Mark the scroll area inside with
 * `data-sheet-scroll` and the nav bar with `data-sheet-handle`.
 *
 * The screen-behind push-back effect is done by App (it scales the stage
 * while a sheet is open).
 */
export function Sheet({ open, onRequestClose, onExited, label, children }: SheetProps) {
  const [stage, setStage] = useState<Stage>(open ? 'entering' : 'closed');
  const [drag, setDrag] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const requestCloseRef = useRef(onRequestClose);
  requestCloseRef.current = onRequestClose;
  const exitedRef = useRef(onExited);
  exitedRef.current = onExited;

  // Drive the enter/exit transitions from `open`.
  useLayoutEffect(() => {
    if (open) {
      setStage((s) => (s === 'open' ? s : 'entering'));
    } else {
      setStage((s) => (s === 'closed' ? s : 'closing'));
    }
  }, [open]);

  useEffect(() => {
    if (stage === 'entering') {
      // Two frames so the off-screen position is painted before transitioning.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setStage('open'));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    if (stage === 'closing') {
      const t = setTimeout(() => {
        setStage('closed');
        setDrag(0);
        exitedRef.current?.();
      }, 460);
      return () => clearTimeout(t);
    }
    if (stage === 'open') {
      // Keep focus that is already inside (e.g. a new item's title focused during the tap,
      // which is what lets iOS open the keyboard); otherwise move it into the dialog.
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    }
  }, [stage]);

  // Escape closes.
  useEffect(() => {
    if (stage !== 'open') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage]);

  // Swipe to dismiss (touch: anywhere when scrolled to top; pointer: handle only).
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || stage !== 'open') return;
    let startY = 0;
    let startT = 0;
    let lastY = 0;
    let lastT = 0;
    let tracking = false;
    let dragging = false;

    const isField = (t: EventTarget | null) =>
      t instanceof Element && !!t.closest('input, textarea, select, [contenteditable="true"]');
    const scrollerAtTop = (t: EventTarget | null) => {
      const scroller = t instanceof Element ? t.closest<HTMLElement>('[data-sheet-scroll]') : null;
      return !scroller || scroller.scrollTop <= 0;
    };
    const finish = () => {
      if (!dragging) {
        tracking = false;
        return;
      }
      const dy = lastY - startY;
      const v = (lastY - startY) / Math.max(1, lastT - startT);
      tracking = false;
      dragging = false;
      panel.dataset.dragging = '';
      delete panel.dataset.dragging;
      if (dy > DISMISS_DISTANCE || (dy > 30 && v > DISMISS_VELOCITY)) requestCloseRef.current();
      setDrag(0);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || isField(e.target)) return;
      tracking = scrollerAtTop(e.target);
      dragging = false;
      startY = lastY = e.touches[0].clientY;
      startT = lastT = e.timeStamp;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!tracking) return;
      const y = e.touches[0].clientY;
      const dy = y - startY;
      if (!dragging) {
        if (dy > 6 && scrollerAtTop(e.target)) {
          dragging = true;
          panel.dataset.dragging = 'true';
        } else if (dy < -6) {
          tracking = false;
          return;
        } else return;
      }
      e.preventDefault();
      lastY = y;
      lastT = e.timeStamp;
      setDrag(Math.max(0, dy));
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      const handle = e.target instanceof Element ? e.target.closest('[data-sheet-handle]') : null;
      if (!handle || (e.target instanceof Element && e.target.closest('button, input, textarea, select'))) return;
      tracking = true;
      dragging = true;
      panel.dataset.dragging = 'true';
      startY = lastY = e.clientY;
      startT = lastT = e.timeStamp;
      const move = (ev: PointerEvent) => {
        lastY = ev.clientY;
        lastT = ev.timeStamp;
        setDrag(Math.max(0, ev.clientY - startY));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        finish();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };

    panel.addEventListener('touchstart', onTouchStart, { passive: true });
    panel.addEventListener('touchmove', onTouchMove, { passive: false });
    panel.addEventListener('touchend', finish);
    panel.addEventListener('touchcancel', finish);
    panel.addEventListener('pointerdown', onPointerDown);
    return () => {
      panel.removeEventListener('touchstart', onTouchStart);
      panel.removeEventListener('touchmove', onTouchMove);
      panel.removeEventListener('touchend', finish);
      panel.removeEventListener('touchcancel', finish);
      panel.removeEventListener('pointerdown', onPointerDown);
    };
  }, [stage]);

  if (stage === 'closed') return null;
  const shown = stage === 'open';

  return (
    <div className={styles.layer}>
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-shown={shown || undefined}
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
