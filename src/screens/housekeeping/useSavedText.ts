import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { HOUSEKEEPING_SAVE_DELAY_MS } from '../../lib/constants';

export interface SavedText {
  /** What the field shows. */
  value: string;
  onChange(value: string): void;
  onFocus(): void;
  /** Saves at once (blur). */
  onBlur(): void;
  /** Replaces the text and saves it at once (Clear). */
  replace(value: string): void;
}

/**
 * A multi-line text field that saves itself (the message for the housekeeper, a visit's
 * comments): HOUSEKEEPING_SAVE_DELAY_MS after the last keystroke and on blur, when the
 * trimmed text differs from the stored one. While there is unsaved typing, or a save is
 * in flight, the field keeps its draft; otherwise it follows the stored value (changes by
 * others arrive live, and a failed save, which the provider takes back, puts the old text
 * back). While focused, a draft that only differs by surrounding spaces is kept, so a
 * space typed just before a pause isn't swallowed.
 *
 * `save` gets the trimmed text; the field ignores its failures (the provider reports them).
 */
export function useSavedText(stored: string, save: (text: string) => Promise<unknown>): SavedText {
  const [draft, setDraft] = useState(stored);
  const [focused, setFocused] = useState(false);
  const [settled, bump] = useReducer((n: number) => n + 1, 0);
  const draftRef = useRef(stored);
  /** Typed since the last save began. */
  const dirty = useRef(false);
  /** Saves in flight. */
  const pending = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef({ stored, save });
  latest.current = { stored, save };

  // Follow the stored value unless there is something of ours still to land.
  useEffect(() => {
    if (dirty.current || pending.current) return;
    const keep = focused && draftRef.current.trim() === stored;
    if (!keep && draftRef.current !== stored) {
      draftRef.current = stored;
      setDraft(stored);
    }
  }, [stored, focused, settled]);

  const commit = useCallback(() => {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    const text = draftRef.current.trim();
    if (text === latest.current.stored) {
      bump();
      return;
    }
    pending.current += 1;
    let result: Promise<unknown>;
    try {
      result = latest.current.save(text);
    } catch (err) {
      result = Promise.reject(err);
    }
    void result
      .catch(() => {})
      .finally(() => {
        pending.current -= 1;
        bump();
      });
  }, []);

  // Leaving with unsaved typing (the day changed, the screen went): save it.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (dirty.current) commit();
    },
    [commit],
  );

  return {
    value: draft,
    onChange: (value) => {
      draftRef.current = value;
      dirty.current = true;
      setDraft(value);
      clearTimeout(timer.current);
      timer.current = setTimeout(commit, HOUSEKEEPING_SAVE_DELAY_MS);
    },
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      commit();
    },
    replace: (value) => {
      draftRef.current = value;
      dirty.current = true;
      setDraft(value);
      commit();
    },
  };
}
