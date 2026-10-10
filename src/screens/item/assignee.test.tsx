import { cleanup, render, screen } from '@testing-library/react';
import { makeHome, MockHome } from '../testing/mockHome';
import { ItemSheet } from './ItemSheet';

vi.mock('../../state/HomeProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../state/HomeProvider')>();
  const { useMockHome } = await import('../testing/mockHome');
  return { ...actual, useHome: useMockHome, useHousehold: useMockHome };
});

afterEach(() => cleanup());

describe('Item sheet: who it is assigned to', () => {
  it('lists people who have not joined yet, with a quiet "Not joined yet"', () => {
    render(
      <MockHome initial={makeHome()}>
        <ItemSheet target={{ kind: 'edit', itemId: 'i-chemicals' }} open onClose={() => {}} onExited={() => {}} />
      </MockHome>,
    );
    const select = screen.getByLabelText('Assigned to') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      '🦆 Stratis',
      '🦔 Shea · Not joined yet',
      '🐻 Pat · Not joined yet',
      'Unassigned',
    ]);
    // Chosen: just the person, as for anyone.
    expect(select.value).toBe('m-shea');
    expect(select.parentElement!.querySelector('span[aria-hidden="true"]')!.textContent).toBe('🦔 Shea');
  });
});
