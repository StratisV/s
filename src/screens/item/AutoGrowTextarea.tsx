import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows' | 'value'> & { value: string };

/**
 * A textarea that grows with its text so it reads like plain text (the
 * sheet's title and note). One row when empty.
 */
export const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, Props>(function AutoGrowTextarea({ value, ...rest }, ref) {
  const el = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => el.current!, []);

  const fit = useCallback(() => {
    const node = el.current;
    if (!node) return;
    // Collapsing to measure can clamp the sheet's scroll position; keep it.
    const scroller = node.closest<HTMLElement>('[data-sheet-scroll]');
    const top = scroller?.scrollTop ?? 0;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
    if (scroller && scroller.scrollTop !== top) scroller.scrollTop = top;
  }, []);

  useLayoutEffect(fit, [value, fit]);

  // Re-measure when the width changes (rotation, window resize) and once fonts load.
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let width = node.clientWidth;
    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (node.clientWidth !== width) {
              width = node.clientWidth;
              fit();
            }
          });
    ro?.observe(node);
    let alive = true;
    document.fonts?.ready.then(() => alive && fit()).catch(() => {});
    return () => {
      alive = false;
      ro?.disconnect();
    };
  }, [fit]);

  return <textarea ref={el} rows={1} value={value} {...rest} />;
});
