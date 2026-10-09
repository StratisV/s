import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './ActionSheet.module.css';

export interface ActionSheetAction {
  label: string;
  destructive?: boolean;
  onSelect(): void;
}

interface ActionSheetProps {
  open: boolean;
  title?: string;
  message?: string;
  actions: ActionSheetAction[];
  cancelLabel?: string;
  onCancel(): void;
}

/**
 * iOS action sheet (confirmations: delete item, discard changes, delete
 * area, sign out). Tapping the backdrop or Cancel calls onCancel.
 *
 * Keyboard: focus starts on Cancel (the least destructive choice), Tab stays
 * inside, Escape cancels, and a held Enter cannot run into an action. When it
 * closes, focus goes back to where it was, unless the chosen action moved it.
 */
export function ActionSheet({ open, title, message, actions, cancelLabel = 'Cancel', onCancel }: ActionSheetProps) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 260);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || !mounted) return;
    const sheet = sheetRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButtonRef.current?.focus({ preventScroll: true });
    const buttons = () => Array.from(sheet?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.repeat) {
        // Auto-repeat from the key that opened the sheet must not confirm it.
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation(); // don't also close a sheet underneath
        cancelRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = buttons();
      if (list.length === 0) return;
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i === list.length - 1 ? 0 : i + 1;
      e.preventDefault();
      list[next].focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      // Back where it was, unless the action already put focus somewhere else.
      const active = document.activeElement;
      const lost = !active || active === document.body || !!sheet?.contains(active);
      if (lost && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, mounted]);

  if (!mounted) return null;
  return createPortal(
    <div className={styles.root} data-shown={shown || undefined}>
      <div className={styles.backdrop} onClick={onCancel} />
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Confirm'}
        aria-describedby={message ? messageId : undefined}
      >
        <div className={styles.group}>
          {title || message ? (
            <div className={styles.header}>
              {title ? (
                <div id={titleId} className={styles.title}>
                  {title}
                </div>
              ) : null}
              {message ? (
                <div id={messageId} className={styles.message}>
                  {message}
                </div>
              ) : null}
            </div>
          ) : null}
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className={styles.action}
              data-destructive={a.destructive || undefined}
              onClick={a.onSelect}
            >
              {a.label}
            </button>
          ))}
        </div>
        <button ref={cancelButtonRef} type="button" className={`${styles.group} ${styles.cancel}`} onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
