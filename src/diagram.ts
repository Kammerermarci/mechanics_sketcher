// Diagrams: a plot laid along a member of the sketch, the way an internal
// force diagram is drawn. This is the geometry of it, in model units: what
// the diagram runs along, and where the points of the plot's functions land.

import { type Sketch, type Diagram, type Plot, type PlotCurve, type Id, entity, point, curves, arcAngles, arcRadius } from "./model";
import { type V, add, sub, mul, norm, perp, dist, polar, angleOf, TWO_PI } from "./geom";
import { type Stretch, stretches, runs, uprights } from "./plotmath";
import { type Expr, evaluate } from "./expr";

/**
 * How far out of the plot's own vertical range a value may be and still be
 * drawn, in heights of the plot. A diagram is not cut off at the edge of the
 * plot as the plot itself is, but a function running off to infinity has to
 * stop somewhere.
 */
const REACH = 20;

/** What a diagram runs along: a straight stretch, or part of a circle. */
export interface Baseline {
  kind: "line" | "arc";
  /** The point a share t of the way along it, 0 at its start and 1 at its end. */
  at(t: number): V;
  /** The unit vector pointing to its left there, seen along it: towards the centre, on an arc. */
  left(t: number): V;
  /** How far along it the point nearest to q is, from 0 to 1. */
  nearest(q: V): number;
  length: number;
  /** The angle an arc turns through; 0 for a line. */
  sweep: number;
}

const xy = (sk: Sketch, id: Id): V => { const p = point(sk, id); return [p.x, p.y]; };

/** The plot a diagram draws, if it is still there. */
export function plotOf(sk: Sketch, d: Pick<Diagram, "plot">): Plot | null {
  return sk.plots?.find((p) => p.id === d.plot) ?? null;
}

/**
 * The middle line of the beam a curve is a side of, when it is one: the
 * centres of the beam's two ends, and of its bend for a curved beam. A beam
 * is told by its shape, since it is ordinary geometry: two sides of the same
 * kind, closed at each end by a half-circle about a centre, or by a line with
 * a point at its middle.
 */
export function beamAxis(sk: Sketch, on: Id): NonNullable<Diagram["axis"]> | null {
  const side = entity(sk, on);
  if (!side || (side.type !== "line" && side.type !== "arc")) return null;
  /** What closes the beam at a corner of this side: the centre that end is built on, and the corner across from this one. */
  const endAt = (corner: Id): { centre: Id; far: Id } | null => {
    for (const c of curves(sk)) {
      if (c.id === side.id || c.type === "circle" || (c.p1 !== corner && c.p2 !== corner)) continue;
      const far = c.p1 === corner ? c.p2 : c.p1;
      if (c.type === "arc") {
        // A round end is an arc about its own centre, not about the centre of the bend.
        if (side.type === "arc" && c.c === side.c) continue;
        return { centre: c.c, far };
      }
      const middle = sk.constraints.find((k) => k.type === "midpoint" && k.l === c.id);
      if (middle?.type === "midpoint") return { centre: middle.p, far };
    }
    return null;
  };
  const start = endAt(side.p1), end = endAt(side.p2);
  if (!start || !end || start.centre === end.centre) return null;
  // The other side: the same kind of curve between the two far corners, about the same centre if it is an arc.
  const other = curves(sk).some((c) => c.id !== side.id && c.type === side.type &&
    ((c.p1 === start.far && c.p2 === end.far) || (c.p1 === end.far && c.p2 === start.far)) &&
    (c.type !== "arc" || side.type !== "arc" || c.c === side.c));
  if (!other) return null;
  if (side.type === "arc") return { a: start.centre, b: end.centre, o: side.c };
  // Either side of a straight beam gives the same line: it runs from the left end, or the lower one of two above each other.
  const A = xy(sk, start.centre), B = xy(sk, end.centre);
  const forward = A[0] < B[0] - 1e-9 || (Math.abs(A[0] - B[0]) <= 1e-9 && A[1] <= B[1]);
  return forward ? { a: start.centre, b: end.centre } : { a: end.centre, b: start.centre };
}

function lineBase(a: V, b: V): Baseline | null {
  const length = dist(a, b);
  if (length < 1e-9) return null;
  const n = perp(norm(sub(b, a)));
  const d = sub(b, a);
  const nearest = (q: V) => Math.max(0, Math.min(1, ((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]) / (length * length)));
  return { kind: "line", at: (t) => add(a, mul(d, t)), left: () => n, nearest, length, sweep: 0 };
}

function arcBase(c: V, r: number, a0: number, a1: number): Baseline | null {
  const sweep = a1 - a0;
  if (r < 1e-9 || sweep < 1e-9) return null;
  const ang = (t: number) => a0 + sweep * t;
  const nearest = (q: V) => {
    // Measured round from the start of the arc; beyond its end, whichever end is closer.
    let turn = (angleOf(sub(q, c)) - a0) % TWO_PI;
    if (turn < 0) turn += TWO_PI;
    return turn <= sweep ? turn / sweep : turn - sweep < TWO_PI - turn ? 1 : 0;
  };
  return { kind: "arc", at: (t) => polar(c, r, ang(t)), left: (t) => [-Math.cos(ang(t)), -Math.sin(ang(t))], nearest, length: r * sweep, sweep };
}

/** What a diagram runs along: the middle of its beam, or else the line or arc it is on. Null when that has no length. */
export function baseline(sk: Sketch, d: Pick<Diagram, "on" | "axis">): Baseline | null {
  if (d.axis) {
    const a = xy(sk, d.axis.a), b = xy(sk, d.axis.b);
    if (!d.axis.o) return lineBase(a, b);
    const o = xy(sk, d.axis.o);
    const a0 = angleOf(sub(a, o));
    let a1 = angleOf(sub(b, o));
    if (a1 <= a0) a1 += TWO_PI;
    return arcBase(o, (dist(o, a) + dist(o, b)) / 2, a0, a1);
  }
  const e = entity(sk, d.on);
  if (e?.type === "line") return lineBase(xy(sk, e.p1), xy(sk, e.p2));
  if (e?.type === "arc") {
    const { a0, a1 } = arcAngles(sk, e);
    return arcBase(xy(sk, e.c), arcRadius(sk, e), a0, a1);
  }
  return null;
}

/**
 * Where a function turns between a and b: its highest point there when it
 * rises and then falls, its lowest when `top` is false. The stretch is
 * narrowed by thirds until it is as fine as numbers go.
 */
function turningPoint(expr: Expr, a: number, b: number, top: boolean): number {
  const f = (x: number) => (top ? 1 : -1) * evaluate(expr, x);
  for (let i = 0; i < 80 && b - a > 1e-13 * Math.max(1, Math.abs(a), Math.abs(b)); i++) {
    const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
    if (f(m1) < f(m2)) a = m1;
    else b = m2;
  }
  const x = (a + b) / 2;
  // Where a curve is flat the search can only close in to about eight digits. Tidied to seven, a peak
  // at 2.5 comes out as 2.5 and not as 2.50000001, and the value read off there is the exact one.
  return Number(x.toPrecision(7));
}

/** One function of the plot as it lies along the member. */
export interface DiagramPart {
  curve: PlotCurve;
  /** The curve itself, in runs of points. */
  lines: V[][];
  /** The straight lines square to the member: across a jump, and down to the member at the ends. */
  uprights: [V, V][];
  /** The outlines of the areas between the member and the curve, for shading. */
  areas: V[][];
  /** The strokes from the member to the curve. */
  strokes: [V, V][];
  /** The values worth writing down: where each is, and which way is away from the member there. */
  values: { v: number; at: V; out: V }[];
}

export interface DiagramShape {
  plot: Plot;
  base: Baseline;
  parts: DiagramPart[];
  /** The two ends of the stretch of the member it covers. */
  ends: [V, V];
  /** The largest value there is, by size: how far along the member it is, and where it is drawn. Null for a diagram with nothing in it. */
  peak: { t: number; v: number; at: V } | null;
}

/** The largest value, by size, that the functions of a plot take over its range. 0 when it has none. */
export function plotPeak(plot: Plot): number {
  let peak = 0;
  for (const c of plot.curves) for (const s of stretches(plot, c)) for (const run of runs(plot, s, REACH)) for (const [, y] of run) peak = Math.max(peak, Math.abs(y));
  return peak;
}

/**
 * The diagram as it lies in the sketch, in model units; null when its plot
 * or its member is gone, or has no length. The plot's horizontal range is
 * stretched over the part of the member the diagram covers.
 */
export function diagramShape(sk: Sketch, d: Diagram): DiagramShape | null {
  const plot = plotOf(sk, d), base = baseline(sk, d);
  if (!plot || !base) return null;
  const x0 = plot.x.min, span = plot.x.max - plot.x.min;
  /** How far along the member a value of the plot's horizontal axis is. */
  const along = (x: number) => {
    const u = (x - x0) / span;
    return d.t0 + (d.t1 - d.t0) * (d.back ? 1 - u : u);
  };
  const place = (x: number, v: number): V => {
    const t = along(x);
    return add(base.at(t), mul(base.left(t), d.side * v * d.scale));
  };
  let peak: DiagramShape["peak"] = null;
  const see = (x: number, v: number) => { if (!peak || Math.abs(v) > Math.abs(peak.v)) peak = { t: along(x), v, at: place(x, v) }; };
  const tiny = (v: number, of: number) => Math.abs(v) <= Math.abs(of) * 1e-9;

  /** For each function, the places whose values are worth writing down: the ends of its pieces and its turning points. */
  const notes: [number, number][][] = [];
  const parts = plot.curves.map((curve): DiagramPart => {
    const part: DiagramPart = { curve, lines: [], uprights: [], areas: [], strokes: [], values: [] };
    const list = stretches(plot, curve);
    const noted: [number, number][] = [];
    notes.push(noted);
    const note = (x: number, v: number) => {
      if (!Number.isFinite(v) || noted.some(([nx, nv]) => Math.abs(nx - x) < span * 1e-6 && Math.abs(nv - v) < 1e-9 * Math.max(1, Math.abs(v)))) return;
      noted.push([x, v]);
    };
    for (const s of list) {
      // Along an arc even a straight function is a curve, so it gets a point every two degrees at the least.
      const share = ((s.to - s.from) / span) * Math.abs(d.t1 - d.t0);
      const dense: Stretch = base.kind === "arc" ? { ...s, samples: Math.max(s.samples, Math.ceil((base.sweep * share) / (Math.PI / 90)) + 1) } : s;
      for (const run of runs(plot, dense, REACH)) {
        part.lines.push(run.map(([x, y]) => place(x, y)));
        const first = run[0][0], last = run[run.length - 1][0];
        // Out along the curve and back along the member: on an arc that way back is curved too.
        const back = base.kind === "arc" ? [...run].reverse().map(([x]) => base.at(along(x))) : [base.at(along(last)), base.at(along(first))];
        part.areas.push([...run.map(([x, y]) => place(x, y)), ...back]);
        for (const [x, y] of run) see(x, y);
        // The turning points: where the curve stops rising and falls, or the other way round. Each is
        // looked for in the function itself, between the drawn points it lies among, so that the value
        // written is the function's own and not that of the nearest drawn point.
        let rising = 0, since = 0;
        for (let i = 1; i < run.length; i++) {
          const slope = Math.sign(run[i][1] - run[i - 1][1]);
          if (!slope) continue;
          if (rising && slope !== rising) {
            const x = turningPoint(s.expr, run[since - 1][0], run[i][0], rising > 0);
            const v = evaluate(s.expr, x);
            note(x, v);
            see(x, v);
          }
          rising = slope;
          since = i;
        }
      }
      note(s.from, evaluate(s.expr, s.from));
      note(s.to, evaluate(s.expr, s.to));
    }
    // Whether jumps are drawn is the curve's own choice; whether its ends are closed down to the member, the diagram's.
    for (const [a, b] of uprights(plot, curve, REACH, !!d.closed)) part.uprights.push([place(a[0], a[1]), place(b[0], b[1])]);
    return part;
  });

  const top = peak as DiagramShape["peak"];
  parts.forEach((part, k) => {
    const list = stretches(plot, part.curve);
    const valueAt = (x: number): number | null => {
      const s = list.find((k) => x >= k.from - span * 1e-9 && x <= k.to + span * 1e-9);
      const v = s ? evaluate(s.expr, x) : NaN;
      return Number.isFinite(v) ? v : null;
    };
    if (d.strokes) {
      // Evenly spaced along the covered stretch, between its ends.
      for (let i = 1; i <= d.strokes; i++) {
        const u = i / (d.strokes + 1);
        const x = x0 + span * u;
        const v = valueAt(x);
        if (v !== null && top && !tiny(v, top.v) && Math.abs(v) <= Math.abs(top.v)) part.strokes.push([base.at(along(x)), place(x, v)]);
      }
    }
    if (d.values && top) {
      for (const [x, v] of notes[k]) {
        if (tiny(v, top.v)) continue;
        const t = along(x);
        part.values.push({ v, at: place(x, v), out: mul(base.left(t), d.side * Math.sign(v)) });
      }
    }
  });
  return { plot, base, parts, ends: [base.at(d.t0), base.at(d.t1)], peak: top };
}
