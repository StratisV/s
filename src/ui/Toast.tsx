import { useCallback, useEffect, useRef, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useHome } from '../state/HomeProvider';
import styles from './Toast.module.css';

/** Fields where Cmd/Ctrl+Z belongs to the text, not to the toast. */
function isTextField(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'].includes(el.type);
}

/**
 * Undo / error toast, floating above the tab bar. Auto-hides after ~4s (see
 * HomeProvider), but not while it has keyboard focus or a pointer over it.
 * The live region is always in the page (empty when idle) so screen readers
 * announce each message. Cmd/Ctrl+Z runs Undo while one is offered.
 */
export function Toast() {
  const { toast, phase, onboardingTail, holdToast } = useHome();
  const regionRef = useRef<HTMLDivElement>(null);
  const holds = useRef({ focus: false, pointer: false });

  const sync = useCallback(() => holdToast(holds.current.focus || holds.current.pointer), [holdToast]);

  // A new toast (or none): the old one's button may have taken focus with it, and a
  // pointer has to move over the new one to hold it.
  const toastId = toast?.id;
  useEffect(() => {
    const region = regionRef.current;
    holds.current.pointer = false;
    holds.current.focus = toastId !== undefined && !!region && region.contains(document.activeElement);
    sync();
  }, [toastId, sync]);

  const undo = toast?.action?.label === 'Undo' ? toast.action : null;
  useEffect(() => {
    if (!undo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.altKey || e.shiftKey || !(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== 'z' || isTextField(document.activeElement)) return;
      e.preventDefault();
      undo.run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  const onPointerMove = (e: PointerEvent) => {
    // A finger lifts straight away; only a hovering mouse or pen holds the toast.
    if (e.pointerType === 'touch' || holds.current.pointer) return;
    holds.current.pointer = true;
    sync();
  };
  const onPointerLeave = () => {
    if (!holds.current.pointer) return;
    holds.current.pointer = false;
    sync();
  };

  // Setup screens have their main button at the bottom, so the toast drops in from the top there.
  const atTop = phase.kind !== 'ready' || onboardingTail;
  return createPortal(
    <div className={styles.wrap} data-top={atTop || undefined}>
      <div
        ref={regionRef}
        className={styles.region}
        role="status"
        aria-live="polite"
        onFocus={() => {
          holds.current.focus = true;
          sync();
        }}
        onBlur={(e) => {
          holds.current.focus = !!e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node);
          sync();
        }}
      >
        {toast ? (
          <div key={toast.id} className={styles.toast} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
            <span className={styles.message}>{toast.message}</span>
            {toast.action ? (
              <button
                type="button"
                className={styles.action}
                onClick={toast.action.run}
                aria-keyshortcuts={undo ? 'Meta+Z Control+Z' : undefined}
              >
                {toast.action.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
