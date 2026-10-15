import { describe, expect, it } from 'vitest';
import { RPC_METHODS, type RpcMethod } from '../../src/lib/backend/serverApi';
import { BackendError } from '../../src/lib/backend/types';
import { newItemDraft } from '../../src/lib/logic/items';
import { ID_MAX, RPC_ARGS, TEXT_CAP, isRpcMethod, validateArgs } from './rpc';

const H = '6f1c6b1e-6a47-4b7a-9d3c-7b0f6a1f2a10';
const ID = '0b9e6f5a-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
const DRAFT = { ...newItemDraft(ID), title: 'Bleed the radiators' };

/** What the app really sends for each method (HomeProvider, ChatProvider, the screens). */
const REAL: { [M in RpcMethod]: unknown[][] } = {
  getMyHouseholdId: [[]],
  load: [[H]],
  updateHousehold: [[H, { name: 'Our home' }], [H, { address: '21 Alderbrook Road', timezone: 'Europe/London' }]],
  updateMember: [[ID, { emoji: '🦆' }], [ID, { name: 'Shea', emoji: '🦔' }]],
  addPerson: [[H, { name: 'Ela', emoji: '🦊', email: '' }], [H, { name: 'Ela', emoji: '🦊' }]],
  removePerson: [[ID]],
  createArea: [[H, 'Garage']],
  renameArea: [[ID, 'Garden Lounge']],
  deleteArea: [[ID]],
  reorderAreas: [[H, [ID, H]]],
  createItem: [[H, DRAFT], [H, { ...DRAFT, kind: 'state', due_date: null, repeat: 'none', notify: 'none', assignee_id: ID }]],
  updateItem: [[ID, { title: 'New' }], [ID, { due_date: null }], [ID, { kind: 'state', due_date: null, repeat: 'none', notify: 'none' }], [ID, {}]],
  deleteItem: [[ID]],
  completeItem: [[ID]],
  undoCompletion: [[ID]],
  listMessages: [[H], [H, { before: '2026-10-09T08:19:00.000Z' }], [H, { before: '2026-10-09T08:19:00+01:00', limit: 50 }], [H, {}]],
  getMessages: [[[ID, H]], [[]]],
  sendMessage: [[H, 'Hello']],
  deleteMessage: [[ID]],
  setReaction: [[ID, '👍', true], [ID, '👍', false]],
  setHousekeepingNote: [[H, 'Please do the windows'], [H, '']],
  undoClearHousekeepingNote: [[H]],
  createHousekeepingTask: [[H, 'Windows'], [H, 'Windows', ID], [H, 'Windows', null]],
  renameHousekeepingTask: [[ID, 'Windows inside']],
  deleteHousekeepingTask: [[ID]],
  moveHousekeepingTask: [[ID, H, 0], [ID, null, 3]],
  // Sent only by the app from before sections (still open on a phone after an update).
  reorderHousekeepingTasks: [[H, [ID]]],
  createHousekeepingSection: [[H, 'Kitchen']],
  renameHousekeepingSection: [[ID, 'Kitchen and dining']],
  deleteHousekeepingSection: [[ID]],
  moveHousekeepingSection: [[ID, 0], [ID, 2]],
  setHousekeepingTaskDone: [[H, '2026-10-09', { taskId: ID }, true], [H, '2026-10-02', { visitTaskId: ID }, false]],
  saveHousekeepingVisit: [[H, '2026-10-09', { comments: 'Lovely' }], [H, '2026-10-09', { price_pence: 4500 }], [H, '2026-10-09', { price_pence: null }]],
  addHousekeepingVisit: [[H, '2026-10-01']],
  deleteHousekeepingVisit: [[ID]],
};

function refused(method: RpcMethod, args: unknown, path?: string) {
  try {
    validateArgs(method, args);
  } catch (err) {
    expect(err).toBeInstanceOf(BackendError);
    expect((err as BackendError).code).toBe('unknown');
    expect((err as BackendError).message).toBe(`invalid_input: ${path ?? (err as BackendError).message.slice('invalid_input: '.length)}`);
    return (err as BackendError).message;
  }
  throw new Error(`${method} accepted ${JSON.stringify(args)}`);
}

describe('the RPC allow-list', () => {
  it('has argument checks for exactly the allowed methods', () => {
    expect(Object.keys(RPC_ARGS).sort()).toEqual(Object.keys(RPC_METHODS).sort());
  });

  it('accepts what the app sends, as JSON carries it', () => {
    for (const [method, calls] of Object.entries(REAL) as [RpcMethod, unknown[][]][]) {
      for (const args of calls) {
        const wire = JSON.parse(JSON.stringify(args));
        expect(validateArgs(method, wire), `${method} ${JSON.stringify(args)}`).toEqual(wire);
      }
    }
  });

  it('knows no method outside the list, however it is named', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'signInWithGoogle', 'importHousehold', 'createInvite', 'setPersonEmail', 'enterHome', '', 42, null]) {
      expect(isRpcMethod(name)).toBe(false);
    }
    expect(isRpcMethod('load')).toBe(true);
  });

  it('refuses wrong types, with the path of what was wrong', () => {
    refused('load', [42], 'args[0]');
    refused('load', [''], 'args[0]');
    refused('load', ['x'.repeat(ID_MAX + 1)], 'args[0]');
    refused('load', [], 'args[0]');
    refused('load', [H, H], 'args');
    refused('load', 'not an array', 'args');
    refused('createArea', [H, 7], 'args[1]');
    refused('createArea', [H, 'x'.repeat(TEXT_CAP + 1)], 'args[1]');
    refused('setReaction', [ID, '👍', 'yes'], 'args[2]');
    refused('createItem', [H, { ...DRAFT, rag: 'purple' }], 'args[1].rag');
    refused('createItem', [H, { ...DRAFT, kind: 'project' }], 'args[1].kind');
    refused('createItem', [H, { ...DRAFT, repeat: 'daily' }], 'args[1].repeat');
    refused('createItem', [H, { ...DRAFT, notify: 'hourly' }], 'args[1].notify');
    refused('createItem', [H, { ...DRAFT, due_date: '2026-02-30' }], 'args[1].due_date');
    refused('createItem', [H, { ...DRAFT, due_date: '9 Oct' }], 'args[1].due_date');
    refused('createItem', [H, { ...DRAFT, assignee_id: 5 }], 'args[1].assignee_id');
    const { note: _note, ...withoutNote } = DRAFT;
    refused('createItem', [H, withoutNote], 'args[1].note');
    refused('updateItem', [ID, { status: 'done' }], 'args[1].status');
    refused('updateItem', [ID, null], 'args[1]');
    refused('updateItem', [ID, [1]], 'args[1]');
    refused('listMessages', [H, { limit: 1000 }], 'args[1].limit');
    refused('listMessages', [H, { limit: 2.5 }], 'args[1].limit');
    refused('listMessages', [H, { before: 'yesterday' }], 'args[1].before');
    refused('listMessages', [H, null], 'args[1]');
    refused('getMessages', [Array.from({ length: 1001 }, () => ID)], 'args[0]');
    refused('getMessages', [[ID, 3]], 'args[0][1]');
    refused('reorderAreas', [H, Array.from({ length: 501 }, () => ID)], 'args[1]');
    refused('saveHousekeepingVisit', [H, '2026-10-09', { price_pence: -1 }], 'args[2].price_pence');
    refused('saveHousekeepingVisit', [H, '2026-10-09', { price_pence: 1_000_001 }], 'args[2].price_pence');
    refused('saveHousekeepingVisit', [H, '2026-10-09', { price_pence: '45' }], 'args[2].price_pence');
  });

  it('refuses keys it does not list, including ones that try to reach the prototype', () => {
    refused('updateMember', [ID, { weekly_email: false }], 'args[1].weekly_email');
    refused('updateMember', [ID, { push_enabled: true }], 'args[1].push_enabled');
    refused('updateHousehold', [H, { weekly_email_day: 3 }], 'args[1].weekly_email_day');
    refused('updateHousehold', JSON.parse(`["${H}", {"__proto__": {"name": "x"}}]`), 'args[1].__proto__');
    refused('updateHousehold', JSON.parse(`["${H}", {"constructor": {"prototype": {}}}]`), 'args[1].constructor');
    refused('createItem', [H, { ...DRAFT, id: 'mine' }], 'args[1].id');
    // Rebuilt objects carry only their listed keys.
    const [, patch] = validateArgs('updateHousehold', JSON.parse(`["${H}", {"name": "Home"}]`)) as [string, object];
    expect(Object.getPrototypeOf(patch)).toBe(Object.prototype);
  });

  it('takes no Google emails in server mode', () => {
    refused('addPerson', [H, { name: 'Ela', emoji: '🦊', email: 'ela@example.com' }], 'args[1].email');
  });

  it('checks moves in the task list and its sections by shape (DemoBackend checks the rest)', () => {
    // One task, into a section or none, at a place from 0.
    refused('moveHousekeepingTask', [ID, H], 'args[2]');
    refused('moveHousekeepingTask', [ID, undefined, 0], 'args[1]');
    refused('moveHousekeepingTask', [ID, 3, 0], 'args[1]');
    refused('moveHousekeepingTask', [ID, null, -1], 'args[2]');
    refused('moveHousekeepingTask', [ID, null, 1.5], 'args[2]');
    refused('moveHousekeepingTask', [ID, null, '2'], 'args[2]');
    refused('moveHousekeepingTask', [ID, null, 100_001], 'args[2]');
    // The whole list is not taken any more: that was how one phone undid another's move.
    refused('moveHousekeepingTask', [H, [{ sectionId: null, taskIds: [ID] }], 0], 'args[1]');
    refused('moveHousekeepingSection', [ID], 'args[1]');
    refused('moveHousekeepingSection', [ID, -1], 'args[1]');
    refused('moveHousekeepingSection', [[ID, H], 0], 'args[0]');
    refused('reorderHousekeepingTasks', [H, Array.from({ length: 501 }, () => ID)], 'args[1]');
    expect(isRpcMethod('arrangeHousekeepingTasks')).toBe(false);
    expect(isRpcMethod('reorderHousekeepingSections')).toBe(false);
    refused('createHousekeepingSection', [H, 40], 'args[1]');
    refused('createHousekeepingTask', [H, 'Windows', 5], 'args[2]');
    refused('createHousekeepingTask', [H, 'Windows', ID, ID], 'args');
  });

  it('takes exactly one tick target', () => {
    refused('setHousekeepingTaskDone', [H, '2026-10-09', { taskId: ID, visitTaskId: ID }, true], 'args[2]');
    refused('setHousekeepingTaskDone', [H, '2026-10-09', {}, true], 'args[2]');
    refused('setHousekeepingTaskDone', [H, '2026-10-09', { taskId: 1 }, true], 'args[2]');
  });

  it('reads real calendar days only', () => {
    expect(() => validateArgs('addHousekeepingVisit', [H, '2028-02-29'])).not.toThrow();
    refused('addHousekeepingVisit', [H, '2027-02-29'], 'args[1]');
    refused('addHousekeepingVisit', [H, '2026-13-01'], 'args[1]');
  });
});
