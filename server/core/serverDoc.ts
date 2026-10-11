// The one blob the server keeps: the home (DemoBackend's document), the sign-in data, and a
// little bookkeeping. docs/ARCHITECTURE.md "Server mode (no setup)", "The stored document".

import type { DemoDoc } from '../../src/lib/backend/demo';
import type { ISOTimestamp } from '../../src/lib/types';

export const SERVER_DOC_FORMAT = 'homeos.server/1';

/**
 * Where the home lives in the Blob store: one blob per Vercel environment, so a preview
 * deployment never touches the production home. HOMEOS_BLOB_PATH overrides it.
 */
export function homeBlobPath(env: Record<string, string | undefined>): string {
  return env.HOMEOS_BLOB_PATH || `homeos/${env.VERCEL_ENV || 'development'}/home.json`;
}

/** How many recent write ids ServerDoc.meta.writes keeps. */
export const RECENT_WRITES = 50;

export interface ServerDoc {
  format: typeof SERVER_DOC_FORMAT;
  /** 1 when the home came online; +1 with every stored change (one per put, however many writes it holds). */
  rev: number;
  /** +1 with every stored change in which the chat (messages, reactions) changed. */
  chatRev: number;
  /**
   * The home, exactly as DemoBackend stores it, at rest with `session` null and `users`,
   * `invites` and `push_subs` empty (runAs() puts the caller in for one call and takes them
   * out again). Never sent to a browser as it is: browsers get what DemoBackend's methods return.
   */
  home: DemoDoc;
  /** Server-only: never in any response. */
  auth: ServerAuth;
  meta: ServerMeta;
}

export interface ServerAuth {
  /** Signed-in browsers, in sign-in order. At most DEVICE_LIMITS.perPerson per person and DEVICE_LIMITS.perHome in all. */
  devices: DeviceRow[];
  /** Live sign-in codes, at most one per person (a new one replaces it). Expired ones are pruned on every write. */
  codes: CodeRow[];
}

export interface DeviceRow {
  /** Public id (uuid), as DeviceInfo.id. */
  id: string;
  /** SHA-256 of the device key (base64url of 32 random bytes), base64url. The key itself is never stored. */
  keyHash: string;
  /** The person's user id: members[].user_id of whoever this browser is signed in as. */
  userId: string;
  /** deviceLabel(user agent) when it signed in, at most 60 characters. */
  label: string;
  createdAt: ISOTimestamp;
}

export interface CodeRow {
  id: string;
  /** SHA-256 of the normalised code (normaliseCode(), 8 letters), hex. The code itself is never stored. */
  codeHash: string;
  /** Who it signs in as (a member id; joined or not). */
  memberId: string;
  /** The member who made it (null when they are gone). */
  createdBy: string | null;
  createdAt: ISOTimestamp;
  /** createdAt + CODE_TTL_MS. */
  expiresAt: ISOTimestamp;
}

export interface ServerMeta {
  /** When the home came online (setup). */
  createdAt: ISOTimestamp;
  /**
   * The ids of the last RECENT_WRITES stored puts, newest last. Each put adds a fresh random id
   * before it is sent; when a put fails with a conflict, the writer re-reads and, if its own id
   * is in there, its put did land (the SDK retried after a lost reply): it does not apply the
   * batch again.
   */
  writes: string[];
  /** Blob operations this UTC month, for the budget (docs: "Budget"). Approximate: reads are counted per instance and added with the next put. */
  usage: { month: string; puts: number; reads: number };
}

/** The UTC month of `at`, as ServerMeta.usage.month: "2026-10". */
export function usageMonth(at: Date): string {
  return at.toISOString().slice(0, 7);
}

/** A new document for a home that is coming online (setup): rev 1, chatRev 1, no devices or codes yet. */
export function newServerDoc(home: DemoDoc, now: Date): ServerDoc {
  return {
    format: SERVER_DOC_FORMAT,
    rev: 1,
    chatRev: 1,
    home: { ...home, session: null, users: [], invites: [], push_subs: [] },
    auth: { devices: [], codes: [] },
    meta: { createdAt: now.toISOString(), writes: [], usage: { month: usageMonth(now), puts: 0, reads: 0 } },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** The DemoDoc lists the server relies on (DemoBackend fills in the rest as it reads). */
const HOME_LISTS = [
  'users',
  'households',
  'members',
  'areas',
  'items',
  'completions',
  'invites',
  'push_subs',
  'messages',
  'message_reactions',
  'housekeeping_notes',
  'housekeeping_tasks',
  'housekeeping_visits',
  'housekeeping_visit_tasks',
] as const;

/** The stored body as a ServerDoc; throws when it is not one (wrong format or shape). */
export function parseServerDoc(body: string): ServerDoc {
  const doc: unknown = JSON.parse(body);
  if (!isRecord(doc) || doc.format !== SERVER_DOC_FORMAT) throw new Error('not a home.os server document');
  if (!isCount(doc.rev) || doc.rev < 1 || !isCount(doc.chatRev)) throw new Error('server document: bad rev');
  const home = doc.home;
  if (!isRecord(home) || home.version !== 1 || !HOME_LISTS.every((key) => Array.isArray(home[key]))) {
    throw new Error('server document: bad home');
  }
  const auth = doc.auth;
  if (!isRecord(auth) || !Array.isArray(auth.devices) || !Array.isArray(auth.codes)) throw new Error('server document: bad auth');
  const meta = doc.meta;
  if (
    !isRecord(meta) ||
    typeof meta.createdAt !== 'string' ||
    !Array.isArray(meta.writes) ||
    !isRecord(meta.usage) ||
    typeof meta.usage.month !== 'string' ||
    !isCount(meta.usage.puts) ||
    !isCount(meta.usage.reads)
  ) {
    throw new Error('server document: bad meta');
  }
  return doc as unknown as ServerDoc;
}

/** The body to store (JSON). */
export function serialiseServerDoc(doc: ServerDoc): string {
  return JSON.stringify(doc);
}

/** The chat part of the home, as a string to compare before and after a write (chatRev). */
export function chatFingerprint(home: DemoDoc): string {
  return JSON.stringify([home.messages ?? [], home.message_reactions ?? []]);
}
