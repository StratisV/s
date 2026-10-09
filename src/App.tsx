import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatScreen } from './screens/chat/ChatScreen';
import { inCollapsedArea } from './screens/home/areaPanel';
import { HomeScreen } from './screens/home/HomeScreen';
import { AddButton, TabBar } from './screens/home/TabBar';
import { ItemSheet } from './screens/item/ItemSheet';
import { Onboarding } from './screens/onboarding/Onboarding';
import { ProfileScreen } from './screens/profile/ProfileScreen';
import { useSharedLink } from './screens/share/useSharedLink';
import { StatsScreen } from './screens/stats/StatsScreen';
import type { ItemSheetTarget, Tab } from './screens/types';
import { ChatProvider, useChat } from './state/ChatProvider';
import { useHome, useHousehold } from './state/HomeProvider';
import { StatusSky } from './ui/StatusSky';
import { Toast } from './ui/Toast';
import styles from './App.module.css';

export default function App() {
  const { phase, onboardingTail } = useHome();

  let content;
  if (phase.kind === 'loading') content = <div className={styles.splash} aria-busy="true" />;
  else if (phase.kind === 'error') content = <ErrorScreen message={phase.message} />;
  else if (phase.kind === 'ready' && !onboardingTail) content = <MainApp />;
  else content = <Onboarding />;

  return (
    <div className={styles.viewport}>
      <div className={styles.column}>{content}</div>
      <StatusSky />
      <Toast />
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className={styles.error} role="alert">
      <p>{message}</p>
      <button type="button" onClick={() => window.location.reload()}>
        Try again
      </button>
    </div>
  );
}

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false; // engines without :focus-visible
  }
}

interface FocusReturn {
  target: HTMLElement;
  /** Fallbacks if the target's row is gone (completed or deleted): the rows after it, then before it. */
  nearby: HTMLElement[];
  /** The target's area, whose name (a disclosure button) is the last fallback on Home. */
  section: HTMLElement | null;
}

/**
 * The focused control in the stage, if it was focused from the keyboard. A tap
 * leaves nothing to return to, so closing never scrolls or rings a row.
 */
function takeFocusReturn(stage: HTMLElement | null): FocusReturn | null {
  const el = document.activeElement;
  if (!stage || !(el instanceof HTMLElement) || !stage.contains(el) || !isFocusVisible(el)) return null;
  const rows = Array.from(stage.querySelectorAll<HTMLElement>('[data-item-open]'));
  const i = rows.indexOf(el);
  const nearby = i < 0 ? [] : [...rows.slice(i + 1), ...rows.slice(0, i).reverse()];
  return { target: el, nearby, section: el.closest('section') };
}

function restoreFocus({ target, nearby, section }: FocusReturn, stage: HTMLElement) {
  // Only when focus was left behind (on the page, or in the closing sheet).
  const active = document.activeElement;
  if (active && active !== document.body && !active.closest('[role="dialog"]')) return;
  // Rows in a collapsed area can't take focus: skip them.
  const reachable = (el: HTMLElement | null | undefined): el is HTMLElement =>
    !!el && el.isConnected && stage.contains(el) && !inCollapsedArea(el);
  const next =
    [target, ...nearby].find(reachable) ??
    [section?.querySelector<HTMLElement>('button[aria-expanded]')].find(reachable) ??
    stage.querySelector<HTMLElement>('button[aria-label="New item"]');
  next?.focus({ preventScroll: true });
}

/** The ready app: the chat lives as long as the household is open (its tab comes and goes). */
function MainApp() {
  const { data } = useHousehold();
  return (
    <ChatProvider key={data.household.id}>
      <MainShell />
    </ChatProvider>
  );
}

function MainShell() {
  const { unread } = useChat();
  const [tab, setTab] = useState<Tab>('home');
  const [sheetTarget, setSheetTarget] = useState<ItemSheetTarget | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  // The area an item was just saved into, for Home to expand if it is collapsed.
  const [revealArea, setRevealArea] = useState<string | null>(null);
  const clearReveal = useCallback(() => setRevealArea(null), []);
  // The area a shared link (?area=) points at, for Home to open and scroll to.
  const [linkedArea, setLinkedArea] = useState<string | null>(null);
  const clearLinkedArea = useCallback(() => setLinkedArea(null), []);
  const stageRef = useRef<HTMLDivElement>(null);

  // Page-sheet push-back: scale the stage so it sits 18px in from each side.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width || 402;
      el.style.setProperty('--stage-scale', String((w - 36) / w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Where keyboard focus was when the Item sheet opened. Taken before the stage
  // goes inert below (effects run in order), which would blur it.
  const sheetReturn = useRef<FocusReturn | null>(null);
  useEffect(() => {
    if (sheetOpen) sheetReturn.current = takeFocusReturn(stageRef.current);
  }, [sheetOpen]);

  // While a sheet or the Profile cover is up, the screen behind can't be focused or tapped.
  const covered = sheetOpen || profileOpen;
  useEffect(() => {
    if (stageRef.current) stageRef.current.inert = covered;
  }, [covered]);

  // For the strip behind the status bar (StatusSky): Profile covers the hero; behind a sheet the screen goes black.
  useEffect(() => {
    const html = document.documentElement;
    html.toggleAttribute('data-cover', profileOpen);
    html.toggleAttribute('data-sheet', sheetOpen);
    return () => {
      html.removeAttribute('data-cover');
      html.removeAttribute('data-sheet');
    };
  }, [profileOpen, sheetOpen]);

  // Once the stage is interactive again, focus goes back to the row (or the + button).
  // The Profile cover returns focus itself (ProfileScreen).
  useEffect(() => {
    if (covered) return;
    const ret = sheetReturn.current;
    sheetReturn.current = null;
    if (ret && stageRef.current) restoreFocus(ret, stageRef.current);
  }, [covered]);

  const openSheet = useCallback((target: ItemSheetTarget) => {
    setSheetTarget(target);
    setSheetKey((k) => k + 1);
    setSheetOpen(true);
  }, []);

  // Opened from a shared link (?item= or ?area=).
  useSharedLink({
    openItem: (itemId) => openSheet({ kind: 'edit', itemId }),
    showArea: (areaId) => {
      setTab('home');
      setLinkedArea(areaId);
    },
  });

  // The tab switch sits under the hero on every tab.
  const tabs = <TabBar tab={tab} onTab={setTab} unread={unread} />;

  return (
    <div className={styles.main} data-pushed={sheetOpen || undefined}>
      <div ref={stageRef} className={styles.stage}>
        {tab === 'home' ? (
          <HomeScreen
            tabs={tabs}
            onOpenItem={(itemId) => openSheet({ kind: 'edit', itemId })}
            onOpenProfile={() => setProfileOpen(true)}
            onAddItem={(areaId) => openSheet({ kind: 'new', areaId })}
            revealArea={revealArea}
            onRevealed={clearReveal}
            linkedArea={linkedArea}
            onLinkedAreaShown={clearLinkedArea}
          />
        ) : tab === 'chat' ? (
          <ChatScreen tabs={tabs} onOpenProfile={() => setProfileOpen(true)} />
        ) : (
          <StatsScreen tabs={tabs} onOpenProfile={() => setProfileOpen(true)} />
        )}
        <AddButton tab={tab} onAdd={() => openSheet({ kind: 'new' })} />
        <div className={styles.dim} aria-hidden="true" />
      </div>
      {sheetTarget ? (
        <ItemSheet
          key={sheetKey}
          target={sheetTarget}
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onExited={() => setSheetTarget(null)}
          onSaved={setRevealArea}
        />
      ) : null}
      <ProfileScreen open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
