// Pure helpers for the household chat: ordering and merging pages, grouping
// messages into runs, day separators and times in the household's time zone,
// reaction chips, unread state and the iPhone keyboard offset.

import type { ChatMessage, ChatPage, ChatReaction, ISOTimestamp, Member } from '../types';
import { addDays, formatDay, zonedParts } from './dates';

/** Consecutive messages from one sender this close together form a run (one name, one avatar). */
export const RUN_GAP_MS = 5 * 60_000;
/** A pause this long within a day gets its own time separator, like Messages. */
export const SEPARATOR_GAP_MS = 60 * 60_000;

/** Milliseconds since the epoch; any ISO form (`Z` or `+00:00`) compares the same. */
export const timeOf = (ts: ISOTimestamp): number => new Date(ts).getTime();

/**
 * Microseconds since the epoch, for ordering and comparing message times.
 * Postgres keeps microseconds and PostgREST prints them
 * ('2026-10-09T19:13:24.1021+00:00'), while a JS Date stops at milliseconds:
 * two messages in the same millisecond would otherwise tie.
 */
export function instantOf(ts: ISOTimestamp): number {
  const fraction = /[T ][\d:]+\.(\d+)/.exec(ts)?.[1] ?? '';
  // Parse with the fraction cut to milliseconds (engines differ on longer ones), then add the rest.
  const ms = Date.parse(fraction.length > 3 ? ts.replace(`.${fraction}`, `.${fraction.slice(0, 3)}`) : ts);
  return ms * 1000 + Number(fraction.slice(3, 6).padEnd(3, '0'));
}

/** Chat order: oldest first by instant (to the microsecond), then by id so the order is stable. */
export function compareMessages(a: ChatMessage, b: ChatMessage): number {
  return instantOf(a.created_at) - instantOf(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * `current` with `incoming` merged in by id (an incoming copy replaces the one
 * held, unless `keepLocal(id)` says the held copy is newer), in chat order.
 */
export function mergeMessages(
  current: ChatMessage[],
  incoming: ChatMessage[],
  keepLocal: (id: string) => boolean = () => false,
): ChatMessage[] {
  if (!incoming.length) return current;
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) {
    if (byId.has(m.id) && keepLocal(m.id)) continue;
    byId.set(m.id, m);
  }
  return [...byId.values()].sort(compareMessages);
}

/**
 * Folds a fresh newest page into what is loaded (resync, app back in view).
 *
 * Within the page's window (from its oldest message on, or everything when no
 * older ones exist) the page is the truth: messages missing from it were
 * deleted. `keepLocal(id)` marks messages this device changed or received
 * after the page was requested; those keep their held copy. Older loaded
 * messages stay when they join up with the page; when they might not (all of
 * them older than the window, so newer ones could be missing in between) they
 * are dropped and paging starts again from the page.
 */
export function mergeNewestPage(
  current: ChatMessage[],
  currentHasMore: boolean,
  page: ChatPage,
  keepLocal: (id: string) => boolean = () => false,
): { messages: ChatMessage[]; hasMore: boolean } {
  const pageIds = new Set(page.messages.map((m) => m.id));
  const start = page.hasMore && page.messages.length ? instantOf(page.messages[0].created_at) : -Infinity;
  const inWindow = (m: ChatMessage) => instantOf(m.created_at) >= start;
  const recent = current.filter((m) => !pageIds.has(m.id) && inWindow(m) && keepLocal(m.id));
  const older = current.filter((m) => !pageIds.has(m.id) && !inWindow(m));
  const joined = older.length > 0 && current.some(inWindow);
  const base = joined ? older : [];
  const held = new Map(current.map((m) => [m.id, m]));
  const fromPage = page.messages.map((m) => (keepLocal(m.id) && held.has(m.id) ? held.get(m.id)! : m));
  return {
    messages: [...base, ...fromPage, ...recent].sort(compareMessages),
    hasMore: joined ? currentHasMore : page.hasMore,
  };
}

// ── Time ──────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

/** "18:42" in the household's time zone (24-hour, as in the rest of the app's en-GB dates). */
export function formatClock(ts: ISOTimestamp, timeZone: string): string {
  const { hour, minute } = zonedParts(new Date(ts), timeZone);
  return `${pad(hour)}:${pad(minute)}`;
}

/** "Today", "Yesterday" or "Tue 6 Oct" (with the year when it is not this year). */
export function dayLabel(ts: ISOTimestamp, timeZone: string, now: Date): string {
  const day = zonedParts(new Date(ts), timeZone).date;
  const today = zonedParts(now, timeZone).date;
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  return formatDay(day, today);
}

/** "Today 08:05": what a separator says, and what a message's time reads as. */
export function stampLabel(ts: ISOTimestamp, timeZone: string, now: Date): { day: string; time: string } {
  return { day: dayLabel(ts, timeZone, now), time: formatClock(ts, timeZone) };
}

// ── Rows: separators, runs ────────────────────────────────

export type DeliveryState = 'sent' | 'sending' | 'failed';

/** One message as the chat shows it: stored, or still on its way from this device. */
export interface ChatEntry {
  /** Stable React key (a sent message keeps the key it had while sending). */
  key: string;
  message: ChatMessage;
  state: DeliveryState;
}

export type ChatRow =
  | { kind: 'separator'; key: string; day: string; time: string }
  | {
      kind: 'message';
      key: string;
      entry: ChatEntry;
      mine: boolean;
      /** First of a run: the sender's name goes above it. */
      first: boolean;
      /** Last of a run: the avatar (others) goes beside it. */
      last: boolean;
      /** The bubble has a tail: last of its run, or followed in it by an emoji-only message (no bubble). */
      tail: boolean;
    };

/**
 * Lays the entries out as rows: a separator at the start of each day (and
 * after an hour's pause), and runs of messages from one sender no more than
 * RUN_GAP_MS apart. A separator also ends a run.
 */
export function buildRows(entries: ChatEntry[], meId: string, timeZone: string, now: Date): ChatRow[] {
  const rows: ChatRow[] = [];
  type MessageRow = Extract<ChatRow, { kind: 'message' }>;
  let prev: MessageRow | null = null;
  let prevDay = '';
  for (const entry of entries) {
    const m = entry.message;
    const t = timeOf(m.created_at);
    const day = zonedParts(new Date(t), timeZone).date;
    const prevTime = prev ? timeOf(prev.entry.message.created_at) : -Infinity;
    const separated = !prev || day !== prevDay || t - prevTime >= SEPARATOR_GAP_MS;
    if (separated) {
      const { day: dayText, time } = stampLabel(m.created_at, timeZone, now);
      rows.push({ kind: 'separator', key: `sep-${entry.key}`, day: dayText, time });
    }
    const sameRun = !!prev && !separated && prev.entry.message.member_id === m.member_id && t - prevTime <= RUN_GAP_MS;
    if (prev && !sameRun) prev.last = prev.tail = true;
    else if (prev && isJumboEmoji(m.body)) prev.tail = true;
    const row: MessageRow = {
      kind: 'message',
      key: entry.key,
      entry,
      mine: m.member_id === meId,
      first: !sameRun,
      last: false,
      tail: false,
    };
    rows.push(row);
    prev = row;
    prevDay = day;
  }
  if (prev) prev.last = prev.tail = true;
  return rows;
}

// ── People ────────────────────────────────────────────────

export const FORMER_MEMBER = 'Former member';

/** The sender as shown in the chat: the member, or a former member (left, or row gone). */
export function senderOf(memberId: string | null, members: Member[]): { name: string; emoji: string; known: boolean } {
  const member = memberId ? members.find((m) => m.id === memberId) : undefined;
  return member
    ? { name: member.name, emoji: member.emoji, known: true }
    : { name: FORMER_MEMBER, emoji: '👤', known: false };
}

/** "Shea", "Shea and Ela", "Shea, Ela and you". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// ── Reactions ─────────────────────────────────────────────

export interface ReactionChip {
  emoji: string;
  count: number;
  /** You reacted with this emoji. */
  mine: boolean;
  /** Who reacted, in the order they did. */
  memberIds: string[];
}

/** One chip per emoji, in the order each emoji was first used. */
export function summarizeReactions(reactions: ChatReaction[], meId: string): ReactionChip[] {
  const chips = new Map<string, ReactionChip>();
  for (const r of reactions) {
    const chip = chips.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, memberIds: [] };
    if (chip.memberIds.includes(r.member_id)) continue;
    chip.memberIds.push(r.member_id);
    chip.count += 1;
    if (r.member_id === meId) chip.mine = true;
    chips.set(r.emoji, chip);
  }
  return [...chips.values()];
}

/** "👍, 2 reactions from Shea and you": the emoji, the count, who, and whether you did. */
export function reactionChipLabel(chip: ReactionChip, members: Member[], meId: string): string {
  const others = chip.memberIds.filter((id) => id !== meId).map((id) => senderOf(id, members).name);
  const names = chip.mine ? [...others, 'you'] : others;
  return `${chip.emoji}, ${chip.count} ${chip.count === 1 ? 'reaction' : 'reactions'} from ${joinNames(names)}`;
}

/** Your reaction with `emoji` added (on) or taken off, as the server will store it. */
export function applyReaction(message: ChatMessage, meId: string, emoji: string, on: boolean, at: ISOTimestamp): ChatMessage {
  const mine = (r: ChatReaction) => r.member_id === meId && r.emoji === emoji;
  const has = message.reactions.some(mine);
  if (on === has) return message;
  return {
    ...message,
    reactions: on
      ? [...message.reactions, { message_id: message.id, member_id: meId, emoji, created_at: at }]
      : message.reactions.filter((r) => !mine(r)),
  };
}

// ── Emoji-only messages ───────────────────────────────────

/**
 * One emoji as people type it: a flag (a pair of regional indicators, never
 * one alone), a keycap, or a pictograph (with its variation selector, skin
 * tone, tag sequence and ZWJ joins, e.g. 👨‍👩‍👧, ❤️‍🔥, 🏴󠁧󠁢󠁳󠁣󠁴󠁿).
 */
const EMOJI = String.raw`(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|(?:(?!\p{Regional_Indicator})\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F)\p{Emoji_Modifier}?[\u{E0020}-\u{E007E}]*\u{E007F}?(?:\u200D(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})\uFE0F?\p{Emoji_Modifier}?)*)`;
const JUMBO = new RegExp(`^(?:${EMOJI}\\s*){1,3}$`, 'u');

/** A message of only one to three emoji shows large, with no bubble (like Messages). */
export function isJumboEmoji(body: string): boolean {
  const text = body.trim();
  return text.length > 0 && text.length <= 64 && JUMBO.test(text);
}

// ── Unread ────────────────────────────────────────────────

/** The newest message's time, or null for an empty chat. */
export function newestTimestamp(messages: ChatMessage[]): ISOTimestamp | null {
  let best: ChatMessage | null = null;
  for (const m of messages) if (!best || timeOf(m.created_at) > timeOf(best.created_at)) best = m;
  return best?.created_at ?? null;
}

/** True when someone else (or a former member) wrote after `lastRead` (never read: anything from others). */
export function hasUnread(messages: ChatMessage[], meId: string, lastRead: ISOTimestamp | null): boolean {
  const since = lastRead ? timeOf(lastRead) : -Infinity;
  return messages.some((m) => m.member_id !== meId && timeOf(m.created_at) > since);
}

// ── Keyboard ──────────────────────────────────────────────

/**
 * How far the on-screen keyboard covers the bottom of the layout viewport:
 * iOS keeps the page height and shrinks (and may scroll) the visual viewport,
 * so the distance from its bottom to the page's bottom is the keyboard.
 */
export function keyboardInset(layoutHeight: number, viewport: { height: number; offsetTop: number } | null | undefined): number {
  if (!viewport) return 0;
  const covered = layoutHeight - viewport.height - viewport.offsetTop;
  // Sub-pixel noise and the URL bar wobble are not a keyboard.
  return covered > 40 ? Math.round(covered) : 0;
}
