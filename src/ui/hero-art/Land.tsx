// The land, in three depths so it can drift apart a little as the hero
// scrolls: the far hills under London's skyline, the fields, and the garden
// with the cottage, the apple tree, the pond and the picket fence.
import s from '../Hero.module.css';
import { below, band, crestY, f1, smooth, type Pt, type Ref } from './frame';
import { House } from './House';
import { ART_H, ART_W, BLEED, VIEW_BOX, type HeroLook, type Paint } from './look';

const FAR: Pt[] = [[-40, 205], [10, 209], [60, 207], [120, 202], [180, 205], [236, 206], [296, 199], [352, 198], [442, 203]];
const HILL2: Pt[] = [[-40, 228], [16, 222], [76, 217], [136, 221], [192, 229], [250, 233], [304, 226], [356, 216], [442, 221]];
const HILL3: Pt[] = [[-40, 252], [36, 247], [104, 244], [170, 250], [240, 257], [312, 251], [376, 243], [442, 245]];
const LAWN: Pt[] = [[-40, 290], [30, 285], [110, 280], [190, 280], [270, 283], [350, 281], [442, 275]];
const FORE: Pt[] = [[-40, 321], [40, 315], [120, 314], [200, 318], [280, 320], [360, 315], [442, 311]];

const FULL = { x: -BLEED, width: ART_W + 2 * BLEED, height: ART_H };

function Grad({ id, y1, y2, a, b }: { id: string; y1: number; y2: number; a: string; b: string }) {
  return (
    <linearGradient id={id} x1="0" y1={y1} x2="0" y2={y2} gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor={a} />
      <stop offset="1" stopColor={b} />
    </linearGradient>
  );
}

// ---------------------------------------------------------------- far

/** London on the horizon: the BT Tower, St Paul's, the Gherkin, the Shard and the Eye. */
function Skyline({ p, lit }: { p: Paint; lit: number }) {
  return (
    <g>
      <g fill={p.skyline}>
        <rect x="-2" y="199" width="6" height="12" />
        <rect x="5.4" y="194.5" width="4.2" height="16.5" rx=".5" />
        <rect x="13.9" y="185" width="1.9" height="26" />
        <rect x="13" y="188.2" width="3.7" height="1.9" rx=".9" />
        <rect x="13.3" y="191.3" width="3.1" height="1.3" rx=".6" />
        <rect x="14.6" y="180.8" width=".5" height="4.6" />
        <rect x="18.6" y="200.5" width="5" height="10.5" />
        <rect x="25" y="202" width="12" height="9" />
        <rect x="27.2" y="198" width="7.6" height="4.4" />
        <path d="M26.8 198.2A4.2 4.8 0 0 1 35.2 198.2Z" />
        <rect x="30.6" y="191.6" width=".8" height="2.8" />
        <circle cx="31" cy="191.4" r=".75" />
        <path d="M39.4 211C38.9 203 40 196.6 42.5 192.8 45 196.6 46.1 203 45.6 211Z" />
        <path d="M47.6 211V196.4L52.2 195V211Z" />
        <path d="M54.4 211L58.7 183.4 59.1 185.2 59.7 182.4 64.2 211Z" />
        <rect x="65.2" y="200.5" width="4.4" height="10.5" />
        <circle cx="77" cy="199" r="7.4" fill="none" stroke={p.skyline} strokeWidth=".9" />
        <path d="M77 191.6V206.4M69.6 199H84.4M71.8 193.8L82.2 204.2M82.2 193.8L71.8 204.2" stroke={p.skyline} strokeWidth=".35" />
        <path d="M77 199L73.4 211H74.4L77 201.2L79.6 211H80.6Z" />
        <rect x="84.6" y="204" width="5" height="7" />
      </g>
      {lit > 0.02 ? (
        <g fill="#FFD27A" opacity={+lit.toFixed(3)}>
          {[
            [0, 202], [1.8, 206], [6.6, 197], [7, 202.4], [6.6, 207], [19.8, 203], [21.6, 207], [27, 205],
            [33.6, 205.5], [48.6, 199], [50.4, 203.5], [49, 207.6], [58, 194], [59.4, 199.5], [58.4, 204.6],
            [60.8, 207.8], [66.4, 203], [67.8, 207], [86, 206.4],
          ].map(([x, y]) => (
            <rect key={`${x},${y}`} x={x} y={y} width=".9" height=".9" />
          ))}
        </g>
      ) : null}
    </g>
  );
}

export function FarLand({ look, id }: { look: HeroLook; id: Ref }) {
  const p = look.paint;
  const rim = look.rim;
  const lamp = Math.max(look.lamps.ground, look.lamps.attic * 0.6);
  return (
    <svg className={s.layer} viewBox={VIEW_BOX} preserveAspectRatio="none">
      <defs>
        <Grad id={id('far')} y1={198} y2={250} a={p.far} b={p.far2} />
        <Grad id={id('hill2')} y1={216} y2={262} a={p.hill2} b={p.hill2b} />
        <radialGradient id={id('scatter')}>
          <stop offset="0" stopColor={look.horizon.colour} stopOpacity="0.7" />
          <stop offset="0.5" stopColor={look.horizon.colour} stopOpacity="0.22" />
          <stop offset="1" stopColor={look.horizon.colour} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('mist')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={look.mist.colour} stopOpacity="0" />
          <stop offset="0.55" stopColor={look.mist.colour} stopOpacity="0.85" />
          <stop offset="1" stopColor={look.mist.colour} stopOpacity="0" />
        </linearGradient>
      </defs>

      <Skyline p={p} lit={look.city} />

      {/* Far hills, hazy, their crest catching the light. */}
      <path d={below(FAR)} fill={`url(#${id('far')})`} />
      <path d={smooth(FAR)} fill="none" stroke={rim.colour} strokeWidth="1.1" opacity={+(rim.strength * 0.45).toFixed(3)} />

      {/* Low sunlight scattering in the air over the far hills. */}
      {look.golden > 0.02 ? (
        <ellipse cx={f1(Math.min(400, Math.max(0, look.horizon.x)))} cy="212" rx="160" ry="40" fill={`url(#${id('scatter')})`} opacity={+(look.golden * 0.7).toFixed(3)} />
      ) : null}

      {/* Middle hills, with copses along the top and a neighbour's window or two. */}
      <path d={below(HILL2)} fill={`url(#${id('hill2')})`} />
      <path d={band(HILL2, 10, 15)} fill={p.field} opacity="0.18" />
      <path d={smooth(HILL2)} fill="none" stroke={rim.colour} strokeWidth="1.1" opacity={+(rim.strength * 0.45).toFixed(3)} />
      {(
        [
          [[20, 220.5, 4.6], [27.5, 216.8, 6], [35.5, 219.4, 4.6]],
          [[296, 225.2, 4.4], [304, 221.4, 5.8], [312.5, 224.4, 4.4]],
          [[176, 226, 3.6], [182, 223.6, 4.4]],
        ] as const
      ).map((clump, i) => (
        <g key={i}>
          <g fill={p.hedge} transform="translate(1 1.4)">
            {clump.map(([x, y, r], j) => (
              <circle key={j} cx={x} cy={y} r={r} />
            ))}
          </g>
          <g fill={p.distantTree}>
            {clump.map(([x, y, r], j) => (
              <circle key={j} cx={x} cy={y} r={r} />
            ))}
          </g>
        </g>
      ))}
      {lamp > 0.05 ? (
        <g fill="#FFD08A" opacity={+lamp.toFixed(3)}>
          <rect x="46" y="219.6" width="1.8" height="1.5" rx=".4" />
          <rect x="49.6" y="220" width="1.5" height="1.3" rx=".4" />
          <rect x="206" y="230.6" width="1.7" height="1.4" rx=".4" />
          <rect x="330" y="220.4" width="1.8" height="1.5" rx=".4" />
          <rect x="384" y="217" width="1.5" height="1.3" rx=".4" />
        </g>
      ) : null}

      {look.mist.strength > 0.02 ? (
        <path d={band(HILL2, 4, 30)} fill={`url(#${id('mist')})`} opacity={+(look.mist.strength * 0.8).toFixed(3)} />
      ) : null}
    </svg>
  );
}

// ---------------------------------------------------------------- middle

export function MidLand({ look, id }: { look: HeroLook; id: Ref }) {
  const p = look.paint;
  const sheep = [302, 310, 321, 328];
  return (
    <svg className={s.layer} viewBox={VIEW_BOX} preserveAspectRatio="none">
      <defs>
        <Grad id={id('hill3')} y1={243} y2={292} a={p.hill3} b={p.hill3b} />
      </defs>
      <path d={below(HILL3)} fill={`url(#${id('hill3')})`} />
      <path d={band(HILL3, 9, 16)} fill={p.field} opacity="0.32" />
      <path d={smooth(HILL3)} fill="none" stroke={look.rim.colour} strokeWidth="1.1" opacity={+(look.rim.strength * 0.4).toFixed(3)} />
      {sheep.map((x, i) => {
        const y = crestY(HILL3, x) + 4 + (i % 2) * 2.2;
        const left = i % 2 === 0;
        return (
          <g key={x}>
            <ellipse cx={x} cy={f1(y)} rx="2.2" ry="1.5" fill={p.sheep} />
            <ellipse cx={left ? x - 2.1 : x + 2.1} cy={f1(y - 0.5)} rx=".85" ry=".75" fill={p.sheepFace} />
          </g>
        );
      })}
      {look.mist.strength > 0.02 ? (
        <path d={band(HILL3, 8, 36)} fill={`url(#${id('mist')})`} opacity={+(look.mist.strength * 0.55).toFixed(3)} />
      ) : null}
    </svg>
  );
}

// ---------------------------------------------------------------- near

const TREE = [
  [104, 240, 19],
  [121, 223, 23],
  [142, 235, 20],
  [131, 251, 19],
  [110, 254, 14],
  [147, 251, 12],
] as const;

/** The apple tree, through the year: bare, in blossom, green, with apples, gold, rust. */
function AppleTree({ look, id }: { look: HeroLook; id: Ref }) {
  const p = look.paint;
  const { tree } = look;
  const trunk = (
    <>
      <path
        d="M119.5 291C121 278 121 264 118 251 116.5 246 114 243 111 241L114 239.5C117.5 241.5 120 244.5 121.5 248 122.5 244 125 240.5 129 238.5L131 240.5C127.5 243.5 125.5 248 125.5 253 125.5 266 126.5 279 128.5 291Z"
        fill={p.trunk}
      />
      <path d="M125.5 253C125.5 266 126.5 279 128.5 291H125C123.5 280 123.5 266 124 253Z" fill={p.trunkDark} opacity="0.5" />
    </>
  );
  if (tree === 'bare') {
    return (
      <g>
        {trunk}
        <g fill="none" stroke={p.trunk} strokeLinecap="round">
          <path d="M112 241C104 236 97 230 92 222M129.5 239C134 230 136 222 135 212M122 247C123 236 121 226 116 214M128 240C138 236 146 238 154 232" strokeWidth="2.6" />
          <path d="M98 232C94 232 90 235 87 238M101 227C101 221 99 216 96 212M134 224C140 222 144 217 146 211M118 230C112 226 108 220 107 214M146 235C150 240 156 243 162 243M152 233C154 227 158 223 163 221" strokeWidth="1.5" />
          <path d="M92 222C88 220 85 216 84 212M135 212C133 207 134 203 137 200M116 214C115 209 117 205 120 202M107 214C103 211 102 207 102 203M154 232C158 229 162 228 166 229" strokeWidth=".9" />
        </g>
      </g>
    );
  }
  const circles = tree === 'rust' ? TREE.filter((_, i) => i !== 4 && i !== 5) : TREE;
  return (
    <g>
      {trunk}
      <g fill={`url(#${id('canopy')})`}>
        {circles.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={tree === 'rust' ? r * 0.92 : r} />
        ))}
      </g>
      <g fill={p.canopyLight}>
        <circle cx={113 - 6 * look.side} cy="217" r="10" opacity="0.5" />
        <circle cx="99" cy="234" r="7" opacity="0.38" />
        <circle cx={135 + 3 * look.side} cy="216" r="6.5" opacity="0.32" />
        <circle cx="146" cy="229" r="5" opacity="0.25" />
      </g>
      <g fill={p.canopyDark}>
        <circle cx="141" cy="257" r="9" opacity="0.35" />
        <circle cx="120" cy="263" r="8" opacity="0.3" />
        <circle cx="104" cy="256" r="6" opacity="0.25" />
      </g>
      {tree === 'blossom' ? (
        <g fill={p.blossom}>
          {[
            [100, 236], [108, 228], [116, 215], [126, 210], [134, 220], [144, 230], [150, 242], [138, 247],
            [125, 236], [112, 247], [104, 250], [120, 225], [131, 232], [146, 251], [96, 244], [118, 258],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i % 3 ? 1.6 : 2.1} opacity={i % 4 ? 0.95 : 0.75} />
          ))}
        </g>
      ) : null}
      {tree === 'apples' || tree === 'gold' ? (
        <g>
          {(tree === 'apples'
            ? [[108, 233], [128, 241], [146, 229], [116, 255], [124, 222], [139, 252], [99, 247], [133, 230]]
            : [[128, 241], [116, 255], [139, 252]]
          ).map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="2.3" fill={p.apple} />
              <circle cx={x - 0.7} cy={y - 0.7} r="0.7" fill="#fff" opacity="0.55" />
            </g>
          ))}
        </g>
      ) : null}
    </g>
  );
}

/** A slender poplar (a soft flame of leaves) standing on `base`. */
function Poplar({ x, base, h, w, p }: { x: number; base: number; h: number; w: number; p: Paint }) {
  const top = base - h;
  return (
    <g>
      <rect x={x - 0.9} y={base - 8} width="1.8" height="8" fill={p.trunkDark} />
      <path
        d={`M${x} ${top}C${x + w * 0.9} ${top + h * 0.22} ${x + w} ${top + h * 0.6} ${x + w * 0.62} ${base - 6}Q${x} ${base - 2} ${x - w * 0.62} ${base - 6}C${x - w} ${top + h * 0.6} ${x - w * 0.9} ${top + h * 0.22} ${x} ${top}Z`}
        fill={p.poplar}
      />
      <path
        d={`M${x} ${top}C${x - w * 0.9} ${top + h * 0.22} ${x - w} ${top + h * 0.6} ${x - w * 0.62} ${base - 6}Q${x - w * 0.3} ${base - 4} ${x - w * 0.1} ${base - 4.5}C${x - w * 0.4} ${top + h * 0.55} ${x - w * 0.3} ${top + h * 0.2} ${x} ${top}Z`}
        fill={p.poplarLight}
        opacity="0.55"
      />
    </g>
  );
}

function Flower({ x, y, c, p, r = 1.2 }: { x: number; y: number; c: string; p: Paint; r?: number }) {
  const d = r * 1.05;
  return (
    <g fill={c}>
      <circle cx={x} cy={y - d} r={r} />
      <circle cx={x + d} cy={y - d * 0.3} r={r} />
      <circle cx={x + d * 0.6} cy={y + d * 0.8} r={r} />
      <circle cx={x - d * 0.6} cy={y + d * 0.8} r={r} />
      <circle cx={x - d} cy={y - d * 0.3} r={r} />
      <circle cx={x} cy={y} r={r * 0.7} fill={p.yellow} />
    </g>
  );
}

function Tuft({ x, y, p, k = 1 }: { x: number; y: number; p: Paint; k?: number }) {
  return (
    <path
      d={`M${x} ${y}q${f1(-2 * k)} ${f1(-4 * k)} ${f1(-4.5 * k)} ${f1(-6 * k)}M${x} ${y}q${f1(0.2 * k)} ${f1(-5.5 * k)} ${f1(1.4 * k)} ${f1(-8.5 * k)}M${x} ${y}q${f1(2 * k)} ${f1(-3.5 * k)} ${f1(5 * k)} ${f1(-5 * k)}`}
      fill="none"
      stroke={p.blade}
      strokeWidth="1.25"
      strokeLinecap="round"
    />
  );
}

const PATH = 'M227.5 292C224 302 214 310 204 318 196 325 190 332 186 342H252C250.5 332 247.5 323 247.5 313 247.5 304 246 298 244.5 292Z';

/** A picket fence from x0 to x1 standing on `base`. */
function pickets(x0: number, x1: number, base: number, h: number): string {
  let d = '';
  for (let x = x0; x <= x1; x += 6.6) {
    d += `M${f1(x)} ${base}V${f1(base - h + 2.4)}Q${f1(x + 1.45)} ${f1(base - h - 0.6)} ${f1(x + 2.9)} ${f1(base - h + 2.4)}V${base}Z`;
  }
  return d;
}
const FENCE_L = pickets(151, 210, 307, 13);
const FENCE_R = pickets(258, 320, 307, 13);

/** Leaves fallen on the lawn in autumn. */
const FALLEN = [
  [96, 292, 20], [112, 296, -30], [131, 289, 60], [146, 298, 10], [162, 294, -50], [90, 300, 80],
  [268, 300, -20], [283, 296, 40], [296, 310, 70], [176, 314, -60], [205, 300, 30], [338, 300, -10],
] as const;

export function NearLand({ look, id }: { look: HeroLook; id: Ref }) {
  const p = look.paint;
  const g = look.lamps.ground;
  const lampGlow = Math.max(g, look.lamps.attic * 0.6);
  const sunLeft = look.sun.x < ART_W / 2;
  // Shadows lean away from the sun and stretch when it is low; they fade at night.
  const lean = -look.side * (6 + 16 * look.golden);
  const shade = 0.22 * (1 - look.stars.faint * 0.6);
  const flowers = look.blooms !== 'winter';
  const bloomCols =
    look.blooms === 'spring'
      ? [p.yellow, p.white, p.yellow, p.lavender]
      : look.blooms === 'autumn'
        ? [p.orange, p.burgundy, p.yellow, p.coral]
        : [p.pink, p.white, p.lavender, p.pink];
  return (
    <svg className={s.layer} viewBox={VIEW_BOX} preserveAspectRatio="none">
      <defs>
        <Grad id={id('lawn')} y1={276} y2={330} a={p.lawn} b={p.lawn2} />
        <Grad id={id('fore')} y1={308} y2={342} a={p.fore} b={p.fore2} />
        <Grad id={id('wall')} y1={-106} y2={0} a={p.wall} b={p.wall2} />
        <Grad id={id('roof')} y1={-128} y2={-40} a={p.roof} b={p.roof2} />
        <Grad id={id('path')} y1={292} y2={340} a={p.path} b={p.pathEdge} />
        <linearGradient id={id('door')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.door} />
          <stop offset="1" stopColor={p.doorDark} />
        </linearGradient>
        {/* Window glass reflects the sky. */}
        <linearGradient id={id('glass')} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={look.glass[0]} />
          <stop offset="1" stopColor={look.glass[1]} />
        </linearGradient>
        <radialGradient id={id('lamp')} cx="0.5" cy="0.62" r="0.75">
          <stop offset="0" stopColor="#FFE2A0" />
          <stop offset="0.6" stopColor="#FFB960" />
          <stop offset="1" stopColor="#EE8E44" />
        </radialGradient>
        <radialGradient id={id('spill')}>
          <stop offset="0" stopColor="#FFB867" stopOpacity="0.5" />
          <stop offset="1" stopColor="#FFB867" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('pathLight')} x1="0" y1="292" x2="0" y2="336" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFC27A" stopOpacity="0.42" />
          <stop offset="0.55" stopColor="#FFC27A" stopOpacity="0.12" />
          <stop offset="1" stopColor="#FFC27A" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={id('canopy')} cx={112 + 14 * look.side} cy="214" r="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={p.canopyLight} />
          <stop offset="0.5" stopColor={p.canopy} />
          <stop offset="1" stopColor={p.canopyDark} />
        </radialGradient>
        <radialGradient id={id('bush')} cx={0.35 + 0.15 * look.side} cy="0.3" r="0.8">
          <stop offset="0" stopColor={p.bushLight} />
          <stop offset="0.55" stopColor={p.bush} />
          <stop offset="1" stopColor={p.bushDark} />
        </radialGradient>
        <linearGradient id={id('water')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={look.water[0]} />
          <stop offset="1" stopColor={look.water[1]} />
        </linearGradient>
        <clipPath id={id('pond')}>
          <ellipse cx="60" cy="305" rx="45" ry="9.6" />
        </clipPath>
        <linearGradient id={id('warm')} x1={sunLeft ? 0 : 1} y1="0" x2={sunLeft ? 1 : 0} y2="0">
          <stop offset="0" stopColor={look.horizon.colour} stopOpacity="0.3" />
          <stop offset="0.6" stopColor={look.horizon.colour} stopOpacity="0.06" />
          <stop offset="1" stopColor={look.horizon.colour} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Trees behind the garden. */}
      <AppleTree look={look} id={id} />
      <Poplar x={344} base={290} h={58} w={8.5} p={p} />
      <Poplar x={358} base={291} h={44} w={7} p={p} />

      {/* The lawn. */}
      <path d={below(LAWN)} fill={`url(#${id('lawn')})`} />
      <path d={smooth(LAWN)} fill="none" stroke={look.rim.colour} strokeWidth="1.1" opacity={+(look.rim.strength * 0.36).toFixed(3)} />

      {/* Soft shadow under the house. */}
      <ellipse cx={f1(228 + lean)} cy="292.5" rx={f1(88 + Math.abs(lean))} ry="5.2" fill={p.shadow} opacity={+shade.toFixed(3)} />

      <House look={look} id={id} />

      {/* Bushes at the corners of the house. */}
      <g fill={`url(#${id('bush')})`}>
        <circle cx="128" cy="287" r="10" />
        <circle cx="141" cy="283" r="11.5" />
        <circle cx="151" cy="289" r="7.5" />
        <circle cx="306" cy="288" r="9" />
        <circle cx="317" cy="282" r="12" />
        <circle cx="330" cy="289" r="8.5" />
      </g>
      {flowers
        ? (
            [
              [133, 279], [144, 276], [138, 287], [148, 284], [311, 280], [320, 275], [325, 284], [313, 289], [302, 285],
            ] as const
          ).map(([x, y], i) => (look.blooms === 'autumn' && i % 2 ? null : <Flower key={i} x={x} y={y} c={bloomCols[i % 4]} p={p} r={1.02} />))
        : (
            [
              [134, 280], [145, 278], [139, 287], [314, 279], [322, 283], [306, 286],
            ] as const
          ).map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.2" fill={p.berry} />)}

      {/* Foreground bank. */}
      <path d={below(FORE)} fill={`url(#${id('fore')})`} />

      {/* The garden path from the door. */}
      <path d={PATH} fill={`url(#${id('path')})`} />
      <g fill={p.stone}>
        <ellipse cx="236" cy="298" rx="5.5" ry="1.9" />
        <ellipse cx="232" cy="306" rx="7" ry="2.4" />
        <ellipse cx="224.5" cy="315" rx="8.6" ry="2.9" />
        <ellipse cx="216" cy="325.5" rx="10.6" ry="3.5" />
      </g>

      {/* White picket fence, open at the gate. */}
      <g>
        <rect x="150" y="297" width="64" height="2" rx="1" fill={p.fenceShade} />
        <rect x="150" y="302" width="64" height="2" rx="1" fill={p.fenceShade} />
        <path d={FENCE_L} fill={p.fence} />
        <rect x="256" y="297" width="66" height="2" rx="1" fill={p.fenceShade} />
        <rect x="256" y="302" width="66" height="2" rx="1" fill={p.fenceShade} />
        <path d={FENCE_R} fill={p.fence} />
        <rect x="214" y="291" width="4.4" height="17" rx="1.2" fill={p.fence} />
        <circle cx="216.2" cy="290" r="2.5" fill={p.fence} />
        <rect x="253" y="291" width="4.4" height="17" rx="1.2" fill={p.fence} />
        <circle cx="255.2" cy="290" r="2.5" fill={p.fence} />
        <path d="M150 307.5H218M253 307.5H322" stroke={p.shadow} strokeWidth="1.2" opacity="0.18" />
      </g>
      {look.robin ? (
        <g>
          <path d="M213.2 284.6l-2.6 -2.4 .4 2.8Z" fill={p.robin} />
          <ellipse cx="216.4" cy="284.6" rx="3.6" ry="2.9" fill={p.robin} />
          <circle cx="219.2" cy="282.2" r="2.1" fill={p.robin} />
          <path d="M218 281.4c1.8 -.4 3.1 .6 3 2.2 -.1 1.6 -1.6 3.2 -3.6 3.4 -1.4 .1 -2.2 -.8 -1.6 -2 .6 -1.2 1.4 -2.2 2.2 -3.6Z" fill={p.robinBreast} />
          <path d="M221.1 281.9l1.5 .4 -1.5 .4Z" fill={p.ink} />
          <circle cx="219.8" cy="281.6" r=".45" fill={p.ink} />
          <path d="M215.8 287.3v1.2M217.4 287.3v1.2" stroke={p.ink} strokeWidth=".5" />
        </g>
      ) : null}

      {/* The pond: it mirrors the sky, with the duck's reflection, a glint, lilies and reeds. */}
      <g>
        <path d="M13 292C12 298 13.5 302 15 306M19 306C19 299 20 293 22 287M24 307C23.5 302 22 298 20 295" fill="none" stroke={p.reed} strokeWidth="1.3" strokeLinecap="round" />
        <rect x="10.6" y="286" width="2.8" height="7" rx="1.4" fill={p.cattail} transform="rotate(-10 12 290)" />
        <rect x="21" y="282.6" width="2.8" height="7" rx="1.4" fill={p.cattail} transform="rotate(12 22 286)" />
        <ellipse cx="60" cy="306" rx="49" ry="12.4" fill={p.pondEdge} />
        <ellipse cx="60" cy="305" rx="45" ry="9.6" fill={`url(#${id('water')})`} />
        <g clipPath={`url(#${id('pond')})`}>
          <rect x="15" y="295" width="90" height="3.2" fill={look.water[0]} opacity="0.7" />
          <ellipse cx="73" cy="309" rx="14" ry="2.6" fill={p.duckShade} opacity="0.34" />
          <ellipse cx="84.5" cy="311.6" rx="4" ry="1.6" fill={p.duckHead} opacity="0.28" />
          {look.glint.strength > 0.02 ? (
            <g fill={look.glint.colour} opacity={+look.glint.strength.toFixed(3)}>
              <ellipse cx="40" cy="300" rx="9" ry="1.1" />
              <ellipse cx="46" cy="303.4" rx="5" ry=".8" />
            </g>
          ) : null}
          <path d="M57.4 306.3q17 2.2 33.6 -.2" fill="none" stroke="#fff" strokeWidth=".8" strokeLinecap="round" opacity=".45" />
          <path d="M24 307.5h10M50 312h8M92 304.6h7" stroke="#fff" strokeWidth=".9" strokeLinecap="round" opacity={+(0.3 * (1 - look.stars.bright * 0.7)).toFixed(3)} />
        </g>
        <path d="M89 306.5a6.2 2.4 0 1 0 6.6 -1.6l-6.6 1.6Z" fill={p.lily} />
        <path d="M97 302.4a3.6 1.5 0 1 0 3.8 -1l-3.8 1Z" fill={p.lily} opacity=".9" />
        {look.blooms === 'summer' ? <circle cx="92.4" cy="304.6" r="1.6" fill={p.pink} /> : null}
        <g fill={p.stoneDark} opacity="0.6">
          <ellipse cx="14" cy="309" rx="3.4" ry="2" />
          <ellipse cx="36" cy="317.6" rx="3.6" ry="1.7" />
          <ellipse cx="88" cy="317" rx="3.2" ry="1.6" />
        </g>
      </g>

      {/* Toadstools by the hedgehog. */}
      <g>
        <rect x="366.5" y="306" width="3" height="7" rx="1.3" fill={p.stalk} />
        <path d="M361.5 307.5a6.5 5.2 0 0 1 13 0Z" fill={p.toadstool} />
        <circle cx="365.5" cy="304.5" r="1" fill={p.white} />
        <circle cx="370.5" cy="304" r="1.2" fill={p.white} />
        <rect x="376.5" y="310" width="2.2" height="5" rx="1" fill={p.stalk} />
        <path d="M373.2 311.2a4.4 3.6 0 0 1 8.8 0Z" fill={p.toadstool} />
        <circle cx="377.5" cy="309" r=".8" fill={p.white} />
      </g>

      {/* Grass, wild flowers and, in autumn, fallen leaves. */}
      <Tuft x={8} y={324} p={p} />
      <Tuft x={118} y={321} p={p} k={0.8} />
      <Tuft x={166} y={321} p={p} />
      <Tuft x={276} y={324} p={p} k={0.9} />
      <Tuft x={316} y={322} p={p} k={0.8} />
      <Tuft x={386} y={318} p={p} k={0.8} />
      {flowers
        ? (
            [
              [150, 316], [176, 320], [264, 320], [290, 322], [304, 316], [352, 322], [110, 318],
            ] as const
          ).map(([x, y], i) => <Flower key={i} x={x} y={y} c={i % 3 === 0 ? p.white : bloomCols[i % 4]} p={p} r={1.1} />)
        : null}
      {look.leaves
        ? FALLEN.map(([x, y, a], i) => (
            <ellipse key={i} cx={x} cy={y} rx="2" ry="1" transform={`rotate(${a} ${x} ${y})`} fill={i % 3 ? p.orange : p.apple} opacity="0.85" />
          ))
        : null}

      {/* The hedgehog's shadow. */}
      <ellipse cx={f1(343 + lean * 0.4)} cy="315.5" rx={f1(17 + Math.abs(lean) * 0.3)} ry="2.6" fill={p.shadow} opacity={+(shade * 1.1).toFixed(3)} />

      {/* Lamplight spilling out at night onto the step and down the path. */}
      {lampGlow > 0.01 ? (
        <g opacity={+lampGlow.toFixed(3)}>
          <ellipse cx="236" cy="295" rx="34" ry="7" fill={`url(#${id('spill')})`} opacity={+g.toFixed(3)} />
          <path d={PATH} fill={`url(#${id('pathLight')})`} opacity={+g.toFixed(3)} />
        </g>
      ) : null}

      {/* Golden-hour warmth from the sun's side. */}
      {look.golden > 0.02 ? <rect {...FULL} y="0" fill={`url(#${id('warm')})`} opacity={+look.golden.toFixed(3)} /> : null}
    </svg>
  );
}
