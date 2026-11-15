import { STAGES } from '../../data/stages';
import { ageInMonths, formatAge, inRange, stageOf } from '../../lib/age';
import { ageAtPosition, positionOf } from '../../lib/timeline';
import type { AgeRange, Challenge, IssueId, Kid, Powerup, PowerupWhen, Source, Stage } from '../../types';

/*
 * The Powerups tab's thinking, kept apart from the screen so it can be tested on its own:
 * ages in words, which challenges matter at an age (and in what order), how the timeline's
 * bars are packed into lanes, and the stops the age slider moves between.
 */

/* Ages in words */

const QUARTERS: Record<number, string> = { 1: '¼', 2: '½', 3: '¾' };

const isWhole = (n: number) => Math.abs(n - Math.round(n)) < 1e-9;

/** Under 2 and not a whole year, an age reads best in months. */
const inMonths = (age: number) => age > 0 && age < 2 && !isWhole(age);

/**
 * One end of an age range, as it reads in "18 months to 3½": "birth", "6 months",
 * "18 months", "3½", "12". From 2 up, ages snap to the nearest quarter year.
 */
export function formatAgePoint(age: number): string {
  if (age <= 0) return 'birth';
  if (inMonths(age)) {
    const months = Math.round(age * 12);
    return months === 1 ? '1 month' : `${months} months`;
  }
  const quarters = Math.round(age * 4);
  const whole = Math.floor(quarters / 4);
  const part = QUARTERS[quarters % 4];
  return part ? `${whole}${part}` : String(whole);
}

/**
 * A range in words: "18 months to 3½", "1 to 5", "birth to 1", "6 to 18 months".
 * With `unit`, the end says what it counts: "18 months to 12 years", "birth to 1 year".
 */
export function formatSpan(range: AgeRange, { unit = false } = {}): string {
  if (inMonths(range.from) && inMonths(range.to)) {
    return `${Math.round(range.from * 12)} to ${Math.round(range.to * 12)} months`;
  }
  const from = formatAgePoint(range.from);
  const to = formatAgePoint(range.to);
  if (!unit || inMonths(range.to)) return `${from} to ${to}`;
  return `${from} to ${to} ${range.to === 1 ? 'year' : 'years'}`;
}

export const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "Peak: 18 months to 3½". */
export const peakLabel = (challenge: Challenge) => `Peak: ${formatSpan(challenge.peak)}`;

/** A timeline bar's words for a screen reader: "Tantrums: common from 1 to 5, most common from 18 months to 3½". */
export const barLabel = (challenge: Challenge) =>
  `${challenge.title}: common from ${formatSpan(challenge.ages)}, most common from ${formatSpan(challenge.peak)}`;

/** The ages a Powerup suits, for its badge: "18 months to 12 years". */
export const agesBadge = (range: AgeRange) => capitalise(formatSpan(range, { unit: true }));

/** A short name for a timeline bar: "Night waking & settling" is "Night waking". */
export const shortTitle = (title: string) => title.split(/,| & /)[0].trim();

/** The results heading for an age: "Most common at 4 years". */
export const atAgeHeading = (months: number) =>
  months < 1 ? 'Most common for newborns' : `Most common at ${formatAge(months)}`;

/** "Mia, 4 years 2 months". */
export const kidAgeLabel = (kid: Pick<Kid, 'name' | 'birth'>, today: Date = new Date()) =>
  `${kid.name}, ${formatAge(ageInMonths(kid.birth, today))}`;

/** "Mia’s", or "James’" for a name ending in s. */
export const possessive = (name: string) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);

/** Words inside their own quote marks lose them, so the screen can add its own. */
export const unquote = (text: string) => text.trim().replace(/^["“‘']+|["”’']+$/g, '').trim();

export const WHEN_LABELS: Record<PowerupWhen, string> = {
  'in-the-moment': 'In the moment',
  'daily-habit': 'Daily habit',
  prevention: 'Prevention',
  repair: 'Repair',
};

export const SOURCE_KINDS: Record<Source['kind'], string> = {
  study: 'Study',
  review: 'Review',
  guideline: 'Guideline',
  book: 'Book',
  programme: 'Programme',
};

/** The colours a challenge can take on the timeline and its card, from tokens.css. */
export type Tone = 'sun' | 'coral' | 'mint' | 'sky' | 'lilac' | 'rose' | 'brand';

/** Each issue's colour. Fourteen issues share seven colours, so near neighbours differ. */
export const ISSUE_TONES: Record<IssueId, Tone> = {
  sleep: 'lilac',
  feelings: 'coral',
  behaviour: 'sun',
  anxiety: 'sky',
  eating: 'mint',
  siblings: 'rose',
  screens: 'brand',
  school: 'sun',
  friends: 'rose',
  independence: 'mint',
  confidence: 'mint',
  body: 'rose',
  connection: 'lilac',
  risk: 'coral',
};

/** A challenge's colour: its main issue's. */
export const toneOf = (challenge: Challenge): Tone => ISSUE_TONES[challenge.issues[0]] ?? 'brand';

/* Which challenges matter at an age */

export interface RankedChallenge {
  challenge: Challenge;
  /** The age is inside its peak. */
  atPeak: boolean;
  /** How far the age is from the peak, along the timeline (one stage is 1/6); 0 at the peak. */
  distance: number;
  /** It touches one of the kid's focus issues. */
  focus: boolean;
}

function peakDistance(age: number, peak: AgeRange): number {
  if (inRange(age, peak)) return 0;
  const here = positionOf(age);
  return age < peak.from ? positionOf(peak.from) - here : here - positionOf(peak.to);
}

/** Peak and focus first, then peak, then focus, then the rest. */
const tier = (r: RankedChallenge) => (r.atPeak ? 0 : 2) + (r.focus ? 0 : 1);

/**
 * The challenges common at an age (in years), most relevant first: those at their peak, then
 * by how close the age is to the peak. A kid's focus issues lift theirs up within each.
 */
export function challengesAt(
  challenges: Challenge[],
  age: number,
  { issue, focus = [] }: { issue?: IssueId; focus?: IssueId[] } = {},
): RankedChallenge[] {
  return challenges
    .filter((c) => inRange(age, c.ages) && (!issue || c.issues.includes(issue)))
    .map((challenge) => ({
      challenge,
      atPeak: inRange(age, challenge.peak),
      distance: peakDistance(age, challenge.peak),
      focus: challenge.issues.some((i) => focus.includes(i)),
    }))
    .sort(
      (a, b) =>
        tier(a) - tier(b) ||
        a.distance - b.distance ||
        a.challenge.peak.from - b.challenge.peak.from ||
        a.challenge.title.localeCompare(b.challenge.title),
    );
}

/** Challenges grouped by the stage they peak in, youngest first; empty stages left out. */
export function groupByStage(challenges: Challenge[]): { stage: Stage; challenges: Challenge[] }[] {
  const sorted = [...challenges].sort((a, b) => a.peak.from - b.peak.from || a.ages.from - b.ages.from);
  return STAGES.map((stage) => ({
    stage,
    challenges: sorted.filter((c) => stageOf(c.peak.from).id === stage.id),
  })).filter((group) => group.challenges.length > 0);
}

/** A challenge's Powerups in the order written; with an age, those that suit it come first. */
export function powerupsForChallenge(challengeId: string, powerups: Powerup[], age?: number | null): Powerup[] {
  const list = powerups.filter((p) => p.challengeIds.includes(challengeId));
  if (age == null) return list;
  return [...list.filter((p) => inRange(age, p.ages)), ...list.filter((p) => !inRange(age, p.ages))];
}

/** The few Powerups a challenge's card shows: those that suit the age when there are any. */
export function topPowerups(challengeId: string, powerups: Powerup[], age?: number | null, limit = 2): Powerup[] {
  const list = powerupsForChallenge(challengeId, powerups, age);
  const fitting = age == null ? list : list.filter((p) => inRange(age, p.ages));
  return (fitting.length ? fitting : list).slice(0, limit);
}

/* The timeline */

export interface Span {
  start: number;
  end: number;
}

/**
 * Puts spans into lanes so none in a lane overlap (keeping `gap` between neighbours), using as
 * few lanes as possible: each, from the earliest start, goes in the first lane free for it.
 */
export function packLanes(spans: Span[], gap = 0): { lanes: number[]; count: number } {
  const order = spans.map((_, i) => i).sort((a, b) => spans[a].start - spans[b].start || spans[b].end - spans[a].end);
  const ends: number[] = [];
  const lanes = new Array<number>(spans.length).fill(0);
  for (const i of order) {
    const span = spans[i];
    let lane = ends.findIndex((end) => end + gap <= span.start + 1e-9);
    if (lane === -1) {
      lane = ends.length;
      ends.push(span.end);
    } else {
      ends[lane] = span.end;
    }
    lanes[i] = lane;
  }
  return { lanes, count: ends.length };
}

export interface BarLayout {
  challenge: Challenge;
  lane: number;
  /** Where its ages start and end along the timeline (0 to 1). */
  start: number;
  end: number;
  peakStart: number;
  peakEnd: number;
}

/** About how wide a bar's label is, in px (13px semibold text, an emoji and its gap). */
export const labelWidth = (title: string) => Math.ceil(shortTitle(title).length * 7 + 26);

/**
 * Lays the challenges out as bars across their ages. A bar's lane is kept clear for its label
 * too, so the words never run into the next bar. `width` is the timeline's width in px.
 */
export function layoutBars(challenges: Challenge[], width = 558): { bars: BarLayout[]; lanes: number } {
  const geometry = challenges.map((challenge) => ({
    challenge,
    start: positionOf(challenge.ages.from),
    end: positionOf(challenge.ages.to),
    peakStart: positionOf(challenge.peak.from),
    peakEnd: positionOf(challenge.peak.to),
  }));
  const spans = geometry.map((g) => ({ start: g.start, end: Math.max(g.end, g.start + labelWidth(g.challenge.title) / width) }));
  const { lanes, count } = packLanes(spans, 6 / width);
  return { bars: geometry.map((g, i) => ({ ...g, lane: lanes[i] })).sort((a, b) => a.start - b.start || a.lane - b.lane), lanes: count };
}

/**
 * Spreads points along a line (0 to 1) so none sit closer than `minGap`, moving each group of
 * crowded points evenly around its middle. Kids born close together keep their order.
 */
export function spreadPoints(points: number[], minGap: number, min = 0, max = 1): number[] {
  const order = points.map((_, i) => i).sort((a, b) => points[a] - points[b] || a - b);
  const clusters: { members: number[]; centre: number }[] = [];
  const half = (n: number) => ((n - 1) * minGap) / 2;
  for (const i of order) {
    clusters.push({ members: [i], centre: points[i] });
    while (clusters.length > 1) {
      const b = clusters[clusters.length - 1];
      const a = clusters[clusters.length - 2];
      if (b.centre - half(b.members.length) - (a.centre + half(a.members.length)) >= minGap - 1e-9) break;
      const members = [...a.members, ...b.members];
      clusters.splice(-2, 2, { members, centre: members.reduce((sum, j) => sum + points[j], 0) / members.length });
    }
  }
  const out = new Array<number>(points.length);
  for (const { members, centre } of clusters) {
    const width = (members.length - 1) * minGap;
    const first = Math.max(min, Math.min(centre - width / 2, max - width));
    members.forEach((j, k) => (out[j] = first + k * minGap));
  }
  return out;
}

/* The age slider, in whole months */

/** The oldest age the slider picks: 17 years 11 months (ranges run up to, not including, 18). */
export const MAX_MONTHS = 18 * 12 - 1;

/**
 * Where the arrow keys stop: every month to 2, every 3 months to 5, then every year to 17, so
 * each stop reads differently ("19 months", "2 years 3 months", "6 years").
 */
export const AGE_STOPS: number[] = [
  ...Array.from({ length: 24 }, (_, m) => m),
  ...Array.from({ length: 12 }, (_, i) => 24 + i * 3),
  ...Array.from({ length: 13 }, (_, i) => 60 + i * 12),
];

const LAST_STOP = AGE_STOPS[AGE_STOPS.length - 1];

/** The next stop up (1) or down (-1) from an age; with no age yet, the slider sits at birth. */
export function stepAge(months: number | null, direction: 1 | -1): number {
  const from = months ?? 0;
  if (direction > 0) return AGE_STOPS.find((stop) => stop > from) ?? Math.max(from, LAST_STOP);
  return [...AGE_STOPS].reverse().find((stop) => stop < from) ?? 0;
}

/** The nearest stop to an age in months (the lower one on a tie). */
export function snapMonths(months: number): number {
  let best = AGE_STOPS[0];
  for (const stop of AGE_STOPS) if (Math.abs(stop - months) < Math.abs(best - months)) best = stop;
  return best;
}

const STAGE_STARTS = STAGES.map((stage) => stage.from * 12);

/** The start of the next stage up (1) or down (-1): Page Up and Page Down. */
export function stepStage(months: number | null, direction: 1 | -1): number {
  const from = months ?? 0;
  if (direction > 0) return STAGE_STARTS.find((start) => start > from) ?? Math.max(from, LAST_STOP);
  return [...STAGE_STARTS].reverse().find((start) => start < from) ?? 0;
}

/** The age a tap on a stage picks: its middle, on a stop (Toddler is 2 years, Teen 15). */
export const stageMonths = (stage: Stage) =>
  snapMonths(Math.floor(((stage.from + stage.to) / 2) * 12));

/** The age at a point along the timeline (0 to 1), on a stop. */
export const monthsAtPosition = (position: number) => Math.min(snapMonths(ageAtPosition(position) * 12), LAST_STOP);

/* Search and counts */

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘]/g, "'")
    .toLowerCase();

/** Powerups whose title or tagline has every word searched for; title matches first. */
export function searchPowerups(powerups: Powerup[], query: string): Powerup[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return powerups
    .map((powerup, index) => {
      const title = fold(powerup.title);
      const tagline = fold(powerup.tagline);
      if (!words.every((w) => title.includes(w) || tagline.includes(w))) return null;
      return { powerup, index, score: words.filter((w) => title.includes(w)).length };
    })
    .filter((hit): hit is { powerup: Powerup; index: number; score: number } => hit !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((hit) => hit.powerup);
}

/** How many different sources the Powerups draw on. */
export function countSources(powerups: Powerup[]): number {
  return new Set(powerups.flatMap((p) => p.sources.map((s) => s.url ?? `${fold(s.title)}|${s.year}`))).size;
}
