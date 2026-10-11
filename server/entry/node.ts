// Node's http request and response ↔ ApiRequest and ApiResponse, for both entries (Vercel's
// Node launcher hands over IncomingMessage and ServerResponse, with shouldAddHelpers false).
//
// SKELETON: not implemented yet.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRequest, ApiResponse } from '../core/handler';

/**
 * Reads the request (the body as UTF-8; past `maxBytes`, which is SETUP_BODY_MAX, it stops
 * reading and rejects with ApiError('too_large'), for errorResponse()). `trustProxy` (Vercel): the IP from x-real-ip, else the first of
 * x-forwarded-for; else the socket's address.
 */
export function readRequest(_req: IncomingMessage, _opts: { maxBytes: number; trustProxy: boolean }): Promise<ApiRequest> {
  throw new Error('readRequest: not implemented yet');
}

export function writeResponse(_res: ServerResponse, _response: ApiResponse): void {
  throw new Error('writeResponse: not implemented yet');
}
