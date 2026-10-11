// Node's http request and response ↔ ApiRequest and ApiResponse, for both entries (Vercel's
// Node launcher hands over IncomingMessage and ServerResponse, with shouldAddHelpers false).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError } from '../core/errors';
import type { ApiRequest, ApiResponse } from '../core/handler';

/** The first value of a header (Node joins most repeated headers already). */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}

/** The client's address: behind Vercel's proxy, x-real-ip, else the first of x-forwarded-for. */
function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const real = first(req.headers['x-real-ip'])?.trim();
    if (real) return real;
    const forwarded = first(req.headers['x-forwarded-for'])?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

/**
 * Reads the request (the body as UTF-8; past `maxBytes`, which is SETUP_BODY_MAX, it stops
 * reading and rejects with ApiError('too_large'), for errorResponse()). `trustProxy` (Vercel): the IP from x-real-ip, else the first of
 * x-forwarded-for; else the socket's address.
 */
export function readRequest(req: IncomingMessage, opts: { maxBytes: number; trustProxy: boolean }): Promise<ApiRequest> {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(req.headers)) headers[name.toLowerCase()] = first(value);
  const base = { method: req.method ?? 'GET', url: req.url ?? '/', headers, ip: clientIp(req, opts.trustProxy) };
  const declared = Number(headers['content-length']);
  if (Number.isFinite(declared) && declared > opts.maxBytes) {
    req.resume();
    return Promise.reject(new ApiError('too_large', 'Too large'));
  }
  return new Promise<ApiRequest>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const onData = (chunk: Buffer | string) => {
      if (done) return;
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      size += buf.length;
      if (size > opts.maxBytes) {
        done = true;
        req.off('data', onData);
        // Let the rest go by without keeping it, so the answer can still be sent.
        req.resume();
        reject(new ApiError('too_large', 'Too large'));
        return;
      }
      chunks.push(buf);
    };
    req.on('data', onData);
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve({ ...base, body: Buffer.concat(chunks).toString('utf8') });
    });
    req.on('error', (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

export function writeResponse(res: ServerResponse, response: ApiResponse): void {
  res.statusCode = response.status;
  for (const [name, value] of Object.entries(response.headers)) res.setHeader(name, value);
  res.setHeader('Content-Length', Buffer.byteLength(response.body, 'utf8'));
  res.end(response.body);
}
