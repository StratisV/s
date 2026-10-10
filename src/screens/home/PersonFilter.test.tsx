import { cleanup, render, screen, within } from '@testing-library/react';
import { person } from '../testing/mockHome';
import { PersonFilter } from './PersonFilter';

afterEach(() => cleanup());

describe('PersonFilter', () => {
  it('shows someone who has not joined yet like anyone else; VoiceOver hears that they have not', () => {
    const members = [
      person({ id: 'm-stratis', name: 'Stratis', user_id: 'user-stratis', emoji: '🦆' }),
      person({ id: 'm-shea', name: 'Shea', emoji: '🦔', email: 'shea@gmail.com' }),
    ];
    render(
      <PersonFilter
        members={members}
        meId="m-stratis"
        value="all"
        counts={{ all: 5, none: 1, 'm-stratis': 2, 'm-shea': 2 }}
        onChange={() => {}}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Show tasks for' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Everyone, 5 items',
      'Stratis (you), 2 items',
      'Shea, 2 items, not joined yet',
      'Unassigned, 1 item',
    ]);
    // On screen: no label, just the emoji, name and count.
    expect(radios[2].textContent).toBe('🦔Shea2');
  });
});
