import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../lib/backend/types';
import { HomeProvider, TOAST_MS, useHome, type HomeContextValue } from '../state/HomeProvider';
import { Toast } from './Toast';

// The toast only needs the provider; stay on the splash (auth never answers).
const backend = { kind: 'demo', getUser: () => new Promise(() => {}), onAuthChange: () => () => {} } as unknown as Backend;

function setup() {
  let home!: HomeContextValue;
  function Expose() {
    home = useHome();
    return <textarea aria-label="Note" />;
  }
  render(
    <HomeProvider backend={backend}>
      <Expose />
      <Toast />
    </HomeProvider>,
  );
  const region = screen.getByRole('status');
  return { home: () => home, region };
}

function showUndo(home: () => HomeContextValue) {
  const run = vi.fn();
  act(() => home().showToast('Marked as done', { label: 'Undo', run }));
  return run;
}

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

/** jsdom has no PointerEvent, so set pointerType by hand. React derives leave from pointerout. */
function pointer(type: 'pointerMove' | 'pointerLeave', el: Element, pointerType: string) {
  const event = type === 'pointerMove' ? createEvent.pointerMove(el) : createEvent.pointerOut(el);
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  if (type === 'pointerLeave') Object.defineProperty(event, 'relatedTarget', { value: document.body });
  fireEvent(el, event);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Toast', () => {
  it('keeps one polite live region in the page, empty when idle', () => {
    const { home, region } = setup();
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    showUndo(home);
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe('Marked as doneUndo');
    advance(TOAST_MS);
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe('');
  });

  it('hides after about 4 seconds', () => {
    const { home, region } = setup();
    showUndo(home);
    advance(TOAST_MS - 1);
    expect(region.textContent).toContain('Marked as done');
    advance(1);
    expect(region.textContent).toBe('');
  });

  it('stays while Undo has focus, then gets a fresh 4 seconds', () => {
    const { home, region } = setup();
    showUndo(home);
    const undo = within(region).getByRole('button', { name: 'Undo' });
    act(() => undo.focus());
    advance(TOAST_MS * 3);
    expect(region.textContent).toContain('Marked as done');
    act(() => undo.blur());
    advance(TOAST_MS - 1);
    expect(region.textContent).toContain('Marked as done');
    advance(1);
    expect(region.textContent).toBe('');
  });

  it('stays while a mouse is over it, not after a finger lifts', () => {
    const { home, region } = setup();
    showUndo(home);
    const toast = region.firstElementChild!;
    pointer('pointerMove', toast, 'mouse');
    advance(TOAST_MS * 2);
    expect(region.textContent).toContain('Marked as done');
    pointer('pointerLeave', toast, 'mouse');
    advance(TOAST_MS);
    expect(region.textContent).toBe('');

    showUndo(home);
    pointer('pointerMove', region.firstElementChild!, 'touch');
    advance(TOAST_MS);
    expect(region.textContent).toBe('');
  });

  it('a new toast is not held by the focus the old one lost', () => {
    const { home, region } = setup();
    showUndo(home);
    act(() => within(region).getByRole('button', { name: 'Undo' }).focus());
    // Undo runs: the toast goes and another takes its place.
    act(() => home().showToast('Couldn’t undo. No connection.'));
    advance(TOAST_MS);
    expect(region.textContent).toBe('');
  });

  it('Cmd or Ctrl+Z runs Undo, except while typing', () => {
    const { home, region } = setup();
    const run = showUndo(home);
    expect(within(region).getByRole('button', { name: 'Undo' }).getAttribute('aria-keyshortcuts')).toBe('Meta+Z Control+Z');
    const note = screen.getByLabelText('Note');
    act(() => note.focus());
    fireEvent.keyDown(note, { key: 'z', ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
    act(() => note.blur());
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true }); // redo, not undo
    expect(run).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'Z', metaKey: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('Cmd+Z does nothing without an Undo toast', () => {
    const { home } = setup();
    const share = vi.fn();
    act(() => home().showToast('Invite link ready', { label: 'Share', run: share }));
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    expect(share).not.toHaveBeenCalled();
    advance(TOAST_MS);
    const run = vi.fn();
    act(() => home().showToast('Marked as done', { label: 'Undo', run }));
    advance(TOAST_MS);
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    expect(run).not.toHaveBeenCalled();
  });
});
