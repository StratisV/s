import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { backdrop, pickArt } from './pick';
import s from './AreaArt.module.css';

export interface AreaArtProps {
  /** The area's name: picks the scene ("Kitchen", "Bathroom Small", "Front garden"...). */
  name: string;
  /** Something that stays the same for the area (its id): picks the colours and small details. */
  seed: string;
  className?: string;
}

/** True once the drawings' chunk has arrived: later pictures appear at once, without the fade. */
let loaded = false;
const Scene = lazy(() =>
  import('./Scene').then((mod) => {
    loaded = true;
    return mod;
  }),
);

const DARK = '(prefers-color-scheme: dark)';
const darkQuery = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DARK) : null);
function subscribe(onChange: () => void): () => void {
  const query = darkQuery();
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
}
/** Dark mode shows each picture's evening: lamplight and a night sky. */
function useEvening(): boolean {
  return useSyncExternalStore(subscribe, () => darkQuery()?.matches ?? false, () => false);
}

/**
 * An area's illustration: a small hand-made scene for the kind of room
 * its name says (a pot steaming in the kitchen, a bath with a green rubber duck, a robin on
 * the garden fence), in colours its seed picks, so no two areas look the same. It fills its
 * box, cropped to cover, in any shape. Dark mode shows the scene in the evening. Decorative:
 * hidden from assistive technology (the area's name is said by whatever holds it). The
 * drawings load as one chunk the first time one is shown, over a soft gradient of the same
 * colours. Its little motions (steam, bubbles, twinkling lights) pause off screen and stop
 * for Reduce Motion.
 */
export function AreaArt({ name, seed, className }: AreaArtProps): JSX.Element {
  const pick = useMemo(() => pickArt(name, seed), [name, seed]);
  const evening = useEvening();
  const root = useRef<HTMLSpanElement>(null);
  // Fade in only if the drawings weren't here yet when this picture first appeared.
  const [fade] = useState(() => !loaded);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => el.toggleAttribute('data-paused', !entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <span
      ref={root}
      className={className ? `${s.art} ${className}` : s.art}
      aria-hidden="true"
      data-area-art={pick.key}
      style={{ background: backdrop(pick, evening) }}
    >
      <Suspense fallback={null}>
        <Scene pick={pick} evening={evening} fade={fade} />
      </Suspense>
    </span>
  );
}
