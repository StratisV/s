import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, type StorageLike } from '../../lib/backend/demo';
import { HomeProvider, useHome } from '../../state/HomeProvider';
import { DoneSheet, type DoneTarget } from './DoneSheet';
import { StatsScreen } from './StatsScreen';

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

function Ready({ onOpenDone, done }: { onOpenDone?: (t: DoneTarget, opener: HTMLElement) => void; done?: DoneTarget }) {
  const { phase, data } = useHome();
  if (phase.kind !== 'ready' || !data) return null;
  return (
    <>
      <StatsScreen onOpenProfile={() => {}} onOpenDone={onOpenDone} />
      {done ? <DoneSheet open target={done} onClose={() => {}} /> : null}
    </>
  );
}

async function setup(props: { onOpenDone?: (t: DoneTarget, opener: HTMLElement) => void; done?: DoneTarget } = {}) {
  const backend = new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 });
  render(
    <HomeProvider backend={backend}>
      <Ready {...props} />
    </HomeProvider>,
  );
  await screen.findByRole('radiogroup', { name: 'Period' });
}

const legend = () =>
  within(screen.getByRole('list', { name: 'Done per person' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent);

afterEach(cleanup);

describe('StatsScreen', () => {
  it('shows this month per person, in member order', async () => {
    await setup();
    expect(screen.getByRole('radio', { name: 'This Month' }).getAttribute('aria-checked')).toBe('true');
    expect(legend()).toEqual(['🦔Stratis4', '🦆Shea2', '🦊Ela1']);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('7 tasks done this month: Stratis 4, Shea 2, Ela 1.');
    // One arc per member with completions.
    expect(screen.getByRole('img').querySelectorAll('svg g circle')).toHaveLength(3);
  });

  it('switches to Lifetime by tap and back with the arrow keys', async () => {
    await setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Lifetime' }));
    expect(legend()).toEqual(['🦔Stratis58', '🦆Shea37', '🦊Ela16']);
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/^111 tasks done in total/);

    const lifetime = screen.getByRole('radio', { name: 'Lifetime' });
    lifetime.focus();
    fireEvent.keyDown(lifetime, { key: 'ArrowLeft' });
    expect(screen.getByRole('radio', { name: 'This Month' }).getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'This Month' }));
    expect(legend()).toEqual(['🦔Stratis4', '🦆Shea2', '🦊Ela1']);
  });

  it('opens the tasks behind the circle, a person, or a slice', async () => {
    const onOpenDone = vi.fn();
    await setup({ onOpenDone });
    fireEvent.click(screen.getByRole('button', { name: /^Show the tasks: 7 tasks done this month/ }));
    expect(onOpenDone).toHaveBeenLastCalledWith({ period: 'month', memberId: null }, expect.any(HTMLElement));
    fireEvent.click(screen.getByRole('button', { name: 'Shea, 2 done. Show the tasks' }));
    expect(onOpenDone.mock.lastCall![0]).toMatchObject({ period: 'month', memberId: expect.any(String) });
    const sheaId = onOpenDone.mock.lastCall![0].memberId;
    fireEvent.click(screen.getByRole('img').querySelector(`circle[data-member="${sheaId}"]`)!);
    expect(onOpenDone.mock.lastCall![0]).toEqual({ period: 'month', memberId: sheaId });
    fireEvent.click(screen.getByRole('radio', { name: 'Lifetime' }));
    fireEvent.click(screen.getByRole('button', { name: /^Show the tasks: 111 tasks done in total/ }));
    expect(onOpenDone).toHaveBeenLastCalledWith({ period: 'lifetime', memberId: null }, expect.any(HTMLElement));
  });

  it('lists the tasks done, newest first, for everyone or one person', async () => {
    await setup({ done: { period: 'month', memberId: null } });
    const dialog = await screen.findByRole('dialog', { name: 'Done this month' });
    const rows = () => within(dialog).queryAllByRole('listitem').filter((li) => li.hasAttribute('data-done-row'));
    expect(rows()).toHaveLength(7);
    expect(within(dialog).getByRole('radio', { name: /^Everyone/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Ela, 1' }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toMatch(/Ela ·/);
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Shea, 2' }));
    expect(rows()).toHaveLength(2);
  });
});
