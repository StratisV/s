import { useEffect, useRef, useState } from 'react';
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
  onAdd(): void;
  /** Messages from others since the chat was last read: a dot on Chat. */
  unread?: boolean;
  /** Slid out of the way (while typing in the chat). */
  hidden?: boolean;
}

/**
 * Floating Liquid Glass tab bar (Home, Chat, Stats) with the round add
 * button on the right on Home and Stats.
 */
export function TabBar({ tab, onTab, onAdd, unread = false, hidden = false }: TabBarProps) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.inert = hidden;
  }, [hidden]);
  // The add button pops in when it comes back from Chat (it isn't there on Chat), not when the app opens.
  const [visitedChat, setVisitedChat] = useState(false);
  if (tab === 'chat' && !visitedChat) setVisitedChat(true);

  return (
    <nav ref={ref} className={styles.bar} aria-label="Tabs" data-hidden={hidden || undefined} aria-hidden={hidden || undefined}>
      <div className={styles.capsule}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={styles.tab}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => onTab(t.id)}
          >
            <span className={styles.label}>
              {t.label}
              {t.id === 'chat' && unread ? <span className={styles.dot} aria-hidden="true" /> : null}
            </span>
            {t.id === 'chat' && unread ? <span className="visually-hidden">, unread messages</span> : null}
          </button>
        ))}
      </div>
      {tab !== 'chat' ? (
        <button
          type="button"
          className={styles.add}
          aria-label="New item"
          onClick={onAdd}
          data-enter={visitedChat || undefined}
        >
          {/* Same visible size as the 32px "add" glyph in the design: 18px across, 3px stroke. */}
          <PlusIcon size={25} strokeWidth={2.9} />
        </button>
      ) : null}
    </nav>
  );
}
