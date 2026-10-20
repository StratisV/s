import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item, Member } from '../../lib/types';
import { ConfettiProvider } from '../../ui/Confetti';
import { ItemCard } from './ItemCard';
import { COMPLETE_FEEDBACK_MS, LEAVE_MS } from './ItemRow';
import { RevealContext } from './reveal';

const TODAY = '2026-10-08';

const item: Item = {
  id: 'item-1',
  household_id: 'h1',
  area_id: 'a-hall',
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
const HALLWAY = { id: 'a-hall', name: 'Hallway' };

function setup(overrides: Partial<Item> = {}, { showWho = true, lit = null }: { showWho?: boolean; lit?: string | null } = {}) {
  const onOpen = vi.fn();
  const onComplete = vi.fn(() => Promise.resolve());
  const view = render(
    <ConfettiProvider>
      <RevealContext.Provider value={lit}>
        <ul>
          <ItemCard
            item={{ ...item, ...overrides }}
            area={HALLWAY}
            members={MEMBERS}
            today={TODAY}
            timeZone="Europe/London"
            showWho={showWho}
            onOpen={onOpen}
            onComplete={onComplete}
          />
        </ul>
      </RevealContext.Provider>
    </ConfettiProvider>,
  );
  const li = view.container.querySelector('li')!;
  const open = li.querySelector<HTMLButtonElement>('[data-item-open]')!;
  return { onOpen, onComplete, view, li, open };
}

describe('ItemCard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('starts with its area’s picture, hidden from assistive tech, in the button that opens it', () => {
    const { open } = setup();
    const art = open.querySelector('[data-area-art]')!;
    expect(art.getAttribute('aria-hidden')).toBe('true');
    expect(art.getAttribute('data-area-art')).toMatch(/^hallway:/);
    expect(open.firstElementChild!.contains(art)).toBe(true);
  });

  it('says the title, the urgency and when, then its area and who it is for', () => {
    const { open } = setup();
    expect(open.querySelector('[data-meta]')!.textContent).toBe('Urgent2 days late');
    expect(open.querySelector('[data-late]')!.textContent).toBe('2 days late');
    expect(open.querySelector('[data-where]')!.textContent).toBe('Hallway·🦆Shea');
    expect(open.querySelector('[data-room]')!.textContent).toBe('Hallway');
  });

  it('reads one sentence to assistive tech, its area in it, and names the ring', () => {
    const { open } = setup({ repeat: 'monthly' });
    expect(open.querySelector('.visually-hidden')!.textContent).toBe(
      ', Urgent, 2 days late, Hallway, Shea, repeats monthly, has a note.',
    );
    expect(screen.getByRole('button', { name: 'Mark Heaters not working as done' })).toBeTruthy();
    // The ring comes after the words (it sits at the card's end).
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.hasAttribute('data-item-open'))).toEqual([true, false]);
  });

  it('leaves who it is for out while one person’s items show (VoiceOver still hears it), and says Unassigned', () => {
    const filtered = setup({}, { showWho: false });
    expect(filtered.open.querySelector('[data-where]')!.textContent).toBe('Hallway');
    expect(filtered.open.querySelector('.visually-hidden')!.textContent).toContain('Shea');
    cleanup();
    const nobody = setup({ assignee_id: null, note: '' });
    expect(nobody.open.querySelector('[data-who]')).toBeNull();
    expect(nobody.open.querySelector('.visually-hidden')!.textContent).toBe(', Urgent, 2 days late, Hallway, Unassigned.');
  });

  it('a thing looked after: its gauge in the ring’s place, its condition and its area', () => {
    const { open, view } = setup({ kind: 'state', title: 'Shower seal', rag: 'amber', due_date: null, notify: 'none', note: '' });
    expect(screen.queryByRole('button', { name: /^Mark / })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(view.container.querySelector('[data-variant="row"]')!.getAttribute('data-rag')).toBe('amber');
    expect(open.querySelector('[data-meta]')!.textContent).toBe('Okay');
    expect(open.querySelector('.visually-hidden')!.textContent).toBe(', to maintain, Okay, Hallway, Shea.');
  });

  it('opens the item when the card is tapped', () => {
    const { open, onOpen, onComplete } = setup();
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledWith('item-1');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('ticked off, it is struck through, then folds away, a repeating job too, and completes once', async () => {
    const { li, onComplete, onOpen, open } = setup({ repeat: 'weekly' });
    const ring = screen.getByRole('button', { name: 'Mark Heaters not working as done' });
    fireEvent.click(ring);
    fireEvent.click(ring);
    expect(ring.hasAttribute('data-done')).toBe(true);
    expect(li.hasAttribute('data-completing')).toBe(true);
    // A tap on the card during the feedback must not open the sheet.
    fireEvent.click(open);
    expect(onOpen).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(COMPLETE_FEEDBACK_MS);
    });
    // It moves on to a later date, so it leaves the list like a one-off.
    expect(li.hasAttribute('data-leaving')).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(LEAVE_MS);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('item-1');
  });

  it('carries its id, and lights up while it is the item just saved', () => {
    const { li } = setup();
    expect(li.dataset.itemId).toBe('item-1');
    expect(li.hasAttribute('data-lit')).toBe(false);
    cleanup();
    expect(setup({}, { lit: 'item-1' }).li.hasAttribute('data-lit')).toBe(true);
  });
});
