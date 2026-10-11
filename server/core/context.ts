// Builds the ServerContext both entries use: configFromEnv(env) (with the entry's overrides),
// new HomeStore(blobs, { path: config.blobPath, budget: config.budget }), an AttemptLimiter, and
// node:crypto for randomness (randomBytes, randomUUID). One per function instance (module
// scope), so its HomeStore cache and limiter live as long as the instance.
//
// SKELETON: not implemented yet.

import type { BlobStore } from '../store/types';
import type { AttemptLimits } from './limits';
import type { ServerContext } from './handler';

export interface ContextOptions {
  blobs: BlobStore;
  env: Record<string, string | undefined>;
  /** Vercel: true; the local server: false (http://localhost). */
  secureCookies: boolean;
  /** The local server's --attempts; default DEFAULT_ATTEMPT_LIMITS. */
  attempts?: AttemptLimits;
}

export function createServerContext(_opts: ContextOptions): ServerContext {
  throw new Error('createServerContext: not implemented yet');
}
