import { MAX_AGE, STAGES } from '../data/stages';

/*
 * The timeline gives every stage the same width, so the first years (where a lot happens fast)
 * are not squeezed to nothing beside the teens. Within a stage, age runs evenly.
 */

/** Where an age sits along the timeline, from 0 (birth) to 1 (18). */
export function positionOf(age: number): number {
  const clamped = Math.min(Math.max(age, 0), MAX_AGE);
  if (clamped >= MAX_AGE) return 1;
  const index = STAGES.findIndex((stage) => clamped >= stage.from && clamped < stage.to);
  const stage = STAGES[index];
  return (index + (clamped - stage.from) / (stage.to - stage.from)) / STAGES.length;
}

/** The age at a point along the timeline (0 to 1): the inverse of positionOf. */
export function ageAtPosition(position: number): number {
  const p = Math.min(Math.max(position, 0), 1) * STAGES.length;
  if (p >= STAGES.length) return MAX_AGE;
  const index = Math.floor(p);
  const stage = STAGES[index];
  return stage.from + (p - index) * (stage.to - stage.from);
}
