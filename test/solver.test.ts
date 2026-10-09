import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import { SketchSolver } from "../src/solver";
import {
  ORIGIN, emptySketch, addPoint, addLine, addCircle, addArc, addConstraint, addSupport, addFrame,
  point, remove, isFixed, serialize, deserialize, type Sketch, type Line, type Circle,
} from "../src/model";

let solver: SketchSolver;
beforeAll(async () => { solver = new SketchSolver(await make_gcs_wrapper()); });
afterAll(() => solver.dispose());

const xy = (sk: Sketch, id: string) => { const p = point(sk, id); return [p.x, p.y]; };
const close = (got: number[], want: number[], digits = 6) =>
  got.forEach((v, i) => expect(v).toBeCloseTo(want[i], digits));

/** Isosceles triangle: fixed A, horizontal base AB, equal legs, base and height dimensions. */
function triangle(base: number, height: number) {
  const sk = emptySketch();
  const A = addPoint(sk, 0, 0), B = addPoint(sk, 3.7, 0.4), C = addPoint(sk, 1.6, 2.2);
  const ab = addLine(sk, A.id, B.id), bc = addLine(sk, B.id, C.id), ca = addLine(sk, C.id, A.id);
  addConstraint(sk, { type: "fixed", p: A.id });
  addConstraint(sk, { type: "horizontal", a: A.id, b: B.id });
  addConstraint(sk, { type: "equal", a: bc.id, b: ca.id });
  const dBase = addConstraint(sk, { type: "distance", a: A.id, b: B.id, mode: "aligned", value: base, offset: -8 });
  const dH = addConstraint(sk, { type: "distance", a: A.id, b: C.id, mode: "vertical", value: height, offset: 8 });
  return { sk, A, B, C, ab, dBase, dH };
}

describe("solving", () => {
  it("solves a fully dimensioned truss triangle", () => {
    const { sk, A, B, C } = triangle(4, 3);
    const r = solver.solve(sk);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(0);
    close(xy(sk, A.id), [0, 0]);
    close(xy(sk, B.id), [4, 0]);
    close(xy(sk, C.id), [2, 3]);
  });

  it("re-solves the whole drawing when a dimension changes", () => {
    const { sk, B, C, dBase, dH } = triangle(4, 3);
    solver.solve(sk);
    dBase.value = 6;
    dH.value = 2;
    expect(solver.solve(sk).ok).toBe(true);
    close(xy(sk, B.id), [6, 0]);
    close(xy(sk, C.id), [3, 2]);
  });

  it("counts degrees of freedom as constraints are added", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 3, 1);
    addLine(sk, a.id, b.id);
    expect(solver.solve(sk).dof).toBe(4);
    addConstraint(sk, { type: "fixed", p: a.id });
    expect(solver.solve(sk).dof).toBe(2);
    addConstraint(sk, { type: "horizontal", a: a.id, b: b.id });
    expect(solver.solve(sk).dof).toBe(1);
    addConstraint(sk, { type: "distance", a: a.id, b: b.id, mode: "aligned", value: 5, offset: 8 });
    const r = solver.solve(sk);
    expect(r.dof).toBe(0);
    close(xy(sk, b.id), [5, 0]);
  });

  it("keeps points on their side for horizontal and vertical distances", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, -2, -1);
    addConstraint(sk, { type: "fixed", p: a.id });
    addConstraint(sk, { type: "distance", a: a.id, b: b.id, mode: "horizontal", value: 5, offset: 8 });
    addConstraint(sk, { type: "distance", a: a.id, b: b.id, mode: "vertical", value: 3, offset: 8 });
    expect(solver.solve(sk).ok).toBe(true);
    close(xy(sk, b.id), [-5, -3]);
  });

  it("drives the angle between two members", () => {
    const sk = emptySketch();
    const o = addPoint(sk, 0, 0), a = addPoint(sk, 4, 0.3), b = addPoint(sk, 2, 2.5);
    const l1 = addLine(sk, o.id, a.id), l2 = addLine(sk, o.id, b.id);
    addConstraint(sk, { type: "fixed", p: o.id });
    addConstraint(sk, { type: "horizontal", a: o.id, b: a.id });
    addConstraint(sk, { type: "distance", a: o.id, b: b.id, mode: "aligned", value: 2, offset: 8 });
    const ang = addConstraint(sk, { type: "angle", l1: l1.id, rev1: false, l2: l2.id, rev2: false, value: Math.PI / 3, radius: 10 });
    expect(solver.solve(sk).ok).toBe(true);
    close(xy(sk, b.id), [1, Math.sqrt(3)]);
    ang.value = (2 * Math.PI) / 3;
    expect(solver.solve(sk).ok).toBe(true);
    close(xy(sk, b.id), [-1, Math.sqrt(3)]);
  });

  it("honours reversed line directions in an angle", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 4, 0.2), o = addPoint(sk, 0, 0), b = addPoint(sk, 2, 2.5);
    const l1 = addLine(sk, a.id, o.id); // drawn towards the joint
    const l2 = addLine(sk, o.id, b.id);
    addConstraint(sk, { type: "fixed", p: o.id });
    addConstraint(sk, { type: "horizontal", a: o.id, b: a.id });
    addConstraint(sk, { type: "distance", a: o.id, b: b.id, mode: "aligned", value: 2, offset: 8 });
    addConstraint(sk, { type: "angle", l1: l1.id, rev1: true, l2: l2.id, rev2: false, value: Math.PI / 4, radius: 10 });
    expect(solver.solve(sk).ok).toBe(true);
    close(xy(sk, b.id), [Math.SQRT2, Math.SQRT2]);
  });

  it("handles parallel, perpendicular and midpoint", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0.1), c = addPoint(sk, 0.2, 2), d = addPoint(sk, 4.3, 2.4);
    const m = addPoint(sk, 1.5, 0.4, true);
    const ab = addLine(sk, a.id, b.id), cd = addLine(sk, c.id, d.id), ac = addLine(sk, a.id, c.id);
    addConstraint(sk, { type: "fixed", p: a.id });
    addConstraint(sk, { type: "horizontal", a: a.id, b: b.id });
    addConstraint(sk, { type: "parallel", l1: ab.id, l2: cd.id });
    addConstraint(sk, { type: "perpendicular", l1: ab.id, l2: ac.id });
    addConstraint(sk, { type: "midpoint", p: m.id, l: ab.id });
    addConstraint(sk, { type: "distance", a: a.id, b: b.id, mode: "aligned", value: 4, offset: 8 });
    expect(solver.solve(sk).ok).toBe(true);
    expect(point(sk, c.id).x).toBeCloseTo(0, 6);
    expect(point(sk, d.id).y).toBeCloseTo(point(sk, c.id).y, 6);
    close(xy(sk, m.id), [2, 0]);
  });

  it("handles circles: radius, tangent line, point on rim, equal radius", () => {
    const sk = emptySketch();
    const c = addPoint(sk, 0, 0), c2 = addPoint(sk, 6, 1);
    const circ = addCircle(sk, c.id, 1.3) as Circle, circ2 = addCircle(sk, c2.id, 0.7) as Circle;
    const a = addPoint(sk, -3, 2.2), b = addPoint(sk, 3, 1.8), q = addPoint(sk, 1.8, 0.2, true);
    const l = addLine(sk, a.id, b.id) as Line;
    addConstraint(sk, { type: "fixed", p: c.id });
    addConstraint(sk, { type: "radius", target: circ.id, value: 2, angle: 0.5 });
    addConstraint(sk, { type: "horizontal", a: a.id, b: b.id });
    addConstraint(sk, { type: "tangent", l: l.id, c: circ.id });
    addConstraint(sk, { type: "pointOn", p: q.id, on: circ.id });
    addConstraint(sk, { type: "equal", a: circ.id, b: circ2.id });
    expect(solver.solve(sk).ok).toBe(true);
    expect(circ.r).toBeCloseTo(2, 6);
    expect(circ2.r).toBeCloseTo(2, 6);
    expect(point(sk, a.id).y).toBeCloseTo(2, 6);
    const pq = point(sk, q.id);
    expect(Math.hypot(pq.x, pq.y)).toBeCloseTo(2, 6);
  });

  it("keeps arc endpoints on the arc and drives its radius", () => {
    const sk = emptySketch();
    const c = addPoint(sk, 0, 0), s = addPoint(sk, 2, 0), e = addPoint(sk, 0.1, 2.4);
    const arc = addArc(sk, c.id, s.id, e.id);
    addConstraint(sk, { type: "fixed", p: c.id });
    addConstraint(sk, { type: "horizontal", a: c.id, b: s.id });
    addConstraint(sk, { type: "vertical", a: c.id, b: e.id });
    addConstraint(sk, { type: "radius", target: arc.id, value: 3, angle: 0.5 });
    const r = solver.solve(sk);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(0);
    close(xy(sk, s.id), [3, 0]);
    close(xy(sk, e.id), [0, 3]);
  });
});

describe("dragging", () => {
  it("pulls a point towards the pointer without breaking constraints", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 5, 0);
    addLine(sk, a.id, b.id);
    addConstraint(sk, { type: "fixed", p: a.id });
    addConstraint(sk, { type: "distance", a: a.id, b: b.id, mode: "aligned", value: 5, offset: 8 });
    const r = solver.solve(sk, [{ kind: "point", id: b.id, x: 3, y: 10 }]);
    expect(r.ok).toBe(true);
    const p = point(sk, b.id);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(5, 5);
    expect(Math.atan2(p.y, p.x)).toBeCloseTo(Math.atan2(10, 3), 2);
    expect(r.dof).toBe(1); // the drag does not use up freedom
  });

  it("moves a free point exactly to the pointer", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 5, 0);
    addLine(sk, a.id, b.id);
    expect(solver.solve(sk, [{ kind: "point", id: b.id, x: 7, y: 2 }]).ok).toBe(true);
    close(xy(sk, b.id), [7, 2], 5);
    close(xy(sk, a.id), [0, 0], 5);
  });

  it("does not move a fixed point", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 1, 1);
    addConstraint(sk, { type: "fixed", p: a.id });
    solver.solve(sk, [{ kind: "point", id: a.id, x: 9, y: 9 }]);
    close(xy(sk, a.id), [1, 1]);
  });

  it("resizes a circle by its rim", () => {
    const sk = emptySketch();
    const c = addPoint(sk, 0, 0);
    const circ = addCircle(sk, c.id, 1);
    addConstraint(sk, { type: "fixed", p: c.id });
    expect(solver.solve(sk, [{ kind: "rim", id: circ.id, x: 3, y: 4 }]).ok).toBe(true);
    expect(circ.r).toBeCloseTo(5, 5);
  });
});

describe("diagnosis", () => {
  it("reports conflicting constraints and leaves the sketch alone", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0);
    addLine(sk, a.id, b.id);
    addConstraint(sk, { type: "fixed", p: a.id });
    addConstraint(sk, { type: "distance", a: a.id, b: b.id, mode: "aligned", value: 4, offset: 8 });
    addConstraint(sk, { type: "horizontal", a: a.id, b: b.id });
    const v = addConstraint(sk, { type: "vertical", a: a.id, b: b.id });
    const r = solver.solve(sk);
    expect(r.conflicting.length).toBeGreaterThan(0);
    expect(r.conflicting).toContain(v.id);
    close(xy(sk, b.id), [4, 0]);
  });

  it("reports redundant constraints", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0.2);
    addLine(sk, a.id, b.id);
    addConstraint(sk, { type: "horizontal", a: a.id, b: b.id });
    const dup = addConstraint(sk, { type: "horizontal", a: a.id, b: b.id });
    const r = solver.solve(sk);
    expect(r.redundant).toContain(dup.id);
  });
});

describe("freedom", () => {
  it("tells apart the joints that are pinned down from those that can still move", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0.2), c = addPoint(sk, 2, 3);
    addLine(sk, a.id, b.id);
    addLine(sk, b.id, c.id);
    addConstraint(sk, { type: "fixed", p: a.id });
    addConstraint(sk, { type: "horizontal", a: a.id, b: b.id });
    addConstraint(sk, { type: "distance", a: a.id, b: b.id, mode: "aligned", value: 4, offset: 8 });
    const before = structuredClone(sk);
    const f = solver.freedom(sk)!;
    expect([...f.points]).toEqual([c.id]); // a is fixed, b is fully determined, c is loose
    expect(sk).toEqual(before); // probing leaves the sketch alone
    addConstraint(sk, { type: "distance", a: b.id, b: c.id, mode: "aligned", value: 3, offset: 8 });
    expect([...solver.freedom(sk)!.points]).toEqual([c.id]); // still one way to move
    addConstraint(sk, { type: "vertical", a: b.id, b: c.id });
    expect(solver.freedom(sk)!.points.size).toBe(0);
  });

  it("tracks a circle's radius separately from its centre", () => {
    const sk = emptySketch();
    const c = addPoint(sk, 1, 1);
    const circ = addCircle(sk, c.id, 2);
    let f = solver.freedom(sk)!;
    expect(f.points.has(c.id)).toBe(true);
    expect(f.radii.has(circ.id)).toBe(true);
    addConstraint(sk, { type: "fixed", p: c.id });
    f = solver.freedom(sk)!;
    expect(f.points.size).toBe(0);
    expect(f.radii.has(circ.id)).toBe(true);
    addConstraint(sk, { type: "radius", target: circ.id, value: 2, angle: 0 });
    expect(solver.freedom(sk)!.radii.size).toBe(0);
  });
});

describe("model", () => {
  it("cleans up endpoints and constraints when a line is deleted", () => {
    const { sk, A, B, C, ab } = triangle(4, 3);
    remove(sk, [ab.id]);
    // A, B and C are still used by the other two members.
    expect(sk.entities.filter((e) => e.type === "point").map((e) => e.id)).toEqual([ORIGIN, A.id, B.id, C.id]);
    remove(sk, [C.id]);
    // Deleting C takes both remaining members, then the bare endpoints. Only the origin is left.
    expect(sk.entities.map((e) => e.id)).toEqual([ORIGIN]);
    expect(sk.constraints).toEqual([]);
  });

  it("keeps points placed with the Point tool", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0, true), b = addPoint(sk, 1, 0);
    const l = addLine(sk, a.id, b.id);
    remove(sk, [l.id]);
    expect(sk.entities.map((e) => e.id)).toEqual([ORIGIN, a.id]);
  });

  it("always has a fixed origin that cannot be deleted or dragged", () => {
    const sk = emptySketch();
    expect(isFixed(sk, ORIGIN)).toBe(true);
    remove(sk, [ORIGIN]);
    expect(sk.entities.map((e) => e.id)).toEqual([ORIGIN]);
    expect(solver.solve(sk, [{ kind: "point", id: ORIGIN, x: 5, y: 5 }]).ok).toBe(true);
    close(xy(sk, ORIGIN), [0, 0]);
    expect(solver.solve(sk).dof).toBe(0); // the origin adds no freedom
  });

  it("lets geometry be dimensioned against the origin", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 2.2, 0.3, true);
    addConstraint(sk, { type: "horizontal", a: ORIGIN, b: a.id });
    addConstraint(sk, { type: "distance", a: ORIGIN, b: a.id, mode: "aligned", value: 3, offset: 8 });
    const r = solver.solve(sk);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(0);
    close(xy(sk, a.id), [3, 0]);
  });

  it("drops a support with its joint, and keeps free-standing axes", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0);
    const l = addLine(sk, a.id, b.id);
    const pin = addSupport(sk, "pin", a.id);
    const roller = addSupport(sk, "roller", b.id);
    const axes = addFrame(sk, 1, 1);
    remove(sk, [roller.id]);
    expect(sk.symbols.map((x) => x.id)).toEqual([pin.id, axes.id]);
    remove(sk, [l.id]); // takes both endpoints, and the pin with its joint
    expect(sk.symbols.map((x) => x.id)).toEqual([axes.id]);
  });

  it("opens files saved before the origin and symbols existed", () => {
    const old = JSON.stringify({ version: 1, nextId: 2, entities: [{ id: "p1", type: "point", x: 1, y: 2 }], constraints: [], figureWidthMm: 60 });
    const sk = deserialize(old);
    expect(sk.entities.map((e) => e.id)).toEqual([ORIGIN, "p1"]);
    expect(sk.symbols).toEqual([]);
    expect(sk.showOrigin).toBe(true);
    expect(sk.figureWidthMm).toBe(60);
  });

  it("round-trips through JSON", () => {
    const { sk } = triangle(4, 3);
    expect(deserialize(serialize(sk))).toEqual(sk);
    expect(() => deserialize('{"hello":1}')).toThrow();
  });
});
