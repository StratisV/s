import { useEffect } from 'react';
import { FamilyScreen } from './features/family/FamilyScreen';
import { PowerupsScreen } from './features/library/PowerupsScreen';
import { MeditateScreen } from './features/meditate/MeditateScreen';
import { WeeklyScreen } from './features/weekly/WeeklyScreen';
import { navigate, useRoute } from './lib/route';
import type { TabId } from './types';
import { TabBar } from './ui/TabBar';

const TITLES: Record<TabId, string> = {
  meditate: 'Meditate',
  powerups: 'Powerups',
  family: 'Your family',
  weekly: 'This Week',
};

export function App() {
  const route = useRoute();

  useEffect(() => {
    document.title = `${TITLES[route.tab]} · Parent Powerup`;
  }, [route.tab]);

  // A new tab opens at its top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.tab]);

  return (
    <>
      {route.tab === 'meditate' && <MeditateScreen />}
      {route.tab === 'powerups' && <PowerupsScreen />}
      {route.tab === 'family' && <FamilyScreen />}
      {route.tab === 'weekly' && <WeeklyScreen />}
      <TabBar current={route.tab} onSelect={(tab) => navigate({ tab })} />
    </>
  );
}
