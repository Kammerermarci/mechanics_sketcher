// CAD drawing helpers. The results are ordinary sketch lines, arcs and constraints.
import { type V, add, sub, mul, dot, cross, norm, perp, dist, angleOf, wrap } from "./geom";
import { type Sketch, type Id, type ConstraintDraft, addPoint, addLine, addArc } from "./model";

export type RectangleMode = "rectangle" | "rectcenter" | "rect3";

/** Four corners in perimeter order; third point sets signed width from the first edge. */
export function rectangleCorners(mode: RectangleMode, a: V, b: V, third?: V): [V, V, V, V] | null {
  if (mode === "rect3") {
    if (!third || dist(a, b) < 1e-12) return null;
    const normal = perp(norm(sub(b, a))), width = dot(sub(third, a), normal);
    if (Math.abs(width) < 1e-12) return null;
    const offset = mul(normal, width);
    return [a, b, add(b, offset), add(a, offset)];
  }
  const start = mode === "rectcenter" ? sub(mul(a, 2), b) : a;
  if (Math.abs(start[0] - b[0]) < 1e-12 || Math.abs(start[1] - b[1]) < 1e-12) return null;
  return [start, [b[0], start[1]], b, [start[0], b[1]]];
}

export function rectangleParts(sk: Sketch, corners: [V, V, V, V], mode: RectangleMode,
  existing: Partial<Record<number, Id>> = {}, center?: Id, construction = false): { made: Id[]; autos: ConstraintDraft[] } {
  const ids = corners.map((v, i) => existing[i] ?? addPoint(sk, v[0], v[1]).id);
  const lines = ids.map((id, i) => addLine(sk, id, ids[(i + 1) % 4]));
  if (construction) lines.forEach((line) => { line.construction = true; });
  const autos: ConstraintDraft[] = mode === "rect3"
    ? [{ type: "parallel", l1: lines[0].id, l2: lines[2].id },
      { type: "parallel", l1: lines[1].id, l2: lines[3].id },
      { type: "perpendicular", l1: lines[0].id, l2: lines[1].id }]
    : ids.map((id, i) => ({ type: i % 2 === 0 ? "horizontal" : "vertical", a: id, b: ids[(i + 1) % 4] }));
  if (center) {
    const diagonal = addLine(sk, ids[0], ids[2]);
    diagonal.construction = true;
    autos.push({ type: "midpoint", p: center, l: diagonal.id });
  }
  return { made: lines.map((l) => l.id), autos };
}

/** The counter-clockwise arc from a to b (or b to a) that passes through the third point. */
export function arcThrough(a: V, b: V, through: V): { c: V; r: number; a0: number; a1: number; reverse: boolean } | null {
  const u = sub(b, a), v = sub(through, a), determinant = cross(u, v);
  const size = Math.max(dot(u, u), dot(v, v), dist(b, through) ** 2);
  if (size < 1e-24 || Math.abs(determinant) <= size * 1e-9) return null;
  const u2 = dot(u, u), v2 = dot(v, v);
  const c = add(a, [(u2 * v[1] - v2 * u[1]) / (2 * determinant), (u[0] * v2 - v[0] * u2) / (2 * determinant)]);
  const start = angleOf(sub(a, c)), end = angleOf(sub(b, c)), middle = angleOf(sub(through, c));
  const reverse = wrap(middle - start) > wrap(end - start);
  const a0 = reverse ? end : start;
  return { c, r: dist(a, c), a0, a1: a0 + wrap((reverse ? start : end) - a0), reverse };
}

export function threePointArc(sk: Sketch, a: Id, b: Id, through: Id, shape: NonNullable<ReturnType<typeof arcThrough>>, construction = false) {
  const center = addPoint(sk, shape.c[0], shape.c[1]);
  const arc = addArc(sk, center.id, shape.reverse ? b : a, shape.reverse ? a : b);
  if (construction) arc.construction = true;
  return { arc, autos: [{ type: "pointOn", p: through, on: arc.id }] as ConstraintDraft[] };
}
