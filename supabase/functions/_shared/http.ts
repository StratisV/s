// Outbound request helpers shared by the push and email senders.

/** Default time limit for one outbound request (connect, send and read the answer). */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * An AbortSignal that fires after `timeoutMs`, or earlier when `signal` (for example the
 * scheduler run's deadline) aborts. Pass it to fetch: it also covers reading the body.
 */
export function requestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(1, timeoutMs));
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
