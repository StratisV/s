// Attempt limits for codes (sign-in and setup), in this instance's memory: a wrong guess never
// costs a Blob write, and guessing stays impractical (40-bit codes, a handful live at a time).
// Per instance, not shared: an attacker spread over many instances gets these limits on each,
// which still leaves the odds of a hit around one in ten billion per hour.
// docs/ARCHITECTURE.md "Server mode (no setup)", "Signing in".

export interface AttemptLimits {
  /** Failed attempts allowed per IP address in `windowMs`. Default 10. */
  perIp: number;
  /** Failed attempts allowed from everyone together in `windowMs`. Default 50. */
  global: number;
  /** Default 15 minutes. */
  windowMs: number;
}

export const DEFAULT_ATTEMPT_LIMITS: AttemptLimits = { perIp: 10, global: 50, windowMs: 15 * 60_000 };

/** At most this many addresses are remembered; past it the oldest go first. */
const MAX_TRACKED_IPS = 10_000;

export class AttemptLimiter {
  /** Failure times (ms) per address, oldest first, at most limits.perIp each. */
  private byIp = new Map<string, number[]>();
  /** Everyone's failure times (ms), oldest first, at most limits.global. */
  private all: number[] = [];

  constructor(
    readonly limits: AttemptLimits = DEFAULT_ATTEMPT_LIMITS,
    readonly now: () => number = Date.now,
  ) {}

  /** Drops failures that left the window. */
  private prune(at: number) {
    const since = at - this.limits.windowMs;
    while (this.all.length && this.all[0] <= since) this.all.shift();
    for (const [ip, times] of this.byIp) {
      while (times.length && times[0] <= since) times.shift();
      if (!times.length) this.byIp.delete(ip);
    }
  }

  /** Seconds until the oldest of `times` leaves the window, when `times` holds `limit` or more; else 0. */
  private wait(times: number[] | undefined, limit: number, at: number): number {
    if (!times || times.length < Math.max(1, limit)) return 0;
    const freeAt = times[times.length - Math.max(1, limit)] + this.limits.windowMs;
    return Math.max(1, Math.ceil((freeAt - at) / 1000));
  }

  /**
   * Seconds until `ip` may try a code again (its own failures, or everyone's), 0 when it may
   * now. Checked before a code is looked at; while blocked the request is 429
   * 'too_many_attempts' with Retry-After, and the code is not tried (or counted).
   */
  blockedFor(ip: string): number {
    const at = this.now();
    this.prune(at);
    return Math.max(this.wait(this.byIp.get(ip), this.limits.perIp, at), this.wait(this.all, this.limits.global, at));
  }

  /** Counts a failed attempt from `ip` (sliding window). Successes are not counted. */
  fail(ip: string): void {
    const at = this.now();
    this.prune(at);
    let times = this.byIp.get(ip);
    if (!times) {
      if (this.byIp.size >= MAX_TRACKED_IPS) this.byIp.delete(this.byIp.keys().next().value as string);
      times = [];
      this.byIp.set(ip, times);
    }
    times.push(at);
    if (times.length > Math.max(1, this.limits.perIp)) times.shift();
    this.all.push(at);
    if (this.all.length > Math.max(1, this.limits.global)) this.all.shift();
  }

  /** Dev and tests (POST /__homeos/reset). */
  reset(): void {
    this.byIp.clear();
    this.all = [];
  }
}
