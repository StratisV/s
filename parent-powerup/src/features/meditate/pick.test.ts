import { MEDITATIONS } from '../../data/meditations';
import { inRange } from '../../lib/age';
import { addDays } from '../../lib/dates';
import type { Challenge, Kid, Meditation, Powerup, SessionLog } from '../../types';
import {
  ageGap,
  doneToday,
  hashOf,
  listNames,
  minutesOf,
  moreToTry,
  pickPowerup,
  pickToday,
  reasonFor,
  rotation,
  streak,
  totalSeconds,
  youngestAge,
  type PickInput,
} from './pick';

const TODAY = '2026-11-15';

let ids = 0;
function kid(birth: string, over: Partial<Kid> = {}): Kid {
  ids += 1;
  return {
    id: `kid-${ids}`,
    name: `Kid ${ids}`,
    birth,
    avatar: '🦊',
    colour: 'sun',
    temperament: [],
    interests: [],
    focus: [],
    notes: '',
    ...over,
  };
}

// Ages on 15 November 2026 (born mid-month, so these are just over the whole year).
const BABY = '2025-08'; // 1
const THREE = '2023-08'; // 3
const SEVEN = '2019-08'; // 7
const TEN = '2016-08'; // 10
const FOURTEEN = '2012-08'; // 14
const NINETEEN = '2007-08'; // 19

function input(over: Partial<PickInput> = {}): PickInput {
  return { mode: 'together', kids: [], parentFocus: [], today: TODAY, sessions: [], meditations: MEDITATIONS, ...over };
}

/** Today's pick on each of `n` days from `from`, with nothing done in between. */
function picksOver(base: PickInput, n: number, from = TODAY): Meditation[] {
  return Array.from({ length: n }, (_, i) => pickToday({ ...base, today: addDays(from, i) })!);
}

function counts(list: Meditation[]): Map<string, number> {
  const map = new Map<string, number>();
  list.forEach((m) => map.set(m.id, (map.get(m.id) ?? 0) + 1));
  return map;
}

const byId = (id: string) => MEDITATIONS.find((m) => m.id === id)!;

describe('lengths', () => {
  it('adds up the steps', () => {
    const m = { steps: [{ text: 'One step', seconds: 50 }, { text: 'Two step', seconds: 70 }] };
    expect(totalSeconds(m)).toBe(120);
    expect(minutesOf(m)).toBe(2);
  });

  it('never says less than a minute', () => {
    expect(minutesOf({ steps: [{ text: 'Quick one', seconds: 20 }] })).toBe(1);
  });
});

describe('ageGap', () => {
  it('is 0 inside the range and grows outside it', () => {
    expect(ageGap(4, { from: 3, to: 6 })).toBe(0);
    expect(ageGap(1, { from: 3, to: 6 })).toBe(2);
    expect(ageGap(6, { from: 3, to: 6 })).toBeGreaterThan(0);
    expect(ageGap(9, { from: 3, to: 6 })).toBeGreaterThan(ageGap(7, { from: 3, to: 6 }));
  });
});

describe('pickToday: together', () => {
  it('fits the kid’s age', () => {
    for (const birth of [THREE, SEVEN, TEN, FOURTEEN]) {
      const k = kid(birth);
      const age = youngestAge([k], TODAY)!;
      for (const m of picksOver(input({ kids: [k] }), 30)) {
        expect(m.mode).toBe('together');
        expect(inRange(age, m.ages!)).toBe(true);
      }
    }
  });

  it('lets the youngest kid’s age decide', () => {
    const kids = [kid(TEN), kid(THREE)];
    for (const m of picksOver(input({ kids }), 30)) expect(inRange(3.25, m.ages!)).toBe(true);
  });

  it('prefers ones that suit every kid joining', () => {
    const suitTen = (kids: Kid[]) => picksOver(input({ kids }), 60).filter((m) => inRange(10.25, m.ages!)).length;
    expect(suitTen([kid(SEVEN), kid(TEN)])).toBeGreaterThan(suitTen([kid(SEVEN)]));
  });

  it('is the same all day, whatever is done today', () => {
    const k = kid(SEVEN, { interests: ['space'] });
    const first = pickToday(input({ kids: [k] }))!;
    const sessions: SessionLog[] = [{ date: TODAY, meditationId: first.id, mode: 'together', kidIds: [k.id] }];
    expect(pickToday(input({ kids: [k] }))!.id).toBe(first.id);
    expect(pickToday(input({ kids: [k], sessions }))!.id).toBe(first.id);
  });

  it('never repeats yesterday’s pick', () => {
    const configs: Kid[][] = [
      [],
      [kid(BABY)],
      [kid(THREE, { interests: ['animals'] })],
      [kid(SEVEN, { interests: ['space'], focus: ['sleep'] })],
      [kid(TEN)],
      [kid(FOURTEEN, { interests: ['music'] })],
      [kid(THREE), kid(TEN, { interests: ['dinosaurs'] })],
      [kid(NINETEEN)],
    ];
    for (const kids of configs) {
      const picks = picksOver(input({ kids }), 120, '2026-09-01');
      for (let i = 1; i < picks.length; i++) expect(picks[i].id).not.toBe(picks[i - 1].id);
    }
  });

  it('steers clear of one you did yesterday', () => {
    const k = kid(SEVEN);
    const plain = pickToday(input({ kids: [k] }))!;
    const sessions: SessionLog[] = [{ date: addDays(TODAY, -1), meditationId: plain.id, mode: 'together', kidIds: [k.id] }];
    const today = pickToday(input({ kids: [k], sessions }))!;
    expect(today.id).not.toBe(plain.id);
    expect(inRange(youngestAge([k], TODAY)!, today.ages!)).toBe(true);
  });

  it('leans towards the kid’s interests', () => {
    const fan = kid(SEVEN, { interests: ['space'] });
    const picks = picksOver(input({ kids: [fan] }), 66);
    const tally = counts(picks);
    const rocket = tally.get('rocket-to-the-stars') ?? 0;
    const others = [...tally.entries()].filter(([id]) => id !== 'rocket-to-the-stars').map(([, n]) => n);
    expect(rocket).toBeGreaterThanOrEqual(1.5 * Math.max(...others));
    // ...but still gets plenty of variety.
    expect(tally.size).toBeGreaterThanOrEqual(6);
  });

  it('leans towards what you would like help with', () => {
    for (const birth of [THREE, SEVEN, TEN, FOURTEEN]) {
      const sleepy = (kids: Kid[]) => picksOver(input({ kids }), 60).filter((m) => m.goodFor.includes('sleep')).length;
      expect(sleepy([kid(birth, { focus: ['sleep'] })])).toBeGreaterThan(sleepy([kid(birth)]));
    }
  });

  it('offers a broad one when there are no kids yet', () => {
    for (const m of picksOver(input(), 30)) {
      expect(m.mode).toBe('together');
      expect(m.ages!.from).toBeLessThanOrEqual(5);
      expect(m.ages!.to).toBeGreaterThanOrEqual(8);
    }
  });

  it('picks the nearest ages for a baby, and for a kid past 18', () => {
    for (const m of picksOver(input({ kids: [kid(BABY)] }), 20)) expect(m.ages!.from).toBe(2);
    for (const m of picksOver(input({ kids: [kid(NINETEEN)] }), 20)) expect(m.ages!.to).toBe(18);
  });

  it('copes with nothing to pick', () => {
    expect(pickToday(input({ meditations: [] }))).toBeUndefined();
    expect(moreToTry(input({ meditations: [] }), undefined)).toEqual([]);
  });

  it('copes with just one meditation', () => {
    const only = MEDITATIONS.filter((m) => m.id === 'rainbow-breathing');
    expect(pickToday(input({ meditations: only }))!.id).toBe('rainbow-breathing');
  });
});

describe('pickToday: just me', () => {
  it('picks a solo meditation, and goes through them all', () => {
    const picks = picksOver(input({ mode: 'solo', kids: [kid(SEVEN)] }), 8);
    picks.forEach((m) => expect(m.mode).toBe('solo'));
    expect(new Set(picks.map((m) => m.id)).size).toBe(MEDITATIONS.filter((m) => m.mode === 'solo').length);
  });

  it('leans on what the parent would like for themselves', () => {
    const picks = picksOver(input({ mode: 'solo', parentFocus: ['sleep'] }), 40);
    const tally = counts(picks);
    const sleep = tally.get('body-scan-for-sleep') ?? 0;
    expect(sleep).toBeGreaterThanOrEqual(1.5 * Math.max(...[...tally.entries()].filter(([id]) => id !== 'body-scan-for-sleep').map(([, n]) => n)));
  });

  it('never repeats yesterday’s pick', () => {
    for (const parentFocus of [[], ['sleep'], ['feelings', 'connection']] as PickInput['parentFocus'][]) {
      const picks = picksOver(input({ mode: 'solo', parentFocus }), 90);
      for (let i = 1; i < picks.length; i++) expect(picks[i].id).not.toBe(picks[i - 1].id);
    }
  });
});

describe('rotation', () => {
  it('never puts the same one twice in a row, even round the end of the lap', () => {
    const configs: PickInput[] = [
      input({ kids: [kid(SEVEN, { interests: ['space'] })] }),
      input({ kids: [kid(THREE, { interests: ['animals'], focus: ['sleep'] })] }),
      input({ kids: [kid(FOURTEEN, { interests: ['ocean'] })] }),
      input({ mode: 'solo', parentFocus: ['anxiety'] }),
      input({ mode: 'solo', parentFocus: ['sleep'] }),
      input(),
    ];
    for (const config of configs) {
      const lap = rotation(config, TODAY);
      expect(lap.length).toBeGreaterThan(1);
      lap.forEach((m, i) => expect(m.id).not.toBe(lap[(i + 1) % lap.length].id));
    }
  });
});

describe('moreToTry', () => {
  it('lists others in the same mode that fit the youngest kid’s age, best first, without today’s', () => {
    const k = kid(SEVEN, { interests: ['dinosaurs'] });
    const base = input({ kids: [k] });
    const featured = pickToday(base)!;
    const more = moreToTry(base, featured);
    expect(more.length).toBeGreaterThanOrEqual(3);
    expect(more.map((m) => m.id)).not.toContain(featured.id);
    more.forEach((m) => {
      expect(m.mode).toBe('together');
      expect(inRange(youngestAge([k], TODAY)!, m.ages!)).toBe(true);
    });
    if (featured.id !== 'dinosaur-stomp') expect(more[0].id).toBe('dinosaur-stomp');
  });

  it('fills in with the nearest ages when few fit', () => {
    const more = moreToTry(input({ kids: [kid(BABY)] }), undefined);
    expect(more.length).toBeGreaterThanOrEqual(3);
    more.forEach((m) => expect(m.ages!.from).toBeLessThanOrEqual(3));
  });

  it('lists the other solo ones for just me', () => {
    const base = input({ mode: 'solo' });
    const featured = pickToday(base)!;
    const more = moreToTry(base, featured);
    expect(more).toHaveLength(MEDITATIONS.filter((m) => m.mode === 'solo').length - 1);
    more.forEach((m) => expect(m.mode).toBe('solo'));
  });
});

describe('streak', () => {
  const day = (offset: number): SessionLog => ({
    date: addDays(TODAY, offset),
    meditationId: 'x',
    mode: 'solo',
    kidIds: [],
  });

  it('is 0 with nothing done', () => {
    expect(streak([], TODAY)).toBe(0);
  });

  it('counts days in a row up to today', () => {
    expect(streak([day(-2), day(-1), day(0)], TODAY)).toBe(3);
  });

  it('is still current when the last one was yesterday', () => {
    expect(streak([day(-3), day(-2), day(-1)], TODAY)).toBe(3);
  });

  it('starts again after a missed day, without counting what came before', () => {
    expect(streak([day(-5), day(-4), day(-2)], TODAY)).toBe(0);
    expect(streak([day(-5), day(-4), day(-1), day(0)], TODAY)).toBe(2);
  });

  it('counts a day once, however many sessions it had', () => {
    expect(streak([day(0), day(0), day(0), day(-1)], TODAY)).toBe(2);
  });

  it('runs across months and years', () => {
    const sessions = ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'].map((date) => ({ ...day(0), date }));
    expect(streak(sessions, '2027-01-02')).toBe(4);
  });

  it('ignores sessions in the future', () => {
    expect(streak([day(1), day(0)], TODAY)).toBe(1);
  });
});

describe('doneToday', () => {
  const sessions: SessionLog[] = [{ date: TODAY, meditationId: 'a', mode: 'solo', kidIds: [] }];
  it('knows what was done today', () => {
    expect(doneToday(sessions, TODAY)).toBe(true);
    expect(doneToday(sessions, TODAY, 'a')).toBe(true);
    expect(doneToday(sessions, TODAY, 'b')).toBe(false);
    expect(doneToday(sessions, addDays(TODAY, 1))).toBe(false);
  });
});

describe('pickPowerup', () => {
  const challenge = (id: string, issues: Challenge['issues']): Challenge => ({
    id,
    title: id,
    emoji: '⭐',
    issues,
    ages: { from: 0, to: 18 },
    peak: { from: 0, to: 18 },
    summary: 'A challenge for the tests.',
    normal: 'Normal.',
    seekHelp: [],
  });
  const powerup = (id: string, from: number, to: number, challengeIds: string[]): Powerup => ({
    id,
    title: id,
    tagline: 'A tip',
    challengeIds,
    ages: { from, to },
    when: 'daily-habit',
    time: '5 minutes',
    steps: ['One', 'Two', 'Three'],
    why: 'Because.',
    approach: 'Emotion coaching',
    sources: [],
  });
  const challenges = [challenge('sleepy', ['sleep']), challenge('cross', ['feelings'])];
  const powerups = [
    powerup('toddler-sleep', 1, 4, ['sleepy']),
    powerup('toddler-feelings', 1, 4, ['cross']),
    powerup('school-sleep', 5, 12, ['sleepy']),
    powerup('school-feelings', 5, 12, ['cross']),
    powerup('teen-feelings', 12, 18, ['cross']),
  ];
  const at = (today: string, kids: Kid[], list = powerups) => pickPowerup({ powerups: list, challenges, kids, today });

  it('is nothing without Powerups', () => {
    expect(at(TODAY, [], [])).toBeUndefined();
    expect(at(TODAY, [kid(SEVEN)], [])).toBeUndefined();
  });

  it('copes with just one', () => {
    const only = [powerups[0]];
    expect(at(TODAY, [], only)!.powerup.id).toBe('toddler-sleep');
    expect(at(TODAY, [kid(FOURTEEN)], only)!.powerup.id).toBe('toddler-sleep');
  });

  it('fits the kid’s age, and their focus when it can', () => {
    const k = kid(THREE, { focus: ['sleep'] });
    for (let i = 0; i < 10; i++) {
      const pick = at(addDays(TODAY, i), [k])!;
      expect(pick.kid?.id).toBe(k.id);
      expect(pick.powerup.id).toBe('toddler-sleep');
    }
    const ages = new Set(Array.from({ length: 10 }, (_, i) => at(addDays(TODAY, i), [kid(SEVEN)])!.powerup.id));
    expect([...ages].every((id) => id.startsWith('school'))).toBe(true);
    expect(ages.size).toBe(2);
  });

  it('takes turns between kids', () => {
    const a = kid(THREE);
    const b = kid(FOURTEEN);
    const kidsPicked = new Set(Array.from({ length: 6 }, (_, i) => at(addDays(TODAY, i), [a, b])!.kid?.id));
    expect(kidsPicked).toEqual(new Set([a.id, b.id]));
  });

  it('picks any one without kids, the same all day, and not yesterday’s', () => {
    expect(at(TODAY, [])!.powerup.id).toBe(at(TODAY, [])!.powerup.id);
    for (let i = 1; i < 30; i++) {
      expect(at(addDays(TODAY, i), [])!.powerup.id).not.toBe(at(addDays(TODAY, i - 1), [])!.powerup.id);
    }
  });

  it('falls back to any when no Powerup fits the kids’ ages', () => {
    expect(at(TODAY, [kid(NINETEEN)])!.powerup).toBeDefined();
  });
});

describe('reasons', () => {
  it('names the kid whose interest it fits', () => {
    const leo = kid(SEVEN, { name: 'Leo', interests: ['space'] });
    expect(reasonFor(byId('rocket-to-the-stars'), input({ kids: [leo] }))).toBe('For Leo, who loves space');
  });

  it('names everyone who shares it', () => {
    const mia = kid(SEVEN, { name: 'Mia', interests: ['animals'] });
    const sam = kid(THREE, { name: 'Sam', interests: ['animals'] });
    expect(reasonFor(byId('humming-bee'), input({ kids: [mia, sam] }))).toBe('For Sam and Mia, who love animals');
  });

  it('says what it is good for, from a focus', () => {
    const k = kid(SEVEN, { focus: ['anxiety'] });
    expect(reasonFor(byId('starfish-hand'), input({ kids: [k] }))).toBe('Good for worries and fears');
    expect(reasonFor(byId('body-scan-for-sleep'), input({ mode: 'solo', parentFocus: ['sleep'] }))).toBe('Good for sleep');
  });

  it('says nothing without a reason', () => {
    expect(reasonFor(byId('rainbow-breathing'), input({ kids: [kid(SEVEN)] }))).toBeUndefined();
    expect(reasonFor(byId('rainbow-breathing'), input())).toBeUndefined();
  });

  it('lists names in plain English', () => {
    expect(listNames([])).toBe('');
    expect(listNames(['Mia'])).toBe('Mia');
    expect(listNames(['Mia', 'Leo'])).toBe('Mia and Leo');
    expect(listNames(['Mia', 'Leo', 'Sam'])).toBe('Mia, Leo and Sam');
  });
});

describe('hashOf', () => {
  it('is steady', () => {
    expect(hashOf('rocket')).toBe(hashOf('rocket'));
    expect(hashOf('rocket')).not.toBe(hashOf('rockets'));
  });
});
