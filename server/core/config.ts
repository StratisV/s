// The server's settings, from the environment. docs/ARCHITECTURE.md "Server mode (no setup)",
// "Settings". Nothing here is ever sent to a browser or logged.

import { isSetupCode, normaliseCode } from '../../src/lib/backend/serverApi';
import { DEFAULT_ATTEMPT_LIMITS, type AttemptLimits } from './limits';
import { homeBlobPath } from './serverDoc';

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

/** A budget from the environment: a whole number of 0 or more, else the default. */
function budgetOf(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '' || !/^\d+$/.test(value.trim())) return fallback;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) ? n : fallback;
}

/**
 * From process.env on Vercel (HOMEOS_SETUP_CODE, HOMEOS_BLOB_PATH, VERCEL_ENV,
 * HOMEOS_BLOB_WRITES_PER_MONTH, HOMEOS_BLOB_READS_PER_MONTH). A budget that is not a whole
 * number of 0 or more keeps its default.
 */
export function configFromEnv(env: Record<string, string | undefined>): ServerConfig {
  const raw = env.HOMEOS_SETUP_CODE;
  const setup = typeof raw === 'string' ? normaliseCode(raw) : '';
  const setupCode = isSetupCode(setup) ? setup : null;
  if (raw && !setupCode) {
    // Says why setup will refuse every code, never the value.
    console.warn('home.os: HOMEOS_SETUP_CODE is set but is not a setup code (12 or more letters of the code alphabet); setup is off.');
  }
  return {
    setupCode,
    blobPath: homeBlobPath(env),
    secureCookies: true,
    budget: {
      writes: budgetOf(env.HOMEOS_BLOB_WRITES_PER_MONTH, DEFAULT_BUDGET.writes),
      reads: budgetOf(env.HOMEOS_BLOB_READS_PER_MONTH, DEFAULT_BUDGET.reads),
    },
    attempts: { ...DEFAULT_ATTEMPT_LIMITS },
  };
}
