// STUB, until the illustrated version is merged (it replaces this file). A soft wash in a hue
// picked from `seed`, with the room's glyph in the middle, so every area looks a little
// different. Inline styles only, so nothing is left behind when the illustrated file lands.
import type { CSSProperties } from 'react';
import { RoomIcon } from '../../screens/home/RoomIcon';

export interface AreaArtProps {
  name: string;
  seed: string;
  className?: string;
}

/** A small, steady number from a string (FNV-1a). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * An area's illustration, filling its box (any aspect ratio, cropped to cover). Decorative:
 * hidden from assistive tech. Works in light and dark (a wash of colour over the card).
 */
export function AreaArt({ name, seed, className }: AreaArtProps): JSX.Element {
  const hue = hash(`${seed}:${name}`) % 360;
  // The caller's class gives the box; the wash fills it whatever its shape.
  const style: CSSProperties = {
    display: 'grid',
    placeItems: 'center',
    overflow: 'hidden',
    background: `radial-gradient(120% 90% at 20% 0%, hsl(${hue} 85% 70% / 0.55), transparent 70%), linear-gradient(160deg, hsl(${hue} 70% 62% / 0.32), hsl(${(hue + 40) % 360} 70% 55% / 0.22)), var(--card)`,
    color: `hsl(${hue} 45% 45%)`,
  };
  return (
    <div className={className} style={style} aria-hidden="true" data-area-art="">
      <RoomIcon name={name} size={40} />
    </div>
  );
}
