import { describe, it, expect } from "vitest";
import { emptySketch, serialize, deserialize, type Plot, type PlotCurve } from "../src/model";
import {
  PLOT, niceStep, tickValues, tickText, stretches, runs, uprights, plotPrims, plotSvg, plotTikz, fitY, newPlot, newCurve, copyPlot,
  pieceError, toPaper, toData, curveLabelAt, axisCross,
} from "../src/plot";
import { PAPER, PT_MM, type Prim } from "../src/prims";
import { primsToTikz } from "../src/export";

const RED = "#d32f2f";
/** A plot 60 mm by 40 mm of x from -1 to 5 and y from -2 to 3: 10 mm and 8 mm to the unit. */
function plot(curves: Partial<PlotCurve>[] = [], more: Partial<Plot> = {}): Plot {
  return {
    id: "g1", name: "Test", width: 60, height: 40,
    x: { min: -1, max: 5, label: "x" }, y: { min: -2, max: 3, label: "y" },
    curves: curves.map((c, i) => ({ id: `f${i + 1}`, color: RED, pieces: [], ...c })),
    ...more,
  };
}
const paths = (prims: Prim[], ref = "f1") => prims.filter((p): p is Extract<Prim, { k: "path" }> => p.k === "path" && p.ref === ref);
const texts = (prims: Prim[], part: string) => prims.filter((p): p is Extract<Prim, { k: "text" }> => p.k === "text" && p.part === part);

describe("ticks", () => {
  it("chooses a round step that puts ticks about a centimetre apart", () => {
    expect(niceStep(6, 60)).toBe(1);
    expect(niceStep(5, 40)).toBe(1);
    expect(niceStep(16, 35)).toBe(5);
    expect(niceStep(150, 45)).toBe(50);
    expect(niceStep(0.6, 60)).toBeCloseTo(0.1);
    expect(tickValues({ min: -1, max: 5, label: "" }, 60)).toEqual([-1, 0, 1, 2, 3, 4, 5]);
    expect(tickValues({ min: 0.05, max: 0.45, label: "" }, 40)).toEqual([0.1, 0.2, 0.3, 0.4]);
    // A step of its own is kept, unless it would crowd the axis with ticks.
    expect(tickValues({ min: 0, max: 2, label: "", step: 0.5 }, 60)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(tickValues({ min: 0, max: 100, label: "", step: 0.01 }, 60)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it("writes a tick's number with the decimals of the step", () => {
    expect(tickText(2, 1)).toBe("2");
    expect(tickText(0.30000000000000004, 0.1)).toBe("0.3");
    expect(tickText(1.25, 0.25)).toBe("1.25");
    expect(tickText(-50, 50)).toBe("-50");
  });
});

describe("sampling a function", () => {
  it("cuts each piece down to the plot and draws a straight line through its two ends only", () => {
    const p = plot([{ pieces: [{ expr: "2x - 1", from: 0, to: 2 }, { expr: "sin(x)", from: 2 }, { expr: "x", from: 7, to: 9 }, { expr: "x +" }, { expr: "" }] }]);
    const s = stretches(p, p.curves[0]);
    expect(s.map((x) => [x.from, x.to, x.samples])).toEqual([[0, 2, 2], [2, 5, 61]]);
    expect(pieceError(p.curves[0].pieces[3])).toMatch(/missing/);
    expect(pieceError(p.curves[0].pieces[4])).toBeNull(); // not typed yet
    expect(pieceError({ expr: "x", from: 3, to: 1 })).toMatch(/ends before it starts/);
  });

  it("breaks a curve where the function has no value or runs far out of the plot", () => {
    const p = plot([{ pieces: [{ expr: "1/(x - 2)" }] }, { pieces: [{ expr: "sqrt(x)" }] }]);
    const [pole] = stretches(p, p.curves[0]);
    const parts = runs(p, pole);
    // One run either side of the pole at x = 2; nothing joins them.
    expect(parts).toHaveLength(2);
    expect(parts[0][parts[0].length - 1][0]).toBeLessThan(2);
    expect(parts[1][0][0]).toBeGreaterThan(2);
    for (const run of parts) for (const [, y] of run) expect(Math.abs(y)).toBeLessThanOrEqual(8);
    // The root starts where it has a value.
    const root = runs(p, stretches(p, p.curves[1])[0]);
    expect(root).toHaveLength(1);
    expect(root[0][0][0]).toBeGreaterThanOrEqual(0);
  });

  it("draws the jump between two pieces that meet, and leaves the ends of a curve at their values", () => {
    const pieces = [{ expr: "6 - 2x", from: 0, to: 2 }, { expr: "-1", from: 2, to: 4 }];
    const p = plot([{ pieces }], { y: { min: -8, max: 8, label: "" } });
    expect(uprights(p, p.curves[0])).toEqual([[[2, 2], [2, -1]]]);
    p.curves[0].join = false;
    expect(uprights(p, p.curves[0])).toEqual([]);
    delete p.curves[0].join;
    p.curves[0].fill = true;
    // Shaded or not, a curve ends at its value: nothing is drawn down to the axis there.
    expect(uprights(p, p.curves[0])).toEqual([[[2, 2], [2, -1]]]);
    // Only when asked for, as a diagram on a member can.
    expect(uprights(p, p.curves[0], 1, true)).toEqual([[[0, 0], [0, 6]], [[2, 2], [2, -1]], [[4, -1], [4, 0]]]);
    p.curves[0].join = false;
    expect(uprights(p, p.curves[0], 1, true)).toEqual([[[0, 0], [0, 6]], [[4, -1], [4, 0]]]);
    delete p.curves[0].join;
    // Pieces that meet at the same value have nothing to join.
    p.curves[0].pieces = [{ expr: "x", from: 0, to: 2 }, { expr: "2", from: 2, to: 4 }];
    delete p.curves[0].fill;
    expect(uprights(p, p.curves[0])).toEqual([]);
  });
});

describe("a plot as primitives", () => {
  it("draws arrowed axes through the origin, with ticks and numbers but none at the crossing or under the arrowheads", () => {
    const p = plot();
    const prims = plotPrims(p);
    expect(axisCross(p)).toEqual([0, 0]);
    const xAxis = prims.find((q) => q.part === "xaxis"), yAxis = prims.find((q) => q.part === "yaxis");
    expect(xAxis).toMatchObject({ k: "line", a: [0, 16], b: [60, 16], arrowB: true });
    expect(yAxis).toMatchObject({ k: "line", a: [10, 0], b: [10, 40], arrowB: true });
    expect(texts(prims, "xtick").map((t) => t.tex)).toEqual(["-1", "1", "2", "3", "4"]);
    expect(texts(prims, "ytick").map((t) => t.tex)).toEqual(["-2", "-1", "1", "2"]);
    // A number hangs under its tick, which is drawn across the axis.
    expect(texts(prims, "xtick")[1]).toMatchObject({ at: [20, 16 - PLOT.tickCross / 2], anchor: "n" });
    expect(texts(prims, "ytick")[0]).toMatchObject({ at: [10 - PLOT.tickCross / 2, 0], anchor: "e" });
    expect(prims.filter((q) => q.part === "tick")).toHaveLength(9);
    // The names stand at the arrowheads.
    expect(texts(prims, "xlabel")[0]).toMatchObject({ at: [60, 16], anchor: "w", tex: "x" });
    expect(texts(prims, "ylabel")[0]).toMatchObject({ at: [10, 40], anchor: "s", tex: "y" });
  });

  it("puts an axis along the edge when the origin is out of range", () => {
    const p = plot([], { x: { min: 1, max: 7, label: "" }, y: { min: 2, max: 7, label: "" } });
    const prims = plotPrims(p);
    expect(prims.find((q) => q.part === "xaxis")).toMatchObject({ a: [0, 0], b: [60, 0] });
    expect(prims.find((q) => q.part === "yaxis")).toMatchObject({ a: [0, 0], b: [0, 40] });
    expect(texts(prims, "xlabel")).toHaveLength(0); // no name, no text
  });

  it("draws a curve in its colour and thickness, cut off at the edge of the plot", () => {
    const p = plot([{ pieces: [{ expr: "x^2" }], weight: 1.2, dash: "dashed" }]);
    const [curve] = paths(plotPrims(p));
    expect(curve).toMatchObject({ ink: RED, width: 1.2 * PT_MM, dash: [2, 1.2], layer: "sym" });
    for (const [X, Y] of curve.pts) {
      expect(X).toBeGreaterThanOrEqual(-1e-9);
      expect(Y).toBeLessThanOrEqual(40 + 1e-9);
    }
    // It leaves through the top edge, where x squared is 3.
    const last = curve.pts[curve.pts.length - 1];
    expect(last[1]).toBeCloseTo(40);
    expect(toData(p, last)[0]).toBeCloseTo(Math.sqrt(3), 2);
    expect(toPaper(p, [0, 0])).toEqual([10, 16]);
    // A standard curve is as thick as a member.
    expect(paths(plotPrims(plot([{ pieces: [{ expr: "x" }] }])))[0].width).toBeCloseTo(PAPER.member, 2);
  });

  it("shades down to the axis under everything else, and names a curve beside it or where it was put", () => {
    const p = plot([{ pieces: [{ expr: "2 - x", from: 0, to: 4 }], fill: true, label: "M_h" }]);
    const prims = plotPrims(p);
    expect(prims[0]).toMatchObject({ k: "region", ref: "f1", layer: "fill" });
    if (prims[0].k !== "region" || prims[0].outlines[0].kind !== "path") throw new Error();
    // From the axis up the line and back: a triangle above the axis and one below, in one outline.
    expect([prims[0].outlines[0].start, ...prims[0].outlines[0].segs.map((s) => s.to)]).toEqual([[10, 16], [10, 32], [50, 0], [50, 16], [10, 16]]);
    const [name] = texts(prims, "label");
    expect(name).toMatchObject({ tex: "M_h", ink: RED, anchor: "c", ref: "f1" });
    expect(curveLabelAt(p, p.curves[0])![0]).toBeCloseTo(2.64);
    p.curves[0].lx = 3;
    p.curves[0].ly = 2;
    expect(texts(plotPrims(p), "label")[0].at).toEqual([40, 32]);
  });

  it("draws a box with ticks outside it and the names of the axes centred along it", () => {
    const p = plot([], { frame: "box" });
    const prims = plotPrims(p);
    expect(prims.find((q) => q.part === "frame")).toMatchObject({ k: "poly", pts: [[0, 0], [60, 0], [60, 40], [0, 40]] });
    expect(prims.some((q) => q.part === "xaxis")).toBe(false);
    // Around a box every tick has its number, the ones at the corners too.
    expect(texts(prims, "xtick").map((t) => t.tex)).toEqual(["-1", "0", "1", "2", "3", "4", "5"]);
    expect(texts(prims, "xtick")[0]).toMatchObject({ at: [0, -PLOT.tickBox], anchor: "n" });
    const [xName] = texts(prims, "xlabel"), [yName] = texts(prims, "ylabel");
    expect(xName).toMatchObject({ anchor: "n" });
    expect(xName.at[0]).toBe(30);
    expect(xName.at[1]).toBeLessThan(-PLOT.tickBox - 2 * PAPER.textSep);
    expect(yName).toMatchObject({ anchor: "s", rot: Math.PI / 2 });
    expect(yName.at[1]).toBe(20);
    expect(yName.at[0]).toBeLessThan(-PLOT.tickBox - 2 * PAPER.textSep);
    // Without numbers the names move in; without ticks they stand at the box.
    p.ticks = "marks";
    expect(texts(plotPrims(p), "xlabel")[0].at[1]).toBe(-PLOT.tickBox);
    p.ticks = "none";
    expect(texts(plotPrims(p), "xlabel")[0].at[1]).toBe(0);
    expect(plotPrims(p).some((q) => q.part === "tick")).toBe(false);
  });

  it("draws a grid of lines or of dots at the ticks", () => {
    const p = plot([], { grid: "lines" });
    const grid = (q: Plot) => plotPrims(q).filter((x) => x.part === "grid");
    expect(grid(p)).toHaveLength(7 + 6);
    expect(grid(p)[0]).toMatchObject({ k: "line", a: [0, 0], b: [0, 40], ink: PLOT.gridInk, layer: "fill" });
    p.grid = "dots";
    // Six columns and five rows are left once the dots on the two axes are taken out.
    expect(grid(p)).toHaveLength(6 * 5);
    expect(grid(p)[0]).toMatchObject({ k: "circle", r: PLOT.dotRadius, fill: "ink", color: PLOT.dotInk });
    p.frame = "box";
    // In a box the dots on the frame go instead: five columns and four rows inside it.
    expect(grid(p)).toHaveLength(5 * 4);
    delete p.grid;
    expect(grid(p)).toHaveLength(0);
  });

  it("goes into an SVG, and into plain TikZ when asked as primitives", () => {
    const p = plot([{ pieces: [{ expr: "sin(x)" }] }]);
    const svg = plotSvg(p)!;
    expect(svg).toContain("<polyline");
    expect(svg).toContain(`stroke="${RED}"`);
    const tikz = primsToTikz(plotPrims(plot([{ pieces: [{ expr: "x/2", from: 0, to: 2 }], dash: "dotted" }])))!;
    expect(tikz).toMatch(/\\draw\[member, line width=0\.8pt, draw=\{rgb,255:red,211;green,47;blue,47\}, dash pattern=on 0\.01mm off 1\.1mm\] \(10,16\) -- \(30,24\);/);
  });
});

describe("a plot for pgfplots", () => {
  it("pins the size, the ranges, the axes and every tick", () => {
    const tikz = plotTikz(plot());
    expect(tikz).toMatch(/^% Made with Mech Sketch\. Needs \\usepackage\{pgfplots\} and \\usetikzlibrary\{arrows\.meta\}\.\n\\begin\{tikzpicture\}\n\\begin\{axis\}\[\n/);
    expect(tikz).toContain("width=60mm, height=40mm, scale only axis,");
    expect(tikz).toContain("xmin=-1, xmax=5, ymin=-2, ymax=3,");
    expect(tikz).toContain("axis x line=middle, axis y line=middle,");
    expect(tikz).toContain("-{Stealth[length=1.8mm, width=1.1mm, inset=0.5mm]}");
    expect(tikz).toContain("xlabel={$x$}, every axis x label/.style={at={(axis description cs:1,0.4)}, anchor=west, inner sep=0.7mm},");
    expect(tikz).toContain("ylabel={$y$}, every axis y label/.style={at={(axis description cs:0.16667,1)}, anchor=south, inner sep=0.7mm},");
    expect(tikz).toContain("xtick={-1,1,2,3,4}, xticklabels={$-1$,$1$,$2$,$3$,$4$},");
    expect(tikz).toContain("ytick={-2,-1,1,2}, yticklabels={$-2$,$-1$,$1$,$2$},");
    expect(tikz).toContain("tick align=center, major tick length=1.6mm,");
    expect(tikz).toContain("scaled ticks=false");
    expect(tikz).toContain("restrict y to domain=-7:8, unbounded coords=jump,");
    expect(tikz).toContain("trig format plots=rad");
    expect(tikz).not.toContain("grid=");
    expect(tikz).not.toContain("set layers");
    expect(tikz).toContain("line join=round, line cap=round");
    expect(tikz.trimEnd().endsWith("\\end{axis}\n\\end{tikzpicture}")).toBe(true);
  });

  it("writes each piece as a formula over its stretch, with the jumps between them", () => {
    const p = plot([{ pieces: [{ expr: "2x − 1", from: 0, to: 2 }, { expr: "-x^2/4 + 1", from: 2 }], weight: 1, dash: "dashed" }]);
    const tikz = plotTikz(p);
    const pen = "draw={rgb,255:red,211;green,47;blue,47}, line width=1pt, dash pattern=on 2mm off 1.2mm";
    expect(tikz).toContain(`\\addplot[${pen}, domain=0:2, samples=2] {2*x - 1};`);
    expect(tikz).toContain(`\\addplot[${pen}, domain=2:5, samples=61] {(-(x^2))/4 + 1};`);
    // The jump is drawn after the axis, in mm from its corner: 2 is 30 mm along, 3 and 0 are 40 and 16 mm up.
    expect(tikz).toContain(`\\end{axis}\n\\draw[${pen}, line cap=round] (30mm,40mm) -- (30mm,16mm);\n\\end{tikzpicture}`);
  });

  it("shades on a layer under the grid, and sets the names of curves after the axis", () => {
    const p = plot([{ pieces: [{ expr: "2 - x", from: 0, to: 4 }], fill: true, label: "M_ő", lx: 3, ly: 2 }], { grid: "lines" });
    const tikz = plotTikz(p);
    expect(tikz).toContain("set layers,");
    expect(tikz).toContain("\\addplot[draw=none, fill={rgb,255:red,248;green,222;blue,222}, domain=0:4, samples=2, on layer=axis background] {2 - x} \\closedcycle;");
    expect(tikz).toContain("grid=major, grid style={line width=0.2pt, draw={rgb,255:red,204;green,204;blue,204}},");
    // Accented letters are taken apart as in every other label; the name sits in mm from the corner of the axes.
    expect(tikz).toContain("\\node[inner sep=0pt, text={rgb,255:red,211;green,47;blue,47}] at (40mm,32mm) {$M_{\\mathaccent28797{o}}$};\n\\end{tikzpicture}");
    // The shading is closed down to the axis, the line is not: it ends at its value.
    expect(tikz).toContain("\\end{axis}\n\\node");
    expect(tikz).not.toContain("\\draw");
  });

  it("writes a box with its names placed from the size of the tick numbers, and a grid of dots as marks", () => {
    const p = plot([], { frame: "box", grid: "dots", x: { min: 0, max: 2, label: "t\\,[\\mathrm{s}]", step: 1 }, y: { min: 0, max: 2, label: "v", step: 1 } });
    const tikz = plotTikz(p);
    expect(tikz).toContain("axis lines=box, axis line style={line width=0.4pt},");
    expect(tikz).toMatch(/xlabel=\{\$t\\,\[\\mathrm\{s\}\]\$\}, every axis x label\/\.style=\{at=\{\(axis description cs:0\.5,-0\.\d+\)\}, anchor=north, inner sep=0\.7mm\},/);
    expect(tikz).toMatch(/ylabel=\{\$v\$\}, every axis y label\/\.style=\{at=\{\(axis description cs:-0\.\d+,0\.5\)\}, rotate=90, anchor=south, inner sep=0\.7mm\},/);
    expect(tikz).toContain("xtick={0,1,2}, xticklabels={$0$,$1$,$2$},");
    expect(tikz).toContain("tick align=outside, tick pos=left, major tick length=1.2mm,");
    expect(tikz).toMatch(/\\addplot\[only marks, mark=\*, mark size=0\.2mm, color=\{rgb,255:red,140;green,140;blue,140\}, mark options=\{line width=0pt\}\] coordinates \{\n {4}\(1,1\)\n {2}\};/);
    // No ticks: the list is kept for the grid, with no marks and no numbers.
    p.ticks = "none";
    expect(plotTikz(p)).toContain("xtick={0,1,2}, xticklabels=\\empty,");
    expect(plotTikz(p)).toContain("major tick length=0mm,");
  });
});

describe("plots in a sketch", () => {
  it("starts a plot with one function to fill in, and copies one under ids of its own", () => {
    const sk = emptySketch();
    const a = newPlot(sk);
    expect(a).toMatchObject({ name: "Plot 1", width: 70, height: 45, x: { min: 0, max: 10 } });
    expect(a.curves).toHaveLength(1);
    expect(a.curves[0].pieces).toEqual([{ expr: "" }]);
    // Each new function takes a colour that is not in use yet.
    const second = newCurve(sk, a);
    expect(second.color).not.toBe(a.curves[0].color);
    const b = copyPlot(sk, a);
    expect(b.name).toBe("Plot 1 copy");
    expect(new Set([a.id, b.id, ...a.curves.map((c) => c.id), ...b.curves.map((c) => c.id)]).size).toBe(6);
    expect(newPlot(sk).name).toBe("Plot 3");
    expect(sk.plots).toHaveLength(3);
  });

  it("keeps plots through a file, and passes over one that is damaged", () => {
    const sk = emptySketch();
    const p = newPlot(sk);
    p.curves[0].pieces = [{ expr: "sin(x)", from: 0, to: 3 }];
    p.frame = "box";
    const back = deserialize(serialize(sk));
    expect(back.plots).toEqual(sk.plots);
    const raw = JSON.parse(serialize(sk));
    raw.plots.push({ id: "g9", name: "broken", curves: "none" }, { ...raw.plots[0], id: "g10", x: { min: 3, max: 1, label: "" } });
    expect(deserialize(JSON.stringify(raw)).plots).toHaveLength(1);
    // A sketch without plots has none made up for it.
    expect("plots" in deserialize(serialize(emptySketch()))).toBe(false);
  });

  it("fits the vertical range to the functions, with a little room and round ends", () => {
    const p = plot([{ pieces: [{ expr: "6 - 2x", from: 0, to: 2 }, { expr: "-7", from: 2, to: 4 }] }]);
    expect(fitY(p)).toEqual([-9, 8]);
    // A constant gets a range around it; nothing typed gives nothing to fit.
    p.curves[0].pieces = [{ expr: "3" }];
    const [lo, hi] = fitY(p)!;
    expect(lo).toBeLessThan(3);
    expect(hi).toBeGreaterThan(3);
    p.curves[0].pieces = [{ expr: "" }];
    expect(fitY(p)).toBeNull();
    // A shaded curve reaches to the axis.
    p.curves[0].pieces = [{ expr: "4 + x" }];
    p.curves[0].fill = true;
    expect(fitY(p)![0]).toBeLessThanOrEqual(0);
  });
});
