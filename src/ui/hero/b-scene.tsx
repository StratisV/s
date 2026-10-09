// Hero B: the still layers of the scene, drawn in stage units (402 x 358, one
// unit per point on a 402pt iPhone): the sky with the sun, the moon, the far
// city and the hills in layers of haze, and the house in its garden with the
// pond. Everything that moves lives in b-life.tsx.
import type { ReactNode } from 'react';
import { MOON, RIDGE_A, RIDGE_FAR, SKY_Y, STAGE_H, STAGE_W, clamp, mix, ridgeY, type HeroLook } from './b-light';
import { ShardLight } from './b-life';
import styles from './HeroB.module.css';

type Pt = readonly [number, number];
const r1 = (n: number) => Math.round(n * 10) / 10;
/** How far the art runs past each side of the stage, for phones wider than 402pt. */
export const BLEED = 40;

/** A smooth curve through `pts` (Catmull-Rom as cubic Béziers), closed down to `bottom`. */
export function smooth(pts: readonly Pt[], bottom?: number): string {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)},${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)},${r1(
      p2[1] - (p3[1] - p1[1]) / 6,
    )} ${p2[0]},${p2[1]}`;
  }
  if (bottom === undefined) return d;
  return `${d}L${pts[pts.length - 1][0]},${bottom}L${pts[0][0]},${bottom}Z`;
}

const RIDGE_B: Pt[] = [
  [-44, 247],
  [35, 241],
  [80, 237],
  [120, 241],
  [160, 247],
  [200, 250],
  [240, 246],
  [280, 238],
  [320, 233],
  [360, 235],
  [446, 241],
];
const RIDGE_C: Pt[] = [
  [-44, 268],
  [30, 261],
  [70, 258],
  [110, 262],
  [150, 268],
  [190, 272],
  [240, 267],
  [290, 260],
  [340, 258],
  [380, 261],
  [446, 264],
];
const RIDGE_D: Pt[] = [
  [-44, 298],
  [40, 295],
  [100, 292],
  [160, 290],
  [220, 289],
  [280, 290],
  [340, 292],
  [446, 296],
];
const RIDGE_E: Pt[] = [
  [-44, 317],
  [40, 313],
  [100, 310],
  [160, 309],
  [220, 310],
  [280, 311],
  [340, 313],
  [446, 317],
];

const PATH_FAR = smooth(RIDGE_FAR, 300);
const PATH_A = smooth(RIDGE_A, 300);
const PATH_B = smooth(RIDGE_B, 300);
const PATH_C = smooth(RIDGE_C, 320);
const PATH_D = smooth(RIDGE_D, STAGE_H);
const PATH_E = smooth(RIDGE_E, STAGE_H);

/** Light shafts from a low sun: angle from straight up (degrees) and half width. */
const RAYS: readonly (readonly [number, number])[] = [
  [-78, 2.2],
  [-60, 3.4],
  [-43, 2.4],
  [-27, 4],
  [-11, 2.6],
  [6, 3.6],
  [22, 2.2],
  [40, 3.2],
  [58, 2.4],
  [76, 3],
];
function ray(angle: number, half: number): string {
  const at = (deg: number) => {
    const t = ((deg - 90) * Math.PI) / 180;
    return `${r1(Math.cos(t) * 270)},${r1(Math.sin(t) * 270)}`;
  };
  return `M0,0L${at(angle - half)}L${at(angle + half)}Z`;
}

/** Faint stars packed along the Milky Way (in its rotated frame). */
const MILKY_DUST: readonly (readonly [number, number, number])[] = (() => {
  let seed = 917;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  return Array.from({ length: 70 }, () => {
    const x = 40 + rand() * 420;
    const y = 122 + (rand() + rand() + rand() - 1.5) * 26;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round((0.25 + rand() * 0.45) * 100) / 100] as const;
  });
})();

/** Small trees along the middle hills: x, radius. */
const B_TREES: readonly Pt[] = [
  [58, 3.4],
  [64, 4.4],
  [71, 3],
  [94, 3.6],
  [262, 3.2],
  [298, 4],
  [305, 3.2],
  [336, 4.6],
  [344, 3.4],
];

/** A picket fence: one path for every picket between x0 and x1. */
function pickets(x0: number, x1: number): string {
  let d = '';
  for (let x = x0; x <= x1 - 2.6; x += 6) d += `M${x},296.2L${x + 1.3},294L${x + 2.6},296.2V308H${x}Z`;
  return d;
}
const FENCE_L = pickets(146, 198);
const FENCE_R = pickets(229, 372);

/**
 * A rounded volume lit from one side: the shape in its shaded colour, then the
 * same shape shifted towards the light in its lit colour, clipped to itself,
 * which leaves a crisp crescent of shade on the far side.
 */
function Volume({
  id,
  lit,
  shade,
  dx,
  dy,
  children,
}: {
  id: string;
  lit: string;
  shade: string;
  dx: number;
  dy: number;
  children: ReactNode;
}) {
  return (
    <>
      <clipPath id={id}>{children}</clipPath>
      <g fill={shade}>{children}</g>
      <g clipPath={`url(#${id})`}>
        <g fill={lit} transform={`translate(${r1(dx)} ${r1(dy)})`}>
          {children}
        </g>
      </g>
    </>
  );
}

// ---------------------------------------------------------------------------

/** The sky: gradient, Milky Way, the horizon's glow and the sun. */
export function SkyArt({ look, u }: { look: HeroLook; u: string }) {
  const { sky, sun, horizon } = look;
  return (
    <svg viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} overflow="visible" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${u}sky`} x1="0" y1="0" x2="0" y2={STAGE_H} gradientUnits="userSpaceOnUse">
          {SKY_Y.map((y, i) => (
            <stop key={y} offset={y / STAGE_H} stopColor={sky[i]} />
          ))}
        </linearGradient>
        <radialGradient id={`${u}glow`}>
          <stop offset="0" stopColor={sun.glow} stopOpacity="0.95" />
          <stop offset="0.28" stopColor={sun.glow} stopOpacity="0.5" />
          <stop offset="0.62" stopColor={sun.glow} stopOpacity="0.14" />
          <stop offset="1" stopColor={sun.glow} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}corona`}>
          <stop offset="0.38" stopColor={sun.core} stopOpacity="0.55" />
          <stop offset="0.6" stopColor={sun.core} stopOpacity="0.16" />
          <stop offset="1" stopColor={sun.core} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}hz`}>
          <stop offset="0" stopColor={horizon.colour} stopOpacity="0.9" />
          <stop offset="0.5" stopColor={horizon.colour} stopOpacity="0.35" />
          <stop offset="1" stopColor={horizon.colour} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}rays`} cx="0" cy="0" r="230" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(sun.glow, '#FFFFFF', 0.35)} stopOpacity="0.2" />
          <stop offset="0.35" stopColor={sun.glow} stopOpacity="0.07" />
          <stop offset="1" stopColor={sun.glow} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}milky`}>
          <stop offset="0" stopColor="#C9D4FF" stopOpacity="0.32" />
          <stop offset="0.55" stopColor="#9FB0EE" stopOpacity="0.12" />
          <stop offset="1" stopColor="#9FB0EE" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x={-BLEED} width={STAGE_W + 2 * BLEED} height={STAGE_H} fill={`url(#${u}sky)`} />
      {look.stars.milky > 0 && (
        <g opacity={look.stars.milky * 0.75} transform="rotate(-24 260 120)">
          <ellipse cx="250" cy="122" rx="230" ry="38" fill={`url(#${u}milky)`} />
          <ellipse cx="300" cy="116" rx="110" ry="14" fill={`url(#${u}milky)`} />
          <ellipse cx="196" cy="128" rx="80" ry="10" fill={`url(#${u}milky)`} opacity="0.7" />
          <g fill="#E8EDFF">
            {MILKY_DUST.map(([x, y, r]) => (
              <circle key={`${x},${y}`} cx={x} cy={y} r={r} opacity={0.35 + (r - 0.25) * 0.8} />
            ))}
          </g>
        </g>
      )}
      {horizon.opacity > 0 && (
        <ellipse cx={r1(horizon.x)} cy="236" rx="300" ry="78" fill={`url(#${u}hz)`} opacity={r1(horizon.opacity * 100) / 100} />
      )}
      {look.rays > 0 && sun.visible > 0 && (
        <g fill={`url(#${u}rays)`} opacity={r1(look.rays * sun.visible * 100) / 100}>
          {RAYS.map(([a, half]) => (
            <path key={a} d={ray(a, half)} transform={`translate(${r1(sun.x)} ${r1(sun.y)})`} />
          ))}
        </g>
      )}
      {sun.visible > 0 && (
        <g>
          <circle cx={r1(sun.x)} cy={r1(sun.y)} r={r1(sun.glowR)} fill={`url(#${u}glow)`} opacity={sun.glowOpacity * sun.visible} />
          <circle cx={r1(sun.x)} cy={r1(sun.y)} r={r1(sun.r * 2.4)} fill={`url(#${u}corona)`} opacity={sun.visible} />
          <circle cx={r1(sun.x)} cy={r1(sun.y)} r={r1(sun.r)} fill={sun.core} opacity={sun.visible} />
          <circle cx={r1(sun.x)} cy={r1(sun.y)} r={r1(sun.r * 0.62)} fill="#FFFDF4" opacity={0.55 * sun.visible} />
        </g>
      )}
    </svg>
  );
}

/** A crescent moon with earthshine and a halo, high on the left. */
export function Moon({ look, u }: { look: HeroLook; u: string }) {
  if (look.moon <= 0) return null;
  const { x, y, r } = MOON;
  return (
    <svg
      className={styles.piece}
      viewBox={`${x - 40} ${y - 40} 80 80`}
      style={{
        position: 'absolute',
        left: `${((x - 40) / STAGE_W) * 100}%`,
        top: `${((y - 40) / STAGE_H) * 100}%`,
        width: `${(80 / STAGE_W) * 100}%`,
        height: `${(80 / STAGE_H) * 100}%`,
        opacity: look.moon,
      }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`${u}moonGlow`}>
          <stop offset="0" stopColor="#E9EEFF" stopOpacity="0.5" />
          <stop offset="0.4" stopColor="#C8D3FF" stopOpacity="0.16" />
          <stop offset="1" stopColor="#C8D3FF" stopOpacity="0" />
        </radialGradient>
        <mask id={`${u}crescent`}>
          <circle cx={x} cy={y} r={r} fill="#fff" />
          <circle cx={x - 4.6} cy={y - 3.4} r={r * 0.94} fill="#000" />
        </mask>
      </defs>
      <circle cx={x} cy={y} r="38" fill={`url(#${u}moonGlow)`} />
      <circle cx={x} cy={y} r={r} fill="#9AA8D6" opacity="0.16" />
      <circle cx={x} cy={y} r={r} fill="#FBF4DC" mask={`url(#${u}crescent)`} />
    </svg>
  );
}

// ---------------------------------------------------------------------------

/** The far city on the horizon: London, softened by distance. */
function Skyline({ c, city }: { c: HeroLook['colours']; city: number }) {
  return (
    <g>
      <g fill={c.skyline}>
        <rect x="16" y="217" width="6" height="18" />
        <rect x="23" y="211" width="5" height="24" rx="0.6" />
        {/* BT Tower */}
        <rect x="33.6" y="199" width="2.4" height="36" />
        <rect x="32.6" y="203.4" width="4.4" height="2.4" rx="1" />
        <rect x="32.9" y="207.6" width="3.8" height="1.6" rx="0.8" />
        <rect x="34.5" y="193.5" width="0.6" height="6" />
        <rect x="39" y="219" width="7" height="16" />
        {/* St Paul's */}
        <rect x="47" y="222" width="16" height="13" />
        <rect x="50" y="216.4" width="10" height="6" />
        <path d="M49.4,216.6A5.6,6.2 0 0 1 60.6,216.6Z" />
        <rect x="54.4" y="208" width="1.2" height="3.6" />
        <circle cx="55" cy="207.6" r="0.9" />
        {/* The Gherkin */}
        <path d="M66,235C65.4,224 66.8,215 70.2,210C73.6,215 75,224 74.4,235Z" />
        <path d="M77,235V214.5L83.6,212.4V235Z" />
        {/* The Shard */}
        <path d="M86.5,235L92.1,196.8L92.6,199.4L93.4,195.6L99.6,235Z" />
        <rect x="101" y="221" width="6" height="14" />
        {/* London Eye */}
        <circle cx="116" cy="218.5" r="10.2" fill="none" stroke={c.skyline} strokeWidth="1.1" />
        <circle cx="116" cy="218.5" r="1.2" />
        <path d="M116,218.5L111,235H112.4L116,221L119.6,235H121Z" />
        <rect x="128" y="224" width="7" height="11" />
      </g>
      {city > 0 && (
        <g fill="#FFD27A" opacity={city}>
          {[
            [18, 222],
            [19.4, 228],
            [25, 216],
            [25.4, 224],
            [41, 224],
            [43, 229],
            [49.5, 226],
            [58, 226],
            [69, 220],
            [71.6, 226],
            [79.4, 219],
            [81, 226],
            [91, 214],
            [93.4, 222],
            [95.6, 229],
            [103.4, 225],
            [130, 228],
          ].map(([x, y]) => (
            <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" />
          ))}
        </g>
      )}
    </g>
  );
}

/** The house: a cross-gabled cottage with a chimney, its door to the path. */
function House({ look, u }: { look: HeroLook; u: string }) {
  const c = look.colours;
  const lx = look.lightX;
  const lamps = look.lamps;
  const glow = Math.sqrt(lamps);
  const glassTop = mix(c.glassTop, '#FFAE45', glow);
  const glassBottom = mix(c.glassBottom, '#FFE49C', glow);
  const curtain = mix('#C8645A', '#E07A4E', lamps);
  // Faces turned towards the light are lit, the others shaded.
  const towards = (side: -1 | 1) => clamp(0.5 + side * lx * 0.8, 0, 1);
  const roofLeft = mix(c.roof, c.roofLight, towards(-1) * look.contrast);
  const roofRight = mix(c.roof, c.roofLight, towards(1) * look.contrast);
  const hip = mix(c.roofShade, c.roofLight, towards(1));
  const chimneyShadeX = lx <= 0 ? 268.4 : 262;
  const reach = look.shadow.reach;
  const sx = -lx * 46 * reach;
  return (
    <g>
      <defs>
        <linearGradient id={`${u}glass`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={glassTop} />
          <stop offset="1" stopColor={glassBottom} />
        </linearGradient>
      </defs>
      {/* Cast shadow on the ground, away from the light */}
      <path
        d={`M186,300H292L${r1(292 + sx)},${r1(304.5)}H${r1(186 + sx * 0.6)}Z`}
        fill={c.shadow}
        opacity={look.shadow.opacity}
      />
      {/* Chimney (behind the roof) */}
      <rect x="262" y="212" width="12.4" height="40" fill={c.chimney} />
      <rect x={chimneyShadeX} y="212" width="6" height="40" fill={c.chimneyShade} opacity={0.35 + 0.5 * look.contrast} />
      <path d="M262,219.5H274.4M262,226.5H274.4" stroke={c.chimneyShade} strokeWidth="0.6" opacity="0.6" />
      <rect x="260.2" y="209" width="16" height="4.2" rx="1" fill={c.cap} />
      <rect x="263.4" y="203.6" width="4.2" height="5.8" rx="0.6" fill={c.roofShade} />
      <rect x="269.2" y="204.6" width="4.2" height="4.8" rx="0.6" fill={c.roofShade} />
      {/* Wing */}
      <rect x="240" y="258" width="52" height="42" fill={c.wall} />
      {/* Wing window with curtains and a window box */}
      <rect x="249.6" y="273" width="32.8" height="20" rx="1.2" fill={c.frame} />
      <rect x="251.4" y="274.8" width="29.2" height="16.4" fill={`url(#${u}glass)`} />
      <path d="M251.4,274.8H256.6C255.4,279 254.6,284 255.8,291.2H251.4Z" fill={curtain} opacity="0.9" />
      <path d="M280.6,274.8H275.4C276.6,279 277.4,284 276.2,291.2H280.6Z" fill={curtain} opacity="0.9" />
      <path d="M261,274.8V291.2M271,274.8V291.2M251.4,280.2H280.6" stroke={c.frame} strokeWidth="1.2" />
      <path d="M262.6,289.4L266.8,276.6H268.6L264.4,289.4Z" fill="#fff" opacity={0.35 * (1 - lamps)} />
      <rect x="248" y="292.4" width="36" height="2.2" rx="0.8" fill={c.frame} />
      <rect x="249.4" y="294.4" width="33.2" height="4.4" rx="1" fill={c.box} />
      <g>
        {[
          [251.6, c.bush],
          [255.4, c.bushShade],
          [259.8, c.bush],
          [264.6, c.bushShade],
          [269.2, c.bush],
          [273.8, c.bushShade],
          [278.4, c.bush],
          [281.4, c.bushShade],
        ].map(([x, f]) => (
          <circle key={x as number} cx={x as number} cy="293.6" r="2.3" fill={f as string} />
        ))}
        {[
          [252.8, c.pink],
          [258, c.yellow],
          [262.4, c.rose],
          [267.4, c.white],
          [271.8, c.pink],
          [276.4, c.yellow],
          [280.6, c.rose],
        ].map(([x, f]) => (
          <circle key={x as number} cx={x as number} cy="292.2" r="1.25" fill={f as string} />
        ))}
      </g>
      {/* Wing roof: a long tiled slope with a hipped end */}
      <path d="M232.5,266.5H298L283.4,231.6H228Z" fill={c.roof} />
      <path
        d="M231,245.5H289.2M231,254.6H293M231,239.2H286.6M231,260.6H295.6"
        stroke={c.roofLine}
        strokeWidth="0.7"
        opacity="0.7"
      />
      <path d="M283.4,231.6L298,266.5H291.2Z" fill={hip} opacity="0.9" />
      <rect x="232.5" y="265.6" width="65.5" height="2.6" fill={c.roofShade} />
      <rect x="240" y="268.2" width="52" height="3.2" fill={c.wallShade} opacity="0.75" />
      <path d="M228,231.6H283.4" stroke={c.roofShade} strokeWidth="2.6" strokeLinecap="round" />
      {/* The gable stands proud of the wing: its shadow falls on the wing wall */}
      {lx < 0.1 && (
        <path d={`M240,268.2H${r1(240 + Math.min(15, 9 * Math.max(0.25, -lx) * reach))}L240,300Z`} fill={c.wallShade} opacity={0.4 + 0.5 * look.contrast} />
      )}
      {/* Gable */}
      <path d="M186,300V248L213,202.2L240,248V300Z" fill={c.wall} />
      <path d="M186,253.2L213,207.4L240,253.2" fill="none" stroke={c.wallShade} strokeWidth="4.4" opacity="0.75" />
      <path d="M179,252.4L213,193.2L213,202.4L184.4,252.4Z" fill={roofLeft} />
      <path d="M247,252.4L213,193.2L213,202.4L241.6,252.4Z" fill={roofRight} />
      <path d="M185.6,251.6L213,204L240.4,251.6" fill="none" stroke={c.frame} strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="213" cy="192.6" r="1.6" fill={c.roofShade} />
      {/* Rim light along the edges facing a low sun */}
      {look.rim.strength * Math.abs(lx) > 0.08 && (
        <g fill="none" stroke={look.rim.colour} strokeWidth="1.2" strokeLinecap="round" opacity={Math.min(0.95, look.rim.strength * Math.abs(lx))}>
          {lx > 0 ? (
            <path d="M213.6,193.8L246.6,251.2M283.8,232.4L297.6,265.6M274.2,212.6V232" />
          ) : (
            <path d="M212.4,193.8L179.4,251.2M236.6,231H261.4M274.6,231H282.6M262.2,212.6V231.4" />
          )}
        </g>
      )}
      {/* Upper arched window */}
      <path d="M205.4,238.6V225.4A7.6,7.6 0 0 1 220.6,225.4V238.6Z" fill={c.frame} />
      <path d="M207,237V225.4A6,6 0 0 1 219,225.4V237Z" fill={`url(#${u}glass)`} />
      <path d="M213,219.4V237M207,228.4H219" stroke={c.frame} strokeWidth="1.1" />
      <path d="M208.6,235.4L211.6,228.6H212.8L209.8,235.4Z" fill="#fff" opacity={0.35 * (1 - lamps)} />
      <rect x="203.6" y="238" width="18.8" height="2.2" rx="0.8" fill={c.frame} />
      {/* Door, under a little hood, with a fanlight and a lantern */}
      <path d="M199.6,262.6L213,254.4L226.4,262.6Z" fill={c.roof} />
      <path d="M199.6,262.6L213,254.4L226.4,262.6" fill="none" stroke={c.roofShade} strokeWidth="1.2" strokeLinejoin="round" />
      <rect x="201.6" y="262.4" width="22.8" height="2" fill={c.frame} />
      <rect x="201.6" y="264.4" width="22.8" height="1.6" fill={c.wallShade} opacity="0.8" />
      <path d="M202.6,300V277A10.4,10.4 0 0 1 223.4,277V300Z" fill={c.frame} />
      <path d="M204.6,300V277A8.4,8.4 0 0 1 221.4,277V300Z" fill={c.door} />
      <path d="M205.8,276.4A7.2,7.2 0 0 1 220.2,276.4Z" fill={`url(#${u}glass)`} />
      <path d="M213,269.2V276.4M207.9,271.3L210.1,276.4M218.1,271.3L215.9,276.4" stroke={c.frame} strokeWidth="0.7" />
      <rect x="204.6" y="276.4" width="16.8" height="1.1" fill={c.doorDark} />
      <g fill={c.doorDark}>
        <rect x="206.8" y="279.6" width="5" height="8" rx="0.8" />
        <rect x="214.2" y="279.6" width="5" height="8" rx="0.8" />
        <rect x="206.8" y="290" width="5" height="7.6" rx="0.8" />
        <rect x="214.2" y="290" width="5" height="7.6" rx="0.8" />
      </g>
      <circle cx="218.6" cy="288.8" r="1.05" fill={c.brass} />
      <rect x="211.2" y="284.4" width="3.6" height="1" rx="0.5" fill={c.brass} />
      <path d="M229.2,270.2H231.6V271.4" fill="none" stroke="#3A3A44" strokeWidth="0.7" />
      <rect x="229.4" y="271.2" width="4" height="6" rx="0.9" fill="#3A3A44" />
      <rect x="230.3" y="272.3" width="2.2" height="3.6" rx="0.5" fill={mix('#9FB0BE', '#FFE7A8', lamps)} />
      {/* Plinth and step */}
      <rect x="186" y="296.4" width="106" height="3.8" fill={c.plinth} />
      <rect x="200.4" y="298.6" width="25.2" height="2.6" rx="0.6" fill={c.plinth} />
      {/* A climbing rose up the gable, by the door */}
      <g>
        {[
          [196.6, 296, 3.2],
          [198.6, 291, 2.6],
          [196.4, 286.6, 2.6],
          [198.4, 282, 2.4],
          [196.6, 277.4, 2.3],
          [198.8, 272.8, 2.2],
          [197, 268.4, 2],
          [199.8, 265.2, 1.8],
        ].map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill={i % 2 ? c.bushShade : c.bush} />
        ))}
        {[
          [195.4, 294.4],
          [199.6, 289.2],
          [195.6, 284.4],
          [199.4, 279.6],
          [196, 274.6],
          [199.6, 270.4],
          [197.8, 266.2],
        ].map(([x, y]) => (
          <circle key={`${x},${y}`} cx={x} cy={y} r="1.15" fill={c.pink} />
        ))}
      </g>
    </g>
  );
}

/** Warm light from the windows and the lantern, and its spill on the lawn. */
function Lamplight({ look, u }: { look: HeroLook; u: string }) {
  if (look.lamps <= 0) return null;
  return (
    <g opacity={look.lamps}>
      <defs>
        <radialGradient id={`${u}lamp`}>
          <stop offset="0" stopColor="#FFC870" stopOpacity="0.55" />
          <stop offset="0.45" stopColor="#FFB45A" stopOpacity="0.18" />
          <stop offset="1" stopColor="#FFB45A" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="266" cy="283" rx="34" ry="24" fill={`url(#${u}lamp)`} />
      <ellipse cx="213" cy="226" rx="22" ry="20" fill={`url(#${u}lamp)`} />
      <circle cx="231.4" cy="274.2" r="11" fill={`url(#${u}lamp)`} />
      <ellipse cx="213" cy="274" rx="16" ry="12" fill={`url(#${u}lamp)`} opacity="0.7" />
      <ellipse cx="262" cy="308" rx="46" ry="9" fill={`url(#${u}lamp)`} opacity="0.75" />
      <ellipse cx="213" cy="306" rx="20" ry="6" fill={`url(#${u}lamp)`} opacity="0.6" />
    </g>
  );
}

/** Land: the far city, three ranges of hills, the garden, the house, the fence and the pond. */
export function LandArt({ look, u }: { look: HeroLook; u: string }) {
  const c = look.colours;
  const { rim, sun } = look;
  const lx = look.lightX;
  const ly = look.lightY;
  const contrast = look.contrast;
  const rimOf = (base: string, k: number) => mix(base, rim.colour, rim.strength * k);
  const litOf = (shade: string, lit: string) => mix(shade, lit, 0.35 + 0.65 * contrast);
  const reach = look.shadow.reach;
  const shadowX = (s: number) => r1(-lx * s * reach);
  const lowSun = sun.visible > 0 && sun.y > 150 ? clamp((sun.y - 150) / 60, 0, 1) * sun.visible : 0;
  // The sun's reflection in the pond (it lies between x 40 and 152).
  const glint = sun.visible > 0 && sun.x > 44 && sun.x < 148 ? clamp((sun.y - 120) / 90, 0, 1) * sun.visible : 0;
  const moonGlint = look.moon * 0.9;

  const full = { viewBox: `0 0 ${STAGE_W} ${STAGE_H}`, overflow: 'visible', 'aria-hidden': true, focusable: false } as const;
  return (
    <>
    <div className={styles.depthFar}>
    <svg {...full}>
      <defs>
        <linearGradient id={`${u}water`} x1="0" y1="311" x2="0" y2="331" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={look.water.far} />
          <stop offset="1" stopColor={look.water.near} />
        </linearGradient>
        <linearGradient id={`${u}lawn`} x1="0" y1="306" x2="0" y2="340" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={c.lawn} />
          <stop offset="1" stopColor={c.lawnDark} />
        </linearGradient>
        <linearGradient id={`${u}garden`} x1="0" y1="288" x2="0" y2="312" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={c.garden} />
          <stop offset="1" stopColor={c.gardenDark} />
        </linearGradient>
        <radialGradient id={`${u}bloom`}>
          <stop offset="0" stopColor={sun.glow} stopOpacity="0.7" />
          <stop offset="0.5" stopColor={sun.glow} stopOpacity="0.22" />
          <stop offset="1" stopColor={sun.glow} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}cityGlow`}>
          <stop offset="0" stopColor="#FFB27A" stopOpacity="0.5" />
          <stop offset="1" stopColor="#FFB27A" stopOpacity="0" />
        </radialGradient>
        {(
          [
            ['mist1', 0.85],
            ['mist2', 0.7],
            ['mist3', 0.5],
          ] as const
        ).map(([id, k]) => (
          <linearGradient key={id} id={`${u}${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={look.mist.colour} stopOpacity="0" />
            <stop offset="1" stopColor={look.mist.colour} stopOpacity={r1(look.mist.amount * k * 100) / 100} />
          </linearGradient>
        ))}
        <clipPath id={`${u}pond`}>
          <ellipse cx="96" cy="321.3" rx="56" ry="8.6" />
        </clipPath>
      </defs>

      {/* The city's glow on the night sky, then the city */}
      {look.extras.city > 0 && (
        <ellipse cx="72" cy="234" rx="92" ry="30" fill={`url(#${u}cityGlow)`} opacity={look.extras.city * 0.5} />
      )}
      {/* The farthest range, almost sky */}
      <path d={PATH_FAR} fill={rimOf(c.ridgeFar, 0.6)} transform="translate(0 -1)" />
      <path d={PATH_FAR} fill={c.ridgeFar} />
      <rect x={-BLEED} y="204" width={STAGE_W + 2 * BLEED} height="40" fill={`url(#${u}mist1)`} />
      <Skyline c={c} city={look.extras.city} />

      {/* Far ridge, with its sunlit edge, and mist in the valley below */}
      <path d={PATH_A} fill={rimOf(c.ridgeA, 0.5)} transform="translate(0 -1)" />
      <path d={PATH_A} fill={c.ridgeA} />
      <rect x={-BLEED} y="222" width={STAGE_W + 2 * BLEED} height="34" fill={`url(#${u}mist2)`} />

      {/* Light scattering around a low sun */}
      {lowSun > 0 && (
        <ellipse cx={r1(sun.x)} cy={r1(Math.min(sun.y + 18, 240))} rx="190" ry="58" fill={`url(#${u}bloom)`} opacity={r1(lowSun * 100) / 100} />
      )}

    </svg>
    <ShardLight look={look} />
    </div>

    <div className={styles.depthMid}>
    <svg {...full}>
      {/* Middle hills with copses */}
      <path d={PATH_B} fill={rimOf(c.hillB, 0.45)} transform="translate(0 -1)" />
      <path d={PATH_B} fill={c.hillB} />
      <g fill={c.hillBtrees}>
        {B_TREES.map(([x, r]) => (
          <circle key={x} cx={x} cy={r1(ridgeY(RIDGE_B, x) - r + 2.2)} r={r} />
        ))}
      </g>
      <rect x={-BLEED} y="240" width={STAGE_W + 2 * BLEED} height="34" fill={`url(#${u}mist3)`} />

      {/* Near hills: fields and hedgerows */}
      <path d={PATH_C} fill={rimOf(c.hillC, 0.4)} transform="translate(0 -1.2)" />
      <path d={PATH_C} fill={c.hillC} />
      <path d="M-44,284C40,276 90,274 140,279C175,283 200,284 236,280C290,274 340,272 446,278V320H-44Z" fill={c.hillCfield} opacity="0.55" />
      <path
        d="M-44,279C30,270 74,268.4 112,272.8C150,277 172,279.6 206,277M262,272C300,266.6 352,265.4 446,271"
        fill="none"
        stroke={c.hillCdark}
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.9"
      />
      <Volume id={`${u}ct1`} lit={litOf(c.hillCdark, c.hillC)} shade={c.hillCdark} dx={lx * 2.4} dy={-ly * 6}>
        <circle cx="36" cy="261" r="6.4" />
        <circle cx="43.6" cy="263" r="4.8" />
      </Volume>
      <Volume id={`${u}ct2`} lit={litOf(c.hillCdark, c.hillC)} shade={c.hillCdark} dx={lx * 2.4} dy={-ly * 6}>
        <circle cx="372" cy="258" r="6.8" />
      </Volume>
      <g>
        {(
          [
            [74, 265.6, 1],
            [83.4, 268.4, -1],
            [96.6, 266.2, 1],
            [105.2, 269.6, 1],
          ] as const
        ).map(([x, y, dir]) => (
          <g key={x} transform={`translate(${x} ${y}) scale(${dir} 1)`}>
            <ellipse cx="0" cy="0" rx="2.5" ry="1.65" fill={c.sheep} />
            <ellipse cx="2.4" cy="-0.5" rx="0.95" ry="0.8" fill={c.sheepFace} />
            <path d="M-1.2,1.4V2.4M1.1,1.4V2.4" stroke={c.sheepFace} strokeWidth="0.5" />
          </g>
        ))}
      </g>
      <rect x="35.4" y="266" width="1.4" height="4.6" fill={c.trunk} opacity="0.6" />
      <rect x="371.3" y="263.8" width="1.4" height="5" fill={c.trunk} opacity="0.6" />

    </svg>
    </div>

    <svg {...full}>
      {/* The garden the house stands in */}
      <path d={PATH_D} fill={rimOf(c.garden, 0.3)} transform="translate(0 -1)" />
      <path d={PATH_D} fill={`url(#${u}garden)`} />

      {/* Poplars behind the house on the left */}
      <ellipse cx={r1(170 + shadowX(10))} cy="296.4" rx="13" ry="2" fill={c.shadow} opacity={look.shadow.opacity} />
      <rect x="157.4" y="284" width="2" height="12" fill={c.trunk} />
      <rect x="169.2" y="282" width="2.2" height="14" fill={c.trunk} />
      <Volume id={`${u}pop2`} lit={litOf(c.poplarShade, c.poplar)} shade={c.poplarShade} dx={lx * 4.2} dy={-ly * 8}>
        <path d="M158.4,222C164,229 165.8,250 165,270C164.4,282 152.4,282 151.8,270C151,250 152.8,229 158.4,222Z" />
      </Volume>
      <Volume id={`${u}pop1`} lit={litOf(c.poplarShade, c.poplar)} shade={c.poplarShade} dx={lx * 4.8} dy={-ly * 8}>
        <path d="M170.4,203.6C177,212 179.2,238 178.2,262C177.6,277 163.2,277 162.6,262C161.6,238 163.8,212 170.4,203.6Z" />
      </Volume>

      {/* The big tree on the right, in its seasonal colours (bare in winter) */}
      <ellipse cx={r1(333 + shadowX(14))} cy="298" rx="30" ry="3" fill={c.shadow} opacity={look.shadow.opacity} />
      {look.extras.bareTree ? (
        <g fill="none" stroke={c.trunk} strokeLinecap="round">
          <path d="M329.2,298C330.2,288 330.4,276 329.8,266L334.8,266C334.2,276 334.6,288 336,298Z" fill={c.trunk} stroke="none" />
          <path d="M331,268C326,259 318,252 309.6,247.6M332.2,266C332.4,254 331,242 327.6,228M333.4,268C340,262 348,257 356.4,252.6" strokeWidth="2.6" />
          <path d="M318,251.6C314.4,246.6 312.6,240.6 312.4,234M331,246C336,239 339.6,232.4 341.6,224.4M346.4,257.6C350,250.4 352,244.4 352.2,238.2M329.8,236C325,230.4 322.4,225.6 320.4,218.6" strokeWidth="1.6" />
          <path d="M310.4,247.8C305.6,245.4 302.4,241.4 300.6,236.6M328.2,230.6C329.4,224.6 330.4,219.6 331.6,213.8M354.6,253.6C358.6,250.4 361.6,246.6 363.6,242M341.2,226C345.4,223.4 348.6,219.6 350.6,215.6M313,238.6C309.6,235.6 307.6,231.6 307,227.4M352,241.6C355.4,238.6 357.6,235 358.6,230.6M321.4,221.6C318,219.4 315.8,216.4 314.8,212.8M336.6,236.6C340.6,236.2 344.2,234.4 347,231.4" strokeWidth="1" />
        </g>
      ) : (
        <>
          <path d="M329.4,298C330.6,288 330.8,276 329.8,262H334.6C333.8,276 334.2,288 335.8,298Z" fill={c.trunk} />
          <path d="M332.2,276C336,272 340,268.6 344.4,266.6" fill="none" stroke={c.trunk} strokeWidth="2" strokeLinecap="round" />
          <Volume id={`${u}tree`} lit={litOf(c.treeShade, c.treeLit)} shade={c.treeShade} dx={lx * 7.5} dy={-ly * 20}>
            <circle cx="314" cy="251" r="14" />
            <circle cx="327.6" cy="236" r="17" />
            <circle cx="346" cy="240.6" r="15.4" />
            <circle cx="353" cy="256" r="12" />
            <circle cx="333" cy="258.4" r="15" />
          </Volume>
          <g fill={c.treeFleck} opacity={0.45 + 0.45 * contrast}>
            {[
              [319.4, 229.4, 2.2],
              [327, 224.6, 1.8],
              [311, 240.4, 1.9],
              [340.6, 230.2, 1.7],
              [306.6, 249.4, 1.5],
              [356, 238.8, 1.5],
            ].map(([x, y, r]) => (
              <circle key={x} cx={r1(x + lx * 4)} cy={y} r={r} />
            ))}
          </g>
        </>
      )}

      <House look={look} u={u} />

      {/* Bushes at the foot of the house */}
      <Volume id={`${u}bush1`} lit={litOf(c.bushShade, c.bush)} shade={c.bushShade} dx={lx * 3.4} dy={-ly * 9}>
        <circle cx="182.6" cy="295.6" r="8.4" />
        <circle cx="191.2" cy="298.4" r="5.6" />
      </Volume>
      <g fill={c.hydrangea}>
        <circle cx="179.4" cy="291.6" r="1.6" />
        <circle cx="185.2" cy="290.2" r="1.5" />
        <circle cx="182" cy="296.4" r="1.5" />
        <circle cx="190.8" cy="295.2" r="1.3" />
      </g>
      <g fill={c.lilac}>
        <circle cx="187.6" cy="293.6" r="1.2" />
        <circle cx="177.6" cy="296.8" r="1.2" />
      </g>
      <Volume id={`${u}bush2`} lit={litOf(c.bushShade, c.bush)} shade={c.bushShade} dx={lx * 3} dy={-ly * 8}>
        <circle cx="295" cy="296.4" r="7.2" />
        <circle cx="303.4" cy="298.6" r="5.4" />
      </Volume>

      <Lamplight look={look} u={u} />

      {/* The picket fence, open at the gate */}
      <g>
        <rect x="146" y="298.4" width="52.6" height="1.7" fill={c.fenceShade} />
        <rect x="146" y="303.8" width="52.6" height="1.7" fill={c.fenceShade} />
        <rect x="229" y="298.4" width="143" height="1.7" fill={c.fenceShade} />
        <rect x="229" y="303.8" width="143" height="1.7" fill={c.fenceShade} />
        <path d={FENCE_L} fill={c.fence} />
        <path d={FENCE_R} fill={c.fence} />
        <rect x="198.8" y="292.4" width="3.6" height="16" rx="0.8" fill={c.fence} />
        <rect x="224.6" y="292.4" width="3.6" height="16" rx="0.8" fill={c.fence} />
        <circle cx="200.6" cy="292.2" r="1.9" fill={c.fence} />
        <circle cx="226.4" cy="292.2" r="1.9" fill={c.fence} />
      </g>

      {/* Lawn and the path to the door */}
      <path d={PATH_E} fill={rimOf(c.lawn, 0.25)} transform="translate(0 -1)" />
      <path d={PATH_E} fill={`url(#${u}lawn)`} />
      <path d="M204.4,300.2H221.6L236,340H190Z" fill={c.path} />
      <path d="M204.4,300.2L190,340M221.6,300.2L236,340" stroke={c.pathShade} strokeWidth="1" />
      <g fill={c.pathShade} opacity="0.75">
        <path d="M206.6,305.6H218.4L219.2,307.4H205.8Z" />
        <path d="M204.6,312.6H220.6L221.6,314.8H203.6Z" />
        <path d="M202.2,321.4H223.4L224.6,324H201Z" />
        <path d="M199.4,331.6H226.6L228,334.6H198Z" />
      </g>

      {/* The pond: bank, water mirroring the sky, the sun or moon in it, lilies and reeds */}
      <ellipse cx="96" cy="320.2" rx="58" ry="10.2" fill={c.pondEdge} />
      <ellipse cx="96" cy="321.3" rx="56" ry="8.6" fill={`url(#${u}water)`} />
      <g clipPath={`url(#${u}pond)`}>
        <path d="M44,316.4H82M108,315.6H146M54,325H70M122,326H140" stroke={look.water.glint} strokeWidth="0.7" opacity="0.4" />
        {glint > 0 && (
          <g fill={look.water.glint} opacity={glint}>
            <rect x={r1(sun.x - 7)} y="314" width="14" height="1.3" rx="0.6" />
            <rect x={r1(sun.x - 5)} y="317.2" width="10" height="1.2" rx="0.6" />
            <rect x={r1(sun.x - 8)} y="320.6" width="16" height="1.2" rx="0.6" />
            <rect x={r1(sun.x - 4)} y="324" width="8" height="1.1" rx="0.55" />
            <rect x={r1(sun.x - 6)} y="327.2" width="12" height="1.1" rx="0.55" />
          </g>
        )}
        {moonGlint > 0 && (
          <g fill="#F4ECCF" opacity={moonGlint}>
            <rect x={MOON.x - 4} y="315" width="8" height="1" rx="0.5" />
            <rect x={MOON.x - 2.6} y="318.4" width="5.2" height="1" rx="0.5" />
            <rect x={MOON.x - 4.6} y="322" width="9.2" height="1" rx="0.5" />
            <rect x={MOON.x - 2} y="325.6" width="4" height="0.9" rx="0.45" />
          </g>
        )}
        {/* The duck's reflection */}
        <g transform="translate(86 321.6) scale(1.12 -0.56)" fill={c.duck} opacity="0.22">
          <path d="M-15,-9.5C-12.5,-10.5 -8,-10 -3,-10.6C3,-11.4 9.5,-11 13.2,-7.4C15.6,-5 16.2,-2 15.4,1.8L-11.5,1.8C-14.8,-0.8 -16.6,-5.6 -15,-9.5Z" />
          <path d="M7.6,-9C7.8,-13.5 8.2,-17 9.6,-19.5L15.4,-18.8C15.6,-15.8 15,-11.5 14.6,-7.8Z" />
          <circle cx="12.6" cy="-21.2" r="6.2" />
        </g>
      </g>
      <g fill={c.lily}>
        <path d="M125.4,324.4A7,2.4 0 1 1 131.8,325.2L127.6,324.8Z" />
        <path d="M57,317.6A5,1.8 0 1 1 61.6,318.2L58.8,318Z" />
        <ellipse cx="139" cy="319.6" rx="3.6" ry="1.3" />
      </g>
      <g fill={c.pink}>
        <path d="M124.2,322.6L125.4,320.2L126.4,322L127.6,319.8L128.6,322L129.8,320.4L130.6,322.8Z" />
      </g>
      <g fill={c.stone}>
        <ellipse cx="48" cy="327.6" rx="3.4" ry="1.7" />
        <ellipse cx="140.6" cy="328.4" rx="4.2" ry="1.9" />
        <ellipse cx="147" cy="325.6" rx="2.6" ry="1.3" />
      </g>
      <g fill="none" stroke={c.reed} strokeWidth="1.4" strokeLinecap="round">
        <path d="M44,322C43.6,312 42.4,304 40,296" />
        <path d="M47,323C47.2,313 48.2,305 50.6,299" />
        <path d="M41.2,322C39.4,314 36.4,309 32.6,305.4" />
        <path d="M49.6,323.4C51.6,317 54.6,313 58.4,310.6" />
        <path d="M45.6,322.4C45.6,316 45.4,310 44.6,302" />
      </g>
      <g fill={c.cattail}>
        <rect x="38.6" y="295" width="3" height="8.2" rx="1.5" transform="rotate(-14 40.1 299.1)" />
        <rect x="48.8" y="298.2" width="2.8" height="7.4" rx="1.4" transform="rotate(15 50.2 301.9)" />
      </g>

      {/* The hedgehog's shadow on the lawn */}
      <ellipse cx={r1(322 + shadowX(6))} cy="327.6" rx="19" ry="2.5" fill={c.shadow} opacity={look.shadow.opacity * 1.3} />
    </svg>
    </>
  );
}

/** Blades and flowers in the foreground grass, in front of the animals. */
export function FrontArt({ look }: { look: HeroLook }) {
  const c = look.colours;
  const y0 = 300;
  const h = STAGE_H - y0;
  const tufts: readonly Pt[] = [
    [14, 330],
    [160, 326],
    [176, 333],
    [252, 329],
    [278, 334],
    [306, 329.6],
    [344, 328.6],
    [386, 331],
  ];
  return (
    <svg
      className={styles.piece}
      viewBox={`0 ${y0} ${STAGE_W} ${h}`}
      overflow="visible"
      style={{ position: 'absolute', left: 0, top: `${(y0 / STAGE_H) * 100}%`, width: '100%', height: `${(h / STAGE_H) * 100}%` }}
      aria-hidden="true"
      focusable="false"
    >
      <g fill={c.tuft}>
        {tufts.map(([x, y]) => (
          <path key={x} d={`M${x - 4},${y}C${x - 3},${y - 3} ${x - 3.6},${y - 5} ${x - 5},${y - 7}C${x - 2},${y - 5.4} ${x - 1.2},${y - 3.4} ${x - 0.6},${y - 1.6}C${x - 0.4},${y - 4.6} ${x},${y - 7} ${x + 1},${y - 9}C${x + 1.6},${y - 6} ${x + 1.4},${y - 3.6} ${x + 1},${y - 1.6}C${x + 2},${y - 3.6} ${x + 3.4},${y - 5} ${x + 5.4},${y - 6}C${x + 4},${y - 4} ${x + 3.4},${y - 2} ${x + 3.2},${y}Z`} />
        ))}
      </g>
      <g>
        {(
          [
            [170, 321.4],
            [262, 323.4],
            [292, 319.6],
            [364, 321],
            [24, 321],
            [12, 314.6],
          ] as const
        ).map(([x, y]) => (
          <g key={x}>
            <circle cx={x - 1.3} cy={y} r="1.2" fill={c.white} />
            <circle cx={x + 1.3} cy={y} r="1.2" fill={c.white} />
            <circle cx={x} cy={y - 1.3} r="1.2" fill={c.white} />
            <circle cx={x} cy={y + 1.3} r="1.2" fill={c.white} />
            <circle cx={x} cy={y} r="0.9" fill={c.yellow} />
          </g>
        ))}
      </g>
      {look.extras.autumn > 0.3 && (
        <g opacity={clamp((look.extras.autumn - 0.3) * 2, 0, 1)}>
          {(
            [
              [288, 324.6, 20, c.leaf],
              [352, 322, -30, c.leafRed],
              [368, 326.4, 60, c.leaf],
              [246, 326, -10, c.leafRed],
              [314, 318, 40, c.leaf],
            ] as const
          ).map(([x, y, a, f]) => (
            <path key={x} d="M-2.4,0C-1.2,-1.4 1.2,-1.4 2.4,0C1.2,1.4 -1.2,1.4 -2.4,0Z" fill={f} transform={`translate(${x} ${y}) rotate(${a})`} />
          ))}
        </g>
      )}
    </svg>
  );
}
