// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appBaseUrl,
  captureSharedLink,
  forgetSharedLink,
  LINK_KEEP_MS,
  takeSharedLink,
  withoutLinkParams,
} from './sharedLink';

const NOW = Date.parse('2026-10-08T09:00:00Z');

function visit(path: string) {
  window.history.replaceState(null, '', path);
}

beforeEach(() => {
  localStorage.clear();
  visit('/');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withoutLinkParams', () => {
  it('takes out item and area and keeps the rest exactly', () => {
    expect(withoutLinkParams('?item=i1')).toBe('');
    expect(withoutLinkParams('?frame&item=i1')).toBe('?frame');
    expect(withoutLinkParams('?area=a1&demo-seed=1&frame')).toBe('?demo-seed=1&frame');
    expect(withoutLinkParams('?%69tem=i1&x=a%20b')).toBe('?x=a%20b');
  });

  it('leaves a query without them alone', () => {
    expect(withoutLinkParams('')).toBe('');
    expect(withoutLinkParams('?frame')).toBe('?frame');
    expect(withoutLinkParams('?a=1&&b=2')).toBe('?a=1&&b=2');
    expect(withoutLinkParams('?items=1&areas=2')).toBe('?items=1&areas=2');
    expect(withoutLinkParams('?%E0%A4%A=1')).toBe('?%E0%A4%A=1');
  });
});

describe('captureSharedLink and takeSharedLink', () => {
  it('keeps the link, takes it out of the address bar, and hands it over once', () => {
    visit('/?frame&item=i1#top');
    captureSharedLink(NOW);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/?frame#top');
    expect(takeSharedLink(NOW + 1000)).toEqual({ kind: 'item', id: 'i1' });
    expect(takeSharedLink(NOW + 2000)).toBeNull();
  });

  it('an area link', () => {
    visit('/?area=a%201');
    captureSharedLink(NOW);
    expect(window.location.search).toBe('');
    expect(takeSharedLink(NOW)).toEqual({ kind: 'area', id: 'a 1' });
  });

  it('a newer link replaces one still waiting', () => {
    visit('/?area=a1');
    captureSharedLink(NOW);
    visit('/?item=i2');
    captureSharedLink(NOW + 5000);
    expect(takeSharedLink(NOW + 6000)).toEqual({ kind: 'item', id: 'i2' });
  });

  it('without a link the address and anything waiting are left alone', () => {
    visit('/?item=i1');
    captureSharedLink(NOW);
    const replace = vi.spyOn(window.history, 'replaceState');
    visit('/?frame');
    replace.mockClear();
    captureSharedLink(NOW + 1000);
    expect(replace).not.toHaveBeenCalled();
    expect(takeSharedLink(NOW + 2000)).toEqual({ kind: 'item', id: 'i1' });
  });

  it('an empty link is taken out of the address but not kept', () => {
    visit('/?item=');
    captureSharedLink(NOW);
    expect(window.location.search).toBe('');
    expect(takeSharedLink(NOW)).toBeNull();
  });

  it('a link left waiting too long (never signed in) is forgotten', () => {
    visit('/?item=i1');
    captureSharedLink(NOW);
    expect(takeSharedLink(NOW + LINK_KEEP_MS + 1)).toBeNull();
    expect(localStorage.getItem('homeos.link')).toBeNull();
  });

  it('keeps it through the sign-in round trip', () => {
    visit('/?item=i1');
    captureSharedLink(NOW);
    // Back from Google: a fresh page with no link in the address.
    visit('/?code=abc');
    captureSharedLink(NOW + 60_000);
    expect(takeSharedLink(NOW + 90_000)).toEqual({ kind: 'item', id: 'i1' });
  });

  it('ignores whatever else is stored under its key', () => {
    for (const junk of ['nope', '"x"', 'null', '{"kind":"other","id":"x","at":0}', '{"kind":"item","id":"","at":0}', '{"kind":"item","id":"x"}']) {
      localStorage.setItem('homeos.link', junk);
      expect(takeSharedLink(NOW), junk).toBeNull();
    }
  });

  it('forgetSharedLink drops it (signing out)', () => {
    visit('/?area=a1');
    captureSharedLink(NOW);
    forgetSharedLink();
    expect(takeSharedLink(NOW)).toBeNull();
  });

  it('works without storage: the address is still cleaned', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    visit('/?item=i1');
    expect(() => captureSharedLink(NOW)).not.toThrow();
    expect(window.location.search).toBe('');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(takeSharedLink(NOW)).toBeNull();
    expect(() => forgetSharedLink()).not.toThrow();
  });
});

describe('appBaseUrl', () => {
  it('is the origin and the base path', () => {
    expect(appBaseUrl()).toBe(`${window.location.origin}${import.meta.env.BASE_URL}`);
    expect(appBaseUrl().endsWith('/')).toBe(true);
  });
});
