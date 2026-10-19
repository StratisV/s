// The pieces the area scenes are drawn from, in the hero's storybook style: soft vertical
// gradients, round friendly shapes, a little shade on one side, and at night the same room
// by lamplight under a night sky. Every scene is drawn in a 168 by 140 box (6:5).
import type { CSSProperties, ReactNode } from 'react';
import { mixColour } from '../../lib/logic/sky';
import { dusk, nightSky, type Colourway } from './pick';
import s from './AreaArt.module.css';

export const W = 168;
export const H = 140;

/** Things whose colour doesn't change from room to room (lit by the evening like the rest). */
const FIXED = {
  white: '#FFFDF8',
  linen: '#EEE5D8',
  trim: '#FFFAF2',
  metal: '#C5CED8',
  metal2: '#8F9BA9',
  brass: '#E6B547',
  leaf: '#5DB262',
  leaf2: '#3F9352',
  leafLight: '#8FD375',
  pot: '#DE8A62',
  pot2: '#BD6A45',
  ink: '#2B2F3A',
  water: '#8FE0E2',
  water2: '#3FB2C4',
  duck: '#5BC26A',
  duck2: '#36975A',
  bill: '#FFA43C',
  robin: '#8C6B4B',
  robinBreast: '#EC6A3C',
  brick: '#D9876A',
  brick2: '#B9654D',
  stone: '#E7D7BD',
  stone2: '#CDB898',
  card: '#D9A86C',
  card2: '#BF8C52',
  welly: '#F2C24E',
  shadow: '#1E2A3A',
  glassTop: '#A9D8F5',
  glassLow: '#E6F5FB',
} as const;

type Key = Exclude<keyof Colourway, 'name'> | keyof typeof FIXED | 'tile' | 'hill' | 'panel' | 'haze';
export type Paint = Record<Key, string>;

/** Big, far-away surfaces: they fade most in the evening. */
const FAR = new Set<Key>(['wall', 'wall2', 'floor', 'floor2', 'ground', 'ground2', 'hill', 'tile', 'panel', 'haze']);

/** A room's paint by day, or by lamplight and moonlight (dark mode). */
export function paint(cw: Colourway, evening: boolean): Paint {
  const day: Paint = {
    ...FIXED,
    wall: cw.wall,
    wall2: cw.wall2,
    floor: cw.floor,
    floor2: cw.floor2,
    main: cw.main,
    main2: cw.main2,
    accent: cw.accent,
    accent2: cw.accent2,
    wood: cw.wood,
    wood2: cw.wood2,
    skyTop: cw.skyTop,
    skyLow: cw.skyLow,
    ground: cw.ground,
    ground2: cw.ground2,
    tile: mixColour('#FFFFFF', cw.main, 0.2),
    hill: mixColour(cw.ground, cw.skyLow, 0.45),
    panel: mixColour(cw.main, '#FFFFFF', 0.55),
    haze: mixColour(cw.skyLow, cw.main2, 0.22),
  };
  if (!evening) return day;
  const night = {} as Paint;
  for (const key of Object.keys(day) as Key[]) night[key] = dusk(day[key], FAR.has(key));
  const [top, low] = nightSky(cw);
  night.skyTop = top;
  night.skyLow = low;
  night.glassTop = '#101B4C';
  night.glassLow = '#34407A';
  night.haze = mixColour(low, '#0A1030', 0.45);
  return night;
}

/** Lamplight, the moon and the stars: the same by day and night. */
export const LIGHT = { lamp: '#FFD98F', halo: '#FFB45E', bulb: '#FFF1C9', moon: '#FFF3D1', star: '#FFF8E6', lit: '#FFD27E' };

export interface Ctx {
  p: Paint;
  evening: boolean;
  /** The other composition (a shower, a single bed). */
  alt: boolean;
  /** 0, 1 or 2: which small touches. */
  detail: number;
  /** A document-unique id for a gradient or clip path. */
  id: (name: string) => string;
}

export const url = (c: Ctx, name: string) => `url(#${c.id(name)})`;
const f1 = (v: number) => +v.toFixed(2);

/** The scene's shared gradients: lamplight (a radial glow) and a soft shadow. */
export function Defs({ c }: { c: Ctx }) {
  return (
    <defs>
      <radialGradient id={c.id('glow')}>
        <stop offset="0" stopColor={LIGHT.lamp} stopOpacity="0.85" />
        <stop offset="0.4" stopColor={LIGHT.halo} stopOpacity="0.32" />
        <stop offset="1" stopColor={LIGHT.halo} stopOpacity="0" />
      </radialGradient>
      <radialGradient id={c.id('moonlight')}>
        <stop offset="0" stopColor={LIGHT.moon} stopOpacity="0.3" />
        <stop offset="1" stopColor={LIGHT.moon} stopOpacity="0" />
      </radialGradient>
      <radialGradient id={c.id('shade')}>
        <stop offset="0" stopColor={c.p.shadow} stopOpacity="0.22" />
        <stop offset="1" stopColor={c.p.shadow} stopOpacity="0" />
      </radialGradient>
      <linearGradient id={c.id('glass')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={c.p.glassTop} />
        <stop offset="1" stopColor={c.p.glassLow} />
      </linearGradient>
    </defs>
  );
}

/** Lamplight in the evening (nothing by day). `k` is how strong. */
export function Glow({ c, x, y, r, k = 1 }: { c: Ctx; x: number; y: number; r: number; k?: number }) {
  return c.evening ? <circle cx={x} cy={y} r={r} fill={url(c, 'glow')} opacity={k} /> : null;
}

/** A soft shadow on the floor under something. */
export function Shadow({ c, x, y, rx, ry = 4 }: { c: Ctx; x: number; y: number; rx: number; ry?: number }) {
  return <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={url(c, 'shade')} />;
}

/** A vertical gradient. */
export function VGrad({ id, stops }: { id: string; stops: readonly (readonly [number, string])[] }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      {stops.map(([o, col], i) => (
        <stop key={i} offset={o} stopColor={col} />
      ))}
    </linearGradient>
  );
}

/** A room's back wall, skirting board and floorboards; the floor starts at `floor`. */
export function Room({ c, floor = 100 }: { c: Ctx; floor?: number }) {
  const { p } = c;
  return (
    <g>
      <defs>
        <VGrad id={c.id('wall')} stops={[[0, p.wall], [1, p.wall2]]} />
        <VGrad id={c.id('floor')} stops={[[0, p.floor2], [0.18, p.floor], [1, p.floor2]]} />
      </defs>
      <rect width={W} height={floor} fill={url(c, 'wall')} />
      <rect y={floor} width={W} height={H - floor} fill={url(c, 'floor')} />
      <path d={`M0 ${floor + 12.5}H${W}M0 ${floor + 26.5}H${W}`} stroke={p.floor2} strokeWidth="1" opacity="0.7" />
      <path d={`M38 ${floor}v12.5M112 ${floor}v12.5M74 ${floor + 12.5}v14M148 ${floor + 12.5}v14M20 ${floor + 26.5}v14M96 ${floor + 26.5}v14`} stroke={p.floor2} strokeWidth="0.8" opacity="0.55" />
      <rect y={floor - 5} width={W} height="5" fill={p.trim} />
      <rect y={floor} width={W} height="1.6" fill={p.shadow} opacity="0.08" />
    </g>
  );
}

/** A crescent moon at cx, cy. */
export function crescent(cx: number, cy: number, r: number): string {
  // The circle less a second one up and to the right.
  const ox = cx + r * 0.52;
  const oy = cy - r * 0.32;
  const r2 = r * 0.86;
  const dx = ox - cx;
  const dy = oy - cy;
  const d = Math.hypot(dx, dy);
  const a = (r * r - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(r * r - a * a);
  const mx = cx + (a * dx) / d;
  const my = cy + (a * dy) / d;
  const p1 = `${f1(mx + (h * dy) / d)} ${f1(my - (h * dx) / d)}`;
  const p2 = `${f1(mx - (h * dy) / d)} ${f1(my + (h * dx) / d)}`;
  return `M${p1}A${r} ${r} 0 1 0 ${p2}A${f1(r2)} ${f1(r2)} 0 0 1 ${p1}Z`;
}

/** The moon (soft halo at night; a pale daytime moon otherwise). */
export function Moon({ c, x, y, r }: { c: Ctx; x: number; y: number; r: number }) {
  return (
    <g>
      {c.evening ? <circle cx={x} cy={y} r={r * 2.6} fill={url(c, 'moonlight')} /> : null}
      <path d={crescent(x, y, r)} fill={c.evening ? LIGHT.moon : '#FFFFFF'} opacity={c.evening ? 1 : 0.85} />
    </g>
  );
}

/** Stars: x, y, size. Every third one twinkles. */
export function Stars({ pts }: { pts: readonly (readonly [number, number, number])[] }) {
  return (
    <g fill={LIGHT.star}>
      {pts.map(([x, y, r], i) =>
        r > 1 ? (
          <path
            key={i}
            className={i % 3 === 0 ? s.twinkle : undefined}
            style={{ animationDelay: `${-i * 0.7}s` }}
            d={`M${x} ${f1(y - r * 1.6)}L${f1(x + r * 0.4)} ${f1(y - r * 0.4)}L${f1(x + r * 1.6)} ${y}L${f1(x + r * 0.4)} ${f1(y + r * 0.4)}L${x} ${f1(y + r * 1.6)}L${f1(x - r * 0.4)} ${f1(y + r * 0.4)}L${f1(x - r * 1.6)} ${y}L${f1(x - r * 0.4)} ${f1(y - r * 0.4)}Z`}
          />
        ) : (
          <circle key={i} cx={x} cy={y} r={r} opacity="0.85" />
        ),
      )}
    </g>
  );
}

/** A soft white cloud, `w` wide, its flat base at x, y. */
export function Cloud({ x, y, w, o = 0.9 }: { x: number; y: number; w: number; o?: number }) {
  const k = w / 30;
  return (
    <g fill="#FFFFFF" opacity={o}>
      <rect x={x} y={f1(y - 6 * k)} width={f1(30 * k)} height={f1(6 * k)} rx={f1(3 * k)} />
      <circle cx={f1(x + 9 * k)} cy={f1(y - 6 * k)} r={f1(5.5 * k)} />
      <circle cx={f1(x + 17 * k)} cy={f1(y - 8 * k)} r={f1(7.5 * k)} />
      <circle cx={f1(x + 24.5 * k)} cy={f1(y - 5 * k)} r={f1(5 * k)} />
    </g>
  );
}

/** London rooftops and chimney pots, seen at the bottom of a window. */
function Rooftops({ c, x, y, w }: { c: Ctx; x: number; y: number; w: number }) {
  const col = c.evening ? '#1B2556' : mixColour(c.p.glassLow, '#7F9BB5', 0.42);
  const k = w / 40;
  const d = `M${x} ${y}V${f1(y - 7 * k)}H${f1(x + 7 * k)}V${f1(y - 10 * k)}h${f1(2 * k)}v-${f1(2.4 * k)}h${f1(1.4 * k)}v${f1(2.4 * k)}h${f1(1.2 * k)}v-${f1(2.4 * k)}h${f1(1.4 * k)}v${f1(2.4 * k)}h${f1(2 * k)}V${f1(y - 6 * k)}H${f1(x + 22 * k)}L${f1(x + 27 * k)} ${f1(y - 11 * k)}L${f1(x + 32 * k)} ${f1(y - 6 * k)}H${f1(x + 34 * k)}V${f1(y - 9 * k)}h${f1(1.6 * k)}v-${f1(2 * k)}h${f1(1.4 * k)}v${f1(2 * k)}h${f1(1.6 * k)}V${f1(y - 5 * k)}H${f1(x + w)}V${y}Z`;
  return (
    <g>
      <path d={d} fill={col} />
      {c.evening ? (
        <g fill={LIGHT.lit}>
          <rect x={f1(x + 3 * k)} y={f1(y - 4.6 * k)} width={f1(1.6 * k)} height={f1(1.8 * k)} opacity="0.9" />
          <rect x={f1(x + 25 * k)} y={f1(y - 4 * k)} width={f1(1.6 * k)} height={f1(1.8 * k)} opacity="0.75" />
        </g>
      ) : null}
    </g>
  );
}

/**
 * A window onto the sky: a cloud by day; the moon and stars at night (the moon by day too
 * when `moon` is set, as in a bedroom). Curtains are optional; the bottom shows London's roofs.
 */
export function Window({
  c,
  x,
  y,
  w,
  h,
  moon = false,
  curtains,
  roofs = true,
  frosted = false,
}: {
  c: Ctx;
  x: number;
  y: number;
  w: number;
  h: number;
  moon?: boolean;
  curtains?: string;
  roofs?: boolean;
  frosted?: boolean;
}) {
  const { p } = c;
  const clip = c.id(`win${x}-${y}`);
  return (
    <g>
      <clipPath id={clip}>
        <rect x={x} y={y} width={w} height={h} rx="1.5" />
      </clipPath>
      <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx="3.5" fill={p.trim} />
      <g clipPath={`url(#${clip})`}>
        <rect x={x} y={y} width={w} height={h} fill={url(c, 'glass')} />
        {c.evening ? (
          <Stars
            pts={[
              [x + w * 0.18, y + h * 0.22, 1.3],
              [x + w * 0.42, y + h * 0.12, 0.7],
              [x + w * 0.3, y + h * 0.48, 0.6],
              [x + w * 0.55, y + h * 0.36, 1.1],
            ]}
          />
        ) : (
          <Cloud x={x + w * 0.08} y={y + h * 0.42} w={w * 0.46} o={0.8} />
        )}
        {moon || c.evening ? <Moon c={c} x={x + w * 0.74} y={y + h * 0.27} r={Math.min(w, h) * 0.13} /> : null}
        {roofs ? <Rooftops c={c} x={x} y={y + h} w={w} /> : null}
        {frosted ? <rect x={x} y={y} width={w} height={h} fill="#FFFFFF" opacity={c.evening ? 0.12 : 0.42} /> : null}
        {/* A glint on the glass by day. */}
        {c.evening ? null : (
          <path d={`M${f1(x + w * 0.62)} ${y}l-${f1(w * 0.3)} ${h}h${f1(w * 0.1)}l${f1(w * 0.3)}-${h}z`} fill="#FFFFFF" opacity="0.22" />
        )}
      </g>
      <rect x={x + w / 2 - 1} y={y} width="2" height={h} fill={p.trim} />
      <rect x={x} y={y + h * 0.48 - 1} width={w} height="2" fill={p.trim} />
      <rect x={x - 5} y={y + h + 2} width={w + 10} height="3.2" rx="1.4" fill={p.trim} />
      <rect x={x - 5} y={y + h + 4.6} width={w + 10} height="1.2" fill={p.shadow} opacity="0.08" />
      {curtains ? (
        <g fill={curtains}>
          <path d={`M${x - 6} ${y - 5}h${f1(w * 0.26)}c-1 ${f1(h * 0.3)}-${f1(w * 0.1)} ${f1(h * 0.55)}-${f1(w * 0.02)} ${f1(h * 0.62)}c-${f1(w * 0.1)} ${f1(h * 0.08)} 0 ${f1(h * 0.3)} 2 ${f1(h * 0.5)}H${x - 6}Z`} />
          <path d={`M${x + w + 6} ${y - 5}h-${f1(w * 0.26)}c1 ${f1(h * 0.3)} ${f1(w * 0.1)} ${f1(h * 0.55)} ${f1(w * 0.02)} ${f1(h * 0.62)}c${f1(w * 0.1)} ${f1(h * 0.08)} 0 ${f1(h * 0.3)}-2 ${f1(h * 0.5)}H${x + w + 6}Z`} />
          <rect x={x - 8} y={y - 7} width={w + 16} height="2.4" rx="1.2" fill={p.wood2} />
        </g>
      ) : null}
    </g>
  );
}

/** A potted plant standing at x (its pot's base at y). Three kinds: leafy, a snake plant, a monstera. */
export function Plant({ c, x, y, k = 1, kind = 0 }: { c: Ctx; x: number; y: number; k?: number; kind?: number }) {
  const { p } = c;
  return (
    <g transform={`translate(${x} ${y}) scale(${k})`}>
      <ellipse cx="0" cy="0" rx="9" ry="2" fill={p.shadow} opacity="0.12" />
      {kind === 1 ? (
        <g>
          <path d="M-4 -12C-8 -24-7 -34-5 -42C-2 -34 0 -24 -0.5 -12Z" fill={p.leaf2} />
          <path d="M-1 -12C-2 -26 0 -38 3 -46C5 -36 4 -24 2.5 -12Z" fill={p.leaf} />
          <path d="M2 -12C3 -22 6 -30 9 -34C10 -26 8 -18 5.5 -12Z" fill={p.leaf2} />
          <path d="M-6 -12C-10 -18-12 -24-12 -28C-8 -24-5 -18 -3 -12Z" fill={p.leaf} />
          <path d="M2 -16C2.4 -26 2.8 -34 3 -42M-3.6 -16C-5 -24-5.4 -32-5 -38" stroke={p.leafLight} strokeWidth="0.8" fill="none" opacity="0.7" />
        </g>
      ) : kind === 2 ? (
        <g>
          <path d="M0 -12C-1 -20-4 -26-9 -30M0 -12C1 -22 3 -30 8 -34M0 -12C0 -22 0 -32 -1 -40" stroke={p.leaf2} strokeWidth="1.2" fill="none" />
          <path d="M-9 -30c-7 1-11 -4-10 -9 3 -5 10 -5 13 -1 2 4 0 9 -3 10z" fill={p.leaf} />
          <path d="M8 -34c7 1 11 -4 10 -9-3 -5-10 -5-13 -1-2 4 0 9 3 10z" fill={p.leaf2} />
          <path d="M-1 -40c-6 -1-9 -7-6 -11 4 -4 10 -3 12 1 2 5-1 9-6 10z" fill={p.leafLight} />
          <path d="M-12 -36l4 2M12 -40l-4 2M-3 -46l3 3" stroke={p.wall} strokeWidth="1" strokeLinecap="round" opacity="0.8" />
        </g>
      ) : (
        <g>
          {[-56, -28, 0, 28, 56].map((a, i) => (
            <ellipse key={a} cx="0" cy="-25" rx="4.6" ry="10" transform={`rotate(${a} 0 -13)`} fill={i % 2 ? p.leaf2 : p.leaf} />
          ))}
          <ellipse cx="0" cy="-27" rx="3.6" ry="8" fill={p.leafLight} opacity="0.75" />
        </g>
      )}
      <path d="M-7.5 -12H7.5L5.8 0H-5.8Z" fill={p.pot} />
      <path d="M2.6 -12H7.5L5.8 0H2Z" fill={p.pot2} opacity="0.55" />
      <rect x="-8.6" y="-14.4" width="17.2" height="3.6" rx="1.3" fill={p.pot} />
      <rect x="-8.6" y="-11.6" width="17.2" height="0.9" fill={p.pot2} opacity="0.6" />
    </g>
  );
}

/** A framed picture: little hills under a sun (0), shapes (1) or a leaf (2). */
export function Picture({ c, x, y, w, h, art = 0 }: { c: Ctx; x: number; y: number; w: number; h: number; art?: number }) {
  const { p } = c;
  const clip = c.id(`pic${x}-${y}`);
  return (
    <g>
      <rect x={x - 2.5} y={y - 2.5} width={w + 5} height={h + 5} rx="1.6" fill={p.wood2} />
      <rect x={x} y={y} width={w} height={h} fill={p.white} />
      <clipPath id={clip}>
        <rect x={x + 2} y={y + 2} width={w - 4} height={h - 4} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect x={x} y={y} width={w} height={h} fill={art === 1 ? p.accent2 : p.skyLow} />
        {art === 0 ? (
          <g>
            <circle cx={x + w * 0.7} cy={y + h * 0.36} r={h * 0.14} fill={p.accent} />
            <path d={`M${x} ${y + h * 0.78}Q${x + w * 0.3} ${y + h * 0.42} ${x + w * 0.62} ${y + h * 0.72}T${x + w} ${y + h * 0.6}V${y + h}H${x}Z`} fill={p.main} />
            <path d={`M${x} ${y + h * 0.9}Q${x + w * 0.5} ${y + h * 0.64} ${x + w} ${y + h * 0.88}V${y + h}H${x}Z`} fill={p.main2} />
          </g>
        ) : art === 1 ? (
          <g>
            <circle cx={x + w * 0.36} cy={y + h * 0.42} r={h * 0.24} fill={p.accent} />
            <path d={`M${x + w * 0.46} ${y + h}V${y + h * 0.62}a${w * 0.2} ${w * 0.2} 0 0 1 ${w * 0.4} 0V${y + h}Z`} fill={p.main} />
          </g>
        ) : (
          <g>
            <path d={`M${x + w * 0.5} ${y + h * 0.92}C${x + w * 0.12} ${y + h * 0.6} ${x + w * 0.3} ${y + h * 0.2} ${x + w * 0.5} ${y + h * 0.1}C${x + w * 0.7} ${y + h * 0.2} ${x + w * 0.88} ${y + h * 0.6} ${x + w * 0.5} ${y + h * 0.92}Z`} fill={p.leaf} />
            <path d={`M${x + w * 0.5} ${y + h * 0.9}V${y + h * 0.16}`} stroke={p.leafLight} strokeWidth="0.8" />
          </g>
        )}
      </g>
    </g>
  );
}

/** A floor lamp, its base at x, y, the shade `h` up. Lit in the evening. */
export function FloorLamp({ c, x, y, h = 62, shade }: { c: Ctx; x: number; y: number; h?: number; shade?: string }) {
  const { p } = c;
  const top = y - h;
  return (
    <g>
      <Glow c={c} x={x} y={top + 10} r={44} />
      {c.evening ? <path d={`M${x - 9} ${top + 13}L${x - 24} ${y}H${x + 24}L${x + 9} ${top + 13}Z`} fill={LIGHT.lamp} opacity="0.12" /> : null}
      <ellipse cx={x} cy={y} rx="9" ry="2" fill={p.shadow} opacity="0.14" />
      <rect x={x - 1} y={top + 10} width="2" height={h - 10} fill={p.ink} opacity="0.8" />
      <ellipse cx={x} cy={y - 1} rx="7" ry="2" fill={p.ink} opacity="0.85" />
      <path d={`M${x - 7} ${top}H${x + 7}L${x + 11} ${top + 14}H${x - 11}Z`} fill={c.evening ? LIGHT.lamp : (shade ?? p.accent2)} />
      <path d={`M${x + 3} ${top}H${x + 7}L${x + 11} ${top + 14}H${x + 6}Z`} fill={c.evening ? LIGHT.halo : p.shadow} opacity={c.evening ? 0.35 : 0.1} />
    </g>
  );
}

/** A table lamp sitting on a surface at x, y. */
export function TableLamp({ c, x, y, shade }: { c: Ctx; x: number; y: number; shade?: string }) {
  const { p } = c;
  return (
    <g>
      <Glow c={c} x={x} y={y - 14} r={30} />
      <path d={`M${x - 4} ${y}C${x - 5} ${y - 5} ${x - 3} ${y - 8} ${x} ${y - 9}C${x + 3} ${y - 8} ${x + 5} ${y - 5} ${x + 4} ${y}Z`} fill={p.main2} />
      <path d={`M${x - 5} ${y - 21}H${x + 5}L${x + 8} ${y - 10}H${x - 8}Z`} fill={c.evening ? LIGHT.lamp : (shade ?? p.white)} />
      <path d={`M${x + 2} ${y - 21}H${x + 5}L${x + 8} ${y - 10}H${x + 4}Z`} fill={c.evening ? LIGHT.halo : p.shadow} opacity={c.evening ? 0.35 : 0.1} />
    </g>
  );
}

/** A pendant light hanging from the ceiling at x, its shade at y. */
export function Pendant({ c, x, y, colour }: { c: Ctx; x: number; y: number; colour?: string }) {
  const { p } = c;
  return (
    <g>
      <Glow c={c} x={x} y={y + 10} r={52} />
      {c.evening ? <path d={`M${x - 10} ${y + 6}L${x - 34} ${y + 62}H${x + 34}L${x + 10} ${y + 6}Z`} fill={LIGHT.lamp} opacity="0.1" /> : null}
      <path d={`M${x} 0V${y - 6}`} stroke={p.ink} strokeWidth="0.9" opacity="0.7" />
      <path d={`M${x - 11} ${y + 6}C${x - 11} ${y - 2} ${x - 6} ${y - 7} ${x} ${y - 7}C${x + 6} ${y - 7} ${x + 11} ${y - 2} ${x + 11} ${y + 6}Z`} fill={colour ?? p.accent} />
      <path d={`M${x + 3} ${y - 6.4}C${x + 8} ${y - 5} ${x + 11} ${y - 1} ${x + 11} ${y + 6}H${x + 6}C${x + 6} ${y} ${x + 5} ${y - 3} ${x + 3} ${y - 6.4}Z`} fill={p.shadow} opacity="0.12" />
      <ellipse cx={x} cy={y + 6} rx="5" ry="1.8" fill={c.evening ? LIGHT.bulb : p.white} />
    </g>
  );
}

/** Wisps of steam rising from x, y. */
export function Steam({ c, x, y, k = 1 }: { c: Ctx; x: number; y: number; k?: number }) {
  const colour = c.evening ? '#E8EDFF' : '#FFFFFF';
  return (
    <g transform={`translate(${x} ${y}) scale(${k})`} fill="none" stroke={colour} strokeWidth="1.7" strokeLinecap="round" opacity={c.evening ? 0.6 : 0.95}>
      {[-5, 0, 5].map((dx, i) => (
        <path key={dx} className={s.steam} style={{ animationDelay: `${-i * 1.2}s` }} d={`M${dx} 0c-2.6-2.6 2.6-4.6 0-7.4s2.6-4.8 0-7.6`} />
      ))}
    </g>
  );
}

/** The household's green rubber duck, sitting (bottom of its body at 0, 0), facing right. */
export function Duck({ c, x, y, k = 1, bob = false }: { c: Ctx; x: number; y: number; k?: number; bob?: boolean }) {
  const { p } = c;
  return (
    <g transform={`translate(${x} ${y}) scale(${k})`}>
      <g className={bob ? s.bob : undefined}>
        <path d="M-9 -4.6C-9.6 -7.4-10.6 -9.4-11.6 -10.6C-9 -10.4-7 -9.2-6 -7.6C-3 -9 3 -9.4 7 -7.6 9.4 -6.4 10 -3.4 9 -1.4 7.6 0.8 3 1 -1 1-6 1-9 -0.6-9 -4.6Z" fill={p.duck} />
        <path d="M-8.6 -2.6C-6 0 3 0.4 9 -1.6 8 0.6 3 1 -1 1-6 1-8.4 0-8.6 -2.6Z" fill={p.duck2} opacity="0.6" />
        <path d="M-5 -5.2C-2 -6.6 2.4 -6.4 4 -4.6 3 -2.4-1.4 -2-5 -5.2Z" fill={p.duck2} />
        <circle cx="4.4" cy="-11.6" r="5" fill={p.duck} />
        <ellipse cx="2.6" cy="-13.8" rx="1.8" ry="1" fill="#FFFFFF" opacity="0.3" transform="rotate(-30 2.6 -13.8)" />
        <path d="M8.6 -12.2C11.2 -12.8 13.4 -12 13.4 -10.8 13.2 -9.6 10.8 -9.2 8.8 -9.8Z" fill={p.bill} />
        <circle cx="6" cy="-12.6" r="1.2" fill={p.ink} />
        <circle cx="6.4" cy="-13" r="0.4" fill="#FFFFFF" />
      </g>
    </g>
  );
}

/** A robin, facing left, standing at x, y. */
export function Robin({ c, x, y, k = 1 }: { c: Ctx; x: number; y: number; k?: number }) {
  const { p } = c;
  return (
    <g transform={`translate(${x} ${y}) scale(${k})`}>
      <g className={s.bob}>
        <path d="M-1.4 -2.4L-2 0M1.2 -2.4L1.6 0" stroke={p.ink} strokeWidth="0.7" strokeLinecap="round" />
        <path d="M3 -6.6L9.4 -9.6L8.4 -4.8Z" fill={p.robin} />
        <ellipse cx="0.4" cy="-6.4" rx="5.4" ry="4.4" fill={p.robin} />
        <circle cx="-3" cy="-10.4" r="3.4" fill={p.robin} />
        <path d="M-6.2 -10C-7.2 -6.4-5 -2.6-1 -2.2-3 -4.4-3.2 -7.6-1.8 -10.2-3.2 -11.2-5 -11.2-6.2 -10Z" fill={p.robinBreast} />
        <path d="M0 -7.6C2.4 -8.8 5 -8 5.8 -6.2 4 -4.6 1.6 -4.8 0 -7.6Z" fill={p.shadow} opacity="0.2" />
        <path d="M-6.2 -11.2L-8.8 -10.6L-6.2 -9.8Z" fill={p.ink} />
        <circle cx="-4" cy="-11.2" r="0.7" fill={p.ink} />
      </g>
    </g>
  );
}

/** A cat curled up asleep (a loaf), sitting on y with its middle at x, its head to the right. */
export function Cat({ c, x, y, k = 1, coat }: { c: Ctx; x: number; y: number; k?: number; coat: readonly [string, string] }) {
  const { p } = c;
  const [fur, dark] = c.evening ? [dusk(coat[0]), dusk(coat[1])] : coat;
  return (
    <g transform={`translate(${x} ${y}) scale(${k})`}>
      <ellipse cx="0" cy="0" rx="15" ry="2" fill={p.shadow} opacity="0.14" />
      <path d="M-14 0C-15.4 -8-9 -13 -1 -13C7 -13 13 -10 13.4 -4C13.6 -1.6 12.4 0 10 0Z" fill={fur} />
      <path d="M-8 -11.4C-6 -8-6.4 -5-8.6 -3M-2 -12.6C0 -9-0.4 -6-2.6 -4" stroke={dark} strokeWidth="1.6" strokeLinecap="round" fill="none" opacity="0.6" />
      <path d="M-13.4 -1.4C-15 2.6-4 3 6 1.4" stroke={dark} strokeWidth="3.2" strokeLinecap="round" fill="none" />
      <path d="M5.4 -15.4L6.6 -21.6L10.4 -17.2Z" fill={fur} />
      <path d="M12.6 -17.4L16.8 -21L16.2 -14.8Z" fill={fur} />
      <path d="M6.6 -19.6L7.2 -17.6L9 -17.8Z" fill="#F4A6A0" opacity="0.8" />
      <ellipse cx="11" cy="-12.2" rx="7" ry="6.2" fill={fur} />
      <path d="M7.6 -12.4q1.2 1 2.4 0M12.4 -12.4q1.2 1 2.4 0" stroke={p.ink} strokeWidth="0.75" strokeLinecap="round" fill="none" />
      <path d="M10.6 -10.2h1.4l-0.7 0.8z" fill="#E98A8A" />
      <ellipse cx="7.8" cy="-10" rx="1.4" ry="0.8" fill="#FF9B95" opacity="0.45" />
      <ellipse cx="14.8" cy="-10" rx="1.4" ry="0.8" fill="#FF9B95" opacity="0.45" />
    </g>
  );
}

/** Coats for the cat: ginger, grey tabby, or black with a white chest. */
export const CAT_COATS: readonly (readonly [string, string])[] = [
  ['#F2A75E', '#D07F38'],
  ['#A9A6B4', '#77748A'],
  ['#4A4A55', '#2C2C35'],
];

/** The sky of an outdoor scene down to `low` (y), with the sun and clouds, or the moon and stars. */
export function Sky({ c, low = 96, sunX = 132 }: { c: Ctx; low?: number; sunX?: number }) {
  const { p } = c;
  return (
    <g>
      <defs>
        <VGrad id={c.id('sky')} stops={[[0, p.skyTop], [1, p.skyLow]]} />
        <radialGradient id={c.id('sun')}>
          <stop offset="0" stopColor="#FFF4C9" stopOpacity="0.9" />
          <stop offset="1" stopColor="#FFF4C9" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={low} fill={url(c, 'sky')} />
      {c.evening ? (
        <g>
          <Stars
            pts={[
              [18, 14, 1.4],
              [40, 30, 0.7],
              [62, 10, 0.8],
              [86, 24, 1.2],
              [104, 8, 0.7],
              [150, 34, 0.8],
              [28, 44, 0.6],
              [120, 40, 0.6],
              [72, 42, 0.6],
            ]}
          />
          <Moon c={c} x={sunX} y={22} r={8} />
        </g>
      ) : (
        <g>
          <circle cx={sunX} cy="22" r="24" fill={url(c, 'sun')} />
          <circle cx={sunX} cy="22" r="9" fill="#FFE58A" />
          <Cloud x={14} y={30} w={34} />
          <Cloud x={84} y={18} w={24} o={0.75} />
        </g>
      )}
    </g>
  );
}

/** A soft row of far hills along y. */
export function Hills({ c, y }: { c: Ctx; y: number }) {
  return (
    <path
      d={`M0 ${y}C20 ${y - 10} 38 ${y - 12} 58 ${y - 5}S96 ${y - 14} 118 ${y - 8}S152 ${y - 6} 168 ${y - 12}V${y + 20}H0Z`}
      fill={c.p.hill}
    />
  );
}

/** A picket fence from x0 to x1, its pickets' tops at y and feet at y + h. */
export function Fence({ c, x0, x1, y, h, colour }: { c: Ctx; x0: number; x1: number; y: number; h: number; colour?: string }) {
  const col = colour ?? c.p.trim;
  const pickets: ReactNode[] = [];
  for (let x = x0; x < x1; x += 9) {
    pickets.push(<path key={x} d={`M${x} ${y + h}V${y + 3}L${x + 3} ${y}L${x + 6} ${y + 3}V${y + h}Z`} />);
  }
  return (
    <g>
      <rect x={x0 - 2} y={y + h * 0.28} width={x1 - x0 + 4} height="3" fill={mixColour(col, c.p.shadow, 0.18)} />
      <rect x={x0 - 2} y={y + h * 0.7} width={x1 - x0 + 4} height="3" fill={mixColour(col, c.p.shadow, 0.18)} />
      <g fill={col}>{pickets}</g>
      <rect x={x0 - 2} y={y + h - 2} width={x1 - x0 + 4} height="2" fill={c.p.shadow} opacity="0.1" />
    </g>
  );
}

/** A bush with flowers along y, from x0 to x1. */
export function Border({ c, x0, x1, y, flowers }: { c: Ctx; x0: number; x1: number; y: number; flowers: readonly string[] }) {
  const { p } = c;
  const blobs: ReactNode[] = [];
  const dots: ReactNode[] = [];
  let i = 0;
  for (let x = x0; x <= x1; x += 11, i++) {
    blobs.push(<circle key={x} cx={x} cy={y - (i % 2 ? 5 : 3)} r={i % 2 ? 8 : 7} fill={i % 3 ? p.leaf : p.leaf2} />);
    dots.push(<circle key={`a${x}`} cx={x - 3} cy={y - 8 - (i % 2) * 2} r="1.9" fill={flowers[i % flowers.length]} />);
    dots.push(<circle key={`b${x}`} cx={x + 3} cy={y - 4 - (i % 3)} r="1.7" fill={flowers[(i + 2) % flowers.length]} />);
  }
  return (
    <g>
      {blobs}
      <g opacity={c.evening ? 0.85 : 1}>{dots}</g>
    </g>
  );
}

/** Lights strung from x0 to x1, sagging to `sag` below y. Warm and glowing in the evening. */
export function FairyLights({ c, x0, x1, y, sag, n = 9, swags = 2 }: { c: Ctx; x0: number; x1: number; y: number; sag: number; n?: number; swags?: number }) {
  const span = (x1 - x0) / swags;
  let d = `M${x0} ${y}`;
  const bulbs: ReactNode[] = [];
  const colours = [LIGHT.bulb, '#FFC48A', '#FFE7AE', '#FFB2A6'];
  for (let sIdx = 0; sIdx < swags; sIdx++) {
    const a = x0 + sIdx * span;
    d += `Q${f1(a + span / 2)} ${f1(y + sag * 2)} ${f1(a + span)} ${y}`;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const bx = a + span * t;
      const by = y + sag * 2 * 2 * t * (1 - t);
      const col = colours[(i + sIdx) % colours.length];
      bulbs.push(
        <g key={`${sIdx}-${i}`} className={(i + sIdx) % 3 === 0 ? s.twinkle : undefined} style={{ animationDelay: `${-(i + sIdx * 3) * 0.6}s` }}>
          {c.evening ? <circle cx={f1(bx)} cy={f1(by + 2)} r="4.4" fill={col} opacity="0.32" /> : null}
          <ellipse cx={f1(bx)} cy={f1(by + 2.2)} rx="1.5" ry="2" fill={c.evening ? col : mixColour(col, '#FFFFFF', 0.4)} stroke={c.evening ? undefined : c.p.shadow} strokeOpacity="0.14" strokeWidth="0.5" />
        </g>,
      );
    }
  }
  return (
    <g>
      <path d={d} fill="none" stroke={c.p.ink} strokeWidth="0.6" opacity="0.55" />
      {bulbs}
    </g>
  );
}

/** Bunting from x0 to x1, flags hanging from a sagging string at y. */
export function Bunting({ c, x0, x1, y, colours }: { c: Ctx; x0: number; x1: number; y: number; colours: readonly string[] }) {
  const flags: ReactNode[] = [];
  const n = 10;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + (x1 - x0) * t;
    const yy = y + 8 * 4 * t * (1 - t);
    flags.push(<path key={i} d={`M${f1(x - 5)} ${f1(yy - 0.6)}L${f1(x + 5)} ${f1(yy + 0.6)}L${f1(x)} ${f1(yy + 10)}Z`} fill={colours[i % colours.length]} />);
  }
  return (
    <g>
      <path d={`M${x0} ${y}Q${(x0 + x1) / 2} ${y + 16} ${x1} ${y}`} fill="none" stroke={c.p.ink} strokeWidth="0.6" opacity="0.4" />
      {flags}
    </g>
  );
}

/** Style for a staggered animation. */
export const delay = (seconds: number): CSSProperties => ({ animationDelay: `${seconds}s` });
