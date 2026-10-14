import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { person } from '../testing/mockHome';
import { filterName, PersonFilter } from './PersonFilter';

afterEach(() => cleanup());

const members = [
  person({ id: 'm-stratis', name: 'Stratis', user_id: 'user-stratis', emoji: '🦆' }),
  person({ id: 'm-shea', name: 'Shea', emoji: '🦔', email: 'shea@gmail.com' }),
];
const counts = { all: 5, none: 1, 'm-stratis': 2, 'm-shea': 2 };

function setup(value = 'all') {
  const onChange = vi.fn();
  render(<PersonFilter members={members} meId="m-stratis" value={value} counts={counts} onChange={onChange} />);
  return { onChange };
}

describe('PersonFilter', () => {
  it('Mine is one tap: on shows only your items, and a second tap shows everyone’s again', () => {
    const { onChange } = setup();
    const mine = screen.getByRole('button', { name: 'Mine' });
    expect(mine.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(mine);
    expect(onChange).toHaveBeenLastCalledWith('m-stratis');
    cleanup();
    const on = setup('m-stratis');
    const pressed = screen.getByRole('button', { name: 'Mine' });
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(pressed);
    expect(on.onChange).toHaveBeenLastCalledWith('all');
    // The people menu's button names the choice either way.
    expect(screen.getByRole('button', { name: 'Show tasks for: Stratis (you)' })).toBeTruthy();
  });

  it('opens a menu of everyone, you, each person and Unassigned, with how many are open; VoiceOver hears who has not joined', () => {
    const { onChange } = setup();
    const button = screen.getByRole('button', { name: 'Show tasks for: Everyone' });
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(button);
    const menu = screen.getByRole('menu', { name: 'Show tasks for' });
    const radios = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Everyone, 5 items',
      'Stratis (you), 2 items',
      'Shea, 2 items, not joined yet',
      'Unassigned, 1 item',
    ]);
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    // On screen: the emoji, the name, a note for someone who has not joined, and how many are open.
    expect(radios[2].textContent).toBe('🦔SheaNot joined yet2 open');
    expect(radios[1].textContent).toBe('🦆Stratis (you)2 open');
    fireEvent.click(radios[2]);
    expect(onChange).toHaveBeenCalledWith('m-shea');
  });

  it('washes the pill in the tint while it narrows Home to someone else or the unassigned', () => {
    setup('m-shea');
    expect(screen.getByRole('button', { name: 'Show tasks for: Shea' }).hasAttribute('data-filtered')).toBe(true);
    expect(screen.getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed')).toBe('false');
    cleanup();
    setup('m-stratis');
    // Mine shows it: the pill stays quiet.
    expect(screen.getByRole('button', { name: /^Show tasks for/ }).hasAttribute('data-filtered')).toBe(false);
  });

  it('names a choice in words', () => {
    expect(filterName('all', members, 'm-stratis')).toBe('Everyone');
    expect(filterName('none', members, 'm-stratis')).toBe('Unassigned');
    expect(filterName('m-stratis', members, 'm-stratis')).toBe('Stratis (you)');
    expect(filterName('m-shea', members, 'm-stratis')).toBe('Shea');
    expect(filterName('gone', members, 'm-stratis')).toBe('Everyone');
  });
});
