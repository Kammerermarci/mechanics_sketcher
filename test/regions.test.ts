import { describe, it, expect } from "vitest";
import {
  emptySketch, addPoint, addLine, addCircle, addArc, addSymbol, addFrame, remove, deserialize, serialize,
  type Sketch, type Point,
} from "../src/model";
import { findFaces, regionAt, findOverlaps } from "../src/regions";
import {
  buildPrims, fillOutlines, outlinePolygon, primDistance, mmPerUnit, figureWidth, balloonRadius, PAPER, type Prim,
} from "../src/prims";

const sq = (sk: Sketch, x: number, y: number, s: number): Point[] => {
  const p = [addPoint(sk, x, y), addPoint(sk, x + s, y), addPoint(sk, x + s, y + s), addPoint(sk, x, y + s)];
  p.forEach((a, i) => addLine(sk, a.id, p[(i + 1) % 4].id));
  return p;
};
const of = (prims: Prim[], id: string) => prims.filter((p) => p.ref === id);

describe("closed regions", () => {
  it("finds the inside of a square and nothing outside it", () => {
    const sk = emptySketch();
    const p = sq(sk, 0, 0, 4);
    const faces = findFaces(sk);
    expect(faces).toHaveLength(1);
    expect(faces[0].area).toBeCloseTo(16);
    expect(new Set(faces[0].points)).toEqual(new Set(p.map((x) => x.id)));
    expect(regionAt(sk, [2, 2])?.kind).toBe("face");
    expect(regionAt(sk, [5, 2])).toBeNull();
  });

  it("splits a truss into its panels and picks the one clicked", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0), c = addPoint(sk, 8, 0), d = addPoint(sk, 2, 3), e = addPoint(sk, 6, 3);
    for (const [u, v] of [[a, b], [b, c], [a, d], [d, b], [b, e], [e, c], [d, e]]) addLine(sk, u.id, v.id);
    expect(findFaces(sk).map((f) => Math.round(f.area)).sort()).toEqual([6, 6, 6]);
    const r = regionAt(sk, [4, 2]);
    expect(r?.kind === "face" && new Set(r.face.points)).toEqual(new Set([b.id, d.id, e.id]));
  });

  it("ignores loose ends and treats a joint on the middle of a line as a corner", () => {
    const sk = emptySketch();
    const p = sq(sk, 0, 0, 4);
    const m = addPoint(sk, 2, 0, true);   // lies on the bottom side
    const top = addPoint(sk, 2, 4, true); // lies on the top side
    addLine(sk, m.id, top.id);            // divides the square in two
    const tail = addPoint(sk, 6, 6);
    addLine(sk, p[2].id, tail.id);        // a member sticking out
    const faces = findFaces(sk);
    expect(faces.map((f) => f.area).sort()).toEqual([8, 8]);
    const left = regionAt(sk, [1, 2]);
    expect(left?.kind === "face" && left.face.points).toContain(m.id);
    expect(left?.kind === "face" && left.face.points).not.toContain(tail.id);
  });

  it("follows arcs: a half disc is closed by its diameter", () => {
    const sk = emptySketch();
    const c = addPoint(sk, 0, 0), s = addPoint(sk, 2, 0), e = addPoint(sk, -2, 0);
    const arc = addArc(sk, c.id, s.id, e.id); // upper half
    addLine(sk, e.id, s.id);
    const faces = findFaces(sk);
    expect(faces).toHaveLength(1);
    expect(faces[0].area).toBeCloseTo(Math.PI * 2, 1);
    expect(faces[0].arcs.filter((x) => x === arc.id)).toHaveLength(1);
    expect(regionAt(sk, [0, 1])?.kind).toBe("face");
    expect(regionAt(sk, [0, -1])).toBeNull();
  });

  it("picks a circle, and leaves a circle inside a shape as a hole", () => {
    const sk = emptySketch();
    sq(sk, 0, 0, 10);
    const c = addPoint(sk, 5, 5);
    const hole = addCircle(sk, c.id, 2);
    const inCircle = regionAt(sk, [5, 5]);
    expect(inCircle).toEqual({ kind: "circle", circle: hole.id });
    const plate = regionAt(sk, [1, 1]);
    expect(plate?.kind === "face" && plate.holes).toEqual([hole.id]);
  });

  it("leaves construction lines out", () => {
    const sk = emptySketch();
    sq(sk, 0, 0, 4);
    for (const e of sk.entities) if (e.type === "line") { e.construction = true; break; }
    expect(findFaces(sk)).toHaveLength(0);
  });
});

describe("fills", () => {
  it("draws the region in its colour, with the hole cut out, and follows the geometry", () => {
    const sk = emptySketch();
    const p = sq(sk, 0, 0, 10);
    const c = addPoint(sk, 5, 5);
    addCircle(sk, c.id, 2);
    const r = regionAt(sk, [1, 1]);
    if (r?.kind !== "face") throw new Error("expected a face");
    const f = addSymbol(sk, { type: "fill", color: "#d5dbe1", points: r.face.points, arcs: r.face.arcs, curves: r.face.curves, holes: r.holes });
    const prims = buildPrims(sk, 1, { editor: false });
    expect(prims[0]).toMatchObject({ k: "region", color: "#d5dbe1", ref: f.id }); // under everything else
    expect(primDistance(prims[0], [1, 1])).toBe(0);
    expect(primDistance(prims[0], [5, 5])).toBe(Infinity); // inside the hole
    expect(primDistance(prims[0], [11, 1])).toBe(Infinity);
    p[1].x = 20; // stretch the plate
    expect(primDistance(buildPrims(sk, 1, { editor: false })[0], [15, 1])).toBe(0);
  });

  it("keeps arc sides curved", () => {
    const sk = emptySketch();
    const c = addPoint(sk, 0, 0), s = addPoint(sk, 2, 0), e = addPoint(sk, -2, 0);
    addArc(sk, c.id, s.id, e.id);
    addLine(sk, e.id, s.id);
    const face = findFaces(sk)[0];
    const f = addSymbol(sk, { type: "fill", color: "#eceff1", points: face.points, arcs: face.arcs, curves: face.curves, holes: [] });
    const outline = fillOutlines(sk, f, 1)[0];
    expect(outline.kind === "path" && outline.segs.filter((x) => x.k === "A")).toHaveLength(1);
    const poly = outlinePolygon(outline);
    expect(Math.max(...poly.map((q) => q[1]))).toBeCloseTo(2, 1); // the top of the arc is part of the outline
    expect(Math.min(...poly.map((q) => q[1]))).toBeCloseTo(0);
  });

  it("goes when a line of its boundary is deleted", () => {
    const sk = emptySketch();
    sq(sk, 0, 0, 4);
    const face = findFaces(sk)[0];
    addSymbol(sk, { type: "fill", color: "#eceff1", points: face.points, arcs: face.arcs, curves: face.curves, holes: [] });
    remove(sk, [face.curves[0]]);
    expect(sk.symbols).toHaveLength(0);
  });
});

describe("overlaps", () => {
  it("reports the stretch two lines share, and nothing for lines that only touch", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 10, 0), c = addPoint(sk, 4, 0), d = addPoint(sk, 14, 0), e = addPoint(sk, 10, 5);
    addLine(sk, a.id, b.id);
    addLine(sk, c.id, d.id); // overlaps the first from x = 4 to 10
    addLine(sk, b.id, e.id); // only meets it at a joint
    const o = findOverlaps(sk);
    expect(o.segments).toHaveLength(1);
    expect(o.segments[0][0][0]).toBeCloseTo(4);
    expect(o.segments[0][1][0]).toBeCloseTo(10);
  });

  it("does not flag segments joined end to end, or a construction line over a member", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 5, 0), c = addPoint(sk, 10, 0);
    addLine(sk, a.id, b.id);
    addLine(sk, b.id, c.id);
    expect(findOverlaps(sk).segments).toHaveLength(0);
    const helper = addLine(sk, a.id, c.id);
    expect(findOverlaps(sk).segments).toHaveLength(2);
    helper.construction = true;
    expect(findOverlaps(sk).segments).toHaveLength(0);
  });

  it("reports circles drawn twice", () => {
    const sk = emptySketch();
    const c = addPoint(sk, 1, 1), c2 = addPoint(sk, 1, 1);
    addCircle(sk, c.id, 2);
    addCircle(sk, c2.id, 2);
    addCircle(sk, c.id, 3);
    expect(findOverlaps(sk).rounds).toHaveLength(1);
  });
});

describe("annotations", () => {
  it("draws centre lines through a circle and past its rim", () => {
    const sk = emptySketch();
    const c = addPoint(sk, 1, 1);
    const circ = addCircle(sk, c.id, 1);
    const mark = addSymbol(sk, { type: "centermark", on: circ.id, angle: 0 });
    const lines = of(buildPrims(sk, 10, { editor: false }), mark.id);
    expect(lines).toHaveLength(6); // a cross and four arms
    expect(lines.every((p) => p.k === "line" && p.stroke === "centre")).toBe(true);
    const xs = lines.flatMap((p) => (p.k === "line" ? [p.a[0], p.b[0]] : []));
    expect(Math.max(...xs)).toBeCloseTo(10 + 10 + PAPER.centreOver);
    remove(sk, [circ.id]);
    expect(sk.symbols).toHaveLength(0);
  });

  it("draws a balloon with its number and a leader to what it points at", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0);
    const l = addLine(sk, a.id, b.id);
    const bal = addSymbol(sk, { type: "balloon", text: "3", on: l.id, t: 0.5, x: 0, y: 0, dx: 0, dy: 10, end: "arrow" });
    let prims = of(buildPrims(sk, 10, { editor: false }), bal.id);
    const circle = prims.find((p) => p.k === "circle");
    expect(circle).toMatchObject({ c: [20, 10], fill: "paper" });
    expect(circle && circle.k === "circle" && circle.r).toBeCloseTo(balloonRadius("3"));
    const leader = prims.find((p) => p.k === "line");
    expect(leader).toMatchObject({ a: [20, 0], arrowA: true });
    expect(prims.find((p) => p.k === "text")).toMatchObject({ tex: "3", at: [20, 10], anchor: "c" });
    b.x = 8; // the member grows: the balloon follows its middle
    prims = of(buildPrims(sk, 10, { editor: false }), bal.id);
    expect(prims.find((p) => p.k === "circle")).toMatchObject({ c: [40, 10] });
    bal.dy = 0; // sitting on the spot it points at: no leader
    expect(of(buildPrims(sk, 10, { editor: false }), bal.id).some((p) => p.k === "line")).toBe(false);
  });

  it("hatches one side of a line, and the size can be changed", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 2, 0);
    const l = addLine(sk, a.id, b.id);
    const h = addSymbol(sk, { type: "hatch", on: l.id, side: -1, spacing: 2, depth: 3 });
    let strokes = of(buildPrims(sk, 10, { editor: false }), h.id);
    expect(strokes).toHaveLength(10); // 20 mm at 2 mm spacing
    expect(strokes.every((p) => p.k === "line" && p.a[1] === 0 && Math.abs(p.b[1] + 3) < 1e-9)).toBe(true); // below the line
    h.side = 1;
    h.spacing = 5;
    strokes = of(buildPrims(sk, 10, { editor: false }), h.id);
    expect(strokes).toHaveLength(4);
    expect(strokes.every((p) => p.k === "line" && p.b[1] > 0)).toBe(true);
  });

  it("hatches the outside of a circle", () => {
    const sk = emptySketch();
    const c = addPoint(sk, 0, 0);
    const circ = addCircle(sk, c.id, 1);
    const h = addSymbol(sk, { type: "hatch", on: circ.id, side: -1, spacing: 2, depth: 2 });
    const strokes = of(buildPrims(sk, 10, { editor: false }), h.id);
    expect(strokes.length).toBe(Math.round((2 * Math.PI * 10) / 2));
    expect(strokes.every((p) => p.k === "line" && Math.hypot(...p.b) > Math.hypot(...p.a))).toBe(true);
  });

  it("gives each coordinate axis its own length", () => {
    const sk = emptySketch();
    const f = addFrame(sk, 0, 0);
    f.xSize = 20;
    f.ySize = 5;
    let arrows = of(buildPrims(sk, 10, { editor: false }), f.id).filter((p) => p.k === "line");
    expect(arrows[0]).toMatchObject({ b: [20, 0] });
    expect(arrows[1].k === "line" && arrows[1].b[1]).toBeCloseTo(5);
    f.ySize = 0;
    const prims = of(buildPrims(sk, 10, { editor: false }), f.id);
    expect(prims.filter((p) => p.k === "line")).toHaveLength(1);
    expect(prims.filter((p) => p.k === "text")).toHaveLength(1);
  });

  it("reads axes saved with one length for both", () => {
    const old = JSON.parse(serialize(emptySketch()));
    old.symbols = [{ id: "s1", type: "frame", x: 0, y: 0, angle: 0, xLabel: "x", yLabel: "y", size: 14 }];
    delete old.scaleMode;
    const sk = deserialize(JSON.stringify(old));
    expect(sk.symbols[0]).toMatchObject({ xSize: 14, ySize: 14 });
    expect(sk.symbols[0]).not.toHaveProperty("size");
    expect(sk.scaleMode).toBe("width");
  });
});

describe("paper scale modes", () => {
  it("follows the drawing in width mode and stays put in fixed mode", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0);
    addLine(sk, a.id, b.id);
    expect(mmPerUnit(sk)).toBeCloseTo(20);
    expect(figureWidth(sk)).toBeCloseTo(80);
    b.x = 8;
    expect(mmPerUnit(sk)).toBeCloseTo(10); // annotations grow relative to the geometry
    sk.scaleMode = "fixed";
    sk.mmPerUnit = 15;
    expect(mmPerUnit(sk)).toBe(15);
    b.x = 16;
    expect(mmPerUnit(sk)).toBe(15); // unchanged as the drawing grows
    expect(figureWidth(sk)).toBeCloseTo(240);
  });
});
