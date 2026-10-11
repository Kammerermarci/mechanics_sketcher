import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import { SketchSolver } from "../src/solver";
import { emptySketch, addPoint, addCircle, addArc, addConstraint, entity, point, arcRadius, type Sketch, type Arc, type Line } from "../src/model";
import { straightBeam, curvedBeam, type BeamParts } from "../src/beam";

let solver: SketchSolver;
beforeAll(async () => { solver = new SketchSolver(await make_gcs_wrapper()); });
afterAll(() => solver.dispose());

/** Adds the constraints of a beam the way the app does, and solves. */
function settle(sk: Sketch, parts: BeamParts) {
  for (const a of parts.autos) addConstraint(sk, a);
  const r = solver.solve(sk);
  expect(r.ok).toBe(true);
  expect(r.conflicting).toEqual([]);
  expect(r.redundant).toEqual([]);
  return r;
}
const xy = (sk: Sketch, id: string) => [point(sk, id).x, point(sk, id).y];
const gap = (sk: Sketch, a: string, b: string) => Math.hypot(point(sk, a).x - point(sk, b).x, point(sk, a).y - point(sk, b).y);

describe("straight beam", () => {
  it("is free to move, turn, stretch and widen, and nothing else", () => {
    for (const ends of ["round", "square"] as const) {
      const sk = emptySketch();
      const a = addPoint(sk, 0, 0, ends === "square"), b = addPoint(sk, 6, 2, ends === "square");
      const parts = straightBeam(sk, a.id, b.id, 0.8, ends);
      expect(parts.made).toHaveLength(4);
      expect(settle(sk, parts).dof).toBe(5);
    }
  });
});

describe("curved beam", () => {
  /** A quarter turn about the origin at radius 5, from the x axis round to the y axis. */
  function quarter(ends: "round" | "square") {
    const sk = emptySketch();
    const o = addPoint(sk, 0, 0, true), a = addPoint(sk, 5, 0, ends === "square"), b = addPoint(sk, 0, 5, ends === "square");
    const parts = curvedBeam(sk, o.id, a.id, b.id, 1, ends);
    return { sk, o, a, b, parts };
  }

  it("has two arcs about the centre for sides, and round caps tangent to both", () => {
    const { sk, o, a, b, parts } = quarter("round");
    const [outer, inner, capA, capB] = parts.made.map((id) => entity(sk, id) as Arc);
    expect([outer.c, inner.c, capA.c, capB.c]).toEqual([o.id, o.id, a.id, b.id]);
    expect(arcRadius(sk, outer)).toBeCloseTo(6);
    expect(arcRadius(sk, inner)).toBeCloseTo(4);
    // The outline is one closed loop: every end is shared with the next piece.
    expect([outer.p1, outer.p2, inner.p1, inner.p2].sort()).toEqual([capA.p1, capA.p2, capB.p1, capB.p2].sort());
    expect(xy(sk, outer.p1)).toEqual([6, 0]);
    expect(xy(sk, outer.p2)[1]).toBeCloseTo(6);
    // Centre of the bend, where it starts and ends, its radius and its width: six freedoms.
    expect(parts.autos.map((c) => c.type)).toEqual(["tangent", "tangent", "tangent", "tangent"]);
    expect(settle(sk, parts).dof).toBe(6);
  });

  it("keeps its shape when a centre is pulled: both ends stay as far from the centre of the bend, and one width", () => {
    const { sk, o, a, b, parts } = quarter("round");
    settle(sk, parts);
    addConstraint(sk, { type: "fixed", p: o.id });
    const [outer, inner, capA, capB] = parts.made.map((id) => entity(sk, id) as Arc);
    const r = solver.solve(sk, [{ kind: "point", id: b.id, x: -3, y: 6 }]);
    expect(r.ok).toBe(true);
    expect(gap(sk, o.id, a.id)).toBeCloseTo(gap(sk, o.id, b.id), 6);
    expect(arcRadius(sk, capA)).toBeCloseTo(arcRadius(sk, capB), 6);
    // Each cap sits midway between the two sides.
    expect(arcRadius(sk, outer) - gap(sk, o.id, a.id)).toBeCloseTo(arcRadius(sk, capA), 6);
    expect(gap(sk, o.id, a.id) - arcRadius(sk, inner)).toBeCloseTo(arcRadius(sk, capA), 6);
    // A radius dimension on a cap sets the width; one on a side, the bend.
    addConstraint(sk, { type: "radius", target: capA.id, value: 0.5, angle: 0 });
    addConstraint(sk, { type: "radius", target: outer.id, value: 8, angle: 0 });
    expect(solver.solve(sk).ok).toBe(true);
    expect(arcRadius(sk, inner)).toBeCloseTo(7, 6);
    expect(gap(sk, o.id, b.id)).toBeCloseTo(7.5, 6);
  });

  it("can have square ends, each a line through the centre of the bend", () => {
    const { sk, o, a, parts } = quarter("square");
    expect(parts.made.map((id) => entity(sk, id)?.type)).toEqual(["arc", "arc", "line", "line"]);
    expect(settle(sk, parts).dof).toBe(6);
    addConstraint(sk, { type: "fixed", p: o.id });
    solver.solve(sk, [{ kind: "point", id: a.id, x: 3, y: -4 }]);
    const end = entity(sk, parts.made[2]) as Line;
    const [p, q] = [xy(sk, end.p1), xy(sk, end.p2)];
    // In line with the centre, with a at its middle.
    expect(p[0] * q[1] - p[1] * q[0]).toBeCloseTo(0, 6);
    expect((p[0] + q[0]) / 2).toBeCloseTo(point(sk, a.id).x, 6);
  });

  it("keeps its width clear of the centre", () => {
    const sk = emptySketch();
    const o = addPoint(sk, 0, 0, true), a = addPoint(sk, 2, 0), b = addPoint(sk, 0, 2);
    const parts = curvedBeam(sk, o.id, a.id, b.id, 50, "round");
    expect(arcRadius(sk, entity(sk, parts.made[1]) as Arc)).toBeGreaterThan(0.05);
    settle(sk, parts);
  });
});

describe("tangent circles and arcs", () => {
  it("holds two circles touching, and an arc touching a circle", () => {
    const sk = emptySketch();
    const c1 = addCircle(sk, addPoint(sk, 0, 0).id, 2), c2 = addCircle(sk, addPoint(sk, 5.2, 0.3).id, 3);
    addConstraint(sk, { type: "fixed", p: c1.c });
    addConstraint(sk, { type: "radius", target: c1.id, value: 2, angle: 0 });
    addConstraint(sk, { type: "radius", target: c2.id, value: 3, angle: 0 });
    addConstraint(sk, { type: "tangent", l: c1.id, c: c2.id });
    expect(solver.solve(sk).ok).toBe(true);
    expect(gap(sk, c1.c, c2.c)).toBeCloseTo(5, 6);
    const arc = addArc(sk, addPoint(sk, 0.2, -3.4).id, addPoint(sk, 1.7, -3.4).id, addPoint(sk, -1.3, -3.4).id);
    addConstraint(sk, { type: "radius", target: arc.id, value: 1.5, angle: 0 });
    addConstraint(sk, { type: "tangent", l: arc.id, c: c1.id });
    const r = solver.solve(sk);
    expect(r.ok).toBe(true);
    expect(gap(sk, arc.c, c1.c)).toBeCloseTo(3.5, 5);
  });
});
