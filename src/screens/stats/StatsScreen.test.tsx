import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DemoBackend, type StorageLike } from '../../lib/backend/demo';
import { HomeProvider, useHome } from '../../state/HomeProvider';
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

function Ready() {
  const { phase, data } = useHome();
  if (phase.kind !== 'ready' || !data) return null;
  return <StatsScreen onOpenProfile={() => {}} />;
}

async function setup() {
  const backend = new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 });
  render(
    <HomeProvider backend={backend}>
      <Ready />
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
});
