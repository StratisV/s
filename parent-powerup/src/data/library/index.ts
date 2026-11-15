import type { Challenge, Powerup } from '../../types';
import * as early from './early-years';
import * as preschool from './preschool';
import * as middle from './middle-years';
import * as teens from './teens';

/** Every challenge, youngest first by when it peaks. */
export const CHALLENGES: Challenge[] = [early, preschool, middle, teens]
  .flatMap((band) => band.challenges)
  .sort((a, b) => a.peak.from - b.peak.from || a.ages.from - b.ages.from);

export const POWERUPS: Powerup[] = [early, preschool, middle, teens].flatMap((band) => band.powerups);

const CHALLENGE_BY_ID = new Map(CHALLENGES.map((c) => [c.id, c]));
const POWERUP_BY_ID = new Map(POWERUPS.map((p) => [p.id, p]));

export const challengeById = (id: string): Challenge | undefined => CHALLENGE_BY_ID.get(id);
export const powerupById = (id: string): Powerup | undefined => POWERUP_BY_ID.get(id);

/** The Powerups for a challenge, in the order they were written. */
export function powerupsFor(challengeId: string): Powerup[] {
  return POWERUPS.filter((p) => p.challengeIds.includes(challengeId));
}
