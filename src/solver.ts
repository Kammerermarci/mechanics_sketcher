// Bridge between the sketch model and FreeCAD's planegcs solver.

import { GcsWrapper, SolveStatus, type SketchPrimitive } from "@salusoft89/planegcs";
import {
  type Sketch, type Id, type Constraint, type Entity,
  entity, point, isFixed, arcRadius,
} from "./model";

/** Something the pointer is pulling on while the sketch is solved. */
export type Drag =
  | { kind: "point"; id: Id; x: number; y: number }
  /** Pull the rim of a circle or arc towards a position. */
  | { kind: "rim"; id: Id; x: number; y: number };

export interface SolveResult {
  ok: boolean;
  /** Degrees of freedom left. Meaningful only when ok. */
  dof: number;
  conflicting: Id[];
  redundant: Id[];
}

const TWO_PI = Math.PI * 2;

type Prim = SketchPrimitive;

function geometryPrims(sk: Sketch): Prim[] {
  const out: Prim[] = [];
  const fixed = new Set<Id>();
  for (const c of sk.constraints) if (c.type === "fixed") fixed.add(c.p);

  // planegcs needs every point pushed before the curves that use it.
  for (const e of sk.entities) {
    if (e.type === "point") {
      out.push({ id: e.id, type: "point", x: e.x, y: e.y, fixed: fixed.has(e.id) });
    }
  }
  for (const e of sk.entities) {
    if (e.type === "line") {
      out.push({ id: e.id, type: "line", p1_id: e.p1, p2_id: e.p2 });
    } else if (e.type === "circle") {
      out.push({ id: e.id, type: "circle", c_id: e.c, radius: e.r });
    } else if (e.type === "arc") {
      const c = point(sk, e.c), s = point(sk, e.p1), t = point(sk, e.p2);
      const a0 = Math.atan2(s.y - c.y, s.x - c.x);
      let a1 = Math.atan2(t.y - c.y, t.x - c.x);
      if (a1 <= a0) a1 += TWO_PI;
      out.push({
        id: e.id, type: "arc", c_id: e.c, start_id: e.p1, end_id: e.p2,
        radius: arcRadius(sk, e), start_angle: a0, end_angle: a1,
      });
      out.push({ id: `${e.id}:rules`, type: "arc_rules", a_id: e.id });
    }
  }
  return out;
}

function kindOf(sk: Sketch, id: Id): Entity["type"] {
  const e = entity(sk, id);
  if (!e) throw new Error(`constraint refers to missing entity ${id}`);
  return e.type;
}

/** Translates one model constraint into zero or more planegcs constraints. */
function constraintPrims(sk: Sketch, c: Constraint): Prim[] {
  const id = c.id;
  switch (c.type) {
    case "fixed":
      return []; // expressed through the point's fixed flag
    case "coincident":
      return [{ id, type: "p2p_coincident", p1_id: c.a, p2_id: c.b }];
    case "pointOn": {
      const k = kindOf(sk, c.on);
      if (k === "line") return [{ id, type: "point_on_line_pl", p_id: c.p, l_id: c.on }];
      if (k === "circle") return [{ id, type: "point_on_circle", p_id: c.p, c_id: c.on }];
      return [{ id, type: "point_on_arc", p_id: c.p, a_id: c.on }];
    }
    case "midpoint":
      return [
        { id, type: "point_on_line_pl", p_id: c.p, l_id: c.l },
        { id: `${id}:b`, type: "point_on_perp_bisector_pl", p_id: c.p, l_id: c.l },
      ];
    case "horizontal":
      return [{ id, type: "horizontal_pp", p1_id: c.a, p2_id: c.b }];
    case "vertical":
      return [{ id, type: "vertical_pp", p1_id: c.a, p2_id: c.b }];
    case "parallel":
      return [{ id, type: "parallel", l1_id: c.l1, l2_id: c.l2 }];
    case "perpendicular":
      return [{ id, type: "perpendicular_ll", l1_id: c.l1, l2_id: c.l2 }];
    case "equal": {
      const ka = kindOf(sk, c.a), kb = kindOf(sk, c.b);
      if (ka === "line" && kb === "line") return [{ id, type: "equal_length", l1_id: c.a, l2_id: c.b }];
      if (ka === "circle" && kb === "circle") return [{ id, type: "equal_radius_cc", c1_id: c.a, c2_id: c.b }];
      if (ka === "arc" && kb === "arc") return [{ id, type: "equal_radius_aa", a1_id: c.a, a2_id: c.b }];
      if (ka === "circle" && kb === "arc") return [{ id, type: "equal_radius_ca", c1_id: c.a, a2_id: c.b }];
      if (ka === "arc" && kb === "circle") return [{ id, type: "equal_radius_ca", c1_id: c.b, a2_id: c.a }];
      throw new Error("equal needs two lines, or two circles or arcs");
    }
    case "tangent": {
      const k = kindOf(sk, c.c);
      if (k === "circle") return [{ id, type: "tangent_lc", l_id: c.l, c_id: c.c }];
      return [{ id, type: "tangent_la", l_id: c.l, a_id: c.c }];
    }
    case "distance": {
      if (c.mode === "aligned") {
        return [{ id, type: "p2p_distance", p1_id: c.a, p2_id: c.b, distance: c.value }];
      }
      // Horizontal and vertical distances are signed differences. The sign
      // follows the current layout so the points keep their order.
      const prop = c.mode === "horizontal" ? "x" : "y";
      const a = point(sk, c.a), b = point(sk, c.b);
      const sign = b[prop] - a[prop] < 0 ? -1 : 1;
      return [{
        id, type: "difference",
        param1: { o_id: c.a, prop }, param2: { o_id: c.b, prop },
        difference: sign * c.value,
      }];
    }
    case "angle": {
      const l1 = entity(sk, c.l1), l2 = entity(sk, c.l2);
      if (l1?.type !== "line" || l2?.type !== "line") throw new Error("angle needs two lines");
      return [{
        id, type: "l2l_angle_pppp",
        l1p1_id: c.rev1 ? l1.p2 : l1.p1, l1p2_id: c.rev1 ? l1.p1 : l1.p2,
        l2p1_id: c.rev2 ? l2.p2 : l2.p1, l2p2_id: c.rev2 ? l2.p1 : l2.p2,
        angle: c.value,
      }];
    }
    case "radius": {
      const k = kindOf(sk, c.target);
      if (k === "circle") return [{ id, type: "circle_radius", c_id: c.target, radius: c.value }];
      return [{ id, type: "arc_radius", a_id: c.target, radius: c.value }];
    }
  }
}

function dragPrims(sk: Sketch, drags: Drag[]): Prim[] {
  const out: Prim[] = [];
  drags.forEach((d, i) => {
    if (d.kind === "point") {
      if (isFixed(sk, d.id)) return;
      out.push({ id: `drag${i}:x`, type: "coordinate_x", p_id: d.id, x: d.x, temporary: true });
      out.push({ id: `drag${i}:y`, type: "coordinate_y", p_id: d.id, y: d.y, temporary: true });
    } else {
      const helper = `drag${i}:p`;
      out.push({ id: helper, type: "point", x: d.x, y: d.y, fixed: true });
      const k = kindOf(sk, d.id);
      if (k === "circle") {
        out.push({ id: `drag${i}:on`, type: "point_on_circle", p_id: helper, c_id: d.id, temporary: true });
      } else if (k === "arc") {
        out.push({ id: `drag${i}:on`, type: "point_on_arc", p_id: helper, a_id: d.id, temporary: true });
      }
    }
  });
  return out;
}

/** Maps a planegcs id such as "k12:b" back to the model constraint id. */
function modelId(gcsId: string): Id {
  const i = gcsId.indexOf(":");
  return i < 0 ? gcsId : gcsId.slice(0, i);
}

export class SketchSolver {
  constructor(private gcs: GcsWrapper) {}

  /**
   * Solves the sketch. On success the solved positions are written back into
   * `sk`; on failure `sk` is left untouched.
   */
  solve(sk: Sketch, drags: Drag[] = []): SolveResult {
    const g = this.gcs;
    g.clear_data();

    const geometry = geometryPrims(sk);
    const helpers: Prim[] = [];
    const rest: Prim[] = [];
    for (const p of dragPrims(sk, drags)) (p.type === "point" ? helpers : rest).push(p);
    const constraints: Prim[] = [];
    for (const c of sk.constraints) constraints.push(...constraintPrims(sk, c));

    // Helper points go right after the model points, ahead of every curve.
    const firstCurve = geometry.findIndex((p) => p.type !== "point");
    const split = firstCurve < 0 ? geometry.length : firstCurve;
    g.push_primitives_and_params([
      ...geometry.slice(0, split), ...helpers, ...geometry.slice(split),
      ...constraints, ...rest,
    ]);

    const status = g.solve();
    const ok = status === SolveStatus.Success || status === SolveStatus.Converged;
    const unique = (ids: string[]) =>
      [...new Set(ids.map(modelId))].filter((id) => sk.constraints.some((c) => c.id === id));
    const result: SolveResult = {
      ok,
      dof: g.gcs.dof(),
      conflicting: unique(g.get_gcs_conflicting_constraints()),
      redundant: unique(g.get_gcs_redundant_constraints()),
    };
    if (!ok) return result;

    g.apply_solution();
    const solved = new Map<string, Prim>();
    for (const p of g.sketch_index.get_primitives()) solved.set(p.id, p);
    for (const e of sk.entities) {
      const s = solved.get(e.id);
      if (!s) continue;
      if (e.type === "point" && s.type === "point") {
        if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;
        e.x = s.x;
        e.y = s.y;
      } else if (e.type === "circle" && s.type === "circle" && Number.isFinite(s.radius)) {
        e.r = Math.abs(s.radius);
      }
    }
    return result;
  }

  dispose(): void {
    this.gcs.destroy_gcs_module();
  }
}
