// Checks the scheduler's shared secret (pg_cron sends `Authorization: Bearer <CRON_SECRET>`).

const encoder = new TextEncoder();

/** Compares in time that does not depend on where the strings differ. */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** True when `authorization` is "Bearer <secret>" (and the secret is not empty). */
export function isAuthorized(authorization: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret) return false;
  const match = /^Bearer\s+(.+)$/i.exec((authorization ?? '').trim());
  return match !== null && timingSafeEqual(match[1].trim(), secret);
}
