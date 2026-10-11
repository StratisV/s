// Pure helpers for the code fields (server mode): "Have a code?" on the Welcome screen and the
// setup code on "Bring this home online". Kept out of the components so they can be unit tested.
import { CODE_ALPHABET, CODE_LENGTH, formatCode } from '../../lib/backend/serverApi';

/** What a code field keeps of what was typed: letters and digits, upper case ("ab cd-ef" → "ABCDEF"). */
export function codeLetters(text: string): string {
  return text.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** As the field shows it while typing: in groups of four ("abcdefg" → "ABCD-EFG"). */
export function groupCode(text: string): string {
  return formatCode(codeLetters(text));
}

/** Where the caret goes in a grouped code after `letters` letters (after the letter, before a hyphen). */
export function caretAfter(letters: number): number {
  return letters <= 0 ? 0 : letters + Math.floor((letters - 1) / 4);
}

const LETTER = `[${CODE_ALPHABET}]`;
/** A sign-in code inside other text: two groups of four, as in a shared message or a ?code= link. */
const CODE_IN_TEXT = new RegExp(`(?:^|[^0-9A-Z])(${LETTER}{4})[-\\s.]?(${LETTER}{4})(?![0-9A-Z])`, 'g');

/**
 * The sign-in code in pasted text that is more than a code: the whole shared message ("Join
 * our home on home.os: https://…?code=ABCD-EFGH / Code: ABCD-EFGH") or the link. The last
 * code in it (the message ends with it), grouped; null when the text is a code already or holds
 * none, so the paste goes in as it is.
 */
export function codeFromPaste(text: string): string | null {
  const plain = codeLetters(text);
  if (plain.length <= CODE_LENGTH) return null;
  const upper = text.toUpperCase();
  let last: string | null = null;
  for (const match of upper.matchAll(CODE_IN_TEXT)) last = `${match[1]}-${match[2]}`;
  return last;
}
