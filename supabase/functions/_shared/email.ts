// The weekly household email (design/README.md "Notifications"). Everyone in a household gets
// the same content, in this order:
//   1. missed deadlines, 2. due in the next 7 days, 3. everything else open, grouped by area,
//   4. unassigned items, 5. done this week per person, 6. a button that opens home.os.
// Empty sections are left out. The HTML is inline-styled tables (what email clients render
// reliably) in the app's look: system font, #F2F2F7 page, white rounded cards, RAG dots.
//
// A state (To maintain) is never missed or due: it is listed in section 3 under its area,
// after that area's to-dos, marked "To maintain", and left out of the unassigned list (which
// is about to-dos nobody has picked up).

import { addDays, daysBetween, formatDay, type ISODate } from './dates.ts';
import type { AreaRow, CompletionRow, HouseholdRow, ItemRow, MemberRow, Rag } from './types.ts';

export interface WeeklyEmailInput {
  household: HouseholdRow;
  /** The household's members in join order. */
  members: MemberRow[];
  areas: AreaRow[];
  /** The household's open items. */
  items: ItemRow[];
  /** The household's recent completions (older than 7 days are ignored). */
  completions: CompletionRow[];
  /** Today in the household's time zone. */
  today: ISODate;
  now: Date;
  /** Where "Open home.os" goes. */
  appUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** "Due in the next 7 days" covers today up to and including today + 7. */
export const DUE_SOON_DAYS = 7;
const WEEK_MS = 7 * 86_400_000;
const NOTE_MAX = 160;

const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const ROUNDED = "ui-rounded,'SF Pro Rounded',-apple-system,BlinkMacSystemFont,system-ui,sans-serif";
const COLOR = {
  page: '#F2F2F7',
  card: '#FFFFFF',
  label: '#000000',
  secondary: '#6E6E73',
  separator: '#E5E5EA',
  tint: '#007AFF',
  missed: '#D70015',
};
const RAG_DOT: Record<Rag, string> = { red: '#FF3B30', amber: '#FF9500', green: '#34C759' };
const RAG_LABEL: Record<Rag, string> = { red: 'Red', amber: 'Amber', green: 'Green' };
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ── Content ─────────────────────────────────────────────────────────────────

interface DueLabel {
  text: string;
  missed: boolean;
}

export interface DigestRow {
  title: string;
  /** A state (To maintain): shown with the "To maintain" marker instead of a due date. */
  maintain: boolean;
  note: string;
  rag: Rag;
  area: string;
  /** "🦆 Shea" or "Unassigned". */
  who: string;
  due: DueLabel | null;
}

export interface Digest {
  /** The address, or the household name when there is none. */
  place: string;
  todayLabel: string;
  missed: DigestRow[];
  dueSoon: DigestRow[];
  others: { area: string; rows: DigestRow[] }[];
  unassigned: DigestRow[];
  done: { who: string; count: number; titles: string[] }[];
  nothingOpen: boolean;
}

/** "Tue 6 Oct · 2 days late", "Today", "Tomorrow", "Thu 15 Oct" (or null without a date). */
export function dueLabel(due: ISODate | null, today: ISODate): DueLabel | null {
  if (!due) return null;
  const diff = daysBetween(today, due);
  if (diff < 0) {
    const late = -diff;
    return { text: `${formatDay(due, today)} · ${late} ${late === 1 ? 'day' : 'days'} late`, missed: true };
  }
  if (diff === 0) return { text: 'Today', missed: false };
  if (diff === 1) return { text: 'Tomorrow', missed: false };
  return { text: formatDay(due, today), missed: false };
}

/** What marks a state in the email (the app's label for the kind). */
export const MAINTAIN_LABEL = 'To maintain';

const isState = (it: ItemRow) => it.kind === 'state';

/** As on Home: to-dos by earliest due date (no date last, then oldest first), then states by title. */
function compareItems(a: ItemRow, b: ItemRow): number {
  if (isState(a) !== isState(b)) return isState(a) ? 1 : -1;
  if (isState(a)) return a.title.localeCompare(b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (a.due_date !== b.due_date) {
    if (a.due_date === null) return 1;
    if (b.due_date === null) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  }
  const ac = a.created_at ?? '';
  const bc = b.created_at ?? '';
  if (ac !== bc) return ac < bc ? -1 : 1;
  return a.title.localeCompare(b.title);
}

function memberLabel(member: MemberRow | undefined): string {
  return member ? `${member.emoji} ${member.name}`.trim() : 'Unassigned';
}

function squash(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** The email's content, independent of HTML or plain text. */
export function buildDigest(input: WeeklyEmailInput): Digest {
  const { household, members, today, now } = input;
  const memberById = new Map(members.map((m) => [m.id, m]));
  const areas = [...input.areas].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const items = input.items.filter((it) => it.status === 'open').sort(compareItems);

  const row = (it: ItemRow): DigestRow => ({
    title: it.title,
    maintain: isState(it),
    note: squash(it.note ?? '', NOTE_MAX),
    rag: it.rag,
    area: areaName.get(it.area_id) ?? '',
    who: memberLabel(it.assignee_id ? memberById.get(it.assignee_id) : undefined),
    // A state is never due (it has no due date; this holds even for a stale row).
    due: isState(it) ? null : dueLabel(it.due_date, today),
  });

  const soonEnd = addDays(today, DUE_SOON_DAYS);
  const missed: DigestRow[] = [];
  const dueSoon: DigestRow[] = [];
  const rest: ItemRow[] = [];
  for (const it of items) {
    if (isState(it)) rest.push(it);
    else if (it.due_date !== null && it.due_date < today) missed.push(row(it));
    else if (it.due_date !== null && it.due_date <= soonEnd) dueSoon.push(row(it));
    else rest.push(it);
  }

  const others: Digest['others'] = [];
  for (const area of areas) {
    const rows = rest.filter((it) => it.area_id === area.id).map(row);
    if (rows.length) others.push({ area: area.name, rows });
  }
  const orphans = rest.filter((it) => !areaName.has(it.area_id)).map(row);
  if (orphans.length) others.push({ area: 'Other', rows: orphans });

  const unassigned = items
    .filter((it) => !isState(it) && (!it.assignee_id || !memberById.has(it.assignee_id)))
    .map(row);

  // Done this week: completions in the last 7 days, per person credited.
  const since = now.getTime() - WEEK_MS;
  const recent = input.completions
    .filter((c) => {
      const t = Date.parse(c.completed_at);
      return Number.isFinite(t) && t > since && t <= now.getTime();
    })
    .sort((a, b) => Date.parse(a.completed_at) - Date.parse(b.completed_at));
  const byPerson = new Map<string, CompletionRow[]>();
  for (const c of recent) {
    const key = c.credited_to && memberById.has(c.credited_to) ? c.credited_to : '';
    const list = byPerson.get(key) ?? [];
    list.push(c);
    byPerson.set(key, list);
  }
  const order = (key: string) => (key ? members.findIndex((m) => m.id === key) : members.length);
  const done = [...byPerson.entries()]
    .sort(([ka, a], [kb, b]) => b.length - a.length || order(ka) - order(kb))
    .map(([key, list]) => {
      const counts = new Map<string, number>();
      for (const c of list) counts.set(c.item_title, (counts.get(c.item_title) ?? 0) + 1);
      const titles = [...counts.entries()].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t));
      return { who: key ? memberLabel(memberById.get(key)) : 'Former member', count: list.length, titles };
    });

  return {
    place: household.address.trim() || household.name.trim() || 'Home',
    todayLabel: formatDay(today, today),
    missed,
    dueSoon,
    others,
    unassigned,
    done,
    nothingOpen: items.length === 0,
  };
}

/** Subject line: "home.os weekly: 21 Alderbrook Road". */
export function weeklySubject(household: Pick<HouseholdRow, 'name' | 'address'>): string {
  const place = household.address.trim() || household.name.trim() || 'Home';
  return `home.os weekly: ${place}`.replace(/[\r\n]+/g, ' ');
}

// ── HTML ────────────────────────────────────────────────────────────────────

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) links make it into the email. */
function safeHref(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') return escapeHtml(u.toString());
  } catch {
    /* not a URL */
  }
  return '#';
}

function font(size: number, line: number, weight: number, color: string, extra = ''): string {
  return `font-family:${FONT};font-size:${size}px;line-height:${line}px;font-weight:${weight};color:${color};${extra}`;
}

function sectionTitle(title: string): string {
  return `<tr><td style="padding:28px 4px 10px;${font(22, 28, 700, COLOR.label, 'letter-spacing:-0.01em;')}">${escapeHtml(title)}</td></tr>`;
}

function areaTitle(title: string): string {
  return `<tr><td style="padding:16px 4px 8px;${font(17, 22, 600, COLOR.label, 'letter-spacing:-0.01em;')}">${escapeHtml(title)}</td></tr>`;
}

function card(inner: string): string {
  return (
    `<tr><td style="padding:0;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:${COLOR.card};border-radius:24px;border-collapse:separate;">` +
    `${inner}</table></td></tr>`
  );
}

function dot(rag: Rag): string {
  return (
    `<div title="${RAG_LABEL[rag]}" style="width:12px;height:12px;border-radius:6px;background-color:${RAG_DOT[rag]};` +
    `margin-top:5px;font-size:0;line-height:0;">&nbsp;</div>`
  );
}

/** 'due' is the due date for a to-do, or the "To maintain" marker for a state. */
type MetaPart = 'area' | 'who' | 'due';

function itemRow(row: DigestRow, first: boolean, parts: MetaPart[], showNote: boolean): string {
  const pad = first ? 14 : 0;
  const sep = first ? '' : `border-top:1px solid ${COLOR.separator};`;
  const meta: string[] = [];
  for (const part of parts) {
    if (part === 'area' && row.area) meta.push(escapeHtml(row.area));
    if (part === 'who') meta.push(escapeHtml(row.who));
    if (part === 'due' && row.maintain) meta.push(`<span style="font-weight:600;">${MAINTAIN_LABEL}</span>`);
    if (part === 'due' && row.due) {
      meta.push(
        row.due.missed
          ? `<span style="color:${COLOR.missed};font-weight:600;">${escapeHtml(row.due.text)}</span>`
          : `<span style="font-weight:600;">${escapeHtml(row.due.text)}</span>`,
      );
    }
  }
  const note =
    showNote && row.note ? `<div style="${font(15, 20, 400, COLOR.secondary, 'padding-top:2px;')}">${escapeHtml(row.note)}</div>` : '';
  const metaLine = meta.length
    ? `<div style="${font(13, 18, 400, COLOR.secondary, 'padding-top:4px;')}">${meta.join(' · ')}</div>`
    : '';
  return (
    `<tr>` +
    `<td width="26" valign="top" style="width:26px;padding:${first ? 14 : 12}px 0 0 16px;">${dot(row.rag)}</td>` +
    `<td valign="top" style="padding:${pad}px 16px 12px 0;">` +
    `<div style="${sep}${first ? '' : 'padding-top:12px;'}">` +
    `<div style="${font(17, 22, 400, COLOR.label, 'letter-spacing:-0.01em;')}">${escapeHtml(row.title)}</div>` +
    `${note}${metaLine}</div></td></tr>`
  );
}

function itemCard(rows: DigestRow[], parts: MetaPart[], showNote: boolean): string {
  return card(rows.map((r, i) => itemRow(r, i === 0, parts, showNote)).join(''));
}

function doneCard(done: Digest['done']): string {
  const rows = done.map((d, i) => {
    const sep = i === 0 ? '' : `border-top:1px solid ${COLOR.separator};`;
    return (
      `<tr><td style="padding:0 16px;"><div style="${sep}padding:12px 0;">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td valign="top">` +
      `<div style="${font(17, 22, 400, COLOR.label, 'letter-spacing:-0.01em;')}">${escapeHtml(d.who)}</div>` +
      `<div style="${font(13, 18, 400, COLOR.secondary, 'padding-top:2px;')}">${escapeHtml(d.titles.join(', '))}</div>` +
      `</td>` +
      `<td valign="top" align="right" style="padding-left:12px;font-family:${ROUNDED};font-size:22px;line-height:26px;font-weight:700;color:${COLOR.label};">${d.count}</td>` +
      `</tr></table></div></td></tr>`
    );
  });
  return card(rows.join(''));
}

function messageCard(text: string): string {
  return card(`<tr><td style="padding:16px;${font(17, 22, 400, COLOR.label)}">${escapeHtml(text)}</td></tr>`);
}

function preheader(d: Digest): string {
  if (d.missed.length) return `Missed: ${d.missed.map((r) => r.title).join(', ')}`;
  if (d.dueSoon.length) return `Due soon: ${d.dueSoon.map((r) => r.title).join(', ')}`;
  return d.nothingOpen ? 'Nothing is open right now.' : 'Nothing due in the next 7 days.';
}

export const NOTHING_OPEN = 'Nothing is open right now. Enjoy your week.';

function renderHtml(d: Digest, subject: string, appUrl: string, weekday: string): string {
  const body: string[] = [];
  body.push(
    `<tr><td style="padding:8px 4px 0;${font(13, 18, 600, COLOR.secondary, 'letter-spacing:0.02em;')}">home.os weekly</td></tr>`,
    `<tr><td style="padding:2px 4px 0;${font(30, 36, 700, COLOR.label, 'letter-spacing:-0.02em;')}">${escapeHtml(d.place)}</td></tr>`,
    `<tr><td style="padding:2px 4px 0;${font(15, 20, 400, COLOR.secondary)}">Week of ${escapeHtml(d.todayLabel)}</td></tr>`,
  );

  if (d.nothingOpen) {
    body.push(`<tr><td style="height:20px;line-height:20px;font-size:0;">&nbsp;</td></tr>`, messageCard(NOTHING_OPEN));
  }
  if (d.missed.length) body.push(sectionTitle('Missed'), itemCard(d.missed, ['area', 'who', 'due'], true));
  if (d.dueSoon.length) {
    body.push(sectionTitle('Due in the next 7 days'), itemCard(d.dueSoon, ['area', 'who', 'due'], true));
  }
  if (d.others.length) {
    body.push(sectionTitle(d.missed.length || d.dueSoon.length ? 'Everything else' : 'Everything open'));
    for (const group of d.others) body.push(areaTitle(group.area), itemCard(group.rows, ['who', 'due'], true));
  }
  if (d.unassigned.length) body.push(sectionTitle('Unassigned'), itemCard(d.unassigned, ['area', 'due'], false));
  if (d.done.length) body.push(sectionTitle('Done this week'), doneCard(d.done));

  body.push(
    `<tr><td align="center" style="padding:32px 0 8px;">` +
      `<a href="${safeHref(appUrl)}" style="display:inline-block;background-color:${COLOR.tint};border-radius:14px;padding:14px 32px;` +
      `${font(17, 22, 600, '#FFFFFF', 'text-decoration:none;letter-spacing:-0.01em;')}">Open home.os</a>` +
      `</td></tr>`,
    `<tr><td align="center" style="padding:16px 8px 0;${font(13, 18, 400, COLOR.secondary)}">` +
      `You get this email every ${escapeHtml(weekday)}. Turn it off in home.os under Profile.</td></tr>`,
  );

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    `<title>${escapeHtml(subject)}</title>`,
    '</head>',
    `<body style="margin:0;padding:0;background-color:${COLOR.page};-webkit-text-size-adjust:100%;">`,
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader(d))}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:${COLOR.page};">`,
    `<tr><td align="center" style="padding:24px 16px 40px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">`,
    body.join('\n'),
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');
}

// ── Plain text ──────────────────────────────────────────────────────────────

function textRow(row: DigestRow, parts: MetaPart[], showNote: boolean): string[] {
  const meta: string[] = [];
  for (const part of parts) {
    if (part === 'area' && row.area) meta.push(row.area);
    if (part === 'who') meta.push(row.who);
    if (part === 'due' && row.maintain) meta.push(MAINTAIN_LABEL);
    if (part === 'due' && row.due) meta.push(row.due.text);
  }
  const lines = [`* [${RAG_LABEL[row.rag]}] ${row.title}`];
  if (showNote && row.note) lines.push(`  ${row.note}`);
  if (meta.length) lines.push(`  ${meta.join(' · ')}`);
  return lines;
}

function renderText(d: Digest, subject: string, appUrl: string, weekday: string): string {
  const out: string[] = [subject, `Week of ${d.todayLabel}`];
  const section = (title: string) => out.push('', title.toUpperCase());
  if (d.nothingOpen) out.push('', NOTHING_OPEN);
  if (d.missed.length) {
    section('Missed');
    for (const r of d.missed) out.push(...textRow(r, ['area', 'who', 'due'], true));
  }
  if (d.dueSoon.length) {
    section('Due in the next 7 days');
    for (const r of d.dueSoon) out.push(...textRow(r, ['area', 'who', 'due'], true));
  }
  if (d.others.length) {
    section(d.missed.length || d.dueSoon.length ? 'Everything else' : 'Everything open');
    d.others.forEach((group, i) => {
      if (i > 0) out.push('');
      out.push(group.area);
      for (const r of group.rows) out.push(...textRow(r, ['who', 'due'], true));
    });
  }
  if (d.unassigned.length) {
    section('Unassigned');
    for (const r of d.unassigned) out.push(...textRow(r, ['area', 'due'], false));
  }
  if (d.done.length) {
    section('Done this week');
    for (const p of d.done) out.push(`* ${p.who}: ${p.count} (${p.titles.join(', ')})`);
  }
  out.push('', `Open home.os: ${appUrl}`, '', `You get this email every ${weekday}. Turn it off in home.os under Profile.`);
  return out.join('\n') + '\n';
}

/** Subject, HTML and plain text of the weekly email for one household. */
export function renderWeeklyEmail(input: WeeklyEmailInput): RenderedEmail {
  const digest = buildDigest(input);
  const subject = weeklySubject(input.household);
  const weekday = WEEKDAY_NAMES[input.household.weekly_email_day] ?? 'week';
  return {
    subject,
    html: renderHtml(digest, subject, input.appUrl, weekday),
    text: renderText(digest, subject, input.appUrl, weekday),
  };
}
