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

export const RAG_LABEL: Record<Rag, string> = { red: 'Red', amber: 'Amber', green: 'Green' };

/** Ring/dot colour. */
export const RAG_RING: Record<Rag, string> = { red: '#FF3B30', amber: '#FF9500', green: '#34C759' };
/** Ring fill on Home. */
export const RAG_TINT: Record<Rag, string> = {
  red: 'rgba(255,59,48,0.12)',
  amber: 'rgba(255,149,0,0.14)',
  green: 'rgba(52,199,89,0.14)',
};
/** Selected background in the RAG picker. */
export const RAG_PICK_BG: Record<Rag, string> = {
  red: 'rgba(255,59,48,0.10)',
  amber: 'rgba(255,149,0,0.12)',
  green: 'rgba(52,199,89,0.12)',
};
/** Accessible text tone. */
export const RAG_TEXT: Record<Rag, string> = { red: '#D70015', amber: '#C93400', green: '#248A3D' };

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

/** New item defaults (README: To do, Amber, due in 7 days, Unassigned, Never, 1 day before). */
export const NEW_ITEM_DEFAULTS = {
  kind: 'task' as ItemKind,
  rag: 'amber' as Rag,
  due_in_days: 7,
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
  chatMessage: 4000,
  /** A person's Google email (members_email_length; isValidEmail() in lib/logic/people.ts). */
  email: 254,
} as const;

/** Messages per chat page (the newest page first, older ones as you scroll up). */
export const CHAT_PAGE_SIZE = 50;

/** One-tap reactions shown above a message (iOS tapback style). */
export const QUICK_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏'] as const;

/**
 * The fuller reaction grid behind the "+" in the reaction bar, and the only
 * emoji a reaction may be. Keep in step with the check constraint
 * message_reactions_emoji_allowed in supabase/migrations/20261010000100_chat.sql
 * (exact code points, including U+FE0F; constants.test.ts compares them).
 */
export const REACTION_EMOJIS = [
  '❤️', '👍', '👎', '😂', '😮', '😢', '🙏', '🎉',
  '🔥', '👏', '💯', '✅', '❌', '👀', '🤔', '😍',
  '🥳', '😅', '🙌', '💪', '🏡', '🧹', '🛠️', '🦔',
  '🦆', '🦊', '🌻', '⭐', '☕', '🍕', '😴', '🤞',
] as const;
