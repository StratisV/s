// SupabaseBackend tests.
//
// 1. Offline (always run): request shapes and error mapping against a fake fetch, plus
//    subscribe()/auth wiring against a fake client. No network.
// 2. Live (only with SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY and SUPABASE_TEST_SERVICE_KEY,
//    e.g. a local `supabase start`): three real users exercise the whole Backend interface,
//    RLS and the RPCs. The users and their households are deleted afterwards.
//
//    SUPABASE_TEST_URL=http://127.0.0.1:54321 SUPABASE_TEST_ANON_KEY=... \
//    SUPABASE_TEST_SERVICE_KEY=... npx vitest run src/lib/backend/supabase.integration.test.ts

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { addDays, todayIn } from '../logic/dates';
import { seedItemsFor } from '../logic/items';
import { CHAT_PAGE_SIZE } from '../constants';
import type {
  Area,
  ChatChange,
  ChatPage,
  CreateHouseholdInput,
  HouseholdData,
  ItemDraft,
  PushSubscriptionInput,
} from '../types';
import { instantOf } from '../logic/chat';
import { SupabaseBackend, toAuthUser, toBackendError, toHHMM } from './supabase';
import { BackendError, type BackendErrorCode } from './types';

async function rejectsWith(p: Promise<unknown>, code: BackendErrorCode, message?: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `expected BackendError('${code}')`).toBeInstanceOf(BackendError);
  expect((err as BackendError).code).toBe(code);
  if (message) expect((err as BackendError).message).toMatch(message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Offline
// ─────────────────────────────────────────────────────────────────────────────

const FAKE_URL = 'https://fake.supabase.test';
const FAKE_KEY = 'anon-key';

interface Call {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

type Reply = { status?: number; body?: unknown } | Error;

/** A supabase-js client whose fetch is answered by `reply`; every request is recorded. */
function fakeServer(reply: (call: Call) => Reply = () => ({ body: [] })) {
  const calls: Call[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call: Call = {
      method: (init?.method ?? 'GET').toUpperCase(),
      url: new URL(href),
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const r = reply(call);
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    const text = r.body === undefined || status === 204 ? null : JSON.stringify(r.body);
    return new Response(text, { status, headers: { 'content-type': 'application/json' } });
  };
  const client = createClient(FAKE_URL, FAKE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchImpl },
  });
  const backend = new SupabaseBackend(FAKE_URL, FAKE_KEY, { client });
  const rest = (table: string) => calls.filter((c) => c.url.pathname === `/rest/v1/${table}`);
  return { calls, client, backend, rest };
}

const FAKE_USER = {
  id: '11111111-1111-4111-8111-111111111111',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'ada@example.com',
  app_metadata: { provider: 'google' },
  user_metadata: { full_name: 'Ada Lovelace', avatar_url: 'https://img.example/ada.png' },
  created_at: '2026-10-01T09:00:00Z',
};

function fakeJwt(sub: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp, role: 'authenticated', aud: 'authenticated' })}.sig`;
}

/** Answers /auth/v1/user so setSession() succeeds, and everything else with `rest`. */
function withAuth(rest: (call: Call) => Reply) {
  return (call: Call): Reply => (call.url.pathname === '/auth/v1/user' ? { body: FAKE_USER } : rest(call));
}

async function signInFake(client: SupabaseClient) {
  const { error } = await client.auth.setSession({ access_token: fakeJwt(FAKE_USER.id), refresh_token: 'refresh' });
  expect(error).toBeNull();
}

describe('SupabaseBackend offline: mapping helpers', () => {
  const user = (meta: Record<string, unknown>, email = 'grace.hopper@example.com') =>
    ({ id: 'u1', email, user_metadata: meta, app_metadata: {}, aud: 'authenticated', created_at: '' }) as User;

  it('takes the name from full_name, then name, then the email', () => {
    expect(toAuthUser(user({ full_name: ' Grace Hopper ', name: 'G' })).name).toBe('Grace Hopper');
    expect(toAuthUser(user({ name: 'Grace' })).name).toBe('Grace');
    expect(toAuthUser(user({})).name).toBe('grace.hopper');
    expect(toAuthUser(user({}, '')).name).toBe('');
  });

  it('takes the avatar from avatar_url, then picture', () => {
    const both = user({ avatar_url: 'https://a/1.png', picture: 'https://a/2.png' });
    expect(toAuthUser(both).avatarUrl).toBe('https://a/1.png');
    expect(toAuthUser(user({ picture: 'https://a/2.png' })).avatarUrl).toBe('https://a/2.png');
    expect(toAuthUser(user({}))).toEqual({ id: 'u1', email: 'grace.hopper@example.com', name: 'grace.hopper' });
  });

  it('normalises Postgres time to HH:MM', () => {
    expect(toHHMM('08:00:00')).toBe('08:00');
    expect(toHHMM('19:30')).toBe('19:30');
    expect(toHHMM('7:05:00')).toBe('07:05');
    expect(toHHMM(null)).toBe('08:00');
  });

  it('maps errors to BackendError codes', () => {
    const pg = (message: string, code = 'P0001') => ({ message, code, details: null, hint: null });
    for (const code of ['not_signed_in', 'already_member', 'invalid_invite', 'not_found'] as const) {
      expect(toBackendError(pg(code), 400).code).toBe(code);
    }
    const invalid = toBackendError(pg('invalid_input'), 400);
    expect([invalid.code, invalid.message]).toEqual(['unknown', 'invalid_input']);
    expect(toBackendError(pg('new row violates row-level security policy for table "areas"', '42501'), 403).code).toBe(
      'not_found',
    );
    expect(toBackendError(pg('permission denied for table households', '42501'), 403).code).toBe('unknown');
    expect(toBackendError(pg('JWT expired', 'PGRST303'), 401).code).toBe('not_signed_in');
    expect(toBackendError({ message: 'TypeError: fetch failed', code: '' }, 0).code).toBe('network');
    expect(toBackendError(new TypeError('Load failed')).code).toBe('network');
    const tooLong = toBackendError(
      pg('new row for relation "items" violates check constraint "items_title_length"', '23514'),
      400,
    );
    expect([tooLong.code, tooLong.message]).toEqual(['unknown', 'invalid_input: items_title_length']);
    const unnamed = toBackendError(pg('value too long', '23514'), 400);
    expect([unnamed.code, unnamed.message]).toEqual(['unknown', 'invalid_input: value too long']);
    const other = toBackendError(pg('duplicate key value violates unique constraint', '23505'), 409);
    expect([other.code, other.message]).toEqual(['unknown', 'duplicate key value violates unique constraint']);
    const same = new BackendError('already_member');
    expect(toBackendError(same)).toBe(same);
  });
});

describe('SupabaseBackend offline: requests', () => {
  it('creates the default client with PKCE and a persisted session', async () => {
    const backend = new SupabaseBackend(FAKE_URL, FAKE_KEY);
    expect(backend.kind).toBe('supabase');
    // supabase-js keeps the auth settings on the auth client.
    const auth = backend.client.auth as unknown as {
      flowType: string;
      persistSession: boolean;
      autoRefreshToken: boolean;
      detectSessionInUrl: boolean;
    };
    expect(auth.flowType).toBe('pkce');
    expect(auth.persistSession).toBe(true);
    expect(auth.autoRefreshToken).toBe(true);
    expect(auth.detectSessionInUrl).toBe(true);
    // Outside a browser supabase-js starts its refresh timer once initialised; stop it.
    await backend.client.auth.getSession();
    await backend.client.auth.stopAutoRefresh();
  });

  it('load() reads the five tables for the household and normalises the email time', async () => {
    const household = {
      id: 'h1',
      name: 'Flat 2',
      address: '1 Test Street',
      timezone: 'Europe/London',
      weekly_email_day: 1,
      weekly_email_time: '08:00:00',
    };
    const { backend, rest } = fakeServer((call) =>
      call.url.pathname === '/rest/v1/households' ? { body: [household] } : { body: [] },
    );
    const data = await backend.load('h1');
    expect(data.household).toEqual({ ...household, weekly_email_time: '08:00' });
    expect(data).toMatchObject({ members: [], areas: [], items: [], completions: [] });

    const q = (table: string) => rest(table)[0].url.searchParams;
    expect(q('households').get('id')).toBe('eq.h1');
    expect(q('members').get('household_id')).toBe('eq.h1');
    expect(q('members').get('order')).toMatch(/^created_at\.asc/);
    expect(q('areas').get('order')).toMatch(/^position\.asc/);
    expect(q('items').get('status')).toBe('eq.open');
    expect(q('completions').get('select')).toBe(
      'id,household_id,item_id,item_title,credited_to,completed_by,completed_at',
    );
  });

  it('load() pages through long lists and reports a hidden household as not_found', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ id: `c${i}` }));
    const { backend, rest } = fakeServer((call) => {
      if (call.url.pathname === '/rest/v1/households') return { body: [{ id: 'h1', weekly_email_time: '09:15:00' }] };
      if (call.url.pathname === '/rest/v1/completions') {
        return { body: call.url.searchParams.get('offset') === '1000' ? [{ id: 'last' }] : page };
      }
      return { body: [] };
    });
    const data = await backend.load('h1');
    expect(data.completions).toHaveLength(1001);
    expect(rest('completions').map((c) => c.url.searchParams.get('offset') ?? '0')).toEqual(['0', '1000']);

    const hidden = fakeServer(() => ({ body: [] }));
    await rejectsWith(hidden.backend.load('h1'), 'not_found');
  });

  it('calls the RPCs with the documented parameter names', async () => {
    const { backend, calls } = fakeServer((call) => {
      const fn = call.url.pathname.replace('/rest/v1/rpc/', '');
      if (fn === 'invite_preview') return { body: { household_name: 'Flat 2', address: '1 Test Street' } };
      if (fn === 'reorder_areas' || fn === 'undo_completion') return { status: 204 };
      return { body: `${fn}-result` };
    });
    const input: CreateHouseholdInput = {
      name: 'Flat 2',
      address: '1 Test Street',
      timezone: 'Europe/London',
      memberName: 'Ada',
      memberEmoji: '🦔',
      areas: ['Kitchen', 'Garden'],
      items: seedItemsFor(['Kitchen']),
    };
    expect(await backend.createHousehold(input)).toBe('create_household-result');
    expect(await backend.joinHousehold({ token: 'tok', memberName: 'Bea', memberEmoji: '🦊' })).toBe(
      'join_household-result',
    );
    expect(await backend.getInvitePreview('tok')).toEqual({ household_name: 'Flat 2', address: '1 Test Street' });
    expect(await backend.createInvite()).toBe('create_invite-result');
    expect(await backend.completeItem('i1')).toBe('complete_item-result');
    await backend.undoCompletion('c1');
    await backend.reorderAreas('h1', ['a2', 'a1']);

    const body = (fn: string) => calls.find((c) => c.url.pathname === `/rest/v1/rpc/${fn}`)?.body;
    expect(body('create_household')).toEqual({
      p_name: 'Flat 2',
      p_address: '1 Test Street',
      p_timezone: 'Europe/London',
      p_member_name: 'Ada',
      p_member_emoji: '🦔',
      p_areas: ['Kitchen', 'Garden'],
      p_items: input.items.map(({ area, kind, title, note, good, rag, due_in_days, repeat, notify }) => ({
        area,
        kind: kind ?? 'task',
        title,
        note,
        good: good ?? '',
        rag,
        due_in_days,
        repeat,
        notify,
      })),
    });
    expect(JSON.stringify(body('create_household'))).not.toContain('demo_assignee');
    expect(body('join_household')).toEqual({ p_token: 'tok', p_member_name: 'Bea', p_member_emoji: '🦊' });
    expect(body('invite_preview')).toEqual({ p_token: 'tok' });
    expect(body('complete_item')).toEqual({ p_item_id: 'i1' });
    expect(body('undo_completion')).toEqual({ p_completion_id: 'c1' });
    expect(body('reorder_areas')).toEqual({ p_household_id: 'h1', p_area_ids: ['a2', 'a1'] });
  });

  it('returns null for an unknown invite', async () => {
    const { backend } = fakeServer(() => ({ body: null }));
    expect(await backend.getInvitePreview('nope')).toBeNull();
  });

  it('maps RPC errors, RLS rejections and network failures', async () => {
    const pgError = (message: string, code = 'P0001') => ({
      status: 400,
      body: { message, code, details: null, hint: null },
    });
    let next: Reply | ((call: Call) => Reply) = pgError('already_member');
    const { backend } = fakeServer((call) => (typeof next === 'function' ? next(call) : next));
    const household = { name: 'x', address: '', timezone: 'UTC', memberName: 'x', memberEmoji: '🦔', areas: [], items: [] };
    await rejectsWith(backend.createHousehold(household), 'already_member');
    next = pgError('invalid_invite');
    await rejectsWith(backend.joinHousehold({ token: 't', memberName: 'x', memberEmoji: '🦔' }), 'invalid_invite');
    next = pgError('not_found');
    await rejectsWith(backend.completeItem('i1'), 'not_found');
    next = pgError('invalid_input');
    await rejectsWith(backend.updateItem('i1', { assignee_id: 'm9' }), 'unknown', /invalid_input/);
    // RLS hides the household's areas (empty read), then rejects the insert.
    next = (call) =>
      call.method === 'GET'
        ? { body: [] }
        : {
            status: 403,
            body: { code: '42501', message: 'new row violates row-level security policy for table "areas"' },
          };
    await rejectsWith(backend.createArea('h1', 'Attic'), 'not_found');
    next = new TypeError('fetch failed');
    await rejectsWith(backend.renameArea('a1', 'Loft'), 'network');
    next = { status: 500, body: { code: 'XX000', message: 'boom' } };
    await rejectsWith(backend.deleteItem('i1'), 'unknown', /boom/);
  });

  it('reports a failing network on reads, after supabase-js has retried them', async () => {
    vi.useFakeTimers();
    try {
      const { backend, rest } = fakeServer(() => new TypeError('Failed to fetch'));
      const outcome = backend.load('h1').then(
        () => null,
        (e: unknown) => e,
      );
      await vi.runAllTimersAsync();
      const err = await outcome;
      expect(err).toBeInstanceOf(BackendError);
      expect((err as BackendError).code).toBe('network');
      expect(rest('households').length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('updates send only the allowed columns and fail with not_found when no row changed', async () => {
    let rows: unknown[] = [{ id: 'x' }];
    const { backend, calls } = fakeServer(() => ({ body: rows }));

    await backend.updateHousehold('h1', { name: ' Flat 3 ', address: ' 2 New Road ' });
    await backend.updateMember('m1', { name: 'Bea', emoji: '🦊', weekly_email: false, push_enabled: true });
    await backend.updateItem('i1', { title: ' Fix it ', assignee_id: null, due_date: null, rag: 'red' });
    await backend.renameArea('a1', ' Loft ');
    const [h, m, i, a] = calls;
    expect([h.method, h.url.pathname, h.url.searchParams.get('id'), h.url.searchParams.get('select')]).toEqual([
      'PATCH',
      '/rest/v1/households',
      'eq.h1',
      'id',
    ]);
    expect(h.body).toEqual({ name: 'Flat 3', address: '2 New Road' });
    expect(m.body).toEqual({ name: 'Bea', emoji: '🦊', weekly_email: false, push_enabled: true });
    expect(i.body).toEqual({ title: 'Fix it', assignee_id: null, due_date: null, rag: 'red' });
    expect(a.body).toEqual({ name: 'Loft' });

    // Extra keys never reach the API (column grants would reject them).
    await backend.updateMember('m1', { name: 'Bea', role: 'owner' } as never);
    expect(calls.at(-1)!.body).toEqual({ name: 'Bea' });

    rows = [];
    await rejectsWith(backend.updateHousehold('h1', { name: 'x' }), 'not_found');
    await rejectsWith(backend.updateMember('m1', { emoji: '🦊' }), 'not_found');
    await rejectsWith(backend.updateItem('i1', { note: '' }), 'not_found');
    await rejectsWith(backend.renameArea('a1', 'x'), 'not_found');
    await rejectsWith(backend.deleteArea('a1'), 'not_found');
    await rejectsWith(backend.deleteItem('i1'), 'not_found');
    // An empty patch still checks that the row is visible.
    await rejectsWith(backend.updateHousehold('h1', {}), 'not_found');
    expect(calls.at(-1)!.method).toBe('GET');

    const before = calls.length;
    await rejectsWith(backend.renameArea('a1', '   '), 'unknown', /invalid_input/);
    await rejectsWith(backend.updateHousehold('h1', { name: '' }), 'unknown', /invalid_input/);
    expect(calls.length).toBe(before);
  });

  it('creates areas at the end and items with every draft field', async () => {
    const { backend, calls } = fakeServer((call) => {
      if (call.method === 'GET') return { body: [{ position: 4 }] };
      return { status: 201, body: [{ id: 'new', ...(call.body as object) }] };
    });
    const area = await backend.createArea('h1', ' Attic ');
    expect(area).toMatchObject({ id: 'new', household_id: 'h1', name: 'Attic', position: 5 });
    const insertArea = calls[1];
    expect(insertArea.method).toBe('POST');
    expect(insertArea.url.searchParams.get('select')).toBe('id,household_id,name,position');

    const draft: ItemDraft = {
      area_id: 'a1',
      kind: 'task',
      title: ' Bleed the radiators ',
      note: '',
      good: '',
      rag: 'amber',
      due_date: '2026-11-01',
      assignee_id: 'm1',
      repeat: 'yearly',
      notify: 'week_before',
    };
    const item = await backend.createItem('h1', draft);
    expect(item.id).toBe('new');
    expect(calls.at(-1)!.body).toEqual({ household_id: 'h1', ...draft, title: 'Bleed the radiators' });
  });

  it('items carry their kind: read, created, patched, and a state cannot be completed', async () => {
    const { backend, calls, rest } = fakeServer((call) => {
      if (call.url.pathname === '/rest/v1/rpc/complete_item') {
        return { status: 400, body: { message: 'invalid_input', code: 'P0001', details: null, hint: null } };
      }
      if (call.url.pathname === '/rest/v1/households') return { body: [{ id: 'h1', weekly_email_time: '08:00:00' }] };
      if (call.method === 'GET') return { body: [] };
      return { status: 201, body: [{ id: 'new', ...(call.body as object) }] };
    });
    await backend.load('h1');
    expect(rest('items')[0].url.searchParams.get('select')!.split(',')).toContain('kind');

    const state: ItemDraft = {
      area_id: 'a1',
      kind: 'state',
      title: 'Firepit',
      note: 'Cover on.',
      good: 'Cover on when not in use, logs dry and stacked.',
      rag: 'green',
      due_date: null,
      assignee_id: null,
      repeat: 'none',
      notify: 'none',
    };
    await backend.createItem('h1', state);
    expect(calls.at(-1)!.body).toEqual({ household_id: 'h1', ...state });
    // A draft from older code without a kind is a task.
    const { kind: _kind, ...bare } = state;
    await backend.createItem('h1', bare as ItemDraft);
    expect((calls.at(-1)!.body as { kind: string }).kind).toBe('task');

    await backend.updateItem('i1', { kind: 'task', due_date: '2026-10-15', notify: 'day_before' });
    expect(calls.at(-1)!.body).toEqual({ kind: 'task', due_date: '2026-10-15', notify: 'day_before' });

    // complete_item raises invalid_input for a state.
    await rejectsWith(backend.completeItem('i1'), 'unknown', /^invalid_input$/);
  });

  it('items carry "What good looks like": read, created, patched and seeded', async () => {
    const { backend, calls, rest } = fakeServer((call) => {
      if (call.url.pathname === '/rest/v1/households') return { body: [{ id: 'h1', weekly_email_time: '08:00:00' }] };
      if (call.url.pathname === '/rest/v1/rpc/create_household') return { body: 'h1' };
      if (call.method === 'GET') return { body: [] };
      return { status: 201, body: [{ id: 'new', ...(call.body as object) }] };
    });
    await backend.load('h1');
    expect(rest('items')[0].url.searchParams.get('select')!.split(',')).toContain('good');

    const state: ItemDraft = {
      area_id: 'a1',
      kind: 'state',
      title: 'Firepit',
      note: '',
      good: 'Cover on, logs dry.',
      rag: 'green',
      due_date: null,
      assignee_id: null,
      repeat: 'none',
      notify: 'none',
    };
    await backend.createItem('h1', state);
    expect((calls.at(-1)!.body as { good: string }).good).toBe('Cover on, logs dry.');
    // A draft from older code without it sends the column's default.
    const { good: _good, ...bare } = state;
    await backend.createItem('h1', bare as ItemDraft);
    expect((calls.at(-1)!.body as { good: string }).good).toBe('');

    await backend.updateItem('i1', { good: 'Ash cleared out.' });
    expect(calls.at(-1)!.body).toEqual({ good: 'Ash cleared out.' });

    // Seed items send theirs (the Firepit has one), '' for the rest.
    await backend.createHousehold({
      name: 'Flat 2',
      address: '',
      timezone: 'Europe/London',
      memberName: 'Ada',
      memberEmoji: '🦔',
      areas: ['Garden'],
      items: seedItemsFor(['Garden']),
    });
    const seeded = (calls.at(-1)!.body as { p_items: { title: string; good: string }[] }).p_items;
    expect(seeded.find((i) => i.title === 'Firepit')!.good).toBe(
      'Cover on when not in use, ash cleared out, logs dry and stacked under the bench.',
    );
    expect(seeded.filter((i) => i.title !== 'Firepit').every((i) => i.good === '')).toBe(true);
  });

  it('createArea starts at position 0 in an empty household', async () => {
    const { backend } = fakeServer((call) =>
      call.method === 'GET' ? { body: [] } : { status: 201, body: [{ id: 'a', ...(call.body as object) }] },
    );
    expect((await backend.createArea('h1', 'Kitchen')).position).toBe(0);
  });

  it('getMyHouseholdId and push subscriptions use the signed-in user', async () => {
    const { backend, client, rest } = fakeServer(
      withAuth((call) => {
        if (call.url.pathname === '/rest/v1/members') return { body: [{ household_id: 'h1' }] };
        return { status: 201, body: [{ id: 's1' }] };
      }),
    );
    await rejectsWith(backend.getMyHouseholdId(), 'not_signed_in');
    await rejectsWith(
      backend.savePushSubscription('m1', { endpoint: 'https://push/1', keys: { p256dh: 'p', auth: 'a' } }),
      'not_signed_in',
    );
    expect(await backend.getUser()).toBeNull();

    await signInFake(client);
    expect(await backend.getUser()).toEqual({
      id: FAKE_USER.id,
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      avatarUrl: 'https://img.example/ada.png',
    });
    expect(await backend.getMyHouseholdId()).toBe('h1');
    expect(rest('members')[0].url.searchParams.get('user_id')).toBe(`eq.${FAKE_USER.id}`);

    const sub: PushSubscriptionInput = { endpoint: 'https://push/1', keys: { p256dh: 'p', auth: 'a' } };
    await backend.savePushSubscription('m1', sub);
    const save = rest('push_subs')[0];
    expect(save.method).toBe('POST');
    expect(save.url.searchParams.get('on_conflict')).toBe('endpoint');
    expect(save.headers.get('prefer')).toMatch(/resolution=merge-duplicates/);
    expect(save.body).toMatchObject({
      member_id: 'm1',
      user_id: FAKE_USER.id,
      endpoint: 'https://push/1',
      p256dh: 'p',
      auth: 'a',
    });
    expect(save.body).toHaveProperty('user_agent');

    await backend.deletePushSubscription('https://push/1');
    const del = rest('push_subs')[1];
    expect([del.method, del.url.searchParams.get('endpoint')]).toEqual(['DELETE', 'eq.https://push/1']);
  });

  it('getMyHouseholdId is null before joining a household', async () => {
    const { backend, client } = fakeServer(withAuth(() => ({ body: [] })));
    await signInFake(client);
    expect(await backend.getMyHouseholdId()).toBeNull();
  });
});

describe('SupabaseBackend offline: auth and realtime wiring', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function fakeAuthClient() {
    let listener: (event: string, session: { user: User } | null) => void = () => {};
    const unsubscribe = vi.fn();
    const auth = {
      onAuthStateChange: vi.fn((cb: typeof listener) => {
        listener = cb;
        return { data: { subscription: { unsubscribe } } };
      }),
      signInWithOAuth: vi.fn(async () => ({ data: {}, error: null })),
    };
    const client = { auth } as unknown as SupabaseClient;
    const emit = (event: string, session: { user: User } | null) => listener(event, session);
    return { client, auth, unsubscribe, emit };
  }

  it('signInWithGoogle redirects back to the app and lets people pick an account', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://home.example' } });
    const { client, auth } = fakeAuthClient();
    await new SupabaseBackend(FAKE_URL, FAKE_KEY, { client }).signInWithGoogle();
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://home.example/', queryParams: { prompt: 'select_account' } },
    });
  });

  it('onAuthChange reports sign-in and sign-out (not token refreshes), outside the auth callback', () => {
    vi.useFakeTimers();
    const { client, emit, unsubscribe } = fakeAuthClient();
    const seen: (string | null)[] = [];
    const stop = new SupabaseBackend(FAKE_URL, FAKE_KEY, { client }).onAuthChange((u) => seen.push(u?.name ?? null));
    const session = { user: FAKE_USER as unknown as User };

    emit('INITIAL_SESSION', null);
    emit('SIGNED_IN', session);
    emit('TOKEN_REFRESHED', session);
    emit('USER_UPDATED', session);
    expect(seen).toEqual([]); // deferred
    vi.runAllTimers();
    expect(seen).toEqual([null, 'Ada Lovelace']);

    emit('SIGNED_OUT', null);
    stop();
    vi.runAllTimers();
    expect(seen).toEqual([null, 'Ada Lovelace']);
    expect(unsubscribe).toHaveBeenCalled();
  });

  function fakeRealtimeClient() {
    const handlers: { type: string; filter: Record<string, string>; cb: (payload?: unknown) => void }[] = [];
    let status: (s: string) => void = () => {};
    const channel = {
      on: vi.fn((type: string, filter: Record<string, string>, cb: (payload?: unknown) => void) => {
        handlers.push({ type, filter, cb });
        return channel;
      }),
      subscribe: vi.fn((cb: (s: string) => void) => {
        status = cb;
        return channel;
      }),
    };
    const client = {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => 'ok'),
    };
    return { client, channel, handlers, setStatus: (s: string) => status(s) };
  }

  it('subscribe() listens to the household and its four tables on one channel', () => {
    const rt = fakeRealtimeClient();
    const backend = new SupabaseBackend(FAKE_URL, FAKE_KEY, { client: rt.client as unknown as SupabaseClient });
    const onChange = vi.fn();
    const stop = backend.subscribe('h1', onChange);

    expect(rt.client.channel).toHaveBeenCalledTimes(1);
    expect(rt.handlers.map((h) => [h.type, h.filter.table, h.filter.filter, h.filter.event, h.filter.schema])).toEqual([
      ['postgres_changes', 'households', 'id=eq.h1', '*', 'public'],
      ['postgres_changes', 'members', 'household_id=eq.h1', '*', 'public'],
      ['postgres_changes', 'areas', 'household_id=eq.h1', '*', 'public'],
      ['postgres_changes', 'items', 'household_id=eq.h1', '*', 'public'],
      ['postgres_changes', 'completions', 'household_id=eq.h1', '*', 'public'],
    ]);

    rt.handlers[3].cb();
    expect(onChange).toHaveBeenCalledTimes(1);
    // Every join reloads: changes between the caller's load and the first join, or while a
    // dropped connection was down, are never replayed.
    rt.setStatus('SUBSCRIBED');
    expect(onChange).toHaveBeenCalledTimes(2);
    rt.setStatus('CHANNEL_ERROR');
    expect(onChange).toHaveBeenCalledTimes(2);
    rt.setStatus('SUBSCRIBED');
    expect(onChange).toHaveBeenCalledTimes(3);

    stop();
    stop();
    expect(rt.client.removeChannel).toHaveBeenCalledTimes(1);
    expect(rt.client.removeChannel).toHaveBeenCalledWith(rt.channel);
    rt.handlers[0].cb();
    rt.setStatus('SUBSCRIBED');
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('subscribe() uses a fresh channel topic each time', () => {
    const rt = fakeRealtimeClient();
    const backend = new SupabaseBackend(FAKE_URL, FAKE_KEY, { client: rt.client as unknown as SupabaseClient });
    backend.subscribe('h1', () => {})();
    backend.subscribe('h1', () => {});
    const [first, second] = rt.client.channel.mock.calls.map((c) => (c as unknown[])[0]);
    expect(first).not.toBe(second);
    expect(String(first)).toContain('h1');
  });

  it('subscribeChat() maps both chat tables to ChatChange events on one channel', () => {
    const rt = fakeRealtimeClient();
    const backend = new SupabaseBackend(FAKE_URL, FAKE_KEY, { client: rt.client as unknown as SupabaseClient });
    const seen: ChatChange[] = [];
    const stop = backend.subscribeChat('h1', (c) => seen.push(c));

    expect(rt.client.channel).toHaveBeenCalledTimes(1);
    expect(String((rt.client.channel.mock.calls[0] as unknown[])[0])).toMatch(/^chat:h1:/);
    // Deletes are filtered too: with replica identity full the old row carries household_id.
    expect(rt.handlers.map((h) => [h.type, h.filter.table, h.filter.filter, h.filter.event, h.filter.schema])).toEqual([
      ['postgres_changes', 'messages', 'household_id=eq.h1', '*', 'public'],
      ['postgres_changes', 'message_reactions', 'household_id=eq.h1', '*', 'public'],
    ]);
    const [messages, reactions] = rt.handlers;
    const change = (eventType: string, row: object) =>
      eventType === 'DELETE' ? { eventType, new: {}, old: row, errors: null } : { eventType, new: row, old: {}, errors: null };

    messages.cb(change('INSERT', { id: 'm1', household_id: 'h1', body: 'Hi' }));
    messages.cb(change('DELETE', { id: 'm1' })); // a DELETE carries the primary key only
    reactions.cb(change('INSERT', { message_id: 'm2', member_id: 'p1', emoji: '👍', household_id: 'h1' }));
    reactions.cb(change('DELETE', { message_id: 'm2', member_id: 'p1', emoji: '👍' }));
    messages.cb(change('DELETE', {})); // names no message: reload
    reactions.cb(change('INSERT', { message_id: 42 }));
    expect(seen).toEqual([
      { type: 'message', messageId: 'm1', deleted: false },
      { type: 'message', messageId: 'm1', deleted: true },
      { type: 'reaction', messageId: 'm2' },
      { type: 'reaction', messageId: 'm2' },
      { type: 'resync' },
      { type: 'resync' },
    ]);

    // Every join resyncs, the first included: a message posted between the first page and
    // the join, or while a dropped connection was down, is never replayed.
    rt.setStatus('SUBSCRIBED');
    expect(seen).toHaveLength(7);
    expect(seen.at(-1)).toEqual({ type: 'resync' });
    rt.setStatus('CHANNEL_ERROR');
    expect(seen).toHaveLength(7);
    rt.setStatus('SUBSCRIBED');
    expect(seen.at(-1)).toEqual({ type: 'resync' });
    expect(seen).toHaveLength(8);

    stop();
    stop();
    expect(rt.client.removeChannel).toHaveBeenCalledTimes(1);
    expect(rt.client.removeChannel).toHaveBeenCalledWith(rt.channel);
    messages.cb(change('INSERT', { id: 'm3' }));
    rt.setStatus('SUBSCRIBED');
    expect(seen).toHaveLength(8);
  });

  it('subscribeChat() keeps delivering when a listener throws', () => {
    const rt = fakeRealtimeClient();
    const backend = new SupabaseBackend(FAKE_URL, FAKE_KEY, { client: rt.client as unknown as SupabaseClient });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      let calls = 0;
      backend.subscribeChat('h1', () => {
        calls++;
        throw new Error('listener failed');
      });
      expect(() => rt.handlers[0].cb({ eventType: 'INSERT', new: { id: 'm1' }, old: {} })).not.toThrow();
      rt.handlers[1].cb({ eventType: 'INSERT', new: { message_id: 'm1' }, old: {} });
      expect(calls).toBe(2);
      expect(errors).toHaveBeenCalledTimes(2);
    } finally {
      errors.mockRestore();
    }
  });
});

describe('SupabaseBackend offline: chat requests', () => {
  const H = '22222222-2222-4222-8222-222222222222';
  const ME = '33333333-3333-4333-8333-333333333333';
  const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const SELECT = 'id,household_id,member_id,body,created_at,reactions:message_reactions(message_id,member_id,emoji,created_at)';
  const row = (n: number, created_at: string, reactions: object[] = []) => ({
    id: uid(n),
    household_id: H,
    member_id: ME,
    body: `Message ${n}`,
    created_at,
    reactions,
  });
  const at = (s: number) => `2026-10-09T19:13:${String(s).padStart(2, '0')}.5+00:00`;
  const pgError = (message: string, code = 'P0001', status = 400) => ({
    status,
    body: { message, code, details: null, hint: null },
  });

  it('instantOf keeps the microseconds PostgREST prints', () => {
    expect(instantOf('2026-10-09T19:13:24.1021+00:00') - instantOf('2026-10-09T19:13:24.102+00:00')).toBe(100);
    expect(instantOf('2026-10-09T19:13:24.000001+00:00') - instantOf('2026-10-09T19:13:24+00:00')).toBe(1);
    expect(instantOf('2026-10-09T19:13:24.5Z')).toBe(instantOf('2026-10-09T20:13:24.500000+01:00'));
    expect(instantOf('2026-10-09T19:13:24.999999+00:00')).toBeLessThan(instantOf('2026-10-09T19:13:25+00:00'));
  });

  it('listMessages reads the newest page with its reactions in one request, oldest first', async () => {
    const reactions = [
      { message_id: uid(3), member_id: 'p2', emoji: '🎉', created_at: '2026-10-09T19:14:00.10215+00:00' },
      { message_id: uid(3), member_id: 'p1', emoji: '❤️', created_at: '2026-10-09T19:14:00.1021+00:00' },
    ];
    const { backend, rest } = fakeServer(() => ({ body: [row(3, at(3), reactions), row(2, at(2)), row(1, at(1))] }));
    const page = await backend.listMessages(H, { limit: 2 });
    expect(page.hasMore).toBe(true);
    expect(page.messages.map((m) => m.body)).toEqual(['Message 2', 'Message 3']);
    // Reactions oldest first, to the microsecond; exactly the contract's keys.
    expect(page.messages[1].reactions.map((r) => r.emoji)).toEqual(['❤️', '🎉']);
    expect(Object.keys(page.messages[1]).sort()).toEqual(['body', 'created_at', 'household_id', 'id', 'member_id', 'reactions']);
    expect(Object.keys(page.messages[1].reactions[0]).sort()).toEqual(['created_at', 'emoji', 'member_id', 'message_id']);

    const q = rest('messages')[0].url.searchParams;
    expect(rest('messages')).toHaveLength(1);
    expect(q.get('select')).toBe(SELECT);
    expect(q.get('household_id')).toBe(`eq.${H}`);
    expect(q.get('order')).toBe('created_at.desc,id.desc');
    expect(q.get('limit')).toBe('3');
    expect(q.has('created_at')).toBe(false);

    // `before` goes to the API exactly as given (microseconds intact).
    const before = '2026-10-09T19:13:24.1021+00:00';
    const older = await backend.listMessages(H, { before, limit: 5 });
    expect(older).toMatchObject({ hasMore: false });
    expect(older.messages.map((m) => m.body)).toEqual(['Message 1', 'Message 2', 'Message 3']);
    expect(rest('messages')[1].url.searchParams.get('created_at')).toBe(`lt.${before}`);
  });

  it('listMessages page sizes: a positive whole number below max_rows, 50 by default', async () => {
    const { backend, rest } = fakeServer(() => ({ body: [row(1, at(1))] }));
    for (const limit of [undefined, Number.NaN, 0, -3, 2.7, 10_000, Infinity]) await backend.listMessages(H, { limit });
    expect(rest('messages').map((c) => c.url.searchParams.get('limit'))).toEqual(['51', '51', '2', '2', '3', '1000', '1000']);
  });

  it('listMessages never ends a page inside a group of messages sharing one created_at', async () => {
    // Newest first: 5 at t5, then 4, 3 and 2 sharing t3 (one transaction), then 1 at t1.
    const all = [row(5, at(5)), row(4, at(3)), row(3, at(3)), row(2, at(3)), row(1, at(1))];
    const { backend, rest } = fakeServer((call) => {
      const q = call.url.searchParams;
      const lt = q.get('created_at')?.startsWith('lt.') ? instantOf(q.get('created_at')!.slice(3)) : Infinity;
      const eq = q.get('created_at')?.startsWith('eq.') ? q.get('created_at')!.slice(3) : null;
      const rows = all.filter((m) => (eq ? m.created_at === eq : instantOf(m.created_at) < lt));
      return { body: rows.slice(0, Number(q.get('limit') ?? rows.length)) };
    });

    // A page of 3 would end inside the group: it stops before the group instead.
    const first = await backend.listMessages(H, { limit: 3 });
    expect([first.messages.map((m) => m.body), first.hasMore]).toEqual([['Message 5'], true]);
    // The group is bigger than the page: the whole group comes back.
    const second = await backend.listMessages(H, { before: first.messages[0].created_at, limit: 2 });
    expect([second.messages.map((m) => m.body), second.hasMore]).toEqual([['Message 2', 'Message 3', 'Message 4'], true]);
    const groupRead = rest('messages').find((c) => c.url.searchParams.get('created_at') === `eq.${at(3)}`)!;
    expect(groupRead.url.searchParams.get('household_id')).toBe(`eq.${H}`);
    expect(groupRead.url.searchParams.get('select')).toBe(SELECT);
    const third = await backend.listMessages(H, { before: second.messages[0].created_at, limit: 2 });
    expect([third.messages.map((m) => m.body), third.hasMore]).toEqual([['Message 1'], false]);

    // The group is the oldest history: nothing more.
    all.pop();
    const last = await backend.listMessages(H, { before: at(4), limit: 1 });
    expect([last.messages.map((m) => m.body), last.hasMore]).toEqual([['Message 2', 'Message 3', 'Message 4'], false]);
  });

  it('listMessages reports an empty chat, or a household the caller cannot see', async () => {
    let visible: object[] = [{ id: H }];
    const { backend, rest } = fakeServer((call) => ({ body: call.url.pathname === '/rest/v1/households' ? visible : [] }));
    expect(await backend.listMessages(H)).toEqual({ messages: [], hasMore: false });
    expect(rest('households')[0].url.searchParams.get('id')).toBe(`eq.${H}`);
    visible = [];
    await rejectsWith(backend.listMessages(H), 'not_found');
    await rejectsWith(backend.listMessages(H, { before: 'yesterday-ish' }), 'unknown', /^invalid_input: before$/);
    const before = rest('messages').length;
    await rejectsWith(backend.listMessages('another-household'), 'not_found');
    expect(rest('messages')).toHaveLength(before);
  });

  it('getMessages reloads the messages that still exist, in chat order', async () => {
    // Same millisecond: only the microseconds tell them apart.
    const a = row(1, '2026-10-09T19:13:24.10215+00:00');
    const b = row(2, '2026-10-09T19:13:24.1021+00:00');
    const { backend, rest } = fakeServer(() => ({ body: [a, b] }));
    const got = await backend.getMessages([a.id, 'tmp-1', b.id, a.id]);
    expect(got.map((m) => m.id)).toEqual([b.id, a.id]);
    expect(rest('messages')).toHaveLength(1);
    expect(rest('messages')[0].url.searchParams.get('id')).toBe(`in.(${a.id},${b.id})`);
    expect(rest('messages')[0].url.searchParams.get('select')).toBe(SELECT);

    expect(await backend.getMessages([])).toEqual([]);
    expect(await backend.getMessages(['tmp-1'])).toEqual([]);
    expect(rest('messages')).toHaveLength(1);

    // Long lists go in several short requests.
    await backend.getMessages(Array.from({ length: 250 }, (_, i) => uid(i)));
    const sizes = rest('messages')
      .slice(1)
      .map((c) => c.url.searchParams.get('id')!.split(',').length);
    expect(sizes).toEqual([100, 100, 50]);
  });

  it('sendMessage posts only the household and the trimmed body', async () => {
    let reply: Reply = { status: 201, body: [{ ...row(1, at(1)), body: 'The engineer is here', reactions: undefined }] };
    const { backend, rest } = fakeServer(() => reply);
    const sent = await backend.sendMessage(H, '  The engineer is here \n');
    expect(sent).toEqual({ ...row(1, at(1)), body: 'The engineer is here', reactions: [] });
    const post = rest('messages')[0];
    expect(post.method).toBe('POST');
    expect(post.body).toEqual({ household_id: H, body: 'The engineer is here' });
    expect(post.url.searchParams.get('select')).toBe('id,household_id,member_id,body,created_at');

    // Characters as Postgres counts them: an emoji is one.
    await backend.sendMessage(H, '🦔'.repeat(4000));
    await backend.sendMessage(H, ` ${'x'.repeat(4000)}\n`);
    expect(rest('messages')).toHaveLength(3);
    for (const body of ['', '   ', '\n\t ', 'x'.repeat(4001), '🦔'.repeat(4001), null as unknown as string]) {
      await rejectsWith(backend.sendMessage(H, body), 'unknown', /^invalid_input: body$/);
    }
    await rejectsWith(backend.sendMessage('another-household', 'Hi'), 'not_found');
    expect(rest('messages')).toHaveLength(3);

    reply = pgError('new row violates row-level security policy for table "messages"', '42501', 403);
    await rejectsWith(backend.sendMessage(H, 'Hi'), 'not_found');
    // The database's own check, should it ever refuse what the client let through.
    reply = pgError('new row for relation "messages" violates check constraint "messages_body_length"', '23514');
    await rejectsWith(backend.sendMessage(H, 'Hi'), 'unknown', /^invalid_input: messages_body_length$/);
  });

  it('deleteMessage deletes one of your own messages, else not_found', async () => {
    let rows: object[] = [{ id: uid(1) }];
    const { backend, rest } = fakeServer(() => ({ body: rows }));
    await backend.deleteMessage(uid(1));
    const del = rest('messages')[0];
    expect([del.method, del.url.searchParams.get('id'), del.url.searchParams.get('select')]).toEqual([
      'DELETE',
      `eq.${uid(1)}`,
      'id',
    ]);
    rows = []; // someone else's message, or gone: RLS deletes nothing
    await rejectsWith(backend.deleteMessage(uid(1)), 'not_found');
    await rejectsWith(backend.deleteMessage('nope'), 'not_found');
    expect(rest('messages')).toHaveLength(2);
  });

  it('setReaction adds idempotently and removes only by message and emoji', async () => {
    let reply: Reply = { status: 201 };
    const { backend, rest } = fakeServer(() => reply);
    await backend.setReaction(uid(1), '❤️', true);
    const add = rest('message_reactions')[0];
    expect(add.method).toBe('POST');
    expect(add.body).toEqual({ message_id: uid(1), emoji: '❤️' });
    expect(add.url.searchParams.get('on_conflict')).toBe('message_id,member_id,emoji');
    expect(add.headers.get('prefer')).toMatch(/resolution=ignore-duplicates/);

    reply = { status: 204 };
    await backend.setReaction(uid(1), '❤️', false);
    const remove = rest('message_reactions')[1];
    expect(remove.method).toBe('DELETE');
    expect(remove.url.searchParams.get('message_id')).toBe(`eq.${uid(1)}`);
    expect(remove.url.searchParams.get('emoji')).toBe('eq.❤️');
    // RLS keeps the delete to the caller's own reactions.
    expect(remove.url.searchParams.has('member_id')).toBe(false);

    await backend.setReaction(uid(1), '🛠️', true); // two code points (U+FE0F)
    // Only REACTION_EMOJIS (message_reactions_emoji_allowed), refused before any request.
    for (const emoji of ['', '🦔'.repeat(17), '👨‍👩‍👧‍👦', '❤', 'pay rent 1234']) {
      await rejectsWith(backend.setReaction(uid(1), emoji, true), 'unknown', /^invalid_input: emoji$/);
    }
    await rejectsWith(backend.setReaction('nope', '👍', true), 'not_found');
    await backend.setReaction('nope', '👍', false);
    await backend.setReaction(uid(1), '', false);
    expect(rest('message_reactions')).toHaveLength(3);

    reply = pgError('not_found'); // the trigger: no such message
    await rejectsWith(backend.setReaction(uid(2), '👍', true), 'not_found');
    reply = pgError('new row violates row-level security policy for table "message_reactions"', '42501', 403);
    await rejectsWith(backend.setReaction(uid(2), '👍', true), 'not_found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Live
// ─────────────────────────────────────────────────────────────────────────────

const LIVE_URL = process.env.SUPABASE_TEST_URL ?? '';
const LIVE_ANON = process.env.SUPABASE_TEST_ANON_KEY ?? '';
const LIVE_SERVICE = process.env.SUPABASE_TEST_SERVICE_KEY ?? '';
const LIVE = Boolean(LIVE_URL && LIVE_ANON && LIVE_SERVICE);
const describeLive = LIVE ? describe : describe.skip;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await sleep(100);
  }
  return check();
}

interface Person {
  key: 'a' | 'b' | 'c';
  email: string;
  password: string;
  fullName: string;
  userId: string;
  client: SupabaseClient;
  backend: SupabaseBackend;
}

describeLive('SupabaseBackend live (SUPABASE_TEST_URL)', { timeout: 30_000 }, () => {
  const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const TZ = 'Europe/London';
  const AREAS = ['Kitchen', '  ', 'Garden', 'Jacuzzi'];
  let admin: SupabaseClient;
  const people = {} as Record<'a' | 'b' | 'c', Person>;
  const households: string[] = [];

  let hidA = '';
  let token = '';
  let memberA = '';
  let memberB = '';
  let memberC = '';
  let hidC = '';

  async function createPerson(key: Person['key'], fullName: string): Promise<Person> {
    const email = `homeos-${key}-${runId}@example.com`;
    const password = `pw-${runId}-${key}-Secret1!`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error || !data.user) throw error ?? new Error('createUser returned no user');
    const client = createClient(LIVE_URL, LIVE_ANON, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    return {
      key,
      email,
      password,
      fullName,
      userId: data.user.id,
      client,
      backend: new SupabaseBackend(LIVE_URL, LIVE_ANON, { client }),
    };
  }

  const A = () => people.a.backend;
  const B = () => people.b.backend;
  const C = () => people.c.backend;
  const loadA = () => A().load(hidA);
  const area = (data: HouseholdData, name: string): Area => {
    const found = data.areas.find((a) => a.name === name);
    if (!found) throw new Error(`no area ${name}`);
    return found;
  };
  const draft = (over: Partial<ItemDraft> & Pick<ItemDraft, 'area_id'>): ItemDraft => ({
    kind: 'task',
    title: 'Test item',
    note: '',
    good: '',
    rag: 'amber',
    due_date: null,
    assignee_id: null,
    repeat: 'none',
    notify: 'day_before',
    ...over,
  });

  beforeAll(async () => {
    admin = createClient(LIVE_URL, LIVE_SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    people.a = await createPerson('a', 'Ada Tester');
    people.b = await createPerson('b', 'Bea Tester');
    people.c = await createPerson('c', 'Cy Tester');
  }, 60_000);

  afterAll(async () => {
    for (const p of Object.values(people)) {
      await p.client.removeAllChannels().catch(() => {});
      p.client.realtime.disconnect();
    }
    if (!admin) return;
    if (households.length) await admin.from('households').delete().in('id', households);
    for (const p of Object.values(people)) await admin.auth.admin.deleteUser(p.userId).catch(() => {});
  }, 60_000);

  it('maps the signed-in user', async () => {
    expect(await A().getUser()).toEqual({ id: people.a.userId, email: people.a.email, name: 'Ada Tester' });
    expect(await A().getMyHouseholdId()).toBeNull();
  });

  it('creates a household with its areas and seed items', async () => {
    const items = seedItemsFor(AREAS);
    expect(items.length).toBeGreaterThan(0);
    hidA = await A().createHousehold({
      name: 'Test Flat',
      address: '1 Test Street',
      timezone: TZ,
      memberName: 'Ada',
      memberEmoji: '🦔',
      areas: AREAS,
      items,
    });
    households.push(hidA);
    expect(await A().getMyHouseholdId()).toBe(hidA);

    const data = await loadA();
    expect(data.household).toEqual({
      id: hidA,
      name: 'Test Flat',
      address: '1 Test Street',
      timezone: TZ,
      weekly_email_day: 1,
      weekly_email_time: '08:00',
    });
    expect(data.areas.map((a) => [a.name, a.position])).toEqual([
      ['Kitchen', 0],
      ['Garden', 1],
      ['Jacuzzi', 2],
    ]);
    expect(data.members).toHaveLength(1);
    expect(data.members[0]).toMatchObject({
      household_id: hidA,
      user_id: people.a.userId,
      name: 'Ada',
      emoji: '🦔',
      email: people.a.email,
      role: 'owner',
      color: '#007AFF',
    });
    memberA = data.members[0].id;

    expect(data.items).toHaveLength(items.length);
    const today = todayIn(TZ);
    for (const seed of items) {
      const item = data.items.find((i) => i.title === seed.title);
      expect(item, seed.title).toBeDefined();
      expect(item).toMatchObject({
        household_id: hidA,
        area_id: area(data, seed.area).id,
        kind: seed.kind ?? 'task',
        note: seed.note,
        good: seed.good ?? '',
        rag: seed.rag,
        repeat: seed.repeat,
        notify: seed.notify,
        status: 'open',
        assignee_id: null,
        due_date: seed.due_in_days === null ? null : addDays(today, seed.due_in_days),
      });
    }
    expect(data.completions).toEqual([]);
    // The Garden's Firepit is a state (To maintain): no due date, repeat or reminder.
    expect(data.items.find((i) => i.title === 'Firepit')).toMatchObject({
      kind: 'state',
      due_date: null,
      repeat: 'none',
      notify: 'none',
    });

    await rejectsWith(
      A().createHousehold({
        name: 'Second',
        address: '',
        timezone: TZ,
        memberName: 'Ada',
        memberEmoji: '🦔',
        areas: [],
        items: [],
      }),
      'already_member',
    );
  });

  it('invites a second member', async () => {
    token = await A().createInvite();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(await B().getInvitePreview(token)).toEqual({ household_name: 'Test Flat', address: '1 Test Street' });
    expect(await B().getInvitePreview('not-a-token')).toBeNull();
    await rejectsWith(
      B().joinHousehold({ token: 'not-a-token', memberName: 'Bea', memberEmoji: '🦊' }),
      'invalid_invite',
    );

    expect(await B().getMyHouseholdId()).toBeNull();
    expect(await B().joinHousehold({ token, memberName: 'Bea', memberEmoji: '🦊' })).toBe(hidA);
    // Joining again is harmless.
    expect(await B().joinHousehold({ token, memberName: 'Bea', memberEmoji: '🦊' })).toBe(hidA);
    expect(await B().getMyHouseholdId()).toBe(hidA);

    const data = await B().load(hidA);
    expect(data.members.map((m) => [m.name, m.role, m.color])).toEqual([
      ['Ada', 'owner', '#007AFF'],
      ['Bea', 'member', '#AF52DE'],
    ]);
    memberB = data.members[1].id;
  });

  it('keeps other households out', async () => {
    const before = await loadA();
    const kitchen = area(before, 'Kitchen');
    const item = before.items[0];

    expect(await C().getMyHouseholdId()).toBeNull();
    await rejectsWith(C().load(hidA), 'not_found');
    await rejectsWith(C().updateHousehold(hidA, { name: 'Hacked' }), 'not_found');
    await rejectsWith(C().updateMember(memberA, { name: 'Hacked' }), 'not_found');
    await rejectsWith(C().createArea(hidA, 'Hacked'), 'not_found');
    await rejectsWith(C().renameArea(kitchen.id, 'Hacked'), 'not_found');
    await rejectsWith(C().deleteArea(kitchen.id), 'not_found');
    await rejectsWith(C().reorderAreas(hidA, before.areas.map((a) => a.id).reverse()), 'not_found');
    await rejectsWith(C().createItem(hidA, draft({ area_id: kitchen.id, title: 'Hacked' })), 'not_found');
    await rejectsWith(C().updateItem(item.id, { title: 'Hacked' }), 'not_found');
    await rejectsWith(C().deleteItem(item.id), 'not_found');
    await rejectsWith(C().completeItem(item.id), 'not_found');
    await rejectsWith(C().createInvite(), 'not_found');

    // C can still start a household of their own, and it stays separate.
    hidC = await C().createHousehold({
      name: 'Other Place',
      address: '',
      timezone: 'Not/AZone',
      memberName: 'Cy',
      memberEmoji: '🐙',
      areas: ['Shed'],
      items: [],
    });
    households.push(hidC);
    const own = await C().load(hidC);
    expect(own.household).toMatchObject({ name: 'Other Place', timezone: 'Europe/London' });
    expect(own.members.map((m) => m.name)).toEqual(['Cy']);
    expect(own.items).toEqual([]);
    memberC = own.members[0].id;
    await rejectsWith(C().joinHousehold({ token, memberName: 'Cy', memberEmoji: '🐙' }), 'already_member');
    await rejectsWith(C().load(hidA), 'not_found');
    await rejectsWith(A().load(hidC), 'not_found');

    const after = await loadA();
    expect(after).toEqual(before);
  });

  it('lets any member edit everything, including the profiles of others', async () => {
    await B().updateHousehold(hidA, { name: 'Renamed Flat', address: '2 New Road', timezone: 'Europe/Athens' });
    await rejectsWith(B().updateHousehold(hidA, { timezone: 'Not/AZone' }), 'unknown', /invalid_input/);
    await B().updateHousehold(hidA, {});
    await B().updateMember(memberA, { name: 'Ada L', emoji: '🐙', weekly_email: false, push_enabled: true });
    await A().updateMember(memberB, { name: 'Bea B' });

    let data = await loadA();
    expect(data.household).toMatchObject({ name: 'Renamed Flat', address: '2 New Road', timezone: 'Europe/Athens' });
    expect(data.members.map((m) => [m.name, m.emoji, m.weekly_email, m.push_enabled])).toEqual([
      ['Ada L', '🐙', false, true],
      ['Bea B', '🦊', true, false],
    ]);

    const attic = await B().createArea(hidA, 'Attic');
    expect(attic).toMatchObject({ household_id: hidA, name: 'Attic', position: 3 });
    await B().renameArea(attic.id, 'Loft');
    const order = [attic.id, ...data.areas.map((a) => a.id).reverse()];
    await B().reorderAreas(hidA, order);
    data = await loadA();
    expect(data.areas.map((a) => a.id)).toEqual(order);
    expect(data.areas.map((a) => a.position)).toEqual([0, 1, 2, 3]);
    expect(data.areas[0].name).toBe('Loft');

    const created = await B().createItem(
      hidA,
      draft({
        area_id: attic.id,
        title: 'Check the insulation',
        note: 'Before winter',
        rag: 'red',
        due_date: '2026-12-01',
        assignee_id: memberA,
        repeat: 'yearly',
        notify: 'week_before',
      }),
    );
    expect(created).toMatchObject({
      household_id: hidA,
      area_id: attic.id,
      title: 'Check the insulation',
      note: 'Before winter',
      rag: 'red',
      due_date: '2026-12-01',
      assignee_id: memberA,
      repeat: 'yearly',
      notify: 'week_before',
      status: 'open',
      created_by: memberB,
      updated_by: memberB,
    });

    const kitchen = area(data, 'Kitchen');
    await A().updateItem(created.id, {
      area_id: kitchen.id,
      title: 'Check the loft insulation',
      rag: 'green',
      assignee_id: null,
      due_date: null,
      repeat: 'none',
      notify: 'none',
      note: '',
    });
    data = await B().load(hidA);
    expect(data.items.find((i) => i.id === created.id)).toMatchObject({
      area_id: kitchen.id,
      title: 'Check the loft insulation',
      rag: 'green',
      assignee_id: null,
      due_date: null,
      repeat: 'none',
      notify: 'none',
      note: '',
      created_by: memberB,
      updated_by: memberA,
    });

    // An assignee from another household is refused.
    await rejectsWith(B().updateItem(created.id, { assignee_id: memberC }), 'unknown', /invalid_input/);

    await B().deleteItem(created.id);
    await rejectsWith(B().deleteItem(created.id), 'not_found');
    await rejectsWith(B().updateItem(created.id, { title: 'Gone' }), 'not_found');
    expect((await loadA()).items.some((i) => i.id === created.id)).toBe(false);
  });

  it('refuses text over the database limits (TEXT_LIMITS), changing nothing', async () => {
    const before = await loadA();
    const kitchen = area(before, 'Kitchen');
    const over = (limit: number, c = 'x') => c.repeat(limit + 1);
    // Postgres reports a check violation naming the constraint; the backend maps it to 'unknown'.
    const refused = (p: Promise<unknown>, constraint: string) => rejectsWith(p, 'unknown', new RegExp(constraint));

    await refused(A().createItem(hidA, draft({ area_id: kitchen.id, title: over(200) })), 'items_title_length');
    await refused(A().createItem(hidA, draft({ area_id: kitchen.id, note: over(4000) })), 'items_note_length');
    await refused(A().createItem(hidA, draft({ area_id: kitchen.id, good: over(4000) })), 'items_good_length');
    const longest = await A().createItem(
      hidA,
      draft({ area_id: kitchen.id, title: 'x'.repeat(200), note: 'y'.repeat(4000), good: 'z'.repeat(4000) }),
    );
    await refused(B().updateItem(longest.id, { title: over(200) }), 'items_title_length');
    await refused(B().updateItem(longest.id, { note: over(4000) }), 'items_note_length');
    await refused(B().updateItem(longest.id, { good: over(4000) }), 'items_good_length');
    await refused(B().updateMember(memberA, { name: over(40) }), 'members_name_length');
    await refused(B().updateMember(memberA, { emoji: over(16, '🦔') }), 'members_emoji_length');
    await refused(B().updateHousehold(hidA, { name: over(60) }), 'households_name_length');
    await refused(B().updateHousehold(hidA, { address: over(120) }), 'households_address_length');
    await refused(B().createArea(hidA, over(60)), 'areas_name_length');
    await refused(B().renameArea(kitchen.id, over(60)), 'areas_name_length');

    const after = await loadA();
    expect(after.household).toEqual(before.household);
    expect(after.members).toEqual(before.members);
    expect(after.areas).toEqual(before.areas);
    expect(after.items.find((i) => i.id === longest.id)).toMatchObject({
      title: 'x'.repeat(200),
      note: 'y'.repeat(4000),
      good: 'z'.repeat(4000),
    });
    await A().deleteItem(longest.id);
  });

  it('completes items and undoes completions', async () => {
    let data = await loadA();
    const tz = data.household.timezone;
    const today = todayIn(tz);
    const kitchen = area(data, 'Kitchen');

    const oneOff = await A().createItem(
      hidA,
      draft({ area_id: kitchen.id, title: 'Descale the kettle', due_date: addDays(today, 3), assignee_id: memberA }),
    );
    const completionId = await B().completeItem(oneOff.id);
    data = await loadA();
    expect(data.items.some((i) => i.id === oneOff.id)).toBe(false);
    expect(data.completions.find((c) => c.id === completionId)).toMatchObject({
      household_id: hidA,
      item_id: oneOff.id,
      item_title: 'Descale the kettle',
      credited_to: memberA,
      completed_by: memberB,
    });
    await rejectsWith(A().completeItem(oneOff.id), 'not_found');
    await rejectsWith(C().undoCompletion(completionId), 'not_found');

    await A().undoCompletion(completionId);
    data = await loadA();
    expect(data.items.find((i) => i.id === oneOff.id)).toMatchObject({ status: 'open', due_date: addDays(today, 3) });
    expect(data.completions.some((c) => c.id === completionId)).toBe(false);
    await rejectsWith(A().undoCompletion(completionId), 'not_found');

    // Repeating and unassigned: stays open, moves one interval on, credited to whoever did it.
    const weekly = await B().createItem(
      hidA,
      draft({ area_id: kitchen.id, title: 'Water the plants', due_date: addDays(today, -2), repeat: 'weekly' }),
    );
    const weeklyCompletion = await A().completeItem(weekly.id);
    data = await loadA();
    expect(data.items.find((i) => i.id === weekly.id)).toMatchObject({ status: 'open', due_date: addDays(today, 5) });
    expect(data.completions.find((c) => c.id === weeklyCompletion)).toMatchObject({
      credited_to: memberA,
      completed_by: memberA,
    });
    await B().undoCompletion(weeklyCompletion);
    data = await loadA();
    expect(data.items.find((i) => i.id === weekly.id)?.due_date).toBe(addDays(today, -2));
  });

  it('keeps states (To maintain): no due date, never completed, and they can become tasks', async () => {
    let data = await loadA();
    const kitchen = area(data, 'Kitchen');
    const today = todayIn(data.household.timezone);

    // The database drops a state's due date, repeat and reminder, whatever is sent.
    const state = await B().createItem(
      hidA,
      draft({ area_id: kitchen.id, kind: 'state', title: 'Hot tub', rag: 'green', due_date: addDays(today, 3), repeat: 'weekly', notify: 'same_day' }),
    );
    expect(state).toMatchObject({ kind: 'state', due_date: null, repeat: 'none', notify: 'none', rag: 'green', status: 'open' });
    await A().updateItem(state.id, { due_date: addDays(today, 5), notify: 'week_before', rag: 'amber' });
    data = await loadA();
    expect(data.items.find((i) => i.id === state.id)).toMatchObject({ kind: 'state', due_date: null, notify: 'none', rag: 'amber' });

    // Never completed: invalid_input, and no completion is logged.
    const before = data.completions.length;
    await rejectsWith(A().completeItem(state.id), 'unknown', /invalid_input/);
    data = await loadA();
    expect(data.completions).toHaveLength(before);
    expect(data.items.some((i) => i.id === state.id)).toBe(true);

    // A state can become a task, which then takes a due date and can be completed.
    await B().updateItem(state.id, { kind: 'task', due_date: addDays(today, 7), notify: 'day_before' });
    data = await loadA();
    expect(data.items.find((i) => i.id === state.id)).toMatchObject({ kind: 'task', due_date: addDays(today, 7), notify: 'day_before' });
    const cid = await A().completeItem(state.id);
    expect((await loadA()).items.some((i) => i.id === state.id)).toBe(false);
    await A().undoCompletion(cid);

    // And a task can become a state again, losing its due date.
    await A().updateItem(state.id, { kind: 'state' });
    expect((await loadA()).items.find((i) => i.id === state.id)).toMatchObject({ kind: 'state', due_date: null, notify: 'none' });
    await A().deleteItem(state.id);
  });

  it('keeps "What good looks like" through edits by anyone, kind changes, completion and undo', async () => {
    let data = await loadA();
    const garden = area(data, 'Garden');
    const good = 'Cover on when not in use, ash cleared out, logs dry and stacked.';

    const state = await A().createItem(hidA, draft({ area_id: garden.id, kind: 'state', title: 'Fire bowl', good }));
    expect(state).toMatchObject({ kind: 'state', good });
    // Any member edits it; outsiders see and change nothing.
    await B().updateItem(state.id, { good: `${good} Grate brushed.` });
    await rejectsWith(C().updateItem(state.id, { good: 'Hacked' }), 'not_found');
    data = await loadA();
    expect(data.items.find((i) => i.id === state.id)).toMatchObject({ good: `${good} Grate brushed.`, updated_by: memberB });

    // A task keeps it (hidden in the app) through completion and undo, and back to a state.
    const today = todayIn(data.household.timezone);
    await A().updateItem(state.id, { kind: 'task', due_date: today, repeat: 'weekly' });
    const cid = await A().completeItem(state.id);
    expect((await loadA()).items.find((i) => i.id === state.id)).toMatchObject({ kind: 'task', good: `${good} Grate brushed.` });
    await B().undoCompletion(cid);
    await B().updateItem(state.id, { kind: 'state' });
    expect((await loadA()).items.find((i) => i.id === state.id)).toMatchObject({
      kind: 'state',
      due_date: null,
      good: `${good} Grate brushed.`,
    });

    // A plain task starts without one.
    const task = await A().createItem(hidA, draft({ area_id: garden.id, title: 'Sweep the patio' }));
    expect(task.good).toBe('');
    await A().deleteItem(task.id);
    await A().deleteItem(state.id);
  });

  it('deletes an area with its items but keeps their completions', async () => {
    const shed = await A().createArea(hidA, 'Shed');
    const done = await A().createItem(hidA, draft({ area_id: shed.id, title: 'Oil the mower' }));
    const open = await B().createItem(hidA, draft({ area_id: shed.id, title: 'Sharpen the shears' }));
    const completionId = await B().completeItem(done.id);

    await B().deleteArea(shed.id);
    const data = await loadA();
    expect(data.areas.some((a) => a.id === shed.id)).toBe(false);
    expect(data.items.some((i) => i.id === open.id || i.id === done.id)).toBe(false);
    expect(data.completions.find((c) => c.id === completionId)).toMatchObject({
      item_id: null,
      item_title: 'Oil the mower',
    });
    await rejectsWith(B().deleteArea(shed.id), 'not_found');
    await rejectsWith(B().renameArea(shed.id, 'Gone'), 'not_found');
    // Undo still works once the item is gone: it just drops the completion.
    await A().undoCompletion(completionId);
    expect((await loadA()).completions.some((c) => c.id === completionId)).toBe(false);
  });

  it('saves and deletes push subscriptions per user', async () => {
    const endpoint = `https://push.example/${runId}`;
    const rows = async () => {
      const { data, error } = await admin
        .from('push_subs')
        .select('member_id, user_id, p256dh, auth')
        .eq('endpoint', endpoint);
      if (error) throw error;
      return data;
    };

    await A().savePushSubscription(memberA, { endpoint, keys: { p256dh: 'p1', auth: 'a1' } });
    expect(await rows()).toEqual([{ member_id: memberA, user_id: people.a.userId, p256dh: 'p1', auth: 'a1' }]);
    // Same browser again (new keys): still one row.
    await A().savePushSubscription(memberA, { endpoint, keys: { p256dh: 'p2', auth: 'a2' } });
    expect(await rows()).toEqual([{ member_id: memberA, user_id: people.a.userId, p256dh: 'p2', auth: 'a2' }]);

    // Nobody can register a device for someone else.
    await rejectsWith(
      B().savePushSubscription(memberA, { endpoint: `${endpoint}/b`, keys: { p256dh: 'p', auth: 'a' } }),
      'not_found',
    );

    // Knowing someone's endpoint is not enough to take it over: their row stays.
    await rejectsWith(B().savePushSubscription(memberB, { endpoint, keys: { p256dh: 'p3', auth: 'a3' } }), 'not_found');
    expect(await rows()).toEqual([{ member_id: memberA, user_id: people.a.userId, p256dh: 'p2', auth: 'a2' }]);
    // Another account on the same browser (the same subscription keys) takes it over.
    await B().savePushSubscription(memberB, { endpoint, keys: { p256dh: 'p2', auth: 'a2' } });
    expect(await rows()).toEqual([{ member_id: memberB, user_id: people.b.userId, p256dh: 'p2', auth: 'a2' }]);

    // Only https endpoints are stored (the scheduler POSTs to them).
    for (const bad of ['http://127.0.0.1:54321/rest/v1/', 'javascript:alert(1)', `https://push.example/${'x'.repeat(2048)}`]) {
      await rejectsWith(
        A().savePushSubscription(memberA, { endpoint: bad, keys: { p256dh: 'p', auth: 'a' } }),
        'unknown',
        /push_subs_endpoint_https/,
      );
    }

    // A can only delete their own rows.
    await A().deletePushSubscription(endpoint);
    expect(await rows()).toHaveLength(1);
    await B().deletePushSubscription(endpoint);
    expect(await rows()).toEqual([]);
    await B().deletePushSubscription(endpoint);
  });

  it('subscribe() hears edits made by another member; outsiders get no content', { timeout: 45_000 }, async () => {
    const data = await loadA();
    const joined = (p: Person) => p.client.getChannels().some((c) => c.state === 'joined');

    let changes = 0;
    const stop = A().subscribe(hidA, () => changes++);

    // C is not a member but knows A's household id and listens with the same filters.
    // RLS keeps every INSERT and UPDATE from C. Supabase Realtime does not apply RLS to
    // DELETE, so C may hear that a row was deleted, but the payload carries its id only.
    type Heard = { table: string; eventType: string; new: object; old: object };
    const outsiderHeard: Heard[] = [];
    const outsider = people.c.client.channel(`outsider:${hidA}:${runId}`);
    for (const table of ['households', 'members', 'areas', 'items', 'completions']) {
      const filter = `${table === 'households' ? 'id' : 'household_id'}=eq.${hidA}`;
      outsider.on('postgres_changes', { event: '*', schema: 'public', table, filter }, (p) => outsiderHeard.push(p));
    }
    outsider.subscribe();

    try {
      expect(await waitFor(() => joined(people.a) && joined(people.c), 10_000), 'realtime channels joined').toBe(true);
      // The join itself asks for a reload (changes made before it are never replayed).
      expect(await waitFor(() => changes > 0, 5000), 'the first join asks for a reload').toBe(true);
      // Postgres changes start flowing a moment after the join, so keep editing until one arrives.
      const until = Date.now() + 20_000;
      let flowing = false;
      for (let n = 1; !flowing && Date.now() < until; n++) {
        const before = changes;
        await B().renameArea(data.areas[0].id, `Renamed ${runId} ${n}`);
        flowing = await waitFor(() => changes > before, 1500);
      }
      expect(flowing, 'postgres_changes events heard by a member').toBe(true);

      // An insert, an update and a delete, with both channels listening. Realtime checks RLS
      // when it reads the change, and drops an insert or update whose row is already gone, so
      // each step waits until the member has heard the previous one.
      let itemId = '';
      const edits: [string, () => Promise<unknown>][] = [
        ['insert', async () => (itemId = (await B().createItem(hidA, draft({ area_id: data.areas[0].id }))).id)],
        ['update', () => B().updateItem(itemId, { title: `Secret ${runId}`, note: 'secret note' })],
        ['delete', () => B().deleteItem(itemId)],
      ];
      for (const [what, edit] of edits) {
        const before = changes;
        await edit();
        expect(await waitFor(() => changes > before, 10_000), `member heard the ${what}`).toBe(true);
      }
      await sleep(1000);

      for (const heard of outsiderHeard) {
        expect(heard.eventType, `outsider heard ${heard.eventType} on ${heard.table}`).toBe('DELETE');
        expect(heard.new).toEqual({});
        expect(Object.keys(heard.old)).toEqual(['id']);
      }
    } finally {
      stop();
      void people.c.client.removeChannel(outsider);
    }
    // Unsubscribing removes the channel.
    expect(await waitFor(() => people.a.client.getChannels().length === 0, 5000)).toBe(true);
  });

  // ── Chat ────────────────────────────────────────────────

  /** Messages as the service role writes them: with chosen times (members cannot set created_at). */
  async function seedMessages(rows: { member_id: string; body: string; created_at: string }[]) {
    const { data, error } = await admin
      .from('messages')
      .insert(rows.map((r) => ({ household_id: hidA, ...r })))
      .select('id, body, created_at');
    if (error) throw error;
    return data as { id: string; body: string; created_at: string }[];
  }

  /** A household's message ids as stored, in chat order (created_at to the microsecond, then id). */
  async function storedMessageIds(hid: string): Promise<string[]> {
    const { data, error } = await admin.from('messages').select('id').eq('household_id', hid).order('created_at').order('id');
    if (error) throw error;
    return data.map((m) => m.id as string);
  }

  async function storedReactions(messageId: string) {
    const { data, error } = await admin
      .from('message_reactions')
      .select('member_id, household_id, emoji')
      .eq('message_id', messageId)
      .order('created_at');
    if (error) throw error;
    return data;
  }

  it('chat: members post and read; an outsider sees nothing and cannot post', async () => {
    const fromA = await A().sendMessage(hidA, '  The engineer is here \n');
    expect(fromA).toEqual({
      id: fromA.id,
      household_id: hidA,
      member_id: memberA,
      body: 'The engineer is here',
      created_at: fromA.created_at,
      reactions: [],
    });
    const fromB = await B().sendMessage(hidA, 'Thanks, I will put the kettle on');
    expect(fromB).toMatchObject({ household_id: hidA, member_id: memberB, reactions: [] });
    expect(instantOf(fromB.created_at)).toBeGreaterThan(instantOf(fromA.created_at));

    const page = await B().listMessages(hidA);
    expect(page).toEqual({ messages: [fromA, fromB], hasMore: false });
    expect(await A().listMessages(hidA)).toEqual(page);
    expect(await A().getMessages([fromB.id, 'tmp-1', fromA.id, fromB.id])).toEqual([fromA, fromB]);

    // TEXT_LIMITS.chatMessage, in characters as Postgres counts them: an emoji is one.
    const longest = await A().sendMessage(hidA, '🦔'.repeat(4000));
    expect(Array.from(longest.body)).toHaveLength(4000);
    for (const body of ['', '   ', '\n\t ', 'x'.repeat(4001), '🦔'.repeat(4001)]) {
      await rejectsWith(A().sendMessage(hidA, body), 'unknown', /^invalid_input: body$/);
    }
    await A().deleteMessage(longest.id);

    // C belongs to another household: A's chat is invisible and closed to them.
    await rejectsWith(C().listMessages(hidA), 'not_found');
    await rejectsWith(C().listMessages(hidA, { before: fromB.created_at }), 'not_found');
    await rejectsWith(C().sendMessage(hidA, 'Hi'), 'not_found');
    expect(await C().getMessages([fromA.id, fromB.id])).toEqual([]);
    await rejectsWith(C().setReaction(fromA.id, '👍', true), 'not_found');
    await C().setReaction(fromA.id, '👍', false);
    await rejectsWith(C().deleteMessage(fromA.id), 'not_found');

    // C's own chat starts empty and stays out of A's sight.
    expect(await C().listMessages(hidC)).toEqual({ messages: [], hasMore: false });
    const fromC = await C().sendMessage(hidC, 'Only for the shed');
    expect(fromC).toMatchObject({ household_id: hidC, member_id: memberC });
    expect(await A().getMessages([fromC.id])).toEqual([]);
    await rejectsWith(A().listMessages(hidC), 'not_found');
    await rejectsWith(A().setReaction(fromC.id, '👍', true), 'not_found');
    await rejectsWith(A().deleteMessage(fromC.id), 'not_found');

    expect(await storedMessageIds(hidA)).toEqual([fromA.id, fromB.id]);
    expect(await storedMessageIds(hidC)).toEqual([fromC.id]);
    expect(await storedReactions(fromA.id)).toEqual([]);
  });

  it('chat: pages backwards through the whole history, to the microsecond', async () => {
    const current = await storedMessageIds(hidA);
    // Older history: a regular stretch longer than two pages, two messages one microsecond
    // apart, and three sharing one created_at (as rows written in a single transaction do).
    const t = (time: string) => `2026-01-01T${time}+00:00`;
    const regular = Array.from({ length: 2 * CHAT_PAGE_SIZE + 5 }, (_, i) => ({
      member_id: i % 2 ? memberB : memberA,
      body: `History ${i + 1}`,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    }));
    const seeded = await seedMessages([
      ...regular,
      { member_id: memberA, body: 'One microsecond', created_at: t('12:00:00.000001') },
      { member_id: memberB, body: 'Then the next', created_at: t('12:00:00.000002') },
      { member_id: memberA, body: 'Before the group', created_at: t('12:30:00') },
      ...['Group 1', 'Group 2', 'Group 3'].map((body) => ({ member_id: memberB, body, created_at: t('13:00:00.5') })),
      { member_id: memberA, body: 'After the group', created_at: t('13:00:01') },
      { member_id: memberA, body: 'Later still', created_at: t('13:00:02') },
    ]);
    const seededAt = (body: string) => seeded.find((m) => m.body === body)!.created_at;
    const expected = await storedMessageIds(hidA);
    expect(expected).toHaveLength(current.length + seeded.length);
    expect(expected.slice(-current.length)).toEqual(current);

    /** Every page from the newest back, oldest page first. */
    async function readAll(limit?: number): Promise<ChatPage[]> {
      const pages: ChatPage[] = [];
      let before: string | undefined;
      for (;;) {
        const page = await B().listMessages(hidA, { before, limit });
        pages.unshift(page);
        if (!page.hasMore) return pages;
        expect(page.messages.length).toBeGreaterThan(0);
        before = page.messages[0].created_at;
      }
    }
    const ids = (pages: ChatPage[]) => pages.flatMap((p) => p.messages.map((m) => m.id));

    const pages = await readAll();
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages.at(-1)!.messages).toHaveLength(CHAT_PAGE_SIZE);
    expect(ids(pages)).toEqual(expected);
    for (const page of pages) {
      const times = page.messages.map((m) => instantOf(m.created_at));
      expect([...times].sort((x, y) => x - y)).toEqual(times);
    }
    // Tiny pages cross the microsecond pair and the shared created_at at every alignment.
    for (const limit of [1, 2, 3]) expect(ids(await readAll(limit)), `pages of ${limit}`).toEqual(expected);

    // `before` is strict and keeps its microseconds.
    expect(seededAt('Then the next')).toMatch(/\.000002\+00(:00)?$/);
    const previous = await A().listMessages(hidA, { before: seededAt('Then the next'), limit: 1 });
    expect(previous.messages.map((m) => m.body)).toEqual(['One microsecond']);
    // A page that would end inside the group stops before it; a group bigger than the page comes whole.
    const stopsShort = await A().listMessages(hidA, { before: seededAt('Later still'), limit: 3 });
    expect([stopsShort.messages.map((m) => m.body), stopsShort.hasMore]).toEqual([['After the group'], true]);
    const group = await A().listMessages(hidA, { before: seededAt('After the group'), limit: 2 });
    expect([group.messages.map((m) => m.body).sort(), group.hasMore]).toEqual([['Group 1', 'Group 2', 'Group 3'], true]);
    // The start of the chat.
    expect(await A().listMessages(hidA, { before: pages[0].messages[0].created_at })).toEqual({
      messages: [],
      hasMore: false,
    });
    await rejectsWith(A().listMessages(hidA, { before: 'yesterday-ish' }), 'unknown', /^invalid_input: before$/);
  });

  it('chat: reactions from two members, several emoji each, once each; only your own come off', async () => {
    const msg = await A().sendMessage(hidA, 'The firepit has gone to its new home');
    await A().setReaction(msg.id, '❤️', true);
    await A().setReaction(msg.id, '❤️', true); // again: still one
    await A().setReaction(msg.id, '🎉', true);
    await B().setReaction(msg.id, '❤️', true);
    await B().setReaction(msg.id, '🛠️', true); // one emoji of two code points (U+FE0F)

    let [got] = await B().getMessages([msg.id]);
    expect(got.reactions.map((r) => [r.member_id, r.emoji])).toEqual([
      [memberA, '❤️'],
      [memberA, '🎉'],
      [memberB, '❤️'],
      [memberB, '🛠️'],
    ]);
    expect(got.reactions.every((r) => r.message_id === msg.id)).toBe(true);
    // The newest page carries the same message with the same reactions.
    expect(await A().listMessages(hidA, { limit: 1 })).toEqual({ messages: [got], hasMore: true });

    // Removing touches only your own reaction.
    await B().setReaction(msg.id, '❤️', false);
    await B().setReaction(msg.id, '❤️', false); // already off
    await B().setReaction(msg.id, '🎉', false); // A's 🎉 stays
    [got] = await A().getMessages([msg.id]);
    expect(got.reactions.map((r) => [r.member_id, r.emoji])).toEqual([
      [memberA, '❤️'],
      [memberA, '🎉'],
      [memberB, '🛠️'],
    ]);
    // The database fills in the member and the message's household.
    expect(await storedReactions(msg.id)).toEqual([
      { member_id: memberA, household_id: hidA, emoji: '❤️' },
      { member_id: memberA, household_id: hidA, emoji: '🎉' },
      { member_id: memberB, household_id: hidA, emoji: '🛠️' },
    ]);

    for (const emoji of ['', '🦔'.repeat(17), '👨‍👩‍👧‍👦', '❤', 'pay rent 1234']) {
      await rejectsWith(B().setReaction(msg.id, emoji, true), 'unknown', /^invalid_input: emoji$/);
    }
    // The database refuses anything else too, for a client that skips the backend's check.
    for (const emoji of ['<b>hi</b>', '👨‍👩‍👧‍👦', '❤']) {
      const { error } = await people.b.client.from('message_reactions').insert({ message_id: msg.id, emoji });
      expect(error?.code, emoji).toBe('23514');
      expect(error?.message).toMatch(/message_reactions_emoji_allowed/);
    }
    await rejectsWith(B().setReaction(crypto.randomUUID(), '👍', true), 'not_found');
    await B().setReaction(crypto.randomUUID(), '👍', false);
    expect(await storedReactions(msg.id)).toHaveLength(3);
  });

  it('chat: members delete only their own messages, and the reactions go with them', async () => {
    const fromA = await A().sendMessage(hidA, 'Hi Bea');
    const fromB = await B().sendMessage(hidA, 'Hello from Bea');
    await A().setReaction(fromB.id, '❤️', true);
    await B().setReaction(fromA.id, '👍', true);

    await rejectsWith(A().deleteMessage(fromB.id), 'not_found');
    await rejectsWith(C().deleteMessage(fromB.id), 'not_found');
    await rejectsWith(A().deleteMessage('nope'), 'not_found');
    expect((await B().getMessages([fromA.id, fromB.id])).map((m) => m.id)).toEqual([fromA.id, fromB.id]);

    await B().deleteMessage(fromB.id); // A's reaction on it goes too
    await rejectsWith(B().deleteMessage(fromB.id), 'not_found');
    expect(await A().getMessages([fromB.id])).toEqual([]);
    expect(await storedReactions(fromB.id)).toEqual([]);

    await A().deleteMessage(fromA.id);
    expect(await storedReactions(fromA.id)).toEqual([]);
    expect(await B().getMessages([fromA.id, fromB.id])).toEqual([]);
    expect((await B().listMessages(hidA)).messages.some((m) => m.id === fromA.id || m.id === fromB.id)).toBe(false);
  });

  it('subscribeChat: a member hears messages, reactions and deletes; other households hear none of it', { timeout: 60_000 }, async () => {
    const heardB: ChatChange[] = [];
    const heardC: ChatChange[] = [];
    const stopB = B().subscribeChat(hidA, (c) => heardB.push(c));
    const stopC = C().subscribeChat(hidC, (c) => heardC.push(c));
    // C also listens to A's household with the same filters (as if C knew its id). RLS keeps
    // every INSERT from C; a DELETE notice carries the primary key only.
    type Heard = { table: string; eventType: string; new: object; old: object };
    const outsiderHeard: Heard[] = [];
    const outsider = people.c.client.channel(`chat-outsider:${hidA}:${runId}`);
    for (const table of ['messages', 'message_reactions']) {
      const filter = `household_id=eq.${hidA}`;
      outsider.on('postgres_changes', { event: '*', schema: 'public', table, filter }, (p) => outsiderHeard.push(p));
    }
    outsider.subscribe();

    const joined = (p: Person) => {
      const channels = p.client.getChannels();
      return channels.length > 0 && channels.every((c) => c.state === 'joined');
    };
    const messageEvent = (id: string, deleted: boolean) => (c: ChatChange) =>
      c.type === 'message' && c.messageId === id && c.deleted === deleted;
    const reactionEvents = (list: ChatChange[], id: string) =>
      list.filter((c) => c.type === 'reaction' && c.messageId === id).length;
    const sentInA: string[] = [];
    const sentInC: string[] = [];

    const resyncs = (list: ChatChange[]) => list.filter((c) => c.type === 'resync').length;
    try {
      expect(await waitFor(() => joined(people.b) && joined(people.c), 10_000), 'realtime channels joined').toBe(true);
      // Every join resyncs, the first included: a message posted between the first page and
      // the join is never replayed.
      expect(await waitFor(() => resyncs(heardB) === 1 && resyncs(heardC) === 1, 5000), 'the first join resyncs').toBe(true);
      // Postgres changes start flowing a moment after the join, so keep posting until one arrives.
      const until = Date.now() + 20_000;
      let flowing = false;
      for (let n = 1; !flowing && Date.now() < until; n++) {
        const warm = await A().sendMessage(hidA, `Warming up ${n}`);
        sentInA.push(warm.id);
        flowing = await waitFor(() => heardB.some(messageEvent(warm.id, false)), 1500);
      }
      expect(flowing, 'chat events heard by a member').toBe(true);

      // A's message, a reaction on and off, B's own reaction, then the delete, which takes B's
      // reaction with it. Realtime drops an INSERT whose row is gone by the time it reads it,
      // so each step waits until B has heard the previous one.
      const msg = await A().sendMessage(hidA, `Secret ${runId}`);
      sentInA.push(msg.id);
      expect(await waitFor(() => heardB.some(messageEvent(msg.id, false)), 10_000), 'B heard the message').toBe(true);
      const steps: [string, () => Promise<void>][] = [
        ['reaction', () => A().setReaction(msg.id, '👍', true)],
        ['un-reaction', () => A().setReaction(msg.id, '👍', false)],
        ['own reaction', () => B().setReaction(msg.id, '❤️', true)],
      ];
      for (const [what, step] of steps) {
        const before = reactionEvents(heardB, msg.id);
        await step();
        expect(await waitFor(() => reactionEvents(heardB, msg.id) > before, 10_000), `B heard the ${what}`).toBe(true);
      }
      const reactionsBefore = reactionEvents(heardB, msg.id);
      await A().deleteMessage(msg.id);
      expect(await waitFor(() => heardB.some(messageEvent(msg.id, true)), 10_000), 'B heard the delete').toBe(true);
      expect(
        await waitFor(() => reactionEvents(heardB, msg.id) > reactionsBefore, 10_000),
        'B heard the reaction removed with the message',
      ).toBe(true);

      // The same in C's household reaches C only.
      const fromC = await C().sendMessage(hidC, `Shed ${runId}`);
      sentInC.push(fromC.id);
      expect(await waitFor(() => heardC.some(messageEvent(fromC.id, false)), 10_000), 'C heard their message').toBe(true);
      await C().setReaction(fromC.id, '👍', true);
      expect(await waitFor(() => reactionEvents(heardC, fromC.id) > 0, 10_000), 'C heard their reaction').toBe(true);
      await C().deleteMessage(fromC.id);
      expect(await waitFor(() => heardC.some(messageEvent(fromC.id, true)), 10_000), 'C heard their delete').toBe(true);
      await sleep(1000);

      // A new subscription may first hear changes committed just before it (Realtime reads
      // the write-ahead log a little behind), here from the earlier chat tests in A's
      // household. From the first warm-up message on, B hears exactly what this test did there.
      const named = (list: ChatChange[]) => list.flatMap((c) => (c.type === 'resync' ? [] : [c.messageId]));
      const sinceWarmUp = named(heardB).slice(named(heardB).indexOf(sentInA[0]));
      expect(sinceWarmUp.filter((id) => !sentInA.includes(id)), 'B heard only its own household').toEqual([]);
      expect(named(heardC).filter((id) => sentInA.includes(id)), 'C heard nothing of A').toEqual([]);
      expect(resyncs(heardB), 'no resync without a rejoin').toBe(1);
      for (const heard of outsiderHeard) {
        expect(heard.eventType, `outsider heard ${heard.eventType} on ${heard.table}`).toBe('DELETE');
        expect(heard.new).toEqual({});
        const primaryKey = heard.table === 'messages' ? ['id'] : ['emoji', 'member_id', 'message_id'];
        expect(Object.keys(heard.old).sort()).toEqual(primaryKey);
      }

      // A dropped connection: once the channel has rejoined, B is told to resync and hears
      // changes again.
      type Socket = { close(code?: number, reason?: string): void };
      const realtime = people.b.client.realtime as unknown as { socketAdapter?: { socket?: { conn?: Socket } }; conn?: Socket };
      const socket = realtime.socketAdapter?.socket?.conn ?? realtime.conn;
      expect(socket, 'the realtime WebSocket').toBeTruthy();
      socket!.close(4000, 'test: connection dropped');
      expect(await waitFor(() => resyncs(heardB) > 1, 15_000), 'B told to resync').toBe(true);
      const rejoined = Date.now() + 20_000;
      flowing = false;
      for (let n = 1; !flowing && Date.now() < rejoined; n++) {
        const next = await A().sendMessage(hidA, `After the drop ${n}`);
        flowing = await waitFor(() => heardB.some(messageEvent(next.id, false)), 1500);
      }
      expect(flowing, 'B hears again after rejoining').toBe(true);
    } finally {
      stopB();
      stopC();
      void people.c.client.removeChannel(outsider);
    }
    // Unsubscribing removes the channel, and nothing more arrives.
    expect(await waitFor(() => people.b.client.getChannels().length === 0, 5000)).toBe(true);
    const heard = heardB.length;
    await A().sendMessage(hidA, 'After unsubscribing');
    await sleep(1000);
    expect(heardB).toHaveLength(heard);
  });

  it('signs out', async () => {
    await C().signOut();
    expect(await C().getUser()).toBeNull();
    await rejectsWith(C().getMyHouseholdId(), 'not_signed_in');
  });
});
