// "Bring this home online" (server mode): the home a browser kept in demo mode (localStorage
// homeos.demo.v1) turned into the server's home document. Pure and deterministic for a given
// `now` and `newId`. The browser calls serverSetupSummary() for the setup screen, and the server
// (server/core/setup.ts) calls buildServerHome() on the same raw string, so what the screen
// promises is what comes along. docs/ARCHITECTURE.md "Server mode (no setup)", "Setup".
//
// What comes along, and what stays behind (on top of buildImportPayloadWithIds(), whose rules
// apply unchanged: the made-up Stats history stays behind, text is cut to the limits, anything
// the database would refuse is repaired or left out):
//
// - The household: name, address, time zone (an unknown zone becomes Europe/London); weekly
//   email Monday 08:00; created_at, updated_at = now; updated_by null.
// - People: `me` (the payload's) becomes the owner, signed in as `ownerUserId`, email ''.
//   Everyone else comes as not joined yet (user_id null, email '', push off, weekly email on,
//   role member), with their name, emoji and colour (MEMBER_COLORS by position when the payload
//   has none). Join order kept: created_at = now + index ms. claimed_at null for all.
//   Left behind: a person the demo made up (DemoBackend's DEMO_PEOPLE: user_id
//   `demo-user-<key>-…`) whom nothing that comes along refers to: no item assigned, created or
//   updated by them, no completion credited to or completed by them, no message or reaction
//   from them, nothing in housekeeping by them. So a demo housemate the household used (Shea,
//   with her items) comes along, and one nobody used (Ela) does not. `me` always comes along.
// - Areas in order (position 0…n-1, created_at = now + index ms).
// - Items, open and done, every field (kind, title, note, good, rag, due date, repeat, notify,
//   status, assignee, created and updated by, created, updated and completed times), each time
//   no later than now (missing: now), the kind rules applied (applyKindRules).
// - Completions: the payload's (real ones only), linked to their new items.
// - Chat: the messages written after the household was set up on the phone (created_at later
//   than the stored household's created_at; the demo's made-up conversation is dated before
//   it), body trimmed and 1 to TEXT_LIMITS.chatMessage characters (else left out), created_at a
//   timestamp no later than now (else left out), sender mapped (someone who does not come
//   along: null, "Former member"). Their reactions by people who come along, emoji one of
//   REACTION_EMOJIS, once per (message, person, emoji). At most the newest 5000 messages.
// - Housekeeping: the task list as it is (titles 1 to 200 characters, positions 0…n-1 in the
//   list's order; a document without the housekeeping_tasks key gets HOUSEKEEPING_STARTER_TASKS,
//   as DemoBackend.read() does); the message for the housekeeper if it was written after the
//   household was set up (else none: the demo's is made up), without its Clear/Undo copy; the
//   visits created after the household was set up (the demo's seeded visits are dated before),
//   one per date, never after today in the household's time zone, with their rows (task_id
//   mapped to the new task, or null), ticks, comments and price as stored, within the limits
//   (else the value is cut or, for a price, cleared). At most 2000 visits (the newest).
// - Not: invites, push subscriptions, users, the session, the `imported`/`declined` marks.
//
// Every row gets a fresh id from `newId`; nothing from the document is used as an id.

import type { DemoDoc } from '../backend/demo';
import type { ServerSetupSummary } from '../types';

export interface BuildServerHomeOptions {
  now: Date;
  /** The user id the owner signs in as (members.user_id of `me`); the server makes it. */
  ownerUserId: string;
  /** Fresh ids. Default crypto.randomUUID(). */
  newId?: () => string;
}

export interface ServerHome {
  /** The home as DemoBackend stores it, with `session` null and `users`, `invites`, `push_subs` empty. */
  home: DemoDoc;
  householdId: string;
  /** The owner's member id (`me`). */
  ownerMemberId: string;
  summary: ServerSetupSummary;
}

/**
 * The server's home from `raw` (the homeos.demo.v1 string as the browser stores it), or null
 * when it holds no home (not JSON, not version 1, no household with a person in it). Never
 * throws for any input.
 */
export function buildServerHome(_raw: string, _opts: BuildServerHomeOptions): ServerHome | null {
  throw new Error('buildServerHome: not implemented yet (docs/ARCHITECTURE.md "Server mode (no setup)", "Setup")');
}

/**
 * What "Bring this home online" shows for `raw`: buildServerHome()'s summary (same rules), or
 * null when there is nothing to bring. Ignores the document's `imported` and `declined` marks
 * (a home brought to Supabase or turned down there can still come online here). Never throws.
 */
export function serverSetupSummary(_raw: string | null, _now: Date = new Date()): ServerSetupSummary | null {
  throw new Error('serverSetupSummary: not implemented yet (docs/ARCHITECTURE.md "Server mode (no setup)", "Setup")');
}
