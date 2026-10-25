import { describe, expect, it } from 'vitest';
import { BackendError } from './types';
import {
  API_ERROR_STATUS,
  CODE_ALPHABET,
  NOT_RPC,
  RPC_METHODS,
  codeLink,
  formatCode,
  isSetupCode,
  isSignInCode,
  normaliseCode,
  toBackendError,
} from './serverApi';

describe('codes', () => {
  it('uses 32 letters with no look-alikes', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(new Set(CODE_ALPHABET).size).toBe(32);
    for (const c of '01IO') expect(CODE_ALPHABET).not.toContain(c);
  });

  it('normalises what people type or paste', () => {
    expect(normaliseCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(normaliseCode('abcd efgh')).toBe('ABCDEFGH');
    expect(normaliseCode('ABCD–EFGH')).toBe('ABCDEFGH');
    expect(normaliseCode(undefined as unknown as string)).toBe('');
  });

  it('tells sign-in codes from setup codes', () => {
    expect(isSignInCode('ABCDEFGH')).toBe(true);
    expect(isSignInCode('ABCDEFG')).toBe(false);
    expect(isSignInCode('ABCDEFGO')).toBe(false);
    expect(isSetupCode('K7QM3XRPWN9D')).toBe(true);
    expect(isSetupCode('ABCDEFGH')).toBe(false);
    expect(isSetupCode('K7QM3XRPWN91')).toBe(false);
  });

  it('formats in groups of four and makes links', () => {
    expect(formatCode('ABCDEFGH')).toBe('ABCD-EFGH');
    expect(formatCode('K7QM3XRPWN9D')).toBe('K7QM-3XRP-WN9D');
    expect(codeLink('https://home-os-orpin.vercel.app/', 'abcd efgh')).toBe(
      'https://home-os-orpin.vercel.app/?code=ABCD-EFGH',
    );
  });
});

describe('toBackendError', () => {
  const body = (code: string, message = '') => ({ error: { code, message } });

  it('keeps the codes the app knows', () => {
    for (const code of ['not_signed_in', 'not_found', 'home_exists', 'invalid_code', 'too_many_attempts', 'read_only'] as const) {
      const err = toBackendError(API_ERROR_STATUS[code], body(code));
      expect(err).toBeInstanceOf(BackendError);
      expect(err.code).toBe(code);
    }
  });

  it('words invalid input as the other backends do', () => {
    const err = toBackendError(400, body('invalid_input', 'invalid_input: title'));
    expect([err.code, err.message]).toEqual(['unknown', 'invalid_input: title']);
  });

  it('reads an unreachable store as no connection, and anything else as unknown', () => {
    expect(toBackendError(503, body('unavailable')).code).toBe('network');
    expect(toBackendError(503, body('busy')).code).toBe('unknown');
    expect(toBackendError(401, null).code).toBe('not_signed_in');
    expect(toBackendError(502, null).code).toBe('network');
    expect(toBackendError(500, 'not json').code).toBe('unknown');
  });
});

describe('the RPC allow-list', () => {
  it('names every Backend method once: allowed, or what happens instead', () => {
    const allowed = Object.keys(RPC_METHODS);
    const not = Object.keys(NOT_RPC);
    expect(allowed.filter((m) => not.includes(m))).toEqual([]);
    expect(allowed).toHaveLength(39);
    expect(not).toHaveLength(18);
  });

  it('still takes what an app from before sections sends, so a phone that kept the old page open after an update works', () => {
    // f0a194f's housekeeping writes (its reorder too); the whole order is never taken otherwise.
    for (const method of [
      'setHousekeepingNote',
      'undoClearHousekeepingNote',
      'createHousekeepingTask',
      'renameHousekeepingTask',
      'deleteHousekeepingTask',
      'reorderHousekeepingTasks',
      'setHousekeepingTaskDone',
      'saveHousekeepingVisit',
      'addHousekeepingVisit',
      'deleteHousekeepingVisit',
    ]) {
      expect(RPC_METHODS, method).toHaveProperty(method, 'write');
    }
  });
});
