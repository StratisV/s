// Goals for the week, the second tab (docs/ARCHITECTURE.md "Goals for the week"): the screen in
// the app, on the demo household (its seed has last week's goals and this week's, half done),
// with the real HomeProvider, so what is tested is what is stored.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { DemoBackend, type StorageLike } from '../../lib/backend/demo';
import { goalsOf } from '../../lib/logic/goals';
import { HomeProvider } from '../../state/HomeProvider';
import { ConfettiProvider } from '../../ui/Confetti';
import { LINK_COPIED, LINK_OFF, SHARE_TITLE } from './GoalsShareSheet';

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

const SEEDED = ['Sort out the recycling rota', 'Deep clean the fridge', 'Pay the window cleaner', 'Plan Saturday’s dinner'];

/** The app on the seeded household, open on Goals. */
async function setup(prepare?: (backend: DemoBackend, householdId: string) => Promise<void>) {
  localStorage.setItem('homeos.tab', 'goals');
  const backend = new DemoBackend({ storage: new MemoryStorage(), search: '?demo-seed=1', latency: 0 });
  const householdId = (await backend.getMyHouseholdId())!;
  await prepare?.(backend, householdId);
  render(
    <HomeProvider backend={backend}>
      <ConfettiProvider>
        <App />
      </ConfettiProvider>
    </HomeProvider>,
  );
  await screen.findByRole('heading', { name: 'Goals for the week', level: 1 });
  return { backend, householdId };
}

const week = () => document.querySelector<HTMLElement>('[data-goals-week]')!;
const weekName = () => within(week()).getByRole('heading', { level: 2 }).textContent;
const shown = () => Array.from(week().querySelectorAll('[data-goal-tick]')).map((b) => b.getAttribute('aria-label'));
const progress = () => document.querySelector('[data-goals-progress]')!.textContent;
const tick = (title: string) => within(week()).getByRole('checkbox', { name: title });
const row = (title: string) => tick(title).closest('li')!;
const stored = async (backend: DemoBackend, householdId: string) =>
  goalsOf((await backend.load(householdId)).goals.list, week().getAttribute('data-goals-week')!).map((g) => g.title);

async function openMenu(title: string) {
  fireEvent.click(within(week()).getByRole('button', { name: `${title} options` }));
  return screen.findByRole('menu', { name: `${title} options` });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('Goals for the week', () => {
  it('opens on this week: its goals in order, how many are done, who is on each and who ticked it', async () => {
    await setup();
    expect(weekName()).toMatch(/^This week, \d{1,2}( [A-Z][a-z]{2})? to \d{1,2} [A-Z][a-z]{2}$/);
    expect(shown()).toEqual(SEEDED);
    expect(progress()).toBe('2 of 4 done');
    expect(tick('Deep clean the fridge').getAttribute('aria-checked')).toBe('true');
    expect(tick('Plan Saturday’s dinner').getAttribute('aria-checked')).toBe('false');
    // Shea is on the fridge and ticked it herself: just when.
    expect(within(row('Deep clean the fridge')).getByRole('button', { name: /^On it: Shea\./ })).toBeTruthy();
    expect(row('Deep clean the fridge').querySelector('[data-goal-done]')!.textContent).toMatch(/^Done · /);
    expect(within(row('Plan Saturday’s dinner')).getByRole('button', { name: 'Choose who is on Plan Saturday’s dinner' }).textContent).toBe(
      'No one yet',
    );
    // No round + here: Add a Goal is in the list.
    expect(screen.queryByRole('button', { name: 'New item' })).toBeNull();
  });

  it('Add a Goal: Enter adds it at the end and opens the next; Escape closes it', async () => {
    const { backend, householdId } = await setup();
    fireEvent.click(within(week()).getByRole('button', { name: 'Add a Goal' }));
    const field = within(week()).getByRole('textbox', { name: 'New goal' }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: '  Book the chimney sweep ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(shown()).toEqual([...SEEDED, 'Book the chimney sweep']));
    expect(await stored(backend, householdId)).toEqual([...SEEDED, 'Book the chimney sweep']);
    expect(progress()).toBe('2 of 5 done');
    // The next one is open, empty.
    const next = within(week()).getByRole('textbox', { name: 'New goal' }) as HTMLTextAreaElement;
    expect(next.value).toBe('');
    expect(document.activeElement).toBe(next);
    fireEvent.keyDown(next, { key: 'Escape' });
    expect(within(week()).queryByRole('textbox', { name: 'New goal' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(within(week()).getByRole('button', { name: 'Add a Goal' })));
    // Leaving an empty one adds nothing.
    fireEvent.click(within(week()).getByRole('button', { name: 'Add a Goal' }));
    fireEvent.blur(within(week()).getByRole('textbox', { name: 'New goal' }));
    expect(await stored(backend, householdId)).toHaveLength(5);
  });

  it('ticks and unticks: who and when, and the count follows', async () => {
    const { backend, householdId } = await setup();
    fireEvent.click(tick('Plan Saturday’s dinner'));
    expect(tick('Plan Saturday’s dinner').getAttribute('aria-checked')).toBe('true');
    expect(progress()).toBe('3 of 4 done');
    // No one was on it: it says who ticked it.
    expect(row('Plan Saturday’s dinner').querySelector('[data-goal-done]')!.textContent).toMatch(/^Done by \S+ · Today \d\d:\d\d$/);
    await waitFor(async () => {
      const goal = (await backend.load(householdId)).goals.list.find((g) => g.title === 'Plan Saturday’s dinner')!;
      expect([goal.done, goal.done_by !== null, goal.done_at !== null]).toEqual([true, true, true]);
    });
    fireEvent.click(tick('Plan Saturday’s dinner'));
    expect(tick('Plan Saturday’s dinner').getAttribute('aria-checked')).toBe('false');
    expect(row('Plan Saturday’s dinner').querySelector('[data-goal-done]')).toBeNull();
    expect(progress()).toBe('2 of 4 done');
  });

  it('renames in place and chooses who is on it', async () => {
    const { backend, householdId } = await setup();
    const title = row('Plan Saturday’s dinner').querySelector<HTMLTextAreaElement>('[data-goal-title]')!;
    expect(title.getAttribute('aria-label')).toBe('Goal');
    act(() => title.focus());
    fireEvent.change(title, { target: { value: 'Plan Sunday lunch' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    await waitFor(() => expect(shown()).toContain('Plan Sunday lunch'));
    await waitFor(async () => expect(await stored(backend, householdId)).toContain('Plan Sunday lunch'));

    fireEvent.click(within(row('Plan Sunday lunch')).getByRole('button', { name: 'Choose who is on Plan Sunday lunch' }));
    const menu = await screen.findByRole('menu', { name: 'Who’s on it' });
    expect(within(menu).getAllByRole('menuitemradio')[0].getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Shea/ }));
    await waitFor(() => expect(within(row('Plan Sunday lunch')).getByRole('button', { name: /^On it: Shea\./ }).textContent).toContain('Shea'));
  });

  it('moves with Move Up and Move Down, and deletes after asking', async () => {
    const { backend, householdId } = await setup();
    let menu = await openMenu('Sort out the recycling rota');
    // The first has no Move Up.
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Rename', 'Move Down', 'Delete Goal']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move Down' }));
    expect(shown()).toEqual([SEEDED[1], SEEDED[0], SEEDED[2], SEEDED[3]]);
    expect(row('Sort out the recycling rota').hasAttribute('data-moved')).toBe(true);
    await waitFor(async () => expect(await stored(backend, householdId)).toEqual([SEEDED[1], SEEDED[0], SEEDED[2], SEEDED[3]]));

    menu = await openMenu('Plan Saturday’s dinner');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Rename', 'Move Up', 'Delete Goal']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete Goal' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Plan Saturday’s dinner?' });
    expect(within(confirm).getByText('It goes for everyone at home.')).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete Goal' }));
    await waitFor(() => expect(shown()).toEqual([SEEDED[1], SEEDED[0], SEEDED[2]]));
    await waitFor(async () => expect(await stored(backend, householdId)).toEqual([SEEDED[1], SEEDED[0], SEEDED[2]]));
    expect(progress()).toBe('2 of 3 done');
  });

  it('goes to last week and next week, and back to this one', async () => {
    await setup();
    fireEvent.click(within(week()).getByRole('button', { name: 'Previous week' }));
    expect(weekName()).toMatch(/^Last week, /);
    expect(shown()).toEqual(['Book the boiler service', 'Sort out the recycling rota', 'Fix the bike lights']);
    expect(progress()).toBe('2 of 3 done');
    fireEvent.click(within(week()).getByRole('button', { name: 'Next week' }));
    fireEvent.click(within(week()).getByRole('button', { name: 'Next week' }));
    expect(weekName()).toMatch(/^Next week, /);
    expect(shown()).toEqual([]);
    expect(within(week()).getByText('Plan ahead: what should get done that week?')).toBeTruthy();
    fireEvent.click(within(week()).getByRole('button', { name: 'This Week' }));
    expect(weekName()).toMatch(/^This week, /);
    expect(within(week()).queryByRole('button', { name: 'This Week' })).toBeNull();
  });

  it('an empty week with last week unfinished offers to bring those over', async () => {
    const { backend, householdId } = await setup(async (b, hid) => {
      const data = await b.load(hid);
      const monday = data.goals.list.map((g) => g.week).sort().at(-1)!;
      for (const g of goalsOf(data.goals.list, monday)) await b.deleteGoal(g.id);
    });
    expect(shown()).toEqual([]);
    expect(within(week()).getByText('What would make it a good week at home?')).toBeTruthy();
    fireEvent.click(within(week()).getByRole('button', { name: 'Bring over 1 from last week' }));
    await waitFor(() => expect(shown()).toEqual(['Sort out the recycling rota']));
    expect(within(week()).queryByRole('button', { name: /^Bring over/ })).toBeNull();
    const brought = goalsOf((await backend.load(householdId)).goals.list, week().getAttribute('data-goals-week')!)[0];
    expect(brought.carried_from).not.toBeNull();
    expect(brought.done).toBe(false);
  });
});

describe('sharing the week', () => {
  it('Copy Link makes the link once and copies it; Turn Off Link turns it off after asking', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { backend, householdId } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    const sheet = await screen.findByRole('dialog', { name: SHARE_TITLE });
    // A preview of exactly what the link shows.
    const preview = within(sheet).getByRole('figure', { name: 'What the link shows' });
    expect(within(preview).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Sort out the recycling rota'),
      expect.stringContaining('Deep clean the fridge'),
      expect.stringContaining('Pay the window cleaner'),
      'Plan Saturday’s dinner',
    ]);
    // No share sheet in this browser: Copy Link is the way.
    expect(within(sheet).queryByRole('button', { name: 'Share Link' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Turn Off Link' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Copy Link' }));
    await waitFor(() => expect(within(sheet).getByRole('status').textContent).toBe(LINK_COPIED));
    const link = (await backend.load(householdId)).goals.link!;
    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/?goals=${link.token}`);
    expect(sheet.querySelector('[data-goals-url]')!.textContent).toContain(`?goals=${link.token}`);
    // The same link again.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Copy Link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/?goals=${link.token}`);

    fireEvent.click(within(sheet).getByRole('button', { name: 'Turn Off Link' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Turn off the link?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Turn Off Link' }));
    await waitFor(() => expect(within(sheet).getByRole('status').textContent).toBe(LINK_OFF));
    expect((await backend.load(householdId)).goals.link).toBeNull();
    expect(await backend.publicGoals(link.token)).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Turn Off Link' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: SHARE_TITLE })).toBeNull(), { timeout: 2000 });
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  it('Share Link opens the phone’s share sheet with the link, and the screen says it is shared', async () => {
    const share = vi.fn(async (_: ShareData) => {});
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    try {
      const { backend, householdId } = await setup();
      expect(document.querySelector('[data-goals-link-on]')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));
      const sheet = await screen.findByRole('dialog', { name: SHARE_TITLE });
      fireEvent.click(within(sheet).getByRole('button', { name: 'Share Link' }));
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
      const link = (await backend.load(householdId)).goals.link!;
      expect(share).toHaveBeenCalledWith({
        title: 'Goals for the week',
        text: 'Our goals for the week',
        url: `${window.location.origin}/?goals=${link.token}`,
      });
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: SHARE_TITLE })).toBeNull(), { timeout: 2000 });
      expect(document.querySelector('[data-goals-link-on]')!.textContent).toBe(
        'Shared with a link. Anyone with it can see this week’s goals.',
      );
    } finally {
      delete (navigator as { share?: unknown }).share;
    }
  });
});
