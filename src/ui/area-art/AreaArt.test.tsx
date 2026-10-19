import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AREAS } from '../../lib/constants';
import { AreaArt } from './AreaArt';
import { pickArt, type SceneKind } from './pick';
import Scene from './Scene';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The household's areas with ids like the app's (random UUIDs). */
const SEEDS = [
  '4c1d8a2e-1f53-4f0b-9a57-03f7c0a1d201',
  '9e0b6f44-2d8c-4b7a-8d15-6a2f9e3c4b02',
  '1a7c3e90-5b2d-4c8e-a6f1-7d4b2e9c0a03',
  'c3f2a1b0-8e7d-4a6c-b5e4-2f1d0c9b8a04',
  '7b6a5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c05',
  '2e4d6c8b-0a1f-4e3d-8c5b-7a9e1d3c5b06',
  'f0e1d2c3-b4a5-4968-8776-655443322107',
  '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c08',
  '8d7c6b5a-4f3e-4d2c-9b1a-0f9e8d7c6b09',
  '3c2b1a0f-9e8d-4c7b-a6f5-e4d3c2b1a010',
  'b9a8c7d6-e5f4-4a3b-9c2d-1e0f9a8b7c11',
];

/** The drawing's markup without its document-unique ids. */
const drawing = (el: Element) => el.innerHTML.replace(/aa[a-zA-Z0-9]*-/g, 'id-');

describe('AreaArt', () => {
  it('is hidden from assistive technology and shows its colours until the drawing loads', async () => {
    const { container } = render(<AreaArt name="Kitchen" seed="a-kitchen" className="mine" />);
    const art = container.firstElementChild as HTMLElement;
    expect(art.tagName).toBe('SPAN');
    expect(art).toHaveProperty('ariaHidden', 'true');
    expect(art.className).toContain('mine');
    expect(art.style.background).toContain('linear-gradient');
    expect(art.dataset.areaArt).toBe(pickArt('Kitchen', 'a-kitchen').key);
    const svg = await waitFor(() => {
      const found = art.querySelector('svg');
      if (!found) throw new Error('not drawn yet');
      return found;
    });
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
    expect(svg.getAttribute('focusable')).toBe('false');
    // Nothing in it can be reached or read out.
    expect(art.querySelectorAll('a, button, [tabindex], title, text')).toHaveLength(0);
  });

  it("draws the household's 11 areas all differently", async () => {
    const { container } = render(
      <div>
        {DEFAULT_AREAS.map((name, i) => (
          <AreaArt key={name} name={name} seed={SEEDS[i]} />
        ))}
      </div>,
    );
    const arts = Array.from(container.querySelectorAll('[data-area-art]'));
    await waitFor(() => expect(arts.every((el) => el.querySelector('svg'))).toBe(true));
    expect(new Set(arts.map((el) => el.getAttribute('data-area-art'))).size).toBe(11);
    expect(new Set(arts.map(drawing)).size).toBe(11);
  });

  it('draws the evening in dark mode', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('dark'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const { container } = render(<AreaArt name="Bedroom Large" seed="b" />);
    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull());
    expect(container.querySelector('svg')!.hasAttribute('data-evening')).toBe(true);
  });
});

describe('Scene', () => {
  const KINDS: SceneKind[] = [
    'kitchen', 'living', 'bathroom', 'bedroom', 'hallway', 'garden', 'frontGarden', 'gardenRoom', 'hotTub',
    'utility', 'office', 'dining', 'garage', 'stairs', 'loft', 'balcony', 'nursery', 'room',
  ];

  it('draws every scene, both compositions, by day and in the evening, each its own', () => {
    const seen = new Set<string>();
    for (const kind of KINDS) {
      for (const alt of [false, true]) {
        for (const evening of [false, true]) {
          const pick = { ...pickArt('x', 'seed'), kind, alt, mirror: false, detail: 0 };
          const { container, unmount } = render(<Scene pick={pick} evening={evening} fade={false} />);
          const svg = container.querySelector('svg')!;
          expect(svg.querySelectorAll('path, rect, circle, ellipse').length).toBeGreaterThan(12);
          seen.add(drawing(container));
          unmount();
        }
      }
    }
    // Every scene has a second composition (for "small", "guest", "downstairs"...), and an evening.
    expect(seen.size).toBe(KINDS.length * 4);
  });

  it('gives an unknown room different furniture for different seeds', () => {
    const drawings = new Set(
      [0, 1, 2].map((detail) => {
        const { container, unmount } = render(<Scene pick={{ ...pickArt('Gym', 'g'), detail }} evening={false} fade={false} />);
        const html = drawing(container);
        unmount();
        return html;
      }),
    );
    expect(drawings.size).toBe(3);
  });
});
