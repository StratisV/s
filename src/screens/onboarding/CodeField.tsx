import { useLayoutEffect, useRef, type ChangeEvent, type ClipboardEvent } from 'react';
import { caretAfter, codeFromPaste, codeLetters, groupCode } from './codeText';

interface CodeFieldProps {
  id: string;
  /** As shown: grouped ("ABCD-EFGH"). */
  value: string;
  /** The new value, grouped. */
  onChange(value: string): void;
  className?: string;
  /** The `maxLength` attribute (characters as typed, hyphens included). */
  maxLength: number;
  placeholder: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Ids of what describes the field (an error under it). */
  describedBy?: string;
  /** A pasted message or link gives its sign-in code (the "Have a code?" field). */
  takeCodeFromPaste?: boolean;
  enterKeyHint?: 'go' | 'done';
}

/**
 * A code as people type it (server mode): any case, with or without spaces or hyphens, shown
 * in groups of four as it is typed ("ABCD-EFGH"), with the caret kept where it was. Deleting a
 * hyphen deletes the letter before it. The keyboard is the plain one in capitals, with no
 * autocorrect, and iOS may offer a code from Messages (one-time-code).
 */
export function CodeField({
  id,
  value,
  onChange,
  className,
  maxLength,
  placeholder,
  disabled,
  invalid,
  describedBy,
  takeCodeFromPaste = false,
  enterKeyHint = 'go',
}: CodeFieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  /** Where the caret goes once the grouped value is shown. */
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const at = caret.current;
    caret.current = null;
    if (!el || at === null || document.activeElement !== el) return;
    const pos = Math.min(at, el.value.length);
    try {
      el.setSelectionRange(pos, pos);
    } catch {
      /* not a text field any more */
    }
  }, [value]);

  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.target;
    const raw = el.value;
    const at = el.selectionStart ?? raw.length;
    let letters = codeLetters(raw);
    let before = codeLetters(raw.slice(0, at)).length;
    // Only a hyphen went: take the letter beside it too, or the hyphen would just come back.
    if (letters === codeLetters(value)) {
      const kind = (e.nativeEvent as InputEvent).inputType;
      if (kind === 'deleteContentBackward' && before > 0) {
        letters = letters.slice(0, before - 1) + letters.slice(before);
        before -= 1;
      } else if (kind === 'deleteContentForward' && before < letters.length) {
        letters = letters.slice(0, before) + letters.slice(before + 1);
      }
    }
    caret.current = caretAfter(before);
    onChange(groupCode(letters));
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    if (!takeCodeFromPaste) return;
    const code = codeFromPaste(e.clipboardData.getData('text'));
    if (!code) return;
    e.preventDefault();
    caret.current = code.length;
    onChange(code);
  };

  return (
    <input
      ref={ref}
      id={id}
      className={className}
      type="text"
      inputMode="text"
      autoCapitalize="characters"
      autoComplete="one-time-code"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint={enterKeyHint}
      maxLength={maxLength}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onChange={onInput}
      onPaste={onPaste}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    />
  );
}
