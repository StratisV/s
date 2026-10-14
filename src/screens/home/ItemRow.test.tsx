import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item, Member } from '../../lib/types';
import { ConfettiProvider } from '../../ui/Confetti';
import { COMPLETE_FEEDBACK_MS, firstName, ItemRow, LEAVE_MS, splitLastWord } from './ItemRow';

const TODAY = '2026-10-08';

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

const member = (id: string, name: string, emoji: string): Member => ({
  id,
  household_id: 'h1',
  user_id: `u-${id}`,
  name,
  email: '',
  emoji,
  color: '#007AFF',
  role: 'member',
  weekly_email: true,
  push_enabled: false,
  created_at: '2026-10-01T00:00:00Z',
});

const MEMBERS = [member('m1', 'Shea', '🦆'), member('m2', 'Ela', '🦊')];

function setup(overrides: Partial<Item> = {}, extra: { room?: string; hideWhen?: boolean; showWho?: boolean } = {}) {
  const onOpen = vi.fn();
  const onComplete = vi.fn(() => Promise.resolve());
  const props = {
    item: { ...item, ...overrides },
    members: MEMBERS,
    today: TODAY,
    timeZone: 'Europe/London',
    onOpen,
    onComplete,
    ...extra,
  };
  const view = render(
    <ConfettiProvider>
      <ul>
        <ItemRow {...props} />
      </ul>
    </ConfettiProvider>,
  );
  const ring = screen.queryByRole('button', { name: `Mark ${props.item.title} as done` });
  const row = view.container.querySelector<HTMLButtonElement>('[data-item-open]')!;
  const meta = row.querySelector<HTMLElement>('[data-meta]')!;
  return { onOpen, onComplete, ring, row, meta, view };
}

describe('ItemRow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('says how urgent a To do is in words, on the row: Urgent, Within the month, Not urgent', () => {
    for (const [rag, word] of [
      ['red', 'Urgent'],
      ['amber', 'Within the month'],
      ['green', 'Not urgent'],
    ] as const) {
      const { meta, view } = setup({ rag, due_date: '2026-10-12' });
      const badge = meta.querySelector<HTMLElement>('[data-rag]')!;
      expect(badge.textContent).toBe(word);
      expect(badge.dataset.rag).toBe(rag);
      view.unmount();
    }
  });

  it('shows when it is due relative to today, a late date in red, and its room where the list mixes rooms', () => {
    const { meta } = setup({}, { room: 'Hallway' });
    expect(meta.textContent).toBe('Urgent2 days late·Hallway');
    expect(screen.getByText('2 days late').hasAttribute('data-late')).toBe(true);
    cleanup();
    const soon = setup({ rag: 'amber', due_date: '2026-10-12' });
    expect(soon.meta.textContent).toBe('Within the monthIn 4 days');
  });

  it('puts the room after the words in a part of its own that can take the next line, its dot with it', () => {
    const { meta } = setup({}, { room: 'Hallway' });
    const part = meta.querySelector('[data-room]')!.parentElement!;
    // Its own flex item, after the urgency and when (so a short line moves it down whole)...
    expect(part.parentElement).toBe(meta);
    expect(part.firstElementChild!.textContent).toBe('·');
    expect(meta.firstElementChild!.textContent).toBe('Urgent2 days late');
    cleanup();
    // ...but straight after a coloured label, with nothing said between, it stays beside it, without a dot.
    const state = setup({ kind: 'state', rag: 'red', due_date: null }, { room: 'Garden' });
    expect(state.meta.textContent).toBe('Needs workGarden');
    expect(state.meta.querySelector('[data-room]')!.parentElement).toBe(state.meta.firstElementChild);
  });

  it('leaves out the date where the list says it, but never a late one', () => {
    const today = setup({ rag: 'green', due_date: TODAY }, { hideWhen: true, room: 'Garden' });
    expect(today.meta.textContent).toBe('Not urgent·Garden');
    cleanup();
    const late = setup({}, { hideWhen: true });
    expect(late.meta.textContent).toContain('2 days late');
  });

  it('reads one sentence to assistive tech, and keeps the ring name', () => {
    const { row, ring } = setup({ repeat: 'monthly' }, { room: 'Hallway' });
    expect(row.querySelector('.visually-hidden')!.textContent).toBe(
      ', Urgent, 2 days late, Hallway, Shea, repeats monthly, has a note.',
    );
    expect(ring!.getAttribute('aria-label')).toBe('Mark Heaters not working as done');
    cleanup();
    const nobody = setup({ assignee_id: null, note: '  ', due_date: null, rag: 'green' });
    expect(nobody.row.querySelector('.visually-hidden')!.textContent).toBe(', Not urgent, Unassigned.');
  });

  it('shows who it is for, their emoji and first name, unless one person’s items are shown', () => {
    const { row } = setup({}, { room: 'Hallway' });
    expect(row.querySelector('[data-who]')!.textContent).toBe('🦆Shea');
    cleanup();
    const filtered = setup({}, { room: 'Hallway', showWho: false });
    expect(filtered.row.querySelector('[data-who]')).toBeNull();
    // VoiceOver still hears who it is for.
    expect(filtered.row.querySelector('.visually-hidden')!.textContent).toContain('Shea');
    cleanup();
    const nobody = setup({ assignee_id: null });
    expect(nobody.row.querySelector('[data-who]')).toBeNull();
  });

  it('keeps the note glyph on the line of the title’s last word', () => {
    const { row } = setup({ title: 'Heaters not working' });
    const tail = row.querySelector('svg')!.parentElement!;
    expect(tail.textContent).toBe('working');
    expect(splitLastWord('Clear the gutters ')).toEqual(['Clear the ', 'gutters']);
    expect(splitLastWord('Oven')).toEqual(['', 'Oven']);
    // A last word too long to keep whole is left where it falls.
    expect(splitLastWord('See https://example.com/a-long-link')).toEqual(['See https://example.com/a-long-link', '']);
    expect(firstName('  Shea Byrne ')).toBe('Shea');
  });

  it('opens the item when the row is tapped', () => {
    const { row, onOpen, onComplete } = setup();
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith('item-1');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('fills the ring, fires confetti, folds the row away and completes once, even on fast repeated taps', async () => {
    const { ring, row, onOpen, onComplete, view } = setup();
    fireEvent.click(ring!);
    fireEvent.click(ring!);
    expect(ring!.hasAttribute('data-done')).toBe(true);
    // The title is struck through while the check shows, so it is clear which one was ticked.
    expect(view.container.querySelector('li')!.hasAttribute('data-completing')).toBe(true);
    expect(document.querySelectorAll('[data-confetti] > div > *')).toHaveLength(14);
    // A row tap during the feedback must not open the sheet.
    fireEvent.click(row);
    expect(onOpen).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(COMPLETE_FEEDBACK_MS);
    });
    // A one-off leaves its list: the row folds away first.
    expect(view.container.querySelector('li')!.hasAttribute('data-leaving')).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(LEAVE_MS);
    });
    fireEvent.click(ring!);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('item-1');
    expect(ring!.hasAttribute('data-done')).toBe(false);
  });

  it('accepts a new tap on a repeating item once the cooldown has passed (it stays, so it does not fold)', async () => {
    const { ring, onComplete, view } = setup({ repeat: 'monthly' });
    fireEvent.click(ring!);
    await act(async () => {
      vi.advanceTimersByTime(COMPLETE_FEEDBACK_MS);
    });
    expect(view.container.querySelector('li')!.hasAttribute('data-leaving')).toBe(false);
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(ring!);
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
      assignee_id: 'm2',
      updated_at: '2026-10-06T09:00:00Z',
    };

    it('shows a condition gauge instead of the ring, and it is not a button', () => {
      const { view, ring } = setup(firepit);
      expect(ring).toBeNull();
      // The row's only button opens it.
      expect(screen.getAllByRole('button')).toHaveLength(1);
      const gauge = view.container.querySelector<HTMLElement>('li [data-variant="row"]')!;
      expect(gauge.dataset.rag).toBe('green');
      expect(gauge.querySelectorAll('[data-on]')).toHaveLength(3);
      expect(view.container.querySelector('li')!.dataset.kind).toBe('state');
    });

    it('says its condition in words: Good, Okay, Needs work, with fewer bars filled', () => {
      for (const [rag, word, bars] of [
        ['green', 'Good', 3],
        ['amber', 'Okay', 2],
        ['red', 'Needs work', 1],
      ] as const) {
        const { meta, view } = setup({ ...firepit, rag });
        expect(meta.querySelector('[data-rag]')!.textContent).toBe(word);
        expect(view.container.querySelectorAll('li [data-variant="row"] [data-on]')).toHaveLength(bars);
        view.unmount();
      }
    });

    it('reads "<title>, to maintain, Good, ... updated 2 days ago" and when it was last updated', () => {
      const { row, meta } = setup(firepit);
      expect(meta.textContent).toBe('Good·Updated 2 days ago');
      expect(row.querySelector('.visually-hidden')!.textContent).toBe(', to maintain, Good, Ela, updated 2 days ago, has a note.');
    });

    it('says its room instead of when it was updated where the list mixes rooms', () => {
      const { row, meta } = setup(firepit, { room: 'Garden' });
      expect(meta.textContent).toBe('Good·Garden');
      expect(row.querySelector('.visually-hidden')!.textContent).toBe(', to maintain, Good, Garden, Ela, has a note.');
    });

    it('opens on a tap or from the keyboard, and never completes', async () => {
      const { row, onOpen, onComplete } = setup(firepit);
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
