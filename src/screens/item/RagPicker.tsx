import { useId } from 'react';
import { RAG_ORDER, ragWord } from '../../lib/constants';
import type { ItemKind, Rag } from '../../lib/types';
import { CheckIcon } from '../../ui/icons';
import styles from './RagPicker.module.css';

/** What each choice means, under its word. */
const HINT: Record<ItemKind, Record<Rag, string>> = {
  task: { red: 'Needs doing now', amber: 'Some time in the next few weeks', green: 'Whenever there is time' },
  state: { red: 'Needs work soon', amber: 'Could do with some care', green: 'Just as it should be' },
};

/**
 * The colour of an item, said in words: for a To do, how urgent it is (Urgent, Within the
 * month, Not urgent); for a To maintain item, its condition (Poor, Fair, Good). A native radio
 * group drawn as a list of three, each with its dot, its word and what it means; the chosen
 * one is washed in its colour with a check.
 */
export function RagPicker({ value, kind = 'task', onChange }: { value: Rag; kind?: ItemKind; onChange(rag: Rag): void }) {
  const name = useId();
  const headingId = useId();
  return (
    <div className={styles.group}>
      <span id={headingId} className={styles.heading}>
        {kind === 'state' ? 'Condition' : 'How urgent?'}
      </span>
      <div className={styles.card} role="radiogroup" aria-labelledby={headingId}>
        {RAG_ORDER.map((rag) => {
          const selected = rag === value;
          const word = ragWord(kind, rag);
          return (
            <label key={rag} className={styles.option} data-rag={rag} data-selected={selected || undefined}>
              <input
                type="radio"
                className={styles.input}
                name={name}
                value={rag}
                checked={selected}
                // Named by its word; what it means is its description.
                aria-label={word}
                aria-describedby={`${name}-${rag}`}
                onChange={() => onChange(rag)}
              />
              <span className={styles.dot} aria-hidden="true" />
              <span className={styles.words} aria-hidden="true">
                <span className={styles.word}>{word}</span>
                <span id={`${name}-${rag}`} className={styles.hint}>
                  {HINT[kind][rag]}
                </span>
              </span>
              <CheckIcon className={styles.check} size={20} strokeWidth={2.7} />
            </label>
          );
        })}
      </div>
    </div>
  );
}
