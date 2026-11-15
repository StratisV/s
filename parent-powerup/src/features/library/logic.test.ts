import { CHALLENGES } from '../../data/library';
import { STAGES } from '../../data/stages';
import type { Challenge, Powerup } from '../../types';
import {
  AGE_STOPS,
  agesBadge,
  atAgeHeading,
  barLabel,
  challengesAt,
  countSources,
  formatAgePoint,
  formatSpan,
  groupByStage,
  kidAgeLabel,
  layoutBars,
  monthsAtPosition,
  packLanes,
  peakLabel,
  possessive,
  powerupsForChallenge,
  searchPowerups,
  shortTitle,
  snapMonths,
  spreadPoints,
  stageMonths,
  stepAge,
  stepStage,
  topPowerups,
  unquote,
} from './logic';

const challenge = (id: string, over: Partial<Challenge> = {}): Challenge => ({
  id,
  title: id,
  emoji: '⭐',
  issues: ['behaviour'],
  ages: { from: 1, to: 5 },
  peak: { from: 2, to: 3 },
  summary: 'A summary long enough to read.',
  normal: 'Normal.',
  seekHelp: [],
  ...over,
});

const powerup = (id: string, over: Partial<Powerup> = {}): Powerup => ({
  id,
  title: id,
  tagline: `${id} tagline`,
  challengeIds: ['c'],
  ages: { from: 1, to: 5 },
  when: 'in-the-moment',
  time: '1 minute',
  steps: ['One', 'Two', 'Three'],
  why: 'Why it works, at some length.',
  approach: 'Emotion coaching',
  sources: [{ title: 'A book', authors: 'Someone', year: 2000, publisher: 'Press', kind: 'book' }],
  ...over,
});

describe('ages in words', () => {
  it('writes one end of a range', () => {
    expect(formatAgePoint(0)).toBe('birth');
    expect(formatAgePoint(0.25)).toBe('3 months');
    expect(formatAgePoint(1)).toBe('1');
    expect(formatAgePoint(1.5)).toBe('18 months');
    expect(formatAgePoint(2.5)).toBe('2½');
    expect(formatAgePoint(3.5)).toBe('3½');
    expect(formatAgePoint(4.25)).toBe('4¼');
    expect(formatAgePoint(12)).toBe('12');
  });

  it('writes a range', () => {
    expect(formatSpan({ from: 1.5, to: 3.5 })).toBe('18 months to 3½');
    expect(formatSpan({ from: 1, to: 5 })).toBe('1 to 5');
    expect(formatSpan({ from: 0, to: 1 })).toBe('birth to 1');
    expect(formatSpan({ from: 0.5, to: 1.5 })).toBe('6 to 18 months');
    expect(formatSpan({ from: 1.5, to: 12 }, { unit: true })).toBe('18 months to 12 years');
    expect(formatSpan({ from: 0, to: 1 }, { unit: true })).toBe('birth to 1 year');
    expect(agesBadge({ from: 0, to: 1 })).toBe('Birth to 1 year');
  });

  it('labels challenges for the cards and the timeline', () => {
    const tantrums = challenge('tantrums', { title: 'Tantrums', ages: { from: 1, to: 5 }, peak: { from: 1.5, to: 3.5 } });
    expect(peakLabel(tantrums)).toBe('Peak: 18 months to 3½');
    expect(barLabel(tantrums)).toBe('Tantrums: common from 1 to 5, most common from 18 months to 3½');
  });

  it('never uses a dash as punctuation', () => {
    for (const c of CHALLENGES) {
      expect(barLabel(c)).not.toMatch(/[–—]/);
      expect(peakLabel(c)).not.toMatch(/[–—]/);
    }
  });

  it('shortens titles for the timeline', () => {
    expect(shortTitle('Night waking & settling')).toBe('Night waking');
    expect(shortTitle('Hitting, biting & pushing')).toBe('Hitting');
    expect(shortTitle('Tantrums')).toBe('Tantrums');
  });

  it('names ages and kids', () => {
    expect(atAgeHeading(48)).toBe('Most common at 4 years');
    expect(atAgeHeading(18)).toBe('Most common at 18 months');
    expect(atAgeHeading(0)).toBe('Most common for newborns');
    expect(kidAgeLabel({ name: 'Mia', birth: '2022-09' }, new Date(2026, 10, 20))).toBe('Mia, 4 years 2 months');
    expect(possessive('Mia')).toBe('Mia’s');
    expect(possessive('James')).toBe('James’');
  });

  it('takes the quote marks off words to try', () => {
    expect(unquote('“You’re really cross. I’m right here.”')).toBe('You’re really cross. I’m right here.');
    expect(unquote('Plain words')).toBe('Plain words');
  });
});

describe('challengesAt', () => {
  const list = [
    challenge('far-from-peak', { ages: { from: 1, to: 10 }, peak: { from: 7, to: 9 } }),
    challenge('at-peak', { ages: { from: 2, to: 6 }, peak: { from: 3, to: 5 } }),
    challenge('near-peak', { ages: { from: 2, to: 8 }, peak: { from: 5, to: 7 } }),
    challenge('too-old', { ages: { from: 6, to: 12 }, peak: { from: 7, to: 9 } }),
    challenge('sleepy', { issues: ['sleep'], ages: { from: 1, to: 8 }, peak: { from: 6, to: 7 } }),
  ];

  it('keeps only what is common at the age', () => {
    const ids = challengesAt(list, 4).map((r) => r.challenge.id);
    expect(ids).not.toContain('too-old');
    expect(ids).toHaveLength(4);
  });

  it('puts those at their peak first, then by closeness to the peak', () => {
    expect(challengesAt(list, 4).map((r) => r.challenge.id)).toEqual(['at-peak', 'near-peak', 'sleepy', 'far-from-peak']);
    expect(challengesAt(list, 4)[0].atPeak).toBe(true);
  });

  it('lifts a kid’s focus issues', () => {
    const ranked = challengesAt(list, 4, { focus: ['sleep'] });
    expect(ranked.map((r) => r.challenge.id)).toEqual(['at-peak', 'sleepy', 'near-peak', 'far-from-peak']);
    expect(ranked.find((r) => r.challenge.id === 'sleepy')?.focus).toBe(true);
    // At its peak, a focus challenge goes to the very top.
    expect(challengesAt(list, 6.5, { focus: ['sleep'] })[0].challenge.id).toBe('sleepy');
  });

  it('filters by issue', () => {
    expect(challengesAt(list, 4, { issue: 'sleep' }).map((r) => r.challenge.id)).toEqual(['sleepy']);
  });

  it('finds tantrums at their peak at 2 in the real library', () => {
    const ranked = challengesAt(CHALLENGES, 2);
    const tantrums = ranked.find((r) => r.challenge.id === 'tantrums');
    expect(tantrums?.atPeak).toBe(true);
    expect(ranked.findIndex((r) => !r.atPeak)).toBeGreaterThan(ranked.indexOf(tantrums!));
  });
});

describe('groupByStage', () => {
  it('groups every challenge under the stage it peaks in, youngest first', () => {
    const groups = groupByStage(CHALLENGES);
    expect(groups.flatMap((g) => g.challenges)).toHaveLength(CHALLENGES.length);
    expect(groups[0].stage.id).toBe('baby');
    for (const { stage, challenges } of groups) {
      challenges.forEach((c) => expect(c.peak.from >= stage.from && c.peak.from < stage.to).toBe(true));
    }
  });

  it('leaves out empty stages', () => {
    const groups = groupByStage([challenge('a', { peak: { from: 4, to: 5 }, ages: { from: 3, to: 6 } })]);
    expect(groups.map((g) => g.stage.id)).toEqual(['preschool']);
  });
});

describe('Powerups for a challenge', () => {
  const list = [
    powerup('older', { ages: { from: 6, to: 12 } }),
    powerup('young', { ages: { from: 1, to: 5 } }),
    powerup('any', { ages: { from: 0, to: 18 } }),
    powerup('elsewhere', { challengeIds: ['other'] }),
  ];

  it('keeps the written order, with those that suit the age first', () => {
    expect(powerupsForChallenge('c', list).map((p) => p.id)).toEqual(['older', 'young', 'any']);
    expect(powerupsForChallenge('c', list, 3).map((p) => p.id)).toEqual(['young', 'any', 'older']);
  });

  it('shows the top few that suit the age, or the first few when none do', () => {
    expect(topPowerups('c', list, 3, 2).map((p) => p.id)).toEqual(['young', 'any']);
    expect(topPowerups('c', list, 8, 2).map((p) => p.id)).toEqual(['older', 'any']);
    expect(topPowerups('c', [list[0]], 3, 2).map((p) => p.id)).toEqual(['older']);
  });
});

describe('packLanes', () => {
  const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

  it('uses as few lanes as the busiest moment needs', () => {
    const spans = [
      { start: 0, end: 0.4 },
      { start: 0.1, end: 0.3 },
      { start: 0.35, end: 0.6 },
      { start: 0.5, end: 0.9 },
    ];
    const { lanes, count } = packLanes(spans);
    expect(count).toBe(2);
    expect(lanes).toEqual([0, 1, 1, 0]);
  });

  it('keeps a gap between neighbours in a lane', () => {
    expect(packLanes([{ start: 0, end: 0.5 }, { start: 0.5, end: 1 }]).count).toBe(1);
    expect(packLanes([{ start: 0, end: 0.5 }, { start: 0.5, end: 1 }], 0.01).count).toBe(2);
  });

  it('never lets the real challenges’ bars or labels overlap', () => {
    const { bars, lanes } = layoutBars(CHALLENGES);
    expect(bars).toHaveLength(CHALLENGES.length);
    expect(lanes).toBeLessThan(CHALLENGES.length);
    for (const a of bars) {
      for (const b of bars) {
        if (a === b || a.lane !== b.lane) continue;
        expect(overlaps(a, b)).toBe(false);
      }
    }
  });
});

describe('spreadPoints', () => {
  it('leaves points that are far apart alone', () => {
    expect(spreadPoints([0.2, 0.6], 0.1)).toEqual([0.2, 0.6]);
  });

  it('spreads twins evenly around where they are', () => {
    const [a, b] = spreadPoints([0.5, 0.5], 0.1);
    expect(a).toBeCloseTo(0.45);
    expect(b).toBeCloseTo(0.55);
  });

  it('keeps everyone on the line and in order', () => {
    const out = spreadPoints([0.02, 0, 0.01], 0.1);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(0);
    expect(out[1]).toBeLessThan(out[2]);
    expect(out[2]).toBeLessThan(out[0]);
    expect(out[2] - out[1]).toBeCloseTo(0.1);
  });
});

describe('the age slider', () => {
  it('stops every month to 2, every 3 months to 5, then every year', () => {
    expect(AGE_STOPS.slice(0, 3)).toEqual([0, 1, 2]);
    expect(stepAge(23, 1)).toBe(24);
    expect(stepAge(24, 1)).toBe(27);
    expect(stepAge(50, 1)).toBe(51);
    expect(stepAge(50, -1)).toBe(48);
    expect(stepAge(57, 1)).toBe(60);
    expect(stepAge(60, 1)).toBe(72);
    expect(stepAge(204, 1)).toBe(204);
    expect(stepAge(0, -1)).toBe(0);
    expect(stepAge(null, 1)).toBe(1);
  });

  it('jumps a stage with Page Up and Page Down', () => {
    expect(stepStage(50, 1)).toBe(60);
    expect(stepStage(50, -1)).toBe(36);
    expect(stepStage(0, -1)).toBe(0);
  });

  it('picks the middle of a stage', () => {
    expect(STAGES.map(stageMonths)).toEqual([6, 24, 48, 72, 120, 180]);
  });

  it('snaps a tap along the axis to a stop', () => {
    expect(snapMonths(49)).toBe(48);
    expect(monthsAtPosition(0)).toBe(0);
    expect(monthsAtPosition(1)).toBe(204);
    // Half way along is the start of the early school years: 5.
    expect(monthsAtPosition(0.5)).toBe(60);
  });
});

describe('search', () => {
  const list = [
    powerup('a', { title: 'Name it to tame it', tagline: 'Put feelings into words.' }),
    powerup('b', { title: 'Calm first', tagline: 'Help them name the feeling later.' }),
    powerup('c', { title: 'Bedtime pass', tagline: 'One trip out of bed.' }),
  ];

  it('matches every word in titles and taglines, titles first', () => {
    expect(searchPowerups(list, 'name').map((p) => p.id)).toEqual(['a', 'b']);
    expect(searchPowerups(list, 'NAME feeling').map((p) => p.id)).toEqual(['a', 'b']);
    expect(searchPowerups(list, 'bed trip').map((p) => p.id)).toEqual(['c']);
    expect(searchPowerups(list, '  ')).toEqual([]);
  });

  it('counts different sources once', () => {
    expect(countSources(list)).toBe(1);
  });
});
