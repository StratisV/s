import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { heroLook, rgba, STAGE_H, STAGE_W } from './b-light';
import { Birds, Clouds, Duck, Fireflies, Hedgehog, Smoke, Stars } from './b-life';
import { FrontArt, LandArt, Moon, SkyArt } from './b-scene';
import styles from './HeroB.module.css';

/** The current time, refreshed every minute and whenever the app comes back into view. */
function useMinuteClock(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    const tick = () => {
      setNow(new Date());
      schedule();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    tick();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [enabled]);
  return now;
}

/** True while `ref` is on screen (and the page is visible), so the scene only moves when seen. */
function useOnScreen(ref: React.RefObject<HTMLElement>): boolean {
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setSeen(entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return seen;
}

/**
 * The Home hero (art direction B, "Cinematic layers"): a full-bleed
 * illustration from the very top of the screen, under the status bar, of the
 * house in its garden under the sky as it is now in London. The sky, light
 * and colour of every layer follow the real sun (sun.ts); the green duck
 * swims on the pond and the brown hedgehog rocks by the fence. `children`
 * (the title, address and avatar) sit on top in white or black, exposed as
 * data-tone="light" or "dark". The art is decorative; a visually hidden
 * sentence describes it.
 */
export function Hero({ now, children }: { now?: Date; children?: ReactNode }) {
  const clock = useMinuteClock(now === undefined);
  const date = now ?? clock;
  const time = date.getTime();
  const look = useMemo(() => heroLook(new Date(time)), [time]);
  const root = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(root);
  const u = `hb${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  const dark = look.tone === 'dark';
  const shade = rgba(look.sky[0], Math.min(0.5, 0.18 + look.titleSkyLuminance * 0.9));
  const vars = {
    '--hero-sky-top': look.sky[0],
    '--hero-ink': dark ? '#000000' : '#FFFFFF',
    '--hero-ink-secondary': dark ? 'rgba(0,0,0,0.62)' : 'rgba(255,255,255,0.9)',
    '--hero-shadow': dark ? 'none' : `0 1px 2px ${shade}, 0 0 14px ${shade}`,
    '--hero-glass': dark ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.2)',
    '--hero-glass-border': dark ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.32)',
    '--stage-ratio': `${STAGE_W} / ${STAGE_H}`,
  } as CSSProperties;

  return (
    <div
      ref={root}
      className={styles.hero}
      style={vars}
      data-tone={look.tone}
      data-phase={look.phase}
      data-moving={onScreen || undefined}
    >
      <div className={styles.stage} aria-hidden="true">
        <div className={styles.depthSky}>
          <SkyArt look={look} u={u} />
          <Stars look={look} u={u} />
          <Moon look={look} u={u} />
          <Clouds look={look} u={u} />
          <Birds look={look} />
        </div>
        <LandArt look={look} u={u} />
        <Smoke look={look} u={u} />
        <Duck look={look} />
        <Hedgehog look={look} />
        <Fireflies look={look} />
        <FrontArt look={look} />
      </div>
      <div className={styles.edge} aria-hidden="true" />
      <div className={styles.overlay}>{children}</div>
      <p className={styles.description}>{look.description}</p>
    </div>
  );
}
