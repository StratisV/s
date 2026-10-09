import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { RAG_LABEL } from '../../lib/constants';
import type { Item } from '../../lib/types';
import { useConfetti } from '../../ui/Confetti';
import { inCollapsedArea } from './areaPanel';
import { StatusDot, StatusRing } from './StatusRing';
import styles from './ItemRow.module.css';

/** How long the filled ring and check show before the row completes. */
export const COMPLETE_FEEDBACK_MS = 250;
/** A repeating item stays in the list: ignore taps a little longer so a slow double tap counts once. */
const REPEAT_COOLDOWN_MS = 450;

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false; // engines without :focus-visible
  }
}

interface ItemRowProps {
  item: Item;
  /**
   * From itemMeta(): `🦆 Shea`, and `Tue 20 Oct` / `Missed · Tue 6 Oct` / null, or for a
   * state (To maintain) `Updated Tue 6 Oct`.
   */
  meta: { who: string; date: string | null; missed: boolean };
  onOpen(itemId: string): void;
  onComplete(itemId: string): Promise<void> | void;
}

/**
 * A Home row, two lines tall: status ring, then the title, and under it the meta
 * with the note after it (`🦆 Shea · Tue 20 Oct · Order a new pack.`), each cut
 * to one line. The ring completes the item; anywhere else on the row opens it.
 * A state (To maintain) has a solid dot instead of the ring: it is never completed, and
 * the whole row opens it.
 */
export function ItemRow({ item, meta, onOpen, onComplete }: ItemRowProps) {
  const fire = useConfetti();
  const [completing, setCompleting] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const openRef = useRef<HTMLButtonElement>(null);
  // The timer outlives a quick tab switch, so it always calls the latest callback.
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const complete = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy.current) return;
    busy.current = true;
    const ring = event.currentTarget;
    fire(ring);
    navigator.vibrate?.(10);
    setCompleting(true);

    // Only keyboard focus is worth keeping: a tap must not scroll the list to the next row.
    const keyboard = isFocusVisible(ring);

    setTimeout(() => {
      // A one-off item leaves the list: move keyboard focus to the nearest remaining row
      // (rows in a collapsed area can't take it), else to the area's name.
      const own = openRef.current;
      if (item.repeat === 'none' && keyboard && document.activeElement === ring && own) {
        const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-item-open]')).filter(
          (el) => el === own || !inCollapsedArea(el),
        );
        const i = rows.indexOf(own);
        const next = rows[i + 1] ?? rows[i - 1] ?? own.closest('section')?.querySelector<HTMLElement>('button[aria-expanded]');
        next?.focus();
      }
      const pending = completeRef.current(item.id);
      if (mounted.current) setCompleting(false);
      Promise.resolve(pending)
        .catch(() => {
          /* the provider already shows an error toast */
        })
        .finally(() => {
          setTimeout(() => {
            busy.current = false;
          }, REPEAT_COOLDOWN_MS);
        });
    }, COMPLETE_FEEDBACK_MS);
  };

  const maintained = item.kind === 'state';
  // The status is only a colour on screen; assistive tech hears it (and the kind) after the title.
  const spoken = maintained ? `, ${RAG_LABEL[item.rag]}, to maintain.` : `, ${RAG_LABEL[item.rag]}.`;

  return (
    <li className={styles.row} data-kind={item.kind}>
      {maintained ? (
        <StatusDot rag={item.rag} />
      ) : (
        <StatusRing rag={item.rag} done={completing} label={`Mark ${item.title} as done`} onClick={complete} />
      )}
      <button
        ref={openRef}
        type="button"
        className={styles.open}
        data-item-open=""
        onClick={() => {
          if (!busy.current) onOpen(item.id);
        }}
      >
        <span className={styles.title}>
          {item.title}
          <span className="visually-hidden">{spoken}</span>
        </span>
        <span className={styles.meta}>
          <span data-meta="">
            {meta.who}
            {meta.date ? (
              <>
                {' · '}
                <span
                  className={styles.date}
                  data-missed={meta.missed || undefined}
                  data-updated={maintained || undefined}
                >
                  {meta.date}
                </span>
              </>
            ) : null}
          </span>
          {item.note.trim() ? (
            <>
              {' · '}
              <span className={styles.note}>{item.note.trim().replace(/\s+/g, ' ')}</span>
            </>
          ) : null}
        </span>
      </button>
    </li>
  );
}
