import type { Tab } from '../types';
import { PlusIcon } from '../../ui/icons';
import styles from './TabBar.module.css';

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'stats', label: 'Stats' },
];

/** Floating Liquid Glass tab bar (Home, Stats) with the round add button on the right. */
export function TabBar({ tab, onTab, onAdd }: { tab: Tab; onTab(tab: Tab): void; onAdd(): void }) {
  return (
    <nav className={styles.bar} aria-label="Tabs">
      <div className={styles.capsule}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={styles.tab}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <button type="button" className={styles.add} aria-label="New item" onClick={onAdd}>
        {/* Same visible size as the 32px "add" glyph in the design: 18px across, 3px stroke. */}
        <PlusIcon size={25} strokeWidth={2.9} />
      </button>
    </nav>
  );
}
