import type { ReactNode } from 'react';
import { Avatar } from './Avatar';
import styles from './Screen.module.css';

interface ScreenProps {
  /** Nav row avatar; tapping it opens Profile. */
  avatarEmoji: string;
  onAvatar(): void;
  children: ReactNode;
  /** Extra bottom padding for the floating tab bar (default true). */
  withTabBar?: boolean;
  label: string;
}

/**
 * A tab screen (Home, Stats): scroll area with the 52px nav row (avatar on
 * the right), the scroll-edge fade under the status bar, and room at the
 * bottom for the floating tab bar.
 */
export function Screen({ avatarEmoji, onAvatar, children, withTabBar = true, label }: ScreenProps) {
  return (
    <section className={styles.screen} aria-label={label}>
      <div className={styles.scroll} data-tabbar={withTabBar || undefined}>
        <div className={styles.nav}>
          <button type="button" className={styles.avatarButton} onClick={onAvatar} aria-label="Profile">
            <Avatar emoji={avatarEmoji} size={38} emojiSize={22} />
          </button>
        </div>
        {children}
      </div>
      <div className={styles.fade} aria-hidden="true" />
    </section>
  );
}

/** Large title block: 34/41/700 with an optional 17px secondary line. */
export function LargeTitle({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className={styles.titleBlock}>
      <h1 className={styles.title}>{title}</h1>
      {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
    </div>
  );
}
