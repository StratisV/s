import { INTERESTS } from '../../data/family';
import { MEDITATIONS } from '../../data/meditations';
import { inRange } from '../../lib/age';
import type { BreathPattern, IssueId } from '../../types';
import { totalSeconds } from './pick';
import { cycleSeconds } from './timing';

/*
 * The meditations' own rules, beyond the shape checks in src/data/content.test.ts: lengths that
 * suit each age, breaths that end where they start, gentle rhythms for children, and words that
 * follow the house style.
 */

const together = MEDITATIONS.filter((m) => m.mode === 'together');
const solo = MEDITATIONS.filter((m) => m.mode === 'solo');
const minutes = (seconds: number) => seconds / 60;

describe('the meditations', () => {
  it('has plenty of each kind', () => {
    expect(together.length).toBeGreaterThanOrEqual(14);
    expect(solo.length).toBeGreaterThanOrEqual(8);
  });

  it('keeps solo ones between 2 and 10 minutes', () => {
    solo.forEach((m) => {
      expect(minutes(totalSeconds(m))).toBeGreaterThanOrEqual(2);
      expect(minutes(totalSeconds(m))).toBeLessThanOrEqual(10);
    });
  });

  it('keeps together ones short for little ones and longer for teens', () => {
    together.forEach((m) => {
      const length = minutes(totalSeconds(m));
      const from = m.ages!.from;
      // By the youngest age it suits: about 2 to 3 minutes for little ones, up to 8 for teens.
      if (from < 4) expect(length, m.id).toBeLessThanOrEqual(3);
      else if (from < 6) expect(length, m.id).toBeLessThanOrEqual(4);
      else if (from < 10) expect(length, m.id).toBeLessThanOrEqual(6);
      else expect(length, m.id).toBeLessThanOrEqual(8);
      if (from >= 10) expect(length).toBeGreaterThanOrEqual(4);
      expect(length).toBeGreaterThanOrEqual(2);
    });
  });

  it('has at least four that fit every age from 2 to 18, covering sleep, feelings and worries', () => {
    for (let age = 2; age < 18; age += 0.5) {
      const fits = together.filter((m) => inRange(age, m.ages!));
      expect(fits.length, `age ${age}`).toBeGreaterThanOrEqual(4);
      for (const issue of ['sleep', 'feelings', 'anxiety'] as IssueId[]) {
        expect(fits.some((m) => m.goodFor.includes(issue)), `${issue} at ${age}`).toBe(true);
      }
    }
  });

  it('picks up the kids’ interests', () => {
    const covered = new Set(together.flatMap((m) => m.interests));
    for (const id of ['space', 'ocean', 'animals', 'dinosaurs', 'nature', 'sport', 'music'] as const) expect(covered.has(id)).toBe(true);
    // Every interest a kid can have is known to the content.
    covered.forEach((id) => expect(INTERESTS.some((i) => i.id === id)).toBe(true));
  });

  it('covers what parents most often want help with', () => {
    const covered = new Set(MEDITATIONS.flatMap((m) => m.goodFor));
    for (const id of ['sleep', 'feelings', 'anxiety', 'school', 'connection', 'confidence'] as IssueId[]) expect(covered.has(id)).toBe(true);
  });

  it('breathes in whole breaths, so the circle always ends on an out-breath', () => {
    MEDITATIONS.forEach((m) =>
      m.steps.forEach((step) => {
        if (step.breath) expect(step.seconds % cycleSeconds(step.breath), `${m.id}: ${step.text}`).toBe(0);
      }),
    );
  });

  it('uses gentle rhythms: a longer out-breath, and small breaths for small children', () => {
    const breaths = (ids: typeof MEDITATIONS) => ids.flatMap((m) => m.steps.flatMap((s) => (s.breath ? [[m, s.breath] as const] : [])));
    breaths(MEDITATIONS).forEach(([m, b]: readonly [unknown, BreathPattern]) => {
      expect(b.exhale).toBeGreaterThanOrEqual(b.inhale);
      expect(b.inhale).toBeLessThanOrEqual(4);
      expect(b.hold ?? 0).toBeLessThanOrEqual(4);
      void m;
    });
    breaths(together.filter((m) => m.ages!.from < 7)).forEach(([, b]) => {
      expect(b).toEqual({ inhale: 3, exhale: 4 });
    });
    // Every meditation has some guided breathing.
    MEDITATIONS.forEach((m) => expect(m.steps.some((s) => s.breath), m.id).toBe(true));
  });

  it('starts by settling in, without a breathing exercise straight away', () => {
    MEDITATIONS.forEach((m) => expect(m.steps[0].breath, m.id).toBeUndefined());
  });

  it('invites rather than instructs: eyes can stay open', () => {
    MEDITATIONS.forEach((m) => {
      const words = m.steps.map((s) => s.text).join(' ');
      if (/close your eyes|eyes close/i.test(words)) expect(words, m.id).toMatch(/if you like|if you want|if that feels|or look|or rest|or keep/i);
    });
  });

  it('follows the house style: no dashes as punctuation, British spelling, short steps', () => {
    MEDITATIONS.forEach((m) => {
      const words = [m.title, m.theme, m.intro, ...m.steps.map((s) => s.text)];
      words.forEach((text) => {
        expect(text, m.id).not.toMatch(/[–—]/);
        expect(text, m.id).not.toMatch(/ - /);
        expect(text, m.id).not.toMatch(/\b(color|favorite|mom|realize|center)\b/i);
      });
      m.steps.forEach((s) => expect(s.text.length, s.text).toBeLessThanOrEqual(170));
      expect(m.intro.length).toBeLessThanOrEqual(110);
    });
  });
});
