// The notifications' settings from the environment (./config.ts): the VAPID keys and CRON_SECRET.

import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { configFromEnv, cronSecretOf, pushKeysOf } from './config';

function vapid() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]).toString('base64url');
  return { HOMEOS_VAPID_PUBLIC_KEY: publicKey, HOMEOS_VAPID_PRIVATE_KEY: jwk.d! };
}

describe('pushKeysOf', () => {
  it('takes a key pair in the web-push format and a mailto: or https subject', () => {
    const keys = vapid();
    expect(pushKeysOf({ ...keys, HOMEOS_VAPID_SUBJECT: 'mailto:home@example.com' })).toEqual({
      publicKey: keys.HOMEOS_VAPID_PUBLIC_KEY,
      privateKey: keys.HOMEOS_VAPID_PRIVATE_KEY,
      subject: 'mailto:home@example.com',
    });
    expect(pushKeysOf({ ...keys, HOMEOS_VAPID_SUBJECT: 'https://home-os.example' })?.subject).toBe('https://home-os.example');
    // No subject: the deployment's production address.
    expect(pushKeysOf({ ...keys, VERCEL_PROJECT_PRODUCTION_URL: 'home-os.example' })?.subject).toBe('https://home-os.example');
  });

  it('is off (null) without keys, and says which setting is wrong, never its value', () => {
    expect(pushKeysOf({})).toBeNull();
    const keys = vapid();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(pushKeysOf({ ...keys, HOMEOS_VAPID_PUBLIC_KEY: 'AAAA', HOMEOS_VAPID_SUBJECT: 'mailto:a@b.co' })).toBeNull();
    expect(pushKeysOf({ ...keys, HOMEOS_VAPID_PRIVATE_KEY: 'not base64!', HOMEOS_VAPID_SUBJECT: 'mailto:a@b.co' })).toBeNull();
    expect(pushKeysOf({ ...keys, HOMEOS_VAPID_SUBJECT: 'home@example.com' })).toBeNull();
    expect(pushKeysOf({ ...keys })).toBeNull();
    expect(warn.mock.calls.map(([line]) => String(line).split(' is ')[0])).toEqual([
      'home.os: HOMEOS_VAPID_PUBLIC_KEY',
      'home.os: HOMEOS_VAPID_PRIVATE_KEY',
      'home.os: HOMEOS_VAPID_SUBJECT',
      'home.os: HOMEOS_VAPID_SUBJECT',
    ]);
    for (const [line] of warn.mock.calls) expect(String(line)).not.toContain(keys.HOMEOS_VAPID_PRIVATE_KEY);
    warn.mockRestore();
  });
});

describe('cronSecretOf', () => {
  it('takes 16 characters or more; shorter or unset turns the morning run off', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(cronSecretOf(undefined)).toBeNull();
    expect(cronSecretOf('  ')).toBeNull();
    expect(cronSecretOf('too-short')).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(cronSecretOf(' 0123456789abcdef ')).toBe('0123456789abcdef');
    expect(configFromEnv({ CRON_SECRET: '0123456789abcdef' })).toMatchObject({ cronSecret: '0123456789abcdef', push: null });
    warn.mockRestore();
  });
});
