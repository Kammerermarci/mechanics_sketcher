import { describe, it, expect } from "vitest";
import { ORIGIN, emptySketch, addPoint, addLine, addCircle, addArc, addConstraint, addSupport, addFrame } from "../src/model";
import { mmPerUnit, geometryBox, buildPrims, anchorFor, dimTex, primDistance, textBox, arrowHeads, PAPER, type Prim } from "../src/prims";
import { texRuns } from "../src/tex";

const text = (runs: ReturnType<typeof texRuns>) => runs.map((r) => `${r.level}${r.italic ? "i" : "u"}:${r.text}`).join(" ");

describe("paper scale", () => {
  it("makes the geometry as wide as the figure width", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 1, 0), b = addPoint(sk, 5, 2);
    addLine(sk, a.id, b.id);
    expect(mmPerUnit(sk)).toBeCloseTo(80 / 4);
    sk.figureWidthMm = 120;
    expect(mmPerUnit(sk)).toBeCloseTo(30);
  });

  it("falls back to height for a vertical member, and to a default when empty", () => {
    const sk = emptySketch();
    expect(mmPerUnit(sk)).toBe(10);
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 0, 10);
    addLine(sk, a.id, b.id);
    expect(mmPerUnit(sk)).toBeCloseTo(80 / 3);
  });

  it("includes circles and only the swept part of arcs in the bounding box", () => {
    const sk = emptySketch();
    const c = addPoint(sk, 0, 0);
    addCircle(sk, c.id, 2);
    expect(geometryBox(sk)).toEqual({ x0: -2, y0: -2, x1: 2, y1: 2 });

    const sk2 = emptySketch();
    const o = addPoint(sk2, 0, 0), s = addPoint(sk2, 1, 0), e = addPoint(sk2, -1, 0);
    addArc(sk2, o.id, s.id, e.id); // upper half
    const b = geometryBox(sk2);
    expect(b.y1).toBeCloseTo(1);
    expect(b.y0).toBeCloseTo(0);
  });
});

describe("primitive list", () => {
  function beam() {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0);
    const l = addLine(sk, a.id, b.id);
    const d = addConstraint(sk, { type: "distance", a: a.id, b: b.id, mode: "aligned", value: 4, offset: -8 });
    return { sk, l, d };
  }
  const of = (prims: Prim[], id: string) => prims.filter((p) => p.ref === id);

  it("lays out a distance dimension in paper mm", () => {
    const { sk, l, d } = beam();
    const prims = buildPrims(sk, 20, { editor: false });
    expect(of(prims, l.id)).toMatchObject([{ k: "line", a: [0, 0], b: [80, 0], stroke: "member" }]);
    const dim = of(prims, d.id);
    const line = dim.find((p) => p.k === "line" && p.arrowA);
    expect(line).toMatchObject({ a: [0, -8], b: [80, -8], arrowB: true });
    const label = dim.find((p) => p.k === "text");
    expect(label).toMatchObject({ at: [40, -8], tex: "4", anchor: "n" }); // below the line
    expect(dim.filter((p) => p.k === "line")).toHaveLength(3); // two extension lines
  });

  it("uses the label instead of the value, and leaves hidden dimensions out of exports", () => {
    const { sk, d } = beam();
    d.label = " 2a ";
    expect(dimTex(d)).toBe("2a");
    d.hidden = true;
    expect(of(buildPrims(sk, 20, { editor: false }), d.id)).toHaveLength(0);
    const shown = of(buildPrims(sk, 20, { editor: true }), d.id);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((p) => p.ghost)).toBe(true);
  });

  it("leaves construction geometry out of exports", () => {
    const { sk, l } = beam();
    l.construction = true;
    expect(of(buildPrims(sk, 20, { editor: false }), l.id)).toHaveLength(0);
    expect(of(buildPrims(sk, 20, { editor: true }), l.id)).toMatchObject([{ stroke: "construction" }]);
  });

  it("draws an angle dimension as an arc between the two members", () => {
    const sk = emptySketch();
    const o = addPoint(sk, 0, 0), a = addPoint(sk, 4, 0), b = addPoint(sk, 0, 3);
    const l1 = addLine(sk, o.id, a.id), l2 = addLine(sk, o.id, b.id);
    const d = addConstraint(sk, { type: "angle", l1: l1.id, rev1: false, l2: l2.id, rev2: false, value: Math.PI / 2, radius: 10 });
    const arc = buildPrims(sk, 10, { editor: false }).find((p) => p.ref === d.id && p.k === "arc");
    expect(arc).toMatchObject({ c: [0, 0], r: 10, a0: 0 });
    expect(arc && arc.k === "arc" && arc.a1).toBeCloseTo(Math.PI / 2);
    expect(dimTex(d)).toBe("90^\\circ");
  });

  it("chooses the text anchor that faces back towards what is labelled", () => {
    expect(anchorFor([0, -1])).toBe("n");
    expect(anchorFor([0, 1])).toBe("s");
    expect(anchorFor([1, 0])).toBe("w");
    expect(anchorFor([-1, 0])).toBe("e");
    expect(anchorFor([1, 1])).toBe("sw");
  });

  it("measures distance to primitives for picking", () => {
    expect(primDistance({ k: "line", a: [0, 0], b: [10, 0], stroke: "member", layer: "geom" }, [5, 3])).toBeCloseTo(3);
    expect(primDistance({ k: "circle", c: [0, 0], r: 5, stroke: "member", layer: "geom" }, [0, 7])).toBeCloseTo(2);
    const arc: Prim = { k: "arc", c: [0, 0], r: 5, a0: 0, a1: Math.PI / 2, stroke: "member", layer: "geom" };
    expect(primDistance(arc, [4, 4])).toBeCloseTo(Math.hypot(4, 4) - 5);
    expect(primDistance(arc, [0, -5])).toBeCloseTo(Math.hypot(5, 5)); // outside the sweep: nearest end
    const label: Prim = { k: "text", at: [0, 0], tex: "2a", anchor: "n", layer: "dim" };
    const box = textBox(label);
    expect(box.y1).toBeCloseTo(-PAPER.textSep);
    expect(primDistance(label, [0, (box.y0 + box.y1) / 2])).toBe(0);
  });

  it("puts arrowheads at the ends that ask for one", () => {
    const heads = arrowHeads({ k: "line", a: [0, 0], b: [10, 0], stroke: "dim", layer: "dim", arrowB: true });
    expect(heads).toHaveLength(1);
    expect(heads[0][0]).toEqual([10, 0]);
    expect(heads[0][1][0]).toBeCloseTo(10 - PAPER.arrowLen);
  });
});

describe("symbols", () => {
  const of = (prims: Prim[], id: string) => prims.filter((p) => p.ref === id);

  it("ignores an unused origin when sizing the figure", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 10, 5), b = addPoint(sk, 14, 5);
    addLine(sk, a.id, b.id);
    expect(geometryBox(sk)).toEqual({ x0: 10, y0: 5, x1: 14, y1: 5 });
    addLine(sk, ORIGIN, a.id);
    expect(geometryBox(sk).x0).toBe(0);
  });

  it("draws a pin support under its joint, in paper sizes", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 2, 1);
    const pin = addSupport(sk, "pin", a.id);
    const prims = of(buildPrims(sk, 10, { editor: false }), pin.id);
    const tri = prims.find((p) => p.k === "poly");
    expect(tri).toMatchObject({ pts: [[20, 10], [20 - PAPER.supportHalfWidth, 10 - PAPER.pinHeight], [20 + PAPER.supportHalfWidth, 10 - PAPER.pinHeight]], fill: "paper" });
    const ground = prims.find((p) => p.k === "line" && p.stroke === "symbol");
    expect(ground).toMatchObject({ a: [20 - PAPER.groundHalfWidth, 10 - PAPER.pinHeight], b: [20 + PAPER.groundHalfWidth, 10 - PAPER.pinHeight] });
    expect(prims.filter((p) => p.k === "line" && p.stroke === "hatch").length).toBeGreaterThan(4);
    // The same support on a figure drawn twice as large stays the same size.
    const big = of(buildPrims(sk, 20, { editor: false }), pin.id).find((p) => p.k === "poly");
    expect(big && big.k === "poly" && big.pts[0][1] - big.pts[1][1]).toBeCloseTo(PAPER.pinHeight);
  });

  it("turns a support with its angle", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0);
    const wall = addSupport(sk, "fixed", a.id, Math.PI / 2); // ground to the right of the joint
    const prims = of(buildPrims(sk, 10, { editor: false }), wall.id);
    const face = prims.find((p) => p.k === "line" && p.stroke === "member");
    expect(face && face.k === "line" && face.a[0]).toBeCloseTo(0);
    expect(face && face.k === "line" && Math.abs(face.a[1])).toBeCloseTo(PAPER.groundHalfWidth);
    const hatch = prims.filter((p) => p.k === "line" && p.stroke === "hatch");
    expect(hatch.every((p) => p.k === "line" && p.b[0] > 0)).toBe(true);
    expect(prims.some((p) => p.k === "poly")).toBe(false);
  });

  it("gives a roller two wheels", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0);
    const roller = addSupport(sk, "roller", a.id);
    const circles = of(buildPrims(sk, 10, { editor: false }), roller.id).filter((p) => p.k === "circle");
    expect(circles.filter((p) => p.k === "circle" && p.r === PAPER.wheelRadius)).toHaveLength(2);
  });

  it("draws coordinate axes with arrows and labels, free or pinned to a joint", () => {
    const sk = emptySketch();
    const free = addFrame(sk, 1, 2);
    let prims = of(buildPrims(sk, 10, { editor: false }), free.id);
    const arrows = prims.filter((p) => p.k === "line");
    expect(arrows).toMatchObject([{ a: [10, 20], b: [20, 20], arrowB: true }, { a: [10, 20], arrowB: true }]);
    expect(arrows[1].k === "line" && arrows[1].b[1]).toBeCloseTo(30);
    expect(prims.filter((p) => p.k === "text").map((p) => p.k === "text" && p.tex)).toEqual(["x", "y"]);

    const joint = addPoint(sk, 5, 5);
    free.at = joint.id;
    free.yLabel = "";
    prims = of(buildPrims(sk, 10, { editor: false }), free.id);
    expect(prims.find((p) => p.k === "line")).toMatchObject({ a: [50, 50] });
    expect(prims.filter((p) => p.k === "text")).toHaveLength(1);
  });

  it("picks a filled support by clicking inside it", () => {
    const tri: Prim = { k: "poly", pts: [[0, 0], [-2, -4], [2, -4]], stroke: "symbol", fill: "paper", layer: "sym" };
    expect(primDistance(tri, [0, -2])).toBe(0);
    expect(primDistance(tri, [3, -4])).toBeCloseTo(1);
  });
});

describe("label preview", () => {
  it("sets letters in italics and digits upright", () => {
    expect(text(texRuns("2a"))).toBe("0u:2 0i:a");
  });
  it("handles subscripts, superscripts and groups", () => {
    expect(text(texRuns("F_1"))).toBe("0i:F -1u:1");
    expect(text(texRuns("v_{0x}^2"))).toBe("0i:v -1u:0 -1i:x 1u:2");
  });
  it("maps Greek letters and symbols", () => {
    expect(text(texRuns("\\alpha"))).toBe("0i:α");
    expect(text(texRuns("60^\\circ"))).toBe("0u:60 1u:∘");
    expect(text(texRuns("\\Omega t"))).toBe("0u:Ω 0i:t");
  });
  it("keeps \\mathrm upright and attaches accents", () => {
    expect(text(texRuns("m_\\mathrm{A}"))).toBe("0i:m -1u:A");
    expect(texRuns("\\vec{F}_1")[0].text).toBe("F\u20D7");
    expect(texRuns("a\\dot{x}")[0].text).toBe("ax\u0307");
  });
  it("survives unbalanced input", () => {
    expect(() => texRuns("F_{1")).not.toThrow();
    expect(() => texRuns("}a^")).not.toThrow();
    expect(() => texRuns("\\")).not.toThrow();
  });
});
