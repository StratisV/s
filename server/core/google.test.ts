import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { API_PATH } from '../../src/lib/backend/serverApi';
import { USER_DEMO_DOC } from '../../src/lib/logic/importHome.fixture';
import { createHarness, TEST_SETUP_CODE, TEST_START, type Browser, type Harness } from '../testing/harness';
import { fetchGoogleKeys, googleClientIdOf, googlePeopleOf, verifyGoogleIdToken, type GoogleJwk } from './google';

const CLIENT_ID = '1234567890-abcdefghijklmnop.apps.googleusercontent.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...(publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string }), kid: 'k1', alg: 'RS256' } as GoogleJwk;
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys = async (kid: string) => (kid === 'k1' ? JWK : null);
const NOW = new Date(TEST_START);

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

/** A Google-style ID token, signed with the test key unless `key` says otherwise. */
function idToken(claims: Record<string, unknown>, opts: { kid?: string; key?: typeof privateKey; alg?: string } = {}) {
  const head = b64({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1', typ: 'JWT' });
  const body = b64({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '1001',
    email: 'shea@example.com',
    email_verified: true,
    name: 'Shea',
    iat: Math.floor(NOW.getTime() / 1000),
    exp: Math.floor(NOW.getTime() / 1000) + 3600,
    nonce: 'n0nce',
    ...claims,
  });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(opts.key ?? privateKey);
  return `${head}.${body}.${sig.toString('base64url')}`;
}

const verifyOpts = { clientId: CLIENT_ID, nonce: 'n0nce', now: NOW, keys };

describe('Google ID tokens', () => {
  it('accepts a genuine token for this app, with its verified email in lower case', async () => {
    expect(await verifyGoogleIdToken(idToken({ email: 'Shea@Example.com' }), verifyOpts)).toEqual({ email: 'shea@example.com', name: 'Shea' });
    expect(await verifyGoogleIdToken(idToken({ iss: 'accounts.google.com', aud: [CLIENT_ID] }), verifyOpts)).not.toBeNull();
  });

  it('refuses anything else', async () => {
    const refused = [
      idToken({}, { key: other.privateKey }), // not signed by Google
      idToken({}, { kid: 'unknown' }),
      idToken({}, { alg: 'HS256' }),
      idToken({ aud: 'someone-else.apps.googleusercontent.com' }),
      idToken({ iss: 'https://evil.example' }),
      idToken({ exp: Math.floor(NOW.getTime() / 1000) - 3600 }),
      idToken({ iat: Math.floor(NOW.getTime() / 1000) + 3600 }),
      idToken({ nonce: 'another' }),
      idToken({ nonce: undefined }),
      idToken({ email_verified: false }),
      idToken({ email: undefined }),
      'not.a.token',
      '',
    ];
    for (const token of refused) expect(await verifyGoogleIdToken(token, verifyOpts)).toBeNull();
    // A token whose payload was changed after signing.
    const [h, , s] = idToken({}).split('.');
    expect(await verifyGoogleIdToken(`${h}.${b64({ email: 'x@example.com', email_verified: true })}.${s}`, verifyOpts)).toBeNull();
    // An empty nonce never matches.
    expect(await verifyGoogleIdToken(idToken({ nonce: '' }), { ...verifyOpts, nonce: '' })).toBeNull();
  });

  it('reads the settings', () => {
    expect(googleClientIdOf(` ${CLIENT_ID} `)).toBe(CLIENT_ID);
    expect(googleClientIdOf('abc')).toBeNull();
    expect(googleClientIdOf(undefined)).toBeNull();
    expect(googlePeopleOf('Stratis@Example.com=Stratis; shea@example.com = Shea, nonsense, =x')).toEqual({
      'stratis@example.com': 'Stratis',
      'shea@example.com': 'Shea',
    });
  });

  it('keeps Google’s keys as long as they say, and fetches again for a new kid', async () => {
    let fetched = 0;
    let t = 0;
    const fake = (async () => {
      fetched += 1;
      return new Response(JSON.stringify({ keys: [JWK] }), { headers: { 'cache-control': 'public, max-age=600' } });
    }) as unknown as typeof fetch;
    const get = fetchGoogleKeys(fake, () => t);
    expect(await get('k1')).toEqual(JWK);
    expect(await get('k1')).toEqual(JWK);
    expect(fetched).toBe(1);
    expect(await get('k2')).toBeNull();
    expect(fetched).toBe(2);
    t += 601_000;
    await get('k1');
    expect(fetched).toBe(3);
  });
});

// ── Continue with Google through the handler ─────────────

const GOOGLE_ENV = { HOMEOS_GOOGLE_CLIENT_ID: CLIENT_ID, HOMEOS_GOOGLE_PEOPLE: 'stratis@example.com=Stratis; shea@example.com=Shea' };

async function bringOnline(h: Harness) {
  const phone = h.browser();
  const res = await phone.fetch(API_PATH, {
    method: 'POST',
    headers: { 'X-HomeOS': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'setup', code: TEST_SETUP_CODE, phone: JSON.stringify(USER_DEMO_DOC) }),
  });
  expect(res.status).toBe(200);
}

/** Step 1 (googleStart) in `browser`: the state and nonce Google is sent. */
async function start(browser: Browser) {
  const res = await browser.fetch(`${API_PATH}?op=googleStart`, { headers: { host: 'home-os-orpin.vercel.app' } });
  expect(res.status).toBe(302);
  const to = new URL(res.headers.get('location')!);
  return { to, state: to.searchParams.get('state')!, nonce: to.searchParams.get('nonce')! };
}

/** Step 2: Google's form post back, as the browser sends it. */
async function back(browser: Browser, form: Record<string, string>) {
  const res = await browser.fetch(`${API_PATH}?op=google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  return { status: res.status, location: res.headers.get('location') };
}

async function session(browser: Browser) {
  const res = await browser.fetch(`${API_PATH}?op=session`, { headers: { 'X-HomeOS': '1' } });
  return { status: res.status, json: (await res.json()) as { user: { name: string } } };
}

describe('Continue with Google', () => {
  it('says whether it is on', async () => {
    const off = createHarness();
    expect(JSON.parse((await off.request({ method: 'GET', url: `${API_PATH}?op=status` })).body)).toMatchObject({ google: false });
    const on = createHarness({ env: GOOGLE_ENV, googleKeys: keys });
    expect(JSON.parse((await on.request({ method: 'GET', url: `${API_PATH}?op=status` })).body)).toMatchObject({ google: true });
  });

  it('sends the browser to Google for this app, then signs in the household by email, for good', async () => {
    const h = createHarness({ env: GOOGLE_ENV, googleKeys: keys });
    await bringOnline(h);
    const shea = h.browser();
    const { to, state, nonce } = await start(shea);
    expect(to.origin + to.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(to.searchParams)).toMatchObject({
      client_id: CLIENT_ID,
      redirect_uri: 'https://home-os-orpin.vercel.app/api/home?op=google',
      response_type: 'id_token',
      response_mode: 'form_post',
      scope: 'openid email profile',
    });
    expect(state.length).toBeGreaterThan(20);
    expect(nonce.length).toBeGreaterThan(20);
    const done = await back(shea, { id_token: idToken({ nonce }), state });
    expect(done).toEqual({ status: 303, location: '/' });
    expect(await session(shea)).toMatchObject({ status: 200, json: { user: { name: 'Shea' } } });

    // Next time, the email is hers: found directly, one more device for the same person.
    const laptop = h.browser();
    const again = await start(laptop);
    expect(await back(laptop, { id_token: idToken({ nonce: again.nonce }), state: again.state })).toEqual({ status: 303, location: '/' });
    expect(await session(laptop)).toMatchObject({ status: 200, json: { user: { name: 'Shea' } } });
    // Her first phone is still signed in.
    expect((await session(shea)).status).toBe(200);
  });

  it('turns away a Google account that is nobody in the home', async () => {
    const h = createHarness({ env: GOOGLE_ENV, googleKeys: keys });
    await bringOnline(h);
    const stranger = h.browser();
    const { state, nonce } = await start(stranger);
    expect(await back(stranger, { id_token: idToken({ nonce, email: 'stranger@example.com' }), state })).toEqual({
      status: 303,
      location: '/?google=not_member',
    });
    expect((await session(stranger)).status).toBe(401);
  });

  it('refuses a post without its state, with someone else’s state, or with a forged token', async () => {
    const h = createHarness({ env: GOOGLE_ENV, googleKeys: keys });
    await bringOnline(h);
    const a = h.browser();
    const mine = await start(a);
    const b = h.browser();
    const theirs = await start(b);
    // The state from another browser's sign-in.
    expect(await back(a, { id_token: idToken({ nonce: theirs.nonce }), state: theirs.state })).toEqual({ status: 303, location: '/?google=failed' });
    const again = await start(a);
    expect(await back(a, { id_token: idToken({ nonce: again.nonce }, { key: other.privateKey }), state: again.state })).toEqual({
      status: 303,
      location: '/?google=failed',
    });
    // A browser that never started one (no cookie).
    const c = h.browser();
    expect(await back(c, { id_token: idToken({ nonce: mine.nonce }), state: mine.state })).toEqual({ status: 303, location: '/?google=failed' });
    for (const x of [a, c]) expect((await session(x)).status).toBe(401);
  });

  it('is off without a Client ID', async () => {
    const h = createHarness({ googleKeys: keys });
    const res = await h.browser().fetch(`${API_PATH}?op=googleStart`);
    expect([res.status, res.headers.get('location')]).toEqual([303, '/?google=failed']);
  });
});
