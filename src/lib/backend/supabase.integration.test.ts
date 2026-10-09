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
import type { Area, CreateHouseholdInput, HouseholdData, ItemDraft, PushSubscriptionInput } from '../types';
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
      p_items: input.items.map(({ area, title, note, rag, due_in_days, repeat, notify }) => ({
        area,
        title,
        note,
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
      title: ' Bleed the radiators ',
      note: '',
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
    const handlers: { type: string; filter: Record<string, string>; cb: () => void }[] = [];
    let status: (s: string) => void = () => {};
    const channel = {
      on: vi.fn((type: string, filter: Record<string, string>, cb: () => void) => {
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
    // First join: nothing missed. A rejoin after a dropped connection: reload.
    rt.setStatus('SUBSCRIBED');
    expect(onChange).toHaveBeenCalledTimes(1);
    rt.setStatus('CHANNEL_ERROR');
    rt.setStatus('SUBSCRIBED');
    expect(onChange).toHaveBeenCalledTimes(2);

    stop();
    stop();
    expect(rt.client.removeChannel).toHaveBeenCalledTimes(1);
    expect(rt.client.removeChannel).toHaveBeenCalledWith(rt.channel);
    rt.handlers[0].cb();
    expect(onChange).toHaveBeenCalledTimes(2);
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
    title: 'Test item',
    note: '',
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
        note: seed.note,
        rag: seed.rag,
        repeat: seed.repeat,
        notify: seed.notify,
        status: 'open',
        assignee_id: null,
        due_date: seed.due_in_days === null ? null : addDays(today, seed.due_in_days),
      });
    }
    expect(data.completions).toEqual([]);

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
    const hidC = await C().createHousehold({
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

    // Another account on the same browser takes the endpoint over.
    await B().savePushSubscription(memberB, { endpoint, keys: { p256dh: 'p3', auth: 'a3' } });
    expect(await rows()).toEqual([{ member_id: memberB, user_id: people.b.userId, p256dh: 'p3', auth: 'a3' }]);

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
      // Postgres changes start flowing a moment after the join, so keep editing until one arrives.
      const until = Date.now() + 20_000;
      for (let n = 1; changes === 0 && Date.now() < until; n++) {
        await B().renameArea(data.areas[0].id, `Renamed ${runId} ${n}`);
        await waitFor(() => changes > 0, 1500);
      }
      expect(changes, 'postgres_changes events heard by a member').toBeGreaterThan(0);

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

  it('signs out', async () => {
    await C().signOut();
    expect(await C().getUser()).toBeNull();
    await rejectsWith(C().getMyHouseholdId(), 'not_signed_in');
  });
});
