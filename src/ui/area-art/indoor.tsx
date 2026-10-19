// The rooms: each a small storybook vignette with its own charming detail.
import { mixColour } from '../../lib/logic/sky';
import {
  Bunting,
  CAT_COATS,
  Cat,
  Duck,
  FloorLamp,
  Glow,
  LIGHT,
  Pendant,
  Picture,
  Plant,
  Room,
  Shadow,
  Steam,
  TableLamp,
  W,
  Window,
  url,
  type Ctx,
} from './kit';
import s from './AreaArt.module.css';

type Scene = (props: { c: Ctx }) => JSX.Element;

/** Square tiles (`size`), in `fill` with lines of `line`. */
function Tiles({ c, name, w, h, fill, line }: { c: Ctx; name: string; w: number; h: number; fill: string; line: string }) {
  return (
    <pattern id={c.id(name)} width={w} height={h} patternUnits="userSpaceOnUse">
      <rect width={w} height={h} fill={fill} />
      <path d={`M0 0.3H${w}M0.3 0V${h}`} stroke={line} strokeWidth="0.7" />
    </pattern>
  );
}

// ---------------------------------------------------------------- kitchen

/** A pot steaming on the worktop under a pendant light; a herb on the sill. */
export const Kitchen: Scene = ({ c }) => {
  const { p, alt } = c;
  return (
    <g>
      <Room c={c} floor={128} />
      <defs>
        <pattern id={c.id('subway')} width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill={p.tile} />
          <path d="M0 0.3H12M0 6.3H12M0.3 0V6M6.3 6V12" stroke={p.wall2} strokeWidth="0.7" />
        </pattern>
      </defs>
      <rect y="54" width={W} height="26" fill={url(c, 'subway')} />
      <Window c={c} x={12} y={10} w={40} h={32} />
      <Plant c={c} x={43} y={44.2} k={0.4} />
      <Pendant c={c} x={70} y={20} />

      {alt ? (
        // Open shelf with jars.
        <g>
          <rect x="116" y="38" width="48" height="3" rx="1" fill={p.wood} />
          <rect x="116" y="40.6" width="48" height="1" fill={p.shadow} opacity="0.12" />
          {[
            [120, 12, p.accent2],
            [133, 16, p.accent],
            [148, 10, p.main],
          ].map(([x, h, fill]) => (
            <g key={x as number}>
              <rect x={x as number} y={38 - (h as number)} width="10" height={h as number} rx="2.4" fill={p.white} opacity="0.7" />
              <rect x={(x as number) + 1.5} y={38 - (h as number) * 0.62} width="7" height={(h as number) * 0.55} rx="1.4" fill={fill as string} />
              <rect x={(x as number) + 1} y={38 - (h as number) - 2} width="8" height="2.6" rx="1" fill={p.wood2} />
            </g>
          ))}
        </g>
      ) : (
        // Utensils hanging from a rail.
        <g>
          <rect x="118" y="28" width="44" height="2" rx="1" fill={p.metal2} />
          <path d="M127 30v15" stroke={p.metal2} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M122.4 45a4.6 4.6 0 0 0 9.2 0z" fill={p.metal} />
          <path d="M140 30v11" stroke={p.wood2} strokeWidth="1.8" strokeLinecap="round" />
          <rect x="136.4" y="41" width="7.2" height="10" rx="2" fill={p.wood} />
          <path d="M153 30v7" stroke={p.metal2} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M153 37c-4.4 4-4.4 12 0 15 4.4-3 4.4-11 0-15zM153 37c-1.6 4-1.6 12 0 15 1.6-3 1.6-11 0-15z" fill="none" stroke={p.metal2} strokeWidth="0.9" />
        </g>
      )}

      {/* Worktop and cupboards, a tea towel over one handle. */}
      <rect y="80" width={W} height="6" fill={p.wood} />
      <rect y="80" width={W} height="1.3" fill="#FFFFFF" opacity="0.35" />
      <rect y="86" width={W} height="42" fill={p.main} />
      <rect y="86" width={W} height="3" fill={p.shadow} opacity="0.14" />
      <path d="M42 89V128M84 89V128M126 89V128" stroke={p.main2} strokeWidth="1.4" />
      <g fill="none" stroke={p.main2} strokeWidth="0.8" opacity="0.55">
        {[0, 42, 84, 126].map((x) => (
          <rect key={x} x={x + 6} y="97" width="30" height="25" rx="2" />
        ))}
      </g>
      <g fill={p.brass}>
        {[0, 42, 84, 126].map((x) => (
          <rect key={x} x={x + 15} y="91.4" width="12" height="2.4" rx="1.2" />
        ))}
      </g>
      <path d="M55.6 92.4h13v19.4c0 1-0.8 1.8-1.8 1.8h-9.4c-1 0-1.8-0.8-1.8-1.8z" fill={p.white} />
      <path d="M55.6 99h13M55.6 102.4h13" stroke={p.accent} strokeWidth="1.3" />

      {/* Left of the worktop: a crock of wooden spoons, or a bowl of lemons. */}
      {alt ? (
        <g>
          <circle cx="20" cy="70" r="4.4" fill="#F6D44C" />
          <circle cx="28" cy="68.6" r="4.4" fill="#F2C53A" />
          <circle cx="35" cy="70.4" r="4" fill="#F6D44C" />
          <path d="M12 72h30a15 8 0 0 1-30 0z" fill={p.main2} />
        </g>
      ) : (
        <g>
          <path d="M19 67l-3.4-13M24 67V52M29 67l3-12" stroke={p.wood2} strokeWidth="1.6" strokeLinecap="round" />
          <ellipse cx="15.4" cy="52" rx="2" ry="3" fill={p.wood} transform="rotate(-14 15.4 52)" />
          <ellipse cx="24" cy="50" rx="2" ry="3" fill={p.wood} />
          <ellipse cx="32.6" cy="53.4" rx="2" ry="3" fill={p.wood} transform="rotate(14 32.6 53.4)" />
          <rect x="16" y="64" width="16" height="16" rx="3.4" fill={p.white} />
          <rect x="16" y="70" width="16" height="2.4" fill={p.accent} />
        </g>
      )}

      {/* The pot, lid on, steaming. */}
      <Shadow c={c} x={100} y={80} rx={22} ry={2.6} />
      <rect x="79.6" y="65.4" width="6" height="3.2" rx="1.6" fill={p.ink} opacity="0.75" />
      <rect x="114.4" y="65.4" width="6" height="3.2" rx="1.6" fill={p.ink} opacity="0.75" />
      <path d="M84 62H116V73.6Q116 80 109.6 80H90.4Q84 80 84 73.6Z" fill={p.accent} />
      <path d="M109 62H116V73.6Q116 80 109.6 80H105Q110 78 110 71Z" fill={p.shadow} opacity="0.16" />
      <path d="M88 68h7" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <rect x="82.6" y="60.6" width="34.8" height="3.6" rx="1.8" fill={mixColour(p.accent, p.white, 0.12)} />
      <path d="M85 61Q100 51.6 115 61Z" fill={mixColour(p.accent, p.ink, 0.18)} />
      <circle cx="100" cy="54.4" r="2.4" fill={p.ink} opacity="0.85" />
      <Steam c={c} x={100} y={50} />
    </g>
  );
};

// ---------------------------------------------------------------- living room

/** A sofa with a cat asleep on it, a lamp, a big leafy plant. */
export const Living: Scene = ({ c }) => {
  const { p, alt, detail } = c;
  const seat = mixColour(p.main, p.white, 0.1);
  return (
    <g>
      <Room c={c} floor={100} />
      {alt ? (
        <Window c={c} x={54} y={10} w={60} h={34} curtains={p.accent2} />
      ) : detail === 1 ? (
        <g>
          <Picture c={c} x={58} y={14} w={30} h={24} art={0} />
          <Picture c={c} x={94} y={20} w={16} h={18} art={2} />
        </g>
      ) : (
        <Picture c={c} x={64} y={14} w={40} h={28} art={detail} />
      )}
      <Plant c={c} x={17} y={100} k={1.2} kind={2} />
      <FloorLamp c={c} x={152} y={100} h={66} />

      <ellipse cx="84" cy="117" rx="64" ry="9.4" fill={p.accent2} />
      <ellipse cx="84" cy="117" rx="55" ry="6.6" fill="none" stroke={p.white} strokeWidth="1" strokeDasharray="2.6 2.6" opacity="0.6" />

      <Shadow c={c} x={84} y={100} rx={58} ry={4} />
      <rect x="40" y="52" width="88" height="32" rx="9" fill={p.main} />
      <rect x="44" y="53.4" width="80" height="4" rx="2" fill="#FFFFFF" opacity="0.14" />
      <rect x="41" y="73" width="43" height="13" rx="4.4" fill={seat} />
      <rect x="84" y="73" width="43" height="13" rx="4.4" fill={seat} />
      <path d="M84 75v10" stroke={p.main2} strokeWidth="1" opacity="0.5" />
      <rect x="29" y="62" width="19" height="30" rx="8.4" fill={p.main} />
      <rect x="120" y="62" width="19" height="30" rx="8.4" fill={p.main} />
      <rect x="131" y="62" width="8" height="30" rx="4" fill={p.shadow} opacity="0.1" />
      <rect x="33" y="84" width="102" height="9" rx="4" fill={p.main2} />
      <rect x="40" y="93" width="3.4" height="7" rx="1" fill={p.wood2} />
      <rect x="125" y="93" width="3.4" height="7" rx="1" fill={p.wood2} />
      <rect x="48" y="58" width="18" height="17" rx="4.4" fill={p.accent} transform="rotate(-9 57 66.5)" />
      <rect x="102" y="58" width="18" height="17" rx="4.4" fill={p.accent2} transform="rotate(8 111 66.5)" />
      <path d="M106 63l10 6M104 68l9 5" stroke={p.accent} strokeWidth="1" opacity="0.5" transform="rotate(8 111 66.5)" />
      {alt ? <Cat c={c} x={98} y={113} coat={CAT_COATS[detail]} /> : <Cat c={c} x={74} y={74} k={0.92} coat={CAT_COATS[detail]} />}
    </g>
  );
};

// ---------------------------------------------------------------- bathrooms

/** A roll-top bath full of bubbles, the household's green rubber duck afloat; candles at night. */
const Bath: Scene = ({ c }) => {
  const { p } = c;
  const foam: readonly (readonly [number, number, number])[] = [
    [28, 63, 5],
    [37, 60, 6.2],
    [47, 61.4, 5.6],
    [57, 59, 6.6],
    [67, 61, 5.4],
    [77, 59.6, 6.2],
    [87, 61.4, 5.4],
    [112, 61, 5.6],
    [121, 62.4, 4.6],
  ];
  return (
    <g>
      <Room c={c} floor={104} />
      <defs>
        <Tiles c={c} name="squares" w={10} h={10} fill={p.tile} line={p.wall2} />
      </defs>
      <rect y="56" width={W} height="43" fill={url(c, 'squares')} />
      <rect y="53.6" width={W} height="3" fill={p.trim} />
      <Window c={c} x={118} y={12} w={32} h={24} frosted roofs={false} />
      {/* A wall light. */}
      <Glow c={c} x={70} y={30} r={40} k={0.9} />
      <rect x="66.6" y="26" width="7" height="10" rx="3.5" fill={c.evening ? LIGHT.lamp : p.white} />
      <rect x="69" y="35" width="2" height="4" fill={p.brass} />

      {/* Towel rail and towel. */}
      <rect x="140" y="56" width="24" height="2.2" rx="1.1" fill={p.metal2} />
      <path d="M142.4 57h17.6v26c0 1.4-1 2.4-2.4 2.4h-12.8c-1.4 0-2.4-1-2.4-2.4z" fill={p.accent} />
      <path d="M142.4 76h17.6M142.4 79h17.6" stroke={p.accent2} strokeWidth="1.4" />
      <path d="M142.4 57h17.6v4h-17.6z" fill={p.shadow} opacity="0.12" />

      {/* The bath. */}
      <Shadow c={c} x={76} y={104} rx={60} ry={4} />
      <path d="M20 66H132Q134 66 133.2 70Q129 92 112 96H40Q23 92 18.8 70Q18 66 20 66Z" fill={p.main} />
      <path d="M124 66H132Q134 66 133.2 70Q129 92 112 96H106Q122 88 124 66Z" fill={p.shadow} opacity="0.13" />
      <path d="M36 94c-0.6 3.4-2.6 6-6 7.2h9.4c0.2-2.4 1-4.6 2.4-6.6zM116 94c0.6 3.4 2.6 6 6 7.2h-9.4c-0.2-2.4-1-4.6-2.4-6.6z" fill={p.brass} />
      <path d="M26 64V50.4Q26 44.6 32 44.6Q38 44.6 38 50.4" fill="none" stroke={p.metal2} strokeWidth="3" strokeLinecap="round" />
      <circle cx="21.6" cy="57" r="2.2" fill={p.metal} />
      <circle cx="30.4" cy="57" r="2.2" fill={p.metal} />
      <path d="M21.6 63V57M30.4 63V57" stroke={p.metal2} strokeWidth="1.6" />
      <g fill={p.white}>
        {foam.map(([x, y, r]) => (
          <circle key={x} cx={x} cy={y} r={r} />
        ))}
      </g>
      <g fill={p.linen} opacity="0.7">
        {foam.map(([x, y, r]) => (
          <circle key={x} cx={x + r * 0.3} cy={y + r * 0.35} r={r * 0.55} />
        ))}
      </g>
      <Duck c={c} x={99} y={63} k={1.05} bob />
      <circle cx="93" cy="64.4" r="4" fill={p.white} />
      <circle cx="104.6" cy="64.6" r="4.4" fill={p.white} />
      <rect x="15.6" y="63" width="121" height="6.4" rx="3.2" fill={p.white} />
      <rect x="15.6" y="67" width="121" height="2.4" rx="1.2" fill={p.linen} />
      {/* Candles at the far end: lit in the evening. */}
      <rect x="125.6" y="54.6" width="3.6" height="8.4" rx="0.8" fill={p.white} />
      <rect x="130.6" y="57" width="3.6" height="6" rx="0.8" fill={p.white} />
      {c.evening ? (
        <g>
          <circle cx="129.8" cy="51" r="11" fill={LIGHT.halo} opacity="0.3" />
          <path d="M127.4 54.4c-1.6-1.6-0.8-3.6 0-4.8 0.8 1.2 1.6 3.2 0 4.8z" fill={LIGHT.lamp} />
          <path d="M132.4 56.8c-1.6-1.6-0.8-3.6 0-4.8 0.8 1.2 1.6 3.2 0 4.8z" fill={LIGHT.lamp} />
        </g>
      ) : null}
      {/* Bubbles drifting up. */}
      <g fill="#FFFFFF" stroke={p.water2} strokeOpacity="0.35" strokeWidth="0.5">
        <circle className={s.bubble} cx="52" cy="48" r="2.2" opacity="0.85" />
        <circle className={s.bubble} style={{ animationDelay: '-1.1s' }} cx="72" cy="44" r="1.6" opacity="0.85" />
        <circle className={s.bubble} style={{ animationDelay: '-2.2s' }} cx="40" cy="42" r="1.3" opacity="0.85" />
      </g>
      <rect x="46" y="108" width="56" height="8" rx="4" fill={p.accent2} />
      <rect x="49" y="110" width="50" height="4" rx="2" fill="none" stroke={p.white} strokeWidth="0.8" opacity="0.6" />
    </g>
  );
};

/** A walk-in shower raining down, a basin under a round mirror, the duck on the side. */
const Shower: Scene = ({ c }) => {
  const { p } = c;
  const zellige = mixColour(p.main, p.white, 0.58);
  return (
    <g>
      <Room c={c} floor={104} />
      <defs>
        <Tiles c={c} name="tall" w={8} h={15} fill={zellige} line={mixColour(zellige, p.main2, 0.35)} />
        <Tiles c={c} name="squares" w={10} h={10} fill={p.tile} line={p.wall2} />
      </defs>
      <rect x="70" y="60" width="98" height="39" fill={url(c, 'squares')} />
      <rect x="70" y="57.6" width="98" height="3" fill={p.trim} />
      <rect x="0" y="0" width="70" height="99" fill={url(c, 'tall')} />

      {/* The shower: head, falling water, mixer, a niche of bottles, the tray and the glass. */}
      <path d="M36 0V18" stroke={p.metal2} strokeWidth="2.2" />
      <path d="M26 19.4h20l-2.4 4.6H28.4z" fill={p.metal} />
      <g stroke={c.evening ? '#CFE4FF' : '#7FC4E8'} strokeWidth="1.1" strokeLinecap="round" opacity="0.8">
        {[29, 33, 37, 41, 44].map((x, i) => (
          <path key={x} className={s.drip} style={{ animationDelay: `${-i * 0.33}s` }} d={`M${x} ${30 + (i % 2) * 8}v5`} />
        ))}
      </g>
      <circle cx="36" cy="62" r="3.6" fill={p.metal} />
      <path d="M36 62l5-2" stroke={p.metal2} strokeWidth="1.6" strokeLinecap="round" />
      <rect x="8" y="70" width="22" height="2.4" fill={p.trim} />
      <rect x="10.6" y="61.6" width="5.4" height="8.4" rx="1.8" fill={p.accent} />
      <rect x="17.6" y="59" width="5.4" height="11" rx="1.8" fill={p.main2} />
      <rect x="24.4" y="64" width="4.4" height="6" rx="1.6" fill={p.white} />
      <rect x="4" y="97.4" width="64" height="6.6" rx="2" fill={p.white} />
      <rect x="6" y="10" width="60" height="87.4" fill="#FFFFFF" opacity="0.16" stroke={p.metal2} strokeOpacity="0.55" strokeWidth="1.2" />
      <path d="M14 34l16-16M16 50l30-30M44 86l18-18" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.4" />

      {/* A towel on a hook. */}
      <circle cx="82" cy="40" r="1.6" fill={p.metal2} />
      <path d="M75.6 41.6h12.8l1 29c0 1.6-1 2.6-2.6 2.6h-9.6c-1.6 0-2.6-1-2.6-2.6z" fill={p.accent} />
      <path d="M75.4 64h13.6M75.3 67h13.8" stroke={p.accent2} strokeWidth="1.3" />

      {/* Mirror, lit from behind at night. */}
      <Glow c={c} x={126} y={32} r={36} k={0.9} />
      <circle cx="126" cy="32" r="18" fill={p.brass} />
      <circle cx="126" cy="32" r="15.6" fill={url(c, 'glass')} />
      <path d="M117 26l9-9M118 34l14-14" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" opacity="0.45" />

      {/* Basin on a vanity unit. */}
      <Shadow c={c} x={126} y={104} rx={32} ry={3.4} />
      <rect x="100" y="76" width="52" height="25" rx="3" fill={p.main} />
      <path d="M126 79v19" stroke={p.main2} strokeWidth="1.2" />
      <rect x="117" y="84" width="2.4" height="8" rx="1.2" fill={p.brass} />
      <rect x="132.6" y="84" width="2.4" height="8" rx="1.2" fill={p.brass} />
      <rect x="96" y="72" width="60" height="5.4" rx="2" fill={p.white} />
      <path d="M109 64h34c0 5.4-6.6 8-17 8s-17-2.6-17-8z" fill={p.white} />
      <ellipse cx="126" cy="64" rx="17" ry="2" fill={p.linen} />
      <path d="M126 63V56.6q0-3 3.4-3h3" fill="none" stroke={p.metal2} strokeWidth="2.2" strokeLinecap="round" />
      <rect x="146" y="64" width="6.4" height="8" rx="1.6" fill={p.accent2} />
      <path d="M147.6 64l-1.4-7M150.6 64l1.6-6.4" stroke={p.main2} strokeWidth="1.2" strokeLinecap="round" />
      <Duck c={c} x={104.6} y={72} k={0.72} />
      <rect x="10" y="108" width="52" height="7" rx="3.5" fill={p.accent2} />
    </g>
  );
};

export const Bathroom: Scene = ({ c }) => (c.alt ? <Shower c={c} /> : <Bath c={c} />);

// ---------------------------------------------------------------- bedrooms

/** A pillow, x to x + w along y. */
function Pillow({ c, x, y, w }: { c: Ctx; x: number; y: number; w: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height="14" rx="6" fill={c.p.white} />
      <rect x={x + 2} y={y + 8} width={w - 4} height="5" rx="2.5" fill={c.p.linen} opacity="0.8" />
    </g>
  );
}

/** A big double bed under the window with the moon in it, a lamp on the bedside table. */
const DoubleBed: Scene = ({ c }) => {
  const { p, detail } = c;
  return (
    <g>
      <Room c={c} floor={104} />
      <Window c={c} x={12} y={14} w={34} h={36} moon curtains={p.accent2} />
      <Picture c={c} x={92} y={14} w={26} h={20} art={detail === 2 ? 1 : detail} />

      {/* Bedside table and lamp. */}
      <Shadow c={c} x={38} y={104} rx={14} ry={2.6} />
      <rect x="25" y="80" width="27" height="24" rx="2.4" fill={p.wood} />
      <rect x="25" y="80" width="27" height="3" rx="1.4" fill={p.wood2} />
      <rect x="35.6" y="90" width="6" height="2.2" rx="1.1" fill={p.brass} />
      <TableLamp c={c} x={38.5} y={80} />

      {/* The bed: headboard, two pillows, a turned-down duvet, a throw over the end. */}
      <Shadow c={c} x={106} y={118} rx={54} ry={3.4} />
      <rect x="60" y="48" width="92" height="50" rx="11" fill={p.main2} />
      <g fill={p.main} opacity="0.8">
        {[74, 92, 110, 128].map((x) => (
          <circle key={x} cx={x + 6} cy="58" r="1.4" />
        ))}
      </g>
      <Pillow c={c} x={66} y={64} w={38} />
      <Pillow c={c} x={108} y={64} w={38} />
      <path d="M60 80H152L156 106H56Z" fill={p.main} />
      <path d="M60 80H152L153.2 88H58.8Z" fill={p.white} />
      <path d="M59 86.6H153" stroke={p.linen} strokeWidth="1.2" />
      <path d="M57.2 97H154.8L156 106H56Z" fill={p.accent} />
      <path d="M58 99.6H154.4" stroke={p.accent2} strokeWidth="1" strokeDasharray="3 2.4" opacity="0.8" />
      <rect x="56" y="106" width="100" height="7" rx="1.6" fill={mixColour(p.main, p.shadow, 0.15)} />
      <rect x="58" y="113" width="96" height="4" fill={p.wood2} />
      <rect x="60" y="117" width="4" height="3" fill={p.wood2} />
      <rect x="148" y="117" width="4" height="3" fill={p.wood2} />
    </g>
  );
};

/** A single bed under a window with the moon in it, a suitcase waiting, a lamp. */
const SingleBed: Scene = ({ c }) => {
  const { p } = c;
  return (
    <g>
      <Room c={c} floor={104} />
      <Window c={c} x={100} y={12} w={38} h={32} moon curtains={p.main2} />

      {/* A suitcase by the wall. */}
      <Shadow c={c} x={30} y={104} rx={16} ry={2.6} />
      <path d="M24.6 72.6v-5.4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v5.4" fill="none" stroke={p.ink} strokeWidth="1.6" opacity="0.7" />
      <rect x="16" y="72" width="28" height="31" rx="4" fill={p.accent} />
      <rect x="36" y="72" width="8" height="31" rx="3" fill={p.shadow} opacity="0.12" />
      <path d="M23 72v31M37 72v31" stroke={mixColour(p.accent, p.shadow, 0.25)} strokeWidth="1.6" />
      <rect x="18" y="102.4" width="4" height="2.4" rx="1" fill={p.ink} opacity="0.7" />
      <rect x="38" y="102.4" width="4" height="2.4" rx="1" fill={p.ink} opacity="0.7" />

      {/* Bedside table with a lamp and a book. */}
      <Shadow c={c} x={72} y={104} rx={12} ry={2.4} />
      <rect x="61" y="82" width="22" height="22" rx="2.4" fill={p.wood} />
      <rect x="61" y="82" width="22" height="3" rx="1.4" fill={p.wood2} />
      <circle cx="72" cy="93" r="1.4" fill={p.brass} />
      <TableLamp c={c} x={67} y={82} shade={p.accent2} />
      <rect x="74" y="79" width="8" height="3" rx="0.8" fill={p.main} />

      {/* The bed. */}
      <Shadow c={c} x={119} y={118} rx={30} ry={3} />
      <rect x="94" y="52" width="50" height="44" rx="9" fill={p.wood} />
      <rect x="94" y="52" width="50" height="5" rx="2.5" fill="#FFFFFF" opacity="0.18" />
      <Pillow c={c} x={101} y={66} w={36} />
      <path d="M94 80H144L147.4 106H90.6Z" fill={p.main} />
      <path d="M94 80H144L145 87H93Z" fill={p.white} />
      <g fill={p.accent2}>
        {[
          [101, 93],
          [113, 98],
          [125, 92],
          [137, 99],
          [107, 102],
          [131, 103],
        ].map(([x, y]) => (
          <path key={x} d={`M${x} ${y - 2}l0.6 1.4 1.4 0.6-1.4 0.6-0.6 1.4-0.6-1.4-1.4-0.6 1.4-0.6z`} />
        ))}
      </g>
      <rect x="90.6" y="106" width="56.8" height="7" rx="1.6" fill={p.main2} />
      <rect x="92" y="113" width="54" height="4" fill={p.wood2} />
    </g>
  );
};

export const Bedroom: Scene = ({ c }) => (c.alt ? <SingleBed c={c} /> : <DoubleBed c={c} />);

// ---------------------------------------------------------------- hallway

/** The front door with its fanlight, coats on hooks, wellies and a runner. */
export const Hallway: Scene = ({ c }) => {
  const { p, detail } = c;
  const panel = p.panel;
  const door = detail === 1 ? p.accent : p.main2;
  return (
    <g>
      <Room c={c} floor={104} />
      <rect y="62" width={W} height="37" fill={panel} />
      <rect y="60" width={W} height="3" fill={p.trim} />
      <g fill="none" stroke={mixColour(panel, p.shadow, 0.2)} strokeWidth="1" opacity="0.6">
        <rect x="6" y="68" width="26" height="25" rx="1" />
        <rect x="38" y="68" width="26" height="25" rx="1" />
        <rect x="146" y="68" width="18" height="25" rx="1" />
      </g>

      {/* Door, fanlight and lantern. */}
      <rect x="90" y="10" width="50" height="94" rx="2" fill={p.trim} />
      <path d="M95 26A20 13 0 0 1 135 26Z" fill={url(c, 'glass')} />
      {c.evening ? <path d="M95 26A20 13 0 0 1 135 26Z" fill={LIGHT.lit} opacity="0.55" /> : null}
      <path d="M115 26V14M115 26L104 17.6M115 26L126 17.6" stroke={p.trim} strokeWidth="1.3" />
      <rect x="95" y="28" width="40" height="76" fill={door} />
      <rect x="128" y="28" width="7" height="76" fill={p.shadow} opacity="0.1" />
      <g fill={mixColour(door, p.shadow, 0.22)} opacity="0.55">
        <rect x="100" y="34" width="13" height="24" rx="1.6" />
        <rect x="117" y="34" width="13" height="24" rx="1.6" />
        <rect x="100" y="66" width="13" height="30" rx="1.6" />
        <rect x="117" y="66" width="13" height="30" rx="1.6" />
      </g>
      <rect x="108" y="60.4" width="14" height="3" rx="1" fill={p.brass} />
      <circle cx="129" cy="68" r="1.8" fill={p.brass} />
      <Glow c={c} x={151} y={44} r={30} />
      <rect x="148" y="38" width="7" height="10" rx="2" fill={c.evening ? LIGHT.lamp : p.glassLow} stroke={p.ink} strokeWidth="1" strokeOpacity="0.7" />
      <path d="M147 38h9l-4.5-3.6z" fill={p.ink} opacity="0.75" />

      {c.alt ? (
        // A console table under a round mirror, a bowl for keys.
        <g>
          <circle cx="42" cy="40" r="17" fill={p.brass} />
          <circle cx="42" cy="40" r="14.6" fill={url(c, 'glass')} />
          <path d="M33 36l9-9M34 46l15-15" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" opacity="0.45" />
          <rect x="12" y="70" width="60" height="4.4" rx="1.6" fill={p.wood} />
          <rect x="15" y="74" width="3" height="30" fill={p.wood2} />
          <rect x="66" y="74" width="3" height="30" fill={p.wood2} />
          <path d="M20 70a8 4.4 0 0 1 16 0z" fill={p.accent} />
          <Plant c={c} x={58} y={70} k={0.5} />
        </g>
      ) : (
        // Coat hooks: a coat, a striped scarf, an umbrella.
        <g>
          <rect x="10" y="30" width="62" height="4" rx="1.6" fill={p.wood} />
          <g fill={p.wood2}>
            <circle cx="20" cy="32" r="2" />
            <circle cx="41" cy="32" r="2" />
            <circle cx="62" cy="32" r="2" />
          </g>
          <path d="M20 33c-6 2-9 4-10 10l-1 34h22l-1-34c-1-6-4-8-10-10z" fill={p.main} />
          <path d="M20 33l-4 10 4 3 4-3z" fill={mixColour(p.main, p.shadow, 0.25)} />
          <path d="M20 46v30" stroke={mixColour(p.main, p.shadow, 0.25)} strokeWidth="0.9" />
          <path d="M38 33h6v40h-6z" fill={p.accent2} />
          <path d="M38 41h6M38 49h6M38 57h6M38 65h6" stroke={p.accent} strokeWidth="2.4" />
          <path d="M38 73v3M40 73v3M42 73v3M44 73v3" stroke={p.accent} strokeWidth="0.8" />
          <path d="M62 33c2.6 0 3 2.6 3 4" fill="none" stroke={p.ink} strokeWidth="1.3" strokeLinecap="round" />
          <path d="M62 37l-3.2 6L61 74h2l2.2-31z" fill={p.ink} opacity="0.82" />
        </g>
      )}

      {/* Wellies, a mat and a runner. */}
      <path d="M17 86h7v12h4.6c1.4 0 2.4 1 2.4 2.4V104H17z" fill={p.welly} />
      <path d="M33 88h7v10h4.6c1.4 0 2.4 1 2.4 2.4V104H33z" fill={mixColour(p.welly, p.shadow, 0.08)} />
      <rect x="92" y="105.4" width="46" height="6" rx="1.4" fill={p.wood2} />
      <path d="M36 118H96L100 136H32Z" fill={p.accent} />
      <path d="M37 123H97M35 130H99" stroke={p.accent2} strokeWidth="2" />
    </g>
  );
};

// ---------------------------------------------------------------- utility

/** A washing machine with laundry going round, a basket, socks on the line. */
export const Utility: Scene = ({ c }) => {
  const { p } = c;
  return (
    <g>
      <Room c={c} floor={104} />
      <Pendant c={c} x={128} y={14} colour={p.white} />
      {c.alt ? (
        // A tumble dryer stacked on the washing machine.
        <g>
          <rect x="24" y="4" width="52" height="44" rx="4" fill={p.white} />
          <rect x="68" y="4" width="8" height="44" rx="3" fill={p.shadow} opacity="0.07" />
          <rect x="24" y="12" width="52" height="1.2" fill={p.linen} />
          <circle cx="64" cy="8.4" r="2.2" fill={p.metal} />
          <circle cx="50" cy="30" r="12" fill={p.metal} />
          <circle cx="50" cy="30" r="9" fill={c.evening ? '#2A3466' : '#E8EEF3'} />
          <path d="M43 31c3-4 8-5 11-2 2 2 4 1 5 0-1 5-5 8-9 8-4 0-6-2-7-6z" fill={p.main} opacity="0.85" />
          <rect x="24" y="46" width="52" height="2.4" fill={p.metal2} opacity="0.5" />
        </g>
      ) : (
        // A shelf of bottles, a plant trailing over it.
        <g>
          <rect x="16" y="36" width="64" height="3" rx="1" fill={p.wood} />
          <rect x="20" y="22" width="9" height="14" rx="3" fill={p.accent} />
          <rect x="22.4" y="18.6" width="4" height="4" rx="1" fill={p.white} />
          <rect x="32" y="26" width="8" height="10" rx="2.4" fill={p.main} />
          <rect x="33.6" y="23.4" width="4.6" height="3" rx="1" fill={p.white} />
          <Plant c={c} x={64} y={36} k={0.5} />
          <path d="M58 37c-1 6 0 12-2 17M70 37c1 5 0 9 2 14" fill="none" stroke={p.leaf2} strokeWidth="1" />
          <g fill={p.leaf}>
            <ellipse cx="57" cy="44" rx="2" ry="3" />
            <ellipse cx="56" cy="52" rx="2" ry="3" />
            <ellipse cx="71" cy="45" rx="2" ry="3" />
          </g>
        </g>
      )}

      {/* Washing line. */}
      <path d="M88 26Q126 34 164 26" fill="none" stroke={p.ink} strokeWidth="0.7" opacity="0.5" />
      <g className={s.bob} style={{ animationDelay: '-1.2s' }}>
        <path d="M96 28.4l2-0.6 8 0.8 1 3.6-3 0.6 0.6 13h-10.4l0.6-13-3-0.6z" fill={p.accent} />
      </g>
      <path d="M118 30.4h6v10.6c0 2 2 3 4.6 3.2v3.6c-5.6 0-10.6-1.6-10.6-6z" fill={p.main} />
      <path d="M134 30.6h6v10.6c0 2 2 3 4.6 3.2v3.6c-5.6 0-10.6-1.6-10.6-6z" fill={p.accent2} />
      <path d="M150 29h12v22h-12z" fill={p.white} />
      <path d="M150 45h12" stroke={p.main} strokeWidth="1.6" />
      <g fill={p.wood2}>
        <rect x="99" y="27" width="1.6" height="4" />
        <rect x="120" y="29" width="1.6" height="4" />
        <rect x="136" y="29.2" width="1.6" height="4" />
        <rect x="155" y="27.6" width="1.6" height="4" />
      </g>

      {/* The washing machine. */}
      <Shadow c={c} x={50} y={104} rx={28} ry={3} />
      <rect x="24" y="48" width="52" height="56" rx="4" fill={p.white} />
      <rect x="68" y="48" width="8" height="56" rx="3" fill={p.shadow} opacity="0.07" />
      <rect x="24" y="58" width="52" height="1.2" fill={p.linen} />
      <circle cx="64" cy="53" r="2.6" fill={p.metal} />
      <rect x="31" y="51.6" width="12" height="3" rx="1.5" fill={c.evening ? '#9BE7C1' : p.metal} />
      <circle cx="50" cy="81" r="16.4" fill={p.metal} />
      <circle cx="50" cy="81" r="12.4" fill={c.evening ? '#2A3466' : '#CFE6F2'} />
      <path d="M40 84c4-6 10-7 14-4 3 2 6 1 8-1-1 7-6 11-12 11-5 0-9-2-10-6z" fill={p.accent} opacity="0.9" />
      <path d="M43 76c3-3 8-3 10 0-3 1-7 2-10 0z" fill={p.main} />
      <path d="M41 77a11 11 0 0 1 9-7.4" fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" opacity="0.65" />

      {/* Laundry basket. */}
      <Shadow c={c} x={118} y={104} rx={22} ry={2.6} />
      <path d="M106 79c2-6 8-7 12-3 3-5 10-4 12 1 4 0 6 2 5 5h-30c-1-1 0-2 1-3z" fill={p.accent2} />
      <path d="M112 77c3-4 7-4 9 0z" fill={p.main} />
      <path d="M100 82H138L134.6 104H103.4Z" fill={p.wood} />
      <g stroke={p.wood2} strokeWidth="1" opacity="0.7">
        <path d="M101 88H137M102 94H136M103 100H135" />
        <path d="M108 82v22M115 82v22M122 82v22M129 82v22" strokeDasharray="3 3" />
      </g>
      <path d="M133 82c3 0 5 3 5 7v4c0 2-3 2-3 0v-4c0-2-1-4-2-4z" fill={p.main} />
    </g>
  );
};

// ---------------------------------------------------------------- office

/** A desk by the window: a screen, an anglepoise lamp, a steaming mug, books. */
export const Office: Scene = ({ c }) => {
  const { p } = c;
  return (
    <g>
      <Room c={c} floor={104} />
      <Window c={c} x={12} y={14} w={36} h={36} curtains={p.accent2} />
      {/* Books on a shelf. */}
      <rect x="120" y="36" width="44" height="3" rx="1" fill={p.wood} />
      {[
        [124, 16, p.main],
        [129, 14, p.accent],
        [134, 17, p.main2],
        [139, 12, p.accent2],
      ].map(([x, h, fill]) => (
        <rect key={x as number} x={x as number} y={36 - (h as number)} width="4.4" height={h as number} rx="0.8" fill={fill as string} />
      ))}
      <rect x="147" y="25" width="4.4" height="12" rx="0.8" fill={p.accent} transform="rotate(-16 149 36)" />
      <Plant c={c} x={158} y={36} k={0.42} kind={1} />

      {/* Desk. */}
      <Shadow c={c} x={106} y={104} rx={52} ry={3} />
      <rect x="62" y="75" width="4" height="29" fill={p.wood2} />
      <rect x="122" y="75" width="32" height="29" rx="2" fill={p.main} />
      <path d="M122 89h32" stroke={p.main2} strokeWidth="1.2" />
      <rect x="135" y="80.6" width="6" height="2.4" rx="1.2" fill={p.brass} />
      <rect x="135" y="94.6" width="6" height="2.4" rx="1.2" fill={p.brass} />
      <rect x="56" y="70" width="104" height="5.4" rx="1.6" fill={p.wood} />
      <rect x="56" y="70" width="104" height="1.4" fill="#FFFFFF" opacity="0.3" />

      {c.alt ? (
        // A laptop, and a pinboard of notes.
        <g>
          <rect x="74" y="12" width="44" height="28" rx="2" fill={p.card} stroke={p.wood2} strokeWidth="2" />
          <rect x="79" y="16" width="10" height="9" fill={p.accent2} transform="rotate(-4 84 20)" />
          <rect x="93" y="17" width="9" height="9" fill="#FFE58A" transform="rotate(5 97 21)" />
          <rect x="105" y="15" width="9" height="11" fill={p.white} />
          <rect x="84" y="28" width="12" height="8" fill={p.white} transform="rotate(3 90 32)" />
          <circle cx="84" cy="17" r="1.1" fill={p.accent} />
          <circle cx="109.6" cy="16" r="1.1" fill={p.main} />
          <Glow c={c} x={101} y={58} r={22} k={0.4} />
          <rect x="88" y="50" width="26" height="18" rx="2" fill={p.ink} />
          <rect x="90" y="52" width="22" height="14" rx="1" fill={c.evening ? '#8FC2FF' : '#DCEEFF'} />
          <rect x="93" y="55" width="10" height="2" rx="1" fill={p.main} />
          <rect x="93" y="59" width="16" height="1.6" rx="0.8" fill={p.white} />
          <rect x="84" y="67.6" width="34" height="2.4" rx="1.2" fill={p.metal2} />
        </g>
      ) : (
        // A screen.
        <g>
          <Glow c={c} x={100} y={50} r={30} k={0.4} />
          <rect x="97" y="60" width="6" height="8" fill={p.metal2} />
          <rect x="90" y="67.6" width="20" height="2.6" rx="1.3" fill={p.metal2} />
          <rect x="78" y="34" width="44" height="28" rx="3" fill={p.ink} />
          <rect x="80.6" y="36.6" width="38.8" height="22.8" rx="1.4" fill={c.evening ? '#8FC2FF' : '#DCEEFF'} opacity={c.evening ? 0.85 : 1} />
          <rect x="84" y="40" width="16" height="3" rx="1.5" fill={p.main} opacity="0.85" />
          <rect x="84" y="46" width="30" height="2" rx="1" fill={p.white} opacity="0.9" />
          <rect x="84" y="51" width="24" height="2" rx="1" fill={p.white} opacity="0.9" />
        </g>
      )}

      {/* Mug, steaming. */}
      <rect x="66" y="61" width="9" height="9" rx="2" fill={p.accent} />
      <path d="M75 63.4c3 0 3 4.4 0 4.4" fill="none" stroke={p.accent} strokeWidth="1.6" />
      <Steam c={c} x={70.4} y={59} k={0.55} />

      {/* Anglepoise lamp. */}
      <Glow c={c} x={140} y={64} r={36} />
      <path d="M150 69.6l-6-20 -12 6" fill="none" stroke={p.ink} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
      <ellipse cx="150" cy="69.4" rx="6" ry="1.6" fill={p.ink} opacity="0.85" />
      <circle cx="144" cy="49.6" r="1.6" fill={p.ink} />
      <path d="M131 51l-8 8 6 3.4z" fill={p.accent} transform="rotate(8 129 56)" />
      {c.evening ? <path d="M124 60l-10 10h22z" fill={LIGHT.lamp} opacity="0.22" /> : null}
    </g>
  );
};

// ---------------------------------------------------------------- dining room

/** A table set with flowers and candles under a pendant light, two chairs. */
export const Dining: Scene = ({ c }) => {
  const { p, detail } = c;
  const chair = (x: number, flip: boolean) => {
    const k = flip ? -1 : 1;
    return (
      <g transform={`translate(${x} 0) scale(${k} 1)`}>
        <rect x="-2" y="52" width="3" height="52" rx="1.4" fill={p.wood2} />
        <rect x="-2" y="82" width="22" height="4" rx="1.6" fill={p.wood} />
        <rect x="16.6" y="86" width="3" height="18" rx="1.4" fill={p.wood2} />
        <path d="M1 56h3M1 64h3M1 72h3" stroke={p.wood} strokeWidth="2" />
        <rect x="-1" y="76" width="18" height="6" rx="2.4" fill={p.accent2} />
      </g>
    );
  };
  return (
    <g>
      <Room c={c} floor={104} />
      {detail === 2 ? (
        <Window c={c} x={14} y={12} w={36} h={30} curtains={p.accent2} />
      ) : (
        <Picture c={c} x={20} y={14} w={30} h={24} art={detail} />
      )}
      {c.alt ? (
        // A plate rack.
        <g>
          <rect x="114" y="12" width="40" height="30" rx="2" fill={p.wood} />
          <rect x="114" y="25" width="40" height="2.4" fill={p.wood2} />
          <rect x="114" y="39" width="40" height="3" fill={p.wood2} />
          {[121, 134, 147].map((x, i) => (
            <g key={x}>
              <circle cx={x} cy="19" r="5.2" fill={p.white} stroke={i % 2 ? p.main : p.accent} strokeWidth="1.4" />
              <circle cx={x} cy="33" r="5" fill={p.white} stroke={i % 2 ? p.accent : p.main} strokeWidth="1.4" />
            </g>
          ))}
        </g>
      ) : (
        <Picture c={c} x={122} y={16} w={22} h={20} art={detail === 1 ? 0 : 2} />
      )}
      <Pendant c={c} x={84} y={28} colour={p.main} />
      {chair(18, false)}
      {chair(150, true)}
      <Shadow c={c} x={84} y={104} rx={48} ry={3} />
      <rect x="42" y="78" width="4" height="26" rx="1.4" fill={p.wood2} />
      <rect x="122" y="78" width="4" height="26" rx="1.4" fill={p.wood2} />
      <rect x="34" y="74" width="100" height="5.4" rx="1.6" fill={p.wood} />
      <path d="M58 74h52v9c0 1-1 1.4-2 1.4H60c-1 0-2-0.4-2-1.4z" fill={p.accent2} />
      <path d="M60 81.6h48" stroke={p.accent} strokeWidth="1" strokeDasharray="2 2" />
      {/* A jug of flowers, two candles, a bowl of fruit. */}
      <path d="M79 62h10l-1 12h-8z" fill={p.white} />
      <path d="M80 62c-4-4-6-9-5-12M84 62v-14M88 62c3-4 5-8 4-11" fill="none" stroke={p.leaf2} strokeWidth="1.1" />
      <circle cx="75" cy="50" r="3.4" fill={p.accent} />
      <circle cx="84" cy="46.4" r="3.6" fill={p.main} />
      <circle cx="92.4" cy="50.4" r="3.2" fill="#FFD24E" />
      <circle cx="79.4" cy="55" r="2.6" fill={p.accent2} />
      <circle cx="89" cy="55.6" r="2.4" fill={p.accent} />
      {[60, 106].map((x) => (
        <g key={x}>
          <rect x={x} y="62" width="3.2" height="12" rx="0.8" fill={p.white} />
          {c.evening ? (
            <g>
              <circle cx={x + 1.6} cy="58" r="8" fill={LIGHT.halo} opacity="0.32" />
              <path d={`M${x + 1.6} 61.4c-1.6-1.6-0.8-3.6 0-4.8 0.8 1.2 1.6 3.2 0 4.8z`} fill={LIGHT.lamp} />
            </g>
          ) : null}
        </g>
      ))}
      <circle cx="117" cy="68.6" r="3.6" fill="#F2A23C" />
      <circle cx="123" cy="69.4" r="3.2" fill="#E8584A" />
      <path d="M111 70h18a9 5 0 0 1-18 0z" fill={p.main2} />
      <ellipse cx="47" cy="73.4" rx="7" ry="1.4" fill={p.white} />
      <ellipse cx="47" cy="73" rx="4" ry="0.8" fill={p.linen} />
    </g>
  );
};

// ---------------------------------------------------------------- garage

/** A little car parked under a bulb, tools on the pegboard; a workbench for a shed. */
export const Garage: Scene = ({ c }) => {
  const { p, alt } = c;
  const concrete = c.evening ? mixColour(p.floor2, '#5A6070', 0.4) : mixColour(p.floor, '#B8BEC6', 0.65);
  const board = mixColour(p.wood, p.white, 0.25);
  const tools = (
    <g>
      <path d="M20 30v18" stroke={p.wood2} strokeWidth="2.2" strokeLinecap="round" />
      <rect x="15" y="27" width="10" height="5" rx="1.4" fill={p.metal2} />
      <path d="M34 28l8 20" stroke={p.metal2} strokeWidth="2" strokeLinecap="round" />
      <circle cx="33.4" cy="27" r="3.2" fill="none" stroke={p.metal2} strokeWidth="2" />
      <path d="M50 26h12l-2 22h-8z" fill={p.accent} opacity="0.9" />
      <path d="M52 30h8M52.4 35h7.2M52.8 40h6.4" stroke={p.shadow} strokeWidth="0.6" opacity="0.4" />
    </g>
  );
  return (
    <g>
      <Room c={c} floor={100} />
      <rect y="100" width={W} height="40" fill={concrete} />
      <rect x="10" y="20" width="58" height="34" rx="2" fill={board} />
      <g fill={p.wood2} opacity="0.35">
        {Array.from({ length: 6 }, (_, i) =>
          Array.from({ length: 4 }, (_, j) => <circle key={`${i}-${j}`} cx={15 + i * 9.6} cy={24.6 + j * 8.4} r="0.8" />),
        )}
      </g>
      {tools}
      <rect x="112" y="22" width="48" height="3" rx="1" fill={p.wood} />
      <rect x="116" y="12" width="9" height="10" rx="1.4" fill={p.main} />
      <rect x="128" y="14" width="9" height="8" rx="1.4" fill={p.accent2} />
      <rect x="140" y="11" width="10" height="11" rx="1.4" fill={p.metal} />
      <Pendant c={c} x={84} y={16} colour={p.ink} />
      {alt ? (
        // A workbench with a vice, pots and a saw.
        <g>
          {/* A bike against the wall, behind the bench's end. */}
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="136" cy="92" r="8" stroke={p.ink} strokeWidth="1.8" />
            <circle cx="156" cy="92" r="8" stroke={p.ink} strokeWidth="1.8" />
            <path d="M136 92l7-13h10l3 13M143 79l3 13 7-13M142 76h-4M153 79l-1.4-5h3.4" stroke={p.main} strokeWidth="2" />
          </g>
          <Shadow c={c} x={84} y={100} rx={56} ry={3} />
          <rect x="36" y="74" width="4" height="26" fill={p.wood2} />
          <rect x="128" y="74" width="4" height="26" fill={p.wood2} />
          <rect x="36" y="90" width="96" height="3" fill={p.wood2} />
          <rect x="30" y="68" width="108" height="7" rx="1.6" fill={p.wood} />
          <rect x="40" y="58" width="12" height="10" rx="1.4" fill={p.metal2} />
          <rect x="36" y="61" width="20" height="3" rx="1.2" fill={p.metal} />
          <path d="M70 68l4-12h10l4 12z" fill={p.pot} />
          <path d="M92 68l3-9h8l3 9z" fill={p.pot2} />
          <path d="M98 59c0-6 4-10 8-10" fill="none" stroke={p.leaf} strokeWidth="1.6" />
          <rect x="114" y="62" width="18" height="6" rx="1" fill={p.accent} />
          <path d="M60 86l18 2-2 4-16-2z" fill={p.metal} />
        </g>
      ) : (
        // A small round car.
        <g>
          <Shadow c={c} x={88} y={104} rx={54} ry={4} />
          <path d="M40 94V80c0-6 4-9 10-10l12-2 10-12c3-3 6-4 10-4h22c5 0 8 2 11 6l9 11c8 1 14 3 16 9v16z" fill={p.main} />
          <path d="M40 86h100" stroke={p.main2} strokeWidth="1.2" opacity="0.6" />
          <path d="M68 68l8-10c2-2 4-3 7-3h10v13z" fill={url(c, 'glass')} />
          <path d="M97 55h9c3 0 5 1 7 3l8 10h-24z" fill={url(c, 'glass')} />
          <path d="M95 55v31" stroke={p.main2} strokeWidth="1.2" />
          <rect x="99" y="72" width="7" height="2" rx="1" fill={p.main2} />
          <path d="M136 77h4v5h-5z" fill={c.evening ? LIGHT.lamp : '#FFE58A'} />
          <rect x="38" y="80" width="5" height="4" rx="1" fill="#F0705A" />
          <circle cx="62" cy="94" r="9" fill={p.ink} />
          <circle cx="62" cy="94" r="4" fill={p.metal} />
          <circle cx="120" cy="94" r="9" fill={p.ink} />
          <circle cx="120" cy="94" r="4" fill={p.metal} />
        </g>
      )}
    </g>
  );
};

// ---------------------------------------------------------------- stairs and landing

/** Stairs climbing with a runner, a banister, pictures going up, a cupboard underneath. */
export const Stairs: Scene = ({ c }) => {
  const { p } = c;
  const steps = 8;
  const run = 15;
  const rise = 10;
  const x0 = 26;
  const y0 = 104;
  let edge = `M${x0} ${y0}`;
  for (let i = 0; i < steps; i++) edge += `V${y0 - (i + 1) * rise}H${x0 + (i + 1) * run}`;
  const side = `${edge}V${y0}Z`;
  const rail = (i: number) => [x0 + i * run + run / 2, y0 - (i + 1) * rise] as const;
  return (
    <g>
      <Room c={c} floor={104} />
      {c.alt ? (
        // A tall landing window.
        <g>
          <Window c={c} x={22} y={8} w={26} h={40} />
          <Picture c={c} x={66} y={10} w={16} h={14} art={2} />
        </g>
      ) : (
        // Pictures going up with the stairs.
        <g>
          <Picture c={c} x={20} y={26} w={18} h={22} art={0} />
          <Picture c={c} x={46} y={14} w={20} h={16} art={1} />
          <Picture c={c} x={76} y={6} w={14} h={14} art={2} />
        </g>
      )}
      <Glow c={c} x={120} y={30} r={44} />
      <rect x="117" y="24" width="6" height="10" rx="3" fill={c.evening ? LIGHT.lamp : p.white} />
      <path d={side} fill={p.trim} />
      <path d={side} fill={p.wall2} opacity="0.5" />
      {/* Under-stairs cupboard. */}
      <path d="M92 104V72h20v32z" fill={p.wood} />
      <path d="M92 104V72h20v32z" fill="none" stroke={p.wood2} strokeWidth="1.2" />
      <circle cx="108" cy="90" r="1.4" fill={p.brass} />
      {/* Treads, risers and the runner. */}
      <path d={edge} fill="none" stroke={p.wood} strokeWidth="5" strokeLinejoin="round" />
      <path d={edge} fill="none" stroke={p.main} strokeWidth="3.4" strokeLinejoin="round" />
      {/* Banister and spindles. */}
      <g stroke={p.white} strokeWidth="2">
        {Array.from({ length: steps }, (_, i) => {
          const [x, y] = rail(i);
          return <path key={i} d={`M${x} ${y - 1}V${y - 24}`} />;
        })}
      </g>
      <path d={`M${x0 - 2} ${y0 - 36}L${x0 + steps * run} ${y0 - steps * rise - 30}`} stroke={p.wood2} strokeWidth="3.4" strokeLinecap="round" />
      <rect x={x0 - 6} y={y0 - 40} width="8" height="40" rx="1.6" fill={p.wood2} />
      <circle cx={x0 - 2} cy={y0 - 42} r="4.6" fill={p.wood} />
      <Plant c={c} x={150} y={104} k={0.9} kind={1} />
      <rect x="120" y="106" width="40" height="5" rx="2" fill={p.accent2} />
    </g>
  );
};

// ---------------------------------------------------------------- loft

/** Under the roof: a round window at the gable, boxes, a trunk, a bare bulb. */
export const Loft: Scene = ({ c }) => {
  const { p } = c;
  const beam = mixColour(p.wood2, p.shadow, 0.08);
  return (
    <g>
      <Room c={c} floor={104} />
      {/* The sloping ceiling either side. */}
      <path d="M0 0H62L0 62Z" fill={p.wood} />
      <path d="M168 0H106L168 62Z" fill={p.wood} />
      <g stroke={beam} strokeWidth="2.4" opacity="0.6">
        <path d="M0 14L14 0M0 30L30 0M0 46L46 0" />
        <path d="M168 14L154 0M168 30L138 0M168 46L122 0" />
      </g>
      <path d="M0 62L62 0M168 62L106 0" stroke={beam} strokeWidth="4" />
      {/* A round window. */}
      <circle cx="84" cy="30" r="17" fill={p.trim} />
      <clipPath id={c.id('round')}>
        <circle cx="84" cy="30" r="14" />
      </clipPath>
      <g clipPath={`url(#${c.id('round')})`}>
        <rect x="68" y="14" width="32" height="32" fill={url(c, 'glass')} />
        {c.evening ? (
          <g fill={LIGHT.star}>
            <circle cx="77" cy="24" r="0.8" />
            <circle cx="92" cy="38" r="0.7" />
            <circle cx="80" cy="38" r="0.6" />
          </g>
        ) : null}
        <path d="M70 46c4-6 8-8 14-6s10 0 16-4v10z" fill={c.evening ? '#1B2556' : mixColour(p.glassLow, '#7F9BB5', 0.42)} />
      </g>
      {c.evening ? <path d="M89 20a6 6 0 1 0 3 10 5 5 0 1 1-3-10z" fill={LIGHT.moon} /> : null}
      <path d="M84 13v34M67 30h34" stroke={p.trim} strokeWidth="1.8" />
      {/* A bare bulb. */}
      <path d="M130 22V40" stroke={p.ink} strokeWidth="0.8" opacity="0.7" />
      <Glow c={c} x={130} y={44} r={42} />
      <rect x="128.4" y="39" width="3.2" height="3" fill={p.metal2} />
      <circle cx="130" cy="45" r="3.6" fill={c.evening ? LIGHT.bulb : p.white} stroke={p.shadow} strokeOpacity="0.15" strokeWidth="0.6" />
      {c.alt ? (
        // A reading chair and a lamp.
        <g>
          <FloorLamp c={c} x={14} y={104} h={52} />
          <Shadow c={c} x={46} y={104} rx={22} ry={3} />
          <rect x="30" y="70" width="34" height="26" rx="9" fill={p.main} />
          <rect x="26" y="82" width="9" height="18" rx="4.4" fill={p.main} />
          <rect x="59" y="82" width="9" height="18" rx="4.4" fill={p.main} />
          <rect x="34" y="88" width="26" height="8" rx="3" fill={mixColour(p.main, p.white, 0.1)} />
          <rect x="30" y="96" width="34" height="5" rx="2" fill={p.main2} />
          <rect x="33" y="101" width="2.4" height="3" fill={p.wood2} />
          <rect x="58.6" y="101" width="2.4" height="3" fill={p.wood2} />
          <rect x="40" y="76" width="14" height="12" rx="3.4" fill={p.accent2} transform="rotate(-6 47 82)" />
        </g>
      ) : (
        // Boxes.
        <g>
          <Shadow c={c} x={36} y={104} rx={26} ry={3} />
          <rect x="14" y="80" width="30" height="24" rx="1.4" fill={p.card} />
          <rect x="27" y="80" width="5" height="24" fill={p.card2} opacity="0.5" />
          <rect x="22" y="62" width="26" height="18" rx="1.4" fill={mixColour(p.card, p.white, 0.12)} />
          <rect x="33" y="62" width="5" height="18" fill={p.card2} opacity="0.5" />
          <rect x="46" y="88" width="16" height="16" rx="1.2" fill={p.card2} />
        </g>
      )}
      {/* A trunk. */}
      <Shadow c={c} x={124} y={104} rx={26} ry={3} />
      <path d="M100 86c0-8 6-11 24-11s24 3 24 11z" fill={mixColour(p.accent, p.shadow, 0.12)} />
      <rect x="100" y="86" width="48" height="18" rx="1.6" fill={p.accent} />
      <path d="M100 86h48" stroke={p.brass} strokeWidth="1.6" />
      <rect x="121" y="84" width="6" height="7" rx="1" fill={p.brass} />
      <path d="M100 86v18M148 86v18" stroke={p.brass} strokeWidth="2.4" />
      <rect x="74" y="98" width="18" height="6" rx="1" fill={p.main} />
      <rect x="76" y="93" width="15" height="5" rx="1" fill={p.accent2} />
    </g>
  );
};

// ---------------------------------------------------------------- nursery

/** A cot under a turning mobile, bunting, a teddy and building blocks. */
export const Nursery: Scene = ({ c }) => {
  const { p } = c;
  const teddy = c.evening ? mixColour('#C98D5A', '#1D2452', 0.5) : '#C98D5A';
  const muzzle = c.evening ? mixColour('#EED2B0', '#1D2452', 0.5) : '#EED2B0';
  return (
    <g>
      <Room c={c} floor={104} />
      <Window c={c} x={112} y={30} w={36} h={28} moon curtains={p.accent2} />
      <Bunting c={c} x0={-4} x1={172} y={8} colours={[p.accent, p.main, p.accent2, p.main2]} />
      {/* Night light. */}
      <Glow c={c} x={22} y={62} r={26} />
      <path d="M22 56l2 4 4.4 0.6-3.2 3 0.8 4.4-4-2-4 2 0.8-4.4-3.2-3 4.4-0.6z" fill={c.evening ? LIGHT.lamp : '#FFE08A'} />
      <rect x="14" y="70" width="16" height="3" rx="1" fill={p.wood} />
      {c.alt ? (
        // A play tent.
        <g>
          <Shadow c={c} x={60} y={104} rx={38} ry={3} />
          <path d="M60 28L54 16M60 28L66 16M60 28V14" stroke={p.wood2} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M60 14l9 3-9 3z" fill={p.accent} />
          <path d="M60 28L26 104H94Z" fill={p.white} />
          <path d="M60 28L26 104H38ZM60 28L82 104H94Z" fill={p.accent2} />
          <path d="M60 50L46 104H74Z" fill={mixColour(p.main, p.shadow, 0.3)} />
          <path d="M60 50L46 104H52ZM60 50L68 104H74Z" fill={p.main} />
          <ellipse cx="60" cy="101" rx="8" ry="2.6" fill={p.accent} />
        </g>
      ) : (
        <g>
          {/* The mobile. */}
          <path d="M62 0V22" stroke={p.ink} strokeWidth="0.6" opacity="0.5" />
          <g className={s.sway}>
            <path d="M46 22h32" stroke={p.wood2} strokeWidth="1.4" strokeLinecap="round" />
            <path d="M48 22v10M62 22v14M76 22v8" stroke={p.ink} strokeWidth="0.5" opacity="0.5" />
            <path d="M48 31.6a3.6 3.6 0 1 0 3 5.6 3 3 0 1 1-3-5.6z" fill="#FFE08A" />
            <path d="M62 36l1.6 3.2 3.4 0.4-2.4 2.4 0.6 3.4-3.2-1.6-3.2 1.6 0.6-3.4-2.4-2.4 3.4-0.4z" fill={p.accent} />
            <circle cx="76" cy="33" r="3" fill={p.main} />
          </g>
          {/* The cot. */}
          <Shadow c={c} x={62} y={104} rx={38} ry={3} />
          <rect x="28" y="50" width="5" height="54" rx="2" fill={p.white} />
          <rect x="91" y="50" width="5" height="54" rx="2" fill={p.white} />
          <rect x="31" y="84" width="62" height="7" fill={p.white} />
          <rect x="33" y="80" width="58" height="5" rx="2" fill={p.accent2} />
          <g fill={p.white}>
            {Array.from({ length: 9 }, (_, i) => (
              <rect key={i} x={36 + i * 6.4} y="58" width="2" height="26" rx="1" />
            ))}
          </g>
          <rect x="29" y="55" width="66" height="4" rx="2" fill={p.white} />
          <path d="M68 57h20v18c0 2-1 3-3 3H71c-2 0-3-1-3-3z" fill={p.main} />
          <path d="M68 66h20" stroke={p.main2} strokeWidth="1" />
        </g>
      )}
      {/* Teddy and blocks on a round rug. */}
      <ellipse cx="128" cy="116" rx="36" ry="7" fill={p.accent2} />
      <g transform="translate(118 110)">
        <ellipse cx="0" cy="-8" rx="8" ry="9" fill={teddy} />
        <ellipse cx="0" cy="-6" rx="4.4" ry="5" fill={muzzle} />
        <ellipse cx="-7" cy="-2" rx="3.6" ry="3" fill={teddy} />
        <ellipse cx="7" cy="-2" rx="3.6" ry="3" fill={teddy} />
        <circle cx="0" cy="-21" r="7" fill={teddy} />
        <circle cx="-6" cy="-26" r="2.8" fill={teddy} />
        <circle cx="6" cy="-26" r="2.8" fill={teddy} />
        <ellipse cx="0" cy="-18.4" rx="3.4" ry="2.6" fill={muzzle} />
        <circle cx="-2.6" cy="-22.6" r="0.9" fill={p.ink} />
        <circle cx="2.6" cy="-22.6" r="0.9" fill={p.ink} />
        <path d="M-0.9 -19.4h1.8l-0.9 1z" fill={p.ink} />
        <path d="M-4 -15l4 2.4 4-2.4" fill="none" stroke={p.accent} strokeWidth="1.6" strokeLinecap="round" />
      </g>
      <rect x="138" y="100" width="11" height="11" rx="1.4" fill={p.main} />
      <rect x="150" y="100" width="11" height="11" rx="1.4" fill={p.accent} />
      <rect x="144" y="89" width="11" height="11" rx="1.4" fill="#FFD24E" />
      <path d="M140 102h7M152 102h7M146 91h7" stroke="#FFFFFF" strokeWidth="1" opacity="0.5" />
    </g>
  );
};

// ---------------------------------------------------------------- any other room

/** A room it doesn't know: still cosy, and different from room to room. */
export const AnyRoom: Scene = ({ c }) => {
  const { p } = c;
  // The other composition is the next set of furniture.
  const detail = (c.detail + (c.alt ? 1 : 0)) % 3;
  return (
    <g>
      <Room c={c} floor={100} />
      {detail === 0 ? (
        // An armchair, a lamp and a side table.
        <g>
          <Window c={c} x={14} y={14} w={38} h={34} curtains={p.accent2} />
          <Picture c={c} x={98} y={18} w={24} h={20} art={1} />
          <FloorLamp c={c} x={144} y={100} h={60} />
          <Shadow c={c} x={98} y={100} rx={30} ry={3.4} />
          <rect x="74" y="54" width="48" height="34" rx="12" fill={p.main} />
          <rect x="70" y="70" width="12" height="24" rx="6" fill={p.main} />
          <rect x="114" y="70" width="12" height="24" rx="6" fill={p.main} />
          <rect x="80" y="76" width="36" height="10" rx="4" fill={mixColour(p.main, p.white, 0.1)} />
          <rect x="74" y="86" width="48" height="8" rx="3" fill={p.main2} />
          <rect x="78" y="94" width="3" height="6" fill={p.wood2} />
          <rect x="115" y="94" width="3" height="6" fill={p.wood2} />
          <rect x="88" y="64" width="18" height="14" rx="4" fill={p.accent} transform="rotate(-6 97 71)" />
          <rect x="34" y="78" width="22" height="3" rx="1.4" fill={p.wood} />
          <rect x="43.6" y="81" width="3" height="19" fill={p.wood2} />
          <rect x="38" y="70" width="7" height="8" rx="1.6" fill={p.accent} />
          <Plant c={c} x={18} y={100} k={0.9} kind={1} />
        </g>
      ) : detail === 1 ? (
        // A bookcase, a picture and a plant.
        <g>
          <Picture c={c} x={18} y={22} w={34} h={26} art={0} />
          <Plant c={c} x={36} y={100} k={1.1} kind={2} />
          <Shadow c={c} x={112} y={100} rx={34} ry={3} />
          <rect x="80" y="20" width="64" height="80" rx="2" fill={p.wood} />
          <rect x="84" y="24" width="56" height="72" fill={mixColour(p.wood2, p.shadow, 0.2)} />
          {[44, 70].map((y) => (
            <rect key={y} x="84" y={y} width="56" height="3" fill={p.wood} />
          ))}
          {[
            [86, 24, 16, p.main],
            [91, 24, 18, p.accent],
            [96, 24, 14, p.accent2],
            [101, 24, 19, p.main2],
            [120, 24, 15, p.white],
            [125, 24, 17, p.accent],
            [88, 47, 20, p.accent2],
            [93, 47, 16, p.main2],
            [113, 47, 21, p.main],
            [118, 47, 18, p.white],
            [123, 47, 15, p.accent],
            [86, 73, 20, p.main],
            [91, 73, 18, p.accent2],
            [131, 73, 22, p.main2],
          ].map(([x, top, h, fill]) => (
            <rect key={`${x}-${top}`} x={x as number} y={(top as number) + 20 - (h as number)} width="4.4" height={h as number} rx="0.8" fill={fill as string} />
          ))}
          <circle cx="132" cy="38" r="5" fill={p.pot} />
          <path d="M106 96a8 8 0 0 1 16 0z" fill={p.accent} />
          <rect x="54" y="104" width="68" height="10" rx="5" fill={p.accent2} />
        </g>
      ) : (
        // A console table with flowers under a round mirror.
        <g>
          <circle cx="84" cy="36" r="20" fill={p.brass} />
          <circle cx="84" cy="36" r="17.4" fill={url(c, 'glass')} />
          <path d="M74 30l10-10M75 40l16-16" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
          <Glow c={c} x={46} y={52} r={30} />
          <TableLamp c={c} x={46} y={72} shade={p.accent2} />
          <Shadow c={c} x={84} y={100} rx={44} ry={3} />
          <rect x="40" y="72" width="88" height="5" rx="1.6" fill={p.wood} />
          <rect x="44" y="77" width="3.4" height="23" fill={p.wood2} />
          <rect x="120.6" y="77" width="3.4" height="23" fill={p.wood2} />
          <rect x="47" y="88" width="74" height="2.4" fill={p.wood2} />
          <path d="M100 72l2-12h8l2 12z" fill={p.main} />
          <path d="M104 60c-3-5-3-10 0-13M106 60v-15M108 60c3-5 4-9 2-12" fill="none" stroke={p.leaf2} strokeWidth="1" />
          <circle cx="104" cy="46" r="3" fill={p.accent} />
          <circle cx="106" cy="43" r="3" fill={p.accent2} />
          <circle cx="110" cy="47" r="2.6" fill={p.accent} />
          <path d="M78 82h22l-2 6H80z" fill={p.wood2} />
          <rect x="60" y="64" width="10" height="8" rx="1" fill={p.accent2} />
          <Plant c={c} x={150} y={100} k={1} kind={0} />
          <Plant c={c} x={18} y={100} k={0.8} kind={1} />
        </g>
      )}
    </g>
  );
};
