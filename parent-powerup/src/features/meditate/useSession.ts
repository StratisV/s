import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MeditationStep } from '../../types';
import { type Clock, elapsedOf, locate, pauseClock, resumeClock, seekClock, startClock, stepStarts, totalMs } from './timing';

/*
 * A meditation as it plays: which step, how far in, paused or not. Time comes from
 * performance.now() timestamps (src/features/meditate/timing.ts), so it is right after a pause,
 * after skipping, and after a background tab has had its timers slowed. Animation frames drive
 * the visuals; a slower interval keeps the steps moving when frames stop in the background.
 */

export interface SessionHandlers {
  /** A step has begun, by time or by a skip. `running` is false when it was skipped to while paused. */
  onStep?: (index: number, running: boolean) => void;
  onPause?: () => void;
  onResume?: (index: number) => void;
  /** The whole session is over (it ran to the end, or Finish was tapped). */
  onFinish?: () => void;
  /** Every frame: for the breathing circle and the progress ring, written straight to the page. */
  onFrame?: (elapsed: number) => void;
}

export interface SessionView {
  index: number;
  /** Ms from the start; updated at least once a second. */
  elapsed: number;
  total: number;
  running: boolean;
  done: boolean;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Finish is offered once this much has been done. */
export const FINISH_AT = 0.6;

export function useSession(steps: MeditationStep[], handlers: SessionHandlers) {
  const total = useMemo(() => totalMs(steps), [steps]);
  const starts = useMemo(() => stepStarts(steps), [steps]);
  const on = useRef(handlers);
  on.current = handlers;

  const clock = useRef<Clock>(startClock(now()));
  const last = useRef({ index: -1, second: -1, done: false });
  const [view, setView] = useState<SessionView>({ index: 0, elapsed: 0, total, running: true, done: false });

  const end = useCallback(() => {
    if (last.current.done) return;
    last.current.done = true;
    clock.current = pauseClock(clock.current, now());
    const index = Math.max(0, steps.length - 1);
    setView({ index, elapsed: total, total, running: false, done: true });
    on.current.onFrame?.(total);
    on.current.onFinish?.();
  }, [steps.length, total]);

  /** Brings the view up to the clock. `force` re-renders even within the same second. */
  const sync = useCallback(
    (force = false) => {
      if (last.current.done) return;
      const t = elapsedOf(clock.current, now());
      if (t >= total) {
        end();
        return;
      }
      const at = locate(steps, t);
      on.current.onFrame?.(t);
      const second = Math.floor(t / 1000);
      const stepChanged = at.index !== last.current.index;
      if (force || stepChanged || second !== last.current.second) {
        last.current.index = at.index;
        last.current.second = second;
        setView({ index: at.index, elapsed: t, total, running: clock.current.since !== null, done: false });
      }
      if (stepChanged) on.current.onStep?.(at.index, clock.current.since !== null);
    },
    [end, steps, total],
  );

  useEffect(() => {
    // (Re)start from the top: on opening, and again if React remounts it in development.
    clock.current = startClock(now());
    last.current = { index: -1, second: -1, done: false };
    sync(true);

    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : undefined;
    let frame = 0;
    const loop = () => {
      sync();
      frame = raf ? raf(loop) : 0;
    };
    if (raf) frame = raf(loop);
    const interval = setInterval(() => sync(), 500);
    const onVisible = () => sync(true);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sync]);

  const pause = useCallback(() => {
    if (last.current.done || clock.current.since === null) return;
    clock.current = pauseClock(clock.current, now());
    on.current.onPause?.();
    sync(true);
  }, [sync]);

  const resume = useCallback(() => {
    if (last.current.done || clock.current.since !== null) return;
    clock.current = resumeClock(clock.current, now());
    on.current.onResume?.(Math.max(0, last.current.index));
    sync(true);
  }, [sync]);

  const toggle = useCallback(() => (clock.current.since === null ? resume() : pause()), [pause, resume]);

  const goTo = useCallback(
    (index: number) => {
      if (last.current.done || !steps.length) return;
      const target = Math.min(Math.max(index, 0), steps.length - 1);
      clock.current = seekClock(clock.current, starts[target], now());
      // Restarting the same step should read it again too.
      if (target === last.current.index) last.current.index = -1;
      sync(true);
    },
    [starts, steps.length, sync],
  );

  const next = useCallback(() => goTo(Math.max(0, last.current.index) + 1), [goTo]);
  const previous = useCallback(() => goTo(Math.max(0, last.current.index) - 1), [goTo]);

  const canFinish = !view.done && view.elapsed >= FINISH_AT * total;
  const finish = useCallback(() => {
    if (elapsedOf(clock.current, now()) >= FINISH_AT * total) end();
  }, [end, total]);

  return { ...view, canFinish, pause, resume, toggle, next, previous, finish };
}
