import { useEffect, useState } from 'react';
import { heroSkyTop } from './Hero';
import styles from './StatusSky.module.css';

/** Heroes under the status bar right now (a screen's, or Welcome's). */
let heroes = 0;

function sync() {
  document.documentElement.toggleAttribute('data-hero-top', heroes > 0);
}

/** While `atTop` is true a hero is under the status bar, so the strip steps aside for it. */
export function useHeroAtTop(atTop: boolean): void {
  useEffect(() => {
    if (!atTop) return;
    heroes += 1;
    sync();
    return () => {
      heroes -= 1;
      sync();
    };
  }, [atTop]);
}

/**
 * A strip of sky behind the iPhone status bar. The app draws under the status bar
 * (black-translucent in index.html, so the hero reaches the very top) and its text is
 * always white. Wherever no hero is under it (a screen scrolled down, Profile, the
 * onboarding steps), this strip in the colour of the sky keeps the time readable.
 */
export function StatusSky() {
  const [colour, setColour] = useState(() => heroSkyTop(new Date()));
  useEffect(() => {
    const tick = () => setColour(heroSkyTop(new Date()));
    const timer = setInterval(tick, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  // Browsers that tint their own bar around the page (theme-color) take the sky's colour too.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const before = meta.content;
    meta.content = colour;
    return () => {
      meta.content = before;
    };
  }, [colour]);
  return <div className={styles.strip} style={{ background: colour }} aria-hidden="true" data-status-sky="" />;
}
