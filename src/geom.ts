// Small 2D vector helpers.

export type V = [number, number];

export const TWO_PI = Math.PI * 2;

export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
export const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: V, b: V): number => a[0] * b[1] - a[1] * b[0];
export const len = (a: V): number => Math.hypot(a[0], a[1]);
export const dist = (a: V, b: V): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const perp = (a: V): V => [-a[1], a[0]];
export const mid = (a: V, b: V): V => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const polar = (c: V, r: number, ang: number): V => [c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)];
export const angleOf = (a: V): number => Math.atan2(a[1], a[0]);

export function norm(a: V): V {
  const l = len(a);
  return l < 1e-12 ? [1, 0] : [a[0] / l, a[1] / l];
}

/** Wraps an angle into [0, 2π). */
export function wrap(a: number): number {
  const r = a % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/** True when `ang` lies on the counter-clockwise sweep from a0 to a1. */
export function inSweep(ang: number, a0: number, a1: number): boolean {
  return wrap(ang - a0) <= wrap(a1 - a0) + 1e-9;
}

/** Closest point on segment ab to p, and its parameter along the segment. */
export function projectOnSegment(p: V, a: V, b: V): { point: V; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return { point: add(a, mul(ab, t)), t };
}

export function distToSegment(p: V, a: V, b: V): number {
  return dist(p, projectOnSegment(p, a, b).point);
}

/** Intersection of the infinite lines through a with direction d, and b with direction e. */
export function intersectLines(a: V, d: V, b: V, e: V): V | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(b, a), e) / den;
  return add(a, mul(d, t));
}

export interface Box { x0: number; y0: number; x1: number; y1: number }

export function emptyBox(): Box {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}
export function grow(b: Box, p: V, r = 0): void {
  b.x0 = Math.min(b.x0, p[0] - r);
  b.y0 = Math.min(b.y0, p[1] - r);
  b.x1 = Math.max(b.x1, p[0] + r);
  b.y1 = Math.max(b.y1, p[1] + r);
}
export const boxIsEmpty = (b: Box): boolean => b.x1 < b.x0;
