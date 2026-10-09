import { forwardRef, useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'onBlur'>;

interface InlineTextProps extends InputProps {
  value: string;
  /** Called with the trimmed text when it changed (on blur or Enter). */
  onCommit(next: string): void;
  /** Blank text reverts to the saved value unless this is set. */
  allowBlank?: boolean;
}

/**
 * A text field that edits a saved value in place: it saves on blur or
 * Enter, Escape reverts, and blank text reverts unless `allowBlank`. While
 * not focused it follows the saved value (edits made elsewhere show up).
 */
export const InlineText = forwardRef<HTMLInputElement, InlineTextProps>(function InlineText(
  { value, onCommit, allowBlank = false, onFocus, onKeyDown, ...rest },
  ref,
) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const finish = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(value);
      return;
    }
    const next = draft.trim();
    if (!next && !allowBlank) {
      setDraft(value);
      return;
    }
    setDraft(next);
    if (next !== value) onCommit(next);
  };

  return (
    <input
      ref={ref}
      type="text"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="done"
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        setEditing(true);
        onFocus?.(e);
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          // Revert, and keep the Escape from closing the screen.
          e.preventDefault();
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
});
