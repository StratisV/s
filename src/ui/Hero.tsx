import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Duck, Fireflies, Hedgehog, ShardBeacon, Smoke } from './hero-art/Characters';
import type { Ref } from './hero-art/frame';
import { FarLand, MidLand, NearLand } from './hero-art/Land';
import { heroLook } from './hero-art/look';
import { Birds, Clouds, SkyBase, SkyLights, Stars, Wash } from './hero-art/Sky';
import s from './Hero.module.css';

/** The current time, refreshed every minute and whenever the app comes back into view. */
function useMinuteClock(fixed: Date | undefined): Date {
  const [now, setNow] = useState(() => new Date());
  const live = fixed === undefined;
  useEffect(() => {
    if (!live) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      setNow(new Date());
      clearTimeout(timer);
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    const onShow = () => {
      if (document.visibilityState === 'visible') tick();
    };
    tick();
    document.addEventListener('visibilitychange', onShow);
    // Also after a back-forward cache restore.
    window.addEventListener('pageshow', onShow);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('pageshow', onShow);
    };
  }, [live]);
  return fixed ?? now;
}

const REDUCE = '(prefers-reduced-motion: reduce)';

/** True when the person has asked for less motion. */
function useReducedMotion(): boolean {
  const [still, setStill] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(REDUCE).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(REDUCE);
    const update = () => setStill(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return still;
}

/**
 * The Home hero: a storybook cottage with its green duck and brown hedgehog
 * under London's sky as it is right now (or at `now`). It runs full bleed
 * from the very top of the screen (var(--top-inset) + 300px) and ends in a
 * 24px rounded edge of the page colour. `children` (the avatar, title and
 * address) sit on the sky, below the status bar inset.
 *
 * The sky follows the real sun: the text tone is chosen for it and exposed as
 * data-tone ("light": white text, or "dark"), with --hero-ink,
 * --hero-ink-secondary, --hero-text-shadow, --hero-glass and
 * --hero-glass-edge for the children. The status bar over the hero always
 * takes white text (data-status-bar="light"); once the hero has scrolled
 * away, StatusSky (ui/StatusSky.tsx) puts a band of this sky's colour behind
 * it (heroSkyTop below). The picture is decorative; a
 * visually hidden sentence describes it. Motion pauses off screen and stops
 * for Reduce Motion.
 */
export function Hero({ now, children }: { now?: Date; children?: ReactNode }) {
  const at = useMinuteClock(now);
  const minute = Math.floor(at.getTime() / 60_000);
  const look = useMemo(() => heroLook(new Date(minute * 60_000)), [minute]);
  // Where the clouds are along their lanes is set from the time once, then they drift on their own.
  const [epoch] = useState(() => at.getTime());
  const still = useReducedMotion();
  const uid = `hero${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const id: Ref = (name) => `${uid}-${name}`;

  const root = useRef<HTMLDivElement>(null);

  // Hold every animation while the hero is off screen.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => el.toggleAttribute('data-paused', !entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={root}
      className={s.hero}
      data-tone={look.tone}
      data-phase={look.phase}
      data-status-bar="light"
      data-still={still || undefined}
      style={{ '--hero-sky-top': look.sky[0] } as CSSProperties}
    >
      <div className={s.stage} aria-hidden="true">
        <SkyBase look={look} id={id} />
        <Wash look={look} id={id} />
        <div className={`${s.layer} ${s.depthSky}`}>
          <SkyLights look={look} id={id} />
          {look.stars.bright > 0.01 || look.stars.faint > 0.01 ? <Stars look={look} id={id} /> : null}
          <Clouds look={look} id={id} epoch={epoch} />
          {look.birds ? <Birds /> : null}
        </div>
        <div className={`${s.layer} ${s.depthFar}`}>
          <FarLand look={look} id={id} />
          {look.city > 0.3 ? <ShardBeacon look={look} /> : null}
        </div>
        <div className={`${s.layer} ${s.depthMid}`}>
          <MidLand look={look} id={id} />
        </div>
        <NearLand look={look} id={id} />
        {look.smoke ? <Smoke look={look} /> : null}
        <Duck look={look} id={id} />
        <Hedgehog look={look} />
        {look.fireflies > 0.02 ? <Fireflies strength={look.fireflies} /> : null}
      </div>
      <div className={s.edge} aria-hidden="true" />
      <div className={s.overlay}>{children}</div>
      <p className="visually-hidden">{look.description}</p>
    </div>
  );
}

/** The colour at the top of the hero's sky at `date`, for the strip behind the status bar (StatusSky). */
export function heroSkyTop(date: Date): string {
  return heroLook(date).sky[0];
}
