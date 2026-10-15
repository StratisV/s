import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu, type MenuItem } from './Menu';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(items: MenuItem[], title?: string) {
  render(
    <Menu label="Kitchen" title={title} items={items}>
      {({ ref, ...trigger }) => (
        <button ref={ref} type="button" aria-label="Kitchen options" {...trigger}>
          ...
        </button>
      )}
    </Menu>,
  );
  return screen.getByRole('button', { name: 'Kitchen options' });
}

const actions = () => {
  const add = vi.fn();
  const share = vi.fn();
  return {
    add,
    share,
    items: [
      { key: 'add', label: 'Add Item', ariaLabel: 'Add item to Kitchen', onSelect: add },
      { key: 'share', label: 'Share Room', onSelect: share },
      { key: 'fold', label: 'Collapse All Rooms', groupStart: true, onSelect: () => {} },
    ] satisfies MenuItem[],
  };
};

describe('Menu', () => {
  it('opens from its button, says it has a menu and whether it is open, and focuses the first item', () => {
    const button = setup(actions().items);
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'Kitchen' });
    expect(button.getAttribute('aria-controls')).toBe(menu.id);
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.getAttribute('aria-label') ?? i.textContent)).toEqual([
      'Add item to Kitchen',
      'Share Room',
      'Collapse All Rooms',
    ]);
    expect(document.activeElement).toBe(items[0]);
    // A hairline before a new group.
    expect(items[2].hasAttribute('data-group-start')).toBe(true);
  });

  it('moves with the arrow keys, Home and End; Escape closes it and focus goes back to the button', () => {
    const button = setup(actions().items);
    act(() => button.focus());
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('ArrowUp on the button opens it on the last item; Tab closes it', () => {
    const button = setup(actions().items);
    act(() => button.focus());
    fireEvent.keyDown(button, { key: 'ArrowUp' });
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('choosing an item closes it, puts focus back on the button, then runs the item', () => {
    const { items, share } = actions();
    const button = setup(items);
    fireEvent.click(button);
    share.mockImplementation(() => expect(document.activeElement).toBe(button));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Share Room' }));
    expect(share).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('a tap outside closes it without reaching what is underneath, and it leaves the page once faded', () => {
    vi.useFakeTimers();
    const { items, add } = actions();
    const button = setup(items);
    fireEvent.click(button);
    const menu = screen.getByRole('menu');
    const backdrop = menu.previousElementSibling as HTMLElement;
    fireEvent.pointerDown(backdrop);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(add).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a choice among several: radio items with a check on the chosen one, focused when it opens; a title names it', () => {
    const pick = vi.fn();
    const button = setup(
      [
        { key: 'all', label: 'Everyone', detail: '19 open', checked: false, onSelect: () => pick('all') },
        { key: 'shea', label: 'Shea', note: 'Not joined yet', detail: '6 open', checked: true, onSelect: () => pick('shea') },
      ],
      'Show tasks for',
    );
    fireEvent.click(button);
    const menu = screen.getByRole('menu', { name: 'Show tasks for' });
    const radios = within(menu).getAllByRole('menuitemradio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    expect(document.activeElement).toBe(radios[1]);
    expect(radios[1].textContent).toBe('SheaNot joined yet6 open');
    fireEvent.click(radios[0]);
    expect(pick).toHaveBeenCalledWith('all');
  });

  it('a scroll that moves its button closes it, and leaves focus where it is', () => {
    const button = setup(actions().items);
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    // The page scrolls by 40px: the button is no longer where the menu hangs from.
    button.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: -40, width: 44, height: 44 });
    fireEvent.scroll(window);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('a scroll that leaves its button where it is (a late one, or elsewhere) keeps it open', () => {
    const button = setup(actions().items);
    fireEvent.click(button);
    fireEvent.scroll(window);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'Kitchen' })).toBeTruthy();
  });
});
