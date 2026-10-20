// The whole home: a doll's house with its front taken off, every room in it at once (the
// Housekeeping tab's card for the tasks that belong to no one area). Under the day's sky, or
// lit room by room under the moon in the evening.
import { mixColour } from '../../lib/logic/sky';
import { CAT_COATS, Cat, Duck, Glow, Hills, LIGHT, Picture, Plant, Sky, Steam, VGrad, W, url, type Ctx } from './kit';

type Scene = (props: { c: Ctx }) => JSX.Element;

/** The four rooms a cell can hold. */
type RoomKind = 'bed' | 'bath' | 'kitchen' | 'living';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A small lamp shade hanging or standing at x, its rim at y: warm and glowing in the evening. */
function Shade({ c, x, y, colour }: { c: Ctx; x: number; y: number; colour: string }) {
  return (
    <g>
      <Glow c={c} x={x} y={y + 2} r={18} />
      <path d={`M${x - 3.2} ${y - 4.6}H${x + 3.2}L${x + 5} ${y}H${x - 5}Z`} fill={c.evening ? LIGHT.lamp : colour} />
      <path d={`M${x + 1.2} ${y - 4.6}H${x + 3.2}L${x + 5} ${y}H${x + 2.4}Z`} fill={c.evening ? LIGHT.halo : c.p.shadow} opacity={c.evening ? 0.4 : 0.12} />
    </g>
  );
}

/** A bedroom: the bed, its duvet and pillow, a picture over it and a lamp on the bedside table. */
function Bedroom({ c, b }: { c: Ctx; b: Box }) {
  const { p, detail } = c;
  const floor = b.y + b.h;
  return (
    <g>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={mixColour(p.accent2, p.wall, 0.4)} />
      <Picture c={c} x={b.x + 20} y={b.y + 5} w={11} h={7} art={detail} />
      <rect x={b.x + 5} y={floor - 15} width="3.6" height="15" rx="1.6" fill={p.wood2} />
      <rect x={b.x + 7} y={floor - 8} width="35" height="6" rx="1.4" fill={p.white} />
      <path d={`M${b.x + 15} ${floor - 10.4}h24.6c2.2 0 3.4 1.2 3.4 3.4V${floor - 2}H${b.x + 15}Z`} fill={p.main} />
      <path d={`M${b.x + 15} ${floor - 5.4}H${b.x + 43}V${floor - 2}H${b.x + 15}Z`} fill={p.main2} opacity="0.55" />
      <ellipse cx={b.x + 11.6} cy={floor - 9.4} rx="4.4" ry="2.4" fill={p.white} />
      <rect x={b.x + 46} y={floor - 8} width="8" height="8" rx="1" fill={p.wood} />
      <rect x={b.x + 49.4} y={floor - 12} width="1.2" height="4" fill={p.ink} opacity="0.7" />
      <Shade c={c} x={b.x + 50} y={floor - 11.6} colour={p.white} />
    </g>
  );
}

/** A bathroom: tiles, the bath with the green duck in it, a round mirror and a towel. */
function Bathroom({ c, b }: { c: Ctx; b: Box }) {
  const { p } = c;
  const floor = b.y + b.h;
  const grout = mixColour(p.tile, p.main, 0.35);
  const lines: string[] = [];
  for (let y = b.y + 6; y < floor; y += 6) lines.push(`M${b.x} ${y}H${b.x + b.w}`);
  for (let x = b.x + 6; x < b.x + b.w; x += 6) lines.push(`M${x} ${b.y}V${floor}`);
  return (
    <g>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={p.tile} />
      <path d={lines.join('')} stroke={grout} strokeWidth="0.6" opacity="0.6" />
      <Glow c={c} x={b.x + 47} y={b.y + 9} r={16} k={0.7} />
      <circle cx={b.x + 47} cy={b.y + 10} r="5.6" fill={p.trim} />
      <circle cx={b.x + 47} cy={b.y + 10} r="4.4" fill={c.evening ? p.metal : url(c, 'glass')} />
      <rect x={b.x + 43} y={floor - 15} width="9" height="11" rx="1.4" fill={p.accent} />
      <rect x={b.x + 42} y={floor - 16} width="11" height="2" rx="1" fill={p.metal2} />
      <path d={`M${b.x + 8} ${floor - 17}v-3.4h3.6`} stroke={p.metal2} strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <rect x={b.x + 5} y={floor - 12.4} width="34" height="2.6" rx="1.2" fill={p.white} />
      <rect x={b.x + 7} y={floor - 12} width="30" height="1.8" fill={p.water} />
      <Duck c={c} x={b.x + 24} y={floor - 11.6} k={0.42} bob />
      <g fill="#FFFFFF" opacity={c.evening ? 0.7 : 0.95}>
        <circle cx={b.x + 12} cy={floor - 13.6} r="2.2" />
        <circle cx={b.x + 15.6} cy={floor - 14.2} r="1.7" />
        <circle cx={b.x + 33} cy={floor - 13.4} r="1.9" />
      </g>
      <path d={`M${b.x + 6} ${floor - 10.4}H${b.x + 38}V${floor - 7}C${b.x + 38} ${floor - 3.4} ${b.x + 35.6} ${floor - 1.4} ${b.x + 32} ${floor - 1.4}H${b.x + 12}C${b.x + 8.4} ${floor - 1.4} ${b.x + 6} ${floor - 3.4} ${b.x + 6} ${floor - 7}Z`} fill={p.white} />
      <path d={`M${b.x + 30} ${floor - 10.4}H${b.x + 38}V${floor - 7}C${b.x + 38} ${floor - 3.4} ${b.x + 35.6} ${floor - 1.4} ${b.x + 32} ${floor - 1.4}H${b.x + 28}C${b.x + 31} ${floor - 3} ${b.x + 31} ${floor - 6} ${b.x + 30} ${floor - 10.4}Z`} fill={p.shadow} opacity="0.07" />
    </g>
  );
}

/** A kitchen: cupboards under the worktop, a pot steaming on the hob, jars on a shelf. */
function Kitchen({ c, b }: { c: Ctx; b: Box }) {
  const { p } = c;
  const floor = b.y + b.h;
  return (
    <g>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={p.wall} />
      <rect x={b.x + 31} y={b.y + 9} width="22" height="1.8" rx="0.8" fill={p.wood2} />
      <rect x={b.x + 33} y={b.y + 4} width="4.2" height="5" rx="1" fill={p.accent} />
      <rect x={b.x + 39} y={b.y + 3} width="4.2" height="6" rx="1" fill={p.leaf} />
      <rect x={b.x + 45} y={b.y + 4.6} width="5.4" height="4.4" rx="1" fill={p.main2} />
      <Glow c={c} x={b.x + 18} y={floor - 14} r={20} k={0.8} />
      <rect x={b.x + 3} y={floor - 11} width={b.w - 6} height="11" fill={p.main} />
      <path d={`M${b.x + 3 + (b.w - 6) / 3} ${floor - 10}V${floor}M${b.x + 3 + ((b.w - 6) * 2) / 3} ${floor - 10}V${floor}`} stroke={p.main2} strokeWidth="0.8" opacity="0.7" />
      <g fill={p.metal}>
        <rect x={b.x + 10} y={floor - 8} width="4" height="1.2" rx="0.6" />
        <rect x={b.x + 27} y={floor - 8} width="4" height="1.2" rx="0.6" />
        <rect x={b.x + 44} y={floor - 8} width="4" height="1.2" rx="0.6" />
      </g>
      <rect x={b.x + 2} y={floor - 13} width={b.w - 4} height="2.6" rx="1" fill={p.wood} />
      <Steam c={c} x={b.x + 18} y={floor - 21} k={0.5} />
      <rect x={b.x + 12} y={floor - 19.4} width="12" height="6.4" rx="1.6" fill={p.accent} />
      <rect x={b.x + 11} y={floor - 20.4} width="14" height="1.8" rx="0.9" fill={mixColour(p.accent, p.shadow, 0.25)} />
      <path d={`M${b.x + 9.6} ${floor - 17}h2.4M${b.x + 24} ${floor - 17}h2.4`} stroke={p.ink} strokeWidth="1" strokeLinecap="round" opacity="0.7" />
    </g>
  );
}

/** A living room: the sofa (with the cat on it, now and then), a floor lamp, a picture. */
function Living({ c, b }: { c: Ctx; b: Box }) {
  const { p, detail } = c;
  const floor = b.y + b.h;
  const sofa = p.accent;
  const sofa2 = mixColour(p.accent, p.shadow, 0.2);
  return (
    <g>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={mixColour(p.main, p.wall, 0.78)} />
      <Picture c={c} x={b.x + 14} y={b.y + 4.6} w={12} h={7.4} art={(detail + 1) % 3} />
      <ellipse cx={b.x + 22} cy={floor - 0.6} rx="20" ry="1.6" fill={p.accent2} opacity="0.8" />
      <rect x={b.x + 7} y={floor - 16} width="30" height="9" rx="3" fill={sofa2} />
      <rect x={b.x + 6} y={floor - 9.6} width="32" height="7" rx="2" fill={sofa} />
      <rect x={b.x + 3.4} y={floor - 12.6} width="6" height="10" rx="2.4" fill={sofa} />
      <rect x={b.x + 34.6} y={floor - 12.6} width="6" height="10" rx="2.4" fill={sofa} />
      {detail === 0 ? (
        <Cat c={c} x={b.x + 22} y={floor - 9.6} k={0.36} coat={CAT_COATS[c.alt ? 1 : 0]} />
      ) : (
        <rect x={b.x + 11} y={floor - 15} width="7" height="6" rx="2" fill={p.accent2} transform={`rotate(-8 ${b.x + 14.5} ${floor - 12})`} />
      )}
      <rect x={b.x + 48.4} y={floor - 21} width="1.2" height="21" fill={p.ink} opacity="0.75" />
      <ellipse cx={b.x + 49} cy={floor - 0.8} rx="3.6" ry="1" fill={p.ink} opacity="0.75" />
      <Shade c={c} x={b.x + 49} y={floor - 20} colour={p.accent2} />
      {detail === 1 ? <Plant c={c} x={b.x + 55} y={floor} k={0.34} kind={2} /> : null}
    </g>
  );
}

const ROOMS: Record<RoomKind, (props: { c: Ctx; b: Box }) => JSX.Element> = {
  bed: Bedroom,
  bath: Bathroom,
  kitchen: Kitchen,
  living: Living,
};

/** A room in its box, clipped to it, warmed by lamplight in the evening. */
function Cell({ c, kind, b }: { c: Ctx; kind: RoomKind; b: Box }) {
  const clip = c.id(`cell${b.x}-${b.y}`);
  const Room = ROOMS[kind];
  return (
    <g>
      <clipPath id={clip}>
        <rect x={b.x} y={b.y} width={b.w} height={b.h} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <Room c={c} b={b} />
        {/* The floorboards, and the shade under the floor above. */}
        <rect x={b.x} y={b.y + b.h - 1.6} width={b.w} height="1.6" fill={c.p.floor2} />
        <rect x={b.x} y={b.y} width={b.w} height="2.4" fill={c.p.shadow} opacity="0.1" />
        {c.evening ? <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={LIGHT.lamp} opacity="0.16" /> : null}
      </g>
    </g>
  );
}

/**
 * A doll's house standing on the lawn, its front off: the bedroom and the bathroom upstairs,
 * the kitchen and the living room below, an attic window in the roof and the chimney
 * smoking. The other composition swaps the rooms round, the chimney to the other side and a
 * square attic window.
 */
export const Home: Scene = ({ c }) => {
  const { p, alt } = c;
  const shell = mixColour(p.trim, p.wood, 0.28);
  const roof = mixColour(p.brick, p.main2, 0.22);
  const roof2 = mixColour(roof, p.shadow, 0.18);
  const chimneyX = alt ? 38 : 118;
  const lit = c.evening;
  const upstairs: [RoomKind, RoomKind] = alt ? ['bath', 'bed'] : ['bed', 'bath'];
  const downstairs: [RoomKind, RoomKind] = alt ? ['living', 'kitchen'] : ['kitchen', 'living'];
  return (
    <g>
      <defs>
        <VGrad id={c.id('lawn')} stops={[[0, p.ground], [1, p.ground2]]} />
      </defs>
      <Sky c={c} low={120} sunX={alt ? 26 : 142} />
      <Hills c={c} y={104} />
      <rect y="116" width={W} height="24" fill={url(c, 'lawn')} />

      {/* The chimney, behind the roof, smoking. */}
      <rect x={chimneyX} y="16" width="11" height="26" fill={p.brick} />
      <rect x={chimneyX + 7} y="16" width="4" height="26" fill={p.shadow} opacity="0.12" />
      <rect x={chimneyX - 2} y="13" width="15" height="4.4" rx="1" fill={p.brick2} />
      <Steam c={c} x={chimneyX + 5.5} y={12} k={0.62} />

      {/* The roof, the attic under it and its window. */}
      <path d="M5 50L84 7L163 50Z" fill={roof} />
      <path d="M84 7L163 50L142 46L84 15Z" fill={roof2} opacity="0.5" />
      <path d="M26 46L84 16L142 46Z" fill={mixColour(p.wall2, p.wood, 0.12)} />
      <Glow c={c} x={84} y={33} r={22} />
      {alt ? (
        <g>
          <rect x="76" y="26" width="16" height="13" rx="1.4" fill={p.trim} />
          <rect x="78" y="28" width="12" height="9" fill={lit ? LIGHT.lit : url(c, 'glass')} />
          <path d="M84 28v9M78 32.5h12" stroke={p.trim} strokeWidth="1.2" />
        </g>
      ) : (
        <g>
          <circle cx="84" cy="32" r="7.6" fill={p.trim} />
          <circle cx="84" cy="32" r="5.8" fill={lit ? LIGHT.lit : url(c, 'glass')} />
          <path d="M84 26.2v11.6M78.2 32h11.6" stroke={p.trim} strokeWidth="1.2" />
        </g>
      )}
      <path d="M5 50L84 7L163 50" fill="none" stroke={mixColour(roof, '#FFFFFF', 0.25)} strokeWidth="1.6" strokeLinejoin="round" />

      {/* The house: its frame, then a room in each box. */}
      <rect x="16" y="46" width="136" height="74" fill={shell} />
      <rect x="146" y="46" width="6" height="74" fill={p.shadow} opacity="0.08" />
      <Cell c={c} kind={upstairs[0]} b={{ x: 22, y: 52, w: 59, h: 28 }} />
      <Cell c={c} kind={upstairs[1]} b={{ x: 87, y: 52, w: 59, h: 28 }} />
      <Cell c={c} kind={downstairs[0]} b={{ x: 22, y: 86, w: 59, h: 28 }} />
      <Cell c={c} kind={downstairs[1]} b={{ x: 87, y: 86, w: 59, h: 28 }} />
      <rect x="12" y="118" width="144" height="5" rx="1.4" fill={p.stone} />
      <rect x="12" y="122" width="144" height="1.6" fill={p.shadow} opacity="0.1" />

      {/* A shrub in flower each side. */}
      {[8, 160].map((x, i) => (
        <g key={x}>
          <circle cx={x - 4} cy="121" r="7" fill={p.leaf2} />
          <circle cx={x + 4} cy="120" r="8" fill={p.leaf} />
          <circle cx={x - 2} cy="116" r="2" fill={[p.accent, '#FF8FAE'][i]} />
          <circle cx={x + 5} cy="114.6" r="1.8" fill={['#FFD24E', p.white][i]} />
        </g>
      ))}
    </g>
  );
};
