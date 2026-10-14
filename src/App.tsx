import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatScreen } from './screens/chat/ChatScreen';
import { inCollapsedArea, rowFallback, rowsBeside } from './screens/home/areaPanel';
import { HomeScreen } from './screens/home/HomeScreen';
import { AddButton, TabBar } from './screens/home/TabBar';
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
  /** The target's area, whose name (a disclosure button) is the last fallback on Home (the chosen day under the calendar). */
  section: HTMLElement | null;
}

/**
 * The focused control in the stage, if it was focused from the keyboard. A tap
 * leaves nothing to return to, so closing never scrolls or rings a row.
 */
function takeFocusReturn(stage: HTMLElement | null): FocusReturn | null {
  const el = document.activeElement;
  if (!stage || !(el instanceof HTMLElement) || !stage.contains(el) || !isFocusVisible(el)) return null;
  // The rows in its own list: the areas', or the chosen day's under Home's calendar.
  const rows = rowsBeside(el, stage);
  const i = rows.indexOf(el);
  const nearby = i < 0 ? [] : [...rows.slice(i + 1), ...rows.slice(0, i).reverse()];
  return { target: el, nearby, section: el.closest('section') };
}

/**
 * After the task list sheet closes when it was opened by a tap (VoiceOver's double tap is
 * one too): back to the button that opened it, or Edit task list if that has gone (Add
 * tasks goes once there are tasks). Programmatic focus after a tap shows no ring.
 */
function returnToOpener(opener: HTMLElement, stage: HTMLElement) {
  const active = document.activeElement;
  if (active && active !== document.body && !active.closest('[role="dialog"]')) return;
  const target =
    opener.isConnected && stage.contains(opener)
      ? opener
      : stage.querySelector<HTMLElement>('button[aria-label="Edit task list"]');
  target?.focus({ preventScroll: true });
}

const TAB_IDS: readonly Tab[] = ['home', 'chat', 'housekeeping', 'stats'];
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

function restoreFocus({ target, nearby, section }: FocusReturn, stage: HTMLElement) {
  // Only when focus was left behind (on the page, or in the closing sheet).
  const active = document.activeElement;
  if (active && active !== document.body && !active.closest('[role="dialog"]')) return;
  // Rows in a collapsed area can't take focus: skip them.
  const reachable = (el: HTMLElement | null | undefined): el is HTMLElement =>
    !!el && el.isConnected && stage.contains(el) && !inCollapsedArea(el);
  const next =
    [target, ...nearby].find(reachable) ??
    [rowFallback(section)].find(reachable) ??
    stage.querySelector<HTMLElement>('button[data-add-button]');
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
  const { data } = useHousehold();
  // The tab last open on this device (the housekeeper reopens on Housekeeping).
  const [tab, setTab] = useState<Tab>(loadTab);
  useEffect(() => storeTab(tab), [tab]);
  const newNote = useNewNote(tab === 'housekeeping');
  const [sheetTarget, setSheetTarget] = useState<ItemSheetTarget | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
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
  const pushed = sheetOpen || taskListOpen || doneOpen;
  // The area an item was just saved into, for Home to expand if it is collapsed.
  const [revealArea, setRevealArea] = useState<string | null>(null);
  const clearReveal = useCallback(() => setRevealArea(null), []);
  // The area a shared link (?area=) points at, for Home to open and scroll to.
  const [linkedArea, setLinkedArea] = useState<string | null>(null);
  const clearLinkedArea = useCallback(() => setLinkedArea(null), []);
  // The room the round + adds to (the one a shared link opened on Home), if any.
  const [addRoom, setAddRoom] = useState<string | null>(null);
  const addRoomName = addRoom ? (data.areas.find((a) => a.id === addRoom)?.name ?? null) : null;
  // A day Home's calendar sends to Housekeeping (its visit), for Housekeeping to show.
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

  // Once the stage is interactive again, focus goes back to the row (or the + button); from
  // the task list, to the button that opened it, however it was opened.
  // The Profile cover returns focus itself (ProfileScreen).
  useEffect(() => {
    if (covered) return;
    const ret = sheetReturn.current;
    sheetReturn.current = null;
    const opener = taskListOpener.current;
    taskListOpener.current = null;
    const stage = stageRef.current;
    if (!stage) return;
    if (ret) restoreFocus(ret, stage);
    else if (opener) returnToOpener(opener, stage);
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

  // Leaving Home drops an area link it hasn't shown yet, so it can't scroll Home on a later return.
  const switchTab = useCallback((next: Tab) => {
    setTab(next);
    if (next !== 'home') setLinkedArea(null);
    if (next !== 'housekeeping') setHousekeepingDay(null);
  }, []);
  const openHousekeepingDay = useCallback(
    (date: ISODate) => {
      switchTab('housekeeping');
      setHousekeepingDay(date);
    },
    [switchTab],
  );

  // The tab switch sits under the hero on every tab.
  const tabs = <TabBar tab={tab} onTab={switchTab} unread={unread} newNote={newNote} />;

  return (
    <div className={styles.main} data-pushed={pushed || undefined}>
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
            onRoomContext={setAddRoom}
            onOpenHousekeeping={openHousekeepingDay}
          />
        ) : tab === 'chat' ? (
          <ChatScreen tabs={tabs} onOpenProfile={() => setProfileOpen(true)} />
        ) : tab === 'housekeeping' ? (
          <HousekeepingScreen
            tabs={tabs}
            onOpenProfile={() => setProfileOpen(true)}
            onEditTasks={openTaskList}
            showDay={housekeepingDay}
            onDayShown={clearHousekeepingDay}
          />
        ) : (
          <StatsScreen tabs={tabs} onOpenProfile={() => setProfileOpen(true)} onOpenDone={openDone} />
        )}
        <AddButton
          tab={tab}
          room={tab === 'home' && addRoom && addRoomName ? addRoomName : null}
          onAdd={() => openSheet(tab === 'home' && addRoom && addRoomName ? { kind: 'new', areaId: addRoom } : { kind: 'new' })}
        />
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
      <TaskListSheet open={taskListOpen} onClose={() => setTaskListOpen(false)} />
      <DoneSheet open={doneOpen} target={doneTarget} onClose={() => setDoneOpen(false)} />
      <ProfileScreen open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
