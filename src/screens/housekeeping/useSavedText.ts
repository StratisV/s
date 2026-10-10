import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { HOUSEKEEPING_SAVE_DELAY_MS } from '../../lib/constants';

/**
 * Where a field's saving stands, to show next to it: 'saved' for SAVED_FLASH_MS after a save
 * lands (while the field still holds what was saved), 'failed' from a failed save until the
 * next one starts, otherwise 'idle'.
 */
export type SaveState = 'idle' | 'saved' | 'failed';

/** How long "Saved" shows after a save lands. */
export const SAVED_FLASH_MS = 2000;

/**
 * True for SAVED_FLASH_MS after flash() is called. For fields that say "Saved" for a
 * moment (the message, comments, the price).
 */
export function useSavedFlash(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = useCallback(() => {
    clearTimeout(timer.current);
    setOn(true);
    timer.current = setTimeout(() => setOn(false), SAVED_FLASH_MS);
  }, []);
  return [on, flash];
}

export interface SavedText {
  /** What the field shows. */
  value: string;
  onChange(value: string): void;
  onFocus(): void;
  /** Saves at once (blur). */
  onBlur(): void;
  /** Replaces the text and saves it at once (Clear). */
  replace(value: string): void;
  /** Saving, to show next to the field (SaveState). */
  state: SaveState;
  /** Sends the text again, after a failed save. */
  retry(): void;
}

/**
 * A multi-line text field that saves itself (the message for the housekeeper, a visit's
 * comments): HOUSEKEEPING_SAVE_DELAY_MS after the last keystroke and on blur, when the
 * trimmed text differs from the stored one. While there is unsaved typing, or a save is
 * in flight, the field keeps its draft; otherwise it follows the stored value (changes by
 * others arrive live). While focused, a draft that only differs by surrounding spaces is
 * kept, so a space typed just before a pause isn't swallowed.
 *
 * A failed save (the provider takes its change back and says so) never costs the text: the
 * draft stays in the field as unsaved typing, `state` is 'failed' until the next save
 * starts, and the next pause, blur or retry() sends it again.
 *
 * `save` gets the trimmed text.
 */
export function useSavedText(stored: string, save: (text: string) => Promise<unknown>): SavedText {
  const [draft, setDraft] = useState(stored);
  const [focused, setFocused] = useState(false);
  const [settled, bump] = useReducer((n: number) => n + 1, 0);
  const [failed, setFailed] = useState(false);
  const [saved, flashSaved] = useSavedFlash();
  /** The text the last save stored ("Saved" is about it, not about a later change). */
  const [savedText, setSavedText] = useState<string | null>(null);
  const draftRef = useRef(stored);
  /** Typed since the last save began (or not saved: the last save failed). */
  const dirty = useRef(false);
  /** Saves in flight. */
  const pending = useRef(0);
  /** Numbers each save, so only the latest one says how saving stands. */
  const saves = useRef(0);
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
      // Nothing to send (typed back to what is stored): nothing unsaved either.
      setFailed(false);
      bump();
      return;
    }
    const n = ++saves.current;
    pending.current += 1;
    setFailed(false);
    let result: Promise<unknown>;
    try {
      result = latest.current.save(text);
    } catch (err) {
      result = Promise.reject(err);
    }
    void result
      .then(
        () => {
          if (n !== saves.current) return;
          setSavedText(text);
          flashSaved();
        },
        () => {
          // Keep the text as unsaved typing (the provider has said it wasn't saved).
          if (n !== saves.current) return;
          dirty.current = true;
          setFailed(true);
        },
      )
      .finally(() => {
        pending.current -= 1;
        bump();
      });
  }, [flashSaved]);

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
    state: failed ? 'failed' : saved && savedText === stored ? 'saved' : 'idle',
    retry: () => {
      dirty.current = true;
      commit();
    },
  };
}
