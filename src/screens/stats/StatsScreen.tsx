import { useMemo, useState, type ReactNode } from 'react';
import { countCompletions } from '../../lib/logic/stats';
import type { StatsPeriod } from '../../lib/types';
import { useHousehold } from '../../state/HomeProvider';
import { Avatar } from '../../ui/Avatar';
import { Screen } from '../../ui/Screen';
import { Donut } from './Donut';
import { SegmentedControl } from './SegmentedControl';
import styles from './StatsScreen.module.css';

const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: 'month', label: 'This Month' },
  { value: 'lifetime', label: 'Lifetime' },
];

// Remembered while the app runs, so switching tabs keeps the chosen period.
let lastPeriod: StatsPeriod = 'month';

/** Stats: tasks done per person, this month or ever (README "3. Stats"). */
export function StatsScreen({ onOpenProfile, tabs }: { onOpenProfile(): void; tabs?: ReactNode }) {
  const { data, me, today } = useHousehold();
  const [period, setPeriodState] = useState<StatsPeriod>(lastPeriod);
  const setPeriod = (p: StatsPeriod) => {
    lastPeriod = p;
    setPeriodState(p);
  };

  const { members, completions, household } = data;
  const { rows, total } = useMemo(
    () => countCompletions(members, completions, period, household.timezone),
    // `today` re-counts when a new month starts while the app is open.
    [members, completions, period, household.timezone, today],
  );

  const periodText = period === 'month' ? 'this month' : 'in total';
  const summary =
    `${total} ${total === 1 ? 'task' : 'tasks'} done ${periodText}` +
    (rows.length ? `: ${rows.map((r) => `${r.member.name} ${r.count}`).join(', ')}.` : '.');

  return (
    <Screen
      label="Stats"
      title="Stats"
      avatarEmoji={me.emoji}
      onAvatar={onOpenProfile}
      tabs={tabs}
    >
      <SegmentedControl label="Period" options={PERIODS} value={period} onChange={setPeriod} className={styles.period} />
      <div className={styles.donut}>
        <Donut rows={rows} total={total} label={summary} />
      </div>
      <ul className={styles.legend} aria-label="Done per person">
        {rows.map(({ member, count }) => (
          <li key={member.id} className={styles.row}>
            <span className={styles.who}>
              <Avatar emoji={member.emoji} size={36} emojiSize={20} background="var(--bg)" ring={member.color} />
              <span className={styles.name}>{member.name}</span>
            </span>
            <span className={styles.count}>{count}</span>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
