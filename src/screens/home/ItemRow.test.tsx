import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item } from '../../lib/types';
import { ConfettiProvider } from '../../ui/Confetti';
import { COMPLETE_FEEDBACK_MS, ItemRow } from './ItemRow';

const item: Item = {
  id: 'item-1',
  household_id: 'h1',
  area_id: 'a1',
  title: 'Heaters not working',
  note: 'No heat since the weekend.',
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

  it('shows the title, note and meta, with the missed date marked', () => {
    const { row } = setup();
    expect(row.textContent).toBe('Heaters not workingNo heat since the weekend.🦆 Shea · Missed · Tue 6 Oct');
    expect(screen.getByText('Missed · Tue 6 Oct').hasAttribute('data-missed')).toBe(true);
  });

  it('leaves out a blank note and, without a due date, the date part', () => {
    const { row } = setup({ note: '  ' }, { who: 'Unassigned', date: null, missed: false });
    expect(row.textContent).toBe('Heaters not workingUnassigned');
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
    expect(document.querySelectorAll('[data-confetti] span')).toHaveLength(36);
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
});
