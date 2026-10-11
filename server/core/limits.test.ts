import { describe, expect, it } from 'vitest';
import { AttemptLimiter, DEFAULT_ATTEMPT_LIMITS } from './limits';

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

  it('blocks everyone after 50 failures in all', () => {
    let now = 0;
    const limiter = new AttemptLimiter(DEFAULT_ATTEMPT_LIMITS, () => now);
    for (let i = 0; i < 50; i++) limiter.fail(`10.0.0.${i}`);
    expect(limiter.blockedFor('10.9.9.9')).toBeGreaterThan(0);
    now += 15 * 60_000 + 1;
    expect(limiter.blockedFor('10.9.9.9')).toBe(0);
  });

  it('forgets everything on reset', () => {
    const limiter = new AttemptLimiter({ perIp: 1, global: 5, windowMs: 60_000 }, () => 0);
    limiter.fail('a');
    expect(limiter.blockedFor('a')).toBe(60);
    limiter.reset();
    expect(limiter.blockedFor('a')).toBe(0);
  });
});
