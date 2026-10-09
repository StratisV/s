import { describe, expect, it } from 'vitest';
import { isAuthorized, timingSafeEqual } from './auth.ts';

describe('isAuthorized', () => {
  const secret = 'f3a9c1d2e4b5a6978877665544332211';

  it('accepts the bearer secret', () => {
    expect(isAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(isAuthorized(`bearer ${secret}`, secret)).toBe(true);
    expect(isAuthorized(`  Bearer   ${secret}  `, secret)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isAuthorized(null, secret)).toBe(false);
    expect(isAuthorized('', secret)).toBe(false);
    expect(isAuthorized(secret, secret)).toBe(false);
    expect(isAuthorized(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorized(`Bearer ${secret.slice(1)}`, secret)).toBe(false);
    expect(isAuthorized(`Basic ${secret}`, secret)).toBe(false);
  });

  it('rejects everything when no secret is configured', () => {
    expect(isAuthorized('Bearer ', '')).toBe(false);
    expect(isAuthorized('Bearer x', undefined)).toBe(false);
  });
});

describe('timingSafeEqual', () => {
  it('compares strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'ab')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
    expect(timingSafeEqual('🦔', '🦆')).toBe(false);
  });
});
