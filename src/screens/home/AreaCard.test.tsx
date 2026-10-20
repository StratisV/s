import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AreaCard, peopleWords, type AreaCardProps } from './AreaCard';

afterEach(cleanup);

const STRATIS = { id: 'm-stratis', name: 'Stratis', emoji: '🦆' };
const SHEA = { id: 'm-shea', name: 'Shea', emoji: '🦔' };
const ELA = { id: 'm-ela', name: 'Ela', emoji: '🦊' };

function card(over: Partial<AreaCardProps> = {}) {
  const onOpen = vi.fn();
  const props: AreaCardProps = {
    area: { id: 'a-kitchen', name: 'Kitchen' },
    urgent: 2,
    nonUrgent: 1,
    people: [SHEA, ELA],
    onOpen,
    ...over,
  };
  const view = render(<AreaCard {...props} />);
  return { ...view, onOpen, button: screen.getByRole('button') };
}

/** The status lines on a card: [tone, words]. */
const lines = (button: HTMLElement) =>
  Array.from(button.querySelectorAll<HTMLElement>('[data-tone]')).map((el) => [el.dataset.tone, el.textContent]);

describe('AreaCard', () => {
  it('is one button named for the area, how it is and who looks after it', () => {
    const { button, container } = card();
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(button.getAttribute('aria-label')).toBe('Kitchen, 2 urgent tasks, 1 non-urgent task, Shea and Ela looking after it');
    expect(screen.getByRole('button', { name: /^Kitchen,/ })).toBe(button);
    expect(button.getAttribute('type')).toBe('button');
  });

  it('shows the name, the urgent tasks in red over the non-urgent ones in orange, and the people', () => {
    const { button } = card();
    expect(button.textContent).toContain('Kitchen');
    // The visually hidden comma reads the two lines as one phrase.
    expect(lines(button)).toEqual([
      ['urgent', '2 urgent tasks, '],
      ['non-urgent', '1 non-urgent task'],
    ]);
    expect(button.querySelector('[data-card-status]')!.textContent).toBe('2 urgent tasks, 1 non-urgent task');
    expect(button.textContent).toContain('Shea and Ela');
    // No count of To dos of its own: the lines say it.
    expect(button.textContent).not.toMatch(/to do/);
    // Their faces, the household's own drawn hedgehog among them.
    expect(button.querySelectorAll('[data-drawn="hedgehog"]')).toHaveLength(1);
    expect(button.textContent).toContain('🦊');
    expect(button.dataset.status).toBe('urgent');
  });

  it('shows one line when only one applies, in the singular or the plural', () => {
    const urgent = card({ urgent: 1, nonUrgent: 0 });
    expect(lines(urgent.button)).toEqual([['urgent', '1 urgent task']]);
    cleanup();
    const later = card({ urgent: 0, nonUrgent: 3 });
    expect(lines(later.button)).toEqual([['non-urgent', '3 non-urgent tasks']]);
    expect(later.button.dataset.status).toBe('non-urgent');
    expect(later.button.getAttribute('aria-label')).toBe('Kitchen, 3 non-urgent tasks, Shea and Ela looking after it');
  });

  it('says All good, and that no one is looking after it, when there is nothing to do', () => {
    const { button } = card({ urgent: 0, nonUrgent: 0, people: [] });
    expect(lines(button)).toEqual([['good', 'All good']]);
    expect(button.textContent).toContain('No one yet');
    expect(button.getAttribute('aria-label')).toBe('Kitchen, All good, no one looking after it yet');
    expect(button.dataset.status).toBe('good');
  });

  it('names everyone for screen readers, and shortens the names it shows', () => {
    const { button } = card({ urgent: 0, nonUrgent: 1, people: [STRATIS, SHEA, ELA] });
    expect(button.getAttribute('aria-label')).toBe('Kitchen, 1 non-urgent task, Stratis, Shea and Ela looking after it');
    expect(button.textContent).toContain('Stratis, Shea +1');
  });

  it('carries its picture, hidden from screen readers', () => {
    const { button } = card({ area: { id: 'a-1', name: 'Bathroom Small' } });
    const art = button.querySelector('[data-area-art]')!;
    expect(art.getAttribute('aria-hidden')).toBe('true');
    expect(art.getAttribute('data-area-art')).toMatch(/^bathroom-alt:/);
  });

  it('opens the area when tapped', () => {
    const { button, onOpen } = card();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('words', () => {
  it('lists who is looking after it', () => {
    expect(peopleWords([])).toBe('No one yet');
    expect(peopleWords(['Shea'])).toBe('Shea');
    expect(peopleWords(['Shea', 'Ela'])).toBe('Shea and Ela');
    expect(peopleWords(['Stratis', 'Shea', 'Ela'])).toBe('Stratis, Shea +1');
    expect(peopleWords(['A', 'B', 'C', 'D'])).toBe('A, B +2');
  });
});
