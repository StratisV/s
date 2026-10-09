import { useId } from 'react';
import { RAG_LABEL, RAG_ORDER, RAG_PICK_BG, RAG_RING, RAG_TEXT } from '../../lib/constants';
import type { Rag } from '../../lib/types';
import styles from './RagPicker.module.css';

/** Red / Amber / Green segmented picker: a native radio group styled as three options. */
export function RagPicker({ value, onChange }: { value: Rag; onChange(rag: Rag): void }) {
  const name = useId();
  return (
    <div className={styles.card} role="radiogroup" aria-label="Status">
      {RAG_ORDER.map((rag) => {
        const selected = rag === value;
        return (
          <label
            key={rag}
            className={styles.option}
            data-selected={selected || undefined}
            style={selected ? { background: RAG_PICK_BG[rag], color: RAG_TEXT[rag] } : undefined}
          >
            <input
              type="radio"
              className={styles.input}
              name={name}
              value={rag}
              checked={selected}
              onChange={() => onChange(rag)}
            />
            <span className={styles.dot} style={{ background: RAG_RING[rag] }} aria-hidden="true" />
            {RAG_LABEL[rag]}
          </label>
        );
      })}
    </div>
  );
}
