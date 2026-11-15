import type { SVGProps } from 'react';

/** The app's icons: 24px, drawn with a 2px stroke in the current colour. */
export type IconName =
  | 'meditate'
  | 'bolt'
  | 'family'
  | 'weekly'
  | 'plus'
  | 'close'
  | 'chevron-right'
  | 'chevron-left'
  | 'chevron-down'
  | 'play'
  | 'pause'
  | 'check'
  | 'bookmark'
  | 'bookmark-filled'
  | 'external'
  | 'sparkle'
  | 'clock'
  | 'voice'
  | 'voice-off'
  | 'edit'
  | 'trash'
  | 'flame'
  | 'shield'
  | 'book'
  | 'user'
  | 'heart'
  | 'restart'
  | 'info'
  | 'search';

const PATHS: Record<IconName, JSX.Element> = {
  meditate: (
    <>
      <circle cx="12" cy="5" r="2.2" />
      <path d="M12 8.5v4.2M6 20.5c1.6-1.6 3.6-2.4 6-2.4s4.4.8 6 2.4M4 14.5l3.4-1.4 4.6-.4 4.6.4 3.4 1.4" />
      <path d="M8.5 17.2 12 12.7l3.5 4.5" />
    </>
  ),
  bolt: <path d="M13.2 2.8 5.6 13.2h5.6l-1 8 7.8-10.6h-5.7l.9-7.8Z" />,
  family: (
    <>
      <circle cx="8.5" cy="6.8" r="2.6" />
      <circle cx="16.4" cy="9.4" r="2" />
      <path d="M3.8 19.5v-1.8a4.7 4.7 0 0 1 9.4 0v1.8M13.4 15.1a3.6 3.6 0 0 1 6.6 2v2.4" />
    </>
  ),
  weekly: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15.5" rx="3" />
      <path d="M7.5 9h9M7.5 12.5h9M7.5 16h5.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
  'chevron-right': <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  'chevron-left': <path d="M14.5 5.5 8 12l6.5 6.5" />,
  'chevron-down': <path d="m5.5 9.5 6.5 6.5 6.5-6.5" />,
  play: <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  bookmark: <path d="M6.5 3.5h11v17l-5.5-4-5.5 4v-17Z" />,
  'bookmark-filled': <path d="M6.5 3.5h11v17l-5.5-4-5.5 4v-17Z" fill="currentColor" />,
  external: <path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10" />,
  sparkle: <path d="M12 3.5c.6 4.3 2.2 5.9 6.5 6.5-4.3.6-5.9 2.2-6.5 6.5-.6-4.3-2.2-5.9-6.5-6.5 4.3-.6 5.9-2.2 6.5-6.5ZM18.5 15.5c.3 1.8 1 2.5 2.8 2.8-1.8.3-2.5 1-2.8 2.8-.3-1.8-1-2.5-2.8-2.8 1.8-.3 2.5-1 2.8-2.8Z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  voice: <path d="M4.5 9.5v5h3.5l5 4v-13l-5 4H4.5ZM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />,
  'voice-off': <path d="M4.5 9.5v5h3.5l5 4v-13l-5 4H4.5ZM16.5 9.5l5 5M21.5 9.5l-5 5" />,
  edit: <path d="M4.5 19.5h4l10-10a2.8 2.8 0 0 0-4-4l-10 10v4ZM13.5 6.5l4 4" />,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5" />,
  flame: <path d="M12 21c-3.6 0-6.5-2.6-6.5-6.2 0-3.3 2.4-5.2 3.6-8.3.4 1.9 1.5 3 2.6 3.4C12 6.8 13.4 4.3 15.6 3c-.4 3 3 5.5 3 10.2 0 4.6-3 7.8-6.6 7.8Z" />,
  shield: (
    <>
      <path d="M12 3 5 6v5.5c0 4.4 2.9 8 7 9.5 4.1-1.5 7-5.1 7-9.5V6l-7-3Z" />
      <path d="m8.8 12 2.3 2.3 4.2-4.6" />
    </>
  ),
  book: <path d="M12 6.5C10.3 5 8 4.5 4.5 4.5v14c3.5 0 5.8.5 7.5 2 1.7-1.5 4-2 7.5-2v-14c-3.5 0-5.8.5-7.5 2Zm0 0v14" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  heart: <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z" />,
  restart: <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.6v.2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
};

/** Solid shapes (drawn filled rather than stroked). */
const FILLED: Partial<Record<IconName, true>> = { play: true, bolt: true };

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  /** Fill the shape instead of stroking it (the bolt and play are filled by default). */
  filled?: boolean;
}

/** A decorative icon. Give the control around it a label; the icon itself is hidden from screen readers. */
export function Icon({ name, size = 24, filled, ...rest }: IconProps) {
  const solid = filled ?? FILLED[name] ?? false;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={solid ? 1.2 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
