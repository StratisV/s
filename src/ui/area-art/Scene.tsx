// The drawings, loaded as one chunk the first time an area's picture is shown (AreaArt.tsx).
import { useId, useMemo } from 'react';
import { AnyRoom, Bathroom, Bedroom, Dining, Garage, Hallway, Kitchen, Living, Loft, Nursery, Office, Stairs, Utility } from './indoor';
import { Defs, H, W, paint, type Ctx } from './kit';
import { Balcony, FrontGarden, Garden, GardenRoom, HotTub } from './outdoor';
import type { ArtPick, SceneKind } from './pick';
import s from './AreaArt.module.css';

const SCENES: Record<SceneKind, (props: { c: Ctx }) => JSX.Element> = {
  kitchen: Kitchen,
  living: Living,
  bathroom: Bathroom,
  bedroom: Bedroom,
  hallway: Hallway,
  garden: Garden,
  frontGarden: FrontGarden,
  gardenRoom: GardenRoom,
  hotTub: HotTub,
  utility: Utility,
  office: Office,
  dining: Dining,
  garage: Garage,
  stairs: Stairs,
  loft: Loft,
  balcony: Balcony,
  nursery: Nursery,
  room: AnyRoom,
};

export interface SceneProps {
  pick: ArtPick;
  /** Dark mode: the scene in the evening. */
  evening: boolean;
  /** Fade in (the first time the drawings arrive). */
  fade: boolean;
}

/** One area's scene as an SVG that covers its box (cropped, never stretched). */
export default function Scene({ pick, evening, fade }: SceneProps) {
  const uid = `aa${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const p = useMemo(() => paint(pick.colourway, evening), [pick.colourway, evening]);
  const c: Ctx = { p, evening, alt: pick.alt, detail: pick.detail, id: (name) => `${uid}-${name}` };
  const Draw = SCENES[pick.kind];
  return (
    <svg
      className={s.svg}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      focusable="false"
      data-fade={fade || undefined}
      data-evening={evening || undefined}
    >
      <Defs c={c} />
      <g transform={pick.mirror ? `matrix(-1 0 0 1 ${W} 0)` : undefined}>
        <Draw c={c} />
      </g>
    </svg>
  );
}
