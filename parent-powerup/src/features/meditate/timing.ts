import type { BreathPattern, MeditationStep } from '../../types';

/*
 * The meditation room's clock and breath, as pure functions of time. Progress comes from
 * timestamps (performance.now()), never from counting ticks, so it stays right across pause and
 * resume and when a background tab throttles timers.
 */

/** A pausable stopwatch: `base` ms already run, plus the time since `since` while running. */
export interface Clock {
  base: number;
  /** When it last started running (a performance.now() time), or null while paused. */
  since: number | null;
}

export const startClock = (now: number): Clock => ({ base: 0, since: now });

export function elapsedOf(clock: Clock, now: number): number {
  return clock.base + (clock.since === null ? 0 : Math.max(0, now - clock.since));
}

export function pauseClock(clock: Clock, now: number): Clock {
  return clock.since === null ? clock : { base: elapsedOf(clock, now), since: null };
}

export function resumeClock(clock: Clock, now: number): Clock {
  return clock.since !== null ? clock : { base: clock.base, since: now };
}

/** Jumps to `ms`, keeping whether it is running. */
export function seekClock(clock: Clock, ms: number, now: number): Clock {
  return { base: Math.max(0, ms), since: clock.since === null ? null : now };
}

export const totalMs = (steps: MeditationStep[]): number => steps.reduce((sum, step) => sum + step.seconds * 1000, 0);

/** When each step starts, in ms from the beginning. */
export function stepStarts(steps: MeditationStep[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const step of steps) {
    starts.push(at);
    at += step.seconds * 1000;
  }
  return starts;
}

export interface Location {
  /** The step running at this time (the last step once it is over). */
  index: number;
  /** How far into that step, in ms. */
  inStep: number;
  /** Whether the whole session is over. */
  done: boolean;
}

export function locate(steps: MeditationStep[], ms: number): Location {
  if (!steps.length) return { index: 0, inStep: 0, done: true };
  const total = totalMs(steps);
  if (ms >= total) {
    const last = steps.length - 1;
    return { index: last, inStep: steps[last].seconds * 1000, done: true };
  }
  const t = Math.max(0, ms);
  let start = 0;
  for (let index = 0; index < steps.length; index++) {
    const end = start + steps[index].seconds * 1000;
    if (t < end) return { index, inStep: t - start, done: false };
    start = end;
  }
  return { index: steps.length - 1, inStep: 0, done: true };
}

export type BreathPhase = 'in' | 'hold' | 'out' | 'rest';

export interface Breath {
  phase: BreathPhase;
  /** How full the circle is, 0 (empty) to 1 (full), eased. */
  value: number;
  /** Which second of the phase it is, from 1: "Breathe in, 1, 2, 3". */
  count: number;
  /** The phase's length in seconds. */
  length: number;
}

export const cycleSeconds = (p: BreathPattern): number => p.inhale + (p.hold ?? 0) + p.exhale + (p.rest ?? 0);

/** A soft ease in and out, so the circle never starts or stops with a jolt. */
const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(Math.max(x, 0), 1));

/** Where the breath is `ms` into a step that follows `pattern`. Every breath starts with the in-breath. */
export function breathAt(pattern: BreathPattern, ms: number): Breath {
  const cycle = cycleSeconds(pattern) * 1000;
  const t = ((Math.max(0, ms) % cycle) + cycle) % cycle;
  const phases: [BreathPhase, number][] = [
    ['in', pattern.inhale],
    ['hold', pattern.hold ?? 0],
    ['out', pattern.exhale],
    ['rest', pattern.rest ?? 0],
  ];
  let start = 0;
  for (const [phase, seconds] of phases) {
    const length = seconds * 1000;
    if (length > 0 && t < start + length) {
      const into = t - start;
      const x = into / length;
      const value = phase === 'in' ? ease(x) : phase === 'hold' ? 1 : phase === 'out' ? 1 - ease(x) : 0;
      return { phase, value, count: Math.floor(into / 1000) + 1, length: seconds };
    }
    start += length;
  }
  return { phase: 'rest', value: 0, count: 1, length: 0 };
}

/** "2:05": minutes and seconds, rounded up so it never shows 0:00 before the end. */
export function clockText(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** "2 minutes 5 seconds", for screen readers. */
export function clockWords(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const part = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (!m) return part(s, 'second');
  return s ? `${part(m, 'minute')} ${part(s, 'second')}` : part(m, 'minute');
}
