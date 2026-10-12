// What a plot is worked out from before anything is drawn: its formulas read
// into trees, and its functions sampled into runs of points. The Plot
// workspace draws these over a pair of axes; a diagram in the sketch lays the
// same points along a member.

import { type Plot, type PlotCurve, type PlotPiece } from "./model";
import { type Expr, ExprError, parseExpr, evaluate, degree } from "./expr";
import { type V } from "./geom";

/** Sizes of what a plot is drawn with, in mm on paper, and the colours of its grid. */
export const PLOT = {
  tickCross: 1.6,     // a tick drawn across an axis
  tickBox: 1.2,       // a tick drawn outside a box
  gridWidth: 0.07,    // 0.2 pt grid lines
  gridInk: "#cccccc",
  dotRadius: 0.2,
  dotInk: "#8c8c8c",
  weight: 0.8,        // a curve's thickness in points, unless it has its own
  shade: 0.16,        // how much of a curve's colour is in the shading under it
  tickGap: 12,        // about this far between ticks
  labelRise: 3.2,     // a curve's name sits this far above the curve
  minSize: 15,
  maxSize: 400,
};
/** Dash patterns of a curve, as on and off lengths in mm. Dots are dashes of no length with round ends. */
export const PLOT_DASH: Record<NonNullable<PlotCurve["dash"]>, number[]> = { dashed: [2, 1.2], dotted: [0.01, 1.1] };
export const PLOT_COLORS = ["#d32f2f", "#1565c0", "#2e7d32", "#ef6c00", "#6a1b9a", "#17201b"];

// ---- reading the formulas -------------------------------------------------------

const parsed = new Map<string, Expr | string>();

/** A typed formula as a tree, or what is wrong with it. Each formula is read once. */
export function readFormula(src: string): Expr | string {
  let got = parsed.get(src);
  if (got === undefined) {
    try {
      got = parseExpr(src);
    } catch (err) {
      got = err instanceof ExprError ? err.message : "This cannot be read as a function.";
    }
    if (parsed.size > 2000) parsed.clear();
    parsed.set(src, got);
  }
  return got;
}

/** What is wrong with a formula as it stands, or null. An empty one is not an error: it is not typed yet. */
export function formulaError(src: string): string | null {
  if (!src.trim()) return null;
  const got = readFormula(src);
  return typeof got === "string" ? got : null;
}

/** What a parameter runs over when nothing else is said: once round a circle. */
export const PARAM_RANGE: [number, number] = [0, 2 * Math.PI];

/**
 * What is wrong with a piece as it stands, or null when it can be drawn. With
 * `param`, the piece is of a curve given by a parameter: both its formulas
 * are read, and the parameter has to run forwards.
 */
export function pieceError(piece: PlotPiece, param = false): string | null {
  if (param) {
    const wrong = formulaError(piece.x ?? "") ?? formulaError(piece.expr);
    if (wrong) return wrong;
    if ((piece.to ?? PARAM_RANGE[1]) <= (piece.from ?? PARAM_RANGE[0])) return "The parameter ends before it starts.";
    return null;
  }
  const wrong = formulaError(piece.expr);
  if (wrong) return wrong;
  if (piece.from !== undefined && piece.to !== undefined && piece.to <= piece.from) return "The piece ends before it starts.";
  return null;
}

// ---- sampling ---------------------------------------------------------------------

export interface Stretch {
  expr: Expr;
  /** Where it runs, cut down to the range of the plot. */
  from: number;
  to: number;
  /** How many points it is drawn through; pgfplots is told the same number. */
  samples: number;
}

/**
 * The pieces of a function that can be drawn, each cut down to what the plot
 * shows of it. A curve given by a parameter has none: see paramStretches.
 * With `band`, a straight piece is also cut where it leaves the heights that
 * runs() keeps at that margin: it is drawn through its two ends only, and an
 * end beyond them would leave out all of it.
 */
export function stretches(plot: Plot, curve: PlotCurve, band?: number): Stretch[] {
  const out: Stretch[] = [];
  if (curve.param) return out;
  const span = plot.x.max - plot.x.min;
  for (const piece of curve.pieces) {
    if (pieceError(piece) !== null || !piece.expr.trim()) continue;
    const expr = readFormula(piece.expr) as Expr;
    let from = Math.max(piece.from ?? -Infinity, plot.x.min), to = Math.min(piece.to ?? Infinity, plot.x.max);
    if (!(to - from > span * 1e-9)) continue;
    const straight = degree(expr) <= 1;
    if (straight && band !== undefined) {
      const [lo, hi] = restrictY(plot, band), inset = (hi - lo) * 1e-9;
      const y0 = evaluate(expr, from), y1 = evaluate(expr, to);
      if (Number.isFinite(y0) && Number.isFinite(y1) && y0 !== y1) {
        const k = (y1 - y0) / (to - from);
        const xa = from + (lo + inset - y0) / k, xb = from + (hi - inset - y0) / k;
        from = Math.max(from, Math.min(xa, xb));
        to = Math.min(to, Math.max(xa, xb));
        if (!(to - from > span * 1e-9)) continue;
      }
    }
    // A straight line needs its two ends only; a curve gets a point about every half millimetre.
    const samples = straight ? 2 : Math.max(13, Math.min(401, Math.ceil(((to - from) / span) * plot.width * 2) + 1));
    out.push({ expr, from, to, samples });
  }
  return out;
}

/**
 * The points a stretch is drawn through, in runs. A point where the function
 * has no value, or one more than the height of the plot outside it, ends a
 * run: that is how the two sides of an asymptote stay apart. pgfplots is
 * given the same rule (restrict y to domain, unbounded coords=jump).
 */
export function runs(plot: Plot, s: Stretch, margin = 1): V[][] {
  const [lo, hi] = restrictY(plot, margin);
  const out: V[][] = [];
  let run: V[] = [];
  for (let i = 0; i < s.samples; i++) {
    const x = s.from + ((s.to - s.from) * i) / (s.samples - 1);
    const y = evaluate(s.expr, x);
    if (Number.isFinite(y) && y >= lo && y <= hi) run.push([x, y]);
    else {
      if (run.length > 1) out.push(run);
      run = [];
    }
  }
  if (run.length > 1) out.push(run);
  return out;
}

/** Values outside this are left out of a curve: more than `margin` heights of the plot beyond its range. */
export function restrictY(plot: Plot, margin = 1): [number, number] {
  const span = (plot.y.max - plot.y.min) * margin;
  return [plot.y.min - span, plot.y.max + span];
}
/** The same sideways, for a curve given by a parameter, which can leave the plot on any side. */
export function restrictX(plot: Plot, margin = 1): [number, number] {
  const span = (plot.x.max - plot.x.min) * margin;
  return [plot.x.min - span, plot.x.max + span];
}

// ---- curves given by a parameter ----------------------------------------------------

/** One stretch of a curve given by a parameter: x(t) and y(t) from t = from to t = to. */
export interface ParamStretch {
  x: Expr;
  y: Expr;
  from: number;
  to: number;
  /** How many values of the parameter it is drawn through; pgfplots is told the same number. */
  samples: number;
}

/** The fewest and the most points a curve given by a parameter is drawn through. */
const PARAM_SAMPLES: [number, number] = [97, 1201];

/** The pieces of a curve given by a parameter that can be drawn. */
export function paramStretches(plot: Plot, curve: PlotCurve): ParamStretch[] {
  const out: ParamStretch[] = [];
  if (!curve.param) return out;
  const sx = plot.width / (plot.x.max - plot.x.min), sy = plot.height / (plot.y.max - plot.y.min);
  const [xlo, xhi] = restrictX(plot), [ylo, yhi] = restrictY(plot);
  for (const piece of curve.pieces) {
    if (pieceError(piece, true) !== null || !piece.expr.trim() || !(piece.x ?? "").trim()) continue;
    const x = readFormula(piece.x!) as Expr, y = readFormula(piece.expr) as Expr;
    const from = piece.from ?? PARAM_RANGE[0], to = piece.to ?? PARAM_RANGE[1];
    let samples = 2;
    if (degree(x) > 1 || degree(y) > 1) {
      // A point about every half millimetre along it: how long it is on paper is found from a first, coarser walk.
      let length = 0, last: V | null = null;
      for (let i = 0; i <= 480; i++) {
        const t = from + ((to - from) * i) / 480;
        const X = evaluate(x, t), Y = evaluate(y, t);
        if (!(X >= xlo && X <= xhi && Y >= ylo && Y <= yhi)) { last = null; continue; }
        if (last) length += Math.hypot((X - last[0]) * sx, (Y - last[1]) * sy);
        last = [X, Y];
      }
      samples = Math.max(PARAM_SAMPLES[0], Math.min(PARAM_SAMPLES[1], Math.ceil(length * 2) + 1));
    }
    out.push({ x, y, from, to, samples });
  }
  return out;
}

/**
 * The points a curve given by a parameter is drawn through, in runs. A value
 * of the parameter where either formula has no value, or where the curve is
 * more than the size of the plot outside it, ends a run.
 */
export function paramRuns(plot: Plot, s: ParamStretch, margin = 1): V[][] {
  const [xlo, xhi] = restrictX(plot, margin), [ylo, yhi] = restrictY(plot, margin);
  const out: V[][] = [];
  let run: V[] = [];
  for (let i = 0; i < s.samples; i++) {
    const t = s.from + ((s.to - s.from) * i) / (s.samples - 1);
    const X = evaluate(s.x, t), Y = evaluate(s.y, t);
    if (X >= xlo && X <= xhi && Y >= ylo && Y <= yhi) run.push([X, Y]);
    else {
      if (run.length > 1) out.push(run);
      run = [];
    }
  }
  if (run.length > 1) out.push(run);
  return out;
}

/** Whether a curve has anything that can be drawn, of either kind. */
export function drawable(plot: Plot, curve: PlotCurve): boolean {
  return curve.param ? paramStretches(plot, curve).length > 0 : stretches(plot, curve).length > 0;
}

/**
 * The upright lines of a curve: across the jump between two pieces that meet.
 * A curve ends at the value it has there; only with `ends` set is it also
 * closed down to zero at its two ends, as the outline of a diagram may be.
 */
export function uprights(plot: Plot, curve: PlotCurve, margin = 1, ends = false): [V, V][] {
  const list = stretches(plot, curve);
  const span = plot.x.max - plot.x.min, tall = (plot.y.max - plot.y.min) * 1e-9;
  const [lo, hi] = restrictY(plot, margin);
  const ok = (y: number) => Number.isFinite(y) && y >= lo && y <= hi;
  const out: [V, V][] = [];
  const add = (x: number, a: number, b: number) => { if (ok(a) && ok(b) && Math.abs(a - b) > tall) out.push([[x, a], [x, b]]); };
  list.forEach((s, i) => {
    const before = list[i - 1], after = list[i + 1];
    const meets = (other: Stretch | undefined, at: number, edge: number) => !!other && Math.abs(edge - at) < span * 1e-9;
    if (curve.join !== false && meets(after, s.to, after?.from)) add(s.to, evaluate(s.expr, s.to), evaluate(after.expr, after.from));
    if (ends) {
      if (!meets(before, s.from, before?.to)) add(s.from, 0, evaluate(s.expr, s.from));
      if (!meets(after, s.to, after?.from)) add(s.to, evaluate(s.expr, s.to), 0);
    }
  });
  // From left to right, whatever order they were found in.
  return out.sort((a, b) => a[0][0] - b[0][0]);
}
