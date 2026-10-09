import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  buildRows,
  reactionChipLabel,
  senderOf,
  stampLabel,
  summarizeReactions,
  type ChatEntry,
} from '../../lib/logic/chat';
import { useChat } from '../../state/ChatProvider';
import { useHousehold } from '../../state/HomeProvider';
import { ActionSheet } from '../../ui/ActionSheet';
import { Avatar } from '../../ui/Avatar';
import { LargeTitle } from '../../ui/Screen';
import { copyText } from './clipboard';
import { Composer } from './Composer';
import { ArrowDownIcon } from './icons';
import { MessageMenu, type MenuAction } from './MessageMenu';
import { MessageRow, type ChipView } from './MessageRow';
import { useKeyboardInset } from './useKeyboardInset';
import styles from './ChatScreen.module.css';

interface ChatScreenProps {
  onOpenProfile(): void;
  /** The composer has focus (the tab bar steps aside while typing). */
  onTypingChange(typing: boolean): void;
}

/** Closer than this to the bottom counts as "at the bottom" (new messages follow, and it counts as read). */
const NEAR_BOTTOM = 80;
/** Older messages load when you scroll this close to the top. */
const NEAR_TOP = 400;

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

interface MenuState {
  key: string;
  anchor: DOMRect;
  bubble: HTMLElement;
}

/**
 * The household group chat (docs/ARCHITECTURE.md "Chat"): large title, the
 * messages as a log (newest at the bottom, older ones load as you scroll up),
 * reactions, the long-press menu, and the composer above the tab bar.
 */
export function ChatScreen({ onOpenProfile, onTypingChange }: ChatScreenProps) {
  const { data, me, showToast } = useHousehold();
  const chat = useChat();
  const { entries, status, hasMore, loadingOlder, loadOlder, markRead } = chat;
  const timeZone = data.household.timezone;

  // Day labels ("Today") move on at midnight.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const rows = useMemo(() => buildRows(entries, me.id, timeZone, now), [entries, me.id, timeZone, now]);

  // ── Typing and the keyboard ─────────────────────────────

  const [typing, setTyping] = useState(false);
  const keyboard = useKeyboardInset(typing);

  // Tapping something in the list while typing (a chip, a retry) blurs the field. The tab
  // bar and composer then move, so wait until that tap has landed before they do.
  const pointerDown = useRef(false);
  const blurWaiting = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>();
  const onComposerFocus = useCallback((focused: boolean) => {
    blurWaiting.current = false;
    if (focused) {
      setTyping(true);
    } else if (pointerDown.current) {
      blurWaiting.current = true;
      // In case the press never reports its end.
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        pointerDown.current = false;
        if (!blurWaiting.current) return;
        blurWaiting.current = false;
        setTyping(false);
      }, 1500);
    } else {
      setTyping(false);
    }
  }, []);
  useEffect(() => {
    const release = () => {
      if (!pointerDown.current) return;
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        pointerDown.current = false;
        if (blurWaiting.current) {
          blurWaiting.current = false;
          setTyping(false);
        }
      }, 250);
    };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    return () => {
      clearTimeout(settleTimer.current);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
    };
  }, []);
  const typingRef = useRef(onTypingChange);
  typingRef.current = onTypingChange;
  useEffect(() => typingRef.current(typing), [typing]);
  useEffect(() => () => typingRef.current(false), []);

  const composerRef = useRef<HTMLFormElement>(null);
  const [composerHeight, setComposerHeight] = useState(48);
  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const measure = () => setComposerHeight(Math.round(el.offsetHeight) || 48);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The toast floats just above the composer here (Toast reads --toast-bottom).
  useEffect(() => {
    const root = document.documentElement.style;
    const above = `${composerHeight + 12}px`;
    root.setProperty(
      '--toast-bottom',
      !typing
        ? `calc(var(--tabbar-bottom) + var(--tabbar-height) + 10px + ${above})`
        : keyboard > 0
          ? `calc(${keyboard + 8}px + ${above})`
          : `calc(max(10px, var(--bottom-inset)) + ${above})`,
    );
  }, [composerHeight, typing, keyboard]);
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty('--toast-bottom');
    },
    [],
  );

  // ── Scrolling ───────────────────────────────────────────

  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showNew, setShowNew] = useState(false);
  /** Scroll metrics after the last render, to keep the view still when older messages load above. */
  const lastMetrics = useRef({ height: 0, top: 0 });
  const firstKey = useRef<string | null>(null);
  const lastKey = useRef<string | null>(null);
  const placed = useRef(false);

  const readIfVisible = useCallback(() => {
    if (atBottom.current && document.visibilityState === 'visible') markRead();
  }, [markRead]);

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollHeight;
    if (smooth && !prefersReducedMotion() && typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: 'smooth' });
    else el.scrollTop = top;
    atBottom.current = true;
    setShowNew(false);
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
    lastMetrics.current = { height: el.scrollHeight, top: el.scrollTop };
    if (atBottom.current) {
      setShowNew(false);
      readIfVisible();
    }
    if (el.scrollTop < NEAR_TOP && hasMore && !loadingOlder) void loadOlder();
  };

  // After each change to the list: stay at the bottom, keep the view still when older
  // messages came in above, or offer a "New messages" pill.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const first = entries[0]?.key ?? null;
    const last = entries[entries.length - 1] ?? null;
    if (status === 'ready' && !placed.current) {
      // First time in: start at the bottom.
      placed.current = true;
      el.scrollTop = el.scrollHeight;
      atBottom.current = true;
    } else if (first !== firstKey.current && firstKey.current && entries.some((e) => e.key === firstKey.current)) {
      // Older messages loaded above: keep what you were looking at in place.
      el.scrollTop = lastMetrics.current.top + (el.scrollHeight - lastMetrics.current.height);
    } else if (last && last.key !== lastKey.current) {
      const fromMe = last.message.member_id === me.id;
      if (atBottom.current || (fromMe && last.state !== 'sent')) scrollToBottom(placed.current && lastKey.current !== null);
      else if (!fromMe) setShowNew(true);
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    firstKey.current = first;
    lastKey.current = last?.key ?? null;
    lastMetrics.current = { height: el.scrollHeight, top: el.scrollTop };
    readIfVisible();
  }, [entries, status, me.id, scrollToBottom, readIfVisible]);

  // The composer grew or moved (keyboard, typing): the newest message stays in view.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [composerHeight, keyboard, typing]);

  // Not a full screen of messages yet and more exist: fetch more.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && status === 'ready' && hasMore && !loadingOlder && el.scrollHeight <= el.clientHeight + NEAR_TOP) void loadOlder();
  }, [status, hasMore, loadingOlder, loadOlder, entries.length]);

  // Back in view (app reopened) at the bottom: it is read.
  useEffect(() => {
    const onVisible = () => readIfVisible();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [readIfVisible]);

  // ── Reactions and the menu ──────────────────────────────

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries]);
  const menuEntry: ChatEntry | undefined = menu ? byKey.get(menu.key) : undefined;

  // The message went away (deleted elsewhere) while its menu was open.
  useEffect(() => {
    if (menu && !menuEntry) setMenu(null);
  }, [menu, menuEntry]);

  const openMenu = useCallback((key: string, bubble: HTMLElement) => {
    setMenu({ key, bubble, anchor: bubble.getBoundingClientRect() });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const { toggleReaction, retry, discard, deleteMessage } = chat;
  const onToggleReaction = useCallback((id: string, emoji: string) => toggleReaction(id, emoji), [toggleReaction]);
  const onRetry = useCallback((key: string) => retry(key), [retry]);

  const menuActions: MenuAction[] = [];
  if (menuEntry) {
    const { message, state, key } = menuEntry;
    if (state === 'failed') {
      menuActions.push({
        label: 'Try Again',
        icon: 'retry',
        run: () => {
          closeMenu();
          retry(key);
        },
      });
    }
    menuActions.push({
      label: 'Copy',
      icon: 'copy',
      run: () => {
        closeMenu();
        void copyText(message.body).then((ok) => {
          if (!ok) showToast('Couldn’t copy the message.');
        });
      },
    });
    if (message.member_id === me.id && state !== 'sending') {
      menuActions.push({
        label: 'Delete',
        icon: 'delete',
        destructive: true,
        run: () => {
          closeMenu();
          if (state === 'failed') discard(key);
          else setConfirmDelete(message.id);
        },
      });
    }
  }

  // ── Rows ────────────────────────────────────────────────

  const members = data.members;
  const views = useMemo(
    () =>
      rows.map((row) => {
        if (row.kind !== 'message') return row;
        const m = row.entry.message;
        const sender = senderOf(m.member_id, members);
        const { day, time } = stampLabel(m.created_at, timeZone, now);
        const who = row.mine ? 'You' : sender.name;
        const status = row.entry.state === 'failed' ? ', not delivered' : row.entry.state === 'sending' ? ', sending' : '';
        const chips: ChipView[] = summarizeReactions(m.reactions, me.id).map((c) => ({
          ...c,
          label: reactionChipLabel(c, members, me.id),
        }));
        return { ...row, sender, label: `${who}, ${day} ${time}${status}`, chips };
      }),
    [rows, members, me.id, timeZone, now],
  );

  const empty = status === 'ready' && entries.length === 0;
  const style = {
    '--kb': `${keyboard}px`,
    '--composer-h': `${composerHeight}px`,
  } as CSSProperties;

  return (
    <section
      className={styles.screen}
      aria-label="Chat"
      onPointerDownCapture={() => {
        clearTimeout(settleTimer.current);
        pointerDown.current = true;
      }}
      data-typing={typing || undefined}
      data-keyboard={keyboard > 0 || undefined}
      style={style}
    >
      <div ref={scrollRef} className={styles.scroll} onScroll={onScroll}>
        <div className={styles.nav}>
          <button type="button" className={styles.avatarButton} onClick={onOpenProfile} aria-label="Profile">
            <Avatar emoji={me.emoji} size={38} emojiSize={22} />
          </button>
        </div>
        <LargeTitle title="Chat" />

        {hasMore ? (
          <div className={styles.older} aria-hidden={!loadingOlder}>
            {loadingOlder ? <span className={styles.spinner} role="progressbar" aria-label="Loading earlier messages" /> : null}
          </div>
        ) : null}

        {status === 'loading' ? (
          <div className={styles.state}>
            <span className={styles.spinner} role="progressbar" aria-label="Loading messages" />
          </div>
        ) : null}

        {status === 'error' ? (
          <div className={styles.state} role="alert">
            <p className={styles.stateText}>Couldn’t load the chat.</p>
            <button type="button" className={styles.stateButton} onClick={() => void chat.reload()}>
              Try Again
            </button>
          </div>
        ) : null}

        {empty ? (
          <div className={styles.empty}>
            <span className={styles.emptyEmoji} aria-hidden="true">
              👋
            </span>
            <p className={styles.emptyTitle}>Say hello</p>
            <p className={styles.emptyText}>Start a chat with everyone in your home. Messages here are kept for good.</p>
          </div>
        ) : null}

        <div className={styles.log} role="log" aria-label="Messages" aria-busy={status === 'loading' || loadingOlder}>
          {views.map((row) =>
            row.kind === 'separator' ? (
              <p key={row.key} className={styles.separator}>
                <strong>{row.day}</strong> {row.time}
              </p>
            ) : (
              <MessageRow
                key={row.key}
                row={row}
                sender={row.sender}
                label={row.label}
                chips={row.chips}
                lifted={menu?.key === row.key}
                onMenu={openMenu}
                onToggleReaction={onToggleReaction}
                onRetry={onRetry}
              />
            ),
          )}
        </div>
      </div>
      <div className={styles.fade} aria-hidden="true" />

      {showNew ? (
        <button type="button" className={styles.newPill} onClick={() => scrollToBottom(true)}>
          New messages
          <ArrowDownIcon size={15} strokeWidth={2.6} />
        </button>
      ) : null}

      <Composer
        ref={composerRef}
        initial={chat.draft.get()}
        onDraft={chat.draft.set}
        onSend={chat.send}
        onFocusChange={onComposerFocus}
      />

      {menu && menuEntry ? (
        <MessageMenu
          key={menu.key}
          body={menuEntry.message.body}
          mine={menuEntry.message.member_id === me.id}
          anchor={menu.anchor}
          reactions={menuEntry.state === 'sent'}
          myReactions={menuEntry.message.reactions.filter((r) => r.member_id === me.id).map((r) => r.emoji)}
          onReact={(emoji) => {
            closeMenu();
            toggleReaction(menuEntry.message.id, emoji);
          }}
          actions={menuActions}
          onClose={closeMenu}
          returnFocus={menu.bubble}
        />
      ) : null}

      <ActionSheet
        open={confirmDelete !== null}
        title="Delete this message?"
        message="It will be deleted for everyone in the household."
        actions={[
          {
            label: 'Delete Message',
            destructive: true,
            onSelect: () => {
              const id = confirmDelete;
              setConfirmDelete(null);
              if (id) void deleteMessage(id);
            },
          },
        ]}
        onCancel={() => setConfirmDelete(null)}
      />
    </section>
  );
}
