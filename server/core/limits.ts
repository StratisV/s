// Attempt limits for codes (sign-in and setup), in this instance's memory: a wrong guess never
// costs a Blob write, and guessing stays impractical (40-bit codes, a handful live at a time).
// Per instance, not shared: an attacker spread over many instances gets these limits on each,
// which still leaves the odds of a hit around one in ten billion per hour.
// docs/ARCHITECTURE.md "Server mode (no setup)", "Signing in".
//
// SKELETON: not implemented yet.

export interface AttemptLimits {
  /** Failed attempts allowed per IP address in `windowMs`. Default 10. */
  perIp: number;
  /** Failed attempts allowed from everyone together in `windowMs`. Default 50. */
  global: number;
  /** Default 15 minutes. */
  windowMs: number;
}

export const DEFAULT_ATTEMPT_LIMITS: AttemptLimits = { perIp: 10, global: 50, windowMs: 15 * 60_000 };

export class AttemptLimiter {
  constructor(
    readonly limits: AttemptLimits = DEFAULT_ATTEMPT_LIMITS,
    readonly now: () => number = Date.now,
  ) {}

  /**
   * Seconds until `ip` may try a code again (its own failures, or everyone's), 0 when it may
   * now. Checked before a code is looked at; while blocked the request is 429
   * 'too_many_attempts' with Retry-After, and the code is not tried (or counted).
   */
  blockedFor(_ip: string): number {
    throw new Error('AttemptLimiter.blockedFor: not implemented yet');
  }

  /** Counts a failed attempt from `ip` (sliding window). Successes are not counted. */
  fail(_ip: string): void {
    throw new Error('AttemptLimiter.fail: not implemented yet');
  }

  /** Dev and tests (POST /__homeos/reset). */
  reset(): void {
    throw new Error('AttemptLimiter.reset: not implemented yet');
  }
}
