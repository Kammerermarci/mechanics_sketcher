import { type V, type Box, emptyBox, grow, add, mul, distToSegment } from "./geom";

export type Cubic = [V, V, V, V];
const lerp = (a: V, b: V, t: number): V => add(mul(a, 1 - t), mul(b, t));
export function splitCubic(c: Cubic, t = 0.5): [Cubic, Cubic] {
  const a = lerp(c[0], c[1], t), b = lerp(c[1], c[2], t), d = lerp(c[2], c[3], t);
  const e = lerp(a, b, t), f = lerp(b, d, t), p = lerp(e, f, t);
  return [[c[0], a, e, p], [p, f, d, c[3]]];
}
export function cubicAt(c: Cubic, t: number): V { return splitCubic(c, t)[0][3]; }
/** Exact bounds from the derivative roots, rather than the control polygon. */
export function cubicBounds(c: Cubic): Box {
  const box = emptyBox(); grow(box, c[0]); grow(box, c[3]);
  for (const axis of [0, 1] as const) {
    const [p, q, r, s] = c.map((v) => v[axis]);
    const a = -p + 3*q - 3*r + s, b = 2*(p - 2*q + r), d = q - p;
    const roots: number[] = [];
    if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) roots.push(-d / b); }
    else { const disc = b*b - 4*a*d; if (disc >= 0) roots.push((-b + Math.sqrt(disc))/(2*a), (-b - Math.sqrt(disc))/(2*a)); }
    for (const t of roots) if (t > 0 && t < 1) grow(box, cubicAt(c, t));
  }
  return box;
}
/** Adaptive approximation used only for picking, never for drawing or export. */
export function flattenCubic(c: Cubic, tolerance = 0.01, depth = 0): V[] {
  if (depth >= 16 || Math.max(distToSegment(c[1], c[0], c[3]), distToSegment(c[2], c[0], c[3])) <= tolerance) return [c[0], c[3]];
  const [a, b] = splitCubic(c);
  return [...flattenCubic(a, tolerance, depth + 1).slice(0, -1), ...flattenCubic(b, tolerance, depth + 1)];
}
export function cubicPath(segments: Cubic[], map: (p: V) => V = (p) => p): string {
  const pt = (v: V) => map(v).map((n) => Number(n.toFixed(5))).join(" ");
  return segments.map((c, i) => `${i ? "" : `M${pt(c[0])}`}C${pt(c[1])} ${pt(c[2])} ${pt(c[3])}`).join("");
}
