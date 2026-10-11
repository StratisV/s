import { describe, expect, it } from 'vitest';
import { codeLink } from '../../lib/backend/serverApi';
import { caretAfter, codeFromPaste, codeLetters, groupCode } from './codeText';

describe('code fields', () => {
  it('keep letters and digits, in capitals', () => {
    expect(codeLetters(' ab cd-ef.gh ')).toBe('ABCDEFGH');
    expect(codeLetters('k7qm–3xrp')).toBe('K7QM3XRP');
    expect(codeLetters('é!?')).toBe('');
  });

  it('show the code in groups of four as it is typed', () => {
    expect(groupCode('')).toBe('');
    expect(groupCode('abc')).toBe('ABC');
    expect(groupCode('abcd')).toBe('ABCD');
    expect(groupCode('abcde')).toBe('ABCD-E');
    expect(groupCode('ABCD EFGH')).toBe('ABCD-EFGH');
    expect(groupCode('k7qm3xrpwn9d')).toBe('K7QM-3XRP-WN9D');
  });

  it('put the caret after the letter, before a hyphen', () => {
    expect(caretAfter(0)).toBe(0);
    expect(caretAfter(1)).toBe(1);
    expect(caretAfter(4)).toBe(4);
    expect(caretAfter(5)).toBe(6);
    expect(caretAfter(8)).toBe(9);
    expect(caretAfter(9)).toBe(11);
  });

  it('take the code out of a pasted message or link', () => {
    const link = codeLink('https://home-os-orpin.vercel.app/', 'ABCD-EFGH');
    const message = `Join our home on home.os: ${link}\nCode: ABCD-EFGH`;
    expect(codeFromPaste(message)).toBe('ABCD-EFGH');
    expect(codeFromPaste(link)).toBe('ABCD-EFGH');
    expect(codeFromPaste('code: k7qm 3xrp')).toBe('K7QM-3XRP');
    // A code on its own goes in as it is.
    expect(codeFromPaste('abcd-efgh')).toBeNull();
    expect(codeFromPaste('ABCD')).toBeNull();
    // Nothing shaped like a code (O and I are not in codes): as it is.
    expect(codeFromPaste('Hello from home, see you soon')).toBeNull();
  });
});
