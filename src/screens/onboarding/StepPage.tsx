import { useEffect, useRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import styles from './Onboarding.module.css';

/** How a step arrives: pushed (forward), popped (back), or not animated (first screen). */
export type Enter = 'forward' | 'back' | null;

interface StepPageProps {
  /** Accessible name of the step (announced when it takes focus). */
  label: string;
  enter: Enter;
  /** Contents of the 52px nav row; omitted when the step has no nav controls. */
  nav?: ReactNode;
  children: ReactNode;
}

/**
 * One full-screen setup step: a scroll area below the status bar with the
 * scroll-edge fade. Children lay out in a column, so a `.spacer` followed by a
 * `.footer` keeps the actions at the bottom (and sticky while content scrolls).
 */
export function StepPage({ label, enter, nav, children }: StepPageProps) {
  const ref = useRef<HTMLElement>(null);

  // Move focus to the new step so screen readers and keyboards start there.
  useEffect(() => {
    if (enter) ref.current?.focus({ preventScroll: true });
  }, [enter]);

  return (
    <section ref={ref} className={styles.page} data-enter={enter ?? undefined} aria-label={label} tabIndex={-1}>
      <div className={styles.scroll}>
        {nav !== undefined ? <div className={styles.nav}>{nav}</div> : null}
        {children}
      </div>
      <div className={styles.fade} aria-hidden="true" />
    </section>
  );
}

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Working: shows a spinner, ignores taps, keeps the blue fill. */
  busy?: boolean;
  /** Label while busy (defaults to the normal label). */
  busyLabel?: string;
}

/** 54px pill in #007AFF with white 17/600 text; scales to .96 while pressed. */
export function PrimaryButton({ busy = false, busyLabel, children, onClick, type = 'button', ...rest }: PrimaryButtonProps) {
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  return (
    <button
      {...rest}
      type={type}
      className={styles.primary}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={handleClick}
    >
      {busy ? <Spinner /> : null}
      <span>{busy && busyLabel ? busyLabel : children}</span>
    </button>
  );
}

export function Spinner({ size }: { size?: 'large' }) {
  return <span className={styles.spinner} data-size={size} aria-hidden="true" />;
}
