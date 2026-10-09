// Sends one email through Resend's HTTP API (https://resend.com/docs/api-reference/emails).

import { REQUEST_TIMEOUT_MS, requestSignal } from './http.ts';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface ResendConfig {
  apiKey: string;
  /** "home.os <home@yourdomain.com>" (the domain must be verified in Resend). */
  from: string;
  /** Endpoint override (RESEND_API_URL), for a local fake while testing. Default RESEND_URL. */
  url?: string;
}

export interface SendEmailOptions {
  /**
   * Resend ignores a repeat with the same key for 24 hours, so a retry after a timeout
   * (where the first attempt may have gone through) does not send twice.
   */
  idempotencyKey?: string;
  /** Time limit for the request in ms. Default REQUEST_TIMEOUT_MS (10 s). */
  timeoutMs?: number;
  /** Aborts the request early (the scheduler passes its run deadline). */
  signal?: AbortSignal;
}

export interface SendEmailResult {
  ok: boolean;
  status: number;
  /** Resend's email id when accepted. */
  id?: string;
  /** Resend's error message when refused. */
  error?: string;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export const RESEND_URL = 'https://api.resend.com/emails';

/**
 * Never throws for HTTP errors (the result says what happened); throws for a network
 * failure, the time limit or an abort.
 */
export async function sendEmail(
  message: EmailMessage,
  config: ResendConfig,
  fetchImpl: FetchLike = fetch,
  options: SendEmailOptions = {},
): Promise<SendEmailResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey.slice(0, 256);

  const res = await fetchImpl(config.url || RESEND_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: config.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
    signal: requestSignal(options.timeoutMs ?? REQUEST_TIMEOUT_MS, options.signal),
  });

  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  if (res.ok) {
    return { ok: true, status: res.status, id: typeof data.id === 'string' ? data.id : undefined };
  }
  const error = typeof data.message === 'string' ? data.message : `HTTP ${res.status}`;
  return { ok: false, status: res.status, error };
}
