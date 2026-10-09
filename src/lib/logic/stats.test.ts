import { describe, expect, it } from 'vitest';
import type { Completion, Member } from '../types';
import { countCompletions, donutSegments, memberColor, type MemberCount } from './stats';

function member(id: string, color: string): Member {
  return {
    id,
    household_id: 'h1',
    user_id: `u-${id}`,
    name: id,
    email: '',
    emoji: '🦔',
    color,
    role: 'member',
    weekly_email: true,
    push_enabled: false,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

let seq = 0;
function done(credited_to: string | null, completed_at: string): Completion {
  seq += 1;
  return {
    id: `c${seq}`,
    household_id: 'h1',
    item_id: null,
    item_title: 'Task',
    credited_to,
    completed_by: credited_to,
    completed_at,
  };
}

const stratis = member('stratis', '#007AFF');
const shea = member('shea', '#AF52DE');
const ela = member('ela', '#30B0C7');
const members = [stratis, shea, ela];

describe('memberColor', () => {
  it('cycles through the six member colours', () => {
    expect([0, 1, 2, 3, 4, 5].map(memberColor)).toEqual(['#007AFF', '#AF52DE', '#30B0C7', '#FF9500', '#34C759', '#FF2D55']);
    expect(memberColor(6)).toBe('#007AFF');
    expect(memberColor(8)).toBe('#30B0C7');
    expect(memberColor(-1)).toBe('#FF2D55');
  });
});

describe('countCompletions', () => {
  // 00:30 on 1 Nov in London (GMT): October is now last month.
  const now = new Date('2026-11-01T00:30:00Z');
  const completions = [
    done('stratis', '2026-10-31T23:59:00Z'), // 31 Oct, 23:59 GMT
    done('stratis', '2026-11-01T00:10:00Z'), // 1 Nov, 00:10
    done('shea', '2026-11-01T00:20:00Z'),
    done('ela', '2026-09-30T23:30:00Z'), // 1 Oct 00:30 BST
    done('someone-who-left', '2026-11-01T00:15:00Z'),
    done(null, '2026-11-01T00:15:00Z'),
  ];

  it('counts this month in the household zone, in member order', () => {
    const res = countCompletions(members, completions, 'month', 'Europe/London', now);
    expect(res.rows.map((r) => [r.member.id, r.count])).toEqual([
      ['stratis', 1],
      ['shea', 1],
      ['ela', 0],
    ]);
    expect(res.total).toBe(2);
  });

  it('depends on the zone around a month boundary', () => {
    // In Athens (UTC+2) 31 Oct 23:59 UTC is already 1 Nov.
    const athens = countCompletions(members, completions, 'month', 'Europe/Athens', now);
    expect(athens.rows.map((r) => r.count)).toEqual([2, 1, 0]);
    // In Los Angeles it is still 31 Oct at `now`, and Ela's 30 Sep 23:30 UTC is 16:30 on 30 Sep there.
    const la = countCompletions(members, completions, 'month', 'America/Los_Angeles', now);
    expect(la.rows.map((r) => r.count)).toEqual([2, 1, 0]);
    const laSep = countCompletions(members, completions, 'month', 'America/Los_Angeles', new Date('2026-10-01T05:00:00Z'));
    expect(laSep.rows.map((r) => r.count)).toEqual([0, 0, 1]);
  });

  it('counts everything for lifetime, leaving out unknown or empty credits', () => {
    const res = countCompletions(members, completions, 'lifetime', 'Europe/London', now);
    expect(res.rows.map((r) => r.count)).toEqual([2, 1, 1]);
    expect(res.total).toBe(4);
  });

  it('returns zero rows for nobody done', () => {
    const res = countCompletions(members, [], 'month', 'Europe/London', now);
    expect(res.rows.map((r) => r.count)).toEqual([0, 0, 0]);
    expect(res.total).toBe(0);
  });
});

describe('donutSegments', () => {
  const opts = { size: 220, stroke: 26, gap: 9 };
  const rows = (counts: number[]): MemberCount[] => counts.map((count, i) => ({ member: members[i], count }));

  it('matches the README arc maths (prototype 4 / 2 / 1)', () => {
    const { radius, circumference, segments } = donutSegments(rows([4, 2, 1]), opts);
    const r = (220 - 26) / 2;
    const C = 2 * Math.PI * r;
    expect(radius).toBe(97);
    expect(circumference).toBeCloseTo(C, 10);

    // Same formula as the prototype's donut(): len = share·C − gap − stroke, offset −(start·C + (gap+stroke)/2).
    const total = 7;
    let acc = 0;
    const expected = [4, 2, 1].map((n, i) => {
      const len = Math.max(0.01, (n / total) * C - 9 - 26);
      const seg = {
        memberId: members[i].id,
        color: members[i].color,
        dasharray: `${len} ${C - len}`,
        dashoffset: -((acc / total) * C + (9 + 26) / 2),
      };
      acc += n;
      return seg;
    });
    expect(segments).toEqual(expected);
    expect(segments[0].dashoffset).toBe(-17.5);

    // Visible arcs plus caps and gaps add up to the full ring.
    const lens = segments.map((s) => Number(s.dasharray.split(' ')[0]));
    expect(lens.reduce((a, b) => a + b, 0) + 3 * (9 + 26)).toBeCloseTo(C, 6);
    for (const s of segments) {
      const [dash, rest] = s.dasharray.split(' ').map(Number);
      expect(dash + rest).toBeCloseTo(C, 9);
    }
  });

  it('matches the lifetime split too (58 / 37 / 16)', () => {
    const { circumference: C, segments } = donutSegments(rows([58, 37, 16]), opts);
    expect(Number(segments[1].dasharray.split(' ')[0])).toBeCloseTo((37 / 111) * C - 35, 9);
    expect(segments[2].dashoffset).toBeCloseTo(-((95 / 111) * C + 17.5), 9);
  });

  it('skips members with no completions', () => {
    const { circumference: C, segments } = donutSegments(rows([3, 0, 1]), opts);
    expect(segments.map((s) => s.memberId)).toEqual(['stratis', 'ela']);
    expect(segments[1].dashoffset).toBeCloseTo(-((3 / 4) * C + 17.5), 9);
  });

  it('draws a single person as a full ring', () => {
    const { circumference: C, segments } = donutSegments(rows([0, 5, 0]), opts);
    expect(segments).toEqual([{ memberId: 'shea', color: '#AF52DE', dasharray: `${C} 0`, dashoffset: 0 }]);
  });

  it('draws nothing when nobody has done anything', () => {
    const res = donutSegments(rows([0, 0, 0]), opts);
    expect(res.segments).toEqual([]);
    expect(res.radius).toBe(97);
    expect(donutSegments([], opts).segments).toEqual([]);
  });

  it('keeps tiny shares visible as a dot', () => {
    const { segments } = donutSegments(rows([999, 1, 0]), opts);
    expect(segments[1].dasharray.startsWith('0.01 ')).toBe(true);
  });
});
