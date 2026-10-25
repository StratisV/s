import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Avatar } from './Avatar';
import { Hero, useMinuteClock } from './Hero';
import { heroLook } from './hero-art/look';
import { useHeroAtTop } from './StatusSky';
import styles from './Screen.module.css';

interface HeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** A small line at the top left, level with the avatar (today's date on Home and Housekeeping). */
  eyebrow?: ReactNode;
  /** The avatar at the top right; tapping it opens Profile. */
  avatarEmoji: string;
  onAvatar(): void;
  /**
   * Home's illustrated hero (the cottage under London's sky), with the title on it. Without
   * it (every other tab), a calm compact header: a slim band of the same sky with the date and
   * the avatar on it, then the large title on the page.
   */
  hero?: boolean;
  /** The scroll area the header scrolls in. */
  scrollRef: RefObject<HTMLElement>;
}

/**
 * Scrolled further than this, the sky (the hero's, or the band's) starts to pass under the
 * status bar, so the strip of sky (StatusSky) fades in behind its white text.
 */
const AT_TOP = 40;

/** True while the page is scrolled less than AT_TOP: the header's sky is still under the status bar. */
function useAtTop(scroller: RefObject<HTMLElement>): boolean {
  const [atTop, setAtTop] = useState(true);
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      setAtTop(sc.scrollTop < AT_TOP);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      sc.removeEventListener('scroll', onScroll);
    };
  }, [scroller]);
  return atTop;
}

/**
 * A slim band of the hero's sky at the top of a tab without the hero: the sky as it is in
 * London right now (the colours of the hero's, from its top), behind the status bar and the
 * row with the date and the avatar, ending in the page's rounded edge as the hero does. The
 * status bar over it stays white, as over the hero.
 */
function SkyBand({ children }: { children: ReactNode }) {
  const now = useMinuteClock(undefined);
  const minute = Math.floor(now.getTime() / 60_000);
  const sky = useMemo(() => heroLook(new Date(minute * 60_000)).sky, [minute]);
  return (
    <div
      className={styles.band}
      data-sky-band=""
      data-status-bar="light"
      style={{ '--sky-0': sky[0], '--sky-1': sky[1], '--sky-2': sky[2] } as CSSProperties}
    >
      <div className={styles.bandOverlay}>{children}</div>
      <div className={styles.bandEdge} aria-hidden="true" />
    </div>
  );
}

/**
 * The top of a tab screen. Home: the hero from the very top of the screen (under the status
 * bar) with the date, the avatar, the title and the address on it. Every other tab: the slim
 * band of sky with the date (if any) and the avatar, then the large title and its line under
 * it. Both scroll away with the page.
 */
export function ScreenHeader({ hero = false, title, subtitle, eyebrow, avatarEmoji, onAvatar, scrollRef }: HeaderProps) {
  useHeroAtTop(useAtTop(scrollRef));
  const nav = (
    <div className={styles.heroNav}>
      {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
      <button type="button" className={styles.avatarButton} onClick={onAvatar} aria-label="Profile">
        <Avatar emoji={avatarEmoji} size={38} emojiSize={22} background="transparent" className={styles.avatar} />
      </button>
    </div>
  );
  if (hero) {
    return (
      <Hero>
        {nav}
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
        </div>
      </Hero>
    );
  }
  return (
    <>
      <SkyBand>{nav}</SkyBand>
      <div className={styles.compactTitle} data-compact-title="">
        <h1 className={styles.plainTitle}>{title}</h1>
        {subtitle ? <span className={styles.plainSubtitle}>{subtitle}</span> : null}
      </div>
    </>
  );
}

interface ScreenProps extends Omit<HeaderProps, 'scrollRef'> {
  children: ReactNode;
  /** Room at the bottom for the round + over the tab bar (default true). */
  withAdd?: boolean;
  label: string;
}

/** A tab screen (Home, Goals, Housekeeping, Stats): one scroll area, the header at its top. */
export function Screen({ children, withAdd = true, label, ...header }: ScreenProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <section className={styles.screen} aria-label={label}>
      <div ref={scrollRef} className={styles.scroll} data-add={withAdd || undefined} data-screen-scroll="">
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
