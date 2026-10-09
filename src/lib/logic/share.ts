// What "Share" sends: a short plain-text summary of an item or an area, readable in
// WhatsApp, Messages or Mail, ending with a link back into the app.
import { RAG_LABEL } from '../constants';
import type { Area, ISODate, Item, Member, Repeat } from '../types';
import { formatDay } from './dates';
import { isMissed, isState, sortItems, updatedLabel } from './items';

/** A link into the app: `?item=<id>` opens that item, `?area=<id>` shows that area on Home. */
export type SharedLink = { kind: 'item' | 'area'; id: string };

/** What the share sheet gets: a title (Mail's subject) and the text, link included. */
export interface ShareMessage {
  title: string;
  text: string;
}

export interface ShareContext {
  members: Member[];
  /** Today in the household's time zone. */
  today: ISODate;
  /** The household's, for a To maintain item's "Updated" day. */
  timeZone: string;
  /** The app's address, ending in `/` (origin plus the base path). */
  baseUrl: string;
}

/** How a repeat reads in a shared message. */
export const SHARE_REPEAT: Record<Exclude<Repeat, 'none'>, string> = {
  weekly: 'Every week',
  monthly: 'Every month',
  quarterly: 'Every 3 months',
  biannual: 'Every 6 months',
  yearly: 'Every year',
};

/** The longest note (or "What good looks like") a share carries, in characters, "…" included. */
export const SHARE_NOTE_MAX = 280;
/** The most items an area share lists; the rest are counted ("…and 4 more"). */
export const SHARE_AREA_MAX = 20;

/** Ids are uuids; anything longer than this in a link is not one of ours. */
const LINK_ID_MAX = 64;

const SEP = ' · ';

const graphemes =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** Characters as a person counts them (an emoji, flag or accented letter is one). */
function charsOf(text: string): string[] {
  return graphemes ? Array.from(graphemes.segment(text), (s) => s.segment) : Array.from(text);
}

/** Spaces squashed, each line trimmed, blank lines dropped (the only blank line is the one before the link). */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Tidied, and at most `max` characters: a longer text ends at a word break (when there is
 * one in its last third) with "…".
 */
export function clipText(text: string, max: number = SHARE_NOTE_MAX): string {
  const tidy = tidyText(text);
  const chars = charsOf(tidy);
  if (chars.length <= max) return tidy;
  const kept = chars.slice(0, max - 1);
  let space = kept.length - 1;
  while (space >= 0 && !/\s/.test(kept[space])) space -= 1;
  const cut = space >= Math.floor((max * 2) / 3) ? kept.slice(0, space) : kept;
  return `${cut.join('').replace(/[\s,;:.\-–]+$/u, '')}…`;
}

/** `https://home.example/?item=<id>`: opens the item (or shows the area) in the app. */
export function linkUrl(baseUrl: string, link: SharedLink): string {
  return `${baseUrl}?${link.kind}=${encodeURIComponent(link.id)}`;
}

/** The item or area a link points at (`?item=` wins over `?area=`), or null. */
export function parseSharedLink(search: string): SharedLink | null {
  const params = new URLSearchParams(search);
  for (const kind of ['item', 'area'] as const) {
    const id = params.get(kind)?.trim();
    if (id && id.length <= LINK_ID_MAX) return { kind, id };
  }
  return null;
}

/** The person's name without their emoji. */
function nameOf(members: Member[], id: string | null): string | null {
  const name = members.find((m) => m.id === id)?.name.trim();
  return name || null;
}

/**
 * When it is due or was last updated, as on Home but spelt out for someone reading it
 * later: `Due Fri 13 Nov`, `Missed · Tue 6 Oct`, `Updated Tue 6 Oct`. Null without a date.
 */
function whenOf(item: Item, today: ISODate, timeZone: string): string | null {
  if (isState(item)) {
    const updated = updatedLabel(item.updated_at, today, timeZone);
    return updated === 'Updated' ? null : updated;
  }
  if (!item.due_date) return null;
  const day = formatDay(item.due_date, today);
  return isMissed(item, today) ? `Missed${SEP}${day}` : `Due ${day}`;
}

/**
 * An item, for example:
 *
 *     Heaters not working
 *     Hallway · Red · Missed · Tue 6 Oct
 *     Assigned to Shea
 *     No heat since the weekend. Engineer needs booking.
 *
 *     https://home.example/?item=…
 *
 * A repeating To do adds `Every month` to the second line. A To maintain item reads
 * `Updated <day>` there, `Looked after by <name>`, and adds `What good looks like: …`.
 */
export function itemShareMessage(item: Item, areas: Area[], ctx: ShareContext): ShareMessage {
  const state = isState(item);
  const title = item.title.trim();
  const area = areas.find((a) => a.id === item.area_id)?.name.trim();
  const repeat = !state && item.repeat !== 'none' ? SHARE_REPEAT[item.repeat] : null;
  const facts = [area, RAG_LABEL[item.rag], whenOf(item, ctx.today, ctx.timeZone), repeat].filter(Boolean);
  const name = nameOf(ctx.members, item.assignee_id);
  const who = name ? `${state ? 'Looked after by' : 'Assigned to'} ${name}` : 'Unassigned';
  const note = clipText(item.note);
  const good = state ? clipText(item.good) : '';
  const lines = [title, facts.join(SEP), who, note, good && `What good looks like: ${good}`].filter(Boolean);
  return { title, text: `${lines.join('\n')}\n\n${linkUrl(ctx.baseUrl, { kind: 'item', id: item.id })}` };
}

/** One line of an area share: `• Olive oil · Green · Due Fri 13 Nov`. */
function itemLine(item: Item, ctx: ShareContext): string {
  return `• ${[item.title.trim(), RAG_LABEL[item.rag], whenOf(item, ctx.today, ctx.timeZone)].filter(Boolean).join(SEP)}`;
}

/**
 * An area and its open items, To do first by date, then To maintain (Home's order):
 *
 *     Kitchen (2 items)
 *     • Kitchen paper · Green · Due Thu 5 Nov
 *     • Olive oil · Green · Due Thu 12 Nov
 *
 *     https://home.example/?area=…
 *
 * An area with nothing open says "Nothing to do"; past SHARE_AREA_MAX items the rest are counted.
 */
export function areaShareMessage(area: Area, items: Item[], ctx: ShareContext): ShareMessage {
  const title = area.name.trim();
  const open = sortItems(items.filter((it) => it.area_id === area.id && it.status === 'open'));
  const count = open.length;
  const heading = count ? `${title} (${count} ${count === 1 ? 'item' : 'items'})` : title;
  const shown = open.length > SHARE_AREA_MAX ? open.slice(0, SHARE_AREA_MAX - 1) : open;
  const lines = count ? shown.map((it) => itemLine(it, ctx)) : ['Nothing to do'];
  if (shown.length < count) lines.push(`…and ${count - shown.length} more`);
  return {
    title,
    text: `${[heading, ...lines].join('\n')}\n\n${linkUrl(ctx.baseUrl, { kind: 'area', id: area.id })}`,
  };
}
