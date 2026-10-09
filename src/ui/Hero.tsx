import { heroLook } from './hero/b-light';

export { Hero } from './hero/HeroB';

/** The colour at the top of the hero's sky at `date`, for the strip behind the status bar. */
export function heroSkyTop(date: Date): string {
  return heroLook(date).sky[0];
}
