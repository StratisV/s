import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatScreen } from './screens/chat/ChatScreen';
import { AreaSheet } from './screens/home/AreaSheet';
import { HomeScreen } from './screens/home/HomeScreen';
import { NeedsAttentionScreen } from './screens/home/NeedsAttentionScreen';
import { rowFallback, rowsBeside } from './screens/home/rowFocus';
import { AddButton, hasAddButton, TabBar } from './screens/home/TabBar';
import { HousekeepingScreen } from './screens/housekeeping/HousekeepingScreen';
import { TaskListSheet } from './screens/housekeeping/TaskListSheet';
import { useNewNote } from './screens/housekeeping/useNewNote';
import { ItemSheet } from './screens/item/ItemSheet';
import { ErrorScreen } from './screens/onboarding/ErrorScreen';
import { Onboarding } from './screens/onboarding/Onboarding';
import { ProfileScreen } from './screens/profile/ProfileScreen';
import { useSharedLink } from './screens/share/useSharedLink';
import { DoneSheet, type DoneTarget } from './screens/stats/DoneSheet';
import { StatsScreen } from './screens/stats/StatsScreen';
import { upNext } from './lib/logic/upNext';
import type { ISODate } from './lib/types';
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
  else if (phase.kind === 'error') content = <ErrorScreen message={phase.message} offline={phase.offline} />;
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
  /** The target's section, whose heading is the last fallback (the chosen day under the calendar). */
  section: HTMLElement | null;
}

/**
 * The focused control in `root` (the stage, or an area's sheet), if it was focused from the
 * keyboard. A tap leaves nothing to return to, so closing never scrolls or rings a row.
 */
function takeFocusReturn(root: HTMLElement | null): FocusReturn | null {
  const el = document.activeElement;
  if (!root || !(el instanceof HTMLElement) || !root.contains(el) || !isFocusVisible(el)) return null;
  // The rows in its own list: a group's or a sheet's, or the chosen day's under the calendar.
  const rows = rowsBeside(el, root);
  const i = rows.indexOf(el);
  const nearby = i < 0 ? [] : [...rows.slice(i + 1), ...rows.slice(0, i).reverse()];
  return { target: el, nearby, section: el.closest('section') };
}

/** True when focus was left behind: on the page, or in a sheet that is closing. */
function focusLeftBehind(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !!active.closest('[role="dialog"]');
}

/**
 * After a sheet opened by a tap closes (VoiceOver's double tap is one too): back to the control
 * that opened it (`opener()`), or `fallback` if that has gone. Programmatic focus after a tap
 * shows no ring.
 */
function returnToOpener(opener: () => HTMLElement | null, root: HTMLElement, fallback?: string) {
  if (!focusLeftBehind()) return;
  const el = opener();
  const target = el && el.isConnected && root.contains(el) ? el : fallback ? root.querySelector<HTMLElement>(fallback) : null;
  target?.focus({ preventScroll: true });
}

const TAB_IDS: readonly Tab[] = ['home', 'attention', 'chat', 'housekeeping', 'stats'];
/** Where this device keeps the tab last open, so the app reopens on it. */
const TAB_KEY = 'homeos.tab';

function loadTab(): Tab {
  try {
    const stored = localStorage.getItem(TAB_KEY);
    return TAB_IDS.find((t) => t === stored) ?? 'home';
  } catch {
    return 'home';
  }
}

function storeTab(tab: Tab) {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    /* storage unavailable: the app opens on Home */
  }
}

function restoreFocus({ target, nearby, section }: FocusReturn, root: HTMLElement, fallback?: string) {
  if (!focusLeftBehind()) return;
  const reachable = (el: HTMLElement | null | undefined): el is HTMLElement => !!el && el.isConnected && root.contains(el);
  const next =
    [target, ...nearby].find(reachable) ??
    [rowFallback(section)].find(reachable) ??
    (fallback ? root.querySelector<HTMLElement>(fallback) : null);
  next?.focus({ preventScroll: true });
}

/** The open area sheet's dialog. */
function areaPanel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-area-sheet]')?.closest<HTMLElement>('[role="dialog"]') ?? null;
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

/** Which screen shows an item just saved: Home (its area's card), Needs attention, or the area's sheet. */
type RevealIn = 'home' | 'attention' | 'area';

function MainShell() {
  const { unread } = useChat();
  const { data, today } = useHousehold();
  // The tab last open on this device (the housekeeper reopens on Housekeeping).
  const [tab, setTab] = useState<Tab>(loadTab);
  useEffect(() => storeTab(tab), [tab]);
  const newNote = useNewNote(tab === 'housekeeping');
  // How many things need attention across the house: the count on the Attention tab.
  const attention = useMemo(() => upNext(data.items, today).counts.attention, [data.items, today]);
  const [sheetTarget, setSheetTarget] = useState<ItemSheetTarget | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  // An area opened from its card on Home (or a shared link), in a page sheet.
  const [areaId, setAreaId] = useState<string | null>(null);
  const [areaOpen, setAreaOpen] = useState(false);
  const [areaKey, setAreaKey] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  // Housekeeping's task list sheet (a page sheet, like the Item sheet), and the button that opened it.
  const [taskListOpen, setTaskListOpen] = useState(false);
  const taskListOpener = useRef<HTMLElement | null>(null);
  const openTaskList = useCallback((opener: HTMLElement) => {
    taskListOpener.current = opener;
    setTaskListOpen(true);
  }, []);
  // Stats' tasks behind the circle (a page sheet too), and what opened it.
  const [doneOpen, setDoneOpen] = useState(false);
  const [doneTarget, setDoneTarget] = useState<DoneTarget>({ period: 'month', memberId: null });
  const openDone = useCallback((target: DoneTarget, opener: HTMLElement) => {
    taskListOpener.current = opener;
    setDoneTarget(target);
    setDoneOpen(true);
  }, []);
  const pushed = sheetOpen || taskListOpen || doneOpen || areaOpen;
  // The Item sheet over an area's sheet.
  const stacked = areaOpen && sheetOpen;
  // The item just saved, for the screen behind the sheet to bring into view.
  const [reveal, setReveal] = useState<{ id: string; in: RevealIn } | null>(null);
  const clearReveal = useCallback(() => setReveal(null), []);
  const revealFor = (where: RevealIn) => (reveal?.in === where ? reveal.id : null);
  // A day Needs attention's calendar sends to Housekeeping (its visit), for Housekeeping to show.
  const [housekeepingDay, setHousekeepingDay] = useState<ISODate | null>(null);
  const clearHousekeepingDay = useCallback(() => setHousekeepingDay(null), []);
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

  // Where keyboard focus was when a sheet opened. Taken before the stage
  // goes inert below (effects run in order), which would blur it.
  const sheetReturn = useRef<FocusReturn | null>(null);
  useEffect(() => {
    if (pushed) sheetReturn.current = takeFocusReturn(stageRef.current);
  }, [pushed]);

  // While a sheet or the Profile cover is up, the screen behind can't be focused or tapped.
  const covered = pushed || profileOpen;
  useEffect(() => {
    if (stageRef.current) stageRef.current.inert = covered;
  }, [covered]);

  // For the strip behind the status bar (StatusSky): Profile covers the hero; behind a sheet the screen goes black.
  useEffect(() => {
    const html = document.documentElement;
    html.toggleAttribute('data-cover', profileOpen);
    html.toggleAttribute('data-sheet', pushed);
    return () => {
      html.removeAttribute('data-cover');
      html.removeAttribute('data-sheet');
    };
  }, [profileOpen, pushed]);

  // The toast floats over the round + where there is one (Toast.module.css).
  useEffect(() => {
    document.documentElement.toggleAttribute('data-add', hasAddButton(tab));
    return () => document.documentElement.removeAttribute('data-add');
  }, [tab]);

  // The area whose sheet is (or was last) open, for focus to go back to its card.
  const areaOpener = useRef<string | null>(null);
  // Once the stage is interactive again, focus goes back to the row or card (or the + button);
  // from the task list or Stats' sheet, to the button that opened it, however it was opened;
  // from an area's sheet, to its card. The Profile cover returns focus itself (ProfileScreen).
  useEffect(() => {
    if (covered) return;
    const ret = sheetReturn.current;
    sheetReturn.current = null;
    const opener = taskListOpener.current;
    taskListOpener.current = null;
    const area = areaOpener.current;
    areaOpener.current = null;
    const stage = stageRef.current;
    if (!stage) return;
    if (ret) restoreFocus(ret, stage, 'button[data-add-button]');
    else if (opener) returnToOpener(() => opener, stage, 'button[aria-label="Edit task list"]');
    else if (area) returnToOpener(() => stage.querySelector<HTMLElement>(`li[data-area-id="${area}"] button`), stage);
  }, [covered]);

  // Where keyboard focus was in an area's sheet when the Item sheet opened over it, taken as it
  // opens (the sheet then goes inert); and once the Item sheet has gone, focus goes back there.
  const stackReturn = useRef<FocusReturn | null>(null);
  const wasStacked = useRef(false);
  useEffect(() => {
    if (stacked) {
      wasStacked.current = true;
      return;
    }
    if (!wasStacked.current) return;
    wasStacked.current = false;
    const ret = stackReturn.current;
    stackReturn.current = null;
    const panel = areaPanel();
    if (!panel) return;
    if (ret) restoreFocus(ret, panel);
    // After a tap, into the sheet (on itself, without a ring), so focus is never lost.
    if (focusLeftBehind() && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
  }, [stacked]);

  const openSheet = useCallback(
    (target: ItemSheetTarget) => {
      if (areaOpen) stackReturn.current = takeFocusReturn(areaPanel());
      setSheetTarget(target);
      setSheetKey((k) => k + 1);
      setSheetOpen(true);
    },
    [areaOpen],
  );

  const openArea = useCallback((id: string) => {
    areaOpener.current = id;
    setAreaId(id);
    setAreaKey((k) => k + 1);
    setAreaOpen(true);
  }, []);
  const closeArea = useCallback(() => {
    setAreaOpen(false);
    setReveal((r) => (r?.in === 'area' ? null : r));
  }, []);

  // Leaving a tab drops a saved item it hasn't shown yet, so it can't scroll that tab on a later return.
  const switchTab = useCallback((next: Tab) => {
    setTab(next);
    setReveal(null);
    if (next !== 'housekeeping') setHousekeepingDay(null);
  }, []);
  const openHousekeepingDay = useCallback(
    (date: ISODate) => {
      switchTab('housekeeping');
      setHousekeepingDay(date);
    },
    [switchTab],
  );

  // Opened from a shared link: the item's sheet (?item=), or the area's on Home (?area=).
  useSharedLink({
    openItem: (itemId) => openSheet({ kind: 'edit', itemId }),
    showArea: (id) => {
      switchTab('home');
      openArea(id);
    },
  });

  // A save shows where the item went, on whatever is behind the sheet.
  const onSaved = (itemId: string) => {
    if (areaOpen) setReveal({ id: itemId, in: 'area' });
    else if (tab === 'home' || tab === 'attention') setReveal({ id: itemId, in: tab });
  };

  const openProfile = () => setProfileOpen(true);
  const openItem = (itemId: string) => openSheet({ kind: 'edit', itemId });

  return (
    <div className={styles.main} data-pushed={pushed || undefined}>
      <div ref={stageRef} className={styles.stage}>
        {tab === 'home' ? (
          <HomeScreen
            onOpenProfile={openProfile}
            onOpenArea={openArea}
            onOpenAttention={() => switchTab('attention')}
            revealItem={revealFor('home')}
            onRevealed={clearReveal}
          />
        ) : tab === 'attention' ? (
          <NeedsAttentionScreen
            onOpenItem={openItem}
            onOpenProfile={openProfile}
            revealItem={revealFor('attention')}
            onRevealed={clearReveal}
            onOpenHousekeeping={openHousekeepingDay}
          />
        ) : tab === 'chat' ? (
          <ChatScreen onOpenProfile={openProfile} />
        ) : tab === 'housekeeping' ? (
          <HousekeepingScreen
            onOpenProfile={openProfile}
            onEditTasks={openTaskList}
            showDay={housekeepingDay}
            onDayShown={clearHousekeepingDay}
          />
        ) : (
          <StatsScreen onOpenProfile={openProfile} onOpenDone={openDone} />
        )}
        <AddButton tab={tab} onAdd={() => openSheet({ kind: 'new' })} />
        <TabBar tab={tab} onTab={switchTab} attention={attention} unread={unread} newNote={newNote} />
        <div className={styles.dim} aria-hidden="true" />
      </div>
      {areaId ? (
        <AreaSheet
          key={areaKey}
          areaId={areaId}
          open={areaOpen}
          onClose={closeArea}
          onExited={() => setAreaId(null)}
          onOpenItem={openItem}
          onAddItem={(id) => openSheet({ kind: 'new', areaId: id })}
          revealItem={revealFor('area')}
          onRevealed={clearReveal}
          behind={stacked}
        />
      ) : null}
      {sheetTarget ? (
        <ItemSheet
          key={sheetKey}
          target={sheetTarget}
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onExited={() => setSheetTarget(null)}
          onSaved={onSaved}
        />
      ) : null}
      <TaskListSheet open={taskListOpen} onClose={() => setTaskListOpen(false)} />
      <DoneSheet open={doneOpen} target={doneTarget} onClose={() => setDoneOpen(false)} />
      <ProfileScreen open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
