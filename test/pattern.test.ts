import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import { SketchSolver } from "../src/solver";
import {
  emptySketch, addPoint, addLine, addCircle, addArc, addConstraint, addSupport, addSymbol, point, remove, entity,
  constraint, isLink, curves, serialize, deserialize, type Sketch, type Link, type Line, type Arc, type Circle,
} from "../src/model";
import { mirrorCopy, linearCopy, circularCopy, type CopyResult } from "../src/pattern";

let solver: SketchSolver;
beforeAll(async () => { solver = new SketchSolver(await make_gcs_wrapper()); });
afterAll(() => solver.dispose());

const xy = (sk: Sketch, id: string) => { const p = point(sk, id); return [p.x, p.y]; };
const close = (got: number[], want: number[], digits = 6) =>
  got.forEach((v, i) => expect(v).toBeCloseTo(want[i], digits));
const ok = (r: CopyResult | string): CopyResult => {
  if (typeof r === "string") throw new Error(r);
  return r;
};
const link = (sk: Sketch, r: CopyResult) => constraint(sk, r.link) as Link;
const solved = (sk: Sketch) => {
  const r = solver.solve(sk);
  expect(r.ok).toBe(true);
  expect(r.conflicting).toEqual([]);
  expect(r.redundant).toEqual([]);
  return r;
};
const radius = (sk: Sketch, a: Arc) => Math.hypot(point(sk, a.p1).x - point(sk, a.c).x, point(sk, a.p1).y - point(sk, a.c).y);

/** A vertical mirror line on x = 0 from (0, -1) to (0, 5), fixed in place. */
function axis(sk: Sketch): Line {
  const a = addPoint(sk, 0, -1), b = addPoint(sk, 0, 5);
  addConstraint(sk, { type: "fixed", p: a.id });
  addConstraint(sk, { type: "fixed", p: b.id });
  return addLine(sk, a.id, b.id);
}

describe("mirror", () => {
  it("copies a line to the other side and keeps it there", () => {
    const sk = emptySketch();
    const l = axis(sk);
    const p = addPoint(sk, 1, 0), q = addPoint(sk, 3, 2);
    const line = addLine(sk, p.id, q.id);
    const before = solved(sk).dof;
    const r = ok(mirrorCopy(sk, [line.id], l.id));
    expect(r.made).toHaveLength(1);
    const copy = entity(sk, r.made[0]) as Line;
    close(xy(sk, copy.p1), [-1, 0]);
    close(xy(sk, copy.p2), [-3, 2]);
    // The image adds nothing that can move on its own.
    expect(solved(sk).dof).toBe(before);
    // Moving the original moves the image.
    solver.solve(sk, [{ kind: "point", id: q.id, x: 4, y: 3 }]);
    close(xy(sk, copy.p2), [-point(sk, q.id).x, point(sk, q.id).y]);
    close(xy(sk, q.id), [4, 3], 4);
  });

  it("shares points on the mirror line and leaves alone what is its own image", () => {
    const sk = emptySketch();
    const l = axis(sk);
    const top = addPoint(sk, 0, 4), right = addPoint(sk, 2, 0), base = addPoint(sk, 0, 0);
    const a = addLine(sk, top.id, right.id), b = addLine(sk, right.id, base.id), spine = addLine(sk, base.id, top.id);
    const across1 = addPoint(sk, -1, 2), across2 = addPoint(sk, 1, 2);
    const cross = addLine(sk, across1.id, across2.id);
    const hole = addCircle(sk, top.id, 0.5);
    const n = sk.entities.length;
    const r = ok(mirrorCopy(sk, [a.id, b.id, spine.id, cross.id, hole.id], l.id));
    // Two lines and one new point: the spine, the squarely crossing line and the circle on the line stay single.
    expect(r.made).toHaveLength(2);
    expect(sk.entities.length).toBe(n + 3);
    expect(r.shared.sort()).toEqual([base.id, top.id].sort());
    expect(link(sk, r).pairs).toHaveLength(1);
    solved(sk);
  });

  it("mirrors arcs without saying anything twice", () => {
    const sk = emptySketch();
    const l = axis(sk);
    // Off the line altogether.
    const c = addPoint(sk, 3, 1), s = addPoint(sk, 4, 1), e = addPoint(sk, 3, 2);
    const arc = addArc(sk, c.id, s.id, e.id);
    // Centred on the line.
    const c2 = addPoint(sk, 0, 3), s2 = addPoint(sk, 1, 3), e2 = addPoint(sk, 0.6, 3.8);
    const arc2 = addArc(sk, c2.id, s2.id, e2.id);
    addConstraint(sk, { type: "pointOn", p: c2.id, on: l.id });
    const before = solved(sk).dof;
    const r = ok(mirrorCopy(sk, [arc.id, arc2.id], l.id));
    const k = link(sk, r);
    expect(k.pairs).toHaveLength(3); // centre and one end of the first arc, one end of the second
    expect(k.half).toHaveLength(2);
    expect(solved(sk).dof).toBe(before);
    const copy = entity(sk, r.made[0]) as Arc;
    // Still counter-clockwise: the image of the end is where the copy starts.
    close(xy(sk, copy.p1), [-3, 2]);
    close(xy(sk, copy.p2), [-4, 1]);
    // Growing the original grows the image.
    addConstraint(sk, { type: "fixed", p: c.id });
    const dim = addConstraint(sk, { type: "radius", target: arc.id, value: 1.5, angle: 0 });
    solved(sk);
    expect(radius(sk, copy)).toBeCloseTo(1.5, 6);
    expect(dim.value).toBe(1.5);
    close(xy(sk, copy.c), [-3, 1]);
  });

  it("mirrors a closed outline of lines and arcs joined end to end", () => {
    const sk = emptySketch();
    const l = axis(sk);
    // A slot lying to the right of the line: two arcs and two lines sharing their ends.
    const A = addPoint(sk, 2, 1), B = addPoint(sk, 5, 1);
    const a1 = addPoint(sk, 2, 1.5), a2 = addPoint(sk, 2, 0.5), b1 = addPoint(sk, 5, 0.5), b2 = addPoint(sk, 5, 1.5);
    const arcA = addArc(sk, A.id, a1.id, a2.id), arcB = addArc(sk, B.id, b1.id, b2.id);
    const low = addLine(sk, a2.id, b1.id), high = addLine(sk, b2.id, a1.id);
    for (const [line, arc] of [[low, arcA], [low, arcB], [high, arcA], [high, arcB]] as const) addConstraint(sk, { type: "tangent", l: line.id, c: arc.id });
    addConstraint(sk, { type: "equal", a: arcA.id, b: arcB.id });
    const before = solved(sk).dof;
    expect(before).toBe(5); // two centres and a width
    const r = ok(mirrorCopy(sk, [arcA.id, arcB.id, low.id, high.id], l.id));
    expect(r.made).toHaveLength(4);
    expect(solved(sk).dof).toBe(before);
  });

  it("carries supports, centre marks, hatching and fills across", () => {
    const sk = emptySketch();
    const l = axis(sk);
    const p = addPoint(sk, 1, 0), q = addPoint(sk, 3, 0), t = addPoint(sk, 2, 2);
    const pq = addLine(sk, p.id, q.id), qt = addLine(sk, q.id, t.id), tp = addLine(sk, t.id, p.id);
    const hole = addCircle(sk, addPoint(sk, 2, 0.6).id, 0.3);
    addSupport(sk, "pin", p.id, 0);
    addSymbol(sk, { type: "hatch", on: pq.id, side: -1, spacing: 0.2, depth: 0.2 });
    addSymbol(sk, { type: "centermark", on: hole.id, angle: 0.3 });
    addSymbol(sk, { type: "fill", color: "#d5dbe1", points: [p.id, q.id, t.id], arcs: [null, null, null], curves: [pq.id, qt.id, tp.id], holes: [hole.id] });
    addSymbol(sk, { type: "datum", at: t.id, color: "#d32f2f", label: "A", dx: 2, dy: 2 });
    const r = ok(mirrorCopy(sk, [pq.id, qt.id, tp.id, hole.id], l.id));
    const kinds = r.made.map((id) => sk.symbols.find((s) => s.id === id)?.type).filter(Boolean).sort();
    expect(kinds).toEqual(["centermark", "datum", "fill", "hatch", "support"]);
    const made = (type: string) => sk.symbols.filter((s) => s.type === type)[1];
    const hatch = made("hatch"), fill = made("fill"), datum = made("datum"), mark = made("centermark"), support = made("support");
    // Left and right of the line change places; the ground of the support stays below.
    expect(hatch.type === "hatch" && hatch.side).toBe(1);
    expect(support.type === "support" && Math.cos(support.angle)).toBeCloseTo(1, 9);
    expect(mark.type === "centermark" && mark.angle).toBeCloseTo(Math.PI - 0.3, 9);
    expect(fill.type === "fill" && fill.holes).toHaveLength(1);
    expect(datum.type === "datum" && [datum.label, datum.dx, datum.dy]).toEqual(["B", -2, 2]);
    solved(sk);
  });

  it("gives a reason when there is nothing to do", () => {
    const sk = emptySketch();
    const l = axis(sk);
    expect(typeof mirrorCopy(sk, [], l.id)).toBe("string");
    expect(typeof mirrorCopy(sk, [l.id], l.id)).toBe("string");
    const n = sk.constraints.length;
    const spine = addLine(sk, addPoint(sk, 0, 1).id, addPoint(sk, 0, 2).id);
    expect(typeof mirrorCopy(sk, [spine.id], l.id)).toBe("string");
    expect(sk.constraints.length).toBe(n);
  });
});

describe("linear pattern", () => {
  it("makes copies one step apart that follow the original", () => {
    const sk = emptySketch();
    const p = addPoint(sk, 0, 0), q = addPoint(sk, 1, 2);
    const line = addLine(sk, p.id, q.id);
    const hole = addCircle(sk, addPoint(sk, 0.5, 0.5).id, 0.25);
    const before = solved(sk).dof;
    const r = ok(linearCopy(sk, [line.id, hole.id], 4, [2, 0]));
    expect(r.made).toHaveLength(6);
    // Only the step is new: two freedoms for the whole pattern.
    expect(solved(sk).dof).toBe(before + 2);
    const lines = curves(sk).filter((e): e is Line => e.type === "line");
    close(xy(sk, lines[3].p2), [7, 2]);
    // A longer original makes every copy longer, and the copies keep their spacing.
    addConstraint(sk, { type: "fixed", p: p.id });
    addConstraint(sk, { type: "horizontal", a: p.id, b: lines[1].p1 });
    addConstraint(sk, { type: "distance", a: p.id, b: lines[1].p1, mode: "aligned", value: 3, offset: 1 });
    addConstraint(sk, { type: "distance", a: p.id, b: q.id, mode: "vertical", value: 5, offset: 1 });
    addConstraint(sk, { type: "distance", a: p.id, b: q.id, mode: "horizontal", value: 1, offset: 1 });
    const circles = curves(sk).filter((e): e is Circle => e.type === "circle");
    addConstraint(sk, { type: "radius", target: circles[0].id, value: 0.4, angle: 0 });
    solved(sk);
    close(xy(sk, lines[3].p1), [9, 0]);
    close(xy(sk, lines[3].p2), [10, 5]);
    expect(circles[3].r).toBeCloseTo(0.4, 6);
  });

  it("repeats arcs, chained end to end, without redundancy", () => {
    const sk = emptySketch();
    // An S of two arcs that share an end.
    const c1 = addPoint(sk, 0, 0), s = addPoint(sk, 1, 0), m = addPoint(sk, 0, 1);
    const c2 = addPoint(sk, 0, 2), e = addPoint(sk, -1, 2);
    const first = addArc(sk, c1.id, s.id, m.id), second = addArc(sk, c2.id, e.id, m.id);
    const before = solved(sk).dof;
    const r = ok(linearCopy(sk, [first.id, second.id], 3, [0.5, 4]));
    const k = link(sk, r);
    expect(k.pairs).toHaveLength(2 * 3); // per copy: two centres and one end
    expect(k.half).toHaveLength(2 * 2);  // per copy: the shared end and the far end
    expect(solved(sk).dof).toBe(before + 2);
    const arcs = curves(sk).filter((x): x is Arc => x.type === "arc");
    close(xy(sk, arcs[4].p2), [1, 9]);
    solver.solve(sk, [{ kind: "point", id: s.id, x: 2, y: 0 }]);
    expect(radius(sk, arcs[4])).toBeCloseTo(radius(sk, first), 6);
  });

  it("ties every copy to the original, so deleting one leaves the others in place", () => {
    const sk = emptySketch();
    const p = addPoint(sk, 0, 0), q = addPoint(sk, 1, 1);
    const line = addLine(sk, p.id, q.id);
    addConstraint(sk, { type: "fixed", p: p.id });
    const r = ok(linearCopy(sk, [line.id], 4, [2, 0]));
    expect(link(sk, r).pairs).toHaveLength(6);
    // The first copy goes; the second and third are still two and three steps from the original.
    remove(sk, [r.made[0]]);
    expect(link(sk, r).pairs.map((x) => x[2])).toEqual([2, 2, 3, 3]);
    expect(solved(sk).dof).toBe(4); // the far end of the original, and the step
    const third = entity(sk, r.made[2]) as Line;
    solver.solve(sk, [{ kind: "point", id: third.p1, x: 9, y: 3 }]);
    close(xy(sk, third.p1), [9, 3], 4);
    close(xy(sk, (entity(sk, r.made[1]) as Line).p1), [6, 2], 4);
    close(xy(sk, third.p2), [point(sk, q.id).x + 9, point(sk, q.id).y + 3], 4);
    // With every copy gone the link goes too.
    remove(sk, [r.made[1], r.made[2]]);
    expect(sk.constraints.some(isLink)).toBe(false);
    solved(sk);
  });

  it("survives a round trip through a file", () => {
    const sk = emptySketch();
    const line = addLine(sk, addPoint(sk, 0, 0).id, addPoint(sk, 1, 1).id);
    ok(linearCopy(sk, [line.id], 3, [2, 0]));
    const back = deserialize(serialize(sk));
    expect(back.constraints).toEqual(sk.constraints);
    expect(solver.solve(back).ok).toBe(true);
  });
});

describe("circular pattern", () => {
  it("turns copies about a point", () => {
    const sk = emptySketch();
    const centre = addPoint(sk, 1, 1);
    addConstraint(sk, { type: "fixed", p: centre.id });
    const hole = addCircle(sk, addPoint(sk, 3, 1).id, 0.3);
    const spoke = addLine(sk, centre.id, addPoint(sk, 2.5, 1).id);
    const before = solved(sk).dof;
    const r = ok(circularCopy(sk, [hole.id, spoke.id], centre.id, 6, Math.PI / 3));
    expect(r.made).toHaveLength(10);
    // Nothing new can move: every copy follows from the first.
    expect(solved(sk).dof).toBe(before);
    const circles = curves(sk).filter((e): e is Circle => e.type === "circle");
    close(xy(sk, circles[3].c), [-1, 1]);
    close(xy(sk, circles[1].c), [1 + 2 * Math.cos(Math.PI / 3), 1 + 2 * Math.sin(Math.PI / 3)]);
    // The spokes all start at the shared centre.
    const lines = curves(sk).filter((e): e is Line => e.type === "line");
    expect(lines.every((l) => l.p1 === centre.id)).toBe(true);
    // Pulling the first hole out pulls them all out.
    addConstraint(sk, { type: "horizontal", a: centre.id, b: hole.c });
    addConstraint(sk, { type: "distance", a: centre.id, b: hole.c, mode: "aligned", value: 4, offset: 1 });
    solved(sk);
    close(xy(sk, circles[3].c), [-3, 1]);
    close(xy(sk, circles[4].c), [1 + 4 * Math.cos((4 * Math.PI) / 3), 1 + 4 * Math.sin((4 * Math.PI) / 3)]);
  });

  it("repeats an arc about its own centre and about another", () => {
    const sk = emptySketch();
    const centre = addPoint(sk, 0, 0);
    addConstraint(sk, { type: "fixed", p: centre.id });
    const own = addArc(sk, centre.id, addPoint(sk, 2, 0).id, addPoint(sk, 1.6, 1.2).id);
    const other = addArc(sk, addPoint(sk, 3, 0).id, addPoint(sk, 3.5, 0).id, addPoint(sk, 3, 0.5).id);
    const before = solved(sk).dof;
    const r = ok(circularCopy(sk, [own.id, other.id], centre.id, 4, Math.PI / 2));
    const k = link(sk, r);
    expect(k.half).toHaveLength(6);
    expect(solved(sk).dof).toBe(before);
    const arcs = curves(sk).filter((x): x is Arc => x.type === "arc");
    close(xy(sk, arcs[2].p1), [0, 2]);
    close(xy(sk, arcs[3].c), [0, 3]);
    solver.solve(sk, [{ kind: "point", id: other.c, x: 4, y: 0 }]);
    close(xy(sk, arcs[3].c), [0, point(sk, other.c).x], 4);
  });
});
