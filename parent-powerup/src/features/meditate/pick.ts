import { INTERESTS } from '../../data/family';
import { ISSUES } from '../../data/issues';
import { inRange, kidAge } from '../../lib/age';
import { addDays, dayNumber, fromKey } from '../../lib/dates';
import type { AgeRange, Challenge, IssueId, Kid, Meditation, MeditationMode, Powerup, SessionLog } from '../../types';

/*
 * What the Meditate tab shows, as pure functions of the family, the content and the date.
 *
 * Today's meditation is the same all day: it depends on the date, who is joining and what
 * happened on earlier days, never on the time or on today's sessions. Each day steps along a
 * rotation of the meditations that fit, so consecutive days differ, and the best fits (a
 * space-mad kid's rocket) come round more often than the rest.
 */

export const totalSeconds = (m: Pick<Meditation, 'steps'>): number => m.steps.reduce((sum, s) => sum + s.seconds, 0);

/** Its length in whole minutes, never less than one. */
export const minutesOf = (m: Pick<Meditation, 'steps'>): number => Math.max(1, Math.round(totalSeconds(m) / 60));

/** A steady 32-bit number for a string (FNV-1a), to break ties the same way every time. */
export function hashOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

export interface PickInput {
  mode: MeditationMode;
  /** Together: the kids joining. Empty for solo, or when no kids have been added yet. */
  kids: Kid[];
  /** Solo: what the parent would like for themselves. */
  parentFocus: IssueId[];
  /** Today, 'YYYY-MM-DD'. */
  today: string;
  sessions: SessionLog[];
  meditations: Meditation[];
}

interface Ranked {
  meditation: Meditation;
  score: number;
  /** 0 when it fits the youngest kid's age; otherwise how many years it misses by. */
  gap: number;
}

/** How far an age falls outside a range, in years (0 inside it). */
export function ageGap(age: number, range: AgeRange): number {
  if (inRange(age, range)) return 0;
  return age < range.from ? range.from - age : age - range.to + 1 / 12;
}

/** The kids' ages on a day, youngest first. */
function agesOn(kids: Kid[], day: string): { kid: Kid; age: number }[] {
  const date = fromKey(day);
  return kids.map((kid) => ({ kid, age: kidAge(kid, date) })).sort((a, b) => a.age - b.age);
}

const shares = <T,>(a: readonly T[], b: readonly T[]) => a.some((x) => b.includes(x));

/** Ages a together meditation without any kids should suit: broadly, the primary years. */
const BROAD_AGES = [3, 4, 5, 6, 7, 8, 9];

/**
 * Every meditation in the mode, scored for these kids (or this parent) on this day. Higher
 * scores fit better; for together, the youngest kid's age matters most.
 */
function rank(input: PickInput, day: string): Ranked[] {
  const pool = input.meditations.filter((m) => m.mode === input.mode);
  const tie = (m: Meditation) => hashOf(m.id);

  if (input.mode === 'solo') {
    return pool
      .map((meditation) => ({
        meditation,
        score: 3 * Math.min(2, meditation.goodFor.filter((issue) => input.parentFocus.includes(issue)).length),
        gap: 0,
      }))
      .sort((a, b) => b.score - a.score || tie(a.meditation) - tie(b.meditation));
  }

  const ages = agesOn(input.kids, day);
  if (!ages.length) {
    // No kids yet: the broadest ones fit; the narrower ones count as a near miss.
    const scored = pool.map((meditation) => {
      const range = meditation.ages ?? { from: 0, to: 18 };
      return { meditation, score: BROAD_AGES.filter((age) => inRange(age, range)).length };
    });
    const best = Math.max(0, ...scored.map((r) => r.score));
    return scored
      .map((r) => ({ ...r, gap: r.score >= best - 1 ? 0 : 1 + best - r.score }))
      .sort((a, b) => a.gap - b.gap || b.score - a.score || tie(a.meditation) - tie(b.meditation));
  }

  const youngest = ages[0].age;
  return pool
    .map((meditation) => {
      const range = meditation.ages ?? { from: 0, to: 18 };
      let score = 0;
      for (const [i, { kid, age }] of ages.entries()) {
        // Suiting the older ones too is a bonus; the youngest decides what fits at all.
        if (i > 0 && inRange(age, range)) score += 2;
        if (shares(meditation.interests, kid.interests)) score += i === 0 ? 4 : 3;
        if (shares(meditation.goodFor, kid.focus)) score += 2;
      }
      return { meditation, score, gap: ageGap(youngest, range) };
    })
    .sort((a, b) => a.gap - b.gap || b.score - a.score || tie(a.meditation) - tie(b.meditation));
}

/** Within this many points of the best (and above nothing), a meditation is a favourite. */
const SPREAD = 2;
/** With fewer than this fitting, the nearest misses are let in too. */
const MIN_CHOICES = 3;

/** What fits: for together, the youngest kid's age (or failing that, the nearest ages). */
function fittingOf(ranked: Ranked[]): Ranked[] {
  if (!ranked.length) return [];
  const minGap = ranked[0].gap;
  return ranked.filter((r) => r.gap <= minGap + (minGap > 0 ? 0.5 : 0));
}

/**
 * The days' rotation through everything that fits. Favourites (an interest or a focus matched,
 * or suiting every kid joining) come round twice per lap, the rest once, and never the same
 * twice in a row: favourites, half the rest, favourites, the other half.
 */
export function rotation(input: PickInput, day: string): Meditation[] {
  const fitting = fittingOf(rank(input, day));
  if (!fitting.length) return [];
  const best = Math.max(...fitting.map((r) => r.score));
  const favourite = (r: Ranked) => r.score > 0 && r.score >= best - SPREAD;
  const favourites = fitting.filter(favourite).map((r) => r.meditation);
  const rest = fitting.filter((r) => !favourite(r)).map((r) => r.meditation);
  if (!favourites.length || !rest.length) return fitting.map((r) => r.meditation);
  if (rest.length === 1) return [...favourites, ...rest];
  const half = Math.ceil(rest.length / 2);
  return [...favourites, ...rest.slice(0, half), ...favourites, ...rest.slice(half)];
}

/** How many earlier days the "not yesterday's" rule looks back through. */
const LOOK_BACK = 3;

function pickOn(input: PickInput, day: string, depth: number): Meditation | undefined {
  const cycle = rotation(input, day);
  if (!cycle.length) return undefined;
  const start = mod(dayNumber(day), cycle.length);
  const yesterday = addDays(day, -1);
  const before = depth > 0 ? pickOn(input, yesterday, depth - 1) : undefined;
  const avoid = new Set(input.sessions.filter((s) => s.date === yesterday).map((s) => s.meditationId));
  if (before) avoid.add(before.id);
  for (let i = 0; i < cycle.length; i++) {
    const candidate = cycle[(start + i) % cycle.length];
    if (!avoid.has(candidate.id)) return candidate;
  }
  // Everything was done yesterday: at least do not feature yesterday's pick again.
  for (let i = 0; i < cycle.length; i++) {
    const candidate = cycle[(start + i) % cycle.length];
    if (candidate.id !== before?.id) return candidate;
  }
  return cycle[start];
}

/**
 * Today's meditation for this mode and these kids. The same all day, never yesterday's pick,
 * and not one you did yesterday either, when there is another that fits.
 */
export function pickToday(input: PickInput): Meditation | undefined {
  return pickOn(input, input.today, LOOK_BACK);
}

/**
 * Others to try: the same mode and ages (nearest ages first when few fit), best fit first,
 * without today's pick.
 */
export function moreToTry(input: PickInput, featured: Meditation | undefined): Meditation[] {
  const ranked = rank(input, input.today);
  const fitting = fittingOf(ranked);
  const list = fitting.length >= MIN_CHOICES + 1 ? fitting : ranked.slice(0, Math.max(fitting.length, MIN_CHOICES + 1));
  return list.map((r) => r.meditation).filter((m) => m.id !== featured?.id);
}

/**
 * Days in a row with a finished session. The run is current if it reaches today or
 * yesterday, so it does not reset before you have had a chance today.
 */
export function streak(sessions: SessionLog[], today: string): number {
  const days = new Set(sessions.map((s) => s.date));
  let cursor = days.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (days.has(cursor)) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

export function doneToday(sessions: SessionLog[], today: string, meditationId?: string): boolean {
  return sessions.some((s) => s.date === today && (meditationId === undefined || s.meditationId === meditationId));
}

export interface PowerupPick {
  powerup: Powerup;
  /** The kid it was picked for, when there are kids. */
  kid?: Kid;
}

interface PowerupInput {
  powerups: Powerup[];
  challenges: Challenge[];
  kids: Kid[];
  today: string;
}

interface PowerupTurn {
  pool: Powerup[];
  index: number;
  kid?: Kid;
}

function powerupTurn({ powerups, challenges, kids, today }: PowerupInput): PowerupTurn | undefined {
  if (!powerups.length) return undefined;
  const order = (list: Powerup[]) => list.slice().sort((a, b) => hashOf(a.id) - hashOf(b.id) || a.id.localeCompare(b.id));
  const n = dayNumber(today);
  if (kids.length) {
    const issuesOf = (p: Powerup) => challenges.filter((c) => p.challengeIds.includes(c.id)).flatMap((c) => c.issues);
    const date = fromKey(today);
    // A different kid each day, in turn; each kid's list steps on each time it is their turn.
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[mod(n + i, kids.length)];
      const age = kidAge(kid, date);
      const fits = powerups.filter((p) => inRange(age, p.ages));
      if (!fits.length) continue;
      const focused = fits.filter((p) => shares(issuesOf(p), kid.focus));
      const pool = order(focused.length ? focused : fits);
      return { pool, index: mod(Math.floor(n / kids.length), pool.length), kid };
    }
  }
  const pool = order(powerups);
  return { pool, index: mod(n, pool.length) };
}

/**
 * Today's Powerup: one that fits a kid's age and what you would like help with (any one, without
 * kids). The same all day, and not yesterday's when there is another.
 */
export function pickPowerup(input: PowerupInput): PowerupPick | undefined {
  const turn = powerupTurn(input);
  if (!turn) return undefined;
  let powerup = turn.pool[turn.index];
  const before = powerupTurn({ ...input, today: addDays(input.today, -1) });
  if (before && before.pool[before.index].id === powerup.id && turn.pool.length > 1) {
    powerup = turn.pool[(turn.index + 1) % turn.pool.length];
  }
  return turn.kid ? { powerup, kid: turn.kid } : { powerup };
}

/** "Mia", "Mia and Leo", "Mia, Leo and Sam". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const interestWords = (id: string) => (INTERESTS.find((i) => i.id === id)?.label ?? id).toLowerCase();
const issueWords = (id: IssueId) => (ISSUES.find((i) => i.id === id)?.label ?? id).toLowerCase().replace(' & ', ' and ');

/**
 * Why this one, in a few words: "For Leo, who loves space", "Good for sleep". Nothing when
 * there is no particular reason.
 */
export function reasonFor(meditation: Meditation, input: Pick<PickInput, 'mode' | 'kids' | 'parentFocus' | 'today'>): string | undefined {
  if (input.mode === 'solo') {
    const issue = meditation.goodFor.find((i) => input.parentFocus.includes(i));
    return issue ? `Good for ${issueWords(issue)}` : undefined;
  }
  const kids = agesOn(input.kids, input.today).map((a) => a.kid);
  const interest = meditation.interests.find((i) => kids.some((kid) => kid.interests.includes(i)));
  if (interest) {
    const fans = kids.filter((kid) => kid.interests.includes(interest));
    return `For ${listNames(fans.map((kid) => kid.name))}, who ${fans.length === 1 ? 'loves' : 'love'} ${interestWords(interest)}`;
  }
  const issue = meditation.goodFor.find((i) => kids.some((kid) => kid.focus.includes(i)));
  return issue ? `Good for ${issueWords(issue)}` : undefined;
}

/** The youngest joining kid's age on a day, if any. */
export function youngestAge(kids: Kid[], today: string): number | undefined {
  return agesOn(kids, today)[0]?.age;
}
