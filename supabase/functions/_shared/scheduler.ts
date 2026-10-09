// One scheduler run: load, plan, then claim and send each message. The database access is
// behind SchedulerStore so this runs (and is tested) without Supabase; the Edge Function in
// ../scheduler/index.ts supplies the supabase-js implementation.
//
// Idempotency: every message is claimed in notifications_log first (insert … on conflict do
// nothing). Only a run that claims a message sends it; a failed send deletes the claim so the
// next run (15 minutes later) tries again. A member with several devices gets one push per
// device but has one log row per message.
//
// Time: pushes and weekly emails go out side by side, so neither channel waits for the
// other. Every request has a time limit, and the whole run has a deadline: once it passes,
// nothing new is started, requests still in flight are aborted (their claims released), and
// the run returns its summary. Whatever was left goes out on a later run.

import { REQUEST_TIMEOUT_MS } from './http.ts';
import { planNotifications, type Plan, type PushMessage, type WeeklyEmail } from './plan.ts';
import { sendEmail as resendEmail, type ResendConfig } from './resend.ts';
import type { AreaRow, CompletionRow, HouseholdRow, ItemRow, MemberRow, PushSubRow } from './types.ts';
import { sendWebPush, type VapidKeys } from './webpush.ts';

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface SchedulerData {
  households: HouseholdRow[];
  members: MemberRow[];
  areas: AreaRow[];
  /** Open items. */
  items: ItemRow[];
  /** Completions since `since`. */
  completions: CompletionRow[];
}

export interface LogClaim {
  household_id: string;
  item_id: string | null;
  member_id: string;
  kind: 'reminder' | 'missed' | 'weekly';
  ref_date: string;
}

export interface SchedulerStore {
  load(since: Date): Promise<SchedulerData>;
  pushSubs(memberIds: string[]): Promise<PushSubRow[]>;
  /** Inserts the log row unless it exists. Returns its id when this call inserted it. */
  claim(row: LogClaim): Promise<string | null>;
  unclaim(id: string): Promise<void>;
  deletePushSub(id: string): Promise<void>;
}

export interface SchedulerConfig {
  /** APP_URL. Without it pushes open "/" and the weekly email is skipped. */
  appUrl: string;
  /** null when VAPID_* is not set: pushes are skipped. */
  vapid: VapidKeys | null;
  /** null when RESEND_API_KEY / EMAIL_FROM is not set: emails are skipped. */
  resend: ResendConfig | null;
  fetch?: FetchLike;
  /** Pushes sent in parallel. */
  concurrency?: number;
  /** Pause between two weekly emails (Resend's default limit is 2 requests per second). */
  emailIntervalMs?: number;
  /** For tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Push service hosts that may be contacted. Default DEFAULT_PUSH_HOSTS (webpush.ts). */
  pushHosts?: readonly string[];
  /** Time limit for each push or email request. Default 10 s. */
  requestTimeoutMs?: number;
  /**
   * Time budget for the run, counted from its start. Default 90 s: pg_net waits 120 s for
   * the answer (supabase/cron.sql) and an Edge Function is stopped after 150 s.
   */
  deadlineMs?: number;
  /** After the deadline, how long sends that were aborted get to wind down. Default 5 s. */
  graceMs?: number;
}

export interface ChannelSummary {
  enabled: boolean;
  /** Why the channel did not run. */
  skipped?: string;
  planned: number;
  sent: number;
  alreadySent: number;
  failed: number;
  /** Not started before the deadline (not claimed, so a later run sends them). */
  deferred: number;
}

export interface SchedulerSummary {
  ok: true;
  dry: boolean;
  now: string;
  households: number;
  /** The run reached its deadline before everything was sent. */
  timedOut: boolean;
  push: ChannelSummary & {
    /** Planned pushes for members without a stored subscription (not claimed). */
    noDevice: number;
    devices: { sent: number; failed: number; removed: number };
  };
  email: ChannelSummary;
  errors: string[];
  /** Only for a dry run. */
  plan?: Plan;
}

/** Completions are loaded from this far back ("done this week" plus a day of slack). */
export const COMPLETIONS_LOOKBACK_DAYS = 8;
/** Default time budget of one run (see SchedulerConfig.deadlineMs). */
export const RUN_DEADLINE_MS = 90_000;
const DEADLINE_GRACE_MS = 5_000;
const MAX_ERRORS = 20;
/** Extra attempts when Resend answers 429 (too many requests). */
const EMAIL_RATE_RETRIES = 2;

/** Runs `fn` over `items`, `limit` at a time, starting each item only while `canStart()`. */
async function eachLimit<T>(
  items: T[],
  limit: number,
  canStart: () => boolean,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length && canStart()) {
      const item = items[next++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runScheduler(
  store: SchedulerStore,
  config: SchedulerConfig,
  options: { now: Date; dry?: boolean },
): Promise<SchedulerSummary> {
  const { now } = options;
  const dry = options.dry === true;
  const fetchImpl = config.fetch ?? fetch;
  const concurrency = config.concurrency ?? 6;
  const emailGap = config.emailIntervalMs ?? 600;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = config.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const errors: string[] = [];
  const fail = (text: string) => {
    if (errors.length < MAX_ERRORS) errors.push(text);
  };

  // The clock starts now, so loading counts against the budget too.
  const deadline = new AbortController();
  const timers: ReturnType<typeof setTimeout>[] = [];
  timers.push(
    setTimeout(() => deadline.abort(new Error('the run reached its deadline')), config.deadlineMs ?? RUN_DEADLINE_MS),
  );
  const inTime = () => !deadline.signal.aborted;

  try {
    const since = new Date(now.getTime() - COMPLETIONS_LOOKBACK_DAYS * 86_400_000);
    const data = await store.load(since);
    const plan = planNotifications({ ...data, now, appUrl: config.appUrl || '/' });

    const pushSkip = config.vapid ? undefined : 'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY or VAPID_SUBJECT is not set';
    const emailSkip = !config.resend
      ? 'RESEND_API_KEY or EMAIL_FROM is not set'
      : !config.appUrl
        ? 'APP_URL is not set'
        : undefined;

    const summary: SchedulerSummary = {
      ok: true,
      dry,
      now: now.toISOString(),
      households: data.households.length,
      timedOut: false,
      push: {
        enabled: !pushSkip,
        ...(pushSkip ? { skipped: pushSkip } : {}),
        planned: plan.pushes.length,
        sent: 0,
        alreadySent: 0,
        failed: 0,
        deferred: 0,
        noDevice: 0,
        devices: { sent: 0, failed: 0, removed: 0 },
      },
      email: {
        enabled: !emailSkip,
        ...(emailSkip ? { skipped: emailSkip } : {}),
        planned: plan.emails.length,
        sent: 0,
        alreadySent: 0,
        failed: 0,
        deferred: 0,
      },
      errors,
    };

    if (dry) return { ...summary, plan };

    const unclaim = async (id: string) => {
      try {
        await store.unclaim(id);
      } catch (err) {
        fail(`could not release claim ${id}: ${message(err)}`);
      }
    };

    // Messages that were started but have not finished, so the summary can name any that
    // are still stuck when the run returns.
    const pushesInFlight = new Set<PushMessage>();
    const emailsInFlight = new Set<WeeklyEmail>();
    let pushesQueued = 0;
    let pushesStarted = 0;

    // ── Pushes ──
    const sendPushes = async () => {
      if (!config.vapid || plan.pushes.length === 0) return;
      const vapid = config.vapid;
      const memberIds = [...new Set(plan.pushes.map((p) => p.memberId))];
      const subsByMember = new Map<string, PushSubRow[]>();
      for (const sub of await store.pushSubs(memberIds)) {
        const list = subsByMember.get(sub.member_id) ?? [];
        list.push(sub);
        subsByMember.set(sub.member_id, list);
      }
      const removed = new Set<string>();

      const sendOne = async (msg: PushMessage) => {
        const subs = (subsByMember.get(msg.memberId) ?? []).filter((s) => !removed.has(s.id));
        if (subs.length === 0) {
          summary.push.noDevice++;
          return;
        }
        let claimId: string | null;
        try {
          claimId = await store.claim({
            household_id: msg.householdId,
            item_id: msg.itemId,
            member_id: msg.memberId,
            kind: msg.kind,
            ref_date: msg.refDate,
          });
        } catch (err) {
          summary.push.failed++;
          fail(`claim ${msg.kind} ${msg.itemId} for ${msg.memberId}: ${message(err)}`);
          return;
        }
        if (!claimId) {
          summary.push.alreadySent++;
          return;
        }

        const body = JSON.stringify(msg.payload);
        const delivered = await Promise.all(
          subs.map(async (sub) => {
            try {
              const res = await sendWebPush(sub, body, vapid, fetchImpl, {
                now,
                allowedHosts: config.pushHosts,
                timeoutMs,
                signal: deadline.signal,
              });
              if (res.ok) {
                summary.push.devices.sent++;
                return true;
              }
              summary.push.devices.failed++;
              if (res.gone) {
                if (!removed.has(sub.id)) {
                  removed.add(sub.id);
                  summary.push.devices.removed++;
                  // Status 0: refused before sending (not a known push service).
                  if (res.status === 0) fail(`removed push subscription ${sub.id}: ${res.detail ?? 'refused'}`);
                  try {
                    await store.deletePushSub(sub.id);
                  } catch (err) {
                    fail(`could not delete push subscription ${sub.id}: ${message(err)}`);
                  }
                }
              } else {
                fail(`push ${msg.kind} ${msg.itemId} to ${msg.memberId}: HTTP ${res.status}${res.detail ? ` ${res.detail}` : ''}`);
              }
              return false;
            } catch (err) {
              summary.push.devices.failed++;
              fail(`push ${msg.kind} ${msg.itemId} to ${msg.memberId}: ${message(err)}`);
              return false;
            }
          }),
        );

        if (delivered.some(Boolean)) {
          summary.push.sent++;
        } else {
          summary.push.failed++;
          await unclaim(claimId);
        }
      };

      pushesQueued = plan.pushes.length;
      await eachLimit(plan.pushes, concurrency, inTime, async (msg) => {
        pushesStarted++;
        pushesInFlight.add(msg);
        try {
          await sendOne(msg);
        } finally {
          pushesInFlight.delete(msg);
        }
      });
    };

    // ── Weekly emails ──
    // One at a time and spaced out: Resend allows 2 requests per second by default.
    const sendEmails = async () => {
      if (emailSkip || !config.resend || plan.emails.length === 0) return;
      const resend = config.resend;
      const sendOne = (email: WeeklyEmail) =>
        resendEmail(
          { to: email.to, subject: email.subject, html: email.html, text: email.text },
          resend,
          fetchImpl,
          {
            // Resend drops a repeat with the same key, in case a "failed" send actually went out.
            idempotencyKey: `weekly/${email.memberId}/${email.refDate}`,
            timeoutMs,
            signal: deadline.signal,
          },
        );
      let sentBefore = false;
      for (const [index, email] of plan.emails.entries()) {
        if (!inTime()) {
          summary.email.deferred += plan.emails.length - index;
          return;
        }
        emailsInFlight.add(email);
        try {
          let claimId: string | null;
          try {
            claimId = await store.claim({
              household_id: email.householdId,
              item_id: null,
              member_id: email.memberId,
              kind: 'weekly',
              ref_date: email.refDate,
            });
          } catch (err) {
            summary.email.failed++;
            fail(`claim weekly for ${email.memberId}: ${message(err)}`);
            continue;
          }
          if (!claimId) {
            summary.email.alreadySent++;
            continue;
          }
          if (sentBefore) await sleep(emailGap);
          sentBefore = true;
          if (!inTime()) {
            // Out of time while waiting: leave this one and the rest to the next run.
            await unclaim(claimId);
            summary.email.deferred += plan.emails.length - index;
            return;
          }
          try {
            let res = await sendOne(email);
            for (let retry = 1; res.status === 429 && retry <= EMAIL_RATE_RETRIES && inTime(); retry++) {
              await sleep(retry * 1000);
              res = await sendOne(email);
            }
            if (res.ok) {
              summary.email.sent++;
              continue;
            }
            fail(`weekly email to ${email.memberId}: HTTP ${res.status} ${res.error ?? ''}`.trim());
          } catch (err) {
            fail(`weekly email to ${email.memberId}: ${message(err)}`);
          }
          summary.email.failed++;
          await unclaim(claimId);
        } finally {
          emailsInFlight.delete(email);
        }
      }
    };

    // Side by side: a slow push service cannot hold up the weekly email, or the reverse.
    const channel = (name: string, run: () => Promise<void>) =>
      run().catch((err) => {
        fail(`${name}: ${message(err)}`);
      });
    const finished = Promise.all([channel('push', sendPushes), channel('email', sendEmails)]);
    // Sends still in flight at the deadline are aborted and normally finish at once; a send
    // that ignores the abort gets `graceMs` before the run returns without it.
    const outOfTime = new Promise<void>((resolve) => {
      const wait = () => timers.push(setTimeout(resolve, config.graceMs ?? DEADLINE_GRACE_MS));
      if (deadline.signal.aborted) wait();
      else deadline.signal.addEventListener('abort', wait, { once: true });
    });
    await Promise.race([finished, outOfTime]);

    // A copy, so work that is still stuck cannot change the summary after it is returned.
    const result = structuredClone(summary);
    result.timedOut = deadline.signal.aborted;
    result.push.deferred = pushesQueued - pushesStarted;
    for (const msg of pushesInFlight) {
      result.push.failed++;
      if (result.errors.length < MAX_ERRORS) {
        result.errors.push(`push ${msg.kind} ${msg.itemId} to ${msg.memberId}: still running when the run ended`);
      }
    }
    for (const email of emailsInFlight) {
      result.email.failed++;
      if (result.errors.length < MAX_ERRORS) {
        result.errors.push(`weekly email to ${email.memberId}: still running when the run ended`);
      }
    }
    return result;
  } finally {
    for (const t of timers) clearTimeout(t);
  }
}
