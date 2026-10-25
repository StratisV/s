// Symbols the Goals tab and its public page use (SF Symbols stand-ins, as src/ui/icons.tsx).
import type { SVGProps } from 'react';

type IconProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>;

const base = (size: number, props: Omit<IconProps, 'size'>) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  'aria-hidden': true,
  focusable: false,
  ...props,
});

/** link (the public link). */
export function LinkIcon({ size = 18, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <path
        d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3.3-3.3a3.6 3.6 0 0 0-5.1-5.1l-1.1 1.1M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3.3 3.3a3.6 3.6 0 0 0 5.1 5.1l1.1-1.1"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** arrow.turn.down.right (Bring over: last week's goals come down into this one). */
export function BringOverIcon({ size = 22, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <path d="M5.5 4.5v6a4 4 0 0 0 4 4h9M14.5 10.5l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** circle.dashed with a person's head: nobody on a goal yet. */
export function NobodyIcon({ size = 18, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <circle cx="12" cy="12" r="8.6" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.6 2.4" />
      <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.2 16.4c.8-1.5 2.2-2.3 3.8-2.3s3 .8 3.8 2.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** link.badge.minus stand-in: the link crossed out (Turn Off Link). */
export function LinkOffIcon({ size = 20, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <path
        d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3.3-3.3a3.6 3.6 0 0 0-5.1-5.1l-1.1 1.1M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3.3 3.3a3.6 3.6 0 0 0 5.1 5.1l1.1-1.1M4.5 4.5l15 15"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** doc.on.doc (Copy Link). */
export function CopyIcon({ size = 20, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
