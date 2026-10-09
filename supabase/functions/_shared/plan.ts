// What the scheduler should send right now. Pure: the Edge Function loads the rows, calls
// planNotifications(), then claims each message in notifications_log before sending it, so
// running every 15 minutes sends each reminder, missed alert and weekly email once.
//
// Rules (docs/ARCHITECTURE.md "Edge Function scheduler"), all in the household's time zone:
// - Pushes go out at or after 08:00 (SEND_HOUR), only to members with push_enabled.
// - Reminder: an open item whose due date minus its Notify offset is today. To the assignee,
//   or to every member when unassigned.
// - Missed: an open item due between today - 3 and today - 1 (so "the morning after", with
//   two more days to catch up if a run was missed). To the assignee and the owner(s).
// - Weekly email: on weekly_email_day at or after weekly_email_time, to every member with
//   weekly_email on and an email address.

import { addDays, formatDay, minutesOfDay, zonedParts, type ISODate } from './dates.ts';
import { renderWeeklyEmail } from './email.ts';
import type { AreaRow, CompletionRow, HouseholdRow, ItemRow, MemberRow, Notify } from './types.ts';

/** Hour (household time) from which reminders and missed alerts go out. */
export const SEND_HOUR = 8;

/** Days before the due date that a reminder goes out. */
export const NOTIFY_DAYS_BEFORE: Record<Exclude<Notify, 'none'>, number> = {
  same_day: 0,
  day_before: 1,
  week_before: 7,
};

/** A missed alert can go out until this many days after the due date. */
export const MISSED_WINDOW_DAYS = 3;

const REMINDER_TITLE: Record<Exclude<Notify, 'none'>, string> = {
  same_day: 'Due today',
  day_before: 'Due tomorrow',
  week_before: 'Due in a week',
};

/** Keeps the encrypted push payload far below the 4 KB Web Push limit. */
const PUSH_TITLE_MAX = 120;
const PUSH_AREA_MAX = 60;

export interface PlanInput {
  households: HouseholdRow[];
  members: MemberRow[];
  areas: AreaRow[];
  /** Open items (anything else is ignored). */
  items: ItemRow[];
  /** Recent completions, for "done this week" in the weekly email. */
  completions: CompletionRow[];
  now: Date;
  /** The app's URL: opened by a tapped notification and by the email's button. */
  appUrl: string;
}

/** What the service worker shows (public/sw.js). */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface PushMessage {
  kind: 'reminder' | 'missed';
  householdId: string;
  itemId: string;
  memberId: string;
  /** notifications_log.ref_date: the item's due date. */
  refDate: ISODate;
  payload: PushPayload;
}

export interface WeeklyEmail {
  householdId: string;
  memberId: string;
  /** notifications_log.ref_date: today in the household's time zone. */
  refDate: ISODate;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Plan {
  pushes: PushMessage[];
  emails: WeeklyEmail[];
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function byJoinOrder(a: MemberRow, b: MemberRow): number {
  const ac = a.created_at ?? '';
  const bc = b.created_at ?? '';
  return ac < bc ? -1 : ac > bc ? 1 : 0;
}

function byDueDate(a: ItemRow, b: ItemRow): number {
  const ad = a.due_date ?? '9999-12-31';
  const bd = b.due_date ?? '9999-12-31';
  if (ad !== bd) return ad < bd ? -1 : 1;
  const ac = a.created_at ?? '';
  const bc = b.created_at ?? '';
  if (ac !== bc) return ac < bc ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function planNotifications(input: PlanInput): Plan {
  const { now, appUrl } = input;
  const pushes: PushMessage[] = [];
  const emails: WeeklyEmail[] = [];

  for (const household of input.households) {
    const local = zonedParts(now, household.timezone);
    const today = local.date;
    const members = input.members.filter((m) => m.household_id === household.id).sort(byJoinOrder);
    const memberById = new Map(members.map((m) => [m.id, m]));
    const areas = input.areas.filter((a) => a.household_id === household.id);
    const areaName = new Map(areas.map((a) => [a.id, a.name]));
    const items = input.items
      .filter((it) => it.household_id === household.id && it.status === 'open')
      .sort(byDueDate);

    // ── Pushes ──
    if (local.hour >= SEND_HOUR) {
      const pushTo = (ids: Iterable<string>) => {
        const out: MemberRow[] = [];
        const seen = new Set<string>();
        for (const id of ids) {
          const m = memberById.get(id);
          if (m && m.push_enabled && !seen.has(id)) {
            seen.add(id);
            out.push(m);
          }
        }
        return out;
      };
      const assigneeOf = (it: ItemRow) => (it.assignee_id && memberById.has(it.assignee_id) ? it.assignee_id : null);
      const owners = members.filter((m) => m.role === 'owner').map((m) => m.id);
      const missedFrom = addDays(today, -MISSED_WINDOW_DAYS);

      for (const it of items) {
        if (!it.due_date) continue;
        const title = clip(it.title, PUSH_TITLE_MAX);
        const area = clip(areaName.get(it.area_id) ?? '', PUSH_AREA_MAX);
        const withArea = (text: string) => (area ? `${text} · ${area}` : text);
        const assignee = assigneeOf(it);

        if (it.notify !== 'none' && addDays(it.due_date, -NOTIFY_DAYS_BEFORE[it.notify]) === today) {
          const recipients = pushTo(assignee ? [assignee] : members.map((m) => m.id));
          for (const m of recipients) {
            pushes.push({
              kind: 'reminder',
              householdId: household.id,
              itemId: it.id,
              memberId: m.id,
              refDate: it.due_date,
              payload: {
                title: REMINDER_TITLE[it.notify],
                body: withArea(title),
                url: appUrl,
                tag: `reminder:${it.id}`,
              },
            });
          }
        }

        if (it.due_date >= missedFrom && it.due_date < today) {
          const recipients = pushTo(assignee ? [assignee, ...owners] : owners);
          for (const m of recipients) {
            pushes.push({
              kind: 'missed',
              householdId: household.id,
              itemId: it.id,
              memberId: m.id,
              refDate: it.due_date,
              payload: {
                title: `Missed: ${title}`,
                body: withArea(`Was due ${formatDay(it.due_date, today)}`),
                url: appUrl,
                tag: `missed:${it.id}`,
              },
            });
          }
        }
      }
    }

    // ── Weekly email ──
    const nowMinutes = local.hour * 60 + local.minute;
    if (local.weekday === household.weekly_email_day && nowMinutes >= minutesOfDay(household.weekly_email_time)) {
      const recipients = members.filter((m) => m.weekly_email && m.email.trim() !== '');
      if (recipients.length) {
        const rendered = renderWeeklyEmail({
          household,
          members,
          areas,
          items,
          completions: input.completions.filter((c) => c.household_id === household.id),
          today,
          now,
          appUrl,
        });
        for (const m of recipients) {
          emails.push({ householdId: household.id, memberId: m.id, refDate: today, to: m.email.trim(), ...rendered });
        }
      }
    }
  }

  return { pushes, emails };
}
