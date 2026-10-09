import { useEffect, useRef, useState } from 'react';
import { donutSegments, type MemberCount } from '../../lib/logic/stats';
import styles from './Donut.module.css';

const SIZE = 220;
const STROKE = 26;
const GAP = 9;
const TWEEN_MS = 560;

interface DonutProps {
  rows: MemberCount[];
  total: number;
  /** Text alternative for the whole chart. */
  label: string;
}

/**
 * Completions per member as a ring (README "Donut"): starts at 12 o'clock,
 * runs clockwise in member order, round caps, 9px visual gaps. With no
 * completions it shows a faint full track and 0.
 */
export function Donut({ rows, total, label }: DonutProps) {
  const shown = useTweenedRows(rows);
  const { radius, segments } = donutSegments(shown, { size: SIZE, stroke: STROKE, gap: GAP });
  const c = SIZE / 2;

  return (
    <div className={styles.chart} role="img" aria-label={label}>
      <svg className={styles.ring} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle
          className={styles.track}
          data-visible={total === 0 || undefined}
          cx={c}
          cy={c}
          r={radius}
          fill="none"
          strokeWidth={STROKE}
        />
        <g className={styles.segments} data-visible={total > 0 || undefined}>
          {segments.map((s) => (
            <circle
              key={s.memberId}
              cx={c}
              cy={c}
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={s.dasharray}
              strokeDashoffset={s.dashoffset}
            />
          ))}
        </g>
      </svg>
      <div className={styles.center} aria-hidden="true">
        <span className={styles.total}>{total}</span>
        <span className={styles.caption}>done</span>
      </div>
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * Rows whose counts glide from the previous values to the new ones, so the
 * arcs grow and shrink when the period changes. To or from an empty chart
 * there is nothing to morph: the ring cross-fades with the track instead
 * (the last non-empty counts stay drawn while they fade out).
 */
function useTweenedRows(rows: MemberCount[]): MemberCount[] {
  const [shown, setShown] = useState(() => new Map(rows.map((r) => [r.member.id, r.count])));
  const shownRef = useRef(shown);
  const key = rows.map((r) => `${r.member.id}:${r.count}`).join(',');

  useEffect(() => {
    const to = new Map(rows.map((r) => [r.member.id, r.count]));
    const from = shownRef.current;
    const sum = (m: Map<string, number>) => [...to.keys()].reduce((n, id) => n + (m.get(id) ?? 0), 0);
    const set = (m: Map<string, number>) => {
      shownRef.current = m;
      setShown(m);
    };
    if (sum(to) === 0) return; // keep the last ring while it fades out
    if (sum(from) === 0 || prefersReducedMotion()) {
      set(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / TWEEN_MS);
      const e = easeOutCubic(t);
      const next = new Map<string, number>();
      for (const [id, v] of to) {
        const a = from.get(id) ?? 0;
        next.set(id, a + (v - a) * e);
      }
      set(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [key]); // `key` changes whenever any member or count does

  return rows.map((r) => ({ member: r.member, count: shown.get(r.member.id) ?? 0 }));
}
