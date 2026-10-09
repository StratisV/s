// The Home hero's colours and light at a moment in London, driven by the real
// sun (lib/logic/sun.ts). Every ground colour is a day colour lit by one
// ambient light (a tint, how much of it, a dimmer and a saturation), then
// hazed towards the horizon by distance, so the whole picture shifts together
// from noon to golden hour to moonlight. The sky behind the title is modelled
// here too (gradient, glows, sun bloom), so the text tone and the soft wash
// behind it can be solved for a guaranteed contrast.
import { mixColour } from '../../lib/logic/sky';
import { LONDON, skyAt, sunTimes, type SkyPhase } from '../../lib/logic/sun';

// ---------------------------------------------------------------- frame

/** The art in its own units: 1 unit = 1pt on a 402pt wide phone. */
export const ART_W = 402;
export const ART_H = 354;
/** Extra art either side, shown on wider phones (up to 482pt). */
export const BLEED = 40;
export const VIEW_BOX = `${-BLEED} 0 ${ART_W + 2 * BLEED} ${ART_H}`;
/** Where each of the five sky colours sits (art y). */
export const SKY_Y = [0, 66, 171, 201, 222] as const;
/** The sun's centre sits on this line at sunrise and sunset, behind the far hills. */
export const HORIZON = 212;

/**
 * Where the overlay sits on the art. The art is anchored to the bottom of the
 * hero (inset + 300pt tall) at 1pt per unit, so these are the same for any
 * status bar inset; x covers phones 375 to 440pt wide (the art is centred).
 */
export const ZONES = {
  /** The status bar (the top 54pt with the usual inset). */
  statusBar: 56,
  /** The 38pt avatar button in the nav row. */
  avatar: { x0: 326, x1: 414, y0: 56, y1: 108 },
  /** The large title and the address. */
  text: { x0: -24, x1: 196, y0: 98, y1: 178 },
} as const;

/** Points behind the title glyphs and the address glyphs, for the contrast checks. */
const TITLE_PTS = grid([2, 30, 60, 90, 118, 132], [111, 119, 127, 135, 143]);
const ADDRESS_PTS = grid([2, 40, 80, 120, 160, 187], [151, 157, 163, 169]);
function grid(xs: number[], ys: number[]): (readonly [number, number])[] {
  return xs.flatMap((x) => ys.map((y) => [x, y] as const));
}

// ---------------------------------------------------------------- maths

type Stops<T> = readonly (readonly [number, T])[];
export type SkyColours = readonly [string, string, string, string, string];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smoothstep = (e0: number, e1: number, v: number) => {
  const t = clamp((v - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** A smooth maximum (no kink where a and b cross). */
const smax = (a: number, b: number, k: number) => (a + b + Math.sqrt((a - b) ** 2 + k * k)) / 2;

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
const num = (s: Stops<number>, el: number) => along(s, el, lerp);
const col = (s: Stops<string>, el: number) => along(s, el, mixColour);
const mixSky = (a: SkyColours, b: SkyColours, t: number) =>
  a.map((c, i) => mixColour(c, b[i], t)) as unknown as SkyColours;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex(c: readonly number[]): string {
  return `#${c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}
/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${+alpha.toFixed(3)})`;
}

// ---------------------------------------------------------------- sky

const NIGHT_SKY: SkyColours = ['#050A21', '#0A1334', '#111C46', '#1A2652', '#252F5E'];

/**
 * Evening: deep blue overhead all day (so white text always reads), gold low
 * down, then a coral and violet sunset and an indigo dusk. The colours are
 * deepest where the title sits and brightest behind the hills.
 */
const EVENING_SKY: Stops<SkyColours> = [
  [-16, NIGHT_SKY],
  [-10, ['#071030', '#0E1A45', '#1A2759', '#283467', '#363C70']],
  [-6.5, ['#0B1540', '#152354', '#26336E', '#43457F', '#62508C']],
  [-3.5, ['#101C4E', '#1B2B66', '#3A3D86', '#86609E', '#D98794']],
  [-1, ['#14235A', '#223779', '#4B4B96', '#C7779A', '#FFA683']],
  [2, ['#17306E', '#274790', '#4A52A0', '#E58E8E', '#FFBE80']],
  [5, ['#193C88', '#2954A2', '#4362AE', '#EEB09C', '#FFD7A0']],
  [9, ['#1A489A', '#2357AD', '#3A68B6', '#E2C8B8', '#FFE6C2']],
  [15, ['#164DA6', '#1D59B3', '#2A68BF', '#B5D2EA', '#F4EEDF']],
  [25, ['#154DA8', '#1C5AB5', '#2968C0', '#97C3EA', '#DFEEF2']],
];

/** Morning: softer and pinker low down, cooler and paler sooner. */
const MORNING_SKY: Stops<SkyColours> = [
  [-16, NIGHT_SKY],
  [-10, ['#081132', '#101C48', '#1D2A5E', '#2C366B', '#3B3F72']],
  [-6.5, ['#0D1744', '#18275B', '#2E3B77', '#4F4E8C', '#735B96']],
  [-3.5, ['#121F55', '#203272', '#424991', '#9A6FA2', '#EC9AA4']],
  [-1, ['#172966', '#29438A', '#5463A6', '#D894B0', '#FFC0A6']],
  [1.5, ['#193577', '#2A4A92', '#4C5FA6', '#EAB4BE', '#FFDDB8']],
  [5, ['#1A3E8A', '#2650A0', '#3E62AA', '#E2C6D2', '#FFEACF']],
  [10, ['#1748A0', '#1E56B0', '#2B66BB', '#C2D8EC', '#FAF1E4']],
  [25, ['#154DA8', '#1C5AB5', '#2968C0', '#97C3EA', '#DFEEF2']],
];

/** The sky colour at art height y. */
export function skyAtY(sky: SkyColours, y: number): string {
  if (y <= SKY_Y[0]) return sky[0];
  for (let i = 1; i < SKY_Y.length; i++) {
    if (y <= SKY_Y[i]) return mixColour(sky[i - 1], sky[i], (y - SKY_Y[i - 1]) / (SKY_Y[i] - SKY_Y[i - 1]));
  }
  return sky[4];
}

// ---------------------------------------------------------------- light

interface Light {
  tint: string;
  amount: number;
  dim: number;
  sat: number;
}
const mixLight = (a: Light, b: Light, t: number): Light => ({
  tint: mixColour(a.tint, b.tint, t),
  amount: lerp(a.amount, b.amount, t),
  dim: lerp(a.dim, b.dim, t),
  sat: lerp(a.sat, b.sat, t),
});
const L = (tint: string, amount: number, dim: number, sat = 1): Light => ({ tint, amount, dim, sat });

const EVENING_LIGHT: Stops<Light> = [
  [-14, L('#121A46', 0.64, 0.56)],
  [-8, L('#1A2454', 0.58, 0.64)],
  [-4, L('#3A387A', 0.48, 0.74, 1.04)],
  [-1.5, L('#6C589E', 0.36, 0.85, 1.08)],
  [1, L('#E88A70', 0.3, 0.95, 1.14)],
  [3, L('#FFA460', 0.28, 1, 1.16)],
  [7, L('#FFBE72', 0.2, 1.02, 1.12)],
  [14, L('#FFDDA4', 0.08, 1, 1.05)],
  [24, L('#FFFFFF', 0, 1)],
];
const MORNING_LIGHT: Stops<Light> = [
  [-14, L('#121A46', 0.64, 0.56)],
  [-8, L('#1C2656', 0.58, 0.65)],
  [-4, L('#423D7E', 0.46, 0.76, 1.04)],
  [-1.5, L('#8868A4', 0.33, 0.87, 1.07)],
  [1, L('#F29C8C', 0.24, 0.96, 1.1)],
  [3, L('#FFB488', 0.2, 1, 1.12)],
  [7, L('#FFD09C', 0.12, 1.02, 1.08)],
  [13, L('#FFE6C6', 0.05, 1, 1.03)],
  [22, L('#FFFFFF', 0, 1)],
];

/** The air between here and the far hills: what distant things fade into. */
const HAZE_EVENING: Stops<string> = [
  [-14, '#1A224E'],
  [-8, '#252D60'],
  [-4, '#54488A'],
  [-1, '#9A6EA4'],
  [2, '#C688B2'],
  [6, '#E4AEB2'],
  [11, '#EAD4C8'],
  [16, '#D9E6EC'],
  [25, '#CFE3EF'],
];
const HAZE_MORNING: Stops<string> = [
  [-14, '#1A224E'],
  [-8, '#272E62'],
  [-4, '#5C4F8E'],
  [-1, '#A680AE'],
  [1.5, '#D6A6C0'],
  [5, '#E8C6CA'],
  [10, '#E6DDD8'],
  [14, '#D9E7EE'],
  [25, '#CFE3EF'],
];

/**
 * The day colours of everything on the ground, with how far away each one is
 * (0 = here, 1 = lost in the haze at the horizon).
 */
const BASE = {
  skyline: ['#5F7D9C', 0.62],
  far: ['#86B8A6', 0.6],
  far2: ['#78AC98', 0.54],
  hill2: ['#8CC47E', 0.36],
  hill2b: ['#76B26E', 0.32],
  distantTree: ['#589A62', 0.4],
  sheep: ['#FBF7EE', 0.3],
  sheepFace: ['#4A4048', 0.3],
  hill3: ['#8CC574', 0.12],
  hill3b: ['#74B064', 0.12],
  field: ['#B4D884', 0.12],
  hedge: ['#4E9455', 0.18],
  poplar: ['#4E9A5A', 0.06],
  poplarLight: ['#7CC36C', 0.06],
  lawn: ['#8ECC6A', 0],
  lawn2: ['#6CB558', 0],
  fore: ['#67B254', 0],
  fore2: ['#4E9A48', 0],
  blade: ['#4A9646', 0],
  canopy: ['#58AA5C', 0],
  canopyLight: ['#8DD072', 0],
  canopyDark: ['#3F8C4F', 0],
  trunk: ['#8E603D', 0],
  trunkDark: ['#6E472C', 0],
  apple: ['#F2574A', 0],
  blossom: ['#FFE4EC', 0],
  bush: ['#5DB262', 0],
  bushLight: ['#8FD375', 0],
  bushDark: ['#3F9352', 0],
  wall: ['#FFF3E0', 0],
  wall2: ['#F7E2C6', 0],
  wallShade: ['#E3C5A2', 0],
  roof: ['#EE7F60', 0],
  roof2: ['#D8634C', 0],
  roofDark: ['#B54E40', 0],
  roofLine: ['#C55946', 0],
  trim: ['#FFFAF2', 0],
  door: ['#3C8C86', 0],
  doorDark: ['#2A6B66', 0],
  brass: ['#F2C14E', 0],
  lantern: ['#3B3A40', 0],
  brick: ['#D47B5E', 0],
  brickDark: ['#A9594A', 0],
  pot: ['#E89766', 0],
  curtain: ['#F6B9A4', 0],
  box: ['#B07250', 0],
  path: ['#F1DEC0', 0],
  pathEdge: ['#DBC09C', 0],
  stone: ['#E4CDA9', 0],
  stoneDark: ['#C9AC86', 0],
  fence: ['#FFF8EE', 0],
  fenceShade: ['#E4D5C1', 0],
  pondEdge: ['#A6BDA6', 0],
  reed: ['#5E9E50', 0],
  cattail: ['#8A5A36', 0],
  lily: ['#5EB062', 0],
  pink: ['#FF8FAE', 0],
  white: ['#FFF9F3', 0],
  yellow: ['#FFD24E', 0],
  lavender: ['#B5A0F4', 0],
  coral: ['#FF8A66', 0],
  rose: ['#EE5C78', 0],
  orange: ['#F28A2E', 0],
  burgundy: ['#B23A55', 0],
  berry: ['#E2384A', 0],
  pumpkin: ['#F39436', 0],
  pumpkinDark: ['#D46E22', 0],
  wreath: ['#3F8A4C', 0],
  toadstool: ['#EE5A4A', 0],
  robin: ['#8C6B4B', 0],
  robinBreast: ['#EC6A3C', 0],
  stalk: ['#FBEEDD', 0],
  shadow: ['#1E3F2C', 0],
  // The duck: clearly green.
  duck: ['#5BC26A', 0],
  duckLight: ['#A6E98C', 0],
  duckShade: ['#36975A', 0],
  duckWing: ['#3A9C5A', 0],
  duckWingLight: ['#9AE397', 0],
  duckHead: ['#2E9E5E', 0],
  duckSheen: ['#86E3A8', 0],
  bill: ['#FFA43C', 0],
  billDark: ['#E07E28', 0],
  // The hedgehog: clearly brown.
  spines: ['#8C5A2E', 0],
  spinesLight: ['#B47E48', 0],
  spinesDark: ['#5C391C', 0],
  face: ['#EECBA0', 0],
  faceShade: ['#D9AD7E', 0],
  ear: ['#F2A99A', 0],
  nose: ['#3A2517', 0],
  ink: ['#1F2529', 0],
  blush: ['#FF9B95', 0],
  feet: ['#6A4428', 0],
} as const satisfies Record<string, readonly [string, number]>;

type PaintKey = keyof typeof BASE;
export type Paint = Record<PaintKey, string>;

/** The duck and the hedgehog keep more of their colour at night (and the lamps are near). */
const CHARACTER = new Set<PaintKey>([
  'duck', 'duckLight', 'duckShade', 'duckWing', 'duckWingLight', 'duckHead', 'duckSheen', 'bill', 'billDark',
  'spines', 'spinesLight', 'spinesDark', 'face', 'faceShade', 'ear', 'nose', 'blush', 'feet',
]);

function light(base: string, l: Light, keep = 0): string {
  const amount = l.amount * (1 - keep);
  const dim = 1 - (1 - l.dim) * (1 - keep);
  const [r, g, b] = rgb(mixColour(base, l.tint, amount)).map((v) => v * dim);
  const grey = (r + g + b) / 3;
  return toHex([r, g, b].map((v) => grey + (v - grey) * l.sat));
}

// ---------------------------------------------------------------- seasons

export type TreeLook = 'bare' | 'blossom' | 'green' | 'apples' | 'gold' | 'rust';
export type Blooms = 'winter' | 'spring' | 'summer' | 'autumn';

const TREE_BY_MONTH: readonly TreeLook[] = [
  'bare', 'bare', 'blossom', 'blossom', 'green', 'green', 'apples', 'apples', 'apples', 'gold', 'rust', 'bare',
];
const CANOPY: Record<TreeLook, readonly [string, string, string]> = {
  bare: ['#58AA5C', '#8DD072', '#3F8C4F'],
  blossom: ['#9ACB84', '#E9F7DA', '#6AA86A'],
  green: ['#55A85A', '#8CD072', '#3D8A4E'],
  apples: ['#58AA5C', '#8DD072', '#3F8C4F'],
  gold: ['#E39B38', '#FFD06A', '#B9682A'],
  rust: ['#C46A38', '#EB9A56', '#924529'],
};

// ---------------------------------------------------------------- the rest

const SUN_EVENING: Stops<string> = [
  [-1, '#FF6A3A'],
  [2, '#FF8A45'],
  [6, '#FFB25A'],
  [14, '#FFDC86'],
  [30, '#FFF2C4'],
];
const SUN_MORNING: Stops<string> = [
  [-1, '#FF7E52'],
  [2, '#FF9C5E'],
  [6, '#FFC575'],
  [14, '#FFE59A'],
  [30, '#FFF3C8'],
];
/** How strongly the low sun warms the horizon and lights the edges of things. */
const GOLDEN: Stops<number> = [
  [-9, 0],
  [-5, 0.35],
  [-2, 0.8],
  [1, 1],
  [5, 0.85],
  [10, 0.4],
  [18, 0.08],
  [26, 0],
];
const GLOW_EVENING: Stops<string> = [
  [-6, '#B85C8C'],
  [-2, '#EE7680'],
  [1, '#FF8650'],
  [6, '#FFB060'],
];
const GLOW_MORNING: Stops<string> = [
  [-6, '#B874A0'],
  [-2, '#F296A0'],
  [1, '#FFA074'],
  [6, '#FFC888'],
];
/** Rim light on hill crests and roofs: warm from the low sun, cool from the moon. */
const RIM: Stops<number> = [
  [-12, 0.5],
  [-7, 0.3],
  [-3, 0.35],
  [0, 0.95],
  [5, 0.85],
  [12, 0.45],
  [24, 0.3],
];
const RIM_EVENING: Stops<string> = [
  [-8, '#8EA2E6'],
  [-3, '#E7A0C0'],
  [0, '#FFAE6C'],
  [8, '#FFD08A'],
  [22, '#FFF6DA'],
];
const RIM_MORNING: Stops<string> = [
  [-8, '#8EA2E6'],
  [-3, '#F0B4CC'],
  [0, '#FFC096'],
  [8, '#FFDCAA'],
  [22, '#FFF6DA'],
];
const MOON_UP: Stops<number> = [
  [-8, 1],
  [-3, 0],
];
const STARS_BRIGHT: Stops<number> = [
  [-8, 1],
  [-2.5, 0],
];
const STARS_FAINT: Stops<number> = [
  [-12, 1],
  [-6, 0],
];
const MILKY: Stops<number> = [
  [-16, 1],
  [-11, 0],
];
/** Lamps come on in the evening before the sun has quite gone. */
const LAMPS_EVENING: Stops<number> = [
  [-4, 1],
  [3, 0],
];
const LAMPS_MORNING: Stops<number> = [
  [-3, 1],
  [1, 0],
];
const CLOUD_TOP: Stops<string> = [
  [-12, '#56628F'],
  [-6, '#6A5F94'],
  [-2.5, '#DC8CA8'],
  [1, '#FFB48C'],
  [5, '#FFD8B6'],
  [12, '#FFF7EE'],
  [22, '#FFFFFF'],
];
const CLOUD_BOTTOM: Stops<string> = [
  [-12, '#252D5A'],
  [-6, '#3A3D76'],
  [-2.5, '#7A5C96'],
  [1, '#C47A9A'],
  [5, '#D6A6BC'],
  [12, '#D3DDEE'],
  [22, '#D6E3F5'],
];
const CLOUD_ALPHA: Stops<number> = [
  [-12, 0.36],
  [-5, 0.72],
  [2, 0.97],
];
/** Mist lying in the valleys: thickest around dawn, a little at dusk. */
const MIST_MORNING: Stops<number> = [
  [-11, 0],
  [-6, 0.5],
  [-2, 0.9],
  [2, 0.8],
  [7, 0.35],
  [13, 0],
];
const MIST_EVENING: Stops<number> = [
  [-9, 0],
  [-4, 0.35],
  [-1, 0.4],
  [3, 0.18],
  [8, 0],
];
const FIREFLIES: Stops<number> = [
  [-6, 1],
  [1, 0],
];

const zoneFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON.timeZone,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  hourCycle: 'h23',
});

/** The calendar in London at `date`. */
export function londonClock(date: Date): { year: number; month: number; day: number; hour: number } {
  const parts = zoneFormat.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}

// ---------------------------------------------------------------- sun and moon

export interface SunPlace {
  x: number;
  y: number;
  r: number;
}

/**
 * Where the sun sits in the picture. It rises in the east (left) behind the
 * London skyline, skims low beneath the address, then climbs right of the
 * title block, crosses the sky above the house and sets in the west behind the
 * poplars. Noon is higher in summer, and sunrise and sunset sit further apart.
 */
export function sunPlace(date: Date): SunPlace {
  const state = skyAt(date);
  const { maxElevation } = sunTimes(date, LONDON.lat, LONDON.lon);
  const summer = clamp((maxElevation - 15) / 47, 0, 1);
  const apex = lerp(122, 88, summer);
  const el = state.elevation;
  const lift = el >= 0 ? (HORIZON - apex) * clamp(el / Math.max(1, maxElevation), 0, 1) ** 0.8 : el * 4;
  const y = HORIZON - lift;
  const p = clamp(state.dayProgress, -0.1, 1.1);
  const xRise = lerp(70, 30, summer);
  const xSet = lerp(338, 386, summer);
  const xNoon = 250;
  const xLine = p < 0.5 ? lerp(xRise, xNoon, clamp(p / 0.5, 0, 1)) : lerp(xNoon, xSet, clamp((p - 0.5) / 0.5, 0, 1));
  // Never behind the title: until it is clear of the address it stays low.
  const clear = 228 * smoothstep(201, 194, y);
  return { x: smax(xLine, clear, 12), y, r: 12.5 };
}

const SYNODIC = 29.530588853;
/** A new moon (6 Jan 2000, 18:14 UTC). */
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

export interface MoonPlace {
  x: number;
  y: number;
  r: number;
  /** Days since the new moon, 0 to 29.5. */
  age: number;
  /** Shown age: never thinner than a slim crescent, so there is always a moon to see. */
  shown: number;
  name: 'crescent' | 'half' | 'gibbous' | 'full';
}

/** The moon: its real phase, arcing over the right of the sky through the night. */
export function moonPlace(date: Date): MoonPlace {
  const t = date.getTime();
  const age = ((((t - NEW_MOON) / 86_400_000) % SYNODIC) + SYNODIC) % SYNODIC;
  const shown = clamp(age, 2.6, SYNODIC - 2.6);
  const lit = (1 - Math.cos((2 * Math.PI * shown) / SYNODIC)) / 2;
  const name = lit > 0.94 ? 'full' : lit > 0.6 ? 'gibbous' : lit > 0.4 ? 'half' : 'crescent';
  const times = sunTimes(date, LONDON.lat, LONDON.lon);
  const rise = times.sunrise?.getTime() ?? times.solarNoon.getTime() - 6 * 3_600_000;
  const set = times.sunset?.getTime() ?? times.solarNoon.getTime() + 6 * 3_600_000;
  const night = 86_400_000 - (set - rise);
  const n = clamp(t > times.solarNoon.getTime() ? (t - set) / night : 1 - (rise - t) / night, 0, 1);
  return { x: lerp(222, 308, n), y: 124 - 54 * Math.sin(Math.PI * n), r: 10, age, shown, name };
}

// ---------------------------------------------------------------- glows

/** A soft elliptical glow (a radial gradient), drawn in the sky and used by the contrast model. */
export interface Glow {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  opacity: number;
  /** Offset 0..1, colour, alpha. */
  stops: readonly (readonly [number, string, number])[];
}

function glowAt(g: Glow, x: number, y: number): [string, number] | null {
  const t = Math.hypot((x - g.cx) / g.rx, (y - g.cy) / g.ry);
  if (t >= 1 || g.opacity <= 0) return null;
  const s = g.stops;
  if (t <= s[0][0]) return [s[0][1], s[0][2] * g.opacity];
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i][0]) {
      const k = (t - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      return [mixColour(s[i - 1][1], s[i][1], k), lerp(s[i - 1][2], s[i][2], k) * g.opacity];
    }
  }
  return [s[s.length - 1][1], s[s.length - 1][2] * g.opacity];
}
function over(c: string, glows: readonly Glow[], x: number, y: number): string {
  let out = c;
  for (const g of glows) {
    const hit = glowAt(g, x, y);
    if (hit) out = mixColour(out, hit[0], hit[1]);
  }
  return out;
}

/** The wash behind the title block: where it sits (its colour and strength are solved per minute). */
export const WASH = { cx: 62, cy: 140, rx: 252, ry: 66 } as const;
const washGlow = (colour: string, alpha: number): Glow => ({
  ...WASH,
  opacity: alpha,
  stops: [
    [0, colour, 1],
    [0.5, colour, 0.92],
    [1, colour, 0],
  ],
});

// ---------------------------------------------------------------- tone

export type Tone = 'light' | 'dark';

/** The text colours the hero's children get (Hero.module.css mirrors these). */
export const INK = {
  light: { title: '#FFFFFF', secondary: '#FFFFFF', alpha: 0.92 },
  dark: { title: '#0B1A30', secondary: '#0B1A30', alpha: 0.72 },
} as const;
/** Contrast the title and the address must reach against the sky behind them. */
export const TARGET = { title: 5.6, address: 4.6 } as const;

export interface TextContrast {
  title: number;
  address: number;
}

/** The worst contrast of the title and the address against the modelled sky. */
export function textContrast(
  tone: Tone,
  bg: (x: number, y: number) => string,
): TextContrast {
  const ink = INK[tone];
  let title = Infinity;
  let address = Infinity;
  for (const [x, y] of TITLE_PTS) title = Math.min(title, contrast(ink.title, bg(x, y)));
  for (const [x, y] of ADDRESS_PTS) {
    const b = bg(x, y);
    address = Math.min(address, contrast(mixColour(b, ink.secondary, ink.alpha), b));
  }
  return { title, address };
}

// ---------------------------------------------------------------- clouds

export interface CloudSpec {
  /** Lane: the cloud's left edge travels from x0 to x1 - w. */
  x0: number;
  x1: number;
  y: number;
  w: number;
  shape: number;
  /** Seconds for one crossing. */
  dur: number;
  /** Where it is at the epoch, 0..1 along its lane. */
  phase: number;
  /** Low, distant clouds are flatter and fainter. */
  far: boolean;
}

/** Lanes that keep clouds out of the status bar, the title block and the avatar. */
const LANES = [
  { x0: 204, x1: 320, y: [62, 72], w: [34, 46], far: false },
  { x0: 204, x1: 470, y: [114, 120], w: [42, 60], far: false },
  { x0: 96, x1: 470, y: [178, 184], w: [34, 58], far: true },
] as const;

function seeded(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** The day's clouds: how many, where and what shape change from day to day. */
export function cloudsOfDay(key: number): CloudSpec[] {
  const rnd = seeded(key * 7919 + 13);
  const count = [2, 3, 3, 4][Math.floor(rnd() * 4)];
  const order = [1, 2, 0, 2, 1];
  const out: CloudSpec[] = [];
  for (let i = 0; i < count; i++) {
    const lane = LANES[order[(i + Math.floor(rnd() * 2)) % order.length]];
    const w = Math.round(lerp(lane.w[0], lane.w[1], rnd()));
    out.push({
      x0: lane.x0,
      x1: lane.x1,
      y: Math.round(lerp(lane.y[0], lane.y[1], rnd())),
      w,
      shape: Math.floor(rnd() * 4),
      // Not a whole number of seconds, so moments minutes apart find it in different places.
      dur: +((lane.x1 - lane.x0) * lerp(0.9, 1.4, rnd()) * (lane.far ? 1.5 : 1)).toFixed(1) + 0.37,
      phase: rnd(),
      far: lane.far,
    });
  }
  return out;
}

// ---------------------------------------------------------------- the look

export interface HeroLook {
  phase: SkyPhase;
  elevation: number;
  morning: boolean;
  month: number;
  hour: number;
  /** A number for the London date, so the clouds can change from day to day. */
  dayKey: number;
  sky: SkyColours;
  /** Glows painted over the sky gradient (horizon, city), below the wash. */
  skyGlows: Glow[];
  /** The sun's bloom and halo, over the wash. */
  sunGlows: Glow[];
  sun: SunPlace & { colour: string; visible: number };
  moon: MoonPlace & { visible: number };
  /** 0 to 1, how golden the light is (low sun). */
  golden: number;
  /** Where the light comes from: -1 left (morning sun) to 1 right (evening sun); 0 at night. */
  side: number;
  horizon: { x: number; colour: string };
  rim: { colour: string; strength: number };
  stars: { bright: number; faint: number; milky: number };
  /** Window light: the ground floor and the attic (a reading lamp stays on late). */
  lamps: { ground: number; attic: number; lantern: number };
  /** Lights of London and the neighbours. */
  city: number;
  cloud: { top: string; bottom: string; alpha: number };
  clouds: CloudSpec[];
  smoke: boolean;
  birds: boolean;
  fireflies: number;
  mist: { strength: number; colour: string };
  water: readonly [string, string];
  /** Window glass, reflecting the sky. */
  glass: readonly [string, string];
  /** The glint on the pond: the sun's or the moon's colour, and how bright. */
  glint: { colour: string; strength: number };
  tree: TreeLook;
  blooms: Blooms;
  leaves: boolean;
  pumpkin: boolean;
  wreath: boolean;
  /** A robin on the gate post, December to February by day. */
  robin: boolean;
  tone: Tone;
  wash: { colour: string; alpha: number };
  /** The worst text contrast with the chosen tone and wash. */
  contrast: TextContrast;
  description: string;
  paint: Paint;
}

const PHASE_PHRASE: Record<SkyPhase, string> = {
  night: 'at night',
  dawn: 'at dawn',
  sunrise: 'at sunrise',
  day: 'in the daytime',
  sunset: 'at sunset',
  dusk: 'at dusk',
};
const SEASON_WORD: Record<Blooms, string> = {
  winter: 'winter',
  spring: 'spring',
  summer: 'summer',
  autumn: 'autumn',
};

/** Everything the hero needs to draw London's sky and the garden at `date`. */
export function heroLook(date: Date): HeroLook {
  const state = skyAt(date);
  const el = state.elevation;
  const morning = state.dayProgress < 0.5;
  const { year, month, day, hour } = londonClock(date);
  const sky = along(morning ? MORNING_SKY : EVENING_SKY, el, mixSky);
  const ambient = along(morning ? MORNING_LIGHT : EVENING_LIGHT, el, mixLight);
  const haze = col(morning ? HAZE_MORNING : HAZE_EVENING, el);
  const golden = num(GOLDEN, el);

  const tree = TREE_BY_MONTH[month - 1];
  const blooms: Blooms = month <= 2 || month === 12 ? 'winter' : month <= 4 ? 'spring' : month <= 9 ? 'summer' : 'autumn';

  // Paint: the day colours (with the season's tree and lawn), lit and hazed.
  const base: Record<PaintKey, readonly [string, number]> = { ...BASE };
  const [canopy, canopyLight, canopyDark] = CANOPY[tree];
  base.canopy = [canopy, 0];
  base.canopyLight = [canopyLight, 0];
  base.canopyDark = [canopyDark, 0];
  if (blooms === 'winter') {
    for (const k of ['lawn', 'lawn2', 'fore', 'fore2', 'hill2', 'hill3', 'hill3b', 'field'] as const) {
      base[k] = [mixColour(BASE[k][0], '#A7A46A', 0.22), BASE[k][1]];
    }
  }
  const keepChar = 0.46;
  const paint = {} as Paint;
  for (const key of Object.keys(base) as PaintKey[]) {
    const [c, depth] = base[key];
    const lit = light(c, ambient, CHARACTER.has(key) ? keepChar : 0);
    paint[key] = depth ? mixColour(lit, haze, depth) : lit;
  }

  // The sun and its glows.
  const sunAt = sunPlace(date);
  const sunColour = col(morning ? SUN_MORNING : SUN_EVENING, el);
  const sunVisible = clamp((el + 2.5) / 3, 0, 1);
  const glowColour = col(morning ? GLOW_MORNING : GLOW_EVENING, el);
  const horizonX = clamp(sunAt.x, -20, 430);
  // A low sun's glow hugs the horizon; a high one spreads round.
  const flat = lerp(0.36, 1, smoothstep(186, 116, sunAt.y));
  const bloomR = 92 + 76 * golden;
  const sunGlows: Glow[] = sunVisible > 0
    ? [
        {
          cx: sunAt.x,
          cy: sunAt.y,
          rx: bloomR,
          ry: bloomR * flat,
          opacity: sunVisible * lerp(0.8, 1, golden),
          stops: [
            [0, sunColour, 0.5],
            [0.12, sunColour, 0.28],
            [0.4, sunColour, 0.08],
            [1, sunColour, 0],
          ],
        },
        {
          cx: sunAt.x,
          cy: sunAt.y,
          rx: sunAt.r * 2.3,
          ry: sunAt.r * 2.3,
          opacity: 0.8 * sunVisible,
          stops: [
            [0.3, '#FFFBEA', 0.7],
            [0.5, sunColour, 0.3],
            [1, sunColour, 0],
          ],
        },
      ]
    : [];

  const lampsOn = num(morning ? LAMPS_MORNING : LAMPS_EVENING, el);
  // After 1am most of the house is asleep: the ground floor dims, the attic lamp stays on.
  const late = hour >= 1 && hour < 5;
  const skyGlows: Glow[] = [
    {
      cx: horizonX,
      cy: 214,
      rx: 290,
      ry: 54,
      opacity: golden,
      stops: [
        [0, glowColour, 0.95],
        [0.45, glowColour, 0.42],
        [1, glowColour, 0],
      ],
    },
    // London's glow on the horizon at night.
    {
      cx: 46,
      cy: 212,
      rx: 120,
      ry: 30,
      opacity: lampsOn * 0.55,
      stops: [
        [0, '#E39A6A', 0.55],
        [0.5, '#B07084', 0.2],
        [1, '#B07084', 0],
      ],
    },
  ];

  // The text tone that needs the least help from the wash behind the title.
  // White text is preferred (it matches the white status bar): it wins unless
  // the wash would have to be very strong.
  const behind = (washColour: string, alpha: number) => (x: number, y: number) =>
    over(over(over(skyAtY(sky, y), skyGlows, x, y), [washGlow(washColour, alpha)], x, y), sunGlows, x, y);
  const solve = (tone: Tone) => {
    const colour =
      tone === 'light'
        ? mixColour(mixColour(sky[1], sky[2], 0.3), '#040B2A', 0.34)
        : mixColour(sky[2], '#FFFFFF', 0.72);
    for (let alpha = 0; alpha <= 0.9001; alpha += 0.02) {
      const c = textContrast(tone, behind(colour, alpha));
      if (c.title >= TARGET.title && c.address >= TARGET.address) return { colour, alpha: +alpha.toFixed(2), c };
    }
    return { colour, alpha: 0.9, c: textContrast(tone, behind(colour, 0.9)) };
  };
  const forLight = solve('light');
  const ok = (s: ReturnType<typeof solve>) => s.c.title >= TARGET.title && s.c.address >= TARGET.address;
  const pick = ok(forLight) && forLight.alpha <= 0.62 ? forLight : null;
  const forDark = pick ? null : solve('dark');
  const tone: Tone = pick ? 'light' : forDark && ok(forDark) && forDark.alpha < forLight.alpha ? 'dark' : 'light';
  const chosen = tone === 'light' ? forLight : forDark!;

  const moonAt = moonPlace(date);
  const moonVisible = num(MOON_UP, el);
  const cold = month >= 10 || month <= 4;
  const summer = month >= 6 && month <= 8;
  const side = el > -4 ? clamp((sunAt.x - 214) / 150, -1, 1) : 0;
  const glint =
    el > -1
      ? { colour: mixColour(sunColour, '#FFFFFF', 0.4), strength: clamp((el + 1) / 4, 0, 1) * 0.9 }
      : { colour: '#DCE4FF', strength: moonVisible * 0.38 };

  const extras: string[] = [];
  if (moonVisible > 0.5) extras.push(`under a ${moonAt.name} moon and stars`);
  if (lampsOn > 0.5) extras.push('with lamps lit in the windows');
  const description =
    `An illustration of a cottage in its garden in London ${PHASE_PHRASE[state.phase]} in ${SEASON_WORD[blooms]}` +
    `${extras.length ? `, ${extras.join(', ')}` : ''}, with a green duck on the pond and a brown hedgehog by the fence.`;

  return {
    phase: state.phase,
    elevation: el,
    morning,
    month,
    hour,
    dayKey: year * 400 + month * 32 + day,
    sky,
    skyGlows,
    sunGlows,
    sun: { ...sunAt, r: lerp(12.5, 14, golden), colour: sunColour, visible: sunVisible },
    moon: { ...moonAt, visible: moonVisible },
    golden,
    side,
    horizon: { x: horizonX, colour: glowColour },
    rim: { colour: col(morning ? RIM_MORNING : RIM_EVENING, el), strength: num(RIM, el) },
    stars: { bright: num(STARS_BRIGHT, el), faint: num(STARS_FAINT, el), milky: num(MILKY, el) },
    lamps: { ground: lampsOn * (late ? 0.3 : 1), attic: lampsOn, lantern: lampsOn * (late ? 0.6 : 1) },
    city: lampsOn,
    cloud: { top: col(CLOUD_TOP, el), bottom: col(CLOUD_BOTTOM, el), alpha: num(CLOUD_ALPHA, el) },
    clouds: cloudsOfDay(year * 400 + month * 32 + day),
    smoke: cold && (hour >= 16 || hour < 10),
    birds: el > 4,
    fireflies: summer ? num(FIREFLIES, el) : 0,
    mist: { strength: num(morning ? MIST_MORNING : MIST_EVENING, el), colour: mixColour(haze, '#FFFFFF', 0.4) },
    water: [
      light(mixColour(sky[3], '#3E86A0', 0.3), ambient, 0.5),
      light(mixColour(sky[1], '#24607E', 0.35), ambient, 0.5),
    ],
    glass: [
      mixColour(mixColour(sky[1], sky[2], 0.6), '#FFFFFF', 0.28),
      mixColour(mixColour(sky[3], sky[4], 0.3), '#FFFFFF', 0.12),
    ],
    glint,
    tree,
    blooms,
    leaves: month === 10 || month === 11,
    pumpkin: month === 10,
    wreath: month === 12,
    robin: blooms === 'winter' && el > -3,
    tone,
    wash: { colour: chosen.colour, alpha: chosen.alpha },
    contrast: chosen.c,
    description,
    paint,
  };
}
