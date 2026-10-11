import { describe, expect, it } from 'vitest';
import { codeLink } from '../../lib/backend/serverApi';
import { CODE_FIELD_LENGTH, caretAfter, codeFromPaste, codeLetters, groupCode, setupCodeFromText } from './codeText';

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

  it('keep a pasted setup code whole, never two of its groups as a sign-in code', () => {
    expect(codeFromPaste('KQ27-JRMB-NVBU-4NAY-6F76')).toBe('KQ27-JRMB-NVBU-4NAY-6F76');
    expect(codeFromPaste('kq27jrmbnvbu4nay6f76\n')).toBe('KQ27-JRMB-NVBU-4NAY-6F76');
    expect(codeFromPaste('https://home-os-orpin.vercel.app/?setup=KQ27-JRMB-NVBU-4NAY-6F76')).toBe('KQ27-JRMB-NVBU-4NAY-6F76');
    expect(codeFromPaste('K7QM-3XRP-WN9D')).toBe('K7QM-3XRP-WN9D');
    // Words are not a setup code (O and I are not in codes).
    expect(codeFromPaste('Hello from our home')).toBeNull();
  });

  it('find the setup code in pasted text, up to 24 letters', () => {
    expect(setupCodeFromText('KQ27-JRMB-NVBU-4NAY-6F76')).toBe('KQ27-JRMB-NVBU-4NAY-6F76');
    expect(setupCodeFromText('Open https://home-os-orpin.vercel.app/?setup=kq27-jrmb-nvbu-4nay-6f76 on your phone')).toBe(
      'KQ27-JRMB-NVBU-4NAY-6F76',
    );
    expect(setupCodeFromText('K7QM3XRPWN9D')).toBe('K7QM-3XRP-WN9D');
    expect(setupCodeFromText('ABCD-EFGH-JKLM-NPQR-STUV-WXYZ')).toBe('ABCD-EFGH-JKLM-NPQR-STUV-WXYZ');
    expect(setupCodeFromText('ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2')).toBeNull();
    expect(setupCodeFromText('ABCD-EFGH')).toBeNull();
    expect(setupCodeFromText('HELLO-WORLD-FROM')).toBeNull();
    // The field takes the longest one grouped.
    expect(CODE_FIELD_LENGTH).toBe('ABCD-EFGH-JKLM-NPQR-STUV-WXYZ'.length);
  });
});
