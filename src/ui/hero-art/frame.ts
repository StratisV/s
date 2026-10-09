// Shared helpers for drawing the hero's art.
import type { CSSProperties } from 'react';
import { ART_H, ART_W, BLEED } from './look';

/** Makes a document-unique id for a gradient or clip path. */
export type Ref = (name: string) => string;

type Pt = readonly [number, number];
export type { Pt };

export const f1 = (v: number) => +v.toFixed(1);
const pct = (v: number, of: number) => `${+((v / of) * 100).toFixed(3)}%`;

/** Places a piece of the art: x, y, width and height in art units (x may run into the bleed). */
export function box(x: number, y: number, w: number, h: number): CSSProperties {
  const W = ART_W + 2 * BLEED;
  return { left: pct(x + BLEED, W), top: pct(y, ART_H), width: pct(w, W), height: pct(h, ART_H) };
}

/** A smooth curve through points (Catmull-Rom as cubic Beziers). */
export function smooth(pts: readonly Pt[], move = true): string {
  let d = `${move ? 'M' : 'L'}${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d;
}
const shift = (pts: readonly Pt[], dy: number): Pt[] => pts.map(([x, y]) => [x, y + dy]);
/** The ground below a crest line. */
export const below = (pts: readonly Pt[]) => `${smooth(pts)}V${ART_H}H${-BLEED}Z`;
/** A band following a crest, from dy a to dy b below it. */
export const band = (pts: readonly Pt[], a: number, b: number) =>
  `${smooth(shift(pts, a))}${smooth(shift(pts, b).reverse(), false)}Z`;

/** The y of a crest line at x (straight between its points: close enough for placing things on it). */
export function crestY(pts: readonly Pt[], x: number): number {
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

/** A tiny seeded random generator (the same scatter every time). */
export function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
