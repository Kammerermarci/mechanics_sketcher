import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import { SketchSolver } from "../src/solver";
import {
  emptySketch, addPoint, addLine, addCircle, addArc, addConstraint, addSymbol, entity, point, type Sketch, type Line, type Arc,
} from "../src/model";
import { planTrim, applyTrim, intersections } from "../src/trim";

let solver: SketchSolver;
beforeAll(async () => { solver = new SketchSolver(await make_gcs_wrapper()); });
afterAll(() => solver.dispose());

const line = (sk: Sketch, x1: number, y1: number, x2: number, y2: number): Line =>
  addLine(sk, addPoint(sk, x1, y1).id, addPoint(sk, x2, y2).id);
const ends = (sk: Sketch, l: Line) => [point(sk, l.p1), point(sk, l.p2)].map((p) => [p.x, p.y]);
const lines = (sk: Sketch) => sk.entities.filter((e): e is Line => e.type === "line");
/** Trims, then adds the suggested constraints the way the app does: only those that solve cleanly. */
function trim(sk: Sketch, id: string, at: [number, number]) {
  const plan = planTrim(sk, id, at);
  if (!plan) throw new Error("nothing to trim");
  const autos = applyTrim(sk, plan);
  for (const a of autos) addConstraint(sk, a);
  return { plan, autos, result: solver.solve(sk) };
}

describe("crossings", () => {
  it("finds where lines, circles and arcs meet, within their extents", () => {
    const sk = emptySketch();
    const h = line(sk, 0, 0, 10, 0), v = line(sk, 4, -3, 4, 3), miss = line(sk, 12, -1, 12, 1);
    expect(intersections(sk, h, v, 1e-9)).toEqual([[4, 0]]);
    expect(intersections(sk, h, miss, 1e-9)).toEqual([]);
    const c = addCircle(sk, addPoint(sk, 5, 0).id, 2);
    expect(intersections(sk, h, c, 1e-9).map((q) => q[0]).sort()).toEqual([3, 7]);
    const o = addPoint(sk, 5, 0), s = addPoint(sk, 7, 0), e = addPoint(sk, 3, 0);
    const upper = addArc(sk, o.id, s.id, e.id);
    const up = line(sk, 5, -5, 5, 5);
    const hits = intersections(sk, up, upper, 1e-9);
    expect(hits).toHaveLength(1);
    expect(hits[0][1]).toBeCloseTo(2); // only the top: the bottom is not on the arc
    const c2 = addCircle(sk, addPoint(sk, 7, 0).id, 2);
    expect(intersections(sk, c, c2, 1e-9)).toHaveLength(2);
  });
});

describe("trim", () => {
  it("cuts a line back to where another crosses it, and keeps the new end on that line", () => {
    const sk = emptySketch();
    const h = line(sk, 0, 0, 10, 0), v = line(sk, 4, -3, 4, 3);
    const { plan, autos, result } = trim(sk, h.id, [8, 0]);
    expect(plan.gone).toMatchObject({ kind: "line", a: [4, 0], b: [10, 0] });
    expect(ends(sk, h)).toEqual([[0, 0], [4, 0]]);
    expect(autos).toMatchObject([{ type: "pointOn", on: v.id }]);
    expect(result.ok).toBe(true);
    expect(sk.entities.filter((e) => e.type === "point")).toHaveLength(1 + 4); // origin, two ends each; the cut-off end is gone
  });

  it("takes the middle out of a line crossed twice, leaving two lines", () => {
    const sk = emptySketch();
    const h = line(sk, 0, 0, 10, 0);
    line(sk, 3, -2, 3, 2);
    line(sk, 7, -2, 7, 2);
    addConstraint(sk, { type: "horizontal", a: h.p1, b: h.p2 });
    const { result } = trim(sk, h.id, [5, 0]);
    expect(result.ok).toBe(true);
    const flat = lines(sk).filter((l) => Math.abs(point(sk, l.p1).y) < 1e-9 && Math.abs(point(sk, l.p2).y) < 1e-9);
    expect(flat.map((l) => ends(sk, l).map((p) => p[0]))).toEqual([[0, 3], [7, 10]]);
    // Both pieces stay horizontal.
    expect(sk.constraints.filter((c) => c.type === "horizontal")).toHaveLength(2);
  });

  it("removes a line that nothing crosses", () => {
    const sk = emptySketch();
    const h = line(sk, 0, 0, 10, 0);
    const plan = planTrim(sk, h.id, [5, 0])!;
    expect(plan.whole).toBe(true);
    applyTrim(sk, plan);
    expect(lines(sk)).toHaveLength(0);
  });

  it("ends at a joint that is already there, without a new point", () => {
    const sk = emptySketch();
    const h = line(sk, 0, 0, 10, 0);
    const foot = addPoint(sk, 6, 0), top = addPoint(sk, 6, 4);
    addLine(sk, foot.id, top.id); // a post standing on the beam
    addConstraint(sk, { type: "pointOn", p: foot.id, on: h.id });
    const { autos } = trim(sk, h.id, [8, 0]);
    expect(h.p2).toBe(foot.id);
    expect(autos).toEqual([]);
    expect(sk.constraints.filter((c) => c.type === "pointOn")).toHaveLength(0); // the foot is now the beam's end
  });

  it("turns a circle into an arc, keeping what is on the far side of the click", () => {
    const sk = emptySketch();
    const c = addCircle(sk, addPoint(sk, 0, 0).id, 5);
    line(sk, -8, 3, 8, 3); // a chord near the top
    addConstraint(sk, { type: "radius", target: c.id, value: 5, angle: 0 });
    const mark = addSymbol(sk, { type: "centermark", on: c.id, angle: 0 });
    const { plan, result } = trim(sk, c.id, [0, 5]); // click the cap above the chord
    expect(plan.whole).toBe(false);
    const arc = entity(sk, c.id) as Arc;
    expect(arc.type).toBe("arc");
    expect(point(sk, arc.p1).x).toBeCloseTo(-4); // counter-clockwise from the left crossing, under, to the right one
    expect(point(sk, arc.p2).x).toBeCloseTo(4);
    expect(point(sk, arc.p1).y).toBeCloseTo(3);
    expect(result.ok).toBe(true);
    expect(sk.constraints.some((k) => k.type === "radius" && k.target === c.id)).toBe(true); // the radius still drives it
    expect(sk.symbols.map((s) => s.id)).toEqual([mark.id]);
  });

  it("removes a circle that is crossed fewer than twice", () => {
    const sk = emptySketch();
    const c = addCircle(sk, addPoint(sk, 0, 0).id, 5);
    expect(planTrim(sk, c.id, [5, 0])!.whole).toBe(true);
  });

  it("shortens an arc from the end that was clicked", () => {
    const sk = emptySketch();
    const o = addPoint(sk, 0, 0), s = addPoint(sk, 5, 0), e = addPoint(sk, -5, 0);
    const arc = addArc(sk, o.id, s.id, e.id); // upper half
    line(sk, 0, 0, 0, 8); // crosses it at the top
    trim(sk, arc.id, [3, 4]); // the right-hand quarter
    expect(point(sk, arc.p1).x).toBeCloseTo(0);
    expect(point(sk, arc.p1).y).toBeCloseTo(5);
    expect(arc.p2).toBe(e.id);
  });

  it("keeps a trimmed centre line a centre line", () => {
    const sk = emptySketch();
    const h = line(sk, 0, 0, 10, 0);
    h.centre = true;
    line(sk, 3, -2, 3, 2);
    line(sk, 7, -2, 7, 2);
    trim(sk, h.id, [5, 0]);
    expect(lines(sk).filter((l) => l.centre)).toHaveLength(2);
  });
});
