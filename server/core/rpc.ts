// The RPC allow-list's argument checks: what {op:'rpc'} accepts for each method in
// RPC_METHODS (src/lib/backend/serverApi.ts) before the DemoBackend method of the same name runs
// as the caller (runAs). The checks here are about shape and type only; the data rules (lengths
// after trimming, names, membership, dates in the future, kinds) are DemoBackend's, so the
// server says exactly what demo mode says. docs/ARCHITECTURE.md "Server mode (no setup)",
// "The RPC allow-list".
//
// Rules for every check: `args` is an array no longer than the method's specs (trailing
// optional ones may be missing); a value that fails is BackendError('unknown',
// 'invalid_input: <path>'), e.g. 'invalid_input: args[1].rag'; objects are rebuilt with only
// their listed keys and any other key is refused; strings are never trimmed or changed here.
//
import { HOUSEKEEPING_PRICE_MAX_PENCE } from '../../src/lib/constants';
import { BackendError } from '../../src/lib/backend/types';
import type { DemoBackend } from '../../src/lib/backend/demo';
import type { RpcMethod } from '../../src/lib/backend/serverApi';

/** Longest string any argument may be (characters); DemoBackend then applies the real limit. */
export const TEXT_CAP = 20_000;
/** Longest id (DemoBackend's are uuids; anything longer names nothing). */
export const ID_MAX = 100;

export type ArgSpec =
  /** A string of 1 to ID_MAX characters. */
  | { t: 'id' }
  /** A string of at most TEXT_CAP characters (may be empty or blank: DemoBackend decides). */
  | { t: 'text' }
  | { t: 'bool' }
  /** A real calendar day, YYYY-MM-DD. */
  | { t: 'date' }
  /** An ISO 8601 timestamp with a zone that Date.parse reads. */
  | { t: 'timestamp' }
  /** A whole number from min to max. */
  | { t: 'int'; min: number; max: number }
  | { t: 'enum'; of: readonly string[] }
  /** An array of ids, at most `max`. */
  | { t: 'ids'; max: number }
  /** An array of at most `max` values, each checked by `of`. */
  | { t: 'list'; of: ArgSpec; max: number }
  /** The value, or null. */
  | { t: 'nullable'; of: ArgSpec }
  /** May be missing (undefined; in an object, the key absent). */
  | { t: 'optional'; of: ArgSpec }
  /** An object with only these keys (each checked by its spec; 'optional' ones may be absent). */
  | { t: 'object'; keys: Record<string, ArgSpec> }
  /** Exactly one of these object specs matches (HousekeepingTickTarget). */
  | { t: 'oneOf'; of: ArgSpec[] }
  /** Exactly this string. */
  | { t: 'literal'; value: string };

const id: ArgSpec = { t: 'id' };
const text: ArgSpec = { t: 'text' };
const bool: ArgSpec = { t: 'bool' };
const date: ArgSpec = { t: 'date' };
const opt = (of: ArgSpec): ArgSpec => ({ t: 'optional', of });
const nullable = (of: ArgSpec): ArgSpec => ({ t: 'nullable', of });

const KIND: ArgSpec = { t: 'enum', of: ['task', 'state'] };
const RAG: ArgSpec = { t: 'enum', of: ['red', 'amber', 'green'] };
const REPEAT: ArgSpec = { t: 'enum', of: ['none', 'weekly', 'monthly', 'quarterly', 'biannual', 'yearly'] };
const NOTIFY: ArgSpec = { t: 'enum', of: ['none', 'same_day', 'day_before', 'week_before'] };

/** ItemDraft: every key required. */
const ITEM_DRAFT: ArgSpec = {
  t: 'object',
  keys: {
    area_id: id,
    kind: KIND,
    title: text,
    note: text,
    good: text,
    rag: RAG,
    due_date: nullable(date),
    assignee_id: nullable(id),
    repeat: REPEAT,
    notify: NOTIFY,
  },
};
/** ItemPatch: any of ItemDraft's keys. */
const ITEM_PATCH: ArgSpec = {
  t: 'object',
  keys: Object.fromEntries(
    Object.entries((ITEM_DRAFT as Extract<ArgSpec, { t: 'object' }>).keys).map(([key, spec]) => [key, opt(spec)]),
  ),
};

/**
 * arrangeHousekeepingTasks' groups: at most 100 (a household has at most 31: no section and
 * HOUSEKEEPING_SECTIONS_MAX sections), each a section id or null and at most 500 task ids
 * (HOME_ROW_LIMITS allows 200 tasks). DemoBackend checks that they name every task once.
 */
const TASK_GROUPS: ArgSpec = {
  t: 'list',
  max: 100,
  of: { t: 'object', keys: { sectionId: nullable(id), taskIds: { t: 'ids', max: 500 } } },
};

/**
 * The argument specs of every allowed method, in the order the method takes them. Notes:
 * - updateMember: only name and emoji (weekly email and push are not in server mode).
 * - addPerson: email must be '' (or absent): no Google emails in server mode.
 * - listMessages: limit 1 to 999, like Supabase's cap; before a timestamp.
 * - reorderAreas: at most 500 ids; reorderHousekeepingSections: at most 100; getMessages: at most 1000.
 * - createHousekeepingTask: its section may be null or left out (no section).
 */
export const RPC_ARGS: { [M in RpcMethod]: ArgSpec[] } = {
  getMyHouseholdId: [],
  load: [id],
  updateHousehold: [id, { t: 'object', keys: { name: opt(text), address: opt(text), timezone: opt(text) } }],
  updateMember: [id, { t: 'object', keys: { name: opt(text), emoji: opt(text) } }],
  addPerson: [id, { t: 'object', keys: { name: text, emoji: text, email: opt({ t: 'literal', value: '' }) } }],
  removePerson: [id],
  createArea: [id, text],
  renameArea: [id, text],
  deleteArea: [id],
  reorderAreas: [id, { t: 'ids', max: 500 }],
  createItem: [id, ITEM_DRAFT],
  updateItem: [id, ITEM_PATCH],
  deleteItem: [id],
  completeItem: [id],
  undoCompletion: [id],
  listMessages: [
    id,
    opt({ t: 'object', keys: { before: opt(nullable({ t: 'timestamp' })), limit: opt({ t: 'int', min: 1, max: 999 }) } }),
  ],
  getMessages: [{ t: 'ids', max: 1000 }],
  sendMessage: [id, text],
  deleteMessage: [id],
  setReaction: [id, text, bool],
  setHousekeepingNote: [id, text],
  undoClearHousekeepingNote: [id],
  createHousekeepingTask: [id, text, opt(nullable(id))],
  renameHousekeepingTask: [id, text],
  deleteHousekeepingTask: [id],
  arrangeHousekeepingTasks: [id, TASK_GROUPS],
  createHousekeepingSection: [id, text],
  renameHousekeepingSection: [id, text],
  deleteHousekeepingSection: [id],
  reorderHousekeepingSections: [id, { t: 'ids', max: 100 }],
  setHousekeepingTaskDone: [
    id,
    date,
    { t: 'oneOf', of: [{ t: 'object', keys: { taskId: id } }, { t: 'object', keys: { visitTaskId: id } }] },
    bool,
  ],
  saveHousekeepingVisit: [
    id,
    date,
    {
      t: 'object',
      keys: {
        comments: opt(text),
        price_pence: opt(nullable({ t: 'int', min: 0, max: HOUSEKEEPING_PRICE_MAX_PENCE })),
      },
    },
  ],
  addHousekeepingVisit: [id, date],
  deleteHousekeepingVisit: [id],
};

/** Whether `method` is in the allow-list (an own key of RPC_ARGS, so never 'constructor' and the like). */
export function isRpcMethod(method: unknown): method is RpcMethod {
  return typeof method === 'string' && Object.prototype.hasOwnProperty.call(RPC_ARGS, method);
}

function refuse(path: string): BackendError {
  return new BackendError('unknown', `invalid_input: ${path}`);
}

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** A real calendar day, YYYY-MM-DD. */
function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  return d <= [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** An ISO 8601 timestamp with a zone (as Postgres and DemoBackend read them). */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** A plain object as JSON.parse makes them (not an array, not null). */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

/** `value` checked against `spec` and rebuilt; throws refuse(path). Never called with spec 'optional' for a missing value. */
function check(spec: ArgSpec, value: unknown, path: string): unknown {
  switch (spec.t) {
    case 'id':
      if (typeof value !== 'string' || value.length < 1 || value.length > ID_MAX) throw refuse(path);
      return value;
    case 'text':
      if (typeof value !== 'string' || value.length > TEXT_CAP) throw refuse(path);
      return value;
    case 'bool':
      if (typeof value !== 'boolean') throw refuse(path);
      return value;
    case 'date':
      if (!isDate(value)) throw refuse(path);
      return value;
    case 'timestamp':
      if (typeof value !== 'string' || !TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) throw refuse(path);
      return value;
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < spec.min || value > spec.max) throw refuse(path);
      return value;
    case 'enum':
      if (typeof value !== 'string' || !spec.of.includes(value)) throw refuse(path);
      return value;
    case 'ids':
      if (!Array.isArray(value) || value.length > spec.max) throw refuse(path);
      return value.map((v, i) => check({ t: 'id' }, v, `${path}[${i}]`));
    case 'list':
      if (!Array.isArray(value) || value.length > spec.max) throw refuse(path);
      return value.map((v, i) => check(spec.of, v, `${path}[${i}]`));
    case 'nullable':
      return value === null ? null : check(spec.of, value, path);
    case 'optional':
      return value === undefined ? undefined : check(spec.of, value, path);
    case 'literal':
      if (value !== spec.value) throw refuse(path);
      return value;
    case 'object': {
      if (!isPlainObject(value)) throw refuse(path);
      for (const key of Object.keys(value)) {
        if (!own(spec.keys, key)) throw refuse(`${path}.${key}`);
      }
      const out: Record<string, unknown> = {};
      for (const [key, keySpec] of Object.entries(spec.keys)) {
        const present = own(value, key) && value[key] !== undefined;
        if (!present) {
          if (keySpec.t === 'optional') continue;
          throw refuse(`${path}.${key}`);
        }
        out[key] = check(keySpec, value[key], `${path}.${key}`);
      }
      return out;
    }
    case 'oneOf': {
      const matches: unknown[] = [];
      for (const option of spec.of) {
        try {
          matches.push(check(option, value, path));
        } catch {
          /* not this one */
        }
      }
      if (matches.length !== 1) throw refuse(path);
      return matches[0];
    }
  }
}

/** `args` checked against RPC_ARGS[method] and rebuilt (see the top of this file). Throws BackendError('unknown', 'invalid_input: …'). */
export function validateArgs(method: RpcMethod, args: unknown): unknown[] {
  if (!isRpcMethod(method)) throw refuse('method');
  const specs = RPC_ARGS[method];
  if (!Array.isArray(args) || args.length > specs.length) throw refuse('args');
  const out: unknown[] = [];
  specs.forEach((spec, i) => {
    const value = i < args.length ? args[i] : undefined;
    if (value === undefined) {
      if (spec.t !== 'optional') throw refuse(`args[${i}]`);
      return;
    }
    out[i] = check(spec, value, `args[${i}]`);
  });
  // No holes: a missing optional argument in the middle is passed as undefined.
  return Array.from({ length: out.length }, (_, i) => out[i]);
}

/** Calls the DemoBackend method `method` with the checked `args`. */
export function runRpc(backend: DemoBackend, method: RpcMethod, args: unknown[]): Promise<unknown> {
  if (!isRpcMethod(method)) return Promise.reject(refuse('method'));
  const fn = backend[method] as unknown as (...a: unknown[]) => Promise<unknown>;
  return fn.apply(backend, args);
}
