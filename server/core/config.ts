// The server's settings, from the environment. docs/ARCHITECTURE.md "Server mode (no setup)",
// "Settings". Nothing here is ever sent to a browser or logged.

import { isSetupCode, normaliseCode } from '../../src/lib/backend/serverApi';
import { googleClientIdOf, googlePeopleOf } from './google';
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
  /** HOMEOS_GOOGLE_CLIENT_ID (googleClientIdOf): Continue with Google is on when set. */
  googleClientId: string | null;
  /** HOMEOS_GOOGLE_PEOPLE (googlePeopleOf): who in the household each Google email is, by name. */
  googlePeople: Record<string, string>;
  /**
   * The VAPID keys phone notifications are sent with (pushKeysOf): HOMEOS_VAPID_PUBLIC_KEY,
   * HOMEOS_VAPID_PRIVATE_KEY and HOMEOS_VAPID_SUBJECT. Null when any is missing or malformed:
   * Profile then says notifications aren't set up, and the morning run sends nothing. Only the
   * public key ever leaves the server (GET ?op=notify).
   */
  push: PushKeys | null;
  /**
   * CRON_SECRET (16 or more characters): Vercel sends it as `Authorization: Bearer <secret>`
   * with every cron request, and the morning run (GET ?op=tick) answers nothing else. Null:
   * the run is off (403).
   */
  cronSecret: string | null;
}

/** The server's VAPID key pair in the web-push format (base64url), and who it is from. */
export interface PushKeys {
  /** 65-byte uncompressed P-256 point. */
  publicKey: string;
  /** 32-byte private scalar. */
  privateKey: string;
  /** "mailto:…" or an https URL: the contact push services see. */
  subject: string;
}

const B64URL = /^[A-Za-z0-9_-]+$/;

function bytesOf(value: string): Buffer | null {
  return B64URL.test(value) ? Buffer.from(value, 'base64url') : null;
}

/**
 * The VAPID keys from the environment, or null (with one warning that says which is wrong,
 * never a value) when they are missing or malformed. HOMEOS_VAPID_SUBJECT defaults to the
 * deployment's production address (https://<VERCEL_PROJECT_PRODUCTION_URL>) when unset.
 */
export function pushKeysOf(env: Record<string, string | undefined>): PushKeys | null {
  const publicKey = (env.HOMEOS_VAPID_PUBLIC_KEY ?? '').trim();
  const privateKey = (env.HOMEOS_VAPID_PRIVATE_KEY ?? '').trim();
  const production = (env.VERCEL_PROJECT_PRODUCTION_URL ?? '').trim();
  const subject = (env.HOMEOS_VAPID_SUBJECT ?? '').trim() || (production ? `https://${production}` : '');
  if (!publicKey && !privateKey) return null;
  const point = bytesOf(publicKey);
  const scalar = bytesOf(privateKey);
  let wrong: string | null = null;
  if (!point || point.length !== 65 || point[0] !== 0x04) wrong = 'HOMEOS_VAPID_PUBLIC_KEY is not a P-256 public key (base64url, 65 bytes)';
  else if (!scalar || scalar.length < 30 || scalar.length > 32) wrong = 'HOMEOS_VAPID_PRIVATE_KEY is not a P-256 private key (base64url, 32 bytes)';
  else if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s/]+\S*)$/.test(subject)) wrong = 'HOMEOS_VAPID_SUBJECT is not a mailto: address or an https URL';
  if (wrong) {
    console.warn(`home.os: ${wrong}; phone notifications are off.`);
    return null;
  }
  return { publicKey, privateKey, subject };
}

/** CRON_SECRET when it is long enough (16 characters, as Vercel recommends), else null (warned once when set). */
export function cronSecretOf(value: string | undefined): string | null {
  const secret = (value ?? '').trim();
  if (!secret) return null;
  if (secret.length < 16) {
    console.warn('home.os: CRON_SECRET is shorter than 16 characters; the morning notifications run is off.');
    return null;
  }
  return secret;
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
 * HOMEOS_BLOB_WRITES_PER_MONTH, HOMEOS_BLOB_READS_PER_MONTH, the HOMEOS_VAPID_* keys,
 * CRON_SECRET). A budget that is not a whole number of 0 or more keeps its default.
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
    googleClientId: googleClientIdOf(env.HOMEOS_GOOGLE_CLIENT_ID),
    googlePeople: googlePeopleOf(env.HOMEOS_GOOGLE_PEOPLE),
    push: pushKeysOf(env),
    cronSecret: cronSecretOf(env.CRON_SECRET),
  };
}
