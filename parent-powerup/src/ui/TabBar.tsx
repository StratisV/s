import type { TabId } from '../types';
import { Icon, type IconName } from './Icon';
import styles from './TabBar.module.css';

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'meditate', label: 'Meditate', icon: 'meditate' },
  { id: 'powerups', label: 'Powerups', icon: 'bolt' },
  { id: 'family', label: 'Family', icon: 'family' },
  { id: 'weekly', label: 'This Week', icon: 'weekly' },
];

interface TabBarProps {
  current: TabId;
  onSelect: (tab: TabId) => void;
}

/** The four tabs along the bottom, over frosted glass. */
export function TabBar({ current, onSelect }: TabBarProps) {
  return (
    <nav className={styles.bar} aria-label="Main">
      <ul className={styles.list}>
        {TABS.map((tab) => {
          const active = tab.id === current;
          return (
            <li key={tab.id}>
              <button
                type="button"
                className={styles.tab}
                data-active={active || undefined}
                aria-current={active ? 'page' : undefined}
                onClick={() => onSelect(tab.id)}
              >
                <span className={styles.icon}>
                  <Icon name={tab.icon} size={24} filled={tab.icon === 'bolt' ? active : undefined} />
                </span>
                <span className={styles.label}>{tab.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
