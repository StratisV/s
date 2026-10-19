import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { DemoBackend, type StorageLike } from '../../lib/backend/demo';
import { captureSharedLink } from '../../lib/sharedLink';
import type { HouseholdData } from '../../lib/types';
import { HomeProvider } from '../../state/HomeProvider';
import { ConfettiProvider } from '../../ui/Confetti';
import { UNKNOWN_AREA_TOAST, UNKNOWN_ITEM_TOAST } from './useSharedLink';

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

/**
 * Opens the app as a shared link would: `link` gets the seeded household and returns the
 * query (`?item=…`), which is in the address as the app starts.
 */
async function openLink(link: (data: HouseholdData, backend: DemoBackend) => Promise<string> | string) {
  const backend = new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 });
  const data = await backend.load((await backend.getMyHouseholdId())!);
  window.history.replaceState(null, '', `/${await link(data, backend)}`);
  captureSharedLink();
  render(
    <HomeProvider backend={backend}>
      <ConfettiProvider>
        <App />
      </ConfettiProvider>
    </HomeProvider>,
  );
  await screen.findByRole('heading', { name: 'Home', level: 1 });
  return data;
}

const idOf = (data: HouseholdData, title: string) => data.items.find((i) => i.title === title)!.id;
const areaId = (data: HouseholdData, name: string) => data.areas.find((a) => a.name === name)!.id;

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe('opening a shared item link', () => {
  it('opens the item’s sheet, and the link is gone from the address', async () => {
    await openLink((data) => `?item=${idOf(data, 'Heaters not working')}`);
    expect(window.location.search).toBe('');
    const sheet = await screen.findByRole('dialog', { name: 'Edit item' });
    expect((within(sheet).getByLabelText('Title') as HTMLTextAreaElement).value).toBe('Heaters not working');
    // Only once: nothing is left waiting.
    expect(localStorage.getItem('homeos.link')).toBeNull();
  });

  it('an item this home doesn’t have only gets a toast', async () => {
    await openLink(() => '?item=7f1c2d3e-0000-4000-8000-000000000001');
    expect(await screen.findByText(UNKNOWN_ITEM_TOAST)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a one-off item that has been done says so', async () => {
    await openLink(async (data, backend) => {
      const id = idOf(data, 'Heaters not working');
      await backend.completeItem(id);
      return `?item=${id}`;
    });
    expect(await screen.findByText('“Heaters not working” is already done')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('opening a shared area link', () => {
  it('opens the area in its sheet on Home, whichever tab the app last showed', async () => {
    localStorage.setItem('homeos.tab', 'housekeeping');
    const data = await openLink((data) => `?frame&area=${areaId(data, 'Hallway')}`);
    expect(window.location.search).toBe('?frame');
    const sheet = await screen.findByRole('dialog', { name: 'Hallway' });
    expect(sheet.querySelector('[data-area-sheet]')!.getAttribute('data-area-id')).toBe(areaId(data, 'Hallway'));
    expect(within(sheet).getByRole('heading', { level: 1 }).textContent).toBe('Hallway');
    expect(within(sheet).getByRole('button', { name: 'Mark Heaters not working as done' })).toBeTruthy();
    // On Home, behind it.
    const tabs = screen.getByRole('navigation', { name: 'Tabs', hidden: true });
    expect(within(tabs).getByRole('button', { name: 'Home', hidden: true }).getAttribute('aria-current')).toBe('page');
    // Only once: nothing is left waiting.
    expect(localStorage.getItem('homeos.link')).toBeNull();
  });

  it('an area this home doesn’t have only gets a toast', async () => {
    await openLink(() => '?area=nope');
    expect(await screen.findByText(UNKNOWN_AREA_TOAST)).toBeTruthy();
  });
});

describe('signing out', () => {
  it('forgets a link still waiting', async () => {
    await openLink(() => '');
    // A link captured while signed in is applied at once, so leave one waiting by hand.
    localStorage.setItem('homeos.link', JSON.stringify({ kind: 'item', id: 'x', at: Date.now() }));
    await act(async () => {
      screen.getByRole('button', { name: 'Profile' }).click();
    });
    const signOut = await screen.findByRole('button', { name: 'Sign Out' });
    await act(async () => signOut.click());
    const confirm = await screen.findByRole('alertdialog');
    await act(async () => within(confirm).getByRole('button', { name: 'Sign Out' }).click());
    await waitFor(() => expect(localStorage.getItem('homeos.link')).toBeNull());
  });
});
