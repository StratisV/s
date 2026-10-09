import { describe, expect, it } from 'vitest';
import { skyAt } from '../../lib/logic/sun';
import { cloudsOfDay, heroLook, moonPlace, sunPlace, TARGET, ZONES } from './look';

const at = (iso: string) => new Date(iso);

/** Every 5 minutes through a London day (BST or GMT as given by `offset`). */
function day(date: string, offset: string): Date[] {
  const start = at(`${date}T00:00:00${offset}`).getTime();
  return Array.from({ length: 288 }, (_, i) => new Date(start + i * 300_000));
}
const DAYS = [
  day('2026-10-08', '+01:00'),
  day('2026-06-21', '+01:00'),
  day('2026-12-21', 'Z'),
  day('2026-03-20', 'Z'),
];

type Box = { x0: number; x1: number; y0: number; y1: number };
const hitsBox = (x: number, y: number, r: number, b: Box) =>
  x + r > b.x0 && x - r < b.x1 && y + r > b.y0 && y - r < b.y1;

describe('heroLook', () => {
  it('gives the phase of the London sky at the brief moments', () => {
    const phases = {
      '2026-10-08T03:00+01:00': 'night',
      '2026-10-08T06:55+01:00': 'dawn',
      '2026-10-08T07:30+01:00': 'sunrise',
      '2026-10-08T10:00+01:00': 'day',
      '2026-10-08T13:00+01:00': 'day',
      '2026-10-08T18:05+01:00': 'sunset',
      '2026-10-08T18:45+01:00': 'dusk',
      '2026-10-08T22:00+01:00': 'night',
      '2026-06-21T21:15+01:00': 'dusk',
      '2026-12-21T15:45Z': 'sunset',
    } as const;
    for (const [iso, phase] of Object.entries(phases)) {
      const look = heroLook(at(iso));
      expect(look.phase, iso).toBe(phase);
      expect(look.phase).toBe(skyAt(at(iso)).phase);
    }
  });

  it('keeps white text at 5.6:1 (title) and 4.6:1 (address) or better at every 5 minutes of four days', () => {
    for (const times of DAYS) {
      for (const t of times) {
        const look = heroLook(t);
        expect(look.tone, t.toISOString()).toBe('light');
        expect(look.contrast.title, t.toISOString()).toBeGreaterThanOrEqual(TARGET.title);
        expect(look.contrast.address, t.toISOString()).toBeGreaterThanOrEqual(TARGET.address);
        // The wash behind the title is only ever a soft deepening of the sky.
        expect(look.wash.alpha, t.toISOString()).toBeLessThanOrEqual(0.62);
      }
    }
  });

  it('only uses the wash while the low morning sun is near the title', () => {
    for (const times of DAYS) {
      for (const t of times) {
        const look = heroLook(t);
        if (!look.morning || look.elevation < -6) expect(look.wash.alpha, t.toISOString()).toBe(0);
      }
    }
    const washed = DAYS[0].filter((t) => heroLook(t).wash.alpha > 0).length;
    expect(washed / 288).toBeLessThan(0.25);
  });

  it('never puts the sun behind the title, the status bar or the avatar', () => {
    for (const times of DAYS) {
      for (const t of times) {
        const look = heroLook(t);
        if (look.sun.visible <= 0) continue;
        const { x, y, r } = sunPlace(t);
        // The disc stays clear of the text block (which already keeps 7pt below the glyphs).
        expect(hitsBox(x, y, r + 2, ZONES.text), t.toISOString()).toBe(false);
        expect(hitsBox(x, y, r + 4, ZONES.avatar), t.toISOString()).toBe(false);
        expect(y - r, t.toISOString()).toBeGreaterThan(ZONES.statusBar + 8);
      }
    }
  });

  it('moves the sun from east (left) to west (right), lower in winter', () => {
    const morning = sunPlace(at('2026-10-08T07:40+01:00'));
    const evening = sunPlace(at('2026-10-08T18:00+01:00'));
    expect(morning.x).toBeLessThan(evening.x);
    const juneNoon = sunPlace(at('2026-06-21T13:00+01:00'));
    const decNoon = sunPlace(at('2026-12-21T12:00Z'));
    expect(juneNoon.y).toBeLessThan(decNoon.y);
  });

  it('keeps the moon clear of the title, the status bar and the avatar, in its real phase', () => {
    for (const times of DAYS) {
      for (const t of times) {
        const m = moonPlace(t);
        expect(hitsBox(m.x, m.y, m.r + 4, ZONES.text)).toBe(false);
        expect(hitsBox(m.x, m.y, m.r + 2, ZONES.avatar)).toBe(false);
        expect(m.y - m.r).toBeGreaterThan(ZONES.statusBar);
      }
    }
    // 8 October 2026 is two days before a new moon: a thin waning crescent.
    const oct = moonPlace(at('2026-10-08T22:00+01:00'));
    expect(oct.name).toBe('crescent');
    expect(oct.age).toBeGreaterThan(25);
    expect(moonPlace(at('2026-12-21T20:00Z')).name).toBe('gibbous');
    // It moves through the night.
    expect(moonPlace(at('2026-10-08T22:00+01:00')).x).not.toBeCloseTo(moonPlace(at('2026-10-09T03:00+01:00')).x, 0);
  });

  it('keeps every cloud lane out of the status bar, the title block and the avatar, every day of the year', () => {
    for (let d = 0; d < 400; d++) {
      for (const c of cloudsOfDay(2026 * 400 + d)) {
        const h = c.w * (c.far ? 0.32 : 0.44);
        const lane = { x0: c.x0, x1: c.x1, y0: c.y, y1: c.y + h };
        const overlaps = (b: { x0: number; x1: number; y0: number; y1: number }) =>
          lane.x1 > b.x0 && lane.x0 < b.x1 && lane.y1 > b.y0 && lane.y0 < b.y1;
        expect(c.y).toBeGreaterThan(ZONES.statusBar);
        expect(overlaps(ZONES.text)).toBe(false);
        expect(overlaps(ZONES.avatar)).toBe(false);
      }
    }
    // The weather changes from day to day.
    const counts = new Set(Array.from({ length: 30 }, (_, d) => JSON.stringify(cloudsOfDay(2026 * 400 + d))));
    expect(counts.size).toBeGreaterThan(20);
  });

  it('follows the seasons', () => {
    const oct = heroLook(at('2026-10-08T13:00+01:00'));
    expect(oct.tree).toBe('gold');
    expect(oct.pumpkin).toBe(true);
    expect(oct.leaves).toBe(true);
    const dec = heroLook(at('2026-12-21T12:00Z'));
    expect(dec.tree).toBe('bare');
    expect(dec.wreath).toBe(true);
    expect(dec.robin).toBe(true);
    expect(dec.smoke).toBe(false);
    expect(heroLook(at('2026-12-21T17:00Z')).smoke).toBe(true);
    expect(heroLook(at('2026-04-20T10:00+01:00')).tree).toBe('blossom');
    const june = heroLook(at('2026-06-21T23:30+01:00'));
    expect(june.tree).toBe('green');
    expect(june.fireflies).toBeGreaterThan(0.9);
    expect(oct.fireflies).toBe(0);
  });

  it('lights the house at night and dims the ground floor after 1am', () => {
    const evening = heroLook(at('2026-10-08T22:00+01:00'));
    expect(evening.lamps.ground).toBe(1);
    const late = heroLook(at('2026-10-08T03:00+01:00'));
    expect(late.lamps.ground).toBeLessThan(0.5);
    expect(late.lamps.attic).toBe(1);
    expect(heroLook(at('2026-10-08T13:00+01:00')).lamps.ground).toBe(0);
  });

  it('describes the scene and the time of day', () => {
    expect(heroLook(at('2026-10-08T22:00+01:00')).description).toMatch(
      /^An illustration of a cottage in its garden in London at night in autumn, under a crescent moon and stars, with lamps lit in the windows, with a green duck on the pond and a brown hedgehog by the fence\.$/,
    );
    expect(heroLook(at('2026-06-21T13:00+01:00')).description).toContain('in the daytime in summer');
  });
});
