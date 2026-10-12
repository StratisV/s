import { describe, expect, it } from 'vitest';
import { API_PATH } from '../../src/lib/backend/serverApi';
import { USER_DEMO_DOC } from '../../src/lib/logic/importHome.fixture';
import { createHarness, TEST_SETUP_CODE, type Browser, type Harness } from '../testing/harness';
import { hashPassword, passwordMatches } from './auth';

async function call(browser: Browser, op: string, body?: Record<string, unknown>) {
  const res = body
    ? await browser.fetch(API_PATH, {
        method: 'POST',
        headers: { 'X-HomeOS': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, ...body }),
      })
    : await browser.fetch(`${API_PATH}?op=${op}`, { headers: { 'X-HomeOS': '1' } });
  return { status: res.status, json: (await res.json()) as any };
}

/** Stratis's phone brings the home online (Shea not joined yet). */
async function online(h: Harness) {
  const phone = h.browser();
  const setup = await call(phone, 'setup', { code: TEST_SETUP_CODE, phone: JSON.stringify(USER_DEMO_DOC) });
  expect(setup.status).toBe(200);
  return { phone, hid: setup.json.entry.householdId as string };
}

const members = async (b: Browser, hid: string) => (await call(b, 'rpc', { method: 'load', args: [hid] })).json.result.members as any[];

describe('passwords', () => {
  it('are kept only as a salted hash that checks', () => {
    const deps = { randomBytes: (n: number) => new Uint8Array(n).map((_, i) => i) };
    const stored = hashPassword('kitchen-duck', deps);
    expect(stored).toMatch(/^scrypt\$/);
    expect(stored).not.toContain('kitchen-duck');
    expect(passwordMatches('kitchen-duck', stored)).toBe(true);
    expect(passwordMatches('kitchen-Duck', stored)).toBe(false);
    expect(passwordMatches('kitchen-duck', 'nonsense')).toBe(false);
  });
});

describe('Create Account and Sign In', () => {
  it('Shea creates her account and is the Shea already in the home; then signs in anywhere with it', async () => {
    const h = createHarness();
    const { hid } = await online(h);
    const shea = h.browser();
    const made = await call(shea, 'signUp', { name: ' shea ', email: 'Shea@Example.com', password: 'hedgehog1' });
    expect(made.status).toBe(200);
    expect(made.json.entry.status).toBe('claimed');
    expect(made.json.user.name).toBe('Shea');
    const people = await members(shea, hid);
    expect(people.filter((m) => m.name === 'Shea')).toHaveLength(1);
    expect(people.find((m) => m.name === 'Shea')).toMatchObject({ email: 'shea@example.com' });
    expect(people.find((m) => m.name === 'Shea').user_id).not.toBeNull();

    const laptop = h.browser();
    expect((await call(laptop, 'signIn', { email: 'shea@example.com', password: 'wrong-one' })).json.error.code).toBe('invalid_code');
    const back = await call(laptop, 'signIn', { email: 'SHEA@example.com', password: 'hedgehog1' });
    expect(back.status).toBe(200);
    expect(back.json.user.name).toBe('Shea');
    expect((await call(laptop, 'session')).json.user.name).toBe('Shea');
    // The password never comes back in anything a browser gets.
    for (const b of [shea, laptop]) expect(b.bodies.join('')).not.toContain('hedgehog1');
  });

  it('Stratis, who brought the home online, makes an account for himself and keeps his place', async () => {
    const h = createHarness();
    const { hid } = await online(h);
    const phone2 = h.browser();
    const made = await call(phone2, 'signUp', { name: 'Stratis', email: 'stratis@example.com', password: 'duckduck' });
    expect(made.status).toBe(200);
    expect(made.json.entry.status).toBe('member');
    const people = await members(phone2, hid);
    expect(people.filter((m) => m.name === 'Stratis')).toHaveLength(1);
    expect(people.find((m) => m.name === 'Stratis').role).toBe('owner');
  });

  it('someone new gets their own profile in the same home', async () => {
    const h = createHarness();
    const { phone, hid } = await online(h);
    const maria = h.browser();
    const made = await call(maria, 'signUp', { name: 'Maria', email: 'maria@example.com', password: 'cleaning' });
    expect(made.status).toBe(200);
    expect(made.json.entry.status).toBe('claimed');
    const seenByStratis = await members(phone, hid);
    expect(seenByStratis.find((m) => m.name === 'Maria')).toMatchObject({ role: 'member', email: 'maria@example.com' });
    expect(seenByStratis.find((m) => m.name === 'Maria').user_id).not.toBeNull();
  });

  it('refuses a taken email, a short password, a bad email and a missing name', async () => {
    const h = createHarness();
    await online(h);
    const a = h.browser();
    expect((await call(a, 'signUp', { name: 'Shea', email: 'shea@example.com', password: 'hedgehog1' })).status).toBe(200);
    const b = h.browser();
    expect((await call(b, 'signUp', { name: 'Other', email: 'SHEA@example.com', password: 'whatever1' })).json.error.code).toBe('email_taken');
    expect((await call(b, 'signUp', { name: 'Other', email: 'o@example.com', password: '123' })).json.error.code).toBe('invalid_input');
    expect((await call(b, 'signUp', { name: 'Other', email: 'not-an-email', password: '123456' })).json.error.code).toBe('invalid_input');
    expect((await call(b, 'signUp', { name: ' ', email: 'o@example.com', password: '123456' })).json.error.code).toBe('invalid_input');
    expect((await call(b, 'signIn', { email: 'nobody@example.com', password: '123456' })).json.error.code).toBe('invalid_code');
    expect((await call(b, 'session')).status).toBe(401);
  });

  it('limits password guessing', async () => {
    const h = createHarness();
    await online(h);
    expect((await call(h.browser(), 'signUp', { name: 'Shea', email: 'shea@example.com', password: 'hedgehog1' })).status).toBe(200);
    const guesser = h.browser({ ip: '10.9.9.9' });
    let last = '';
    for (let i = 0; i < 12; i++) last = (await call(guesser, 'signIn', { email: 'shea@example.com', password: `guess${i}xx` })).json.error.code;
    expect(last).toBe('too_many_attempts');
  });
});
