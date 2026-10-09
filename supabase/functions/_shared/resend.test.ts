import { describe, expect, it } from 'vitest';
import { RESEND_URL, sendEmail } from './resend.ts';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { calls, impl };
}

const message = {
  to: 'shea@example.com',
  subject: 'home.os weekly: 21 Alderbrook Road',
  html: '<p>Hi</p>',
  text: 'Hi',
};
const config = { apiKey: 're_test_123', from: 'home.os <home@example.com>' };

describe('sendEmail (Resend)', () => {
  it('POSTs the message as JSON with the API key', async () => {
    const { calls, impl } = fakeFetch(200, { id: 'email-1' });
    const result = await sendEmail(message, config, impl);

    expect(result).toEqual({ ok: true, status: 200, id: 'email-1' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(RESEND_URL);
    expect(RESEND_URL).toBe('https://api.resend.com/emails');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({
      Authorization: 'Bearer re_test_123',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      from: 'home.os <home@example.com>',
      to: ['shea@example.com'],
      subject: 'home.os weekly: 21 Alderbrook Road',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
  });

  it('sends an idempotency key when given one', async () => {
    const { calls, impl } = fakeFetch(200, { id: 'email-2' });
    await sendEmail(message, config, impl, { idempotencyKey: 'weekly/m-1/2026-10-12' });
    expect((calls[0].init.headers as Record<string, string>)['Idempotency-Key']).toBe('weekly/m-1/2026-10-12');
  });

  it('posts to RESEND_API_URL instead when one is configured', async () => {
    const { calls, impl } = fakeFetch(200, { id: 'email-3' });
    await sendEmail(message, { ...config, url: 'http://127.0.0.1:9999/emails' }, impl);
    expect(calls[0].url).toBe('http://127.0.0.1:9999/emails');
  });

  it("reports Resend's error message when refused", async () => {
    const { impl } = fakeFetch(422, { statusCode: 422, name: 'validation_error', message: 'Invalid `to` field.' });
    expect(await sendEmail(message, config, impl)).toEqual({ ok: false, status: 422, error: 'Invalid `to` field.' });
  });

  it('copes with a response that is not JSON', async () => {
    const { impl } = fakeFetch(502, 'Bad gateway');
    expect(await sendEmail(message, config, impl)).toEqual({ ok: false, status: 502, error: 'HTTP 502' });
  });
});
