import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_STORAGE_KEY, DemoBackend, type StorageLike } from '../../lib/backend/demo';
import { QUICK_REACTIONS, REACTION_EMOJIS } from '../../lib/constants';
import { ChatProvider, useChat, type ChatContextValue } from '../../state/ChatProvider';
import { HomeProvider, useHome, type HomeContextValue } from '../../state/HomeProvider';
import { ChatScreen } from './ChatScreen';
import { LONG_PRESS_MS } from './useLongPress';

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
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

let home: HomeContextValue;
let chat: ChatContextValue;

function Probe() {
  chat = useChat();
  return null;
}

function Ready({ onOpenProfile, onTyping }: { onOpenProfile(): void; onTyping(typing: boolean): void }) {
  home = useHome();
  if (home.phase.kind !== 'ready' || !home.data) return null;
  return (
    <ChatProvider>
      <Probe />
      <ChatScreen onOpenProfile={onOpenProfile} onTypingChange={onTyping} />
    </ChatProvider>
  );
}

async function setup(prepare?: (storage: MemoryStorage) => void) {
  const storage = new MemoryStorage();
  const backend = new DemoBackend({ storage, search: '?demo-seed=1', latency: 0 });
  prepare?.(storage);
  const onOpenProfile = vi.fn();
  const onTyping = vi.fn();
  render(
    <HomeProvider backend={backend}>
      <Ready onOpenProfile={onOpenProfile} onTyping={onTyping} />
    </HomeProvider>,
  );
  await screen.findByRole('heading', { name: 'Chat', level: 1 });
  await waitFor(() => expect(chat.status).toBe('ready'));
  return { backend, storage, onOpenProfile, onTyping };
}

const log = () => screen.getByRole('log', { name: 'Messages' });
const bubble = (text: string | RegExp) =>
  within(log())
    .getAllByRole('article')
    .find((el) => (typeof text === 'string' ? el.textContent === text : text.test(el.textContent ?? '')))!;
const menu = () => screen.queryByRole('dialog', { name: 'Message actions' });

// jsdom has no PointerEvent: a MouseEvent with the pointer fields is enough here.
beforeAll(() => {
  if (!('PointerEvent' in window)) {
    class FakePointerEvent extends MouseEvent {
      isPrimary: boolean;
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.isPrimary = init.isPrimary ?? true;
        this.pointerType = init.pointerType ?? 'mouse';
      }
    }
    (window as unknown as { PointerEvent: unknown }).PointerEvent = FakePointerEvent;
  }
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as { visualViewport?: unknown }).visualViewport;
});

describe('ChatScreen', () => {
  it('shows the conversation: names over runs, avatars, day separators, your bubbles on the right', async () => {
    await setup();
    const messages = within(log()).getAllByRole('article');
    expect(messages).toHaveLength(8);
    // Names: once above each run of someone else's messages.
    const shea = bubble(/^The heating engineer/);
    expect(shea.getAttribute('aria-label')).toMatch(/^Shea, (Today|Yesterday) \d\d:\d\d$/);
    const sheaRow = shea.closest('[data-first]')!;
    expect(sheaRow.textContent).toContain('Shea');
    expect(sheaRow.querySelector('[aria-hidden="true"]')?.textContent).toBe('🦆');
    // Yours: "You", right side, no name line.
    const mine = bubble("I'm in all morning, I'll let him in.");
    expect(mine.getAttribute('aria-label')).toMatch(/^You, /);
    expect(mine.hasAttribute('data-mine')).toBe(true);
    // Day separators.
    expect(within(log()).getAllByText(/^(Today|Yesterday)$/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows reactions as chips that say who reacted, and toggles yours', async () => {
    await setup();
    const olive = bubble(/^Restocked the olive oil/).closest('[data-state]')! as HTMLElement;
    const thumbs = within(olive).getByRole('button', { name: '👍, 1 reaction from Shea' });
    expect(thumbs.getAttribute('aria-pressed')).toBe('false');
    expect(within(olive).getByRole('button', { name: '❤️, 1 reaction from Ela' })).toBeTruthy();
    fireEvent.click(thumbs);
    const both = within(olive).getByRole('button', { name: '👍, 2 reactions from Shea and you' });
    expect(both.getAttribute('aria-pressed')).toBe('true');
    expect(both.textContent).toBe('👍2');
    fireEvent.click(both);
    await waitFor(() => expect(within(olive).getByRole('button', { name: '👍, 1 reaction from Shea' })).toBeTruthy());
  });

  it('right-click opens the menu: quick reactions, + for all of them, and Copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await setup();
    fireEvent.contextMenu(bubble(/^The heating engineer/));
    const dialog = menu()!;
    expect(dialog).toBeTruthy();
    expect(within(dialog).getAllByRole('button', { name: /^React with / }).map((b) => b.textContent)).toEqual([...QUICK_REACTIONS]);
    // Someone else's message: no Delete.
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'More reactions' }));
    expect(within(dialog).getAllByRole('button', { name: /^React with / })).toHaveLength(REACTION_EMOJIS.length);
    fireEvent.click(within(dialog).getByRole('button', { name: 'React with 🎉' }));
    expect(menu()).toBeNull();
    const row = bubble(/^The heating engineer/).closest('[data-state]') as HTMLElement;
    expect(within(row).getByRole('button', { name: '🎉, 1 reaction from you' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.contextMenu(bubble(/^The heating engineer/));
    fireEvent.click(within(menu()!).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('The heating engineer can come on Saturday between 10 and 12. Is anyone in?'));
  });

  it('a long press opens the menu (and the click after it does nothing)', async () => {
    await setup();
    const target = bubble(/^Thank you!/);
    fireEvent.pointerDown(target, { button: 0, isPrimary: true, clientX: 10, clientY: 10 });
    await act(() => new Promise((r) => setTimeout(r, LONG_PRESS_MS + 50)));
    expect(menu()).toBeTruthy();
    fireEvent.pointerUp(target);
    fireEvent.click(target);
    expect(menu()).toBeTruthy();
    // A press that moves (a scroll) doesn't.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(menu()).toBeNull();
    fireEvent.pointerDown(target, { button: 0, isPrimary: true, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(target, { clientX: 10, clientY: 40 });
    await act(() => new Promise((r) => setTimeout(r, LONG_PRESS_MS + 50)));
    expect(menu()).toBeNull();
  });

  it('opens from the keyboard and Escape gives focus back to the message', async () => {
    await setup();
    const target = bubble(/^Also, is the old firepit/);
    act(() => target.focus());
    fireEvent.keyDown(target, { key: 'Enter' });
    const dialog = menu()!;
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'React with ❤️' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(target);
    fireEvent.keyDown(target, { key: 'ContextMenu' });
    expect(menu()).toBeTruthy();
  });

  it('deletes your own message after confirming', async () => {
    await setup();
    fireEvent.contextMenu(bubble(/^Restocked the olive oil/));
    fireEvent.click(within(menu()!).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete this message?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete Message' }));
    await waitFor(() => expect(within(log()).queryByText(/^Restocked the olive oil/)).toBeNull());
    expect(within(log()).getAllByRole('article')).toHaveLength(7);
  });

  it('sends with Enter, keeps Shift+Enter as a new line, and the send button is off while blank', async () => {
    const { onTyping } = await setup();
    const field = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(field.maxLength).toBe(4000);
    expect(field.getAttribute('enterkeyhint')).toBe('send');
    fireEvent.focus(field);
    expect(onTyping).toHaveBeenLastCalledWith(true);
    fireEvent.change(field, { target: { value: 'Two\nlines' } });
    expect(send.disabled).toBe(false);
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(field.value).toBe('Two\nlines');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(field.value).toBe('');
    await waitFor(() => expect(bubble('Two\nlines')).toBeTruthy());
    fireEvent.change(field, { target: { value: 'By button' } });
    fireEvent.click(send);
    await waitFor(() => expect(bubble('By button')).toBeTruthy());
    fireEvent.blur(field);
    expect(onTyping).toHaveBeenLastCalledWith(false);
  });

  it('follows the iPhone keyboard with the visual viewport while typing', async () => {
    const vv = Object.assign(new EventTarget(), { height: 874, offsetTop: 0 });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 874, configurable: true });
    await setup();
    const region = screen.getByRole('region', { name: 'Chat' });
    const field = screen.getByRole('textbox', { name: 'Message' });
    act(() => field.focus());
    expect(region.hasAttribute('data-typing')).toBe(true);
    expect(region.hasAttribute('data-keyboard')).toBe(false);
    act(() => {
      vv.height = 538;
      vv.dispatchEvent(new Event('resize'));
    });
    expect(region.hasAttribute('data-keyboard')).toBe(true);
    expect(region.style.getPropertyValue('--kb')).toBe('336px');
    act(() => {
      vv.offsetTop = 100;
      vv.dispatchEvent(new Event('scroll'));
    });
    expect(region.style.getPropertyValue('--kb')).toBe('236px');
    act(() => field.blur());
    expect(region.hasAttribute('data-typing')).toBe(false);
    expect(region.style.getPropertyValue('--kb')).toBe('0px');
  });

  it('shows a failed send with a retry', async () => {
    const { backend } = await setup();
    const real = backend.sendMessage.bind(backend);
    const spy = vi.spyOn(backend, 'sendMessage').mockRejectedValueOnce(new Error('offline'));
    const field = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(field, { target: { value: 'Flaky' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    const retry = await screen.findByRole('button', { name: 'Not delivered. Try again' });
    expect(screen.getByText('Not Delivered')).toBeTruthy();
    expect(bubble('Flaky').getAttribute('aria-label')).toMatch(/not delivered$/);
    spy.mockImplementation(real);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByText('Not Delivered')).toBeNull());
    expect(bubble('Flaky').getAttribute('aria-label')).not.toMatch(/not delivered/);
  });

  it('names a former member and opens Profile from the avatar', async () => {
    const { onOpenProfile } = await setup((storage) => {
      const doc = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
      doc.messages[0].member_id = null;
      storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(doc));
    });
    expect(bubble(/^The heating engineer/).getAttribute('aria-label')).toMatch(/^Former member, /);
    expect(within(log()).getByText('Former member')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(onOpenProfile).toHaveBeenCalled();
  });

  it('invites the household to say hello when there are no messages', async () => {
    await setup((storage) => {
      const doc = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
      doc.messages = [];
      doc.message_reactions = [];
      storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(doc));
    });
    expect(screen.getByText('Say hello')).toBeTruthy();
    expect(within(log()).queryAllByRole('article')).toHaveLength(0);
  });

  it('marks the chat read while it is shown at the bottom', async () => {
    await setup();
    await waitFor(() => expect(chat.unread).toBe(false));
  });
});
