import type { ItemKind, Notify, Rag, Repeat, SeedItem } from './types';

export const APP_NAME = 'home.os';

/** Profile emoji, in grid order (6 columns × 4 rows). */
export const EMOJIS = [
  '🦔', '🦆', '🦊', '🐻', '🐼', '🐨',
  '🐸', '🐢', '🐙', '🦉', '🐝', '🦋',
  '🐱', '🐶', '🐰', '🦁', '🐧', '🐳',
  '🌻', '🌵', '🍄', '🌈', '⭐', '🔥',
] as const;

/** Member colours, assigned in join order (cycles after six). */
export const MEMBER_COLORS = ['#007AFF', '#AF52DE', '#30B0C7', '#FF9500', '#34C759', '#FF2D55'] as const;

export const RAG_ORDER: Rag[] = ['red', 'amber', 'green'];

/**
 * What a To do item's colour means, in words (the household's own rule): red is urgent,
 * amber is to be done within the month, green is not urgent. Shown wherever the colour is.
 */
export const URGENCY_LABEL: Record<Rag, string> = { red: 'Urgent', amber: 'Within the month', green: 'Not urgent' };

/** What a To maintain item's colour means, in words: the condition it is in. */
export const CONDITION_LABEL: Record<Rag, string> = { red: 'Needs work', amber: 'Okay', green: 'Good' };

/**
 * What each word means, under it in the Item sheet's picker: how soon (To do) or what shape
 * it is in (To maintain).
 */
export const RAG_HINT: Record<ItemKind, Record<Rag, string>> = {
  task: { red: 'Needs doing now', amber: 'Some time in the next few weeks', green: 'Whenever there is time' },
  state: { red: 'Not as it should be', amber: 'Fine for now, keep an eye on it', green: 'Just as it should be' },
};

/** The word for an item's colour: its urgency (To do) or its condition (To maintain). */
export function ragWord(kind: ItemKind | undefined, rag: Rag): string {
  return kind === 'state' ? CONDITION_LABEL[rag] : URGENCY_LABEL[rag];
}

/** The two kinds of item, as the Item sheet offers them ("To do" is the default). */
export const KIND_OPTIONS: { value: ItemKind; label: string }[] = [
  { value: 'task', label: 'To do' },
  { value: 'state', label: 'To maintain' },
];

export const KIND_LABEL: Record<ItemKind, string> = { task: 'To do', state: 'To maintain' };

/** What a 'state' (To maintain) always has: no due date, repeat or reminder. */
export const STATE_FIELDS = { due_date: null, repeat: 'none', notify: 'none' } as const;

export const REPEAT_OPTIONS: { value: Repeat; label: string }[] = [
  { value: 'none', label: 'Never' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Every 3 months' },
  { value: 'biannual', label: 'Every 6 months' },
  { value: 'yearly', label: 'Yearly' },
];

export const NOTIFY_OPTIONS: { value: Notify; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'same_day', label: 'On the day' },
  { value: 'day_before', label: '1 day before' },
  { value: 'week_before', label: '1 week before' },
];

/** Days before the due date that the reminder goes out. */
export const NOTIFY_DAYS_BEFORE: Record<Exclude<Notify, 'none'>, number> = {
  same_day: 0,
  day_before: 1,
  week_before: 7,
};

/** Months added per repeat interval (weekly is handled as 7 days). */
export const REPEAT_MONTHS: Record<Exclude<Repeat, 'none' | 'weekly'>, number> = {
  monthly: 1,
  quarterly: 3,
  biannual: 6,
  yearly: 12,
};

/**
 * New item defaults (design/README.md "New item"): To do, Within the month, no due date,
 * Unassigned, Never, 1 day before (once it has a date). A job is due only when someone says
 * when, as in Reminders, Things and Todoist: a date a week on turned a "Not urgent" job nobody
 * had dated into a red "1 day late".
 */
export const NEW_ITEM_DEFAULTS = {
  kind: 'task' as ItemKind,
  rag: 'amber' as Rag,
  due_date: null,
  repeat: 'none' as Repeat,
  notify: 'day_before' as Notify,
};

export const DEFAULT_AREAS = [
  'Kitchen',
  'Living Room',
  'Bathroom Small',
  'Bathroom Large',
  'Bedroom Small',
  'Bedroom Large',
  'Garden',
  'Garden Lounge',
  'Jacuzzi',
  'Hallway',
  'Front garden',
];

export const DEFAULT_ADDRESS = '21 Alderbrook Road';

/**
 * The household's current notes list (from the prototype's logic class), plus the new
 * firepit, kept track of as a "To maintain" item with what good looks like for it. Due
 * offsets are relative to 8 Oct, the day the list was captured.
 */
export const SEED_ITEMS: SeedItem[] = [
  { area: 'Kitchen', title: 'Kitchen paper', note: 'Restocked.', rag: 'green', due_in_days: 28, repeat: 'monthly', notify: 'day_before', demo_assignee: 'me' },
  { area: 'Kitchen', title: 'Olive oil', note: 'Restocked, 5L tin is in the pantry.', rag: 'green', due_in_days: 35, repeat: 'monthly', notify: 'day_before', demo_assignee: 'me' },
  { area: 'Living Room', title: 'Mirror lights not level', note: 'One is 3cm higher. We need to bring someone in to make it even.', rag: 'amber', due_in_days: 12, repeat: 'none', notify: 'day_before' },
  { area: 'Bathroom Small', title: 'Re-seal around the shower', note: 'Mould starting in the corner.', rag: 'amber', due_in_days: 16, repeat: 'none', notify: 'day_before', demo_assignee: 'shea' },
  { area: 'Bathroom Large', title: 'Shower draining slowly', note: 'Tried the plunger, still slow.', rag: 'amber', due_in_days: 6, repeat: 'none', notify: 'day_before', demo_assignee: 'shea' },
  { area: 'Bedroom Large', title: 'Wardrobe door hinge', note: 'Works, but squeaks.', rag: 'green', due_in_days: 23, repeat: 'none', notify: 'day_before', demo_assignee: 'me' },
  { area: 'Garden', title: 'Garden room wall panel', note: 'Collapsed where it was cut for the AC. Solved for now, but the solution is not the most elegant.', rag: 'amber', due_in_days: 22, repeat: 'none', notify: 'day_before', demo_assignee: 'me' },
  { area: 'Garden', title: 'Give away the old firepit', note: 'Ela will take it, she has a garden. She will confirm next week.', rag: 'green', due_in_days: 7, repeat: 'none', notify: 'day_before', demo_assignee: 'ela' },
  { area: 'Garden', kind: 'state', title: 'Firepit', note: "New one installed. Keep the cover on when it's not in use.", good: 'Cover on when not in use, ash cleared out, logs dry and stacked under the bench.', rag: 'green', due_in_days: null, repeat: 'none', notify: 'none', demo_assignee: 'ela' },
  { area: 'Garden Lounge', title: 'Clean cushions before winter', note: '', rag: 'green', due_in_days: 23, repeat: 'none', notify: 'day_before', demo_assignee: 'ela' },
  { area: 'Jacuzzi', title: 'Water test strips running low', note: 'Order a new pack.', rag: 'amber', due_in_days: 4, repeat: 'none', notify: 'day_before' },
  { area: 'Jacuzzi', title: 'Change the filter', note: '', rag: 'green', due_in_days: 12, repeat: 'monthly', notify: 'day_before', demo_assignee: 'shea' },
  { area: 'Hallway', title: 'Heaters not working', note: 'No heat since the weekend. Engineer needs booking.', rag: 'red', due_in_days: -2, repeat: 'none', notify: 'day_before', demo_assignee: 'shea' },
  { area: 'Front garden', title: 'Trim the hedges', note: '', rag: 'green', due_in_days: 25, repeat: 'quarterly', notify: 'day_before' },
];

/**
 * More To do items for the demo household (`?demo-seed=1` only, after SEED_ITEMS; never a
 * real household's list), so Needs attention's calendar has a lively month: something due today, three
 * weekly jobs whose repeats show faint through the month, and a busy day six days on with
 * four things due (three dots and "+1"). Due offsets are from today, like SEED_ITEMS'.
 * Garden Lounge keeps one status (green) and Front garden two, so their names still fit
 * on one line beside the status counts at 320px (e2e/share.spec.ts).
 */
export const DEMO_CALENDAR_ITEMS: SeedItem[] = [
  { area: 'Garden Lounge', title: 'Empty the dehumidifier', note: 'The tank fills in about a week.', rag: 'green', due_in_days: 0, repeat: 'weekly', notify: 'same_day', demo_assignee: 'shea' },
  { area: 'Garden Lounge', title: 'Water the plants', note: '', rag: 'green', due_in_days: 2, repeat: 'weekly', notify: 'same_day', demo_assignee: 'ela' },
  { area: 'Garden Lounge', title: 'Cover the garden furniture', note: 'Storm forecast for that night.', rag: 'green', due_in_days: 6, repeat: 'none', notify: 'day_before', demo_assignee: 'shea' },
  { area: 'Front garden', title: 'Put the bins out', note: 'Collection is early the next morning.', rag: 'green', due_in_days: 6, repeat: 'weekly', notify: 'same_day', demo_assignee: 'me' },
  { area: 'Front garden', title: 'Clear the gutters', note: 'Overflowing at the back corner.', rag: 'red', due_in_days: 6, repeat: 'biannual', notify: 'day_before' },
];

/** Hour (household time) after which reminders, missed alerts and the weekly email go out. */
export const SEND_HOUR = 8;

/** Maximum text lengths (inputs use maxLength; the database enforces the same limits). */
export const TEXT_LIMITS = {
  itemTitle: 200,
  itemNote: 4000,
  /** "What good looks like" on a To maintain item. */
  itemGood: 4000,
  memberName: 40,
  householdName: 60,
  address: 120,
  areaName: 60,
  /** No input: emoji come from EMOJI_SET. The database still caps what a client can store. */
  memberEmoji: 16,
  /** A task on the housekeeping task list (and its copy on a visit). */
  housekeepingTask: 200,
  /** A section of the housekeeping task list (and its name on a visit's rows). */
  housekeepingSection: 40,
  /** The "Message for the housekeeper" (and its copy on a visit). */
  housekeepingNote: 4000,
  /** A visit's comments. */
  housekeepingComments: 4000,
  /** A person's Google email (members_email_length; isValidEmail() in lib/logic/people.ts). */
  email: 254,
  /** A reminder someone set for themselves (server mode: Profile > Notifications). */
  reminderTitle: 80,
} as const;

// ── Housekeeping (docs/ARCHITECTURE.md "Housekeeping") ──────

/**
 * Highest price for a day, in pence (£10,000.00). The database check
 * housekeeping_visits_price_range allows 0 to this, or null (not entered).
 */
export const HOUSEKEEPING_PRICE_MAX_PENCE = 1_000_000;

/**
 * The task list every new household starts with, in this order. Keep in step with the
 * array in create_household and the backfill in
 * supabase/migrations/20261010000400_housekeeping.sql (same titles, same order; a unit
 * test compares them).
 */
export const HOUSEKEEPING_STARTER_TASKS = [
  'Change the bed sheets',
  'Hoover and mop the floors',
  'Clean the bathrooms',
  'Clean the kitchen',
  'Dust the surfaces',
  'Empty the bins',
  'Ironing',
] as const;

/** Title a task gets from "Add Task" in the task list sheet (then focused to type over). */
export const HOUSEKEEPING_NEW_TASK = 'New task';

/** Name a section gets from "Add Section" in the task list sheet (then focused to type over). */
export const HOUSEKEEPING_NEW_SECTION = 'New section';

/**
 * The most sections a household's task list may have. The database's trigger refuses more
 * (check_violation housekeeping_sections_limit), DemoBackend too (invalid_input: sections).
 */
export const HOUSEKEEPING_SECTIONS_MAX = 30;

/** Comments and the message save this long after the last keystroke (and on blur). */
export const HOUSEKEEPING_SAVE_DELAY_MS = 1000;

/** A demo person, as in SeedItem.demo_assignee ('me' = the signed-in user). */
export type DemoPersonKey = 'me' | 'shea' | 'ela';

/**
 * The demo household's "Message for the housekeeper" (src/lib/backend/demo.ts): written by
 * `by`, `daysBack` days before today at hour:minute household time.
 */
export const HOUSEKEEPING_DEMO_NOTE: {
  body: string;
  by: DemoPersonKey;
  daysBack: number;
  hour: number;
  minute: number;
} = {
  body: 'Guests arrive Friday, please do the spare room first.',
  by: 'shea',
  daysBack: 1,
  hour: 19,
  minute: 20,
};

/** One past visit in the demo household (see HOUSEKEEPING_DEMO_VISITS). */
export interface HousekeepingSeedVisit {
  /**
   * Which Thursday: 0 = the latest Thursday strictly before today (household time zone),
   * 1 = the Thursday a week before that, and so on. Never today, never in the future.
   */
  weeksBack: number;
  /** Who recorded it: created_by, updated_by and done_by of its ticks. */
  by: DemoPersonKey;
  /** Household-time wall clock of the first tick (created_at). */
  hour: number;
  minute: number;
  /** The visit's copy of the message that day ('' = none). */
  note: string;
  /**
   * Titles from HOUSEKEEPING_STARTER_TASKS that were ticked; the others are on the visit
   * but not done. Ticks are one minute apart from hour:minute, in list order; updated_at is
   * one minute after the last tick.
   */
  done: string[];
  comments: string;
  price_pence: number | null;
}

/**
 * The demo household's past visits (every demo household, ?demo-seed=1 included, gets
 * them along with the starter task list and HOUSEKEEPING_DEMO_NOTE). Each visit's tasks
 * are the seven starter tasks in order. With the e2e clock (Thu 8 Oct 2026, 10:00 London)
 * they fall on Thu 1 Oct, 24 Sep, 17 Sep, 10 Sep and 3 Sep, so October shows
 * "1 visit · £60.00" and September "4 visits · £240.00".
 */
export const HOUSEKEEPING_DEMO_VISITS: HousekeepingSeedVisit[] = [
  {
    weeksBack: 0,
    by: 'ela',
    hour: 10,
    minute: 5,
    note: 'Please leave the ironing for next week.',
    done: ['Change the bed sheets', 'Hoover and mop the floors', 'Clean the bathrooms', 'Clean the kitchen', 'Dust the surfaces', 'Empty the bins'],
    comments: "Ironing left for next week as asked. We're out of bin bags.",
    price_pence: 6000,
  },
  {
    weeksBack: 1,
    by: 'shea',
    hour: 9,
    minute: 50,
    note: '',
    done: [...HOUSEKEEPING_STARTER_TASKS],
    comments: 'Oven cleaned as well, it took an extra half hour.',
    price_pence: 6500,
  },
  {
    weeksBack: 2,
    by: 'ela',
    hour: 10,
    minute: 10,
    note: 'Please give the fridge a wipe inside.',
    done: ['Hoover and mop the floors', 'Clean the bathrooms', 'Clean the kitchen', 'Dust the surfaces', 'Empty the bins', 'Ironing'],
    comments: 'Fridge done. The hoover bag is nearly full.',
    price_pence: 6000,
  },
  {
    weeksBack: 3,
    by: 'me',
    hour: 10,
    minute: 0,
    note: '',
    done: ['Change the bed sheets', 'Hoover and mop the floors', 'Clean the bathrooms', 'Clean the kitchen', 'Empty the bins'],
    comments: '',
    price_pence: 6000,
  },
  {
    weeksBack: 4,
    by: 'ela',
    hour: 10,
    minute: 20,
    note: '',
    done: ['Change the bed sheets', 'Hoover and mop the floors', 'Clean the bathrooms', 'Clean the kitchen', 'Dust the surfaces', 'Empty the bins'],
    comments: 'The bathroom tap is dripping.',
    price_pence: 5500,
  },
];
