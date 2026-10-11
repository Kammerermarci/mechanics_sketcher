import { describe, it, expect } from "vitest";
import {
  emptySketch, addPoint, addLine, addConstraint, addSymbol, serialize, deserialize, point, type Sketch, type Line, type Load, type Moment, type LineLoad,
} from "../src/model";
import { buildPrims, loadArrow, lineLoadFrame, momentArc, loadLabel, loadReach, PAPER, type Prim } from "../src/prims";
import { toSvg, toTikz } from "../src/export";
import { mirrorCopy } from "../src/pattern";

/** A beam from (0, 0) to (10, 0), with forces drawn 2 units long per unit of magnitude. */
function beam(): { sk: Sketch; l: Line } {
  const sk = emptySketch();
  const l = addLine(sk, addPoint(sk, 0, 0).id, addPoint(sk, 10, 0).id);
  sk.loadScale = { force: 2, line: 1.5, moment: 0.5 };
  return { sk, l };
}
const of = (sk: Sketch, id: string, mm = 10): Prim[] => buildPrims(sk, mm, { editor: false }).filter((p) => p.ref === id);
const RED = "#d32f2f";

describe("forces", () => {
  it("draws an arrow whose length follows the magnitude, arriving at its point", () => {
    const { sk, l } = beam();
    const f = addSymbol(sk, { type: "load", at: l.p2, angle: -Math.PI / 2, value: 3, label: "F", color: RED });
    const [arrow, name] = of(sk, f.id);
    // 3 units of magnitude at 2 units of length each, at 10 mm a unit: 60 mm, coming down onto (10, 0).
    expect(arrow).toMatchObject({ k: "line", stroke: "arrow", arrowB: true, ink: RED, head: PAPER.arrowScale });
    if (arrow.k !== "line") throw new Error();
    expect(arrow.a[0]).toBeCloseTo(100);
    expect(arrow.a[1]).toBeCloseTo(60);
    expect(arrow.b).toEqual([100, 0]);
    // Its name stands beyond the tail, in the same colour.
    expect(name).toMatchObject({ k: "text", tex: "F", anchor: "s", ink: RED, part: "label" });
    // Half the magnitude, half the length.
    f.value = 1.5;
    expect(loadArrow(sk, f, 10).tail[1]).toBeCloseTo(30);
    // Leaving the point instead, it runs on from it the way it acts.
    f.pull = true;
    const pulled = loadArrow(sk, f, 10);
    expect(pulled.tail).toEqual([100, 0]);
    expect(pulled.tip[1]).toBeCloseTo(-30);
  });

  it("keeps a very small force long enough to be an arrow, and follows the sketch's scale", () => {
    const { sk, l } = beam();
    const f = addSymbol(sk, { type: "load", at: l.p1, angle: 0, value: 0.001, label: "", color: RED });
    const len = (s: Load) => { const a = loadArrow(sk, s, 10); return Math.hypot(a.tip[0] - a.tail[0], a.tip[1] - a.tail[1]); };
    expect(len(f)).toBeGreaterThan(PAPER.arrowLen * PAPER.arrowScale);
    f.value = 4;
    expect(len(f)).toBeCloseTo(80);
    sk.loadScale = { ...sk.loadScale, force: 1 };
    expect(len(f)).toBeCloseTo(40);
    expect(of(sk, f.id)).toHaveLength(1); // no name, no text
    // The name can be moved from where it is put.
    f.label = "F_1";
    const at = loadLabel(sk, f, 10)!.at;
    f.dx = 3;
    f.dy = -2;
    expect(loadLabel(sk, f, 10)!.at).toEqual([at[0] + 3, at[1] - 2]);
  });
});

describe("distributed loads", () => {
  const add = (sk: Sketch, l: Line, more: Partial<LineLoad> = {}) =>
    addSymbol(sk, { type: "lineload", on: l.id, t0: 0, t1: 1, q1: 2, q2: 2, side: 1, count: 6, label: "q", color: RED, ...more });

  it("draws a row of arrows under a straight envelope, on the chosen side", () => {
    const { sk, l } = beam();
    const q = add(sk, l);
    const prims = of(sk, q.id);
    const arrows = prims.filter((p) => p.k === "line" && p.arrowB);
    expect(arrows).toHaveLength(6);
    // 2 units of magnitude at 1.5 units each: 3 units, 30 mm tall, above the line and pointing down at it.
    arrows.forEach((p, i) => {
      if (p.k !== "line") throw new Error();
      expect(p.a[0]).toBeCloseTo(i * 20);
      expect(p.a[1]).toBeCloseTo(30);
      expect(p.b[1]).toBeCloseTo(0);
      expect(p.ink).toBe(RED);
    });
    expect(prims.find((p) => p.part === "envelope")).toMatchObject({ a: [0, 30], b: [100, 30] });
    expect(prims.find((p) => p.k === "text")).toMatchObject({ tex: "q", at: [50, 30], anchor: "s" });
    // On the other side, and pointing away from the line.
    q.side = -1;
    q.pull = true;
    const away = of(sk, q.id).find((p) => p.k === "line" && p.arrowB);
    expect(away).toMatchObject({ a: [0, 0] });
    expect(away?.k === "line" && away.b[1]).toBeCloseTo(-30);
  });

  it("runs down to a point where the magnitude is zero, and covers part of the line", () => {
    const { sk, l } = beam();
    const q = add(sk, l, { q1: 0, q2: 4, t0: 0.2, t1: 0.8, count: 7 });
    const f = lineLoadFrame(sk, q, 10)!;
    expect(f.s0).toEqual([20, 0]);
    expect(f.s1).toEqual([80, 0]);
    expect(f.e0).toEqual([20, 0]);
    expect(f.e1[1]).toBeCloseTo(60);
    // Where there is no height there is no arrow; the envelope still closes the triangle.
    const prims = of(sk, q.id);
    expect(prims.filter((p) => p.k === "line" && p.arrowB)).toHaveLength(6);
    expect(prims.find((p) => p.part === "envelope")).toMatchObject({ a: [20, 0] });
  });

  it("can point at an angle of its own, as weight does on a slope", () => {
    const sk = emptySketch();
    const l = addLine(sk, addPoint(sk, 0, 0).id, addPoint(sk, 10, 10).id);
    sk.loadScale = { line: 1 };
    const q = add(sk, l, { q1: 1, q2: 1, angle: -Math.PI / 2 });
    const f = lineLoadFrame(sk, q, 10)!;
    // The arrows come straight down, so their tails are straight above the line.
    expect(f.e0[0]).toBeCloseTo(0);
    expect(f.e0[1]).toBeCloseTo(10);
    expect(f.e1[0]).toBeCloseTo(100);
    expect(f.e1[1]).toBeCloseTo(110);
    expect(loadReach(sk, q)).toHaveLength(4);
  });
});

describe("moments", () => {
  it("draws three quarters of a circle whose radius follows the magnitude, with its head the way it turns", () => {
    const { sk, l } = beam();
    const m = addSymbol(sk, { type: "moment", at: l.p1, angle: 0, value: 4, label: "M", color: "#1565c0" });
    const arc = of(sk, m.id).find((p) => p.k === "arc");
    // 4 at 0.5 units each: 2 units, 20 mm.
    expect(arc).toMatchObject({ c: [0, 0], r: 20, a0: 0, a1: 1.5 * Math.PI, stroke: "arrow", arrowB: true, ink: "#1565c0" });
    expect(arc).not.toHaveProperty("arrowA");
    m.cw = true;
    const back = of(sk, m.id).find((p) => p.k === "arc");
    expect(back).toMatchObject({ arrowA: true });
    expect(back).not.toHaveProperty("arrowB");
    m.value = 0;
    expect(momentArc(sk, m as Moment, 10).r).toBeGreaterThan(2);
  });
});

describe("loads in files and exports", () => {
  it("keeps loads and their scale through a file, and goes when what it is on goes", () => {
    const { sk, l } = beam();
    addSymbol(sk, { type: "load", at: l.p2, angle: 0, value: 2, label: "F", color: RED, pull: true });
    addSymbol(sk, { type: "lineload", on: l.id, t0: 0, t1: 1, q1: 1, q2: 2, side: 1, count: 5, label: "q", color: RED });
    const back = deserialize(serialize(sk));
    expect(back.symbols).toEqual(sk.symbols);
    expect(back.loadScale).toEqual({ force: 2, line: 1.5, moment: 0.5 });
    // An older file has no scale, and none is made up for it.
    const old = JSON.parse(serialize(sk));
    delete old.loadScale;
    expect("loadScale" in deserialize(JSON.stringify(old))).toBe(false);
  });

  it("writes the colour into the TikZ and the SVG", () => {
    const { sk, l } = beam();
    addSymbol(sk, { type: "load", at: l.p2, angle: -Math.PI / 2, value: 1, label: "F", color: RED });
    addSymbol(sk, { type: "moment", at: l.p1, angle: 0, value: 4, label: "M_0", color: "#1565c0" });
    addSymbol(sk, { type: "lineload", on: l.id, t0: 0, t1: 1, q1: 1, q2: 1, side: 1, count: 3, label: "", color: "#2e7d32" });
    const tikz = toTikz(sk)!;
    const red = "{rgb,255:red,211;green,47;blue,47}", blue = "{rgb,255:red,21;green,101;blue,192}", green = "{rgb,255:red,46;green,125;blue,50}";
    expect(tikz).toMatch(new RegExp(`\\\\draw\\[arrow, draw=${red.replace(/[{}]/g, "\\$&")}, -bigtip\\] \\(80,16\\) -- \\(80,0\\);`));
    expect(tikz).toContain(`text=${red}] at (80,16) {$F$};`);
    expect(tikz).toMatch(new RegExp(`\\\\draw\\[arrow, draw=${blue.replace(/[{}]/g, "\\$&")}, -bigtip\\] \\(16,0\\) arc\\[start angle=0, end angle=270, radius=16\\];`));
    expect(tikz).toContain(`text=${blue}`);
    expect(tikz.match(new RegExp(`draw=${green.replace(/[{}]/g, "\\$&")}, -tip`, "g"))).toHaveLength(3);
    expect(tikz).toContain("bending"); // a head on an arc
    const svg = toSvg(sk)!;
    expect(svg).toContain(`stroke="${RED}"`);
    expect(svg).toContain(`fill="${RED}" stroke="none"`);
    expect(svg).toContain(`stroke="#1565c0"`);
  });

  it("mirrors loads with what they are on", () => {
    const sk = emptySketch();
    const axis = addLine(sk, addPoint(sk, 0, -5).id, addPoint(sk, 0, 5).id);
    const l = addLine(sk, addPoint(sk, 1, 0).id, addPoint(sk, 4, 0).id);
    addConstraint(sk, { type: "fixed", p: axis.p1 });
    addSymbol(sk, { type: "load", at: l.p2, angle: Math.PI / 6, value: 2, label: "F", color: RED });
    addSymbol(sk, { type: "moment", at: l.p1, angle: 0, value: 1, label: "M", color: RED });
    addSymbol(sk, { type: "lineload", on: l.id, t0: 0, t1: 0.5, q1: 1, q2: 2, side: 1, count: 4, label: "q", color: RED });
    const r = mirrorCopy(sk, [l.id], axis.id);
    if (typeof r === "string") throw new Error(r);
    const copies = sk.symbols.slice(3);
    expect(copies.map((s) => s.type)).toEqual(["load", "moment", "lineload"]);
    const [f, m, q] = copies as [Load, Moment, LineLoad];
    // A force up and to the right becomes one up and to the left.
    expect(Math.cos(f.angle)).toBeCloseTo(-Math.cos(Math.PI / 6));
    expect(Math.sin(f.angle)).toBeCloseTo(Math.sin(Math.PI / 6));
    expect(point(sk, f.at).x).toBeCloseTo(-4);
    // The moment turns the other way, and covers the mirror image of the same three quarters.
    expect(m.cw).toBe(true);
    expect(Math.cos(m.angle)).toBeCloseTo(Math.cos(Math.PI - 1.5 * Math.PI));
    expect(q.side).toBe(-1);
    expect([q.t0, q.t1, q.q1, q.q2]).toEqual([0, 0.5, 1, 2]);
  });
});
