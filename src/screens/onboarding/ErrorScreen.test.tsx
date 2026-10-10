import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { HomeContextValue } from '../../state/HomeProvider';
import { makeHome, MockHome } from '../testing/mockHome';
import { ErrorScreen } from './ErrorScreen';

vi.mock('../../state/HomeProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../state/HomeProvider')>();
  const { useMockHome } = await import('../testing/mockHome');
  return { ...actual, useHome: useMockHome, useHousehold: useMockHome };
});

afterEach(() => cleanup());

function show(props: { message: string; offline: boolean }, over: Partial<HomeContextValue> = {}) {
  const home = makeHome(over);
  render(
    <MockHome initial={home}>
      <ErrorScreen {...props} />
    </MockHome>,
  );
  return home;
}

describe('ErrorScreen', () => {
  it('offline: a hero step saying so, and that the home opens by itself once back online', () => {
    show({ message: 'No connection. Try again in a moment.', offline: true });
    expect(screen.getByRole('heading', { level: 1, name: 'You’re offline' })).toBeTruthy();
    expect(screen.getByText('Your home opens by itself as soon as you’re back online.')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('anything else: what went wrong', () => {
    show({ message: 'Something went wrong. Try again.', offline: false });
    expect(screen.getByRole('heading', { level: 1, name: 'Couldn’t open your home' })).toBeTruthy();
    expect(screen.getByText('Something went wrong. Try again.')).toBeTruthy();
  });

  it('Try Again retries (busy meanwhile)', async () => {
    let finish!: () => void;
    const home = show(
      { message: 'No connection.', offline: true },
      { retry: vi.fn(() => new Promise<void>((r) => (finish = r))) },
    );
    const button = screen.getByRole('button', { name: 'Try Again' });
    fireEvent.click(button);
    expect(home.retry).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(home.retry).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBeNull());
  });
});
