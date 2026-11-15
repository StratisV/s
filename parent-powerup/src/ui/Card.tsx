import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tone?: 'plain' | 'sun' | 'mint' | 'sky' | 'coral' | 'lilac' | 'brand' | 'sunk';
  /** Pad the card (default true). */
  padded?: boolean;
}

/** A rounded card on the page, inset from its edges. */
export function Card({ children, tone = 'plain', padded = true, className, ...rest }: CardProps) {
  return (
    <div className={[styles.card, className].filter(Boolean).join(' ')} data-tone={tone} data-padded={padded || undefined} {...rest}>
      {children}
    </div>
  );
}
