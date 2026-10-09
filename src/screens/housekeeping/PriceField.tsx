import { useEffect, useId, useReducer, useRef, useState } from 'react';
import { parsePrice, priceInputValue } from '../../lib/logic/housekeeping';
import styles from './Housekeeping.module.css';

interface PriceFieldProps {
  /** The stored price in pence; null = not entered. */
  stored: number | null;
  /** Saves a new price (null clears it). The field ignores failures (the provider reports them). */
  onSave(pence: number | null): Promise<unknown>;
}

/** About as wide as `text` (digits are 1ch; a point or comma is narrower), plus room for the caret. */
function fieldWidth(text: string): string {
  const narrow = (text.match(/[.,\s]/g) ?? []).length;
  return `calc(${text.length - narrow}ch + ${narrow * 0.4}ch + 3px)`;
}

export const PRICE_ERROR = 'Enter an amount like 45.00, up to £10,000.00.';

/**
 * "Price for the day": a card with one row, the label on the left and "£" and the amount
 * on the right, typed on the decimal keypad. Leaving the field reads it (parsePrice):
 * a valid, changed amount is saved (blank clears it) and shown as "45.00"; anything else
 * keeps the text, marks the field invalid and says why under the card.
 */
export function PriceField({ stored, onSave }: PriceFieldProps) {
  const id = useId();
  const errorId = useId();
  const [draft, setDraft] = useState(() => priceInputValue(stored));
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [settled, bump] = useReducer((n: number) => n + 1, 0);
  const pending = useRef(0);
  const reverting = useRef(false);

  // Shows the stored price unless it is being typed, is wrong, or ours is still landing.
  useEffect(() => {
    if (editing || invalid || pending.current) return;
    setDraft(priceInputValue(stored));
  }, [stored, editing, invalid, settled]);

  const finish = () => {
    setEditing(false);
    if (reverting.current) {
      reverting.current = false;
      setInvalid(false);
      setDraft(priceInputValue(stored));
      return;
    }
    const read = parsePrice(draft);
    if (!read.ok) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(priceInputValue(read.pence));
    if (read.pence === stored) return;
    pending.current += 1;
    void onSave(read.pence)
      .catch(() => {})
      .finally(() => {
        pending.current -= 1;
        bump();
      });
  };

  return (
    <>
      <div className={styles.card}>
        {/* The whole row is the field's label: a tap anywhere on it starts typing. */}
        <label htmlFor={id} className={styles.priceRow}>
          <span className={styles.priceLabel}>Price for the day</span>
          <span className={styles.priceValue}>
            <span className={styles.pound} aria-hidden="true">
              £
            </span>
            <input
              id={id}
              className={styles.priceInput}
              type="text"
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="0.00"
              aria-label="Price for the day"
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errorId : undefined}
              value={draft}
              // As wide as what it shows, so the £ sits just before the amount.
              style={{ width: fieldWidth(draft || '0.00') }}
              onFocus={() => setEditing(true)}
              onChange={(e) => {
                setDraft(e.target.value);
                // Once it reads right again, the error goes.
                if (invalid && parsePrice(e.target.value).ok) setInvalid(false);
              }}
              onBlur={finish}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  // Back to the stored price; keep the Escape from closing anything else.
                  e.preventDefault();
                  e.stopPropagation();
                  reverting.current = true;
                  e.currentTarget.blur();
                }
              }}
            />
          </span>
        </label>
      </div>
      {invalid ? (
        <p id={errorId} className={styles.error} role="alert">
          {PRICE_ERROR}
        </p>
      ) : null}
    </>
  );
}
