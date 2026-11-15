import type { ReactNode } from 'react';
import styles from './Screen.module.css';

interface ScreenProps {
  /** Small words over the title ("Sunday 15 November"). */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** A line under the title. */
  subtitle?: ReactNode;
  /** Buttons at the right of the title. */
  actions?: ReactNode;
  children: ReactNode;
  /** A tone for the page's top wash. */
  tone?: 'brand' | 'sun' | 'mint' | 'sky';
}

/** A tab's page: a big title at the top, then the content, clear of the tab bar. */
export function Screen({ eyebrow, title, subtitle, actions, children, tone }: ScreenProps) {
  return (
    <main className={styles.screen} data-tone={tone}>
      <header className={styles.header}>
        <div className={styles.headings}>
          {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
      <div className={styles.body}>{children}</div>
    </main>
  );
}

interface SectionProps {
  title?: ReactNode;
  /** A line under the section title. */
  hint?: ReactNode;
  /** A control at the right of the section title ("See all"). */
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}

/** A titled section within a page. */
export function Section({ title, hint, action, children, id }: SectionProps) {
  return (
    <section className={styles.section} aria-labelledby={title && id ? `${id}-title` : undefined}>
      {(title || action) && (
        <div className={styles.sectionHead}>
          <div>
            {title && (
              <h2 className={styles.sectionTitle} id={id ? `${id}-title` : undefined}>
                {title}
              </h2>
            )}
            {hint && <p className={styles.sectionHint}>{hint}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
