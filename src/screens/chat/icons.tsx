// Chat glyphs (SF Symbols stand-ins), drawn like src/ui/icons.tsx.
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

/** arrow.up (send) */
export function ArrowUpIcon({ size = 20, strokeWidth = 2.6, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <path
        d="M12 19.5V5M5.5 11L12 4.5 18.5 11"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** arrow.down (jump to the newest messages) */
export function ArrowDownIcon({ size = 16, strokeWidth = 2.4, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <path
        d="M12 4.5V19M5.5 13L12 19.5 18.5 13"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** doc.on.doc (Copy) */
export function CopyIcon({ size = 20, strokeWidth = 1.7, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <rect x="8.5" y="8.5" width="11" height="12" rx="2.5" stroke="currentColor" strokeWidth={strokeWidth} />
      <path
        d="M15.5 8.5V6a2.5 2.5 0 00-2.5-2.5H7A2.5 2.5 0 004.5 6v7.5A2.5 2.5 0 007 16h1.5"
        stroke="currentColor"
        strokeWidth={strokeWidth}
      />
    </svg>
  );
}

/** trash (Delete) */
export function TrashIcon({ size = 20, strokeWidth = 1.7, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <path
        d="M4.5 6.5h15M9.5 6.5V5a1.5 1.5 0 011.5-1.5h2A1.5 1.5 0 0114.5 5v1.5M6.5 6.5l.8 12.1a2 2 0 002 1.9h5.4a2 2 0 002-1.9l.8-12.1M10 10.5v6M14 10.5v6"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** arrow.clockwise (Try Again) */
export function RetryIcon({ size = 20, strokeWidth = 1.8, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <path
        d="M19 12a7 7 0 11-2.05-4.95M19 4.5v3.5h-3.5"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** exclamationmark.circle.fill (not delivered) */
export function NotDeliveredIcon({ size = 24, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <circle cx="12" cy="12" r="10" fill="#FF3B30" />
      <path d="M12 7v6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="12" cy="16.6" r="1.4" fill="#fff" />
    </svg>
  );
}

/** face.smiling with a plus (more reactions) */
export function MoreReactionsIcon({ size = 24, strokeWidth = 1.8, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <path d="M12 6.5v11M6.5 12h11" stroke="currentColor" strokeWidth={strokeWidth + 0.4} strokeLinecap="round" />
    </svg>
  );
}
