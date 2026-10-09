import { useState, type ReactNode, type Ref, type UIEvent } from 'react';
import styles from './NavPage.module.css';

interface NavPageProps {
  /** Left and right of the 52px nav row (back button, Done). */
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Shown small in the bar once the large title has scrolled under it. */
  inlineTitle?: string;
  scrollRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}

/** Distance after which the 41px large title has gone under the bar. */
const TITLE_GONE = 44;

/**
 * A page in the Profile cover: the nav row stays put above the scrolling
 * content and turns into a frosted bar once something scrolls under it.
 * At the top it is transparent, exactly like the 3a frames.
 */
export function NavPage({ leading, trailing, inlineTitle, scrollRef, children }: NavPageProps) {
  const [scroll, setScroll] = useState<'top' | 'scrolled' | 'pastTitle'>('top');
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const y = e.currentTarget.scrollTop;
    const next = y <= 0 ? 'top' : inlineTitle && y >= TITLE_GONE ? 'pastTitle' : 'scrolled';
    if (next !== scroll) setScroll(next);
  };

  return (
    <div className={styles.page}>
      <div className={styles.bar} data-scrolled={scroll !== 'top' || undefined}>
        <div className={styles.leading}>{leading}</div>
        <div className={styles.title} data-visible={scroll === 'pastTitle' || undefined} aria-hidden="true">
          {inlineTitle}
        </div>
        <div className={styles.trailing}>{trailing}</div>
      </div>
      <div ref={scrollRef} className={styles.scroll} onScroll={onScroll}>
        {children}
      </div>
    </div>
  );
}
