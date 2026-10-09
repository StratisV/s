import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Avatar } from './Avatar';
import { Hero } from './Hero';
import { useHeroAtTop } from './StatusSky';
import styles from './Screen.module.css';

interface HeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** The avatar on the hero; tapping it opens Profile. */
  avatarEmoji: string;
  onAvatar(): void;
  /** The Home / Chat / Stats switch: just under the hero, then held at the top as the page scrolls. */
  tabs?: ReactNode;
  /** The scroll area the header scrolls in. */
  scrollRef: RefObject<HTMLElement>;
}

/** True once `dock` has scrolled up to where it sticks (its `top`). */
function useStuck(dock: RefObject<HTMLElement>, scroller: RefObject<HTMLElement>): boolean {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = dock.current;
    const sc = scroller.current;
    if (!el || !sc) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const top = parseFloat(getComputedStyle(el).top) || 0;
      const offset = el.getBoundingClientRect().top - sc.getBoundingClientRect().top;
      setStuck(sc.scrollTop > 0 && offset <= top + 0.5);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    sc.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      sc.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [dock, scroller]);
  return stuck;
}

/**
 * The top of a tab screen: the hero from the very top of the screen (under the
 * status bar) with the title, a secondary line and the avatar on it, then the
 * tab switch, which stays at the top once the hero has scrolled away.
 */
export function ScreenHeader({ title, subtitle, avatarEmoji, onAvatar, tabs, scrollRef }: HeaderProps) {
  const dockRef = useRef<HTMLDivElement>(null);
  const stuck = useStuck(dockRef, scrollRef);
  useHeroAtTop(!stuck);
  return (
    <>
      <Hero>
        <div className={styles.heroNav}>
          <button type="button" className={styles.avatarButton} onClick={onAvatar} aria-label="Profile">
            <Avatar emoji={avatarEmoji} size={38} emojiSize={22} background="transparent" className={styles.avatar} />
          </button>
        </div>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
        </div>
      </Hero>
      {tabs ? (
        <div ref={dockRef} className={styles.dock} data-stuck={stuck || undefined}>
          {tabs}
        </div>
      ) : null}
    </>
  );
}

interface ScreenProps extends Omit<HeaderProps, 'scrollRef'> {
  children: ReactNode;
  /** Room at the bottom for the floating add button (default true). */
  withAdd?: boolean;
  label: string;
}

/** A tab screen (Home, Stats): one scroll area, the header (hero and tab switch) at its top. */
export function Screen({ children, withAdd = true, label, ...header }: ScreenProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <section className={styles.screen} aria-label={label}>
      <div ref={scrollRef} className={styles.scroll} data-add={withAdd || undefined}>
        <ScreenHeader {...header} scrollRef={scrollRef} />
        {children}
      </div>
    </section>
  );
}

/** Large title block (pages without a hero): 34/41/700 with an optional 17px secondary line. */
export function LargeTitle({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className={styles.plainTitleBlock}>
      <h1 className={styles.plainTitle}>{title}</h1>
      {subtitle ? <span className={styles.plainSubtitle}>{subtitle}</span> : null}
    </div>
  );
}
