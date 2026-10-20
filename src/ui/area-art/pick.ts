// Which picture an area gets (AreaArt.tsx): the scene from words in its name, the
// composition from its size words, and the colours (and a few small details) from its seed,
// so no two areas look the same. Small and in the main bundle: the drawings themselves load
// later as one chunk (Scene.tsx), over a soft gradient of the same colours (backdrop below).
import { mixColour } from '../../lib/logic/sky';

export type SceneKind =
  | 'kitchen'
  | 'living'
  | 'bathroom'
  | 'bedroom'
  | 'hallway'
  | 'garden'
  | 'frontGarden'
  | 'gardenRoom'
  | 'hotTub'
  | 'utility'
  | 'office'
  | 'dining'
  | 'garage'
  | 'stairs'
  | 'loft'
  | 'balcony'
  | 'nursery'
  | 'home'
  | 'room';

/** Scenes under the sky (the rest are rooms with a wall and a floor). */
const OUTDOOR: ReadonlySet<SceneKind> = new Set<SceneKind>(['garden', 'frontGarden', 'hotTub', 'balcony', 'home']);

/**
 * First match wins, so the more particular names come first: "Garden Lounge" before "Garden"
 * and "Lounge", "Front garden" before "Garden", "Guest bathroom" before "Guest". British and
 * American words both.
 */
const RULES: readonly (readonly [RegExp, SceneKind])[] = [
  [/jacuzzi|hot ?tub|\bspa\b|whirlpool|swimming|\bpool\b|sauna/, 'hotTub'],
  // Beds that grow things, before the bedroom's "bed".
  [/flower ?beds?|raised beds?|veg(etable)? (patch|beds?)/, 'garden'],
  [/garden (lounge|room|house|cabin|snug)|summer ?house|conservatory|orangery|sun ?(room|lounge)|green ?house|glass ?house|gazebo|pergola|log cabin/, 'gardenRoom'],
  [/front (garden|yard|lawn|drive|path|porch|steps?)|drive ?way|\bdrive\b|porch|forecourt|\bbins?\b|kerb|curb/, 'frontGarden'],
  [/balcon|terrace|roof ?top|roof garden|patio|\bdecking\b|\bdeck\b|veranda/, 'balcony'],
  [/office|study|studio|work ?(space|room)|library|\bdesk\b/, 'office'],
  [/garage|car ?port|workshop|\bshed\b|bike store|cycle store/, 'garage'],
  [/utility|laundry|boot ?room|mud ?room|airing|boiler|scullery/, 'utility'],
  [/nursery|\bkids?\b|kids'|children|\bchild|play ?room|\bbaby\b|toddler|games? room/, 'nursery'],
  [/bath|shower|toilet|\bwc\b|\bloo\b|en.?suite|cloakroom|wash ?room|rest ?room|powder room|lavatory|\blav\b/, 'bathroom'],
  [/kitchen|pantry|larder|galley|cook/, 'kitchen'],
  [/dining|breakfast|dinner/, 'dining'],
  [/living|lounge|sitting|family room|front room|drawing room|reception|\bden\b|snug|\btv\b|media room|parlou?r|cinema|great room/, 'living'],
  [/bed|guest|spare|master|sleep|box ?room|dorm/, 'bedroom'],
  [/\bstairs?\b|staircase|stairway|stairwell|landing/, 'stairs'],
  [/hall|entr(y|ance)|foyer|vestibule|corridor|lobby|passage|front door/, 'hallway'],
  [/loft|attic|eaves|roof ?space|mezzanine/, 'loft'],
  [/garden|yard|lawn|allotment|orchard|grounds|outside|outdoor|\bveg|flower ?bed|\bpond\b|hedge/, 'garden'],
  // The whole place, last, so a room of it keeps its own ("Home office" is an office): Housekeeping's Whole home.
  [/\bwhole\b|\bhome\b|\bhouse\b|\bflat\b|apartment|everywhere|\bgeneral\b|all rooms|throughout/, 'home'],
];

/** Words for a smaller or second room: its other composition (a shower, a single bed). */
const SMALLER =
  /\b(small|smaller|little|mini|compact|guest|spare|box|single|downstairs|ground floor|lower|en.?suite|shower|second|2nd|junior|cloakroom|wc|loo|toilet|half|powder|kitchenette|galley|workshop|shed|landing)\b/;
/** Words for the main one (a bath, a double bed): they win over SMALLER. */
const LARGER = /\b(large|larger|big|bigger|master|main|family|upstairs|first floor|upper|double|king|primary|grand)\b/;

/** The scene for an area's name (case doesn't matter); a name it doesn't know gets a cosy room. */
export function sceneKind(name: string): SceneKind {
  const n = name.toLowerCase();
  return RULES.find(([re]) => re.test(n))?.[1] ?? 'room';
}

/**
 * True for the other composition: "Bathroom Small" (a shower) beside "Bathroom Large" (a
 * bath), "Bedroom Small" (a single bed) beside "Bedroom Large" (a double). Without size
 * words, a trailing even number ("Bedroom 2") picks it too.
 */
export function isAlt(name: string): boolean {
  const n = name.toLowerCase();
  if (LARGER.test(n)) return false;
  if (SMALLER.test(n)) return true;
  const num = /(\d+)\s*$/.exec(n);
  return num ? Number(num[1]) % 2 === 0 : false;
}

/** A well-mixed 32-bit hash of a seed (FNV-1a, then MurmurHash3's finish). */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** One room's colours (day): its walls, floor, soft furnishings, wood, and its sky and lawn outside. */
export interface Colourway {
  name: string;
  wall: string;
  wall2: string;
  floor: string;
  floor2: string;
  /** The big soft things: sofa, duvet, cabinets, the bath's outside. */
  main: string;
  main2: string;
  /** Small pops: cushions, a pot, a towel, flowers. */
  accent: string;
  accent2: string;
  wood: string;
  wood2: string;
  skyTop: string;
  skyLow: string;
  ground: string;
  ground2: string;
}

/** Soft colourways in the hero's family (cream walls, sage, blush, butter, terracotta and teal). */
export const COLOURWAYS: readonly Colourway[] = [
  {
    name: 'sage',
    wall: '#EDF3E6', wall2: '#DAE7D0', floor: '#E9D3B5', floor2: '#D5BA95',
    main: '#86B592', main2: '#5F9670', accent: '#FF9C7A', accent2: '#F6D7A7',
    wood: '#C99A6B', wood2: '#A87A4F', skyTop: '#A9D9F0', skyLow: '#EAF6EC', ground: '#9BD07A', ground2: '#6FB35A',
  },
  {
    name: 'blush',
    wall: '#FCEBE6', wall2: '#F4D5CD', floor: '#ECD2B6', floor2: '#D9B897',
    main: '#E98A93', main2: '#C96872', accent: '#FFC94D', accent2: '#FFE3C2',
    wood: '#D2A57B', wood2: '#B1835A', skyTop: '#F4BFC8', skyLow: '#FFEBDD', ground: '#A5D47E', ground2: '#7BBA5F',
  },
  {
    name: 'sky',
    wall: '#E6F0FB', wall2: '#D0E1F4', floor: '#ECDCC4', floor2: '#D9C2A2',
    main: '#6E9FE3', main2: '#4F7FC6', accent: '#FFB25B', accent2: '#FFE6B8',
    wood: '#C79D72', wood2: '#A47B52', skyTop: '#8FC6F0', skyLow: '#E0F1FB', ground: '#92CC72', ground2: '#67B154',
  },
  {
    name: 'butter',
    wall: '#FFF5D9', wall2: '#F8E5B4', floor: '#E2C6A2', floor2: '#CBA97F',
    main: '#F0B447', main2: '#D6932B', accent: '#4FA7A2', accent2: '#CFEDE4',
    wood: '#C38E5E', wood2: '#9F6E42', skyTop: '#A6D6F2', skyLow: '#FFF2CC', ground: '#A3CF6E', ground2: '#79B455',
  },
  {
    name: 'lilac',
    wall: '#F1EBFB', wall2: '#DFD3F4', floor: '#E8D6C1', floor2: '#D4BCA0',
    main: '#A28BE6', main2: '#8069C9', accent: '#FF8FB0', accent2: '#FFE0EA',
    wood: '#C9A07A', wood2: '#A67E58', skyTop: '#B9B0EE', skyLow: '#F7E6F2', ground: '#9ECF7C', ground2: '#73B45E',
  },
  {
    name: 'peach',
    wall: '#FFECDD', wall2: '#F9D8BF', floor: '#E5C9A7', floor2: '#CEAB83',
    main: '#F28E62', main2: '#D46D43', accent: '#5DB26A', accent2: '#D6F0C9',
    wood: '#C9925F', wood2: '#A47044', skyTop: '#F7BB98', skyLow: '#FFEBD3', ground: '#A2D07A', ground2: '#77B65C',
  },
  {
    name: 'mint',
    wall: '#E3F4EF', wall2: '#CAE8DF', floor: '#EFDDC6', floor2: '#DBC3A4',
    main: '#43A398', main2: '#2E8279', accent: '#F4C04E', accent2: '#FFEFC2',
    wood: '#C99C6E', wood2: '#A47A4E', skyTop: '#98D5E3', skyLow: '#E3F6EF', ground: '#93CF78', ground2: '#68B35A',
  },
  {
    name: 'cream',
    wall: '#FFF3E0', wall2: '#F6E0C3', floor: '#DDB68C', floor2: '#C69B6F',
    main: '#E47E62', main2: '#C45F47', accent: '#3C8C86', accent2: '#CBE8E3',
    wood: '#B98458', wood2: '#94633B', skyTop: '#A3CFEF', skyLow: '#FCEEDC', ground: '#8ECC6A', ground2: '#6CB558',
  },
];

/** Everything about an area's picture that its name and seed decide. */
export interface ArtPick {
  kind: SceneKind;
  /** The other composition (see isAlt). */
  alt: boolean;
  /** Drawn the other way round. */
  mirror: boolean;
  colourway: Colourway;
  /** 0, 1 or 2: small touches that differ (a plant, a picture, a cat's colour). */
  detail: number;
  hash: number;
  /** Names the drawing, for tests: kind, composition, colours, details. */
  key: string;
}

export function pickArt(name: string, seed: string): ArtPick {
  const kind = sceneKind(name);
  const alt = isAlt(name);
  const hash = hashSeed(seed);
  const colourway = COLOURWAYS[hash % COLOURWAYS.length];
  const mirror = ((hash >>> 8) & 1) === 1;
  const detail = (hash >>> 12) % 3;
  return { kind, alt, mirror, colourway, detail, hash, key: `${kind}${alt ? '-alt' : ''}:${colourway.name}:${mirror ? 'm' : 'n'}${detail}` };
}

// ---------------------------------------------------------------- evening

/** What the evening light mixes colours towards: the hero's indigo dusk. */
export const NIGHT = '#1D2452';

/** A day colour by lamplight and moonlight: far things (walls, floors, sky) fade more. */
export function dusk(colour: string, far = false): string {
  return mixColour(colour, NIGHT, far ? 0.66 : 0.5);
}

/** The night sky outside (top, low), a touch of the room's own colour in it. */
export function nightSky(cw: Colourway): readonly [string, string] {
  return [mixColour('#0C1540', cw.skyTop, 0.08), mixColour('#34407C', cw.skyLow, 0.12)];
}

/**
 * The soft gradient shown until the drawing has loaded: the scene's own wall and floor (or
 * sky and ground), so the picture settles in rather than pops.
 */
export function backdrop(pick: ArtPick, evening: boolean): string {
  const cw = pick.colourway;
  if (OUTDOOR.has(pick.kind)) {
    const [top, low] = evening ? nightSky(cw) : [cw.skyTop, cw.skyLow];
    const [g1, g2] = evening ? [dusk(cw.ground, true), dusk(cw.ground2, true)] : [cw.ground, cw.ground2];
    return `linear-gradient(180deg, ${top} 0%, ${low} 58%, ${g1} 58%, ${g2} 100%)`;
  }
  const [w1, w2, f1, f2] = [cw.wall, cw.wall2, cw.floor, cw.floor2].map((c) => (evening ? dusk(c, true) : c));
  return `linear-gradient(180deg, ${w1} 0%, ${w2} 72%, ${f1} 72%, ${f2} 100%)`;
}
