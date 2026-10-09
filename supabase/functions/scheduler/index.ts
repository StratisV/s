// Edge Function "scheduler": push reminders, missed alerts and the weekly email.
//
// pg_cron calls it every 15 minutes (supabase/cron.sql) with
// `Authorization: Bearer <CRON_SECRET>`; verify_jwt is off for it in supabase/config.toml.
// The work itself is in ../_shared/scheduler.ts; this file wires it to the database.
//
//   POST /functions/v1/scheduler          run: claim and send what is due
//   POST /functions/v1/scheduler?dry=1    only report what would be sent (nothing is claimed);
//                                         add &now=2026-10-12T08:30:00Z to plan another time
//
// Secrets (npx supabase secrets set …): CRON_SECRET, APP_URL, VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT, RESEND_API_KEY, EMAIL_FROM. Without the VAPID or Resend
// ones that channel is skipped and the response says so. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY come from the platform. Optional RESEND_API_URL replaces
// https://api.resend.com/emails (only for a local fake while testing).
//
// Pushes only go to the browser push services (DEFAULT_PUSH_HOSTS in ../_shared/webpush.ts;
// a stored endpoint anywhere else is deleted), every request has a 10 s limit, and a run
// stops starting new sends after 90 s so it always answers before pg_net gives up.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { isAuthorized } from '../_shared/auth.ts';
import {
  runScheduler,
  type LogClaim,
  type SchedulerData,
  type SchedulerStore,
} from '../_shared/scheduler.ts';
import type { AreaRow, CompletionRow, HouseholdRow, ItemRow, MemberRow, PushSubRow } from '../_shared/types.ts';

const PAGE = 1000;
const IN_CHUNK = 100;

interface PageResult {
  data: unknown[] | null;
  error: { message: string } | null;
}

function env(name: string): string {
  return (Deno.env.get(name) ?? '').trim();
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Reads every row, a page at a time (PostgREST caps each response at max_rows). */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return rows;
    rows.push(...(data as T[]));
    from += data.length;
  }
}

function supabaseStore(url: string, serviceRoleKey: string): SchedulerStore {
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    async load(since: Date): Promise<SchedulerData> {
      const [households, members, areas, items, completions] = await Promise.all([
        readAll<HouseholdRow>((a, b) =>
          db
            .from('households')
            .select('id,name,address,timezone,weekly_email_day,weekly_email_time')
            .order('id')
            .range(a, b),
        ),
        readAll<MemberRow>((a, b) =>
          db
            .from('members')
            .select('id,household_id,name,email,emoji,role,weekly_email,push_enabled,created_at')
            .order('id')
            .range(a, b),
        ),
        readAll<AreaRow>((a, b) =>
          db.from('areas').select('id,household_id,name,position').order('id').range(a, b),
        ),
        // Open items with the note already cut to what the email shows (a view in
        // supabase/migrations/20261009000100_hardening.sql), so a run never downloads full notes.
        readAll<ItemRow>((a, b) =>
          db
            .from('scheduler_open_items')
            .select('id,household_id,area_id,title,note,rag,due_date,assignee_id,notify,status,created_at')
            .order('id')
            .range(a, b),
        ),
        readAll<CompletionRow>((a, b) =>
          db
            .from('completions')
            .select('id,household_id,item_id,item_title,credited_to,completed_at')
            .gte('completed_at', since.toISOString())
            .order('id')
            .range(a, b),
        ),
      ]);
      return { households, members, areas, items, completions };
    },

    async pushSubs(memberIds: string[]): Promise<PushSubRow[]> {
      const rows: PushSubRow[] = [];
      for (let i = 0; i < memberIds.length; i += IN_CHUNK) {
        const chunk = memberIds.slice(i, i + IN_CHUNK);
        rows.push(
          ...(await readAll<PushSubRow>((a, b) =>
            db
              .from('push_subs')
              .select('id,member_id,endpoint,p256dh,auth')
              .in('member_id', chunk)
              .order('id')
              .range(a, b),
          )),
        );
      }
      return rows;
    },

    async claim(row: LogClaim): Promise<string | null> {
      // insert … on conflict (kind, member_id, item_id, ref_date) do nothing returning id:
      // an empty result means another run already claimed (and sent) it.
      const { data, error } = await db
        .from('notifications_log')
        .upsert(row, { onConflict: 'kind,member_id,item_id,ref_date', ignoreDuplicates: true })
        .select('id');
      if (error) throw new Error(error.message);
      const first = (data as { id: string }[] | null)?.[0];
      return first?.id ?? null;
    },

    async unclaim(id: string): Promise<void> {
      const { error } = await db.from('notifications_log').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },

    async deletePushSub(id: string): Promise<void> {
      const { error } = await db.from('push_subs').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json(405, { ok: false, error: 'method_not_allowed' });
  }

  const secret = env('CRON_SECRET');
  if (!secret) console.error('scheduler: CRON_SECRET is not set, refusing every request');
  if (!isAuthorized(req.headers.get('Authorization'), secret)) {
    return json(401, { ok: false, error: 'unauthorized' });
  }

  const supabaseUrl = env('SUPABASE_URL');
  const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { ok: false, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set' });
  }

  const params = new URL(req.url).searchParams;
  const dry = params.get('dry') === '1';
  let now = new Date();
  // Planning for another moment is only allowed in a dry run, so it can never send.
  if (dry && params.get('now')) {
    const at = new Date(params.get('now') as string);
    if (Number.isNaN(at.getTime())) return json(400, { ok: false, error: 'invalid now' });
    now = at;
  }

  const vapidPublicKey = env('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = env('VAPID_PRIVATE_KEY');
  const vapidSubject = env('VAPID_SUBJECT');
  const resendKey = env('RESEND_API_KEY');
  const emailFrom = env('EMAIL_FROM');

  try {
    const summary = await runScheduler(
      supabaseStore(supabaseUrl, serviceRoleKey),
      {
        appUrl: env('APP_URL'),
        vapid:
          vapidPublicKey && vapidPrivateKey && vapidSubject
            ? { publicKey: vapidPublicKey, privateKey: vapidPrivateKey, subject: vapidSubject }
            : null,
        resend: resendKey && emailFrom ? { apiKey: resendKey, from: emailFrom, url: env('RESEND_API_URL') } : null,
      },
      { now, dry },
    );
    if (!dry) {
      const { push, email, errors } = summary;
      console.log(
        `scheduler: push sent ${push.sent}/${push.planned} (already ${push.alreadySent}, no device ${push.noDevice}, failed ${push.failed}, deferred ${push.deferred})` +
          `, email sent ${email.sent}/${email.planned} (already ${email.alreadySent}, failed ${email.failed}, deferred ${email.deferred})` +
          (summary.timedOut ? '; reached the deadline, the rest goes out on the next run' : '') +
          (push.skipped ? `; push skipped: ${push.skipped}` : '') +
          (email.skipped ? `; email skipped: ${email.skipped}` : ''),
      );
      for (const e of errors) console.warn(`scheduler: ${e}`);
    }
    return json(200, summary);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('scheduler failed:', error);
    return json(500, { ok: false, error });
  }
});
