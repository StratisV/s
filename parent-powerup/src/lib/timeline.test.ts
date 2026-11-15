import { STAGES } from '../data/stages';
import { ageAtPosition, positionOf } from './timeline';

describe('timeline scale', () => {
  it('gives each stage the same width', () => {
    STAGES.forEach((stage, i) => {
      expect(positionOf(stage.from)).toBeCloseTo(i / STAGES.length);
    });
    expect(positionOf(18)).toBe(1);
  });

  it('runs evenly within a stage', () => {
    // Toddler is 1 to 3, the second sixth: 2 is half way along it.
    expect(positionOf(2)).toBeCloseTo(1.5 / 6);
  });

  it('clamps outside 0 to 18', () => {
    expect(positionOf(-1)).toBe(0);
    expect(positionOf(30)).toBe(1);
  });

  it('turns a position back into the same age', () => {
    for (const age of [0, 0.4, 1, 2.25, 4.9, 7, 10.5, 15, 17.9]) {
      expect(ageAtPosition(positionOf(age))).toBeCloseTo(age);
    }
    expect(ageAtPosition(1)).toBe(18);
  });
});
