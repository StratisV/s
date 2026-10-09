import { act, cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { skyAt } from '../lib/logic/sun';
import { Hero } from './Hero';
import { STARS } from './hero-art/Sky';
import { ZONES } from './hero-art/look';
import s from './Hero.module.css';

const at = (iso: string) => new Date(iso);

function overlay() {
  return (
    <>
      <button type="button" aria-label="Profile">
        🦔
      </button>
      <h1>Home</h1>
      <p>21 Alderbrook Road</p>
    </>
  );
}

/** A stand-in IntersectionObserver that the test can drive. */
class FakeObserver {
  static all: FakeObserver[] = [];
  constructor(public callback: IntersectionObserverCallback) {
    FakeObserver.all.push(this);
  }
  target: Element | null = null;
  observe(el: Element) {
    this.target = el;
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  fire(isIntersecting: boolean, top = 0) {
    const entry = {
      isIntersecting,
      target: this.target,
      boundingClientRect: { top } as DOMRectReadOnly,
      rootBounds: { top: 0 } as DOMRectReadOnly,
    } as unknown as IntersectionObserverEntry;
    act(() => this.callback([entry], this as unknown as IntersectionObserver));
  }
}

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: matches && query.includes('reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const root = (container: HTMLElement) => container.firstElementChild as HTMLElement;

beforeEach(() => {
  FakeObserver.all = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  mockReducedMotion(false);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // @ts-expect-error jsdom has no matchMedia of its own.
  delete window.matchMedia;
});

describe('Hero', () => {
  it.each([
    ['2026-10-08T03:00+01:00', 'night', 'at night'],
    ['2026-10-08T06:55+01:00', 'dawn', 'at dawn'],
    ['2026-10-08T07:30+01:00', 'sunrise', 'at sunrise'],
    ['2026-10-08T10:00+01:00', 'day', 'in the daytime'],
    ['2026-10-08T13:00+01:00', 'day', 'in the daytime'],
    ['2026-10-08T18:05+01:00', 'sunset', 'at sunset'],
    ['2026-10-08T18:45+01:00', 'dusk', 'at dusk'],
    ['2026-10-08T22:00+01:00', 'night', 'at night'],
    ['2026-06-21T21:15+01:00', 'dusk', 'at dusk'],
    ['2026-12-21T15:45Z', 'sunset', 'at sunset'],
  ])('at %s shows the %s sky with white text and describes it', (iso, phase, phrase) => {
    const { container } = render(<Hero now={at(iso)}>{overlay()}</Hero>);
    const hero = root(container);
    expect(hero.dataset.phase).toBe(phase);
    expect(hero.dataset.tone).toBe('light');
    expect(hero.dataset.statusBar).toBe('light');
    const description = container.querySelector('p.visually-hidden');
    expect(description?.textContent).toContain(`in London ${phrase}`);
    expect(description?.textContent).toContain('a green duck');
    expect(description?.textContent).toContain('a brown hedgehog');
  });

  it('keeps the picture decorative and the overlay accessible, heading first', () => {
    const { container } = render(<Hero now={at('2026-10-08T22:00+01:00')}>{overlay()}</Hero>);
    const hero = root(container);
    expect(hero.getAttribute('role')).toBeNull();
    expect(container.querySelector('[role="img"]')).toBeNull();
    const art = container.querySelector(`.${s.stage}`)!;
    expect(art.getAttribute('aria-hidden')).toBe('true');
    expect(art.querySelector('svg')).not.toBeNull();
    const heading = screen.getByRole('heading', { name: 'Home' });
    expect(screen.getByRole('button', { name: 'Profile' })).toBeTruthy();
    const description = container.querySelector('p.visually-hidden')!;
    // The description is read after the title and the address.
    expect(heading.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(description.textContent).toContain('under a crescent moon and stars');
  });

  it('recomputes the sky every minute and when the app comes back into view', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // Find the minute the sunset turns to dusk on 8 October.
    let t = at('2026-10-08T18:00+01:00').getTime();
    while (skyAt(new Date(t + 60_000)).phase === 'sunset') t += 60_000;
    vi.setSystemTime(t + 10_000);
    const { container } = render(<Hero>{overlay()}</Hero>);
    expect(root(container).dataset.phase).toBe('sunset');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(root(container).dataset.phase).toBe('dusk');
    // Back after a few hours in the background.
    vi.setSystemTime(at('2026-10-08T23:30+01:00'));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(root(container).dataset.phase).toBe('night');
  });

  it('pauses its animations while it is off screen', () => {
    const { container } = render(<Hero now={at('2026-10-08T22:00+01:00')}>{overlay()}</Hero>);
    const hero = root(container);
    const io = FakeObserver.all.find((o) => o.target === hero)!;
    expect(io).toBeDefined();
    io.fire(false);
    expect(hero.hasAttribute('data-paused')).toBe(true);
    io.fire(true);
    expect(hero.hasAttribute('data-paused')).toBe(false);
    // Every moving piece carries the motion class the pause rule holds.
    const moving = container.querySelectorAll(`.${s.m}`);
    expect(moving.length).toBeGreaterThan(5);
    const css = readFileSync(`${process.cwd()}/src/ui/Hero.module.css`, 'utf8');
    expect(css).toMatch(/\.hero\[data-paused\] \.m,[^{]*\{\s*animation-play-state: paused !important;/);
  });

  it('holds still with Reduce Motion', () => {
    mockReducedMotion(true);
    const { container } = render(<Hero now={at('2026-10-08T10:00+01:00')}>{overlay()}</Hero>);
    expect(root(container).hasAttribute('data-still')).toBe(true);
    const css = readFileSync(`${process.cwd()}/src/ui/Hero.module.css`, 'utf8');
    expect(css).toMatch(/\.hero\[data-still\] \.m,[^{]*\{\s*animation: none !important;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.hero \.m,[^{]*\{\s*animation: none !important;/);
    // The scroll parallax only runs when motion is welcome.
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.hero:not\(\[data-still\]\) \.depthSky/);
  });

  it('moves when motion is welcome', () => {
    const { container } = render(<Hero now={at('2026-10-08T10:00+01:00')}>{overlay()}</Hero>);
    expect(root(container).hasAttribute('data-still')).toBe(false);
  });

  it('keeps stars out from under the status bar glyphs and bright ones off the title and the avatar', () => {
    for (const star of STARS) {
      if (star.y < ZONES.statusBar) {
        expect(star.r).toBeLessThanOrEqual(0.5);
        expect(star.bright || star.sparkle).toBe(false);
        // Not under the clock (x 30 to 110), the island (130 to 272) or the icons (282 to 386).
        const underGlyphs = (star.x > 24 && star.x < 112) || (star.x > 134 && star.x < 268) || (star.x > 284 && star.x < 390);
        expect(underGlyphs).toBe(false);
      }
      const inText = star.x < ZONES.text.x1 && star.y > ZONES.text.y0 && star.y < ZONES.text.y1;
      if (inText) expect(star.bright || star.sparkle).toBe(false);
      const byAvatar = star.x > ZONES.avatar.x0 - 6 && star.y > ZONES.avatar.y0 && star.y < ZONES.avatar.y1 + 6;
      expect(byAvatar).toBe(false);
    }
  });
});
