// Attempt limits for codes (sign-in and setup), and for device keys this instance does not
// know, in this instance's memory: a wrong guess never costs a Blob write, and guessing stays
// impractical (40-bit codes, a handful live at a time). Per instance, not shared: an attacker
// spread over many instances gets these limits on each, which still leaves the odds of a hit
// around one in ten billion per hour. docs/ARCHITECTURE.md "Server mode (no setup)", "Signing in".
//
// - Addresses: an IPv4 address counts as itself; an IPv6 address by its /64 (one household or
//   one phone gets a whole /64, so counting single addresses would be no limit at all); an
//   IPv4 address written as IPv6 (::ffff:1.2.3.4) as the IPv4 address.
// - begin(ip) checks and counts in one synchronous step: an attempt counts as a failure from
//   the moment it starts, so a burst of attempts running at the same time is limited like the
//   same attempts one after another; the ticket's succeeded() takes it back.
// - An address that signed in successfully within the window (the home's Wi-Fi, which the whole
//   household shares) may fail `trustedPerIp` times instead of `perIp`, and is never held back
//   by others' failures.
// - `global` is not a count of failures but of addresses failing: while that many different
//   addresses have failed within the window (a guesser spread over many addresses), an
//   address that has failed itself (and is not trusted) is held until its failures leave the
//   window. An address with no failure of its own is never blocked by anyone else, so a
//   stranger can't lock the household out of joining.

export interface AttemptLimits {
  /** Failed attempts allowed per address in `windowMs`. Default 10. */
  perIp: number;
  /** Different failing addresses (in `windowMs`) at which an address that has failed is held. Default 50. */
  global: number;
  /** Default 15 minutes. */
  windowMs: number;
  /** Failed attempts allowed for an address with a successful sign-in in the window. Default 2 × perIp. */
  trustedPerIp?: number;
}

export const DEFAULT_ATTEMPT_LIMITS: AttemptLimits = { perIp: 10, global: 50, windowMs: 15 * 60_000, trustedPerIp: 20 };

/**
 * Device keys this instance did not know (ServerContext.keyMisses): past these, an unknown key
 * is not worth a read of the store (the answer is 503 'unavailable' instead). Counted apart
 * from codes, so a phone with an old key never holds up anyone's code on the same Wi-Fi.
 */
export const DEFAULT_KEY_MISS_LIMITS: AttemptLimits = { perIp: 10, global: 50, windowMs: 15 * 60_000 };

/** At most this many addresses are remembered; past it the oldest go first. */
const MAX_TRACKED_IPS = 10_000;

/** One attempt that began: a failure unless succeeded() is called. */
export interface AttemptTicket {
  /** The attempt worked: it no longer counts as a failure, and its address is trusted for the window. */
  succeeded(): void;
}

/** The address an attempt counts against: IPv4 as it is, IPv6 by its /64 (see the top). */
export function addressKey(ip: string): string {
  let a = (typeof ip === 'string' ? ip : '').trim().toLowerCase();
  if (a.startsWith('[')) a = a.slice(1, a.includes(']') ? a.indexOf(']') : undefined);
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  if (!a.includes(':')) return a || 'unknown';
  const mapped = /:ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (mapped && /^[0:]*$/.test(a.slice(0, mapped.index))) return mapped[1];
  // Expand '::' and keep the first four groups (an IPv4 tail counts as two).
  const double = a.indexOf('::');
  const split = (s: string) => (s ? s.split(':') : []).flatMap((g) => (g.includes('.') ? ['0', '0'] : [g]));
  let groups: string[];
  if (double >= 0) {
    const left = split(a.slice(0, double));
    const right = split(a.slice(double + 2));
    groups = [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  } else {
    groups = split(a);
  }
  const prefix = groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16));
  while (prefix.length < 4) prefix.push('0');
  return `${prefix.join(':')}::/64`;
}

interface Failure {
  at: number;
}

export class AttemptLimiter {
  /** Failure times per address, oldest first. */
  private byIp = new Map<string, Failure[]>();
  /** When each address last signed in successfully. */
  private trusted = new Map<string, number>();

  constructor(
    readonly limits: AttemptLimits = DEFAULT_ATTEMPT_LIMITS,
    readonly now: () => number = Date.now,
  ) {}

  private get trustedLimit(): number {
    return Math.max(1, this.limits.trustedPerIp ?? this.limits.perIp * 2);
  }

  /** Drops failures and successes that left the window. */
  private prune(at: number) {
    const since = at - this.limits.windowMs;
    for (const [ip, times] of this.byIp) {
      while (times.length && times[0].at <= since) times.shift();
      if (!times.length) this.byIp.delete(ip);
    }
    for (const [ip, t] of this.trusted) if (t <= since) this.trusted.delete(ip);
  }

  /** Seconds until the oldest of the last `limit` failures leaves the window, when there are `limit` or more; else 0. */
  private wait(times: Failure[] | undefined, limit: number, at: number): number {
    if (!times || times.length < Math.max(1, limit)) return 0;
    const freeAt = times[times.length - Math.max(1, limit)].at + this.limits.windowMs;
    return Math.max(1, Math.ceil((freeAt - at) / 1000));
  }

  /** How many different addresses (not trusted) have failed within the window. */
  private failingAddresses(): number {
    let n = 0;
    for (const key of this.byIp.keys()) if (!this.trusted.has(key)) n += 1;
    return n;
  }

  private waitFor(key: string, at: number): number {
    const times = this.byIp.get(key);
    if (this.trusted.has(key)) return this.wait(times, this.trustedLimit, at);
    const own = this.wait(times, this.limits.perIp, at);
    // Many addresses failing at once: one that has failed itself waits until its failures are gone.
    if (times?.length && this.failingAddresses() >= Math.max(1, this.limits.global)) {
      const clearAt = times[times.length - 1].at + this.limits.windowMs;
      return Math.max(own, 1, Math.ceil((clearAt - at) / 1000));
    }
    return own;
  }

  /**
   * Seconds until `ip` may try again, 0 when it may now. While blocked the request is 429
   * 'too_many_attempts' with Retry-After, and nothing is tried (or counted).
   */
  blockedFor(ip: string): number {
    const at = this.now();
    this.prune(at);
    return this.waitFor(addressKey(ip), at);
  }

  private record(key: string, at: number): Failure {
    let times = this.byIp.get(key);
    if (!times) {
      if (this.byIp.size >= MAX_TRACKED_IPS) this.byIp.delete(this.byIp.keys().next().value as string);
      times = [];
      this.byIp.set(key, times);
    }
    const failure = { at };
    times.push(failure);
    const keep = Math.max(this.limits.perIp, this.trustedLimit, 1);
    if (times.length > keep) times.shift();
    return failure;
  }

  /**
   * Checks and counts in one step, with nothing in between: `{ wait }` (seconds, more than 0)
   * when `ip` must wait, else a ticket for an attempt that counts as a failed one until its
   * succeeded() is called. Every attempt that has begun counts, so attempts sent all at once
   * are limited exactly like the same attempts one after another.
   */
  begin(ip: string): { wait: number; ticket: null } | { wait: 0; ticket: AttemptTicket } {
    const at = this.now();
    this.prune(at);
    const key = addressKey(ip);
    const wait = this.waitFor(key, at);
    if (wait > 0) return { wait, ticket: null };
    const failure = this.record(key, at);
    let settled = false;
    const ticket: AttemptTicket = {
      succeeded: () => {
        if (settled) return;
        settled = true;
        const times = this.byIp.get(key);
        const i = times ? times.indexOf(failure) : -1;
        if (times && i >= 0) {
          times.splice(i, 1);
          if (!times.length) this.byIp.delete(key);
        }
        if (this.trusted.size >= MAX_TRACKED_IPS && !this.trusted.has(key)) {
          this.trusted.delete(this.trusted.keys().next().value as string);
        }
        this.trusted.set(key, this.now());
      },
    };
    return { wait: 0, ticket };
  }

  /** Counts a failed attempt from `ip` (sliding window). */
  fail(ip: string): void {
    const at = this.now();
    this.prune(at);
    this.record(addressKey(ip), at);
  }

  /** Dev and tests (POST /__homeos/reset). */
  reset(): void {
    this.byIp.clear();
    this.trusted.clear();
  }
}
