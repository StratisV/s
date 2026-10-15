import { GlyphIcon, roomGlyph } from '../home/RoomIcon';

/**
 * A section's drawing (decorative: its name is always written next to it): the room's own
 * from Home when the name is a room's (Kitchen: a pot, Bathrooms: a bath, Bedrooms: a bed,
 * Living room: a sofa, Hallway: a door, Garden: a leaf, Laundry: a washer), else a quiet list.
 */
export function SectionIcon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  const glyph = roomGlyph(name);
  if (glyph !== 'house') return <GlyphIcon glyph={glyph} size={size} className={className} />;
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
      <path d="M9.5 7h10M9.5 12h10M9.5 17h10" />
      <circle cx="5" cy="7" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}
