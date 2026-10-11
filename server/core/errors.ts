// Errors as the API sends them (src/lib/backend/serverApi.ts: ApiErrorCode, API_ERROR_STATUS).

import type { ApiErrorCode } from '../../src/lib/backend/serverApi';

/** An error with its wire code. `retryAfter` (seconds) goes out as Retry-After (too_many_attempts). */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string = code,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Any error as an ApiError: ApiError as it is; BackendError by its code ('unknown' with a
 * message starting 'invalid_input' → 'invalid_input' with that message; 'unknown' otherwise
 * → 'unknown'; 'network' never comes from DemoBackend); BlobUnavailableError → 'unavailable';
 * anything else → 'unknown' (its message is logged, never sent).
 *
 * SKELETON: not implemented yet.
 */
export function toApiError(_err: unknown): ApiError {
  throw new Error('toApiError: not implemented yet');
}
