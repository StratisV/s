import { useMemo, useState } from 'react';
import { formatDay, todayIn } from '../../lib/logic/dates';
import { doneInPeriod } from '../../lib/logic/stats';
import type { StatsPeriod } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { EmojiText } from '../../ui/EmojiText';
import { Sheet } from '../../ui/Sheet';
import styles from './DoneSheet.module.css';

/** What the sheet shows: the period, and one person or everyone (null). */
export interface DoneTarget {
  period: StatsPeriod;
  memberId: string | null;
}

interface DoneSheetProps {
  open: boolean;
  target: DoneTarget;
  onClose(): void;
}

/**
 * The tasks behind Stats' circle (tap the circle, a slice of it, or a person): what was done
 * this month or ever, newest first, with who did it and when. "Everyone" or one person at a time.
 * App mounts it next to the stage, like the other page sheets.
 */
export function DoneSheet({ open, target, onClose }: DoneSheetProps) {
  return (
    <Sheet open={open} onRequestClose={onClose} label={target.period === 'month' ? 'Done this month' : 'Done in total'}>
      {/* A fresh body (and filter) for each opening. */}
      <DoneBody key={`${target.period}:${target.memberId ?? ''}:${open}`} target={target} onClose={onClose} />
    </Sheet>
  );
}

function DoneBody({ target, onClose }: { target: DoneTarget; onClose(): void }) {
  const { data, today } = useHousehold();
  const { members, completions, household } = data;
  const [who, setWho] = useState<string | null>(target.memberId);
  const all = useMemo(
    () => doneInPeriod(members, completions, target.period, household.timezone, today),
    [members, completions, target.period, household.timezone, today],
  );
  const shown = who === null ? all : all.filter((c) => c.credited_to === who);
  const byId = new Map(members.map((m) => [m.id, m]));
  const counts = new Map<string, number>();
  for (const c of all) counts.set(c.credited_to!, (counts.get(c.credited_to!) ?? 0) + 1);
  const people = members.filter((m) => (counts.get(m.id) ?? 0) > 0 || m.id === who);
  const title = target.period === 'month' ? 'Done this month' : 'Done in total';
  const person = who ? byId.get(who) : null;
  const empty = person
    ? `${person.name} hasn’t done anything ${target.period === 'month' ? 'this month' : 'yet'}.`
    : target.period === 'month'
      ? 'Nothing done yet this month.'
      : 'Nothing done yet.';

  return (
    <div className={styles.root}>
      <div className={styles.nav} data-sheet-handle>
        <span />
        <h1 className={styles.title}>{title}</h1>
        <button type="button" className={styles.done} onClick={onClose}>
          Done
        </button>
      </div>
      <div className={styles.body} data-sheet-scroll>
        <div className={styles.chips} role="radiogroup" aria-label="Show tasks done by">
          <button type="button" role="radio" aria-checked={who === null} className={styles.chip} onClick={() => setWho(null)}>
            Everyone <span className={styles.chipCount}>{all.length}</span>
          </button>
          {people.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={who === m.id}
              aria-label={`${m.name}, ${counts.get(m.id) ?? 0}`}
              className={styles.chip}
              onClick={() => setWho(m.id)}
            >
              <EmojiText text={m.emoji} /> {m.name} <span className={styles.chipCount}>{counts.get(m.id) ?? 0}</span>
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className={styles.empty}>{empty}</p>
        ) : (
          <ul className={styles.list} aria-label={person ? `Done by ${person.name}` : 'Done'}>
            {shown.map((c) => {
              const m = byId.get(c.credited_to!);
              const day = todayIn(household.timezone, new Date(c.completed_at));
              const when = day === today ? 'Today' : formatDay(day, today);
              return (
                <li key={c.id} className={styles.row} data-done-row>
                  <span className={styles.check} aria-hidden="true">
                    ✓
                  </span>
                  <span className={styles.text}>
                    <span className={styles.task}>{c.item_title}</span>
                    <span className={styles.meta}>
                      {m ? (
                        <>
                          <EmojiText text={m.emoji} /> {m.name} ·{' '}
                        </>
                      ) : null}
                      {when}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
