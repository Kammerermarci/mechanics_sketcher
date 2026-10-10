// Random sketches, trimmed at random places, the way the app does it: whatever is left must still
// lie on the curves it was cut from, and the piece that was clicked must be gone.

import { it, expect, beforeAll, afterAll } from "vitest";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import { SketchSolver } from "../src/solver";
import { emptySketch, addPoint, addLine, addCircle, addArc, addConstraint, curves, point, arcRadius, arcAngles, type Sketch, type Curve } from "../src/model";
import { planTrim, applyTrim } from "../src/trim";

let solver: SketchSolver;
beforeAll(async () => { solver = new SketchSolver(await make_gcs_wrapper()); });
afterAll(() => solver.dispose());

let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const R = (a: number, b: number) => a + (b - a) * rnd();

/** Points sampled along a curve. */
function sample(sk: Sketch, e: Curve, n = 40): [number, number][] {
  const out: [number, number][] = [];
  if (e.type === "line") { const a = point(sk, e.p1), b = point(sk, e.p2); for (let i = 0; i <= n; i++) out.push([a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n]); return out; }
  const c = point(sk, e.c);
  if (e.type === "circle") { for (let i = 0; i < n; i++) out.push([c.x + e.r * Math.cos(i * 2 * Math.PI / n), c.y + e.r * Math.sin(i * 2 * Math.PI / n)]); return out; }
  const r = arcRadius(sk, e), { a0, a1 } = arcAngles(sk, e);
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([c.x + r * Math.cos(a), c.y + r * Math.sin(a)]); }
  return out;
}
/** Distance from q to the nearest of the original carriers. */
function carrierDist(q: [number, number], carriers: { kind: string; a?: number[]; b?: number[]; c?: number[]; r?: number }[]): number {
  let best = Infinity;
  for (const k of carriers) {
    if (k.kind === "line") { const [ax, ay] = k.a!, [bx, by] = k.b!; const dx = bx - ax, dy = by - ay; const l = Math.hypot(dx, dy); best = Math.min(best, Math.abs((q[0] - ax) * dy - (q[1] - ay) * dx) / l); }
    else best = Math.min(best, Math.abs(Math.hypot(q[0] - k.c![0], q[1] - k.c![1]) - k.r!));
  }
  return best;
}

it("leaves a constrained sketch where it was, whatever is trimmed", () => {
  const problems: Record<string, number> = {};
  const note = (k: string) => { problems[k] = (problems[k] ?? 0) + 1; };
  let trims = 0;
  for (let round = 0; round < 120; round++) {
    const sk = emptySketch();
    // two or three axis-aligned rectangles with shared corners, level and upright sides, equal opposite sides, dimensions; plus circles
    const nr = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < nr; i++) {
      const x = R(-5, 2), y = R(-5, 2), w = R(1.5, 5), h = R(1.5, 5);
      const p = [addPoint(sk, x, y), addPoint(sk, x + w, y), addPoint(sk, x + w, y + h), addPoint(sk, x, y + h)];
      const l = p.map((a, k) => addLine(sk, a.id, p[(k + 1) % 4].id));
      addConstraint(sk, { type: "horizontal", a: p[0].id, b: p[1].id });
      addConstraint(sk, { type: "vertical", a: p[1].id, b: p[2].id });
      addConstraint(sk, { type: "horizontal", a: p[2].id, b: p[3].id });
      addConstraint(sk, { type: "vertical", a: p[3].id, b: p[0].id });
      if (rnd() < 0.6) addConstraint(sk, { type: "fixed", p: p[0].id });
      if (rnd() < 0.6) addConstraint(sk, { type: "distance", a: p[0].id, b: p[1].id, mode: "aligned", value: w, offset: 1 });
      if (rnd() < 0.6) addConstraint(sk, { type: "distance", a: p[1].id, b: p[2].id, mode: "aligned", value: h, offset: 1 });
      if (rnd() < 0.4) { const m = addPoint(sk, x + w / 2, y, true); addConstraint(sk, { type: "midpoint", p: m.id, l: l[0].id }); }
      void l;
    }
    const nc = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < nc; i++) { const c = addCircle(sk, addPoint(sk, R(-4, 4), R(-4, 4)).id, R(1, 3)); if (rnd() < 0.5) addConstraint(sk, { type: "radius", target: c.id, value: c.r, angle: 0 }); }
    const first = solver.solve(sk);
    if (!first.ok) { note("setup unsolvable"); continue; }
    for (let step = 0; step < 6; step++) {
      const carriers = curves(sk).map((e) => e.type === "line" ? { kind: "line", a: [point(sk, e.p1).x, point(sk, e.p1).y], b: [point(sk, e.p2).x, point(sk, e.p2).y] } : { kind: "round", c: [point(sk, e.c).x, point(sk, e.c).y], r: e.type === "circle" ? e.r : arcRadius(sk, e) });
      const list = curves(sk);
      if (!list.length) break;
      const e = list[Math.floor(rnd() * list.length)];
      const pts = sample(sk, e);
      const at = pts[Math.floor(rnd() * pts.length)];
      const plan = planTrim(sk, e.id, at);
      if (!plan) continue;
      const autos = applyTrim(sk, plan);
      trims++;
      let base;
      try { base = solver.solve(sk); } catch (err) { note("solve threw: " + (err as Error).message); break; }
      if (!base.ok) { note("unsolvable right after trim"); break; }
      for (const a of autos) {
        const c = addConstraint(sk, a);
        const r = solver.solve(sk);
        if (!r.ok || r.conflicting.length > base.conflicting.length || r.redundant.length > base.redundant.length) sk.constraints = sk.constraints.filter((x) => x !== c);
      }
      const fin = solver.solve(sk);
      if (!fin.ok) { note("unsolvable at the end"); break; }
      let worst = 0;
      for (const c of curves(sk)) for (const q of sample(sk, c, 12)) worst = Math.max(worst, carrierDist(q, carriers));
      if (worst > 1e-4) note("geometry moved after a trim (" + (plan.whole ? "whole" : e.type) + ")");
    }
  }
  expect(trims).toBeGreaterThan(500);
  expect(problems).toEqual({});
});

it("removes exactly the piece that was clicked, in sketches of every kind", () => {
  const problems: Record<string, number> = {};
  const note = (k: string) => { problems[k] = (problems[k] ?? 0) + 1; };
  let trims = 0, noplan = 0;
  for (let round = 0; round < 200; round++) {
    const sk = emptySketch();
    const n = 3 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
      const k = rnd();
      if (k < 0.5) addLine(sk, addPoint(sk, R(-5, 5), R(-5, 5)).id, addPoint(sk, R(-5, 5), R(-5, 5)).id);
      else if (k < 0.8) addCircle(sk, addPoint(sk, R(-4, 4), R(-4, 4)).id, R(0.8, 3));
      else { const cx = R(-4, 4), cy = R(-4, 4), r = R(0.8, 3), a0 = R(0, 6.28), a1 = a0 + R(0.5, 5); addArc(sk, addPoint(sk, cx, cy).id, addPoint(sk, cx + r * Math.cos(a0), cy + r * Math.sin(a0)).id, addPoint(sk, cx + r * Math.cos(a1), cy + r * Math.sin(a1)).id); }
    }
    const carriers = curves(sk).map((e) => e.type === "line" ? { kind: "line", a: [point(sk, e.p1).x, point(sk, e.p1).y], b: [point(sk, e.p2).x, point(sk, e.p2).y] } : { kind: "round", c: [point(sk, e.c).x, point(sk, e.c).y], r: e.type === "circle" ? e.r : arcRadius(sk, e) });
    for (let step = 0; step < 6; step++) {
      const list = curves(sk);
      if (!list.length) break;
      const e = list[Math.floor(rnd() * list.length)];
      const pts = sample(sk, e);
      const at = pts[Math.floor(rnd() * pts.length)];
      let plan;
      try { plan = planTrim(sk, e.id, at); } catch (err) { note("plan threw: " + (err as Error).message); break; }
      if (!plan) { noplan++; continue; }
      let autos;
      try { autos = applyTrim(sk, plan); } catch (err) { note("apply threw: " + (err as Error).message); break; }
      trims++;
      const base = solver.solve(sk);
      if (!base.ok) { note("unsolvable right after trim"); break; }
      for (const a of autos) {
        const c = addConstraint(sk, a);
        let r;
        try { r = solver.solve(sk); } catch (err) { note("solve threw: " + (err as Error).message); sk.constraints = sk.constraints.filter((x) => x !== c); continue; }
        // A constraint that says nothing new is left out, as in the app; that is no fault.
        if (!r.ok || r.conflicting.length > base.conflicting.length || r.redundant.length > base.redundant.length) sk.constraints = sk.constraints.filter((x) => x !== c);
      }
      const fin = solver.solve(sk);
      if (!fin.ok) note("unsolvable at the end");
      // what is left must still lie on the original carriers
      let worst = 0;
      for (const c of curves(sk)) for (const q of sample(sk, c, 12)) worst = Math.max(worst, carrierDist(q, carriers));
      if (worst > 1e-5) note("geometry moved off its original curves");
      // the clicked spot must be gone
      const still = curves(sk).some((c) => sample(sk, c, 400).some((q) => Math.hypot(q[0] - at[0], q[1] - at[1]) < 1e-3));
      if (still && !plan.whole) {
        // unless another curve passes through the same spot
        const others = carriers.filter((k) => carrierDist(at, [k]) < 1e-3).length;
        if (others < 2) note("clicked spot still drawn");
      }
    }
  }
  expect(trims).toBeGreaterThan(800);
  expect(noplan).toBe(0);
  expect(problems).toEqual({});
});
