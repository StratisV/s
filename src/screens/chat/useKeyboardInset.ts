import { useEffect, useState } from 'react';
import { keyboardInset } from '../../lib/logic/chat';

/**
 * While `active` (the composer has focus), how many px of the bottom of the
 * page the on-screen keyboard covers, from window.visualViewport. 0 when
 * inactive or where there is no visualViewport (or no keyboard).
 */
export function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!active || !vv) {
      setInset(0);
      return;
    }
    const measure = () => setInset(keyboardInset(window.innerHeight, vv));
    measure();
    vv.addEventListener('resize', measure);
    vv.addEventListener('scroll', measure);
    return () => {
      vv.removeEventListener('resize', measure);
      vv.removeEventListener('scroll', measure);
    };
  }, [active]);
  return inset;
}
