import { useCallback, useEffect, useRef, useState } from 'react';
import { HomeScreen } from './screens/home/HomeScreen';
import { TabBar } from './screens/home/TabBar';
import { ItemSheet } from './screens/item/ItemSheet';
import { Onboarding } from './screens/onboarding/Onboarding';
import { ProfileScreen } from './screens/profile/ProfileScreen';
import { StatsScreen } from './screens/stats/StatsScreen';
import type { ItemSheetTarget, Tab } from './screens/types';
import { useHome } from './state/HomeProvider';
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

function MainApp() {
  const [tab, setTab] = useState<Tab>('home');
  const [sheetTarget, setSheetTarget] = useState<ItemSheetTarget | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
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

  // While a sheet or the Profile cover is up, the screen behind can't be focused or tapped.
  const covered = sheetOpen || profileOpen;
  useEffect(() => {
    if (stageRef.current) stageRef.current.inert = covered;
  }, [covered]);

  const openSheet = useCallback((target: ItemSheetTarget) => {
    setSheetTarget(target);
    setSheetKey((k) => k + 1);
    setSheetOpen(true);
  }, []);

  return (
    <div className={styles.main} data-pushed={sheetOpen || undefined}>
      <div ref={stageRef} className={styles.stage}>
        {tab === 'home' ? (
          <HomeScreen onOpenItem={(itemId) => openSheet({ kind: 'edit', itemId })} onOpenProfile={() => setProfileOpen(true)} />
        ) : (
          <StatsScreen onOpenProfile={() => setProfileOpen(true)} />
        )}
        <TabBar tab={tab} onTab={setTab} onAdd={() => openSheet({ kind: 'new' })} />
        <div className={styles.dim} aria-hidden="true" />
      </div>
      {sheetTarget ? (
        <ItemSheet
          key={sheetKey}
          target={sheetTarget}
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onExited={() => setSheetTarget(null)}
        />
      ) : null}
      <ProfileScreen open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
