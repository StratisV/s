import { CheckIcon } from '../../ui/icons';
import styles from './Housekeeping.module.css';

/**
 * "✓ Saved", shown for a moment next to what was saved (the screen's live region says
 * "Saved" for assistive tech, so this is hidden from it).
 */
export function SavedFlag() {
  return (
    <span className={styles.savedFlag} aria-hidden="true" data-saved="">
      <CheckIcon size={11} strokeWidth={3.2} />
      Saved
    </span>
  );
}

interface NotSavedProps {
  /** What didn't save, for the button's name: "the message", "the comments", "the price". */
  what: string;
  onRetry(): void;
}

/**
 * Under a field whose save failed (what was typed stays in it): "Not saved." and Try again.
 * The provider's toast has already said why.
 */
export function NotSaved({ what, onRetry }: NotSavedProps) {
  return (
    <p className={styles.unsaved} data-unsaved="">
      <span>Not saved.</span>{' '}
      <button type="button" className={styles.retry} aria-label={`Try again to save ${what}`} onClick={onRetry}>
        Try again
      </button>
    </p>
  );
}
