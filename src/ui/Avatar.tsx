import type { CSSProperties } from 'react';

interface AvatarProps {
  emoji: string;
  /** Circle diameter in px. */
  size: number;
  /** Emoji font size in px. */
  emojiSize: number;
  background?: string;
  /** Inset ring colour (Stats legend uses the member colour at 2.5px). */
  ring?: string;
  ringWidth?: number;
  shadow?: string;
  className?: string;
  style?: CSSProperties;
}

/** Emoji in a circle: nav avatar (38/22, #E5E5EA), legend (36/20), profile (112/62, white). */
export function Avatar({
  emoji,
  size,
  emojiSize,
  background = 'var(--avatar-bg)',
  ring,
  ringWidth = 2.5,
  shadow,
  className,
  style,
}: AvatarProps) {
  const shadows = [ring ? `inset 0 0 0 ${ringWidth}px ${ring}` : null, shadow ?? null].filter(Boolean).join(', ');
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background,
        boxShadow: shadows || undefined,
        display: 'grid',
        placeItems: 'center',
        fontSize: emojiSize,
        lineHeight: 1,
        flex: 'none',
        userSelect: 'none',
        ...style,
      }}
    >
      {emoji}
    </span>
  );
}
