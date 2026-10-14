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

/** A broom (housekeeping): a visit on Home's calendar, and its row under the calendar. */
export function BroomIcon({ size = 16, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <path d="M12 2.5v6.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M8.5 9h7a1.5 1.5 0 0 1 1.5 1.5V13H7v-2.5A1.5 1.5 0 0 1 8.5 9zM6.8 14h10.4l2.6 7.2a.6.6 0 0 1-.56.8H4.76a.6.6 0 0 1-.56-.8zM9.1 17.2l-.6 3.8h1.1l.5-3.8zM12.55 17.2h-1.1v3.8h1.1zM14.9 17.2l.5 3.8h1.1l-.6-3.8z"
      />
    </svg>
  );
}

/** ellipsis (a room's menu on Home). */
export function EllipsisIcon({ size = 20, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <circle cx="5.5" cy="12" r="1.9" fill="currentColor" />
      <circle cx="12" cy="12" r="1.9" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.9" fill="currentColor" />
    </svg>
  );
}

/** chevron.down (a menu button, Show more). */
export function ChevronDownIcon({ size = 12, strokeWidth = 2.4, ...p }: IconProps) {
  return (
    <svg {...base(size, p)} viewBox="0 0 14 8">
      <path d="M1.5 1.5L7 6.5l5.5-5" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** arrow.triangle.2.circlepath (an item repeats). */
export function RepeatIcon({ size = 14, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <path
        d="M4.5 11a7.5 7.5 0 0 1 13.2-4.6M19.5 13a7.5 7.5 0 0 1-13.2 4.6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M18.6 3.2v3.9h-3.9M5.4 20.8v-3.9h3.9"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** person.2 (Everyone, in Home's person menu). */
export function PeopleIcon({ size = 20, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <circle cx="9" cy="8.5" r="3.3" stroke="currentColor" strokeWidth="2" />
      <path d="M3.2 19.2c.6-3.1 3-4.9 5.8-4.9s5.2 1.8 5.8 4.9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M15.4 5.6a3.1 3.1 0 0 1 0 6M17.6 14.6c1.7.6 2.9 2.2 3.2 4.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** checkmark.seal.fill (all clear). The check is cut out in the card colour. */
export function SealCheckIcon({ size = 22, ...p }: IconProps) {
  return (
    <svg {...base(size, p)}>
      <path
        d="M12 2.8l2.3 1.7 2.9-.1.9 2.7 2.3 1.8-.9 2.7.9 2.7-2.3 1.8-.9 2.7-2.9-.1L12 21.2l-2.3-1.7-2.9.1-.9-2.7-2.3-1.8.9-2.7-.9-2.7 2.3-1.8.9-2.7 2.9.1z"
        fill="currentColor"
      />
      <path d="M8.4 12.2l2.4 2.4 4.8-4.9" stroke="var(--card)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
