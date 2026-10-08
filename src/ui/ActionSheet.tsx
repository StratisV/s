import { useEffect, useState } from 'react';
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
 */
export function ActionSheet({ open, title, message, actions, cancelLabel = 'Cancel', onCancel }: ActionSheetProps) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

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
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!mounted) return null;
  return createPortal(
    <div className={styles.root} data-shown={shown || undefined}>
      <div className={styles.backdrop} onClick={onCancel} />
      <div className={styles.sheet} role="alertdialog" aria-modal="true" aria-label={title ?? 'Confirm'}>
        <div className={styles.group}>
          {title || message ? (
            <div className={styles.header}>
              {title ? <div className={styles.title}>{title}</div> : null}
              {message ? <div className={styles.message}>{message}</div> : null}
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
        <button type="button" className={`${styles.group} ${styles.cancel}`} onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
