import { clone, isFixed, addConstraint, type Sketch } from "./model";
import type { Drag, SketchSolver, SolveResult } from "./solver";

/** Apply a group drag atomically: every requested point must reach its target. */
export function solveGroupMove(sk: Sketch, solver: SketchSolver, drags: Drag[]): SolveResult {
  const candidate = clone(sk);
  const targets = new Map(drags.flatMap((d) => d.kind === "point" ? [[d.id, d] as const] : []));
  const blocked: SolveResult = { ok: false, dof: 0, conflicting: [], redundant: [] };
  for (const e of candidate.entities) {
    if (e.type === "point") {
      const target = targets.get(e.id);
      if (!target) continue;
      // A real anchor blocks the whole group instead of stretching the other objects.
      if (isFixed(sk, e.id) && Math.hypot(target.x - e.x, target.y - e.y) > 1e-8) return blocked;
      e.x = target.x;
      e.y = target.y;
      if (!isFixed(candidate, e.id)) addConstraint(candidate, { type: "fixed", p: e.id });
    } else if (e.type === "circle" && targets.has(e.c)) {
      if (!candidate.constraints.some((c) => c.type === "radius" && c.target === e.id)) {
        addConstraint(candidate, { type: "radius", target: e.id, value: e.r, angle: 0 });
      }
    }
  }
  const pinned = solver.solve(candidate);
  if (!pinned.ok) return pinned;
  // planegcs can skip equations whose inputs are all fixed. Recheck without
  // the temporary pins before accepting, including dimensions to the origin.
  candidate.constraints = clone(sk).constraints;
  const result = solver.solve(candidate);
  if (!result.ok) return result;
  for (const e of candidate.entities) {
    if (e.type === "point") {
      const target = targets.get(e.id);
      if (target && Math.hypot(e.x - target.x, e.y - target.y) > 1e-6) return blocked;
    } else if (e.type === "circle" && targets.has(e.c)) {
      const original = sk.entities.find((p) => p.id === e.id);
      if (original?.type === "circle" && Math.abs(e.r - original.r) > 1e-6) return blocked;
    }
  }
  // Temporary pins and radius constraints never enter the document or Undo history.
  const solved = new Map(candidate.entities.map((e) => [e.id, e]));
  for (const e of sk.entities) {
    const next = solved.get(e.id);
    if (e.type === "point" && next?.type === "point") { e.x = next.x; e.y = next.y; }
    else if (e.type === "circle" && next?.type === "circle") e.r = next.r;
  }
  return result;
}
