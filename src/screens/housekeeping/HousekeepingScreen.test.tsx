import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type Context, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOUSEKEEPING_SAVE_DELAY_MS, HOUSEKEEPING_STARTER_TASKS } from '../../lib/constants';
import * as provider from '../../state/HomeProvider';
import {
  withSectionAdded,
  withSectionDeleted,
  withSectionMoved,
  withSectionRenamed,
  withTaskAdded,
  withTaskDeleted,
  withTaskMoved,
  withTaskRenamed,
} from '../../lib/logic/housekeeping';
import type {
  Area,
  HouseholdData,
  HousekeepingData,
  HousekeepingSection,
  HousekeepingTask,
  HousekeepingTickTarget,
  HousekeepingVisit,
  HousekeepingVisitPatch,
  ISODate,
  Member,
} from '../../lib/types';
import { HOUSEKEEPING_CALENDAR_VIEW_KEY } from './Calendar';
import { HousekeepingScreen } from './HousekeepingScreen';
import { PRICE_ERROR } from './PriceField';
import { deleteSectionMessage, TaskListSheet } from './TaskListSheet';
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
  section_id: null,
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
      section_id: null,
      section_title: '',
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
    sections: [],
    tasks: TASKS,
    visits: [OCT_1, SEP_24],
  };
}

const KITCHEN: HousekeepingSection = { id: 's-kitchen', household_id: 'h', title: 'Kitchen', position: 0 };
const BATHROOMS: HousekeepingSection = { id: 's-bath', household_id: 'h', title: 'Bathrooms', position: 1 };

/**
 * The seed's list in sections: Change the bed sheets, Hoover and mop the floors, Dust the
 * surfaces and Ironing in no section; Kitchen: Clean the kitchen, Empty the bins; Bathrooms:
 * Clean the bathrooms.
 */
function sectioned(): HousekeepingData {
  const moves: [string, string, number][] = [
    ['t4', KITCHEN.id, 0],
    ['t6', KITCHEN.id, 1],
    ['t3', BATHROOMS.id, 0],
  ];
  return moves.reduce(
    (hk, [id, sectionId, index]) => withTaskMoved(hk, id, sectionId, index, TODAY),
    { ...seed(), sections: [KITCHEN, BATHROOMS] },
  );
}

let households = 0;

/** The household's areas: a card each on the checklist, in this order. */
const AREAS: Area[] = [
  { id: 'a-kitchen', household_id: 'h', name: 'Kitchen', position: 0 },
  { id: 'a-living', household_id: 'h', name: 'Living Room', position: 1 },
];

function householdData(housekeeping: HousekeepingData, areas: Area[] = AREAS): HouseholdData {
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
    areas,
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
      section_id: hk.sections.some((s) => s.id === t.section_id) ? t.section_id : null,
      section_title: hk.sections.find((s) => s.id === t.section_id)?.title ?? '',
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
    // The list, as the provider shows it: the logic module's helpers (today's visit follows).
    createHousekeepingTask: vi.fn(async (title: string, sectionId?: string | null) => {
      const section = sectionId ?? null;
      const siblings = latest.housekeeping.tasks.filter((t) => t.section_id === section);
      const task: HousekeepingTask = {
        id: `t-new-${++created}`,
        household_id: 'h',
        title,
        section_id: section,
        position: siblings.reduce((n, t) => Math.max(n, t.position + 1), 0),
      };
      edit((hk) => withTaskAdded(hk, task, TODAY));
      return task;
    }),
    renameHousekeepingTask: vi.fn(async (id: string, title: string) => {
      edit((hk) => withTaskRenamed(hk, id, title, TODAY));
    }),
    deleteHousekeepingTask: vi.fn(async (id: string) => {
      edit((hk) => withTaskDeleted(hk, id, TODAY));
    }),
    moveHousekeepingTask: vi.fn(async (id: string, sectionId: string | null, index: number) => {
      edit((hk) => withTaskMoved(hk, id, sectionId, index, TODAY));
    }),
    createHousekeepingSection: vi.fn(async (title: string) => {
      const section: HousekeepingSection = {
        id: `s-new-${++created}`,
        household_id: 'h',
        title: title.trim(),
        position: latest.housekeeping.sections.reduce((n, s) => Math.max(n, s.position + 1), 0),
      };
      edit((hk) => withSectionAdded(hk, section));
      return section;
    }),
    renameHousekeepingSection: vi.fn(async (id: string, title: string) => {
      edit((hk) => withSectionRenamed(hk, id, title, TODAY));
    }),
    deleteHousekeepingSection: vi.fn(async (id: string) => {
      edit((hk) => withSectionDeleted(hk, id, TODAY));
    }),
    moveHousekeepingSection: vi.fn(async (id: string, index: number) => {
      edit((hk) => withSectionMoved(hk, id, index, TODAY));
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

function setup(
  housekeeping: HousekeepingData = seed(),
  { sheet = false, showDay = null, areas = AREAS }: { sheet?: boolean; showDay?: ISODate | null; areas?: Area[] } = {},
) {
  let setData!: Dispatch<SetStateAction<HouseholdData>>;
  const actions = makeActions(() => setData);
  const onEditTasks = vi.fn();
  const onDayShown = vi.fn();
  render(
    <FakeHome initial={householdData(housekeeping, areas)} actions={actions} bind={(set) => (setData = set)}>
      <HousekeepingScreen onOpenProfile={() => {}} onEditTasks={onEditTasks} showDay={showDay} onDayShown={onDayShown} />
      {sheet ? <TaskListSheet open onClose={() => {}} /> : null}
    </FakeHome>,
  );
  const data = () => latest;
  return { actions, onEditTasks, onDayShown, data };
}

const section = (name: string) => screen.getByRole('region', { name });
const today = () => section('Today');
const calendar = () => screen.getByRole('grid');
const day = (name: string | RegExp) => within(calendar()).getByRole('button', { name });
/** A button of the calendar's bar or card: Today, Show month, Previous week… */
const control = (name: string) => within(section('Calendar')).getByRole('button', { name });
/** The line beside the calendar while today is chosen and shown. */
const line = () => section('Calendar').querySelector('[data-today-summary]')?.textContent ?? null;
/** The chosen day before today, in place of the Today section. */
const detail = () => document.querySelector<HTMLElement>('[data-day-detail]');
/** The polite live region that says what was saved. */
const said = () => document.querySelector('[data-announcer]')!.textContent;
/** The checklist's cards, as their headers are named: "Kitchen, 2 of 5 done". */
const cardNames = (inside: HTMLElement) =>
  Array.from(inside.querySelectorAll('[data-card] h3 button')).map((b) => b.getAttribute('aria-label'));
/** A card's header: one button, named first by the card. */
const cardHeader = (name: string, inside: HTMLElement) => within(inside).getByRole('button', { name: new RegExp(`^${name}, `) });
/** Opens a card with a tap on its header (unless it is open) and gives its tasks: a group named after it. */
const openCard = (name: string, inside: HTMLElement) => {
  const header = cardHeader(name, inside);
  if (header.getAttribute('aria-expanded') !== 'true') fireEvent.click(header);
  return within(inside).getByRole('group', { name });
};
/** A checkbox's task title. */
const titleOf = (box: HTMLElement) => document.getElementById(box.getAttribute('aria-labelledby')!)!.textContent;
/** Matches the element whose whole text is `text`, also when EmojiText has drawn its 🦆 or 🦔 in a span. */
const wholeText = (text: string | RegExp) => {
  const matches = (el: Element) => (typeof text === 'string' ? el.textContent === text : text.test(el.textContent ?? ''));
  return (_: string, el: Element | null) => !!el && matches(el) && !Array.from(el.children).some(matches);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  // The week strip or the month is remembered on this device.
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HousekeepingScreen', () => {
  it('shows today’s date, the calendar, the message and today’s checklist, in that order', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Housekeeping' })).toBeTruthy();
    expect(screen.getByText('Last visit Thu 1 Oct')).toBeTruthy();
    // Today's date over the title, as on Home.
    const date = document.querySelector('time')!;
    expect(date.textContent).toBe('Thursday 8 October');
    expect(date.getAttribute('dateTime')).toBe(TODAY);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Calendar',
      'Message for the housekeeper',
      'Today',
    ]);

    const message = screen.getByRole('textbox', {
      name: 'Message for the housekeeper',
    }) as HTMLTextAreaElement;
    expect(message.value).toBe('Guests arrive Friday, please do the spare room first.');
    expect(message.maxLength).toBe(4000);
    expect(screen.getByText(wholeText('🦆 Shea · Yesterday 19:20'))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear message' })).toBeTruthy();

    // A card a row, all closed: Whole home (the tasks in no section), then each area in order.
    const tasks = within(today()).getByRole('group', { name: 'Tasks today' });
    expect(cardNames(tasks)).toEqual(['Whole home, 0 of 7 done', 'Kitchen, no tasks yet', 'Living Room, no tasks yet']);
    expect(within(tasks).queryAllByRole('checkbox')).toHaveLength(0);
    const boxes = within(openCard('Whole home', tasks)).getAllByRole('checkbox');
    expect(boxes.map(titleOf)).toEqual([...HOUSEKEEPING_STARTER_TASKS]);
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

    // The calendar opens on this week with today chosen, and a line on how today's visit is going.
    expect(calendar().getAttribute('aria-label')).toBe('Week of Monday 5 October');
    expect(within(section('Calendar')).getByText('5 to 11 October')).toBeTruthy();
    expect(day('Thursday 8 October, today, selected').hasAttribute('data-today')).toBe(true);
    expect(line()).toBe('No visit yet today');
    expect(within(section('Calendar')).queryByRole('button', { name: 'Today' })).toBeNull();
    expect(control('Show month')).toBeTruthy();
    expect(detail()).toBeNull();
  });

  it('a card per area has the tasks of the section named after it; a section no area is called comes last', async () => {
    setup(sectioned());
    const tasks = within(today()).getByRole('group', { name: 'Tasks today' });
    // Whole home first (the tasks in no section), each area in order, then Bathrooms (no area of that name).
    expect(cardNames(tasks)).toEqual([
      'Whole home, 0 of 4 done',
      'Kitchen, 0 of 2 done',
      'Living Room, no tasks yet',
      'Bathrooms, 0 of 1 done',
    ]);
    // Each header, an h3 under the day's h2, is one button that opens its card in place.
    const header = cardHeader('Kitchen', tasks);
    expect(header.closest('h3')).toBeTruthy();
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(header.textContent).toContain('0 of 2 done');
    const kitchen = openCard('Kitchen', tasks);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(header.getAttribute('aria-controls')!)).toBe(kitchen);
    expect(within(kitchen).getAllByRole('checkbox').map(titleOf)).toEqual(['Clean the kitchen', 'Empty the bins']);

    await act(async () => {
      fireEvent.click(within(kitchen).getByRole('checkbox', { name: 'Clean the kitchen' }));
    });
    expect(header.getAttribute('aria-label')).toBe('Kitchen, 1 of 2 done');
    expect(header.textContent).toContain('1 of 2 done');
    await waitFor(() => expect(said()).toBe('Clean the kitchen done'));

    // The last one: all done, shown in green and said.
    await act(async () => {
      fireEvent.click(within(kitchen).getByRole('checkbox', { name: 'Empty the bins' }));
    });
    expect(header.getAttribute('aria-label')).toBe('Kitchen, all 2 done');
    expect(header.closest('[data-card]')!.getAttribute('data-state')).toBe('done');
    expect(header.textContent).toContain('All done');
    await waitFor(() => expect(said()).toBe('Empty the bins done. Kitchen, all 2 done'));

    // A card of one task; several open at once.
    const bathrooms = openCard('Bathrooms', tasks);
    await act(async () => {
      fireEvent.click(within(bathrooms).getByRole('checkbox', { name: 'Clean the bathrooms' }));
    });
    expect(cardHeader('Bathrooms', tasks).getAttribute('aria-label')).toBe('Bathrooms, done');
    expect(cardHeader('Bathrooms', tasks).textContent).toContain('All done');
    await waitFor(() => expect(said()).toBe('Clean the bathrooms done. Bathrooms, done'));
    expect(header.getAttribute('aria-expanded')).toBe('true');

    // A tap on the header again closes it: its rows are out of reach.
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(within(tasks).queryByRole('group', { name: 'Kitchen' })).toBeNull();
    expect(within(tasks).getByRole('group', { name: 'Bathrooms' })).toBeTruthy();
  });

  it('an area with no tasks says so and opens to Add Task; an empty section no area is called is left out', () => {
    const hk = sectioned();
    setup({ ...hk, sections: [...hk.sections, { id: 's-empty', household_id: 'h', title: 'Garden', position: 2 }] });
    const tasks = within(today()).getByRole('group', { name: 'Tasks today' });
    expect(cardNames(tasks)).toEqual([
      'Whole home, 0 of 4 done',
      'Kitchen, 0 of 2 done',
      'Living Room, no tasks yet',
      'Bathrooms, 0 of 1 done',
    ]);
    expect(cardHeader('Living Room', tasks).textContent).toContain('No tasks yet');
    const living = openCard('Living Room', tasks);
    expect(within(living).queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(living).getByRole('button', { name: 'Add Task to Living Room' })).toBeTruthy();
    cleanup();
    // Every task in a section: no Whole home.
    setup({
      ...hk,
      tasks: hk.tasks.map((t) => (t.section_id === null ? { ...t, section_id: KITCHEN.id, position: 10 + t.position } : t)),
    });
    expect(cardNames(within(today()).getByRole('group', { name: 'Tasks today' }))).toEqual([
      'Kitchen, 0 of 6 done',
      'Living Room, no tasks yet',
      'Bathrooms, 0 of 1 done',
    ]);
  });

  it('an earlier visit keeps the sections it had, matched to the areas by the names it kept', () => {
    const hk = seed();
    // Two rows under Upstairs and two under "kitchen", both deleted since; the rest in none.
    const kept: HousekeepingVisit = {
      ...OCT_1,
      tasks: OCT_1.tasks.map((r, i) => ({
        ...r,
        section_id: null,
        section_title: i < 2 ? 'Upstairs' : i < 4 ? 'kitchen' : '',
      })),
    };
    setup({ ...hk, sections: [], visits: [kept, SEP_24] }, { showDay: '2026-10-01' });
    const tasks = within(detail()!).getByRole('group', { name: 'Tasks on Thursday 1 October' });
    expect(cardNames(tasks)).toEqual([
      'Whole home, 2 of 3 done',
      'Kitchen, all 2 done',
      'Living Room, no tasks',
      'Upstairs, all 2 done',
    ]);
    expect(within(openCard('Kitchen', tasks)).getAllByRole('checkbox').map(titleOf)).toEqual([
      'Clean the bathrooms',
      'Clean the kitchen',
    ]);
    // An area with nothing that day; and no Add Task on a visit gone by.
    expect(within(openCard('Living Room', tasks)).getByText('No tasks on this visit.')).toBeTruthy();
    expect(within(tasks).queryByRole('button', { name: /^Add Task/ })).toBeNull();
  });

  it('Add Task: typed straight into the field it becomes; the area’s section is made first when there is none', async () => {
    const { actions, data } = setup(sectioned());
    const tasks = within(today()).getByRole('group', { name: 'Tasks today' });
    const living = openCard('Living Room', tasks);
    fireEvent.click(within(living).getByRole('button', { name: 'Add Task to Living Room' }));
    let field = document.activeElement as HTMLTextAreaElement;
    expect([field.getAttribute('aria-label'), field.value, field.placeholder]).toEqual(['Task name', '', 'New task']);
    expect(living.contains(field)).toBe(true);
    // Enter adds it and keeps the field, empty, for the next one.
    fireEvent.change(field, { target: { value: ' Plump the cushions ' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    expect(actions.createHousekeepingSection).toHaveBeenCalledTimes(1);
    expect(actions.createHousekeepingSection).toHaveBeenCalledWith('Living Room');
    const section = data().housekeeping.sections.find((s) => s.title === 'Living Room')!;
    expect(actions.createHousekeepingTask).toHaveBeenCalledWith('Plump the cushions', section.id);
    await waitFor(() => expect(within(living).getAllByRole('checkbox').map(titleOf)).toEqual(['Plump the cushions']));
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('');
    await waitFor(() => expect(said()).toBe('Plump the cushions added to Living Room'));
    // The next goes straight into that section.
    fireEvent.change(field, { target: { value: 'Dust the shelves' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    expect(actions.createHousekeepingSection).toHaveBeenCalledTimes(1);
    expect(actions.createHousekeepingTask).toHaveBeenLastCalledWith('Dust the shelves', section.id);
    await waitFor(() => expect(cardHeader('Living Room', tasks).getAttribute('aria-label')).toBe('Living Room, 0 of 2 done'));
    // Enter with nothing typed: the field goes, and focus is back on Add Task.
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(within(living).queryByRole('textbox', { name: 'Task name' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(within(living).getByRole('button', { name: 'Add Task to Living Room' })));

    // Whole home's go in no section; Escape drops what was typed.
    const home = openCard('Whole home', tasks);
    fireEvent.click(within(home).getByRole('button', { name: 'Add Task to Whole home' }));
    field = document.activeElement as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'Windows' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(actions.createHousekeepingTask).toHaveBeenCalledTimes(2);
    fireEvent.click(within(home).getByRole('button', { name: 'Add Task to Whole home' }));
    field = document.activeElement as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'Windows' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    expect(actions.createHousekeepingTask).toHaveBeenLastCalledWith('Windows', null);
    await waitFor(() => expect(cardHeader('Whole home', tasks).getAttribute('aria-label')).toBe('Whole home, 0 of 5 done'));
  });

  it('a card opened low on the screen comes up as it opens, its header kept in sight; at once with Reduce Motion', () => {
    setup(sectioned());
    // The tab's scroll area: 874px tall, 60px kept clear at the bottom.
    const scroller = screen.getByRole('region', { name: 'Housekeeping' }).firstElementChild as HTMLElement;
    scroller.style.overflowY = 'auto';
    scroller.style.paddingBottom = '60px';
    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy as typeof scroller.scrollBy;
    const header = cardHeader('Kitchen', today());
    // What it opens: 160px under the header.
    const inner = document.getElementById(header.getAttribute('aria-controls')!)!.firstElementChild as HTMLElement;
    Object.defineProperty(inner, 'scrollHeight', { configurable: true, value: 160 });
    let top = 700;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const box = (from: number, to: number) =>
        ({ top: from, bottom: to, left: 0, right: 402, width: 402, height: to - from, x: 0, y: from, toJSON() {} }) as DOMRect;
      if (this === scroller) return box(0, 874);
      if (this === header) return box(top, top + 82);
      return box(0, 0);
    });
    try {
      // 782 + 160 comes up to 814 (874 less the 60 kept clear).
      fireEvent.click(header);
      expect(scrollBy).toHaveBeenLastCalledWith({ top: 128, behavior: 'smooth' });
      // Closing never scrolls.
      fireEvent.click(header);
      expect(scrollBy).toHaveBeenCalledTimes(1);
      // Taller than the screen: up until its header is at the top, no further.
      Object.defineProperty(inner, 'scrollHeight', { configurable: true, value: 2000 });
      top = 300;
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })),
      );
      fireEvent.click(header);
      expect(scrollBy).toHaveBeenLastCalledWith({ top: 300, behavior: 'auto' });
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('a name typed is added when the field is left, shown where the field was until it is stored; a failed save gives it back', async () => {
    const { actions, data } = setup(sectioned());
    let fail!: (error: Error) => void;
    actions.createHousekeepingTask.mockImplementationOnce(
      () =>
        new Promise<HousekeepingTask>((_, reject) => {
          fail = reject;
        }),
    );
    const kitchen = openCard('Kitchen', within(today()).getByRole('group', { name: 'Tasks today' }));
    fireEvent.click(within(kitchen).getByRole('button', { name: 'Add Task to Kitchen' }));
    const field = document.activeElement as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'Clean the oven' } });
    await act(async () => field.blur());
    expect(actions.createHousekeepingTask).toHaveBeenCalledWith('Clean the oven', KITCHEN.id);
    // Saving: the name where the field was, busy, and no Add Task until it is stored (nothing moves under a finger).
    expect(kitchen.querySelector('[aria-busy="true"]')!.textContent).toBe('Clean the oven');
    expect(within(kitchen).queryByRole('textbox', { name: 'Task name' })).toBeNull();
    expect(within(kitchen).queryByRole('button', { name: 'Add Task to Kitchen' })).toBeNull();
    // It failed (a toast says why): the name is back in its field, to try again.
    await act(async () => fail(new Error('offline')));
    expect(kitchen.querySelector('[aria-busy="true"]')).toBeNull();
    expect((within(kitchen).getByRole('textbox', { name: 'Task name' }) as HTMLTextAreaElement).value).toBe('Clean the oven');
    expect(data().housekeeping.tasks.map((t) => t.title)).not.toContain('Clean the oven');
  });

  it('ticks and unticks a task at once and says so', async () => {
    const { actions } = setup();
    openCard('Whole home', today());
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
    // With areas: a card each, saying so.
    setup({ ...seed(), tasks: [] });
    expect(cardNames(today())).toEqual(['Kitchen, no tasks yet', 'Living Room, no tasks yet']);
    expect(within(today()).getByText(NOT_STARTED_NO_TASKS)).toBeTruthy();
    cleanup();
    // No areas either: one card that says so, with Add tasks.
    const { onEditTasks } = setup({ ...seed(), tasks: [] }, { areas: [] });
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
    expect(line()).toBe('No visit yet today');
    const todayButton = day('Thursday 8 October, today, selected');
    expect(todayButton.hasAttribute('data-visit')).toBe(false);
    fireEvent.click(control('Show month'));
    expect(within(section('Calendar')).getByText('1 visit · £60.00')).toBeTruthy();
  });

  it('comments alone count as a visit', () => {
    setup({ ...seed(), visits: [todayVisit(0, { comments: 'Out of bin bags.' }), OCT_1] });
    expect(screen.getByText("Today's visit")).toBeTruthy();
    expect(day('Thursday 8 October, today, visit, 0 of 7 done, selected').hasAttribute('data-visit')).toBe(true);
    expect(line()).toBe('0 of 7 done today');
    expect(within(today()).getByRole('button', { name: 'Delete Visit' })).toBeTruthy();
  });
});

describe('Calendar', () => {
  it('is Home’s date picker: this week, today chosen, visits marked, the future out of reach', () => {
    setup();
    const grid = calendar();
    expect(grid.getAttribute('aria-label')).toBe('Week of Monday 5 October');
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((th) => th.getAttribute('abbr')),
    ).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    expect(
      within(grid)
        .getAllByRole('button')
        .map((b) => b.getAttribute('data-date')),
    ).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    // Today is chosen, says so on its button (where focus goes) and is the one in the tab order.
    const todayButton = day('Thursday 8 October, today, selected');
    expect(todayButton.closest('[role="gridcell"]')!.getAttribute('aria-selected')).toBe('true');
    expect(todayButton.tabIndex).toBe(0);
    // No visit can be ahead: the days to come and next week can't be chosen.
    expect((day('Friday 9 October') as HTMLButtonElement).disabled).toBe(true);
    expect((control('Next week') as HTMLButtonElement).disabled).toBe(true);

    // Last week: the visit has the dot in its circle and says what was done.
    fireEvent.click(control('Previous week'));
    expect(calendar().getAttribute('aria-label')).toBe('Week of Monday 28 September');
    expect(within(section('Calendar')).getByText('28 Sep to 4 Oct')).toBeTruthy();
    const oct1 = day('Thursday 1 October, visit, 6 of 7 done, £60.00');
    expect(oct1.hasAttribute('data-visit')).toBe(true);
    expect(oct1.hasAttribute('data-dot')).toBe(true);
    expect(day('Friday 2 October').hasAttribute('data-visit')).toBe(false);
    expect((control('Next week') as HTMLButtonElement).disabled).toBe(false);
    // Today is still chosen but out of sight: the line gives way to Today, which comes back.
    expect(line()).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Today' })).toBeTruthy();
    fireEvent.click(control('Today'));
    expect(calendar().getAttribute('aria-label')).toBe('Week of Monday 5 October');
    expect(line()).toBe('No visit yet today');
  });

  it('Show month: each month with its total, remembered on this device apart from Home’s', () => {
    setup();
    fireEvent.click(control('Show month'));
    const grid = calendar();
    expect(document.getElementById(grid.getAttribute('aria-labelledby')!)!.textContent).toBe('October 2026');
    expect(within(section('Calendar')).getByText('1 visit · £60.00')).toBeTruthy();
    expect((control('Next month') as HTMLButtonElement).disabled).toBe(true);
    expect(day('Thursday 1 October, visit, 6 of 7 done, £60.00').hasAttribute('data-visit')).toBe(true);
    expect(localStorage.getItem(HOUSEKEEPING_CALENDAR_VIEW_KEY)).toBe('month');
    expect(localStorage.getItem('homeos.calendar')).toBeNull();

    fireEvent.click(control('Previous month'));
    expect(within(section('Calendar')).getByText('September 2026')).toBeTruthy();
    expect(within(section('Calendar')).getByText('1 visit · £65.00')).toBeTruthy();
    // Another month keeps the chosen day.
    expect(screen.getByRole('heading', { level: 2, name: 'Today' })).toBeTruthy();
    fireEvent.click(control('Previous month'));
    expect(within(section('Calendar')).getByText('No visits')).toBeTruthy();
    // Show week, away from the chosen day: this week, today chosen.
    fireEvent.click(control('Show week'));
    expect(calendar().getAttribute('aria-label')).toBe('Week of Monday 5 October');
    expect(localStorage.getItem(HOUSEKEEPING_CALENDAR_VIEW_KEY)).toBeNull();

    // Opened again in the month once it was chosen.
    cleanup();
    localStorage.setItem(HOUSEKEEPING_CALENDAR_VIEW_KEY, 'month');
    setup();
    expect(document.getElementById(calendar().getAttribute('aria-labelledby')!)!.textContent).toBe('October 2026');
  });

  it('moves with the arrow keys, Home and End, and Page Up and Down, never into the future', () => {
    setup();
    const start = day(/^Thursday 8 October/);
    act(() => start.focus());
    fireEvent.keyDown(start, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(day('Wednesday 7 October'));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(day('Monday 5 October'));
    // Past the strip's edge, into the week before.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(day('Sunday 4 October'));
    expect(calendar().getAttribute('aria-label')).toBe('Week of Monday 28 September');
    expect((document.activeElement as HTMLElement).tabIndex).toBe(0);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(day('Sunday 27 September'));
    fireEvent.keyDown(document.activeElement!, { key: 'PageDown' });
    // 27 October is still to come: as far as today.
    expect(document.activeElement).toBe(day('Thursday 8 October, today, selected'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(day('Thursday 8 October, today, selected'));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(day('Thursday 8 October, today, selected'));
    fireEvent.keyDown(document.activeElement!, { key: 'PageUp' });
    expect(document.activeElement).toBe(day('Tuesday 8 September'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(day(/^Thursday 24 September, visit/));
    // Choosing a day shows its visit in place of today's.
    fireEvent.click(document.activeElement!);
    expect(screen.getByRole('heading', { level: 2, name: 'Thursday 24 September' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Today' })).toBeNull();
  });
});

describe('The chosen day', () => {
  /** The week before, with the visit on Thursday 1 October. */
  const lastWeek = () => fireEvent.click(control('Previous week'));

  it('a past visit shows in place of today’s, editable, with its message; Today comes back', async () => {
    const { actions } = setup();
    lastWeek();
    fireEvent.click(day(/^Thursday 1 October/));
    expect(screen.queryByRole('region', { name: 'Today' })).toBeNull();
    const visit = section('Thursday 1 October');
    expect(visit).toBe(detail());
    // Under the calendar and the message, as today's is.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Calendar',
      'Message for the housekeeper',
      'Thursday 1 October',
    ]);
    expect(within(visit).getByText('Message that day')).toBeTruthy();
    expect(within(visit).getByText('Please leave the ironing for next week.')).toBeTruthy();
    const tasks = within(visit).getByRole('group', {
      name: 'Tasks on Thursday 1 October',
    });
    expect(cardNames(tasks)).toEqual(['Whole home, 6 of 7 done', 'Kitchen, no tasks', 'Living Room, no tasks']);
    expect(
      within(openCard('Whole home', tasks))
        .getAllByRole('checkbox')
        .filter((b) => (b as HTMLInputElement).checked),
    ).toHaveLength(6);
    expect(within(visit).getByRole('heading', { level: 3, name: 'Comments' })).toBeTruthy();
    // Named with their day, so they can't be mistaken for today's.
    expect(
      (
        within(visit).getByRole('textbox', {
          name: 'Comments, Thursday 1 October',
        }) as HTMLTextAreaElement
      ).value,
    ).toBe('Ironing left for next week as asked.');
    expect(
      (
        within(visit).getByRole('textbox', {
          name: 'Price for the day, Thursday 1 October',
        }) as HTMLInputElement
      ).value,
    ).toBe('60.00');
    expect(screen.queryAllByRole('textbox', { name: 'Comments' })).toHaveLength(0);
    expect(
      within(visit).getByText(/^Recorded by 🦊 Ela · Thu 1 Oct 10:05 · Updated by 🦊 Ela · Thu 1 Oct 10:12$/),
    ).toBeTruthy();
    const ironing = within(tasks).getByRole('checkbox', { name: 'Ironing' });
    await act(async () => {
      fireEvent.click(ironing);
    });
    expect(actions.setHousekeepingTaskDone).toHaveBeenCalledWith('2026-10-01', { taskId: 't7' }, true);

    // Today, from the bar: today's section again, and the line.
    fireEvent.click(control('Today'));
    expect(within(today()).getByRole('group', { name: 'Tasks today' })).toBeTruthy();
    expect(detail()).toBeNull();
    expect(line()).toBe('No visit yet today');
  });

  it('adds a visit to a past day without one', async () => {
    const { actions } = setup();
    fireEvent.click(day('Tuesday 6 October'));
    const visit = section('Tuesday 6 October');
    expect(within(visit).getByText('No visit recorded.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(visit).getByRole('button', { name: 'Add a visit' }));
    });
    expect(actions.addHousekeepingVisit).toHaveBeenCalledWith('2026-10-06');
    const tasks = await within(visit).findByRole('group', {
      name: 'Tasks on Tuesday 6 October',
    });
    // Focus on the visit's first card, ready to open it.
    await waitFor(() => expect(document.activeElement).toBe(cardHeader('Whole home', tasks)));
    await waitFor(() => expect(said()).toBe('Visit added'));
    // Nothing recorded on it yet: not counted as a visit until something is.
    expect(within(visit).getByText(NOTHING_RECORDED)).toBeTruthy();
    expect(day('Tuesday 6 October, selected').hasAttribute('data-visit')).toBe(false);
    const home = openCard('Whole home', tasks);
    await act(async () => {
      fireEvent.click(within(home).getByRole('checkbox', { name: 'Ironing' }));
    });
    expect(day('Tuesday 6 October, visit, 1 of 7 done, selected').hasAttribute('data-visit')).toBe(true);
    fireEvent.click(control('Show month'));
    expect(within(section('Calendar')).getByText('2 visits · £60.00')).toBeTruthy();
  });

  it('deletes a visit after asking', async () => {
    const { actions } = setup();
    lastWeek();
    fireEvent.click(day(/^Thursday 1 October/));
    fireEvent.click(within(detail()!).getByRole('button', { name: 'Delete Visit' }));
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Delete the visit on Thu 1 Oct?',
    });
    expect(within(confirm).getByText('Its ticks, comments and price will be deleted for everyone.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Delete Visit' }));
    });
    expect(actions.deleteHousekeepingVisit).toHaveBeenCalledWith('v1');
    expect(within(detail()!).getByText('No visit recorded.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add a visit' })));
    await waitFor(() => expect(said()).toBe('Visit deleted'));
    expect(day('Thursday 1 October, selected').hasAttribute('data-visit')).toBe(false);
    fireEvent.click(control('Show month'));
    expect(within(section('Calendar')).getByText('No visits')).toBeTruthy();
  });

  it('choosing a day low on the screen brings it up and says what is there; focus stays on the day', () => {
    setup();
    // The tab's scroll area: 874px tall, 60px kept clear at the bottom, in an 800px window.
    const scroller = screen.getByRole('region', { name: 'Housekeeping' }).firstElementChild as HTMLElement;
    scroller.style.overflowY = 'auto';
    scroller.style.paddingBottom = '60px';
    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy as typeof scroller.scrollBy;
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    // Where the chosen day's heading is (its section runs 800px on).
    let top = 700;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const box = (from: number, to: number) =>
        ({ top: from, bottom: to, left: 0, right: 402, width: 402, height: to - from, x: 0, y: from, toJSON() {} }) as DOMRect;
      if (this === scroller) return box(0, 874);
      if (this.matches('h2[tabindex="-1"]')) return box(top, top + 25);
      if (this.matches('section') && this.querySelector(':scope > div > h2[tabindex="-1"]')) return box(top, top + 800);
      return box(0, 0);
    });
    try {
      const oct6 = day('Tuesday 6 October');
      act(() => oct6.focus());
      fireEvent.click(oct6);
      // Up until 45% of the window (360px) is left under its heading: 725 + 360 comes up to 814.
      expect(scrollBy).toHaveBeenCalledTimes(1);
      expect(scrollBy.mock.calls[0][0].top).toBeCloseTo(271);
      expect(scrollBy.mock.calls[0][0].behavior).toBe('smooth');
      expect(said()).toBe('Tuesday 6 October: no visit recorded. Details below the calendar.');
      expect(document.activeElement).toBe(day('Tuesday 6 October, selected'));

      // High enough already: it stays.
      top = 300;
      lastWeek();
      fireEvent.click(day(/^Thursday 1 October/));
      expect(scrollBy).toHaveBeenCalledTimes(1);
      expect(said()).toBe('Thursday 1 October: 6 of 7 done, £60.00. Details below the calendar.');
      fireEvent.click(control('Today'));
      fireEvent.click(day(/^Thursday 8 October/));
      expect(said()).toBe('Thursday 8 October, today: not started yet. Details below the calendar.');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('a day from Home’s calendar is chosen in its week, brought to the top and focused', async () => {
    // jsdom has no scrolling.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const { onDayShown } = setup(seed(), { showDay: '2026-09-24' });
      const heading = screen.getByRole('heading', { level: 2, name: 'Thursday 24 September' });
      await waitFor(() => expect(document.activeElement).toBe(heading));
      expect(scrollIntoView.mock.contexts).toContain(heading);
      expect(scrollIntoView).toHaveBeenLastCalledWith(expect.objectContaining({ block: 'start' }));
      expect(onDayShown).toHaveBeenCalledTimes(1);
      expect(calendar().getAttribute('aria-label')).toBe('Week of Monday 21 September');
      expect(day('Thursday 24 September, visit, 7 of 7 done, £65.00, selected')).toBeTruthy();
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});

describe('Task list sheet', () => {
  const sheet = () => screen.getByRole('dialog', { name: 'Task list' });
  /** The tasks' names, in the sheet or in one of its cards. */
  const taskNames = (inside: HTMLElement = sheet()) =>
    within(inside)
      .getAllByRole('textbox', { name: 'Task name' })
      .map((i) => (i as HTMLTextAreaElement).value);
  /** The new name's field that Add Task or Add Section opened: focused inside the tap. */
  const draft = () => {
    const field = document.activeElement as HTMLTextAreaElement;
    expect(field.hasAttribute('data-draft-input')).toBe(true);
    return field;
  };
  const noDraft = () => expect(document.querySelector('[data-draft-input]')).toBeNull();

  it('renames, adds, reorders and deletes tasks', async () => {
    const { actions, data } = setup(seed(), { sheet: true });
    expect(taskNames()).toEqual([...HOUSEKEEPING_STARTER_TASKS]);
    expect(
      within(sheet()).getByText(
        "Sections group the tasks, such as Kitchen or Bathrooms. Changes show in today's visit too. Earlier visits keep their own list.",
      ),
    ).toBeTruthy();
    // Names wrap (a field that grows with its text), so a long one reads in full.
    const first = within(sheet()).getAllByRole('textbox', { name: 'Task name' })[0];
    expect(first.tagName).toBe('TEXTAREA');
    // No sections: one card with no heading, and a plain Add Task.
    expect(within(sheet()).queryByRole('group', { name: 'No Section' })).toBeNull();
    const addTask = () => within(sheet()).getByRole('button', { name: 'Add Task' });

    // Rename in place; blank puts the old title back.
    act(() => first.focus());
    fireEvent.change(first, { target: { value: '  ' } });
    act(() => first.blur());
    expect(actions.renameHousekeepingTask).not.toHaveBeenCalled();
    act(() => first.focus());
    fireEvent.change(first, { target: { value: 'Change the sheets ' } });
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(actions.renameHousekeepingTask).toHaveBeenCalledWith('t1', 'Change the sheets');
    // Today's checklist follows.
    expect(within(openCard('Whole home', today())).getByRole('checkbox', { name: 'Change the sheets' })).toBeTruthy();

    // Add Task: the row becomes an empty field for the name, focused in the tap. Nothing is
    // made until a name is in.
    fireEvent.click(addTask());
    let field = draft();
    expect([field.getAttribute('aria-label'), field.value, field.placeholder]).toEqual(['Task name', '', 'New task']);
    expect(actions.createHousekeepingTask).not.toHaveBeenCalled();
    // Escape drops it, and focus goes back to Add Task; so does Enter with nothing typed.
    fireEvent.keyDown(field, { key: 'Escape' });
    noDraft();
    expect(document.activeElement).toBe(addTask());
    fireEvent.click(addTask());
    fireEvent.keyDown(draft(), { key: 'Enter' });
    noDraft();
    expect(actions.createHousekeepingTask).not.toHaveBeenCalled();
    // Typed, then Enter: made with that name, last, and focus is back on Add Task for the next.
    fireEvent.click(addTask());
    field = draft();
    fireEvent.change(field, { target: { value: ' Clean the windows ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(actions.createHousekeepingTask).toHaveBeenCalledWith('Clean the windows', null);
    await waitFor(() => expect(sheet().querySelector('[aria-busy="true"]')).toBeNull());
    expect(taskNames().at(-1)).toBe('Clean the windows');
    expect(document.activeElement).toBe(addTask());

    // The arrow keys on a grip move the task and say where to.
    const grip = within(sheet()).getByRole('button', { name: 'Reorder Ironing' });
    act(() => grip.focus());
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    // One task and where it goes, so a move made on another phone meanwhile stands.
    expect(actions.moveHousekeepingTask).toHaveBeenCalledWith('t7', null, 5);
    expect(within(sheet()).getByText('Ironing moved to position 6 of 8.')).toBeTruthy();
    expect(document.activeElement).toBe(within(sheet()).getByRole('button', { name: 'Reorder Ironing' }));

    // Delete asks first.
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Delete Empty the bins' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Empty the bins?' });
    expect(within(confirm).getByText('Earlier visits keep it.')).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete Task' }));
    expect(actions.deleteHousekeepingTask).toHaveBeenCalledWith('t6');
    expect(data().housekeeping.tasks.map((t) => t.title)).not.toContain('Empty the bins');
    expect(taskNames()).toEqual([
      'Change the sheets',
      'Hoover and mop the floors',
      'Clean the bathrooms',
      'Clean the kitchen',
      'Dust the surfaces',
      'Ironing',
      'Clean the windows',
    ]);
  });

  it('adds a section with the name typed; a task added into it goes there, and the checklist shows it', async () => {
    const { actions } = setup(seed(), { sheet: true });
    // No sections yet: no Move to Section on the rows.
    expect(within(sheet()).queryByRole('button', { name: 'Move Ironing to a section' })).toBeNull();

    fireEvent.click(within(sheet()).getByRole('button', { name: 'Add Section' }));
    const name = draft();
    expect([name.getAttribute('aria-label'), name.value, name.placeholder]).toEqual(['Section name', '', 'New section']);
    fireEvent.change(name, { target: { value: ' Kitchen ' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    // Made with its name: nothing to rename afterwards.
    expect(actions.createHousekeepingSection).toHaveBeenCalledWith('Kitchen');
    expect(actions.renameHousekeepingSection).not.toHaveBeenCalled();
    await waitFor(() => expect(sheet().querySelector('[aria-busy="true"]')).toBeNull());
    const card = within(sheet()).getByRole('group', { name: 'Kitchen' });
    expect(document.activeElement).toBe(within(sheet()).getByRole('button', { name: 'Add Section' }));
    // An empty section adds nothing to the checklist (the Kitchen card is the area's).
    expect(cardNames(today())).toEqual(['Whole home, 0 of 7 done', 'Kitchen, no tasks yet', 'Living Room, no tasks yet']);
    // The tasks in no section are headed now, and each Add Task says where it adds.
    const none = within(sheet()).getByRole('group', { name: 'No Section' });
    expect(taskNames(none)).toEqual([...HOUSEKEEPING_STARTER_TASKS]);
    expect(within(none).getByRole('button', { name: 'Add Task to No Section' })).toBeTruthy();

    fireEvent.click(within(card).getByRole('button', { name: 'Add Task to Kitchen' }));
    const task = draft();
    expect(task.getAttribute('aria-label')).toBe('Task name');
    fireEvent.change(task, { target: { value: 'Clean the oven' } });
    fireEvent.keyDown(task, { key: 'Enter' });
    expect(actions.createHousekeepingTask).toHaveBeenCalledWith('Clean the oven', 's-new-1');
    await waitFor(() => expect(taskNames(card)).toEqual(['Clean the oven']));
    expect(document.activeElement).toBe(within(card).getByRole('button', { name: 'Add Task to Kitchen' }));
    // Now the Kitchen area's card has it: the section is named after it.
    expect(cardNames(today())).toEqual(['Whole home, 0 of 7 done', 'Kitchen, 0 of 1 done', 'Living Room, no tasks yet']);
    expect(within(openCard('Kitchen', today())).getByRole('checkbox', { name: 'Clean the oven' })).toBeTruthy();
    // Rows have Move to Section once there are sections.
    expect(within(sheet()).getByRole('button', { name: 'Move Ironing to a section' })).toBeTruthy();
  });

  it('a name typed is kept when the field is left; while it saves its row shows it, and a failed save gives it back', async () => {
    const { actions, data } = setup(sectioned(), { sheet: true });
    let fail!: (error: Error) => void;
    actions.createHousekeepingTask.mockImplementationOnce(
      () =>
        new Promise<HousekeepingTask>((_, reject) => {
          fail = reject;
        }),
    );
    const kitchen = within(sheet()).getByRole('group', { name: 'Kitchen' });
    fireEvent.click(within(kitchen).getByRole('button', { name: 'Add Task to Kitchen' }));
    const field = draft();
    fireEvent.change(field, { target: { value: 'Clean the oven' } });
    // Leaving the field (a tap elsewhere) makes it too.
    act(() => field.blur());
    expect(actions.createHousekeepingTask).toHaveBeenCalledWith('Clean the oven', KITCHEN.id);
    noDraft();
    // Saving: the name shows where it will be, busy.
    expect(kitchen.querySelector('[aria-busy="true"]')!.textContent).toBe('Clean the oven');
    // It failed (a toast says why): the name is back in its field, to try again.
    await act(async () => fail(new Error('offline')));
    expect(kitchen.querySelector('[aria-busy="true"]')).toBeNull();
    expect(kitchen.querySelector<HTMLTextAreaElement>('[data-draft-input]')!.value).toBe('Clean the oven');
    expect(data().housekeeping.tasks.map((t) => t.title)).not.toContain('Clean the oven');
  });

  it('a tap on another button while a name is typed lands: the name is saved first, then the button does its job', async () => {
    const { actions } = setup(sectioned(), { sheet: true });
    const none = within(sheet()).getByRole('group', { name: 'No Section' });
    fireEvent.click(within(none).getByRole('button', { name: 'Add Task to No Section' }));
    fireEvent.change(draft(), { target: { value: 'Windows' } });
    // The press keeps the field focused, so nothing moves under the finger before the click...
    const remove = within(sheet()).getByRole('button', { name: 'Delete Empty the bins' });
    expect(fireEvent.mouseDown(remove)).toBe(false);
    draft();
    // ...which saves the name, then asks about the delete.
    fireEvent.click(remove);
    expect(actions.createHousekeepingTask).toHaveBeenCalledWith('Windows', null);
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Empty the bins?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(actions.deleteHousekeepingTask).not.toHaveBeenCalled();

    // Add Task in another card: the name is saved and that card's field opens, in one tap.
    await waitFor(() => expect(sheet().querySelector('[aria-busy="true"]')).toBeNull());
    fireEvent.click(within(none).getByRole('button', { name: 'Add Task to No Section' }));
    fireEvent.change(draft(), { target: { value: 'Oven' } });
    const addToKitchen = within(sheet()).getByRole('button', { name: 'Add Task to Kitchen' });
    expect(fireEvent.mouseDown(addToKitchen)).toBe(false);
    fireEvent.click(addToKitchen);
    expect(actions.createHousekeepingTask).toHaveBeenLastCalledWith('Oven', null);
    expect(within(sheet()).getByRole('group', { name: 'Kitchen' }).contains(draft())).toBe(true);
    await waitFor(() =>
      expect(taskNames(none)).toEqual([
        'Change the bed sheets',
        'Hoover and mop the floors',
        'Dust the surfaces',
        'Ironing',
        'Windows',
        'Oven',
      ]),
    );
  });

  it('moves a task with Move to Section, keeping your place, and with the arrow keys from one section to the next', async () => {
    const { actions, data } = setup(sectioned(), { sheet: true });
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Move Ironing to a section' }));
    const menu = await screen.findByRole('menu', { name: 'Move to Section' });
    expect(within(menu).getAllByRole('menuitemradio').map((i) => [i.textContent, i.getAttribute('aria-checked')])).toEqual([
      ['No Section', 'true'],
      ['Kitchen', 'false'],
      ['Bathrooms', 'false'],
    ]);
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Kitchen' }));
    // To the end of the kitchen.
    expect(actions.moveHousekeepingTask).toHaveBeenLastCalledWith('t7', KITCHEN.id, 2);
    expect(within(sheet()).getByText('Ironing moved to Kitchen, position 3 of 3.')).toBeTruthy();
    expect(data().housekeeping.tasks.find((t) => t.id === 't7')!.section_id).toBe(KITCHEN.id);
    // It lights up where it landed, while focus stays in the card it left: on the "…" of the
    // task before it (it was last), ready for the next move.
    expect(within(sheet()).getByRole('button', { name: 'Reorder Ironing' }).closest('li')!.hasAttribute('data-moved')).toBe(true);
    await waitFor(() =>
      expect(document.activeElement).toBe(within(sheet()).getByRole('button', { name: 'Move Dust the surfaces to a section' })),
    );

    // Up from the top of the kitchen: to the end of the tasks in no section.
    const grip = within(sheet()).getByRole('button', { name: 'Reorder Clean the kitchen' });
    act(() => grip.focus());
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    expect(actions.moveHousekeepingTask).toHaveBeenLastCalledWith('t4', null, 3);
    expect(within(sheet()).getByText('Clean the kitchen moved to No Section, position 4 of 4.')).toBeTruthy();
    expect(document.activeElement).toBe(within(sheet()).getByRole('button', { name: 'Reorder Clean the kitchen' }));
    // And down again, to the top of the kitchen.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(actions.moveHousekeepingTask).toHaveBeenLastCalledWith('t4', KITCHEN.id, 0);
    expect(within(sheet()).getByText('Clean the kitchen moved to Kitchen, position 1 of 3.')).toBeTruthy();
  });

  it("a section's menu renames it, moves it, and deletes it after asking, keeping its tasks", async () => {
    const { actions, data } = setup(sectioned(), { sheet: true });
    const openMenu = async (name: string) => {
      fireEvent.click(within(sheet()).getByRole('button', { name: `${name} options` }));
      return screen.findByRole('menu', { name: `${name} options` });
    };

    // The first has no Move Up, the last no Move Down.
    let menu = await openMenu('Kitchen');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Rename', 'Move Down', 'Delete Section']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move Down' }));
    expect(actions.moveHousekeepingSection).toHaveBeenCalledWith(KITCHEN.id, 1);
    expect(within(sheet()).getByText('Kitchen moved to position 2 of 2.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(sheet()).getByRole('button', { name: 'Kitchen options' })));
    // The checklist: the Kitchen area keeps its place (the household's order), Bathrooms (no area's) stays last.
    expect(cardNames(today())).toEqual([
      'Whole home, 0 of 4 done',
      'Kitchen, 0 of 2 done',
      'Living Room, no tasks yet',
      'Bathrooms, 0 of 1 done',
    ]);

    // Rename: its name, focused and selected inside the tap (so a phone's keyboard comes up).
    menu = await openMenu('Kitchen');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Rename', 'Move Up', 'Delete Section']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }));
    const field = document.activeElement as HTMLTextAreaElement;
    expect(field.getAttribute('aria-label')).toBe('Section name');
    expect([field.value, field.selectionStart, field.selectionEnd]).toEqual(['Kitchen', 0, 7]);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: 'Kitchen and utility' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(actions.renameHousekeepingSection).toHaveBeenCalledWith(KITCHEN.id, 'Kitchen and utility');
    // No area has that name: its tasks have a card of their own, in the sections' order, after Bathrooms.
    expect(cardNames(today())).toEqual([
      'Whole home, 0 of 4 done',
      'Kitchen, no tasks yet',
      'Living Room, no tasks yet',
      'Bathrooms, 0 of 1 done',
      'Kitchen and utility, 0 of 2 done',
    ]);

    menu = await openMenu('Kitchen and utility');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete Section' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Kitchen and utility?' });
    expect(within(confirm).getByText('Its 2 tasks move to the top of the list. Earlier visits keep this section.')).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete Section' }));
    expect(actions.deleteHousekeepingSection).toHaveBeenCalledWith(KITCHEN.id);
    expect(data().housekeeping.sections.map((s) => s.title)).toEqual(['Bathrooms']);
    // Its tasks: at the top, after the ones there, in their order.
    expect(taskNames()).toEqual([
      'Change the bed sheets',
      'Hoover and mop the floors',
      'Dust the surfaces',
      'Ironing',
      'Clean the kitchen',
      'Empty the bins',
      'Clean the bathrooms',
    ]);
    // Focus: the next section's "…", else (as here, it was last) the one before it.
    await waitFor(() => expect(document.activeElement).toBe(within(sheet()).getByRole('button', { name: 'Bathrooms options' })));
  });

  it('says what deleting a section does to its tasks', () => {
    expect(deleteSectionMessage(0)).toBe('Earlier visits keep this section.');
    expect(deleteSectionMessage(1)).toBe('Its task moves to the top of the list. Earlier visits keep this section.');
    expect(deleteSectionMessage(3)).toBe('Its 3 tasks move to the top of the list. Earlier visits keep this section.');
  });

  it("a section's grip moves it with the arrow keys", () => {
    const { actions } = setup(sectioned(), { sheet: true });
    const grip = within(sheet()).getByRole('button', { name: 'Reorder Bathrooms section' });
    expect(grip.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(grip.getAttribute('aria-describedby')!)!.textContent).toBe(
      'Drag, or use the up and down arrow keys, to move this section.',
    );
    act(() => grip.focus());
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    expect(actions.moveHousekeepingSection).toHaveBeenCalledWith(BATHROOMS.id, 0);
    expect(within(sheet()).getByText('Bathrooms moved to position 1 of 2.')).toBeTruthy();
    expect(document.activeElement).toBe(within(sheet()).getByRole('button', { name: 'Reorder Bathrooms section' }));
    // Already first: nothing.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(actions.moveHousekeepingSection).toHaveBeenCalledTimes(1);
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
    expect(cardNames(today())).toEqual(['Kitchen, no tasks yet', 'Living Room, no tasks yet']);
  });
});
