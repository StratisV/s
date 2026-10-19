// The scenes outside (and the garden room, which looks out): under the day's sky, or the
// moon and stars in the evening.
import type { ReactNode } from 'react';
import { mixColour } from '../../lib/logic/sky';
import { Border, Fence, FairyLights, Glow, Hills, LIGHT, Moon, Plant, Robin, Shadow, Sky, Steam, Stars, VGrad, W, url, type Ctx } from './kit';
import s from './AreaArt.module.css';

type Scene = (props: { c: Ctx }) => JSX.Element;

/** The lawn from `top` down, with the mower's stripes. */
function Lawn({ c, top }: { c: Ctx; top: number }) {
  const { p } = c;
  const bands: ReactNode[] = [];
  for (let i = -5; i < 5; i += 2) {
    bands.push(<path key={i} d={`M${84 + i * 16} ${top}H${84 + (i + 1) * 16}L${84 + (i + 1) * 44} 140H${84 + i * 44}Z`} />);
  }
  return (
    <g>
      <defs>
        <VGrad id={c.id('lawn')} stops={[[0, p.ground], [1, p.ground2]]} />
      </defs>
      <rect y={top} width={W} height={140 - top} fill={url(c, 'lawn')} />
      <g fill="#FFFFFF" opacity={c.evening ? 0.03 : 0.09}>
        {bands}
      </g>
    </g>
  );
}

/** A round tree whose trunk stands at x, y: apples (0), blossom (1) or plain green (2). */
function Tree({ c, x, y, fruit }: { c: Ctx; x: number; y: number; fruit: number }) {
  const { p } = c;
  const canopy = p.leaf;
  return (
    <g>
      <Shadow c={c} x={x} y={y} rx={20} ry={3} />
      <path d={`M${x - 3} ${y}L${x - 2} ${y - 34}L${x - 9} ${y - 44}M${x - 2} ${y - 34}L${x + 6} ${y - 46}M${x + 3} ${y}L${x + 2} ${y - 36}`} stroke={p.wood2} strokeWidth="4" strokeLinecap="round" fill="none" />
      <path d={`M${x - 3.4} ${y}h7l-1.4-36h-4.2z`} fill={p.wood2} />
      <circle cx={x - 12} cy={y - 50} r="15" fill={p.leaf2} />
      <circle cx={x + 12} cy={y - 52} r="16" fill={p.leaf2} />
      <circle cx={x} cy={y - 64} r="17" fill={canopy} />
      <circle cx={x - 14} cy={y - 56} r="12" fill={canopy} />
      <circle cx={x + 13} cy={y - 60} r="12" fill={canopy} />
      <circle cx={x - 5} cy={y - 70} r="8" fill={p.leafLight} opacity="0.7" />
      {fruit === 2 ? null : (
        <g fill={fruit === 0 ? '#F2574A' : '#FFD6E2'}>
          {[
            [-14, -54],
            [8, -66],
            [16, -50],
            [-4, -58],
            [-18, -66],
            [4, -78],
          ].map(([dx, dy]) => (
            <circle key={`${dx}${dy}`} cx={x + dx} cy={y + dy} r={fruit === 0 ? 2.4 : 2.1} />
          ))}
        </g>
      )}
    </g>
  );
}

// ---------------------------------------------------------------- garden

/** The lawn with its stripes, a picket fence with a robin on the post, flowers, a tree. */
export const Garden: Scene = ({ c }) => {
  const { p, alt, detail } = c;
  return (
    <g>
      <Sky c={c} low={90} sunX={124} />
      <Hills c={c} y={72} />
      <Lawn c={c} top={84} />
      <Fence c={c} x0={-4} x1={172} y={60} h={30} />
      {/* The robin's post. */}
      <rect x="104" y="56" width="9" height="36" rx="1" fill={p.trim} />
      <rect x="102.6" y="54" width="11.8" height="3.4" rx="1" fill={mixColour(p.trim, p.shadow, 0.12)} />
      <Robin c={c} x={108.6} y={54.4} k={1.1} />
      <Border c={c} x0={-2} x1={174} y={97} flowers={[p.accent, '#FF8FAE', '#FFD24E', p.white, '#B5A0F4']} />
      {alt ? (
        // A bench under the tree's shade, the tree on the other side.
        <g>
          <Tree c={c} x={140} y={112} fruit={detail} />
          <Shadow c={c} x={44} y={124} rx={28} ry={3} />
          <rect x="20" y="104" width="48" height="4" rx="1.6" fill={p.wood} />
          <rect x="20" y="110" width="48" height="4" rx="1.6" fill={p.wood} />
          <rect x="18" y="114" width="52" height="4" rx="1.6" fill={p.wood2} />
          <rect x="22" y="118" width="3" height="7" fill={p.wood2} />
          <rect x="63" y="118" width="3" height="7" fill={p.wood2} />
        </g>
      ) : (
        <g>
          <Tree c={c} x={28} y={114} fruit={detail} />
          {/* A watering can on the lawn. */}
          <g transform="translate(130 124)">
            <ellipse cx="2" cy="0" rx="13" ry="2.2" fill={p.shadow} opacity="0.12" />
            <path d="M-8 0V-12c0-2 1-3 3-3h10c2 0 3 1 3 3V0z" fill={p.accent} />
            <path d="M8 -9l9-8 2 2-9 9z" fill={p.accent} />
            <path d="M17 -18l3 -2 2 4-3 1z" fill={mixColour(p.accent, p.shadow, 0.2)} />
            <path d="M-5 -15c0-6 10-6 10 0" fill="none" stroke={mixColour(p.accent, p.shadow, 0.2)} strokeWidth="1.6" />
          </g>
        </g>
      )}
    </g>
  );
};

// ---------------------------------------------------------------- front garden

/** A wheelie bin standing at x, y (its base). */
function Bin({ c, x, y, colour }: { c: Ctx; x: number; y: number; colour: string }) {
  const lid = mixColour(colour, c.p.shadow, 0.22);
  return (
    <g>
      <Shadow c={c} x={x + 10} y={y} rx={13} ry={2.4} />
      <path d={`M${x} ${y - 30}H${x + 20}L${x + 18.4} ${y - 2}H${x + 1.6}Z`} fill={colour} />
      <path d={`M${x + 14} ${y - 30}H${x + 20}L${x + 18.4} ${y - 2}H${x + 13.6}Z`} fill={c.p.shadow} opacity="0.12" />
      <rect x={x - 1.6} y={y - 34} width="23.2" height="5" rx="1.6" fill={lid} />
      <rect x={x + 4} y={y - 36} width="12" height="2.4" rx="1.2" fill={lid} />
      <circle cx={x + 4} cy={y - 1} r="2.6" fill={c.p.ink} />
    </g>
  );
}

/** A small hedgehog facing left, its feet at x, y. */
function Hedgehog({ c, x, y }: { c: Ctx; x: number; y: number }) {
  const night = (col: string) => (c.evening ? mixColour(col, '#1D2452', 0.4) : col);
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="2" cy="0" rx="10" ry="1.6" fill={c.p.shadow} opacity="0.14" />
      <path d="M-2 -1C-3 -7 1 -11 7 -11.4L5 -13.6 9 -12.4 9.6 -15.4 11.6 -12 14 -14 14.4 -10.4 17.4 -11 16.4 -7.6 19 -6.4 16.6 -4.6C16.6 -1 13 0 9 0H0z" fill={night('#8C5A2E')} />
      <path d="M-2 -1C-4 -4-7 -5-9.4 -4.4-10.4 -3.4-9.6 -2-8 -1.6-5.4 -1-3.4 -0.6-2 -1Z" fill={night('#EECBA0')} />
      <path d="M-2 -1C-3 -5-1 -8 3 -8.6-1 -6-1 -3 0 -0.4Z" fill={night('#EECBA0')} />
      <circle cx="-9.6" cy="-3.4" r="1" fill={c.p.ink} />
      <circle cx="-5" cy="-4.4" r="0.8" fill={c.p.ink} />
    </g>
  );
}

/** A pastel house front: the door with its fanlight, the path to the gate, the bins out. */
export const FrontGarden: Scene = ({ c }) => {
  const { p, detail } = c;
  const lit = c.evening;
  const sash = (x: number) => (
    <g>
      <rect x={x - 3} y="31" width="38" height="46" rx="1.6" fill={p.trim} />
      <rect x={x} y="34" width="32" height="40" fill={lit ? LIGHT.lit : url(c, 'glass')} opacity={lit ? 0.9 : 1} />
      {lit ? (
        <g fill={p.accent2} opacity="0.85">
          <path d={`M${x} 34h7c-1 10-3 22 0 40h-7z`} />
          <path d={`M${x + 32} 34h-7c1 10 3 22 0 40h7z`} />
        </g>
      ) : (
        <path d={`M${x + 20} 34l-14 40h6l14-40z`} fill="#FFFFFF" opacity="0.3" />
      )}
      <path d={`M${x} 54h32M${x + 16} 34v40`} stroke={p.trim} strokeWidth="2" />
      <path d={`M${x - 2} 78c4-4 32-4 36 0`} fill={p.leaf2} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle key={i} cx={x + 1 + i * 6} cy={i % 2 ? 75.6 : 74.6} r="1.9" fill={[p.accent, '#FF8FAE', '#FFD24E'][i % 3]} />
      ))}
      <rect x={x - 3} y="78" width="38" height="4" rx="1.2" fill={p.wood2} />
    </g>
  );
  return (
    <g>
      <Sky c={c} low={40} sunX={148} />
      <rect y="16" width={W} height="88" fill={p.panel} />
      <rect y="16" width={W} height="88" fill={p.shadow} opacity="0.03" />
      <rect x="-2" y="12" width="172" height="6" fill={p.trim} />
      <rect y="18" width={W} height="2" fill={p.shadow} opacity="0.1" />
      {sash(10)}
      {sash(126)}
      {/* Door, fanlight, lantern and steps. */}
      <rect x="64" y="34" width="40" height="70" fill={p.trim} />
      <path d="M68 50a16 12 0 0 1 32 0z" fill={lit ? LIGHT.lit : url(c, 'glass')} />
      <path d="M84 50V39M84 50L74 42M84 50L94 42" stroke={p.trim} strokeWidth="1.2" />
      <rect x="69" y="52" width="30" height="52" fill={p.accent} />
      <rect x="92" y="52" width="7" height="52" fill={p.shadow} opacity="0.1" />
      <g fill={mixColour(p.accent, p.shadow, 0.22)} opacity="0.55">
        <rect x="73" y="57" width="10" height="18" rx="1.4" />
        <rect x="85" y="57" width="10" height="18" rx="1.4" />
        <rect x="73" y="81" width="10" height="18" rx="1.4" />
        <rect x="85" y="81" width="10" height="18" rx="1.4" />
      </g>
      <rect x="79" y="76.4" width="10" height="2.4" rx="1" fill={p.brass} />
      <circle cx="94" cy="84" r="1.5" fill={p.brass} />
      <Glow c={c} x={110} y={60} r={26} />
      <rect x="107" y="55" width="6" height="9" rx="1.6" fill={lit ? LIGHT.lamp : p.glassLow} stroke={p.ink} strokeOpacity="0.7" strokeWidth="1" />
      <path d="M106 55h8l-4-3.4z" fill={p.ink} opacity="0.75" />
      {c.alt
        ? // Bay trees in pots either side of the door.
          [57, 111].map((x) => (
            <g key={x}>
              <path d={`M${x} 98V84`} stroke={p.wood2} strokeWidth="1.4" />
              <circle cx={x} cy="80" r="7" fill={p.leaf2} />
              <circle cx={x - 2} cy="78" r="3" fill={p.leafLight} opacity="0.6" />
              <path d={`M${x - 5} 96h10l-1.4 7h-7.2z`} fill={p.pot} />
            </g>
          ))
        : null}
      <rect x="60" y="102" width="48" height="4" rx="1" fill={p.stone} />
      <rect x="56" y="105.6" width="56" height="4" rx="1" fill={p.stone2} />

      {/* The front garden: lawn, the path, bins, the gate in a low wall. */}
      <rect y="109" width={W} height="31" fill={p.ground} />
      <path d="M62 109.6H106L118 140H50Z" fill={p.stone} />
      <path d="M60 118h48M57 128h54" stroke={p.stone2} strokeWidth="1.2" />
      <Bin c={c} x={8} y={118} colour={detail === 1 ? '#3D73C2' : '#3E8A5C'} />
      <Bin c={c} x={32} y={118} colour="#3B4352" />
      {detail === 0 ? <Hedgehog c={c} x={124} y={121} /> : null}
      <g fill={p.leaf}>
        <circle cx="132" cy="112" r="7" />
        <circle cx="146" cy="110" r="8" />
        <circle cx="160" cy="112" r="7" />
      </g>
      <g>
        {[136, 148, 158].map((x, i) => (
          <circle key={x} cx={x} cy={i % 2 ? 106 : 108} r="1.8" fill={[p.accent, '#FF8FAE', '#FFD24E'][i]} />
        ))}
      </g>
      <rect x="-2" y="124" width="56" height="16" fill={p.brick} />
      <rect x="114" y="124" width="56" height="16" fill={p.brick} />
      <g stroke={p.brick2} strokeWidth="0.8" opacity="0.6">
        <path d="M-2 130H54M114 130H170M-2 136H54M114 136H170" />
        <path d="M10 124v6M30 124v6M46 124v6M20 130v6M40 130v6M124 124v6M144 124v6M160 124v6M134 130v6M154 130v6" />
      </g>
      <rect x="-3" y="121" width="58" height="4" rx="1" fill={p.stone} />
      <rect x="113" y="121" width="58" height="4" rx="1" fill={p.stone} />
      {/* The gate. */}
      <rect x="53" y="116" width="6" height="24" rx="1" fill={p.stone2} />
      <rect x="109" y="116" width="6" height="24" rx="1" fill={p.stone2} />
      <g fill={p.ink} opacity="0.85">
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x={62 + i * 6} y="120" width="1.8" height="20" />
        ))}
        <path d="M59 121Q84 114 109 121v2Q84 116 59 123z" />
        <rect x="59" y="131" width="50" height="1.8" />
      </g>
    </g>
  );
};

// ---------------------------------------------------------------- garden room

/** A timber garden room looking out at the garden: fairy lights, a cushioned sofa or a hanging chair. */
export const GardenRoom: Scene = ({ c }) => {
  const { p, alt } = c;
  const timber = mixColour(p.wood, p.wall, 0.45);
  const rattan = p.wood2;
  return (
    <g>
      <rect width={W} height="100" fill={timber} />
      <g stroke={p.wood2} strokeWidth="0.8" opacity="0.4">
        {Array.from({ length: 14 }, (_, i) => (
          <path key={i} d={`M${6 + i * 12} 0V100`} />
        ))}
      </g>
      <rect y="100" width={W} height="40" fill={p.wood} />
      <path d="M0 110H168M0 121H168M0 132H168" stroke={p.wood2} strokeWidth="1" opacity="0.6" />
      <rect y="100" width={W} height="2" fill={p.shadow} opacity="0.12" />

      {/* Glazed doors onto the garden. */}
      <clipPath id={c.id('view')}>
        <rect x="36" y="18" width="96" height="76" />
      </clipPath>
      <rect x="32" y="14" width="104" height="84" rx="2" fill={p.trim} />
      <g clipPath={`url(#${c.id('view')})`}>
        <rect x="36" y="18" width="96" height="76" fill={url(c, 'glass')} />
        {c.evening ? (
          <g>
            <Stars pts={[[50, 28, 1.2], [70, 22, 0.7], [104, 30, 0.8], [62, 40, 0.6]]} />
            <Moon c={c} x={114} y={32} r={6} />
          </g>
        ) : null}
        <path d="M36 70C52 60 64 66 76 62S104 56 132 64V94H36Z" fill={p.leaf2} />
        <path d="M36 80C60 74 92 76 132 78V94H36Z" fill={p.ground} />
        <circle cx="54" cy="64" r="10" fill={p.leaf} />
        <circle cx="116" cy="62" r="12" fill={p.leaf} />
        {c.evening ? null : <path d="M100 18l-30 76h12l30-76z" fill="#FFFFFF" opacity="0.18" />}
      </g>
      <path d="M68 18V94M100 18V94" stroke={p.trim} strokeWidth="3" />
      <FairyLights c={c} x0={-6} x1={174} y={6} sag={7} n={9} swags={2} />

      {/* A lantern and a potted olive tree. */}
      <Glow c={c} x={16} y={104} r={26} />
      <rect x="10" y="100" width="12" height="16" rx="2" fill="none" stroke={p.ink} strokeWidth="1.4" opacity="0.8" />
      <path d="M9 100l7-5 7 5z" fill={p.ink} opacity="0.8" />
      <rect x="14" y="106" width="4" height="8" rx="1" fill={c.evening ? LIGHT.lamp : p.white} />
      <Shadow c={c} x={152} y={120} rx={14} ry={2.6} />
      <path d="M144 106h16l-2 14h-12z" fill={p.stone} />
      <path d="M152 106V80" stroke={p.wood2} strokeWidth="1.6" />
      <g fill={mixColour(p.leaf, '#A9B8A0', 0.45)}>
        <ellipse cx="146" cy="76" rx="8" ry="6" />
        <ellipse cx="158" cy="72" rx="8" ry="7" />
        <ellipse cx="152" cy="66" rx="7" ry="6" />
      </g>

      {alt ? (
        // A hanging egg chair with a cushion, a side table with a mug.
        <g>
          <path d="M80 122C80 80 96 50 118 46" fill="none" stroke={p.ink} strokeWidth="2.6" opacity="0.75" />
          <path d="M72 122h24" stroke={p.ink} strokeWidth="3" strokeLinecap="round" opacity="0.75" />
          <path d="M112 47V58" stroke={p.ink} strokeWidth="1" opacity="0.7" />
          <Shadow c={c} x={112} y={124} rx={20} ry={3} />
          <path d="M112 58C96 58 90 76 92 92 94 106 102 112 112 112 122 112 130 106 132 92 134 76 128 58 112 58Z" fill={rattan} />
          <path d="M112 64C101 64 97 78 98 90 99 100 104 104 112 104 120 104 125 100 126 90 127 78 123 64 112 64Z" fill={mixColour(rattan, p.shadow, 0.25)} />
          <rect x="99" y="86" width="26" height="14" rx="6" fill={p.main} />
          <rect x="103" y="76" width="16" height="12" rx="4" fill={p.accent} />
          <g stroke={mixColour(rattan, p.white, 0.25)} strokeWidth="0.7" opacity="0.6" fill="none">
            <path d="M94 80c6 2 30 2 36 0M93 92c6 2 32 2 38 0" />
          </g>
          <rect x="48" y="100" width="18" height="3" rx="1.2" fill={p.wood2} />
          <rect x="55.6" y="103" width="2.8" height="18" fill={p.wood2} />
          <rect x="52" y="92" width="7" height="8" rx="1.6" fill={p.accent2} />
        </g>
      ) : (
        // A rattan sofa with deep cushions.
        <g>
          <Shadow c={c} x={84} y={122} rx={58} ry={3.4} />
          <rect x="34" y="72" width="100" height="40" rx="5" fill={rattan} />
          <g stroke={mixColour(rattan, p.white, 0.28)} strokeWidth="0.8" opacity="0.55">
            <path d="M34 80H134M34 88H134M34 96H134M34 104H134" />
          </g>
          <rect x="28" y="84" width="14" height="30" rx="4" fill={rattan} />
          <rect x="126" y="84" width="14" height="30" rx="4" fill={rattan} />
          <rect x="40" y="66" width="43" height="24" rx="6" fill={p.main} />
          <rect x="85" y="66" width="43" height="24" rx="6" fill={p.main} />
          <rect x="40" y="88" width="88" height="12" rx="4" fill={mixColour(p.main, p.white, 0.12)} />
          <rect x="48" y="72" width="16" height="15" rx="4" fill={p.accent} transform="rotate(-8 56 79.5)" />
          <rect x="104" y="72" width="16" height="15" rx="4" fill={p.accent2} transform="rotate(8 112 79.5)" />
          <rect x="38" y="112" width="3" height="8" fill={p.wood2} />
          <rect x="127" y="112" width="3" height="8" fill={p.wood2} />
        </g>
      )}
    </g>
  );
};

// ---------------------------------------------------------------- hot tub

/** A wooden hot tub on the deck, bubbling and steaming, rolled towels on the step. */
export const HotTub: Scene = ({ c }) => {
  const { p } = c;
  const cx = 84;
  const cy = 72;
  const rx = 54;
  const ry = 11;
  const yAt = (x: number) => cy + ry * Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2));
  return (
    <g>
      <Sky c={c} low={60} sunX={30} />
      {/* A slatted fence with climbers. */}
      <rect x="-2" y="26" width="172" height="74" fill={p.wood} />
      <g fill={p.wood2} opacity="0.55">
        {Array.from({ length: 10 }, (_, i) => (
          <rect key={i} x="-2" y={32 + i * 7} width="172" height="1.4" />
        ))}
      </g>
      <g fill={p.leaf}>
        <circle cx="8" cy="30" r="9" />
        <circle cx="20" cy="26" r="7" />
        <circle cx="152" cy="28" r="10" />
        <circle cx="164" cy="34" r="8" />
      </g>
      <g fill={p.accent}>
        <circle cx="12" cy="26" r="1.8" />
        <circle cx="150" cy="24" r="1.8" />
        <circle cx="160" cy="31" r="1.6" />
      </g>
      <rect y="100" width={W} height="40" fill={p.wood2} />
      <path d="M0 110H168M0 121H168M0 132H168" stroke={p.wood} strokeWidth="1" opacity="0.6" />
      <defs>
        <VGrad id={c.id('water')} stops={[[0, p.water2], [1, p.water]]} />
        <radialGradient id={c.id('pool')}>
          <stop offset="0" stopColor="#8FF4FF" stopOpacity="0.75" />
          <stop offset="1" stopColor="#8FF4FF" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* The tub. */}
      <Shadow c={c} x={cx} y={124} rx={60} ry={4} />
      <path d={`M${cx - rx} ${cy}A${rx} ${ry} 0 0 0 ${cx + rx} ${cy}V112A${rx} ${ry} 0 0 1 ${cx - rx} 112Z`} fill={p.wood} />
      <g stroke={p.wood2} strokeWidth="1" opacity="0.6">
        {Array.from({ length: 9 }, (_, i) => {
          const x = cx - rx + 12 + i * 10.5;
          return <path key={i} d={`M${x.toFixed(1)} ${yAt(x).toFixed(1)}V${(yAt(x) + 40).toFixed(1)}`} />;
        })}
      </g>
      <path d={`M${cx + 30} ${yAt(cx + 30)}A${rx} ${ry} 0 0 0 ${cx + rx} ${cy}V112A${rx} ${ry} 0 0 1 ${cx + 30} ${yAt(cx + 30) + 40}Z`} fill={p.shadow} opacity="0.12" />
      {[86, 104].map((y) => (
        <path key={y} d={`M${cx - rx} ${y}A${rx} ${ry} 0 0 0 ${cx + rx} ${y}`} fill="none" stroke={p.metal2} strokeWidth="2" />
      ))}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={p.wood2} />
      <ellipse cx={cx} cy={cy + 0.6} rx={rx - 4} ry={ry - 2.6} fill={url(c, 'water')} />
      {c.evening ? <ellipse cx={cx} cy={cy} rx={rx - 2} ry={ry + 6} fill={url(c, 'pool')} /> : null}
      <path d={`M${cx - 30} ${cy - 2}q6-2.4 12 0M${cx + 8} ${cy + 3}q6-2.4 12 0M${cx - 8} ${cy - 5}q5-2 10 0`} fill="none" stroke="#FFFFFF" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
      <g fill="#FFFFFF">
        {[
          [-36, 1, 1.6],
          [-20, 3, 1.2],
          [22, -3, 1.4],
          [36, 2, 1.8],
          [-2, 4, 1.1],
        ].map(([dx, dy, r]) => (
          <circle key={dx} cx={cx + dx} cy={cy + dy} r={r} opacity="0.85" />
        ))}
        <circle className={s.bubble} cx={cx - 14} cy={cy - 4} r="1.6" opacity="0.9" />
        <circle className={s.bubble} style={{ animationDelay: '-1.4s' }} cx={cx + 16} cy={cy - 3} r="1.3" opacity="0.9" />
        <circle className={s.bubble} style={{ animationDelay: '-2.3s' }} cx={cx + 2} cy={cy - 6} r="1.1" opacity="0.9" />
      </g>
      <Steam c={c} x={cx - 18} y={cy - 6} k={1.1} />
      <Steam c={c} x={cx + 20} y={cy - 8} k={0.9} />

      {/* A step with rolled towels; a lantern at night. */}
      <rect x="6" y="108" width="28" height="20" rx="2" fill={p.wood} />
      <path d="M6 116h28" stroke={p.wood2} strokeWidth="1" />
      {[
        [13, p.accent],
        [26, p.accent2],
      ].map(([x, fill]) => (
        <g key={x as number}>
          <circle cx={x as number} cy="102" r="6" fill={fill as string} />
          <path d={`M${x} 102m-3.4 0a3.4 3.4 0 1 0 3.4 -3.4`} fill="none" stroke={p.white} strokeWidth="1" opacity="0.7" />
        </g>
      ))}
      <Glow c={c} x={152} y={106} r={22} />
      {c.alt ? (
        // A parasol.
        <g>
          <path d="M150 128V44" stroke={p.ink} strokeWidth="1.6" opacity="0.8" />
          <path d="M118 52Q150 24 182 52Z" fill={p.accent} />
          <path d="M118 52q4 4 8 0 4 4 8 0 4 4 8 0 4 4 8 0 4 4 8 0 4 4 8 0 4 4 8 0 4 4 8 0z" fill={p.accent} />
          <path d="M150 34L136 52M150 34L164 52" stroke="#FFFFFF" strokeWidth="1.2" opacity="0.45" />
          <rect x="143" y="126" width="14" height="3" rx="1" fill={p.ink} opacity="0.8" />
        </g>
      ) : (
        <Plant c={c} x={154} y={124} k={1} kind={1} />
      )}
    </g>
  );
};

// ---------------------------------------------------------------- balcony

/** A London balcony: the skyline with the Shard, a little table for two, plants by the railing. */
export const Balcony: Scene = ({ c }) => {
  const { p, detail } = c;
  const far = p.haze;
  const near = mixColour(far, p.shadow, c.evening ? 0.2 : 0.12);
  const blocks: readonly (readonly [number, number, number])[] = [
    [-2, 74, 18],
    [16, 66, 14],
    [30, 80, 20],
    [52, 60, 12],
    [64, 72, 16],
    [86, 78, 14],
    [134, 70, 16],
    [150, 62, 20],
  ];
  return (
    <g>
      <Sky c={c} low={100} sunX={42} />
      {/* The skyline, and the Shard. */}
      <path d="M118 100L124.6 24L126 20L127.4 24L134 100Z" fill={far} />
      <path d="M126 20L127.4 24L134 100H128Z" fill="#FFFFFF" opacity={c.evening ? 0.05 : 0.18} />
      {c.evening ? <circle cx="126" cy="21" r="1.4" fill="#FF6A5A" className={s.twinkle} /> : null}
      <g fill={far}>
        {blocks.map(([x, y, w]) => (
          <rect key={x} x={x} y={y} width={w} height={100 - y} />
        ))}
      </g>
      <path d="M100 100V88h10v-6h8v18z" fill={near} />
      {c.evening ? (
        <g fill={LIGHT.lit} opacity="0.85">
          {[
            [4, 80],
            [20, 72],
            [36, 86],
            [56, 66],
            [68, 78],
            [90, 84],
            [140, 76],
            [156, 70],
            [160, 82],
          ].map(([x, y]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width="2" height="2.4" />
          ))}
        </g>
      ) : null}

      {/* The balcony floor and railing. */}
      <rect y="100" width={W} height="40" fill={p.floor} />
      <path d="M0 112H168M0 126H168M28 100V140M70 100V140M112 100V140M154 100V140" stroke={p.floor2} strokeWidth="1" opacity="0.8" />
      <g fill={p.ink} opacity="0.82">
        <rect x="-2" y="70" width="172" height="3" rx="1.4" />
        <rect x="-2" y="98" width="172" height="2.4" />
        {Array.from({ length: 22 }, (_, i) => (
          <rect key={i} x={2 + i * 8} y="73" width="1.6" height="25" />
        ))}
      </g>

      {/* Plants either side. */}
      <path d="M8 120h20l-2 16H10z" fill={p.main} />
      <g stroke={p.leaf} strokeWidth="1.6" strokeLinecap="round" fill="none">
        <path d="M18 120C16 104 10 96 4 92M18 120C18 102 20 92 24 84M18 120C20 106 26 100 32 98M18 120C14 108 12 104 8 102" />
      </g>
      <Plant c={c} x={152} y={134} k={1} kind={detail === 2 ? 2 : 0} />

      {c.alt ? (
        // A striped deckchair and a drink.
        <g>
          <Shadow c={c} x={86} y={130} rx={28} ry={3} />
          <path d="M66 130L90 94M104 130L80 104" stroke={p.wood2} strokeWidth="2.4" strokeLinecap="round" />
          <path d="M88 96L71 126L86 129L102 99Z" fill={p.accent} />
          <path d="M92 97L76 127.4M96.6 98L81 128.4" stroke={p.white} strokeWidth="2.2" />
          <rect x="110" y="116" width="11" height="14" rx="1" fill={p.wood} />
          <rect x="112.6" y="108" width="5.4" height="8" rx="1.2" fill={p.accent2} />
        </g>
      ) : (
        // A table for two, a cup on it.
        <g>
          <Shadow c={c} x={84} y={130} rx={30} ry={3} />
          <g fill="none" stroke={p.ink} strokeWidth="1.6" opacity="0.85">
            <path d="M54 130V112M54 112c0-10 4-16 10-16" />
            <path d="M60 112H70V130" />
            <path d="M114 130V112M114 112c0-10-4-16-10-16" />
            <path d="M108 112H98V130" />
          </g>
          <rect x="52" y="110" width="20" height="3" rx="1.4" fill={p.accent} />
          <rect x="96" y="110" width="20" height="3" rx="1.4" fill={p.accent} />
          <ellipse cx="84" cy="104" rx="18" ry="3.4" fill={p.white} />
          <path d="M84 107V128M78 130h12" stroke={p.ink} strokeWidth="1.8" opacity="0.85" />
          <rect x="78" y="96" width="7" height="7" rx="1.6" fill={p.accent2} />
          <path d="M85 98c2.4 0 2.4 3.4 0 3.4" fill="none" stroke={p.accent2} strokeWidth="1.2" />
          <Steam c={c} x={81.4} y={95} k={0.42} />
          <rect x="89" y="99" width="5" height="4" rx="1" fill={p.main} />
        </g>
      )}
    </g>
  );
};
