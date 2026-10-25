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
  // flag.fill: the week's goals
  goals: (
    <path d="M5.6 2.9c.6 0 1.1.5 1.1 1.1v.2c1.4-.8 3-1 4.9-.4l1.6.5c1.6.5 3.1.4 4.6-.4.7-.4 1.6.1 1.6.9v8.6c0 .5-.3.9-.7 1.1-1.9 1-3.9 1.2-6 .6l-1.6-.5c-1.5-.5-2.9-.3-4.4.5v6.2a1.1 1.1 0 0 1-2.2 0V4c0-.6.5-1.1 1.1-1.1Z" />
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
 * The tabs, in this order. "Goals for the week" is too long for a tab, so its tab says
 * "Goals"; the screen itself is titled "Goals for the week".
 */
export const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'goals', label: 'Goals' },
  { id: 'housekeeping', label: 'Housekeeping' },
  { id: 'stats', label: 'Stats' },
];

/** Tabs without the round +: Housekeeping has nothing to add. */
const WITHOUT_ADD: readonly Tab[] = ['housekeeping'];

/** True for the tabs that show the round +. Goals has its own Add a Goal, in its list. */
export function hasAddButton(tab: Tab): boolean {
  return tab !== 'goals' && !WITHOUT_ADD.includes(tab);
}

interface TabBarProps {
  tab: Tab;
  onTab(tab: Tab): void;
  /** How many of this week's goals are not done: a count on Goals (none at 0). */
  goals?: number;
  /** A message for the housekeeper from someone else since the tab was last open: a dot on Housekeeping. */
  newNote?: boolean;
}

/** "9+" past nine, as iOS shortens a badge. */
const badgeText = (n: number) => (n > 9 ? '9+' : String(n));

/** A tab's name for assistive tech when its badge or dot says something (they are hidden). */
function spokenName(id: Tab, label: string, goals: number, newNote: boolean): string | undefined {
  if (id === 'goals' && goals > 0) return `${label}, ${goals} not done`;
  if (id === 'housekeeping' && newNote) return `${label}, new message`;
  return undefined;
}

/**
 * The tab bar (docs/ARCHITECTURE.md "Tab bar"): Home, Goals, Housekeeping and Stats in frosted
 * glass docked on the bottom edge. Each tab is its symbol over a short name; the open one is in
 * the tint, on a soft highlight that slides to it. A count on Goals says how many of this
 * week's goals are not done; a dot on Housekeeping says there is a new message for the
 * housekeeper.
 */
export function TabBar({ tab, onTab, goals = 0, newNote = false }: TabBarProps) {
  const index = Math.max(0, TABS.findIndex((t) => t.id === tab));
  return (
    <nav className={styles.bar} aria-label="Tabs" style={{ '--count': TABS.length, '--index': index } as CSSProperties}>
      <span className={styles.highlight} aria-hidden="true" />
      {TABS.map((t) => {
        const badge = t.id === 'goals' && goals > 0;
        const dot = t.id === 'housekeeping' && newNote;
        return (
          <button
            key={t.id}
            type="button"
            className={styles.tab}
            data-tab={t.id}
            aria-current={tab === t.id ? 'page' : undefined}
            aria-label={spokenName(t.id, t.label, goals, newNote)}
            onClick={() => onTab(t.id)}
          >
            <span className={styles.icon}>
              <TabIcon tab={t.id} />
              {badge ? (
                <span className={styles.badge} aria-hidden="true" data-badge="">
                  {badgeText(goals)}
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
 * The round add button, floating over the tab bar at the right on the tabs that have it
 * (hasAddButton()). Opens the new-item sheet.
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
