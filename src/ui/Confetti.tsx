import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';

type Fire = (origin: Element | { x: number; y: number }) => void;

const ConfettiContext = createContext<Fire>(() => {});

const PARTICLES = 36;
const REDUCED_PARTICLES = 6;
const GRAVITY = 1500; // px/s²
const LIFETIME_MS = 3000;
const EMOJI = ['🦔', '🦆'];

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Hedgehog and duck confetti (README "Confetti"): 36 particles from the
 * centre of the tapped control, ±280 px/s horizontal, −(700–1200) px/s
 * vertical, 1500 px/s² gravity, ±420° spin, 1.7–2.6 s, 0–160 ms delay,
 * scale 0.2→1 in the first frame, fade after 75%. Full-screen overlay
 * that never takes taps; removed after ~3 s. With Reduce Motion: a small,
 * gentle burst.
 */
export function ConfettiProvider({ children }: { children: ReactNode }) {
  const layerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const layer = document.createElement('div');
    layer.setAttribute('aria-hidden', 'true');
    layer.dataset.confetti = '';
    Object.assign(layer.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '1000',
      pointerEvents: 'none',
      overflow: 'hidden',
    });
    document.body.appendChild(layer);
    layerRef.current = layer;
    return () => {
      layer.remove();
      layerRef.current = null;
    };
  }, []);

  const fire = useCallback<Fire>((origin) => {
    const layer = layerRef.current;
    if (!layer) return;
    let ox: number;
    let oy: number;
    if (origin instanceof Element) {
      const r = origin.getBoundingClientRect();
      ox = r.left + r.width / 2;
      oy = r.top + r.height / 2;
    } else {
      ox = origin.x;
      oy = origin.y;
    }
    const reduced = prefersReducedMotion();
    const count = reduced ? REDUCED_PARTICLES : PARTICLES;
    const burst = document.createElement('div');
    for (let i = 0; i < count; i++) {
      const vx = (Math.random() * 2 - 1) * (reduced ? 90 : 280);
      const vy = -(reduced ? 300 + Math.random() * 150 : 700 + Math.random() * 500);
      const size = 24 + Math.random() * 20;
      const spin = reduced ? 0 : (Math.random() * 2 - 1) * 420;
      const dur = 1700 + Math.random() * 900;
      const delay = Math.random() * 160;
      const el = document.createElement('span');
      el.textContent = EMOJI[Math.random() < 0.5 ? 0 : 1];
      Object.assign(el.style, {
        position: 'absolute',
        left: `${ox}px`,
        top: `${oy}px`,
        fontSize: `${size}px`,
        lineHeight: '1',
        opacity: '0',
        transform: 'translate(-50%,-50%) scale(0.2)',
        willChange: 'transform, opacity',
      });
      const T = dur / 1000;
      const frames: Keyframe[] = [];
      for (let k = 0; k <= 12; k++) {
        const t = (T * k) / 12;
        const x = vx * t;
        const y = vy * t + 0.5 * GRAVITY * t * t;
        frames.push({
          transform: `translate(-50%,-50%) translate(${x}px,${y}px) rotate(${(spin * k) / 12}deg) scale(${k === 0 ? 0.2 : 1})`,
          opacity: k <= 9 ? 1 : (12 - k) / 3,
        });
      }
      burst.appendChild(el);
      el.animate?.(frames, { duration: dur, delay, easing: 'linear', fill: 'both' });
    }
    layer.appendChild(burst);
    setTimeout(() => burst.remove(), LIFETIME_MS);
  }, []);

  return <ConfettiContext.Provider value={fire}>{children}</ConfettiContext.Provider>;
}

/** `const fire = useConfetti(); fire(event.currentTarget)` */
export function useConfetti(): Fire {
  return useContext(ConfettiContext);
}
