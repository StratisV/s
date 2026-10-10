// SF Symbols stand-ins drawn as inline SVG (no icon font to load).
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

/** xmark */
export function XMarkIcon({ size = 22, strokeWidth = 2.4, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}

/** checkmark */
export function CheckIcon({ size = 24, strokeWidth = 2.6, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <path
        d="M4.5 12.5l5 5L19.5 7"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** plus */
export function PlusIcon({ size = 32, strokeWidth = 2.2, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <path d="M12 4.5v15M4.5 12h15" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}

/** chevron.right (list rows) */
export function ChevronRightIcon({ size = 14, strokeWidth = 2.4, ...p }: IconProps) {
  return (
    <svg {...base(size, p)} viewBox="0 0 8 14">
      <path d="M1.5 1.5L6.5 7l-5 5.5" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** chevron.left (back) */
export function ChevronLeftIcon({ size = 20, strokeWidth = 2.6, ...p }: IconProps) {
  return (
    <svg {...base(size, p)} viewBox="0 0 12 20">
      <path d="M10 2L2 10l8 8" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** square.and.arrow.up (iOS Share): Share item, Share <area>, and the Add to Home Screen hint. */
export function ShareIcon({ size = 18, strokeWidth = 1.8, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <path
        d="M12 3v12M8 7l4-4 4 4M7 10H6a2 2 0 00-2 2v7a2 2 0 002 2h12a2 2 0 002-2v-7a2 2 0 00-2-2h-1"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** minus.circle.fill (iOS edit-mode delete). */
export function MinusCircleIcon({ size = 22, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <circle cx="12" cy="12" r="11" fill="#FF3B30" />
      <path d="M7 12h10" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** plus.circle.fill (iOS edit-mode insert). */
export function PlusCircleIcon({ size = 22, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <circle cx="12" cy="12" r="11" fill="#34C759" />
      <path d="M12 7v10M7 12h10" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** line.3.horizontal (reorder grip). */
export function GripIcon({ size = 22, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <path d="M4 8h16M4 12h16M4 16h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** The official multicolour Google "G" (sign-in branding guidelines). */
export function GoogleGIcon({ size = 20, ...p }: IconProps) {
  return (
    <svg {...base(size, p)} viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
