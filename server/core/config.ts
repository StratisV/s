// The server's settings, from the environment. docs/ARCHITECTURE.md "Server mode (no setup)",
// "Settings". Nothing here is ever sent to a browser or logged.

import { DEFAULT_ATTEMPT_LIMITS, type AttemptLimits } from './limits';

export interface ServerConfig {
  /**
   * HOMEOS_SETUP_CODE, normalised (normaliseCode); null when unset or not isSetupCode() (then
   * setup always answers 'invalid_code' and the server logs once why).
   */
  setupCode: string | null;
  /** The home's blob path (homeBlobPath(env)). */
  blobPath: string;
  /** Mark the key cookie Secure: configFromEnv gives true; createServerContext() takes the entry's value (Vercel true, the local server false). */
  secureCookies: boolean;
  /** HOMEOS_BLOB_WRITES_PER_MONTH (default 1900) and HOMEOS_BLOB_READS_PER_MONTH (default 9000); 0 = no limit. */
  budget: { writes: number; reads: number };
  attempts: AttemptLimits;
}

export const DEFAULT_BUDGET = { writes: 1900, reads: 9000 } as const;

/**
 * From process.env on Vercel (HOMEOS_SETUP_CODE, HOMEOS_BLOB_PATH, VERCEL_ENV,
 * HOMEOS_BLOB_WRITES_PER_MONTH, HOMEOS_BLOB_READS_PER_MONTH). A budget that is not a whole
 * number of 0 or more keeps its default.
 *
 * SKELETON: not implemented yet.
 */
export function configFromEnv(_env: Record<string, string | undefined>): ServerConfig {
  void DEFAULT_ATTEMPT_LIMITS;
  throw new Error('configFromEnv: not implemented yet');
}
