import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type Context, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOUSEKEEPING_SAVE_DELAY_MS, HOUSEKEEPING_STARTER_TASKS } from '../../lib/constants';
import * as provider from '../../state/HomeProvider';
import type {
  HouseholdData,
  HousekeepingData,
  HousekeepingTask,
  HousekeepingTickTarget,
  HousekeepingVisit,
  HousekeepingVisitPatch,
  ISODate,
  Member,
} from '../../lib/types';
import { HousekeepingScreen } from './HousekeepingScreen';
import { PRICE_ERROR } from './PriceField';
import { TaskListSheet } from './TaskListSheet';
import { SAVED_FLASH_MS } from './useSavedText';
import { NOT_STARTED, NOT_STARTED_NO_TASKS, NOTHING_RECORDED } from './VisitEditor';

// The provider is replaced by a small in-memory one below (the screen only talks to
// useHousehold()); the logic module is the real one.
vi.mock('../../state/HomeProvider', async () => {
  const { createContext, useContext } = await import('react');
  const FakeHomeContext = createContext<unknown>(null);
  return {
    FakeHomeContext,
    useHousehold: () => useContext(FakeHomeContext),
    useHome: () => useContext(FakeHomeContext),
  };
});
const { FakeHomeContext } = provider as unknown as {
  FakeHomeContext: Context<unknown>;
};

// ── Fixtures: Thu 8 Oct 2026, 10:00 in London (as in e2e) ──

const TODAY: ISODate = '2026-10-08';
const NOW = new Date('2026-10-08T10:00:00+01:00');

function member(id: string, name: string, emoji: string): Member {
  return {
    id,
    household_id: 'h',
    user_id: `u-${id}`,
    name,
    email: '',
    emoji,
    color: '#007AFF',
    role: 'member',
    weekly_email: true,
    push_enabled: false,
    created_at: '2026-01-01T00:00:00Z',
  };
}

const ME = member('m-me', 'Stratis', '🦔');
const SHEA = member('m-shea', 'Shea', '🦆');
const ELA = member('m-ela', 'Ela', '🦊');

const TASKS: HousekeepingTask[] = HOUSEKEEPING_STARTER_TASKS.map((title, i) => ({
  id: `t${i + 1}`,
  household_id: 'h',
  title,
  position: i,
}));

function visit(
  id: string,
  date: ISODate,
  by: Member,
  done: number,
  price: number | null,
  extra: Partial<HousekeepingVisit> = {},
): HousekeepingVisit {
  const at = `${date}T09:05:00Z`;
  return {
    id,
    household_id: 'h',
    visit_date: date,
    note: '',
    comments: '',
    price_pence: price,
    created_by: by.id,
    created_at: at,
    updated_by: by.id,
    updated_at: `${date}T09:12:00Z`,
    tasks: TASKS.map((t, i) => ({
      id: `${id}-r${i + 1}`,
      visit_id: id,
      household_id: 'h',
      task_id: t.id,
      title: t.title,
      position: i,
      done: i < done,
      done_by: i < done ? by.id : null,
      done_at: i < done ? `${date}T09:0${5 + Math.min(i, 4)}:00Z` : null,
    })),
    ...extra,
  };
}

const OCT_1 = visit('v1', '2026-10-01', ELA, 6, 6000, {
  note: 'Please leave the ironing for next week.',
  comments: 'Ironing left for next week as asked.',
});
const SEP_24 = visit('v2', '2026-09-24', SHEA, 7, 6500);

function seed(): HousekeepingData {
  return {
    note: {
      body: 'Guests arrive Friday, please do the spare room first.',
      updated_at: '2026-10-07T18:20:00Z',
      updated_by: SHEA.id,
    },
    tasks: TASKS,
    visits: [OCT_1, SEP_24],
  };
}

let households = 0;

function householdData(housekeeping: HousekeepingData): HouseholdData {
  return {
    // A new household per test: the calendar remembers its month per household while the app runs.
    household: {
      id: `h${++households}`,
      name: 'Home',
      address: '',
      timezone: 'Europe/London',
      weekly_email_day: 1,
      weekly_email_time: '08:00',
    },
    members: [ME, SHEA, ELA],
    areas: [],
    items: [],
    completions: [],
    housekeeping,
  };
}

// ── A small in-memory provider: the housekeeping actions apply at once and resolve ──

function newVisitOn(hk: HousekeepingData, date: ISODate): HousekeepingVisit {
  const id = `new-${date}`;
  const at = NOW.toISOString();
  return {
    id,
    household_id: 'h',
    visit_date: date,
    note: date === TODAY ? hk.note.body : '',
    comments: '',
    price_pence: null,
    created_by: ME.id,
    created_at: at,
    updated_by: ME.id,
    updated_at: at,
    tasks: hk.tasks.map((t, i) => ({
      id: `${id}-${t.id}`,
      visit_id: id,
      household_id: 'h',
      task_id: t.id,
      title: t.title,
      position: i,
      done: false,
      done_by: null,
      done_at: null,
    })),
  };
}

function withVisit(
  hk: HousekeepingData,
  date: ISODate,
  change: (v: HousekeepingVisit) => HousekeepingVisit,
): HousekeepingData {
  const existing = hk.visits.find((v) => v.visit_date === date);
  const next = change(existing ?? newVisitOn(hk, date));
  const visits = existing ? hk.visits.map((v) => (v === existing ? next : v)) : [next, ...hk.visits];
  return {
    ...hk,
    visits: visits.sort((a, b) => b.visit_date.localeCompare(a.visit_date)),
  };
}

function makeActions(set: () => Dispatch<SetStateAction<HouseholdData>>) {
  const edit = (fn: (hk: HousekeepingData) => HousekeepingData) =>
    set()((d) => ({ ...d, housekeeping: fn(d.housekeeping) }));
  let created = 0;
  return {
    setHousekeepingNote: vi.fn(async (body: string) => {
      edit((hk) => ({
        ...hk,
        note: {
          body: body.trim(),
          updated_at: NOW.toISOString(),
          updated_by: ME.id,
        },
      }));
    }),
    undoClearHousekeepingNote: vi.fn(async (previous: HousekeepingData['note']) => {
      edit((hk) => (hk.note.body === '' ? { ...hk, note: previous } : hk));
    }),
    setHousekeepingTaskDone: vi.fn(async (date: ISODate, target: HousekeepingTickTarget, done: boolean) => {
      edit((hk) =>
        withVisit(hk, date, (v) => ({
          ...v,
          tasks: v.tasks.map((t) =>
            ('taskId' in target ? t.task_id === target.taskId : t.id === target.visitTaskId)
              ? {
                  ...t,
                  done,
                  done_by: done ? ME.id : null,
                  done_at: done ? NOW.toISOString() : null,
                }
              : t,
          ),
        })),
      );
    }),
    saveHousekeepingVisit: vi.fn(async (date: ISODate, patch: HousekeepingVisitPatch) => {
      edit((hk) => withVisit(hk, date, (v) => ({ ...v, ...patch })));
    }),
    addHousekeepingVisit: vi.fn(async (date: ISODate) => {
      edit((hk) => withVisit(hk, date, (v) => v));
    }),
    deleteHousekeepingVisit: vi.fn(async (id: string) => {
      edit((hk) => ({ ...hk, visits: hk.visits.filter((v) => v.id !== id) }));
    }),
    createHousekeepingTask: vi.fn(async (title: string) => {
      const task: HousekeepingTask = {
        id: `t-new-${++created}`,
        household_id: 'h',
        title,
        position: 99,
      };
      edit((hk) => ({ ...hk, tasks: [...hk.tasks, task] }));
      return task;
    }),
    renameHousekeepingTask: vi.fn(async (id: string, title: string) => {
      edit((hk) => ({
        ...hk,
        tasks: hk.tasks.map((t) => (t.id === id ? { ...t, title } : t)),
      }));
    }),
    deleteHousekeepingTask: vi.fn(async (id: string) => {
      edit((hk) => ({ ...hk, tasks: hk.tasks.filter((t) => t.id !== id) }));
    }),
    reorderHousekeepingTasks: vi.fn(async (ids: string[]) => {
      edit((hk) => ({
        ...hk,
        tasks: ids.map((id, i) => ({
          ...hk.tasks.find((t) => t.id === id)!,
          position: i,
        })),
      }));
    }),
    showToast: vi.fn(),
    dismissToast: vi.fn(),
  };
}

type Actions = ReturnType<typeof makeActions>;

function FakeHome({
  initial,
  actions,
  bind,
  children,
}: {
  initial: HouseholdData;
  actions: Actions;
  bind(set: Dispatch<SetStateAction<HouseholdData>>): void;
  children: ReactNode;
}) {
  const [data, setData] = useState(initial);
  bind(setData);
  latest = data;
  latestSet = setData;
  return (
    <FakeHomeContext.Provider value={{ data, me: ME, today: TODAY, ...actions }}>{children}</FakeHomeContext.Provider>
  );
}

let latest: HouseholdData;
/** Sets the fake provider's data (a reload bringing what is stored). */
let latestSet: Dispatch<SetStateAction<HouseholdData>>;

function setup(housekeeping: HousekeepingData = seed(), { sheet = false } = {}) {
  let setData!: Dispatch<SetStateAction<HouseholdData>>;
  const actions = makeActions(() => setData);
  const onEditTasks = vi.fn();
  render(
    <FakeHome initial={householdData(housekeeping)} actions={actions} bind={(set) => (setData = set)}>
      <HousekeepingScreen onOpenProfile={() => {}} onEditTasks={onEditTasks} />
      {sheet ? <TaskListSheet open onClose={() => {}} /> : null}
    </FakeHome>,
  );
  const data = () => latest;
  return { actions, onEditTasks, data };
}

const section = (name: string) => screen.getByRole('region', { name });
const today = () => section('Today');
const calendar = () => screen.getByRole('grid');
const day = (name: string | RegExp) => within(calendar()).getByRole('button', { name });
/** The polite live region that says what was saved. */
const said = () => document.querySelector('[data-announcer]')!.textContent;
/** Matches the element whose whole text is `text`, also when EmojiText has drawn its 🦆 or 🦔 in a span. */
const wholeText = (text: string | RegExp) => {
  const matches = (el: Element) => (typeof text === 'string' ? el.textContent === text : text.test(el.textContent ?? ''));
  return (_: string, el: Element | null) => !!el && matches(el) && !Array.from(el.children).some(matches);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HousekeepingScreen', () => {
  it('shows the message, today’s checklist and the calendar, in that order', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Housekeeping' })).toBeTruthy();
    expect(screen.getByText('Last visit Thu 1 Oct')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Message for the housekeeper',
      'Today',
      'Calendar',
    ]);

    const message = screen.getByRole('textbox', {
      name: 'Message for the housekeeper',
    }) as HTMLTextAreaElement;
    expect(message.value).toBe('Guests arrive Friday, please do the spare room first.');
    expect(message.maxLength).toBe(4000);
    expect(screen.getByText(wholeText('🦆 Shea · Yesterday 19:20'))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear message' })).toBeTruthy();

    const tasks = within(today()).getByRole('group', { name: 'Tasks today' });
    const boxes = within(tasks).getAllByRole('checkbox');
    expect(
      boxes.map(
        (b) =>
          b.getAttribute('aria-labelledby') && document.getElementById(b.getAttribute('aria-labelledby')!)!.textContent,
      ),
    ).toEqual([...HOUSEKEEPING_STARTER_TASKS]);
    expect(boxes.every((b) => !(b as HTMLInputElement).checked)).toBe(true);
    expect(within(today()).getByRole('checkbox', { name: 'Ironing' })).toBeTruthy();
    expect(within(today()).getByText(NOT_STARTED)).toBeTruthy();
    expect(within(today()).getByRole('textbox', { name: 'Comments' })).toBeTruthy();
    const price = within(today()).getByRole('textbox', {
      name: 'Price for the day',
    }) as HTMLInputElement;
    expect(price.inputMode).toBe('decimal');
    expect(price.value).toBe('');
    expect(within(today()).getByRole('button', { name: 'Edit task list' })).toBeTruthy();

    // The calendar opens on this month with the last visit chosen.
    expect(within(section('Calendar')).getByText('October 2026')).toBeTruthy();
    expect(within(section('Calendar')).getByText('1 visit · £60.00')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Thursday 1 October' })).toBeTruthy();
    expect(screen.getByText('Please leave the ironing for next week.')).toBeTruthy();
  });

  it('ticks and unticks a task at once and says so', async () => {
    const { actions } = setup();
    const sheets = within(today()).getByRole('checkbox', {
      name: 'Change the bed sheets',
    });
    await act(async () => {
      fireEvent.click(sheets);
    });
    expect(actions.setHousekeepingTaskDone).toHaveBeenCalledWith(TODAY, { taskId: 't1' }, true);
    expect((sheets as HTMLInputElement).checked).toBe(true);
    // Who ticked it describes the checkbox.
    const byline = document.getElementById(sheets.getAttribute('aria-describedby')!)!;
    expect(byline.textContent).toBe('🦔 Stratis · 10:00');
    await waitFor(() => expect(said()).toBe('Change the bed sheets done'));
    expect(within(today()).getByText(wholeText(/^Recorded by 🦔 Stratis · Today 10:00$/))).toBeTruthy();
    expect(screen.getByText("Today's visit")).toBeTruthy();

    await act(async () => {
      fireEvent.click(
        within(today()).getByRole('checkbox', {
          name: 'Change the bed sheets',
        }),
      );
    });
    expect(actions.setHousekeepingTaskDone).toHaveBeenLastCalledWith(TODAY, { taskId: 't1' }, false);
    await waitFor(() => expect(said()).toBe('Change the bed sheets not done'));
  });

  it('saves comments on blur, and a second after the last keystroke', async () => {
    const { actions } = setup();
    const comments = within(today()).getByRole('textbox', { name: 'Comments' });
    act(() => comments.focus());
    fireEvent.change(comments, { target: { value: '  Out of bin bags.  ' } });
    expect(actions.saveHousekeepingVisit).not.toHaveBeenCalled();
    await act(async () => comments.blur());
    expect(actions.saveHousekeepingVisit).toHaveBeenCalledWith(TODAY, {
      comments: 'Out of bin bags.',
    });
    await waitFor(() => expect(said()).toBe('Saved'));
    expect((comments as HTMLTextAreaElement).value).toBe('Out of bin bags.');

    // Unchanged: nothing is sent.
    act(() => comments.focus());
    act(() => comments.blur());
    expect(actions.saveHousekeepingVisit).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    act(() => comments.focus());
    fireEvent.change(comments, { target: { value: 'Out of bin bags. ' } });
    fireEvent.change(comments, { target: { value: 'Out of bin bags. And' } });
    act(() => vi.advanceTimersByTime(HOUSEKEEPING_SAVE_DELAY_MS - 1));
    expect(actions.saveHousekeepingVisit).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(actions.saveHousekeepingVisit).toHaveBeenLastCalledWith(TODAY, {
      comments: 'Out of bin bags. And',
    });
    // Still typing: the field keeps what is being typed.
    fireEvent.change(comments, { target: { value: 'Out of bin bags. And ' } });
    act(() => vi.advanceTimersByTime(HOUSEKEEPING_SAVE_DELAY_MS));
    expect((comments as HTMLTextAreaElement).value).toBe('Out of bin bags. And ');
    expect(actions.saveHousekeepingVisit).toHaveBeenCalledTimes(2);
  });

  it('saves the price on blur in pence, and explains a price it can’t read', async () => {
    const { actions } = setup();
    const price = within(today()).getByRole('textbox', {
      name: 'Price for the day',
    }) as HTMLInputElement;
    act(() => price.focus());
    fireEvent.change(price, { target: { value: '45.5' } });
    await act(async () => price.blur());
    expect(actions.saveHousekeepingVisit).toHaveBeenCalledWith(TODAY, {
      price_pence: 4550,
    });
    expect(price.value).toBe('45.50');
    await waitFor(() => expect(said()).toBe('Saved'));

    act(() => price.focus());
    fireEvent.change(price, { target: { value: '45.555' } });
    await act(async () => price.blur());
    expect(price.value).toBe('45.555');
    expect(price.getAttribute('aria-invalid')).toBe('true');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(PRICE_ERROR);
    expect(price.getAttribute('aria-describedby')).toBe(alert.id);
    expect(actions.saveHousekeepingVisit).toHaveBeenCalledTimes(1);

    // Blank clears it.
    act(() => price.focus());
    fireEvent.change(price, { target: { value: '' } });
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => price.blur());
    expect(actions.saveHousekeepingVisit).toHaveBeenLastCalledWith(TODAY, {
      price_pence: null,
    });
    expect(price.value).toBe('');
  });

  it('saves the message, and Clear empties it with an Undo', async () => {
    const { actions } = setup();
    const message = screen.getByRole('textbox', {
      name: 'Message for the housekeeper',
    }) as HTMLTextAreaElement;
    act(() => message.focus());
    fireEvent.change(message, { target: { value: 'Please do the oven.\n' } });
    await act(async () => message.blur());
    expect(actions.setHousekeepingNote).toHaveBeenCalledWith('Please do the oven.');
    await waitFor(() => expect(said()).toBe('Saved'));
    // Under the message: "✓ Saved" for a moment, then who changed it and when.
    const byline = screen.getByText(wholeText(/^Saved ·🦔 Stratis · Today 10:00$/));
    expect(byline.querySelector('[data-saved]')).toBeTruthy();

    const clear = screen.getByRole('button', { name: 'Clear message' });
    act(() => clear.focus());
    await act(async () => {
      fireEvent.click(clear);
    });
    expect(actions.setHousekeepingNote).toHaveBeenLastCalledWith('');
    expect(message.value).toBe('');
    // Clear stays where it was, dimmed, and keeps focus (VoiceOver keeps its place).
    expect(screen.getByRole('button', { name: 'Clear message' })).toBe(clear);
    expect(clear.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(clear);
    expect(actions.showToast).toHaveBeenCalledWith('Message cleared', expect.objectContaining({ label: 'Undo' }));
    await waitFor(() => expect(said()).toBe('Message cleared'));
    // Nothing to clear: a tap does nothing.
    fireEvent.click(clear);
    expect(actions.setHousekeepingNote).toHaveBeenCalledTimes(2);

    // Undo puts back the message as it was, with who wrote it and when (not as a new edit).
    act(() => actions.showToast.mock.calls[0][1].run());
    expect(actions.undoClearHousekeepingNote).toHaveBeenCalledWith({
      body: 'Please do the oven.',
      updated_at: NOW.toISOString(),
      updated_by: ME.id,
    });
    expect(actions.setHousekeepingNote).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(message.value).toBe('Please do the oven.'));
    expect(clear.hasAttribute('aria-disabled')).toBe(false);
  });

  it('Undo after Clear brings back someone else’s message under their name', async () => {
    const { actions } = setup();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear message' }));
    });
    act(() => actions.showToast.mock.calls[0][1].run());
    expect(actions.undoClearHousekeepingNote).toHaveBeenCalledWith(seed().note);
    await waitFor(() => expect(screen.getByText(wholeText('🦆 Shea · Yesterday 19:20'))).toBeTruthy());
  });

  it('offers the task list when there are no tasks yet', () => {
    const { onEditTasks } = setup({ ...seed(), tasks: [] });
    expect(within(today()).getByText('No tasks yet.')).toBeTruthy();
    // Nothing to tick: comments or a price start the visit.
    expect(within(today()).getByText(NOT_STARTED_NO_TASKS)).toBeTruthy();
    expect(within(today()).queryByText(NOT_STARTED)).toBeNull();
    const add = within(today()).getByRole('button', { name: 'Add tasks' });
    fireEvent.click(add);
    // With the button pressed, for focus to come back to when the sheet closes.
    expect(onEditTasks).toHaveBeenLastCalledWith(add);
    const edit = within(today()).getByRole('button', { name: 'Edit task list' });
    fireEvent.click(edit);
    expect(onEditTasks).toHaveBeenLastCalledWith(edit);
  });
});

describe('Saving', () => {
  const offline = () => new Error('offline');

  it('says "Saved" next to Comments for a moment, and before the byline for the price', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    setup();
    const comments = within(today()).getByRole('textbox', { name: 'Comments' });
    const commentsRow = within(today()).getByRole('heading', { level: 3, name: 'Comments' }).parentElement!;
    act(() => comments.focus());
    fireEvent.change(comments, { target: { value: 'Out of bin bags.' } });
    await act(async () => comments.blur());
    expect(within(commentsRow).getByText('Saved')).toBeTruthy();
    // Shown, not said twice: the live region says it.
    expect(commentsRow.querySelector('[data-saved]')!.getAttribute('aria-hidden')).toBe('true');
    expect(said()).toBe('Saved');
    act(() => vi.advanceTimersByTime(SAVED_FLASH_MS));
    expect(within(commentsRow).queryByText('Saved')).toBeNull();

    const price = within(today()).getByRole('textbox', { name: 'Price for the day' });
    act(() => price.focus());
    fireEvent.change(price, { target: { value: '45' } });
    await act(async () => price.blur());
    const caption = today().querySelector('[data-visit-caption]')!;
    expect(caption.textContent).toBe('Saved ·Recorded by 🦔 Stratis · Today 10:00');
    act(() => vi.advanceTimersByTime(SAVED_FLASH_MS));
    expect(caption.textContent).toBe('Recorded by 🦔 Stratis · Today 10:00');
  });

  it('a failed save keeps the comments typed, says so, and Try again sends them', async () => {
    const { actions } = setup();
    actions.saveHousekeepingVisit.mockRejectedValueOnce(offline());
    const comments = within(today()).getByRole('textbox', { name: 'Comments' }) as HTMLTextAreaElement;
    const text = 'Out of bin bags, the hoover bag is full and the boiler is making a noise again.';
    act(() => comments.focus());
    fireEvent.change(comments, { target: { value: text } });
    await act(async () => comments.blur());
    expect(actions.saveHousekeepingVisit).toHaveBeenCalledTimes(1);
    expect(comments.value).toBe(text);
    expect(within(today()).getByText('Not saved.')).toBeTruthy();

    // Still there after a reload of the same (old) data.
    act(() => latestSet((d) => ({ ...d })));
    expect(comments.value).toBe(text);

    await act(async () => {
      fireEvent.click(within(today()).getByRole('button', { name: 'Try again to save the comments' }));
    });
    expect(actions.saveHousekeepingVisit).toHaveBeenLastCalledWith(TODAY, { comments: text });
    expect(comments.value).toBe(text);
    expect(within(today()).queryByText('Not saved.')).toBeNull();
    await waitFor(() => expect(said()).toBe('Saved'));
  });

  it('a failed save keeps a new message, and leaving the field again sends it', async () => {
    const { actions } = setup();
    actions.setHousekeepingNote.mockRejectedValueOnce(offline());
    const message = screen.getByRole('textbox', { name: 'Message for the housekeeper' }) as HTMLTextAreaElement;
    const text = 'Guests arrive Friday. Please do the spare room first, then change all the beds.';
    act(() => message.focus());
    fireEvent.change(message, { target: { value: text } });
    await act(async () => message.blur());
    expect(message.value).toBe(text);
    const section = screen.getByRole('region', { name: 'Message for the housekeeper' });
    expect(within(section).getByText('Not saved.')).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Try again to save the message' })).toBeTruthy();

    act(() => message.focus());
    await act(async () => message.blur());
    expect(actions.setHousekeepingNote).toHaveBeenCalledTimes(2);
    expect(actions.setHousekeepingNote).toHaveBeenLastCalledWith(text);
    expect(message.value).toBe(text);
    expect(within(section).queryByText('Not saved.')).toBeNull();
  });

  it('a failed save keeps the price typed; Try again sends it, Escape goes back', async () => {
    const { actions } = setup();
    actions.saveHousekeepingVisit.mockRejectedValueOnce(offline()).mockRejectedValueOnce(offline());
    const price = within(today()).getByRole('textbox', { name: 'Price for the day' }) as HTMLInputElement;
    act(() => price.focus());
    fireEvent.change(price, { target: { value: '62.5' } });
    await act(async () => price.blur());
    expect(price.value).toBe('62.50');
    expect(within(today()).getByText('Not saved.')).toBeTruthy();
    act(() => latestSet((d) => ({ ...d })));
    expect(price.value).toBe('62.50');

    // Fails again, then Escape puts back the stored price (none).
    await act(async () => {
      fireEvent.click(within(today()).getByRole('button', { name: 'Try again to save the price' }));
    });
    expect(actions.saveHousekeepingVisit).toHaveBeenCalledTimes(2);
    expect(price.value).toBe('62.50');
    act(() => price.focus());
    fireEvent.keyDown(price, { key: 'Escape' });
    expect(price.value).toBe('');
    expect(within(today()).queryByText('Not saved.')).toBeNull();

    act(() => price.focus());
    fireEvent.change(price, { target: { value: '62.5' } });
    await act(async () => price.blur());
    expect(actions.saveHousekeepingVisit).toHaveBeenLastCalledWith(TODAY, { price_pence: 6250 });
    expect(within(today()).queryByText('Not saved.')).toBeNull();
  });
});

describe("Today's visit", () => {
  const todayVisit = (done: number, extra: Partial<HousekeepingVisit> = {}) => visit('v0', TODAY, ME, done, null, extra);

  it('can be deleted, after asking, once something is recorded', async () => {
    const { actions } = setup({ ...seed(), visits: [todayVisit(2), OCT_1, SEP_24] });
    expect(screen.getByText("Today's visit")).toBeTruthy();
    fireEvent.click(within(today()).getByRole('button', { name: 'Delete Visit' }));
    const confirm = await screen.findByRole('alertdialog', { name: "Delete today's visit?" });
    expect(within(confirm).getByText('Its ticks, comments and price will be deleted for everyone.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Delete Visit' }));
    });
    expect(actions.deleteHousekeepingVisit).toHaveBeenCalledWith('v0');
    expect(within(today()).queryByRole('button', { name: 'Delete Visit' })).toBeNull();
    expect(within(today()).getByText(NOT_STARTED)).toBeTruthy();
    expect(document.activeElement).toBe(within(today()).getByRole('heading', { level: 2, name: 'Today' }));
    await waitFor(() => expect(said()).toBe('Visit deleted'));
    expect(screen.getByText('Last visit Thu 1 Oct')).toBeTruthy();
  });

  it('with nothing recorded (a tick taken back) is not counted anywhere', () => {
    setup({ ...seed(), visits: [todayVisit(0), OCT_1, SEP_24] });
    expect(screen.getByText('Last visit Thu 1 Oct')).toBeTruthy();
    expect(within(today()).getByText(NOT_STARTED)).toBeTruthy();
    expect(within(today()).queryByText(/^Recorded by/)).toBeNull();
    expect(within(today()).queryByRole('button', { name: 'Delete Visit' })).toBeNull();
    expect(within(section('Calendar')).getByText('1 visit · £60.00')).toBeTruthy();
    const todayButton = day('Thursday 8 October, today');
    expect(todayButton.hasAttribute('data-visit')).toBe(false);
  });

  it('comments alone count as a visit', () => {
    setup({ ...seed(), visits: [todayVisit(0, { comments: 'Out of bin bags.' }), OCT_1] });
    expect(screen.getByText("Today's visit")).toBeTruthy();
    expect(day('Thursday 8 October, today, visit, 0 of 7 done').hasAttribute('data-visit')).toBe(true);
    expect(within(today()).getByRole('button', { name: 'Delete Visit' })).toBeTruthy();
  });
});

describe('Calendar', () => {
  it('names every day, marks visits and today, and keeps the future out of reach', () => {
    setup();
    const grid = calendar();
    expect(grid.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.getElementById(grid.getAttribute('aria-labelledby')!)!.textContent).toBe('October 2026');
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((th) => th.getAttribute('abbr')),
    ).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    // The chosen day says so on its button, where focus goes (not just on its cell).
    const oct1 = day('Thursday 1 October, visit, 6 of 7 done, £60.00, selected');
    expect(oct1.hasAttribute('data-visit')).toBe(true);
    expect(oct1.closest('[role="gridcell"]')!.getAttribute('aria-selected')).toBe('true');
    expect(oct1.tabIndex).toBe(0);
    const today = day('Thursday 8 October, today');
    expect(today.hasAttribute('data-today')).toBe(true);
    expect(today.tabIndex).toBe(-1);
    expect((day('Friday 9 October') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Next month' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(within(section('Calendar')).getByText('September 2026')).toBeTruthy();
    expect(within(section('Calendar')).getByText('1 visit · £65.00')).toBeTruthy();
    // Another month shows its own latest visit under it, never October's day.
    const sep24 = day('Thursday 24 September, visit, 7 of 7 done, £65.00, selected');
    expect(sep24.tabIndex).toBe(0);
    expect(screen.getByRole('heading', { level: 3, name: 'Thursday 24 September' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(within(section('Calendar')).getByText('October 2026')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Thursday 1 October' })).toBeTruthy();

    // A month without visits: nothing chosen, the hint, and the 1st is the way in.
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(within(section('Calendar')).getByText('August 2026')).toBeTruthy();
    expect(within(section('Calendar')).getByText('No visits')).toBeTruthy();
    expect(screen.getByText('Tap a day to see its visit.')).toBeTruthy();
    expect(document.querySelector('[data-day-detail] h3')).toBeNull();
    expect(day('Saturday 1 August').tabIndex).toBe(0);
  });

  it('moves with the arrow keys, Home and End, and Page Up and Down, never into the future', () => {
    setup();
    const start = day(/^Thursday 1 October/);
    act(() => start.focus());
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(day('Friday 2 October'));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(day('Sunday 4 October'));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(day('Monday 28 September'));
    expect(within(section('Calendar')).getByText('September 2026')).toBeTruthy();
    expect((document.activeElement as HTMLElement).tabIndex).toBe(0);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(day('Monday 21 September'));
    fireEvent.keyDown(document.activeElement!, { key: 'PageDown' });
    // 21 October is still to come: as far as today.
    expect(document.activeElement).toBe(day('Thursday 8 October, today'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(day('Thursday 8 October, today'));
    fireEvent.keyDown(document.activeElement!, { key: 'PageUp' });
    expect(document.activeElement).toBe(day('Tuesday 8 September'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(day('Tuesday 15 September'));
    // Choosing a day shows its visit under the calendar.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    fireEvent.click(document.activeElement!);
    expect(screen.getByRole('heading', { level: 3, name: 'Thursday 24 September' })).toBeTruthy();
  });
});

describe('The chosen day', () => {
  it('shows a past visit, editable, with its message', async () => {
    const { actions } = setup();
    const detail = screen.getByRole('heading', {
      level: 3,
      name: 'Thursday 1 October',
    }).parentElement!;
    expect(within(detail).getByText('Message that day')).toBeTruthy();
    const tasks = within(detail).getByRole('group', {
      name: 'Tasks on Thursday 1 October',
    });
    expect(
      within(tasks)
        .getAllByRole('checkbox')
        .filter((b) => (b as HTMLInputElement).checked),
    ).toHaveLength(6);
    expect(within(detail).getByRole('heading', { level: 4, name: 'Comments' })).toBeTruthy();
    // Named with their day, so they can't be mistaken for today's.
    expect(
      (
        within(detail).getByRole('textbox', {
          name: 'Comments, Thursday 1 October',
        }) as HTMLTextAreaElement
      ).value,
    ).toBe('Ironing left for next week as asked.');
    expect(
      (
        within(detail).getByRole('textbox', {
          name: 'Price for the day, Thursday 1 October',
        }) as HTMLInputElement
      ).value,
    ).toBe('60.00');
    expect(screen.getAllByRole('textbox', { name: 'Comments' })).toHaveLength(1);
    expect(screen.getAllByRole('textbox', { name: 'Price for the day' })).toHaveLength(1);
    expect(
      within(detail).getByText(/^Recorded by 🦊 Ela · Thu 1 Oct 10:05 · Updated by 🦊 Ela · Thu 1 Oct 10:12$/),
    ).toBeTruthy();
    const ironing = within(tasks).getByRole('checkbox', { name: 'Ironing' });
    await act(async () => {
      fireEvent.click(ironing);
    });
    expect(actions.setHousekeepingTaskDone).toHaveBeenCalledWith('2026-10-01', { taskId: 't7' }, true);
  });

  it('adds a visit to a past day without one', async () => {
    const { actions } = setup();
    fireEvent.click(day('Tuesday 6 October'));
    expect(screen.getByRole('heading', { level: 3, name: 'Tuesday 6 October' })).toBeTruthy();
    expect(screen.getByText('No visit recorded.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add a visit' }));
    });
    expect(actions.addHousekeepingVisit).toHaveBeenCalledWith('2026-10-06');
    const tasks = await screen.findByRole('group', {
      name: 'Tasks on Tuesday 6 October',
    });
    await waitFor(() => expect(document.activeElement).toBe(within(tasks).getAllByRole('checkbox')[0]));
    await waitFor(() => expect(said()).toBe('Visit added'));
    // Nothing recorded on it yet: not counted as a visit until something is.
    expect(within(screen.getByRole('heading', { level: 3, name: 'Tuesday 6 October' }).parentElement!).getByText(NOTHING_RECORDED)).toBeTruthy();
    expect(day('Tuesday 6 October, selected').hasAttribute('data-visit')).toBe(false);
    expect(within(section('Calendar')).getByText('1 visit · £60.00')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(tasks).getByRole('checkbox', { name: 'Ironing' }));
    });
    expect(day('Tuesday 6 October, visit, 1 of 7 done, selected').hasAttribute('data-visit')).toBe(true);
    expect(within(section('Calendar')).getByText('2 visits · £60.00')).toBeTruthy();
  });

  it('deletes a visit after asking', async () => {
    const { actions } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Visit' }));
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Delete the visit on Thu 1 Oct?',
    });
    expect(within(confirm).getByText('Its ticks, comments and price will be deleted for everyone.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Delete Visit' }));
    });
    expect(actions.deleteHousekeepingVisit).toHaveBeenCalledWith('v1');
    expect(screen.getByText('No visit recorded.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add a visit' })));
    await waitFor(() => expect(said()).toBe('Visit deleted'));
    expect(within(section('Calendar')).getByText('No visits')).toBeTruthy();
  });

  it('points back up to Today for today', () => {
    setup();
    fireEvent.click(day('Thursday 8 October, today'));
    expect(screen.getByText("Today's visit is above.")).toBeTruthy();
    const heading = within(today()).getByRole('heading', {
      level: 2,
      name: 'Today',
    });
    heading.scrollIntoView = vi.fn();
    fireEvent.click(screen.getByRole('button', { name: "Show today's visit" }));
    expect(document.activeElement).toBe(heading);
    expect(heading.scrollIntoView).toHaveBeenCalled();
  });

  it('choosing a day brings its details into view and says what is there; focus stays on the day', () => {
    setup();
    const scrolled: { el: Element; opts: unknown }[] = [];
    const proto = Element.prototype as { scrollIntoView?: unknown };
    const before = proto.scrollIntoView;
    proto.scrollIntoView = function (this: Element, opts: unknown) {
      scrolled.push({ el: this, opts });
    };
    try {
      const sep = day('Tuesday 6 October');
      act(() => sep.focus());
      fireEvent.click(sep);
      const heading = screen.getByRole('heading', { level: 3, name: 'Tuesday 6 October' });
      expect(scrolled.map((s) => s.el)).toEqual([heading]);
      expect(scrolled[0].opts).toMatchObject({ block: 'nearest' });
      expect(said()).toBe('Tuesday 6 October: no visit recorded. Details below the calendar.');
      expect(document.activeElement).toBe(day('Tuesday 6 October, selected'));

      fireEvent.click(day(/^Thursday 1 October/));
      expect(said()).toBe('Thursday 1 October: 6 of 7 done, £60.00. Details below the calendar.');
      fireEvent.click(day(/^Thursday 8 October/));
      expect(said()).toBe("Thursday 8 October: today's visit is above the calendar.");
      expect(scrolled).toHaveLength(3);
    } finally {
      proto.scrollIntoView = before;
    }
  });

  it('says how to see a visit when nothing is chosen', () => {
    setup({ ...seed(), visits: [SEP_24] });
    expect(screen.getByText('Tap a day to see its visit.')).toBeTruthy();
    expect(within(section('Calendar')).getByText('No visits')).toBeTruthy();
  });
});

describe('Task list sheet', () => {
  const sheet = () => screen.getByRole('dialog', { name: 'Task list' });

  it('renames, adds, reorders and deletes tasks', async () => {
    const { actions, data } = setup(seed(), { sheet: true });
    const names = () =>
      within(sheet())
        .getAllByRole('textbox', { name: 'Task name' })
        .map((i) => (i as HTMLInputElement).value);
    expect(names()).toEqual([...HOUSEKEEPING_STARTER_TASKS]);
    expect(
      within(sheet()).getByText("Changes show in today's visit too. Earlier visits keep their own list."),
    ).toBeTruthy();

    // Rename in place; blank puts the old title back.
    const first = within(sheet()).getAllByRole('textbox', {
      name: 'Task name',
    })[0];
    act(() => first.focus());
    fireEvent.change(first, { target: { value: '  ' } });
    act(() => first.blur());
    expect(actions.renameHousekeepingTask).not.toHaveBeenCalled();
    act(() => first.focus());
    fireEvent.change(first, { target: { value: 'Change the sheets ' } });
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(actions.renameHousekeepingTask).toHaveBeenCalledWith('t1', 'Change the sheets');
    // Today's checklist follows.
    expect(within(today()).getByRole('checkbox', { name: 'Change the sheets' })).toBeTruthy();

    // Add Task: "New task", focused with its text selected.
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Add Task' }));
    expect(actions.createHousekeepingTask).toHaveBeenCalledWith('New task');
    await waitFor(() => expect((document.activeElement as HTMLInputElement).value).toBe('New task'));
    const added = document.activeElement as HTMLInputElement;
    expect([added.selectionStart, added.selectionEnd]).toEqual([0, 8]);

    // The arrow keys on a grip move the task and say where to.
    const grip = within(sheet()).getByRole('button', {
      name: 'Reorder Ironing',
    });
    act(() => grip.focus());
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    expect(actions.reorderHousekeepingTasks).toHaveBeenCalledWith([
      't1',
      't2',
      't3',
      't4',
      't5',
      't7',
      't6',
      't-new-1',
    ]);
    expect(within(sheet()).getByText('Ironing moved to position 6 of 8.')).toBeTruthy();
    expect(document.activeElement).toBe(within(sheet()).getByRole('button', { name: 'Reorder Ironing' }));

    // Delete asks first.
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Delete Empty the bins' }));
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Delete Empty the bins?',
    });
    expect(within(confirm).getByText('Earlier visits keep it.')).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete Task' }));
    expect(actions.deleteHousekeepingTask).toHaveBeenCalledWith('t6');
    expect(data().housekeeping.tasks.map((t) => t.title)).not.toContain('Empty the bins');
    expect(names()).toEqual([
      'Change the sheets',
      'Hoover and mop the floors',
      'Clean the bathrooms',
      'Clean the kitchen',
      'Dust the surfaces',
      'Ironing',
      'New task',
    ]);
  });

  it('can be emptied', async () => {
    const { actions } = setup({ ...seed(), tasks: TASKS.slice(0, 1) }, { sheet: true });
    fireEvent.click(
      within(sheet()).getByRole('button', {
        name: 'Delete Change the bed sheets',
      }),
    );
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Delete Change the bed sheets?',
    });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete Task' }));
    expect(actions.deleteHousekeepingTask).toHaveBeenCalledWith('t1');
    expect(within(sheet()).queryAllByRole('textbox', { name: 'Task name' })).toHaveLength(0);
    expect(within(today()).getByText('No tasks yet.')).toBeTruthy();
  });
});
