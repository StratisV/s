import type { MeditationStep } from '../../types';
import {
  breathAt,
  clockText,
  clockWords,
  cycleSeconds,
  elapsedOf,
  locate,
  pauseClock,
  resumeClock,
  seekClock,
  startClock,
  stepStarts,
  totalMs,
} from './timing';

const steps: MeditationStep[] = [
  { text: 'Settle in', seconds: 10 },
  { text: 'Breathe', seconds: 20, breath: { inhale: 4, exhale: 6 } },
  { text: 'Rest', seconds: 5 },
];

describe('clock', () => {
  it('runs from when it starts', () => {
    const clock = startClock(1000);
    expect(elapsedOf(clock, 1000)).toBe(0);
    expect(elapsedOf(clock, 4500)).toBe(3500);
  });

  it('stands still while paused and carries on after', () => {
    let clock = startClock(0);
    clock = pauseClock(clock, 3000);
    expect(elapsedOf(clock, 60_000)).toBe(3000);
    clock = resumeClock(clock, 60_000);
    expect(elapsedOf(clock, 61_000)).toBe(4000);
  });

  it('ignores a pause while paused and a resume while running', () => {
    let clock = startClock(0);
    clock = resumeClock(clock, 5000);
    expect(elapsedOf(clock, 6000)).toBe(6000);
    clock = pauseClock(clock, 6000);
    clock = pauseClock(clock, 9000);
    expect(elapsedOf(clock, 9000)).toBe(6000);
  });

  it('jumps, keeping whether it runs', () => {
    const running = seekClock(startClock(0), 10_000, 2000);
    expect(elapsedOf(running, 3000)).toBe(11_000);
    const paused = seekClock(pauseClock(startClock(0), 2000), 30_000, 5000);
    expect(elapsedOf(paused, 99_000)).toBe(30_000);
    expect(elapsedOf(seekClock(startClock(0), -5, 0), 0)).toBe(0);
  });

  it('is right after a long gap, as when a background tab wakes up', () => {
    const clock = startClock(0);
    expect(locate(steps, elapsedOf(clock, 31_000))).toEqual({ index: 2, inStep: 1000, done: false });
  });
});

describe('steps', () => {
  it('knows the total and where each step starts', () => {
    expect(totalMs(steps)).toBe(35_000);
    expect(stepStarts(steps)).toEqual([0, 10_000, 30_000]);
  });

  it('finds the step at a time', () => {
    expect(locate(steps, 0)).toEqual({ index: 0, inStep: 0, done: false });
    expect(locate(steps, 9_999)).toEqual({ index: 0, inStep: 9_999, done: false });
    expect(locate(steps, 10_000)).toEqual({ index: 1, inStep: 0, done: false });
    expect(locate(steps, 34_999)).toEqual({ index: 2, inStep: 4_999, done: false });
    expect(locate(steps, 35_000)).toEqual({ index: 2, inStep: 5_000, done: true });
    expect(locate(steps, 99_000).done).toBe(true);
    expect(locate(steps, -50)).toEqual({ index: 0, inStep: 0, done: false });
    expect(locate([], 0).done).toBe(true);
  });
});

describe('breath', () => {
  const calm = { inhale: 4, exhale: 6 };
  const box = { inhale: 4, hold: 4, exhale: 4, rest: 4 };

  it('knows a cycle’s length', () => {
    expect(cycleSeconds(calm)).toBe(10);
    expect(cycleSeconds(box)).toBe(16);
  });

  it('breathes in, then out, and starts again', () => {
    expect(breathAt(calm, 0)).toMatchObject({ phase: 'in', value: 0, count: 1, length: 4 });
    expect(breathAt(calm, 2000).value).toBeCloseTo(0.5);
    expect(breathAt(calm, 3999).phase).toBe('in');
    expect(breathAt(calm, 4000)).toMatchObject({ phase: 'out', count: 1, length: 6 });
    expect(breathAt(calm, 4000).value).toBeCloseTo(1);
    expect(breathAt(calm, 9000).count).toBe(6);
    expect(breathAt(calm, 9999).value).toBeCloseTo(0, 2);
    expect(breathAt(calm, 10_000)).toMatchObject({ phase: 'in', count: 1 });
  });

  it('holds full and rests empty', () => {
    expect(breathAt(box, 5000)).toMatchObject({ phase: 'hold', value: 1, count: 2 });
    expect(breathAt(box, 13_000)).toMatchObject({ phase: 'rest', value: 0, count: 2 });
  });

  it('grows steadily on the in-breath and shrinks steadily on the out-breath', () => {
    let last = -1;
    for (let t = 0; t < 4000; t += 100) {
      const { value } = breathAt(calm, t);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
    last = 1;
    for (let t = 4000; t < 10_000; t += 100) {
      const { value } = breathAt(calm, t);
      expect(value).toBeLessThanOrEqual(last);
      last = value;
    }
  });
});

describe('time left', () => {
  it('shows minutes and seconds, rounding up', () => {
    expect(clockText(125_000)).toBe('2:05');
    expect(clockText(124_100)).toBe('2:05');
    expect(clockText(500)).toBe('0:01');
    expect(clockText(0)).toBe('0:00');
    expect(clockText(-10)).toBe('0:00');
  });

  it('says it in words', () => {
    expect(clockWords(125_000)).toBe('2 minutes 5 seconds');
    expect(clockWords(60_000)).toBe('1 minute');
    expect(clockWords(1000)).toBe('1 second');
    expect(clockWords(61_000)).toBe('1 minute 1 second');
  });
});
