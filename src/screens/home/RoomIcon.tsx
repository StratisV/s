import type { ReactNode } from 'react';

// A small line drawing for each room (Kitchen, Garden Lounge, Front garden...), chosen from
// its name, so the eye can find a room on Home without reading every name (Apple Home's
// room icons). A room with a name it doesn't know gets a house.

/** A room's drawing. */
export type Glyph = 'pot' | 'sofa' | 'bath' | 'bed' | 'leaf' | 'plant' | 'tub' | 'door' | 'tulip' | 'car' | 'washer' | 'desk' | 'fork' | 'house';

/** First match wins, so the more particular names come first ("Garden Lounge" before "Garden"). */
const RULES: [RegExp, Glyph][] = [
  [/garden lounge|conservatory|garden room|summer ?house|orangery|greenhouse/, 'plant'],
  [/front (garden|yard|lawn)|porch|drive/, 'tulip'],
  [/jacuzzi|hot ?tub|\bspa\b|pool|sauna/, 'tub'],
  [/living|sitting|family|\bden\b|snug|lounge|front room/, 'sofa'],
  [/garden|yard|lawn|patio|terrace|balcony|shed/, 'leaf'],
  [/kitchen|pantry|larder/, 'pot'],
  [/bath|shower|toilet|\bwc\b|\bloo\b|en.?suite|cloakroom|washroom/, 'bath'],
  [/bed|nursery|guest/, 'bed'],
  [/hall|entr|corridor|landing|stair/, 'door'],
  [/garage|\bcar\b/, 'car'],
  [/laundry|utility|wash/, 'washer'],
  [/office|study|desk|work/, 'desk'],
  [/dining/, 'fork'],
];

export function roomGlyph(name: string): Glyph {
  const n = name.toLowerCase();
  return RULES.find(([re]) => re.test(n))?.[1] ?? 'house';
}

const PATHS: Record<Glyph, ReactNode> = {
  pot: (
    <>
      <path d="M5 11h14v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" />
      <path d="M3 11h18M2.5 14H5M19 14h2.5M9.5 7.5h5M12 7.5V11" />
    </>
  ),
  sofa: (
    <>
      <path d="M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11" />
      <path d="M3 13a2 2 0 0 1 4 0v1.5h10V13a2 2 0 0 1 4 0v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M6 18v1.5M18 18v1.5" />
    </>
  ),
  bath: (
    <>
      <path d="M3 12h18v1.5A5.5 5.5 0 0 1 15.5 19h-7A5.5 5.5 0 0 1 3 13.5z" />
      <path d="M6 12V6.5a2.5 2.5 0 0 1 4.6-1.4M8 19l-1 2M16 19l1 2" />
    </>
  ),
  bed: (
    <>
      <path d="M3 5v15M3 15.5h18V20M21 15.5V13a3 3 0 0 0-3-3h-7v5.5" />
      <rect x="5.5" y="10.5" width="3.5" height="3" rx="1.5" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 19c0-8 5-14 15-14 0 9-5.5 14-13.5 14" />
      <path d="M5 19c2.5-4 5.5-7 10-9.5" />
    </>
  ),
  plant: (
    <>
      <path d="M7 13.5h10l-1.4 6.5H8.4z" />
      <path d="M12 13.5V9.5M12 9.5c0-3 2-5 5-5 0 3-2 5-5 5zM12 10.5c0-2.6-1.7-4.2-4.2-4.2 0 2.4 1.6 4.2 4.2 4.2z" />
    </>
  ),
  tub: (
    <>
      <path d="M3 12.5h18v2.5a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5z" />
      <path d="M6 16c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1" />
      <circle cx="8.5" cy="8" r="1.3" />
      <circle cx="12.5" cy="5.5" r="1.7" />
      <circle cx="16" cy="8.8" r="1" />
    </>
  ),
  door: (
    <>
      <path d="M6 20.5V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5v16M3.5 20.5h17" />
      <circle cx="14.8" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  tulip: (
    <>
      <path d="M12 21v-8M12 13c-2.8 0-4.8-2-4.8-4.8V5l2.4 1.8L12 4l2.4 2.8L16.8 5v3.2c0 2.8-2 4.8-4.8 4.8z" />
      <path d="M12 18.5c-2.4 0-4-1.4-4.6-3.4 2.4 0 4 1.4 4.6 3.4zM12 17c1.8 0 3.2-1 3.8-2.6-1.9 0-3.2 1-3.8 2.6z" />
    </>
  ),
  car: (
    <>
      <path d="M4 16.5V13l1.8-4.6A2 2 0 0 1 7.7 7h8.6a2 2 0 0 1 1.9 1.4L20 13v3.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 13h16" />
      <path d="M6.5 17.5V19M17.5 17.5V19" />
      <circle cx="7.5" cy="15" r="0.6" fill="currentColor" />
      <circle cx="16.5" cy="15" r="0.6" fill="currentColor" />
    </>
  ),
  washer: (
    <>
      <rect x="4.5" y="3" width="15" height="18" rx="2.5" />
      <circle cx="12" cy="13" r="4.2" />
      <path d="M7.5 6.5h2" />
    </>
  ),
  desk: (
    <>
      <rect x="5" y="4.5" width="14" height="10" rx="1.5" />
      <path d="M3 18.5h18M9.5 14.5l-.5 4M14.5 14.5l.5 4" />
    </>
  ),
  fork: (
    <>
      <path d="M7 3v6a2 2 0 0 0 4 0V3M9 3v18M16.5 21V3c-2 1-3 3.5-3 6.5v3.5h3" />
    </>
  ),
  house: (
    <>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
    </>
  ),
};

/** The room's line icon (decorative: the room's name is always written next to it). */
export function RoomIcon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  return <GlyphIcon glyph={roomGlyph(name)} size={size} className={className} />;
}

/** One drawing, by name (decorative). */
export function GlyphIcon({ glyph, size = 20, className }: { glyph: Glyph; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[glyph]}
    </svg>
  );
}
