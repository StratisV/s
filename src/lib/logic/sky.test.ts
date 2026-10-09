import { DAY, FULL_DAY, FULL_NIGHT, mixColour, NIGHT, PHASE_PHRASE, skyLook } from './sky';
import { skyAt, type SkyState } from './sun';

/** A sun at `elevation`, in the morning (before noon) or the evening. */
function sun(elevation: number, when: 'morning' | 'evening', height = elevation / 30): SkyState {
  const beforeNoon = when === 'morning';
  const phase =
    elevation < -6
      ? 'night'
      : elevation < 0
        ? beforeNoon
          ? 'dawn'
          : 'dusk'
        : elevation < 8
          ? beforeNoon
            ? 'sunrise'
            : 'sunset'
          : 'day';
  return { phase, elevation, dayProgress: beforeNoon ? 0.2 : 0.8, height };
}

/** 0 to 1: how far `c` is from black (rough lightness). */
function lightness(c: string): number {
  const n = parseInt(c.slice(1), 16);
  return (((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)) / (3 * 255);
}

/** Red minus blue: positive is warm (peach, orange), negative is cool (blue, navy). */
function warmth(c: string): number {
  const n = parseInt(c.slice(1), 16);
  return ((n >> 16) & 255) - (n & 255);
}

describe('mixColour', () => {
  it('mixes per channel and clamps t', () => {
    expect(mixColour('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mixColour('#FF0000', '#0000FF', 0.25)).toBe('#BF0040');
    expect(mixColour('#123456', '#ABCDEF', 0)).toBe('#123456');
    expect(mixColour('#123456', '#ABCDEF', 1)).toBe('#ABCDEF');
    expect(mixColour('#123456', '#ABCDEF', 7)).toBe('#ABCDEF');
    expect(mixColour('#123456', '#ABCDEF', -1)).toBe('#123456');
  });
});

describe('skyLook', () => {
  it('is the 3a day once the sun is up, morning or evening', () => {
    for (const when of ['morning', 'evening'] as const) {
      for (const el of [FULL_DAY, 30, 62]) {
        const look = skyLook(sun(el, when));
        expect(look.phase).toBe('day');
        expect(look.sky.top).toBe(DAY.sky.top);
        expect(look.sky.horizon).toBe(DAY.sky.horizon);
        // The middle stop sits halfway, so the gradient is the 3a two-colour one.
        expect(look.sky.middle).toBe(mixColour(DAY.sky.top, DAY.sky.horizon, 0.5));
        expect(look.ground).toEqual(DAY.ground);
        expect(look.sun.colour).toBe(DAY.sun);
        expect(look.sun.halo).toBe('rgba(255, 214, 107, 0.22)');
        expect(look.sun.haloSize).toBe(9);
        expect(look.sun.opacity).toBe(1);
        expect(look.glow.strength).toBe(0);
        expect(look.moon).toBe(0);
        expect(look.stars).toEqual({ bright: 0, faint: 0 });
        expect(look.night).toBe(0);
        expect(look.lamps).toBe(0);
      }
    }
  });

  it('is a deep navy night with a moon, stars, dimmed animals and lit windows', () => {
    for (const when of ['morning', 'evening'] as const) {
      for (const el of [FULL_NIGHT, -20, -40]) {
        const look = skyLook(sun(el, when));
        expect(look.phase).toBe('night');
        expect(look.sky).toEqual(NIGHT.sky);
        expect(look.ground).toEqual(NIGHT.ground);
        expect(look.moon).toBe(1);
        expect(look.stars).toEqual({ bright: 1, faint: 1 });
        expect(look.night).toBe(1);
        expect(look.lamps).toBe(1);
        expect(look.sun.opacity).toBe(0);
        expect(look.glow.strength).toBe(0);
      }
    }
    // Navy: dark and blue.
    expect(lightness(NIGHT.sky.top)).toBeLessThan(0.15);
    expect(warmth(NIGHT.sky.top)).toBeLessThan(-30);
    // Darker green ground than by day.
    expect(lightness(NIGHT.ground.top)).toBeLessThan(lightness(DAY.ground.top) - 0.4);
  });

  it('sunrise and sunset: warm peach horizon, pink sky, a low orange sun and a strong glow', () => {
    for (const when of ['morning', 'evening'] as const) {
      const look = skyLook(sun(3, when));
      expect(look.phase).toBe(when === 'morning' ? 'sunrise' : 'sunset');
      expect(warmth(look.sky.horizon)).toBeGreaterThan(80);
      expect(warmth(look.sky.middle)).toBeGreaterThan(30);
      expect(look.sun.colour).not.toBe(DAY.sun);
      expect(warmth(look.sun.colour)).toBeGreaterThan(150);
      expect(look.sun.haloSize).toBeGreaterThan(9);
      expect(look.glow.strength).toBeGreaterThan(0.9);
      expect(look.moon).toBe(0);
      expect(look.stars.bright).toBe(0);
    }
    // Morning and evening are their own variants.
    expect(skyLook(sun(3, 'morning')).sky).not.toEqual(skyLook(sun(3, 'evening')).sky);
  });

  it('dawn and dusk: indigo to rose, with the first (bright) stars only', () => {
    for (const when of ['morning', 'evening'] as const) {
      const look = skyLook(sun(-4, when));
      expect(look.phase).toBe(when === 'morning' ? 'dawn' : 'dusk');
      // Indigo above: dark and cool.
      expect(lightness(look.sky.top)).toBeLessThan(0.4);
      expect(warmth(look.sky.top)).toBeLessThan(-40);
      // Rose at the horizon: light and warm.
      expect(warmth(look.sky.horizon)).toBeGreaterThan(20);
      expect(lightness(look.sky.horizon)).toBeGreaterThan(0.5);
      expect(look.stars.bright).toBeGreaterThan(0);
      expect(look.stars.bright).toBeLessThan(1);
      expect(look.stars.faint).toBe(0);
      expect(look.sun.opacity).toBe(0);
      expect(look.lamps).toBeGreaterThan(0.5);
    }
  });

  it('interpolates smoothly between stops', () => {
    // Halfway between the -3 and 0 evening stops.
    const a = skyLook(sun(-3, 'evening'));
    const b = skyLook(sun(0, 'evening'));
    const mid = skyLook(sun(-1.5, 'evening'));
    expect(mid.sky.top).toBe(mixColour(a.sky.top, b.sky.top, 0.5));
    expect(mid.sky.horizon).toBe(mixColour(a.sky.horizon, b.sky.horizon, 0.5));
    expect(mid.ground.top).toBe(mixColour(a.ground.top, b.ground.top, 0.5));

    // No jumps anywhere: a tenth of a degree never moves a channel by more than a few steps.
    for (const when of ['morning', 'evening'] as const) {
      for (let el = -20; el < 30; el += 0.1) {
        const x = skyLook(sun(el, when));
        const y = skyLook(sun(el + 0.1, when));
        for (const [p, q] of [
          [x.sky.top, y.sky.top],
          [x.sky.middle, y.sky.middle],
          [x.sky.horizon, y.sky.horizon],
          [x.ground.top, y.ground.top],
          [x.sun.colour, y.sun.colour],
        ]) {
          expect(Math.abs(lightness(p) - lightness(q))).toBeLessThan(0.03);
        }
        expect(Math.abs(x.glow.strength - y.glow.strength)).toBeLessThan(0.05);
        expect(Math.abs(x.stars.bright - y.stars.bright)).toBeLessThan(0.05);
      }
    }
  });

  it('the evening is warmer than the morning, the morning pinker', () => {
    const m = skyLook(sun(0, 'morning'));
    const e = skyLook(sun(0, 'evening'));
    const n = (c: string) => parseInt(c.slice(1), 16);
    // Evening horizon has less blue (more orange); morning more (peach-pink).
    expect(n(e.sky.horizon) & 255).toBeLessThan(n(m.sky.horizon) & 255);
  });

  it('rises on the left to the top-left corner, is in the 3a corner by full day, sets on the right', () => {
    // Morning: the east (left) sun, from the horizon up to its corner.
    expect(skyLook(sun(0, 'morning')).sun).toMatchObject({ side: 'east', lift: 0 });
    expect(skyLook(sun(FULL_DAY - 0.01, 'morning')).sun.side).toBe('east');
    expect(skyLook(sun(FULL_DAY - 0.01, 'morning')).sun.lift).toBeGreaterThan(0.99);
    // Full day, morning or afternoon: the west sun in the 3a spot (lift 1 is its top corner).
    for (const when of ['morning', 'evening'] as const) {
      for (const el of [FULL_DAY, 15, 30, 62]) expect(skyLook(sun(el, when)).sun).toMatchObject({ side: 'west', lift: 1 });
    }
    // Evening: down the right side to the horizon.
    expect(skyLook(sun(FULL_DAY - 0.01, 'evening')).sun.side).toBe('west');
    expect(skyLook(sun(0, 'evening')).sun).toMatchObject({ side: 'west', lift: 0 });
    // Before sunrise and after sunset it waits below the horizon, on its side.
    const before = skyLook(sun(-5, 'morning')).sun;
    expect(before.side).toBe('east');
    expect(before.lift).toBeLessThan(0);
    expect(skyLook(sun(-5, 'evening')).sun.side).toBe('west');
    // A low sun stands clear of the horizon: the lift is eased up, but stays in order.
    const low = skyLook(sun(3, 'evening')).sun.lift;
    const higher = skyLook(sun(6, 'evening')).sun.lift;
    expect(low).toBeGreaterThan(3 / FULL_DAY);
    expect(higher).toBeGreaterThan(low);
    // Smooth: a tenth of a degree never moves it far (minute ticks glide, see HomeScene JUMP).
    for (let el = -20; el < 20; el += 0.1) {
      expect(Math.abs(skyLook(sun(el + 0.1, 'evening')).sun.lift - skyLook(sun(el, 'evening')).sun.lift)).toBeLessThan(0.05);
    }
    // Far below the horizon it stays within reach of the scene.
    expect(skyLook(sun(-40, 'evening')).sun.lift).toBeGreaterThanOrEqual(-0.62);
  });

  it('follows the real London sky through 8 October 2026', () => {
    const at = (hhmm: string) => skyLook(skyAt(new Date(`2026-10-08T${hhmm}:00+01:00`)));
    expect(at('03:00').phase).toBe('night');
    expect(at('06:55').phase).toBe('dawn');
    expect(at('07:30').phase).toBe('sunrise');
    expect(at('12:00').phase).toBe('day');
    expect(at('18:05').phase).toBe('sunset');
    expect(at('18:45').phase).toBe('dusk');

    expect(at('12:00').sky.top).toBe(DAY.sky.top);
    expect(at('03:00').sky.top).toBe(NIGHT.sky.top);
    // The sun rises on the east side and is in the 3a corner for the rest of the day.
    // (It reaches 12 degrees at about 08:40 and drops below at about 16:55.)
    expect(at('07:30').sun.side).toBe('east');
    expect(at('08:30').sun.side).toBe('east');
    expect(at('08:30').sun.lift).toBeLessThan(1);
    for (const t of ['09:00', '10:00', '12:00', '12:48', '15:00', '16:30']) {
      expect(at(t).sun, t).toMatchObject({ side: 'west', lift: 1 });
    }
    expect(at('17:00').sun.side).toBe('west');
    expect(at('17:00').sun.lift).toBeLessThan(1);
    expect(at('18:05').sun.side).toBe('west');
  });

  it('follows the seasons: the same clock time is day in June and night in December', () => {
    const june = skyLook(skyAt(new Date('2026-06-21T20:30:00+01:00')));
    const december = skyLook(skyAt(new Date('2026-12-21T20:30:00Z')));
    expect(june.phase).toBe('sunset');
    expect(december.phase).toBe('night');
    // A winter noon (the sun only reaches about 15°) is still the 3a day.
    expect(skyLook(skyAt(new Date('2026-12-21T12:00:00Z'))).sky.top).toBe(DAY.sky.top);
  });

  it('has a phrase for every phase', () => {
    expect(PHASE_PHRASE.sunset).toBe('at sunset');
    expect(PHASE_PHRASE.night).toBe('at night');
    expect(Object.keys(PHASE_PHRASE).sort()).toEqual(['dawn', 'day', 'dusk', 'night', 'sunrise', 'sunset']);
  });
});
