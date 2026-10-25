// The public link's page (?goals=<token>): what anyone sees, signed in or not.

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicGoals } from '../../lib/types';
import { INACTIVE_TEXT, INACTIVE_TITLE, PUBLIC_IDLE_MS, PUBLIC_REFRESH_MS, PublicGoalsPage } from './PublicGoalsPage';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';

const VIEW: PublicGoals = {
  week: '2026-10-05',
  goals: [
    { title: 'Sort out the recycling rota', done: false, person: { name: 'Ela', emoji: '🐻' } },
    { title: 'Deep clean the fridge', done: true, person: { name: 'Shea', emoji: '🦆' } },
    { title: 'Plan Saturday’s dinner', done: false, person: null },
  ],
};

/** Lets the page's read settle. */
const settle = () => act(async () => {});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the public goals page', () => {
  it('shows the week’s dates, how much is done, and each goal with its tick and who is on it', async () => {
    const read = vi.fn(async () => VIEW);
    render(<PublicGoalsPage token={TOKEN} read={read} />);
    expect(document.querySelector('[data-public-goals]')!.getAttribute('data-public-goals')).toBe('loading');
    expect(await screen.findByText('1 of 3 done')).toBeTruthy();
    expect(read).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByRole('heading', { level: 1, name: 'Goals for the week' })).toBeTruthy();
    expect(screen.getByText('5 to 11 Oct')).toBeTruthy();
    const items = within(document.querySelector<HTMLElement>('[data-public-list]')!).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Sort out the recycling rota🐻 Ela',
      'Deep clean the fridge🦆 Shea',
      'Plan Saturday’s dinner',
    ]);
    expect(within(items[1]).getByRole('img', { name: 'Done' })).toBeTruthy();
    expect(within(items[0]).getByRole('img', { name: 'Not done yet' })).toBeTruthy();
    // Its own title, and kept out of search engines.
    expect(document.title).toBe('Goals for the week');
    expect(document.head.querySelector('meta[name="robots"]')!.getAttribute('content')).toBe('noindex, nofollow');
    // Nothing to do here: no buttons, no fields.
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.queryAllByRole('textbox')).toEqual([]);
  });

  it('a week with nothing yet, and a week all done', async () => {
    const read = vi.fn(async (): Promise<PublicGoals> => ({ week: VIEW.week, goals: [] }));
    render(<PublicGoalsPage token={TOKEN} read={read} />);
    expect(await screen.findByRole('heading', { name: 'Nothing planned yet' })).toBeTruthy();
    cleanup();
    render(<PublicGoalsPage token={TOKEN} read={async () => ({ week: VIEW.week, goals: VIEW.goals.map((g) => ({ ...g, done: true })) })} />);
    expect(await screen.findByText('All 3 done')).toBeTruthy();
  });

  it('a link turned off (or never made) says so calmly', async () => {
    render(<PublicGoalsPage token={TOKEN} read={async () => null} />);
    const status = await screen.findByRole('status');
    expect(within(status).getByRole('heading', { name: INACTIVE_TITLE })).toBeTruthy();
    expect(within(status).getByText(INACTIVE_TEXT)).toBeTruthy();
    expect(document.querySelector('[data-public-goals]')!.getAttribute('data-public-goals')).toBe('inactive');
    // It no longer promises to keep itself up to date.
    expect(screen.getByText('Shared from home.os.')).toBeTruthy();
  });

  it('no connection: Try Again', async () => {
    const read = vi.fn<(token: string) => Promise<PublicGoals | null>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(VIEW);
    render(<PublicGoalsPage token={TOKEN} read={read} />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'Couldn’t load the goals' })).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByText('1 of 3 done')).toBeTruthy();
  });

  it('asks again every minute while in use, keeps what it shows when that fails, and rests when left alone', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    let view = VIEW;
    let fail = false;
    const read = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return view;
    });
    render(<PublicGoalsPage token={TOKEN} read={read} />);
    await settle();
    expect(screen.getByText('1 of 3 done')).toBeTruthy();

    // Someone at home ticks one: within a minute it shows here.
    view = { ...VIEW, goals: VIEW.goals.map((g) => ({ ...g, done: g.done || g.title === 'Plan Saturday’s dinner' })) };
    await act(async () => {
      vi.advanceTimersByTime(PUBLIC_REFRESH_MS);
    });
    expect(screen.getByText('2 of 3 done')).toBeTruthy();

    // A refresh that fails keeps the list.
    fail = true;
    await act(async () => {
      vi.advanceTimersByTime(PUBLIC_REFRESH_MS);
    });
    expect(screen.getByText('2 of 3 done')).toBeTruthy();
    fail = false;

    // Left alone for a long while: it stops asking, until someone uses the page again.
    await act(async () => {
      vi.advanceTimersByTime(PUBLIC_IDLE_MS + PUBLIC_REFRESH_MS);
    });
    const calls = read.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(PUBLIC_REFRESH_MS * 3);
    });
    expect(read.mock.calls.length).toBe(calls);
    fireEvent.pointerDown(window);
    await act(async () => {
      vi.advanceTimersByTime(PUBLIC_REFRESH_MS);
    });
    expect(read.mock.calls.length).toBe(calls + 1);
  });
});
