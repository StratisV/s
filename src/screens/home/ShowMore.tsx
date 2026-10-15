import { useContext, useState } from 'react';
import type { Item } from '../../lib/types';
import { ChevronDownIcon } from '../../ui/icons';
import { RevealContext } from './reveal';
import styles from './HomeScreen.module.css';

/**
 * A list that shows its first `preview` rows, then "Show 2 more" for the rest (only when two
 * or more are left: a single row takes no more room than the button). It opens by itself when
 * the item just saved is behind it (RevealContext), so what was saved can always be seen; the
 * person can fold it again straight away.
 */
export function useFold(items: Item[], preview: number) {
  const reveal = useContext(RevealContext);
  const [open, setOpen] = useState(false);
  // The saved item this list last opened for, so it opens once for it, not on every render.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const folds = items.length > preview + 1;
  const behind = folds && reveal !== null && items.slice(preview).some((it) => it.id === reveal);
  if (behind && openedFor !== reveal) {
    // Set while rendering (React's pattern for state that follows props): never drawn folded first.
    setOpenedFor(reveal);
    setOpen(true);
  }
  const shown = !folds || open;
  return {
    folds,
    open: shown,
    rows: shown ? items : items.slice(0, preview),
    hidden: items.length - preview,
    toggle: () => setOpen((o) => !o),
  };
}

interface ShowMoreProps {
  open: boolean;
  /** How many rows are folded away. */
  hidden: number;
  /** The id of the list it opens. */
  controls: string;
  onToggle(): void;
}

/** "Show 6 more" under a folded list, "Show fewer" once it is open; lined up with the titles above it. */
export function ShowMore({ open, hidden, controls, onToggle }: ShowMoreProps) {
  return (
    <button type="button" className={styles.more} aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      {open ? 'Show fewer' : `Show ${hidden} more`}
      <ChevronDownIcon className={styles.moreChevron} size={11} strokeWidth={2.6} />
    </button>
  );
}
