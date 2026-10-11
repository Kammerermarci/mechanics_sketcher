// Plots of functions. A plot is laid out on paper in millimetres, with the
// lower left corner of its axis box at the origin, and broken down into the
// same primitives as a sketch: the screen and the SVG draw from that list.
// The TikZ is written for pgfplots instead, with everything about the layout
// pinned down in it, so that it comes out as the screen shows it while the
// formulas stay formulas in the LaTeX.

import { type Sketch, type Plot, type PlotAxis, type PlotCurve, type Id, newId } from "./model";
import { type Prim, type TextPrim, PAPER, PT_MM, labelTex, tint } from "./prims";
import { type Expr, evaluate, toPgf, pgfNumber } from "./expr";
import { type V } from "./geom";
import { texEngine } from "./tex";
import { latexAccents } from "./accents";
import { num, tikzColor, primsToSvg } from "./export";
import { type Stretch, PLOT, PLOT_DASH, PLOT_COLORS, readFormula, pieceError, stretches, runs, restrictY, uprights } from "./plotmath";

export { PLOT, PLOT_DASH, PLOT_COLORS, readFormula, pieceError, stretches, runs, uprights };

// ---- layout ---------------------------------------------------------------------

/** Where a point of the plot's own coordinates is on paper. */
export function toPaper(plot: Plot, [x, y]: V): V {
  return [((x - plot.x.min) / (plot.x.max - plot.x.min)) * plot.width, ((y - plot.y.min) / (plot.y.max - plot.y.min)) * plot.height];
}
/** And the other way round. */
export function toData(plot: Plot, [X, Y]: V): V {
  return [plot.x.min + (X / plot.width) * (plot.x.max - plot.x.min), plot.y.min + (Y / plot.height) * (plot.y.max - plot.y.min)];
}

/** A round step, 1, 2 or 5 times a power of ten, that puts ticks about PLOT.tickGap apart. */
export function niceStep(span: number, lengthMm: number): number {
  const raw = (span * PLOT.tickGap) / Math.max(lengthMm, 1);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return (m <= 1.5 ? 1 : m <= 3.5 ? 2 : m <= 7.5 ? 5 : 10) * pow;
}

/** The step between the ticks of an axis: its own, or a round one that suits its length on paper. */
export function tickStep(a: PlotAxis, lengthMm: number): number {
  const span = a.max - a.min;
  // A step so fine that the ticks would run together is passed over.
  return a.step !== undefined && a.step > 0 && span / a.step <= 80 ? a.step : niceStep(span, lengthMm);
}

/** The values an axis has ticks at: every multiple of its step in its range. */
export function tickValues(a: PlotAxis, lengthMm: number): number[] {
  const step = tickStep(a, lengthMm);
  const eps = (a.max - a.min) * 1e-9;
  const out: number[] = [];
  for (let k = Math.ceil((a.min - eps) / step); k * step <= a.max + eps; k++) out.push(Number((k * step).toPrecision(12)));
  return out;
}

/** A tick's number, with as many decimals as the step between ticks has. */
export function tickText(v: number, step: number): string {
  let d = 0;
  while (d < 8 && Math.abs(Math.round(step * 10 ** d) / 10 ** d - step) > step * 1e-9) d++;
  return String(Number(v.toFixed(d)));
}

/** Where the two axes of a plot drawn with arrows run, in the plot's coordinates: through the origin, or along the nearest edge when it is out of range. */
export function axisCross(plot: Plot): V {
  const clamp = (a: PlotAxis) => Math.max(a.min, Math.min(a.max, 0));
  return [clamp(plot.x), clamp(plot.y)];
}

// ---- cutting to the plot -----------------------------------------------------------

/** Cuts a run of points down to the range of the plot. What is left may be several runs. */
function clipRun(plot: Plot, run: V[]): V[][] {
  const { min: x0, max: x1 } = plot.x, { min: y0, max: y1 } = plot.y;
  const out: V[][] = [];
  let cur: V[] = [];
  const end = () => { if (cur.length > 1) out.push(cur); cur = []; };
  for (let i = 1; i < run.length; i++) {
    // Liang-Barsky: the part of the segment from a to b that lies inside the box.
    const a = run[i - 1], b = run[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    let t0 = 0, t1 = 1, inside = true;
    for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]]) {
      if (p === 0) { if (q < 0) inside = false; }
      else if (p < 0) t0 = Math.max(t0, q / p);
      else t1 = Math.min(t1, q / p);
    }
    if (!inside || t0 > t1) { end(); continue; }
    const from: V = [a[0] + dx * t0, a[1] + dy * t0], to: V = [a[0] + dx * t1, a[1] + dy * t1];
    if (!cur.length) cur.push(from);
    else if (t0 > 0) { end(); cur.push(from); }
    cur.push(to);
    if (t1 < 1) end();
  }
  end();
  return out;
}

/** Cuts a closed outline down to the range of the plot (Sutherland-Hodgman, edge by edge). */
function clipArea(plot: Plot, pts: V[]): V[] {
  const edges: [0 | 1, number, 1 | -1][] = [[0, plot.x.min, 1], [0, plot.x.max, -1], [1, plot.y.min, 1], [1, plot.y.max, -1]];
  let out = pts;
  for (const [axis, at, sign] of edges) {
    const inside = (p: V) => (p[axis] - at) * sign >= 0;
    const next: V[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length];
      const cut = (): V => { const t = (at - a[axis]) / (b[axis] - a[axis]); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
      if (inside(a)) {
        next.push(a);
        if (!inside(b)) next.push(cut());
      } else if (inside(b)) next.push(cut());
    }
    out = next;
    if (!out.length) break;
  }
  return out;
}

/** Where the name of a curve sits, in the plot's coordinates: where it was put, or else above the curve, two thirds of the way along what shows of it. */
export function curveLabelAt(plot: Plot, curve: PlotCurve): V | null {
  if (curve.lx !== undefined && curve.ly !== undefined) return [curve.lx, curve.ly];
  const shown = stretches(plot, curve).flatMap((s) => runs(plot, s)).flatMap((r) => clipRun(plot, r)).flat();
  if (!shown.length) return null;
  const x0 = shown[0][0], x1 = shown[shown.length - 1][0];
  const want = x0 + (x1 - x0) * 0.66;
  // The point of the curve there: on the stretch between the two drawn points either side of it.
  let at = shown[0];
  for (let i = 1; i < shown.length; i++) {
    const a = shown[i - 1], b = shown[i];
    if (a[0] <= want && want <= b[0] && b[0] > a[0]) {
      const t = (want - a[0]) / (b[0] - a[0]);
      at = [want, a[1] + (b[1] - a[1]) * t];
      break;
    }
  }
  const rise = (PLOT.labelRise / plot.height) * (plot.y.max - plot.y.min);
  // Above the curve, unless that would be out of the plot.
  return [at[0], at[1] + rise > plot.y.max ? at[1] - rise : at[1] + rise];
}

// ---- primitives ---------------------------------------------------------------------

interface Layout {
  xs: number[];
  ys: number[];
  /** Where the axes run on paper, for a plot with arrowed axes. */
  X0: number;
  Y0: number;
  xNumbers: { v: number; tex: string }[];
  yNumbers: { v: number; tex: string }[];
  tick: number;
  /** How far the axis names of a boxed plot sit from the box: below it, and to its left. */
  below: number;
  left: number;
}

/**
 * Whether a tick value of an axis gets its mark and its number. Around a box
 * all of them do. On arrowed axes two are left out: the one where the other
 * axis crosses, and the one at the far end, where the arrowhead is.
 */
function marked(plot: Plot, axis: "x" | "y", v: number): boolean {
  if (plot.frame === "box") return true;
  const a = plot[axis], eps = (a.max - a.min) * 1e-9;
  return Math.abs(v - axisCross(plot)[axis === "x" ? 0 : 1]) > eps && Math.abs(v - a.max) > eps;
}

function layout(plot: Plot): Layout {
  const box = plot.frame === "box";
  const xs = tickValues(plot.x, plot.width), ys = tickValues(plot.y, plot.height);
  const [cx, cy] = axisCross(plot);
  const [X0, Y0] = toPaper(plot, [cx, cy]);
  const xStep = tickStep(plot.x, plot.width), yStep = tickStep(plot.y, plot.height);
  const numbered = plot.ticks === undefined;
  // Where the other axis crosses, a number would sit on that axis: it is left out.
  const xNumbers = !numbered ? [] : xs.filter((v) => marked(plot, "x", v)).map((v) => ({ v, tex: tickText(v, xStep) }));
  const yNumbers = !numbered ? [] : ys.filter((v) => marked(plot, "y", v)).map((v) => ({ v, tex: tickText(v, yStep) }));
  const tick = plot.ticks === "none" ? 0 : box ? PLOT.tickBox : PLOT.tickCross;
  const engine = texEngine();
  const tall = Math.max(0, ...xNumbers.map((n) => { const m = engine.measure(n.tex); return (m.asc + m.desc) * PAPER.em; }));
  const wide = Math.max(0, ...yNumbers.map((n) => engine.measure(n.tex).w * PAPER.em));
  return {
    xs, ys, X0, Y0, xNumbers, yNumbers, tick,
    below: tick + (xNumbers.length ? tall + 2 * PAPER.textSep : 0),
    left: tick + (yNumbers.length ? wide + 2 * PAPER.textSep : 0),
  };
}

/**
 * The plot as primitives, in mm on paper, with the lower left corner of its
 * axis box at (0, 0). What belongs to a curve carries the curve's id; the
 * names of the axes are parts "xlabel" and "ylabel" of the plot itself.
 */
export function plotPrims(plot: Plot): Prim[] {
  const { width: W, height: H } = plot;
  const box = plot.frame === "box";
  const L = layout(plot);
  const P = (q: V) => toPaper(plot, q);
  const dim = { layer: "dim" as const, ref: plot.id };
  const out: Prim[] = [];

  // Shading first: everything else is drawn over it.
  for (const c of plot.curves) {
    if (!c.fill) continue;
    for (const s of stretches(plot, c)) {
      for (const run of runs(plot, s)) {
        const area = clipArea(plot, [[run[0][0], 0], ...run, [run[run.length - 1][0], 0]]);
        if (area.length < 3) continue;
        const [start, ...rest] = area.map(P);
        out.push({ k: "region", layer: "fill", ref: c.id, color: tint(c.color, PLOT.shade), outlines: [{ kind: "path", start, segs: [...rest, start].map((to) => ({ k: "L" as const, to })) }] });
      }
    }
  }

  const gridX = L.xs.map((v) => P([v, 0])[0]), gridY = L.ys.map((v) => P([0, v])[1]);
  if (plot.grid === "lines") {
    const grid = { ...dim, layer: "fill" as const, k: "line" as const, stroke: "hatch" as const, width: PLOT.gridWidth, ink: PLOT.gridInk, part: "grid" };
    for (const X of gridX) out.push({ ...grid, a: [X, 0], b: [X, H] });
    for (const Y of gridY) out.push({ ...grid, a: [0, Y], b: [W, Y] });
  } else if (plot.grid === "dots") {
    // Not on the axes or the frame, where a dot would only smudge the line.
    const onLine = (v: number, at: number, far: number) => Math.abs(v - at) < 1e-6 || (box && (Math.abs(v) < 1e-6 || Math.abs(v - far) < 1e-6));
    for (const X of gridX) {
      for (const Y of gridY) {
        if (onLine(X, box ? 0 : L.X0, W) || onLine(Y, box ? 0 : L.Y0, H)) continue;
        out.push({ ...dim, layer: "fill", k: "circle", c: [X, Y], r: PLOT.dotRadius, stroke: "hatch", width: 0, fill: "ink", color: PLOT.dotInk, ink: PLOT.dotInk, part: "grid" });
      }
    }
  }

  const tickLine = (a: V, b: V): Prim => ({ ...dim, k: "line", a, b, stroke: "dim", part: "tick" });
  const number = (at: V, tex: string, anchor: TextPrim["anchor"], part: string): Prim => ({ ...dim, k: "text", at, tex, anchor, part });
  if (box) {
    if (L.tick) {
      for (const X of gridX) out.push(tickLine([X, 0], [X, -L.tick]));
      for (const Y of gridY) out.push(tickLine([0, Y], [-L.tick, Y]));
    }
    out.push({ ...dim, k: "poly", pts: [[0, 0], [W, 0], [W, H], [0, H]], stroke: "symbol", part: "frame" });
    for (const n of L.xNumbers) out.push(number([P([n.v, 0])[0], -L.tick], n.tex, "n", "xtick"));
    for (const n of L.yNumbers) out.push(number([-L.tick, P([0, n.v])[1]], n.tex, "e", "ytick"));
  } else {
    if (L.tick) {
      const half = L.tick / 2;
      for (const v of L.xs) if (marked(plot, "x", v)) out.push(tickLine([P([v, 0])[0], L.Y0 - half], [P([v, 0])[0], L.Y0 + half]));
      for (const v of L.ys) if (marked(plot, "y", v)) out.push(tickLine([L.X0 - half, P([0, v])[1]], [L.X0 + half, P([0, v])[1]]));
    }
    out.push({ ...dim, k: "line", a: [0, L.Y0], b: [W, L.Y0], stroke: "symbol", arrowB: true, part: "xaxis" });
    out.push({ ...dim, k: "line", a: [L.X0, 0], b: [L.X0, H], stroke: "symbol", arrowB: true, part: "yaxis" });
    for (const n of L.xNumbers) out.push(number([P([n.v, 0])[0], L.Y0 - L.tick / 2], n.tex, "n", "xtick"));
    for (const n of L.yNumbers) out.push(number([L.X0 - L.tick / 2, P([0, n.v])[1]], n.tex, "e", "ytick"));
  }

  for (const c of plot.curves) {
    const line = { layer: "sym" as const, ref: c.id, stroke: "member" as const, width: (c.weight ?? PLOT.weight) * PT_MM, ink: c.color };
    const dash = c.dash ? PLOT_DASH[c.dash] : undefined;
    for (const s of stretches(plot, c)) {
      for (const run of runs(plot, s)) for (const part of clipRun(plot, run)) out.push({ ...line, k: "path", pts: part.map(P), ...(dash ? { dash } : {}) });
    }
    for (const up of uprights(plot, c)) for (const part of clipRun(plot, up)) out.push({ ...line, k: "path", pts: part.map(P), ...(dash ? { dash } : {}) });
  }

  const xName = labelTex(plot.x.label), yName = labelTex(plot.y.label);
  if (box) {
    if (xName) out.push(number([W / 2, 0 - L.below], xName, "n", "xlabel"));
    if (yName) out.push({ ...number([0 - L.left, H / 2], yName, "s", "ylabel"), rot: Math.PI / 2 } as Prim);
  } else {
    if (xName) out.push(number([W, L.Y0], xName, "w", "xlabel"));
    if (yName) out.push(number([L.X0, H], yName, "s", "ylabel"));
  }
  for (const c of plot.curves) {
    const tex = labelTex(c.label ?? "");
    const at = tex ? curveLabelAt(plot, c) : null;
    if (at) out.push({ layer: "sym", ref: c.id, k: "text", at: P(at), tex, anchor: "c", ink: c.color, part: "label" });
  }
  return out;
}

/** The plot as a standalone SVG file, or null when it has no size to draw at. */
export function plotSvg(plot: Plot): string | null {
  return primsToSvg(plotPrims(plot));
}

// ---- pgfplots -----------------------------------------------------------------------

/**
 * The plot as a tikzpicture with a pgfplots axis in it. The size, the ranges,
 * the ticks and where every label sits are all written out, so nothing is
 * left for pgfplots to choose: it comes out as the screen shows it.
 */
export function plotTikz(plot: Plot): string {
  const { width: W, height: H } = plot;
  const box = plot.frame === "box";
  const L = layout(plot);
  const n = pgfNumber;
  const mm = (v: number) => `${num(v, 2)}mm`;
  const math = (typed: string) => `$${latexAccents(labelTex(typed), "math")}$`;
  // A share of the axis box, as pgfplots counts places for labels: 0 to 1 along each side.
  const share = (v: number) => num(v, 5);
  const [cx, cy] = axisCross(plot);
  const opts: string[] = [];
  opts.push(`width=${mm(W)}, height=${mm(H)}, scale only axis`);
  opts.push(`xmin=${n(plot.x.min)}, xmax=${n(plot.x.max)}, ymin=${n(plot.y.min)}, ymax=${n(plot.y.max)}`);
  const sep = `inner sep=${mm(PAPER.textSep)}`;
  const xLabel = plot.x.label.trim(), yLabel = plot.y.label.trim();
  if (box) {
    opts.push(`axis lines=box, axis line style={line width=0.4pt}`);
    if (xLabel) opts.push(`xlabel={${math(xLabel)}}, every axis x label/.style={at={(axis description cs:0.5,${share(-L.below / H)})}, anchor=north, ${sep}}`);
    if (yLabel) opts.push(`ylabel={${math(yLabel)}}, every axis y label/.style={at={(axis description cs:${share(-L.left / W)},0.5)}, rotate=90, anchor=south, ${sep}}`);
  } else {
    // Through the origin; along the edge it lies beyond when it is out of range.
    const side = (at: number, a: PlotAxis, low: string, high: string) => (at > a.min && at < a.max ? "middle" : at <= a.min ? low : high);
    opts.push(`axis x line=${side(cy, plot.y, "bottom", "top")}, axis y line=${side(cx, plot.x, "left", "right")}`);
    opts.push(`axis line style={line width=0.4pt, -{Stealth[length=${mm(PAPER.arrowLen)}, width=${mm(PAPER.arrowWidth)}, inset=${mm(PAPER.arrowLen * 0.28)}]}}`);
    if (xLabel) opts.push(`xlabel={${math(xLabel)}}, every axis x label/.style={at={(axis description cs:1,${share(L.Y0 / H)})}, anchor=west, ${sep}}`);
    if (yLabel) opts.push(`ylabel={${math(yLabel)}}, every axis y label/.style={at={(axis description cs:${share(L.X0 / W)},1)}, anchor=south, ${sep}}`);
  }
  // The ticks carry the grid too, so they are listed even where no mark is drawn at them.
  const xs = L.xs.filter((v) => marked(plot, "x", v)), ys = L.ys.filter((v) => marked(plot, "y", v));
  const list = (vs: number[]) => (vs.length ? `{${vs.map(n).join(",")}}` : "\\empty");
  const labels = (ns: { tex: string }[]) => (ns.length ? `{${ns.map((t) => `$${t.tex}$`).join(",")}}` : "\\empty");
  opts.push(`xtick=${list(xs)}, xticklabels=${labels(L.xNumbers)}`);
  opts.push(`ytick=${list(ys)}, yticklabels=${labels(L.yNumbers)}`);
  // "scaled ticks" would pull a power of ten out of the numbers and print it at the end of the axis.
  opts.push(`tick align=${box ? "outside" : "center"}, ${box ? "tick pos=left, " : ""}major tick length=${mm(L.tick)}, tick style={line width=0.3pt, black}, ticklabel style={${sep}}, scaled ticks=false`);
  if (plot.grid === "lines") opts.push(`grid=major, grid style={line width=${num(PLOT.gridWidth / PT_MM, 2)}pt, draw=${tikzColor(PLOT.gridInk)}}`);
  const [lo, hi] = restrictY(plot);
  opts.push(`restrict y to domain=${n(lo)}:${n(hi)}, unbounded coords=jump`);
  opts.push(`trig format plots=rad, line join=round, line cap=round`);
  const shaded = plot.curves.some((c) => c.fill && stretches(plot, c).length);
  if (shaded) opts.push(`set layers`);

  const body: string[] = [];
  /** What is drawn once the axis is closed. */
  const after: string[] = [];
  if (plot.grid === "dots") {
    const dots: string[] = [];
    const onLine = (v: number, at: number, a: PlotAxis) => Math.abs(v - at) < (a.max - a.min) * 1e-9 || (box && (Math.abs(v - a.min) < (a.max - a.min) * 1e-9 || Math.abs(v - a.max) < (a.max - a.min) * 1e-9));
    for (const x of L.xs) for (const y of L.ys) if (!onLine(x, box ? plot.x.min : cx, plot.x) && !onLine(y, box ? plot.y.min : cy, plot.y)) dots.push(`(${n(x)},${n(y)})`);
    if (dots.length) {
      const rows: string[] = [];
      for (let i = 0; i < dots.length; i += 10) rows.push(dots.slice(i, i + 10).join(" "));
      // The colour goes to the outline too, drawn as thin as can be: a mark does not take "draw=none".
      body.push(`\\addplot[only marks, mark=*, mark size=${mm(PLOT.dotRadius)}, color=${tikzColor(PLOT.dotInk)}, mark options={line width=0pt}] coordinates {\n    ${rows.join("\n    ")}\n  };`);
    }
  }
  for (const c of plot.curves) {
    const list = stretches(plot, c);
    if (!list.length) continue;
    const dash = c.dash ? `, dash pattern=on ${mm(PLOT_DASH[c.dash][0])} off ${mm(PLOT_DASH[c.dash][1])}${c.dash === "dotted" ? ", line cap=round" : ""}` : "";
    const pen = `draw=${tikzColor(c.color)}, line width=${num(c.weight ?? PLOT.weight, 2)}pt${dash}`;
    const where = (s: Stretch) => `domain=${n(s.from)}:${n(s.to)}, samples=${s.samples}`;
    if (c.fill) {
      for (const s of list) body.push(`\\addplot[draw=none, fill=${tikzColor(tint(c.color, PLOT.shade))}, ${where(s)}, on layer=axis background] {${toPgf(s.expr)}} \\closedcycle;`);
    }
    for (const s of list) body.push(`\\addplot[${pen}, ${where(s)}] {${toPgf(s.expr)}};`);
    // The upright lines go in after the axis, in mm from its lower left corner like the names: inside it,
    // one that runs along the edge of the plot would be cut to half its thickness.
    for (const up of uprights(plot, c)) {
      for (const part of clipRun(plot, up)) after.push(`\\draw[${pen}, line cap=round] ${part.map((q) => { const [X, Y] = toPaper(plot, q); return `(${mm(X)},${mm(Y)})`; }).join(" -- ")};`);
    }
  }
  // The names of the curves go in after the axis too, where its edge does not cut them.
  const names: string[] = after;
  for (const c of plot.curves) {
    const at = c.label?.trim() ? curveLabelAt(plot, c) : null;
    if (!at) continue;
    const [X, Y] = toPaper(plot, at);
    names.push(`\\node[inner sep=0pt, text=${tikzColor(c.color)}] at (${mm(X)},${mm(Y)}) {${math(c.label!)}};`);
  }
  return (
    `% Made with Mech Sketch. Needs \\usepackage{pgfplots} and \\usetikzlibrary{arrows.meta}.\n` +
    `\\begin{tikzpicture}\n\\begin{axis}[\n  ${opts.join(",\n  ")},\n]\n` +
    body.map((b) => `  ${b}\n`).join("") +
    `\\end{axis}\n` +
    names.map((b) => `${b}\n`).join("") +
    `\\end{tikzpicture}\n`
  );
}

// ---- making and fitting ---------------------------------------------------------------

/** A curve with one piece still to be typed. */
export function newCurve(sk: Sketch, plot: Plot): PlotCurve {
  const used = new Set(plot.curves.map((c) => c.color));
  const curve: PlotCurve = { id: newId(sk, "curve"), pieces: [{ expr: "" }], color: PLOT_COLORS.find((c) => !used.has(c)) ?? PLOT_COLORS[0] };
  plot.curves.push(curve);
  return curve;
}

/** A plot with one function to fill in, added to the sketch's plots. */
export function newPlot(sk: Sketch): Plot {
  const plots = (sk.plots ??= []);
  let k = plots.length + 1;
  while (plots.some((p) => p.name === `Plot ${k}`)) k++;
  const plot: Plot = {
    id: newId(sk, "plot"), name: `Plot ${k}`, curves: [],
    x: { min: 0, max: 10, label: "x" }, y: { min: -5, max: 5, label: "y" },
    width: 70, height: 45,
  };
  newCurve(sk, plot);
  plots.push(plot);
  return plot;
}

/** A copy of a plot under a name of its own, added to the sketch's plots. */
export function copyPlot(sk: Sketch, plot: Plot): Plot {
  const copy: Plot = structuredClone(plot);
  copy.id = newId(sk, "plot");
  copy.name = `${plot.name} copy`;
  for (const c of copy.curves) c.id = newId(sk, "curve");
  sk.plots!.push(copy);
  return copy;
}

/** A value rounded outwards to a round number at the scale of `span`: down when `sign` is -1, up when it is 1. */
function roundOut(v: number, span: number, sign: -1 | 1): number {
  const step = niceStep(span, 60) / 2;
  return Number(((sign < 0 ? Math.floor(v / step + 1e-9) : Math.ceil(v / step - 1e-9)) * step).toPrecision(12));
}

/** The vertical range that shows all of the curves over the horizontal range of the plot, with a little room; null when there is nothing to show. */
export function fitY(plot: Plot): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  const span = plot.x.max - plot.x.min;
  for (const c of plot.curves) {
    for (const piece of c.pieces) {
      if (pieceError(piece) !== null || !piece.expr.trim()) continue;
      const expr = readFormula(piece.expr) as Expr;
      const from = Math.max(piece.from ?? -Infinity, plot.x.min), to = Math.min(piece.to ?? Infinity, plot.x.max);
      if (!(to - from > span * 1e-9)) continue;
      for (let i = 0; i <= 400; i++) {
        const y = evaluate(expr, from + ((to - from) * i) / 400);
        if (Number.isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
      }
    }
    // A shaded curve reaches down, or up, to the axis.
    if (c.fill && lo <= hi) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  }
  if (lo > hi) return null;
  // A function that runs off to infinity is not chased there.
  const reach = Math.max(Math.abs(lo), Math.abs(hi));
  if (reach > 1e9) return null;
  let height = hi - lo;
  if (height < Math.max(reach, 1) * 1e-9) { lo -= 1; hi += 1; height = 2; }
  const pad = height * 0.08;
  return [roundOut(lo - pad, height, -1), roundOut(hi + pad, height, 1)];
}

/** Ids of everything a plot holds, itself included: what a selection in it can be. */
export function plotIds(plot: Plot): Id[] {
  return [plot.id, ...plot.curves.map((c) => c.id)];
}
