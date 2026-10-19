import { useState, type CSSProperties, type ReactNode } from 'react';
import type { Tab } from '../types';
import { PlusIcon } from '../../ui/icons';
import styles from './TabBar.module.css';

/** SF Symbols stand-ins for the tabs (filled, as iOS draws tab bar symbols). */
const ICONS: Record<Tab, ReactNode> = {
  // house.fill
  home: (
    <path d="M10.9 3.6a1.7 1.7 0 0 1 2.2 0l7.6 6.6c.6.5.2 1.5-.6 1.5H19v7.6c0 .9-.7 1.7-1.6 1.7h-3.1v-4.9c0-.7-.6-1.3-1.3-1.3h-2c-.7 0-1.3.6-1.3 1.3V21H6.6c-.9 0-1.6-.8-1.6-1.7v-7.6H3.9c-.8 0-1.2-1-.6-1.5z" />
  ),
  // exclamationmark.circle.fill
  attention: (
    <path
      fillRule="evenodd"
      d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Zm0 4.1c.76 0 1.36.63 1.32 1.39l-.33 6.06a.99.99 0 0 1-1.98 0l-.33-6.06A1.32 1.32 0 0 1 12 6.6Zm0 11.4a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Z"
    />
  ),
  // message.fill
  chat: (
    <path d="M12 3.3c-5.1 0-9.2 3.4-9.2 7.6 0 2.4 1.3 4.5 3.4 5.9-.2 1.3-.9 2.6-1.9 3.4-.3.2-.1.6.2.6 2 0 3.7-.8 4.9-1.8.8.2 1.7.3 2.6.3 5.1 0 9.2-3.4 9.2-7.6S17.1 3.3 12 3.3Z" />
  ),
  // sparkles
  housekeeping: (
    <>
      <path d="M10 5.2c.45 3 1.3 4.9 2.4 6s3 1.95 6 2.4c-3 .45-4.9 1.3-6 2.4s-1.95 3-2.4 6c-.45-3-1.3-4.9-2.4-6s-3-1.95-6-2.4c3-.45 4.9-1.3 6-2.4s1.95-3 2.4-6Z" />
      <path d="M18.2 1.8c.23 1.5.6 2.4 1.15 2.95s1.45.92 2.95 1.15c-1.5.23-2.4.6-2.95 1.15S18.43 8.5 18.2 10c-.23-1.5-.6-2.4-1.15-2.95S15.6 6.13 14.1 5.9c1.5-.23 2.4-.6 2.95-1.15s.92-1.45 1.15-2.95Z" />
    </>
  ),
  // chart.pie.fill
  stats: (
    <>
      <path d="M11 4.6A8.4 8.4 0 1 0 19.4 13H12a1 1 0 0 1-1-1Z" />
      <path d="M13 2.6V11h8.4A8.4 8.4 0 0 0 13 2.6Z" />
    </>
  ),
};

function TabIcon({ tab }: { tab: Tab }) {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      {ICONS[tab]}
    </svg>
  );
}

/**
 * The tabs, in this order. "Needs attention" is too long for a tab at 375pt wide (five to a
 * bar), so its tab says "Attention"; the screen itself is titled "Needs attention".
 */
export const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'attention', label: 'Attention' },
  { id: 'chat', label: 'Chat' },
  { id: 'housekeeping', label: 'Housekeeping' },
  { id: 'stats', label: 'Stats' },
];

/** Tabs without the round +: Chat has its composer at the bottom, Housekeeping has nothing to add. */
const WITHOUT_ADD: readonly Tab[] = ['chat', 'housekeeping'];

/** True for the tabs that show the round +. */
export function hasAddButton(tab: Tab): boolean {
  return !WITHOUT_ADD.includes(tab);
}

interface TabBarProps {
  tab: Tab;
  onTab(tab: Tab): void;
  /** How many things need attention: a red count on Attention (none at 0). */
  attention?: number;
  /** Messages from others since the chat was last read: a dot on Chat. */
  unread?: boolean;
  /** A message for the housekeeper from someone else since the tab was last open: a dot on Housekeeping. */
  newNote?: boolean;
}

/** "9+" past nine, as iOS shortens a badge. */
const badgeText = (n: number) => (n > 9 ? '9+' : String(n));

/** A tab's name for assistive tech when its badge or dot says something (they are hidden). */
function spokenName(id: Tab, label: string, attention: number, unread: boolean, newNote: boolean): string | undefined {
  if (id === 'attention' && attention > 0) return `${label}, ${attention} ${attention === 1 ? 'item' : 'items'}`;
  if (id === 'chat' && unread) return `${label}, unread messages`;
  if (id === 'housekeeping' && newNote) return `${label}, new message`;
  return undefined;
}

/**
 * The tab bar (docs/ARCHITECTURE.md "Tab bar"): Home, Attention, Chat, Housekeeping and Stats
 * in a capsule of glass floating over the foot of the screen, iOS 26's tab bar. Each tab is
 * its symbol over a short name; the open one is in the tint, on a soft glass highlight that
 * slides to it. A red count on Attention says how many things need attention; a dot on Chat
 * (unread messages) and on Housekeeping (a new message for the housekeeper).
 */
export function TabBar({ tab, onTab, attention = 0, unread = false, newNote = false }: TabBarProps) {
  const index = Math.max(0, TABS.findIndex((t) => t.id === tab));
  return (
    <nav className={styles.bar} aria-label="Tabs" style={{ '--count': TABS.length, '--index': index } as CSSProperties}>
      <span className={styles.highlight} aria-hidden="true" />
      {TABS.map((t) => {
        const badge = t.id === 'attention' && attention > 0;
        const dot = (t.id === 'chat' && unread) || (t.id === 'housekeeping' && newNote);
        return (
          <button
            key={t.id}
            type="button"
            className={styles.tab}
            data-tab={t.id}
            aria-current={tab === t.id ? 'page' : undefined}
            aria-label={spokenName(t.id, t.label, attention, unread, newNote)}
            onClick={() => onTab(t.id)}
          >
            <span className={styles.icon}>
              <TabIcon tab={t.id} />
              {badge ? (
                <span className={styles.badge} aria-hidden="true" data-badge="">
                  {badgeText(attention)}
                </span>
              ) : dot ? (
                <span className={styles.dot} aria-hidden="true" data-dot="" />
              ) : null}
            </span>
            <span className={styles.label}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/**
 * The round add button, floating over the tab bar at the right on Home, Needs attention and
 * Stats. Opens the new-item sheet.
 */
export function AddButton({ tab, onAdd }: { tab: Tab; onAdd(): void }) {
  // It pops in when it comes back from a tab without it, not when the app opens.
  const [wasAway, setWasAway] = useState(false);
  const away = !hasAddButton(tab);
  if (away && !wasAway) setWasAway(true);
  if (away) return null;
  return (
    <button
      type="button"
      className={styles.add}
      aria-label="New item"
      onClick={onAdd}
      data-add-button=""
      data-enter={wasAway || undefined}
    >
      <PlusIcon size={24} strokeWidth={2.8} />
    </button>
  );
}
