import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import styles from './Sheet.module.css';

interface SheetProps {
  title: ReactNode;
  /** Words over the title. */
  eyebrow?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Buttons pinned to the foot of the sheet. */
  footer?: ReactNode;
  /** Label for the close button (default "Close"). */
  closeLabel?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A sheet that rises from the bottom over a dimmed page. Escape, the close button or a tap on
 * the dim closes it; focus stays inside while it is open and goes back where it was after.
 */
export function Sheet({ title, eyebrow, onClose, children, footer, closeLabel = 'Close' }: SheetProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const node = panel.current;
    node?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, []);

  return createPortal(
    <div className={styles.layer}>
      <div className={styles.dim} onClick={() => close.current()} aria-hidden="true" />
      <div
        ref={panel}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className={styles.grabber} aria-hidden="true" />
        <header className={styles.header}>
          <div className={styles.headings}>
            {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
          </div>
          <button type="button" className={styles.close} onClick={() => close.current()} aria-label={closeLabel}>
            <Icon name="close" size={20} />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
