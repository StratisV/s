// Errors as the API sends them (src/lib/backend/serverApi.ts: ApiErrorCode, API_ERROR_STATUS).

import type { ApiErrorCode } from '../../src/lib/backend/serverApi';
import { BackendError } from '../../src/lib/backend/types';
import { BlobUnavailableError } from '../store/types';

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
 */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof BackendError) {
    switch (err.code) {
      case 'not_signed_in':
      case 'not_found':
      case 'home_exists':
      case 'already_member':
      case 'email_taken':
      case 'invalid_invite':
      case 'invalid_code':
      case 'too_many_attempts':
      case 'read_only':
        return new ApiError(err.code, err.message || err.code);
      case 'network':
        return new ApiError('unavailable');
      case 'unknown':
      default:
        return err.message.startsWith('invalid_input') ? new ApiError('invalid_input', err.message) : new ApiError('unknown');
    }
  }
  if (err instanceof BlobUnavailableError) return new ApiError('unavailable');
  return new ApiError('unknown');
}
