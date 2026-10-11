// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureServerLinks,
  CODE_LINK_KEEP_MS,
  forgetServerLinks,
  pendingSetupCode,
  SETUP_LINK_KEEP_MS,
  takeSignInCode,
  withoutServerLinkParams,
} from './serverLinks';

const NOW = Date.parse('2026-10-09T11:00:00.000Z');

function open(url: string) {
  window.history.replaceState(null, '', url);
}

beforeEach(() => localStorage.clear());
afterEach(() => open('/'));

describe('server links', () => {
  it('takes ?setup= and ?code= out of the address bar, leaving everything else as it was', () => {
    open('/?item=abc&code=abcd-efgh&x=%20y#top');
    captureServerLinks(NOW);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/?item=abc&x=%20y#top');
    expect(withoutServerLinkParams('?setup=K7QM-3XRP-WN9D')).toBe('');
    expect(withoutServerLinkParams('?a=1')).toBe('?a=1');
  });

  it('keeps the sign-in code (normalised) until it is taken, once', () => {
    open('/?code=abcd%20efgh');
    captureServerLinks(NOW);
    expect(takeSignInCode(NOW)).toBe('ABCD-EFGH');
    expect(takeSignInCode(NOW)).toBeNull();
  });

  it('forgets a sign-in code after an hour', () => {
    open('/?code=ABCD-EFGH');
    captureServerLinks(NOW);
    expect(takeSignInCode(NOW + CODE_LINK_KEEP_MS + 1)).toBeNull();
  });

  it('keeps the setup code (read, not taken) for a day, until forgotten', () => {
    open('/?setup=k7qm-3xrp-wn9d');
    captureServerLinks(NOW);
    expect(pendingSetupCode(NOW)).toBe('K7QM-3XRP-WN9D');
    expect(pendingSetupCode(NOW)).toBe('K7QM-3XRP-WN9D');
    expect(pendingSetupCode(NOW + SETUP_LINK_KEEP_MS + 1)).toBeNull();
    open('/?setup=K7QM-3XRP-WN9D');
    captureServerLinks(NOW);
    forgetServerLinks('setup');
    expect(pendingSetupCode(NOW)).toBeNull();
  });

  it('ignores an empty link, and survives storage that throws', () => {
    open('/?code=');
    captureServerLinks(NOW);
    expect(window.location.search).toBe('');
    expect(takeSignInCode(NOW)).toBeNull();
    localStorage.setItem('homeos.code', 'not json');
    expect(takeSignInCode(NOW)).toBeNull();
  });
});
