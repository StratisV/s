import { CHALLENGES, POWERUPS } from './library';
import { ISSUES } from './issues';
import { MEDITATIONS } from './meditations';
import { DIGESTS } from './digests';
import { INTERESTS } from './family';
import type { AgeRange } from '../types';

/*
 * The content's own rules. Every Powerup must point at real challenges and real sources, ages
 * must make sense on the timeline, and every piece of the weekly digest must link to its source.
 */

const ISSUE_IDS = new Set(ISSUES.map((i) => i.id));
const INTEREST_IDS = new Set(INTERESTS.map((i) => i.id));
const validRange = (r: AgeRange) => r.from >= 0 && r.to <= 18 && r.from < r.to;
const unique = (ids: string[]) => ids.length === new Set(ids).size;

describe('library', () => {
  it('has unique ids', () => {
    expect(unique(CHALLENGES.map((c) => c.id))).toBe(true);
    expect(unique(POWERUPS.map((p) => p.id))).toBe(true);
  });

  it.each(CHALLENGES.map((c) => [c.id, c] as const))('challenge %s is well formed', (_, c) => {
    expect(validRange(c.ages)).toBe(true);
    expect(validRange(c.peak)).toBe(true);
    expect(c.peak.from).toBeGreaterThanOrEqual(c.ages.from);
    expect(c.peak.to).toBeLessThanOrEqual(c.ages.to);
    expect(c.issues.length).toBeGreaterThan(0);
    c.issues.forEach((i) => expect(ISSUE_IDS.has(i)).toBe(true));
    expect(c.summary.length).toBeGreaterThan(20);
  });

  it.each(POWERUPS.map((p) => [p.id, p] as const))('powerup %s is well formed', (_, p) => {
    expect(validRange(p.ages)).toBe(true);
    expect(p.challengeIds.length).toBeGreaterThan(0);
    p.challengeIds.forEach((id) => expect(CHALLENGES.some((c) => c.id === id)).toBe(true));
    expect(p.steps.length).toBeGreaterThanOrEqual(3);
    expect(p.steps.length).toBeLessThanOrEqual(6);
    expect(p.why.length).toBeGreaterThan(40);
    expect(p.approach.length).toBeGreaterThan(3);
    expect(p.sources.length).toBeGreaterThan(0);
    p.sources.forEach((s) => {
      expect(s.title && s.authors && s.publisher).toBeTruthy();
      expect(s.year).toBeGreaterThan(1950);
      if (s.url) expect(s.url).toMatch(/^https:\/\//);
    });
  });
});

describe('meditations', () => {
  it('has unique ids', () => {
    expect(unique(MEDITATIONS.map((m) => m.id))).toBe(true);
  });

  it.each(MEDITATIONS.map((m) => [m.id, m] as const))('meditation %s is well formed', (_, m) => {
    expect(m.steps.length).toBeGreaterThan(2);
    m.steps.forEach((s) => {
      expect(s.seconds).toBeGreaterThan(0);
      expect(s.text.length).toBeGreaterThan(5);
    });
    if (m.mode === 'together') expect(m.ages && validRange(m.ages)).toBeTruthy();
    m.interests.forEach((i) => expect(INTEREST_IDS.has(i)).toBe(true));
    m.goodFor.forEach((i) => expect(ISSUE_IDS.has(i)).toBe(true));
  });
});

describe('weekly digests', () => {
  it('has one digest per week, newest first', () => {
    expect(unique(DIGESTS.map((d) => d.week))).toBe(true);
    const order = DIGESTS.map((d) => d.weekOf);
    expect(order).toEqual([...order].sort().reverse());
  });

  it.each(DIGESTS.map((d) => [d.week, d] as const))('digest %s links every item to its source', (_, d) => {
    expect(d.weekOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.items.length).toBeGreaterThan(0);
    expect(unique(d.items.map((i) => i.id))).toBe(true);
    d.items.forEach((item) => {
      expect(item.source.url).toMatch(/^https:\/\//);
      expect(item.source.title && item.source.journal && item.source.authors).toBeTruthy();
      expect(item.source.published).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
      item.issues.forEach((i) => expect(ISSUE_IDS.has(i)).toBe(true));
    });
  });
});
