import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackendError } from '../lib/backend/types';
import {
  applyReaction,
  hasUnread,
  mergeMessages,
  mergeNewestPage,
  newestTimestamp,
  timeOf,
  type ChatEntry,
} from '../lib/logic/chat';
import type { ChatChange, ChatMessage, ISOTimestamp } from '../lib/types';
import { RESUME_AFTER_MS, SAFETY_MS, useHousehold } from './HomeProvider';

const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

export type ChatStatus = 'loading' | 'ready' | 'error';

export interface ChatContextValue {
  status: ChatStatus;
  /** Stored messages oldest first (your pending reactions and deletes applied), then your unsent ones. */
  entries: ChatEntry[];
  /** Older messages exist before the first loaded one. */
  hasMore: boolean;
  loadingOlder: boolean;
  /** Loads the page before the oldest loaded message. */
  loadOlder(): Promise<void>;
  /** Reloads the newest page (after an error, or to resync). */
  reload(): Promise<void>;

  /** Posts at once as a pending bubble; it turns into the stored message, or shows a retry. */
  send(body: string): void;
  retry(key: string): void;
  /** Drops an unsent (failed) message. */
  discard(key: string): void;
  /** Adds or removes your reaction (optimistic; a failure takes it back with a toast). */
  setReaction(messageId: string, emoji: string, on: boolean): void;
  /** Flips your reaction with `emoji` on the message. */
  toggleReaction(messageId: string, emoji: string): void;
  /** Deletes one of your messages (hidden at once; a failure brings it back with a toast). */
  deleteMessage(messageId: string): Promise<void>;

  /** Someone else wrote since you last read the chat on this device. */
  unread: boolean;
  /** Everything loaded counts as read (the chat is in view, scrolled to the bottom). */
  markRead(): void;

  /** The composer's unsent text, kept while you switch tabs. */
  draft: { get(): string; set(text: string): void };
}

const ChatContext = createContext<ChatContextValue | null>(null);

/** Where this device keeps a member's last-read time. */
export const readKey = (memberId: string) => `homeos.chat.read.${memberId}`;

function loadLastRead(memberId: string): ISOTimestamp | null {
  try {
    return localStorage.getItem(readKey(memberId));
  } catch {
    return null;
  }
}

function storeLastRead(memberId: string, ts: ISOTimestamp) {
  try {
    localStorage.setItem(readKey(memberId), ts);
  } catch {
    /* storage unavailable: unread state lasts for this session only */
  }
}

/** What a failed chat write says. */
export function chatFailureMessage(action: 'react' | 'delete', err: unknown): string {
  const lead = action === 'react' ? 'Couldn’t react.' : 'Couldn’t delete the message.';
  if (err instanceof BackendError) {
    if (err.code === 'network') return `${lead} No connection.`;
    if (err.code === 'not_signed_in') return `${lead} Please sign in again.`;
  }
  return `${lead} Try again.`;
}

interface Pending {
  key: string;
  body: string;
  created_at: ISOTimestamp;
  state: 'sending' | 'failed';
  /** When the latest attempt to send it began (this device's clock). */
  startedAt: number;
}

/**
 * A stored message of yours with a pending send's text is taken for that send
 * (realtime got there first) only if it was posted after the send began, give
 * or take this much clock difference between the device and the server.
 */
const CLAIM_SKEW_MS = 2 * 60_000;

/** On a resync, at most this many older loaded messages are reloaded (newest first). */
const RESYNC_REFRESH_MAX = 500;

interface ReactionOp {
  id: number;
  messageId: string;
  emoji: string;
  on: boolean;
}

interface ChatState {
  status: ChatStatus;
  messages: ChatMessage[];
  hasMore: boolean;
  loadingOlder: boolean;
  pending: Pending[];
  ops: ReactionOp[];
  /** Messages being deleted (hidden until the delete settles). */
  hiding: string[];
  lastRead: ISOTimestamp | null;
}

const isGone = (err: unknown) => err instanceof BackendError && err.code === 'not_found';

/**
 * The household's group chat: the newest page, older pages on demand, live
 * changes from Backend.subscribeChat, optimistic sends, reactions and deletes,
 * and the unread dot. Mount inside the ready app (it needs the household).
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const { backend, data, me, showToast } = useHousehold();
  const householdId = data.household.id;
  const meId = me.id;

  const [state, setState] = useState<ChatState>(() => ({
    status: 'loading',
    messages: [],
    hasMore: false,
    loadingOlder: false,
    pending: [],
    ops: [],
    hiding: [],
    lastRead: loadLastRead(meId),
  }));
  /** Always the state last set, for actions that need the newest copy. */
  const stateRef = useRef(state);
  const update = useCallback((fn: (s: ChatState) => ChatState) => {
    const next = fn(stateRef.current);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
  }, []);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Bookkeeping that never needs a render.
  /** Messages known to be deleted: a page fetched before the delete must not bring them back. */
  const deleted = useRef(new Set<string>());
  /** A clock of local changes: which messages changed here after a page was requested. */
  const tick = useRef(0);
  const touched = useRef(new Map<string, number>());
  const touch = (ids: string[]) => {
    tick.current += 1;
    for (const id of ids) touched.current.set(id, tick.current);
  };
  /** The newest getMessages() asked for each id; an older answer is stale. */
  const fetchSeq = useRef(0);
  const latestFetch = useRef(new Map<string, number>());
  /** The newest listMessages() for the newest page; an older answer is stale. */
  const pageSeq = useRef(0);
  /** A sent message keeps its pending bubble's key, so it doesn't re-mount. One key per message. */
  const keyFor = useRef(new Map<string, string>());
  /** Pending sends a stored message was taken for (claimPending), by key, until their send settles. */
  const claimed = useRef(new Map<string, Pending>());
  /** Reaction writes run one after another per message and emoji. */
  const chains = useRef(new Map<string, Promise<void>>());
  const opSeq = useRef(0);
  const tempSeq = useRef(0);
  const draftText = useRef('');
  const olderBusy = useRef(false);
  /** When the last chat event arrived or the newest page was last asked for (the safety net counts from it). */
  const lastActivity = useRef(Date.now());

  const visible = (list: ChatMessage[]) => list.filter((m) => !deleted.current.has(m.id));

  /**
   * Pending sends this device already sees stored (realtime got there first) are
   * dropped, and the stored message takes over the bubble's key. Only a message
   * posted since the send began counts: an older one with the same text (in a
   * first page that was still loading) is not it. If the send then fails after
   * all, deliver() gives the bubble back (another device of yours sent that text).
   */
  const claimPending = (s: ChatState, arrived: ChatMessage[]): Pending[] => {
    let pending = s.pending;
    for (const m of arrived) {
      if (m.member_id !== meId || keyFor.current.has(m.id) || s.messages.some((x) => x.id === m.id)) continue;
      const posted = timeOf(m.created_at);
      const match = pending.find(
        (p) => p.state === 'sending' && p.body === m.body && posted >= p.startedAt - CLAIM_SKEW_MS,
      );
      if (!match) continue;
      keyFor.current.set(m.id, match.key);
      claimed.current.set(match.key, match);
      pending = pending.filter((p) => p !== match);
    }
    return pending;
  };

  const removeMessage = useCallback(
    (id: string) => {
      deleted.current.add(id);
      update((s) => ({
        ...s,
        messages: s.messages.filter((m) => m.id !== id),
        ops: s.ops.filter((o) => o.messageId !== id),
        hiding: s.hiding.filter((h) => h !== id),
      }));
    },
    [update],
  );

  // ── Loading ─────────────────────────────────────────────

  /** Loads the newest page and merges it in. Resolves to the page's ids (null: failed, or overtaken by a newer load). */
  const loadNewest = useCallback(async (): Promise<Set<string> | null> => {
    const seq = ++pageSeq.current;
    const since = tick.current;
    lastActivity.current = Date.now();
    try {
      const page = await backend.listMessages(householdId);
      if (!alive.current || seq !== pageSeq.current) return null;
      const keepLocal = (id: string) => (touched.current.get(id) ?? 0) > since;
      update((s) => {
        const fresh = { ...page, messages: visible(page.messages) };
        const merged = mergeNewestPage(s.messages, s.hasMore, fresh, keepLocal);
        return { ...s, status: 'ready', messages: merged.messages, hasMore: merged.hasMore, pending: claimPending(s, fresh.messages) };
      });
      return new Set(page.messages.map((m) => m.id));
    } catch {
      if (!alive.current || seq !== pageSeq.current) return null;
      // Keep showing what is loaded; only a first load that fails shows the error.
      update((s) => (s.status === 'ready' ? s : { ...s, status: 'error' }));
      return null;
    }
  }, [backend, householdId, update]);

  /**
   * Reloads specific messages (realtime told us they changed). `insert`: add
   * them even if not loaded (a new message); otherwise only replace loaded ones.
   * Ids that come back missing were deleted.
   */
  const refetch = useCallback(
    async (ids: string[], insert: boolean) => {
      const seq = ++fetchSeq.current;
      for (const id of ids) latestFetch.current.set(id, seq);
      let got: ChatMessage[];
      try {
        got = await backend.getMessages(ids);
      } catch {
        // The next change or resync brings it in.
        return;
      }
      if (!alive.current) return;
      const current = ids.filter((id) => latestFetch.current.get(id) === seq && !deleted.current.has(id));
      const found = got.filter((m) => current.includes(m.id));
      const missing = current.filter((id) => !got.some((m) => m.id === id));
      for (const id of missing) deleted.current.add(id);
      if (!found.length && !missing.length) return;
      touch(found.map((m) => m.id));
      update((s) => {
        const loaded = new Set(s.messages.map((m) => m.id));
        const wanted = insert ? found : found.filter((m) => loaded.has(m.id));
        return {
          ...s,
          messages: mergeMessages(
            s.messages.filter((m) => !missing.includes(m.id)),
            wanted,
          ),
          pending: claimPending(s, wanted),
          ops: s.ops.filter((o) => !missing.includes(o.messageId)),
        };
      });
    },
    [backend, update],
  );

  const loadOlder = useCallback(async () => {
    const s = stateRef.current;
    if (olderBusy.current || !s.hasMore || s.status !== 'ready' || !s.messages.length) return;
    olderBusy.current = true;
    const since = tick.current;
    const before = s.messages[0].created_at;
    update((x) => ({ ...x, loadingOlder: true }));
    try {
      const page = await backend.listMessages(householdId, { before });
      if (!alive.current) return;
      const keepLocal = (id: string) => (touched.current.get(id) ?? 0) > since;
      update((x) => {
        // A resync since may have restarted paging from a newer page: only join on where we asked.
        if (!x.messages.length || timeOf(x.messages[0].created_at) !== timeOf(before)) return { ...x, loadingOlder: false };
        return {
          ...x,
          loadingOlder: false,
          messages: mergeMessages(x.messages, visible(page.messages), keepLocal),
          hasMore: page.hasMore,
        };
      });
    } catch {
      if (alive.current) update((x) => ({ ...x, loadingOlder: false }));
    } finally {
      olderBusy.current = false;
    }
  }, [backend, householdId, update]);

  /**
   * Changes may have been missed (another tab wrote, or the connection dropped and
   * rejoined): reload the newest page, then the older loaded messages it doesn't
   * cover, so their reactions and deletes are not left stale.
   */
  const resync = useCallback(async () => {
    const page = await loadNewest();
    if (!page || !alive.current) return;
    const older = stateRef.current.messages.map((m) => m.id).filter((id) => !page.has(id));
    if (older.length) await refetch(older.slice(-RESYNC_REFRESH_MAX), false);
  }, [loadNewest, refetch]);

  // First load, live changes, and a reload whenever the app comes back into view
  // (docs/ARCHITECTURE.md "Sync guarantees").
  useEffect(() => {
    const onChange = (change: ChatChange) => {
      lastActivity.current = Date.now();
      if (change.type === 'resync') void resync();
      else if (change.type === 'message' && change.deleted) removeMessage(change.messageId);
      else void refetch([change.messageId], change.type === 'message');
    };
    let unsub: (() => void) | null = null;
    try {
      unsub = backend.subscribeChat(householdId, onChange);
    } catch {
      unsub = null; // no live updates; the visibility resync still runs
    }
    void loadNewest();

    // Back after a while, from the back/forward cache, or back online: changes may have been
    // missed (HomeProvider reconnects the socket), so resync. A short hide reloads the newest page.
    let hiddenAt = isVisible() ? null : Date.now();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt ??= Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      void (away >= RESUME_AFTER_MS ? resync() : loadNewest());
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void resync();
    };
    const onOnline = () => void resync();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onOnline);

    // Safety net: a channel that joined but silently stopped delivering. 60 s without a chat
    // event or a load, while in view: load the newest page.
    lastActivity.current = Date.now();
    let safety: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const wait = lastActivity.current + SAFETY_MS - Date.now();
      if (wait > 0) {
        safety = setTimeout(check, wait);
        return;
      }
      lastActivity.current = Date.now();
      if (isVisible()) void loadNewest();
      safety = setTimeout(check, SAFETY_MS);
    };
    safety = setTimeout(check, SAFETY_MS);

    return () => {
      unsub?.();
      clearTimeout(safety);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onOnline);
    };
  }, [backend, householdId, loadNewest, refetch, removeMessage, resync]);

  // Another tab of this person read the chat.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== readKey(meId)) return;
      update((s) => ({ ...s, lastRead: e.newValue }));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [meId, update]);

  // ── Sending ─────────────────────────────────────────────

  const deliver = useCallback(
    async (key: string) => {
      const p = stateRef.current.pending.find((x) => x.key === key);
      if (!p) return;
      const startedAt = Date.now();
      update((s) => ({ ...s, pending: s.pending.map((x) => (x.key === key ? { ...x, state: 'sending', startedAt } : x)) }));
      try {
        const sent = await backend.sendMessage(householdId, p.body);
        if (!alive.current) return;
        claimed.current.delete(key);
        // One key per message: a stored message wrongly taken for this send gets its own back.
        for (const [id, k] of keyFor.current) if (k === key && id !== sent.id) keyFor.current.delete(id);
        keyFor.current.set(sent.id, key);
        touch([sent.id]);
        update((s) => ({
          ...s,
          pending: s.pending.filter((x) => x.key !== key),
          messages: deleted.current.has(sent.id) ? s.messages : mergeMessages(s.messages, [sent], (id) => id === sent.id && s.messages.some((m) => m.id === id)),
        }));
      } catch {
        if (!alive.current) return;
        // A stored message was taken for this send, yet the send failed: it was not this
        // one. It keeps its own key, and this message shows as not delivered again.
        const taken = claimed.current.get(key);
        claimed.current.delete(key);
        if (taken) for (const [id, k] of keyFor.current) if (k === key) keyFor.current.delete(id);
        update((s) => {
          if (s.pending.some((x) => x.key === key)) {
            return { ...s, pending: s.pending.map((x) => (x.key === key ? { ...x, state: 'failed' } : x)) };
          }
          if (!taken) return s;
          const back: Pending = { ...taken, state: 'failed' };
          return { ...s, pending: [...s.pending, back].sort((a, b) => timeOf(a.created_at) - timeOf(b.created_at)) };
        });
      }
    },
    [backend, householdId, update],
  );

  const send = useCallback(
    (body: string) => {
      const text = body.trim();
      if (!text) return;
      const key = `local-${++tempSeq.current}`;
      const last = stateRef.current.messages[stateRef.current.messages.length - 1];
      // Never before the newest message, even with a slow clock.
      const at = Math.max(Date.now(), last ? timeOf(last.created_at) + 1 : 0);
      const pending: Pending = { key, body: text, created_at: new Date(at).toISOString(), state: 'sending', startedAt: Date.now() };
      update((s) => ({ ...s, pending: [...s.pending, pending] }));
      void deliver(key);
    },
    [deliver, update],
  );

  const retry = useCallback((key: string) => void deliver(key), [deliver]);
  const discard = useCallback((key: string) => update((s) => ({ ...s, pending: s.pending.filter((p) => p.key !== key) })), [update]);

  // ── Reactions ───────────────────────────────────────────

  const setReaction = useCallback(
    (messageId: string, emoji: string, on: boolean) => {
      const op: ReactionOp = { id: ++opSeq.current, messageId, emoji, on };
      update((s) => ({ ...s, ops: [...s.ops, op] }));
      const chainKey = `${messageId} ${emoji}`;
      const run = async () => {
        try {
          await backend.setReaction(messageId, emoji, on);
          if (!alive.current) return;
          touch([messageId]);
          const at = new Date().toISOString();
          update((s) => ({
            ...s,
            ops: s.ops.filter((o) => o.id !== op.id),
            messages: s.messages.map((m) => (m.id === messageId ? applyReaction(m, meId, emoji, on, at) : m)),
          }));
        } catch (err) {
          if (!alive.current) return;
          if (isGone(err)) {
            removeMessage(messageId);
            showToast('That message was deleted.');
            return;
          }
          update((s) => ({ ...s, ops: s.ops.filter((o) => o.id !== op.id) }));
          showToast(chatFailureMessage('react', err));
        }
      };
      const next = (chains.current.get(chainKey) ?? Promise.resolve()).then(run);
      chains.current.set(chainKey, next);
      void next.then(() => {
        if (chains.current.get(chainKey) === next) chains.current.delete(chainKey);
      });
    },
    [backend, meId, removeMessage, showToast, update],
  );

  // ── Deleting ────────────────────────────────────────────

  const deleteMessage = useCallback(
    async (messageId: string) => {
      update((s) => ({ ...s, hiding: [...s.hiding, messageId] }));
      try {
        await backend.deleteMessage(messageId);
        if (alive.current) removeMessage(messageId);
      } catch (err) {
        if (!alive.current) return;
        if (isGone(err)) {
          removeMessage(messageId); // already gone
          return;
        }
        update((s) => ({ ...s, hiding: s.hiding.filter((h) => h !== messageId) }));
        showToast(chatFailureMessage('delete', err));
      }
    },
    [backend, removeMessage, showToast, update],
  );

  // ── Unread ──────────────────────────────────────────────

  const markRead = useCallback(() => {
    const newest = newestTimestamp(stateRef.current.messages);
    const last = stateRef.current.lastRead;
    if (!newest || (last && timeOf(newest) <= timeOf(last))) return;
    storeLastRead(meId, newest);
    update((s) => ({ ...s, lastRead: newest }));
  }, [meId, update]);

  // ── What the screen shows ───────────────────────────────

  const entries = useMemo<ChatEntry[]>(() => {
    const hidden = new Set(state.hiding);
    const shown: ChatEntry[] = state.messages
      .filter((m) => !hidden.has(m.id))
      .map((m) => {
        let message = m;
        for (const op of state.ops) {
          if (op.messageId === m.id) message = applyReaction(message, meId, op.emoji, op.on, m.created_at);
        }
        return { key: keyFor.current.get(m.id) ?? m.id, message, state: 'sent' };
      });
    const unsent: ChatEntry[] = state.pending.map((p) => ({
      key: p.key,
      state: p.state,
      message: { id: p.key, household_id: householdId, member_id: meId, body: p.body, created_at: p.created_at, reactions: [] },
    }));
    return [...shown, ...unsent];
  }, [state.messages, state.ops, state.hiding, state.pending, householdId, meId]);

  const unread = useMemo(() => hasUnread(state.messages, meId, state.lastRead), [state.messages, meId, state.lastRead]);

  const reload = useCallback(async () => {
    update((s) => (s.status === 'error' ? { ...s, status: 'loading' } : s));
    await loadNewest();
  }, [loadNewest, update]);

  const toggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      const s = stateRef.current;
      const m = s.messages.find((x) => x.id === messageId);
      if (!m) return;
      let mine = m.reactions.some((r) => r.member_id === meId && r.emoji === emoji);
      for (const op of s.ops) if (op.messageId === messageId && op.emoji === emoji) mine = op.on;
      setReaction(messageId, emoji, !mine);
    },
    [meId, setReaction],
  );

  const draft = useMemo(
    () => ({
      get: () => draftText.current,
      set: (text: string) => {
        draftText.current = text;
      },
    }),
    [],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      status: state.status,
      entries,
      hasMore: state.hasMore,
      loadingOlder: state.loadingOlder,
      loadOlder,
      reload,
      send,
      retry,
      discard,
      setReaction,
      toggleReaction,
      deleteMessage,
      unread,
      markRead,
      draft,
    }),
    [
      state.status,
      entries,
      state.hasMore,
      state.loadingOlder,
      loadOlder,
      reload,
      send,
      retry,
      discard,
      setReaction,
      toggleReaction,
      deleteMessage,
      unread,
      markRead,
      draft,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
}
