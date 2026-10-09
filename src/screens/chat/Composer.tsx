import { forwardRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { TEXT_LIMITS } from '../../lib/constants';
import { AutoGrowTextarea } from '../item/AutoGrowTextarea';
import { ArrowUpIcon } from './icons';
import styles from './Composer.module.css';

interface ComposerProps {
  /** The text as last left (kept while switching tabs). */
  initial: string;
  onDraft(text: string): void;
  onSend(text: string): void;
  onFocusChange(focused: boolean): void;
}

/**
 * The glass message field above the tab bar: grows to about five lines,
 * Enter sends and Shift+Enter starts a new line; the round send button is
 * off while the field is blank.
 */
export const Composer = forwardRef<HTMLFormElement, ComposerProps>(function Composer(
  { initial, onDraft, onSend, onFocusChange },
  ref,
) {
  const [text, setText] = useState(initial);
  const blank = text.trim() === '';

  const change = (value: string) => {
    setText(value);
    onDraft(value);
  };

  const send = () => {
    if (blank) return;
    onSend(text);
    change('');
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send();
  };

  return (
    <form ref={ref} className={styles.composer} onSubmit={onSubmit} aria-label="New message">
      <AutoGrowTextarea
        className={styles.input}
        value={text}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        placeholder="Message"
        aria-label="Message"
        maxLength={TEXT_LIMITS.chatMessage}
        enterKeyHint="send"
        autoComplete="off"
        spellCheck
      />
      <button
        type="submit"
        className={styles.send}
        aria-label="Send"
        disabled={blank}
        // Keep the field focused (and the iPhone keyboard up) when tapping send.
        onMouseDown={(e) => e.preventDefault()}
      >
        <ArrowUpIcon size={20} strokeWidth={2.7} />
      </button>
    </form>
  );
});
