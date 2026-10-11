import { describe, expect, it } from 'vitest';
import { addressKey, AttemptLimiter, DEFAULT_ATTEMPT_LIMITS } from './limits';

describe('AttemptLimiter', () => {
  it('lets an address try 10 wrong codes in 15 minutes, then blocks it until the oldest leaves the window', () => {
    let now = 0;
    const limiter = new AttemptLimiter(DEFAULT_ATTEMPT_LIMITS, () => now);
    for (let i = 0; i < 10; i++) {
      expect(limiter.blockedFor('1.1.1.1')).toBe(0);
      limiter.fail('1.1.1.1');
      now += 1000;
    }
    // The first failure was at 0: free again at 15:00.
    expect(limiter.blockedFor('1.1.1.1')).toBe(15 * 60 - 10);
    expect(limiter.blockedFor('2.2.2.2')).toBe(0);
    now = 15 * 60_000 + 1;
    expect(limiter.blockedFor('1.1.1.1')).toBe(0);
  });

  it('counts an attempt from the moment it begins, so attempts sent all at once are limited too', () => {
    const limiter = new AttemptLimiter({ perIp: 10, global: 50, windowMs: 60_000 }, () => 0);
    const begun = Array.from({ length: 200 }, () => limiter.begin('203.0.113.7'));
    expect(begun.filter((b) => b.ticket !== null)).toHaveLength(10);
    expect(begun.filter((b) => b.ticket === null).every((b) => b.wait === 60)).toBe(true);
  });

  it('takes an attempt that worked back, and trusts its address for the window', () => {
    let now = 0;
    const limiter = new AttemptLimiter({ perIp: 3, global: 50, windowMs: 60_000, trustedPerIp: 6 }, () => now);
    const ok = limiter.begin('192.0.2.1');
    ok.ticket!.succeeded();
    ok.ticket!.succeeded();
    // The household's Wi-Fi: someone signed in from it, so a few more slips are allowed.
    for (let i = 0; i < 6; i++) {
      expect(limiter.begin('192.0.2.1').ticket).not.toBeNull();
    }
    expect(limiter.begin('192.0.2.1').ticket).toBeNull();
    now = 60_001;
    expect(limiter.blockedFor('192.0.2.1')).toBe(0);
  });

  it('never blocks an address with no failures of its own; holds those that failed while many addresses are failing', () => {
    let now = 0;
    const limiter = new AttemptLimiter(DEFAULT_ATTEMPT_LIMITS, () => now);
    // A guesser spread over 50 addresses, one wrong code each.
    for (let i = 0; i < 50; i++) limiter.fail(`198.51.100.${i}`);
    // The household (no failures of its own) is never held up by that.
    expect(limiter.blockedFor('10.9.9.9')).toBe(0);
    expect(limiter.begin('10.9.9.9').ticket).not.toBeNull();
    // Each guessing address is held until its own failures leave the window.
    expect(limiter.blockedFor('198.51.100.7')).toBe(15 * 60);
    now += 15 * 60_000 + 1;
    expect(limiter.blockedFor('198.51.100.7')).toBe(0);
  });

  it('counts an IPv6 address by its /64, and an IPv4 address written as IPv6 as itself', () => {
    expect(addressKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:DB8::1')).toBe('2001:db8:0:0::/64');
    expect(addressKey('[2001:db8:1:2::9]')).toBe('2001:db8:1:2::/64');
    expect(addressKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(addressKey('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(addressKey('192.0.2.1')).toBe('192.0.2.1');
    expect(addressKey('')).toBe('unknown');
    const limiter = new AttemptLimiter({ perIp: 10, global: 50, windowMs: 60_000 }, () => 0);
    // Ten addresses of one /64 are one address.
    for (let i = 1; i <= 10; i++) limiter.fail(`2001:db8:1:2::${i.toString(16)}`);
    expect(limiter.blockedFor('2001:db8:1:2::ffff')).toBeGreaterThan(0);
    expect(limiter.blockedFor('2001:db8:1:3::1')).toBe(0);
  });

  it('forgets everything on reset', () => {
    const limiter = new AttemptLimiter({ perIp: 1, global: 5, windowMs: 60_000 }, () => 0);
    limiter.fail('a');
    expect(limiter.blockedFor('a')).toBe(60);
    limiter.reset();
    expect(limiter.blockedFor('a')).toBe(0);
  });
});
