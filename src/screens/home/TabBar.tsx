import { useState, type CSSProperties } from 'react';
import type { Tab } from '../types';
import { PlusIcon } from '../../ui/icons';
import styles from './TabBar.module.css';

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'chat', label: 'Chat' },
  { id: 'stats', label: 'Stats' },
];

interface TabBarProps {
  tab: Tab;
  onTab(tab: Tab): void;
  /** Messages from others since the chat was last read: a dot on Chat. */
  unread?: boolean;
}

/**
 * The Home / Chat / Stats switch, just under the hero on every tab: a
 * segmented control whose white thumb slides to the tab that is open.
 */
export function TabBar({ tab, onTab, unread = false }: TabBarProps) {
  const index = Math.max(
    0,
    TABS.findIndex((t) => t.id === tab),
  );
  return (
    <nav className={styles.bar} aria-label="Tabs" style={{ '--index': index } as CSSProperties}>
      <span className={styles.thumb} aria-hidden="true" />
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={styles.tab}
          aria-current={tab === t.id ? 'page' : undefined}
          aria-label={t.id === 'chat' && unread ? 'Chat, unread messages' : undefined}
          onClick={() => onTab(t.id)}
        >
          <span className={styles.label}>
            {t.label}
            {t.id === 'chat' && unread ? <span className={styles.dot} aria-hidden="true" /> : null}
          </span>
        </button>
      ))}
    </nav>
  );
}

/** The round add button, floating at the bottom right on Home and Stats. */
export function AddButton({ tab, onAdd }: { tab: Tab; onAdd(): void }) {
  // It pops in when it comes back from Chat (it isn't there on Chat), not when the app opens.
  const [visitedChat, setVisitedChat] = useState(false);
  if (tab === 'chat' && !visitedChat) setVisitedChat(true);
  if (tab === 'chat') return null;
  return (
    <button type="button" className={styles.add} aria-label="New item" onClick={onAdd} data-enter={visitedChat || undefined}>
      {/* Same visible size as the 32px "add" glyph in the design: 18px across, 3px stroke. */}
      <PlusIcon size={25} strokeWidth={2.9} />
    </button>
  );
}
