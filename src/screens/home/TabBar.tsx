import { useLayoutEffect, useRef, useState } from 'react';
import type { Tab } from '../types';
import { PlusIcon } from '../../ui/icons';
import styles from './TabBar.module.css';

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'chat', label: 'Chat' },
  { id: 'housekeeping', label: 'Housekeeping' },
  { id: 'stats', label: 'Stats' },
];

/** Tabs without the round +: Chat has its composer at the bottom, Housekeeping has nothing to add. */
const WITHOUT_ADD: readonly Tab[] = ['chat', 'housekeeping'];

interface TabBarProps {
  tab: Tab;
  onTab(tab: Tab): void;
  /** Messages from others since the chat was last read: a dot on Chat. */
  unread?: boolean;
}

/**
 * The tab the switch showed last. Every screen draws its own switch (in its header), so a
 * new TabBar mounts on each tab change: its thumb starts there and slides across.
 */
let shownTab: Tab | null = null;

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * The Home / Chat / Housekeeping / Stats switch, just under the hero on every tab: a
 * segmented control whose segments size to their labels and whose white thumb slides to
 * the tab that is open (docs/ARCHITECTURE.md "Housekeeping", "Tab switch").
 */
export function TabBar({ tab, onTab, unread = false }: TabBarProps) {
  const navRef = useRef<HTMLElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  /** Where the thumb was last put, to skip resize callbacks that change nothing. */
  const placed = useRef({ left: -1, width: -1 });
  // Hidden until it has been measured (no flash at the left edge).
  const [measured, setMeasured] = useState(false);

  /** Puts the thumb under `id`'s button; `animate` lets it slide there. False if it can't. */
  const place = (id: Tab, animate: boolean): boolean => {
    const thumb = thumbRef.current;
    const button = navRef.current?.querySelector<HTMLElement>(`[data-tab="${id}"]`);
    if (!thumb || !button) return false;
    const left = button.offsetLeft;
    const width = button.offsetWidth;
    placed.current = { left, width };
    thumb.dataset.animate = String(animate);
    thumb.style.width = `${width}px`;
    thumb.style.transform = `translateX(${left}px)`;
    return true;
  };

  // Slide from the tab shown before (by this switch, or the previous screen's) to this one.
  useLayoutEffect(() => {
    const from = shownTab;
    shownTab = tab;
    if (from && from !== tab && !reducedMotion() && place(from, false)) {
      // Style the old position first, so moving to the new one is a transition.
      void thumbRef.current?.getBoundingClientRect();
      place(tab, true);
    } else {
      place(tab, false);
    }
    setMeasured(true);
  }, [tab]);

  // Labels change size (fonts loading, the window resizing, text zoom): follow at once.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const button = nav.querySelector<HTMLElement>(`[data-tab="${tabRef.current}"]`);
      if (!button) return;
      const { left, width } = placed.current;
      // Observing reports once at the start: leave a slide in progress alone.
      if (button.offsetLeft === left && button.offsetWidth === width) return;
      place(tabRef.current, false);
    });
    ro.observe(nav);
    nav.querySelectorAll('button').forEach((b) => ro.observe(b));
    return () => ro.disconnect();
  }, []);

  return (
    <nav ref={navRef} className={styles.bar} aria-label="Tabs">
      <span ref={thumbRef} className={styles.thumb} data-measured={measured || undefined} aria-hidden="true" />
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={styles.tab}
          data-tab={t.id}
          aria-current={tab === t.id ? 'page' : undefined}
          aria-label={t.id === 'chat' && unread ? 'Chat, unread messages' : undefined}
          onClick={() => onTab(t.id)}
        >
          {/* data-label reserves the bold label's width, so choosing a tab never moves the others. */}
          <span className={styles.label} data-label={t.label}>
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
  // It pops in when it comes back from a tab without it, not when the app opens.
  const [wasAway, setWasAway] = useState(false);
  const away = WITHOUT_ADD.includes(tab);
  if (away && !wasAway) setWasAway(true);
  if (away) return null;
  return (
    <button
      type="button"
      className={styles.add}
      aria-label="New item"
      onClick={onAdd}
      data-enter={wasAway || undefined}
    >
      {/* Same visible size as the 32px "add" glyph in the design: 18px across, 3px stroke. */}
      <PlusIcon size={25} strokeWidth={2.9} />
    </button>
  );
}
