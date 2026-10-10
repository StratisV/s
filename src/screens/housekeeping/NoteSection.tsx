import { useId, useRef } from 'react';
import { TEXT_LIMITS } from '../../lib/constants';
import { noteByline } from '../../lib/logic/housekeeping';
import { useHousehold } from '../../state/HomeProvider';
import { EmojiText } from '../../ui/EmojiText';
import { AutoGrowTextarea } from '../item/AutoGrowTextarea';
import { useSavedText } from './useSavedText';
import styles from './Housekeeping.module.css';

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false; // engines without :focus-visible
  }
}

interface NoteSectionProps {
  /** Says what was saved, politely (the screen's live region). */
  announce(text: string): void;
}

/**
 * "Message for the housekeeper": one household-wide note any member writes to give
 * direction. It saves itself (a pause in typing, or leaving the field), shows who changed
 * it last, and Clear empties it with an Undo.
 */
export function NoteSection({ announce }: NoteSectionProps) {
  const { data, setHousekeepingNote, showToast, dismissToast } = useHousehold();
  const { note } = data.housekeeping;
  const headingId = useId();
  const bylineId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const field = useSavedText(note.body, (body) =>
    setHousekeepingNote(body).then(() => announce(body ? 'Saved' : 'Message cleared')),
  );

  const byline = noteByline(note, data.members, data.household.timezone, new Date());
  const hasMessage = !!note.body || !!field.value.trim();

  const clear = (button: HTMLButtonElement) => {
    const before = note.body;
    // The button goes with the message: from the keyboard, carry on in the field.
    if (isFocusVisible(button)) fieldRef.current?.focus({ preventScroll: true });
    field.replace('');
    if (!before) return;
    showToast('Message cleared', {
      label: 'Undo',
      run: () => {
        dismissToast();
        void setHousekeepingNote(before).catch(() => {});
      },
    });
  };

  return (
    <section aria-labelledby={headingId}>
      <div className={`${styles.headerRow} ${styles.headerRowFirst}`}>
        <h2 id={headingId} className={styles.header}>
          Message for the housekeeper
        </h2>
        {hasMessage ? (
          <button
            type="button"
            className={styles.headerAction}
            aria-label="Clear message"
            onClick={(e) => clear(e.currentTarget)}
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className={styles.card}>
        <AutoGrowTextarea
          ref={fieldRef}
          className={styles.textField}
          value={field.value}
          onChange={(e) => field.onChange(e.target.value)}
          onFocus={field.onFocus}
          onBlur={field.onBlur}
          aria-labelledby={headingId}
          aria-describedby={byline ? bylineId : undefined}
          placeholder="Anything to do first, or differently? e.g. please do the spare room first"
          maxLength={TEXT_LIMITS.housekeepingNote}
          autoCapitalize="sentences"
        />
      </div>
      {byline ? (
        <p id={bylineId} className={styles.caption}>
          <EmojiText text={byline} />
        </p>
      ) : null}
    </section>
  );
}
