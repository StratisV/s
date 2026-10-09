// The things that move: the green duck afloat on the pond (with its ripples),
// the brown hedgehog by the fence, wisps of chimney smoke, fireflies and the
// red light on top of the Shard.
import type { CSSProperties } from 'react';
import { mixColour } from '../../lib/logic/sky';
import s from '../Hero.module.css';
import { box, type Ref } from './frame';
import { rgba, type HeroLook, type Paint } from './look';

/** Spiky edge round part of an ellipse: soft spines that sweep back (towards the tail). */
function spines(cx: number, cy: number, rx: number, ry: number, from: number, to: number, n: number, out: number): string {
  const at = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(cx + rx * r * Math.cos(a)).toFixed(2)} ${(cy + ry * r * Math.sin(a)).toFixed(2)}`;
  };
  let d = `M${at(from, 1)}`;
  for (let i = 0; i < n; i++) {
    const a0 = from + ((to - from) * i) / n;
    const a1 = from + ((to - from) * (i + 1)) / n;
    d += `L${at(a0 + (a1 - a0) * 0.86, out)}L${at(a1, 1)}`;
  }
  return d;
}
const HOG_COAT = `${spines(33, 26.5, 21, 14.5, 196, 382, 15, 1.24)}Q45 40 31 39.5 21 39 18 34Z`;
const HOG_COAT_INNER = `${spines(34.5, 27.5, 15.5, 10, 205, 372, 12, 1.26)}Q42 37 31.5 36.5 24 36 22.5 31Z`;

/** The duck sits on the water: the box ends at the waterline, so its body is cut there. */
const DUCK = { x: 57, w: 34, water: 306 } as const;
// The duck is drawn in a 40 by 36 box (y from -4); the waterline is at y 27.
const DUCK_K = DUCK.w / 40;

/** The duck: plump, clearly green, facing right (towards the house). */
function DuckArt({ p, id }: { p: Paint; id: Ref }) {
  return (
    <svg viewBox="0 -4 40 36" className={`${s.m} ${s.duck}`}>
      <radialGradient id={id('duckBody')} cx="19" cy="17" r="20" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor={p.duckLight} />
        <stop offset="0.45" stopColor={p.duck} />
        <stop offset="1" stopColor={p.duckShade} />
      </radialGradient>
      <radialGradient id={id('duckHead')} cx="0.38" cy="0.3" r="0.8">
        <stop offset="0" stopColor={p.duckSheen} />
        <stop offset="0.5" stopColor={p.duckHead} />
        <stop offset="1" stopColor={p.duckShade} />
      </radialGradient>
      {/* Body: round and plump, with a little upturned tail. */}
      <path
        d="M3 11.4C4.6 14 7.8 15.4 11.6 15.4 15.4 15.4 19 14.2 23 14.8 30.6 16 35.8 19.8 35.8 25 35.8 29.8 32.4 32 27.6 32H10.4C5.6 32 3 29.6 3 25.2 3 22.2 3.8 20.2 5 18.6 3.4 16.6 2.6 14 3 11.4Z"
        fill={`url(#${id('duckBody')})`}
      />
      <path d="M3 11.4C4.6 14 7.8 15.4 11.6 15.4c3.8 0 7.4-1.2 11.4-.6" fill="none" stroke={p.duckLight} strokeWidth="1" strokeLinecap="round" opacity=".85" />
      <path d="M4.6 26.4C9 27.8 22 28 34.8 26.2 34.2 28.8 31.6 30.2 28 30.2H10C7.4 30.2 5.4 28.8 4.6 26.4Z" fill={p.duckShade} opacity=".42" />
      {/* Wing: three soft feathers, tips to the back. */}
      <path
        d="M24.6 20.4C21.8 18.4 15.6 18.6 12 20.4 10.8 21 10.6 22.2 11.6 22.6 12.6 23 13.6 22.7 14.2 22.5 14.6 23.6 15.8 24.2 17.2 23.8 18 24.8 19.4 25.1 20.8 24.7 23.8 24.3 25.8 22.4 24.6 20.4Z"
        fill={p.duckWing}
      />
      <path d="M24.6 20.4C21.8 18.4 15.6 18.6 12 20.4" fill="none" stroke={p.duckWingLight} strokeWidth="1.2" strokeLinecap="round" opacity=".9" />
      {/* Neck and a big round head, with a curl on top. */}
      <ellipse cx="27.8" cy="15.4" rx="5.4" ry="5" fill={`url(#${id('duckBody')})`} />
      <circle cx="29.6" cy="8.8" r="7.4" fill={`url(#${id('duckHead')})`} />
      <path d="M27.4 1.7c.3-2 2.5-3 4.2-2" fill="none" stroke={p.duckHead} strokeWidth="1.3" strokeLinecap="round" />
      {/* Bill. */}
      <path d="M35.8 7.6C39 6.6 42.8 7 43.8 8.6 44.4 9.8 42.6 10.8 36.4 11Z" fill={p.bill} />
      <path d="M36.6 10.6C39.8 10.8 43 10.4 43.8 9.5 44 11.2 41.2 12.4 37 12Z" fill={p.billDark} />
      <path d="M37.4 8.3c1.4-.4 2.9-.5 4.1-.2" fill="none" stroke="#fff" strokeWidth=".55" strokeLinecap="round" opacity=".5" />
      {/* Eye. */}
      <ellipse cx="32.6" cy="7.2" rx="1.4" ry="1.65" fill={p.ink} />
      <circle cx="33" cy="6.6" r=".58" fill="#fff" />
      <ellipse cx="31.6" cy="11" rx="1.6" ry=".95" fill={p.blush} opacity=".38" />
    </svg>
  );
}

export function Duck({ look, id }: { look: HeroLook; id: Ref }) {
  const top = DUCK.water - 31 * DUCK_K;
  return (
    <>
      <div className={`${s.piece} ${s.waterline}`} style={box(DUCK.x, top, DUCK.w, 31 * DUCK_K)}>
        <DuckArt p={look.paint} id={id} />
      </div>
      {/* Rings spreading on the water. */}
      {[0, 1].map((i) => (
        <div key={i} className={`${s.piece} ${s.m} ${s.ripple}`} style={{ ...box(DUCK.x - 2, DUCK.water - 3.4, DUCK.w + 4, 6.8), animationDelay: `${-1.6 * i}s` }}>
          <svg viewBox="0 0 38 6.8" preserveAspectRatio="none">
            <ellipse cx="19" cy="3.4" rx="18" ry="2.8" fill="none" stroke={mixColour(look.water[0], '#FFFFFF', 0.5)} strokeWidth=".7" />
          </svg>
        </div>
      ))}
    </>
  );
}

/** The hedgehog: round, clearly brown, facing left (towards the house). */
function HedgehogArt({ p }: { p: Paint }) {
  return (
    <svg viewBox="0 0 56 42" className={`${s.m} ${s.hedgehog}`}>
      <ellipse cx="22" cy="39.6" rx="2.6" ry="1.7" fill={p.feet} />
      <ellipse cx="38" cy="39.6" rx="2.6" ry="1.7" fill={p.feet} />
      {/* A coat of spines in two layers. */}
      <path d={HOG_COAT} fill={p.spinesDark} stroke={p.spinesDark} strokeWidth="1.4" strokeLinejoin="round" />
      <path d={HOG_COAT} fill={p.spines} transform="translate(0.6 0.9) scale(0.985)" />
      <path d={HOG_COAT_INNER} fill={p.spinesLight} stroke={p.spinesLight} strokeWidth="1" strokeLinejoin="round" opacity="0.9" />
      <path d="M30 18l3 4.5M38 17.5l1.5 4.8M45 21l-.5 4.5M24 22l3.6 3.4M42 27.5l2.4 3M34 24l2 3.6" stroke={p.spinesDark} strokeWidth="1" strokeLinecap="round" opacity=".42" />
      {/* Face, pointing left. */}
      <path d="M23 18.6c-6 .8-12.8 5.6-17.6 10.8-1.6 1.8-.8 4.2 1.6 4.6 5 .8 11 3.2 15.6 3.8 4.6-3.8 6.4-15.2.4-19.2Z" fill={p.face} />
      <path d="M7 34c5 .8 11 3.2 15.6 3.8 1.4-1.2 2.6-3 3.4-5.2-4.6 1.8-12.4 1-19-.6Z" fill={p.faceShade} opacity=".7" />
      <circle cx="5.4" cy="31" r="2.5" fill={p.nose} />
      <circle cx="4.7" cy="30.2" r=".75" fill="#fff" opacity=".7" />
      <ellipse cx="14.6" cy="26.4" rx="1.8" ry="2.1" fill={p.ink} />
      <circle cx="14.1" cy="25.7" r=".65" fill="#fff" />
      {/* Ear: tan outside, soft pink inside. */}
      <circle cx="21.4" cy="21.6" r="2.7" fill={p.faceShade} />
      <circle cx="21.3" cy="21.9" r="1.45" fill={p.ear} />
      <ellipse cx="13.8" cy="31.4" rx="2.3" ry="1.3" fill={p.blush} opacity=".5" />
    </svg>
  );
}

export function Hedgehog({ look }: { look: HeroLook }) {
  return (
    <div className={s.piece} style={box(321, 283, 44, 33)}>
      <HedgehogArt p={look.paint} />
    </div>
  );
}

/** Thin, light wisps rising from the chimney on cold mornings and evenings. */
export function Smoke({ look }: { look: HeroLook }) {
  const day = look.elevation > 2;
  const colour = day ? 'rgba(255,255,255,0.8)' : rgba(mixColour(look.cloud.top, '#E6ECFF', 0.55), 0.55);
  const rest = [
    ['translate(10%, -70%) scale(0.75)', 0.45],
    ['translate(40%, -190%) scale(1.05)', 0.32],
    ['translate(90%, -320%) scale(1.4)', 0.2],
    ['translate(150%, -450%) scale(1.75)', 0.1],
  ] as const;
  return (
    <div className={s.piece} style={{ ...box(260.4, 143.6, 8, 8), '--smoke': colour } as CSSProperties}>
      {rest.map(([t, o], i) => (
        <span key={i} className={`${s.m} ${s.puff}`} style={{ '--rest-transform': t, '--rest-opacity': o } as CSSProperties} />
      ))}
    </div>
  );
}

/** Fireflies over the garden on summer nights: rest position, drift and blink timings. */
const FIREFLIES = [
  [124, 270, 6.8, 2.1, -0.4],
  [168, 296, 5.2, 2.9, -1.6],
  [292, 262, 7.4, 1.8, -2.2],
  [336, 298, 6.1, 2.6, -0.9],
  [44, 280, 5.6, 3.3, -2.8],
  [272, 304, 6.6, 2.4, -1.2],
  [104, 300, 7.9, 3.0, -0.2],
  [372, 280, 5.9, 2.2, -3.1],
  [196, 300, 6.3, 2.7, -1.9],
] as const;

export function Fireflies({ strength }: { strength: number }) {
  return (
    <div className={s.layer} style={{ opacity: +strength.toFixed(3) }}>
      {FIREFLIES.map(([x, y, dur, blink, delay], i) => (
        <span
          key={i}
          className={`${s.piece} ${s.m} ${s.firefly}`}
          style={{ ...box(x - 4, y - 4, 8, 8), '--ff-duration': `${dur}s`, '--ff-blink': `${blink}s`, '--ff-delay': `${delay}s` } as CSSProperties}
        />
      ))}
    </div>
  );
}

/** The red light blinking on top of the Shard at night. */
export function ShardBeacon({ look }: { look: HeroLook }) {
  return (
    <div className={s.piece} style={{ ...box(56.7, 179.4, 6, 6), opacity: +look.city.toFixed(3) }}>
      <svg viewBox="0 0 6 6" className={`${s.m} ${s.beacon}`}>
        <circle cx="3" cy="3" r="2.2" fill="#FF5A4E" opacity="0.35" />
        <circle cx="3" cy="3" r=".8" fill="#FF7A6A" />
      </svg>
    </div>
  );
}
