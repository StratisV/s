// The sky: its gradient and glows, the wash behind the title, the sun, the
// moon in its real phase, the Milky Way, stars, clouds, birds and a rare
// shooting star.
import type { CSSProperties } from 'react';
import { mixColour } from '../../lib/logic/sky';
import s from '../Hero.module.css';
import { box, f1, seeded, type Ref } from './frame';
import { ART_H, ART_W, BLEED, SKY_Y, VIEW_BOX, WASH, ZONES, type CloudSpec, type Glow, type HeroLook } from './look';

const FULL = { x: -BLEED, width: ART_W + 2 * BLEED };

function GlowShape({ g, id }: { g: Glow; id: string }) {
  if (g.opacity <= 0.005) return null;
  return (
    <>
      <radialGradient id={id}>
        {g.stops.map(([o, c, a], i) => (
          <stop key={i} offset={o} stopColor={c} stopOpacity={a} />
        ))}
      </radialGradient>
      <ellipse cx={f1(g.cx)} cy={f1(g.cy)} rx={f1(g.rx)} ry={f1(g.ry)} fill={`url(#${id})`} opacity={+g.opacity.toFixed(3)} />
    </>
  );
}

/** The sky's gradient, the glow on the horizon and London's glow at night. */
export function SkyBase({ look, id }: { look: HeroLook; id: Ref }) {
  return (
    <svg className={s.layer} viewBox={VIEW_BOX} preserveAspectRatio="none">
      <linearGradient id={id('sky')} x1="0" y1="0" x2="0" y2={ART_H} gradientUnits="userSpaceOnUse">
        {look.sky.map((c, i) => (
          <stop key={i} offset={SKY_Y[i] / ART_H} stopColor={c} />
        ))}
      </linearGradient>
      <rect {...FULL} height={ART_H} fill={`url(#${id('sky')})`} />
      {look.skyGlows.map((g, i) => (
        <GlowShape key={i} g={g} id={id(`glow${i}`)} />
      ))}
    </svg>
  );
}

/** A soft wash of deeper sky behind the title block, only as strong as legibility needs. */
export function Wash({ look, id }: { look: HeroLook; id: Ref }) {
  if (look.wash.alpha <= 0) return null;
  const g: Glow = {
    ...WASH,
    opacity: look.wash.alpha,
    stops: [
      [0, look.wash.colour, 1],
      [0.5, look.wash.colour, 0.92],
      [1, look.wash.colour, 0],
    ],
  };
  return (
    <svg className={s.layer} viewBox={VIEW_BOX} preserveAspectRatio="none">
      <GlowShape g={g} id={id('wash')} />
    </svg>
  );
}

/** The lit part of the moon: its limb on one side, the terminator on the other. */
function moonPath(cx: number, cy: number, r: number, age: number): string {
  const period = 29.530588853;
  const phi = (2 * Math.PI * age) / period;
  const waxing = age < period / 2;
  const tx = f1(Math.abs(Math.cos(phi)) * r);
  const crescent = Math.cos(phi) > 0;
  const limb = waxing ? 1 : 0;
  const term = waxing === crescent ? 0 : 1;
  return `M${cx} ${cy - r}A${r} ${r} 0 0 ${limb} ${cx} ${cy + r}A${tx} ${r} 0 0 ${term} ${cx} ${cy - r}Z`;
}

/** The Milky Way, the moon, the sun and its light: they drift together when the hero scrolls. */
export function SkyLights({ look, id }: { look: HeroLook; id: Ref }) {
  const { sun, moon } = look;
  const rays = look.golden > 0.2 && sun.visible > 0.3 && sun.x > 236;
  return (
    <svg className={s.layer} viewBox={VIEW_BOX} preserveAspectRatio="none">
      {look.stars.milky > 0.02 ? (
        <g opacity={+(look.stars.milky * 0.62).toFixed(3)} transform="rotate(-27 300 128)">
          <radialGradient id={id('milky')}>
            <stop offset="0" stopColor="#C9D3FF" stopOpacity="0.26" />
            <stop offset="0.5" stopColor="#A9B6F0" stopOpacity="0.1" />
            <stop offset="1" stopColor="#A9B6F0" stopOpacity="0" />
          </radialGradient>
          <ellipse cx="300" cy="128" rx="240" ry="34" fill={`url(#${id('milky')})`} />
          <ellipse cx="336" cy="126" rx="130" ry="13" fill={`url(#${id('milky')})`} opacity="0.8" />
        </g>
      ) : null}

      {moon.visible > 0.01 ? (
        <g opacity={+moon.visible.toFixed(3)}>
          <radialGradient id={id('moonGlow')}>
            <stop offset="0" stopColor="#E9EEFF" stopOpacity="0.34" />
            <stop offset="0.3" stopColor="#C9D4FF" stopOpacity="0.12" />
            <stop offset="1" stopColor="#C9D4FF" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={id('moon')} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FFFCEE" />
            <stop offset="1" stopColor="#F2E0B0" />
          </linearGradient>
          <circle cx={f1(moon.x)} cy={f1(moon.y)} r="58" fill={`url(#${id('moonGlow')})`} />
          <g transform={`rotate(-24 ${f1(moon.x)} ${f1(moon.y)})`}>
            <circle cx={f1(moon.x)} cy={f1(moon.y)} r={moon.r} fill="#9AA8D6" opacity="0.13" />
            <path d={moonPath(f1(moon.x), f1(moon.y), moon.r, moon.shown)} fill={`url(#${id('moon')})`} />
            <g fill="#D9C79A" opacity="0.32">
              <circle cx={f1(moon.x + 3)} cy={f1(moon.y - 3)} r="1.8" />
              <circle cx={f1(moon.x - 2)} cy={f1(moon.y + 4)} r="1.3" />
              <circle cx={f1(moon.x + 5)} cy={f1(moon.y + 3)} r="1" />
            </g>
          </g>
        </g>
      ) : null}

      {sun.visible > 0 ? (
        <g>
          {look.sunGlows.map((g, i) => (
            <GlowShape key={i} g={g} id={id(`sunGlow${i}`)} />
          ))}
          {rays ? <Rays look={look} id={id} /> : null}
          <radialGradient id={id('sun')} cx="0.42" cy="0.38" r="0.7">
            <stop offset="0" stopColor="#FFFEF6" />
            <stop offset="0.55" stopColor={sun.colour} />
            <stop offset="1" stopColor={sun.colour} />
          </radialGradient>
          <circle cx={f1(sun.x)} cy={f1(sun.y)} r={f1(sun.r)} fill={`url(#${id('sun')})`} />
        </g>
      ) : null}
    </svg>
  );
}

/** Soft shafts of low sunlight, fanning up and away from the title. */
function Rays({ look, id }: { look: HeroLook; id: Ref }) {
  const { x, y, colour } = look.sun;
  const k = (look.golden - 0.2) / 0.8;
  return (
    <g opacity={+(0.4 * k * look.sun.visible).toFixed(3)}>
      <clipPath id={id('rayClip')}>
        <rect x={ZONES.text.x1 + 12} y={ZONES.statusBar + 8} width="300" height={y - ZONES.statusBar - 2} />
      </clipPath>
      <radialGradient id={id('ray')} cx={x} cy={y} r="150" gradientUnits="userSpaceOnUse">
        <stop offset="0.08" stopColor={colour} stopOpacity="0.3" />
        <stop offset="1" stopColor={colour} stopOpacity="0" />
      </radialGradient>
      <g fill={`url(#${id('ray')})`} clipPath={`url(#${id('rayClip')})`}>
        {[-166, -146, -124, -100, -76].map((deg, i) => {
          const a = (deg * Math.PI) / 180;
          const w = (i % 2 ? 0.05 : 0.08) * Math.PI;
          const p = (t: number) => `${f1(x + 180 * Math.cos(t))} ${f1(y + 180 * Math.sin(t))}`;
          return <path key={deg} d={`M${f1(x)} ${f1(y)}L${p(a - w / 2)}L${p(a + w / 2)}Z`} />;
        })}
      </g>
    </g>
  );
}

// ---------------------------------------------------------------- stars

export interface Star {
  x: number;
  y: number;
  r: number;
  bright: boolean;
  sparkle: boolean;
  group: number;
}

/**
 * A fixed scatter of stars, denser high up. None under the status bar's
 * clock, island or icons, none bright behind the title, none by the avatar.
 */
export const STARS: Star[] = (() => {
  const rnd = seeded(29);
  const out: Star[] = [];
  const { avatar, text, statusBar } = ZONES;
  for (let tries = 0; out.length < 74 && tries < 4000; tries++) {
    const x = -30 + rnd() * 462;
    const y = statusBar + 4 + rnd() ** 1.25 * 140;
    const r = 0.45 + rnd() ** 2.2 * 1;
    const i = out.length;
    const bright = i % 3 === 0;
    const sparkle = i % 10 === 4;
    if (x > avatar.x0 - 6 && y < avatar.y1 + 6) continue;
    const inText = x < text.x1 + 4 && y > text.y0 - 6 && y < text.y1;
    if (inText && (bright || sparkle || r > 0.75)) continue;
    out.push({ x, y, r, bright, sparkle, group: i % 3 });
  }
  // A little faint dust in the gaps of the status bar, away from its glyphs.
  for (const [x, y] of [
    [118, 22],
    [126, 44],
    [272, 18],
    [278, 40],
    [-8, 30],
    [404, 34],
  ] as const) {
    out.push({ x, y, r: 0.5, bright: false, sparkle: false, group: out.length % 3 });
  }
  return out;
})();

export function Stars({ look, id }: { look: HeroLook; id: Ref }) {
  const { bright, faint } = look.stars;
  const { moon } = look;
  return (
    <>
      {[0, 1, 2].map((group) => (
        <div key={group} className={`${s.layer} ${s.m} ${s.twinkle}`} data-group={group}>
          <svg className={s.layer} viewBox={VIEW_BOX} preserveAspectRatio="none">
            {STARS.filter((star) => star.group === group).map((star, i) => {
              if (moon.visible > 0.1 && Math.hypot(star.x - moon.x, star.y - moon.y) < 22) return null;
              // Fainter towards the hazy horizon.
              const o = (star.bright ? bright : faint) * (1 - Math.max(0, star.y - 130) / 70);
              if (o <= 0.02) return null;
              const { x, y } = star;
              if (star.sparkle) {
                const k = 2.6 + star.r * 1.6;
                return (
                  <path
                    key={i}
                    d={`M${f1(x)} ${f1(y - k)}Q${f1(x)} ${f1(y)} ${f1(x + k)} ${f1(y)}Q${f1(x)} ${f1(y)} ${f1(x)} ${f1(y + k)}Q${f1(x)} ${f1(y)} ${f1(x - k)} ${f1(y)}Q${f1(x)} ${f1(y)} ${f1(x)} ${f1(y - k)}Z`}
                    fill="#FFF7E2"
                    opacity={+o.toFixed(3)}
                  />
                );
              }
              return <circle key={i} cx={f1(x)} cy={f1(y)} r={f1(star.r)} fill="#FFF7E6" opacity={+o.toFixed(3)} />;
            })}
          </svg>
        </div>
      ))}
      {look.stars.milky > 0.9 ? (
        <div className={`${s.piece} ${s.m} ${s.meteor}`} style={box(236, 64, 84, 40)}>
          <svg viewBox="0 0 84 40">
            <linearGradient id={id('meteor')} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
              <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.9" />
            </linearGradient>
            <path d="M82 2L4 38" stroke={`url(#${id('meteor')})`} strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- clouds

/** Puffy clouds as overlapping circles on a rounded base (in a 100 by 44 box), with sunlit tops. */
const CLOUD_SHAPES = [
  {
    base: [6, 28, 88, 16],
    puffs: [[22, 31, 12], [40, 22, 15], [60, 17, 16.5], [79, 27, 13]],
    lights: [[36, 16, 8.5], [56, 11, 9.5], [75, 21, 7]],
  },
  {
    base: [8, 29, 84, 15],
    puffs: [[25, 30, 13], [46, 22, 17.5], [70, 28, 14]],
    lights: [[41, 15, 9.5], [66, 22, 7]],
  },
  {
    base: [4, 30, 92, 14],
    puffs: [[16, 32, 9], [31, 27, 11], [48, 25, 12], [65, 26, 11.5], [82, 31, 9.5]],
    lights: [[29, 21, 6], [46, 18, 7], [63, 19, 6.5]],
  },
  {
    base: [14, 29, 70, 15],
    puffs: [[30, 30, 12], [44, 18, 14], [56, 10, 13], [66, 22, 13], [76, 31, 10]],
    lights: [[42, 12, 8], [54, 4, 8.5], [64, 16, 6.5]],
  },
] as const;

function Cloud({ c, look, id, epoch }: { c: CloudSpec; look: HeroLook; id: Ref; epoch: number }) {
  const shape = CLOUD_SHAPES[c.shape];
  const h = c.w * (c.far ? 0.32 : 0.44);
  const span = c.x1 - c.w - c.x0;
  const elapsed = (c.phase * c.dur + epoch / 1000) % c.dur;
  // Under Reduce Motion it rests where it would be now, inside the visible part of its lane.
  const rest = Math.min(0.85, Math.max(0.1, elapsed / c.dur));
  const motion = {
    '--rest-x': `${((rest * span * 100) / c.w).toFixed(1)}%`,
    '--drift-to': `${((span / c.w) * 100).toFixed(1)}%`,
    '--drift-duration': `${c.dur}s`,
    '--drift-delay': `${(-elapsed).toFixed(1)}s`,
    opacity: +(look.cloud.alpha * (c.far ? 0.7 : 1)).toFixed(3),
  } as CSSProperties;
  const [bx, by, bw, bh] = shape.base;
  return (
    <div className={s.piece} style={box(c.x0, c.y, c.w, h)}>
      <div className={`${s.layer} ${s.m} ${s.cloud}`} style={motion}>
        <svg className={s.layer} viewBox="0 0 100 44" preserveAspectRatio="none">
          <g fill={`url(#${id(c.far ? 'cloudFar' : 'cloud')})`}>
            <rect x={bx} y={by} width={bw} height={bh} rx={bh / 2} />
            {shape.puffs.map(([x, y, r], j) => (
              <circle key={j} cx={x} cy={y} r={r} />
            ))}
          </g>
          <g fill={`url(#${id('cloudLight')})`}>
            {shape.lights.map(([x, y, r], j) => (
              <circle key={j} cx={x} cy={y} r={r * 1.35} />
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
}

export function Clouds({ look, id, epoch }: { look: HeroLook; id: Ref; epoch: number }) {
  const { cloud } = look;
  const farTop = mixColour(cloud.top, look.sky[3], 0.35);
  const farBottom = mixColour(cloud.bottom, look.sky[3], 0.45);
  return (
    <>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <linearGradient id={id('cloud')} x1="0" y1="2" x2="0" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0.15" stopColor={cloud.top} />
          <stop offset="1" stopColor={cloud.bottom} />
        </linearGradient>
        <linearGradient id={id('cloudFar')} x1="0" y1="2" x2="0" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0.15" stopColor={farTop} />
          <stop offset="1" stopColor={farBottom} />
        </linearGradient>
        <radialGradient id={id('cloudLight')}>
          <stop offset="0" stopColor={cloud.top} stopOpacity="0.95" />
          <stop offset="0.6" stopColor={cloud.top} stopOpacity="0.5" />
          <stop offset="1" stopColor={cloud.top} stopOpacity="0" />
        </radialGradient>
      </svg>
      {look.clouds.map((c, i) =>
        // High clouds stay away on moonlit nights, so they never hide the moon.
        look.moon.visible > 0.3 && c.y < 100 ? null : <Cloud key={i} c={c} look={look} id={id} epoch={epoch} />,
      )}
    </>
  );
}

export function Birds() {
  const bird = (
    <svg viewBox="0 0 14 6">
      <path d="M1 4.6Q4 .6 7 4Q10 .6 13 4.6" fill="none" stroke="#2A3550" strokeOpacity="0.7" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return (
    <>
      <div className={`${s.piece} ${s.m} ${s.bird}`} style={box(262, 80, 9, 3.9)}>
        <span className={s.m}>{bird}</span>
      </div>
      <div className={`${s.piece} ${s.m} ${s.bird}`} style={{ ...box(251, 88, 7, 3), animationDelay: '-12.6s' }}>
        <span className={s.m} style={{ animationDelay: '-0.2s' }}>
          {bird}
        </span>
      </div>
    </>
  );
}
