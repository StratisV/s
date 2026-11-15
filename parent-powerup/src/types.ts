/*
 * The shapes of everything in Parent Powerup. The content (Powerups, meditations, the weekly
 * digest) is data in src/data; the family is saved on this device (src/lib/store.ts).
 *
 * Ages are in years, as decimals: 1.5 is 18 months. A range runs from `from` up to (not
 * including) `to`, so a challenge for 1 to 3 covers a child of 2 years 11 months but not 3.
 */

/** What a parent filters the library by. */
export type IssueId =
  | 'sleep'
  | 'feelings'
  | 'behaviour'
  | 'eating'
  | 'anxiety'
  | 'siblings'
  | 'screens'
  | 'school'
  | 'friends'
  | 'independence'
  | 'body'
  | 'confidence'
  | 'connection'
  | 'risk';

export interface Issue {
  id: IssueId;
  label: string;
  emoji: string;
}

/** The stages along the timeline, each the same width on screen (src/lib/timeline.ts). */
export type StageId = 'baby' | 'toddler' | 'preschool' | 'early-school' | 'middle-years' | 'teen';

export interface Stage {
  id: StageId;
  label: string;
  /** "0 to 1", shown under the label. */
  span: string;
  from: number;
  to: number;
  /** One line on what this stage is about. */
  blurb: string;
}

export interface AgeRange {
  from: number;
  to: number;
}

/** Where the thinking behind a Powerup (or a digest item) comes from. Always a real, checkable source. */
export interface Source {
  title: string;
  /** "Gottman, J. M." or "American Academy of Pediatrics". */
  authors: string;
  year: number;
  /** The journal, publisher or organisation. */
  publisher: string;
  /** A stable link: PubMed, a DOI, or the organisation's own page. */
  url?: string;
  kind: 'study' | 'review' | 'guideline' | 'book' | 'programme';
}

/** A common challenge as children grow up, placed on the timeline by `ages` and `peak`. */
export interface Challenge {
  id: string;
  title: string;
  emoji: string;
  /** The first is the main one (its colour on the timeline). */
  issues: IssueId[];
  /** When it commonly shows up. */
  ages: AgeRange;
  /** When it is most common. Inside `ages`. */
  peak: AgeRange;
  /** What is going on, developmentally, in a sentence or two. */
  summary: string;
  /** Reassurance: what is normal here. */
  normal: string;
  /** Signs it is worth talking to a GP, health visitor, paediatrician or psychologist. */
  seekHelp: string[];
}

export type PowerupWhen = 'in-the-moment' | 'daily-habit' | 'prevention' | 'repair';

/** A technique or tip for a challenge, from an evidence-based approach. */
export interface Powerup {
  id: string;
  title: string;
  /** One line: what it does. */
  tagline: string;
  /** The challenges it helps with (at least one). */
  challengeIds: string[];
  /** The ages it suits; may be narrower or wider than its challenges'. */
  ages: AgeRange;
  when: PowerupWhen;
  /** How long it takes, in plain words: "2 minutes", "10 minutes a day". */
  time: string;
  /** What to do, in order: 3 to 5 short steps. */
  steps: string[];
  /** Words to try, if any: "You're really cross the tower fell. I'm here." */
  sayThis?: string;
  /** Why it works: the developmental science, in plain words. */
  why: string;
  /** The expert approach it comes from: "Emotion coaching", "Parent-Child Interaction Therapy". */
  approach: string;
  sources: Source[];
  /** Set once a named clinician has reviewed it; until then the UI shows the approach and sources only. */
  review?: { by: string; credentials: string; date: string };
}

/** A breathing rhythm the circle follows, in seconds. */
export interface BreathPattern {
  inhale: number;
  hold?: number;
  exhale: number;
  /** A pause after breathing out. */
  rest?: number;
}

export interface MeditationStep {
  /** Shown on screen and, with voice on, read aloud. */
  text: string;
  seconds: number;
  /** While this step runs the circle breathes this pattern; without it the circle rests. */
  breath?: BreathPattern;
}

/** Together: a parent with one or more kids. Solo: the parent alone. */
export type MeditationMode = 'together' | 'solo';

export interface Meditation {
  id: string;
  title: string;
  mode: MeditationMode;
  /** Together only: the kids' ages it suits. */
  ages?: AgeRange;
  emoji: string;
  /** "Ocean", "Space", "Calm after a hard moment". */
  theme: string;
  /** Interests it fits (personalising: a space-mad kid gets the rocket one). */
  interests: InterestId[];
  /** What it can help with. */
  goodFor: IssueId[];
  /** A line on what it is. */
  intro: string;
  steps: MeditationStep[];
}

export type KidColour = 'sun' | 'coral' | 'mint' | 'sky' | 'lilac' | 'rose';

export type TemperamentId =
  | 'sensitive'
  | 'spirited'
  | 'cautious'
  | 'easygoing'
  | 'strong-willed'
  | 'social'
  | 'dreamy'
  | 'anxious';

export type InterestId =
  | 'animals'
  | 'space'
  | 'ocean'
  | 'dinosaurs'
  | 'nature'
  | 'sport'
  | 'music'
  | 'art'
  | 'building'
  | 'stories'
  | 'vehicles'
  | 'gaming';

export interface Kid {
  id: string;
  name: string;
  /** Birth month, 'YYYY-MM'. A month is enough to place them on the timeline. */
  birth: string;
  avatar: string;
  colour: KidColour;
  temperament: TemperamentId[];
  interests: InterestId[];
  /** What the parent would like help with right now. */
  focus: IssueId[];
  /** Anything else: needs, a diagnosis, a new sibling on the way, a move. */
  notes: string;
}

export interface Parent {
  name: string;
  /** What the parent would like for themselves (meditation picks lean on it). */
  focus: IssueId[];
}

/** A meditation finished, for the streak and the "done today" tick. */
export interface SessionLog {
  /** Local date, 'YYYY-MM-DD'. */
  date: string;
  meditationId: string;
  mode: MeditationMode;
  kidIds: string[];
  /** How it felt afterwards, 1 (still wobbly) to 3 (calm). */
  feeling?: 1 | 2 | 3;
}

export interface SavedState {
  version: 1;
  parent: Parent;
  kids: Kid[];
  sessions: SessionLog[];
  /** Powerups the parent bookmarked. */
  saved: string[];
  /** Whether the welcome has been seen. */
  welcomed: boolean;
}

/** One piece of new science in the weekly digest. Every item is a real, linked publication. */
export interface DigestItem {
  id: string;
  kind: 'study' | 'review' | 'guideline';
  /** Our plain-language headline. */
  headline: string;
  /** What they did and found, in two or three plain sentences. */
  summary: string;
  /** What this means for you, as a parent. */
  takeaway: string;
  issues: IssueId[];
  /** The children's ages the work is about, when it is about an age. */
  ages?: AgeRange;
  source: {
    /** The publication's own title. */
    title: string;
    /** "Smith J, Jones A, et al." */
    authors: string;
    journal: string;
    /** 'YYYY-MM-DD' (or 'YYYY-MM' when only the month is known). */
    published: string;
    url: string;
    pmid?: string;
    doi?: string;
  };
}

export interface Digest {
  /** ISO week: '2026-W46'. */
  week: string;
  /** The Monday it was published, 'YYYY-MM-DD'. */
  weekOf: string;
  /** The week's theme in a few words. */
  title: string;
  /** A short note from the curators. */
  editorNote: string;
  items: DigestItem[];
}

/** Where the app is: a tab, and what it was asked to show there. */
export type TabId = 'meditate' | 'powerups' | 'family' | 'weekly';

export interface Route {
  tab: TabId;
  /** Powerups: filter to this kid's age (and their focus). */
  kid?: string;
  /** Powerups: open this challenge, or this Powerup. */
  challenge?: string;
  powerup?: string;
  /** Powerups: filter by this issue. */
  issue?: IssueId;
  /** Family: open the editor for this kid ('new' for a new one). */
  edit?: string;
}
