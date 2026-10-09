// The cottage at 21 Alderbrook Road: a cream house with a front gable and a
// fish-scale terracotta roof, a lower wing, a brick chimney, lamplit windows,
// a teal door with a fanlight and a lantern, and its seasonal touches.
import { f1, type Ref } from './frame';
import type { HeroLook, Paint } from './look';

/** Fish-scale roof tiles: rows of little arcs, for clipping to a roof. */
function scales(x0: number, x1: number, y0: number, y1: number, w: number, h: number): string {
  let d = '';
  let row = 0;
  for (let y = y0; y <= y1; y += h, row++) {
    const start = x0 - (row % 2) * (w / 2);
    d += `M${f1(start)} ${f1(y)}`;
    for (let x = start; x < x1; x += w) d += `a${w / 2} ${f1(h * 0.95)} 0 0 0 ${w} 0`;
  }
  return d;
}
const MAIN_ROOF =
  'M-66 -54L-3.4 -124.2Q0 -128 3.4 -124.2L66 -54Q67.5 -51 64 -50H50L0 -106L-50 -50H-64Q-67.5 -51 -66 -54Z';
const LEFT_SLOPE = 'M-66 -54L-3.4 -124.2Q0 -128 0 -128V-106L-50 -50H-64Q-67.5 -51 -66 -54Z';
const RIGHT_SLOPE = 'M66 -54L3.4 -124.2Q0 -128 0 -128V-106L50 -50H64Q67.5 -51 66 -54Z';
const WING_ROOF = 'M-100 -40Q-102.2 -43 -99.6 -46.3L-85.2 -66.2Q-83.2 -68.6 -80 -68.6H-46V-40Z';
const MAIN_TILES = scales(-70, 70, -121, -50, 7.4, 6.4);
const WING_TILES = scales(-104, -44, -66, -40, 7.4, 6.4);
const DOOR_OUTER = 'M-13.5 0V-30A13.5 13.5 0 0 1 13.5 -30V0Z';
const DOOR = 'M-10.5 0V-30A10.5 10.5 0 0 1 10.5 -30V0Z';

/** Flowers in a window box (or winter greenery), by season. */
function boxColours(look: HeroLook, p: Paint): string[] {
  switch (look.blooms) {
    case 'winter':
      return [p.wreath, p.berry, p.wreath, p.bushDark, p.berry, p.wreath];
    case 'spring':
      return [p.yellow, p.white, p.yellow, p.yellow, p.white, p.lavender];
    case 'autumn':
      return [p.orange, p.burgundy, p.yellow, p.orange, p.burgundy, p.coral];
    default:
      return [p.pink, p.coral, p.white, p.pink, p.lavender, p.coral, p.pink];
  }
}

function Window({ x, y, w, h, p, id, lamp }: { x: number; y: number; w: number; h: number; p: Paint; id: Ref; lamp: number }) {
  return (
    <g>
      <rect x={x - 2.6} y={y - 2.6} width={w + 5.2} height={h + 5.2} rx="3.2" fill={p.trim} />
      <rect x={x} y={y} width={w} height={h} rx="1.6" fill={`url(#${id('glass')})`} />
      {lamp > 0.01 ? <rect x={x} y={y} width={w} height={h} rx="1.6" fill={`url(#${id('lamp')})`} opacity={+lamp.toFixed(3)} /> : null}
      <path
        d={`M${x} ${y}h${f1(w * 0.34)}c${f1(-w * 0.12)} ${f1(h * 0.22)} ${f1(-w * 0.22)} ${f1(h * 0.4)} ${f1(-w * 0.34)} ${f1(h * 0.52)}ZM${x + w} ${y}h${f1(-w * 0.34)}c${f1(w * 0.12)} ${f1(h * 0.22)} ${f1(w * 0.22)} ${f1(h * 0.4)} ${f1(w * 0.34)} ${f1(h * 0.52)}Z`}
        fill={p.curtain}
        opacity="0.94"
      />
      <path d={`M${f1(x + w * 0.62)} ${f1(y + h * 0.2)}l${f1(-w * 0.3)} ${f1(h * 0.34)}`} stroke="#fff" strokeWidth="1.3" strokeLinecap="round" opacity={+(0.5 * (1 - lamp)).toFixed(3)} />
      <rect x={x + w / 2 - 0.8} y={y} width="1.6" height={h} fill={p.trim} />
      <rect x={x} y={y + h * 0.48} width={w} height="1.6" fill={p.trim} />
      <rect x={x - 3.6} y={y + h + 1.2} width={w + 7.2} height="3" rx="1.3" fill={p.trim} />
    </g>
  );
}

function WindowBox({ x, y, w, p, blooms }: { x: number; y: number; w: number; p: Paint; blooms: string[] }) {
  const n = Math.round(w / 4.4);
  return (
    <g>
      <path d={`M${x} ${y}c${f1(w * 0.2)}-3.6 ${f1(w * 0.8)}-3.6 ${w} 0`} fill={p.bushDark} />
      {Array.from({ length: n }, (_, i) => (
        <circle key={i} cx={f1(x + 2.2 + (i * (w - 4.4)) / (n - 1))} cy={f1(y - 1.6 - (i % 2) * 1.3)} r="1.55" fill={blooms[i % blooms.length]} />
      ))}
      <rect x={x} y={y} width={w} height="5" rx="1.5" fill={p.box} />
      <rect x={x} y={y + 3.4} width={w} height="1.6" rx=".8" fill="#000" opacity="0.12" />
    </g>
  );
}

/** A climbing rose round the door: flowers in summer, hips in autumn, bare stems in winter. */
function Rose({ look, p }: { look: HeroLook; p: Paint }) {
  const spots = [
    [-15.5, -6],
    [-17, -16],
    [-16.5, -27],
    [-12.5, -37],
    [-6, -44],
    [2, -46.5],
  ] as const;
  const leafy = look.blooms !== 'winter';
  return (
    <g>
      <path d="M-14.5 0C-17 -12 -18 -26 -12 -38 -8 -45 0 -47 7 -45" fill="none" stroke={leafy ? p.bushDark : p.trunk} strokeWidth="1.4" strokeLinecap="round" />
      {spots.map(([x, y], i) => (
        <g key={i}>
          {leafy || i % 3 === 0 ? (
            <ellipse cx={x + 1.6} cy={y + 1} rx="2" ry="1.2" fill={p.bush} transform={`rotate(-30 ${x + 1.6} ${y + 1})`} />
          ) : null}
          {look.blooms === 'summer' ? <circle cx={x} cy={y} r="1.75" fill={i % 2 ? p.pink : p.rose} /> : null}
          {look.blooms === 'autumn' && i % 2 === 0 ? <circle cx={x} cy={y} r="1.1" fill={p.berry} /> : null}
          {look.blooms === 'spring' && i % 2 === 1 ? <circle cx={x} cy={y} r="1" fill={p.bushLight} /> : null}
        </g>
      ))}
    </g>
  );
}

export function House({ look, id }: { look: HeroLook; id: Ref }) {
  const p = look.paint;
  const { ground, attic, lantern } = look.lamps;
  const blooms = boxColours(look, p);
  // Daylight from one side: the far side of the house is a touch cooler and darker.
  const day = look.sun.visible;
  const shadeAmt = day * (0.06 + 0.2 * look.golden) * Math.min(1, Math.abs(look.side) * 1.4);
  const fromLeft = look.side < 0;
  const warmAmt = day * 0.22 * look.golden;
  // In the evening the gable throws a shadow across the wing.
  const cast = look.side > 0.2 ? day * look.golden * 0.34 : 0;
  const castLen = 8 + 20 * look.golden;
  const rimSun = look.rim.strength * (day > 0.2 ? 1 : 0.7);
  return (
    <g transform="translate(236 292) scale(0.93)">
      <defs>
        <clipPath id={id('mainRoof')}>
          <path d={MAIN_ROOF} />
        </clipPath>
        <clipPath id={id('wingRoof')}>
          <path d={WING_ROOF} />
        </clipPath>
        <clipPath id={id('walls')}>
          <path d="M-46 0V-54.25L0 -106L46 -54.25V0ZM-92 0V-42H-46V0Z" />
        </clipPath>
        <linearGradient id={id('side')} x1={fromLeft ? 1 : 0} y1="0" x2={fromLeft ? 0 : 1} y2="0">
          <stop offset="0" stopColor="#2E3A78" stopOpacity={+shadeAmt.toFixed(3)} />
          <stop offset="0.55" stopColor="#2E3A78" stopOpacity={+(shadeAmt * 0.25).toFixed(3)} />
          <stop offset="1" stopColor={look.sun.colour} stopOpacity={+warmAmt.toFixed(3)} />
        </linearGradient>
        <radialGradient id={id('wallGlow')}>
          <stop offset="0" stopColor="#FFC774" stopOpacity="0.5" />
          <stop offset="0.55" stopColor="#FFB45E" stopOpacity="0.14" />
          <stop offset="1" stopColor="#FFB45E" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Chimney, behind the roof. */}
      <rect x="24" y="-140" width="13.5" height="56" rx="1.5" fill={p.brick} />
      <rect x="33" y="-140" width="4.5" height="56" fill={p.brickDark} opacity="0.32" />
      <g fill={p.brickDark} opacity="0.3">
        <rect x="25.5" y="-133" width="6" height="2.6" rx="1" />
        <rect x="29.5" y="-127" width="6" height="2.6" rx="1" />
        <rect x="25.5" y="-121" width="6" height="2.6" rx="1" />
        <rect x="29.5" y="-115" width="6" height="2.6" rx="1" />
      </g>
      <rect x="21" y="-145.5" width="19.5" height="7" rx="2.6" fill={p.brickDark} />
      <rect x="26.3" y="-151.5" width="9" height="7" rx="1.6" fill={p.pot} />
      <path d="M26.3 -150h9" stroke={look.rim.colour} strokeWidth="1" opacity={+(rimSun * 0.5).toFixed(3)} />

      {/* The wing on the left. */}
      <rect x="-92" y="-42" width="46" height="42" fill={`url(#${id('wall')})`} />
      <rect x="-92" y="-42" width="46" height="6" fill={p.wallShade} opacity="0.55" />
      <path d={WING_ROOF} fill={`url(#${id('roof')})`} />
      <path d={WING_TILES} fill="none" stroke={p.roofLine} strokeWidth="0.9" opacity="0.5" clipPath={`url(#${id('wingRoof')})`} />
      <path d="M-99.6 -46.3L-85.2 -66.2Q-83.2 -68.6 -80 -68.6H-58" fill="none" stroke={look.rim.colour} strokeWidth="1.4" strokeLinecap="round" opacity={+(rimSun * (look.side < 0.2 ? 0.8 : 0.35)).toFixed(3)} />
      {/* The main roof shades the wing roof where it laps over it. */}
      <path d="M-66 -54L-50 -72" stroke={p.roofDark} strokeWidth="5" opacity="0.32" clipPath={`url(#${id('wingRoof')})`} />
      <rect x="-101" y="-41.5" width="55" height="3" rx="1.4" fill={p.roofDark} />

      {/* The main house. */}
      <path d="M-46 0V-54.25L0 -106L46 -54.25V0Z" fill={`url(#${id('wall')})`} />
      <path d="M-46 -54.25L0 -106L46 -54.25V-46L0 -97L-46 -46Z" fill={p.wallShade} opacity="0.7" />
      {cast > 0.01 ? (
        <path d={`M-46 -44L${f1(-46 - castLen)} -38V0H-46Z`} fill="#2A3470" opacity={+cast.toFixed(3)} />
      ) : null}

      {/* Lamplight falling on the walls round the windows (under the frames, so the bars stay crisp). */}
      {ground > 0.01 ? (
        <g opacity={+ground.toFixed(3)} fill={`url(#${id('wallGlow')})`}>
          <circle cx="-69" cy="-24" r="24" />
          <circle cx="-30" cy="-35" r="22" />
          <circle cx="30" cy="-35" r="22" />
          <circle cx="0" cy="-30" r="20" />
        </g>
      ) : null}
      {attic > 0.01 ? <circle cx="0" cy="-77" r="20" fill={`url(#${id('wallGlow')})`} opacity={+attic.toFixed(3)} /> : null}

      <path d={MAIN_ROOF} fill={`url(#${id('roof')})`} />
      <path d={MAIN_TILES} fill="none" stroke={p.roofLine} strokeWidth="0.9" opacity="0.48" clipPath={`url(#${id('mainRoof')})`} />
      <path d={fromLeft || look.side === 0 ? RIGHT_SLOPE : LEFT_SLOPE} fill={p.roofDark} opacity={+(0.14 + 0.16 * look.golden * day).toFixed(3)} />
      <path d="M-50 -50L0 -106L50 -50" fill="none" stroke={p.trim} strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M50 -50.5H62M-50 -50.5H-62" stroke={p.roofDark} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      {/* Rim light along the roof edge facing the light. */}
      <path
        d={fromLeft ? 'M-66 -54L-3.4 -124.2Q0 -128 3.4 -124.2' : 'M66 -54L3.4 -124.2Q0 -128 -3.4 -124.2'}
        fill="none"
        stroke={look.rim.colour}
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity={+(rimSun * 0.9).toFixed(3)}
      />

      {/* Fairy lights along the gable in December. */}
      {look.wreath && attic > 0.05 ? (
        <g opacity={+attic.toFixed(3)}>
          {Array.from({ length: 15 }, (_, i) => {
            const t = (i + 0.5) / 15;
            const x = -50 + 100 * t;
            const y = -106 + 56 * Math.abs(2 * t - 1) + 3.2;
            return (
              <g key={i}>
                <circle cx={f1(x)} cy={f1(y)} r="2.6" fill="#FFD27A" opacity="0.28" />
                <circle cx={f1(x)} cy={f1(y)} r="1" fill={i % 4 === 1 ? '#FF8A7A' : i % 4 === 3 ? '#9EE6A8' : '#FFF1C2'} />
              </g>
            );
          })}
        </g>
      ) : null}

      {/* Round attic window. */}
      <circle cx="0" cy="-77" r="11.2" fill={p.trim} />
      <circle cx="0" cy="-77" r="8.6" fill={`url(#${id('glass')})`} />
      {attic > 0.01 ? <circle cx="0" cy="-77" r="8.6" fill={`url(#${id('lamp')})`} opacity={+attic.toFixed(3)} /> : null}
      <path d="M0 -85.6V-68.4M-8.6 -77H8.6" stroke={p.trim} strokeWidth="1.5" />
      <path d="M2.5 -82.5l-4.5 6" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity={+(0.5 * (1 - attic)).toFixed(3)} />

      {/* House number over the door. */}
      <rect x="-6.5" y="-55.5" width="13" height="7.4" rx="3.7" fill={p.trim} />
      <text x="0" y="-49.9" textAnchor="middle" fontSize="5.6" fontWeight="700" fill={p.doorDark} fontFamily="ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, sans-serif">
        21
      </text>

      {/* Door, with a fanlight in its arch. */}
      <path d={DOOR_OUTER} fill={p.trim} />
      <path d={DOOR} fill={`url(#${id('door')})`} />
      <path d="M-10.5 -30A10.5 10.5 0 0 1 10.5 -30Z" fill={`url(#${id('glass')})`} />
      {ground > 0.01 ? <path d="M-10.5 -30A10.5 10.5 0 0 1 10.5 -30Z" fill={`url(#${id('lamp')})`} opacity={+Math.max(ground, attic * 0.5).toFixed(3)} /> : null}
      <path d="M0 -30V-40.5M0 -30L-7.4 -37.4M0 -30L7.4 -37.4" stroke={p.trim} strokeWidth="1.1" />
      <rect x="-11" y="-31" width="22" height="2" fill={p.trim} />
      <g fill={p.doorDark} opacity="0.4">
        <rect x="-7" y="-25.5" width="5.6" height="9.5" rx="1.4" />
        <rect x="1.4" y="-25.5" width="5.6" height="9.5" rx="1.4" />
        <rect x="-7" y="-13" width="5.6" height="9" rx="1.4" />
        <rect x="1.4" y="-13" width="5.6" height="9" rx="1.4" />
      </g>
      {look.wreath ? (
        <g>
          <circle cx="0" cy="-19.5" r="4.3" fill="none" stroke={p.wreath} strokeWidth="2.6" />
          <g fill={p.berry}>
            <circle cx="-3.2" cy="-22" r=".8" />
            <circle cx="3.4" cy="-21" r=".8" />
            <circle cx="-2" cy="-16.4" r=".8" />
          </g>
          <path d="M-1.8 -14.6l1.8 -1.2 1.8 1.2" fill="none" stroke={p.berry} strokeWidth="1.2" strokeLinecap="round" />
        </g>
      ) : null}
      <circle cx="6.6" cy="-13.5" r="1.45" fill={p.brass} />
      <rect x="-16.5" y="-2" width="33" height="3.6" rx="1.6" fill={p.stone} />

      {/* A lantern by the door. */}
      <path d="M14.8 -42.5h4.4" stroke={p.lantern} strokeWidth="1.1" strokeLinecap="round" />
      <path d="M17 -42.5v1.6" stroke={p.lantern} strokeWidth="0.9" />
      <path d="M14.6 -38.6l2.4 -2.4 2.4 2.4Z" fill={p.lantern} />
      <rect x="15" y="-38.6" width="4" height="5.4" rx=".6" fill={lantern > 0.01 ? '#FFD58A' : look.glass[0]} />
      {lantern > 0.01 ? <rect x="15" y="-38.6" width="4" height="5.4" rx=".6" fill="#FFE7AE" opacity={+lantern.toFixed(3)} /> : null}
      <rect x="14.6" y="-33.4" width="4.8" height="1.2" rx=".5" fill={p.lantern} />

      {/* Windows either side of the door, and the wing's window. */}
      <Window x={-39} y={-46} w={18} h={22} p={p} id={id} lamp={ground} />
      <Window x={21} y={-46} w={18} h={22} p={p} id={id} lamp={ground} />
      <Window x={-81.5} y={-32} w={25} h={16.5} p={p} id={id} lamp={ground} />
      <WindowBox x={-41.5} y={-18.6} w={23} p={p} blooms={blooms} />
      <WindowBox x={18.5} y={-18.6} w={23} p={p} blooms={blooms} />
      <WindowBox x={-85.5} y={-12.4} w={33} p={p} blooms={blooms} />

      <Rose look={look} p={p} />

      {/* Clipped topiary either side of the step. */}
      {[-30, 30].map((x) => (
        <g key={x}>
          <circle cx={x} cy="-5.2" r="6.6" fill={`url(#${id('bush')})`} />
          <circle cx={x - 2.2} cy="-8" r="2.4" fill={p.bushLight} opacity="0.55" />
        </g>
      ))}

      {look.pumpkin ? (
        <g>
          <ellipse cx="19.5" cy="-2.6" rx="4.4" ry="3.3" fill={p.pumpkin} />
          <path d="M17.6 -5.4c-.8 1.8-.8 3.8 0 5.6M21.4 -5.4c.8 1.8.8 3.8 0 5.6" fill="none" stroke={p.pumpkinDark} strokeWidth=".8" />
          <path d="M19.5 -5.8l.4 -1.8" stroke={p.trunkDark} strokeWidth="1.1" strokeLinecap="round" />
          <ellipse cx="25.6" cy="-1.6" rx="2.6" ry="2.1" fill={p.pumpkinDark} />
        </g>
      ) : null}

      {/* Sun on one side, cool shade on the other. */}
      {shadeAmt + warmAmt > 0.01 ? (
        <rect x="-102" y="-110" width="170" height="112" fill={`url(#${id('side')})`} clipPath={`url(#${id('walls')})`} />
      ) : null}
    </g>
  );
}
