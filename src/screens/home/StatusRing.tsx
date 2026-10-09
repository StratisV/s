import type { CSSProperties, MouseEvent } from 'react';
import { RAG_RING, RAG_TINT } from '../../lib/constants';
import type { Rag } from '../../lib/types';
import { CheckIcon } from '../../ui/icons';
import styles from './StatusRing.module.css';

interface StatusRingProps {
  rag: Rag;
  /** Filled with its colour and a white check while the item is being completed. */
  done: boolean;
  label: string;
  onClick(event: MouseEvent<HTMLButtonElement>): void;
}

/** The 22px RAG ring at the start of an item row; tapping it marks the item done. */
export function StatusRing({ rag, done, label, onClick }: StatusRingProps) {
  const colours = { '--ring': RAG_RING[rag], '--ring-fill': RAG_TINT[rag] } as CSSProperties;
  return (
    <button
      type="button"
      className={styles.ring}
      style={colours}
      data-done={done || undefined}
      aria-label={label}
      onClick={onClick}
    >
      <CheckIcon className={styles.check} size={14} strokeWidth={3.2} />
    </button>
  );
}
