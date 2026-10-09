// The colours and light of the home scene for a given sun (see sun.ts): sky,
// ground, sun, horizon glow, moon and stars, smoothly interpolated by the sun's
// elevation, with a softer, pinker morning and a warmer evening.
import type { SkyPhase, SkyState } from './sun';

type RGB = readonly [number, number, number];
/** Piecewise-linear stops by sun elevation (degrees), lowest first. */
type Stops<T> = readonly (readonly [number, T])[];

export interface SkyLook {
  phase: SkyPhase;
  /** Sky gradient from the top of the scene down to the horizon (the 66% line). */
  sky: { top: string; middle: string; horizon: string };
  ground: { top: string; bottom: string };
  sun: {
    colour: string;
    /** Halo ring colour (rgba) and width in px. */
    halo: string;
    haloSize: number;
    /**
     * Which sun is out. `east` (left) rises in the morning and climbs to the top-left
     * corner; once it is full day it is `west`, in the 3a spot at the top right, which it
     * keeps until it sets on the right. Never above the house.
     */
    side: 'east' | 'west';
    /** 0 on the horizon, 1 in its top corner (from FULL_DAY up), negative below the horizon. */
    lift: number;
    /** 0 once the sun is well below the horizon. */
    opacity: number;
  };
  /** Warm light along the horizon around the sun at sunrise and sunset (rgba, 0 to 1). */
  glow: { colour: string; strength: number };
  /** Moon opacity, 0 to 1. */
  moon: number;
  /** The brightest stars come out first (dusk), the faint ones once it is dark. */
  stars: { bright: number; faint: number };
  /** 0 by day to 1 at night: how far the house and animals are dimmed. */
  night: number;
  /** 0 to 1: the house's windows are lit (from around sunset to after sunrise). */
  lamps: number;
}

function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mixRgb = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Mixes two `#RRGGBB` colours: t = 0 gives a, t = 1 gives b. */
export function mixColour(a: string, b: string, t: number): string {
  return hex(mixRgb(rgb(a), rgb(b), Math.max(0, Math.min(1, t))));
}

/** The value at `el` along `stops` (held flat beyond the first and last stop). */
function along<T>(stops: Stops<T>, el: number, mix: (a: T, b: T, t: number) => T): T {
  if (el <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [e1, v1] = stops[i];
    if (el <= e1) {
      const [e0, v0] = stops[i - 1];
      return mix(v0, v1, (el - e0) / (e1 - e0));
    }
  }
  return stops[stops.length - 1][1];
}

const num = (stops: Stops<number>, el: number) => along(stops, el, lerp);
const colour = (stops: Stops<string>, el: number) => along(stops, el, (a, b, t) => mixColour(a, b, t));

/** The 3a day colours (design/README.md "Home scene card"). */
export const DAY = {
  sky: { top: '#EAF3FF', horizon: '#F6FAFF' },
  ground: { top: '#DCEFD6', bottom: '#CFE8C8' },
  sun: '#FFD66B',
} as const;

/** Night, the same before dawn and after dusk. */
export const NIGHT = {
  sky: { top: '#0B1533', middle: '#12204A', horizon: '#1F2F5E' },
  ground: { top: '#2C4636', bottom: '#22392B' },
} as const;

/** Elevation (degrees) at and above which the scene shows the plain 3a day. */
export const FULL_DAY = 12;
/** Elevation at and below which the scene shows full night. */
export const FULL_NIGHT = -12;

interface Palette {
  top: string;
  middle: string;
  horizon: string;
  groundTop: string;
  groundBottom: string;
}

const dayPalette: Palette = {
  top: DAY.sky.top,
  // Halfway down the sky: the 3a two-colour gradient, unchanged.
  middle: mixColour(DAY.sky.top, DAY.sky.horizon, 0.5),
  horizon: DAY.sky.horizon,
  groundTop: DAY.ground.top,
  groundBottom: DAY.ground.bottom,
};

const nightPalette: Palette = {
  ...NIGHT.sky,
  groundTop: NIGHT.ground.top,
  groundBottom: NIGHT.ground.bottom,
};

const p = (top: string, middle: string, horizon: string, groundTop: string, groundBottom: string): Palette => ({
  top,
  middle,
  horizon,
  groundTop,
  groundBottom,
});

/** Evening: gold, coral and pink at sunset, then indigo to rose at dusk. */
const EVENING: Stops<Palette> = [
  [FULL_NIGHT, nightPalette],
  [-9, p('#121D47', '#232D62', '#3E3F7C', '#34503D', '#2A4433')],
  [-6, p('#1A2457', '#353C7C', '#6E5590', '#3F5C46', '#34503C')],
  [-3, p('#28357A', '#5E5A9E', '#D98FA0', '#5F7F63', '#527257')],
  [0, p('#5266B0', '#B588B4', '#FFA27A', '#9DBB92', '#8EAF84')],
  [3, p('#8AA2DA', '#EEAAB6', '#FFBE86', '#BCD6AE', '#ADCB9F')],
  [6, p('#BCD1F2', '#F6CFCB', '#FFDDB8', '#D0E8C7', '#C3DFB9')],
  [9, p('#E2EDFD', '#EEF2F9', '#FBF3EA', '#DAEED3', '#CDE6C5')],
  [FULL_DAY, dayPalette],
];

/** Morning: the same story, softer and pinker. */
const MORNING: Stops<Palette> = [
  [FULL_NIGHT, nightPalette],
  [-9, p('#131F4A', '#262F66', '#43437F', '#34503D', '#2A4433')],
  [-6, p('#1C275B', '#3A4282', '#7A6098', '#3F5C46', '#34503C')],
  [-3, p('#2D3A80', '#6A64A8', '#E7A1B2', '#61816A', '#54745D')],
  [0, p('#5C72BA', '#C597C2', '#FFB596', '#A2BF9A', '#93B38B')],
  [3, p('#94ADE0', '#F1B9C6', '#FFCDA0', '#BFD8B3', '#B0CDA4')],
  [6, p('#C5D8F4', '#F6D9D8', '#FFE6CC', '#D2E9CA', '#C4E0BC')],
  [9, p('#E4EFFD', '#EFF4FB', '#FAF6F0', '#DAEED3', '#CDE6C5')],
  [FULL_DAY, dayPalette],
];

function mixPalette(a: Palette, b: Palette, t: number): Palette {
  return {
    top: mixColour(a.top, b.top, t),
    middle: mixColour(a.middle, b.middle, t),
    horizon: mixColour(a.horizon, b.horizon, t),
    groundTop: mixColour(a.groundTop, b.groundTop, t),
    groundBottom: mixColour(a.groundBottom, b.groundBottom, t),
  };
}

/** Low and orange near the horizon, the 3a yellow once it is up. */
const SUN_EVENING: Stops<string> = [
  [-1, '#FF8840'],
  [3, '#FFA94E'],
  [7, '#FFC160'],
  [FULL_DAY, DAY.sun],
];
const SUN_MORNING: Stops<string> = [
  [-1, '#FF9850'],
  [3, '#FFB25A'],
  [7, '#FFC463'],
  [FULL_DAY, DAY.sun],
];
/** Halo opacity and width: the 3a 9px at 22% by day, a stronger glow when low. */
const HALO_ALPHA: Stops<number> = [
  [-1, 0.38],
  [3, 0.32],
  [7, 0.26],
  [FULL_DAY, 0.22],
];
const HALO_SIZE: Stops<number> = [
  [-1, 16],
  [3, 14],
  [7, 11],
  [FULL_DAY, 9],
];

const GLOW_STRENGTH: Stops<number> = [
  [-10, 0],
  [-6, 0.45],
  [-3, 0.85],
  [0, 1],
  [3, 0.95],
  [6, 0.6],
  [9, 0.2],
  [FULL_DAY, 0],
];
const GLOW_EVENING: Stops<string> = [
  [-4, '#F09AA8'],
  [0, '#FF9A5A'],
  [5, '#FFB870'],
];
const GLOW_MORNING: Stops<string> = [
  [-4, '#F0A6BC'],
  [0, '#FFAC7E'],
  [5, '#FFC488'],
];

const MOON: Stops<number> = [
  [-9, 1],
  [-3, 0],
];
const STARS_BRIGHT: Stops<number> = [
  [-7, 1],
  [-2, 0],
];
const STARS_FAINT: Stops<number> = [
  [-11, 1],
  [-6, 0],
];
const NIGHT_DIM: Stops<number> = [
  [-10, 1],
  [-2, 0],
];
const LAMPS: Stops<number> = [
  [-5, 1],
  [2, 0],
];
/** The sun sinks behind the ground; its halo fades as it goes so no ring is left above the horizon. */
const SUN_OPACITY: Stops<number> = [
  [-1.5, 0],
  [0, 1],
];

function rgba(hexColour: string, alpha: number): string {
  const [r, g, b] = rgb(hexColour);
  return `rgba(${r}, ${g}, ${b}, ${+alpha.toFixed(3)})`;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * How far up its side of the scene the sun is: 0 on the horizon, 1 in the top corner once
 * it is full day (when the colours are the 3a ones too). Eased so a low sun stands clear of
 * the horizon, and one just set drops out of sight.
 */
function sunLift(elevation: number): number {
  const h = clamp(elevation / FULL_DAY, -0.5, 1);
  return Math.sign(h) * Math.abs(h) ** 0.7;
}

/** How the scene looks for the sun in `state` (from skyAt in sun.ts). */
export function skyLook(state: SkyState): SkyLook {
  const el = state.elevation;
  // dayProgress is below 0.5 before solar noon (and below 0 before sunrise).
  const morning = state.dayProgress < 0.5;
  const palette = along(morning ? MORNING : EVENING, el, mixPalette);
  const sun = colour(morning ? SUN_MORNING : SUN_EVENING, el);
  return {
    phase: state.phase,
    sky: { top: palette.top, middle: palette.middle, horizon: palette.horizon },
    ground: { top: palette.groundTop, bottom: palette.groundBottom },
    sun: {
      colour: sun,
      halo: rgba(sun, num(HALO_ALPHA, el)),
      haloSize: +num(HALO_SIZE, el).toFixed(1),
      side: morning && el < FULL_DAY ? 'east' : 'west',
      lift: sunLift(el),
      opacity: num(SUN_OPACITY, el),
    },
    glow: {
      colour: rgba(colour(morning ? GLOW_MORNING : GLOW_EVENING, el), 0.9),
      strength: num(GLOW_STRENGTH, el),
    },
    moon: num(MOON, el),
    stars: { bright: num(STARS_BRIGHT, el), faint: num(STARS_FAINT, el) },
    night: num(NIGHT_DIM, el),
    lamps: num(LAMPS, el),
  };
}

/** How the scene's accessible label ends: "A duck and a hedgehog outside their house at sunset". */
export const PHASE_PHRASE: Record<SkyPhase, string> = {
  night: 'at night',
  dawn: 'at dawn',
  sunrise: 'at sunrise',
  day: 'in the daytime',
  sunset: 'at sunset',
  dusk: 'at dusk',
};
