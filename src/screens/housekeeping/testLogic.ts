// TEST ONLY: stand-ins for the calendar, price, checklist and byline functions of
// src/lib/logic/housekeeping.ts, written from the specs in its doc comments, so the
// Housekeeping screen's tests (HousekeepingScreen.test.tsx) run while that module is being
// built in parallel. Once it is, the tests can drop the vi.mock and use it directly.
// Nothing in the app imports this file.

import { formatDay, parseISODate } from '../../lib/logic/dates';
import { senderOf, stampLabel } from '../../lib/logic/chat';
import { HOUSEKEEPING_PRICE_MAX_PENCE } from '../../lib/constants';
import type {
  HousekeepingData,
  HousekeepingNote,
  HousekeepingTickTarget,
  HousekeepingVisit,
  HousekeepingVisitTask,
  ISODate,
  Member,
} from '../../lib/types';
import type { ChecklistRow, MonthTotals, PriceParse, YearMonth } from '../../lib/logic/housekeeping';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number) => String(n).padStart(2, '0');

export const monthOf = (date: ISODate): YearMonth => date.slice(0, 7);

export function shiftMonth(month: YearMonth, n: number): YearMonth {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((((total % 12) + 12) % 12) + 1)}`;
}

export function monthTitle(month: YearMonth): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function monthGrid(month: YearMonth): (ISODate | null)[][] {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (ISODate | null)[] = [...Array<null>(lead).fill(null)];
  for (let d = 1; d <= days; d++) cells.push(`${month}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (ISODate | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export const canHaveVisit = (date: ISODate, today: ISODate): boolean => date <= today;

export function longDay(date: ISODate, today: ISODate): string {
  const { y, m, d } = parseISODate(date);
  const base = `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
  return parseISODate(today).y === y ? base : `${base} ${y}`;
}

export const visitOn = (visits: HousekeepingVisit[], date: ISODate) => visits.find((v) => v.visit_date === date);

export const visitDays = (visits: HousekeepingVisit[], month: YearMonth) =>
  new Set(visits.filter((v) => monthOf(v.visit_date) === month).map((v) => v.visit_date));

export function doneCount(visit: HousekeepingVisit) {
  return {
    done: visit.tasks.filter((t) => t.done).length,
    total: visit.tasks.length,
  };
}

export function formatPrice(pence: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(pence / 100);
}

export const priceInputValue = (pence: number | null): string =>
  pence === null ? '' : `${Math.floor(pence / 100)}.${pad(pence % 100)}`;

export function calendarDayLabel(date: ISODate, today: ISODate, visit: HousekeepingVisit | undefined): string {
  let label = longDay(date, today);
  if (date === today) label += ', today';
  if (visit) {
    const { done, total } = doneCount(visit);
    label += `, visit, ${done} of ${total} done`;
    if (visit.price_pence !== null) label += `, ${formatPrice(visit.price_pence)}`;
  }
  return label;
}

export function defaultSelectedDay(visits: HousekeepingVisit[], today: ISODate): ISODate | null {
  const days = visits
    .map((v) => v.visit_date)
    .filter((d) => d < today && monthOf(d) === monthOf(today))
    .sort();
  return days.at(-1) ?? null;
}

export function monthTotals(visits: HousekeepingVisit[], month: YearMonth): MonthTotals {
  const inMonth = visits.filter((v) => monthOf(v.visit_date) === month);
  const priced = inMonth.filter((v) => v.price_pence !== null);
  return {
    visits: inMonth.length,
    pence: priced.reduce((n, v) => n + (v.price_pence ?? 0), 0),
    priced: priced.length,
  };
}

export function monthSummary(totals: MonthTotals): string {
  if (!totals.visits) return 'No visits';
  const count = `${totals.visits} ${totals.visits === 1 ? 'visit' : 'visits'}`;
  return totals.priced ? `${count} · ${formatPrice(totals.pence)}` : count;
}

export function housekeepingSubtitle(visits: HousekeepingVisit[], today: ISODate): string {
  const past = visits.map((v) => v.visit_date).filter((d) => d <= today);
  if (past.includes(today)) return "Today's visit";
  const latest = past.sort().at(-1);
  return latest ? `Last visit ${formatDay(latest, today)}` : 'Weekly';
}

export function parsePrice(text: string): PriceParse {
  let t = text.trim();
  if (!t) return { ok: true, pence: null };
  if (t.startsWith('£')) t = t.slice(1).trim();
  if (!t.includes('.') && /^\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d{0,2})?$/.test(t)) t = t.replace(/,/g, '');
  const match = /^(\d*)(?:\.(\d{1,2}))?$/.exec(t);
  if (!match || (!match[1] && !match[2])) return { ok: false };
  const pence = Number(match[1] || '0') * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return pence > HOUSEKEEPING_PRICE_MAX_PENCE ? { ok: false } : { ok: true, pence };
}

export function matchesTarget(row: HousekeepingVisitTask, target: HousekeepingTickTarget): boolean {
  return 'taskId' in target ? row.task_id === target.taskId : row.id === target.visitTaskId;
}

export function checklistFor(housekeeping: HousekeepingData, date: ISODate): ChecklistRow[] {
  const visit = visitOn(housekeeping.visits, date);
  if (visit) {
    return visit.tasks.map((t) => ({
      key: t.task_id ? `task:${t.task_id}` : `row:${t.id}`,
      title: t.title,
      done: t.done,
      doneBy: t.done_by,
      doneAt: t.done_at,
      target: t.task_id ? { taskId: t.task_id } : { visitTaskId: t.id },
    }));
  }
  return housekeeping.tasks.map((t) => ({
    key: `task:${t.id}`,
    title: t.title,
    done: false,
    doneBy: null,
    doneAt: null,
    target: { taskId: t.id },
  }));
}

function who(memberId: string | null, members: Member[]): string {
  const s = senderOf(memberId, members);
  return `${s.emoji} ${s.name}`;
}

export function visitByline(visit: HousekeepingVisit, members: Member[], timeZone: string, now: Date): string {
  const made = stampLabel(visit.created_at, timeZone, now);
  let line = `Recorded by ${who(visit.created_by, members)} · ${made.day} ${made.time}`;
  if (new Date(visit.updated_at).getTime() - new Date(visit.created_at).getTime() >= 60_000) {
    const changed = stampLabel(visit.updated_at, timeZone, now);
    line += ` · Updated by ${who(visit.updated_by, members)} · ${changed.day} ${changed.time}`;
  }
  return line;
}

export function noteByline(note: HousekeepingNote, members: Member[], timeZone: string, now: Date): string | null {
  if (!note.body || !note.updated_at) return null;
  const at = stampLabel(note.updated_at, timeZone, now);
  return `${who(note.updated_by, members)} · ${at.day} ${at.time}`;
}

export function doneByline(
  row: HousekeepingVisitTask,
  visitDate: ISODate,
  members: Member[],
  timeZone: string,
  now: Date,
): string | null {
  if (!row.done || !row.done_at) return null;
  const { time } = stampLabel(row.done_at, timeZone, now);
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(row.done_at));
  return `${who(row.done_by, members)} · ${day === visitDate ? time : `${formatDay(day, visitDate)} ${time}`}`;
}
