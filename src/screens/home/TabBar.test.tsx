import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tab } from '../types';
import { AddButton, TabBar } from './TabBar';

afterEach(cleanup);

const thumb = () =>
  screen.getByRole('navigation', { name: 'Tabs' }).querySelector<HTMLElement>('[aria-hidden="true"]')!;

describe('TabBar', () => {
  it('has Home, Chat, Housekeeping and Stats, with the open one marked', () => {
    const onTab = vi.fn();
    render(<TabBar tab="housekeeping" onTab={onTab} unread />);
    const nav = screen.getByRole('navigation', { name: 'Tabs' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Home', 'Chat', 'Housekeeping', 'Stats']);
    expect(within(nav).getByRole('button', { name: 'Housekeeping' }).getAttribute('aria-current')).toBe('page');
    expect(
      within(nav)
        .getAllByRole('button')
        .filter((b) => b.hasAttribute('aria-current')),
    ).toHaveLength(1);
    expect(within(nav).getByRole('button', { name: 'Chat, unread messages' })).toBeTruthy();
    fireEvent.click(within(nav).getByRole('button', { name: 'Stats' }));
    expect(onTab).toHaveBeenCalledWith('stats');
  });

  it('slides the thumb from the tab shown before, even when a new switch mounts', () => {
    const { unmount } = render(<TabBar tab="home" onTab={() => {}} />);
    expect(thumb().hasAttribute('data-measured')).toBe(true);
    unmount();
    // The next screen draws its own switch: the thumb starts at Home and slides to Housekeeping.
    render(<TabBar tab="housekeeping" onTab={() => {}} />);
    expect(thumb().dataset.animate).toBe('true');
  });

  it('does not slide with Reduce Motion', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('matchMedia', matchMedia);
    try {
      const { rerender } = render(<TabBar tab="home" onTab={() => {}} />);
      rerender(<TabBar tab="stats" onTab={() => {}} />);
      expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
      expect(thumb().dataset.animate).toBe('false');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('AddButton', () => {
  it('shows on Home and Stats only, and pops in when it comes back', () => {
    const show = (tab: Tab) => <AddButton tab={tab} onAdd={() => {}} />;
    const { rerender } = render(show('home'));
    const add = () => screen.queryByRole('button', { name: 'New item' });
    expect(add()?.hasAttribute('data-enter')).toBe(false);
    rerender(show('housekeeping'));
    expect(add()).toBeNull();
    rerender(show('chat'));
    expect(add()).toBeNull();
    rerender(show('stats'));
    expect(add()?.hasAttribute('data-enter')).toBe(true);
  });
});
