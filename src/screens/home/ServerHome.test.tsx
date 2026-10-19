import { cleanup, render, screen } from '@testing-library/react';
import type { HomeContextValue } from '../../state/HomeProvider';
import { ConfettiProvider } from '../../ui/Confetti';
import { ItemSheet } from '../item/ItemSheet';
import { fakeBackend, makeHome, MockHome, sampleData } from '../testing/mockHome';
import { HomeScreen, READ_ONLY_LINE } from './HomeScreen';
import { NeedsAttentionScreen } from './NeedsAttentionScreen';

vi.mock('../../state/HomeProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../state/HomeProvider')>();
  const { useMockHome } = await import('../testing/mockHome');
  return { ...actual, useHome: useMockHome, useHousehold: useMockHome };
});

const server = () => fakeBackend({ kind: 'server' } as never);

function showHome(home: HomeContextValue) {
  render(
    <MockHome initial={home}>
      <ConfettiProvider>
        <HomeScreen onOpenProfile={() => {}} onOpenArea={() => {}} onOpenAttention={() => {}} />
      </ConfettiProvider>
    </MockHome>,
  );
}

function showAttention(home: HomeContextValue) {
  render(
    <MockHome initial={home}>
      <ConfettiProvider>
        <NeedsAttentionScreen onOpenItem={() => {}} onOpenProfile={() => {}} />
      </ConfettiProvider>
    </MockHome>,
  );
}

function showItem(home: HomeContextValue) {
  render(
    <MockHome initial={home}>
      <ConfettiProvider>
        <ItemSheet target={{ kind: 'edit', itemId: 'i-chemicals' }} open onClose={() => {}} onExited={() => {}} />
      </ConfettiProvider>
    </MockHome>,
  );
}

afterEach(() => cleanup());

describe('Home in server mode', () => {
  it('says saving is paused, under the summary sentence, while the month’s storage is used up', () => {
    showHome(makeHome({ backend: server(), readOnly: true }));
    const line = screen.getByText(READ_ONLY_LINE);
    expect(line.textContent).toBe('Saving is paused until next month: the free storage limit is used up.');
    expect(line.getAttribute('role')).toBe('status');
    // Right under the sentence on what needs doing, above the areas.
    expect(line.previousElementSibling).toBe(document.querySelector('[data-home-summary]'));
    expect(line.nextElementSibling).toBe(screen.getByRole('list', { name: 'Areas' }));
    cleanup();
    // On Needs attention too: under its sentence, above the view switch and whose items.
    showAttention(makeHome({ backend: server(), readOnly: true }));
    const again = screen.getByText(READ_ONLY_LINE);
    expect(again.previousElementSibling).toBe(document.querySelector('[data-attention-summary]'));
    expect(again.nextElementSibling!.contains(screen.getByRole('radiogroup', { name: 'View' }))).toBe(true);
  });

  it('says it with no areas too, and not at all while saving works', () => {
    const data = sampleData();
    data.areas = [];
    data.items = [];
    showHome(makeHome({ backend: server(), readOnly: true, data }));
    expect(screen.getByText(READ_ONLY_LINE)).toBeTruthy();
    cleanup();
    showHome(makeHome({ backend: server(), readOnly: false }));
    expect(screen.queryByText(READ_ONLY_LINE)).toBeNull();
  });
});

describe('Item sheet in server mode', () => {
  it('offers no Notify (nothing sends notifications), and keeps Repeat', () => {
    showItem(makeHome({ backend: server() }));
    expect(screen.getByLabelText('Repeat')).toBeTruthy();
    expect(screen.queryByLabelText('Notify')).toBeNull();
  });

  it('still offers Notify elsewhere', () => {
    showItem(makeHome());
    expect(screen.getByLabelText('Notify')).toBeTruthy();
  });
});
