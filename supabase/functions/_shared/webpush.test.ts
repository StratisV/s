import { createECDH, createPublicKey, randomBytes, verify } from 'node:crypto';
import ece from 'http_ece';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PUSH_HOSTS,
  MAX_PAYLOAD_BYTES,
  base64UrlDecode,
  base64UrlEncode,
  encryptPayload,
  generateVapidKeys,
  isAllowedPushEndpoint,
  sendWebPush,
  vapidAuthorization,
  vapidJwt,
  type PushSubscriptionKeys,
  type VapidKeys,
} from './webpush.ts';

/** A browser-side subscription whose private key we hold, so we can decrypt. */
function browser(endpoint = 'https://fcm.googleapis.com/fcm/send/abc123') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const subscription: PushSubscriptionKeys = {
    endpoint,
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: auth.toString('base64url'),
  };
  const decrypt = (body: Uint8Array) =>
    ece
      .decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ecdh, authSecret: auth })
      .toString('utf8');
  return { subscription, decrypt };
}

function decodeJwtPart(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(part)));
}

async function vapidKeys(): Promise<VapidKeys> {
  return { ...(await generateVapidKeys()), subject: 'mailto:home@example.com' };
}

describe('base64url', () => {
  it('round-trips bytes and accepts standard base64 with padding', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = base64UrlEncode(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect([...base64UrlDecode(encoded)]).toEqual([...bytes]);
    expect([...base64UrlDecode(Buffer.from(bytes).toString('base64'))]).toEqual([...bytes]);
  });
});

describe('encryptPayload (RFC 8291 aes128gcm)', () => {
  it('produces a body that an independent implementation (http_ece) decrypts', async () => {
    const { subscription, decrypt } = browser();
    const text = JSON.stringify({ title: 'Due tomorrow', body: 'Kitchen paper · Kitchen', url: 'https://x', tag: 'reminder:1' });
    const body = await encryptPayload(text, subscription);
    expect(decrypt(body)).toBe(text);
  });

  it('round-trips unicode and payloads up to the size limit', async () => {
    const { subscription, decrypt } = browser();
    const emoji = '🦔 Stratis · Thu 5 Nov · Jacuzzi ';
    expect(decrypt(await encryptPayload(emoji, subscription))).toBe(emoji);

    const big = 'x'.repeat(MAX_PAYLOAD_BYTES);
    const body = await encryptPayload(big, subscription);
    expect(body.length).toBeLessThanOrEqual(4096);
    expect(decrypt(body)).toBe(big);

    await expect(encryptPayload(big + 'x', subscription)).rejects.toThrow(/limit/);
  });

  it('writes the aes128gcm header: salt, record size 4096, 65-byte sender key', async () => {
    const { subscription } = browser();
    const salt = new Uint8Array(16).fill(7);
    const body = await encryptPayload('hi', subscription, { salt });
    expect([...body.slice(0, 16)]).toEqual([...salt]);
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(body[21]).toBe(0x04);
    // header (86) + plaintext (2) + delimiter (1) + GCM tag (16)
    expect(body.length).toBe(86 + 2 + 1 + 16);
  });

  it('uses a fresh key pair and salt for every message', async () => {
    const { subscription, decrypt } = browser();
    const a = await encryptPayload('same', subscription);
    const b = await encryptPayload('same', subscription);
    expect(Buffer.from(a.slice(0, 86)).equals(Buffer.from(b.slice(0, 86)))).toBe(false);
    expect(decrypt(a)).toBe('same');
    expect(decrypt(b)).toBe('same');
  });

  it('rejects malformed subscription keys', async () => {
    const { subscription } = browser();
    await expect(encryptPayload('x', { ...subscription, p256dh: 'AAAA' })).rejects.toThrow(/p256dh/);
    await expect(encryptPayload('x', { ...subscription, auth: 'AAAA' })).rejects.toThrow(/auth/);
  });
});

describe('VAPID', () => {
  it('generates keys in the web-push format', async () => {
    const keys = await generateVapidKeys();
    const pub = base64UrlDecode(keys.publicKey);
    expect(pub.length).toBe(65);
    expect(pub[0]).toBe(0x04);
    expect(base64UrlDecode(keys.privateKey).length).toBe(32);
  });

  it('signs an ES256 JWT that verifies with the public key, with the right claims', async () => {
    const vapid = await vapidKeys();
    const now = new Date('2026-10-08T07:00:00Z');
    const jwt = await vapidJwt('https://web.push.apple.com/QGuQyavXutnMH8?x=1', vapid, now);
    const [h, p, s] = jwt.split('.');

    expect(decodeJwtPart(h)).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = decodeJwtPart(p);
    expect(claims.aud).toBe('https://web.push.apple.com');
    expect(claims.sub).toBe('mailto:home@example.com');
    const nowSec = Math.floor(now.getTime() / 1000);
    expect(claims.exp).toBe(nowSec + 12 * 3600);
    expect((claims.exp as number) - nowSec).toBeLessThanOrEqual(24 * 3600);

    // WebCrypto verification with the raw public key.
    const signature = base64UrlDecode(s);
    expect(signature.length).toBe(64);
    const key = await crypto.subtle.importKey(
      'raw',
      base64UrlDecode(vapid.publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const data = new TextEncoder().encode(`${h}.${p}`);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, data)).toBe(true);

    // A tampered payload does not verify.
    const forged = new TextEncoder().encode(`${h}.${base64UrlEncode(new TextEncoder().encode('{"aud":"x"}'))}`);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, forged)).toBe(false);
  });

  it('accepts keys made the way the web-push package makes them (Node ECDH, base64url)', async () => {
    // Find a private key with a leading zero byte so the 31-byte form (zeros dropped) is covered too.
    let ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    for (let i = 0; i < 5000 && ecdh.getPrivateKey()[0] !== 0; i++) {
      ecdh = createECDH('prime256v1');
      ecdh.generateKeys();
    }
    const d = ecdh.getPrivateKey();
    const privateKey = (d[0] === 0 ? d.subarray(1) : d).toString('base64url');
    const publicKey = ecdh.getPublicKey().toString('base64url');
    const vapid: VapidKeys = { publicKey, privateKey, subject: 'https://home.example.com' };

    const jwt = await vapidJwt('https://updates.push.services.mozilla.com/wpush/v2/abc', vapid);
    const [h, p, s] = jwt.split('.');
    const nodeKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: ecdh.getPublicKey().subarray(1, 33).toString('base64url'),
        y: ecdh.getPublicKey().subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
    const ok = verify('sha256', Buffer.from(`${h}.${p}`), { key: nodeKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
    expect(ok).toBe(true);
    expect(decodeJwtPart(p).aud).toBe('https://updates.push.services.mozilla.com');
  });

  it('builds the Authorization header as "vapid t=<jwt>, k=<public key>"', async () => {
    const vapid = await vapidKeys();
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/x', vapid);
    expect(header).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(header.endsWith(`, k=${vapid.publicKey}`)).toBe(true);
  });

  it('rejects malformed VAPID keys', async () => {
    const vapid = await vapidKeys();
    await expect(vapidJwt('https://x.example', { ...vapid, publicKey: 'AAAA' })).rejects.toThrow(/VAPID_PUBLIC_KEY/);
    await expect(
      vapidJwt('https://x.example', { ...vapid, privateKey: base64UrlEncode(new Uint8Array(40)) }),
    ).rejects.toThrow(/VAPID_PRIVATE_KEY/);
  });
});

describe('sendWebPush', () => {
  function fakeFetch(status: number, text = '') {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(text, { status });
    };
    return { calls, impl };
  }

  it('POSTs the encrypted payload with the Web Push headers', async () => {
    const { subscription, decrypt } = browser('https://fcm.googleapis.com/fcm/send/dev-1');
    const vapid = await vapidKeys();
    const { calls, impl } = fakeFetch(201);
    const payload = JSON.stringify({ title: 'Missed: Heaters', body: 'Was due Tue 6 Oct · Hallway', url: 'https://app', tag: 'missed:1' });

    const result = await sendWebPush(subscription, payload, vapid, impl);

    expect(result).toEqual({ status: 201, ok: true, gone: false, detail: undefined });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(subscription.endpoint);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.TTL).toBe('86400');
    expect(headers.Urgency).toBe('normal');
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    const jwt = /t=([^,]+)/.exec(headers.Authorization)![1];
    expect(decodeJwtPart(jwt.split('.')[1]).aud).toBe('https://fcm.googleapis.com');
    expect(decrypt(init.body as Uint8Array)).toBe(payload);
  });

  it('honours ttl and urgency options', async () => {
    const { subscription } = browser();
    const { calls, impl } = fakeFetch(201);
    await sendWebPush(subscription, 'x', await vapidKeys(), impl, { ttl: 60, urgency: 'high' });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.TTL).toBe('60');
    expect(headers.Urgency).toBe('high');
  });

  it('maps 410 and 404 to gone, other errors to not ok', async () => {
    const { subscription } = browser();
    const vapid = await vapidKeys();
    expect(await sendWebPush(subscription, 'x', vapid, fakeFetch(410, 'push subscription has unsubscribed or expired').impl)).toEqual({
      status: 410,
      ok: false,
      gone: true,
      detail: 'push subscription has unsubscribed or expired',
    });
    expect((await sendWebPush(subscription, 'x', vapid, fakeFetch(404).impl)).gone).toBe(true);
    const r = await sendWebPush(subscription, 'x', vapid, fakeFetch(403, 'BadJwtToken').impl);
    expect(r).toEqual({ status: 403, ok: false, gone: false, detail: 'BadJwtToken' });
    expect((await sendWebPush(subscription, 'x', vapid, fakeFetch(500).impl)).gone).toBe(false);
  });
});

describe('push endpoint allowlist', () => {
  it('accepts the endpoints real browsers hand out', () => {
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bH',
      'https://fcm.googleapis.com/wp/dQw4w9WgXcQ',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABh',
      'https://web.push.apple.com/QGuQyavXutnMH8',
      'https://api.push.apple.com/3/device/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=BQYAAA',
      'https://FCM.googleapis.com:443/fcm/send/x',
    ]) {
      expect(isAllowedPushEndpoint(endpoint), endpoint).toBe(true);
    }
  });

  it('refuses everything else', () => {
    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com:8443/fcm/send/x',
      'https://user:pass@fcm.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com.evil.example/fcm/send/x',
      'https://evilfcm.googleapis.com/x',
      'https://push.apple.com/x',
      'https://notify.windows.com/x',
      'https://xnotify.windows.com/x',
      'https://permanently-removed.invalid/fcm/send/x',
      'https://127.0.0.1/x',
      'https://169.254.169.254/latest/meta-data/',
      'http://kong:8000/functions/v1/scheduler',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'not a url',
      '',
    ]) {
      expect(isAllowedPushEndpoint(endpoint), endpoint).toBe(false);
    }
  });

  it('takes its own list of hosts', () => {
    expect(isAllowedPushEndpoint('https://push.example.com/a', ['push.example.com'])).toBe(true);
    expect(isAllowedPushEndpoint('https://a.push.example.com/a', ['*.push.example.com'])).toBe(true);
    expect(isAllowedPushEndpoint('https://push.example.com/a', ['*.push.example.com'])).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/a', ['push.example.com'])).toBe(false);
    expect(DEFAULT_PUSH_HOSTS).toContain('fcm.googleapis.com');
  });
});

describe('sendWebPush: untrusted endpoints and time limits', () => {
  it('never contacts an endpoint outside the allowlist and reports it as gone', async () => {
    const vapid = await vapidKeys();
    for (const endpoint of ['http://127.0.0.1:54321/rest/v1/', 'https://push.example.com/x', 'file:///etc/passwd']) {
      const { subscription } = browser(endpoint);
      const calls: string[] = [];
      const result = await sendWebPush(subscription, 'x', vapid, async (url) => {
        calls.push(url);
        return new Response('', { status: 201 });
      });
      expect(result).toEqual({ status: 0, ok: false, gone: true, detail: 'endpoint is not a known push service' });
      expect(calls).toEqual([]);
    }
  });

  it('allowedHosts replaces the default list', async () => {
    const { subscription } = browser('https://push.example.com/dev-1');
    const calls: string[] = [];
    const result = await sendWebPush(
      subscription,
      'x',
      await vapidKeys(),
      async (url) => {
        calls.push(url);
        return new Response('', { status: 201 });
      },
      { allowedHosts: ['push.example.com'] },
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['https://push.example.com/dev-1']);
  });

  it('does not follow redirects: a 3xx is a failed send, not a delivery', async () => {
    const { subscription } = browser();
    let init: RequestInit | undefined;
    const result = await sendWebPush(subscription, 'x', await vapidKeys(), async (_url, i) => {
      init = i;
      return new Response('', { status: 307, headers: { Location: 'http://169.254.169.254/' } });
    });
    expect(init?.redirect).toBe('manual');
    expect(result).toMatchObject({ status: 307, ok: false, gone: false });
  });

  it('gives up after timeoutMs, and when its signal aborts', async () => {
    const { subscription } = browser();
    const vapid = await vapidKeys();
    const waitForAbort = async (_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        const signal = init.signal as AbortSignal;
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    const started = Date.now();
    await expect(sendWebPush(subscription, 'x', vapid, waitForAbort, { timeoutMs: 30 })).rejects.toThrow(/timeout|aborted/i);
    expect(Date.now() - started).toBeLessThan(5000);

    const stop = new AbortController();
    const pending = sendWebPush(subscription, 'x', vapid, waitForAbort, { signal: stop.signal });
    stop.abort(new Error('the run reached its deadline'));
    await expect(pending).rejects.toThrow('the run reached its deadline');
  });
});
