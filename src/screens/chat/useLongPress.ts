import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

/** How long a press must last to open the message menu. */
export const LONG_PRESS_MS = 450;
/** A finger that moves further than this is scrolling, not pressing. */
const MOVE_TOLERANCE = 8;

/**
 * Long-press (touch, pen or mouse) and right-click / the context-menu
 * gesture call `onLongPress`. The click that ends a long press is swallowed.
 */
export function useLongPress(onLongPress: () => void, ms = LONG_PRESS_MS) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const callback = useRef(onLongPress);
  callback.current = onLongPress;

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    origin.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return;
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        origin.current = null;
        fired.current = true;
        navigator.vibrate?.(10);
        callback.current();
      }, ms);
    },
    [ms],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const o = origin.current;
      if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > MOVE_TOLERANCE) cancel();
    },
    [cancel],
  );

  const onContextMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      cancel();
      // A touch long-press also raises contextmenu on some browsers: open once.
      if (fired.current) return;
      fired.current = true;
      callback.current();
    },
    [cancel],
  );

  const onClickCapture = useCallback((e: MouseEvent) => {
    if (!fired.current) return;
    fired.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu,
    onClickCapture,
  };
}
