import { useMemo, useState } from 'react';
import { countCompletions } from '../../lib/logic/stats';
import type { StatsPeriod } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { Avatar } from '../../ui/Avatar';
import { Screen } from '../../ui/Screen';
import type { DoneTarget } from './DoneSheet';
import { Donut } from './Donut';
import { SegmentedControl } from './SegmentedControl';
import styles from './StatsScreen.module.css';

const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: 'month', label: 'This Month' },
  { value: 'lifetime', label: 'Lifetime' },
];

// Remembered while the app runs, so switching tabs keeps the chosen period.
let lastPeriod: StatsPeriod = 'month';

/**
 * Stats: tasks done per person, this month or ever (README "3. Stats"). Tap the circle for the
 * tasks behind it, or a slice or a person for theirs (`onOpenDone`, App's DoneSheet).
 */
export function StatsScreen({
  onOpenProfile,
  onOpenDone,
}: {
  onOpenProfile(): void;
  onOpenDone?(target: DoneTarget, opener: HTMLElement): void;
}) {
  const { data, me, today } = useHousehold();
  const [period, setPeriodState] = useState<StatsPeriod>(lastPeriod);
  const setPeriod = (p: StatsPeriod) => {
    lastPeriod = p;
    setPeriodState(p);
  };

  const { members, completions, household } = data;
  const { rows, total } = useMemo(
    // "This month" is the month of `today` (the household's day, which moves on at midnight
    // while the app is open), not of whatever the clock says at render time.
    () => countCompletions(members, completions, period, household.timezone, today),
    [members, completions, period, household.timezone, today],
  );

  const periodText = period === 'month' ? 'this month' : 'in total';
  const summary =
    `${total} ${total === 1 ? 'task' : 'tasks'} done ${periodText}` +
    (rows.length ? `: ${rows.map((r) => `${r.member.name} ${r.count}`).join(', ')}.` : '.');

  return (
    <Screen label="Stats" title="Stats" avatarEmoji={me.emoji} onAvatar={onOpenProfile}>
      <SegmentedControl
        label="Period"
        options={PERIODS}
        value={period}
        onChange={setPeriod}
        className={styles.period}
        compact
      />
      <div className={styles.donut}>
        {onOpenDone ? (
          <button
            type="button"
            className={styles.donutButton}
            aria-label={`Show the tasks: ${summary}`}
            onClick={(e) => onOpenDone({ period, memberId: null }, e.currentTarget)}
          >
            <Donut
              rows={rows}
              total={total}
              label={summary}
              onSegment={(memberId) => onOpenDone({ period, memberId }, document.activeElement as HTMLElement)}
            />
          </button>
        ) : (
          <Donut rows={rows} total={total} label={summary} />
        )}
      </div>
      {onOpenDone ? <p className={styles.hint}>Tap the circle or a name to see the tasks.</p> : null}
      <ul className={styles.legend} aria-label="Done per person">
        {rows.map(({ member, count }) => {
          const who = (
            <>
              <span className={styles.who}>
                <Avatar emoji={member.emoji} size={36} emojiSize={20} background="var(--bg)" ring={member.color} />
                <span className={styles.name}>{member.name}</span>
              </span>
              <span className={styles.count}>{count}</span>
            </>
          );
          return (
            <li key={member.id} className={styles.row}>
              {onOpenDone ? (
                <button
                  type="button"
                  className={styles.rowButton}
                  aria-label={`${member.name}, ${count} done. Show the tasks`}
                  onClick={(e) => onOpenDone({ period, memberId: member.id }, e.currentTarget)}
                >
                  {who}
                </button>
              ) : (
                who
              )}
            </li>
          );
        })}
      </ul>
    </Screen>
  );
}
