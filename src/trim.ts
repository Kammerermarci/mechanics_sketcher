// Trimming: removing the stretch of a line, circle or arc that lies between
// two crossings with other curves.

import {
  type Sketch, type Id, type Curve, type Arc, type Constraint, type ConstraintDraft,
  entity, point, points, curves, curvePoints, arcRadius, addPoint, addLine, addArc, remove, dropIfUnused,
} from "./model";
import { type V, add, sub, mul, dot, dist, angleOf, polar, wrap, TWO_PI } from "./geom";

type Shape =
  | { kind: "line"; a: V; b: V }
  | { kind: "round"; c: V; r: number; a0: number; sweep: number; full: boolean };

function shapeOf(sk: Sketch, e: Curve): Shape {
  const xy = (id: Id): V => { const p = point(sk, id); return [p.x, p.y]; };
  if (e.type === "line") return { kind: "line", a: xy(e.p1), b: xy(e.p2) };
  if (e.type === "circle") return { kind: "round", c: xy(e.c), r: e.r, a0: 0, sweep: TWO_PI, full: true };
  const c = xy(e.c);
  const a0 = angleOf(sub(xy(e.p1), c));
  return { kind: "round", c, r: arcRadius(sk, e), a0, sweep: wrap(angleOf(sub(xy(e.p2), c)) - a0) || TWO_PI, full: false };
}

/** True when q, already known to be on the curve's carrier, lies within the curve itself. */
function within(s: Shape, q: V, eps: number): boolean {
  if (s.kind === "line") {
    const d = sub(s.b, s.a);
    const len = Math.hypot(d[0], d[1]);
    const t = dot(sub(q, s.a), d) / (len * len);
    return t > -eps / len && t < 1 + eps / len;
  }
  if (s.full) return true;
  const off = wrap(angleOf(sub(q, s.c)) - s.a0);
  const slack = eps / Math.max(s.r, 1e-12);
  return off < s.sweep + slack || off > TWO_PI - slack;
}

/** The points where two shapes meet. Lines running along each other give none. */
function crossings(s: Shape, t: Shape, eps: number): V[] {
  let found: V[] = [];
  if (s.kind === "line" && t.kind === "line") {
    const d = sub(s.b, s.a), e = sub(t.b, t.a);
    const den = d[0] * e[1] - d[1] * e[0];
    if (Math.abs(den) > 1e-12 * Math.hypot(d[0], d[1]) * Math.hypot(e[0], e[1])) {
      const w = sub(t.a, s.a);
      found = [add(s.a, mul(d, (w[0] * e[1] - w[1] * e[0]) / den))];
    }
  } else if (s.kind === "line" || t.kind === "line") {
    const line = (s.kind === "line" ? s : t) as Extract<Shape, { kind: "line" }>;
    const round = (s.kind === "line" ? t : s) as Extract<Shape, { kind: "round" }>;
    const d = sub(line.b, line.a), f = sub(line.a, round.c);
    const A = dot(d, d), B = 2 * dot(f, d), C = dot(f, f) - round.r * round.r;
    if (A > 1e-18) {
      // How far the line passes from the centre. Within a hair of the radius it touches: a
      // tangent line is only as exact as the solver left it, and must still count as meeting.
      const off = Math.abs(f[0] * d[1] - f[1] * d[0]) / Math.sqrt(A);
      const touch = eps * 10;
      if (off >= round.r - touch && off <= round.r + touch) found = [add(line.a, mul(d, -B / (2 * A)))];
      else if (off < round.r) {
        const root = Math.sqrt(Math.max(0, B * B - 4 * A * C));
        found = [(-B - root) / (2 * A), (-B + root) / (2 * A)].map((u) => add(line.a, mul(d, u)));
      }
    }
  } else {
    const gap = dist(s.c, t.c);
    if (gap > 1e-12 && gap <= s.r + t.r + eps && gap >= Math.abs(s.r - t.r) - eps) {
      const along = (s.r * s.r - t.r * t.r + gap * gap) / (2 * gap);
      const h = Math.sqrt(Math.max(0, s.r * s.r - along * along));
      const u = mul(sub(t.c, s.c), 1 / gap);
      const base = add(s.c, mul(u, along));
      found = h < eps ? [base] : [add(base, [-u[1] * h, u[0] * h]), add(base, [u[1] * h, -u[0] * h])];
    }
  }
  return found.filter((q) => within(s, q, eps) && within(t, q, eps));
}

/** The points where two curves meet, in model units. Lines running along each other give none. */
export function intersections(sk: Sketch, e1: Curve, e2: Curve, eps: number): V[] {
  return crossings(shapeOf(sk, e1), shapeOf(sk, e2), eps);
}

/** A place where the curve being trimmed is crossed. */
interface Cut {
  /** Position along the curve: 0..1 on a line, the angle swept from its start on a circle or arc. */
  t: number;
  pos: V;
  /** The curve that crosses there. */
  by: Id;
}

export interface TrimPlan {
  curve: Id;
  /** The stretch that will go, for showing before the click. */
  gone: { kind: "line"; a: V; b: V } | { kind: "round"; c: V; r: number; a0: number; a1: number };
  /** The crossings that bound it; null at an open end of the curve. */
  lo: Cut | null;
  hi: Cut | null;
  /** True when nothing crosses the curve, so all of it goes. */
  whole: boolean;
}

function scaleOf(sk: Sketch): number {
  let size = 0;
  for (const p of points(sk)) size = Math.max(size, Math.abs(p.x), Math.abs(p.y));
  return Math.max(1e-9, size * 1e-7);
}

/**
 * The curves a stroke of the pointer from a to b passes over, nearest to a
 * first, with the place it crosses each.
 */
export function strokeHits(sk: Sketch, a: V, b: V): { id: Id; at: V }[] {
  if (dist(a, b) < 1e-12) return [];
  const eps = scaleOf(sk);
  const stroke: Shape = { kind: "line", a, b };
  const out: { id: Id; at: V }[] = [];
  for (const e of curves(sk)) {
    for (const q of crossings(stroke, shapeOf(sk, e), eps)) out.push({ id: e.id, at: q });
  }
  return out.sort((x, y) => dist(a, x.at) - dist(a, y.at));
}

/** Works out what a click on `curveId` near `at` would trim away. */
export function planTrim(sk: Sketch, curveId: Id, at: V): TrimPlan | null {
  const target = entity(sk, curveId);
  if (!target || target.type === "point" || target.type === "spline") return null;
  const eps = scaleOf(sk);
  const s = shapeOf(sk, target);
  const length = s.kind === "line" ? dist(s.a, s.b) : s.r * s.sweep;
  if (length < eps) return null;
  const end = s.kind === "line" ? 1 : s.sweep;
  const param = (q: V): number => {
    if (s.kind === "line") { const d = sub(s.b, s.a); return dot(sub(q, s.a), d) / dot(d, d); }
    return wrap(angleOf(sub(q, s.c)) - s.a0);
  };
  const margin = (eps * 10) / (s.kind === "line" ? length : Math.max(s.r, 1e-12));

  const cuts: Cut[] = [];
  for (const other of curves(sk)) {
    if (other.id === target.id) continue;
    for (const q of intersections(sk, target, other, eps)) {
      const t = param(q);
      const inside = s.kind === "round" && s.full ? true : t > margin && t < end - margin;
      if (inside && !cuts.some((c) => Math.abs(c.t - t) < margin)) cuts.push({ t, pos: q, by: other.id });
    }
  }
  cuts.sort((x, y) => x.t - y.t);

  let tc = param(at);
  // Beside an arc but past one of its ends, the click belongs to the end it is nearer to:
  // just before the start is not the far end, though the angle there has come all the way round.
  if (s.kind === "round" && !s.full && tc > end) tc = tc - end < TWO_PI - tc ? end : 0;
  tc = Math.max(0, Math.min(end, tc));
  const posAt = (t: number): V => (s.kind === "line" ? add(s.a, mul(sub(s.b, s.a), t)) : polar(s.c, s.r, s.a0 + t));

  if (s.kind === "round" && s.full) {
    // A circle has no ends: it takes two crossings to leave an arc.
    if (cuts.length < 2) return { curve: curveId, gone: { kind: "round", c: s.c, r: s.r, a0: 0, a1: TWO_PI }, lo: null, hi: null, whole: true };
    const hi = cuts.find((c) => c.t > tc) ?? cuts[0];
    const lo = [...cuts].reverse().find((c) => c.t < tc) ?? cuts[cuts.length - 1];
    return { curve: curveId, gone: { kind: "round", c: s.c, r: s.r, a0: lo.t, a1: lo.t + (wrap(hi.t - lo.t) || TWO_PI) }, lo, hi, whole: false };
  }
  const lo = [...cuts].reverse().find((c) => c.t < tc) ?? null;
  const hi = cuts.find((c) => c.t > tc) ?? null;
  const from = lo ? lo.t : 0, to = hi ? hi.t : end;
  const gone: TrimPlan["gone"] = s.kind === "line"
    ? { kind: "line", a: posAt(from), b: posAt(to) }
    : { kind: "round", c: s.c, r: s.r, a0: s.a0 + from, a1: s.a0 + to };
  return { curve: curveId, gone, lo, hi, whole: !lo && !hi };
}

/**
 * Carries out a trim. Returns constraints worth trying afterwards: each new
 * end is put on the curve that cut it, so the two stay together.
 */
export function applyTrim(sk: Sketch, plan: TrimPlan): ConstraintDraft[] {
  const target = entity(sk, plan.curve);
  if (!target || target.type === "point" || target.type === "spline") return [];
  if (plan.whole) {
    remove(sk, [target.id]);
    return [];
  }
  const eps = scaleOf(sk);
  const autos: ConstraintDraft[] = [], collinear: ConstraintDraft[] = [];
  // The point a new end lands on: one that is already there, or a new one tied to the cutting curve.
  const endAt = (cut: Cut): Id => {
    const there = points(sk).find((p) => Math.hypot(p.x - cut.pos[0], p.y - cut.pos[1]) < eps * 10);
    if (there) return there.id;
    const p = addPoint(sk, cut.pos[0], cut.pos[1]);
    autos.push({ type: "pointOn", p: p.id, on: cut.by });
    return p.id;
  };
  const flags = (from: Curve, to: Curve) => {
    if (from.construction) to.construction = true;
    if (from.centre) to.centre = true;
    if (from.weight !== undefined) to.weight = from.weight;
    if (from.dashed) to.dashed = true;
    if (from.color !== undefined) to.color = from.color;
  };
  // Horizontal and vertical are kept between a line's ends, so they follow the ends.
  const retarget = (oldA: Id, oldB: Id, newA: Id, newB: Id) => {
    for (const c of sk.constraints) {
      if ((c.type === "horizontal" || c.type === "vertical") && ((c.a === oldA && c.b === oldB) || (c.a === oldB && c.b === oldA))) {
        c.a = newA;
        c.b = newB;
      }
    }
  };
  const levelOf = (a: Id, b: Id) =>
    sk.constraints.find((c) => (c.type === "horizontal" || c.type === "vertical") && ((c.a === a && c.b === b) || (c.a === b && c.b === a)))?.type as "horizontal" | "vertical" | undefined;

  if (target.type === "line") {
    // What was said about the line's length or its middle is no longer true of what is left
    // of it, and would pull the sketch about. Equal length goes; a point at the middle stays on the line.
    sk.constraints = sk.constraints.flatMap((c): Constraint[] => {
      if (c.type === "equal" && (c.a === target.id || c.b === target.id)) return [];
      if (c.type === "midpoint" && c.l === target.id) return [{ id: c.id, type: "pointOn", p: c.p, on: target.id }];
      return [c];
    });
  }
  // A fill bounded by the curve has lost its outline.
  if (target.type !== "circle") sk.symbols = sk.symbols.filter((s) => !(s.type === "fill" && s.curves.includes(target.id)));

  if (target.type === "line") {
    const { p1, p2 } = target;
    const level = levelOf(p1, p2);
    if (plan.lo && plan.hi) {
      const q0 = endAt(plan.lo), q1 = endAt(plan.hi);
      target.p2 = q0;
      retarget(p1, p2, p1, q0);
      const rest = addLine(sk, q1, p2);
      flags(target, rest);
      if (level) autos.push({ type: level, a: q1, b: p2 });
      // The two pieces were one line, and stay in line with each other.
      else collinear.push({ type: "pointOn", p: q1, on: target.id }, { type: "pointOn", p: p2, on: target.id });
    } else if (plan.hi) {
      const q = endAt(plan.hi);
      target.p1 = q;
      retarget(p1, p2, q, p2);
      dropIfUnused(sk, p1);
    } else if (plan.lo) {
      const q = endAt(plan.lo);
      target.p2 = q;
      retarget(p1, p2, p1, q);
      dropIfUnused(sk, p2);
    }
  } else if (target.type === "circle") {
    // What is left runs counter-clockwise from the far crossing round to the near one.
    const start = endAt(plan.hi!), finish = endAt(plan.lo!);
    const arc: Arc = { id: target.id, type: "arc", c: target.c, p1: start, p2: finish };
    flags(target, arc);
    // The arc takes the circle's place and its name, so dimensions and constraints on it carry over.
    sk.entities[sk.entities.indexOf(target)] = arc;
    sk.symbols = sk.symbols.filter((s) => !(s.type === "fill" && s.circle === target.id));
    for (const s of sk.symbols) if (s.type === "fill") s.holes = s.holes.filter((h) => h !== target.id);
  } else {
    const { p1, p2 } = target;
    if (plan.lo && plan.hi) {
      const q0 = endAt(plan.lo), q1 = endAt(plan.hi);
      target.p2 = q0;
      const rest = addArc(sk, target.c, q1, p2);
      flags(target, rest);
      // The two pieces were one arc, and keep one radius.
      collinear.push({ type: "equal", a: target.id, b: rest.id });
    } else if (plan.hi) {
      target.p1 = endAt(plan.hi);
      dropIfUnused(sk, p1);
    } else if (plan.lo) {
      target.p2 = endAt(plan.lo);
      dropIfUnused(sk, p2);
    }
  }

  // A point that was held on the curve and is now one of its ends needs no such constraint.
  sk.constraints = sk.constraints.filter((c) => {
    if (c.type !== "pointOn" && c.type !== "midpoint") return true;
    const on = entity(sk, c.type === "pointOn" ? c.on : c.l);
    return !on || on.type === "point" || !curvePoints(on).includes(c.p);
  });
  // The same for the constraints about to be tried. Those that keep the pieces together come last:
  // where a piece is already held some other way, they are the ones to do without.
  return [...autos, ...collinear].filter((a) => {
    if (a.type !== "pointOn") return true;
    const on = entity(sk, a.on);
    return !!on && on.type !== "point" && !curvePoints(on).includes(a.p);
  });
}

