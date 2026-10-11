// Bridge between the sketch model and FreeCAD's planegcs solver.

import { GcsWrapper, SolveStatus, DebugMode, type SketchPrimitive } from "@salusoft89/planegcs";
import {
  type Sketch, type Id, type Constraint, type Entity, type Link, type HalfPair,
  ORIGIN, entity, point, isFixed, arcRadius,
} from "./model";
import { type V, sub, dot, cross, norm, perp } from "./geom";

/** Something the pointer is pulling on while the sketch is solved. */
export type Drag =
  | { kind: "point"; id: Id; x: number; y: number }
  /** Pull the rim of a circle or arc towards a position. */
  | { kind: "rim"; id: Id; x: number; y: number };

/** What in a sketch is not yet pinned down. */
export interface Freedom {
  /** Points that can still move. */
  points: Set<Id>;
  /** Circles whose radius can still change. */
  radii: Set<Id>;
}

export interface SolveResult {
  ok: boolean;
  /** Degrees of freedom left. Meaningful only when ok. */
  dof: number;
  conflicting: Id[];
  redundant: Id[];
}

const TWO_PI = Math.PI * 2;

type Prim = SketchPrimitive;
/** An unknown of its own that constraints can share, such as the step of a pattern. */
interface FreeParam { name: string; value: number }

function geometryPrims(sk: Sketch): Prim[] {
  const out: Prim[] = [];
  const fixed = new Set<Id>([ORIGIN]);
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

/** Equal radius for two circles or arcs, in any mix. Null when one of them is neither. */
function equalRadius(sk: Sketch, id: string, a: Id, b: Id): Prim | null {
  const ka = entity(sk, a)?.type, kb = entity(sk, b)?.type;
  if (ka === "circle" && kb === "circle") return { id, type: "equal_radius_cc", c1_id: a, c2_id: b };
  if (ka === "arc" && kb === "arc") return { id, type: "equal_radius_aa", a1_id: a, a2_id: b };
  if (ka === "circle" && kb === "arc") return { id, type: "equal_radius_ca", c1_id: a, a2_id: b };
  if (ka === "arc" && kb === "circle") return { id, type: "equal_radius_ca", c1_id: b, a2_id: a };
  return null;
}

/**
 * The one direction an image held by half a pair can still move in: along
 * its arc for an end, along the bisector of the arc's ends for a centre. Null
 * when the arc is not there to say.
 */
function freeDirection(sk: Sketch, h: HalfPair): V | null {
  const arc = entity(sk, h.arc);
  if (arc?.type !== "arc") return null;
  const xy = (id: Id): V => { const p = point(sk, id); return [p.x, p.y]; };
  const across = h.role === "end" ? sub(xy(h.to), xy(arc.c)) : sub(xy(arc.p2), xy(arc.p1));
  if (Math.hypot(across[0], across[1]) < 1e-12) return null;
  return norm(perp(across));
}

/**
 * A mirror, shift or turn as planegcs constraints. A whole pair takes two
 * equations. Half a pair takes the one of the two that acts along the
 * direction its image can still move in, so it never comes out degenerate.
 */
function linkPrims(sk: Sketch, c: Link, params: FreeParam[]): Prim[] {
  const out: Prim[] = [];
  const xy = (id: Id): V => { const p = point(sk, id); return [p.x, p.y]; };
  let n = 0;
  const next = () => `${c.id}:${n++}`;
  /** Half pairs whose arc has gone are held like whole ones. */
  const whole: { from: Id; to: Id; steps: number }[] = c.pairs.map(([from, to, steps]) => ({ from, to, steps: steps ?? 1 }));
  const halves: { from: Id; to: Id; steps: number; t: V }[] = [];
  for (const h of c.half) {
    const t = freeDirection(sk, h);
    const pair = { from: h.from, to: h.to, steps: h.steps ?? 1 };
    if (t) halves.push({ ...pair, t });
    else whole.push(pair);
  }

  if (c.type === "mirror") {
    const l = entity(sk, c.l);
    if (l?.type !== "line") throw new Error("a mirror needs a line");
    const u = norm(sub(xy(l.p2), xy(l.p1)));
    const ends = { l2p1_id: l.p1, l2p2_id: l.p2 };
    for (const { from, to } of whole) out.push({ id: next(), type: "p2p_symmetric_ppl", p1_id: from, p2_id: to, l_id: c.l });
    for (const { from, to, t } of halves) {
      // Either the image lies straight across the line, or the middle of the two is on it.
      const along = Math.abs(dot(t, u)) >= Math.abs(cross(u, t));
      out.push({ id: next(), type: along ? "perpendicular_pppp" : "midpoint_on_line_pppp", l1p1_id: from, l1p2_id: to, ...ends });
    }
  } else if (c.type === "shift") {
    // The step is an unknown that every pair shares; the second copy is two of it away, and
    // so on. It starts out as what the first pair makes it.
    const first = whole[0] ?? halves[0];
    if (!first) return out;
    const gap = sub(xy(first.to), xy(first.from));
    const step = { x: gap[0] / first.steps, y: gap[1] / first.steps };
    const made = new Set<string>();
    /**
     * The name of the unknown for `steps` steps along x or y, made on first
     * use. Each is the one before it plus one step; the solver's own
     * "proportional" constraint ignores its ratio, so that is how multiples are said.
     */
    const reach = (prop: "x" | "y", steps: number): string => {
      const name = (k: number) => `${c.id}:d${prop}${k === 1 ? "" : k}`;
      for (let k = 1; k <= steps; k++) {
        if (made.has(name(k))) continue;
        made.add(name(k));
        params.push({ name: name(k), value: step[prop] * k });
        if (k > 1) out.push({ id: next(), type: "difference", param1: name(k - 1), param2: name(k), difference: name(1) });
      }
      return name(steps);
    };
    const eq = (p: { from: Id; to: Id; steps: number }, prop: "x" | "y") =>
      out.push({ id: next(), type: "difference", param1: { o_id: p.from, prop }, param2: { o_id: p.to, prop }, difference: reach(prop, p.steps) });
    for (const p of whole) { eq(p, "x"); eq(p, "y"); }
    for (const p of halves) eq(p, Math.abs(p.t[0]) >= Math.abs(p.t[1]) ? "x" : "y");
  } else {
    const centre = xy(c.c);
    const same = (p: { from: Id; to: Id }): Prim => ({ id: next(), type: "point_on_perp_bisector_ppp", p_id: c.c, lp1_id: p.from, lp2_id: p.to });
    const turned = (p: { from: Id; to: Id; steps: number }): Prim =>
      ({ id: next(), type: "l2l_angle_pppp", l1p1_id: c.c, l1p2_id: p.from, l2p1_id: c.c, l2p2_id: p.to, angle: c.angle * p.steps });
    for (const p of whole) out.push(same(p), turned(p));
    for (const p of halves) {
      // As far from the centre as its point, or at the right angle round it.
      const e = norm(sub(xy(p.to), centre));
      out.push(Math.abs(dot(p.t, e)) >= Math.abs(cross(e, p.t)) ? same(p) : turned(p));
    }
  }
  // A copied circle may since have been trimmed into an arc.
  for (const [a, b] of c.circles) {
    const same = equalRadius(sk, next(), a, b);
    if (same) out.push(same);
  }
  return out;
}

/**
 * Translates one model constraint into zero or more planegcs constraints.
 * Unknowns it needs beyond the geometry are added to `params`.
 */
function constraintPrims(sk: Sketch, c: Constraint, params: FreeParam[]): Prim[] {
  const id = c.id;
  switch (c.type) {
    case "mirror":
    case "shift":
    case "turn":
      return linkPrims(sk, c, params);
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
      if (kindOf(sk, c.a) === "line" && kindOf(sk, c.b) === "line") return [{ id, type: "equal_length", l1_id: c.a, l2_id: c.b }];
      const same = equalRadius(sk, id, c.a, c.b);
      if (!same) throw new Error("equal needs two lines, or two circles or arcs");
      return [same];
    }
    case "tangent": {
      const round = entity(sk, c.c), l = entity(sk, c.l);
      if (round && l && l.type !== "line" && l.type !== "point" && round.type !== "line" && round.type !== "point") {
        // Two circles or arcs. Arcs that meet at a shared end are tangent there when that end
        // is in line with both centres; said that way there is no doubt about which side they touch on.
        if (l.type === "arc" && round.type === "arc") {
          const shared = [l.p1, l.p2].find((p) => p === round.p1 || p === round.p2);
          if (shared && l.c !== round.c) return [{ id, type: "point_on_line_ppp", p_id: shared, lp1_id: l.c, lp2_id: round.c }];
          return [{ id, type: "tangent_aa", a1_id: l.id, a2_id: round.id }];
        }
        if (l.type === "circle" && round.type === "circle") return [{ id, type: "tangent_cc", c1_id: l.id, c2_id: round.id }];
        const [circle, arc] = l.type === "circle" ? [l, round] : [round, l];
        return [{ id, type: "tangent_ca", c_id: circle.id, a_id: arc.id }];
      }
      if (!round || l?.type !== "line") throw new Error("tangent needs a line and a circle or arc");
      if (round.type === "circle") return [{ id, type: "tangent_lc", l_id: c.l, c_id: c.c }];
      if (round.type !== "arc") throw new Error("tangent needs a line and a circle or arc");
      // Where the line starts at an end of the arc, it is tangent when it is square to the
      // radius there. Said that way the solver gets a slope to follow; the distance from the
      // centre to the line has none at the answer.
      const shared = [round.p1, round.p2].find((p) => p === l.p1 || p === l.p2);
      if (shared) return [{ id, type: "perpendicular_pppp", l1p1_id: round.c, l1p2_id: shared, l2p1_id: l.p1, l2p2_id: l.p2 }];
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
  constructor(private gcs: GcsWrapper) {
    // By default the solver logs every diagnosis to the console.
    gcs.debug_mode = DebugMode.NoDebug;
  }

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
    const params: FreeParam[] = [];
    for (const c of sk.constraints) constraints.push(...constraintPrims(sk, c, params));
    for (const p of params) g.push_sketch_param(p.name, p.value, false);

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

  /** Degrees of freedom with one point pinned or an extra constraint added; null if that does not solve. */
  private dofWith(sk: Sketch, pin: Id | null, extra: Prim[]): number | null {
    const g = this.gcs;
    g.clear_data();
    const geometry = geometryPrims(sk).map((p) => (p.type === "point" && p.id === pin ? { ...p, fixed: true } : p));
    const constraints: Prim[] = [];
    const params: FreeParam[] = [];
    for (const c of sk.constraints) constraints.push(...constraintPrims(sk, c, params));
    for (const p of params) g.push_sketch_param(p.name, p.value, false);
    g.push_primitives_and_params([...geometry, ...constraints, ...extra]);
    const status = g.solve();
    if (status !== SolveStatus.Success && status !== SolveStatus.Converged) return null;
    return g.gcs.dof();
  }

  /**
   * Which points can still move, and which circles can still change size.
   * A point is free if pinning it where it is uses up a degree of freedom.
   * Returns null when the sketch does not solve, or is too large to probe
   * point by point. Does not change the sketch.
   */
  freedom(original: Sketch): Freedom | null {
    if (original.entities.length > 400) return null;
    // Probe a solved copy: pinning a point only makes sense where the constraints already hold.
    const sk = structuredClone(original);
    if (!this.solve(sk).ok) return null;
    const pts = sk.entities.filter((e) => e.type === "point");
    const base = this.dofWith(sk, null, []);
    if (base === null) return null;
    const out: Freedom = { points: new Set(), radii: new Set() };
    if (base <= 0) return out;
    for (const p of pts) {
      if (isFixed(sk, p.id)) continue;
      const d = this.dofWith(sk, p.id, []);
      if (d !== null && d < base) out.points.add(p.id);
    }
    for (const e of sk.entities) {
      if (e.type !== "circle") continue;
      const d = this.dofWith(sk, null, [{ id: "probe:r", type: "circle_radius", c_id: e.id, radius: e.r }]);
      if (d !== null && d < base) out.radii.add(e.id);
    }
    return out;
  }

  dispose(): void {
    this.gcs.destroy_gcs_module();
  }
}
