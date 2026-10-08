import { MEMBER_COLORS } from '../constants';
import type { Completion, Member, StatsPeriod } from '../types';
import { monthKey } from './dates';

export function memberColor(index: number): string {
  return MEMBER_COLORS[((index % MEMBER_COLORS.length) + MEMBER_COLORS.length) % MEMBER_COLORS.length];
}

export interface MemberCount {
  member: Member;
  count: number;
}

/**
 * Completions per member, in member order. "month" is the current calendar
 * month in the household's time zone. Completions credited to someone who
 * is no longer a member are left out (so the total matches the legend).
 */
export function countCompletions(
  members: Member[],
  completions: Completion[],
  period: StatsPeriod,
  timeZone: string,
  now: Date = new Date(),
): { rows: MemberCount[]; total: number } {
  const current = monthKey(now, timeZone);
  const counts = new Map<string, number>();
  for (const c of completions) {
    if (!c.credited_to) continue;
    if (period === 'month' && monthKey(c.completed_at, timeZone) !== current) continue;
    counts.set(c.credited_to, (counts.get(c.credited_to) ?? 0) + 1);
  }
  const rows = members.map((member) => ({ member, count: counts.get(member.id) ?? 0 }));
  return { rows, total: rows.reduce((n, r) => n + r.count, 0) };
}

export interface DonutSegment {
  memberId: string;
  color: string;
  /** stroke-dasharray value. */
  dasharray: string;
  /** stroke-dashoffset value. */
  dashoffset: number;
}

/**
 * Donut arcs (README "Arc maths"): C = 2πr; each segment's dash is
 * share·C − gap − stroke and its offset −(start·C + (gap+stroke)/2), with the
 * SVG rotated −90° so it starts at 12 o'clock and runs clockwise. Members
 * with no completions get no segment; a single segment is a full ring.
 */
export function donutSegments(
  rows: MemberCount[],
  opts: { size: number; stroke: number; gap: number },
): { radius: number; circumference: number; segments: DonutSegment[] } {
  const radius = (opts.size - opts.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = rows.reduce((n, r) => n + r.count, 0);
  const visible = rows.filter((r) => r.count > 0);
  if (total === 0) return { radius, circumference, segments: [] };
  if (visible.length === 1) {
    const r = visible[0];
    return {
      radius,
      circumference,
      segments: [{ memberId: r.member.id, color: r.member.color, dasharray: `${circumference} 0`, dashoffset: 0 }],
    };
  }
  let acc = 0;
  const segments: DonutSegment[] = [];
  for (const r of visible) {
    const len = Math.max(0.01, (r.count / total) * circumference - opts.gap - opts.stroke);
    segments.push({
      memberId: r.member.id,
      color: r.member.color,
      dasharray: `${len} ${circumference - len}`,
      dashoffset: -((acc / total) * circumference + (opts.gap + opts.stroke) / 2),
    });
    acc += r.count;
  }
  return { radius, circumference, segments };
}
