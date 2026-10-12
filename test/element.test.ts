import { describe, it, expect } from "vitest";
import {
  emptySketch, addPoint, addLine, addArc, addCircle, addConstraint, addSymbol, isEdge, isNamed, curves, serialize, deserialize,
  type Sketch, type Line, type Arc, type ElementLook,
} from "../src/model";
import { elementPaths, elementLength, elementReach, springTurns, spiralTurns, lookOf, defaultLook, TURNS_MAX } from "../src/element";
import { buildPrims, standardWeight, DASHED, PAPER, type Prim } from "../src/prims";
import { toSvg, toTikz } from "../src/export";
import { mirrorCopy, linearCopy } from "../src/pattern";

/** A line from (0, 0) to (len, 0) drawn as an element. */
function between(len: number, element: Line["element"], look: ElementLook = { across: 2, pitch: 1 }): { sk: Sketch; l: Line } {
  const sk = emptySketch();
  const l = addLine(sk, addPoint(sk, 0, 0).id, addPoint(sk, len, 0).id);
  l.element = element;
  l.look = look;
  return { sk, l };
}
const round = (runs: number[][][]) => runs.map((r) => r.map((q) => q.map((v) => Number(v.toFixed(6)))));
const of = (sk: Sketch, id: string): Prim[] => buildPrims(sk, 10, { editor: false }).filter((p) => p.ref === id);

describe("a spring between two points", () => {
  it("is a zigzag about the line, with a straight piece at either end", () => {
    const { sk, l } = between(10, "spring", { across: 2, pitch: 2 });
    // Ends of 1.2, which leaves 7.6: four turns of 1.9 fit best at a pitch of 2.
    expect(springTurns(10, l.look!)).toBe(4);
    const [run] = elementPaths(sk, l);
    expect(round([run.slice(0, 4)])[0]).toEqual([[0, 0], [1.2, 0], [1.675, 1], [2.625, -1]]);
    expect(round([run.slice(-2)])[0]).toEqual([[8.8, 0], [10, 0]]);
    expect(run).toHaveLength(2 + 2 * 4 + 2);
    // It never leaves the strip it is as wide as.
    for (const [, y] of run) expect(Math.abs(y)).toBeLessThanOrEqual(1 + 1e-9);
    expect(elementReach(sk, l)).toBe(1);
  });

  it("gets more turns as it is pulled longer, at the spacing it was given", () => {
    const look = { across: 2, pitch: 1 };
    expect(springTurns(10, look)).toBe(8);
    expect(springTurns(20, look)).toBe(18);
    expect(springTurns(40, look)).toBe(38);
    // A short one still has a turn; an endless one stops somewhere.
    expect(springTurns(0.5, look)).toBe(1);
    expect(springTurns(1e6, look)).toBe(TURNS_MAX);
    // The turns of the longer spring are no wider apart than those of the shorter.
    const gap = (len: number) => { const { sk, l } = between(len, "spring", look); const [run] = elementPaths(sk, l); return run[4][0] - run[2][0]; };
    expect(gap(20)).toBeCloseTo(gap(40), 1);
  });

  it("is drawn as the loops of a coil instead, ending back on the line", () => {
    const { sk, l } = between(12, "spring", { across: 2, pitch: 1, coil: true });
    const [run] = elementPaths(sk, l);
    expect(round([[run[0], run[run.length - 1]]])[0]).toEqual([[0, 0], [12, 0]]);
    // Loops: the wire comes back on itself, which a zigzag never does.
    expect(run.some((q, i) => i > 0 && q[0] < run[i - 1][0] - 1e-9)).toBe(true);
    for (const [x, y] of run) {
      expect(Math.abs(y)).toBeLessThanOrEqual(1 + 1e-9);
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(12 + 1e-9);
    }
    // As many loops as fit at its pitch.
    expect(springTurns(12, l.look!)).toBe(9);
  });

  it("follows its line wherever that points", () => {
    const sk = emptySketch();
    const l = addLine(sk, addPoint(sk, 1, 1).id, addPoint(sk, 1, 11).id);
    l.element = "spring";
    l.look = { across: 2, pitch: 2 };
    const [run] = elementPaths(sk, l);
    // Going up, left of the line is towards smaller x.
    expect(round([[run[2], run[3], run[run.length - 1]]])[0]).toEqual([[0, 2.675], [2, 3.625], [1, 11]]);
  });
});

describe("a damper between two points", () => {
  it("is a rod with a piston, in a cylinder closed towards the end", () => {
    const { sk, l } = between(10, "damper", { across: 2, pitch: 1 });
    const [rod, piston, cylinder, rest] = round(elementPaths(sk, l));
    // A cylinder of 3 in the middle of the line, from 3.5 to 6.5; the piston 55 % of the way in.
    expect(rod).toEqual([[0, 0], [5.15, 0]]);
    expect(piston).toEqual([[5.15, -0.78], [5.15, 0.78]]);
    expect(cylinder).toEqual([[3.5, 1], [6.5, 1], [6.5, -1], [3.5, -1]]);
    expect(rest).toEqual([[6.5, 0], [10, 0]]);
  });

  it("can be turned round, and gives way on a short line", () => {
    const { sk, l } = between(10, "damper", { across: 2, pitch: 1, flip: true });
    const [rod, , cylinder] = round(elementPaths(sk, l));
    expect(rod).toEqual([[10, 0], [4.85, 0]]);
    expect(cylinder[0]).toEqual([6.5, 1]);
    // No longer than 70 % of the line it is on.
    const short = between(2, "damper", { across: 2, pitch: 1 });
    const [, , body] = round(elementPaths(short.sk, short.l));
    expect(body[1][0] - body[0][0]).toBeCloseTo(1.4);
  });
});

describe("a spiral spring", () => {
  it("is wound about the start of its line and ends at the other end", () => {
    const { sk, l } = between(6, "spiral", { across: 1, pitch: 2 });
    const [run] = elementPaths(sk, l);
    // It is tied to the centre, starts a pitch's half from it, and its windings are a pitch apart: (6 - 1) / 2 of them.
    expect(spiralTurns(6, l.look!)).toBeCloseTo(2.5);
    expect(run[0]).toEqual([0, 0]);
    expect(Math.hypot(...run[1])).toBeCloseTo(1);
    expect(run[run.length - 1]).toEqual([6, 0]);
    // Further out all the way, and counter-clockwise.
    for (let i = 2; i < run.length; i++) {
      expect(Math.hypot(...run[i])).toBeGreaterThan(Math.hypot(...run[i - 1]));
      expect(run[i - 1][0] * run[i][1] - run[i - 1][1] * run[i][0]).toBeGreaterThan(0);
    }
    l.look!.flip = true;
    const [back] = elementPaths(sk, l);
    expect(back[1][0] * back[2][1] - back[1][1] * back[2][0]).toBeLessThan(0);
    // In the figure it is held at its centre by a small ring, as a pin is.
    expect(of(sk, l.id).find((p) => p.part === "hub")).toMatchObject({ k: "circle", c: [0, 0], r: PAPER.hingeRadius, fill: "paper" });
    // Its name is measured from its centre, and it has no width to clear.
    expect(elementReach(sk, l)).toBe(0);
  });

  it("has more windings when it is larger, each drawn through a point every three degrees", () => {
    const look = { across: 1, pitch: 1 };
    expect(spiralTurns(4, look)).toBeCloseTo(3.5);
    expect(spiralTurns(8, look)).toBeCloseTo(7.5);
    const { sk, l } = between(8, "spiral", look);
    const [run] = elementPaths(sk, l);
    expect(run.length).toBeGreaterThanOrEqual(7.5 * 120);
    // No two points of it are further apart than a few degrees of its outermost winding.
    for (let i = 2; i < run.length; i++) expect(Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1])).toBeLessThan(8 * (Math.PI / 60) * 1.01);
  });
});

describe("an element bent round an arc", () => {
  const quarter = (element: Arc["element"], look: ElementLook) => {
    const sk = emptySketch();
    const arc = addArc(sk, addPoint(sk, 0, 0).id, addPoint(sk, 10, 0).id, addPoint(sk, 0, 10).id);
    arc.element = element;
    arc.look = look;
    return { sk, arc };
  };

  it("lays a spring along the arc, from its start to its end", () => {
    const { sk, arc } = quarter("spring", { across: 2, pitch: 2 });
    expect(elementLength(sk, arc)).toBeCloseTo(5 * Math.PI);
    const [run] = elementPaths(sk, arc);
    expect(round([[run[0], run[run.length - 1]]])[0]).toEqual([[10, 0], [0, 10]]);
    // Between 9 and 11 from the centre: one across either side of the arc.
    for (const q of run) {
      expect(Math.hypot(...q)).toBeGreaterThanOrEqual(9 - 1e-9);
      expect(Math.hypot(...q)).toBeLessThanOrEqual(11 + 1e-9);
    }
  });

  it("bends a damper round it, its walls following the arc", () => {
    const { sk, arc } = quarter("damper", { across: 2, pitch: 1 });
    const [rod, piston, cylinder] = elementPaths(sk, arc);
    // The rod and the walls are curved: points every few degrees, all at their own distance from the centre.
    expect(rod.length).toBeGreaterThan(5);
    for (const q of rod) expect(Math.hypot(...q)).toBeCloseTo(10, 9);
    expect(piston).toHaveLength(2);
    const radii = cylinder.map((q) => Number(Math.hypot(...q).toFixed(6)));
    expect(new Set(radii)).toEqual(new Set([9, 11]));
  });
});

describe("elements in the figure", () => {
  it("are drawn in place of their line, thinner than an edge, with their name beside them", () => {
    const { sk, l } = between(10, "spring", { across: 2, pitch: 2 });
    l.label = "k_1";
    const prims = of(sk, l.id);
    expect(prims.map((p) => p.k)).toEqual(["path", "text"]);
    expect(prims[0]).toMatchObject({ k: "path", stroke: "element", layer: "geom" });
    expect(prims[0].k === "path" && prims[0].pts[2]).toEqual([16.75, 10]);
    expect(standardWeight(l)).toBe(0.6);
    // The name clears the zigzag: above the line by half the width and more.
    expect(prims[1].k === "text" && prims[1].at[1]).toBeGreaterThan(10);
    expect(prims[1]).toMatchObject({ tex: "k_1", part: "label" });
    // Its own thickness, where it has one.
    l.weight = 1;
    expect(of(sk, l.id)[0]).toMatchObject({ width: 0.3515 });
    // It bounds no shape, and it is something with a name.
    expect(isEdge(l)).toBe(false);
    expect(isNamed(l)).toBe(true);
  });

  it("goes into the files as plain paths", () => {
    const { sk, l } = between(10, "damper");
    l.label = "c";
    const tikz = toTikz(sk)!;
    expect(tikz).toContain("element/.style={line width=0.6pt}");
    // One unit is 8 mm: the figure is as wide as the line is long.
    expect(tikz).toContain("\\draw[element] (28,8) -- (52,8) -- (52,-8) -- (28,-8);");
    expect(tikz).toMatch(/\\node\[inner sep=0pt\] at \([^)]*\) \{\$c\$\};/);
    expect(tikz).not.toContain("decorat");
    expect(toSvg(sk)!).toContain("<polyline");
  });

  it("makes up a look for an element that was saved without one", () => {
    const { sk, l } = between(16, "spring");
    delete l.look;
    expect(lookOf(sk, l)).toEqual(defaultLook(2));
    expect(elementPaths(sk, l)).toHaveLength(1);
    // And keeps what it has through a file.
    l.look = { across: 3, pitch: 1.5, coil: true };
    expect(curves(deserialize(serialize(sk)))[0]).toEqual(l);
  });

  it("is copied with its look; a spiral seen in a mirror winds the other way", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, -1), b = addPoint(sk, 0, 5);
    addConstraint(sk, { type: "fixed", p: a.id });
    addConstraint(sk, { type: "fixed", p: b.id });
    const axis = addLine(sk, a.id, b.id);
    const spring = addLine(sk, addPoint(sk, 1, 1).id, addPoint(sk, 4, 1).id);
    spring.element = "spring";
    spring.look = { across: 1, pitch: 0.5, coil: true };
    spring.label = "k";
    const spiral = addLine(sk, addPoint(sk, 2, 3).id, addPoint(sk, 3, 3).id);
    spiral.element = "spiral";
    spiral.look = { across: 1, pitch: 0.3 };
    const r = mirrorCopy(sk, [spring.id, spiral.id], axis.id);
    if (typeof r === "string") throw new Error(r);
    const made = curves(sk).filter((c) => r.made.includes(c.id)) as Line[];
    expect(made.map((c) => [c.element, c.look, c.label])).toEqual([
      ["spring", { across: 1, pitch: 0.5, coil: true }, "k"],
      ["spiral", { across: 1, pitch: 0.3, flip: true }, undefined],
    ]);
    // In a row nothing is turned over.
    const row = linearCopy(sk, [spiral.id], 2, [0, 2]);
    if (typeof row === "string") throw new Error(row);
    expect((curves(sk).find((c) => row.made.includes(c.id)) as Line).look).toEqual({ across: 1, pitch: 0.3 });
  });
});

describe("dashed curves", () => {
  it("are edges like any other, drawn with dashes on screen and in the files", () => {
    const sk = emptySketch();
    const l = addLine(sk, addPoint(sk, 0, 0).id, addPoint(sk, 10, 0).id);
    const c = addCircle(sk, addPoint(sk, 5, 5).id, 2);
    const arc = addArc(sk, addPoint(sk, 0, 0).id, addPoint(sk, 3, 0).id, addPoint(sk, 0, 3).id);
    for (const e of [l, c, arc]) e.dashed = true;
    expect(isEdge(l)).toBe(true);
    for (const e of [l, c, arc]) expect(of(sk, e.id)[0]).toMatchObject({ stroke: "member", dash: DASHED });
    expect(standardWeight(l)).toBe(0.8);
    const tikz = toTikz(sk)!;
    expect(tikz.match(/\\draw\[member, dash pattern=on 2mm off 1\.2mm\]/g)).toHaveLength(3);
    expect(toSvg(sk)!.match(/stroke-dasharray="2 1\.2"/g)).toHaveLength(3);
    // A helper has its own look in the editor, and is not exported at all.
    l.construction = true;
    expect(buildPrims(sk, 10, { editor: true }).find((p) => p.ref === l.id)).not.toHaveProperty("dash");
  });
});

describe("the mark of a centre of mass", () => {
  it("is a datum point drawn as a circle in quarters, two of them filled", () => {
    const sk = emptySketch();
    const p = addPoint(sk, 1, 1);
    const d = addSymbol(sk, { type: "datum", at: p.id, color: "#17201b", label: "S", dx: 3, dy: 3, mass: true });
    const prims = of(sk, d.id);
    expect(prims.map((q) => q.k)).toEqual(["circle", "poly", "poly", "text"]);
    expect(prims[0]).toMatchObject({ c: [10, 10], r: PAPER.massRadius, fill: "paper" });
    // The upper right and the lower left quarter.
    const centre = (q: Prim) => q.k === "poly" ? [q.pts.reduce((s, v) => s + v[0], 0) / q.pts.length - 10, q.pts.reduce((s, v) => s + v[1], 0) / q.pts.length - 10] : [];
    expect(centre(prims[1]).every((v) => v > 0)).toBe(true);
    expect(centre(prims[2]).every((v) => v < 0)).toBe(true);
    expect(prims[1]).toMatchObject({ fill: "ink", color: "#17201b" });
    expect(toTikz(sk)!).toContain("fill={rgb,255:red,23;green,32;blue,27}");
    // Without the flag it is the dot it always was.
    delete d.mass;
    expect(of(sk, d.id).map((q) => q.k)).toEqual(["circle", "text"]);
  });
});
