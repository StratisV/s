import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { PHASE_PHRASE, skyLook } from '../lib/logic/sky';
import { skyAt } from '../lib/logic/sun';
import { DUCK_URL, HEDGEHOG_URL } from './animals';
import styles from './HomeScene.module.css';

/**
 * A scatter of stars: left %, top % (of the scene), bright (out first at dusk). Bright ones
 * are 3px and faint ones 2px: whole pixels, so they stay round dots on any screen.
 */
const STARS: readonly (readonly [number, number, boolean])[] = [
  [7, 14, true],
  [15, 36, false],
  [22, 9, false],
  [29, 27, true],
  [36, 46, false],
  [41, 11, true],
  [47, 30, false],
  [56, 8, false],
  [61, 22, true],
  [67, 43, false],
  [73, 13, false],
  [79, 34, true],
  [85, 52, false],
  [92, 44, false],
  [11, 54, false],
  [52, 50, false],
];

/**
 * A change of the sun's height bigger than this is a jump in time (the app was in the
 * background, or the device clock moved), not a minute passing: the sun goes straight to
 * its new place instead of gliding there. A minute moves it by under 0.05.
 */
const JUMP = 0.1;

/** The current time, refreshed every minute and whenever the app comes back into view. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Just after the next minute starts.
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
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, []);
  return now;
}

/**
 * The home scene card: a duck and a hedgehog living in a house (README "Home
 * scene card"), under the sky as it is now at the house in London. The sun
 * rises on the left (east) and climbs to the top-left corner; by full day it is
 * in the 3a spot at the top right, and it sets on the right (west) behind the
 * ground. It never crosses the house: the two corners swap with a cross-fade.
 * At night the moon and stars come out and the windows glow. Used on Home and
 * on the Welcome and Join screens. With Reduce Motion the animals and stars
 * stay still and the sun moves without gliding.
 */
export function HomeScene({ height = 150 }: { height?: number }) {
  const now = useMinuteClock();
  const look = useMemo(() => skyLook(skyAt(now)), [now]);

  // The sun glides with the minutes, but after a jump in time it is just in its new place:
  // `data-jump` turns its transitions off until the browser has drawn it there.
  const shown = useRef(look.sun);
  const moved =
    Math.abs(look.sun.lift - shown.current.lift) > JUMP ||
    // Changing corners anywhere but at the top (where they cross-fade) is a jump too.
    (look.sun.side !== shown.current.side && Math.abs(look.sun.lift - 1) > 0.001);
  const [jumping, setJumping] = useState(false);
  useEffect(() => {
    shown.current = look.sun;
    if (moved) setJumping(true);
    // `moved` comes from the same render as `look.sun`, so it only needs `look.sun`.
  }, [look.sun]);
  useEffect(() => {
    if (!jumping) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setJumping(false));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [jumping]);

  const vars = {
    height,
    '--sky-top': look.sky.top,
    '--sky-middle': look.sky.middle,
    '--sky-horizon': look.sky.horizon,
    '--ground-top': look.ground.top,
    '--ground-bottom': look.ground.bottom,
    '--sun': look.sun.colour,
    '--sun-halo': look.sun.halo,
    '--sun-halo-size': `${look.sun.haloSize}px`,
    '--sun-west': look.sun.side === 'west' ? 1 : 0,
    '--sun-lift': look.sun.lift,
    '--sun-opacity': look.sun.opacity,
    '--glow': look.glow.colour,
    '--glow-strength': look.glow.strength,
    '--moon': look.moon,
    '--stars-bright': look.stars.bright,
    '--stars-faint': look.stars.faint,
    '--night': look.night,
    '--lamps': look.lamps,
  } as CSSProperties;

  const starsOut = look.stars.bright > 0 || look.stars.faint > 0;

  return (
    <div
      className={styles.scene}
      style={vars}
      role="img"
      aria-label={`A duck and a hedgehog outside their house ${PHASE_PHRASE[look.phase]}`}
      data-phase={look.phase}
      data-sun={look.sun.side}
      data-jump={moved || jumping || undefined}
    >
      <span className={styles.stars} data-out={starsOut || undefined}>
        {STARS.map(([left, top, bright], i) => (
          <span
            key={i}
            className={styles.star}
            data-star={bright ? 'bright' : 'faint'}
            style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${-i * 0.37}s` }}
          />
        ))}
      </span>
      <span className={styles.moon} />
      <span className={styles.glow} />
      <span className={styles.sun} data-side="east" />
      <span className={styles.sun} data-side="west" />
      <span className={styles.ground} />
      <span className={styles.lamplight} />
      <span className={styles.house}>🏡</span>
      <span className={styles.windows} />
      <img className={styles.duck} src={DUCK_URL} alt="" draggable={false} data-animal="duck" />
      <img className={styles.hedgehog} src={HEDGEHOG_URL} alt="" draggable={false} data-animal="hedgehog" />
    </div>
  );
}
