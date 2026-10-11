import { describe, it, expect } from "vitest";
import {
  emptySketch, addPoint, addLine, addArc, addSymbol, addConstraint, remove, serialize, deserialize,
  type Sketch, type Plot, type Diagram, type Line,
} from "../src/model";
import { baseline, beamAxis, diagramShape, plotPeak, plotOf } from "../src/diagram";
import { straightBeam, curvedBeam } from "../src/beam";
import { buildPrims, valueText, tint, type Prim } from "../src/prims";
import { PLOT } from "../src/plot";
import { toSvg, toTikz } from "../src/export";

const RED = "#d32f2f";
/** A sketch with a line from (0, 0) to (10, 0) and a plot of x from 0 to 5 with the given formulas as one function. */
function setup(pieces: Plot["curves"][0]["pieces"] = [{ expr: "2x" }]): { sk: Sketch; l: Line; plot: Plot } {
  const sk = emptySketch();
  const l = addLine(sk, addPoint(sk, 0, 0).id, addPoint(sk, 10, 0).id);
  const plot: Plot = { id: "g1", name: "M", width: 60, height: 40, x: { min: 0, max: 5, label: "x" }, y: { min: -10, max: 10, label: "M" }, curves: [{ id: "f1", color: RED, pieces }] };
  sk.plots = [plot];
  return { sk, l, plot };
}
const on = (sk: Sketch, l: Line, more: Partial<Diagram> = {}) =>
  addSymbol(sk, { type: "diagram", plot: "g1", on: l.id, t0: 0, t1: 1, side: 1, scale: 0.5, ...more });
const close = (a: number[][], b: number[][]) => {
  expect(a).toHaveLength(b.length);
  a.forEach((p, i) => { expect(p[0]).toBeCloseTo(b[i][0], 6); expect(p[1]).toBeCloseTo(b[i][1], 6); });
};

describe("what a diagram runs along", () => {
  it("is the line or the arc it is on, from its start to its end", () => {
    const sk = emptySketch();
    const l = addLine(sk, addPoint(sk, 0, 0).id, addPoint(sk, 0, 4).id);
    const base = baseline(sk, { on: l.id })!;
    expect(base.kind).toBe("line");
    expect(base.length).toBe(4);
    expect(base.at(0.25)).toEqual([0, 1]);
    close([base.left(0.5)], [[-1, 0]]); // going up, left is to the left
    const arc = addArc(sk, addPoint(sk, 0, 0).id, addPoint(sk, 5, 0).id, addPoint(sk, 0, 5).id);
    const round = baseline(sk, { on: arc.id })!;
    expect(round.kind).toBe("arc");
    expect(round.sweep).toBeCloseTo(Math.PI / 2);
    expect(round.length).toBeCloseTo(2.5 * Math.PI);
    close([round.at(0), round.at(1), round.at(0.5)], [[5, 0], [0, 5], [5 * Math.SQRT1_2, 5 * Math.SQRT1_2]]);
    // Left of an arc that turns counter-clockwise is towards its centre.
    close([round.left(0)], [[-1, 0]]);
    expect(baseline(sk, { on: "nothing" })).toBeNull();
  });

  it("finds the middle of a beam from either of its sides, round ends or square", () => {
    for (const ends of ["round", "square"] as const) {
      const sk = emptySketch();
      const a = addPoint(sk, 0, 0, true).id, b = addPoint(sk, 10, 0, true).id;
      const { made, autos } = straightBeam(sk, a, b, 1, ends);
      autos.forEach((c) => addConstraint(sk, c));
      // Both sides give the same line, from the left end to the right one.
      expect(beamAxis(sk, made[0])).toEqual({ a, b });
      expect(beamAxis(sk, made[1])).toEqual({ a, b });
      // An end of the beam is not a side of it.
      expect(beamAxis(sk, made[2])).toBeNull();
      const base = baseline(sk, { on: made[1], axis: beamAxis(sk, made[1])! })!;
      close([base.at(0), base.at(1)], [[0, 0], [10, 0]]);
    }
  });

  it("finds the middle of a curved beam, running the way its sides do", () => {
    for (const ends of ["round", "square"] as const) {
      const sk = emptySketch();
      const o = addPoint(sk, 0, 0, true).id, a = addPoint(sk, 10, 0, true).id, b = addPoint(sk, 0, 10, true).id;
      const { made, autos } = curvedBeam(sk, o, a, b, 1, ends);
      autos.forEach((c) => addConstraint(sk, c));
      expect(beamAxis(sk, made[0])).toEqual({ a, b, o });
      expect(beamAxis(sk, made[1])).toEqual({ a, b, o });
      const base = baseline(sk, { on: made[0], axis: beamAxis(sk, made[0])! })!;
      expect(base.kind).toBe("arc");
      expect(base.length).toBeCloseTo(5 * Math.PI);
      close([base.at(0), base.at(1)], [[10, 0], [0, 10]]);
    }
  });

  it("takes a plain line for what it is", () => {
    const sk = emptySketch();
    const p = [addPoint(sk, 0, 0).id, addPoint(sk, 4, 0).id, addPoint(sk, 4, 3).id];
    const l = addLine(sk, p[0], p[1]);
    addLine(sk, p[1], p[2]);
    addLine(sk, p[2], p[0]);
    expect(beamAxis(sk, l.id)).toBeNull();
  });
});

describe("a plot laid along a member", () => {
  it("stretches the plot's axis over the member and sets the values off square to it", () => {
    const { sk, l, plot } = setup();
    const d = on(sk, l);
    const shape = diagramShape(sk, d)!;
    expect(plotOf(sk, d)).toBe(plot);
    expect(plotPeak(plot)).toBe(10);
    // 2x over 0 to 5, half a unit of height to the unit: from the start of the line up to 5 above its end.
    close(shape.parts[0].lines[0], [[0, 0], [10, 5]]);
    // Closed down to the line where it ends away from it; at the start it is on the line already.
    expect(shape.parts[0].uprights).toHaveLength(1);
    close(shape.parts[0].uprights[0], [[10, 5], [10, 0]]);
    close(shape.parts[0].areas[0], [[0, 0], [10, 5], [10, 0], [0, 0]]);
    expect(shape.peak).toMatchObject({ t: 1, v: 10 });
    close([shape.peak!.at, ...shape.ends], [[10, 5], [0, 0], [10, 0]]);
  });

  it("can lie on the other side, run from the far end, and cover part of the member", () => {
    const { sk, l } = setup();
    const d = on(sk, l, { side: -1 });
    close(diagramShape(sk, d)!.parts[0].lines[0], [[0, 0], [10, -5]]);
    d.side = 1;
    d.back = true;
    close(diagramShape(sk, d)!.parts[0].lines[0], [[10, 0], [0, 5]]);
    delete d.back;
    d.t0 = 0.2;
    d.t1 = 0.7;
    const shape = diagramShape(sk, d)!;
    close(shape.parts[0].lines[0], [[2, 0], [7, 5]]);
    close(shape.ends, [[2, 0], [7, 0]]);
    d.scale = 0.1;
    close(diagramShape(sk, d)!.parts[0].lines[0], [[2, 0], [7, 1]]);
  });

  it("draws the jumps of a function in pieces, and is not cut off at the edge of the plot", () => {
    const { sk, l, plot } = setup([{ expr: "6 - 2x", from: 0, to: 2 }, { expr: "-3", from: 2, to: 5 }]);
    plot.y = { min: -1, max: 1, label: "" }; // far too small a range for these values
    const shape = diagramShape(sk, on(sk, l))!;
    close(shape.parts[0].lines[0], [[0, 3], [4, 1]]);
    close(shape.parts[0].lines[1], [[4, -1.5], [10, -1.5]]);
    // Up from the line at the start, across the jump, and back to the line at the end.
    expect(shape.parts[0].uprights.map((u) => u.map((q) => q.map((v) => Number(v.toFixed(6)))))).toEqual([[[0, 0], [0, 3]], [[4, 1], [4, -1.5]], [[10, -1.5], [10, 0]]]);
    expect(shape.peak).toMatchObject({ t: 0, v: 6 });
    // With the jumps switched off for the function, only the ends are closed.
    plot.curves[0].join = false;
    expect(diagramShape(sk, sk.symbols[0] as Diagram)!.parts[0].uprights).toHaveLength(2);
  });

  it("follows an arc, with its values set off towards the centre or away from it", () => {
    const sk = emptySketch();
    const arc = addArc(sk, addPoint(sk, 0, 0).id, addPoint(sk, 5, 0).id, addPoint(sk, 0, 5).id);
    sk.plots = [{ id: "g1", name: "N", width: 60, height: 40, x: { min: 0, max: 1, label: "" }, y: { min: -2, max: 2, label: "" }, curves: [{ id: "f1", color: RED, pieces: [{ expr: "1" }] }] }];
    const d = addSymbol(sk, { type: "diagram", plot: "g1", on: arc.id, t0: 0, t1: 1, side: -1, scale: 2 });
    const [line] = diagramShape(sk, d)!.parts[0].lines;
    // A constant along a quarter circle is a quarter circle 2 further out: a point every two degrees, not just its ends.
    expect(line.length).toBeGreaterThanOrEqual(46);
    for (const q of line) expect(Math.hypot(q[0], q[1])).toBeCloseTo(7, 6);
    close([line[0], line[line.length - 1]], [[7, 0], [0, 7]]);
    d.side = 1;
    for (const q of diagramShape(sk, d)!.parts[0].lines[0]) expect(Math.hypot(q[0], q[1])).toBeCloseTo(3, 6);
    // The shaded area goes out along the curve and back along the arc.
    const [area] = diagramShape(sk, d)!.parts[0].areas;
    expect(area).toHaveLength(2 * line.length);
    expect(Math.hypot(...area[area.length - 1])).toBeCloseTo(5, 6);
  });

  it("draws strokes from the member to the curve, and notes the values at ends, jumps and peaks", () => {
    const { sk, l } = setup([{ expr: "x(4 - x)", from: 0, to: 4 }, { expr: "-2", from: 4, to: 5 }]);
    const d = on(sk, l, { strokes: 4, values: true, scale: 1 });
    const part = diagramShape(sk, d)!.parts[0];
    // Four strokes, evenly spaced between the ends: at x = 1, 2, 3 and 4 of the plot. At 4 the first piece is back at zero.
    expect(part.strokes.map(([a, b]) => [a[0], Number(b[1].toFixed(6))])).toEqual([[2, 3], [4, 4], [6, 3]]);
    // The peak of the parabola and the two ends of the last piece; zeros are not written.
    expect(part.values.map((v) => [valueText(v.v), Number(v.at[0].toFixed(3))])).toEqual([["4", 4], ["-2", 8], ["-2", 10]]);
    // Each is written on the far side of the curve from the member.
    expect(part.values[0].out[1]).toBeCloseTo(1);
    expect(part.values[1].out[1]).toBeCloseTo(-1);
    expect(valueText(12.345678)).toBe("12.35");
    expect(valueText(1 / 3)).toBe("0.3333");
  });
});

describe("a diagram in the figure", () => {
  const of = (sk: Sketch, id: string): Prim[] => buildPrims(sk, 10, { editor: false }).filter((p) => p.ref === id);

  it("is shaded under everything, drawn in the colours of its plot, and closed down to its member", () => {
    const { sk, l, plot } = setup();
    plot.curves[0].weight = 1.2;
    plot.curves[0].dash = "dashed";
    const d = on(sk, l);
    const all = buildPrims(sk, 10, { editor: false });
    expect(all[0]).toMatchObject({ k: "region", ref: d.id, color: tint(RED, PLOT.shade), layer: "fill" });
    const [, curve, upright] = of(sk, d.id);
    expect(curve).toMatchObject({ k: "path", pts: [[0, 0], [100, 50]], ink: RED, dash: [2, 1.2] });
    expect(curve.k === "path" && curve.width).toBeCloseTo(1.2 * 0.3515, 4);
    expect(upright).toMatchObject({ k: "path", pts: [[100, 50], [100, 0]] });
    d.plain = true;
    expect(of(sk, d.id).some((p) => p.k === "region")).toBe(false);
    // Into the files it goes as points: the SVG as a polyline, the TikZ as a plain path.
    expect(toSvg(sk)!).toContain("<polyline");
    expect(toTikz(sk)!).toMatch(/\\draw\[member, line width=1\.2pt, draw=\{rgb,255:red,211;green,47;blue,47\}, dash pattern=on 2mm off 1\.2mm\] \(0,0\) -- \(80,40\);/);
  });

  it("brings a zero line of its own along the middle of a beam, and writes its values", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0, true).id, b = addPoint(sk, 10, 0, true).id;
    const { made, autos } = straightBeam(sk, a, b, 1, "round");
    autos.forEach((c) => addConstraint(sk, c));
    sk.plots = [{ id: "g1", name: "V", width: 60, height: 40, x: { min: 0, max: 5, label: "" }, y: { min: -5, max: 5, label: "" }, curves: [{ id: "f1", color: RED, pieces: [{ expr: "3" }] }] }];
    const d = addSymbol(sk, { type: "diagram", plot: "g1", on: made[0], axis: beamAxis(sk, made[0])!, t0: 0, t1: 1, side: 1, scale: 1, values: true, strokes: 3 });
    const prims = of(sk, d.id);
    expect(prims.find((p) => p.part === "zero")).toMatchObject({ k: "path", pts: [[0, 0], [100, 0]], stroke: "dim" });
    expect(prims.filter((p) => p.part === "stroke")).toHaveLength(3);
    // The same value at both ends is written at both.
    expect(prims.filter((p) => p.part === "value").map((p) => p.k === "text" && [p.tex, p.at, p.anchor, p.ink])).toEqual([["3", [0, 30], "s", RED], ["3", [100, 30], "s", RED]]);
    // On a plain line the line is the zero.
    const { sk: plain, l } = setup();
    expect(buildPrims(plain, 10, { editor: false }).filter((p) => p.ref === on(plain, l).id).some((p) => p.part === "zero")).toBe(false);
  });

  it("goes with what it is on and with its plot", () => {
    const { sk, l } = setup();
    const d = on(sk, l);
    const back = deserialize(serialize(sk));
    expect(back.symbols).toEqual(sk.symbols);
    // A file whose plot is missing loses the diagram, not the sketch.
    const raw = JSON.parse(serialize(sk));
    delete raw.plots;
    expect(deserialize(JSON.stringify(raw)).symbols).toEqual([]);
    // Nothing to draw while its plot is gone, and no error either.
    sk.plots = [];
    expect(diagramShape(sk, d)).toBeNull();
    expect(of(sk, d.id)).toEqual([]);
    remove(sk, [l.id]);
    expect(sk.symbols).toEqual([]);
  });
});
