import type { IncomingMessage, ServerResponse } from 'node:http';
import * as blob from '@vercel/blob';
import { SETUP_BODY_MAX } from '../../src/lib/backend/serverApi';
import { createServerContext } from '../core/context';
import { errorResponse, handleApi, type ApiResponse } from '../core/handler';
import { VercelBlobStore } from '../store/vercel';
import { readRequest, writeResponse } from './node';

process.env.VERCEL_BLOB_RETRIES ??= '2';
const ctx = createServerContext({ blobs: new VercelBlobStore(blob), env: process.env, secureCookies: true });

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let response: ApiResponse;
  try {
    response = await handleApi(await readRequest(req, { maxBytes: SETUP_BODY_MAX, trustProxy: true }), ctx);
  } catch (err) {
    response = errorResponse(err);
  }
  writeResponse(res, response);
}
