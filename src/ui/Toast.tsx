import { createPortal } from 'react-dom';
import { useHome } from '../state/HomeProvider';
import styles from './Toast.module.css';

/** Undo / error toast, floating above the tab bar. Auto-hides after ~4s (see HomeProvider). */
export function Toast() {
  const { toast } = useHome();
  if (!toast) return null;
  return createPortal(
    <div className={styles.wrap}>
      <div key={toast.id} className={styles.toast} role="status" aria-live="polite">
        <span className={styles.message}>{toast.message}</span>
        {toast.action ? (
          <button type="button" className={styles.action} onClick={toast.action.run}>
            {toast.action.label}
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
