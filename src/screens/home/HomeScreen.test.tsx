import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, type StorageLike } from '../../lib/backend/demo';
import { HomeProvider, useHome, type HomeContextValue } from '../../state/HomeProvider';
import { ConfettiProvider } from '../../ui/Confetti';
import { HomeScreen } from './HomeScreen';

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

function Ready({ onOpenProfile, expose }: { onOpenProfile(): void; expose(home: HomeContextValue): void }) {
  const home = useHome();
  expose(home);
  if (home.phase.kind !== 'ready' || !home.data) return null;
  return <HomeScreen onOpenItem={() => {}} onAddItem={onAddItem} onOpenProfile={onOpenProfile} />;
}

async function setup() {
  const backend = new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 });
  const onOpenProfile = vi.fn();
  let home!: HomeContextValue;
  render(
    <HomeProvider backend={backend}>
      <ConfettiProvider>
        <Ready onOpenProfile={onOpenProfile} expose={(h) => (home = h)} />
      </ConfettiProvider>
    </HomeProvider>,
  );
  await screen.findByRole('heading', { name: 'Home', level: 1 });
  return { onOpenProfile, home: () => home };
}

afterEach(cleanup);

describe('HomeScreen', () => {
  it('lists the areas and says each row’s status to assistive tech', async () => {
    await setup();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(11);
    expect(screen.queryByText('No areas yet')).toBeNull();
    // jsdom's name computation may put a space before the comma.
    const heaters = screen.getByRole('button', { name: /^Heaters not working ?, Red\. No heat since the weekend/ });
    expect(heaters.hasAttribute('data-item-open')).toBe(true);
    expect(screen.getByRole('button', { name: /^Olive oil ?, Green\./ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Shower draining slowly ?, Amber\./ })).toBeTruthy();
    // The ring keeps its name.
    expect(screen.getByRole('button', { name: 'Mark Heaters not working as done' })).toBeTruthy();
  });

  it('shows a way to add an area when there are none left', async () => {
    const { home, onOpenProfile } = await setup();
    await act(async () => {
      for (const area of home().data!.areas) await home().deleteArea(area.id);
    });
    await waitFor(() => expect(home().data!.areas).toHaveLength(0));

    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
    expect(screen.getByText('No areas yet')).toBeTruthy();
    expect(screen.getByText(/Add one in Profile, under Household\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Profile' }));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);

    // Adding one back replaces the card with the area.
    await act(async () => {
      await home().createArea('Kitchen');
    });
    await screen.findByRole('heading', { name: 'Kitchen', level: 2 });
    expect(screen.queryByText('No areas yet')).toBeNull();
    expect(screen.getByText('Nothing to do')).toBeTruthy();
  });
});
