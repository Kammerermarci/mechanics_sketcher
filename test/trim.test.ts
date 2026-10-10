import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import { SketchSolver } from "../src/solver";
import {
  emptySketch, addPoint, addLine, addCircle, addArc, addConstraint, addSymbol, entity, point, type Sketch, type Line, type Arc,
} from "../src/model";
import { planTrim, applyTrim, intersections, strokeHits } from "../src/trim";

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

  it("counts a tangent line as meeting the circle, as exactly as a solver leaves it", () => {
    const sk = emptySketch();
    const c = addCircle(sk, addPoint(sk, 0, 0).id, 2);
    // A hair short of touching, and a hair too deep: both are tangent for all practical purposes.
    for (const y of [2 + 3e-9, 2 - 3e-9]) {
      const t = line(sk, -5, y, 5, y);
      const hits = intersections(sk, t, c, 1e-6);
      expect(hits).toHaveLength(1);
      expect(hits[0][0]).toBeCloseTo(0, 6);
    }
    expect(intersections(sk, line(sk, -5, 2.01, 5, 2.01), c, 1e-6)).toHaveLength(0);
    // So a line is cut where an arc is tangent to it.
    const base = line(sk, -5, -2, 5, -2);
    const plan = planTrim(sk, base.id, [3, -2])!;
    expect(plan.whole).toBe(false);
    expect(plan.gone).toMatchObject({ kind: "line", b: [5, -2] });
    expect((plan.gone as { a: number[] }).a[0]).toBeCloseTo(0, 6);
  });

  it("drops what was said about a line's length and middle, so nothing is pulled about", () => {
    const sk = emptySketch();
    const h = line(sk, 0, 0, 10, 0), other = line(sk, 0, 3, 10, 3);
    line(sk, 4, -3, 4, 2);
    const m = addPoint(sk, 5, 0, true);
    addConstraint(sk, { type: "equal", a: h.id, b: other.id });
    addConstraint(sk, { type: "midpoint", p: m.id, l: h.id });
    const { result } = trim(sk, h.id, [8, 0]);
    expect(result.ok).toBe(true);
    expect(sk.constraints.map((c) => c.type).sort()).toEqual(["pointOn", "pointOn"]);
    // Everything is where it was: the line just ends at the crossing now.
    expect(ends(sk, h)).toEqual([[0, 0], [4, 0]]);
    expect(ends(sk, other)).toEqual([[0, 3], [10, 3]]);
    expect([point(sk, m.id).x, point(sk, m.id).y]).toEqual([5, 0]);
  });

  it("keeps the two pieces of a line cut in the middle in line with each other", () => {
    const sk = emptySketch();
    const slant = line(sk, 0, 0, 10, 5);
    line(sk, 3, -2, 3, 6);
    line(sk, 7, -2, 7, 8);
    addConstraint(sk, { type: "fixed", p: slant.p1 });
    const { autos, result } = trim(sk, slant.id, [5, 2.5]);
    expect(autos.filter((a) => a.type === "pointOn" && a.on === slant.id)).toHaveLength(2);
    expect(result.ok).toBe(true);
    // What is left of the line itself, and the new line made of its far part.
    const first = slant, rest = lines(sk)[lines(sk).length - 1];
    expect(rest.id).not.toBe(slant.id);
    // Pull the far end of the second piece: both pieces turn together about the fixed start.
    solver.solve(sk, [{ kind: "point", id: rest.p2, x: 10, y: 8 }]);
    const [a, b] = ends(sk, first), [c, d] = ends(sk, rest);
    const cross = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    expect(cross(a, b, c)).toBeCloseTo(0, 6);
    expect(cross(a, b, d)).toBeCloseTo(0, 6);
    expect(d[1]).toBeGreaterThan(6);
  });

  it("gives a click just past the start of an arc to the start, not to the far end", () => {
    const sk = emptySketch();
    const o = addPoint(sk, 0, 0), s = addPoint(sk, 5, 0), e = addPoint(sk, -5, 0);
    const upper = addArc(sk, o.id, s.id, e.id);
    line(sk, 0, 1, 0, 9); // crosses the arc at its top
    // A click beside the arc, a little below where it starts on the right.
    const plan = planTrim(sk, upper.id, [5, -0.05])!;
    expect(plan.gone).toMatchObject({ kind: "round" });
    const g = plan.gone as { a0: number; a1: number };
    expect(g.a0).toBeCloseTo(0, 9);
    expect(g.a1).toBeCloseTo(Math.PI / 2, 9);
    // And one just past the end, on the left, to the end.
    const far = planTrim(sk, upper.id, [-5, -0.05])!.gone as { a0: number; a1: number };
    expect(far.a0).toBeCloseTo(Math.PI / 2, 9);
    expect(far.a1).toBeCloseTo(Math.PI, 9);
  });

  it("lists what a stroke of the pointer passes over, in the order it meets them", () => {
    const sk = emptySketch();
    const a = line(sk, 2, -1, 2, 1), b = line(sk, 6, -1, 6, 1);
    const c = addCircle(sk, addPoint(sk, 4, 0).id, 0.5);
    line(sk, 0, 5, 10, 5); // out of the way
    const hits = strokeHits(sk, [0, 0], [10, 0]);
    expect(hits.map((h) => h.id)).toEqual([a.id, c.id, c.id, b.id]);
    expect(hits.map((h) => h.at[0])).toEqual([2, 3.5, 4.5, 6]);
    // Only as far as the stroke goes.
    expect(strokeHits(sk, [0, 0], [3, 0]).map((h) => h.id)).toEqual([a.id]);
    expect(strokeHits(sk, [1, 0], [1, 0])).toEqual([]);
  });
});
