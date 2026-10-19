import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AreaCard, countWords, peopleWords, type AreaCardProps } from './AreaCard';

afterEach(cleanup);

const STRATIS = { id: 'm-stratis', name: 'Stratis', emoji: '🦆' };
const SHEA = { id: 'm-shea', name: 'Shea', emoji: '🦔' };
const ELA = { id: 'm-ela', name: 'Ela', emoji: '🦊' };

function card(over: Partial<AreaCardProps> = {}) {
  const onOpen = vi.fn();
  const props: AreaCardProps = {
    area: { id: 'a-kitchen', name: 'Kitchen' },
    status: 'attention',
    statusText: '2 need attention',
    openCount: 3,
    people: [SHEA, ELA],
    onOpen,
    ...over,
  };
  const view = render(<AreaCard {...props} />);
  return { ...view, onOpen, button: screen.getByRole('button') };
}

describe('AreaCard', () => {
  it('is one button named for the area, its status, its To dos and who looks after it', () => {
    const { button, container } = card();
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(button.getAttribute('aria-label')).toBe('Kitchen, 2 need attention, 3 to do, Shea and Ela looking after it');
    expect(screen.getByRole('button', { name: /^Kitchen,/ })).toBe(button);
    expect(button.getAttribute('type')).toBe('button');
  });

  it('shows the name, the status in words, the count and the people', () => {
    const { button } = card();
    expect(button.textContent).toContain('Kitchen');
    expect(button.textContent).toContain('2 need attention');
    expect(button.textContent).toContain('3 to do');
    expect(button.textContent).toContain('Shea and Ela');
    // Their faces, the household's own drawn hedgehog among them.
    expect(button.querySelectorAll('[data-drawn="hedgehog"]')).toHaveLength(1);
    expect(button.textContent).toContain('🦊');
    expect(button.dataset.status).toBe('attention');
  });

  it('says when there is nothing to do and no one looking after it', () => {
    const { button } = card({ status: 'good', statusText: 'All good', openCount: 0, people: [] });
    expect(button.textContent).toContain('All good');
    expect(button.textContent).toContain('Nothing to do');
    expect(button.textContent).toContain('No one yet');
    expect(button.getAttribute('aria-label')).toBe('Kitchen, All good, Nothing to do, no one looking after it yet');
    expect(button.dataset.status).toBe('good');
  });

  it('names everyone for screen readers, and shortens the names it shows', () => {
    const { button } = card({ status: 'soon', statusText: '1 coming up', openCount: 1, people: [STRATIS, SHEA, ELA] });
    expect(button.getAttribute('aria-label')).toBe('Kitchen, 1 coming up, 1 to do, Stratis, Shea and Ela looking after it');
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
  it('counts the To dos', () => {
    expect(countWords(0)).toBe('Nothing to do');
    expect(countWords(1)).toBe('1 to do');
    expect(countWords(12)).toBe('12 to do');
  });

  it('lists who is looking after it', () => {
    expect(peopleWords([])).toBe('No one yet');
    expect(peopleWords(['Shea'])).toBe('Shea');
    expect(peopleWords(['Shea', 'Ela'])).toBe('Shea and Ela');
    expect(peopleWords(['Stratis', 'Shea', 'Ela'])).toBe('Stratis, Shea +1');
    expect(peopleWords(['A', 'B', 'C', 'D'])).toBe('A, B +2');
  });
});
