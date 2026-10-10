import { useId } from 'react';
import { TEXT_LIMITS } from '../../lib/constants';
import { noteByline } from '../../lib/logic/housekeeping';
import { useHousehold } from '../../state/HomeProvider';
import { EmojiText } from '../../ui/EmojiText';
import { AutoGrowTextarea } from '../item/AutoGrowTextarea';
import { NotSaved, SavedFlag } from './SaveStatus';
import { useSavedText } from './useSavedText';
import styles from './Housekeeping.module.css';

interface NoteSectionProps {
  /** Says what was saved, politely (the screen's live region). */
  announce(text: string): void;
}

/**
 * "Message for the housekeeper": one household-wide note any member writes to give
 * direction. It saves itself (a pause in typing, or leaving the field), shows who changed
 * it last ("✓ Saved" for a moment after a save), and Clear empties it with an Undo that
 * puts it back as it was, under the name of whoever wrote it. Clear stays in place (dimmed)
 * while there is nothing to clear, so focus and VoiceOver don't lose their place when it
 * is used. A failed save keeps the text with "Not saved. Try again".
 */
export function NoteSection({ announce }: NoteSectionProps) {
  const { data, setHousekeepingNote, undoClearHousekeepingNote, showToast, dismissToast } = useHousehold();
  const { note } = data.housekeeping;
  const headingId = useId();
  const bylineId = useId();
  const field = useSavedText(note.body, (body) =>
    setHousekeepingNote(body).then(() => announce(body ? 'Saved' : 'Message cleared')),
  );

  const byline = noteByline(note, data.members, data.household.timezone, new Date());
  const hasMessage = !!note.body || !!field.value.trim();

  const clear = () => {
    if (!hasMessage) return;
    const before = note;
    field.replace('');
    if (!before.body) return;
    showToast('Message cleared', {
      label: 'Undo',
      run: () => {
        dismissToast();
        void undoClearHousekeepingNote(before).catch(() => {});
      },
    });
  };

  return (
    <section aria-labelledby={headingId}>
      <div className={`${styles.headerRow} ${styles.headerRowFirst}`}>
        <h2 id={headingId} className={styles.header}>
          Message for the housekeeper
        </h2>
        <button
          type="button"
          className={styles.headerAction}
          aria-label="Clear message"
          aria-disabled={hasMessage ? undefined : true}
          onClick={clear}
        >
          Clear
        </button>
      </div>
      <div className={styles.card}>
        <AutoGrowTextarea
          className={styles.textField}
          value={field.value}
          onChange={(e) => field.onChange(e.target.value)}
          onFocus={field.onFocus}
          onBlur={field.onBlur}
          aria-labelledby={headingId}
          aria-describedby={byline && field.state !== 'failed' ? bylineId : undefined}
          placeholder="Anything to do first, or differently? e.g. please do the spare room first"
          maxLength={TEXT_LIMITS.housekeepingNote}
          autoCapitalize="sentences"
        />
      </div>
      {field.state === 'failed' ? (
        <NotSaved what="the message" onRetry={field.retry} />
      ) : byline ? (
        <p id={bylineId} className={styles.caption}>
          {field.state === 'saved' ? (
            <span className={styles.savedLead} aria-hidden="true">
              <SavedFlag />
              {' ·'}
            </span>
          ) : null}
          <EmojiText text={byline} />
        </p>
      ) : null}
    </section>
  );
}
