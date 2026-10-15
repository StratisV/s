import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';
import { AutoGrowTextarea } from '../item/AutoGrowTextarea';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'onBlur' | 'onFocus' | 'onKeyDown'>;
type Field = HTMLInputElement | HTMLTextAreaElement;

interface InlineTextProps extends InputProps {
  value: string;
  /** Called with the trimmed text when it changed (on blur or Enter). */
  onCommit(next: string): void;
  /** Blank text reverts to the saved value unless this is set. */
  allowBlank?: boolean;
  /**
   * Wraps onto as many lines as the text needs (a textarea that grows with it) instead of one
   * line that scrolls sideways, so a long name reads in full. It is still one line of text:
   * Enter saves, and line breaks pasted in become spaces.
   */
  multiline?: boolean;
  onFocus?(e: FocusEvent<Field>): void;
  onKeyDown?(e: KeyboardEvent<Field>): void;
}

/**
 * A text field that edits a saved value in place: it saves on blur or
 * Enter, Escape reverts, and blank text reverts unless `allowBlank`. While
 * not focused it follows the saved value (edits made elsewhere show up).
 */
export const InlineText = forwardRef<Field, InlineTextProps>(function InlineText(
  { value, onCommit, allowBlank = false, multiline = false, onFocus, onKeyDown, ...rest },
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

  const shared = {
    autoComplete: 'off',
    autoCorrect: 'off',
    spellCheck: false,
    enterKeyHint: 'done' as const,
    onFocus: (e: FocusEvent<Field>) => {
      setEditing(true);
      onFocus?.(e);
    },
    onBlur: finish,
    onKeyDown: (e: KeyboardEvent<Field>) => {
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
    },
  };

  if (multiline) {
    return (
      <AutoGrowTextarea
        ref={ref as Ref<HTMLTextAreaElement>}
        {...shared}
        {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[\r\n]+/g, ' '))}
      />
    );
  }
  return (
    <input
      ref={ref as Ref<HTMLInputElement>}
      type="text"
      {...shared}
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
    />
  );
});
