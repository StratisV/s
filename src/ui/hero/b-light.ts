// Hero B ("Cinematic layers"): the light model. From the real London sun
// (sun.ts) it works out every colour of the scene for one moment: the sky
// gradient, the sun and moon, and a colour grade for the land that multiplies
// each layer by the light of the hour and mixes it into the haze by distance
// (atmospheric perspective). Pure functions, no DOM.
import { skyAt, type SkyPhase, type SkyState } from '../../lib/logic/sun';

type RGB = readonly [number, number, number];
type Stops<T> = readonly (readonly [number, T])[];
type Sky5 = readonly [string, string, string, string, string];

/** The stage the art is drawn on (viewBox units; 1 unit = 1px on a 402pt wide iPhone). */
export const STAGE_W = 402;
export const STAGE_H = 358;
/** Where the sky gradient stops sit, from the top of the stage down to the horizon. */
export const SKY_Y = [0, 92, 165, 214, 248] as const;

const rgbOf = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hexOf = (c: RGB): string =>
  `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Mixes two #rrggbb colours: t = 0 gives a, 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  const k = clamp(t, 0, 1);
  return hexOf([lerp(x[0], y[0], k), lerp(x[1], y[1], k), lerp(x[2], y[2], k)]);
}

function multiply(a: string, b: string): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return hexOf([(x[0] * y[0]) / 255, (x[1] * y[1]) / 255, (x[2] * y[2]) / 255]);
}

/** Screen blend: lightens a by b at strength k (0 to 1). */
function screen(a: string, b: string, k: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return hexOf([0, 1, 2].map((i) => 255 - ((255 - x[i]) * (255 - y[i] * k)) / 255) as unknown as RGB);
}

/** Pushes a colour away from its grey (k > 1 is more saturated). */
function saturate(a: string, k: number): string {
  const [r, g, b] = rgbOf(a);
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  return hexOf([grey + (r - grey) * k, grey + (g - grey) * k, grey + (b - grey) * k]);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r},${g},${b},${+alpha.toFixed(3)})`;
}

function along<T>(stops: Stops<T>, el: number, mixer: (a: T, b: T, t: number) => T): T {
  if (el <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [e1, v1] = stops[i];
    if (el <= e1) {
      const [e0, v0] = stops[i - 1];
      return mixer(v0, v1, (el - e0) / (e1 - e0));
    }
  }
  return stops[stops.length - 1][1];
}
const num = (s: Stops<number>, el: number) => along(s, el, lerp);
const col = (s: Stops<string>, el: number) => along(s, el, mix);
const sky5 = (s: Stops<Sky5>, el: number) =>
  along(s, el, (a, b, t) => a.map((c, i) => mix(c, b[i], t)) as unknown as Sky5);

// ---------------------------------------------------------------------------
// Sky: zenith, upper, middle, low and horizon, by sun elevation (degrees).
// Deep and saturated at the top in every phase, so white status bar text and
// a white title always read; the colour lives near the horizon.

const NIGHT_SKY: Sky5 = ['#030817', '#07112B', '#0C1A3B', '#14254D', '#1C2E5A'];

const SKY_EVENING: Stops<Sky5> = [
  [-16, NIGHT_SKY],
  [-10, ['#050D24', '#0B183A', '#152554', '#243268', '#323A72']],
  [-6.5, ['#0A1636', '#172859', '#303878', '#5C4D8A', '#93608A']],
  [-3, ['#11224F', '#243F82', '#4E5498', '#9A6B9C', '#E2817A']],
  [0, ['#183370', '#2C569A', '#6B6BA6', '#D28A93', '#FF985A']],
  [2.5, ['#1E4284', '#3360A6', '#6A73AC', '#E8A693', '#FFB466']],
  [6, ['#22509A', '#3A70B8', '#5C82BE', '#E4BFA4', '#FFCF8C']],
  [11, ['#1F57A6', '#3574C4', '#5088CC', '#C3D8DE', '#F0E4C6']],
  [20, ['#1C5AB2', '#2F74C8', '#4A88D4', '#A9D0EE', '#D6EAF3']],
  [45, ['#1756B0', '#2C70C6', '#4686D4', '#A0CCF0', '#CFE7F6']],
];

/** Mornings: the same story, softer, pinker and more lilac. */
const SKY_MORNING: Stops<Sky5> = [
  [-16, NIGHT_SKY],
  [-10, ['#060E26', '#0D1B40', '#182A60', '#2B3874', '#3C417C']],
  [-6.5, ['#0B1839', '#1B2C61', '#383F84', '#6A5694', '#A26C94']],
  [-3, ['#13265A', '#2B4790', '#5D60A8', '#B07CAA', '#EE9C98']],
  [0, ['#1B3876', '#335EA2', '#7272AE', '#E09DA6', '#FFB38E']],
  [2.5, ['#21468A', '#3A68AE', '#7480B6', '#EEB6A6', '#FFC59A']],
  [6, ['#2554A0', '#3F78BE', '#6188C4', '#E6CAB6', '#FFDAAA']],
  [11, ['#1F57A6', '#3574C4', '#5088CC', '#C6DAE0', '#F2E8D0']],
  [20, ['#1C5AB2', '#2F74C8', '#4A88D4', '#A9D0EE', '#D6EAF3']],
  [45, ['#1756B0', '#2C70C6', '#4686D4', '#A0CCF0', '#CFE7F6']],
];

/** The light falling on the land (multiplied in): moonlit blue, violet, rose, gold, white. */
const LIGHT_EVENING: Stops<string> = [
  [-14, '#313B5E'],
  [-9, '#384068'],
  [-5.5, '#4C4C80'],
  [-2.5, '#8E78A2'],
  [-0.5, '#D48C80'],
  [2, '#FFBE84'],
  [5, '#FFD298'],
  [9, '#FFDCAA'],
  [15, '#FFEED6'],
  [25, '#FFF9F0'],
  [40, '#FFFFFF'],
];
const LIGHT_MORNING: Stops<string> = [
  [-14, '#313B5E'],
  [-9, '#39426A'],
  [-5.5, '#525286'],
  [-2.5, '#9886B0'],
  [-0.5, '#DE9EA2'],
  [2, '#FFC4A0'],
  [5, '#FFD2A8'],
  [9, '#FFE3C0'],
  [15, '#FFF2E0'],
  [25, '#FFFAF4'],
  [40, '#FFFFFF'],
];

const SUN_CORE: Stops<string> = [
  [-1, '#FF7E45'],
  [1.5, '#FF9C55'],
  [4, '#FFBC70'],
  [8, '#FFD994'],
  [15, '#FFEDC2'],
  [30, '#FFF7E2'],
];
const SUN_GLOW: Stops<string> = [
  [-2, '#FF6E48'],
  [1.5, '#FF8E50'],
  [5, '#FFB56A'],
  [10, '#FFD796'],
  [25, '#FFF0C8'],
];

/** Cloud tops (lit from above by day) and bases (lit from below at sunset). */
const CLOUD_TOP: Stops<string> = [
  [-12, '#16203F'],
  [-6, '#2B3462'],
  [-3, '#5C5790'],
  [0, '#9184B0'],
  [3, '#C6A9C2'],
  [7, '#F4E2E2'],
  [14, '#FFFFFF'],
];
const CLOUD_BASE: Stops<string> = [
  [-12, '#0E1733'],
  [-6, '#4A3F78'],
  [-3, '#E07F8E'],
  [0, '#FF9A62'],
  [3, '#FFB772'],
  [7, '#FFD9B0'],
  [14, '#D6E6F6'],
];

// ---------------------------------------------------------------------------
// The scene's own colours by day (before grading). Characters are graded more
// gently so the duck stays clearly green and the hedgehog clearly brown at night.

const BASE = {
  skyline: '#6F829C',
  ridgeFar: '#8AA6A6',
  ridgeA: '#76A486',
  hillB: '#6AAA63',
  hillBtrees: '#4C8A4F',
  hillC: '#7DBB57',
  hillCfield: '#9CCB63',
  hillCdark: '#4A873E',
  garden: '#84C155',
  gardenDark: '#6FAE48',
  lawn: '#8DCA5A',
  lawnDark: '#5E9D3F',
  tuft: '#5A9A3E',
  trunk: '#7A5434',
  poplar: '#4F9655',
  poplarShade: '#33714A',
  bush: '#5FA851',
  bushShade: '#3F823F',
  wall: '#F7ECD9',
  wallShade: '#E1CDAF',
  plinth: '#CDB999',
  roof: '#D7643F',
  roofLight: '#E98158',
  roofShade: '#AD472E',
  roofLine: '#BC5233',
  chimney: '#C4643F',
  chimneyShade: '#94452D',
  cap: '#EBDCC6',
  door: '#2A7C7F',
  doorDark: '#1D5E61',
  brass: '#F2C452',
  frame: '#FFFFFF',
  glassTop: '#86BEEA',
  glassBottom: '#D6ECFA',
  box: '#8E5C3A',
  path: '#EADCC3',
  pathShade: '#D2C1A3',
  fence: '#FCFBF7',
  fenceShade: '#D8D2C5',
  pondEdge: '#5F944F',
  stone: '#BDB5A5',
  sheep: '#F4F1EA',
  sheepFace: '#3D3A3A',
  reed: '#4C8A3A',
  cattail: '#7B4C2B',
  lily: '#4C9E58',
  pink: '#F48DB4',
  rose: '#E8506A',
  yellow: '#FFD24A',
  white: '#FFFFFF',
  lilac: '#A992DE',
  hydrangea: '#7F9CF0',
  leaf: '#E9893A',
  leafRed: '#D2593A',
  // The green duck.
  duck: '#2AA866',
  duckHead: '#13865A',
  duckShine: '#4FD39A',
  duckWing: '#1B7A4E',
  duckBelly: '#7ED3A0',
  bill: '#FFA42E',
  billDark: '#E0801A',
  eye: '#122019',
  speculum: '#4C6FE3',
  // The brown hedgehog.
  spines: '#6B4326',
  spinesMid: '#8A5A31',
  spinesLight: '#B07C48',
  face: '#ECCBA2',
  faceShade: '#D6AE80',
  nose: '#2A1B12',
  feet: '#563720',
  blush: '#F29C88',
} as const;

type BaseKey = keyof typeof BASE;

/** How far into the haze each kind of thing sits (0 near, 1 lost in the air). */
/**
 * How far away each layer is: 1 is the farthest range, 0 the lawn at your
 * feet. Far layers sink into the haze; near land falls into a deeper, cooler
 * key when the sun is low (backlit), while the house, garden and animals stay lit.
 */
const DEPTH: Partial<Record<BaseKey, number>> = {
  ridgeFar: 1,
  skyline: 0.86,
  ridgeA: 0.8,
  hillB: 0.62,
  hillBtrees: 0.64,
  hillC: 0.42,
  hillCfield: 0.42,
  hillCdark: 0.44,
  sheep: 0.36,
  sheepFace: 0.36,
  garden: 0.22,
  gardenDark: 0.2,
  poplar: 0.2,
  poplarShade: 0.2,
  lawn: 0.04,
  lawnDark: 0,
  tuft: 0,
  pondEdge: 0.04,
  reed: 0.02,
  cattail: 0.02,
};

/** Land that goes into the backlit key at golden hour (not the house, garden or animals). */
const BACKLIT = new Set<BaseKey>(['hillB', 'hillBtrees', 'hillC', 'hillCfield', 'hillCdark', 'garden', 'gardenDark', 'lawn', 'lawnDark', 'tuft', 'pondEdge', 'reed', 'cattail']);

const SHADED = new Set<BaseKey>([
  'hillBtrees',
  'hillCdark',
  'gardenDark',
  'lawnDark',
  'tuft',
  'poplarShade',
  'bushShade',
  'wallShade',
  'roofShade',
  'chimneyShade',
  'doorDark',
  'pathShade',
  'fenceShade',
  'pondEdge',
]);

const CHARACTER = new Set<BaseKey>([
  'duck',
  'duckHead',
  'duckShine',
  'duckWing',
  'duckBelly',
  'bill',
  'billDark',
  'eye',
  'speculum',
  'spines',
  'spinesMid',
  'spinesLight',
  'face',
  'faceShade',
  'nose',
  'feet',
  'blush',
]);

/** The big tree through the year (London month, 1 to 12): fresh, summer, gold, rust, bare. */
type TreeLook = { lit: string; shade: string; fleck: string; bare: boolean };
const TREE: readonly TreeLook[] = [
  { lit: '#7DB458', shade: '#4C833F', fleck: '#9FCB6A', bare: true }, // Jan
  { lit: '#7DB458', shade: '#4C833F', fleck: '#9FCB6A', bare: true }, // Feb
  { lit: '#9ACF62', shade: '#5C9645', fleck: '#C4E486', bare: false }, // Mar: new leaves
  { lit: '#88C85A', shade: '#4E8E42', fleck: '#B2DD7A', bare: false },
  { lit: '#7DBE52', shade: '#478A3D', fleck: '#A2D46A', bare: false },
  { lit: '#76B84E', shade: '#43863B', fleck: '#9CCF64', bare: false },
  { lit: '#72B24C', shade: '#41813A', fleck: '#97CA60', bare: false },
  { lit: '#79B24C', shade: '#46803A', fleck: '#A4C95E', bare: false },
  { lit: '#A7BE4A', shade: '#6A8A36', fleck: '#E2C254', bare: false }, // Sep: turning
  { lit: '#EFAE45', shade: '#BF6A2E', fleck: '#FFD46C', bare: false }, // Oct: gold
  { lit: '#E5893C', shade: '#A84E2A', fleck: '#F7B455', bare: false }, // Nov: rust
  { lit: '#7DB458', shade: '#4C833F', fleck: '#9FCB6A', bare: true }, // Dec
];

export type Palette = Record<BaseKey, string> & {
  treeLit: string;
  treeShade: string;
  treeFleck: string;
  lamp: string;
  lampCore: string;
  shadow: string;
};

export interface HeroLook {
  phase: SkyPhase;
  /** Text colour over the sky: "light" means white text. */
  tone: 'light' | 'dark';
  /** Luminance of the sky behind the title (for the record and tests). */
  titleSkyLuminance: number;
  sky: Sky5;
  sun: { x: number; y: number; r: number; core: string; glow: string; glowR: number; glowOpacity: number; visible: number };
  /** Warm band along the horizon at sunrise and sunset. */
  horizon: { colour: string; opacity: number; x: number };
  moon: number;
  stars: { bright: number; faint: number; milky: number };
  /** −1: light from the left (morning sun, the moon) to 1: from the right (evening sun). */
  lightX: number;
  /** How high the light comes from: small for a low sun (long, sideways light). */
  lightY: number;
  /** 0 to 1: how strongly volumes split into a lit and a shaded side. */
  contrast: number;
  /** Lit edges along ridges and roofs facing the sun. */
  rim: { colour: string; strength: number };
  /** Cast shadows: length factor and opacity. */
  shadow: { reach: number; opacity: number };
  lamps: number;
  night: number;
  cloud: { top: string; base: string; opacity: number };
  water: { far: string; near: string; glint: string };
  haze: string;
  colours: Palette;
  extras: { smoke: number; fireflies: boolean; birds: boolean; city: number; autumn: number; bareTree: boolean };
  /** Mist in the valleys between the ranges of hills. */
  mist: { colour: string; amount: number };
  /** Light shafts fanning from a low sun. */
  rays: number;
  /** A sentence for screen readers. */
  description: string;
}

// The sun's path: rising over the hills right of the title, setting behind the
// hills at the right edge (east on the left, west on the right).
const SUN_X0 = 148;
const SUN_X1 = 386;
/** Height of the sun's path: summer noon reaches just under the status bar. */
const SUN_RISE = 128;

/** The farthest range, which the sun rises from and sets behind (also drawn by the scene). */
export const RIDGE_FAR: readonly (readonly [number, number])[] = [
  [-44, 226],
  [40, 219],
  [90, 221],
  [140, 225],
  [180, 222],
  [220, 214],
  [260, 202],
  [300, 191],
  [338, 184],
  [372, 181],
  [446, 191],
];

/** The far ridge in front of it. */
export const RIDGE_A: readonly (readonly [number, number])[] = [
  [-44, 236],
  [30, 230],
  [70, 227],
  [110, 230],
  [150, 235],
  [190, 235],
  [230, 230],
  [270, 223],
  [310, 216],
  [350, 211],
  [386, 209],
  [446, 214],
];

export function ridgeY(points: readonly (readonly [number, number])[], x: number): number {
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return points[points.length - 1][1];
}

/** The moon hangs high on the left, above the title, where it never meets the sun. */
export const MOON = { x: 134, y: 76, r: 9.5 } as const;

function londonParts(date: Date): { month: number; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      month: 'numeric',
      hour: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(date);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return { month: get('month'), hour: get('hour') };
  } catch {
    return { month: date.getUTCMonth() + 1, hour: date.getUTCHours() };
  }
}

const PHRASE: Record<SkyPhase, string> = {
  night: 'at night, under the moon and stars',
  dawn: 'at dawn',
  sunrise: 'at sunrise',
  day: 'in the daytime',
  sunset: 'at sunset',
  dusk: 'at dusk',
};

/** Everything the hero needs to draw `date` in London. */
export function heroLook(date: Date, state: SkyState = skyAt(date)): HeroLook {
  const el = state.elevation;
  const p = state.dayProgress;
  const morning = p < 0.5;
  const sky = sky5(morning ? SKY_MORNING : SKY_EVENING, el);
  const light = col(morning ? LIGHT_MORNING : LIGHT_EVENING, el);
  const haze = mix(sky[3], sky[4], 0.55);
  const { month } = londonParts(date);

  // Sun position on the stage.
  const sx = lerp(SUN_X0, SUN_X1, clamp(p, -0.12, 1.12));
  const ground = ridgeY(RIDGE_FAR, sx);
  const sy = el >= 0 ? ground - SUN_RISE * (el / 62) ** 0.78 : ground + -el * 7;
  const core = col(SUN_CORE, el);

  // Light direction: the sun by day, the moon (high on the left) by night.
  const night = num(
    [
      [-10, 1],
      [-2, 0],
    ],
    el,
  );
  const sunSide = clamp((p - 0.5) * 2.6, -1, 1);
  const lightX = lerp(sunSide, -0.55, night);
  const contrast = num(
    [
      [-12, 0.32],
      [-4, 0.25],
      [0, 0.8],
      [5, 1],
      [14, 0.8],
      [30, 0.62],
    ],
    el,
  );

  // Grade: multiply by the light (fully at night, gently by day so greens stay
  // green), cool the shaded colours towards the sky, then fade into the haze.
  const strength = num(
    [
      [-10, 1],
      [-4, 0.95],
      [0, 0.74],
      [5, 0.56],
      [15, 0.48],
      [40, 0.4],
    ],
    el,
  );
  // Golden light lifts the sunlit colours (screen), the shade stays cool.
  const warm = col(SUN_GLOW, el);
  const lift = num(
    [
      [-2, 0],
      [1, 0.2],
      [5, 0.24],
      [12, 0.1],
      [22, 0],
    ],
    el,
  );
  const coolness = num(
    [
      [-8, 0.04],
      [-2, 0.16],
      [3, 0.2],
      [10, 0.12],
      [30, 0.07],
    ],
    el,
  );
  const cool = mix(sky[1], sky[2], 0.4);
  const backlight = num(
    [
      [-12, 0.12],
      [-6, 0.26],
      [-2, 0.36],
      [1, 0.34],
      [4, 0.26],
      [9, 0.12],
      [16, 0.03],
      [25, 0],
    ],
    el,
  );
  const silhouette = mix(sky[0], '#2A2142', 0.45);
  const hazeK = lerp(0.92, 0.8, night);
  const gradeHex = (base: string, depth: number, shaded: boolean, character: boolean, backlit = false): string => {
    const lit = multiply(base, light);
    const k = character ? lerp(strength, 0.6, night) : strength;
    let g = mix(base, lit, k);
    if (shaded) g = mix(g, cool, coolness);
    else if (lift > 0) g = saturate(screen(g, warm, lift * (1 - depth)), 1 + lift * 1.4 * (1 - depth));
    if (backlit) g = mix(g, silhouette, backlight * (1 - depth) ** 1.4);
    return mix(g, haze, hazeK * depth ** 1.3);
  };
  const colours = {} as Palette;
  (Object.keys(BASE) as BaseKey[]).forEach((k) => {
    colours[k] = gradeHex(BASE[k], DEPTH[k] ?? 0, SHADED.has(k), CHARACTER.has(k), BACKLIT.has(k));
  });
  const treeLook = TREE[(month - 1 + 12) % 12] ?? TREE[5];
  const autumn = month === 10 || month === 11 ? 1 : month === 9 ? 0.4 : 0;
  colours.treeLit = gradeHex(treeLook.lit, 0.16, false, false);
  colours.treeShade = gradeHex(treeLook.shade, 0.16, true, false);
  colours.treeFleck = gradeHex(treeLook.fleck, 0.16, false, false);
  colours.lamp = '#FFC266';
  colours.lampCore = '#FFE6A6';
  colours.shadow = mix(mix(multiply('#2C4A2A', light), cool, 0.25), '#0B1430', night * 0.6);

  const rimStrength = num(
    [
      [-3, 0],
      [0, 0.55],
      [3, 1],
      [9, 0.85],
      [18, 0.4],
      [35, 0.22],
    ],
    el,
  );

  // Title legibility: the sky around y = 140 (between "Home" and the address).
  const titleSky = mix(sky[1], sky[2], 0.66);
  const titleSkyLuminance = luminance(titleSky);
  const tone = titleSkyLuminance > 0.42 ? 'dark' : 'light';

  const lamps = num(
    [
      [-3.5, 1],
      [4, 0],
    ],
    el,
  );
  const cold = month >= 10 || month <= 3;
  const smoke = cold ? num([[-4, 1], [4, 1], [9, 0]], el) * (morning && el > 0 ? 0.6 : 1) : 0;
  const fireflies = month >= 6 && month <= 8 && el < -3.5;
  const birds = el > 4;

  const extras = [
    lamps > 0.5 ? 'warm light in the windows' : null,
    smoke > 0.3 ? 'smoke curling from the chimney' : null,
    fireflies ? 'fireflies over the garden' : null,
    birds ? 'birds overhead' : null,
  ].filter(Boolean);

  return {
    phase: state.phase,
    tone,
    titleSkyLuminance,
    sky,
    sun: {
      x: sx,
      y: sy,
      r: lerp(12.5, 11, clamp(el / 20, 0, 1)),
      core,
      glow: col(SUN_GLOW, el),
      glowR: lerp(96, 44, clamp(el / 30, 0, 1)),
      glowOpacity: num(
        [
          [-4, 0],
          [-1, 0.75],
          [4, 0.85],
          [12, 0.55],
          [30, 0.36],
        ],
        el,
      ),
      visible: num(
        [
          [-3, 0],
          [-0.6, 1],
        ],
        el,
      ),
    },
    horizon: {
      colour: mix(sky[4], col(SUN_GLOW, el), 0.55),
      opacity: num(
        [
          [-9, 0],
          [-4.5, 0.55],
          [-1, 0.95],
          [3, 0.9],
          [9, 0.4],
          [18, 0],
        ],
        el,
      ),
      x: clamp(sx, 60, 360),
    },
    moon: num(
      [
        [-8, 1],
        [-2.5, 0],
      ],
      el,
    ),
    stars: {
      bright: num(
        [
          [-8, 1],
          [-2.5, 0],
        ],
        el,
      ),
      faint: num(
        [
          [-12, 1],
          [-6, 0],
        ],
        el,
      ),
      milky: num(
        [
          [-16, 1],
          [-11, 0],
        ],
        el,
      ),
    },
    lightX,
    lightY: lerp(lerp(0.1, 0.36, clamp(el / 35, 0, 1)), 0.3, night),
    contrast,
    rim: { colour: el > -2 ? mix(core, '#FFFFFF', 0.25) : '#AFC2F2', strength: el > -2 ? rimStrength : 0.3 * night },
    shadow: {
      reach: el > 0 ? clamp(1 / Math.tan((Math.max(el, 2) * Math.PI) / 180) / 6, 0.2, 2.6) : 0.4,
      opacity: num(
        [
          [-3, 0.1],
          [0, 0.18],
          [4, 0.3],
          [20, 0.26],
        ],
        el,
      ),
    },
    lamps,
    night,
    cloud: {
      top: col(CLOUD_TOP, el),
      base: col(CLOUD_BASE, el),
      opacity: num(
        [
          [-12, 0.55],
          [-4, 0.9],
          [0, 1],
        ],
        el,
      ),
    },
    water: {
      far: mix(sky[4], sky[3], 0.25),
      near: mix(sky[2], sky[1], 0.4),
      // Sunlight on the water by day, moonlight by night.
      glint: mix(mix(core, '#FFFFFF', 0.35), '#B9C6EC', clamp((-el - 1) / 5, 0, 1)),
    },
    haze,
    colours,
    extras: { smoke, fireflies, birds, city: lamps, autumn, bareTree: treeLook.bare },
    mist: {
      colour: mix(haze, sky[4], 0.5),
      amount: num(
        [
          [-12, 0.28],
          [-4, 0.45],
          [2, 0.6],
          [12, 0.55],
          [30, 0.5],
        ],
        el,
      ),
    },
    rays: num(
      [
        [-1.5, 0],
        [1, 0.8],
        [5, 1],
        [11, 0.4],
        [16, 0],
      ],
      el,
    ),
    description: `An illustration of the house in London ${PHRASE[state.phase]}: a cottage in its garden, a green duck on the pond and a brown hedgehog by the fence${extras.length ? `, with ${extras.join(', ')}` : ''}.`,
  };
}
