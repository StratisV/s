import { ActionSheet } from '../../ui/ActionSheet';
import styles from './Housekeeping.module.css';

/** The card with a centred, red Delete Visit under a visit (today's, or a chosen day's). */
export function DeleteVisitButton({ onPress }: { onPress(): void }) {
  return (
    <div className={styles.card}>
      <button type="button" className={styles.deleteButton} aria-haspopup="dialog" onClick={onPress}>
        Delete Visit
      </button>
    </div>
  );
}

interface DeleteVisitSheetProps {
  open: boolean;
  /** "Delete the visit on Thu 1 Oct?", "Delete today's visit?" */
  title: string;
  onConfirm(): void;
  onCancel(): void;
}

/**
 * Asks before a visit is deleted. Kept mounted by the caller beside the visit (not inside
 * it), so it can slide away after the visit has gone.
 */
export function DeleteVisitSheet({ open, title, onConfirm, onCancel }: DeleteVisitSheetProps) {
  return (
    <ActionSheet
      open={open}
      title={title}
      message="Its ticks, comments and price will be deleted for everyone."
      actions={[{ label: 'Delete Visit', destructive: true, onSelect: onConfirm }]}
      onCancel={onCancel}
    />
  );
}
