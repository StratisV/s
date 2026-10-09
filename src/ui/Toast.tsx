import { createPortal } from 'react-dom';
import { useHome } from '../state/HomeProvider';
import styles from './Toast.module.css';

/** Undo / error toast, floating above the tab bar. Auto-hides after ~4s (see HomeProvider). */
export function Toast() {
  const { toast, phase, onboardingTail } = useHome();
  if (!toast) return null;
  // Setup screens have their main button at the bottom, so the toast drops in from the top there.
  const atTop = phase.kind !== 'ready' || onboardingTail;
  return createPortal(
    <div className={styles.wrap} data-top={atTop || undefined}>
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
