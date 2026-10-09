import { useEffect, useState } from 'react';

/**
 * Mount/animate/unmount for a layer that slides in and out. `mounted` turns
 * true as soon as `open` does; `shown` follows two frames later (so the
 * off-screen position is painted first and the transition runs) and drops
 * at once on close; `mounted` drops after `exitMs`, when the exit
 * transition is over.
 */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; shown: boolean } {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open) {
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(t);
  }, [open, exitMs]);

  return { mounted: mounted || open, shown: open && shown };
}

/** The sheet transition length from tokens.css, in ms. */
export const SHEET_MS = 480;
