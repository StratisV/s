import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tab } from '../types';
import { AddButton, hasAddButton, TabBar } from './TabBar';

afterEach(cleanup);

const nav = () => screen.getByRole('navigation', { name: 'Tabs' });
const highlight = () => nav().querySelector<HTMLElement>(':scope > [aria-hidden="true"]')!;

describe('TabBar', () => {
  it('has Home, Goals, Chat, Housekeeping and Stats, each a symbol over its name, with the open one marked', () => {
    const onTab = vi.fn();
    render(<TabBar tab="housekeeping" onTab={onTab} />);
    const buttons = within(nav()).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Home', 'Goals', 'Chat', 'Housekeeping', 'Stats']);
    // A symbol over every name (decorative: the name says it).
    for (const b of buttons) expect(b.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(within(nav()).getByRole('button', { name: 'Housekeeping' }).getAttribute('aria-current')).toBe('page');
    expect(buttons.filter((b) => b.hasAttribute('aria-current'))).toHaveLength(1);
    fireEvent.click(within(nav()).getByRole('button', { name: 'Stats' }));
    expect(onTab).toHaveBeenCalledWith('stats');
    fireEvent.click(within(nav()).getByRole('button', { name: 'Goals' }));
    expect(onTab).toHaveBeenLastCalledWith('goals');
  });

  it('counts this week’s goals not done on Goals, and puts a dot on Chat and Housekeeping', () => {
    const { rerender } = render(<TabBar tab="home" onTab={() => {}} goals={2} unread newNote />);
    const goals = within(nav()).getByRole('button', { name: 'Goals, 2 not done' });
    expect(goals.querySelector('[data-badge]')!.textContent).toBe('2');
    expect(within(nav()).getByRole('button', { name: 'Chat, unread messages' }).querySelector('[data-dot]')).toBeTruthy();
    expect(within(nav()).getByRole('button', { name: 'Housekeeping, new message' }).querySelector('[data-dot]')).toBeTruthy();
    // One, and more than nine.
    rerender(<TabBar tab="home" onTab={() => {}} goals={1} />);
    expect(within(nav()).getByRole('button', { name: 'Goals, 1 not done' })).toBeTruthy();
    rerender(<TabBar tab="home" onTab={() => {}} goals={12} />);
    expect(within(nav()).getByRole('button', { name: 'Goals, 12 not done' }).querySelector('[data-badge]')!.textContent).toBe('9+');
    // Every goal done (or none), nothing unread: plain names.
    rerender(<TabBar tab="home" onTab={() => {}} goals={0} />);
    expect(within(nav()).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([null, null, null, null, null]);
    expect(nav().querySelector('[data-badge], [data-dot]')).toBeNull();
  });

  it('slides the open tab’s highlight to the one chosen', () => {
    const { rerender } = render(<TabBar tab="home" onTab={() => {}} />);
    expect(nav().style.getPropertyValue('--index')).toBe('0');
    expect(nav().style.getPropertyValue('--count')).toBe('5');
    expect(highlight()).toBeTruthy();
    rerender(<TabBar tab="stats" onTab={() => {}} />);
    expect(nav().style.getPropertyValue('--index')).toBe('4');
    rerender(<TabBar tab="goals" onTab={() => {}} />);
    expect(nav().style.getPropertyValue('--index')).toBe('1');
  });
});

describe('AddButton', () => {
  it('shows on Home and Stats only (Goals adds its own way), and pops in when it comes back', () => {
    const show = (tab: Tab) => <AddButton tab={tab} onAdd={() => {}} />;
    const { rerender } = render(show('home'));
    const add = () => screen.queryByRole('button', { name: 'New item' });
    expect(add()?.hasAttribute('data-enter')).toBe(false);
    rerender(show('goals'));
    expect(add()).toBeNull();
    rerender(show('housekeeping'));
    expect(add()).toBeNull();
    rerender(show('chat'));
    expect(add()).toBeNull();
    rerender(show('stats'));
    expect(add()?.hasAttribute('data-enter')).toBe(true);
    expect((['home', 'goals', 'chat', 'housekeeping', 'stats'] as Tab[]).filter(hasAddButton)).toEqual(['home', 'stats']);
  });

  it('opens a new item', () => {
    const onAdd = vi.fn();
    render(<AddButton tab="home" onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: 'New item' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
