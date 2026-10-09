import { forwardRef, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { TEXT_LIMITS } from '../../lib/constants';
import { AutoGrowTextarea } from '../item/AutoGrowTextarea';
import { ArrowUpIcon } from './icons';
import styles from './Composer.module.css';

interface ComposerProps {
  /** The text as last left (kept while switching tabs). */
  initial: string;
  onDraft(text: string): void;
  onSend(text: string): void;
  /**
   * The field gained or lost focus. `touch`: it was tapped with a finger or pen,
   * so an on-screen keyboard is on its way.
   */
  onFocusChange(focused: boolean, touch: boolean): void;
}

/**
 * The glass message field above the tab bar: grows to about five lines, and
 * the round send button is off while the field is blank. Tapped with a finger
 * (the iPhone keyboard), Return starts a new line and the button sends, like
 * Messages. With a hardware keyboard, Enter sends and Shift+Enter starts a
 * new line. Ctrl or Cmd+Enter always sends.
 */
export const Composer = forwardRef<HTMLFormElement, ComposerProps>(function Composer(
  { initial, onDraft, onSend, onFocusChange },
  ref,
) {
  const [text, setText] = useState(initial);
  const blank = text.trim() === '';
  // How the field was last reached. Set on pointerdown, which comes before the focus.
  const touchRef = useRef(false);
  const [touch, setTouch] = useState(false);

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
    if (e.key !== 'Enter' || e.altKey || e.nativeEvent.isComposing) return;
    const force = e.metaKey || e.ctrlKey;
    if (!force && (e.shiftKey || touchRef.current)) return; // a new line
    e.preventDefault();
    send();
  };

  const onPointerDown = (e: PointerEvent<HTMLTextAreaElement>) => {
    const finger = e.pointerType === 'touch' || e.pointerType === 'pen';
    touchRef.current = finger;
    setTouch(finger);
  };

  return (
    <form ref={ref} className={styles.composer} onSubmit={onSubmit} aria-label="New message">
      <AutoGrowTextarea
        className={styles.input}
        value={text}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onFocus={() => onFocusChange(true, touchRef.current)}
        onBlur={() => {
          onFocusChange(false, touchRef.current);
          touchRef.current = false;
          setTouch(false);
        }}
        placeholder="Message"
        aria-label="Message"
        maxLength={TEXT_LIMITS.chatMessage}
        // The iPhone keyboard's Return key reads "return" when it adds a line, "send" when it sends.
        enterKeyHint={touch ? 'enter' : 'send'}
        autoComplete="off"
        spellCheck
      />
      <button
        type="submit"
        className={styles.send}
        aria-label="Send"
        // Not `disabled`: it stays in the Tab order, so Tab from an empty field reaches it
        // (and then the tab bar) instead of leaving the page while the tab bar is hidden.
        aria-disabled={blank}
        // Keep the field focused (and the iPhone keyboard up) when tapping send.
        onMouseDown={(e) => e.preventDefault()}
      >
        <ArrowUpIcon size={20} strokeWidth={2.7} />
      </button>
    </form>
  );
});
