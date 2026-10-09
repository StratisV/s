// Hero B: everything that moves. Each moving thing is its own small <svg>
// window onto the stage (viewBox in stage units), so the browser can move it
// on the compositor with transform and opacity alone, without repainting the
// still layers.
import type { CSSProperties, ReactNode } from 'react';
import { MOON, STAGE_H, STAGE_W, mix, type HeroLook } from './b-light';
import styles from './HeroB.module.css';

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

function box(x: number, y: number, w: number, h: number): CSSProperties {
  return { left: pct(x, STAGE_W), top: pct(y, STAGE_H), width: pct(w, STAGE_W), height: pct(h, STAGE_H) };
}

/** An <svg> showing the stage rectangle x, y, w, h at its place on the stage. */
export function Piece({
  x,
  y,
  w,
  h,
  className,
  style,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <svg
      className={`${styles.piece}${className ? ` ${className}` : ''}`}
      viewBox={`${x} ${y} ${w} ${h}`}
      style={{ ...box(x, y, w, h), ...style }}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Stars: a fixed scatter, thinning towards the horizon and clear of the moon.

type Star = readonly [x: number, y: number, size: number];

const STARS: readonly Star[] = (() => {
  let seed = 20261008;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const out: Star[] = [];
  while (out.length < 92) {
    const x = rand() * STAGE_W;
    const y = 3 + rand() ** 1.45 * 222;
    const size = rand();
    if (Math.hypot(x - MOON.x, y - MOON.y) < 22) continue;
    out.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10, size]);
  }
  return out;
})();

const fadeTowardsHorizon = (y: number) => Math.round((1 - Math.min(0.85, Math.max(0, (y - 140) / 95))) * 100) / 100;

function StarDots({ stars }: { stars: readonly Star[] }) {
  return (
    <>
      {stars.map(([x, y, s]) => (
        <circle
          key={`${x},${y}`}
          cx={x}
          cy={y}
          r={Math.round((0.32 + s * 0.6) * 100) / 100}
          fill={s > 0.6 ? '#FFF6DE' : '#E4EBFF'}
          opacity={fadeTowardsHorizon(y)}
        />
      ))}
    </>
  );
}

const sparkle = (x: number, y: number, r: number) =>
  `M${x},${y - r}Q${x},${y} ${x + r},${y}Q${x},${y} ${x},${y + r}Q${x},${y} ${x - r},${y}Q${x},${y} ${x},${y - r}Z`;

export function Stars({ look, u }: { look: HeroLook; u: string }) {
  const { bright, faint } = look.stars;
  if (bright <= 0 && faint <= 0) return null;
  const big = STARS.filter(([, , s]) => s > 0.88);
  const small = STARS.filter(([, , s]) => s <= 0.88);
  const full = { x: 0, y: 0, w: STAGE_W, h: 232 };
  return (
    <>
      <div className={styles.fill} style={{ opacity: faint }}>
        <Piece {...full} className={`${styles.anim} ${styles.twinkleA}`}>
          <StarDots stars={small.filter((_, i) => i % 2 === 0)} />
        </Piece>
        <Piece {...full} className={`${styles.anim} ${styles.twinkleB}`}>
          <StarDots stars={small.filter((_, i) => i % 2 === 1)} />
        </Piece>
      </div>
      <div className={styles.fill} style={{ opacity: bright }}>
        <Piece {...full} className={`${styles.anim} ${styles.twinkleC}`}>
          {big.map(([x, y, s]) => (
            <g key={`${x},${y}`} opacity={fadeTowardsHorizon(y)}>
              <path d={sparkle(x, y, 2.4 + (s - 0.88) * 14)} fill="#FFF8E6" opacity="0.85" />
              <circle cx={x} cy={y} r="0.85" fill="#FFFFFF" />
            </g>
          ))}
        </Piece>
      </div>
      {faint > 0.9 && (
        <Piece x={262} y={96} w={76} h={40} className={`${styles.anim} ${styles.meteor}`}>
          <defs>
            <linearGradient id={`${u}meteor`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
              <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.9" />
            </linearGradient>
          </defs>
          <path d="M336,98L268,132" stroke={`url(#${u}meteor)`} strokeWidth="1" strokeLinecap="round" />
        </Piece>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Clouds: crisp, flat-bottomed, two-tone (lit tops by day, glowing bases at sunset).

/** A cloud is a stack of long tapered strands: x centre, y, half length, half thickness, opacity. */
type Strand = readonly [cx: number, cy: number, rx: number, ry: number, opacity: number];

const CLOUD_SHAPES: Record<'deck' | 'wisp' | 'streak', { w: number; strands: readonly Strand[] }> = {
  // A layered bank: thicker in the middle, feathered strands above and below.
  deck: {
    w: 150,
    strands: [
      [70, -4.2, 66, 4.2, 1],
      [86, -9.6, 44, 3.8, 1],
      [62, -13.6, 26, 3, 0.95],
      [104, -13, 20, 2.4, 0.8],
      [40, -7, 30, 2.6, 0.85],
      [120, -1.4, 28, 1.6, 0.7],
    ],
  },
  wisp: {
    w: 110,
    strands: [
      [52, -3, 50, 3, 1],
      [68, -7.4, 30, 2.8, 0.95],
      [32, -6, 20, 1.9, 0.8],
      [90, -1.2, 18, 1.4, 0.7],
    ],
  },
  streak: {
    w: 140,
    strands: [
      [62, -2.6, 60, 2.6, 1],
      [86, -6.2, 34, 2.4, 1],
      [40, -4.4, 26, 1.9, 0.8],
      [110, -1.4, 28, 1.4, 0.7],
    ],
  },
};

interface CloudSpec {
  shape: keyof typeof CLOUD_SHAPES;
  /** Bottom of the cloud on the stage. */
  y: number;
  scale: number;
  /** Seconds to cross the stage, and where in the crossing it starts (0 to 1). */
  duration: number;
  at: number;
  /** 0 near to 1 far: farther clouds sink into the haze. */
  depth: number;
}

/**
 * High strands above the title (clear of the status bar) and low ones over
 * the hills, clear of the title and address so they never sit behind text.
 */
const CLOUDS: readonly CloudSpec[] = [
  { shape: 'deck', y: 86, scale: 0.78, duration: 300, at: 0.3, depth: 0 },
  { shape: 'wisp', y: 98, scale: 0.7, duration: 360, at: 0.74, depth: 0.1 },
  { shape: 'streak', y: 207, scale: 0.95, duration: 420, at: 0.42, depth: 0.3 },
  { shape: 'wisp', y: 217, scale: 0.6, duration: 480, at: 0.9, depth: 0.5 },
];

function Cloud({ spec, look, id }: { spec: CloudSpec; look: HeroLook; id: string }) {
  const shape = CLOUD_SHAPES[spec.shape];
  const top = Math.min(...shape.strands.map(([, cy, , ry]) => cy - ry));
  const w = shape.w * spec.scale;
  const h = -top * spec.scale;
  const y = spec.y - h;
  const haze = (c: string) => mix(c, look.haze, spec.depth * 0.6);
  return (
    <Piece
      x={0}
      y={y}
      w={w}
      h={h}
      className={`${styles.anim} ${styles.drift}`}
      style={
        {
          '--from': `${(-(w + 44) / w) * 100}%`,
          '--to': `${((STAGE_W + 44) / w) * 100}%`,
          animationDuration: `${spec.duration}s`,
          animationDelay: `${-spec.at * spec.duration}s`,
          opacity: look.cloud.opacity * 0.94,
        } as CSSProperties
      }
    >
      <defs>
        <linearGradient id={id} x1="0" y1={top} x2="0" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={haze(look.cloud.top)} />
          <stop offset="0.3" stopColor={haze(look.cloud.top)} />
          <stop offset="1" stopColor={haze(look.cloud.base)} />
        </linearGradient>
      </defs>
      <g transform={`translate(0 ${spec.y}) scale(${spec.scale})`} fill={`url(#${id})`}>
        {shape.strands.map(([cx, cy, rx, ry, o]) => (
          <ellipse key={`${cx},${cy}`} cx={cx} cy={cy} rx={rx} ry={ry} opacity={o} />
        ))}
      </g>
    </Piece>
  );
}

export function Clouds({ look, u }: { look: HeroLook; u: string }) {
  return (
    <>
      {CLOUDS.map((spec, i) => (
        <Cloud key={i} spec={spec} look={look} id={`${u}cloud${i}`} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------

/** A few birds crossing the low sky by day, now and then. */
export function Birds({ look }: { look: HeroLook }) {
  if (!look.extras.birds) return null;
  const ink = mix('#2F3B52', look.colours.shadow, 0.3);
  const bird = (x: number, y: number, s: number, delay: string) => (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path
        className={`${styles.anim} ${styles.flap}`}
        style={{ animationDelay: delay }}
        d="M-4.2,0Q-2.2,-2.6 0,0Q2.2,-2.6 4.2,0"
        fill="none"
        stroke={ink}
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
  return (
    <Piece
      x={0}
      y={176}
      w={34}
      h={16}
      className={`${styles.anim} ${styles.birds}`}
      style={{ '--from': `${(-78 / 34) * 100}%`, '--to': `${((STAGE_W + 44) / 34) * 100}%` } as CSSProperties}
    >
      {bird(8, 186, 1, '0s')}
      {bird(20, 181, 0.85, '-0.22s')}
      {bird(28.5, 188.4, 0.72, '-0.41s')}
    </Piece>
  );
}

/** Smoke curling from the chimney on cold evenings, nights and mornings. */
export function Smoke({ look, u }: { look: HeroLook; u: string }) {
  const amount = look.extras.smoke;
  if (amount <= 0) return null;
  const fill = mix(mix(look.cloud.top, '#C8CED8', 0.45), look.colours.shadow, 0.12);
  return (
    <div className={styles.fill} style={{ opacity: amount * 0.9 }}>
      {[0, 1, 2, 3].map((i) => (
        <Piece key={i} x={261} y={194} w={14} h={14} className={`${styles.anim} ${styles.puff}`} style={{ animationDelay: `${-i * 1.5}s` }}>
          <defs>
            <radialGradient id={`${u}puff${i}`}>
              <stop offset="0.35" stopColor={fill} stopOpacity="0.95" />
              <stop offset="1" stopColor={fill} stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="268" cy="201" r="5.6" fill={`url(#${u}puff${i})`} />
        </Piece>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The duck: green, swimming on the pond, facing right towards the house.

export function Duck({ look }: { look: HeroLook }) {
  const c = look.colours;
  // Only a low sun (or the moon) catches the duck's back.
  const rim = Math.max(0, look.rim.strength - 0.4) * 1.6 * (look.lightX < 0 ? 1 : 0.6);
  return (
    <>
      {[0, 1].map((i) => (
        <Piece key={i} x={62} y={317} w={48} h={9} className={`${styles.anim} ${styles.ripple}`} style={{ animationDelay: `${-i * 1.6}s` }}>
          <ellipse cx="86" cy="321.6" rx="20" ry="2.8" fill="none" stroke={look.water.glint} strokeWidth="0.8" />
        </Piece>
      ))}
      {/* Clipped at the waterline so the bob never lifts the duck out of the pond */}
      <div className={styles.waterline} style={box(56, 284, 60, 37.6)}>
        <svg className={`${styles.anim} ${styles.duck}`} viewBox="56 284 60 37.6" aria-hidden="true" focusable="false">
          <g transform="translate(86 321.6) scale(1.12)">
            <path
              d="M-15,-9.5C-12.5,-10.5 -8,-10 -3,-10.6C3,-11.4 9.5,-11 13.2,-7.4C15.6,-5 16.2,-2 15.4,3L-11.5,3C-14.8,-0.8 -16.6,-5.6 -15,-9.5Z"
              fill={c.duck}
            />
            <path d="M-15.2,-9.2C-17.4,-10.2 -18.6,-12.6 -17.8,-14.4C-17.2,-15.4 -15.8,-15 -15.6,-13.8C-15.4,-12.4 -14,-11.2 -11.6,-10.6Z" fill={c.duckHead} />
            <path d="M-10.5,-6.8C-7,-10.2 1.5,-10.8 7.2,-7.6C5.6,-4.4 0.5,-2.6 -5,-3C-8,-3.2 -10,-4.6 -10.5,-6.8Z" fill={c.duckWing} />
            <path d="M-6.6,-5.4C-4.6,-6.1 -2,-6.2 0.2,-5.8L-0.2,-4.4C-2.4,-4.7 -4.6,-4.5 -6.4,-3.9Z" fill={c.speculum} />
            <path d="M-6.5,-3.6C-4.6,-4.2 -2.4,-4.4 -0.2,-4.1" fill="none" stroke="#FFFFFF" strokeWidth="0.45" opacity="0.8" />
            <path d="M-9.2,-4.6L-11.6,-3.6M-8.4,-3.6L-10.2,-2.4" stroke={c.duckHead} strokeWidth="0.6" strokeLinecap="round" />
            <path d="M7.6,-9C7.8,-13.5 8.2,-17 9.6,-19.5L15.4,-18.8C15.6,-15.8 15,-11.5 14.6,-7.8Z" fill={c.duck} />
            <path d="M8.1,-14.8C10.3,-13.9 12.9,-13.9 15.1,-14.9L15,-13.3C12.9,-12.4 10.3,-12.4 7.9,-13.3Z" fill="#FFFFFF" />
            <circle cx="12.6" cy="-21.2" r="6.2" fill={c.duckHead} />
            <path d="M8.2,-24C9.4,-26.1 11.8,-27.3 14.2,-27C12.2,-26 10.4,-25 9.3,-23.2Z" fill={c.duckShine} opacity="0.75" />
            <path d="M17.2,-22.7C20.1,-23.7 23.6,-23.1 24.4,-21.4C24.8,-20.2 23,-19.3 20.4,-19.2C19.2,-19.2 18,-19.4 17.1,-19.8Z" fill={c.bill} />
            <path d="M17.6,-20.4C19.6,-20.1 22,-20.2 23.8,-20.7" fill="none" stroke={c.billDark} strokeWidth="0.7" strokeLinecap="round" />
            <circle cx="21.3" cy="-22.2" r="0.38" fill={c.billDark} />
            <circle cx="14.7" cy="-22.5" r="1.4" fill={c.eye} />
            <circle cx="15.15" cy="-23" r="0.48" fill="#FFFFFF" />
            <path d="M-13.4,0.2C-6,-1.2 6,-1.2 15.8,-0.2" fill="none" stroke={look.water.glint} strokeWidth="1.1" strokeLinecap="round" opacity="0.75" />
            {rim > 0.05 && (
              <path
                d="M-14.6,-10.2C-11,-11 -6,-10.6 -1,-11.3C4,-12 9,-11.6 12,-8.6"
                fill="none"
                stroke={look.rim.colour}
                strokeWidth="0.9"
                strokeLinecap="round"
                opacity={Math.min(0.9, rim)}
              />
            )}
          </g>
        </svg>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The hedgehog: brown, spiky, facing left towards the house.

function spikyArc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, n: number, out: number, lean: number): string {
  let d = '';
  for (let i = 0; i <= n * 2; i++) {
    const t = from + ((to - from) * i) / (n * 2);
    const k = i % 2 ? out : 1;
    const a = i % 2 ? t + lean : t;
    const x = cx + Math.cos(a) * rx * k;
    const y = cy + Math.sin(a) * ry * k;
    d += `${i ? 'L' : 'M'}${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
  }
  return d;
}

const SPINES = `${spikyArc(3.4, -8.6, 14.6, 11.2, Math.PI * 1.02, Math.PI * 2.12, 13, 1.2, 0.07)}L15.6,-1.6C9,0.4 -1,0.4 -7.6,-2.4Z`;
const SPINES_IN = `${spikyArc(4.4, -8, 10.6, 7.8, Math.PI * 1.08, Math.PI * 2.02, 10, 1.2, 0.08)}L13,-2.6C8,-1.4 0,-1.4 -4,-3Z`;

export function Hedgehog({ look }: { look: HeroLook }) {
  const c = look.colours;
  const lx = look.lightX;
  return (
    <Piece x={294} y={300} w={52} h={28.4} className={`${styles.anim} ${styles.hedgehog}`}>
      <g transform="translate(322 327.4) scale(1.12)">
        <ellipse cx="-6.4" cy="-0.9" rx="2.8" ry="1.5" fill={c.feet} />
        <ellipse cx="10.6" cy="-0.9" rx="2.8" ry="1.5" fill={c.feet} />
        <path d="M-7,-3C0,-0.4 10,-0.4 16,-3L15,-1C9,0.6 0,0.6 -5.6,-1.2Z" fill={c.faceShade} />
        <path d={SPINES} fill={c.spines} strokeLinejoin="round" />
        <g transform={`translate(${Math.round(lx * 1.4 * 10) / 10} -0.6)`}>
          <path d={SPINES_IN} fill={c.spinesMid} />
        </g>
        <g stroke={c.spinesLight} strokeWidth="0.9" strokeLinecap="round" opacity={0.55 + 0.4 * look.contrast}>
          <path d="M0,-15.4L2.6,-17.6M5,-16.2L8,-17.8M9.6,-14.4L12.8,-15.4M3,-11.6L5.8,-13.2M8,-10.8L11,-11.6M12.4,-8.6L15.6,-9M-1.6,-11.2L0.8,-13.4" />
        </g>
        <path d="M-4.2,-15.6C-9,-15 -14.2,-11 -19.8,-6.2C-21.2,-5 -20.6,-3 -18.8,-2.6C-14.2,-1.6 -8.2,-0.8 -3.8,-1.4C-1.4,-5.8 -1.4,-12.4 -4.2,-15.6Z" fill={c.face} />
        <path d="M-18.8,-2.6C-14.2,-1.6 -8.2,-0.8 -3.8,-1.4C-4.6,-3 -9.2,-3.4 -18.2,-3.9Z" fill={c.faceShade} />
        <circle cx="-5.4" cy="-14.4" r="2.2" fill={c.faceShade} />
        <circle cx="-5.3" cy="-14.2" r="1.05" fill={c.blush} opacity="0.8" />
        <ellipse cx="-10.6" cy="-5.6" rx="2" ry="1.2" fill={c.blush} opacity="0.55" />
        <circle cx="-11.4" cy="-9.6" r="1.5" fill={c.nose} />
        <circle cx="-10.95" cy="-10.1" r="0.5" fill="#FFFFFF" />
        <circle cx="-19.8" cy="-5.1" r="1.95" fill={c.nose} />
        <circle cx="-20.4" cy="-5.7" r="0.55" fill="#FFFFFF" opacity="0.6" />
      </g>
    </Piece>
  );
}

// ---------------------------------------------------------------------------

/** The red light on top of the Shard, blinking on the night skyline. */
export function ShardLight({ look }: { look: HeroLook }) {
  if (look.extras.city <= 0.3) return null;
  return (
    <Piece x={90.4} y={192.4} w={6} h={6} className={`${styles.anim} ${styles.beacon}`} style={{ opacity: look.extras.city }}>
      <circle cx="93.4" cy="195.4" r="1.6" fill="#FF5A4E" opacity="0.35" />
      <circle cx="93.4" cy="195.4" r="0.7" fill="#FF7A6A" />
    </Piece>
  );
}

const FIREFLIES: readonly (readonly [number, number])[] = [
  [58, 302],
  [112, 296],
  [150, 309],
  [176, 286],
  [236, 312],
  [286, 290],
  [354, 300],
  [378, 282],
  [28, 290],
];

/** Fireflies drifting over the garden on summer nights. */
export function Fireflies({ look }: { look: HeroLook }) {
  if (!look.extras.fireflies) return null;
  return (
    <>
      {FIREFLIES.map(([x, y], i) => (
        <span
          key={i}
          className={`${styles.anim} ${styles.firefly}`}
          style={{
            left: pct(x, STAGE_W),
            top: pct(y, STAGE_H),
            animationDelay: `${-i * 1.3}s, ${-i * 0.7}s`,
            animationDuration: `${6 + (i % 4)}s, ${2.2 + (i % 3) * 0.6}s`,
          }}
        />
      ))}
    </>
  );
}
