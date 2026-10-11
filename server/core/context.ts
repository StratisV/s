// Builds the ServerContext both entries use: configFromEnv(env) (with the entry's overrides),
// new HomeStore(blobs, { path: config.blobPath, budget: config.budget }), two AttemptLimiters
// (codes, and device keys this instance did not know), and node:crypto for randomness
// (randomBytes, randomUUID). One per function instance (module scope), so its HomeStore cache
// and limiters live as long as the instance.

import { randomBytes, randomUUID } from 'node:crypto';
import type { BlobStore } from '../store/types';
import { configFromEnv } from './config';
import type { ServerContext } from './handler';
import { HomeStore } from './homeStore';
import { AttemptLimiter, DEFAULT_KEY_MISS_LIMITS, type AttemptLimits } from './limits';

export interface ContextOptions {
  blobs: BlobStore;
  env: Record<string, string | undefined>;
  /** Vercel: true; the local server: false (http://localhost). */
  secureCookies: boolean;
  /** The local server's --attempts; default DEFAULT_ATTEMPT_LIMITS. */
  attempts?: AttemptLimits;
}

export function createServerContext(opts: ContextOptions): ServerContext {
  const config = { ...configFromEnv(opts.env), secureCookies: opts.secureCookies };
  if (opts.attempts) config.attempts = { ...opts.attempts };
  return {
    config,
    store: new HomeStore(opts.blobs, { path: config.blobPath, budget: config.budget }),
    limiter: new AttemptLimiter(config.attempts),
    keyMisses: new AttemptLimiter(DEFAULT_KEY_MISS_LIMITS),
    deps: {
      now: () => new Date(),
      randomBytes: (n) => new Uint8Array(randomBytes(n)),
      newId: () => randomUUID(),
    },
  };
}
