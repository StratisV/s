import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_STORAGE_KEY, DemoBackend, type StorageLike } from '../lib/backend/demo';
import { BackendError } from '../lib/backend/types';
import type { ChatChange, ChatMessage } from '../lib/types';
import { ChatProvider, readKey, useChat, type ChatContextValue } from './ChatProvider';
import { HomeProvider, useHome, type HomeContextValue } from './HomeProvider';

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

/** The demo backend with switches to make chat writes fail, and hooks to reorder them. */
class FlakyBackend extends DemoBackend {
  fail: { send?: boolean; react?: boolean; remove?: boolean; list?: boolean } = {};
  /** Holds sendMessage's answer until released (realtime arriving first). */
  holdSend: Promise<void> | null = null;

  async listMessages(...args: Parameters<DemoBackend['listMessages']>) {
    if (this.fail.list) throw new BackendError('network');
    return super.listMessages(...args);
  }
  async sendMessage(householdId: string, body: string) {
    if (this.fail.send) throw new BackendError('network');
    const sent = await super.sendMessage(householdId, body);
    if (this.holdSend) await this.holdSend;
    return sent;
  }
  async setReaction(messageId: string, emoji: string, on: boolean) {
    if (this.fail.react) throw new BackendError('network');
    return super.setReaction(messageId, emoji, on);
  }
  async deleteMessage(id: string) {
    if (this.fail.remove) throw new BackendError('network');
    return super.deleteMessage(id);
  }
}

let chat: ChatContextValue;
let home: HomeContextValue;

function Probe() {
  chat = useChat();
  return null;
}

function Ready() {
  home = useHome();
  if (home.phase.kind !== 'ready' || !home.data) return null;
  return (
    <ChatProvider>
      <Probe />
    </ChatProvider>
  );
}

async function setup(prepare?: (storage: MemoryStorage) => void, spy?: (backend: FlakyBackend) => void) {
  const storage = new MemoryStorage();
  const backend = new FlakyBackend({ storage, search: '?demo-seed=1', latency: 0 });
  prepare?.(storage);
  spy?.(backend);
  render(
    <HomeProvider backend={backend}>
      <Ready />
    </HomeProvider>,
  );
  await waitFor(() => expect(chat?.status).toBe('ready'));
  return { backend, storage };
}

const bodies = () => chat.entries.map((e) => e.message.body);
const meId = () => home.me!.id;
const shea = () => home.data!.members.find((m) => m.name === 'Shea')!;

/** Writes straight into the stored document, as another device would, and tells this tab. */
function otherTab(storage: MemoryStorage, edit: (doc: { messages: Record<string, unknown>[]; message_reactions: Record<string, unknown>[] }) => void) {
  const doc = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
  edit(doc);
  storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(doc));
  window.dispatchEvent(new StorageEvent('storage', { key: DEMO_STORAGE_KEY }));
}

beforeEach(() => {
  localStorage.clear();
  chat = undefined as unknown as ChatContextValue;
  home = undefined as unknown as HomeContextValue;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ChatProvider', () => {
  it('loads the newest page with reactions, oldest first', async () => {
    await setup();
    expect(chat.entries).toHaveLength(8);
    expect(bodies()[0]).toMatch(/^The heating engineer/);
    expect(bodies()[7]).toBe("I'll order a new pack today.");
    expect(chat.entries.every((e) => e.state === 'sent' && e.key === e.message.id)).toBe(true);
    expect(chat.hasMore).toBe(false);
    const olive = chat.entries.find((e) => e.message.body.startsWith('Restocked'))!;
    expect(olive.message.reactions.map((r) => r.emoji)).toEqual(['👍', '❤️']);
  });

  it('sends optimistically: one bubble that turns into the stored message, keeping its key', async () => {
    const { backend } = await setup();
    act(() => chat.send('  Bin day tomorrow  '));
    const pending = chat.entries[chat.entries.length - 1];
    expect(pending).toMatchObject({ state: 'sending', message: { body: 'Bin day tomorrow', member_id: meId() } });
    await waitFor(() => expect(chat.entries[chat.entries.length - 1].state).toBe('sent'));
    const sent = chat.entries[chat.entries.length - 1];
    expect(sent.key).toBe(pending.key);
    expect(sent.message.id).not.toBe(pending.key);
    expect(bodies().filter((b) => b === 'Bin day tomorrow')).toHaveLength(1);
    const stored = await backend.listMessages(home.data!.household.id);
    expect(stored.messages.at(-1)!.body).toBe('Bin day tomorrow');
    // Blank text is not sent.
    act(() => chat.send('   '));
    expect(chat.entries).toHaveLength(9);
  });

  it('does not show a sent message twice when realtime reports it before the send returns', async () => {
    const { backend } = await setup();
    let release!: () => void;
    backend.holdSend = new Promise<void>((r) => (release = r));
    act(() => chat.send('Realtime first'));
    // The change event's reload lands while sendMessage has not answered yet.
    await waitFor(() => expect(chat.entries.at(-1)!.state).toBe('sent'));
    expect(bodies().filter((b) => b === 'Realtime first')).toHaveLength(1);
    const key = chat.entries.at(-1)!.key;
    await act(async () => {
      release();
      await backend.holdSend;
    });
    await waitFor(() => expect(bodies().filter((b) => b === 'Realtime first')).toHaveLength(1));
    expect(chat.entries.at(-1)!.key).toBe(key);
  });

  it('keeps a failed send with a retry', async () => {
    const { backend } = await setup();
    backend.fail.send = true;
    act(() => chat.send('Will this go?'));
    await waitFor(() => expect(chat.entries.at(-1)!.state).toBe('failed'));
    backend.fail.send = false;
    act(() => chat.retry(chat.entries.at(-1)!.key));
    await waitFor(() => expect(chat.entries.at(-1)!.state).toBe('sent'));
    expect(chat.entries.at(-1)!.message.body).toBe('Will this go?');

    backend.fail.send = true;
    act(() => chat.send('Never mind'));
    await waitFor(() => expect(chat.entries.at(-1)!.state).toBe('failed'));
    act(() => chat.discard(chat.entries.at(-1)!.key));
    expect(bodies()).not.toContain('Never mind');
  });

  it('reacts optimistically and stores it; tapping again takes it off', async () => {
    const { backend } = await setup();
    const target = chat.entries[0].message;
    act(() => chat.toggleReaction(target.id, '🎉'));
    const mine = () => chat.entries[0].message.reactions.filter((r) => r.member_id === meId()).map((r) => r.emoji);
    expect(mine()).toEqual(['🎉']); // at once
    await waitFor(async () => {
      const [stored] = await backend.getMessages([target.id]);
      expect(stored.reactions.map((r) => r.emoji)).toContain('🎉');
    });
    act(() => chat.toggleReaction(target.id, '🎉'));
    expect(mine()).toEqual([]);
    await waitFor(async () => {
      const [stored] = await backend.getMessages([target.id]);
      expect(stored.reactions.map((r) => r.emoji)).not.toContain('🎉');
    });
    expect(mine()).toEqual([]);
  });

  it('takes a reaction back with a toast when it fails', async () => {
    const { backend } = await setup();
    backend.fail.react = true;
    const target = chat.entries[2].message;
    act(() => chat.setReaction(target.id, '😂', true));
    expect(chat.entries[2].message.reactions.some((r) => r.emoji === '😂')).toBe(true);
    await waitFor(() => expect(home.toast?.message).toBe('Couldn’t react. No connection.'));
    expect(chat.entries[2].message.reactions.some((r) => r.emoji === '😂')).toBe(false);
  });

  it('deletes your message at once; a failed delete brings it back with a toast', async () => {
    const { backend } = await setup();
    const own = chat.entries.find((e) => e.message.member_id === meId())!;
    backend.fail.remove = true;
    let done!: Promise<void>;
    act(() => {
      done = chat.deleteMessage(own.message.id);
    });
    expect(chat.entries.some((e) => e.key === own.key)).toBe(false);
    await act(() => done);
    expect(chat.entries.some((e) => e.key === own.key)).toBe(true);
    expect(home.toast?.message).toBe('Couldn’t delete the message. No connection.');

    backend.fail.remove = false;
    await act(() => chat.deleteMessage(own.message.id));
    expect(chat.entries.some((e) => e.key === own.key)).toBe(false);
    expect((await backend.getMessages([own.message.id])).length).toBe(0);
  });

  it('picks up changes from another tab (resync): new messages, reactions and deletes', async () => {
    const { storage } = await setup();
    const hid = home.data!.household.id;
    const first = chat.entries[0].message;
    act(() =>
      otherTab(storage, (doc) => {
        doc.messages.push({
          id: 'from-shea',
          household_id: hid,
          member_id: shea().id,
          body: 'Back at six',
          created_at: new Date(Date.now() + 1000).toISOString(),
        });
        doc.message_reactions.push({
          message_id: first.id,
          member_id: shea().id,
          household_id: hid,
          emoji: '🔥',
          created_at: new Date().toISOString(),
        });
        doc.messages = doc.messages.filter((m) => !String(m.body).startsWith('Thank you!'));
      }),
    );
    await waitFor(() => expect(bodies().at(-1)).toBe('Back at six'));
    expect(bodies().some((b) => b.startsWith('Thank you!'))).toBe(false);
    expect(chat.entries[0].message.reactions.map((r) => r.emoji)).toContain('🔥');
  });

  it('applies change events: a new message, a reaction, a delete', async () => {
    let emit!: (c: ChatChange) => void;
    const { backend } = await setup(undefined, (b) => {
      // A quiet backend: only the events this test sends.
      vi.spyOn(b, 'subscribeChat').mockImplementation((_h, onChange) => {
        emit = onChange;
        return () => {};
      });
    });
    const hid = home.data!.household.id;
    const fresh: ChatMessage = await backend.sendMessage(hid, 'Hello from the event');
    await act(async () => emit({ type: 'message', messageId: fresh.id, deleted: false }));
    await waitFor(() => expect(bodies().at(-1)).toBe('Hello from the event'));

    await backend.setReaction(fresh.id, '👀', true);
    await act(async () => emit({ type: 'reaction', messageId: fresh.id }));
    await waitFor(() => expect(chat.entries.at(-1)!.message.reactions.map((r) => r.emoji)).toEqual(['👀']));

    await backend.deleteMessage(fresh.id);
    await act(async () => emit({ type: 'message', messageId: fresh.id, deleted: true }));
    expect(bodies()).not.toContain('Hello from the event');
    // A late reload of a deleted message never brings it back.
    await act(async () => emit({ type: 'reaction', messageId: fresh.id }));
    await act(async () => {
      await chat.reload();
    });
    expect(bodies()).not.toContain('Hello from the event');
  });

  it('pages older messages in', async () => {
    await setup((storage) => {
      const doc = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
      const hid = doc.households[0].id;
      const sender = doc.members[1].id;
      const start = Date.parse(doc.messages[0].created_at) - 60 * 60_000;
      for (let i = 0; i < 60; i++) {
        doc.messages.push({
          id: `old-${i}`,
          household_id: hid,
          member_id: sender,
          body: `Old message ${i}`,
          created_at: new Date(start - (60 - i) * 60_000).toISOString(),
        });
      }
      storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(doc));
    });
    expect(chat.entries).toHaveLength(50);
    expect(chat.hasMore).toBe(true);
    expect(bodies()[0]).toBe('Old message 18');
    await act(() => chat.loadOlder());
    expect(chat.entries).toHaveLength(68);
    expect(chat.hasMore).toBe(false);
    expect(bodies()[0]).toBe('Old message 0');
    await act(() => chat.loadOlder()); // nothing more: no-op
    expect(chat.entries).toHaveLength(68);
  });

  it('tracks unread messages per member on this device', async () => {
    const { storage } = await setup();
    // Never opened: the seeded messages from Shea and Ela are unread.
    expect(chat.unread).toBe(true);
    act(() => chat.markRead());
    expect(chat.unread).toBe(false);
    expect(localStorage.getItem(readKey(meId()))).toBe(chat.entries.at(-1)!.message.created_at);

    // My own message doesn't make it unread; someone else's does.
    act(() => chat.send('Mine'));
    await waitFor(() => expect(chat.entries.at(-1)!.state).toBe('sent'));
    expect(chat.unread).toBe(false);
    act(() =>
      otherTab(storage, (doc) => {
        doc.messages.push({
          id: 'shea-later',
          household_id: home.data!.household.id,
          member_id: shea().id,
          body: 'Ok!',
          created_at: new Date(Date.now() + 5000).toISOString(),
        });
      }),
    );
    await waitFor(() => expect(chat.unread).toBe(true));
  });

  it('another tab reading the chat clears the dot here', async () => {
    await setup();
    expect(chat.unread).toBe(true);
    const newest = chat.entries.at(-1)!.message.created_at;
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: readKey(meId()), newValue: newest }));
    });
    expect(chat.unread).toBe(false);
  });

  it('shows an error when the first load fails, and recovers on reload', async () => {
    const storage = new MemoryStorage();
    const backend = new FlakyBackend({ storage, search: '?demo-seed=1', latency: 0 });
    backend.fail.list = true;
    render(
      <HomeProvider backend={backend}>
        <Ready />
      </HomeProvider>,
    );
    await waitFor(() => expect(chat?.status).toBe('error'));
    backend.fail.list = false;
    await act(() => chat.reload());
    expect(chat.status).toBe('ready');
    expect(chat.entries).toHaveLength(8);
  });

  it('keeps the composer draft', async () => {
    await setup();
    chat.draft.set('half a thought');
    expect(chat.draft.get()).toBe('half a thought');
  });
});
