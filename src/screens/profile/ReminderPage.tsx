import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { TEXT_LIMITS } from '../../lib/constants';
import { BackButton, NavPage } from './NavPage';
import { DAY_LETTERS, DAY_NAMES, MORNING, MORNING_NOTE, WEEK } from './reminders';
import { useNotify } from './useNotify';
import list from './List.module.css';
import people from './People.module.css';
import styles from './Notify.module.css';

interface ReminderPageProps {
  /** The reminder to change, or null for a new one. */
  reminderId: string | null;
  onBack(): void;
  backRef?: Ref<HTMLButtonElement>;
  /** The title field, focused once a new reminder's page has slid in. */
  titleRef?: Ref<HTMLInputElement>;
}

/**
 * A reminder of your own (server mode; docs/ARCHITECTURE.md "Server mode (no setup)",
 * "Notifications"), pushed from Profile: what to be reminded of, the days, and the time, which
 * is always the morning (the run comes once a day). Save (in the bar) is off until there is a
 * title and a day; it closes the page once stored. A reminder that exists also has Delete.
 * When saving fails the page stays, with everything typed, and a toast says why.
 */
export function ReminderPage({ reminderId, onBack, backRef, titleRef }: ReminderPageProps) {
  const notify = useNotify();
  const existing = reminderId ? notify.settings?.reminders.find((r) => r.id === reminderId) : undefined;
  const [title, setTitle] = useState(existing?.title ?? '');
  const [days, setDays] = useState<number[]>(existing?.days ?? []);
  const [busy, setBusy] = useState(false);
  const daysId = useId();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Deleted elsewhere while the page was open: nothing left to change.
  const gone = reminderId !== null && !!notify.settings && !existing;
  useEffect(() => {
    if (gone && !busy) onBack();
  }, [gone, busy, onBack]);

  const ready = title.trim().length > 0 && days.length > 0;
  const heading = reminderId ? 'Edit Reminder' : 'New Reminder';

  const save = async () => {
    if (busy || !ready) return;
    setBusy(true);
    const ok = await notify.saveReminder({ ...(reminderId ? { id: reminderId } : {}), title: title.trim(), days });
    if (!alive.current) return;
    setBusy(false);
    if (ok) onBack();
  };

  const remove = async () => {
    if (busy || !reminderId) return;
    setBusy(true);
    const ok = await notify.deleteReminder(reminderId);
    if (!alive.current) return;
    setBusy(false);
    if (ok) onBack();
  };

  const toggleDay = (day: number) =>
    setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort((a, b) => a - b)));

  const onTitleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (ready) void save();
    else e.currentTarget.blur();
  };

  return (
    <NavPage
      inlineTitle={heading}
      pinTitle
      leading={<BackButton label="Profile" onClick={onBack} buttonRef={backRef} />}
      trailing={
        <button
          type="button"
          className={people.navAction}
          onClick={() => void save()}
          disabled={!ready && !busy}
          aria-busy={busy || undefined}
        >
          Save
        </button>
      }
    >
      <h1 className="visually-hidden">{heading}</h1>

      <h2 className={list.header}>Remind me to</h2>
      <div className={list.card}>
        <div className={list.row}>
          <input
            ref={titleRef}
            type="text"
            className={styles.field}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onTitleKey}
            placeholder="Take the bins out"
            aria-label="Remind me to"
            maxLength={TEXT_LIMITS.reminderTitle}
            autoCapitalize="sentences"
            autoComplete="off"
            enterKeyHint="done"
          />
        </div>
      </div>

      <h2 id={daysId} className={list.header}>
        Days
      </h2>
      <div className={list.card}>
        <div className={styles.days} role="group" aria-labelledby={daysId}>
          {WEEK.map((day) => (
            <button
              key={day}
              type="button"
              className={styles.day}
              aria-pressed={days.includes(day)}
              aria-label={DAY_NAMES[day]}
              onClick={() => toggleDay(day)}
            >
              {DAY_LETTERS[day]}
            </button>
          ))}
        </div>
      </div>
      {days.length === 0 ? <p className={list.caption}>Pick the days it should come on.</p> : null}

      <div className={`${list.card} ${list.lone}`}>
        <div className={list.row}>
          <span className={list.label}>Time</span>
          <span className={list.value}>{MORNING}</span>
        </div>
      </div>
      <p className={list.caption}>{MORNING_NOTE}</p>

      {reminderId ? (
        <div className={`${list.card} ${styles.delete}`}>
          <button type="button" className={`${list.row} ${list.destructive}`} onClick={() => void remove()} disabled={busy}>
            Delete Reminder
          </button>
        </div>
      ) : null}
    </NavPage>
  );
}
