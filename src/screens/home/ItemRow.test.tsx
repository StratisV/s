import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item } from '../../lib/types';
import { ConfettiProvider } from '../../ui/Confetti';
import { COMPLETE_FEEDBACK_MS, ItemRow } from './ItemRow';

const item: Item = {
  id: 'item-1',
  household_id: 'h1',
  area_id: 'a1',
  kind: 'task',
  title: 'Heaters not working',
  note: 'No heat since the weekend.',
  good: '',
  rag: 'red',
  due_date: '2026-10-06',
  assignee_id: 'm1',
  repeat: 'none',
  notify: 'day_before',
  status: 'open',
  created_by: 'm1',
  updated_by: 'm1',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

type Meta = { who: string; date: string | null; missed: boolean };

function setup(overrides: Partial<Item> = {}, meta: Meta = { who: '🦆 Shea', date: 'Missed · Tue 6 Oct', missed: true }) {
  const onOpen = vi.fn();
  const onComplete = vi.fn(() => Promise.resolve());
  const props = { item: { ...item, ...overrides }, meta, onOpen, onComplete };
  const view = render(
    <ConfettiProvider>
      <ul>
        <ItemRow {...props} />
      </ul>
    </ConfettiProvider>,
  );
  const ring = screen.getByRole('button', { name: `Mark ${props.item.title} as done` });
  const row = view.container.querySelector<HTMLButtonElement>('[data-item-open]')!;
  return { onOpen, onComplete, ring, row, view };
}

describe('ItemRow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows the title, then the meta and the note on one line, with the missed date marked', () => {
    const { row } = setup();
    expect(row.textContent).toBe('Heaters not working, Red.🦆 Shea · Missed · Tue 6 Oct · No heat since the weekend.');
    expect(screen.getByText('Missed · Tue 6 Oct').hasAttribute('data-missed')).toBe(true);
  });

  it('leaves out a blank note and, without a due date, the date part', () => {
    const { row } = setup({ note: '  ' }, { who: 'Unassigned', date: null, missed: false });
    expect(row.textContent).toBe('Heaters not working, Red.Unassigned');
  });

  it('tells assistive tech the status after the title, without changing the ring name', () => {
    for (const [rag, label] of [
      ['red', 'Red'],
      ['amber', 'Amber'],
      ['green', 'Green'],
    ] as const) {
      const { row, ring, view } = setup({ rag });
      const hidden = row.querySelector('.visually-hidden')!;
      expect(hidden.textContent).toBe(`, ${label}.`);
      // Inside the title, so the row keeps its two lines: the title, then the meta and note.
      expect(hidden.parentElement!.textContent).toBe(`Heaters not working, ${label}.`);
      expect(row.querySelectorAll(':scope > span')).toHaveLength(2);
      expect(ring.getAttribute('aria-label')).toBe('Mark Heaters not working as done');
      view.unmount();
    }
  });

  it('opens the item when the row is tapped', () => {
    const { row, onOpen, onComplete } = setup();
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith('item-1');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('fills the ring, fires confetti and completes once, even on fast repeated taps', async () => {
    const { ring, row, onOpen, onComplete } = setup();
    fireEvent.click(ring);
    fireEvent.click(ring);
    expect(ring.hasAttribute('data-done')).toBe(true);
    expect(document.querySelectorAll('[data-confetti] > div > *')).toHaveLength(36);
    // A row tap during the feedback must not open the sheet.
    fireEvent.click(row);
    expect(onOpen).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(COMPLETE_FEEDBACK_MS);
    });
    fireEvent.click(ring);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('item-1');
    expect(ring.hasAttribute('data-done')).toBe(false);
  });

  it('accepts a new tap on a repeating item once the cooldown has passed', async () => {
    const { ring, onComplete } = setup({ repeat: 'monthly' });
    fireEvent.click(ring);
    await act(async () => {
      vi.advanceTimersByTime(COMPLETE_FEEDBACK_MS);
    });
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(ring);
    await act(async () => {
      vi.advanceTimersByTime(COMPLETE_FEEDBACK_MS);
    });
    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  describe('a state (To maintain)', () => {
    const firepit: Partial<Item> = {
      kind: 'state',
      title: 'Firepit',
      note: "New one installed. Keep the cover on when it's not in use.",
      rag: 'green',
      due_date: null,
      repeat: 'none',
      notify: 'none',
    };
    const updated: Meta = { who: '🦊 Ela', date: 'Updated Tue 6 Oct', missed: false };

    function setupState(over: Partial<Item> = {}, meta: Meta = updated) {
      const onOpen = vi.fn();
      const onComplete = vi.fn(() => Promise.resolve());
      const view = render(
        <ConfettiProvider>
          <ul>
            <ItemRow item={{ ...item, ...firepit, ...over }} meta={meta} onOpen={onOpen} onComplete={onComplete} />
          </ul>
        </ConfettiProvider>,
      );
      const row = view.container.querySelector<HTMLButtonElement>('[data-item-open]')!;
      return { onOpen, onComplete, row, view };
    }

    it('shows a solid dot in its RAG colour instead of the ring, and it is not a button', () => {
      const { view } = setupState();
      expect(screen.queryByRole('button', { name: /as done$/ })).toBeNull();
      // The row's only button opens it.
      expect(screen.getAllByRole('button')).toHaveLength(1);
      const dot = view.container.querySelector('li > [aria-hidden="true"] > [data-rag]') as HTMLElement;
      expect(dot.dataset.rag).toBe('green');
      expect(dot.style.getPropertyValue('--ring')).toBe('#34C759');
      expect(view.container.querySelector('li')!.dataset.kind).toBe('state');
    });

    it('reads "<emoji> <name> · Updated Tue 6 Oct" (or Unassigned) before the note', () => {
      const { row } = setupState();
      expect(row.textContent).toBe(
        "Firepit, Green, to maintain.🦊 Ela · Updated Tue 6 Oct · New one installed. Keep the cover on when it's not in use.",
      );
      const date = screen.getByText('Updated Tue 6 Oct');
      expect(date.hasAttribute('data-updated')).toBe(true);
      expect(date.hasAttribute('data-missed')).toBe(false);
      cleanup();
      const unassigned = setupState({}, { who: 'Unassigned', date: 'Updated Thu 8 Oct', missed: false });
      expect(unassigned.row.textContent).toContain('Unassigned · Updated Thu 8 Oct · ');
    });

    it('tells assistive tech "<title>, Red, to maintain"', () => {
      for (const [rag, label] of [
        ['red', 'Red'],
        ['amber', 'Amber'],
        ['green', 'Green'],
      ] as const) {
        const { row, view } = setupState({ rag });
        expect(row.querySelector('.visually-hidden')!.textContent).toBe(`, ${label}, to maintain.`);
        // jsdom puts a space between the title and the hidden span; browsers do not.
        expect(screen.getByRole('button', { name: new RegExp(`^Firepit ?, ${label}, to maintain\\.`) })).toBe(row);
        view.unmount();
      }
    });

    it('opens on a tap or from the keyboard, and never completes', async () => {
      const { row, onOpen, onComplete } = setupState();
      fireEvent.click(row);
      expect(onOpen).toHaveBeenCalledWith('item-1');
      row.focus();
      expect(document.activeElement).toBe(row);
      fireEvent.click(row);
      expect(onOpen).toHaveBeenCalledTimes(2);
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(onComplete).not.toHaveBeenCalled();
      expect(document.querySelectorAll('[data-confetti] > div > *')).toHaveLength(0);
    });
  });
});
